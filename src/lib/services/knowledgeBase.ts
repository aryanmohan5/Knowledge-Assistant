import { createHash } from "node:crypto";
import { EmbeddingError, embedTexts } from "@/lib/ai/embeddings";
import { getEmbeddingConfig } from "@/lib/env";
import { HttpError, notFound } from "@/lib/http/errors";
import {
  formatBytes,
  MAX_CHUNKS_PER_PDF,
  MAX_DOCUMENTS_PER_ORG,
  MAX_PAGES_PER_PDF,
  MAX_PDF_BYTES,
} from "@/lib/limits";
import { chunkPages, type TextChunk } from "@/lib/pdf/chunk";
import { extractPages, openPdf } from "@/lib/pdf/extract";
import { repos } from "@/lib/tenant/repos";
import type { TenantContext, UserPrincipal } from "@/lib/tenant/types";

const INSERT_BATCH = 200;
/** A document still "processing" after this long was interrupted (e.g. a server restart). */
export const STALE_PROCESSING_MS = 10 * 60 * 1000;

const limitError = () =>
  new HttpError(
    409,
    "document_limit_reached",
    `Your organization has reached the limit of ${MAX_DOCUMENTS_PER_ORG} documents. Delete a document before uploading another.`,
  );

function cleanFileName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? "";
  const cleaned = base.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, 255);
  return cleaned || "document.pdf";
}

/**
 * Validates an uploaded PDF against every mandatory limit, extracts and
 * chunks its text, and registers it as `processing`. Nothing is embedded
 * until all checks pass, so a rejected upload costs no AI calls.
 *
 * Limits, in order (cheapest first): document count, file size, file type,
 * duplicate, page count, extractable text.
 */
export async function registerUpload(ctx: TenantContext<UserPrincipal>, form: FormData) {
  const r = repos(ctx);

  const file = form.get("file");
  if (!(file instanceof File)) throw new HttpError(400, "file_required", "Choose a PDF to upload.");
  if (file.size === 0) throw new HttpError(400, "file_empty", "The selected file is empty.");

  if ((await r.knowledgeBases.count()) >= MAX_DOCUMENTS_PER_ORG) throw limitError();
  if (file.size > MAX_PDF_BYTES) {
    throw new HttpError(
      413,
      "file_too_large",
      `"${cleanFileName(file.name)}" is ${formatBytes(file.size)}. PDFs can be at most ${formatBytes(MAX_PDF_BYTES)}.`,
    );
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  const checksumSha256 = createHash("sha256").update(bytes).digest("hex");
  const fileName = cleanFileName(file.name);

  const pdf = await openPdf(bytes);
  let chunks: TextChunk[];
  let pageCount: number;
  try {
    pageCount = pdf.numPages;
    if (pageCount > MAX_PAGES_PER_PDF) {
      throw new HttpError(
        422,
        "too_many_pages",
        `"${fileName}" has ${pageCount} pages. PDFs can have at most ${MAX_PAGES_PER_PDF} pages.`,
      );
    }
    chunks = chunkPages(await extractPages(pdf));
  } finally {
    await pdf.loadingTask.destroy().catch(() => {});
  }

  if (chunks.length === 0) {
    throw new HttpError(
      422,
      "no_extractable_text",
      `No text could be extracted from "${fileName}". Scanned (image-only) PDFs are not supported yet.`,
    );
  }
  if (chunks.length > MAX_CHUNKS_PER_PDF) {
    throw new HttpError(422, "too_much_text", `"${fileName}" contains too much text to process.`);
  }

  const existing = await r.knowledgeBases.findOne({ checksumSha256 }, { title: 1 });
  if (existing) {
    throw new HttpError(409, "duplicate_document", `This PDF has already been uploaded as "${existing.title}".`);
  }

  const titleField = form.get("title");
  const title =
    (typeof titleField === "string" && titleField.trim().slice(0, 200)) || fileName.replace(/\.pdf$/i, "");
  const { model, dimensions } = getEmbeddingConfig();

  let kb;
  try {
    kb = await r.knowledgeBases.create({
      title,
      fileName,
      mimeType: "application/pdf",
      sizeBytes: file.size,
      checksumSha256,
      pageCount,
      status: "processing",
      chunkCount: 0,
      embeddingModel: model,
      embeddingDimensions: dimensions,
      uploadedBy: ctx.principal.userId,
    });
  } catch (err) {
    if ((err as { code?: number }).code === 11000) {
      throw new HttpError(409, "duplicate_document", "This PDF has already been uploaded.");
    }
    throw err;
  }

  // Concurrent uploads can both pass the pre-check; re-count after insert and
  // roll back if this one pushed the tenant over the limit.
  if ((await r.knowledgeBases.count()) > MAX_DOCUMENTS_PER_ORG) {
    await r.knowledgeBases.deleteById(kb._id);
    throw limitError();
  }

  return { knowledgeBase: kb, chunks };
}

export type RegisteredUpload = Awaited<ReturnType<typeof registerUpload>>;

/**
 * Embeds the chunks and stores them, each stamped with organizationId (by
 * the tenant repo), knowledgeBaseId, document name and page number. On any
 * failure the partial chunks are removed and the document is marked failed.
 * If the document is deleted mid-flight, its chunks are cleaned up.
 */
export async function ingestChunks(ctx: TenantContext, { knowledgeBase: kb, chunks }: RegisteredUpload) {
  const r = repos(ctx);
  try {
    const vectors = await embedTexts(
      chunks.map((c) => c.text),
      "document",
    );

    const docs = chunks.map((c, i) => ({
      knowledgeBaseId: kb._id,
      documentName: kb.fileName,
      pageNumber: c.pageNumber,
      chunkIndex: c.chunkIndex,
      text: c.text,
      tokenCount: c.tokenCount,
      embedding: vectors[i],
      embeddingModel: kb.embeddingModel,
    }));
    for (let i = 0; i < docs.length; i += INSERT_BATCH) {
      await r.knowledgeChunks.insertMany(docs.slice(i, i + INSERT_BATCH));
    }

    const done = await r.knowledgeBases.updateOne(
      { _id: kb._id, status: "processing" },
      { $set: { status: "ready", chunkCount: docs.length, processedAt: new Date() }, $unset: { error: 1 } },
    );
    if (!done) await r.knowledgeChunks.deleteMany({ knowledgeBaseId: kb._id });
  } catch (err) {
    console.error(`[ingest] knowledge base ${kb._id} failed`, err);
    await r.knowledgeChunks.deleteMany({ knowledgeBaseId: kb._id }).catch(() => {});
    const message =
      err instanceof EmbeddingError ? err.message : "Processing failed unexpectedly. Delete the document and try again.";
    await r.knowledgeBases
      .updateOne({ _id: kb._id, status: "processing" }, { $set: { status: "failed", error: message } })
      .catch(() => {});
  }
}

/** Marks documents whose processing was interrupted as failed so they don't spin forever. */
export async function failStaleProcessing(ctx: TenantContext) {
  return repos(ctx).knowledgeBases.updateMany(
    { status: "processing", updatedAt: { $lt: new Date(Date.now() - STALE_PROCESSING_MS) } },
    { $set: { status: "failed", error: "Processing was interrupted. Delete the document and upload it again." } },
  );
}

export async function listKnowledgeBases(ctx: TenantContext) {
  await failStaleProcessing(ctx);
  const items = await repos(ctx).knowledgeBases.find({}, { limit: MAX_DOCUMENTS_PER_ORG * 2 });
  return {
    items,
    usage: { documents: items.length },
    limits: { maxDocuments: MAX_DOCUMENTS_PER_ORG, maxPages: MAX_PAGES_PER_PDF, maxBytes: MAX_PDF_BYTES },
  };
}

/** Deletes the document and its chunks; both deletes are tenant-scoped. */
export async function deleteKnowledgeBase(ctx: TenantContext, id: string) {
  const r = repos(ctx);
  const kb = await r.knowledgeBases.findById(id, { _id: 1 });
  if (!kb) throw notFound();
  await r.knowledgeBases.deleteById(kb._id);
  // After the parent is gone, so an in-flight ingestion sees it missing and cleans up too.
  const chunksDeleted = await r.knowledgeChunks.deleteMany({ knowledgeBaseId: kb._id });
  return { id: kb._id.toString(), chunksDeleted };
}

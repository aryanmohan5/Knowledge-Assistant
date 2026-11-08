import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readMultipartWithLimit } from "@/lib/http/upload";
import { MAX_DOCUMENTS_PER_ORG, MAX_PDF_BYTES, MAX_UPLOAD_REQUEST_BYTES } from "@/lib/limits";
import { deleteKnowledgeBase, ingestChunks, listKnowledgeBases, registerUpload } from "@/lib/services/knowledgeBase";
import { KnowledgeBase, KnowledgeChunk } from "@/models";
import { kbInput, makeTenant } from "./helpers";
import { makePdf, mockEmbeddingsApi, pdfFile, uploadForm } from "./pdfHelpers";

const DIMS = 4; // set in tests/setup.ts

beforeEach(() => {
  process.env.OPENAI_API_KEY = "sk-test";
});
afterEach(() => {
  vi.unstubAllGlobals();
});

const longText = (label: string) =>
  Array.from({ length: 250 }, (_, i) => `${label} sentence number ${i} about policy.`).join(" ");

describe("upload limits (checked before any processing)", () => {
  it("rejects a PDF over 10 MB", async () => {
    const a = await makeTenant("org-a");
    const fetch = mockEmbeddingsApi(DIMS);
    const big = new File([new Uint8Array(MAX_PDF_BYTES + 1)], "big.pdf", { type: "application/pdf" });
    await expect(registerUpload(a.ctx, uploadForm(big))).rejects.toMatchObject({
      status: 413,
      code: "file_too_large",
      message: '"big.pdf" is 10.00 MB. PDFs can be at most 10 MB.',
    });
    expect(fetch).not.toHaveBeenCalled();
    expect(await a.r.knowledgeBases.count()).toBe(0);
  });

  it("rejects a PDF with more than 20 pages", async () => {
    const a = await makeTenant("org-a");
    const fetch = mockEmbeddingsApi(DIMS);
    const pdf = await makePdf(Array.from({ length: 21 }, (_, i) => `Page ${i + 1}`));
    await expect(registerUpload(a.ctx, uploadForm(pdfFile(pdf, "long.pdf")))).rejects.toMatchObject({
      status: 422,
      code: "too_many_pages",
      message: '"long.pdf" has 21 pages. PDFs can have at most 20 pages.',
    });
    expect(fetch).not.toHaveBeenCalled();
    expect(await a.r.knowledgeBases.count()).toBe(0);
  });

  it("accepts exactly 20 pages", async () => {
    const a = await makeTenant("org-a");
    const pdf = await makePdf(Array.from({ length: 20 }, (_, i) => `Page ${i + 1} content`));
    const { knowledgeBase } = await registerUpload(a.ctx, uploadForm(pdfFile(pdf)));
    expect(knowledgeBase.pageCount).toBe(20);
  });

  it("rejects the 11th document for an organization", async () => {
    const a = await makeTenant("org-a");
    for (let i = 0; i < MAX_DOCUMENTS_PER_ORG; i++) await a.r.knowledgeBases.create(kbInput(a.ctx, `seed-${i}`));
    const pdf = await makePdf(["One more"]);
    await expect(registerUpload(a.ctx, uploadForm(pdfFile(pdf)))).rejects.toMatchObject({
      status: 409,
      code: "document_limit_reached",
    });
    expect(await a.r.knowledgeBases.count()).toBe(MAX_DOCUMENTS_PER_ORG);
  });

  it("counts the limit per organization", async () => {
    const a = await makeTenant("org-a");
    const b = await makeTenant("org-b");
    for (let i = 0; i < MAX_DOCUMENTS_PER_ORG; i++) await b.r.knowledgeBases.create(kbInput(b.ctx, `b-${i}`));
    const { knowledgeBase } = await registerUpload(a.ctx, uploadForm(pdfFile(await makePdf(["A's first"]))));
    expect(knowledgeBase.organizationId.toString()).toBe(a.org._id.toString());
  });

  it("never exceeds the limit under concurrent uploads", async () => {
    const a = await makeTenant("org-a");
    for (let i = 0; i < MAX_DOCUMENTS_PER_ORG - 1; i++) await a.r.knowledgeBases.create(kbInput(a.ctx, `seed-${i}`));
    const pdfs = await Promise.all([1, 2, 3, 4].map((n) => makePdf([`Concurrent upload ${n}`])));
    await Promise.allSettled(pdfs.map((p) => registerUpload(a.ctx, uploadForm(pdfFile(p)))));
    expect(await a.r.knowledgeBases.count()).toBeLessThanOrEqual(MAX_DOCUMENTS_PER_ORG);
  });

  it("rejects non-PDF content even with a .pdf name", async () => {
    const a = await makeTenant("org-a");
    const fake = new File(["<script>alert(1)</script>"], "invoice.pdf", { type: "application/pdf" });
    await expect(registerUpload(a.ctx, uploadForm(fake))).rejects.toMatchObject({ status: 415 });
  });

  it("rejects a PDF with no extractable text", async () => {
    const a = await makeTenant("org-a");
    await expect(registerUpload(a.ctx, uploadForm(pdfFile(await makePdf([""]))))).rejects.toMatchObject({
      status: 422,
      code: "no_extractable_text",
    });
  });

  it("rejects the same PDF twice in one organization but allows it in another", async () => {
    const a = await makeTenant("org-a");
    const b = await makeTenant("org-b");
    const pdf = await makePdf(["Shared handbook"]);
    await registerUpload(a.ctx, uploadForm(pdfFile(pdf), "Handbook"));
    await expect(registerUpload(a.ctx, uploadForm(pdfFile(pdf)))).rejects.toMatchObject({
      status: 409,
      code: "duplicate_document",
      message: 'This PDF has already been uploaded as "Handbook".',
    });
    await expect(registerUpload(b.ctx, uploadForm(pdfFile(pdf)))).resolves.toBeTruthy();
  });

  it("requires a file", async () => {
    const a = await makeTenant("org-a");
    await expect(registerUpload(a.ctx, new FormData())).rejects.toMatchObject({ status: 400, code: "file_required" });
  });
});

describe("readMultipartWithLimit", () => {
  const body = (size: number) => {
    const form = new FormData();
    form.set("file", new File([new Uint8Array(size)], "x.pdf"));
    return new Request("http://localhost/api/knowledge-bases", { method: "POST", body: form });
  };

  it("stops reading once the stream exceeds the cap, even without Content-Length", async () => {
    // A chunked stream that never ends, like a hostile client; we must cut it off.
    let pulled = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulled += 1;
        controller.enqueue(new Uint8Array(1024 * 1024));
      },
    });
    const req = new Request("http://localhost/api/knowledge-bases", {
      method: "POST",
      body: stream,
      headers: { "content-type": "multipart/form-data; boundary=x" },
      duplex: "half",
    } as RequestInit);
    await expect(readMultipartWithLimit(req, MAX_UPLOAD_REQUEST_BYTES, MAX_PDF_BYTES)).rejects.toMatchObject({
      status: 413,
    });
    expect(pulled).toBeLessThan(15);
  });

  it("rejects early on an oversized Content-Length", async () => {
    const req = new Request("http://localhost/x", {
      method: "POST",
      body: "x",
      headers: { "content-type": "multipart/form-data; boundary=x", "content-length": String(MAX_UPLOAD_REQUEST_BYTES + 1) },
    });
    await expect(readMultipartWithLimit(req, MAX_UPLOAD_REQUEST_BYTES, MAX_PDF_BYTES)).rejects.toMatchObject({
      status: 413,
    });
  });

  it("parses a body within the cap", async () => {
    const form = await readMultipartWithLimit(body(1000), MAX_UPLOAD_REQUEST_BYTES, MAX_PDF_BYTES);
    expect((form.get("file") as File).size).toBe(1000);
  });

  it("rejects non-multipart bodies", async () => {
    const req = new Request("http://localhost/x", { method: "POST", body: "{}", headers: { "content-type": "application/json" } });
    await expect(readMultipartWithLimit(req, 100, 100)).rejects.toMatchObject({ status: 415 });
  });
});

describe("ingestion", () => {
  it("stores chunks tagged with organization, document id, document name and page", async () => {
    const a = await makeTenant("org-a");
    const b = await makeTenant("org-b");
    const fetch = mockEmbeddingsApi(DIMS);

    const pdf = await makePdf([longText("Alpha"), "Short second page about benefits."]);
    const upload = await registerUpload(a.ctx, uploadForm(pdfFile(pdf, "Employee Handbook.pdf")));
    expect(upload.knowledgeBase.status).toBe("processing");

    await ingestChunks(a.ctx, upload);

    const kb = await a.r.knowledgeBases.findById(upload.knowledgeBase._id);
    expect(kb).toMatchObject({ status: "ready", pageCount: 2, title: "Employee Handbook" });
    expect(kb!.chunkCount).toBeGreaterThan(2);
    expect(fetch).toHaveBeenCalled();

    const chunks = await KnowledgeChunk.find({ organizationId: a.org._id }).select("+embedding").lean();
    expect(chunks).toHaveLength(kb!.chunkCount);
    for (const c of chunks) {
      expect(c.organizationId.toString()).toBe(a.org._id.toString());
      expect(c.knowledgeBaseId.toString()).toBe(kb!._id.toString());
      expect(c.documentName).toBe("Employee Handbook.pdf");
      expect([1, 2]).toContain(c.pageNumber);
      expect(c.embedding).toHaveLength(DIMS);
    }
    expect(chunks.filter((c) => c.pageNumber === 2).map((c) => c.text)).toEqual(["Short second page about benefits."]);

    // Nothing leaked into the other tenant.
    expect(await b.r.knowledgeChunks.count()).toBe(0);
    expect(await b.r.knowledgeBases.findById(kb!._id)).toBeNull();
  });

  it("marks the document failed with a readable error and leaves no chunks when embedding fails", async () => {
    const a = await makeTenant("org-a");
    mockEmbeddingsApi(DIMS, 401);
    const upload = await registerUpload(a.ctx, uploadForm(pdfFile(await makePdf([longText("Beta")]))));
    await ingestChunks(a.ctx, upload);

    const kb = await a.r.knowledgeBases.findById(upload.knowledgeBase._id);
    expect(kb).toMatchObject({ status: "failed", error: "The embedding provider rejected the API key" });
    expect(await a.r.knowledgeChunks.count()).toBe(0);
  });

  it("cleans up chunks if the document is deleted while processing", async () => {
    const a = await makeTenant("org-a");
    mockEmbeddingsApi(DIMS);
    const upload = await registerUpload(a.ctx, uploadForm(pdfFile(await makePdf([longText("Gamma")]))));
    await deleteKnowledgeBase(a.ctx, upload.knowledgeBase._id.toString());
    await ingestChunks(a.ctx, upload);
    expect(await a.r.knowledgeChunks.count()).toBe(0);
    expect(await a.r.knowledgeBases.count()).toBe(0);
  });

  it("deletes a document and its chunks, but not another tenant's", async () => {
    const a = await makeTenant("org-a");
    const b = await makeTenant("org-b");
    mockEmbeddingsApi(DIMS);
    const pdf = await makePdf([longText("Delta")]);
    const ua = await registerUpload(a.ctx, uploadForm(pdfFile(pdf)));
    const ub = await registerUpload(b.ctx, uploadForm(pdfFile(pdf)));
    await ingestChunks(a.ctx, ua);
    await ingestChunks(b.ctx, ub);

    await expect(deleteKnowledgeBase(a.ctx, ub.knowledgeBase._id.toString())).rejects.toMatchObject({ status: 404 });
    const res = await deleteKnowledgeBase(a.ctx, ua.knowledgeBase._id.toString());
    expect(res.chunksDeleted).toBeGreaterThan(0);
    expect(await a.r.knowledgeChunks.count()).toBe(0);
    expect(await b.r.knowledgeChunks.count()).toBeGreaterThan(0);
  });

  it("lists only the caller's documents and fails stale processing", async () => {
    const a = await makeTenant("org-a");
    const b = await makeTenant("org-b");
    const stale = await a.r.knowledgeBases.create({ ...kbInput(a.ctx, "stale"), status: "processing" });
    await b.r.knowledgeBases.create(kbInput(b.ctx, "b"));
    // Backdate past the stale threshold via the raw driver, so Mongoose timestamps don't reset it.
    await KnowledgeBase.collection.updateOne(
      { _id: stale._id },
      { $set: { updatedAt: new Date(Date.now() - 60 * 60 * 1000) } },
    );

    const list = await listKnowledgeBases(a.ctx);
    expect(list.items).toHaveLength(1);
    expect(list.items[0]).toMatchObject({ status: "failed" });
    expect(list.limits).toEqual({ maxDocuments: 10, maxPages: 20, maxBytes: MAX_PDF_BYTES });
  });
});

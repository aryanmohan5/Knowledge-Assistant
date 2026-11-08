import { Types } from "mongoose";
import { z } from "zod";
import { getEmbeddingConfig } from "@/lib/env";
import { conflict, notFound } from "@/lib/http/errors";
import { repos } from "@/lib/tenant/repos";
import type { TenantContext, UserPrincipal } from "@/lib/tenant/types";
import { MAX_PDF_BYTES, Organization } from "@/models";

export const createKnowledgeBaseInput = z.object({
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().max(2000).optional(),
  fileName: z
    .string()
    .trim()
    .min(1)
    .max(255)
    .refine((n) => n.toLowerCase().endsWith(".pdf"), "fileName must end in .pdf"),
  mimeType: z.literal("application/pdf"),
  sizeBytes: z.number().int().min(1).max(MAX_PDF_BYTES),
  checksumSha256: z.string().regex(/^[a-f0-9]{64}$/i).transform((s) => s.toLowerCase()),
  tags: z.array(z.string().trim().min(1).max(50)).max(20).default([]),
  metadata: z.record(z.string().max(100), z.string().max(1000)).default({}),
});

/**
 * Registers a PDF's metadata. The storage key is derived server-side and
 * namespaced by tenant, so object storage mirrors the database isolation.
 */
export async function createKnowledgeBase(ctx: TenantContext<UserPrincipal>, input: unknown) {
  const data = createKnowledgeBaseInput.parse(input);
  const r = repos(ctx);

  const org = await Organization.findById(ctx.organizationId, { settings: 1 }).lean().exec();
  if (!org) throw notFound("Organization not found");
  if (data.sizeBytes > (org.settings?.maxUploadBytes ?? MAX_PDF_BYTES)) {
    throw conflict("File exceeds the organization's upload limit");
  }
  if ((await r.knowledgeBases.count()) >= (org.settings?.maxDocuments ?? 100)) {
    throw conflict("Organization document limit reached");
  }

  const { model, dimensions } = getEmbeddingConfig();
  const _id = new Types.ObjectId();
  return r.knowledgeBases.create({
    _id,
    ...data,
    metadata: new Map(Object.entries(data.metadata)),
    storageKey: `orgs/${ctx.organizationId.toString()}/knowledge-bases/${_id.toString()}.pdf`,
    status: "pending",
    embeddingModel: model,
    embeddingDimensions: dimensions,
    uploadedBy: ctx.principal.userId,
  });
}

/** Deletes the document and its chunks; both deletes are tenant-scoped. */
export async function deleteKnowledgeBase(ctx: TenantContext, id: string) {
  const r = repos(ctx);
  const kb = await r.knowledgeBases.findById(id, { _id: 1 });
  if (!kb) throw notFound();
  const chunksDeleted = await r.knowledgeChunks.deleteMany({ knowledgeBaseId: kb._id });
  await r.knowledgeBases.deleteById(kb._id);
  return { id: kb._id.toString(), chunksDeleted };
}

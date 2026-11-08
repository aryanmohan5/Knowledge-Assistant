import { Schema, model, models, type InferSchemaType, type Model } from "mongoose";
import { tenantOwned, tenantScope } from "@/lib/db/plugins/tenantScope";

export const KNOWLEDGE_BASE_STATUSES = ["pending", "processing", "ready", "failed"] as const;
export const MAX_PDF_BYTES = 50 * 1024 * 1024;

/** One uploaded PDF and its ingestion metadata. Vectors live in KnowledgeChunk. */
const knowledgeBaseSchema = new Schema(
  {
    ...tenantOwned,
    title: { type: String, required: true, trim: true, maxlength: 200 },
    description: { type: String, trim: true, maxlength: 2000 },
    fileName: { type: String, required: true, trim: true, maxlength: 255 },
    mimeType: { type: String, required: true, enum: ["application/pdf"] },
    sizeBytes: { type: Number, required: true, min: 1, max: MAX_PDF_BYTES },
    checksumSha256: { type: String, required: true, lowercase: true, match: /^[a-f0-9]{64}$/ },
    // Object-storage key; always prefixed with the tenant (see knowledgeBaseService).
    storageKey: { type: String, required: true, immutable: true },
    pageCount: { type: Number, min: 0 },
    status: { type: String, enum: KNOWLEDGE_BASE_STATUSES, default: "pending", required: true },
    error: { type: String, maxlength: 2000 },
    chunkCount: { type: Number, default: 0, min: 0 },
    embeddingModel: { type: String, required: true },
    embeddingDimensions: { type: Number, required: true, min: 1 },
    uploadedBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
    tags: { type: [{ type: String, trim: true, maxlength: 50 }], default: [] },
    metadata: { type: Map, of: String, default: {} },
    processedAt: { type: Date },
  },
  { timestamps: true, strict: "throw", strictQuery: "throw" },
);

knowledgeBaseSchema.index({ organizationId: 1, createdAt: -1 });
knowledgeBaseSchema.index({ organizationId: 1, status: 1 });
// The same file can be uploaded by different tenants but only once per tenant.
knowledgeBaseSchema.index({ organizationId: 1, checksumSha256: 1 }, { unique: true });
knowledgeBaseSchema.plugin(tenantScope);

export type KnowledgeBaseDoc = InferSchemaType<typeof knowledgeBaseSchema>;

export const KnowledgeBase =
  (models.KnowledgeBase as Model<KnowledgeBaseDoc>) || model<KnowledgeBaseDoc>("KnowledgeBase", knowledgeBaseSchema);

import { Schema, model, models, type InferSchemaType, type Model } from "mongoose";
import { tenantOwned, tenantScope } from "@/lib/db/plugins/tenantScope";
import { getEmbeddingConfig } from "@/lib/env";

/**
 * One embedded chunk of a KnowledgeBase PDF. This collection backs the Atlas
 * Vector Search index (see scripts/create-search-indexes.ts), which declares
 * `organizationId` as a filter field so every vector query is pre-filtered
 * to a single tenant.
 */
const knowledgeChunkSchema = new Schema(
  {
    ...tenantOwned,
    knowledgeBaseId: { type: Schema.Types.ObjectId, ref: "KnowledgeBase", required: true, immutable: true },
    chunkIndex: { type: Number, required: true, min: 0 },
    text: { type: String, required: true, maxlength: 20_000 },
    pageNumber: { type: Number, min: 1 },
    tokenCount: { type: Number, min: 0 },
    embedding: {
      type: [Number],
      required: true,
      select: false,
      validate: {
        validator(v: number[]) {
          return v.length === getEmbeddingConfig().dimensions && v.every(Number.isFinite);
        },
        message: () => `embedding must contain exactly ${getEmbeddingConfig().dimensions} finite numbers`,
      },
    },
    embeddingModel: { type: String, required: true },
  },
  { timestamps: true, strict: "throw", strictQuery: "throw" },
);

knowledgeChunkSchema.index({ organizationId: 1, knowledgeBaseId: 1, chunkIndex: 1 }, { unique: true });
knowledgeChunkSchema.plugin(tenantScope);

export type KnowledgeChunkDoc = InferSchemaType<typeof knowledgeChunkSchema>;

export const KnowledgeChunk =
  (models.KnowledgeChunk as Model<KnowledgeChunkDoc>) ||
  model<KnowledgeChunkDoc>("KnowledgeChunk", knowledgeChunkSchema);

import { Types, type PipelineStage } from "mongoose";
import { getEmbeddingConfig } from "@/lib/env";
import { HttpError } from "@/lib/http/errors";
import { repos } from "@/lib/tenant/repos";
import type { TenantContext } from "@/lib/tenant/types";

export type ChunkHit = {
  _id: Types.ObjectId;
  knowledgeBaseId: Types.ObjectId;
  chunkIndex: number;
  pageNumber?: number;
  text: string;
  score: number;
};

/**
 * Restricts the requested knowledge bases to what the principal may see. An
 * assistant token limited to specific knowledge bases can never widen that.
 */
function effectiveKnowledgeBaseIds(ctx: TenantContext, requested?: string[]): Types.ObjectId[] | undefined {
  const req = requested?.map((id) => {
    if (!Types.ObjectId.isValid(id)) throw new HttpError(400, "invalid_request", "Invalid knowledge base id");
    return new Types.ObjectId(id);
  });
  if (ctx.principal.type !== "assistantToken" || ctx.principal.knowledgeBaseIds.length === 0) return req;

  const allowed = ctx.principal.knowledgeBaseIds;
  if (!req) return allowed;
  return req.filter((id) => allowed.some((a) => a.equals(id)));
}

/**
 * Atlas Vector Search over the caller's chunks only. `organizationId` is a
 * pre-filter inside `$vectorSearch` (declared as a filter field on the index),
 * so candidates from other tenants are never scored, then re-asserted with a
 * `$match` right after.
 */
export async function searchChunks(
  ctx: TenantContext,
  queryVector: number[],
  opts: { k?: number; numCandidates?: number; knowledgeBaseIds?: string[] } = {},
): Promise<ChunkHit[]> {
  const { dimensions, indexName } = getEmbeddingConfig();
  if (queryVector.length !== dimensions || !queryVector.every(Number.isFinite)) {
    throw new HttpError(400, "invalid_request", `queryVector must have ${dimensions} finite numbers`);
  }

  const k = Math.min(Math.max(opts.k ?? 8, 1), 50);
  const numCandidates = Math.min(opts.numCandidates ?? k * 20, 10_000);
  const kbIds = effectiveKnowledgeBaseIds(ctx, opts.knowledgeBaseIds);
  if (kbIds && kbIds.length === 0) return [];

  const filter: Record<string, unknown> = { organizationId: { $eq: ctx.organizationId } };
  if (kbIds) filter.knowledgeBaseId = { $in: kbIds };

  const pipeline: PipelineStage[] = [
    {
      $vectorSearch: { index: indexName, path: "embedding", queryVector, numCandidates, limit: k, filter },
    } as PipelineStage,
    {
      $project: {
        knowledgeBaseId: 1,
        chunkIndex: 1,
        pageNumber: 1,
        text: 1,
        score: { $meta: "vectorSearchScore" },
      },
    },
  ];

  return repos(ctx).knowledgeChunks.aggregate<ChunkHit>(pipeline);
}

import { AssistantToken, KnowledgeBase, KnowledgeChunk, User } from "@/models";
import { tenantRepo } from "./repo";
import type { TenantContext } from "./types";

/** The entry point route handlers use for tenant data. */
export function repos(ctx: TenantContext) {
  return {
    users: tenantRepo(User, ctx),
    knowledgeBases: tenantRepo(KnowledgeBase, ctx),
    knowledgeChunks: tenantRepo(KnowledgeChunk, ctx),
    assistantTokens: tenantRepo(AssistantToken, ctx),
  };
}

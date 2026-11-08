import type { Types } from "mongoose";
import type { UserRole } from "@/models/User";

export type UserPrincipal = { type: "user"; userId: Types.ObjectId; role: UserRole };

export type AssistantTokenPrincipal = {
  type: "assistantToken";
  tokenId: Types.ObjectId;
  /** Empty means all knowledge bases in the organization. */
  knowledgeBaseIds: Types.ObjectId[];
  scopes: string[];
};

/** The only thing data access needs: which tenant, and who is acting. */
export type TenantContext<P extends UserPrincipal | AssistantTokenPrincipal = UserPrincipal | AssistantTokenPrincipal> = {
  readonly organizationId: Types.ObjectId;
  readonly principal: P;
};

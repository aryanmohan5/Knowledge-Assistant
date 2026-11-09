import "server-only";
import { Types } from "mongoose";
import { auth } from "@/auth";
import { findOrganizationById } from "@/lib/db/system";
import { forbidden, unauthorized } from "@/lib/http/errors";
import { User, type UserRole } from "@/models";
import type { TenantContext, UserPrincipal } from "./types";

/**
 * Resolves the caller's tenant from the Auth.js session and re-checks on
 * every request that the organization and user are still active, so
 * suspending either takes effect immediately rather than at JWT expiry.
 */
export async function requireTenant(): Promise<TenantContext<UserPrincipal>> {
  const session = await auth();
  const { organizationId, id: userId } = session?.user ?? {};
  if (!organizationId || !userId || !Types.ObjectId.isValid(organizationId) || !Types.ObjectId.isValid(userId)) {
    throw unauthorized();
  }

  const orgId = new Types.ObjectId(organizationId);
  const [org, user] = await Promise.all([
    findOrganizationById(orgId),
    User.findOne({ _id: new Types.ObjectId(userId), organizationId: orgId }, { role: 1, status: 1 }).lean().exec(),
  ]);

  if (!org || !user) throw unauthorized();
  if (org.status !== "active") throw forbidden("Organization is suspended");
  if (user.status !== "active") throw forbidden("User is disabled");

  return Object.freeze({
    organizationId: orgId,
    principal: { type: "user", userId: user._id, role: user.role as UserRole },
  });
}

export function requireRole(ctx: TenantContext<UserPrincipal>, roles: readonly UserRole[]): void {
  if (!roles.includes(ctx.principal.role)) throw forbidden("Insufficient role");
}

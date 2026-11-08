import "server-only";
import { systemBypass } from "@/lib/db/bypass";
import { AssistantToken, Organization } from "@/models";

/**
 * The only place allowed to read across tenants, for lookups that happen
 * *before* a tenant is known. Keep this file tiny and audited.
 */

export function findActiveOrganizationBySlug(slug: string) {
  return Organization.findOne({ slug: slug.toLowerCase(), status: "active" }).lean().exec();
}

export function findOrganizationById(id: unknown) {
  return Organization.findById(id).lean().exec();
}

/** Resolve an embed token by hash. The hash is unique, so at most one tenant matches. */
export function findAssistantTokenByHash(tokenHash: string) {
  return AssistantToken.findOne({ tokenHash }, null, systemBypass("assistant token resolution by hash"))
    .lean()
    .exec();
}

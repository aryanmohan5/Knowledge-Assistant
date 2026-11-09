import "server-only";
import { findAssistantTokenByHash, findOrganizationById } from "@/lib/db/system";
import { hashAssistantToken } from "./assistantToken";

export type EmbedFailure = "malformed" | "not_found" | "revoked" | "expired" | "org_inactive";

export type EmbedTarget =
  | { ok: true; organizationName: string; allowedOrigins: string[] }
  | { ok: false; reason: EmbedFailure };

const TOKEN_REGEX = /^ka_live_[A-Za-z0-9_-]{43}$/;

/**
 * Checks that a token can power the hosted /embed page: it exists, isn't
 * revoked or expired, and its org is active. Origin is *not* checked here;
 * which sites may frame the page is enforced by the browser through the
 * frame-ancestors header built from `allowedOrigins`.
 */
export async function getEmbedTarget(rawToken: string | null | undefined): Promise<EmbedTarget> {
  if (!rawToken || !TOKEN_REGEX.test(rawToken)) return { ok: false, reason: "malformed" };
  const token = await findAssistantTokenByHash(hashAssistantToken(rawToken));
  if (!token) return { ok: false, reason: "not_found" };
  if (token.revokedAt) return { ok: false, reason: "revoked" };
  if (token.expiresAt && token.expiresAt.getTime() <= Date.now()) return { ok: false, reason: "expired" };

  const org = await findOrganizationById(token.organizationId);
  if (!org || org.status !== "active") return { ok: false, reason: "org_inactive" };

  return { ok: true, organizationName: org.name, allowedOrigins: token.allowedOrigins };
}

const SAFE_ORIGIN = /^https?:\/\/[a-z0-9.-]+(?::\d{1,5})?$/i;

/**
 * `frame-ancestors 'self' <origins>`. Origins are normalised at token
 * creation, but anything that isn't a plain scheme://host[:port] is dropped
 * here as well, so a stored value can never inject other CSP directives.
 */
export function frameAncestorsHeader(origins: readonly string[]): string {
  const safe = [...new Set(origins.filter((o) => SAFE_ORIGIN.test(o)))];
  return ["frame-ancestors", "'self'", ...safe].join(" ");
}

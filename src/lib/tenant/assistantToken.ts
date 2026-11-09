import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { Types } from "mongoose";
import { z } from "zod";
import { findAssistantTokenByHash, findOrganizationById } from "@/lib/db/system";
import { HttpError } from "@/lib/http/errors";
import { AssistantToken } from "@/models";
import { repos } from "./repos";
import type { AssistantTokenPrincipal, TenantContext, UserPrincipal } from "./types";

const TOKEN_PREFIX = "ka_live_";
const TOKEN_REGEX = /^ka_live_[A-Za-z0-9_-]{43}$/;

export function hashAssistantToken(raw: string): string {
  return createHash("sha256").update(raw, "utf8").digest("hex");
}

/** Normalizes to `scheme://host[:port]`; rejects anything that isn't http(s). */
export function normalizeOrigin(value: string): string {
  const url = new URL(value);
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error("Origin must be http(s)");
  return url.origin;
}

export const createAssistantTokenInput = z.object({
  name: z.string().trim().min(1).max(100),
  allowedOrigins: z
    .array(z.string().trim().min(1))
    .min(1)
    .max(20)
    .transform((list, ctx) => {
      try {
        return [...new Set(list.map(normalizeOrigin))];
      } catch {
        ctx.addIssue({ code: "custom", message: "allowedOrigins must be valid http(s) origins" });
        return z.NEVER;
      }
    }),
  knowledgeBaseIds: z.array(z.string().regex(/^[a-f0-9]{24}$/i)).max(100).default([]),
  expiresAt: z.coerce.date().refine((d) => d.getTime() > Date.now(), "expiresAt must be in the future").optional(),
});

export type CreateAssistantTokenInput = z.input<typeof createAssistantTokenInput>;

/**
 * Creates an embed token. Returns the raw token exactly once; only its
 * SHA-256 hash is persisted. Restricting knowledge bases is validated against
 * the caller's own tenant so a token can never point at another org's data.
 */
export async function createAssistantToken(ctx: TenantContext<UserPrincipal>, input: CreateAssistantTokenInput | unknown) {
  const data = createAssistantTokenInput.parse(input);
  const r = repos(ctx);

  const kbIds = data.knowledgeBaseIds.map((id) => new Types.ObjectId(id));
  if (kbIds.length > 0) {
    const owned = await r.knowledgeBases.count({ _id: { $in: kbIds } });
    if (owned !== kbIds.length) throw new HttpError(400, "invalid_request", "Unknown knowledge base");
  }

  const rawToken = TOKEN_PREFIX + randomBytes(32).toString("base64url");
  const created = await r.assistantTokens.create({
    name: data.name,
    tokenHash: hashAssistantToken(rawToken),
    tokenPrefix: rawToken.slice(0, TOKEN_PREFIX.length + 6),
    allowedOrigins: data.allowedOrigins,
    knowledgeBaseIds: kbIds,
    expiresAt: data.expiresAt,
    createdBy: ctx.principal.userId,
  });

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { tokenHash, ...token } = created;
  return { token, rawToken };
}

export type ResolveFailure = "malformed" | "not_found" | "revoked" | "expired" | "origin_not_allowed" | "org_inactive";

/**
 * Turns a raw embed token into a TenantContext for the public assistant
 * endpoint. The returned context plugs into the same `repos()` as a logged-in
 * user, so isolation rules are identical.
 */
export async function resolveAssistantToken(
  rawToken: string | null | undefined,
  origin: string | null | undefined,
  opts: {
    /**
     * Origins accepted in addition to the token's allow-list: the app's own
     * origin, i.e. requests from the hosted /embed page (whose framing is
     * restricted by frame-ancestors) and the dashboard tester.
     */
    trustedOrigins?: string[];
  } = {},
): Promise<{ ok: true; ctx: TenantContext<AssistantTokenPrincipal> } | { ok: false; reason: ResolveFailure }> {
  if (!rawToken || !TOKEN_REGEX.test(rawToken)) return { ok: false, reason: "malformed" };

  const token = await findAssistantTokenByHash(hashAssistantToken(rawToken));
  if (!token) return { ok: false, reason: "not_found" };
  if (token.revokedAt) return { ok: false, reason: "revoked" };
  if (token.expiresAt && token.expiresAt.getTime() <= Date.now()) return { ok: false, reason: "expired" };

  let normalized: string | null = null;
  try {
    normalized = origin ? normalizeOrigin(origin) : null;
  } catch {
    normalized = null;
  }
  const trusted = (opts.trustedOrigins ?? []).flatMap((o) => {
    try {
      return [normalizeOrigin(o)];
    } catch {
      return [];
    }
  });
  if (!normalized || !(token.allowedOrigins.includes(normalized) || trusted.includes(normalized))) {
    return { ok: false, reason: "origin_not_allowed" };
  }

  const org = await findOrganizationById(token.organizationId);
  if (!org || org.status !== "active") return { ok: false, reason: "org_inactive" };

  await AssistantToken.updateOne(
    { _id: token._id, organizationId: token.organizationId },
    { $set: { lastUsedAt: new Date() } },
  ).exec();

  return {
    ok: true,
    ctx: Object.freeze({
      organizationId: token.organizationId,
      principal: {
        type: "assistantToken",
        tokenId: token._id,
        knowledgeBaseIds: token.knowledgeBaseIds,
        scopes: token.scopes as string[],
      },
    }),
  };
}

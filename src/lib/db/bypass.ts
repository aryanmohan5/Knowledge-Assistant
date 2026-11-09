import { randomUUID } from "node:crypto";

/**
 * Capability for skipping the tenant guard on a single query. The key is
 * random per process, so a hand-written `{ tenantBypass: ... }` option can
 * never satisfy the guard. Importing this module is restricted by ESLint to
 * `src/lib/db/system.ts` and the tenant plugin itself.
 */
const BYPASS_KEY = randomUUID();

export type TenantBypass = { key: string; reason: string };

export function systemBypass(reason: string): { tenantBypass: TenantBypass } {
  if (!reason.trim()) throw new Error("systemBypass requires a reason");
  return { tenantBypass: { key: BYPASS_KEY, reason } };
}

export function isValidBypass(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const v = value as Partial<TenantBypass>;
  return v.key === BYPASS_KEY && typeof v.reason === "string" && v.reason.trim().length > 0;
}

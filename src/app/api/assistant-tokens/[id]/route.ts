import { NextResponse } from "next/server";
import { notFound } from "@/lib/http/errors";
import { withApi } from "@/lib/http/handler";
import { requireRole, requireTenant } from "@/lib/tenant/context";
import { repos } from "@/lib/tenant/repos";

type Params = { params: Promise<{ id: string }> };

/** Revokes (soft-deletes) a token so its embed URL stops working immediately. */
export const DELETE = withApi<Params>(async (_req, { params }) => {
  const ctx = await requireTenant();
  requireRole(ctx, ["owner", "admin"]);
  const { assistantTokens } = repos(ctx);
  const token = await assistantTokens.findById((await params).id, { _id: 1 });
  if (!token) throw notFound();
  const revoked = await assistantTokens.updateOne(
    { _id: token._id, revokedAt: null },
    { $set: { revokedAt: new Date() } },
  );
  return NextResponse.json({ id: token._id.toString(), revoked: !!revoked });
});

import { NextResponse } from "next/server";
import { readJson, withApi } from "@/lib/http/handler";
import { createAssistantToken } from "@/lib/tenant/assistantToken";
import { requireRole, requireTenant } from "@/lib/tenant/context";
import { repos } from "@/lib/tenant/repos";

export const GET = withApi(async () => {
  const ctx = await requireTenant();
  requireRole(ctx, ["owner", "admin"]);
  const items = await repos(ctx).assistantTokens.find();
  return NextResponse.json({ items });
});

/** The raw token appears only in this response; it cannot be retrieved again. */
export const POST = withApi(async (req) => {
  const ctx = await requireTenant();
  requireRole(ctx, ["owner", "admin"]);
  const { token, rawToken } = await createAssistantToken(ctx, await readJson(req));
  return NextResponse.json({ token, rawToken }, { status: 201, headers: { "Cache-Control": "no-store" } });
});

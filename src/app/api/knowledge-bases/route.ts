import { NextResponse } from "next/server";
import { readJson, withApi } from "@/lib/http/handler";
import { createKnowledgeBase } from "@/lib/services/knowledgeBase";
import { requireTenant } from "@/lib/tenant/context";
import { repos } from "@/lib/tenant/repos";

export const GET = withApi(async (req) => {
  const ctx = await requireTenant();
  const limit = Number(req.nextUrl.searchParams.get("limit") ?? 50);
  const items = await repos(ctx).knowledgeBases.find({}, { limit: Number.isFinite(limit) ? limit : 50 });
  return NextResponse.json({ items });
});

export const POST = withApi(async (req) => {
  const ctx = await requireTenant();
  const created = await createKnowledgeBase(ctx, await readJson(req));
  return NextResponse.json(created, { status: 201 });
});

import { NextResponse } from "next/server";
import { notFound } from "@/lib/http/errors";
import { withApi } from "@/lib/http/handler";
import { deleteKnowledgeBase } from "@/lib/services/knowledgeBase";
import { requireRole, requireTenant } from "@/lib/tenant/context";
import { repos } from "@/lib/tenant/repos";

type Params = { params: Promise<{ id: string }> };

export const GET = withApi<Params>(async (_req, { params }) => {
  const ctx = await requireTenant();
  const kb = await repos(ctx).knowledgeBases.findById((await params).id);
  if (!kb) throw notFound();
  return NextResponse.json(kb);
});

export const DELETE = withApi<Params>(async (_req, { params }) => {
  const ctx = await requireTenant();
  requireRole(ctx, ["owner", "admin"]);
  return NextResponse.json(await deleteKnowledgeBase(ctx, (await params).id));
});

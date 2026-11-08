import { NextResponse } from "next/server";
import { withApi } from "@/lib/http/handler";
import { frameAncestorsHeader, getEmbedTarget } from "@/lib/tenant/embed";

export const runtime = "nodejs";

type Params = { params: Promise<{ token: string }> };

/**
 * Used by middleware to set the per-token frame-ancestors policy on
 * /embed/[token]. Returns only the CSP value; invalid tokens get 'self' only.
 */
export const GET = withApi<Params>(async (_req, { params }) => {
  const target = await getEmbedTarget(decodeURIComponent((await params).token));
  const frameAncestors = frameAncestorsHeader(target.ok ? target.allowedOrigins : []);
  return NextResponse.json({ frameAncestors }, { headers: { "Cache-Control": "no-store" } });
});

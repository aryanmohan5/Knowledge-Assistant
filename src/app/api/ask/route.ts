import { NextResponse, type NextRequest } from "next/server";
import { answerQuestion } from "@/lib/ask/pipeline";
import { parseAskRequest } from "@/lib/ask/request";
import { readJson, withApi } from "@/lib/http/handler";

export const runtime = "nodejs";
export const maxDuration = 60;

const CORS_BASE = {
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type",
  "Access-Control-Max-Age": "600",
  Vary: "Origin",
};

/**
 * Preflight. Any origin may *ask*; the POST only returns a readable
 * response (Access-Control-Allow-Origin) once the token has approved it.
 */
export function OPTIONS(req: NextRequest) {
  const origin = req.headers.get("origin");
  return new Response(null, {
    status: 204,
    headers: origin ? { ...CORS_BASE, "Access-Control-Allow-Origin": origin } : CORS_BASE,
  });
}

/**
 * Public, token-authenticated question answering.
 * Body: { question, knowledgeBaseIds? } with `Authorization: Bearer <assistant token>`.
 * Also accepts `token` in the body.
 */
export async function POST(req: NextRequest) {
  const origin = req.headers.get("origin");
  let originApproved = false;

  const res = await withApi(async (r: NextRequest) => {
    const input = parseAskRequest(r.headers, await readJson(r));
    const result = await answerQuestion(input, undefined, { onAuthorized: () => (originApproved = true) });
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  })(req, undefined);

  res.headers.set("Vary", "Origin");
  if (originApproved && origin) res.headers.set("Access-Control-Allow-Origin", origin);
  return res;
}

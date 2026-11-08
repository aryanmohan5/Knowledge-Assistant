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
 * The origin browsers use for pages served by this app. APP_URL wins when
 * set; otherwise it's derived from the Host (or proxy-forwarded host) header,
 * which is what a same-origin browser request's Origin will match. A
 * cross-site page can't make the two agree.
 */
function appOrigin(req: NextRequest): string {
  if (process.env.APP_URL) return process.env.APP_URL;
  const host = req.headers.get("x-forwarded-host")?.split(",")[0].trim() || req.headers.get("host");
  const proto = req.headers.get("x-forwarded-proto")?.split(",")[0].trim() || req.nextUrl.protocol.replace(":", "");
  return host ? `${proto}://${host}` : req.nextUrl.origin;
}

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
    // Same-origin calls come only from pages we serve: the /embed widget (whose
    // framing is limited by frame-ancestors) and the dashboard tester.
    input.trustedOrigins = [appOrigin(r)];
    const result = await answerQuestion(input, undefined, { onAuthorized: () => (originApproved = true) });
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  })(req, undefined);

  res.headers.set("Vary", "Origin");
  if (originApproved && origin) res.headers.set("Access-Control-Allow-Origin", origin);
  return res;
}

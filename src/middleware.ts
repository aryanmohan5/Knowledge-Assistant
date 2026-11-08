import NextAuth from "next-auth";
import { NextResponse, type NextRequest } from "next/server";
import { authConfig } from "@/auth.config";

const { auth } = NextAuth(authConfig);

// /api/ask authenticates with an assistant token, not a session.
const PUBLIC_API = [/^\/api\/auth(\/|$)/, /^\/api\/public(\/|$)/, /^\/api\/ask$/];

const SELF_ONLY = "frame-ancestors 'self'";

/**
 * /embed/[token] may only be framed by the token's allowed origins. The CSP
 * value comes from a Node route (middleware has no DB access); any failure
 * falls back to 'self' only, i.e. fails closed.
 */
async function embedResponse(req: NextRequest): Promise<NextResponse> {
  const token = req.nextUrl.pathname.split("/")[2] ?? "";
  let frameAncestors = SELF_ONLY;
  try {
    const res = await fetch(new URL(`/api/public/embed/${encodeURIComponent(token)}`, req.nextUrl.origin), {
      signal: AbortSignal.timeout(3000),
      cache: "no-store",
    });
    if (res.ok) {
      const body = (await res.json()) as { frameAncestors?: string };
      if (body.frameAncestors?.startsWith("frame-ancestors 'self'")) frameAncestors = body.frameAncestors;
    }
  } catch {
    // keep SELF_ONLY
  }

  const response = NextResponse.next();
  response.headers.set("Content-Security-Policy", frameAncestors);
  // The token is in the URL: never send it onward as a Referer, never index it.
  response.headers.set("Referrer-Policy", "no-referrer");
  response.headers.set("X-Robots-Tag", "noindex, nofollow");
  return response;
}

/**
 * API: first line of defense only, rejecting unauthenticated calls early.
 * Every handler still calls `requireTenant()` (or validates a token), which is
 * the real boundary.
 */
export default auth(async (req) => {
  const { pathname } = req.nextUrl;
  if (pathname.startsWith("/embed/")) return embedResponse(req);
  if (PUBLIC_API.some((re) => re.test(pathname))) return NextResponse.next();
  if (!req.auth?.user?.organizationId) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  return NextResponse.next();
});

export const config = { matcher: ["/api/:path*", "/embed/:path*"] };

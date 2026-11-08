import NextAuth from "next-auth";
import { NextResponse } from "next/server";
import { authConfig } from "@/auth.config";

const { auth } = NextAuth(authConfig);

const PUBLIC_API = [/^\/api\/auth(\/|$)/, /^\/api\/public(\/|$)/];

/**
 * First line of defense only: rejects unauthenticated API calls early.
 * Every handler still calls `requireTenant()`, which is the real boundary.
 */
export default auth((req) => {
  const { pathname } = req.nextUrl;
  if (PUBLIC_API.some((re) => re.test(pathname))) return NextResponse.next();
  if (!req.auth?.user?.organizationId) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  return NextResponse.next();
});

export const config = { matcher: ["/api/:path*"] };

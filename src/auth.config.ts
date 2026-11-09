import type { NextAuthConfig } from "next-auth";

/**
 * Edge-safe Auth.js config (no database imports) shared by middleware and
 * the full Node config in `auth.ts`.
 */
export const authConfig = {
  session: { strategy: "jwt", maxAge: 12 * 60 * 60 },
  trustHost: true,
  providers: [],
  callbacks: {
    jwt({ token, user }) {
      if (user) {
        token.userId = user.id!;
        token.organizationId = user.organizationId;
        token.organizationName = user.organizationName;
        token.organizationSlug = user.organizationSlug;
        token.role = user.role;
      }
      return token;
    },
    session({ session, token }) {
      session.user.id = token.userId;
      session.user.organizationId = token.organizationId;
      session.user.organizationName = token.organizationName;
      session.user.organizationSlug = token.organizationSlug;
      session.user.role = token.role;
      return session;
    },
  },
} satisfies NextAuthConfig;

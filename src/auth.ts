import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { authConfig } from "@/auth.config";
import { authorizeCredentials } from "@/lib/auth/authorize";
import { connectToDatabase } from "@/lib/db/connect";

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  providers: [
    Credentials({
      credentials: {
        organizationSlug: { label: "Organization" },
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        await connectToDatabase();
        return authorizeCredentials(credentials);
      },
    }),
  ],
});

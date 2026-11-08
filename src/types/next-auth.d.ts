import type { DefaultSession } from "next-auth";
import type { UserRole } from "@/models/User";

declare module "next-auth" {
  interface User {
    organizationId: string;
    role: UserRole;
  }

  interface Session {
    user: {
      id: string;
      organizationId: string;
      role: UserRole;
    } & DefaultSession["user"];
  }
}

declare module "@auth/core/jwt" {
  interface JWT {
    userId: string;
    organizationId: string;
    role: UserRole;
  }
}

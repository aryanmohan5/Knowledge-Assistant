import { z } from "zod";
import { findActiveOrganizationBySlug } from "@/lib/db/system";
import { User, type UserRole } from "@/models";
import { verifyPassword } from "./password";

export const credentialsSchema = z.object({
  organizationSlug: z.string().trim().toLowerCase().min(3).max(48),
  email: z.email().trim().toLowerCase().max(254),
  password: z.string().min(1).max(200),
});

export type AuthorizedUser = {
  id: string;
  email: string;
  name?: string | null;
  organizationId: string;
  role: UserRole;
};

/**
 * Verifies organization + email + password. Users are looked up *inside* the
 * organization named at login, so an account in org A can never sign in to
 * org B even with the same email. Every failure returns `null` (no hint about
 * which part was wrong), and a dummy bcrypt compare runs when the org or user
 * is missing to keep timing uniform.
 */
export async function authorizeCredentials(input: unknown): Promise<AuthorizedUser | null> {
  const parsed = credentialsSchema.safeParse(input);
  if (!parsed.success) return null;
  const { organizationSlug, email, password } = parsed.data;

  const org = await findActiveOrganizationBySlug(organizationSlug);
  const user = org
    ? await User.findOne({ organizationId: org._id, email, status: "active" })
        .select("+passwordHash")
        .lean()
        .exec()
    : null;

  const valid = await verifyPassword(password, user?.passwordHash);
  if (!org || !user || !valid) return null;

  await User.updateOne({ _id: user._id, organizationId: org._id }, { $set: { lastLoginAt: new Date() } }).exec();

  return {
    id: user._id.toString(),
    email: user.email,
    name: user.name,
    organizationId: org._id.toString(),
    role: user.role as UserRole,
  };
}

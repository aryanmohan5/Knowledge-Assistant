import mongoose from "mongoose";
import { z } from "zod";
import { hashPassword, passwordSchema } from "@/lib/auth/password";
import { Organization, ORG_SLUG_REGEX, User } from "@/models";

export const registerOrganizationInput = z.object({
  organizationName: z.string().trim().min(2).max(120),
  organizationSlug: z.string().trim().toLowerCase().regex(ORG_SLUG_REGEX, "3-48 chars: a-z, 0-9, hyphens"),
  ownerEmail: z.email().trim().toLowerCase().max(254),
  ownerName: z.string().trim().min(1).max(120).optional(),
  password: passwordSchema,
});

/**
 * Creates an organization and its owner atomically. Requires a replica set
 * (Atlas always is), so a failure never leaves an org without an owner.
 */
export async function registerOrganization(input: unknown) {
  const data = registerOrganizationInput.parse(input);
  const passwordHash = await hashPassword(data.password);

  return mongoose.connection.transaction(async (session) => {
    const [org] = await Organization.create([{ name: data.organizationName, slug: data.organizationSlug }], { session });
    const [owner] = await User.create(
      [{ organizationId: org._id, email: data.ownerEmail, name: data.ownerName, passwordHash, role: "owner" }],
      { session },
    );
    return {
      organization: { id: org._id.toString(), name: org.name, slug: org.slug },
      owner: { id: owner._id.toString(), email: owner.email, role: owner.role },
    };
  });
}

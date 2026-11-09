import { createHash } from "node:crypto";
import { Types } from "mongoose";
import { hashPassword } from "@/lib/auth/password";
import { repos } from "@/lib/tenant/repos";
import type { TenantContext, UserPrincipal } from "@/lib/tenant/types";
import { Organization, User } from "@/models";

export const PASSWORD = "correct-horse-battery";

export async function makeTenant(slug: string, role: "owner" | "admin" | "member" = "owner") {
  const org = await Organization.create({ name: slug, slug });
  const user = await User.create({
    organizationId: org._id,
    email: `owner@${slug}.test`,
    passwordHash: await hashPassword(PASSWORD),
    role,
  });
  const ctx: TenantContext<UserPrincipal> = {
    organizationId: org._id,
    principal: { type: "user", userId: user._id, role },
  };
  return { org, user, ctx, r: repos(ctx) };
}

export function kbInput(ctx: TenantContext<UserPrincipal>, seed: string) {
  const _id = new Types.ObjectId();
  return {
    _id,
    title: `Doc ${seed}`,
    fileName: `${seed}.pdf`,
    mimeType: "application/pdf" as const,
    sizeBytes: 1024,
    checksumSha256: createHash("sha256").update(seed).digest("hex"),
    pageCount: 1,
    embeddingModel: "test",
    embeddingDimensions: 4,
    uploadedBy: ctx.principal.userId,
  };
}

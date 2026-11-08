import { describe, expect, it } from "vitest";
import { authorizeCredentials } from "@/lib/auth/authorize";
import { registerOrganization } from "@/lib/services/registration";
import { Organization, User } from "@/models";
import { makeTenant, PASSWORD } from "./helpers";

describe("authorizeCredentials", () => {
  it("signs in with org slug + email + password and returns the tenant", async () => {
    const a = await makeTenant("org-a");
    const user = await authorizeCredentials({ organizationSlug: "ORG-A", email: "Owner@Org-A.test", password: PASSWORD });
    expect(user).toMatchObject({ organizationId: a.org._id.toString(), role: "owner" });
  });

  it("rejects wrong password, unknown org and unknown user", async () => {
    await makeTenant("org-a");
    expect(await authorizeCredentials({ organizationSlug: "org-a", email: "owner@org-a.test", password: "wrong-password" })).toBeNull();
    expect(await authorizeCredentials({ organizationSlug: "nope", email: "owner@org-a.test", password: PASSWORD })).toBeNull();
    expect(await authorizeCredentials({ organizationSlug: "org-a", email: "ghost@org-a.test", password: PASSWORD })).toBeNull();
    expect(await authorizeCredentials({ organizationSlug: "org-a" })).toBeNull();
  });

  it("does not let a user of org A sign in through org B", async () => {
    await makeTenant("org-a");
    await makeTenant("org-b");
    expect(await authorizeCredentials({ organizationSlug: "org-b", email: "owner@org-a.test", password: PASSWORD })).toBeNull();
  });

  it("rejects suspended organizations and disabled users", async () => {
    const a = await makeTenant("org-a");
    await User.updateOne({ _id: a.user._id, organizationId: a.org._id }, { $set: { status: "disabled" } });
    expect(await authorizeCredentials({ organizationSlug: "org-a", email: "owner@org-a.test", password: PASSWORD })).toBeNull();

    const b = await makeTenant("org-b");
    await Organization.updateOne({ _id: b.org._id }, { $set: { status: "suspended" } });
    expect(await authorizeCredentials({ organizationSlug: "org-b", email: "owner@org-b.test", password: PASSWORD })).toBeNull();
  });
});

describe("registerOrganization", () => {
  const input = {
    organizationName: "Acme",
    organizationSlug: "acme",
    ownerEmail: "founder@acme.test",
    password: "a-long-enough-password",
  };

  it("creates org + owner atomically and allows login", async () => {
    const res = await registerOrganization(input);
    expect(res.owner.role).toBe("owner");
    const user = await authorizeCredentials({ organizationSlug: "acme", email: input.ownerEmail, password: input.password });
    expect(user?.organizationId).toBe(res.organization.id);
  });

  it("rejects duplicate slugs without leaving an orphan user", async () => {
    await registerOrganization(input);
    await expect(registerOrganization({ ...input, ownerEmail: "other@acme.test" })).rejects.toMatchObject({ code: 11000 });
    expect(await Organization.countDocuments()).toBe(1);
    const org = await Organization.findOne({ slug: "acme" });
    expect(await User.countDocuments({ organizationId: org!._id })).toBe(1);
  });

  it("rejects weak passwords and invalid slugs", async () => {
    await expect(registerOrganization({ ...input, password: "short" })).rejects.toThrow();
    await expect(registerOrganization({ ...input, organizationSlug: "Bad Slug!" })).rejects.toThrow();
  });
});

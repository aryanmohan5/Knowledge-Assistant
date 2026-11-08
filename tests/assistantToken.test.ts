import { describe, expect, it } from "vitest";
import { createAssistantToken, hashAssistantToken, resolveAssistantToken } from "@/lib/tenant/assistantToken";
import { AssistantToken, Organization } from "@/models";
import { kbInput, makeTenant } from "./helpers";

const ORIGIN = "https://customer.example.com";

describe("assistant tokens", () => {
  it("stores only the hash and returns the raw token once", async () => {
    const a = await makeTenant("org-a");
    const { token, rawToken } = await createAssistantToken(a.ctx, { name: "Website", allowedOrigins: [ORIGIN + "/path"] });

    expect(rawToken).toMatch(/^ka_live_[A-Za-z0-9_-]{43}$/);
    expect(token).not.toHaveProperty("tokenHash");
    expect(token.allowedOrigins).toEqual([ORIGIN]);

    const stored = await AssistantToken.findOne({ organizationId: a.org._id }).select("+tokenHash").lean();
    expect(stored?.tokenHash).toBe(hashAssistantToken(rawToken));
    expect(JSON.stringify(stored)).not.toContain(rawToken);

    const listed = await a.r.assistantTokens.find();
    expect(listed[0]).not.toHaveProperty("tokenHash");
  });

  it("resolves to the issuing tenant's context", async () => {
    const a = await makeTenant("org-a");
    await makeTenant("org-b");
    const { rawToken } = await createAssistantToken(a.ctx, { name: "Website", allowedOrigins: [ORIGIN] });

    const res = await resolveAssistantToken(rawToken, ORIGIN);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.ctx.organizationId.toString()).toBe(a.org._id.toString());
      expect(res.ctx.principal.type).toBe("assistantToken");
    }
  });

  it("rejects malformed, unknown, revoked, expired and wrong-origin tokens", async () => {
    const a = await makeTenant("org-a");
    const { token, rawToken } = await createAssistantToken(a.ctx, { name: "Website", allowedOrigins: [ORIGIN] });

    expect(await resolveAssistantToken("nope", ORIGIN)).toEqual({ ok: false, reason: "malformed" });
    expect(await resolveAssistantToken("ka_live_" + "A".repeat(43), ORIGIN)).toEqual({ ok: false, reason: "not_found" });
    expect(await resolveAssistantToken(rawToken, "https://evil.example.com")).toEqual({ ok: false, reason: "origin_not_allowed" });
    expect(await resolveAssistantToken(rawToken, null)).toEqual({ ok: false, reason: "origin_not_allowed" });

    await a.r.assistantTokens.updateById(token._id, { $set: { expiresAt: new Date(Date.now() - 1000) } });
    expect(await resolveAssistantToken(rawToken, ORIGIN)).toEqual({ ok: false, reason: "expired" });

    await a.r.assistantTokens.updateById(token._id, { $set: { revokedAt: new Date() } });
    expect(await resolveAssistantToken(rawToken, ORIGIN)).toEqual({ ok: false, reason: "revoked" });
  });

  it("stops working when the organization is suspended", async () => {
    const a = await makeTenant("org-a");
    const { rawToken } = await createAssistantToken(a.ctx, { name: "Website", allowedOrigins: [ORIGIN] });
    await Organization.updateOne({ _id: a.org._id }, { $set: { status: "suspended" } });
    expect(await resolveAssistantToken(rawToken, ORIGIN)).toEqual({ ok: false, reason: "org_inactive" });
  });

  it("cannot be scoped to another tenant's knowledge base", async () => {
    const a = await makeTenant("org-a");
    const b = await makeTenant("org-b");
    const bKb = await b.r.knowledgeBases.create(kbInput(b.ctx, "b"));
    await expect(
      createAssistantToken(a.ctx, { name: "x", allowedOrigins: [ORIGIN], knowledgeBaseIds: [bKb._id.toString()] }),
    ).rejects.toMatchObject({ status: 400 });
  });

  it("requires at least one valid http(s) origin", async () => {
    const a = await makeTenant("org-a");
    await expect(createAssistantToken(a.ctx, { name: "x", allowedOrigins: [] })).rejects.toThrow();
    await expect(createAssistantToken(a.ctx, { name: "x", allowedOrigins: ["javascript:alert(1)"] })).rejects.toThrow();
  });
});

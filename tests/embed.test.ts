import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { splitAnswer } from "@/lib/ask/renderCitations";
import { POLICY_TRACKS, MIN_GPA } from "@/lib/ask/system1/rules";
import { MAX_PAGES_PER_PDF, MAX_PDF_BYTES } from "@/lib/limits";
import { extractPages, openPdf } from "@/lib/pdf/extract";
import { createAssistantToken, resolveAssistantToken } from "@/lib/tenant/assistantToken";
import { frameAncestorsHeader, getEmbedTarget } from "@/lib/tenant/embed";
import { Organization } from "@/models";
import { buildPdf } from "../scripts/seed-pdf";
import { SEED_ORGANIZATIONS } from "../scripts/seed-data";
import { makeTenant } from "./helpers";

const SITE = "https://portal.example.edu";
const APP = "http://localhost:3000";

describe("getEmbedTarget", () => {
  it("accepts a live token regardless of origin and returns the frame policy inputs", async () => {
    const a = await makeTenant("org-a");
    const { rawToken } = await createAssistantToken(a.ctx, { name: "w", allowedOrigins: [SITE] });
    expect(await getEmbedTarget(rawToken)).toEqual({ ok: true, organizationName: "org-a", allowedOrigins: [SITE] });
  });

  it("rejects malformed, unknown, revoked, expired tokens and inactive orgs", async () => {
    const a = await makeTenant("org-a");
    const { rawToken, token } = await createAssistantToken(a.ctx, { name: "w", allowedOrigins: [SITE] });
    expect(await getEmbedTarget("../../etc/passwd")).toEqual({ ok: false, reason: "malformed" });
    expect(await getEmbedTarget(`ka_live_${"Z".repeat(43)}`)).toEqual({ ok: false, reason: "not_found" });

    await Organization.updateOne({ _id: a.org._id }, { $set: { status: "suspended" } });
    expect(await getEmbedTarget(rawToken)).toEqual({ ok: false, reason: "org_inactive" });
    await Organization.updateOne({ _id: a.org._id }, { $set: { status: "active" } });

    await a.r.assistantTokens.updateById(token._id, { $set: { expiresAt: new Date(Date.now() - 1000) } });
    expect(await getEmbedTarget(rawToken)).toEqual({ ok: false, reason: "expired" });
    await a.r.assistantTokens.updateById(token._id, { $set: { revokedAt: new Date() } });
    expect(await getEmbedTarget(rawToken)).toEqual({ ok: false, reason: "revoked" });
  });
});

describe("frameAncestorsHeader", () => {
  it("lists self plus the token's origins", () => {
    expect(frameAncestorsHeader([SITE, "http://localhost:5500"])).toBe(`frame-ancestors 'self' ${SITE} http://localhost:5500`);
  });

  it("defaults to self only", () => {
    expect(frameAncestorsHeader([])).toBe("frame-ancestors 'self'");
  });

  it("drops values that could inject CSP directives", () => {
    expect(
      frameAncestorsHeader(["https://ok.example", "https://x.example; script-src *", "*", "javascript:alert(1)", "https://a b"]),
    ).toBe("frame-ancestors 'self' https://ok.example");
  });
});

describe("resolveAssistantToken trusted origins", () => {
  it("lets the app's own origin (embed page) through, but nothing else new", async () => {
    const a = await makeTenant("org-a");
    const { rawToken } = await createAssistantToken(a.ctx, { name: "w", allowedOrigins: [SITE] });
    expect((await resolveAssistantToken(rawToken, APP, { trustedOrigins: [APP] })).ok).toBe(true);
    expect((await resolveAssistantToken(rawToken, SITE, { trustedOrigins: [APP] })).ok).toBe(true);
    expect(await resolveAssistantToken(rawToken, "https://evil.example", { trustedOrigins: [APP] })).toEqual({
      ok: false,
      reason: "origin_not_allowed",
    });
    expect(await resolveAssistantToken(rawToken, APP)).toEqual({ ok: false, reason: "origin_not_allowed" });
  });
});

describe("splitAnswer", () => {
  it("splits document and System 1 tags out of the text", () => {
    expect(
      splitAnswer("You qualify [System 1: checkEligibility]. It pays $2,500 [Merit Guide.pdf - Page 1].").map((s) => s.type),
    ).toEqual(["text", "decision", "text", "source", "text"]);
    expect(splitAnswer("Fact [A - B.pdf - Page 12]")[1]).toEqual({ type: "source", documentName: "A - B.pdf", pageNumber: 12 });
  });

  it("leaves untagged text alone", () => {
    expect(splitAnswer("No tags here [not a tag]")).toEqual([{ type: "text", text: "No tags here [not a tag]" }]);
  });
});

describe("seed data", () => {
  const docs = SEED_ORGANIZATIONS.flatMap((o) => o.documents.map((d) => ({ org: o, doc: d })));

  it("has 2 organizations with 2-3 documents each", () => {
    expect(SEED_ORGANIZATIONS).toHaveLength(2);
    for (const o of SEED_ORGANIZATIONS) expect(o.documents.length).toBeGreaterThanOrEqual(2);
    for (const o of SEED_ORGANIZATIONS) expect(o.documents.length).toBeLessThanOrEqual(3);
  });

  it.each(docs.map(({ doc }) => [doc.fileName, doc]))("%s builds within the upload limits and extracts per page", async (_n, doc) => {
    const bytes = await buildPdf(doc);
    expect(bytes.byteLength).toBeLessThan(MAX_PDF_BYTES);
    const pdf = await openPdf(bytes);
    expect(pdf.numPages).toBe(doc.pages.length);
    expect(pdf.numPages).toBeLessThanOrEqual(MAX_PAGES_PER_PDF);
    const pages = await extractPages(pdf);
    // The first sentence of every page survives extraction.
    pages.forEach((p, i) => expect(p.text).toContain(doc.pages[i].split("\n")[0].slice(0, 30)));
  });

  it("builds byte-identical PDFs, so re-seeding is detected as a duplicate", async () => {
    const doc = SEED_ORGANIZATIONS[0].documents[0];
    const hash = async () => createHash("sha256").update(await buildPdf(doc)).digest("hex");
    expect(await hash()).toBe(await hash());
  });

  it("aligns with the System 1 rules", () => {
    const text = docs.map(({ doc }) => doc.pages.join("\n")).join("\n");
    expect(text).toContain(`GPA of ${MIN_GPA.toFixed(1)}`);
    // Every office routePolicy can return is named in the Northbridge handbook.
    const handbook = SEED_ORGANIZATIONS[0].documents[1].pages.join("\n");
    for (const t of POLICY_TRACKS) expect(handbook).toContain(t.office);
  });
});

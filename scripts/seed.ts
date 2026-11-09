/**
 * Seeds two demo organizations with PDFs, pushed through the real HTTP API:
 * register -> sign in -> POST /api/knowledge-bases (upload + ingestion) ->
 * wait for "ready" -> create an assistant token.
 *
 *   npm run dev            # in one terminal (needs MONGODB_URI + AI provider key)
 *   npm run seed           # in another
 *
 * Env: SEED_APP_URL (default http://localhost:3000), SEED_PASSWORD (optional;
 * random per run if unset). Credentials and tokens are printed and written to
 * .seed-output.json, which is gitignored. Nothing secret is stored in the repo.
 */
import { randomBytes } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { config } from "dotenv";
import { DEMO_ORIGIN, SEED_ORGANIZATIONS, type SeedOrganization } from "./seed-data";
import { buildPdf } from "./seed-pdf";

config({ path: [".env.local", ".env"], quiet: true });

const APP_URL = (process.env.SEED_APP_URL || "http://localhost:3000").replace(/\/+$/, "");
const PASSWORD_FROM_ENV = process.env.SEED_PASSWORD;
const READY_TIMEOUT_MS = 5 * 60 * 1000;

class SeedError extends Error {}

// ---------------------------------------------------------------------------
// Minimal HTTP client with a cookie jar (Auth.js session)
// ---------------------------------------------------------------------------

class Client {
  private cookies = new Map<string, string>();

  async req(path: string, init: RequestInit = {}): Promise<Response> {
    let res: Response;
    try {
      res = await fetch(APP_URL + path, {
        ...init,
        redirect: "manual",
        headers: { ...(init.headers as Record<string, string>), cookie: [...this.cookies].map(([k, v]) => `${k}=${v}`).join("; ") },
      });
    } catch {
      throw new SeedError(`Could not reach the app at ${APP_URL}. Start it first with \`npm run dev\` (or set SEED_APP_URL).`);
    }
    for (const c of res.headers.getSetCookie()) {
      const [pair] = c.split(";");
      const i = pair.indexOf("=");
      this.cookies.set(pair.slice(0, i), pair.slice(i + 1));
    }
    return res;
  }

  async json<T>(path: string, init: RequestInit = {}): Promise<{ status: number; body: T }> {
    const res = await this.req(path, init);
    return { status: res.status, body: (await res.json().catch(() => ({}))) as T };
  }

  async login(slug: string, email: string, password: string): Promise<boolean> {
    const { body } = await this.json<{ csrfToken: string }>("/api/auth/csrf");
    await this.req("/api/auth/callback/credentials", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ csrfToken: body.csrfToken, organizationSlug: slug, email, password, callbackUrl: "/dashboard" }),
    });
    return (await this.req("/api/knowledge-bases")).status === 200;
  }
}

type ApiError = { error?: string; message?: string };
type KbItem = { _id: string; fileName: string; status: string; chunkCount: number; pageCount: number; error?: string };

// ---------------------------------------------------------------------------
// Seeding
// ---------------------------------------------------------------------------

async function seedOrganization(org: SeedOrganization) {
  const client = new Client();
  const password = PASSWORD_FROM_ENV || randomBytes(12).toString("base64url");
  console.log(`\n== ${org.name} (${org.slug})`);

  // 1. Register (or reuse an existing org).
  const reg = await client.json<ApiError>("/api/auth/register", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ organizationName: org.name, organizationSlug: org.slug, ownerEmail: org.ownerEmail, ownerName: org.ownerName, password }),
  });
  if (reg.status === 201) console.log("   registered organization");
  else if (reg.status === 409) console.log("   organization already exists, signing in");
  else throw new SeedError(`Registration failed (${reg.status}): ${reg.body.message ?? reg.body.error}`);

  // 2. Sign in.
  if (!(await client.login(org.slug, org.ownerEmail, password))) {
    throw new SeedError(
      reg.status === 409
        ? `"${org.slug}" already exists and the password didn't match. Re-run with the SEED_PASSWORD used originally (see .seed-output.json), or reset the database.`
        : "Signed up but could not sign in. Check AUTH_SECRET in .env.local.",
    );
  }

  // 3. Upload each PDF through the ingestion endpoint.
  for (const doc of org.documents) {
    const form = new FormData();
    form.set("file", new File([(await buildPdf(doc)) as BlobPart], doc.fileName, { type: "application/pdf" }));
    form.set("title", doc.title);
    const up = await client.json<ApiError>("/api/knowledge-bases", { method: "POST", body: form });
    if (up.status === 202) console.log(`   uploaded   ${doc.fileName}`);
    else if (up.body.error === "duplicate_document") console.log(`   exists     ${doc.fileName}`);
    else throw new SeedError(`Upload of "${doc.fileName}" failed (${up.status}): ${up.body.message ?? up.body.error}`);
  }

  // 4. Wait for embedding to finish.
  const deadline = Date.now() + READY_TIMEOUT_MS;
  let items: KbItem[] = [];
  for (;;) {
    items = (await client.json<{ items: KbItem[] }>("/api/knowledge-bases")).body.items ?? [];
    const mine = items.filter((i) => org.documents.some((d) => d.fileName === i.fileName));
    if (mine.length && mine.every((i) => i.status !== "processing" && i.status !== "pending")) break;
    if (Date.now() > deadline) throw new SeedError("Timed out waiting for documents to finish processing.");
    await new Promise((r) => setTimeout(r, 1500));
  }
  for (const i of items) {
    console.log(`   ${i.status.padEnd(10)} ${i.fileName} (${i.pageCount} pages, ${i.chunkCount} chunks)${i.error ? ` - ${i.error}` : ""}`);
  }
  const failed = items.filter((i) => i.status === "failed");

  // 5. Create an assistant token usable from the demo host page and the app itself.
  const tok = await client.json<{ rawToken?: string } & ApiError>("/api/assistant-tokens", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: `Demo widget (${new Date().toISOString().slice(0, 16)})`, allowedOrigins: [DEMO_ORIGIN, APP_URL] }),
  });
  if (tok.status !== 201 || !tok.body.rawToken) throw new SeedError(`Token creation failed (${tok.status}): ${tok.body.message}`);
  const token = tok.body.rawToken;

  return {
    organization: org.name,
    slug: org.slug,
    email: org.ownerEmail,
    password: reg.status === 201 || PASSWORD_FROM_ENV ? password : "(unchanged; use your original SEED_PASSWORD)",
    assistantToken: token,
    embedUrl: `${APP_URL}/embed/${token}`,
    demoUrl: `${DEMO_ORIGIN}/demo.html?token=${token}&app=${encodeURIComponent(APP_URL)}`,
    documents: items.map((i) => ({ fileName: i.fileName, status: i.status, pages: i.pageCount, chunks: i.chunkCount, error: i.error })),
    failedDocuments: failed.length,
  };
}

async function main() {
  console.log(`Seeding ${APP_URL}`);
  const results = [];
  for (const org of SEED_ORGANIZATIONS) results.push(await seedOrganization(org));

  await writeFile(".seed-output.json", JSON.stringify({ generatedAt: new Date().toISOString(), appUrl: APP_URL, organizations: results }, null, 2));

  console.log("\n== Done. Credentials and tokens saved to .seed-output.json (gitignored).\n");
  for (const r of results) {
    console.log(`${r.organization}`);
    console.log(`   sign in   ${APP_URL}/login  org: ${r.slug}  email: ${r.email}  password: ${r.password}`);
    console.log(`   demo      ${r.demoUrl}   (run \`npm run demo\` first)`);
    console.log(`   embed     ${r.embedUrl}`);
  }
  const failed = results.reduce((n, r) => n + r.failedDocuments, 0);
  if (failed) {
    console.log(`\n${failed} document(s) failed to process; see the errors above (usually a missing or invalid AI provider key).`);
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(`\nSeed failed: ${err instanceof SeedError ? err.message : (err as Error).stack}`);
  process.exit(1);
});

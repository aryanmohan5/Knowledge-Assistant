# Knowledge Assistant

A multi-tenant SaaS that turns an organization's PDFs into an embeddable question-answering assistant.

- Organizations sign in and upload documents.
- Visitors on the organization's own website ask questions in an iframe widget.
- Answers cite the exact document and page.
- Eligibility and policy-routing **decisions are made by deterministic code, not by the LLM**.

Built with Next.js 15 (App Router), MongoDB Atlas with Vector Search (Mongoose), Auth.js v5, LangChain, and Tailwind CSS.

**Contents**
- [Quick start](#quick-start)
- [Architecture: LLM vs. System 1](#architecture-llm-vs-system-1)
- [Knowledge base ingestion](#knowledge-base-ingestion)
- [Multi-tenant security](#multi-tenant-security)
- [Embedding the assistant](#embedding-the-assistant)
- [Testing](#testing)
- [Project structure](#project-structure)
- [Known limitations](#known-limitations)

---

## Quick start

### Prerequisites
- Node.js 20+ (developed on 24)
- A **MongoDB Atlas** cluster (the free M0 tier works). Atlas is required because the app uses Vector Search and transactions; a local community `mongod` supports neither.
- An API key for **OpenAI** or **Groq**

### 1. Configure

```bash
npm install
cp .env.example .env.local
```

Fill in `.env.local`. It is gitignored; never commit it.

| Variable | Required | Notes |
|---|---|---|
| `MONGODB_URI` | yes | Atlas connection string |
| `MONGODB_DB` | | Database name (default from the URI) |
| `AUTH_SECRET` | yes | `npx auth secret` or `openssl rand -base64 32` |
| `AI_PROVIDER` | | `OpenAI` (default) or `Groq` |
| `OPENAI_API_KEY` / `GROQ_API_KEY` | yes | The key for the chosen provider |
| `CHAT_MODEL`, `EMBEDDING_MODEL`, `EMBEDDING_DIMENSIONS`, `AI_BASE_URL` | | Overrides; see [Providers](#providers) |
| `ASK_MIN_RELEVANCE` | | Retrieval score cut-off, 0–1 (default 0.6) |
| `APP_URL` | | Public URL of the app; set it in production behind a proxy |

### 2. Create indexes, run, and seed

```bash
npm run db:indexes   # unique indexes + the Atlas Vector Search index (sized for your provider)
npm run dev          # http://localhost:3000
npm run seed         # in a second terminal: 2 orgs × 3 PDFs through the real upload API
npm run demo         # serves demo.html at http://localhost:5500
```

`npm run seed` prints, and writes to the gitignored `.seed-output.json`:
- sign-in credentials for each organization
- each organization's assistant token
- a ready-to-open `http://localhost:5500/demo.html?token=…` URL

Passwords are random unless you set `SEED_PASSWORD`. Use the same value to re-run the seed against an existing database; re-runs skip documents that already exist.

Then:
- **Dashboard:** http://localhost:3000/login. Upload or delete PDFs, create and revoke assistant tokens, and use the **Ask tester**, which shows the full pipeline trace.
- **Embedded widget:** open the printed demo URL. Try the questions in [QUESTIONS.md](QUESTIONS.md).

### Providers

| `AI_PROVIDER` | Endpoint | Embeddings | Chat (Decomposer + Synthesizer) | Key |
|---|---|---|---|---|
| `OpenAI` | `https://api.openai.com/v1` | `text-embedding-3-small` (1536) | `gpt-4o-mini` | `OPENAI_API_KEY` |
| `Groq` | `https://api.groq.com/openai/v1` | `nomic-embed-text-v1_5` (768) | `llama-3.3-70b-versatile` | `GROQ_API_KEY` |

Both providers are reached through their OpenAI-compatible APIs:
- Embeddings: direct `/embeddings` calls (`src/lib/ai/embeddings.ts`)
- Chat: LangChain `ChatOpenAI` with a custom `baseURL` (`src/lib/ai/chat.ts`)

Vector dimensions are validated on every write. Changing the provider or dimensions requires `npm run db:indexes` and re-uploading documents.

---

## Architecture: LLM vs. System 1

`POST /api/ask` is not a single LLM call. Generative steps and deterministic decision logic sit in separate modules with explicit, typed contracts between them.

```
  question + assistant token
            │
            ▼
  ┌────────────────────┐
  │ 1. Token           │  resolveAssistantToken → { organizationId, allowed knowledge bases }
  └────────┬───────────┘
           │            (parallel)
     ┌─────┴───────────────────────────┐
     ▼                                 ▼
┌──────────────────────┐     ┌───────────────────────────────┐
│ 2. Retrieval         │     │ 3. DECOMPOSER (LLM #1)        │
│ Atlas $vectorSearch  │     │ question → JSON               │
│ pre-filtered by      │     │ { intent, gpa, year,          │
│ organizationId       │     │   category, confidence }      │
└─────────┬────────────┘     │ zod-validated; 1 repair try,  │
          │                  │ then deterministic fallback   │
          │                  └──────────────┬────────────────┘
          │                                 ▼
          │                  ┌───────────────────────────────┐
          │                  │ 4. SYSTEM 1 (plain TypeScript)│
          │                  │ checkEligibility(gpa, year)   │ → boolean + reasons
          │                  │ routePolicy(category)         │ → one policy track + office
          │                  │ input: Decomposer JSON ONLY   │
          │                  └──────────────┬────────────────┘
          ▼                                 ▼
┌──────────────────────────────────────────────────────────────┐
│ 5. SYNTHESIZER (LLM #2)                                      │
│ question + System 1 decisions + retrieved passages           │
│ → answer; every fact tagged [Doc.pdf - Page N]               │
└──────────────────────────────┬───────────────────────────────┘
                               ▼
┌──────────────────────────────────────────────────────────────┐
│ 6. Grounding check (deterministic)                           │
│ tags must match retrieved chunks / models that actually ran; │
│ fabricated tags stripped → grounded: true | false            │
└──────────────────────────────────────────────────────────────┘
```

| Stage | Kind | Module | Contract |
|---|---|---|---|
| Token | code | `src/lib/tenant/assistantToken.ts` | Token → `TenantContext`. Invalid/revoked/expired → 401; disallowed origin → 403, before any AI call. |
| Retrieval | code + embeddings | `src/lib/rag/vectorSearch.ts` | Top 6 chunks from the tenant's (and token's) knowledge bases; below `ASK_MIN_RELEVANCE` dropped. |
| Decomposer | **LLM** | `src/lib/ask/decomposer.ts` | Classifies and extracts only; **never decides**. JSON mode + zod schema. Invalid JSON gets one repair, then a fallback to `general_knowledge`. |
| System 1 | **deterministic** | `src/lib/ask/system1/` | Pure functions, no I/O, no LLM. Missing or out-of-range input → `insufficient_input` (never guessed). Rules live in one file, `rules.ts`. |
| Synthesizer | **LLM** | `src/lib/ask/synthesizer.ts` | Writes prose only from the decisions and passages it is given; must cite. |
| Grounding | deterministic | `src/lib/ask/citations.ts` | Verifies every citation; reports `grounded`, `citations`, `invalidCitations`. |

**Why this split:** the LLM is good at understanding a messy question ("I'm a junior with a 3.2") and at writing a readable answer. It is not trustworthy for a yes/no decision. So the decision is made by `checkEligibility(3.2, 3)` in plain TypeScript. It is unit-tested, explainable (`reasons[]`), and identical every time. The Synthesizer is told the decision is authoritative and may not re-evaluate it.

### System 1 rules (`src/lib/ask/system1/rules.ts`)

- `checkEligibility(gpa, year)`: eligible when GPA ≥ **3.0** (on a 4.0 scale) **and** year ∈ **{2, 3, 4}**. Returns `eligible`, `reasons[]` and the rule text, or `insufficient_input` with `missing[]` / `invalid[]`.
- `routePolicy(category)`: maps a category or synonym to exactly one track, or `unrouted`:

  | Track | Policy | Office |
  |---|---|---|
  | academic | Academic Standards Policy | Office of the Registrar |
  | financial_aid | Financial Aid & Scholarships Policy | Financial Aid Office |
  | housing | Residence & Housing Policy | Housing Services |
  | conduct | Student Conduct Policy | Dean of Students |
  | health | Health & Wellbeing Policy | Student Health Services |

The dispatcher (`system1/index.ts`) selects models **only** from the Decomposer's `intent`:
- `eligibility` → `checkEligibility`, plus `routePolicy` if a category was named
- `policy_choice` → `routePolicy`
- `general_knowledge` → none

### Grounding rules

- The Synthesizer's system prompt requires that:
  - every fact ends with its exact source tag, e.g. `[Northbridge Merit Scholarship Guide.pdf - Page 1]`
  - rules-engine decisions are tagged `[System 1: checkEligibility]`
  - if the context lacks the answer, the reply is exactly: *"The knowledge base does not contain information to answer this question."* No outside knowledge.
- Enforced in code rather than trusted:
  - If there is no relevant context **and** no System 1 decision, the Synthesizer is **not called**. The fixed not-found reply is returned, plus a deterministic request for missing GPA/year.
  - Citations that don't match a retrieved chunk (name *and* page) or a model that ran are stripped, and the answer is flagged `grounded: false`.
  - Both LLM calls run at temperature 0.

### Response and errors

The response contains:
- `answer`
- `grounded`, `notFound`
- `citations[]`
- `decomposition` (including whether it came from a retry or the fallback)
- `system1[]`
- `sources[]` (excerpts and scores)
- `trace[]` (status and milliseconds per stage)

| Status | Code | When |
|---|---|---|
| 400 | `invalid_request` | Question missing, too short or too long |
| 401 | `invalid_token` | Missing, malformed, unknown, revoked or expired token |
| 403 | `origin_not_allowed`, `org_inactive` | Website not allowed for this token; organization suspended |
| 502 | `ai_provider_error` (+ `stage`) | Decomposer, Synthesizer or query-embedding call failed |
| 503 | `retrieval_unavailable` | Vector search failed (e.g. index missing) |

Provider error details are logged server-side and never returned.

---

## Knowledge base ingestion

`POST /api/knowledge-bases` (multipart: `file`, optional `title`) is used by the dashboard and by `npm run seed`.

1. **Limits, before any processing.** Each failure returns `{ error, message }` with a user-facing message:

   | Limit | Response |
   |---|---|
   | ≤ **10 MB** per PDF. The raw body stream is cut off at the cap, so oversized uploads are never buffered. | 413 `file_too_large` |
   | ≤ **10 PDFs** per organization. Re-counted after insert, so concurrent uploads can't exceed it. | 409 `document_limit_reached` |
   | ≤ **20 pages** per PDF | 422 `too_many_pages` |
   | Real PDF, checked by file signature; not encrypted or corrupt; has extractable text | 415 / 422 |
   | Duplicate file (SHA-256) within the organization | 409 `duplicate_document` |

2. **Extraction.** `unpdf` (pdf.js) extracts text page by page.
3. **Chunking** (`src/lib/pdf/chunk.ts`). Each page is chunked separately into ~1200 characters with 200 characters of overlap, cut at paragraph, sentence or word boundaries. A chunk never spans two pages, so citations are exact.
4. **Response.** The endpoint returns **202** with status `processing`. Embedding continues in the background via `after()`, in batches of 64 with retries on 429/5xx.
5. **Storage.** Every `KnowledgeChunk` stores:
   - `organizationId`, `knowledgeBaseId` (document id)
   - `documentName`, `pageNumber`
   - `chunkIndex`, `text`, `embedding`
6. **Failure handling.**
   - Embedding fails: partial chunks are removed and the document becomes `failed` with a readable error.
   - Document deleted mid-processing: its chunks are cleaned up.
   - Interrupted for more than 10 minutes: marked failed.

The Atlas Vector Search index (`npm run db:indexes`) declares `organizationId` and `knowledgeBaseId` as **filter fields**, so tenant filtering happens *inside* the vector search (a pre-filter), not afterwards.

---

## Multi-tenant security

### Data isolation: two independent layers

1. **Scoped repositories.** `repos(ctx)` in `src/lib/tenant/` is the only data API route handlers may use. It forces `organizationId` into every filter, insert, update and pipeline, overriding anything the caller passed. A document id from another tenant simply resolves to `null`, which the API returns as 404.
2. **Hard guard.** The `tenantScope` Mongoose plugin (`src/lib/db/plugins/tenantScope.ts`) is attached to every tenant model. Any query, update, aggregate, `insertMany` or `bulkWrite` not pinned to **one exact** `organizationId` throws `TenantIsolationError` before reaching MongoDB. That includes:
   - `$ne` / `$in` / regex or array values
   - an organization filter hidden only inside `$or`
   - updates that touch `organizationId`
   - `$lookup` / `$unionWith` without their own tenant match
   - `$out` / `$merge`
   - collection-wide counts

Supporting rules:
- **Lint enforcement.** ESLint forbids `src/app/**` from importing models, `mongoose` or the cross-tenant module.
- **Cross-tenant lookups** happen only in `src/lib/db/system.ts`: the org by slug at login, and a token by hash. They use a per-process bypass key that can't be forged with a query option.
- **Per-request re-checks.** Each request re-verifies that the user and organization are still active, so suspension takes effect immediately.
- **Uniqueness per tenant.** User emails and document checksums are unique *per organization*.

### Authentication

- **Dashboard users:** Auth.js credentials (organization ID + email + password).
  - bcrypt cost 12, with a timing-safe dummy compare
  - JWT sessions of 12 h
  - a user of org A can't sign in through org B's slug
- **Embedded visitors:** no account. They are authorized by the organization's **assistant token**.

### Assistant tokens

- Format: `ka_live_` + 32 random bytes.
- Only the **SHA-256 hash** is stored; the raw token is shown once at creation.
- Each token has an **allowed-origins list**, optional **knowledge-base restriction**, expiry and **instant revocation**.
- Embed tokens are **publishable keys**: they appear in the host page's HTML, like a Stripe publishable key. What protects them is the origin enforcement below, together with revocation and scoping. Secrecy is not the protection.

| Threat | Control |
|---|---|
| Another website uses the token from browser JavaScript | CORS: `Access-Control-Allow-Origin` is only sent for the token's allowed origins; other origins get 403 before any AI call |
| Another website frames the widget | `/embed/[token]` is served with `Content-Security-Policy: frame-ancestors 'self' <allowed origins>` (set per token in `src/middleware.ts`). Invalid tokens get `'self'` only, and lookup failures fail closed. |
| Token leaks via URL | `Referrer-Policy: no-referrer` and `noindex` on the embed page |
| Token used after a site is decommissioned | Revoke in the dashboard; it takes effect on the next request |
| Token reads another tenant's data | Token → `organizationId` → the same scoped repos and vector pre-filter as everyone else |
| Prompt injection via the question or documents | Both are passed as delimited data; decisions come from System 1, not the LLM; citations are verified in code |

Inside the iframe, `/api/ask` calls come from the app's own origin. The route trusts that origin by comparing `Origin` with the request's `Host` (or `APP_URL`), which a cross-site page cannot make agree. Which sites may host the iframe is then controlled by `frame-ancestors`.

Non-browser clients (curl) can send any `Origin` header. Origin checks are a browser-side control, which is why tokens are scoped and revocable. **Per-token rate limiting is the next control to add** (see [Known limitations](#known-limitations)).

---

## Embedding the assistant

1. On the dashboard, create an assistant token and list the site(s) that will host it, e.g. `https://www.example.edu`.
2. Paste into the site:

```html
<iframe
  src="https://YOUR-APP/embed/ka_live_..."
  title="Ask our assistant"
  style="width: 100%; max-width: 420px; height: 600px; border: 1px solid #e5e5e5; border-radius: 12px"
  referrerpolicy="no-referrer">
</iframe>
```

`demo.html` (repo root) is a fake university portal that does exactly this. It reads the token from its own URL (`?token=…&app=…`), so no token is committed. Serve it with `npm run demo`: a page opened from `file://` has no origin, so `frame-ancestors` can't allow it.

The widget handles every failure state:

| Situation | Widget shows |
|---|---|
| Invalid, revoked or expired token, or suspended organization | Friendly "Assistant unavailable" page; mid-chat it disables input |
| LLM failure (502) or search outage (503) | Retry button that resends the same question |
| Validation errors | Inline message |
| Network failure or 60 s timeout | "Couldn't reach the assistant" with Retry |
| Not-found answer | Distinct "Not in the knowledge base" style |
| `grounded: false` | Note that some statements could not be verified |

---

## Testing

```bash
npm run typecheck && npm run lint && npm test && npm run build
```

`npm test` (vitest, against an in-memory MongoDB replica set, with mocked AI) covers:
- **Tenant isolation:** every hooked operation without a tenant filter throws, plus cross-tenant read, update and delete attempts
- **Auth and registration**
- **Assistant tokens:** hash-only storage; revoked, expired, wrong-origin and trusted-origin cases
- **PDF extraction and chunking**
- **Upload limits:** 10 MB, 20 pages, 10 documents, concurrent uploads, duplicates, non-PDFs
- **Ingestion:** chunk tagging, cleanup on failure or delete
- **Embedding providers:** Groq and OpenAI endpoints, prefixes, retries, dimension checks
- **System 1:** eligibility boundaries; routing synonyms and unknown categories
- **The `/api/ask` pipeline**, with injected fake LLMs and retrieval: the Decomposer's retry and fallback, System 1 → Synthesizer flow, skipping the Synthesizer on no context, stripping fabricated citations, stage-tagged errors, and token → tenant scoping
- **Embed:** token checks, `frame-ancestors` header building (injection attempts dropped), citation rendering
- **Seed data:** fits the limits, builds deterministically, and matches the System 1 rules

`QUESTIONS.md` lists 10 manual test questions, with the expected Decomposer output, System 1 result and citations for each.

The automated suite can't run `$vectorSearch`, which needs Atlas. The full question → cited answer path is covered by the injected-dependency pipeline tests, and the questions in `QUESTIONS.md` verify it against a real cluster.

---

## Project structure

```
demo.html                     external "host site" that embeds the widget
QUESTIONS.md                  manual test questions with expected outcomes
scripts/
  create-search-indexes.ts    Atlas Vector Search + unique indexes (npm run db:indexes)
  seed.ts, seed-data.ts,      2 orgs × 3 PDFs through the real API (npm run seed)
  seed-pdf.ts
  serve-demo.mjs              serves demo.html on :5500 (npm run demo)
src/
  middleware.ts               API session gate; per-token frame-ancestors for /embed
  auth.ts, auth.config.ts     Auth.js credentials provider
  app/
    (auth)/login, register    sign-in and organization signup
    dashboard/                documents, assistant tokens, Ask tester
    embed/[token]/            public chat widget
    api/ask                   question-answering pipeline endpoint
    api/knowledge-bases       upload / list / delete
    api/assistant-tokens      create / list / revoke
    api/public/embed/[token]  frame-ancestors lookup for middleware
  lib/
    ask/                      decomposer, system1/, synthesizer, citations, pipeline
    ai/                       LangChain chat model, embeddings client, AI errors
    rag/vectorSearch.ts       tenant-pre-filtered $vectorSearch
    pdf/                      extraction + page-aware chunking
    services/                 ingestion, registration
    tenant/                   context, scoped repos, assistant tokens, embed checks
    db/                       connection, tenantScope plugin, audited system queries
  models/                     Organization, User, KnowledgeBase, KnowledgeChunk, AssistantToken
tests/                        vitest suites
```

---

## Known limitations

- **No rate limiting** on `/api/ask`, login or signup yet. Add per-token and per-IP limits (e.g. Upstash or Redis) before production.
- **Original PDFs are not stored.** Only metadata, checksum and text chunks are kept, so re-processing requires re-uploading.
- **Background ingestion uses `after()`.** Hosts with short function limits (60 s here) could cut off very slow embedding runs; those documents are marked failed after 10 minutes. A queue (e.g. Inngest or BullMQ) would be the production upgrade.
- **Groq embeddings:** Groq's API schema lists `nomic-embed-text-v1_5`, but availability may vary by account. Verify with your key; `EMBEDDING_MODEL` / `AI_BASE_URL` allow switching.
- **Scanned (image-only) PDFs** are rejected; there is no OCR.
- **`ASK_MIN_RELEVANCE`** (0.6) is a starting point; tune it on real documents.
- **System 1 rules are global defaults** shared by all organizations. Per-organization rules would be a schema extension.

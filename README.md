# Knowledge Assistant

A multi-tenant RAG SaaS built on Next.js 15, MongoDB Atlas (Mongoose) and Auth.js v5. Organizations sign in, upload PDFs on `/dashboard`, and the PDFs are chunked and embedded into Atlas Vector Search.

## Setup

```bash
cp .env.example .env.local   # MONGODB_URI (Atlas), AUTH_SECRET, AI_PROVIDER + its API key
npm install
npm run db:indexes           # unique indexes + Atlas Vector Search index (sized for your provider)
npm run dev                  # http://localhost:3000 → /register, /login, /dashboard
```

| Script | Purpose |
|---|---|
| `npm test` | Isolation, auth, token, PDF, embedding and ingestion suites (in-memory replica set, mocked AI) |
| `npm run typecheck` / `npm run lint` | Strict TS; ESLint enforces the data-access rules below |
| `npm run db:indexes` | Creates or updates `chunk_vector_index` (provider dimensions, cosine, filters on `organizationId` and `knowledgeBaseId`) |

## Embeddings (`AI_PROVIDER`)

| `AI_PROVIDER` | Endpoint | Model | Dimensions | Key |
|---|---|---|---|---|
| `Groq` | `https://api.groq.com/openai/v1` | `nomic-embed-text-v1_5` | 768 | `GROQ_API_KEY` |
| `OpenAI` (default) | `https://api.openai.com/v1` | `text-embedding-3-small` | 1536 | `OPENAI_API_KEY` |

- Both providers are called directly through the OpenAI-compatible `/embeddings` API (`src/lib/ai/embeddings.ts`), in batches of 64, with retries on 429/5xx.
- Nomic models get their `search_document:` / `search_query:` task prefixes.
- Every returned vector is checked against the configured dimensions before it is stored.
- `EMBEDDING_MODEL`, `EMBEDDING_DIMENSIONS` and `AI_BASE_URL` override the defaults. Switching provider or dimensions means re-running `npm run db:indexes` and re-uploading documents.

## Upload pipeline

`POST /api/knowledge-bases` takes a multipart upload with `file` (required) and `title` (optional). Limits are checked in `src/lib/services/knowledgeBase.ts` before any AI call. Each failure returns `{ error, message }` with a message the user can read:

| Limit | Response |
|---|---|
| Body over 10 MB + 64 KB (raw stream is cut off, not buffered) or file over **10 MB** | 413 `file_too_large` |
| More than **10 documents** per organization (re-checked after insert, so concurrent uploads can't exceed it) | 409 `document_limit_reached` |
| More than **20 pages** | 422 `too_many_pages` |
| Not a PDF (checked by file signature), corrupt, or password-protected | 415 / 422 |
| No extractable text (scanned PDF) | 422 `no_extractable_text` |
| Same file already uploaded in this organization | 409 `duplicate_document` |

Once the checks pass, the server extracts text per page (`unpdf`) and splits each page into ~1200-character chunks with 200 characters of overlap, cutting at paragraph or sentence breaks. It then responds `202` with the document in the `processing` state. Embedding and insertion continue in `after()`.

Each `KnowledgeChunk` stores:
- `organizationId` and `knowledgeBaseId` (the document ID)
- `documentName` and `pageNumber`, for citations
- `chunkIndex`, `text` and `embedding`

If embedding fails, the partial chunks are removed and the document is marked `failed` with a readable error. A document deleted mid-processing has its chunks cleaned up. A document stuck in `processing` for over 10 minutes (e.g. after a server restart) is marked failed.

The original PDF is not stored; only its metadata, checksum and chunks are kept.

## Tenant isolation

Isolation has two independent layers.

1. **`repos(ctx)`** (`src/lib/tenant/`) is the only data API that route handlers may use. It forces `organizationId` into every filter, payload, bulk insert and pipeline. A document ID from another tenant resolves to `null`, which the API returns as 404.
2. **`tenantScope` plugin** (`src/lib/db/plugins/tenantScope.ts`) is a hard guard on every tenant model. Any query, update, aggregate, insert or bulk write that isn't pinned to one exact `organizationId` throws `TenantIsolationError`.

Rules:
- Route handlers call `requireTenant()`, which re-checks on every request that the org and user are still active, and then use `repos(ctx)`. ESLint blocks importing models, `mongoose` or `@/lib/db/system` under `src/app/**`.
- Cross-tenant lookups happen only in `src/lib/db/system.ts`.
- Middleware is only a first filter; the real boundary is `requireTenant()`. Its body-size cap is raised in `next.config.ts` so it never truncates uploads.
- `Model.collection.*` (the raw driver) skips Mongoose middleware. Don't use it for tenant data.

## API

| Route | Notes |
|---|---|
| `POST /api/auth/register` | Creates the org and its owner in one transaction |
| `/api/auth/*` | Auth.js; credentials are `organizationSlug`, `email`, `password` |
| `GET /api/knowledge-bases` | The caller's documents plus usage and limits |
| `POST /api/knowledge-bases` | Multipart PDF upload (see above) |
| `GET/DELETE /api/knowledge-bases/:id` | Delete (owner/admin) also removes the document's chunks |
| `GET/POST /api/assistant-tokens`, `DELETE /api/assistant-tokens/:id` | Owner/admin only; the raw token is returned once |

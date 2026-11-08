# Knowledge Assistant

A multi-tenant RAG SaaS built on Next.js 15, MongoDB Atlas (Mongoose) and Auth.js v5. The backend foundation is in place; there is no UI yet.

## Setup

```bash
cp .env.example .env.local   # fill in MONGODB_URI (Atlas) and AUTH_SECRET
npm install
npm run db:indexes           # unique indexes + Atlas Vector Search index
npm run dev
```

| Script | Purpose |
|---|---|
| `npm test` | Isolation, auth and token suites (in-memory replica set) |
| `npm run typecheck` / `npm run lint` | Strict TS; ESLint enforces the data-access rules below |
| `npm run db:indexes` | Creates or updates `chunk_vector_index` (`EMBEDDING_DIMENSIONS`, cosine, filters on `organizationId` and `knowledgeBaseId`) |

## Tenant isolation

Isolation has two independent layers.

1. **`repos(ctx)`** (`src/lib/tenant/`) is the only data API that route handlers may use. It forces `organizationId` into every filter, payload and pipeline. A document id from another tenant resolves to `null`, which the API returns as 404.
2. **`tenantScope` plugin** (`src/lib/db/plugins/tenantScope.ts`) is a hard guard on every tenant model. Any query, update, aggregate, insert or bulk write that isn't pinned to one exact `organizationId` throws `TenantIsolationError`. That includes `$ne`/`$in`, arrays, and an organization filter that appears only inside `$or`. It also rejects updates to `organizationId`, `$lookup`/`$unionWith` without a tenant match, `$out`/`$merge`, and `estimatedDocumentCount`.

Rules:
- Route handlers call `requireTenant()`, which re-checks on every request that the org and user are still active, and then use `repos(ctx)`. ESLint blocks importing models, `mongoose` or `@/lib/db/system` under `src/app/**`.
- Cross-tenant lookups happen only in `src/lib/db/system.ts` (org by slug, assistant token by hash), using a per-process bypass key.
- Middleware is only a first filter; the real boundary is `requireTenant()`.
- `Model.collection.*` (the raw driver) skips Mongoose middleware. Don't use it for tenant data.

## Data model

- **Organization**: the tenant.
- **User**: email is unique per organization.
- **KnowledgeBase**: one PDF's metadata. Its storage key is `orgs/<orgId>/...`, and checksums are unique per tenant.
- **KnowledgeChunk**: text plus `embedding`. This is the vector collection.
- **AssistantToken**: embed credentials. Only the SHA-256 hash is stored, and each token has an origin allow-list, an optional KB restriction, expiry and revocation.

## API

| Route | Notes |
|---|---|
| `POST /api/auth/register` | Creates the org and its owner in one transaction |
| `/api/auth/*` | Auth.js; credentials are `organizationSlug`, `email`, `password` |
| `GET/POST /api/knowledge-bases`, `GET/DELETE /api/knowledge-bases/:id` | |
| `GET/POST /api/assistant-tokens`, `DELETE /api/assistant-tokens/:id` | Owner/admin only; the raw token is returned once |

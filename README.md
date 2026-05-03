# Science Compiler

Full-stack **pnpm monorepo** for exploring **scientific literature as structured data**: **topics**, **papers**, **claims**, **studies**, **evidence links**, plus an **AI ingestion pipeline** (PubMed → claim extraction → linking), a **synthesis / query** layer (retrieval, streaming answers, claim verification, contradiction maps), and **pgvector**-backed embedding search on claims. The **Clerk**-auth SPA (`artifacts/science-compiler`) talks to **`artifacts/api-server`** (Express 5) via OpenAPI-generated **`@workspace/api-client-react`** and **`@workspace/api-zod`**.

## Monorepo layout

| Path | Role |
|------|------|
| `artifacts/science-compiler` | React 19 + Vite SPA (Wouter, TanStack Query, Tailwind v4, Radix/shadcn-style UI, Clerk, Sentry client). Pages include query, topics, papers, claims, admin (e.g. ingestion). |
| `artifacts/api-server` | Express 5 API: CRUD routes, admin ingestion controls, SSE query/synthesis routes, tests (Vitest). |
| `artifacts/mockup-sandbox` | Ancillary UI scaffold. |
| `lib/api-spec/openapi.yaml` | OpenAPI — run `pnpm --filter @workspace/api-spec run codegen` after edits. |
| `lib/db` | Drizzle schema + migrations; tables include topics, papers, claims, studies, evidence, ingestion_runs/configs, question_synthesis, usage/observability-related tables, **claims.embedding** (pgvector HNSW cosine, 1536-d `text-embedding-3-small`). |
| `lib/integrations-openai-ai-server` | OpenAI via Replit AI Integration for chat; batch helpers. **Embeddings** use the **`openai` SDK with `OPENAI_API_KEY`** (proxy does not cover embeddings per `replit.md`). |

## Stack (from repo)

- **Node**: documented in `replit.md` as **24** for Replit; use a current **Node LTS** that matches your host.
- **TypeScript** 5.9, **pnpm** workspaces, **esbuild** API bundle, **Vitest** in api-server.

## Root commands

```bash
pnpm install          # pnpm enforced by root preinstall
pnpm run typecheck    # all packages
pnpm run build        # typecheck + recursive build
pnpm --filter @workspace/api-spec run codegen
pnpm --filter @workspace/db run push        # dev schema sync (drizzle-kit)
pnpm --filter @workspace/api-server run dev # build + start bundled API
pnpm --filter @workspace/science-compiler run dev
```

**Migrations**: this `@workspace/db` package exposes `generate` / `push` (see `lib/db/package.json`). Use your team’s workflow (`generate` + applying SQL under `lib/db/migrations`) for production; `push` is for fast local iteration.

## Core product surface

- **Curated knowledge graph**: CRUD over topics, papers, claims, studies, evidence links; domain filters; seeded demo claims.
- **Ingestion**: PubMed search/fetch (`esearch` / `efetch`), LLM claim extraction from abstracts, linking and synthesis refresh, scheduled worker (~6h) + on-demand **admin** run; configs and run history stored in DB; admin UI at `/admin/ingestion`.
- **Query engine**: full-text style retrieval on claims/papers, **SSE** streaming synthesis (`GET /api/query/synthesize`), claim verification (`POST /api/query/verify`), contradiction map with lazy LLM explanations (`GET /api/claims/:id/contradictions`); **24h** TTL cache in `question_synthesis`.

## Environment variables

Typical:

- **`DATABASE_URL`** — Postgres with **pgvector** enabled for claim embeddings.
- **`OPENAI_API_KEY`** — embeddings (and any direct OpenAI calls outside the Replit proxy path).
- Replit AI Integration base URL + key as used by `@workspace/integrations-openai-ai-server` for chat.
- **Clerk** secrets for Express + React (`@clerk/express`, `@clerk/react`).

## Frontend entrypoints

Generated hooks (e.g. `useVerifyClaim`, `useGetClaimContradictions`) drive the **Query** page (streaming synthesis UI) and **claim detail** (contradiction map panel).

## License

MIT (`package.json`).

# Workspace

## Overview

pnpm workspace monorepo using TypeScript. Each package manages its own dependencies.

## Stack

- **Monorepo tool**: pnpm workspaces
- **Node.js version**: 24
- **Package manager**: pnpm
- **TypeScript version**: 5.9
- **API framework**: Express 5
- **Database**: PostgreSQL + Drizzle ORM
- **Validation**: Zod, `drizzle-zod`
- **API codegen**: Orval (from OpenAPI spec)
- **Build**: esbuild (CJS bundle)
- **AI**: OpenAI via Replit AI Integration (`@workspace/integrations-openai-ai-server`)

## Key Commands

- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- `pnpm --filter @workspace/api-server run dev` — run API server locally

See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details.

## Features

### Core Platform (Task #1)
- Topics, Papers, Claims, Studies, EvidenceLinks with full CRUD
- 50 seeded claims across domains
- Domain filtering on papers list
- GET /evidence-links endpoint
- Error states on all list pages

### AI Paper Ingestion Pipeline (Task #2)
- PubMed search + fetch via `lib/pubmed.ts` (esearch + efetch APIs)
- LLM claim extraction via `lib/claimExtractor.ts` (structured JSON from paper abstracts)
- Evidence linking + synthesis refresh via `lib/evidenceLinker.ts`
- Batch processing with retry via `@workspace/integrations-openai-ai-server/batch`
- Scheduler: runs every 6 hours automatically; also triggerable on demand
- DB tables: `ingestion_runs`, `ingestion_configs`
- Admin API: GET/POST `/admin/ingestion-configs`, PATCH/DELETE `/admin/ingestion-configs/:id`, POST `/admin/ingestion/run`, GET `/admin/ingestion-runs`
- Admin UI: `/admin/ingestion` page with config CRUD, run history, and "Run Now" button

## Architecture

```
artifacts/
  api-server/          Express 5 API, serves /api/*
    src/
      routes/          admin.ts, papers.ts, claims.ts, topics.ts, ...
      lib/             ingestionWorker.ts, ingestionScheduler.ts, pubmed.ts, claimExtractor.ts, evidenceLinker.ts
  science-compiler/    React + Vite frontend
    src/
      pages/           query/, topics/, papers/, claims/, admin/
      components/      layout.tsx, badges.tsx, ui/
lib/
  db/                  Drizzle schema + migrations
  api-spec/            OpenAPI spec (openapi.yaml)
  api-client-react/    Generated React Query hooks (via Orval)
  api-zod/             Generated Zod schemas (via Orval)
  integrations-openai-ai-server/  OpenAI client + batch utilities
```

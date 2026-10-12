# Changelog

## Phase 1 — Database and seed (2026-10-12)

- Drizzle schema (`db/schema.ts`) for all 12 tables in `docs/03-DATA-MODEL.md` plus `style_guides` (user decision: style guide in Neon). Migrations `0000_extensions` (pg_trgm, citext, pgcrypto) and `0001_init`, applied over Neon's direct host by `npm run db:migrate`.
- `lib/db.ts`: Neon HTTP driver for simple queries, short-lived WebSocket pool for transactions, `pingDb`.
- `lib/dedupe/canonical.ts` and `normalize.ts` (moved forward from Phase 3) with unit tests.
- `npm run seed:issues`: four past issues from real GNews articles (36 fetched, 34 kept), cached in `db/seed/past-issues.json`.
- `npm run seed`: 30 sources, style guide v1, 4 `[SEED]` SENT issues (8–9 stories, 3 topics each), 2,200 subscribers. Re-runnable.
- `npm run test:db`: integration tests against Neon (extensions, counts, citext, trigram similarity).
- `/api/health` now pings the DB, reports last run per job and the function region; returns 503 if the DB is unreachable.
- Dependencies added: `drizzle-orm`, `@neondatabase/serverless`, `drizzle-kit`, `tsx` (all listed in `docs/02-ARCHITECTURE.md` §2).

## Phase 0 — Foundations (2026-10-12)

- Scaffolded Next.js 16.4.0 (App Router, TypeScript strict, ESLint) without Tailwind or AGENTS.md.
- Added `lib/time.ts` (IST issue dates and contiguous windows), `lib/env.ts` (zod-validated env), `lib/log.ts` (JSON logger, email masking) with Vitest tests.
- Added `GET /api/health`.
- Dependencies added: `zod` (runtime), `vitest` (dev). Both listed in `docs/02-ARCHITECTURE.md` §2.
- `@types/node` raised to ^24 to satisfy Vitest 5's peer range and match the Node 24 runtime.
- Turned off `cacheComponents`/`partialPrefetching` (scaffold defaults) so routes can declare `runtime = 'nodejs'` per the docs.
- Recorded user decisions and verified provider limits in `docs/DECISIONS.md`; updated `01`, `02`, `04` and `05` docs to match.
- Pushed to GitHub and connected the repo to Vercel. Added `vercel.json` pinning functions to Singapore (`sin1`) to sit next to the Neon database.

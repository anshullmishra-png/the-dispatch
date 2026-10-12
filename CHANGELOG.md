# Changelog

## Phase 0 — Foundations (2026-10-12)

- Scaffolded Next.js 16.4.0 (App Router, TypeScript strict, ESLint) without Tailwind or AGENTS.md.
- Added `lib/time.ts` (IST issue dates and contiguous windows), `lib/env.ts` (zod-validated env), `lib/log.ts` (JSON logger, email masking) with Vitest tests.
- Added `GET /api/health`.
- Dependencies added: `zod` (runtime), `vitest` (dev). Both listed in `docs/02-ARCHITECTURE.md` §2.
- `@types/node` raised to ^24 to satisfy Vitest 5's peer range and match the Node 24 runtime.
- Turned off `cacheComponents`/`partialPrefetching` (scaffold defaults) so routes can declare `runtime = 'nodejs'` per the docs.
- Recorded user decisions and verified provider limits in `docs/DECISIONS.md`; updated `01`, `02`, `04` and `05` docs to match.

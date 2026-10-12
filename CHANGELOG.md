# Changelog

## Phase 4 — Gemini selection (2026-10-12)

- `content/style-guide.md` filled (AI-generated with the user's permission; recorded in `CLAUDE.md` §4). Seeded as style guide v2.
- `lib/ai/gemini.ts`: the only Gemini caller. JSON-schema output, 3 retries with backoff + jitter, 50 s timeout, caller deadline, concurrency 1, mock mode, prompt hash in logs.
- `lib/ai/prompts.ts`, `lib/ai/schemas.ts` (strict schema with per-call id enum; lenient parse shape).
- `lib/curate/`: `lint.ts` (voice + grounding), `validate.ts` (all 8 violation codes), `candidates.ts` (week-spread trimming), `select.ts` (validate → 2 re-prompts → deterministic repair), `draft.ts` (transactional, locked once confirmed).
- `GET /api/cron/curate`: bearer auth, per-issue idempotency, ingest guard, dedupe finalize, selection, draft; stats (tokens, attempts, violations) in `pipeline_runs`.
- Model switched to `gemini-3.6-flash` after `gemini-3.8-flash` failed 4/4 live attempts.
- Dependency added: `@google/genai` (listed in `docs/02-ARCHITECTURE.md` §2).
- Live hardening: fallback Flash model rotation (`GEMINI_FALLBACK_MODELS`), `GEMINI_THINKING_LEVEL=LOW`, re-curate reconsiders the previous draft's stories, grounding lint no longer joins names across sentences or counts a sentence-opening word as part of a name.
- First live draft: 9 picks + 5 backups, 5 topics, `gemini-3.6-flash`, 25.6 s, no repair needed.

## Phase 3 — Dedupe (2026-10-12)

- `lib/dedupe/trigram.ts`: JS port of `pg_trgm` similarity (matches the PostgreSQL docs example; integration-tested against Postgres).
- `lib/dedupe/engine.ts`: duplicate rule with distinctive-entity matching, `chooseDuplicateRoot`, `pickRepresentatives`. Calibrated thresholds approved by the user (see `05-INTEGRATIONS.md` §2).
- `lib/dedupe/history.ts`: `loadLastFourSet` (live picks of the four most recent SENT issues) and `matchLastFour` (title + edited headline + exact URL).
- `lib/dedupe/classify.ts`: `classifyNewArticles` → `duplicate` / `seen_before` / `candidate`, with sample matched pairs in the run stats. Wired into every ingest.
- Ingest: Medianama replaced by ET Small Biz after probing spares from Vercel's `sin1` region.

## Phase 2 — Ingest (2026-10-12)

- `npm run probe` (`scripts/probe-sources.ts`): checks every RSS feed (free) and, with `--gnews`, each news query. 9/20 original feeds worked; 20 working feeds + 5 GNews queries approved by the user.
- `lib/collect/`: `rss.ts` (fetch with 8 s timeout + `rss-parser`), `gnews.ts` (quota-aware, never leaks the key), `text.ts` (HTML stripping), `limit.ts` (concurrency 6), `index.ts` (`collectAll`, `prepareItems`, `runIngest` with source health and auto-pause after 5 failures).
- `lib/issues.ts` (`getOrCreateIssue`), `lib/runs.ts` (pipeline runs + idempotency), `lib/security.ts` (timing-safe bearer/admin checks, fail closed).
- `GET /api/cron/ingest`: bearer `CRON_SECRET`, per-IST-day idempotency, `?force=1`, stats in `pipeline_runs.stats`.
- Seed now syncs `sources` to `content/sources.seed.json`.
- Dependency added: `rss-parser` (listed in `docs/02-ARCHITECTURE.md` §2).

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

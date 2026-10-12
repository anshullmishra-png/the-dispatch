# DECISIONS

Claude Code: append here whenever you resolve a VERIFY item, ask the user a question, or deviate from the docs. Format: date, decision, reason.

## Already decided by the user (before the build)

| Topic | Decision |
|---|---|
| Hosting | Vercel Hobby (free) |
| Database | Neon Postgres |
| Email provider | Resend (keep Resend; handle bounces with its webhooks) |
| Send demonstration | Real mail only to the user's own inbox (`SEND_ALLOWLIST`) |
| News API | Any free one; chosen: GNews |
| Telegram | User has Telegram, bot not yet created (create with @BotFather in Phase 6) |
| Column headers on the Components Map | Trigger, Input, Context, Processing, AI, Output only |
| Design | Trattoria broadsheet (see `docs/06-DESIGN.md`) |

## Answered in Phase 0 (2026-10-12)

| Topic | Decision | Notes |
|---|---|---|
| Repository | New standalone GitHub repo; the user creates it on github.com (no `gh` CLI) | Avoids the multi-project Vercel setup of the old `claude-agents` repo |
| Local folder | `E:\AI by Mihir\AI End Term\the-dispatch` | |
| Gemini key | New key created for this project | Not shared with the Telegram note bot |
| Gemini model | `gemini-3.8-flash` | Literal "Gemini Flash"; Flash-Lite is a separate variant in Google's docs |
| Gemini API surface | `generateContent` | Docs' design; Google calls it legacy but fully supported |
| Topic taxonomy | The 9 topics in `04-AI-PROMPTS.md` §3, unchanged | |
| Style guide content | The user writes it (fills every `[FILL]`, 3+ examples) | Phase 4 is blocked until no `[FILL]` remains |
| Style guide storage | Neon table, seeded from `content/style-guide.md`; curate reads the active row | Matches the Components Map. `03-DATA-MODEL.md` gets the table in Phase 1, with its migration |
| Past four issues | Generated placeholders, subject prefixed `[SEED]` | |
| Resend test addresses | Seed `delivered@`, `bounced@`, `complained@resend.dev` | Real bounce/complaint webhooks in the demo |
| Dashboard | Public read-only counts; admin strip only with `ADMIN_TOKEN` | |
| Newsletter name | The Dispatch | |
| Sender | **Pending.** User first chose "own domain", then asked what that means. Explained: `onboarding@resend.dev` reaches only the Resend account owner, which the demo needs anyway; a custom domain needs DNS records. Using `onboarding@resend.dev` until the user answers (needed by Phase 7) | |
| Demo inbox | `anshullmishra@gmail.com` (`SEND_ALLOWLIST`, `MAIL_REPLY_TO`) | Must be the address the Resend account is registered with |
| GNews terms | Keep GNews despite the free plan's non-commercial-only terms and 12 h delay | Exam project is non-commercial; RSS carries fresh news |
| Send cron time | `0 2 * * 4` → fires Thu 07:30–08:29 IST | Map says "Thu 8 AM". **User updates the map text** to the hourly window |
| Issue window | Contiguous: Thu 00:00 IST → Wed 23:59:59.999 IST | Original Thu 09:00 start left Thu 00:00–08:59 unassigned |
| Phase gating | Stop after every phase for the user's sign-off | |
| Region | Neon in AWS Asia Pacific (Singapore) `ap-southeast-1`; Vercel functions pinned to `sin1` (`vercel.json` `regions`) | User is in India; app and DB must share a region because each job runs hundreds of queries. Neon has no India region. Replaces the earlier US East suggestion |
| GitHub | https://github.com/anshullmishra-png/the-dispatch, connected to the Vercel project (pushes to `main` deploy to production) | |

## Answered in Phase 1 (2026-10-12)

| Topic | Decision | Notes |
|---|---|---|
| Seed story source | Real articles from GNews, one batch per past week (`npm run seed:issues`), cached in `db/seed/past-issues.json` | Lets the Last-4 dedupe fire on live data. Issues labelled `[SEED]` |
| Seed commentary / voice | Neutral placeholder text, never sent to Gemini; **no** seeded `style_examples` | Few-shot comes only from Shreya's real edits; the style guide's Examples section carries the voice until then |
| Secrets location | `.env.local` (git-ignored), converted to `KEY=VALUE` from the user's `label: value` notes; original kept as `.env.local.bak` (git-ignored) | During the check, a script accidentally printed the values into the chat transcript. Nothing was sent elsewhere. **Rotate the Neon password and the Gemini/GNews keys before submission** if the transcript could be shared |

## Answered in Phase 2 (2026-10-12)

| Topic | Decision | Notes |
|---|---|---|
| RSS feeds | 20 approved: 9 original survivors, 3 corrected URLs (Entrackr `/rss`, ET Tech Startups, HT Technology), 8 new (ET Tech Funding, Mint Companies, BusinessLine Info-tech and Money & Banking, The Hindu Business, Indian Express Business, CNBC-TV18 Business, TOI Business) | Dropped: Moneycontrol, Business Standard, Tech in Asia (403), Analytics India Mag, Techcircle, VCCircle, The News Minute (HTML/404), TechCrunch India (stale since 2 Sep) |
| GNews queries | Only the 5 that returned ≥3 articles: `startup funding`, `quick commerce`, `AI startup`, `D2C brand`, `climate tech` | 25 sources total; 5 requests per ingest run (15/week) |
| Medianama → ET Small Biz | User asked to replace Medianama (HTTP 403 to Vercel's servers, though it works from a home connection) with a spare that works | Spares were tested **from Vercel `sin1`** via a throwaway preview deployment (Medianama 403 reproduced; ET Small Biz, HT Business, NDTV Profit, TechCrunch Startups all 200). ET Small Biz chosen: Indian and closest to the startup beat. Lesson: probe feeds from the deployment region, not locally |

## Answered in Phase 3 (2026-10-12)

| Topic | Decision | Notes |
|---|---|---|
| Duplicate thresholds | **Calibrated rule** replaces the documented one: ≥0.85; or ≥0.60 + 1 distinctive shared entity; or ≥0.30 + 2 distinctive shared entities | Calibrated on 509 real articles (~130k pairs). vs the doc rule: +~20 true duplicates caught, −3 false alarms. Evidence and rationale in `05-INTEGRATIONS.md` §2. `DOC_RULE` kept in code for comparison |

## Open

- [x] Feed list approval (Phase 2: 20 RSS + 5 GNews)
- [ ] Sender: custom domain or `onboarding@resend.dev` (Phase 7)
- [ ] `content/style-guide.md` filled by the user (before Phase 4)
- [ ] Confirm `DEMO_MODE` defaults to `true` when unset (see Deviations)
- [ ] Map text: "Thu 8 AM" → "Thu 7:30–8:30 AM IST" (user edits the workbook)
- [x] GNews starter queries replaced (Phase 2)
- [ ] Rotate keys before submission (see "Secrets location")

## VERIFY log

Checked against official provider docs on 2026-10-12.

| Item | Finding | Date |
|---|---|---|
| Vercel cron: min interval and precision on Hobby | Once per day per job; fires anywhere within the scheduled hour; up to 100 jobs/project; best-effort delivery (may be missed or delivered twice, no retries, no redirects followed); GET; `Authorization: Bearer <CRON_SECRET>` sent when the env var is set | 2026-10-12 |
| Vercel function max duration on Hobby | 300 s default and maximum (Fluid compute, now the default) | 2026-10-12 |
| Current Gemini Flash model ID | Stable: `gemini-3.8-flash` (new stable), `gemini-3.6-flash`. Flash-Lite (separate variant): `gemini-3.5-flash-lite`, `gemini-3.1-flash-lite`. `gemini-2.5-*` limited to past users. Interactions API is now recommended; generateContent is legacy but fully supported | 2026-10-12 |
| Gemini free-tier rate and daily limits | Not published in the docs, only shown per key in AI Studio. 3.8-flash is "free of charge" on the free tier. Check in Phase 4 with the new key | 2026-10-12 |
| GNews free-tier quota, delay, params | 100 req/day (resets 00:00 UTC, then 403), ≤10 articles/request, 12 h delay, 30 days history, non-commercial only. `GET /api/v4/search` with `q, lang, country, max, from, to, sortby, apikey` | 2026-10-12 |
| GNews query behaviour (observed) | 3+ word queries → 0–2 results; 1–2 word queries + `country=in` → 10 Indian results across a date range; `sortby=publishedAt` only covers the newest 1–2 days of a range, `relevance` spreads. Details in `05-INTEGRATIONS.md` §1 | 2026-10-12 |
| Neon Postgres version | 18.6; `gen_random_uuid()` native, extensions installed by migration 0000 | 2026-10-12 |
| Resend free-tier daily/monthly caps | 100/day, 3,000/month | 2026-10-12 |
| Resend batch size and rate limit | Batch ≤100 emails per call (≤50 `to` each, no attachments); 10 req/s per team; `Idempotency-Key` supported on batch (≤256 chars, 24 h) | 2026-10-12 |
| Resend test addresses and webhook event names | `delivered@`, `bounced@`, `complained@resend.dev` (+label OK), new `suppressed@resend.dev`; events `email.delivered`, `email.bounced`, `email.complained`, `email.delivery_delayed` (+ `email.failed`, `email.suppressed`); Svix headers `svix-id`, `svix-timestamp`, `svix-signature` over the raw body. `resend.dev` sender delivers only to the account owner | 2026-10-12 |
| Neon region options vs Vercel region | Neon AWS regions: us-east-1/2, us-west-2, eu-central-1, eu-west-2, ap-southeast-1 (Singapore), ap-southeast-2, sa-east-1; no India region. Vercel Hobby: one selectable function region, default `iad1`. Chosen: Singapore + `sin1`. `pg_trgm`, `citext`, `pgcrypto` supported. Free: 100 CU-h, 1 GB/project, scale-to-zero after 5 min | 2026-10-12 |
| Next.js version | 16.4.0 (released 2026-10-06; a security patch is announced for 2026-10-14 — upgrade when it ships). `runtime='edge'` deprecated; `runtime`/`dynamic`/`revalidate` are rejected under Cache Components | 2026-10-12 |

## Deviations from docs

| Date | Deviation | Reason |
|---|---|---|
| 2026-10-12 | `cacheComponents` and `partialPrefetching` turned **off** in `next.config.ts` (create-next-app 16.4 enables them by default) | Next 16 rejects `export const runtime = 'nodejs'` under Cache Components, and `02-ARCHITECTURE.md` §4 requires it on every route. The dashboard reads live Neon data per request, which Cache Components would force into Suspense/`'use cache'` boundaries. Anti-rework rule 4: take the docs' way |
| 2026-10-12 | `@types/node` ^24 instead of the scaffold's ^20; `engines.node = 24.x` | Vitest 5 requires `@types/node` ≥22; local and Vercel runtime are both Node 24 |
| 2026-10-12 | `DEMO_MODE` defaults to `true` when unset or blank | Docs are silent on the default. Fail-safe: a missing env var can never mass-send. Only the literal `false` disables it. Awaiting user confirmation |
| 2026-10-12 | No `date-fns`/`date-fns-tz` | Listed as optional. IST is a fixed UTC+05:30 with no DST, so `lib/time.ts` uses exact offset arithmetic |
| 2026-10-12 | Issue window made contiguous; send cron `0 3 * * 4` → `0 2 * * 4` | User decisions above; `01-PRODUCT-SPEC.md`, `02-ARCHITECTURE.md`, `05-INTEGRATIONS.md` updated |
| 2026-10-12 | Vitest config is `vitest.config.mts` | Vite warned that an ESM `.ts` config loaded as CommonJS breaks under its upcoming native config loader |
| 2026-10-12 | `npm audit` shows 5 high-severity issues in **dev-only** lint tooling (`braces`); production dependencies report 0 | The fix requires breaking `--force` upgrades of the ESLint toolchain. Not shipped to production; revisit when `eslint-config-next` updates |
| 2026-10-12 | `lib/dedupe/canonical.ts` and `normalize.ts` built in **Phase 1** instead of Phase 3 | Seeded past-issue articles store `canonical_hash`/`title_norm`; a stopgap version would leave stale hashes that silently break the Last-4 exact-hash check. Phase 3 keeps `engine.ts`, `history.ts` and the classification tests |
| 2026-10-12 | `extractEntities`: name phrases break at punctuation (comma not between digits), mixed-case brands ("byteXL") count as names, number entities keep only currency + digits (units dropped, unit words stop-listed) | Found on real seed titles: "Elevar Equity, Kalaari Capital" became one unmatchable entity; "₹2,500 crore" vs "Rs 2,500 Cr" differed. Covered by unit tests |
| 2026-10-12 | Seed builder rejects non-business titles and same-issue near-duplicates (2+ shared name/number words) | Raw GNews results included TV-series reviews and the same funding round from two outlets in one issue |
| 2026-10-12 | Migrations run through `scripts/migrate.ts` (drizzle migrator over Neon's **direct** host), not `drizzle-kit migrate` | Neon recommends the non-pooled connection for schema changes; the pooled `DATABASE_URL` stays the app's connection |
| 2026-10-12 | DB integration tests in a separate suite (`npm run test:db`) | `08-TESTING` requires unit tests to be network-free; the "trigram query works in a test" check needs the real database |
| 2026-10-12 | **ingest idempotency is per IST day**, not per issue (other jobs stay per issue). A run started in the last 10 min with no finish time also blocks (in-flight guard) | Mon, Tue and Wed ingest all collect for the same issue; a per-issue rule would skip Tue/Wed. Vercel cron may double-deliver, hence the in-flight check. `?force=1` (still needs the bearer secret) bypasses |
| 2026-10-12 | RSS is fetched with `fetch` (8 s `AbortSignal` timeout, bot User-Agent) and parsed with `rss-parser.parseString` | Gives a hard per-feed timeout and readable HTTP errors; `rss-parser.parseURL` has no abortable timeout |
| 2026-10-12 | `pipeline_runs.trigger` = `cron` when the request's User-Agent starts with `vercel-cron`, else `manual` | Vercel Cron identifies itself by User-Agent; the bearer secret alone can't tell a cron call from a manual curl |
| 2026-10-12 | `npm run seed` **syncs** sources to `content/sources.seed.json` (insert new, delete unreferenced unlisted, pause referenced unlisted) | The original seed only inserted, so 11 dead feeds and 10 retired queries would have stayed active |
| 2026-10-12 | Last-4 matching runs in JS with a `pg_trgm` port; within-window matching stays in SQL | Last-4 compares normalised *edited headlines*, which exist only after JS normalisation. Parity with Postgres is integration-tested (< 1e-6 on 200 real pairs) |
| 2026-10-12 | Within-window matching compares against all already-classified articles of the issue, not only earlier-published ones | GNews delivers with a 12 h delay, so an older article can arrive after a newer copy. `duplicate_of` still points to the cluster root of the earliest match, and `pickRepresentatives` picks the earliest-published member anyway |
| 2026-10-12 | SQL prefilter `title_norm % $1` uses pg_trgm's default threshold 0.3, which is strict (`>`) | Pairs scoring exactly 0.300 are excluded; immaterial in practice and keeps the GIN index usable over the Neon HTTP driver (no session `SET`) |
| 2026-10-12 | Dedupe runs inside every ingest (after inserts), so articles are classified on arrival | Curate (Phase 4) only reads `candidate` representatives; `classifyNewArticles` is idempotent (touches only `new` rows) and can also be called by curate |

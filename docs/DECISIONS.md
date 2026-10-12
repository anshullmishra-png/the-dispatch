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

## Open

- [ ] Feed list approval (Phase 2, after `probe-sources`)
- [ ] Sender: custom domain or `onboarding@resend.dev` (Phase 7)
- [ ] `content/style-guide.md` filled by the user (before Phase 4)
- [ ] Confirm `DEMO_MODE` defaults to `true` when unset (see Deviations)
- [ ] Map text: "Thu 8 AM" → "Thu 7:30–8:30 AM IST" (user edits the workbook)

## VERIFY log

Checked against official provider docs on 2026-10-12.

| Item | Finding | Date |
|---|---|---|
| Vercel cron: min interval and precision on Hobby | Once per day per job; fires anywhere within the scheduled hour; up to 100 jobs/project; best-effort delivery (may be missed or delivered twice, no retries, no redirects followed); GET; `Authorization: Bearer <CRON_SECRET>` sent when the env var is set | 2026-10-12 |
| Vercel function max duration on Hobby | 300 s default and maximum (Fluid compute, now the default) | 2026-10-12 |
| Current Gemini Flash model ID | Stable: `gemini-3.8-flash` (new stable), `gemini-3.6-flash`. Flash-Lite (separate variant): `gemini-3.5-flash-lite`, `gemini-3.1-flash-lite`. `gemini-2.5-*` limited to past users. Interactions API is now recommended; generateContent is legacy but fully supported | 2026-10-12 |
| Gemini free-tier rate and daily limits | Not published in the docs, only shown per key in AI Studio. 3.8-flash is "free of charge" on the free tier. Check in Phase 4 with the new key | 2026-10-12 |
| GNews free-tier quota, delay, params | 100 req/day (resets 00:00 UTC, then 403), ≤10 articles/request, 12 h delay, 30 days history, non-commercial only. `GET /api/v4/search` with `q, lang, country, max, from, to, sortby, apikey` | 2026-10-12 |
| Resend free-tier daily/monthly caps | 100/day, 3,000/month | 2026-10-12 |
| Resend batch size and rate limit | Batch ≤100 emails per call (≤50 `to` each, no attachments); 10 req/s per team; `Idempotency-Key` supported on batch (≤256 chars, 24 h) | 2026-10-12 |
| Resend test addresses and webhook event names | `delivered@`, `bounced@`, `complained@resend.dev` (+label OK), new `suppressed@resend.dev`; events `email.delivered`, `email.bounced`, `email.complained`, `email.delivery_delayed` (+ `email.failed`, `email.suppressed`); Svix headers `svix-id`, `svix-timestamp`, `svix-signature` over the raw body. `resend.dev` sender delivers only to the account owner | 2026-10-12 |
| Neon region options vs Vercel region | AWS us-east-1 (N. Virginia) chosen, next to Vercel `iad1`. No India region (nearest Singapore). `pg_trgm`, `citext`, `pgcrypto` supported. Free: 100 CU-h, 1 GB/project, scale-to-zero after 5 min | 2026-10-12 |
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

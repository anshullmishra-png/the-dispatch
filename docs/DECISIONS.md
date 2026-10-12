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

## Answered in Phase 4 (2026-10-12)

| Topic | Decision | Notes |
|---|---|---|
| Style guide authorship | **AI-generated with the user's explicit permission** (replaces "the user writes it"); `CLAUDE.md` §4 amended to say so | Persona and rules extend the template's starter defaults; 14 more "Never say" entries; 4 examples built from real seed-issue headlines + their real GNews snippets (trimmed to the sentences the commentary uses), each commentary checked to use only facts in its own snippet; one anti-example. 995 words, a little over the template's soft ~900 |
| Gemini model | **`gemini-3.6-flash`** (replaces `gemini-3.8-flash`) | 3.8 failed 4/4 on the new key (2× 50 s timeout, 2× 503); 3.6 succeeded first try in 6.3 s. Both are stable *Flash* models |
| Gemini fallback | `GEMINI_FALLBACK_MODELS=gemini-3-flash-preview`; attempts rotate primary ↔ fallback on one backoff schedule; run stats record the model that wrote the draft | First real curate: 3.6 returned 503 on all 4 full-size (~9.9k-token) attempts, from Vercel and locally, while a tiny prompt worked; `gemini-3-flash-preview` returned a valid 10 + 5 draft in 27.6 s. Flash-Lite deliberately not in the chain ("Gemini Flash" requirement) |
| Candidate trimming | Spread the 80 slots evenly across IST days, ≤6 per outlet, newest first within a day | The doc's newest-first rule would have covered only ~10–12 h of the week |
| Prompt tightening (option B) | Rules 8 + 11 added (attribution, no inflation, no funding stages not in the source, sentence 1 must not restate the headline, Indian spelling) | Re-run comparison: inflation and spelling fixed, openings partly improved; **"Series C" still invented** (flagged) and two unsupported generalisations appeared. Conclusion: the prompt reduces but cannot eliminate embellishment; the grounding flags plus Shreya's per-story review are the safeguard |
| Gemini thinking level | `GEMINI_THINKING_LEVEL=LOW` (env, default LOW) | Same full prompt on `gemini-3-flash-preview`: default thinking → 503 (and 27.6 s / timeouts on Vercel earlier); LOW → valid 10 + 5 draft in 13.6 s, all validator rules passing. Quality is still guarded by validation, re-prompts and Shreya's review |

Deviations recorded in Phase 4: short candidate ids (`a01`…) mapped to UUIDs; strict schema to Gemini but lenient parse; retries = 3 after the first attempt (the docs say both "3 attempts" and "retry 3×" with three delays — the three delays decide it); curate refuses only below 8 candidates (docs/02 §8: still run on a thin batch); voice lint also errors on `!` (style guide: "No exclamation marks"); validator `LAST_FOUR_HIT` = the dedupe rule **or** the doc's "≥0.5 similarity + entity overlap"; invalid fixtures derived in code; `extractEntities` now also breaks name phrases at a sentence-ending period (found in live commentary; titles barely affected, all dedupe tests unchanged); grounding lint ignores a capitalised sentence-opening word before a name but still flags mid-sentence inventions ("Series C").

## Phase 5 (2026-10-12)

| Topic | Decision | Notes |
|---|---|---|
| State machine detail | Exact event table written into `02-ARCHITECTURE.md` §6 ("As implemented") | Adds what the intent table left implicit: curate may replace a draft in review or on hold; `edit` is a no-op except on a confirmed issue; Hold is allowed from DRAFTING too |
| notify guard | Valid draft **or** `needs_attention` | docs §8 says a thin draft is created and flagged so Shreya can act; the strict guard would have stranded it |
| Card hash | Confirm buttons carry an 8-char hash prefix (64-byte callback limit, docs/05 §3); compared with `startsWith` | |

## Open

- [x] Feed list approval (Phase 2: 20 RSS + 5 GNews)
- [ ] Sender: custom domain or `onboarding@resend.dev` (Phase 7)
- [x] `content/style-guide.md` filled (AI-generated with permission, Phase 4)
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
| 2026-10-12 | Telegram: an edit is accepted as the next plain text message too, not only as a reply to the force-reply prompt | Telegram Desktop sometimes drops the reply link. Only one edit can be pending per chat and it expires after 30 min |
| 2026-10-12 | Telegram: one live summary card. After an Edit or Swap the summary is re-posted at the bottom and the old one loses its buttons; stale taps get "out of date" + a fresh card | Keeps Confirm next to the latest state. The stale-card guard (hash prefix) still protects any card left behind |
| 2026-10-12 | `telegram_pending.pending_text` column (migration 0002) and a `u:<story8>` "Use anyway" callback | docs/05 §3 asks for an override when voice lint fails; the rejected text must be kept until she taps it. The override is logged in `approvals.detail.lintOverride` |
| 2026-10-12 | `/status` bot command re-posts this week's summary card | Recovery path when the chat scrolls away; read-only |
| 2026-10-12 | Swap marks the swapped-out article `rejected` | A forced re-curate then never re-picks a story Shreya removed |
| 2026-10-12 | Unedited commentary is stored as `style_examples` (similarity 1.0) at Confirm, replaced on re-confirm; an edit stores one row per story (a re-edit replaces it) | docs/04 §11; avoids double-counting in the voice-match metric |
| 2026-10-12 | "Send now" (`n:<issue8>`) shown only on a confirmed issue whose Thursday has arrived (IST) | After the Thursday job holds an issue the next scheduled send is a week away. It runs `runSend` through the same gate |
| 2026-10-12 | Send claims batches with one `INSERT ... SELECT ... ON CONFLICT DO NOTHING RETURNING` instead of `FOR UPDATE SKIP LOCKED` | The unique `(issue_id, subscriber_id)` row is the lock: overlapping runs can never claim the same subscriber, and it works over the Neon HTTP driver |
| 2026-10-12 | Demo mode really sends to `SEND_ALLOWLIST` plus Resend's `delivered@`/`bounced@`/`complained@resend.dev` (approved test inboxes) | Their real webhook events prove R16 end to end |
| 2026-10-12 | Resend idempotency key = `<issueId>-<contentHash12>-b<batch>` (was `<issueId>-b<batch>`) | Found in the Phase 9 rehearsal: after a reset, batch 1 reused a key with a different body and Resend refused it. The content hash keeps retries deduped and new content distinct |
| 2026-10-12 | `assertSendAllowed({resuming})` accepts `SENDING` for a resumed send; every other guard still applies | A send that runs out of time must be able to continue; unit-tested |
| 2026-10-12 | Resend webhook created by `scripts/resend-webhook.ts` through the Resend API (no dashboard step); Svix verification written with `node:crypto` | Only `lib/mail/send.ts` may import the Resend SDK; no extra dependency |
| 2026-10-12 | Web subscribers are stored `active` (source `web`), no double opt-in | The free `resend.dev` sender can't mail anyone but the owner, so a confirmation email needs a verified domain. Demo mode means they get nothing real anyway. Honeypot field against bots |
| 2026-10-12 | Landing marquee `clamp(44px, 16vw, 304px)` (doc: `clamp(72px, 18vw, 304px)`) | 72 px made "DISPATCH" overflow the frame at 375 px wide |
| 2026-10-12 | Dashboard admin strip (Run now / simulate buttons) not built; `POST /api/admin/run/[job]`, `/api/admin/simulate` and `npm run demo:week` cover it | Time; the demo does not need an admin cookie flow |
| 2026-10-12 | `npm run demo:week -- --reset` resets this week's issue to COLLECTING (keeps articles; drops draft, reviews, send log) | The 15 Oct issue was already sent by the Phase 7 test; a rehearsal needs a fresh draft on live data. `--auto-confirm` taps Approve all + Confirm as Shreya through the signed webhook |
| 2026-10-12 | The "second Telegram account is ignored" check is automated (unit test + `npm run e2e:telegram` posts as a stranger) | The user has no second account |

## Phases 6–10 (2026-10-12)

| Item | Decision |
|---|---|
| Telegram bot | `@thedispatchdesk_bot`, new (not the Skinstinct bot). `SHREYA_TG_USER_ID` = `SHREYA_TG_CHAT_ID` = the user's id from `/start` |
| Manual phone test | User asked to automate testing because of the 11 PM deadline: `npm run e2e:telegram` (17 checks) and `npm run e2e:send` (21 checks) run against production; the user's own taps (Keep, Approve all, Confirm) were also logged |
| Resend | Account on `anshullmishra@gmail.com`, full-access key, sender `onboarding@resend.dev` (no domain) |
| Stop after each phase | Replaced by "complete all phases, test once done" (user, Phase 6) |
| Web app visibility (after review against the brief) | Added `/articles` (article library with status, duplicate match + similarity, Last-4 match, filters, search), dashboard draft panel (picks with signal, rationale, flags, review state), pipeline strip (last ingest, next job from `vercel.json`, failing/paused feeds, eligible stories), delivery history, `/style-guide`. **No web editor**: Telegram stays the only control surface, so there is one approval path |
| Draft visibility | **Public**, labelled "Draft — not yet confirmed" (user chose option a) |
| Evidence on the dashboard (after a second review against the brief) | Live send gate (the 6 checks for this issue), week timeline, audit trail of every review action, send attempts from `pipeline_runs` (survive demo resets, include held runs), delivery-mode panel explaining the synthetic list, list-hygiene panel with recent Resend events, per-pick voice and Last-4 check computed live, `/preview` (exact email HTML), and a public headline checker (`/api/dedupe-check`, read-only) running the ingest dedupe rule. DEMO_MODE stays on: the free sender can only reach the owner and the list is synthetic |
| Editor-first web app (user, after a third review) | `/desk` is Shreya's workspace: three separate states (her review · scheduled delivery · delivery outcome), what needs her attention, every story with "why", fact flags and voice check, alternatives, collapsed swapped/removed list, email preview. `/dashboard` became `/status` (engineering evidence). Telegram login (`/web`) and live web tests skipped by the user |
| Desk editing | Keep, Edit (voice lint + "use anyway"), Swap (best alternative or a chosen backup), Remove, Keep all, Confirm (with the page's hash prefix, so a stale page can't confirm), Hold. Same `lib/approval/review.ts` functions, audit trail and send gate as Telegram, acting as `SHREYA_TG_USER_ID`; Telegram cards are refreshed after each web action. **Open to every visitor** (user decision, so examiners can try it; the passcode gate was built then removed). Risk accepted: anyone with the URL can edit or confirm as Shreya. Mitigations: demo mode limits real mail to the allowlist, every action is in the audit trail, a confirm still needs no pending stories and the current content hash, and Thursday's gate checks the same six conditions |
| Shreya-only app (user, agreeing with a product review) | The app is Shreya's editorial desk: `/` redirects to `/desk`. The subscriber landing page, the subscribe form and `/api/subscribe` (X9) are removed: subscribers are recipients of the email, not users of the app. `/unsubscribe` stays (email recipients need it, R15). Navigation: Desk · Archive · Articles · Settings & status. The desk shows plain-language alerts when a job's latest run failed; `/status` separates rehearsal sends from scheduled ones and no longer duplicates the picks |
| Desk hierarchy (user answers, same Trattoria theme) | One page. Hero: italic eyebrow "Weekly edition · date", greeting + one-sentence state in the 48 px section heading, one-line summary, **one primary action** for the state (review open stories / confirm / preview), quiet secondary links (keep all, hold). The three states became one thin ruled row that turns red only when action is needed. Alerts appear only when something is wrong. Story rows: Keep stays visible while pending; edit / replace / remove sit behind one "Change" link; voice and last-4 checks show only when they fail; fact flags always show |
| Issue window and the Wednesday gap (user, 2026-10-12) | Found: with a Thu 00:00 → Wed 23:59 window and the last ingest at Wed 08:30, news from Wed ~9 AM to midnight reached no issue (Monday's run treated it as out of window). Now the window runs **Wed 13:30 IST → next Wed 13:29:59 IST** (`WINDOW_CUTOFF`), an extra ingest runs Wed 13:30–14:29 just before curate (`?slot=precurate`, blocked only by a run in the last 3 h), and anything published after the cutoff goes to next week. The 15 Oct issue is the transition week (Thu 8 Oct 00:00 → Wed 14 Oct 13:29). Ingest still runs only Mon–Wed |
| RSS depth | 100 items per feed (was 40), so Monday's run still reaches the previous Wednesday afternoon on busy feeds. Observed for 15 Oct: Thu 65, Fri 160, Sat 101, Sun 79 articles collected on Monday |
| Flags after review changes | ⚠ flags (grounding, voice warnings, repeated openings) are recomputed for every live pick after an edit, swap or remove, so a fixed problem disappears and a new one shows (was: computed once at curate) |
| Reminder time vs "by Wednesday 10 PM" | Two daily remind crons (21:30–22:29 and 22:30–23:29 IST). The route skips if it runs before 22:00 IST (`reminderDeadline`), so the first check at or after 10 PM sends the reminder and the second is a fallback. On Hobby the reminder therefore lands between 22:00 and 23:29, never before the deadline. Earlier version: one cron at 22:30–23:29 only |
| Remove story | Added to Telegram (`r:<story8>`, 🗑 Remove on its own row). Allowed only if ≥8 stories and ≥3 topics remain; later stories renumber; the article becomes `rejected`; audited as `approvals.action='remove'` (migration 0003). Stored as `SWAPPED_OUT` with no replacement, so no enum change |


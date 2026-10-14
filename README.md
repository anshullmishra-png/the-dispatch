# The Dispatch — Newsletter Intelligence Engine

An automated pipeline for Shreya's weekly newsletter on the Indian startup ecosystem
(Problem Statement 17, MESA Cohort C4 — AI and its Applications).

- **Live app:** https://the-dispatch-pi.vercel.app opens Shreya's desk. The app is for her, the editor; subscribers only receive the email (and its unsubscribe page)
  - [Editor's desk](https://the-dispatch-pi.vercel.app/desk): Shreya's workspace. Her review, the scheduled delivery and the actual delivery outcome as three separate states; what needs her attention; every story with Gemini's reason, fact flags and voice check; alternatives; email preview. Keep, edit, swap, remove and confirm work here too: the same backend, audit trail and send gate as Telegram, and her Telegram cards update. **Open for the demo** (no sign-in), so anyone can try it; demo mode keeps real mail to the allowlist
  - [Settings & status](https://the-dispatch-pi.vercel.app/status): editorial voice, sources, Telegram, schedule, then issue status, pipeline strip (last ingest, next job, feed health), this week's picks with signal tag, rationale, ⚠ flags and review state, topic and subscriber bars, voice match, delivery history, run log, sources
  - Also on the dashboard: the **live send gate** (all six checks for this week's issue), a week timeline, the **audit trail** of every Telegram review action, every send attempt including those the gate held, the delivery-mode and list-hygiene panels, and [the email preview](https://the-dispatch-pi.vercel.app/preview)
  - [Articles](https://the-dispatch-pi.vercel.app/articles): every article collected this week and what the pipeline decided (duplicate of which story and how similar, seen in which past issue, candidate, picked, removed), with filters and search, plus a **"Check a headline"** box that runs the real dedupe rule against this week and the last four issues
  - [Archive](https://the-dispatch-pi.vercel.app/issues) and issue pages, [style guide](https://the-dispatch-pi.vercel.app/style-guide), [health](https://the-dispatch-pi.vercel.app/api/health)
- **Editor bot:** Telegram `@thedispatchdesk_bot` (answers only Shreya's Telegram id)
- **Components Map:** [`docs/Components-Map.xlsx`](docs/Components-Map.xlsx)

## What it does

| When (IST) | Job | What happens |
|---|---|---|
| Mon–Wed 08:30, Wed 13:30 | ingest | 20 RSS feeds + 5 GNews queries; every article stored once (canonical-URL hash), near-duplicates and stories from the last four issues marked. Each issue covers news published Wed 13:30 → next Wed 13:30 IST, so nothing falls between weeks; Thursday–Sunday news is fetched on Monday (up to 100 items per feed) |
| Wed 14:30 | curate | One Gemini Flash call over the week's candidates picks 8–10 stories across ≥3 topics, each with a signal tag, a rationale and 2–3 sentences in Shreya's voice. Code validates, re-prompts, repairs; a grounding lint flags unsupported numbers/names |
| Wed 17:30 | notify | Header, one card per story (✅ Keep · ✏️ Edit · 🔄 Swap · 🗑 Remove · 🔗 Read) and a final card (Approve all · Confirm · Hold) on Telegram |
| Wed 22:00+ | remind | One reminder, only if still unconfirmed at 10 PM: two checks (21:30–22:29, 22:30–23:29); one that runs before 10 PM sends nothing |
| Thu 07:30 | send | **Only if Shreya confirmed** and nothing changed since: HTML + text email via Resend in batches of 100. Otherwise the issue is held and Shreya is alerted |
| any time | webhooks | Telegram taps update stories; Resend bounce/complaint events and one-click unsubscribes update the list |

**The system never sends without Shreya's confirmation.** `sendIssue()` is the only code that sends mail and its first line is `assertSendAllowed()`: status `CONFIRMED`, confirmed by Shreya's Telegram id, a matching `confirm` approval, the content hash unchanged since, and not already sent. Any edit after Confirm resets the issue to review. Gemini has no send path.

## Architecture

```
 RSS ×20 ─┐                                     ┌─ Telegram (Shreya) ── keep / edit / swap / confirm / hold
 GNews ×5 ─┼─ ingest ─ dedupe ─ curate (Gemini) ─┤                                │
           │     Neon Postgres (articles, issues, stories, approvals, runs)      ▼
           └──────────────────────────────────────── send gate ── Resend ── subscribers
 Vercel Cron (5 jobs) · Next.js 16 on Vercel (sin1) · Neon (Singapore) · public site + dashboard
```

Full components map, routes and state machine: [`docs/02-ARCHITECTURE.md`](docs/02-ARCHITECTURE.md).

Stack: Next.js 16 (App Router, TypeScript strict) on Vercel Hobby · Neon Postgres 18 + Drizzle · Gemini Flash (`@google/genai`, `gemini-3.6-flash` with `gemini-3-flash-preview` fallback) · RSS + GNews · Telegram Bot API (plain fetch) · Resend · Vitest. Everything runs on free tiers except Gemini, which was moved to Google's paid prepay tier after free-tier quota errors (still Gemini Flash).

## Setup

Requires Node 24, a Neon database, and keys for Gemini, GNews, Telegram and Resend (all free).

```bash
npm install
cp .env.example .env.local     # fill in; every variable is explained there and in CLAUDE.md §9
npm run db:migrate             # tables + pg_trgm/citext/pgcrypto in Neon
npm run seed                   # 25 sources, style guide, 4 past issues, 2,200 subscribers
npm run dev
```

After deploying (`vercel --prod`) and adding the same variables in Vercel:

```bash
curl -X POST -H "x-admin-token: $ADMIN_TOKEN" $APP_URL/api/admin/telegram-setup   # point the bot's webhook here
npx tsx scripts/resend-webhook.ts                                                 # create the Resend webhook, store its secret
```

Send `/start` to the bot, put the two ids it replies with in `SHREYA_TG_USER_ID` / `SHREYA_TG_CHAT_ID`, redeploy.

| Script | What it does |
|---|---|
| `npm run check` | typecheck + lint + 264 unit tests (no network) |
| `npm run test:db` | 27 integration tests against Neon (disposable issues, cleaned up) |
| `npm run e2e:telegram` | 17 checks against the **deployed** Telegram webhook (posts as Shreya and as a stranger) |
| `npm run e2e:send` | 21 checks against production: gate holds an unconfirmed issue, demo-mode send, no double send, unsubscribe, signed + real Resend events |
| `npm run demo:week` | A whole week in ~90 s on production: ingest ×3 → curate → notify → confirm → remind → send (`-- --reset`, `-- --auto-confirm`) |
| `npm run probe` | Check every RSS feed (`-- --gnews` also checks queries) |
| `npm run seed` / `seed:issues` | Re-runnable seed / rebuild seed issues from GNews |
| `npm run db:generate` / `db:migrate` | Migrations |

## Environment variables

All in [`.env.example`](.env.example). `GET /api/health` shows which integrations are configured (booleans only). Secrets live only in `.env.local` (git-ignored) and Vercel's environment; none are in the repo or the client bundle.

`DEMO_MODE` defaults to **true**: only `SEND_ALLOWLIST` and Resend's test inboxes get real mail; every other subscriber is logged `skipped_demo`, so the 2,200-row batch logic still runs in full.

## How to try it (5 minutes)

1. **Desk.** Open the URL: this week's issue, her three states (review · scheduled delivery · outcome), what needs attention, the picks with Gemini's reasons. Then Articles (filter "Duplicates", try "Check a headline") and Settings & status (send gate, audit trail, runs).
2. **Week on demand.** `npm run demo:week -- --reset` — ingest ×3 (second and third add 0 new: R2), curate (8–10 picks, ≥3 topics, signal tags, flags: R4–R8).
3. **Telegram.** Cards arrive on the phone. Keep one, Edit one (a one-sentence edit is caught by the voice check), Swap one (a backup takes its place, no AI call), Remove one (refused if it would leave fewer than 8 stories or 3 topics). Confirm while a story is pending → refused. Approve all → Confirm (R9–R11). The script waits for the Confirm.
4. **Control proof.** Edit after confirming → "please confirm again", status back to review (R12, X2).
5. **Gate.** `npm run e2e:send` on an unconfirmed issue: send job holds it, no email, Telegram alert (R12).
6. **Send.** Email arrives in the allowlisted inbox; dashboard shows sent / skipped_demo for 2,200 rows (R14).
7. **Hygiene.** Unsubscribe link (confirmation page, then one-click); Resend's real bounce for `bounced@resend.dev` marks it bounced; next send skips both (R15, R16, X6).
8. **Voice metric.** Dashboard "Voice match": % of commentary accepted unedited (X5).

Fallback if a free tier runs out: `GEMINI_MOCK=true` runs curate from a fixture; earlier live runs are in the dashboard's run table.

## Requirements → evidence

| Req | Where it's met | Proof |
|---|---|---|
| R1 20+ sources | `content/sources.seed.json`, `lib/collect` | 25 active sources on the dashboard |
| R2 no duplicates in a week | canonical hash + trigram/entity rule (`lib/dedupe`) | second ingest inserts 0; "duplicates caught" on the dashboard |
| R3 / R6 not in last 4 issues | `lib/dedupe/history.ts`, validator `LAST_FOUR_HIT` | unit tests; `seen_before` status |
| R4 8–10 picks · R5 signal · R7 ≥3 topics | `lib/curate/validate.ts` (8 violation codes), re-prompt + repair | live drafts: 9 picks, 6–7 topics |
| R8 2–3 lines in her voice | `content/style-guide.md`, voice lint | lint unit tests; flags on cards |
| R9–R11 Telegram review + confirm | `lib/telegram`, `lib/approval/review.ts` (also used by the web desk) | `e2e:telegram` 18/18 |
| R12 never sends autonomously | `assertSendAllowed`, `runSend` | 6 guard unit tests, DB tests, `e2e:send` |
| R13 reminder | `/api/cron/remind` | sends only while `IN_REVIEW` (e2e) |
| R14 email Thursday | `lib/mail`, `/api/cron/send` | email in the allowlisted inbox; send_log counts |
| R15 unsubscribe · R16 bounces | `/api/unsubscribe`, `/api/webhooks/resend`, `lib/subscribers/hygiene.ts` | `e2e:send` incl. Resend's real events |
| R17 Gemini Flash only | `lib/ai/gemini.ts` | no other AI SDK in `package.json` |
| R18 Vercel public URL · R19 live data · R20 deliverables | this README | URL, repo, Components Map |

## Design decisions (FAQ)

| Question | Answer |
|---|---|
| Where is the editorial judgment? | Gemini proposes and explains (signal tag + rationale); Shreya keeps, edits or swaps each story and confirms. A code gate blocks sending without her confirmation. |
| How do you stop duplicates? | Unique canonical-URL hash, trigram title similarity with distinctive-entity overlap (thresholds calibrated on 509 real articles), and a Last-4 check before and after Gemini. |
| What stops hallucinated commentary? | The prompt restricts facts to title and snippet; a grounding lint flags numbers and names not in the source (shown as ⚠ on the card); Shreya reviews every line. It reduces embellishment but can't eliminate it, which is why review is mandatory. |
| Can the AI send mail? | No. Gemini only returns JSON. Only `sendIssue()` sends, after `assertSendAllowed()` (tested). |
| What if she forgets to confirm? | Reminder Wednesday night; Thursday's job holds the issue and alerts her instead of sending. "Send now" appears once she confirms. |
| Bounces and unsubscribes? | One-click `List-Unsubscribe` + a confirmation page; Resend's Svix-signed webhooks mark bounced/complained; send claims only `active` subscribers. The brief says "Gmail bounces"; we use Resend's webhooks. |
| Why Resend, not Gmail? | Free, webhook bounce events, works from serverless. Without a verified domain it delivers only to the account owner, hence the synthetic list and demo mode. |
| Why these cron windows? | Hobby runs each cron once a day, anywhere within its hour. The reminder has two checks (21:30–22:29 and 22:30–23:29 IST); a check that runs before 10 PM sends nothing, so the reminder arrives at the first check after the deadline and never early. |
| Is it live data? | Yes: RSS and GNews fetched at run time; the dashboard shows timestamps and counts. |
| Failures? | Per-feed timeouts, auto-pause after 5 failures, Gemini retries/backoff/model fallback/re-prompt/repair, idempotent crons (Vercel may double-deliver), resumable send, Telegram retry. |

## Known limits

- **Cron precision:** Hobby fires each job once a day, anywhere within its hour, best effort (a run can be missed or doubled; jobs are idempotent).
- **Free tiers:** GNews 100 requests/day with a 12 h delay; Resend 100 emails/day, 3,000/month. Gemini is on the paid prepay tier (after free-tier 429s); its overloads (503) still come in waves, handled by retry and a fallback Flash model.
- **Resend sender:** `onboarding@resend.dev` delivers only to the account owner, so the 2,200 subscribers are synthetic (`@example.invalid`) plus Resend test inboxes. A verified domain would lift this.
- **Spam folder:** with Resend's shared test sender, Gmail may file the issue under Spam (seen on 2026-10-12). Marking it "Not spam" fixes it for that inbox; a verified domain with SPF/DKIM fixes it for everyone.
- **Shreya's voice** in `content/style-guide.md` was AI-generated with the user's permission (CLAUDE.md §4); her real edits become few-shot examples over time.
- **Seed issues** (4 past issues) use real headlines with placeholder commentary; they exist to exercise the Last-4 check.
- **Grounding lint** is a heuristic: it can miss a paraphrased invention and occasionally flags a correct one.
- A send interrupted mid-batch leaves those rows `queued` (not retried automatically); the unique send_log row guarantees no one is mailed twice.
- No dashboard admin buttons or web editor (Telegram is the one control surface); use `POST /api/admin/run/[job]` or `npm run demo:week`.
- Gemini's free tier returned HTTP 429 after many curate runs on 2026-10-12, so the project moved to the paid prepay tier; overload waves (503) are still handled by retries and the fallback model, and `GEMINI_MOCK` is the fallback for a demo.

## Docs

| Doc | Contents |
|---|---|
| [`CLAUDE.md`](CLAUDE.md) | Constraints, stack, working rules |
| [`docs/01-PRODUCT-SPEC.md`](docs/01-PRODUCT-SPEC.md) | Requirements R1–R20 and acceptance checks |
| [`docs/02-ARCHITECTURE.md`](docs/02-ARCHITECTURE.md) | Components map, routes, schedule, state machine |
| [`docs/03-DATA-MODEL.md`](docs/03-DATA-MODEL.md) | Postgres schema |
| [`docs/04-AI-PROMPTS.md`](docs/04-AI-PROMPTS.md) | Gemini prompt, schema, validation |
| [`docs/05-INTEGRATIONS.md`](docs/05-INTEGRATIONS.md) | Feeds, dedupe, Telegram, Resend, Neon, Vercel |
| [`docs/06-DESIGN.md`](docs/06-DESIGN.md) | Trattoria broadsheet design system |
| [`docs/08-TESTING-DEMO-SUBMISSION.md`](docs/08-TESTING-DEMO-SUBMISSION.md) | Tests, demo script, submission checklist |
| [`docs/DECISIONS.md`](docs/DECISIONS.md) | User decisions, verified provider facts, deviations |
| [`CHANGELOG.md`](CHANGELOG.md) | What each phase delivered |

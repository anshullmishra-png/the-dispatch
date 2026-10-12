# 02 — Architecture

Mirrors `Newsletter_Agent_Components_Map.xlsx`. Six columns only: Trigger, Input, Context, Processing, AI, Output.

## 1. Components map (9 steps)

| # | Column | Actor | What happens |
|---|---|---|---|
| 1 | Trigger | Vercel Cron | Cron fires with no human: Mon–Wed collect, Wed 2:30 PM select. |
| 2 | Input | Backend | Pull 20+ RSS feeds + GNews queries. Store every article in Neon. |
| 3 | Context | Neon | Return last 4 issues, this week's articles, style guide (seeded). |
| 4 | Processing | Backend (code) | Dedupe by URL + title match within the week; drop anything in the last 4 issues. |
| 5 | AI | Gemini Flash | Pick 8–10 stories + 5 backups (high signal, ≥3 topics, none in last 4). Draft 2–3 lines each in Shreya's voice. |
| 6 | Output | Backend (code) | Validate the pick (count, topics, no repeats), re-ask Gemini if it fails. Save draft, send to Telegram Wed evening. |
| 7 | Output | Review gate (Shreya, Telegram) | Keep/edit/swap each story, then confirm. No confirm by 10 PM → reminder. |
| 8 | Output | Send gate (code) | Thu morning: passes only if status = `CONFIRMED` and content hash unchanged. Else hold + alert. |
| 9 | Output | Resend | Render HTML email with unsubscribe link, send. Bounce webhook + unsubscribes update Neon. |

Not drawn on the map (document in README): swap loop, edit-after-confirm loop, reminder cron, public pages, webhook return path.

## 2. Dependencies (only these)

`next`, `react`, `react-dom`, `typescript`, `zod`, `drizzle-orm`, `drizzle-kit`, `@neondatabase/serverless`, `@google/genai`, `rss-parser`, `resend`, `svix`, `vitest`, `eslint` (+ Next config), `tsx` (scripts). Optional: `date-fns` + `date-fns-tz` for IST math, `fast-xml-parser` only if `rss-parser` fails on a feed.

## 3. Folder structure

```
app/
  page.tsx                         landing (masthead, latest issue, subscribe)
  issues/page.tsx                  archive list
  issues/[slug]/page.tsx           web view of one sent issue
  dashboard/page.tsx               live pipeline dashboard (public read-only)
  unsubscribe/page.tsx             confirm page (GET shows form; POST/one-click handled by api)
  api/
    cron/ingest/route.ts
    cron/curate/route.ts
    cron/notify/route.ts
    cron/remind/route.ts
    cron/send/route.ts
    telegram/webhook/route.ts
    webhooks/resend/route.ts
    subscribe/route.ts
    unsubscribe/route.ts
    admin/run/[job]/route.ts       manual trigger, ADMIN_TOKEN
    admin/telegram-setup/route.ts  calls setWebhook
    admin/simulate/route.ts        simulate bounce/unsubscribe/confirm (DEMO only)
    health/route.ts
lib/
  time.ts                          IST helpers, issue date/window
  env.ts                           zod-validated env
  db.ts                            Neon + Drizzle clients
  log.ts                           structured logger with request id
  security.ts                      cron/admin auth, HMAC tokens, timing-safe compare
  collect/rss.ts
  collect/gnews.ts
  collect/index.ts                 runIngest()
  dedupe/canonical.ts              canonicalizeUrl(), hashUrl()
  dedupe/normalize.ts              normalizeTitle(), extractEntities()
  dedupe/engine.ts                 classifyArticle(), markDuplicates()
  dedupe/history.ts                loadLastFourSet()
  ai/gemini.ts                     generateJson(), retries, mock mode
  ai/prompts.ts                    system + user prompt builders
  ai/schemas.ts                    zod schemas for selection output
  curate/select.ts                 runSelection() orchestration
  curate/validate.ts               validateSelection()
  curate/lint.ts                   voiceLint(), groundingLint()
  curate/draft.ts                  persistDraft()
  approval/fsm.ts                  transition(), assertSendAllowed(), contentHash()
  telegram/api.ts                  tgCall(), sendMessage(), editMessage(), answerCallback()
  telegram/cards.ts                renderHeader/Story/Final/Reminder
  telegram/handlers.ts             onCallback(), onMessage() (keep/edit/swap/confirm/hold)
  mail/render.ts                   renderIssueHtml(), renderIssueText()
  mail/send.ts                     sendIssue() — the ONLY file importing Resend
  mail/tokens.ts                   signUnsubToken(), verifyUnsubToken()
  subscribers/hygiene.ts           applyBounce(), applyComplaint(), applyUnsubscribe()
  metrics.ts                       voice-fidelity %, pipeline stats for dashboard
content/
  style-guide.md
  topics.json
  sources.seed.json
db/
  schema.ts
  migrations/
  seed/past-issues.json
  seed/subscribers.ts
scripts/
  probe-sources.ts                 hit every feed, print working/broken
  seed.ts
  demo-week.ts                     scripted full-week demo
tests/
  *.test.ts
```

## 4. Routes

| Route | Method | Auth | Calls | Writes |
|---|---|---|---|---|
| `/api/cron/ingest` | GET | `CRON_SECRET` bearer | `runIngest()` | `articles`, `sources`, `pipeline_runs` |
| `/api/cron/curate` | GET | `CRON_SECRET` | dedupe finalize → `runSelection()` → `persistDraft()` | `issues`, `issue_stories`, `articles.status` |
| `/api/cron/notify` | GET | `CRON_SECRET` | Telegram send cards | `telegram_messages`, `issues.status=IN_REVIEW` |
| `/api/cron/remind` | GET | `CRON_SECRET` | Telegram reminder if `IN_REVIEW` | `telegram_messages`, `pipeline_runs` |
| `/api/cron/send` | GET | `CRON_SECRET` | `assertSendAllowed()` → `sendIssue()` | `send_log`, `issues.status` |
| `/api/telegram/webhook` | POST | secret header + allowlist | `onCallback`/`onMessage` | `issue_stories`, `approvals`, `telegram_pending` |
| `/api/webhooks/resend` | POST | Svix signature | `hygiene.*` | `email_events`, `subscribers` |
| `/api/subscribe` | POST | none (rate limited) | validate email | `subscribers` |
| `/api/unsubscribe` | GET/POST | signed token | `applyUnsubscribe()` | `subscribers` |
| `/api/admin/run/[job]` | POST | `ADMIN_TOKEN` | any cron job with `force` flag | per job |
| `/api/admin/telegram-setup` | POST | `ADMIN_TOKEN` | `setWebhook` | none |
| `/api/admin/simulate` | POST | `ADMIN_TOKEN` + `DEMO_MODE` | fake bounce/unsub/confirm | per action |
| `/api/health` | GET | none | DB ping, last run per job, model ID (no secrets) | none |

Every route sets `export const runtime = 'nodejs'` and `export const maxDuration` at or below the Hobby limit (verified 2026-10-12: 300 s default and max with Fluid compute). This requires `cacheComponents` to stay **off** in `next.config.ts` (Next 16 rejects `runtime` under Cache Components).

## 5. Schedule (Vercel Cron, UTC expressions)

Hobby cron (verified 2026-10-12): up to 100 cron jobs per project, **once per day per job**, **hourly precision** (a job can run any time within its hour), invoked with GET. Delivery is **best effort**: a run can be missed or delivered twice, so idempotency is mandatory. Windows below assume that behaviour.

| Job | Cron (UTC) | Fires (IST) | Meaning |
|---|---|---|---|
| ingest | `0 3 * * 1-3` | Mon–Wed 08:30–09:29 | collect |
| curate | `0 9 * * 3` | Wed 14:30–15:29 | "Wednesday afternoon" |
| notify | `0 12 * * 3` | Wed 17:30–18:29 | "by Wednesday evening" |
| remind | `0 17 * * 3` | Wed 22:30–23:29 | reminder, placed **after** 10 PM so it can never fire early |
| send | `0 2 * * 4` | Thu 07:30–08:29 | "Thursday morning", out by about 8 AM (moved from `0 3` on 2026-10-12 to match the map's "Thu 8 AM") |

**Which issue a job acts on** (`lib/time.ts`): ingest uses `collectingIssueDate(now)` (the first Thursday strictly after today, IST). curate, notify, remind and send use `targetIssueDate(now)` (the Thursday on or after today, IST), so Thursday morning's send acts on today's issue while Thursday's articles already feed next week's.

Because you cannot wait for Wednesday during a demo, every job also runs from `/api/admin/run/[job]` and from `npm run demo:week`.

Each cron route: verify `Authorization: Bearer ${CRON_SECRET}` → resolve the job's issue (`getOrCreateIssue(job, now)`, using the rule above) → check idempotency (`pipeline_runs` with same job+issue and `ok=true`, or a run in flight for <10 min → return `{skipped:true}` unless `force`; for **ingest** the scope is job+issue+**IST day**, because Mon–Wed all collect for one issue) → run → write `pipeline_runs`.

## 6. Issue state machine and the send gate

Statuses: `COLLECTING → DRAFTING → IN_REVIEW → CONFIRMED → SENDING → SENT`, plus `HELD`.

| From | To | Trigger | Guard |
|---|---|---|---|
| (none) | COLLECTING | first ingest of the window | — |
| COLLECTING | DRAFTING | curate starts | ≥ 1 ingest run ok |
| DRAFTING | IN_REVIEW | notify delivers cards | draft valid (8–10 picks, ≥3 topics) |
| IN_REVIEW | CONFIRMED | Shreya taps Confirm | caller is `SHREYA_TG_USER_ID`; no story `PENDING`; `content_hash` matches the one on the card |
| CONFIRMED | IN_REVIEW | any edit/swap/keep-change | automatic; clears `confirmed_at`, `content_hash` |
| CONFIRMED | SENDING | send cron or "Send now" | `assertSendAllowed()` passes |
| SENDING | SENT | all batches processed | — |
| IN_REVIEW or CONFIRMED | HELD | send cron finds not confirmed after send time | alerts Shreya; never sends |
| HELD | CONFIRMED | Shreya taps Confirm, then "Send now" | explicit second tap |

`assertSendAllowed(issueId)` throws unless **all** are true:

1. `status === 'CONFIRMED'`
2. `confirmed_by === SHREYA_TG_USER_ID`
3. `confirmed_at` is not null
4. `contentHash(issue) === issues.content_hash` (recomputed now, compared to the hash stored at confirm)
5. a matching `approvals` row exists with action `confirm` and the same hash
6. issue not already `SENT`

`contentHash` = SHA-256 of canonical JSON: `{subject, stories:[{position, headline, url, commentary_final}]}` in position order.

`sendIssue()` is the only function that imports Resend, and it calls `assertSendAllowed()` as its first line. Add a unit test that tries to send with each guard failing and expects a throw.

### As implemented (`lib/approval/fsm.ts`, Phase 5)

The table above is the intent; this is the exact event table the code enforces (and `tests/fsm.test.ts` checks against an independent copy). Any status/event pair not listed throws `IllegalTransitionError`.

| Event | Allowed from → to | Guards and effects |
|---|---|---|
| `curate` | COLLECTING, DRAFTING, IN_REVIEW, HELD → DRAFTING | Replaces the draft (forced re-curate). Route guard: ≥1 ok ingest. Never from CONFIRMED / SENDING / SENT |
| `notify` | DRAFTING → IN_REVIEW | Draft valid (8–10 live picks, ≥3 topics) **or** flagged `needs_attention` (a thin draft still reaches Shreya, docs §8) |
| `confirm` | IN_REVIEW, HELD → CONFIRMED | Caller = `SHREYA_TG_USER_ID`; no live pick `PENDING`; card hash (8-char prefix) = fresh hash. Stores `content_hash`, `confirmed_at`, `confirmed_by`; writes `approvals(confirm, hash)` |
| `edit` | CONFIRMED → IN_REVIEW; DRAFTING, IN_REVIEW, HELD → (unchanged) | Called after any content change (edit/swap/keep). From CONFIRMED it clears the hash and confirmation and writes `approvals(reset_by_edit)` |
| `hold` | DRAFTING, IN_REVIEW, CONFIRMED → HELD | Shreya's Hold, or the send cron finding no confirmation. Writes `approvals(hold)` |
| `start_send` | CONFIRMED → SENDING | Preceded by `assertSendAllowed()` in `sendIssue()` |
| `finish_send` | SENDING → SENT | Sets `sent_at` |

All guards fail closed: if `SHREYA_TG_USER_ID` is unset, Confirm and the send gate refuse everything. Transitions lock the issue row (`SELECT … FOR UPDATE`) inside a transaction.

## 7. Weekly timeline

| When | Job | Outcome |
|---|---|---|
| Mon–Wed morning | ingest | New articles stored; within-week and last-4 dedupe marks applied; issue `COLLECTING` |
| Wed afternoon | curate | One Gemini call (plus ≤2 retries); validated draft saved; issue `DRAFTING` |
| Wed evening | notify | Header + story cards + final card sent; issue `IN_REVIEW` |
| Wed night | remind | Reminder if still `IN_REVIEW` |
| Thu morning | send | If `CONFIRMED` → email sent; else `HELD` + Telegram alert |
| Any time | webhooks | Resend events update subscribers; Telegram callbacks update stories |

## 8. Error handling matrix

| Failure | Behaviour |
|---|---|
| One RSS feed fails or times out (8 s) | Log, increment `sources.consecutive_failures`, continue. Source auto-pauses after 5 consecutive failures; dashboard shows it. |
| GNews 429 / quota | Skip remaining GNews queries this run; continue with RSS. |
| Fewer than 20 usable candidates at curate | Still run Gemini; if fewer than 8 valid picks result, send Shreya a Telegram alert "only N valid stories" and do **not** pad with weak items. Draft is created with what is valid and flagged `NEEDS_ATTENTION`. |
| Gemini 429/503/timeout | Retry 3× with backoff (2 s, 6 s, 15 s + jitter). Then alert Shreya and set `pipeline_runs.ok=false`. Admin can re-run. |
| Gemini output fails zod or rule validation | Re-prompt with the exact violations, up to 2 times. Then deterministic repair: fill/replace from backups to satisfy rules; flag cards with a warning. |
| Telegram send fails | Retry once after 2 s. Then log and mark notify run failed. Dashboard shows "draft not delivered". |
| Shreya's callback arrives for an old card | Answer the callback with "This draft changed" and refresh the card. |
| Send cron runs, status ≠ CONFIRMED | `HELD`, Telegram alert, **no email**. |
| Resend batch fails | Mark those rows `failed`, continue next batch, final Telegram report with counts. Re-run resumes only unsent rows (`send_log` unique per issue+subscriber). |
| Double cron fire | Idempotency check returns `skipped`. |
| Webhook replay | `email_events.svix_id` unique; duplicates ignored. |

## 9. Security

- Cron: bearer `CRON_SECRET`, timing-safe compare.
- Admin: `ADMIN_TOKEN` header; admin simulate routes additionally require `DEMO_MODE=true`.
- Telegram: verify `X-Telegram-Bot-Api-Secret-Token`; ignore any update whose `from.id` ≠ `SHREYA_TG_USER_ID` (log it).
- Resend: verify Svix signature headers; reject if timestamp skew is too large.
- Unsubscribe tokens: HMAC-SHA256 over `subscriberId` with `UNSUB_SIGNING_KEY`; no expiry (unsubscribe links must keep working).
- Never log emails in full; log first 2 chars + domain.
- Subscribe form: server-side email validation, per-IP rate limit (in-memory is acceptable on Hobby; note limitation).
- All HTML rendered into emails and Telegram messages is escaped.

# 05 — Integrations and algorithms

Items marked **VERIFY** may have changed. Check the provider's current docs before coding and record the result in `docs/DECISIONS.md`.

## 1. Ingestion

### RSS — `lib/collect/rss.ts`
- `rss-parser`, custom `User-Agent: TheDispatchBot/1.0 (+APP_URL)`.
- Per-feed timeout 8 s, run feeds with concurrency 6 (`Promise.allSettled`).
- Keep items with a valid link and title, `published_at` inside the issue window (if the feed omits dates, use fetch time and set `raw.date_missing=true`).
- Max 40 items per feed per run.
- Snippet: `contentSnippet` or stripped `content:encoded`/`description`, ≤600 chars stored (≤280 sent to Gemini).
- Update `sources.last_ok_at` or `consecutive_failures/last_error`.

### GNews — `lib/collect/gnews.ts`
- Endpoint (verified 2026-10-12): `GET https://gnews.io/api/v4/search`. Parameters: `q` (≤200 chars), `lang=en`, `country=in`, `max=10`, `from=<window_start ISO>`, `sortby=publishedAt`, `apikey`.
- One `sources` row per query (`kind='gnews'`). Final list: the five above (user chose to keep only queries that returned ≥3 articles). Original starter queries, superseded:
  `Indian startup funding`, `India startup layoffs OR shutdown`, `Indian unicorn`, `India fintech regulation RBI`, `India quick commerce`, `India D2C brand`, `India AI startup`, `India climate tech startup`, `India SaaS startup`, `India startup IPO`.
- Quota (verified 2026-10-12): free plan = 100 requests/day (resets 00:00 UTC; over-quota returns **403**), ≤10 articles per request, **12-hour article delay**, 30 days of history, content truncated, **non-commercial use only** (user accepted for this exam project). 10 queries × 3 ingest days = 30 requests. If 403/429 → stop GNews for the run, continue with RSS.
- Store `publisher` from the API's `source.name`.
- **Observed on the free plan (2026-10-12, ~75 test requests):** queries of 3+ words return 0–2 articles (e.g. `Indian startup funding` with `country=in` and a date range → 0), while 1–2 word queries with `country=in` return the full 10 Indian results across a `from`/`to` range. `sortby=publishedAt` returns only the newest ~1–2 days of a range; `sortby=relevance` spreads across it. Generic words match non-business news ("Series A" → TV-series reviews, "SaaS" → the TV serial *Kyunki Saas Bhi…*). Response: `{ information, totalArticles, articles[] }`; article keys `id,title,description,content,url,image,publishedAt,lang,source{id,name,url,country}`. **Phase 2:** the probe must test every starter query, not just RSS feeds, and the user approves replacements for weak ones.

### Candidate RSS feeds — `content/sources.seed.json`
**Resolved 2026-10-12.** `npm run probe` found 9/20 candidates below working; 11 were dead (404, 403 bot-blocking, HTML instead of XML) or stale. After probing 30 replacements, the user approved **20 RSS feeds + 5 GNews queries** (`startup funding`, `quick commerce`, `AI startup`, `D2C brand`, `climate tech`), now in `content/sources.seed.json`; `npm run seed` syncs the `sources` table to that file (inserts new, deletes unreferenced unlisted rows, pauses referenced ones). The table below is the original candidate list, kept for history.

| Name | Candidate URL |
|---|---|
| Inc42 | `https://inc42.com/feed/` |
| YourStory | `https://yourstory.com/feed` |
| Entrackr | `https://entrackr.com/feed` |
| Economic Times Tech | `https://economictimes.indiatimes.com/tech/rssfeeds/13357270.cms` |
| ET Startups | `https://economictimes.indiatimes.com/small-biz/startups/rssfeeds/11993040.cms` |
| Livemint Technology | `https://www.livemint.com/rss/technology` |
| Moneycontrol Startups | `https://www.moneycontrol.com/rss/startups.xml` |
| Business Standard Companies | `https://www.business-standard.com/rss/companies-101.rss` |
| Medianama | `https://www.medianama.com/feed/` |
| TechCrunch India | `https://techcrunch.com/tag/india/feed/` |
| Analytics India Magazine | `https://analyticsindiamag.com/feed/` |
| The Hindu BusinessLine | `https://www.thehindubusinessline.com/companies/feeder/default.rss` |
| Startup Talky | `https://startuptalky.com/feed/` |
| Tech in Asia (India tag) | `https://www.techinasia.com/tag/india/feed` |
| Rest of World | `https://restofworld.org/feed/` |
| Techcircle | `https://www.techcircle.in/rss` |
| VCCircle | `https://www.vccircle.com/rss` |
| The News Minute (business) | `https://www.thenewsminute.com/taxonomy/term/9/feed` |
| Indian Express Technology | `https://indianexpress.com/section/technology/feed/` |
| Hindustan Times Tech | `https://www.hindustantimes.com/feeds/rss/tech/rssfeed.xml` |

Dead feeds are expected. Replace them rather than shipping failing sources.

## 2. Dedupe algorithm — `lib/dedupe/*`

**Canonical URL** (`canonicalizeUrl`): lowercase scheme/host, drop `www.`, remove fragment, remove tracking params (`utm_*`, `fbclid`, `gclid`, `mc_cid`, `mc_eid`, `ref`, `ref_src`, `cmpid`, `ito`), sort remaining params, strip trailing slash, resolve AMP paths (`/amp`, `?amp`). `canonical_hash = sha256(canonical_url)`.

**Title normalisation** (`normalizeTitle`): lowercase; strip trailing source suffix after ` | `, ` - `, ` — ` when the suffix is ≤4 words; remove punctuation and quotes; collapse spaces; drop leading "exclusive:", "breaking:", "watch:"; keep digits and currency symbols; map `rs`/`inr` → `₹`.

**Entities** (`extractEntities`): capitalised tokens/phrases and numbers from the *original* title, lowercased, excluding stop-list (sentence-initial common words, month names, "India", "Indian", "startup").

**Duplicate rule (calibrated 2026-10-12, user-approved; code: `CALIBRATED_RULE` in `lib/dedupe/engine.ts`).** Two titles are the same story if `similarity(title_norm)`:
- `≥ 0.85` (near-identical / syndicated copies), or
- `≥ 0.60` and ≥ **1** shared *distinctive* entity, or
- `≥ 0.30` and ≥ **2** shared *distinctive* entities.

*Distinctive* excludes entities made only of generic words (results, profit, IPO, rupee, U.S., AI, GST, RBI, …), quarter/fiscal codes (Q2, H1, FY26), years and bare numbers ≤ 31. Entities match when equal or when one's words are contained in the other's ("ai-focused bytexl" ~ "bytexl").

*Why it replaced the original rule* (`≥ 0.6`, or `≥ 0.45` with ≥ 2 shared entities, kept as `DOC_RULE`): on 509 real articles, cross-outlet rewrites of one story scored 0.30–0.45 (e.g. two reports of Tessolve's $75 Mn round: 0.447), so the original missed ~20 true duplicates, and it raised 3 false alarms on template headlines ("Rupee rises 16 paise…" vs "…23 paise…"). Pairs sharing only one distinctive name (e.g. TCS vs Infosys reactions to the same US rule) stay separate on purpose: wrongly merging hides a story from Gemini; Phase 4's `SAME_STORY_IN_PICKS` check still guards picks.

**Classification order for a new article A:**
1. Insert with `ON CONFLICT (canonical_hash) DO NOTHING`. Conflict → already known, stop (counts as `known`).
2. **Within window:** compare with the issue's already-classified articles (SQL `title_norm % $1` on the GIN index, then the rule above). Match → `duplicate`, `duplicate_of` = cluster root of the earliest-published match, score in `similarity`. New articles are processed in publish order, so later ones can match earlier ones from the same run.
3. **Last-4:** compare against the Last-4 set (story article titles + headlines as sent, normalised). Same rule, plus exact canonical-hash equality. Match → `seen_before`, `seen_in_issue` set. (Done in JS with a `pg_trgm` port, `lib/dedupe/trigram.ts`, because edited headlines are normalised in code; an integration test shows it matches Postgres to < 1e-6.)
4. Otherwise → `candidate`.

Cluster representative at curate time: among articles linked by `duplicate_of`, keep the earliest-published, tie-break longest snippet. Only representatives go to Gemini.

Required unit tests: tracking params removed; AMP and `www` variants collapse; suffix stripping; `Rs 50 crore` vs `₹50 crore`; two outlets, same funding round → duplicate; same company, different story → **not** duplicate; Last-4 near-repeat → `seen_before`; 0.44 similarity with 0 shared entities → candidate. Added with calibration: template headlines about different companies → not duplicate; tier edges 0.30 / 0.60 / 0.85.

Use trigram similarity in SQL: `similarity(a.title_norm, $1)` via `pg_trgm`, with the GIN index. Run one query per new article, bounded to the window.

## 3. Telegram — `lib/telegram/*`

Plain `fetch` to `https://api.telegram.org/bot<TOKEN>/<method>`. No bot framework.

**Setup:** `POST /api/admin/telegram-setup` calls `setWebhook` with `url=APP_URL/api/telegram/webhook`, `secret_token=TELEGRAM_WEBHOOK_SECRET`, `allowed_updates=["message","callback_query"]`. Shreya (the user) sends `/start` once to the bot; the handler replies with her numeric ID so she can put it in env (`SHREYA_TG_USER_ID`, `SHREYA_TG_CHAT_ID`). After IDs are set, ignore every other user.

**Webhook handler:** verify the secret header → check `from.id` allowlist → handle → return 200 quickly. Always `answerCallbackQuery`.

**Message formatting:** `parse_mode: "HTML"`; escape `& < >` in all dynamic text. Limit 4096 chars per message. Space sends ≥350 ms apart (chat rate limit is about 1 msg/s).

**Draft delivery order (notify job):**
1. Header: `The Dispatch — draft for Thu 15 Oct · 9 stories · 4 topics` plus warnings if `needs_attention`.
2. One card per pick, in position order:
   ```
   3/9 · FINTECH · under-reported
   <b>Headline</b> (Publisher)
   Commentary text…
   <i>Why: rationale</i>
   ⚠ ungrounded number: 42%        (only if flagged)
   ```
   Buttons row: `✅ Keep` `✏️ Edit` `🔄 Swap` and a URL button `🔗 Read`.
3. Final card: summary table of states (kept/edited/pending counts), topic spread, buttons `✅ Approve all remaining`, `🚀 Confirm final draft`, `⏸ Hold`.

**Callback data** (≤64 bytes): `k:<storyId8>` keep, `e:<storyId8>` edit, `s:<storyId8>` swap, `a:<issue8>` approve all, `c:<issue8>:<hash8>` confirm, `h:<issue8>` hold, `n:<issue8>` send now (held issue). Use 8-char id prefixes; look up with `LIKE` within the current issue and reject ambiguity.

**Keep:** state → `KEPT`; edit the card in place to show `✅ Kept`.
**Edit:** send a `force_reply` prompt "Send the new commentary for story 3"; store `telegram_pending` (expires 30 min); on the next text message that replies to that prompt, validate with `voiceLint`, save `commentary_final`, `edited=true`, state `EDITED`, store `style_examples`, refresh the card. If lint fails, tell her what failed and offer "Use anyway" (she is the editor, so allow override but log it).
**Swap:** mark old pick `SWAPPED_OUT`, promote backup rank 1 (next unused) into the same `position`, ensure topic spread still ≥3 (if not, choose the best-ranked backup that restores it, otherwise warn on the final card), post a new card for the replacement and edit the old one to `🔄 Swapped out`. Swap needs no AI call.
**Approve all remaining:** sets every `PENDING` pick to `KEPT`.
**Confirm:** allowed only if no pick is `PENDING` and the hash on the button equals the freshly computed hash. Stores `content_hash`, `confirmed_at`, `confirmed_by`, status `CONFIRMED`, and an `approvals` row. Reply: "Confirmed. It will go out Thursday morning." If any later action changes content, post "Draft changed after confirmation, please confirm again" and reset to `IN_REVIEW`.
**Hold:** sets `HELD`; nothing sends until she confirms again.
**Reminder card (remind job):** one message "No confirmation yet for Thursday's issue" with the same Confirm/Hold buttons, only if status is `IN_REVIEW`.
**Alert card:** used by send and curate jobs when something needs her attention.

**As implemented (2026-10-12):** an edit is also accepted as the next plain message while one is pending; the summary card is re-posted after Edit/Swap and the old one loses its buttons; "Use anyway" is `u:<story8>` with the text kept in `telegram_pending.pending_text`; `/status` re-posts the summary; "Send now" appears on a confirmed issue once its Thursday has arrived. See `DECISIONS.md`.

## 4. Resend — `lib/mail/*`

- Only `lib/mail/send.ts` imports `resend`.
- `from = MAIL_FROM` (`onboarding@resend.dev` default). Verified 2026-10-12: the `resend.dev` sender delivers only to the account owner's address (others get 403), plus Resend's test addresses. That is why demo mode exists.
- Send via the batch endpoint, ≤100 emails per call (verified; max 50 `to` per email, no attachments). One email object per recipient so each has a personal unsubscribe link. Rate limit is 10 requests/second per team (verified); keep batches ≥600 ms apart anyway. Pass an `Idempotency-Key` header per batch (`<issueId>-b<batchNo>`; verified supported, ≤256 chars, expires 24 h).
- Headers per email: `List-Unsubscribe: <APP_URL/api/unsubscribe?t=TOKEN>` and `List-Unsubscribe-Post: List-Unsubscribe=One-Click`.
- Free-tier caps (verified): 100 emails/day, 3,000/month. Test-address sends count toward the cap. Demo mode keeps real sends to a handful.
- Test addresses (verified): `delivered@`, `bounced@`, `complained@resend.dev` (accept `+label`), plus `suppressed@resend.dev` (no labels). User approved seeding the first three.

**Demo mode (`DEMO_MODE=true`):** for each active subscriber, if email ∈ `SEND_ALLOWLIST` (or approved Resend test addresses) → really send; otherwise write `send_log.status='skipped_demo'`. Batch/claim logic still runs over all 2,200 rows, so scale behaviour is demonstrated and tested.

**Send algorithm (`sendIssue`):**
1. `assertSendAllowed(issueId)`.
2. Set status `SENDING`.
3. Loop: claim up to 100 subscribers with `status='active'` and no `send_log` row (`FOR UPDATE SKIP LOCKED`), insert `send_log` as `queued`, send or skip, update rows with `resend_id` or `failed`.
4. When none left: status `SENT`, `sent_at`. Telegram report: sent / skipped_demo / failed counts.
5. If the function is about to hit its time limit, stop cleanly and self-invoke again (re-run is safe because of the unique `send_log` rows).

**Webhook (`/api/webhooks/resend`):** verify with Svix (`svix-id`, `svix-timestamp`, `svix-signature` headers, secret `RESEND_WEBHOOK_SECRET`). Insert into `email_events` with unique `svix_id` (ignore duplicates). Event names (verified 2026-10-12): `email.delivered`, `email.bounced`, `email.complained`, `email.delivery_delayed`; also `email.failed` and `email.suppressed` exist (record them in `email_events`, no status change). Verify against the **raw** request body.
- `email.bounced`: permanent bounce → `subscribers.status='bounced'`, `bounced_at`, `bounce_type`. Transient bounce → record only.
- `email.complained` → `complained`.
- Match subscriber by recipient email in the payload.
- Resend webhooks must be configured in the Resend dashboard pointing at `APP_URL/api/webhooks/resend`.

**Simulation (X6):** `POST /api/admin/simulate {action:'bounce'|'complaint'|'unsubscribe', email}` (needs `ADMIN_TOKEN` and `DEMO_MODE`) runs the same `hygiene.*` functions the webhook uses, so you can demo R15/R16 without real bounces.

**As implemented (2026-10-12):** claim = `INSERT ... SELECT ... ON CONFLICT DO NOTHING RETURNING` on the unique send_log row; idempotency key `<issueId>-<contentHash12>-b<batch>`; the webhook is created by `scripts/resend-webhook.ts` and verified with `node:crypto` (`lib/mail/svix.ts`).

## 5. Unsubscribe — `lib/mail/tokens.ts`, `/api/unsubscribe`

- Token = base64url(`subscriberId.HMAC_SHA256(subscriberId, UNSUB_SIGNING_KEY)`).
- `GET /unsubscribe?t=…` shows a confirmation page with one button (so mail scanners do not unsubscribe people by prefetching).
- `POST /api/unsubscribe` (also the one-click target) sets `unsubscribed`, `unsubscribed_at`, idempotent.
- Confirmation page copy is plain and friendly; no dark patterns.

## 6. Neon — `lib/db.ts`

- `DATABASE_URL` = pooled string. Use `drizzle-orm/neon-http` for simple reads/writes and `drizzle-orm/neon-serverless` (WebSocket `Pool`) wherever a transaction is needed.
- Region (user decision 2026-10-12): **AWS Asia Pacific (Singapore), ap-southeast-1**, with Vercel functions pinned to `sin1` via `vercel.json` `regions` so app and DB share a region. Neon has no India region; Vercel's Hobby plan allows one selectable function region (default `iad1`). A Neon project's region cannot be changed after creation. `pg_trgm`, `citext`, `pgcrypto` are supported. Free plan: 100 CU-hours/project, 1 GB storage/project, scale-to-zero after 5 min (expect a cold-start delay on the first query).
- Migrations run from `npm run db:migrate`, never at request time.

## 7. Vercel — `vercel.json`

```json
{
  "regions": ["sin1"],
  "crons": [
    { "path": "/api/cron/ingest", "schedule": "0 3 * * 1-3" },
    { "path": "/api/cron/curate", "schedule": "0 9 * * 3" },
    { "path": "/api/cron/notify", "schedule": "0 12 * * 3" },
    { "path": "/api/cron/remind", "schedule": "0 17 * * 3" },
    { "path": "/api/cron/send",   "schedule": "0 2 * * 4" }
  ]
}
```

- Vercel sends `Authorization: Bearer $CRON_SECRET` when `CRON_SECRET` is set in project env (verified). Verify it in every cron route.
- Cron invokes with GET. Hobby (verified 2026-10-12): once per day per job, hourly precision, best-effort delivery (may miss or double-fire), no redirects followed.
- Set env vars for Production and Preview. Redeploy after changing env.
- `maxDuration`: Hobby allows up to 300 s (verified, Fluid compute). Keep jobs short anyway.

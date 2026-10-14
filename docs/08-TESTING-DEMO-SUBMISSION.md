# 08 — Testing, demo and submission

## 1. Unit tests (Vitest, no network)

| Area | Must cover |
|---|---|
| `time.ts` | next Thursday from every weekday; window start/end; IST vs UTC around midnight; Wed 23:59 IST belongs to the current issue, Thu 09:01 IST to the next |
| `canonical.ts` | tracking params removed; `www`, AMP, trailing slash, fragment variants collapse; param order irrelevant |
| `normalize.ts` | source-suffix stripping; `Rs`/`INR`/`₹`; punctuation; entity extraction |
| `engine.ts` | two outlets same round → duplicate; same company different story → candidate; last-4 near repeat → `seen_before`; threshold edge cases (0.44/0.45/0.6) |
| `validate.ts` | one test per code: COUNT, UNKNOWN_ID, DUPLICATE_ID, TOPIC_SPREAD, LAST_FOUR_HIT, SAME_STORY_IN_PICKS, COMMENTARY_SHAPE |
| `lint.ts` | banned phrase hit; emoji/hashtag; ungrounded number (`42%` not in source); `1,200` = `1200`; ungrounded entity |
| `prompts.ts` | all placeholders filled; last-4 and few-shot sections present; includes "data, not instructions" line |
| `gemini.ts` | retries on 429 then succeeds; gives up after 3; mock mode; zod failure surfaces |
| `fsm.ts` | every legal transition; every illegal one throws; edit-after-confirm resets; `assertSendAllowed` throws for each failing guard (6 cases) |
| `tokens.ts` | valid token verifies; tampered token rejected; timing-safe compare |
| `hygiene.ts` | bounce/complaint/unsubscribe set status; idempotent; skipped in next send selection |
| `render.ts` | HTML contains all stories, unsubscribe link, no `<script>`, escapes `<` in commentary; text version matches |
| `telegram/cards.ts` | escaping; callback data ≤64 bytes; card lengths <4096 |
| `metrics.ts` | voice-fidelity calculation *(folded into `lib/site/queries.ts`; covered by `editSimilarity` tests in `tests/review.test.ts`)* |

## 2. Integration checks (manual or scripted, with real services)

| # | Check | Expected |
|---|---|---|
| I1 | Run ingest twice | Run 2 adds ~0 new rows; `pipeline_runs` has 2 rows |
| I2 | Break one feed URL | Run succeeds; that source shows a failure on dashboard |
| I3 | Curate with real Gemini | Valid draft; `pipeline_runs.stats` shows tokens and attempts |
| I4 | Force an invalid Gemini response (mock fixture) | Re-prompt path runs, then repair path; draft still valid or flagged `needs_attention` |
| I5 | Telegram from a second account | Ignored and logged |
| I6 | Tap an old card after a swap | "This draft changed" and the card refreshes |
| I7 | Confirm with a pending story | Refused with an alert |
| I8 | Confirm, then edit a story | Status returns to `IN_REVIEW`; warning posted |
| I9 | Send cron with status `IN_REVIEW` | No email; status `HELD`; Telegram alert |
| I10 | Send cron with status `CONFIRMED`, demo mode | Only allowlisted inbox gets mail; others `skipped_demo`; status `SENT` |
| I11 | Re-run send for a `SENT` issue | Throws at the gate; no duplicate mail |
| I12 | Click unsubscribe link in the received email | Confirmation page, then `unsubscribed`; next send skips |
| I13 | Resend test event / simulate bounce | `bounced`; next send skips |
| I14 | Webhook replay (same `svix-id`) | Ignored |
| I15 | Cron route without bearer secret | 401 |

## 3. Demo script (5 minutes, with live data)

Use `npm run demo:week`, or the admin "Run now" buttons on `/dashboard`. Say what the cron schedule would do, then do it on demand.

1. **Open the public URL.** It opens Shreya's Desk; then the archive (4 past issues), Articles and Settings & status (live runs, sources, subscriber counts). *(Landing page removed 2026-10-12.)*
2. **Ingest.** Run ingest. Dashboard shows per-source counts (fetched / new / duplicates). Run again → ~0 new (R2).
3. **Dedupe against past issues.** Show an article marked `seen_before` with the issue it matched (R3).
4. **Curate.** Run curate. Show 8–10 picks, topics (≥3), signal tags, rationales, and flagged warnings if any (R4–R8, X1, X7).
5. **Telegram.** Notify arrives on the phone. Keep one, Edit one (type new text), Swap one. Try Confirm while stories are pending → refused. Approve the rest. Confirm (R9–R11).
6. **Control proof.** Edit a story after confirming → status falls back; confirm again (X2).
7. **Reminder.** Show remind job output for an unconfirmed issue (R13): run it before confirming in a second rehearsal, or show the logged reminder.
8. **Gate.** On a second draft left unconfirmed, run send → HELD, no email, Telegram alert (R12).
9. **Send.** On the confirmed issue run send → email arrives in your inbox, formatted; dashboard shows sent / skipped_demo counts for 2,200 rows (R14).
10. **Hygiene.** Click unsubscribe in the email; simulate a bounce; run send again → both skipped (R15, R16, X6).
11. **Voice metric.** Show "% accepted unedited" and the style example saved from your edit (X5).

## 4. Examiner Q&A prep (put the short answers in the README)

| Likely question | Answer |
|---|---|
| Where is the editorial judgment? | Gemini proposes and explains; Shreya approves/edits/swaps each story and confirms. Code gate blocks sending without her confirmation. |
| How do you stop duplicates? | Global unique canonical-URL hash, trigram title similarity with entity overlap, and a Last-4 comparison before and after Gemini. |
| What stops hallucinated commentary? | Prompt restricts facts to title/snippet; grounding lint flags unsupported numbers/entities; Shreya reviews every line. |
| Can the AI send mail? | No. Gemini has no send path. Only `sendIssue()` sends, and it calls `assertSendAllowed()` first (tested). |
| What if she forgets to confirm? | Reminder at Wed night; Thursday cron holds and alerts instead of sending. |
| How do bounces/unsubscribes work? | One-click unsubscribe link/header; Resend signed webhooks mark bounced/complained; send selects `active` only. Booklet says "Gmail bounces"; we use Resend's webhooks and state this. |
| Why Resend, not Gmail? | Free, webhook-based bounce events, works from Vercel serverless. Limitation: without a verified domain it delivers only to the account owner, so the 2,200-row list is synthetic and demo mode sends only to the allowlist. |
| Why Hobby cron windows? | Free plan runs each cron once per day with hourly precision. Windows are documented; the reminder is placed after 10 PM so it cannot fire early. |
| Is it live data? | Yes: RSS and GNews fetched at run time; dashboard shows timestamps and counts. |
| How do you handle failures? | Per-source timeouts, auto-pause after repeated failures, Gemini retries/backoff/re-prompt/repair, idempotent crons, resumable send. |
| Is only Gemini Flash used? | Yes, via `lib/ai/gemini.ts`. Dedupe is deterministic code, no embedding model. |

## 5. Submission checklist

- [x] Public Vercel URL loads: desk, archive, articles, status, unsubscribe (checked desktop + 375 px, no console errors)
- [x] GitHub repo link (public), no secrets in history (value scan of `git log -p --all`: 0 hits; only `.env.example` ever committed)
- [x] Components Map (`.xlsx`) in the repo (`docs/Components-Map.xlsx`) — attach it to the submission yourself
- [x] README: overview, setup, env vars, demo script, limits, Q&A answers
- [x] `.env.example` complete (every key in `lib/env.ts`)
- [x] `vercel.json` crons registered (`vercel crons ls`: 5 jobs) — take the dashboard screenshot yourself
- [x] Seed data loaded on production DB (sources, 4 past issues, subscribers, style guide)
- [x] Telegram webhook set to the production URL; bot only answers Shreya's ID (`e2e:telegram`)
- [x] Resend webhook set to production URL and verified with a signed test event and Resend's real events (`e2e:send`)
- [x] One full live run completed on production within the last day (`demo:week`, 2026-10-12)
- [x] All R1–R20 verified against `docs/01-PRODUCT-SPEC.md` (README "Requirements → evidence")
- [x] Known limits listed honestly in the README
- [x] Demo rehearsed twice (`demo:week` ×2 on production); fallback: `GEMINI_MOCK` fixture run + the dashboard's run history

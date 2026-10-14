# 01 — Product spec

## 1. Glossary

| Term | Meaning |
|---|---|
| Issue | One edition of The Dispatch, identified by its Thursday send date (`issue_date`, IST). |
| Issue window | From the previous Wednesday 13:30 IST to the Wednesday before the issue, 13:29:59.999 IST (the start of the last ingest before curate). Consecutive windows touch, so every instant belongs to exactly one issue. Articles published in the window belong to the issue being built. (Changed twice on 2026-10-12: Thu 09:00 → Thu 00:00 → Wed 13:30, the last to close the Wednesday-afternoon gap; see `DECISIONS.md`.) |
| Candidate | An article that survived dedupe and is eligible for selection. |
| Pick | A candidate chosen for the draft (8–10 per issue). |
| Backup | A ranked extra candidate Gemini returns with commentary already written, used for swaps (5 per issue). |
| Last-4 set | All stories (articles, headlines, canonical URLs) in the four most recent `SENT` issues. |
| Gate | The code check in `assertSendAllowed()` that must pass before any subscriber email is sent. |

## 2. Requirements and acceptance checks

Each requirement comes from the booklet. "Check" is what the examiner (or our demo) can verify.

| ID | Requirement | Acceptance check |
|---|---|---|
| R1 | Mon–Wed ingest from multiple RSS feeds and news API queries; 20+ sources | `sources` table has ≥20 active rows (RSS + GNews queries). Dashboard shows the last ingest run with per-source counts. |
| R2 | Store each article; no duplicates within a week | Re-running ingest immediately adds 0 new rows. Same story from two outlets is marked `duplicate` with `duplicate_of` set. |
| R3 | No duplicates against the previous four newsletters | An article whose canonical URL or near-identical title is in the Last-4 set gets `seen_before`, never becomes a candidate. |
| R4 | Wed afternoon: Gemini picks 8–10 stories | Curate run creates an issue in `IN_REVIEW`-ready draft with 8–10 `pick` rows. Fewer or more is rejected by validation. |
| R5 | High signal relative to this week's batch (counterintuitive, under-reported, or connecting trends) | Each pick carries `signal_type` ∈ {counterintuitive, under_reported, trend_link} and a one-line `rationale`. Gemini receives the whole batch in one call. |
| R6 | Not covered in any of the last four newsletters | Validator re-checks every pick against the Last-4 set; any hit triggers a re-prompt. |
| R7 | At least three different topic areas | Validator requires ≥3 distinct `topic` values from the fixed taxonomy. |
| R8 | 2–3 lines of commentary per story in Shreya's documented voice | Commentary is 2–3 sentences, ≤65 words, passes voice lint, built from `content/style-guide.md`. |
| R9 | Draft on Telegram by Wednesday evening | Notify job sends a header, one card per story, and a final card, to Shreya's chat. |
| R10 | Edit, approve or swap each story individually | Each story card has Keep, Edit, Swap (and Remove) buttons that work independently and update the card in place. The web Desk offers the same actions on the same backend. |
| R11 | She confirms the final draft | Final card has Confirm. Confirm is refused while any story is still pending. |
| R12 | Never sends autonomously | With status ≠ `CONFIRMED`, the send cron sends nothing and alerts Shreya. Unit-tested. Editing after confirm resets to `IN_REVIEW`. |
| R13 | Reminder if no confirmation by Wed 10 PM | Remind job sends one Telegram reminder while status is `IN_REVIEW`; none if already confirmed. |
| R14 | Formatted email to the subscriber list Thursday morning | Send job renders HTML + plain text and sends in batches of ≤100. Dashboard shows sent/skipped/failed counts. |
| R15 | Unsubscribes handled | Email has an unsubscribe link and one-click `List-Unsubscribe`. Using it sets `unsubscribed`; next send skips that address. |
| R16 | Bounces handled (booklet wording: "Gmail bounces"; we use Resend webhooks) | A `email.bounced` or `email.complained` webhook marks the subscriber `bounced`/`complained`; next send skips them. Verified with a signed test event. |
| R17 | Gemini Flash only | `grep` shows no other AI SDKs. All AI calls go through `lib/ai/gemini.ts`. |
| R18 | Deployed on Vercel with a public URL | URL loads Shreya's Editor's Desk; Settings & status shows the live pipeline. |
| R19 | Live data + works with some data at submission | Fresh ingest pulls real articles. Seed data (4 past issues, style guide, subscribers) lets a full demo week run on day one. |
| R20 | Deliverables | Public URL, GitHub link, Components Map file all in the submission. |

## 3. User stories

- As Shreya, I get a draft on Telegram and can fix any story in seconds, so my judgment stays in charge.
- As Shreya, I can swap a story for a backup that already has commentary, so a swap is instant.
- As Shreya, I can see why Gemini picked each story, so I can trust or override it.
- As Shreya, nothing leaves the building unless I press Confirm.
- As a subscriber, I can unsubscribe in one click and never get mail again.
- As the examiner, I can open the public URL and see real, recent pipeline runs.

## 4. Non-goals

- No payments, no paywall, no multi-newsletter tenancy.
- No open/click tracking by default (privacy; optional stretch only).
- No web login system. Telegram is Shreya's primary control surface; the web Desk (`/desk`) offers the same actions through the same backend and send gate, and is open for the demo (user decision 2026-10-12). Admin actions use `ADMIN_TOKEN`.
- No embeddings or vector DB.
- No sending to the real 2,200 addresses. The 2,200-row list is synthetic; real mail goes only to `SEND_ALLOWLIST` in demo mode.

## 5. Extra-credit features (kept small and justified)

| # | Feature | Why it earns marks | Effort |
|---|---|---|---|
| X1 | "Why this story" rationale + signal tag on every pick, shown in Telegram | Explains AI judgment, supports editorial control | S |
| X2 | Hash-locked confirmation + approvals audit trail | Makes R12 provable, not just promised | S |
| X3 | Public issue archive with web view of each issue | Gives the public URL real content; doubles as seed for Last-4 | M |
| X4 | Live dashboard: run logs, per-source counts, topic spread, issue status timeline (built as `/status`, "Settings & status") | Proves live data (R19), shows pipeline health | M |
| X5 | Voice-fidelity metric: % of AI commentary Shreya kept unedited, and her edits stored as few-shot examples | Shows the AI improves from feedback; evaluates quality | S |
| X6 | Demo mode + simulate-bounce/unsubscribe endpoints | Lets you demonstrate R15/R16 with only your own inbox | S |
| X7 | Grounding lint (numbers/entities must appear in source) | Reduces hallucination, visible in Telegram as a warning flag | S |
| X8 | Idempotent crons, retries with backoff, graceful degradation | Reliability a grader can see in logs | S |
| X9 | ~~Subscribe form on landing page~~ | Built, then **removed** on 2026-10-12: the app is Shreya's desk, not a subscriber site | — |
| X10 | Web review editor | Built as the Editor's Desk (`/desk`): open for the demo, no signed link (user decision); same review code, audit trail and send gate as Telegram | L |

Do X1–X9. X10 is stretch.

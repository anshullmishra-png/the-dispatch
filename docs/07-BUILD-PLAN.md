# 07 — Build plan

Order is chosen to remove risk early: deploy first, then the riskiest integrations (Telegram, Resend webhooks), then polish. **Do one phase at a time.** Each phase ends with: `npm run typecheck && npm run lint && npm test`, a deploy, a commit `phase N: …`.

## Phase 0 — Foundations and decisions
Read: `CLAUDE.md`, `docs/02-ARCHITECTURE.md`.
- Ask the user the questions in `CLAUDE.md` §5. Record answers in `docs/DECISIONS.md`.
- Check live provider docs for every **VERIFY** item (Vercel cron limits, Gemini Flash model ID + free limits, GNews limits, Resend limits/test addresses/event names) and record results.
- Scaffold Next.js (TS strict), ESLint, Vitest, `lib/env.ts` (zod-validated env), `lib/log.ts`, `lib/time.ts`, `.env.example`, README skeleton.
- Create GitHub repo, import to Vercel, add env vars, deploy "hello" page and `/api/health`.
- **Done when:** public URL serves `/api/health` with `{ok:true}`; `lib/time.ts` tests pass (next issue date, window, IST↔UTC, Wednesday/Thursday edge cases around midnight).

## Phase 1 — Database and seed
Read: `docs/03-DATA-MODEL.md`.
- `db/schema.ts`, migrations, `lib/db.ts`, `npm run db:migrate`.
- `scripts/seed.ts` (sources placeholder, 4 past issues, 2,200 subscribers, style examples).
- **Done when:** migrate + seed run twice without error or duplicates; counts match the spec; trigram similarity query works in a test.

## Phase 2 — Ingest
Read: `docs/05-INTEGRATIONS.md` §1.
- `scripts/probe-sources.ts`; present results to user and finalise `content/sources.seed.json` (≥20 sources incl. GNews queries). Re-seed sources.
- `lib/collect/rss.ts`, `gnews.ts`, `index.ts`, `/api/cron/ingest` with auth, idempotency and `pipeline_runs`.
- **Done when:** one live run stores real articles with `new` status; a second immediate run adds ~0; a dead feed does not break the run; dashboard-ready stats are in `pipeline_runs.stats`.

## Phase 3 — Dedupe
Read: `docs/05-INTEGRATIONS.md` §2.
- `lib/dedupe/*` with the unit tests listed there. Wire into ingest (classification) and `loadLastFourSet()`.
- **Done when:** all dedupe tests pass; on live data the run shows non-zero `duplicate` and (with seeded past issues) a sensible `seen_before` count; log a sample of 10 matched pairs and eyeball them.

## Phase 4 — Gemini selection
Read: `docs/04-AI-PROMPTS.md`.
- `lib/ai/gemini.ts` (retry, mock), `prompts.ts`, `schemas.ts`, `lib/curate/validate.ts`, `lint.ts`, `select.ts`, `draft.ts`, `/api/cron/curate`.
- Fixtures: one valid selection and one invalid per violation code.
- **Done when:** validator tests cover every violation code; with `GEMINI_MOCK=true` the pipeline creates a draft; with real Gemini (one run) the draft has 8–10 picks, 5 backups, ≥3 topics, none in Last-4, commentary 2–3 sentences. Read the commentary against the style guide with the user.

## Phase 5 — State machine and gate
Read: `docs/02-ARCHITECTURE.md` §6.
- `lib/approval/fsm.ts`: `transition`, `contentHash`, `assertSendAllowed`. Stub `sendIssue` that only calls the gate.
- **Done when:** unit tests prove every guard (wrong status, wrong user, missing confirm, hash changed, already sent) throws; edit-after-confirm resets to `IN_REVIEW`.

## Phase 6 — Telegram
Read: `docs/05-INTEGRATIONS.md` §3.
- `lib/telegram/*`, `/api/telegram/webhook`, `/api/admin/telegram-setup`, `/api/cron/notify`, `/api/cron/remind`.
- User creates the bot (BotFather), runs setup, sends `/start`, supplies IDs.
- **Done when (manual test on real phone):** notify sends header + cards + final card; Keep, Edit (force-reply), Swap (uses backup, no AI call), Approve all, Confirm (blocked while pending; works after), Hold, and the reminder all behave; a message from a second Telegram account is ignored; stale-card taps are handled.

## Phase 7 — Email and send
Read: `docs/05-INTEGRATIONS.md` §4–5, `docs/06-DESIGN.md` §8.
- `lib/mail/render.ts` (+ text), `tokens.ts`, `send.ts`, `/api/cron/send`, `/api/unsubscribe`, `/api/webhooks/resend`, `subscribers/hygiene.ts`, `/api/admin/simulate`.
- Configure the Resend webhook in the dashboard.
- **Done when:** with an unconfirmed issue the send cron sends nothing and alerts Shreya; with a confirmed issue in demo mode exactly the allowlisted address receives the email (check Gmail rendering, desktop + mobile); `send_log` shows `skipped_demo` for the rest; unsubscribe link works and a second send skips that address; a signed Resend test event or simulate call marks a bounce and the next send skips it.

## Phase 8 — Public site and dashboard
Read: `docs/06-DESIGN.md`.
- Tokens, fonts, rulebox, paper grain, components. Pages: landing + subscribe, archive, issue view, dashboard, unsubscribe. *(As built: later reshaped into the Editor's Desk, archive, articles, Settings & status, style guide and unsubscribe; landing/subscribe removed. See `docs/DECISIONS.md`.)*
- Metrics: voice-fidelity %, pipeline stats, topic spread, subscriber status counts.
- **Done when:** all pages render on mobile and desktop with real data; dashboard shows real recent runs; Lighthouse accessibility ≥90; contrast rules from design doc respected; no console errors.

## Phase 9 — Crons and full rehearsal
- Add `vercel.json` crons. Deploy.
- `scripts/demo-week.ts`: runs ingest ×3 → curate → notify (waits for you to tap in Telegram) → send, with `force` where needed.
- Run the whole demo against live data. Fix defects.
- **Done when:** `demo:week` completes end-to-end; the Vercel dashboard shows the cron jobs registered; logs show each job authenticated with `CRON_SECRET`.

## Phase 10 — Hardening and submission
- Re-read `docs/08-TESTING-DEMO-SUBMISSION.md`, tick every box.
- README: overview, architecture diagram link, setup, env vars, demo script, known limits (Hobby cron precision, free-tier caps, Resend sender limits, synthetic subscribers).
- Export the Components Map workbook into the repo (`docs/Components-Map.xlsx`).
- Final secret scan (`git log -p | grep -iE "api[_-]?key|token|secret"`), rotate anything exposed.
- **Done when:** submission checklist is fully ticked.

## Stretch (only if everything above is green)
- X10 web review editor at `/review/[issue]` with a signed link.
- Open/click event display from Resend webhooks (only if tracking is enabled and the user wants it).
- LLM-as-judge voice score (extra Gemini call, off by default).

## Anti-rework rules

1. Land pure functions with tests before the routes that call them.
2. Never change a column or enum without editing `docs/03-DATA-MODEL.md` and adding a migration in the same commit.
3. If a VERIFY item turns out different from the docs, update the docs first, then code.
4. If you find two ways to do something, take the one in the docs. Ask the user only when the docs are silent.

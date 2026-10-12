# CLAUDE.md — The Dispatch: Newsletter Intelligence Engine

Read this file first, every session. Then read the doc named in the current build phase (see `docs/07-BUILD-PLAN.md`) before writing code.

## 1. What we are building

An automated pipeline for **Shreya's weekly newsletter "The Dispatch"** (Indian startup ecosystem, 2,200 subscribers, sent Thursday morning).

- Mon–Wed: ingest articles from RSS feeds + news API queries, store them, de-duplicate.
- Wed afternoon: **Gemini Flash** selects 8–10 stories and drafts 2–3 lines of commentary each in Shreya's voice (stored style guide).
- Wed evening: draft goes to Shreya on **Telegram**. She keeps / edits / swaps each story, then confirms.
- Wed 10 PM: reminder if she has not confirmed.
- Thu morning: **only if confirmed**, the draft is rendered into a formatted email and sent via **Resend**.
- Unsubscribes and bounces update the subscriber list so those people stop receiving it.

This is an end-term exam project (AI course). The examiner checks the booklet requirements, the public URL, the GitHub repo and the Components Map.

## 2. Source of truth (in order)

1. The exam booklet (Problem Statement 17) — summarised as R1–R20 in `docs/01-PRODUCT-SPEC.md`.
2. This file.
3. `docs/*.md`.
4. The Components Map (`Newsletter_Agent_Components_Map.xlsx`) — `docs/02-ARCHITECTURE.md` mirrors it. If code and map disagree, fix the code or tell the user the map needs updating. Never silently drift.

## 3. Hard constraints (from the booklet)

- All AI tasks use **Gemini Flash**. No Claude API, no OpenAI, no other LLM, **no embedding models**.
- Deployed on **Vercel** (Hobby plan, free). Public URL required.
- Uses **live external data** wherever possible, and must **work with some data at submission time** (seed data, see `docs/03-DATA-MODEL.md`).
- **The system must never send the newsletter without Shreya's explicit confirmation.**
- Everything must be free-tier. No paid services, no credit card.

## 4. Never do

- Never call any email-sending function except through `sendIssue()` in `lib/mail/send.ts`, which calls `assertSendAllowed()` first (see `docs/02-ARCHITECTURE.md` §6). No other file may import the Resend client.
- Never give Gemini a tool, key or code path that can send email or change issue status.
- Never put secrets in the repo, in client bundles, or in logs. Only `NEXT_PUBLIC_*` values may reach the browser, and none of ours are secrets.
- Never trust incoming webhooks without verification (Telegram secret header + chat/user allowlist; Resend/Svix signature; cron bearer secret).
- Never invent Shreya's voice beyond what the user has authorised. Style guide content comes from `content/style-guide.md`. If it is empty or still has `[FILL]` markers, stop and ask the user.
  **Note (2026-10-12):** Shreya is a fictional persona from the exam brief. With the user's explicit permission, her voice in `content/style-guide.md` (persona, voice rules, "Never say" list, four examples, anti-example) was **AI-generated for this project** by Claude Code. Its four examples use real headlines and snippets from the seeded past issues, and each commentary uses only facts from its own snippet. Any later change to the voice is the user's call.
- Never invent facts in commentary. Numbers and named entities must appear in the source article text.
- Never use `localStorage`/`sessionStorage` for anything that matters (state lives in Neon).
- Never hardcode the Gemini model ID. Read `GEMINI_MODEL` from env.
- Never add dependencies "just in case". Every dependency must be named in `docs/02-ARCHITECTURE.md` §2 or justified in `CHANGELOG.md`.
- Never mark a phase done without running its checks (§8).

## 5. Ask the user first (do not assume)

Before Phase 0 ends, ask the user these and record answers in `docs/DECISIONS.md`:

1. Feed list: approve or edit the candidate sources in `docs/05-INTEGRATIONS.md` §4 (some URLs may be dead).
2. Topic taxonomy: confirm the 9 topics in `docs/04-AI-PROMPTS.md` §3.
3. Style guide: use the starter in `docs/09-STYLE-GUIDE-TEMPLATE.md` as is, or has the user written their own? *(Resolved: AI-generated with the user's permission, see §4.)*
4. Past four newsletters: does the user have real ones to seed, or should we generate clearly-labelled placeholders?
5. Demo recipients: only the user's own inbox (decided), and may we also seed Resend's built-in test addresses (`delivered@resend.dev`, `bounced@resend.dev`, `complained@resend.dev`) to demonstrate real bounce webhooks? (Not decided.)
6. Dashboard visibility: public read-only counts (recommended) or fully behind login?
7. Newsletter name and sender display: "The Dispatch" and `onboarding@resend.dev` (default) — confirm.

If a decision is missing mid-build, ask once, in one message, with the default you will use if they do not answer.

## 6. Stack (locked)

| Concern | Choice |
|---|---|
| Framework | Next.js (latest stable), App Router, TypeScript strict |
| Hosting / cron | Vercel Hobby, `vercel.json` crons |
| Database | Neon Postgres (+ `pg_trgm`), Drizzle ORM + `drizzle-kit`, raw SQL for trigram queries |
| AI | `@google/genai` SDK, Gemini Flash, JSON-schema structured output |
| Validation | `zod` |
| RSS | `rss-parser` |
| News API | GNews (free tier) |
| Chat | Telegram Bot API (webhook mode), no bot framework — plain `fetch` |
| Email | Resend (`resend` SDK) + Svix verification for webhooks |
| Tests | Vitest |
| Styling | Plain CSS variables + CSS modules (or one global stylesheet). No Tailwind, no UI kit. Design = `docs/06-DESIGN.md` |
| Fonts | `next/font/google`: Playfair Display, Bitter, PT Sans |

## 7. Repo layout

See `docs/02-ARCHITECTURE.md` §3 for the full tree. Top level:

```
app/            Next.js routes (pages + api)
lib/            all logic, framework-free where possible
content/        style-guide.md, topics.json, sources.seed.json
db/             schema.ts, migrations/, seed scripts
scripts/        probe-sources, seed, demo-week, set-telegram-webhook
tests/          vitest
docs/           these files
vercel.json
```

## 8. Working rules

1. **One phase at a time** from `docs/07-BUILD-PLAN.md`. Do not start a phase until the previous phase's "Done when" is true.
2. After each phase run: `npm run typecheck && npm run lint && npm test`. Fix before moving on.
3. Deploy to Vercel **in Phase 0** and redeploy every phase. The Telegram and Resend webhooks need the public URL from day one.
4. Commit after every phase with message `phase N: <summary>`. Small commits inside a phase are fine.
5. Keep pure logic (dedupe, validation, hashing, FSM, time) in `lib/` with unit tests. Routes stay thin.
6. Every route handler: verify auth → parse with zod → call lib → return JSON. Return fast; log with a request ID.
7. All times stored as `timestamptz` UTC. All user-facing and schedule reasoning in **IST (Asia/Kolkata)**. Use `lib/time.ts` only; never ad-hoc date math.
8. Every cron route is **idempotent**: running it twice for the same issue must not duplicate rows, messages or emails.
9. Every external call has a timeout, a retry policy (where safe) and a graceful failure path (`docs/02-ARCHITECTURE.md` §8).
10. Add a `GEMINI_MOCK=true` mode that returns fixture JSON, so tests and local dev do not burn free-tier quota.
11. Write the README as you go (setup, env vars, how to run the demo, architecture link). The examiner reads it.
12. Update `CHANGELOG.md` and `docs/DECISIONS.md` whenever you deviate from these docs, with the reason.

## 9. Environment variables

Document all in `.env.example` (no real values). Never commit `.env*` except the example.

| Name | Purpose |
|---|---|
| `DATABASE_URL` | Neon pooled connection string |
| `GEMINI_API_KEY` | Google AI Studio key |
| `GEMINI_MODEL` | Flash model ID (verify current ID in AI Studio docs) |
| `GEMINI_MOCK` | `true` to use fixtures |
| `NEWS_API_KEY` | GNews key |
| `TELEGRAM_BOT_TOKEN` | from @BotFather |
| `TELEGRAM_WEBHOOK_SECRET` | random string; sent back by Telegram as header |
| `SHREYA_TG_USER_ID` | numeric Telegram user ID allowed to control the bot |
| `SHREYA_TG_CHAT_ID` | chat to send drafts to (same as user ID for a private chat) |
| `RESEND_API_KEY` | Resend key |
| `RESEND_WEBHOOK_SECRET` | Svix signing secret for Resend webhooks |
| `MAIL_FROM` | `The Dispatch <onboarding@resend.dev>` |
| `MAIL_REPLY_TO` | user's own inbox |
| `SEND_ALLOWLIST` | comma-separated emails that may really receive mail in demo mode |
| `DEMO_MODE` | `true` → only `SEND_ALLOWLIST` gets real mail; others logged as `skipped_demo` |
| `CRON_SECRET` | Vercel sends `Authorization: Bearer <CRON_SECRET>` to cron routes |
| `ADMIN_TOKEN` | protects `/api/admin/*` and manual-run buttons |
| `UNSUB_SIGNING_KEY` | HMAC key for unsubscribe tokens |
| `APP_URL` | public base URL (e.g. `https://dispatch-xxx.vercel.app`) |

## 10. Definition of done (whole project)

- Every requirement R1–R20 in `docs/01-PRODUCT-SPEC.md` has a passing acceptance check listed in `docs/08-TESTING-DEMO-SUBMISSION.md`.
- `npm run demo:week` runs a full simulated week end-to-end against live feeds and Gemini, with Telegram confirmation done by hand and the send going only to the allowlist.
- Public URL shows: landing/subscribe, issue archive, live dashboard with real run logs, unsubscribe page.
- README, `.env.example`, Components Map and `docs/` are in the repo.
- No secrets in git history.

# The Dispatch — Newsletter Intelligence Engine

An automated pipeline for Shreya's weekly newsletter on the Indian startup ecosystem
(Problem Statement 17, MESA Cohort C4 — AI and its Applications).

- **Mon–Wed** — ingest articles from 20+ RSS feeds and GNews queries; store and de-duplicate them.
- **Wed afternoon** — Gemini Flash picks 8–10 stories and drafts 2–3 lines of commentary each in Shreya's documented voice.
- **Wed evening** — the draft goes to Shreya on Telegram; she keeps, edits or swaps each story, then confirms.
- **Wed 10 PM** — reminder if she hasn't confirmed.
- **Thu morning** — only if confirmed, the issue is rendered as an email and sent via Resend. Unsubscribes and bounces update the list.

The system never sends without Shreya's explicit confirmation. A code gate (`assertSendAllowed`) enforces it.

## Status

Built phase by phase per [`docs/07-BUILD-PLAN.md`](docs/07-BUILD-PLAN.md). Live: https://the-dispatch-pi.vercel.app (health: [`/api/health`](https://the-dispatch-pi.vercel.app/api/health)).

| Phase | Scope | Status |
|---|---|---|
| 0 | Foundations, decisions, deploy | Done |
| 1 | Database and seed | Done |
| 2 | Ingest | Done |
| 3 | Dedupe | Done |
| 4 | Gemini selection | Done |
| 5 | State machine and send gate | Done |
| 6 | Telegram | — |
| 7 | Email and send | — |
| 8 | Public site and dashboard | — |
| 9 | Crons and full rehearsal | — |
| 10 | Hardening and submission | — |

## Stack

Next.js 16 (App Router, TypeScript strict) on Vercel Hobby · Neon Postgres · Gemini Flash (`@google/genai`) · GNews + RSS · Telegram Bot API · Resend · Vitest.

## Local setup

Requires Node 24.

```bash
npm install
cp .env.example .env.local   # fill in values; see the comments in the file
npm run db:migrate           # create tables in Neon
npm run seed                 # sources, style guide, 4 [SEED] past issues, 2,200 subscribers
npm run dev
```

| Script | What it does |
|---|---|
| `npm run dev` | Local dev server |
| `npm run build` | Production build |
| `npm run typecheck` | Generate route types, then `tsc --noEmit` |
| `npm run lint` | ESLint |
| `npm test` | Vitest unit tests (no network) |
| `npm run check` | typecheck + lint + test (run after every phase) |
| `npm run db:generate` | Generate a migration from `db/schema.ts` |
| `npm run db:migrate` | Apply migrations (Neon direct connection) |
| `npm run probe` | Check every RSS feed; `-- --gnews` also checks news queries (spends quota) |
| `npm run seed:issues` | Rebuild `db/seed/past-issues.json` from GNews (`-- --force`; spends ~15 requests) |
| `npm run seed` | Re-runnable seed; prints the resulting counts |
| `npm run test:db` | Integration tests against the real database |

## Environment variables

All variables are documented in [`.env.example`](.env.example) and [`CLAUDE.md`](CLAUDE.md) §9.
`GET /api/health` reports which integrations are configured (booleans only, never values).

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

## Known limits

Filled in as the build progresses (Hobby cron precision, free-tier caps, Resend sender limits, synthetic subscribers).

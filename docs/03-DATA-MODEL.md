# 03 — Data model (Neon Postgres)

Define in Drizzle (`db/schema.ts`) and generate migrations with `drizzle-kit`. The SQL below is the intended shape. Enable `pg_trgm` and `citext` in the first migration.

```sql
create extension if not exists pg_trgm;
create extension if not exists citext;
create extension if not exists pgcrypto;

create type issue_status as enum
  ('COLLECTING','DRAFTING','IN_REVIEW','CONFIRMED','SENDING','SENT','HELD');
create type article_status as enum
  ('new','duplicate','seen_before','candidate','selected','backup','rejected');
create type story_role as enum ('pick','backup');
create type story_state as enum ('PENDING','KEPT','EDITED','SWAPPED_OUT');
create type subscriber_status as enum
  ('pending','active','unsubscribed','bounced','complained');
create type send_status as enum
  ('queued','sent','skipped_demo','skipped_inactive','failed');

create table sources (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('rss','gnews')),
  name text not null,
  url_or_query text not null,
  active boolean not null default true,
  consecutive_failures int not null default 0,
  last_ok_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  unique (kind, url_or_query)
);

create table issues (
  id uuid primary key default gen_random_uuid(),
  issue_date date not null unique,               -- the Thursday, IST
  slug text not null unique,                     -- e.g. 2026-10-15
  status issue_status not null default 'COLLECTING',
  window_start timestamptz not null,
  window_end timestamptz not null,
  subject text,
  needs_attention boolean not null default false,
  content_hash text,                             -- set at confirm
  confirmed_at timestamptz,
  confirmed_by bigint,                           -- Telegram user id
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table articles (
  id uuid primary key default gen_random_uuid(),
  issue_id uuid not null references issues(id),
  source_id uuid references sources(id),
  url text not null,
  canonical_url text not null,
  canonical_hash text not null unique,           -- sha256(canonical_url); global dedupe
  title text not null,
  title_norm text not null,
  snippet text,
  publisher text,
  published_at timestamptz,
  fetched_at timestamptz not null default now(),
  entities text[] not null default '{}',
  status article_status not null default 'new',
  duplicate_of uuid references articles(id),
  seen_in_issue uuid references issues(id),      -- set when matched to last-4
  similarity real,                               -- score that caused duplicate/seen mark
  raw jsonb
);
create index articles_issue_status_idx on articles (issue_id, status);
create index articles_title_trgm_idx on articles using gin (title_norm gin_trgm_ops);
create index articles_published_idx on articles (published_at desc);

create table issue_stories (
  id uuid primary key default gen_random_uuid(),
  issue_id uuid not null references issues(id) on delete cascade,
  article_id uuid not null references articles(id),
  role story_role not null,
  position int,                                  -- 1..10 for picks, null for backups
  backup_rank int,                               -- 1..5 for backups
  topic text not null,
  signal_type text not null check (signal_type in
    ('counterintuitive','under_reported','trend_link')),
  rationale text not null,
  headline text not null,                        -- shown in email (default = article title, may be edited)
  commentary_ai text not null,
  commentary_final text not null,                -- equals ai until edited
  state story_state not null default 'PENDING',
  edited boolean not null default false,
  flags jsonb not null default '[]',             -- e.g. ["ungrounded_number:42%"]
  swapped_from uuid references issue_stories(id),
  created_at timestamptz not null default now(),
  unique (issue_id, article_id)
);
create unique index issue_stories_pos_uq on issue_stories (issue_id, position)
  where role = 'pick' and state <> 'SWAPPED_OUT';
create index issue_stories_issue_idx on issue_stories (issue_id, role);

create table telegram_messages (
  id uuid primary key default gen_random_uuid(),
  issue_id uuid not null references issues(id) on delete cascade,
  story_id uuid references issue_stories(id) on delete cascade,
  chat_id bigint not null,
  message_id bigint not null,
  kind text not null check (kind in ('header','story','final','reminder','alert')),
  created_at timestamptz not null default now(),
  unique (chat_id, message_id)
);

create table telegram_pending (                  -- waiting for Shreya's edit text
  chat_id bigint primary key,
  issue_id uuid not null references issues(id) on delete cascade,
  story_id uuid not null references issue_stories(id) on delete cascade,
  prompt_message_id bigint not null,
  pending_text text,                             -- edit that failed voice lint, kept for "Use anyway" (migration 0002)
  expires_at timestamptz not null
);

create table approvals (                         -- audit trail
  id uuid primary key default gen_random_uuid(),
  issue_id uuid not null references issues(id) on delete cascade,
  story_id uuid references issue_stories(id),
  action text not null check (action in
    ('keep','edit','swap','approve_all','confirm','unconfirm','hold','send_now','reset_by_edit','remove')),
  actor_tg_id bigint,
  content_hash text,
  detail jsonb,
  at timestamptz not null default now()
);

create table subscribers (
  id uuid primary key default gen_random_uuid(),
  email citext not null unique,
  status subscriber_status not null default 'active',
  source text not null default 'seed',           -- seed | form | import
  is_test boolean not null default false,
  token uuid not null default gen_random_uuid(),
  created_at timestamptz not null default now(),
  confirmed_at timestamptz,
  unsubscribed_at timestamptz,
  bounced_at timestamptz,
  bounce_type text,
  last_event text
);
create index subscribers_status_idx on subscribers (status);

create table send_log (
  id uuid primary key default gen_random_uuid(),
  issue_id uuid not null references issues(id) on delete cascade,
  subscriber_id uuid not null references subscribers(id),
  batch_no int,
  resend_id text,
  status send_status not null default 'queued',
  error text,
  at timestamptz not null default now(),
  unique (issue_id, subscriber_id)
);

create table email_events (
  id uuid primary key default gen_random_uuid(),
  svix_id text not null unique,
  resend_id text,
  type text not null,
  subscriber_id uuid references subscribers(id),
  payload jsonb,
  at timestamptz not null default now()
);

create table pipeline_runs (
  id uuid primary key default gen_random_uuid(),
  job text not null,                             -- ingest|curate|notify|remind|send
  issue_id uuid references issues(id),
  trigger text not null check (trigger in ('cron','manual','demo')),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  ok boolean,
  stats jsonb,                                   -- per-source counts, tokens, etc.
  error text
);
create index pipeline_runs_job_idx on pipeline_runs (job, started_at desc);

create table style_examples (                    -- few-shot memory from Shreya's edits
  id uuid primary key default gen_random_uuid(),
  issue_id uuid references issues(id),
  article_title text not null,
  ai_text text not null,
  final_text text not null,
  similarity real not null,                      -- 1.0 = unedited
  created_at timestamptz not null default now()
);

-- Added 2026-10-12 (user decision: style guide stored in Neon, per the Components Map).
create table style_guides (                      -- versioned copy of content/style-guide.md
  id uuid primary key default gen_random_uuid(),
  version int not null unique,
  content text not null,
  content_hash text not null unique,             -- sha256(content); re-seeding an unchanged file is a no-op
  has_fill_markers boolean not null,             -- curate refuses to run while true
  active boolean not null default false,
  created_at timestamptz not null default now()
);
create unique index style_guides_one_active_uq on style_guides (active) where active;
```

Migrations: `db/migrations/0000_extensions.sql` (custom: the three extensions) runs before `0001_init.sql` (generated from `db/schema.ts`). `npm run db:migrate` applies them over Neon's direct (non-pooled) host.

## Rules

- `articles.canonical_hash` is **globally unique**. Inserting an already-known URL is a no-op (`ON CONFLICT DO NOTHING`). An article that appeared in an earlier week never re-enters.
- `issue_stories` holds picks and backups. Swapping marks the old pick `SWAPPED_OUT`, promotes the next backup into the freed `position`, and records `swapped_from`.
- `content_hash` is set only at confirm and cleared by any later change.
- `send_log` unique `(issue_id, subscriber_id)` is what makes the send resumable and double-send-proof.
- Subscriber statuses that may receive mail: `active` only.
- Use a transaction (Neon WebSocket Pool driver, not the HTTP driver) for review actions (keep, edit, swap, remove, approve all) and confirm. Send batches are claimed with one `INSERT … SELECT … ON CONFLICT DO NOTHING RETURNING` on the unique `send_log` row instead of `FOR UPDATE SKIP LOCKED` (see `DECISIONS.md`).

## Seed data (required for R19)

`npm run seed` must be re-runnable (`ON CONFLICT DO NOTHING`) and create:

1. **Sources**: from `content/sources.seed.json`. Final list approved in Phase 2: **20 RSS feeds + 5 GNews queries** (the starter list had 10 queries).
2. **Four past issues**, status `SENT`, dated the previous four Thursdays, each with 8–10 stories (headline, URL, topic, commentary). User decision 2026-10-12: stories are **real articles** fetched from GNews for each past week by `npm run seed:issues` (`scripts/build-seed-issues.ts`, ~12–18 requests), cached in `db/seed/past-issues.json` (titles, links, publishers only). Subjects start with `[SEED]`. Commentary is the fixed placeholder `[SEED] Placeholder commentary…`, never Shreya's voice. Topics rotate so all nine appear across the four issues, so the Last-4 filter has something to bite on.
3. **Subscribers**: 2,200 rows.
   - 1 real: the user's own email, `active`, from `SEND_ALLOWLIST`.
   - If approved: 3 Resend test addresses (`delivered@`, `bounced@`, `complained@resend.dev`), `active`, `is_test=true`.
   - 1 `unsubscribed` and 1 `bounced` example to show the statuses.
   - The rest synthetic `user0001@example.invalid` style, `active`, `is_test=true`, never really emailed (demo mode logs `skipped_demo`).
4. **Style guide**: `content/style-guide.md` (written by the user, see `docs/09-STYLE-GUIDE-TEMPLATE.md`) is copied into `style_guides` as a new active version whenever its content changes.
5. **Style examples**: **none seeded** (user decision 2026-10-12). Seed commentary is placeholder text and must never teach Gemini a voice. On day one the style guide's own Examples section (sent in full on every run) carries the voice; `style_examples` fills from Shreya's real edits.

-- Required before any table: citext (subscribers.email), pg_trgm (title similarity
-- + GIN index), pgcrypto (gen_random_uuid on older Postgres; harmless on 13+).
CREATE EXTENSION IF NOT EXISTS pg_trgm;--> statement-breakpoint
CREATE EXTENSION IF NOT EXISTS citext;--> statement-breakpoint
CREATE EXTENSION IF NOT EXISTS pgcrypto;

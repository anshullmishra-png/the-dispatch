CREATE TYPE "public"."article_status" AS ENUM('new', 'duplicate', 'seen_before', 'candidate', 'selected', 'backup', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."issue_status" AS ENUM('COLLECTING', 'DRAFTING', 'IN_REVIEW', 'CONFIRMED', 'SENDING', 'SENT', 'HELD');--> statement-breakpoint
CREATE TYPE "public"."send_status" AS ENUM('queued', 'sent', 'skipped_demo', 'skipped_inactive', 'failed');--> statement-breakpoint
CREATE TYPE "public"."story_role" AS ENUM('pick', 'backup');--> statement-breakpoint
CREATE TYPE "public"."story_state" AS ENUM('PENDING', 'KEPT', 'EDITED', 'SWAPPED_OUT');--> statement-breakpoint
CREATE TYPE "public"."subscriber_status" AS ENUM('pending', 'active', 'unsubscribed', 'bounced', 'complained');--> statement-breakpoint
CREATE TABLE "approvals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"issue_id" uuid NOT NULL,
	"story_id" uuid,
	"action" text NOT NULL,
	"actor_tg_id" bigint,
	"content_hash" text,
	"detail" jsonb,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "approvals_action_check" CHECK ("approvals"."action" in ('keep','edit','swap','approve_all','confirm','unconfirm','hold','send_now','reset_by_edit'))
);
--> statement-breakpoint
CREATE TABLE "articles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"issue_id" uuid NOT NULL,
	"source_id" uuid,
	"url" text NOT NULL,
	"canonical_url" text NOT NULL,
	"canonical_hash" text NOT NULL,
	"title" text NOT NULL,
	"title_norm" text NOT NULL,
	"snippet" text,
	"publisher" text,
	"published_at" timestamp with time zone,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL,
	"entities" text[] DEFAULT '{}'::text[] NOT NULL,
	"status" "article_status" DEFAULT 'new' NOT NULL,
	"duplicate_of" uuid,
	"seen_in_issue" uuid,
	"similarity" real,
	"raw" jsonb,
	CONSTRAINT "articles_canonical_hash_unique" UNIQUE("canonical_hash")
);
--> statement-breakpoint
CREATE TABLE "email_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"svix_id" text NOT NULL,
	"resend_id" text,
	"type" text NOT NULL,
	"subscriber_id" uuid,
	"payload" jsonb,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "email_events_svix_id_unique" UNIQUE("svix_id")
);
--> statement-breakpoint
CREATE TABLE "issue_stories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"issue_id" uuid NOT NULL,
	"article_id" uuid NOT NULL,
	"role" "story_role" NOT NULL,
	"position" integer,
	"backup_rank" integer,
	"topic" text NOT NULL,
	"signal_type" text NOT NULL,
	"rationale" text NOT NULL,
	"headline" text NOT NULL,
	"commentary_ai" text NOT NULL,
	"commentary_final" text NOT NULL,
	"state" "story_state" DEFAULT 'PENDING' NOT NULL,
	"edited" boolean DEFAULT false NOT NULL,
	"flags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"swapped_from" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "issue_stories_issue_id_article_id_key" UNIQUE("issue_id","article_id"),
	CONSTRAINT "issue_stories_signal_type_check" CHECK ("issue_stories"."signal_type" in ('counterintuitive','under_reported','trend_link'))
);
--> statement-breakpoint
CREATE TABLE "issues" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"issue_date" date NOT NULL,
	"slug" text NOT NULL,
	"status" "issue_status" DEFAULT 'COLLECTING' NOT NULL,
	"window_start" timestamp with time zone NOT NULL,
	"window_end" timestamp with time zone NOT NULL,
	"subject" text,
	"needs_attention" boolean DEFAULT false NOT NULL,
	"content_hash" text,
	"confirmed_at" timestamp with time zone,
	"confirmed_by" bigint,
	"sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "issues_issue_date_unique" UNIQUE("issue_date"),
	CONSTRAINT "issues_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "pipeline_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job" text NOT NULL,
	"issue_id" uuid,
	"trigger" text NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"ok" boolean,
	"stats" jsonb,
	"error" text,
	CONSTRAINT "pipeline_runs_trigger_check" CHECK ("pipeline_runs"."trigger" in ('cron','manual','demo'))
);
--> statement-breakpoint
CREATE TABLE "send_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"issue_id" uuid NOT NULL,
	"subscriber_id" uuid NOT NULL,
	"batch_no" integer,
	"resend_id" text,
	"status" "send_status" DEFAULT 'queued' NOT NULL,
	"error" text,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "send_log_issue_id_subscriber_id_key" UNIQUE("issue_id","subscriber_id")
);
--> statement-breakpoint
CREATE TABLE "sources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"name" text NOT NULL,
	"url_or_query" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"consecutive_failures" integer DEFAULT 0 NOT NULL,
	"last_ok_at" timestamp with time zone,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sources_kind_url_or_query_key" UNIQUE("kind","url_or_query"),
	CONSTRAINT "sources_kind_check" CHECK ("sources"."kind" in ('rss','gnews'))
);
--> statement-breakpoint
CREATE TABLE "style_examples" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"issue_id" uuid,
	"article_title" text NOT NULL,
	"ai_text" text NOT NULL,
	"final_text" text NOT NULL,
	"similarity" real NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "style_guides" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"version" integer NOT NULL,
	"content" text NOT NULL,
	"content_hash" text NOT NULL,
	"has_fill_markers" boolean NOT NULL,
	"active" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "style_guides_version_unique" UNIQUE("version"),
	CONSTRAINT "style_guides_content_hash_unique" UNIQUE("content_hash")
);
--> statement-breakpoint
CREATE TABLE "subscribers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" "citext" NOT NULL,
	"status" "subscriber_status" DEFAULT 'active' NOT NULL,
	"source" text DEFAULT 'seed' NOT NULL,
	"is_test" boolean DEFAULT false NOT NULL,
	"token" uuid DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"confirmed_at" timestamp with time zone,
	"unsubscribed_at" timestamp with time zone,
	"bounced_at" timestamp with time zone,
	"bounce_type" text,
	"last_event" text,
	CONSTRAINT "subscribers_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "telegram_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"issue_id" uuid NOT NULL,
	"story_id" uuid,
	"chat_id" bigint NOT NULL,
	"message_id" bigint NOT NULL,
	"kind" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "telegram_messages_chat_id_message_id_key" UNIQUE("chat_id","message_id"),
	CONSTRAINT "telegram_messages_kind_check" CHECK ("telegram_messages"."kind" in ('header','story','final','reminder','alert'))
);
--> statement-breakpoint
CREATE TABLE "telegram_pending" (
	"chat_id" bigint PRIMARY KEY NOT NULL,
	"issue_id" uuid NOT NULL,
	"story_id" uuid NOT NULL,
	"prompt_message_id" bigint NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "approvals" ADD CONSTRAINT "approvals_issue_id_issues_id_fk" FOREIGN KEY ("issue_id") REFERENCES "public"."issues"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approvals" ADD CONSTRAINT "approvals_story_id_issue_stories_id_fk" FOREIGN KEY ("story_id") REFERENCES "public"."issue_stories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "articles" ADD CONSTRAINT "articles_issue_id_issues_id_fk" FOREIGN KEY ("issue_id") REFERENCES "public"."issues"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "articles" ADD CONSTRAINT "articles_source_id_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."sources"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "articles" ADD CONSTRAINT "articles_duplicate_of_articles_id_fk" FOREIGN KEY ("duplicate_of") REFERENCES "public"."articles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "articles" ADD CONSTRAINT "articles_seen_in_issue_issues_id_fk" FOREIGN KEY ("seen_in_issue") REFERENCES "public"."issues"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_events" ADD CONSTRAINT "email_events_subscriber_id_subscribers_id_fk" FOREIGN KEY ("subscriber_id") REFERENCES "public"."subscribers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_stories" ADD CONSTRAINT "issue_stories_issue_id_issues_id_fk" FOREIGN KEY ("issue_id") REFERENCES "public"."issues"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_stories" ADD CONSTRAINT "issue_stories_article_id_articles_id_fk" FOREIGN KEY ("article_id") REFERENCES "public"."articles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_stories" ADD CONSTRAINT "issue_stories_swapped_from_issue_stories_id_fk" FOREIGN KEY ("swapped_from") REFERENCES "public"."issue_stories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pipeline_runs" ADD CONSTRAINT "pipeline_runs_issue_id_issues_id_fk" FOREIGN KEY ("issue_id") REFERENCES "public"."issues"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "send_log" ADD CONSTRAINT "send_log_issue_id_issues_id_fk" FOREIGN KEY ("issue_id") REFERENCES "public"."issues"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "send_log" ADD CONSTRAINT "send_log_subscriber_id_subscribers_id_fk" FOREIGN KEY ("subscriber_id") REFERENCES "public"."subscribers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "style_examples" ADD CONSTRAINT "style_examples_issue_id_issues_id_fk" FOREIGN KEY ("issue_id") REFERENCES "public"."issues"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "telegram_messages" ADD CONSTRAINT "telegram_messages_issue_id_issues_id_fk" FOREIGN KEY ("issue_id") REFERENCES "public"."issues"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "telegram_messages" ADD CONSTRAINT "telegram_messages_story_id_issue_stories_id_fk" FOREIGN KEY ("story_id") REFERENCES "public"."issue_stories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "telegram_pending" ADD CONSTRAINT "telegram_pending_issue_id_issues_id_fk" FOREIGN KEY ("issue_id") REFERENCES "public"."issues"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "telegram_pending" ADD CONSTRAINT "telegram_pending_story_id_issue_stories_id_fk" FOREIGN KEY ("story_id") REFERENCES "public"."issue_stories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "articles_issue_status_idx" ON "articles" USING btree ("issue_id","status");--> statement-breakpoint
CREATE INDEX "articles_title_trgm_idx" ON "articles" USING gin ("title_norm" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "articles_published_idx" ON "articles" USING btree ("published_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "issue_stories_pos_uq" ON "issue_stories" USING btree ("issue_id","position") WHERE "issue_stories"."role" = 'pick' and "issue_stories"."state" <> 'SWAPPED_OUT';--> statement-breakpoint
CREATE INDEX "issue_stories_issue_idx" ON "issue_stories" USING btree ("issue_id","role");--> statement-breakpoint
CREATE INDEX "pipeline_runs_job_idx" ON "pipeline_runs" USING btree ("job","started_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "style_guides_one_active_uq" ON "style_guides" USING btree ("active") WHERE "style_guides"."active";--> statement-breakpoint
CREATE INDEX "subscribers_status_idx" ON "subscribers" USING btree ("status");
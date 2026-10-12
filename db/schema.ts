// Mirrors docs/03-DATA-MODEL.md. Change both in the same commit, with a migration.
import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  bigint,
  boolean,
  check,
  customType,
  date,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  real,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

const citext = customType<{ data: string }>({
  dataType: () => "citext",
});

const id = () => uuid("id").primaryKey().defaultRandom();
const tstz = (name: string) => timestamp(name, { withTimezone: true });
// Telegram ids have at most 52 significant bits, so a JS number is exact.
const tgId = (name: string) => bigint(name, { mode: "number" });

export const issueStatus = pgEnum("issue_status", [
  "COLLECTING",
  "DRAFTING",
  "IN_REVIEW",
  "CONFIRMED",
  "SENDING",
  "SENT",
  "HELD",
]);
export const articleStatus = pgEnum("article_status", [
  "new",
  "duplicate",
  "seen_before",
  "candidate",
  "selected",
  "backup",
  "rejected",
]);
export const storyRole = pgEnum("story_role", ["pick", "backup"]);
export const storyState = pgEnum("story_state", ["PENDING", "KEPT", "EDITED", "SWAPPED_OUT"]);
export const subscriberStatus = pgEnum("subscriber_status", [
  "pending",
  "active",
  "unsubscribed",
  "bounced",
  "complained",
]);
export const sendStatus = pgEnum("send_status", [
  "queued",
  "sent",
  "skipped_demo",
  "skipped_inactive",
  "failed",
]);

export const sources = pgTable(
  "sources",
  {
    id: id(),
    kind: text("kind").notNull(),
    name: text("name").notNull(),
    urlOrQuery: text("url_or_query").notNull(),
    active: boolean("active").notNull().default(true),
    consecutiveFailures: integer("consecutive_failures").notNull().default(0),
    lastOkAt: tstz("last_ok_at"),
    lastError: text("last_error"),
    createdAt: tstz("created_at").notNull().defaultNow(),
  },
  (t) => [
    unique("sources_kind_url_or_query_key").on(t.kind, t.urlOrQuery),
    check("sources_kind_check", sql`${t.kind} in ('rss','gnews')`),
  ],
);

export const issues = pgTable("issues", {
  id: id(),
  issueDate: date("issue_date", { mode: "string" }).notNull().unique(),
  slug: text("slug").notNull().unique(),
  status: issueStatus("status").notNull().default("COLLECTING"),
  windowStart: tstz("window_start").notNull(),
  windowEnd: tstz("window_end").notNull(),
  subject: text("subject"),
  needsAttention: boolean("needs_attention").notNull().default(false),
  contentHash: text("content_hash"),
  confirmedAt: tstz("confirmed_at"),
  confirmedBy: tgId("confirmed_by"),
  sentAt: tstz("sent_at"),
  createdAt: tstz("created_at").notNull().defaultNow(),
  updatedAt: tstz("updated_at").notNull().defaultNow(),
});

export const articles = pgTable(
  "articles",
  {
    id: id(),
    issueId: uuid("issue_id")
      .notNull()
      .references(() => issues.id),
    sourceId: uuid("source_id").references(() => sources.id),
    url: text("url").notNull(),
    canonicalUrl: text("canonical_url").notNull(),
    canonicalHash: text("canonical_hash").notNull().unique(),
    title: text("title").notNull(),
    titleNorm: text("title_norm").notNull(),
    snippet: text("snippet"),
    publisher: text("publisher"),
    publishedAt: tstz("published_at"),
    fetchedAt: tstz("fetched_at").notNull().defaultNow(),
    entities: text("entities").array().notNull().default(sql`'{}'::text[]`),
    status: articleStatus("status").notNull().default("new"),
    duplicateOf: uuid("duplicate_of").references((): AnyPgColumn => articles.id),
    seenInIssue: uuid("seen_in_issue").references(() => issues.id),
    similarity: real("similarity"),
    raw: jsonb("raw"),
  },
  (t) => [
    index("articles_issue_status_idx").on(t.issueId, t.status),
    index("articles_title_trgm_idx").using("gin", t.titleNorm.op("gin_trgm_ops")),
    index("articles_published_idx").on(t.publishedAt.desc()),
  ],
);

export const issueStories = pgTable(
  "issue_stories",
  {
    id: id(),
    issueId: uuid("issue_id")
      .notNull()
      .references(() => issues.id, { onDelete: "cascade" }),
    articleId: uuid("article_id")
      .notNull()
      .references(() => articles.id),
    role: storyRole("role").notNull(),
    position: integer("position"),
    backupRank: integer("backup_rank"),
    topic: text("topic").notNull(),
    signalType: text("signal_type").notNull(),
    rationale: text("rationale").notNull(),
    headline: text("headline").notNull(),
    commentaryAi: text("commentary_ai").notNull(),
    commentaryFinal: text("commentary_final").notNull(),
    state: storyState("state").notNull().default("PENDING"),
    edited: boolean("edited").notNull().default(false),
    flags: jsonb("flags").notNull().default(sql`'[]'::jsonb`),
    swappedFrom: uuid("swapped_from").references((): AnyPgColumn => issueStories.id),
    createdAt: tstz("created_at").notNull().defaultNow(),
  },
  (t) => [
    unique("issue_stories_issue_id_article_id_key").on(t.issueId, t.articleId),
    check(
      "issue_stories_signal_type_check",
      sql`${t.signalType} in ('counterintuitive','under_reported','trend_link')`,
    ),
    uniqueIndex("issue_stories_pos_uq")
      .on(t.issueId, t.position)
      .where(sql`${t.role} = 'pick' and ${t.state} <> 'SWAPPED_OUT'`),
    index("issue_stories_issue_idx").on(t.issueId, t.role),
  ],
);

export const telegramMessages = pgTable(
  "telegram_messages",
  {
    id: id(),
    issueId: uuid("issue_id")
      .notNull()
      .references(() => issues.id, { onDelete: "cascade" }),
    storyId: uuid("story_id").references(() => issueStories.id, { onDelete: "cascade" }),
    chatId: tgId("chat_id").notNull(),
    messageId: tgId("message_id").notNull(),
    kind: text("kind").notNull(),
    createdAt: tstz("created_at").notNull().defaultNow(),
  },
  (t) => [
    unique("telegram_messages_chat_id_message_id_key").on(t.chatId, t.messageId),
    check(
      "telegram_messages_kind_check",
      sql`${t.kind} in ('header','story','final','reminder','alert')`,
    ),
  ],
);

export const telegramPending = pgTable("telegram_pending", {
  chatId: tgId("chat_id").primaryKey(),
  issueId: uuid("issue_id")
    .notNull()
    .references(() => issues.id, { onDelete: "cascade" }),
  storyId: uuid("story_id")
    .notNull()
    .references(() => issueStories.id, { onDelete: "cascade" }),
  promptMessageId: tgId("prompt_message_id").notNull(),
  // An edit that failed voice lint, held until Shreya taps "Use anyway" or resends.
  pendingText: text("pending_text"),
  expiresAt: tstz("expires_at").notNull(),
});

export const approvals = pgTable(
  "approvals",
  {
    id: id(),
    issueId: uuid("issue_id")
      .notNull()
      .references(() => issues.id, { onDelete: "cascade" }),
    storyId: uuid("story_id").references(() => issueStories.id),
    action: text("action").notNull(),
    actorTgId: tgId("actor_tg_id"),
    contentHash: text("content_hash"),
    detail: jsonb("detail"),
    at: tstz("at").notNull().defaultNow(),
  },
  (t) => [
    check(
      "approvals_action_check",
      sql`${t.action} in ('keep','edit','swap','approve_all','confirm','unconfirm','hold','send_now','reset_by_edit','remove')`,
    ),
  ],
);

export const subscribers = pgTable(
  "subscribers",
  {
    id: id(),
    email: citext("email").notNull().unique(),
    status: subscriberStatus("status").notNull().default("active"),
    source: text("source").notNull().default("seed"),
    isTest: boolean("is_test").notNull().default(false),
    token: uuid("token").notNull().defaultRandom(),
    createdAt: tstz("created_at").notNull().defaultNow(),
    confirmedAt: tstz("confirmed_at"),
    unsubscribedAt: tstz("unsubscribed_at"),
    bouncedAt: tstz("bounced_at"),
    bounceType: text("bounce_type"),
    lastEvent: text("last_event"),
  },
  (t) => [index("subscribers_status_idx").on(t.status)],
);

export const sendLog = pgTable(
  "send_log",
  {
    id: id(),
    issueId: uuid("issue_id")
      .notNull()
      .references(() => issues.id, { onDelete: "cascade" }),
    subscriberId: uuid("subscriber_id")
      .notNull()
      .references(() => subscribers.id),
    batchNo: integer("batch_no"),
    resendId: text("resend_id"),
    status: sendStatus("status").notNull().default("queued"),
    error: text("error"),
    at: tstz("at").notNull().defaultNow(),
  },
  (t) => [unique("send_log_issue_id_subscriber_id_key").on(t.issueId, t.subscriberId)],
);

export const emailEvents = pgTable("email_events", {
  id: id(),
  svixId: text("svix_id").notNull().unique(),
  resendId: text("resend_id"),
  type: text("type").notNull(),
  subscriberId: uuid("subscriber_id").references(() => subscribers.id),
  payload: jsonb("payload"),
  at: tstz("at").notNull().defaultNow(),
});

export const pipelineRuns = pgTable(
  "pipeline_runs",
  {
    id: id(),
    job: text("job").notNull(),
    issueId: uuid("issue_id").references(() => issues.id),
    trigger: text("trigger").notNull(),
    startedAt: tstz("started_at").notNull().defaultNow(),
    finishedAt: tstz("finished_at"),
    ok: boolean("ok"),
    stats: jsonb("stats"),
    error: text("error"),
  },
  (t) => [
    check("pipeline_runs_trigger_check", sql`${t.trigger} in ('cron','manual','demo')`),
    index("pipeline_runs_job_idx").on(t.job, t.startedAt.desc()),
  ],
);

export const styleExamples = pgTable("style_examples", {
  id: id(),
  issueId: uuid("issue_id").references(() => issues.id),
  articleTitle: text("article_title").notNull(),
  aiText: text("ai_text").notNull(),
  finalText: text("final_text").notNull(),
  similarity: real("similarity").notNull(),
  createdAt: tstz("created_at").notNull().defaultNow(),
});

// Versioned copy of content/style-guide.md (user decision: style guide lives in Neon).
export const styleGuides = pgTable(
  "style_guides",
  {
    id: id(),
    version: integer("version").notNull().unique(),
    content: text("content").notNull(),
    contentHash: text("content_hash").notNull().unique(),
    hasFillMarkers: boolean("has_fill_markers").notNull(),
    active: boolean("active").notNull().default(false),
    createdAt: tstz("created_at").notNull().defaultNow(),
  },
  (t) => [uniqueIndex("style_guides_one_active_uq").on(t.active).where(sql`${t.active}`)],
);

export type Issue = typeof issues.$inferSelect;
export type Article = typeof articles.$inferSelect;
export type NewArticle = typeof articles.$inferInsert;
export type IssueStory = typeof issueStories.$inferSelect;
export type Source = typeof sources.$inferSelect;
export type Subscriber = typeof subscribers.$inferSelect;
export type PipelineRun = typeof pipelineRuns.$inferSelect;
export type StyleGuide = typeof styleGuides.$inferSelect;

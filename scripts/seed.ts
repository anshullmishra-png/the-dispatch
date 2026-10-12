// Re-runnable seed (docs/03-DATA-MODEL.md "Seed data"). Every insert is
// ON CONFLICT DO NOTHING, so running it twice changes nothing.
import "./_env";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { eq, sql } from "drizzle-orm";
import { articles, issueStories, issues, sources, styleGuides, subscribers } from "@/db/schema";
import { buildSubscriberRows } from "@/db/seed/subscribers";
import { db, withTransaction } from "@/lib/db";
import { canonicalizeUrl, hashUrl } from "@/lib/dedupe/canonical";
import { extractEntities, normalizeTitle } from "@/lib/dedupe/normalize";
import { requireEnv } from "@/lib/env";
import { formatIssueDateShort, issueWindow, istToUtc } from "@/lib/time";

// User decision 2026-10-12: neutral filler, never sent to Gemini as voice.
const PLACEHOLDER_COMMENTARY =
  "[SEED] Placeholder commentary. Not written by Shreya and never used as a voice example.";

interface SourcesFile {
  rss: { name: string; url: string }[];
  gnews: string[];
}
interface SeedFile {
  issues: {
    issueDate: string;
    stories: {
      position: number;
      topic: string;
      query: string;
      title: string;
      url: string;
      publisher: string;
      publishedAt: string;
    }[];
  }[];
}

const readJson = <T>(path: string): T => JSON.parse(readFileSync(path, "utf8")) as T;

/**
 * Syncs the sources table to content/sources.seed.json: inserts new entries,
 * deletes unlisted ones that no article references, and pauses the rest.
 * Listed sources are never re-activated here: an auto-paused feed stays paused.
 */
async function seedSources() {
  const file = readJson<SourcesFile>("content/sources.seed.json");
  const rows = [
    ...file.rss.map((s) => ({ kind: "rss", name: s.name, urlOrQuery: s.url })),
    ...file.gnews.map((q) => ({ kind: "gnews", name: `GNews: ${q}`, urlOrQuery: q })),
  ];
  const inserted = await db()
    .insert(sources)
    .values(rows)
    .onConflictDoNothing({ target: [sources.kind, sources.urlOrQuery] })
    .returning({ id: sources.id });

  const listed = sql.join(
    rows.map((r) => sql`(${r.kind}, ${r.urlOrQuery})`),
    sql`, `,
  );
  const deleted = await db().execute(sql`
    delete from sources s
    where (s.kind, s.url_or_query) not in (${listed})
      and not exists (select 1 from articles a where a.source_id = s.id)
    returning s.name`);
  const paused = await db().execute(sql`
    update sources set active = false
    where (kind, url_or_query) not in (${listed}) and active
    returning name`);
  return {
    listed: rows.length,
    inserted: inserted.length,
    deleted: deleted.rows.length,
    paused: paused.rows.length,
  };
}

async function seedStyleGuide() {
  const content = readFileSync("content/style-guide.md", "utf8");
  const contentHash = createHash("sha256").update(content).digest("hex");
  const hasFillMarkers = /\[FILL/.test(content);

  return withTransaction(async (tx) => {
    const [existing] = await tx.select().from(styleGuides).where(eq(styleGuides.contentHash, contentHash));
    if (existing) {
      if (!existing.active) {
        await tx.update(styleGuides).set({ active: false }).where(eq(styleGuides.active, true));
        await tx.update(styleGuides).set({ active: true }).where(eq(styleGuides.id, existing.id));
      }
      return { version: existing.version, created: false, hasFillMarkers };
    }
    const [{ max }] = await tx
      .select({ max: sql<number>`coalesce(max(${styleGuides.version}), 0)::int` })
      .from(styleGuides);
    await tx.update(styleGuides).set({ active: false }).where(eq(styleGuides.active, true));
    await tx
      .insert(styleGuides)
      .values({ version: max + 1, content, contentHash, hasFillMarkers, active: true });
    return { version: max + 1, created: true, hasFillMarkers };
  });
}

function seedSubject(issueDate: string, topHeadline: string): string {
  const head = topHeadline.length > 55 ? `${topHeadline.slice(0, 54).trimEnd()}…` : topHeadline;
  return `[SEED] The Dispatch · ${formatIssueDateShort(issueDate)} · ${head}`;
}

async function seedPastIssues() {
  const file = readJson<SeedFile>("db/seed/past-issues.json");
  const summary: { issueDate: string; stories: number; skipped: number }[] = [];

  for (const seed of file.issues) {
    const { start, end } = issueWindow(seed.issueDate);
    const sentAt = istToUtc(seed.issueDate, 8, 0);
    const confirmedAt = istToUtc(seed.issueDate, -4, 0); // Wed 20:00 IST

    const result = await withTransaction(async (tx) => {
      await tx
        .insert(issues)
        .values({
          issueDate: seed.issueDate,
          slug: seed.issueDate,
          status: "SENT",
          windowStart: start,
          windowEnd: end,
          subject: seedSubject(seed.issueDate, seed.stories[0]?.title ?? ""),
          confirmedAt,
          sentAt,
        })
        .onConflictDoNothing({ target: issues.issueDate });
      const [issue] = await tx.select({ id: issues.id }).from(issues).where(eq(issues.issueDate, seed.issueDate));
      if (!issue) throw new Error(`issue ${seed.issueDate} missing after insert`);

      let stories = 0;
      let skipped = 0;
      for (const s of seed.stories) {
        const canonicalUrl = canonicalizeUrl(s.url);
        const canonicalHash = hashUrl(canonicalUrl);
        await tx
          .insert(articles)
          .values({
            issueId: issue.id,
            url: s.url,
            canonicalUrl,
            canonicalHash,
            title: s.title,
            titleNorm: normalizeTitle(s.title),
            publisher: s.publisher,
            publishedAt: new Date(s.publishedAt),
            entities: extractEntities(s.title),
            status: "selected",
            raw: { seed: true, via: "gnews", query: s.query },
          })
          .onConflictDoNothing({ target: articles.canonicalHash });
        const [article] = await tx
          .select({ id: articles.id, issueId: articles.issueId })
          .from(articles)
          .where(eq(articles.canonicalHash, canonicalHash));
        if (!article || article.issueId !== issue.id) {
          skipped += 1; // URL already belongs to another issue
          continue;
        }
        await tx
          .insert(issueStories)
          .values({
            issueId: issue.id,
            articleId: article.id,
            role: "pick",
            position: s.position,
            topic: s.topic,
            signalType: "under_reported",
            rationale: `[SEED] Imported from GNews query "${s.query}"; no editorial judgement applied.`,
            headline: s.title,
            commentaryAi: PLACEHOLDER_COMMENTARY,
            commentaryFinal: PLACEHOLDER_COMMENTARY,
            state: "KEPT",
          })
          .onConflictDoNothing({ target: [issueStories.issueId, issueStories.articleId] });
        stories += 1;
      }
      return { stories, skipped };
    });
    summary.push({ issueDate: seed.issueDate, ...result });
  }
  return summary;
}

async function seedSubscribers() {
  const { SEND_ALLOWLIST } = requireEnv("SEND_ALLOWLIST");
  if (SEND_ALLOWLIST.length === 0) throw new Error("SEND_ALLOWLIST is empty; set your own inbox first");
  const rows = buildSubscriberRows(SEND_ALLOWLIST, new Date());
  let inserted = 0;
  for (let i = 0; i < rows.length; i += 500) {
    const chunk = rows.slice(i, i + 500);
    const res = await db()
      .insert(subscribers)
      .values(chunk)
      .onConflictDoNothing({ target: subscribers.email })
      .returning({ id: subscribers.id });
    inserted += res.length;
  }
  return { rows: rows.length, inserted };
}

async function report() {
  const q = (s: ReturnType<typeof sql>) => db().execute(s).then((r) => r.rows);
  return {
    sources: await q(sql`select kind, count(*)::int as n, count(*) filter (where active)::int as active from sources group by kind order by kind`),
    issues: await q(sql`select i.issue_date, i.status, count(s.id)::int as stories, count(distinct s.topic)::int as topics from issues i left join issue_stories s on s.issue_id = i.id group by i.id order by i.issue_date`),
    subscribers: await q(sql`select status, is_test, count(*)::int as n from subscribers group by status, is_test order by status, is_test`),
    styleGuides: await q(sql`select version, active, has_fill_markers from style_guides order by version`),
    styleExamples: await q(sql`select count(*)::int as n from style_examples`),
  };
}

async function main() {
  const started = Date.now();
  console.log("sources:", await seedSources());
  console.log("style guide:", await seedStyleGuide());
  console.log("past issues:", await seedPastIssues());
  console.log("subscribers:", await seedSubscribers());
  console.log("--- database now holds ---");
  console.dir(await report(), { depth: null });
  console.log(`seed finished in ${Date.now() - started} ms`);
}

main().catch((err: unknown) => {
  console.error("seed failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});

// Builds db/seed/past-issues.json: four placeholder past issues made of REAL
// articles from GNews (user decision 2026-10-12), so the Last-4 dedupe has real
// headlines to match against. Run once; the seed reads the cached file.
//   npm run seed:issues            → skips if the file exists
//   npm run seed:issues -- --force → rebuilds (spends ~12 GNews requests)
import "./_env";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { canonicalizeUrl, hashUrl } from "@/lib/dedupe/canonical";
import { extractEntities, normalizeTitle } from "@/lib/dedupe/normalize";
import { requireEnv } from "@/lib/env";
import { collectingIssueDate, issueWindow, previousIssueDates } from "@/lib/time";

const OUT = "db/seed/past-issues.json";
const STORIES_PER_QUERY = 3;
const GNEWS_HISTORY_DAYS = 29; // free plan serves 30 days; stay inside it

// Free-plan finding (2026-10-12): 3+ word queries return 0–2 results, while 1–2
// word queries with country=in return 10 Indian results across the date range.
// Each past week gets three topics; across four weeks all nine appear. The second
// query in each slot is a fallback if the first yields too few usable stories.
const ROTATION: { topic: string; queries: string[] }[][] = [
  [
    { topic: "funding_vc", queries: ["funding round", "raises funding"] },
    { topic: "fintech", queries: ["fintech", "payments startup"] },
    { topic: "ai_saas", queries: ["AI startup", "generative AI"] },
  ],
  [
    { topic: "consumer_d2c", queries: ["D2C", "consumer brand"] },
    { topic: "commerce_logistics", queries: ["quick commerce", "ecommerce logistics"] },
    { topic: "policy_regulation", queries: ["startup policy", "RBI regulation", "SEBI"] },
  ],
  [
    { topic: "climate_deeptech", queries: ["EV startup", "climate tech", "electric vehicle"] },
    // "healthtech" and "biotech startup" both returned 0 for 18–24 Sep 2026.
    { topic: "health_bio", queries: ["healthtech", "healthcare", "pharma"] },
    { topic: "exits_markets", queries: ["IPO", "acquisition startup"] },
  ],
  [
    // Unfiltered, "Series A" matched TV-series reviews and "SaaS" a TV serial.
    { topic: "funding_vc", queries: ["Series A", "seed round", "venture capital"] },
    { topic: "ai_saas", queries: ["SaaS", "enterprise software", "AI agents"] },
    { topic: "fintech", queries: ["UPI", "neobank"] },
  ],
];

// Title must look like startup/business news. Case-sensitive on purpose for
// acronyms (SaaS, IPO, VC) so "Kyunki Saas Bhi Kabhi Bahu Thi" is rejected.
const BUSINESS_TITLE =
  /\b(?:[Ss]tartups?|raises?|raised|funding|funded|[Ff]intech|crore|lakh|[Mm]n|million|billion|valuation|investors?|venture|acquires?|acquisition|unicorn|layoffs?|revenue|profit|shares?|stocks?|listing|brands?|commerce|payments?)\b|\b(?:SaaS|IPO|VC|AI|D2C|UPI|RBI|SEBI|NBFC|EV)\b|[₹$]\s?\d/;

function looksLikeBusinessNews(title: string): boolean {
  return BUSINESS_TITLE.test(title);
}

interface GNewsArticle {
  title: string;
  url: string;
  publishedAt: string;
  source: { name: string };
}

export interface SeedStory {
  position: number;
  topic: string;
  query: string;
  title: string;
  url: string;
  publisher: string;
  publishedAt: string;
}

export interface SeedIssue {
  issueDate: string;
  stories: SeedStory[];
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const CACHE_DIR = "db/seed/.cache";
let requests = 0;

// Raw responses are cached (git-ignored) so filter tweaks don't spend quota.
async function cachedSearch(apikey: string, issueDate: string, q: string, from: Date, to: Date) {
  const file = `${CACHE_DIR}/${issueDate}-${q.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.json`;
  if (existsSync(file)) return JSON.parse(readFileSync(file, "utf8")) as GNewsArticle[];
  if (requests > 0) await sleep(1200);
  const found = await search(apikey, q, from, to);
  requests += 1;
  mkdirSync(CACHE_DIR, { recursive: true });
  writeFileSync(file, JSON.stringify(found));
  return found;
}

/** Individual name/number words, so "UPI MDR" and "UPI MDR FAQs" overlap. */
function entityWords(title: string): Set<string> {
  return new Set(extractEntities(title).flatMap((e) => e.split(" ")));
}

async function search(apikey: string, q: string, from: Date, to: Date): Promise<GNewsArticle[]> {
  const url = new URL("https://gnews.io/api/v4/search");
  url.search = new URLSearchParams({
    q,
    lang: "en",
    country: "in",
    max: "10",
    sortby: "relevance",
    from: from.toISOString(),
    to: to.toISOString(),
    apikey,
  }).toString();
  const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`GNews ${res.status} for query "${q}"`);
  const body = (await res.json()) as { articles?: GNewsArticle[] };
  return body.articles ?? [];
}

async function main() {
  if (existsSync(OUT) && !process.argv.includes("--force")) {
    console.log(`${OUT} already exists; pass --force to rebuild (spends GNews quota).`);
    return;
  }
  const { NEWS_API_KEY } = requireEnv("NEWS_API_KEY");
  const now = new Date();
  const earliest = new Date(now.getTime() - GNEWS_HISTORY_DAYS * 86_400_000);
  const issueDates = previousIssueDates(collectingIssueDate(now), 4);

  const seenHashes = new Set<string>();
  const seenTitles = new Set<string>();
  const issues: SeedIssue[] = [];

  for (const [i, issueDate] of issueDates.entries()) {
    const { start, end } = issueWindow(issueDate);
    const from = start < earliest ? earliest : start;
    const stories: SeedStory[] = [];

    for (const { topic, queries } of ROTATION[i] ?? []) {
      let taken = 0;
      for (const q of queries) {
        if (taken >= STORIES_PER_QUERY) break;
        const found = await cachedSearch(NEWS_API_KEY, issueDate, q, from, end);
        const before = taken;
        for (const a of found) {
          if (taken >= STORIES_PER_QUERY) break;
          let canonical: string;
          try {
            canonical = canonicalizeUrl(a.url);
          } catch {
            continue;
          }
          const hash = hashUrl(canonical);
          const norm = normalizeTitle(a.title);
          if (!norm || seenHashes.has(hash) || seenTitles.has(norm)) continue;
          if (!looksLikeBusinessNews(a.title)) continue;
          // A real issue never runs the same story twice: skip near-duplicates
          // (2+ shared name/number words) of a story already in this issue.
          const words = entityWords(a.title);
          const nearDup = stories.some(
            (s) => [...entityWords(s.title)].filter((w) => words.has(w)).length >= 2,
          );
          if (nearDup) continue;
          seenHashes.add(hash);
          seenTitles.add(norm);
          stories.push({
            position: stories.length + 1,
            topic,
            query: q,
            title: a.title.trim(),
            url: a.url,
            publisher: a.source.name,
            publishedAt: a.publishedAt,
          });
          taken += 1;
        }
        console.log(`  ${issueDate} · ${topic.padEnd(18)} "${q}" → ${found.length} found, ${taken - before} taken`);
      }
    }

    const topics = new Set(stories.map((s) => s.topic));
    if (stories.length < 8 || topics.size < 3) {
      throw new Error(`${issueDate}: only ${stories.length} stories / ${topics.size} topics; adjust ROTATION`);
    }
    issues.push({ issueDate, stories: stories.slice(0, 10) });
  }

  mkdirSync("db/seed", { recursive: true });
  writeFileSync(
    OUT,
    `${JSON.stringify(
      {
        _note:
          "Placeholder past issues built from real GNews results (titles, links, publishers only). Labelled [SEED] when seeded. Commentary is placeholder text, not Shreya's voice.",
        generatedAt: now.toISOString(),
        issues,
      },
      null,
      2,
    )}\n`,
  );
  console.log(`wrote ${OUT}: ${issues.length} issues, ${issues.reduce((n, x) => n + x.stories.length, 0)} stories, ${requests} GNews requests`);
}

main().catch((err: unknown) => {
  console.error("build-seed-issues failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});

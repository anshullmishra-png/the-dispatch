// Hit every candidate source and report which work (docs/05 §1).
//   npm run probe                       → RSS feeds only (free)
//   npm run probe -- --gnews            → also each GNews query (1 request each)
//   npm run probe -- --gnews "q1" "q2"  → only these extra queries (to test replacements)
import "./_env";
import { readFileSync } from "node:fs";
import { mapSettled } from "@/lib/collect/limit";
import { collectRss, userAgent } from "@/lib/collect/rss";
import { GNewsQuotaError, searchGNews } from "@/lib/collect/gnews";
import { env, requireEnv } from "@/lib/env";

const FRESH_DAYS = 14;

interface SourcesFile {
  rss: { name: string; url: string }[];
  gnews: string[];
}

const day = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : "—");

async function probeRss(file: SourcesFile) {
  const ua = userAgent(env().APP_URL);
  const freshSince = Date.now() - FRESH_DAYS * 86_400_000;
  const results = await mapSettled(file.rss, 6, async (s) => {
    const started = Date.now();
    const items = await collectRss(s.url, s.name, ua);
    const dates = items.map((i) => i.publishedAt).filter((d): d is Date => d !== null);
    const newest = dates.length ? new Date(Math.max(...dates.map((d) => d.getTime()))) : null;
    return {
      items: items.length,
      fresh: dates.filter((d) => d.getTime() >= freshSince).length,
      undated: items.length - dates.length,
      newest,
      ms: Date.now() - started,
      sample: items[0]?.title ?? "",
    };
  });

  console.log(`\nRSS feeds (fresh = published in the last ${FRESH_DAYS} days)\n`);
  let working = 0;
  file.rss.forEach((s, i) => {
    const r = results[i];
    if (r?.status === "fulfilled") {
      const v = r.value;
      const ok = v.fresh > 0;
      if (ok) working += 1;
      console.log(
        `${ok ? "OK  " : "STALE"} ${s.name.padEnd(28)} items ${String(v.items).padStart(2)} · fresh ${String(v.fresh).padStart(2)} · undated ${v.undated} · newest ${day(v.newest)} · ${v.ms} ms`,
      );
      if (v.sample) console.log(`      e.g. ${v.sample.slice(0, 90)}`);
    } else {
      const reason = r?.reason instanceof Error ? r.reason.message : String(r?.reason);
      console.log(`DEAD  ${s.name.padEnd(28)} ${reason}`);
    }
  });
  console.log(`\n${working}/${file.rss.length} RSS feeds working`);
  return working;
}

async function probeGNews(queries: string[]) {
  const { NEWS_API_KEY } = requireEnv("NEWS_API_KEY");
  const from = new Date(Date.now() - 7 * 86_400_000);
  console.log(`\nGNews queries (country=in, last 7 days, 1 request each)\n`);
  let working = 0;
  for (const [i, query] of queries.entries()) {
    if (i > 0) await new Promise((r) => setTimeout(r, 1200));
    try {
      const items = await searchGNews({ apikey: NEWS_API_KEY, query, from });
      const ok = items.length >= 3;
      if (ok) working += 1;
      console.log(`${ok ? "OK  " : "WEAK"} "${query}" → ${items.length} articles`);
      for (const it of items.slice(0, 2)) console.log(`      e.g. ${it.title.slice(0, 90)} — ${it.publisher}`);
    } catch (err) {
      if (err instanceof GNewsQuotaError) {
        console.log(`STOP  quota exhausted at "${query}" (HTTP ${err.status}); remaining queries not probed`);
        break;
      }
      console.log(`FAIL  "${query}" ${(err as Error).message}`);
    }
  }
  console.log(`\n${working}/${queries.length} GNews queries returned ≥3 articles`);
  return working;
}

async function main() {
  const file = JSON.parse(readFileSync("content/sources.seed.json", "utf8")) as SourcesFile;
  const args = process.argv.slice(2);
  const gnewsIdx = args.indexOf("--gnews");
  const rssWorking = await probeRss(file);
  if (gnewsIdx >= 0) {
    const extra = args.slice(gnewsIdx + 1).filter((a) => !a.startsWith("--"));
    await probeGNews(extra.length ? extra : file.gnews);
  }
  if (rssWorking + file.gnews.length < 20) console.log("\nWARNING: fewer than 20 working sources");
}

main().catch((err: unknown) => {
  console.error("probe failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});

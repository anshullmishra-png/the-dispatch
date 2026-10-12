import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { normalizeTitle } from "@/lib/dedupe/normalize";
import { trigramSimilarity } from "@/lib/dedupe/trigram";

// Requires `npm run db:migrate && npm run seed` against the configured database.
const rows = async <T>(query: ReturnType<typeof sql>) => (await db().execute(query)).rows as T[];

describe.skipIf(!process.env.DATABASE_URL)("Neon database (integration)", () => {
  it("has the required extensions", async () => {
    const ext = await rows<{ extname: string }>(
      sql`select extname from pg_extension where extname in ('pg_trgm','citext','pgcrypto')`,
    );
    expect(ext.map((e) => e.extname).sort()).toEqual(["citext", "pg_trgm", "pgcrypto"]);
  });

  it("seed counts match the spec", async () => {
    const [src] = await rows<{ active: number }>(sql`select count(*) filter (where active)::int as active from sources`);
    expect(src?.active).toBeGreaterThanOrEqual(20);

    const issues = await rows<{ stories: number; topics: number }>(sql`
      select count(s.id)::int as stories, count(distinct s.topic)::int as topics
      from issues i join issue_stories s on s.issue_id = i.id
      where i.status = 'SENT' and i.subject like '[SEED]%'
      group by i.id`);
    expect(issues).toHaveLength(4);
    for (const i of issues) {
      expect(i.stories).toBeGreaterThanOrEqual(8);
      expect(i.stories).toBeLessThanOrEqual(10);
      expect(i.topics).toBeGreaterThanOrEqual(3);
    }

    const [subs] = await rows<{ total: number; real: number; unsub: number; bounced: number }>(sql`
      select count(*)::int as total,
             count(*) filter (where not is_test)::int as real,
             count(*) filter (where status = 'unsubscribed')::int as unsub,
             count(*) filter (where status = 'bounced')::int as bounced
      from subscribers`);
    expect(subs).toMatchObject({ total: 2200, real: 1, unsub: 1, bounced: 1 });

    const guides = await rows<{ active: boolean }>(sql`select active from style_guides where active`);
    expect(guides).toHaveLength(1);
  });

  it("citext makes subscriber email lookups case-insensitive", async () => {
    const found = await rows<{ email: string }>(
      sql`select email from subscribers where email = ${"DELIVERED@RESEND.DEV"}`,
    );
    expect(found).toHaveLength(1);
  });

  it("trigram similarity finds a re-worded headline among seeded articles", async () => {
    // A different outlet's wording of a seeded story ("Ultraviolette raises $85 million …").
    const probe = normalizeTitle("Ultraviolette bags $85 million in funding led by Yali Capital - Inc42");
    const [best] = await rows<{ title: string; score: number }>(sql`
      select title, similarity(title_norm, ${probe})::float as score
      from articles
      where title_norm % ${probe}
      order by score desc
      limit 1`);
    expect(best?.title).toMatch(/Ultraviolette/);
    expect(best?.score).toBeGreaterThan(0.3);
  });

  it("the JS trigram port gives the same scores as pg_trgm on real titles", async () => {
    const titles = await rows<{ t: string }>(sql`select title_norm as t from articles order by id limit 201`);
    expect(titles.length).toBeGreaterThan(50);
    const left = titles.slice(0, -1).map((r) => r.t);
    const right = titles.slice(1).map((r) => r.t);
    // Drizzle expands JS arrays into a row of params, so pass them as one JSON value.
    const scores = await rows<{ a: string; b: string; s: number }>(sql`
      select l.v as a, r.v as b, similarity(l.v, r.v)::float as s
      from jsonb_array_elements_text(${JSON.stringify(left)}::jsonb) with ordinality l(v, i)
      join jsonb_array_elements_text(${JSON.stringify(right)}::jsonb) with ordinality r(v, i) using (i)`);
    let maxDiff = 0;
    for (const r of scores) maxDiff = Math.max(maxDiff, Math.abs(r.s - trigramSimilarity(r.a, r.b)));
    expect(scores).toHaveLength(left.length);
    expect(maxDiff).toBeLessThan(1e-6);
  });

  it("an unrelated headline has low similarity to that story", async () => {
    const [row] = await rows<{ score: number }>(sql`
      select max(similarity(title_norm, ${normalizeTitle("Monsoon rains lash Mumbai suburbs")}))::float as score
      from articles where title ilike '%Ultraviolette%'`);
    expect(row?.score).toBeLessThan(0.2);
  });
});

import "./_env";
import { writeFileSync } from "node:fs";
import { neon } from "@neondatabase/serverless";
import { sharedEntityCount } from "@/lib/dedupe/engine";
import { similarityOfSets, trigrams } from "@/lib/dedupe/trigram";
const q = neon(process.env.DATABASE_URL!);
(async () => {
  const rows = (await q`select a.id, a.title, a.title_norm, a.entities, a.publisher from articles a join issues i on i.id = a.issue_id where i.issue_date = '2026-10-15'`) as { id: string; title: string; title_norm: string; entities: string[]; publisher: string }[];
  const tri = rows.map((r) => trigrams(r.title_norm));
  const bands = [0.6, 0.5, 0.45, 0.4, 0.35, 0.3, 0.25];
  const stats = new Map<number, { n: number; s2: number; s3: number; samples: string[] }>();
  for (const b of bands) stats.set(b, { n: 0, s2: 0, s3: 0, samples: [] });
  for (let i = 0; i < rows.length; i++) for (let j = i + 1; j < rows.length; j++) {
    const sim = similarityOfSets(tri[i]!, tri[j]!);
    const band = bands.find((b) => sim >= b);
    if (band === undefined) continue;
    const shared = sharedEntityCount(rows[i]!.entities, rows[j]!.entities);
    const st = stats.get(band)!;
    st.n++; if (shared >= 2) st.s2++; if (shared >= 3) st.s3++;
    st.samples.push(`${sim.toFixed(3)} sh=${shared} | ${rows[i]!.title.slice(0, 70)} [${rows[i]!.publisher}]\n                 | ${rows[j]!.title.slice(0, 70)} [${rows[j]!.publisher}]`);
  }
  let out = `articles: ${rows.length}\n`;
  for (const b of bands) { const s = stats.get(b)!; out += `\n=== sim >= ${b}: ${s.n} pairs (shared>=2: ${s.s2}, shared>=3: ${s.s3})\n` + s.samples.join("\n") + "\n"; }
  writeFileSync(process.argv[2]!, out);
  for (const b of bands) { const s = stats.get(b)!; console.log(`sim >= ${b}: ${String(s.n).padStart(4)} pairs | shared>=2: ${String(s.s2).padStart(4)} | shared>=3: ${String(s.s3).padStart(4)}`); }
})();

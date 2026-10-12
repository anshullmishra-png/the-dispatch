import "./_env";
import { writeFileSync } from "node:fs";
import { neon } from "@neondatabase/serverless";
import { CALIBRATED_RULE, DOC_RULE, judgePair } from "@/lib/dedupe/engine";
import { similarityOfSets, trigrams } from "@/lib/dedupe/trigram";
const q = neon(process.env.DATABASE_URL!);
(async () => {
  const rows = (await q`select a.title, a.title_norm, a.entities, a.publisher from articles a join issues i on i.id = a.issue_id where i.issue_date = '2026-10-15'`) as { title: string; title_norm: string; entities: string[]; publisher: string }[];
  const tri = rows.map((r) => trigrams(r.title_norm));
  const groups: Record<string, string[]> = { both: [], docOnly: [], calOnly: [] };
  for (let i = 0; i < rows.length; i++) for (let j = i + 1; j < rows.length; j++) {
    const sim = similarityOfSets(tri[i]!, tri[j]!);
    if (sim < 0.3) continue;
    const d = judgePair(sim, rows[i]!.entities, rows[j]!.entities, DOC_RULE);
    const c = judgePair(sim, rows[i]!.entities, rows[j]!.entities, CALIBRATED_RULE);
    const line = `${sim.toFixed(3)} distinct=${c.shared} | ${rows[i]!.title.slice(0, 66)}\n                    | ${rows[j]!.title.slice(0, 66)}`;
    if (d.duplicate && c.duplicate) groups.both!.push(line);
    else if (d.duplicate) groups.docOnly!.push(line);
    else if (c.duplicate) groups.calOnly!.push(line);
  }
  let out = "";
  for (const [k, v] of Object.entries(groups)) out += `\n===== ${k}: ${v.length} pairs\n${v.join("\n")}\n`;
  writeFileSync(process.argv[2]!, out);
  console.log(Object.fromEntries(Object.entries(groups).map(([k, v]) => [k, v.length])));
})();

import { describe, expect, it } from "vitest";
import type { GenerateJsonOptions, GenerateJsonResult } from "@/lib/ai/gemini";
import type { SelectionOut } from "@/lib/ai/schemas";
import { trimCandidates } from "@/lib/curate/candidates";
import { parseNeverSay } from "@/lib/curate/lint";
import { repairSelection, runSelection } from "@/lib/curate/select";
import { validateSelection } from "@/lib/curate/validate";
import { createLogger } from "@/lib/log";
import { fixtureCandidates, fixtureContext, STYLE_GUIDE, validSelection } from "./fixtures/curate";

const log = createLogger({ test: "select" });
const deadline = () => Date.now() + 60_000;

function scripted(...answers: SelectionOut[]) {
  const users: string[] = [];
  const generate = async (opts: GenerateJsonOptions<SelectionOut>): Promise<GenerateJsonResult<SelectionOut>> => {
    users.push(opts.user);
    const data = opts.parse(answers[Math.min(users.length - 1, answers.length - 1)]);
    return { data, usage: { in: 1000, out: 300, thoughts: 0 }, attempts: 1, latencyMs: 5, model: "test-flash", promptHash: "h" };
  };
  return { generate, users };
}

describe("runSelection", () => {
  it("accepts a valid first answer without re-prompting", async () => {
    const { generate, users } = scripted(validSelection());
    const res = await runSelection({} as never, { log, deadline: deadline(), generate, context: fixtureContext() });
    expect(users).toHaveLength(1);
    expect(res.repaired).toBe(false);
    expect(res.picks).toHaveLength(8);
    expect(res.backups).toHaveLength(5);
    expect(res.picks[0]).toMatchObject({ position: 1, role: "pick", articleId: "00000000-0000-4000-8000-000000000001" });
    expect(res.backups[4]).toMatchObject({ backupRank: 5, role: "backup" });
  });

  it("re-prompts with the exact violations, then accepts a fixed answer", async () => {
    const bad = validSelection();
    bad.picks.forEach((p) => (p.topic = "fintech"));
    const { generate, users } = scripted(bad, validSelection());
    const res = await runSelection({} as never, { log, deadline: deadline(), generate, context: fixtureContext() });
    expect(users).toHaveLength(2);
    expect(users[1]).toContain("YOUR PREVIOUS ANSWER BROKE THESE RULES");
    expect(users[1]).toContain("TOPIC_SPREAD");
    expect(res.attempts.map((a) => a.violations.length > 0)).toEqual([true, false]);
    expect(res.repaired).toBe(false);
  });

  it("stops after 2 re-prompts and repairs deterministically", async () => {
    const bad = validSelection();
    (bad.picks[0] as { commentary: string }).commentary = "Only one sentence.";
    const { generate, users } = scripted(bad);
    const res = await runSelection({} as never, { log, deadline: deadline(), generate, context: fixtureContext() });
    expect(users).toHaveLength(3);
    expect(res.repaired).toBe(true);
    expect(res.picks.map((p) => p.shortId)).not.toContain("a01");
    expect(res.picks).toHaveLength(8); // a09 promoted from the bench
    expect(res.needsAttention).toBe(false);
  });

  it("flags ungrounded numbers on the story card", async () => {
    const sel = validSelection();
    (sel.picks[0] as { commentary: string }).commentary = "Zetwerk wants a 99% premium. The market will decide.";
    const { generate } = scripted(sel);
    const res = await runSelection({} as never, { log, deadline: deadline(), generate, context: fixtureContext() });
    expect(res.picks[0]?.flags).toContain("ungrounded_number:99%");
  });
});

describe("repairSelection", () => {
  const candidates = fixtureCandidates();
  const neverSay = parseNeverSay(STYLE_GUIDE);
  const repair = (sel: SelectionOut) => repairSelection(sel, validateSelection(sel, { candidates, lastFour: [], neverSay }), candidates);

  it("never pads with weak stories: too many bad picks → needs attention", () => {
    const sel = validSelection();
    sel.picks.slice(0, 6).forEach((p) => (p.commentary = "Bad."));
    const res = repair(sel);
    expect(res.picks.length).toBeLessThan(8);
    expect(res.needsAttention).toBe(true);
    expect(res.notes.join(" ")).toContain("not padding");
  });

  it("restores a 3-topic spread from the bench", () => {
    const sel = validSelection();
    sel.picks.forEach((p, i) => (p.topic = i % 2 ? "fintech" : "funding_vc"));
    const res = repair(sel);
    expect(new Set(res.picks.map((p) => p.topic)).size).toBeGreaterThanOrEqual(3);
    expect(res.needsAttention).toBe(false);
  });
});

describe("trimCandidates", () => {
  const make = (day: number, hour: number, publisher: string) => ({
    publishedAt: new Date(`2026-10-${String(day).padStart(2, "0")}T${String(hour).padStart(2, "0")}:00:00Z`),
    publisher,
    tag: `${day}-${hour}-${publisher}`,
  });

  it("returns everything (newest first) when under the cap", () => {
    const items = [make(9, 1, "A"), make(10, 1, "B")];
    expect(trimCandidates(items, 80).map((i) => i.tag)).toEqual(["10-1-B", "9-1-A"]);
  });

  it("spreads slots across days instead of keeping only the newest", () => {
    // Hours < 18 UTC stay on the same IST date (18:30 UTC is already the next day in IST).
    const items = [...Array.from({ length: 30 }, (_, h) => make(12, h % 18, `New${h}`)), ...Array.from({ length: 10 }, (_, h) => make(8, h, `Old${h}`))];
    const out = trimCandidates(items, 20, 6);
    expect(out).toHaveLength(20);
    expect(out.filter((i) => i.tag.startsWith("8-")).length).toBe(10);
  });

  it("caps any one outlet at 6", () => {
    const items = Array.from({ length: 40 }, (_, h) => make(10 + (h % 3), h % 24, h < 30 ? "Same" : `Other${h}`));
    const out = trimCandidates(items, 15, 6);
    expect(out.filter((i) => i.publisher === "Same").length).toBe(6);
  });
});

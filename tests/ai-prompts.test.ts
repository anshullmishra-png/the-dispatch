import { describe, expect, it } from "vitest";
import { buildRepairPrompt, buildSystemPrompt, buildUserPrompt, DATA_NOT_INSTRUCTIONS, SNIPPET_FOR_GEMINI } from "@/lib/ai/prompts";
import { selectionJsonSchema, TOPICS } from "@/lib/ai/schemas";
import { STYLE_GUIDE } from "./fixtures/curate";

const base = {
  topics: TOPICS,
  styleGuide: STYLE_GUIDE,
  fewShot: [],
  lastFour: [
    { issueDate: "2026-10-08", topic: "ai_saas", headline: "AI-focused byteXL raises $9 Mn" },
    { issueDate: "2026-10-08", topic: "fintech", headline: "PB Fintech hits 32-month low" },
    { issueDate: "2026-10-01", topic: "consumer_d2c", headline: "D2C brands widen offline trade" },
  ],
};

describe("buildSystemPrompt", () => {
  const prompt = buildSystemPrompt(base);

  it("fills every placeholder", () => {
    expect(prompt).not.toMatch(/\{\{\w+\}\}/);
  });

  it("includes the required sections", () => {
    for (const heading of ["TASK", "HARD RULES", "TOPICS:", "STYLE GUIDE", "EXAMPLES OF SHREYA'S EDITS", "LAST_FOUR_ISSUES"]) {
      expect(prompt).toContain(heading);
    }
    expect(prompt).toContain(TOPICS.join(", "));
    expect(prompt).toContain("## Never say");
  });

  it("says candidate text is data, not instructions", () => {
    expect(prompt).toContain(DATA_NOT_INSTRUCTIONS);
  });

  it("groups the last four issues by date with topics", () => {
    expect(prompt).toMatch(/2026-10-08:\n- \[ai_saas\] AI-focused byteXL raises \$9 Mn\n- \[fintech\] PB Fintech/);
    expect(prompt).toContain("2026-10-01:\n- [consumer_d2c]");
  });

  it("says when there are no edits yet, and formats them when there are", () => {
    expect(prompt).toContain("(none yet");
    const withEdits = buildSystemPrompt({
      ...base,
      fewShot: [{ articleTitle: "Story T", aiText: "AI version.", finalText: "Shreya version." }],
    });
    expect(withEdits).toContain("1. Story: Story T\n   AI wrote: AI version.\n   Shreya changed to: Shreya version.");
  });

  it("rejects an unknown placeholder instead of sending it", () => {
    expect(() => buildSystemPrompt({ ...base, styleGuide: "{{nope}}" })).not.toThrow();
  });
});

describe("buildUserPrompt", () => {
  it("is CANDIDATES followed by compact JSON, with snippets capped", () => {
    const long = "x".repeat(400);
    const out = buildUserPrompt([{ id: "a01", source: "Inc42", published: "2026-10-12", title: "T", snippet: long }]);
    expect(out.startsWith("CANDIDATES\n")).toBe(true);
    const rows = JSON.parse(out.slice("CANDIDATES\n".length));
    expect(rows[0]).toMatchObject({ id: "a01", source: "Inc42", published: "2026-10-12", title: "T" });
    expect(rows[0].snippet.length).toBe(SNIPPET_FOR_GEMINI);
  });
});

describe("buildRepairPrompt", () => {
  it("appends the violations to the original message", () => {
    const out = buildRepairPrompt("CANDIDATES\n[]", [
      { code: "TOPIC_SPREAD", message: "picks span 2 topic(s)" },
      { code: "UNKNOWN_ID", message: "id is not in CANDIDATES", articleId: "a99" },
    ]);
    expect(out).toContain("CANDIDATES\n[]");
    expect(out).toContain("YOUR PREVIOUS ANSWER BROKE THESE RULES");
    expect(out).toContain("- UNKNOWN_ID (a99): id is not in CANDIDATES");
  });
});

describe("selectionJsonSchema", () => {
  it("restricts ids to this call's candidates and enforces counts", () => {
    const schema = JSON.stringify(selectionJsonSchema(["a01", "a02"]));
    expect(schema).toContain('"enum":["a01","a02"]');
    expect(schema).toContain('"minItems":8');
    expect(schema).toContain('"maxItems":10');
  });
});

import { describe, expect, it } from "vitest";
import {
  type CardStory,
  confirmCallback,
  type DraftSummary,
  escapeHtml,
  formatFlag,
  id8,
  issueCallback,
  parseCallback,
  renderEditPrompt,
  renderFinal,
  renderHeader,
  renderReminder,
  renderStory,
  storyCallback,
} from "@/lib/telegram/cards";

const STORY_ID = "3f2a9c1e-7b4d-4e2a-9c1e-7b4d4e2a9c1e";
const ISSUE_ID = "a1b2c3d4-0000-4000-8000-000000000001";
const HASH = "deadbeefcafebabe0123456789abcdef0123456789abcdef0123456789abcdef";

const story: CardStory = {
  id: STORY_ID,
  position: 3,
  topic: "fintech",
  signalType: "under_reported",
  headline: "UPI <fees> & the merchants",
  publisher: "Mint",
  url: "https://www.livemint.com/x",
  commentary: "Merchants carry the cost. Banks do not.",
  rationale: "Few outlets covered the merchant side.",
  flags: ["ungrounded_number:42%"],
  state: "PENDING",
};

const summary: DraftSummary = {
  issueId: ISSUE_ID,
  issueDate: "2026-10-15",
  status: "IN_REVIEW",
  contentHash: HASH,
  confirmedAt: null,
  counts: { PENDING: 2, KEPT: 5, EDITED: 2, SWAPPED_OUT: 1 },
  topics: { fintech: 3, ai_saas: 3, funding_vc: 2, consumer_d2c: 1 },
  backupsLeft: 4,
  warnings: [],
};

type Markup = { replyMarkup?: { inline_keyboard: { text: string; callback_data?: string; url?: string }[][] } };
const buttons = (card: Markup) => card.replyMarkup?.inline_keyboard.flat() ?? [];
const labels = (card: Markup) => buttons(card).map((b) => b.text);

describe("escapeHtml", () => {
  it("escapes & < > and nothing else", () => {
    expect(escapeHtml(`a & b <i>"x"</i>`)).toBe(`a &amp; b &lt;i&gt;"x"&lt;/i&gt;`);
  });
});

describe("callback data", () => {
  it("round-trips every action and stays within 64 bytes", () => {
    const all = [
      storyCallback("keep", STORY_ID),
      storyCallback("edit", STORY_ID),
      storyCallback("swap", STORY_ID),
      storyCallback("use_anyway", STORY_ID),
      issueCallback("approve_all", ISSUE_ID),
      issueCallback("hold", ISSUE_ID),
      issueCallback("send_now", ISSUE_ID),
      confirmCallback(ISSUE_ID, HASH),
    ];
    for (const data of all) {
      expect(Buffer.byteLength(data)).toBeLessThanOrEqual(64);
      expect(parseCallback(data)).not.toBeNull();
    }
    expect(parseCallback(storyCallback("swap", STORY_ID))).toEqual({ kind: "story", action: "swap", story8: "3f2a9c1e" });
    expect(parseCallback(confirmCallback(ISSUE_ID, HASH))).toEqual({ kind: "confirm", issue8: "a1b2c3d4", hash8: "deadbeef" });
    expect(parseCallback(issueCallback("hold", ISSUE_ID))).toEqual({ kind: "issue", action: "hold", issue8: "a1b2c3d4" });
  });

  it("rejects anything else", () => {
    for (const bad of ["", "k:", "k:XYZ12345", "z:3f2a9c1e", "c:a1b2c3d4", "k:3f2a9c1e:extra", "k:3f2a9c1e "]) {
      expect(parseCallback(bad)).toBeNull();
    }
  });

  it("id8 is the uuid's first 8 hex chars", () => {
    expect(id8(STORY_ID)).toBe("3f2a9c1e");
  });
});

describe("formatFlag", () => {
  it("makes lint codes readable", () => {
    expect(formatFlag("ungrounded_number:42%")).toBe("ungrounded number: 42%");
    expect(formatFlag("ungrounded_entity:Series C")).toBe("ungrounded entity: Series C");
    expect(formatFlag("voice:more than one question")).toBe("voice: more than one question");
  });
});

describe("renderStory", () => {
  it("follows the documented layout with escaped text", () => {
    const lines = renderStory(story, 9, "IN_REVIEW").text.split("\n");
    expect(lines[0]).toBe("3/9 · FINTECH · under-reported");
    expect(lines[1]).toBe("<b>UPI &lt;fees&gt; &amp; the merchants</b> (Mint)");
    expect(lines[2]).toBe("Merchants carry the cost. Banks do not.");
    expect(lines[3]).toBe("<i>Why: Few outlets covered the merchant side.</i>");
    expect(lines[4]).toBe("⚠ ungrounded number: 42%");
  });

  it("a pending card has Keep, Edit, Swap and a Read link", () => {
    const card = renderStory(story, 9, "IN_REVIEW");
    expect(labels(card)).toEqual(["✅ Keep", "✏️ Edit", "🔄 Swap", "🔗 Read"]);
    expect(buttons(card)[3]?.url).toBe(story.url);
  });

  it("a kept card shows the state and drops Keep", () => {
    const card = renderStory({ ...story, state: "KEPT" }, 9, "IN_REVIEW");
    expect(card.text).toContain("✅ Kept");
    expect(labels(card)).toEqual(["✏️ Edit", "🔄 Swap", "🔗 Read"]);
  });

  it("a swapped-out card keeps only Read", () => {
    const card = renderStory({ ...story, state: "SWAPPED_OUT" }, 9, "IN_REVIEW");
    expect(card.text).toContain("Swapped out");
    expect(labels(card)).toEqual(["🔗 Read"]);
  });

  it("a sent issue's cards have no action buttons", () => {
    expect(labels(renderStory(story, 9, "SENT"))).toEqual(["🔗 Read"]);
  });

  it("omits Read for a non-http url", () => {
    expect(buttons(renderStory({ ...story, url: "javascript:alert(1)" }, 9, "IN_REVIEW")).some((b) => b.url)).toBe(false);
  });

  it("stays under 4096 chars with extreme input", () => {
    const huge = "x".repeat(5000);
    const card = renderStory(
      { ...story, headline: huge, commentary: huge, rationale: huge, publisher: huge, flags: Array(50).fill(`f:${huge}`) },
      9,
      "IN_REVIEW",
    );
    expect(card.text.length).toBeLessThan(4096);
  });
});

describe("renderFinal", () => {
  it("summarises states and topics; Confirm carries the hash prefix", () => {
    const card = renderFinal(summary);
    expect(card.text).toContain("✅ Kept 5 · ✏️ Edited 2 · ⏳ Pending 2 · 🔄 Swapped 1");
    expect(card.text).toContain("Topics (4): AI &amp; SaaS 3 · Fintech 3 · Funding &amp; VC 2 · Consumer &amp; D2C 1");
    expect(labels(card)).toEqual(["✅ Approve all remaining", "🚀 Confirm final draft", "⏸ Hold"]);
    expect(buttons(card)[1]?.callback_data).toBe("c:a1b2c3d4:deadbeef");
  });

  it("drops Approve all when nothing is pending", () => {
    expect(labels(renderFinal({ ...summary, counts: { ...summary.counts, PENDING: 0 } }))).toEqual(["🚀 Confirm final draft", "⏸ Hold"]);
  });

  it("a confirmed issue offers only Hold; a held one offers Confirm but not Hold; a sent one nothing", () => {
    expect(labels(renderFinal({ ...summary, status: "CONFIRMED" }))).toEqual(["⏸ Hold"]);
    expect(labels(renderFinal({ ...summary, status: "HELD" }))).toEqual(["✅ Approve all remaining", "🚀 Confirm final draft"]);
    expect(buttons(renderFinal({ ...summary, status: "SENT" }))).toEqual([]);
  });

  it("shows warnings on the header and the final card", () => {
    const warned = { ...summary, warnings: ["Only 6 valid stories; the draft was not padded with weak ones."] };
    expect(renderHeader(warned).text).toContain("⚠ Only 6 valid stories");
    expect(renderFinal(warned).text).toContain("⚠ Only 6 valid stories");
  });
});

describe("header, reminder and edit prompt", () => {
  it("header follows the documented first line", () => {
    expect(renderHeader(summary).text.split("\n")[0]).toBe("<b>The Dispatch — draft for Thu 15 Oct</b> · 9 stories · 4 topics");
  });

  it("reminder carries the same Confirm and Hold buttons", () => {
    const card = renderReminder(summary);
    expect(card.text).toContain("No confirmation yet for Thursday's issue");
    const data = buttons(card).map((b) => b.callback_data);
    expect(data).toContain("c:a1b2c3d4:deadbeef");
    expect(data).toContain("h:a1b2c3d4");
  });

  it("edit prompt names the story and escapes the current text", () => {
    expect(renderEditPrompt(3, "a < b")).toContain("<code>a &lt; b</code>");
    expect(renderEditPrompt(3, "x")).toContain("story 3");
  });
});

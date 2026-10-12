// Voice and grounding lint for commentary (docs/04 §8). Pure.
import { extractEntities } from "@/lib/dedupe/normalize";

export const MIN_SENTENCES = 2;
export const MAX_SENTENCES = 3;
export const MAX_WORDS = 65;

// Periods that do not end a sentence.
const ABBREVIATIONS = /\b(?:U\.S|U\.K|U\.A\.E|Rs|Mr|Mrs|Ms|Dr|St|vs|Inc|Ltd|Co|Corp|Pvt|No|approx|e\.g|i\.e|etc)\./gi;
const PLACEHOLDER = "\u0001";

export function splitSentences(text: string): string[] {
  const masked = text
    .replace(ABBREVIATIONS, (m) => m.replace(/\./g, PLACEHOLDER))
    .replace(/(?<=\d)\.(?=\d)/g, PLACEHOLDER);
  return masked
    .split(/(?<=[.!?])["”’')]*\s+/u)
    .map((s) => s.replace(new RegExp(PLACEHOLDER, "g"), ".").trim())
    .filter(Boolean);
}

export function wordCount(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

/** Bullet list under the "## Never say" heading of the style guide. */
export function parseNeverSay(styleGuide: string): string[] {
  const section = /^##\s+Never say\s*$([\s\S]*?)(?=^##\s|(?![\s\S]))/im.exec(styleGuide)?.[1] ?? "";
  return section
    .split(/\r?\n/)
    .map((l) => /^\s*[-*]\s+(.+)$/.exec(l)?.[1] ?? "")
    .map((l) => l.replace(/\([^)]*\)\s*$/, "")) // drop trailing notes like "(as filler)"
    // Strip surrounding quotes only: "it's worth noting" keeps its apostrophe.
    .map((l) => l.trim().replace(/^["“”'‘’]+|["“”'‘’]+$/g, "").trim().toLowerCase())
    .filter((l) => l && !l.startsWith("[fill"));
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export interface LintResult {
  errors: string[];
  warnings: string[];
}

export function voiceLint(text: string, neverSay: readonly string[]): LintResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const sentences = splitSentences(text);
  const words = wordCount(text);

  if (sentences.length < MIN_SENTENCES || sentences.length > MAX_SENTENCES) {
    errors.push(`sentences:${sentences.length} (needs ${MIN_SENTENCES}–${MAX_SENTENCES})`);
  }
  if (words > MAX_WORDS) errors.push(`words:${words} (max ${MAX_WORDS})`);
  for (const phrase of neverSay) {
    const flexible = escapeRe(phrase).replace(/[-\s]+/g, "[-\\s]+");
    if (new RegExp(`(?<![\\p{L}\\p{N}])${flexible}(?![\\p{L}\\p{N}])`, "iu").test(text)) errors.push(`banned:${phrase}`);
  }
  if (/(^|\s)#[\p{L}\p{N}_]+/u.test(text)) errors.push("hashtag");
  if (/\p{Extended_Pictographic}/u.test(text)) errors.push("emoji");
  if (/<\/?[a-z][^>]*>|\*\*|__|`|\[[^\]]+\]\([^)]+\)/i.test(text)) errors.push("markup");
  if (text.includes("!")) errors.push("exclamation");
  if ((text.match(/\?/g) ?? []).length > 1) warnings.push("more than one question");
  return { errors, warnings };
}

/** Commentaries in an issue that open with the same first word (docs/04 §8: warning). */
export function openingRepeats(commentaries: readonly string[]): string[] {
  const firstWord = (t: string) => t.trim().split(/\s+/)[0]?.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "") ?? "";
  const counts = new Map<string, number>();
  for (const c of commentaries) counts.set(firstWord(c), (counts.get(firstWord(c)) ?? 0) + 1);
  return [...counts.entries()].filter(([w, n]) => w && n > 1).map(([w]) => w);
}

const normalizeForNumbers = (s: string) =>
  s
    .replace(/(?<![\p{L}\p{N}])(?:rs\.?|inr)\s*(?=\d)/giu, "₹")
    .replace(/(?<=\d),(?=\d)/g, "")
    .toLowerCase();

/**
 * Numbers as they appear, e.g. "₹2500", "48%", "$9", "2.5", "18x". Digits glued
 * to letters (D2C, Q2, FY26, B2B) are names or codes, not amounts.
 */
function numberTokens(text: string): string[] {
  return normalizeForNumbers(text).match(/(?<![\p{L}\p{N}.])[₹$€£]?\d+(?:\.\d+)?(?:%|x(?![\p{L}]))?(?![\p{L}\p{N}])/gu) ?? [];
}

/** Possessives must not break a name match ("Goyal's Temple" vs "Goyal’s Temple"). */
const dropPossessives = (s: string) => s.replace(/['’]s\b/giu, "");

/**
 * Flags numbers and multi-word names in the commentary that the source title
 * and snippet do not contain (docs/04 §8). Warnings, not errors.
 */
export function groundingLint(commentary: string, sourceText: string): string[] {
  const flags: string[] = [];
  const source = normalizeForNumbers(sourceText);
  const sourceDigits = new Set((source.match(/\d+(?:\.\d+)?/g) ?? []).map(String));

  for (const token of new Set(numberTokens(commentary))) {
    const digits = token.replace(/[₹$€£%x]/g, "");
    if (!sourceDigits.has(digits)) flags.push(`ungrounded_number:${token}`);
  }

  const sourceWords = dropPossessives(source).replace(/[^\p{L}\p{N}\s]/gu, " ");
  const inSource = (words: string[]) => {
    const pattern = words.map(escapeRe).join("\\s+");
    const plain = words.join(" ").replace(/[^\p{L}\p{N}\s]/gu, " ").trim().replace(/\s+/g, "\\s+");
    return new RegExp(`\\b${plain}\\b`, "iu").test(sourceWords) || new RegExp(pattern, "iu").test(source);
  };
  for (const entity of extractEntities(commentary)) {
    if (/\d/.test(entity) || !entity.includes(" ")) continue;
    const words = entity.split(" ");
    if (inSource(words)) continue;
    // A capitalised first word of a sentence ("Passing UPI costs…") is not part of a name.
    if (startsSentence(commentary, words)) {
      const rest = words.slice(1);
      if (rest.length < 2 || inSource(rest)) continue;
    }
    flags.push(`ungrounded_entity:${entity}`);
  }
  return flags;
}

function startsSentence(text: string, words: string[]): boolean {
  const m = new RegExp(words.map(escapeRe).join("\\s+"), "iu").exec(text);
  if (!m) return false;
  const before = text.slice(0, m.index).trimEnd();
  return before === "" || /[.!?]["”’')]*$/u.test(before);
}

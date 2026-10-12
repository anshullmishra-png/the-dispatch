// Title normalisation and entity extraction for duplicate detection (docs/05 §2).

const SUFFIX_SEPARATORS = [" | ", " - ", " — ", " – "];
const MAX_SUFFIX_WORDS = 4;
const LEADING_TAGS = /^(exclusive|breaking|watch)\s*:\s*/i;

/** Drops a trailing publisher suffix ("… - Inc42 Media") when it is ≤4 words. */
export function stripSourceSuffix(title: string): string {
  let cut = -1;
  let sepLength = 0;
  for (const sep of SUFFIX_SEPARATORS) {
    const at = title.lastIndexOf(sep);
    if (at > cut) {
      cut = at;
      sepLength = sep.length;
    }
  }
  if (cut <= 0) return title.trim();
  const suffix = title.slice(cut + sepLength).trim();
  const words = suffix.split(/\s+/).filter(Boolean);
  if (words.length === 0 || words.length > MAX_SUFFIX_WORDS) return title.trim();
  return title.slice(0, cut).trim();
}

function stripLeadingTags(title: string): string {
  let out = title.trim();
  while (LEADING_TAGS.test(out)) out = out.replace(LEADING_TAGS, "");
  return out;
}

/** `Rs 50`, `Rs. 50`, `INR 50`, `Rs50` → `₹50`. */
function normalizeRupees(text: string): string {
  return text.replace(/(?<![\p{L}\p{N}])(?:rs\.?|inr)\s*(?=\d)/giu, "₹").replace(/₹\s+(?=\d)/g, "₹");
}

export function normalizeTitle(title: string): string {
  let t = stripLeadingTags(stripSourceSuffix(title));
  t = normalizeRupees(t).toLowerCase();
  t = t.replace(/(?<=\d),(?=\d)/g, ""); // 1,200 → 1200
  t = t.replace(/['’‘`"“”]/g, ""); // quotes/apostrophes vanish: zepto's → zeptos
  // Anything that is not a letter, digit, currency symbol, or a decimal point
  // between digits becomes a space.
  t = t.replace(/(?<=\d)\.(?=\d)/g, "\u0000");
  t = t.replace(/[^\p{L}\p{N}₹$€£\u0000]+/gu, " ");
  t = t.replace(/\u0000/g, ".");
  return t.replace(/\s+/g, " ").trim();
}

const MONTHS = [
  "january", "february", "march", "april", "may", "june", "july", "august",
  "september", "october", "november", "december",
  "jan", "feb", "mar", "apr", "jun", "jul", "aug", "sep", "sept", "oct", "nov", "dec",
];

const STOP_WORDS = new Set([
  ...MONTHS,
  "india", "indian", "indias", "startup", "startups",
  "a", "an", "the", "and", "or", "but", "of", "in", "on", "at", "to", "for", "from",
  "by", "with", "as", "into", "over", "after", "before", "amid", "about", "against",
  "how", "why", "what", "when", "where", "who", "which", "this", "that", "these",
  "those", "here", "its", "it", "is", "are", "was", "were", "be", "will", "can",
  "new", "top", "now", "more", "most", "says", "say", "said", "report", "reports",
  "exclusive", "breaking", "watch", "explained", "live", "update", "updates",
  "first", "big", "you", "your", "we", "our", "his", "her", "their",
  // Units: number entities keep only currency + digits, so "₹2,500 crore" and
  // "Rs 2,500 Cr" match.
  "cr", "crore", "crores", "lakh", "lakhs", "mn", "million", "bn", "billion", "k",
]);

function normalizeNumberToken(token: string): string {
  return normalizeRupees(token).replace(/(?<=\d),(?=\d)/g, "").toLowerCase();
}

// Punctuation that ends a name phrase: "Elevar Equity, Kalaari Capital" is two
// entities, not one. Apostrophes inside words ("Zepto's") do not break.
// A comma between digits ("2,500") is a thousands separator, not a break.
// A period followed by whitespace ends a sentence, so names never span two.
const PHRASE_BREAK = /,(?!\d)|(?<!\d),|\.(?=\s)|[;:!?()[\]{}|"“”]|\s[-—–]\s|\s['‘’]|['‘’](?=\s|$)/u;

/** Starts with a capital, or is mixed-case like "byteXL" / "iPhone". */
function isNameLike(token: string): boolean {
  return /^[₹$€£]?\p{Lu}/u.test(token) || /\p{Ll}\p{Lu}/u.test(token);
}

/**
 * Capitalised tokens/phrases and numbers from the original title, lowercased,
 * minus a stop-list. Phrases are runs of adjacent name-like words within one
 * punctuation-delimited segment.
 */
export function extractEntities(title: string): string[] {
  const clean = normalizeRupees(stripLeadingTags(stripSourceSuffix(title)));
  const entities = new Set<string>();

  for (const segment of clean.split(PHRASE_BREAK)) {
    const tokens = segment.match(/[₹$€£]?\p{L}[\p{L}\p{N}&.'’-]*|[₹$€£]?\d[\d,.]*%?/gu) ?? [];
    let phrase: string[] = [];
    const flush = () => {
      if (phrase.length > 0) entities.add(phrase.join(" "));
      phrase = [];
    };

    for (const raw of tokens) {
      const token = raw.replace(/['’]s$/u, "").replace(/[.'’-]+$/u, "");
      if (/\d/.test(token)) {
        flush();
        entities.add(normalizeNumberToken(token.replace(/[.,]+$/, "")));
        continue;
      }
      const lower = token.toLowerCase();
      if (isNameLike(token) && !STOP_WORDS.has(lower.replace(/['’.]/g, ""))) {
        phrase.push(lower);
      } else {
        flush();
      }
    }
    flush();
  }
  return [...entities];
}

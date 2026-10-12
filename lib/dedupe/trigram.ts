// JavaScript port of pg_trgm's similarity(). Used where the comparison set is
// not in SQL (normalised Last-4 headlines) and in offline unit tests.
// tests/integration checks it matches Postgres on real titles.
//
// pg_trgm: lowercase; split into words on non-alphanumerics; pad each word with
// two leading spaces and one trailing space; take the set of 3-char windows;
// similarity = |A ∩ B| / |A ∪ B|.

export function trigrams(text: string): Set<string> {
  const set = new Set<string>();
  for (const word of text.toLowerCase().split(/[^\p{L}\p{N}]+/u)) {
    if (!word) continue;
    const padded = `  ${word} `;
    const chars = Array.from(padded);
    for (let i = 0; i + 3 <= chars.length; i += 1) set.add(chars.slice(i, i + 3).join(""));
  }
  return set;
}

export function similarityOfSets(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let shared = 0;
  for (const t of a) if (b.has(t)) shared += 1;
  return shared / (a.size + b.size - shared);
}

export function trigramSimilarity(a: string, b: string): number {
  return similarityOfSets(trigrams(a), trigrams(b));
}

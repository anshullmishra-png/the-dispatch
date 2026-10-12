import { istDate } from "@/lib/time";

export const MAX_CANDIDATES = 80;
export const MAX_PER_SOURCE = 6;

interface Trimmable {
  publishedAt: Date | null;
  publisher: string | null;
}

/**
 * Picks at most `max` candidates for the Gemini call (user decision 2026-10-12):
 * the slots are split evenly across the IST days present, newest first within
 * a day, at most `perSource` per outlet overall; unused slots are refilled
 * newest-first. Never ranks by popularity (docs/04 §2).
 */
export function trimCandidates<T extends Trimmable>(items: readonly T[], max = MAX_CANDIDATES, perSource = MAX_PER_SOURCE): T[] {
  const time = (x: T) => x.publishedAt?.getTime() ?? 0;
  const newestFirst = [...items].sort((a, b) => time(b) - time(a));
  if (newestFirst.length <= max) return newestFirst;

  const byDay = new Map<string, T[]>();
  for (const item of newestFirst) {
    const day = item.publishedAt ? istDate(item.publishedAt) : "undated";
    byDay.set(day, [...(byDay.get(day) ?? []), item]);
  }
  const days = [...byDay.keys()].sort().reverse(); // newest day first gets any remainder slot
  const base = Math.floor(max / days.length);
  const extra = max % days.length;

  const chosen = new Set<T>();
  const perOutlet = new Map<string, number>();
  const take = (item: T): boolean => {
    const outlet = (item.publisher ?? "unknown").toLowerCase();
    const n = perOutlet.get(outlet) ?? 0;
    if (n >= perSource || chosen.has(item)) return false;
    perOutlet.set(outlet, n + 1);
    chosen.add(item);
    return true;
  };

  days.forEach((day, i) => {
    const quota = base + (i < extra ? 1 : 0);
    let taken = 0;
    for (const item of byDay.get(day) ?? []) {
      if (taken >= quota) break;
      if (take(item)) taken += 1;
    }
  });
  for (const item of newestFirst) {
    if (chosen.size >= max) break;
    take(item);
  }
  return newestFirst.filter((x) => chosen.has(x));
}

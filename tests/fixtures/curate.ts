import { readFileSync } from "node:fs";
import type { SelectionOut } from "@/lib/ai/schemas";
import type { CurateContext } from "@/lib/curate/select";
import type { CandidateInfo } from "@/lib/curate/validate";
import { hashUrl } from "@/lib/dedupe/canonical";
import { extractEntities, normalizeTitle } from "@/lib/dedupe/normalize";
import { istDate } from "@/lib/time";
import rawCandidates from "./candidates.json";
import rawSelection from "./selection.json";

export const STYLE_GUIDE = readFileSync("content/style-guide.md", "utf8");

export function fixtureCandidates(): Map<string, CandidateInfo & { publishedAt: Date | null }> {
  const map = new Map<string, CandidateInfo & { publishedAt: Date | null }>();
  for (const c of rawCandidates) {
    map.set(c.shortId, {
      shortId: c.shortId,
      articleId: c.articleId,
      title: c.title,
      titleNorm: normalizeTitle(c.title),
      entities: extractEntities(c.title),
      canonicalHash: hashUrl(`https://example.com/${c.shortId}`),
      clusterRoot: c.articleId,
      snippet: c.snippet,
      publisher: c.publisher,
      publishedAt: new Date(c.publishedAt),
    });
  }
  return map;
}

/** A fresh deep copy of the valid fixture, safe to mutate per test. */
export function validSelection(): SelectionOut {
  return structuredClone(rawSelection) as SelectionOut;
}

export function fixtureContext(overrides: Partial<CurateContext> = {}): CurateContext {
  const candidates = fixtureCandidates();
  return {
    styleGuide: { version: 2, content: STYLE_GUIDE },
    neverSay: [],
    candidates,
    promptCandidates: [...candidates.values()].map((c) => ({
      id: c.shortId,
      source: c.publisher ?? "unknown",
      published: c.publishedAt ? istDate(c.publishedAt) : "unknown",
      title: c.title,
      snippet: c.snippet ?? "",
    })),
    lastFour: [],
    fewShot: [],
    candidatesTotal: candidates.size,
    ...overrides,
  };
}

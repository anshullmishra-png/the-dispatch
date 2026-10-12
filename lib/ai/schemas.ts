import { z } from "zod";
import topicsJson from "@/content/topics.json";

export const TOPICS = topicsJson as [string, ...string[]];
export const SIGNAL_TYPES = ["counterintuitive", "under_reported", "trend_link"] as const;
export type SignalType = (typeof SIGNAL_TYPES)[number];

export const PICKS_MIN = 8;
export const PICKS_MAX = 10;
export const BACKUPS = 5;

/**
 * Lenient shape used to *parse* the model's answer. Counts, lengths and id
 * validity are left to validateSelection(), so a bad answer produces precise
 * violations for the re-prompt instead of a single opaque parse error.
 */
export const StoryShape = z.object({
  article_id: z.string(),
  topic: z.string(),
  signal_type: z.string(),
  rationale: z.string(),
  commentary: z.string(),
});
export const SelectionShape = z.object({
  picks: z.array(StoryShape),
  backups: z.array(StoryShape),
});
export type StoryOut = z.infer<typeof StoryShape>;
export type SelectionOut = z.infer<typeof SelectionShape>;

/** Strict schema (docs/04 §5), with article ids restricted to this call's candidates. */
export function strictSelectionSchema(candidateIds: readonly string[]) {
  const ids = candidateIds as [string, ...string[]];
  const Story = z.object({
    article_id: z.enum(ids),
    topic: z.enum(TOPICS),
    signal_type: z.enum(SIGNAL_TYPES),
    rationale: z.string().min(10).max(220),
    commentary: z.string().min(40).max(500),
  });
  return z.object({
    picks: z.array(Story).min(PICKS_MIN).max(PICKS_MAX),
    backups: z.array(Story).length(BACKUPS),
  });
}

/** JSON Schema sent to Gemini as `responseJsonSchema`. */
export function selectionJsonSchema(candidateIds: readonly string[]): Record<string, unknown> {
  return z.toJSONSchema(strictSelectionSchema(candidateIds)) as Record<string, unknown>;
}

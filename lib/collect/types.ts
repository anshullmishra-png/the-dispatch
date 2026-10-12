/** One article as fetched from a feed or the news API, before storage. */
export interface CollectedItem {
  url: string;
  title: string;
  snippet: string | null;
  publisher: string | null;
  publishedAt: Date | null;
  raw: Record<string, unknown>;
}

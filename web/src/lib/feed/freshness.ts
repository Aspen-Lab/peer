// How stale a paper may be before a *daily* briefing stops carrying it.
//
// The reader's freshness setting ("today" / "week" / "month") reaches the
// source queries — OpenAlex and PubMed scope their searches by date — but
// Semantic Scholar's search takes no date parameter, so it answers with its
// best matches of all time. That is how the 2000 PSIPRED server paper and the
// 2020 AlphaFold paper arrived in a pool labelled "today": both are squarely
// on topic, neither is news.
//
// Nothing caught them afterwards. They stayed out of the briefing only
// because recency carried more weight than relevance in the ranking — so the
// moment relevance is allowed to lead (scoring/combine.ts), the classics
// surface. The two changes belong together.
//
// This is a ceiling, not the reader's window: the window shapes what is
// fetched and how recency scores, while the ceiling only says what a daily
// briefing may never contain. It is generous — a paper three weeks past a
// "week" window still counts as news — because the alternative, a hard window,
// empties the briefing on a thin day (a two-day window over today's pool
// leaves nothing at all).

import type { FeedFreshness } from "./profile-compiler";

const CEILING_DAYS: Record<FeedFreshness, number> = {
  today: 30,
  week: 60,
  month: 180,
};

export function staleAfterDays(window: FeedFreshness | undefined): number {
  return CEILING_DAYS[window ?? "week"];
}

/**
 * True when the paper is too old for a briefing of this window. An unusable
 * date is never stale: a missing `publishedAt` means the source did not say,
 * and dropping those loses real papers (DBLP hands over a bare year, some
 * OpenAlex records carry nothing at all).
 */
export function isStale(
  publishedAt: string | undefined,
  window: FeedFreshness | undefined,
  now: number,
): boolean {
  if (!publishedAt) return false;
  const t = Date.parse(publishedAt);
  if (!Number.isFinite(t)) return false;
  const ageDays = (now - t) / 86_400_000;
  return ageDays > staleAfterDays(window);
}

export function dropStale<T extends { publishedAt?: string }>(
  items: T[],
  window: FeedFreshness | undefined,
  now: number,
): T[] {
  return items.filter((item) => !isStale(item.publishedAt, window, now));
}

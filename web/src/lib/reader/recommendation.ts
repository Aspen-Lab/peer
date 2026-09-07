// The one line under the authors saying why a paper is in today's briefing.
//
// `relevanceReason` has three writers, and two of them write a sentence that
// is not a reason: `/api/papers/[id]` stamps a paper resolved by id with a
// line about search, and the reranker fills an empty reason with a generic
// default. Under a title those read as claims — "pulled from your search" on
// a paper that was not — so only the briefing's own copy of the paper is
// asked, and only a reason that is not one of the fill-ins is shown. Absence
// is no line at all, never a made-up one. The strings live here so the
// writers and the page cannot drift apart.

/** What `/api/papers/[id]` stamps on a paper resolved by id — a deep link, not a recommendation. */
export const DEEP_LINK_REASON =
  "Pulled from your search. Summary below is the paper's own abstract.";

/** What the reranker writes when scoring produced no reason at all. */
export const RERANK_DEFAULT_REASON = "Matched against your daily search plan.";

/** What scoring writes when neither a keyword nor a signal matched. */
export const SCORING_FALLBACK_REASON = "Surfaced from your feed sources.";

const FILL_INS: ReadonlySet<string> = new Set([
  DEEP_LINK_REASON,
  RERANK_DEFAULT_REASON,
  SCORING_FALLBACK_REASON,
]);

/**
 * The recommendation line for the briefing's copy of a paper: its
 * `relevanceReason` verbatim when it is a reason, null when it is empty or
 * one of the fill-ins. Callers pass the store's copy, never the fetched one.
 */
export function recommendationLine(reason: string | null | undefined): string | null {
  const text = reason?.trim();
  if (!text || FILL_INS.has(text)) return null;
  return text;
}

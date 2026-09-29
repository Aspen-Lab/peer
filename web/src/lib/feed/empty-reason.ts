// Why the briefing has nothing to show — because the three reasons need three
// different answers, and the page used to give one answer for all of them.
//
//   intent-required  nothing was ever declared to build a briefing FROM: no
//                    project, challenge or topic. store/feed.ts's own
//                    starter-topics fallback (STARTER_TOPICS_KEY) means a
//                    real fetch almost never reaches this with zero papers —
//                    see page.tsx's merged FIRST-VISIT RULING, which renders
//                    this the same way as the ordinary starter-feed setup
//                    strip rather than a second, separate onboarding message.
//   error            the fetch failed: a dead connection, a 500 — retry, don't reconfigure
//   empty            the search ran and found nothing new, and no more specific
//                     honest reason was available — refresh or widen, don't panic
//
// A user with a dead connection was being told to "set up your profile".
//
// There used to be a fourth reason, `no-topics` (checked ahead of
// `intent-required`, on `topicsCount === 0`). It is retired for the same
// reason main retired it: the caller now always supplies a topics key —
// either the reader's own, or the starter fallback — so a literal empty
// topic list can no longer reach here at all; `intentRequired` is the
// broader, still-live signal (project/challenge/topic all absent) that
// replaces it.
//
// EMPTY-STATE-REASON (ABC-JEV-INTEGRATION.md §1bb) — `empty` used to be the
// ONE answer for "the search ran and found nothing," no matter which of
// several very different situations actually caused it (every source down,
// nothing recent enough, nothing matched the reader's own Required topics,
// or everything that matched was already shown). The server now computes,
// from facts it already has and never a guess, which of a small fixed set of
// honest reasons applies — `FeedEmptyReasonCode`, declared once in
// `./types.ts` next to `FeedMeta.emptyReasonCode` — and `reasonCode` below
// carries it in. `empty` itself is kept as a literal member (not folded into
// `FeedEmptyReasonCode`) because it is still the required fallback whenever
// the server sent no code, or sent one this client build doesn't recognize —
// "stay silent rather than guess" (guide §2) applies on the client too.

import { FEED_EMPTY_REASON_CODES, type FeedEmptyReasonCode } from "./types";

export type EmptyReason = "intent-required" | "error" | "empty" | FeedEmptyReasonCode;

export function emptyReason(input: {
  isLoading: boolean;
  papersCount: number;
  feedError: string | null;
  intentRequired?: boolean;
  /**
   * EMPTY-STATE-REASON — the server's own honest reason for an empty
   * response, forwarded from `FeedMeta.emptyReasonCode` via the feed store.
   * Checked AFTER `feedError` (a thrown error always wins — the two can
   * never both be live for the same load in practice, since a code only
   * ever arrives on a successful 200, but the precedence is still coded
   * explicitly rather than left to accident) and only used when it is one of
   * the known codes; anything absent or unrecognized falls through to the
   * existing generic `"empty"`, never a guess.
   */
  reasonCode?: FeedEmptyReasonCode;
}): EmptyReason | null {
  if (input.isLoading || input.papersCount > 0) return null;
  if (input.intentRequired) return "intent-required";
  if (input.feedError) return "error";
  // A JSON response is `unknown` at runtime regardless of what the type
  // annotation promises — checked against the known set, not just
  // truthiness, so a value this build doesn't recognize falls through to
  // "empty" instead of being trusted and rendered as-is.
  if (input.reasonCode && FEED_EMPTY_REASON_CODES.includes(input.reasonCode)) {
    return input.reasonCode;
  }
  return "empty";
}

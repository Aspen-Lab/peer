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
//   empty            the search ran and found nothing new: refresh or widen, don't panic
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

export type EmptyReason = "intent-required" | "error" | "empty";

export function emptyReason(input: {
  isLoading: boolean;
  papersCount: number;
  feedError: string | null;
  intentRequired?: boolean;
}): EmptyReason | null {
  if (input.isLoading || input.papersCount > 0) return null;
  if (input.intentRequired) return "intent-required";
  if (input.feedError) return "error";
  return "empty";
}

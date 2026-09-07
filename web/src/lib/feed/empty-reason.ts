// Why the briefing has nothing to show — because the three reasons need three
// different answers, and the page used to give one answer for all of them.
//
//   no-topics  the reader never said what they work on: onboarding, not an error
//   error      the fetch failed: a dead connection, a 500 — retry, don't reconfigure
//   empty      the search ran and found nothing new: refresh or widen, don't panic
//
// A user with a dead connection was being told to "set up your profile".

export type EmptyReason = "no-topics" | "error" | "empty";

export function emptyReason(input: {
  isLoading: boolean;
  papersCount: number;
  topicsCount: number;
  feedError: string | null;
}): EmptyReason | null {
  if (input.isLoading || input.papersCount > 0) return null;
  if (input.topicsCount === 0) return "no-topics";
  if (input.feedError) return "error";
  return "empty";
}

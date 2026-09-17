// Why the briefing has nothing to show — because the three reasons need three
// different answers, and the page used to give one answer for all of them.
//
//   error      the fetch failed: a dead connection, a 500 — retry, don't reconfigure
//   empty      the search ran and found nothing new: refresh or widen, don't panic
//
// A user with a dead connection was being told to "set up your profile".
//
// There used to be a third reason, `no-topics`. It could not fire: the caller
// passes `starter ? 1 : topics.length`, and `isStarterFeed` is true exactly
// when the trimmed topic list is empty — so the count was never 0. Had it
// fired it would have sent a first-time reader to the profile form that the
// zero-setup first run deliberately took out of the way.

export type EmptyReason = "error" | "empty";

export function emptyReason(input: {
  isLoading: boolean;
  papersCount: number;
  feedError: string | null;
}): EmptyReason | null {
  if (input.isLoading || input.papersCount > 0) return null;
  if (input.feedError) return "error";
  return "empty";
}

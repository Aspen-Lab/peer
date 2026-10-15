// The first visit, as rules (P7-16, the owner's R12).
//
// A profile that has never been set up opens on the /welcome walkthrough once,
// from the home page. `components/first-run.tsx` is the gate that acts on this;
// the rules live here so they can be read, and tested, with no React in the way.
//
// **From the home page only** (P7-16c, §1h.35 (a)): a reader who opens a shared
// paper link, a search or any other route is left where they are. A deep link
// is somebody's answer to "where do you want to go", and a first-time visitor
// who follows one is never pulled off it into a form. The reader who is
// meant to meet the walkthrough is the one who opens Peer itself, and that is
// `/`.
//
// "Never set up" means nothing at all: no onboarding stamp, no research topic,
// no project or challenge, no model key, and the walkthrough has not already
// been shown or skipped. Anything one of those says is the reader's own word,
// and a reader who has given one is never sent anywhere. (This is the same
// "nothing declared" that makes the home page show its sample: topics, project
// and challenge, see `activePaperTopicsKey` in `store/feed.ts`.)

import type { UserProfile } from "@/types";

/** The parts of a profile the first-visit rules read. */
export type FirstVisitProfile = Pick<
  UserProfile,
  | "onboardedAt"
  | "researchTopics"
  | "currentProject"
  | "currentChallenges"
  | "feedAiApiKey"
  | "welcomeSkipped"
>;

/** True when the reader has told Peer anything, or has already met the walkthrough. */
export function hasBeenSetUp(profile: FirstVisitProfile): boolean {
  return (
    Boolean(profile.onboardedAt) ||
    Boolean(profile.welcomeSkipped) ||
    profile.researchTopics.length > 0 ||
    Boolean(profile.currentProject?.trim()) ||
    Boolean(profile.currentChallenges?.trim()) ||
    Boolean(profile.feedAiApiKey?.trim())
  );
}

/**
 * What the first-run gate does on this page, once the profile can be trusted:
 *  - `"redirect"`: the reader is on the home page (`/`, and only there): send
 *    them to /welcome, and record that it was done;
 *  - `"record"`: the reader is on /welcome already — leave them there, and
 *    record that they have been shown it, so leaving does not bring them back;
 *  - `null`: nothing. Every other page, a deep link above all, is left alone.
 */
export function walkthroughAction(
  pathname: string | null,
  profile: FirstVisitProfile,
): "redirect" | "record" | null {
  if (!pathname) return null;
  if (hasBeenSetUp(profile)) return null;
  if (pathname === "/welcome") return "record";
  if (pathname === "/") return "redirect";
  return null;
}

// Per-step completeness for the onboarding wizard — the "already done, don't
// redo it" model. Everything is derived live from the profile store (plus the
// persona quiz's localStorage result), never stored separately, so ticks stay
// truthful as the user types and when a synced profile lands mid-session.

import type { UserProfile } from "@/types";
import { defaultProfile } from "@/types";
import { aiAvailability } from "@/lib/feed/ai-tier";
import type { AuthOutcome } from "@/components/profile-sync";

export type StepKey =
  | "account"
  | "basics"
  | "topics"
  | "work"
  | "radar"
  | "ai"
  | "persona";

export interface StepMeta {
  key: StepKey;
  label: string;
}

/**
 * Every step the wizard can show, in order. Account comes first: a reader's
 * own model key works only while they are signed in, and signing in is what
 * keeps topics, saved papers and settings on every device, so a new reader is
 * offered it before typing anything. It stays optional ("Continue without
 * signing in"). Where sign-in is not configured at all the step is left out —
 * see `visibleSteps`.
 */
export const STEP_META: StepMeta[] = [
  { key: "account", label: "Account" },
  { key: "basics", label: "Basics" },
  { key: "topics", label: "Topics" },
  { key: "work", label: "Work" },
  { key: "radar", label: "Radar" },
  { key: "ai", label: "AI" },
  { key: "persona", label: "Persona" },
];

/**
 * The steps this reader's wizard shows: all of them, less Account where
 * sign-in is not configured (a self-hosted copy has no account to offer).
 *
 * `"unknown"` keeps the step. The page shows no step until the profile has
 * settled, and by then a deployment without sign-in has already said
 * `"unconfigured"` (it is known at once, with no request); a check still
 * unanswered after that can only end in signed-in or signed-out, both of which
 * show the step. So the list is decided once and the step never flashes in or
 * out.
 */
export function visibleSteps(auth: AuthOutcome): StepMeta[] {
  return auth === "unconfigured"
    ? STEP_META.filter((step) => step.key !== "account")
    : STEP_META;
}

/**
 * Whether to offer the sign-in buttons: not signed in, on a deployment that
 * has sign-in. `"unknown"` offers them too — `aiAvailability` reads it as no
 * model, so "sign in to use your key" stays true for that reader.
 */
export function offersSignIn(auth: AuthOutcome): boolean {
  return auth === "signed-out" || auth === "unknown";
}

/**
 * Resolve a shareable walkthrough query such as `/welcome?step=ai`, as an
 * index into the steps the reader is shown (`visibleSteps`). A key that is not
 * in that list — a retired step, or Account where sign-in is not configured —
 * is `null`, and the wizard opens at the first unfinished step instead.
 */
export function stepIndexFromKey(
  key: string | null,
  steps: readonly StepMeta[] = STEP_META,
): number | null {
  if (!key) return null;
  const index = steps.findIndex((step) => step.key === key);
  return index === -1 ? null : index;
}

// Radar fields the wizard actually renders — deviation from any default (or a
// journal added) counts as "tuned". feedMethodMode isn't rendered, so it's
// deliberately excluded.
const RADAR_FIELDS = [
  "feedFocus",
  "feedFreshness",
  "paperCount",
  "feedSourceMix",
  "feedImportance",
  "feedDiscoveryMode",
  "feedAvoidReviews",
  "feedAvoidOldPapers",
  "feedAvoidBroadSurveys",
] as const;

export function isStepDone(
  key: StepKey,
  profile: UserProfile,
  personaDone: boolean,
  // Only the `account` and `ai` steps read it. Defaults to "signed-out" so an
  // unchanged caller sees the answer for a reader who is not signed in.
  auth: AuthOutcome = "signed-out",
): boolean {
  switch (key) {
    case "account":
      return auth === "signed-in";
    case "basics":
      // A typed name is the reliable sentinel; the pill fields are deviation
      // proxies (a real PhD-Y3/"both" user who typed no name reads un-done,
      // which is acceptable for an optional step).
      return (
        profile.displayName !== defaultProfile.displayName ||
        profile.careerStage !== defaultProfile.careerStage ||
        profile.industryVsAcademia !== defaultProfile.industryVsAcademia
      );
    case "topics":
      return profile.researchTopics.length > 0;
    case "work":
      return Boolean(
        profile.currentProject ||
          profile.currentChallenges ||
          profile.school ||
          profile.advisorName ||
          profile.advisorAuthorId,
      );
    case "radar":
      return (
        RADAR_FIELDS.some((f) => profile[f] !== defaultProfile[f]) ||
        (profile.preferredJournals?.length ?? 0) > 0
      );
    case "ai":
      // Done when a model will actually run for this reader: they have pasted
      // their own key and are signed in (or sign-in is not configured here).
      // Peer holds no key of its own, so there is no other way to be done.
      return aiAvailability(profile, auth) !== "none";
    case "persona":
      return personaDone;
  }
}

/** Same key the persona quiz persists its result under (see persona/quiz.tsx). */
const PERSONA_STORAGE_KEY = "peer:persona:v1";

/** Client-only: has the persona quiz been completed on this browser? */
export function readPersonaDone(): boolean {
  if (typeof window === "undefined") return false;
  try {
    const raw = window.localStorage.getItem(PERSONA_STORAGE_KEY);
    if (!raw) return false;
    const parsed = JSON.parse(raw) as { scores?: unknown } | null;
    return Boolean(parsed && typeof parsed.scores === "object" && parsed.scores);
  } catch {
    return false;
  }
}

/**
 * Where the wizard should open: the first step whose data is missing, as an
 * index into `visibleSteps(auth)`. A fully set-up profile lands on the last
 * step (persona), where "Enter Peer" is immediately available — review, don't
 * redo. A reader who is not signed in (where sign-in exists) has Account
 * unfinished, so they open on it, first.
 */
export function firstIncompleteStep(
  profile: UserProfile,
  personaDone: boolean,
  auth: AuthOutcome = "signed-out",
): number {
  const steps = visibleSteps(auth);
  const i = steps.findIndex(
    (m) => !isStepDone(m.key, profile, personaDone, auth),
  );
  return i === -1 ? steps.length - 1 : i;
}

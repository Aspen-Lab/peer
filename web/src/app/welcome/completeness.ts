// Per-step completeness for the onboarding wizard — the "already done, don't
// redo it" model. Everything is derived live from the profile store (plus the
// persona quiz's localStorage result), never stored separately, so ticks stay
// truthful as the user types and when a synced profile lands mid-session.

import type { UserProfile } from "@/types";
import { defaultProfile } from "@/types";
import { aiAvailability } from "@/lib/feed/ai-tier";
import {
  ANONYMOUS_ENTITLEMENT,
  type Entitlement,
} from "@/lib/entitlement/types";

export type StepKey =
  | "basics"
  | "topics"
  | "work"
  | "radar"
  | "ai"
  | "connectors"
  | "persona";

export const STEP_META: { key: StepKey; label: string }[] = [
  { key: "basics", label: "Basics" },
  { key: "topics", label: "Topics" },
  { key: "work", label: "Work" },
  { key: "radar", label: "Radar" },
  { key: "ai", label: "AI" },
  // "Data" matches the feed toolbar's "Data APIs" control; "Sources" would
  // collide with the radar step's Sources field.
  { key: "connectors", label: "Data" },
  { key: "persona", label: "Persona" },
];

/** Resolve a shareable walkthrough query such as `/welcome?step=ai`. */
export function stepIndexFromKey(key: string | null): number | null {
  if (!key) return null;
  const index = STEP_META.findIndex((step) => step.key === key);
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

/** Whether the one remaining data connector (Tavily) is configured. */
export function connectorCount(profile: UserProfile): number {
  return profile.tavilyEnabled && profile.tavilyApiKey?.trim() ? 1 : 0;
}

export function isStepDone(
  key: StepKey,
  profile: UserProfile,
  personaDone: boolean,
  // ABC-freemium 1-15 — only the `ai` step reads it. Defaults to anonymous so
  // an unchanged caller sees the old answer for a signed-out reader.
  entitlement: Pick<Entitlement, "userId"> = ANONYMOUS_ENTITLEMENT,
): boolean {
  switch (key) {
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
      // ABC-freemium 1-15 · R-KEY-4 — **the two halves were required because
      // `"default"` meant no AI.** Under D1 it means Peer's AI, so a signed-in
      // reader who never opens the panel already has a model and the step is
      // complete. Adding your own key stops being a prerequisite and becomes an
      // upgrade — which is also why 1-25 rewrites the panel's copy.
      //
      // Stated rather than deleted: without this comment the next reader sees a
      // removed check and reads it as a bug.
      return aiAvailability(profile, entitlement) !== "none";
    case "connectors":
      return connectorCount(profile) > 0;
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
 * Where the wizard should open: the first step whose data is missing. A fully
 * set-up profile lands on the last step (persona), where "Enter Peer" is
 * immediately available — review, don't redo.
 */
export function firstIncompleteStep(
  profile: UserProfile,
  personaDone: boolean,
  entitlement: Pick<Entitlement, "userId"> = ANONYMOUS_ENTITLEMENT,
): number {
  const i = STEP_META.findIndex(
    (m) => !isStepDone(m.key, profile, personaDone, entitlement),
  );
  return i === -1 ? STEP_META.length - 1 : i;
}

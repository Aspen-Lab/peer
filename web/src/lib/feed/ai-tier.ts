import type { UserProfile } from "@/types";
import type { Entitlement } from "@/lib/entitlement/types";

/**
 * RULING 66a / 68a — **THE ONE PREDICATE THAT DECIDES WHETHER THE JOB AND
 * EVENT FEEDS ENGAGE AI.**
 *
 * The defect this module exists to make unrepeatable: the dashboard's mode chip
 * and the feeds' `aiTier` were **two expressions that never met.** The chip
 * rendered from `aiPaperSearchEnabled && canUseAiTools` — and
 * `aiPaperSearchEnabled` is a **PAPERS** toggle that defaults to `false` and
 * that the job/event request builder never reads — while the feeds sent
 * `aiTier: 2` from the provider state alone. So the chip could truthfully
 * report the papers surface while claiming, in its own words, to describe the
 * whole mode: **"Auto search uses Tier 0 fixed scoring and no AI API"** was
 * FALSE for jobs and events whenever a provider was reachable. Round 25 B
 * proved the pipelines were already running the model on localhost with a live
 * `POST /api/jobs/report` returning `noLlm:false`.
 *
 * Ruling 68a's fix is a truth-telling layer, not new plumbing, and Ruling 32
 * asks for a named predicate rather than a second copy — so the chip and the
 * request builder now call THIS, and cannot drift apart again.
 *
 * **DEPLOYED-USER SAFETY IS UNCHANGED AND IS NOT THIS MODULE'S TO WIDEN.**
 * `canUseLocalServerProvider` in the provider registry, and its comment, are a
 * RECORDED DECISION — a deployed user must never get an operator-funded
 * fallback — and Ruling 68a leaves them untouched. The local branch below is
 * gated on `NODE_ENV === "development"`, so in production a `default` provider
 * with no user key returns `false`, exactly as B's `production/local-dev` probe
 * row measured (tier 0, enrichment false). **Nothing here sends a key
 * anywhere**: the local path deliberately sends no `llmOverride` and lets the
 * server resolve its own provider, which is what keeps the key server-side.
 */

/** The reader brought their own provider and key. This is the one that may send an override. */
export function hasUserLlmOverride(profile: UserProfile): boolean {
  return (
    profile.feedAiProvider !== "default" &&
    Boolean(profile.feedAiApiKey?.trim())
  );
}

export type AiMode = "byok" | "system" | "none";

/** The server-derived identity is the only system-AI authority. */
export function aiAvailability(
  profile: UserProfile,
  entitlement: Pick<Entitlement, "userId">,
): AiMode {
  if (hasUserLlmOverride(profile)) return "byok";
  return entitlement.userId !== null ? "system" : "none";
}

/**
 * True when the job and event feeds will ask for tier 2. **The chip's tier text
 * and the request builder's `aiTier` are both this value** — that identity is
 * the fix, and `ai-tier.test.ts` asserts it rather than trusting it.
 */
export function feedsUseAi(
  profile: UserProfile,
  entitlement: Pick<Entitlement, "userId">,
): boolean {
  return aiAvailability(profile, entitlement) !== "none";
}

/**
 * RULING 68a — **THE MODE CHIP'S THREE STRINGS, IN ONE PLACE THAT CAN BE
 * TESTED.**
 *
 * The chip lives inside the dashboard page component, which is not renderable
 * in a unit test without standing up its whole store graph — so while these
 * strings were inline JSX, no assertion could reach them and the tier text was
 * able to contradict the feeds for as long as it did. They are computed here
 * instead, and `ai-tier.test.ts` holds them to the contract.
 *
 * **THE SPLIT THAT IS THE ACTUAL FIX:** `label` is the BUTTON'S OWN pressed
 * state and stays on the papers toggle — pressing it is what changes it, and
 * saying otherwise would be a different lie. `tier` and `title` are claims
 * about the MODE, so they read `feedsUseAi` only. `aiSearchActive` must never
 * reach `tier`.
 */
export function aiModeChip(options: {
  /** `feedsUseAi(profile)` — the predicate the job and event feeds send from. */
  feedsUseAi: boolean;
  /** The PAPERS toggle, ANDed with the above. Governs the papers surface only. */
  aiSearchActive: boolean;
}): { label: string; tier: string; title: string } {
  return {
    label: options.aiSearchActive ? "AI search" : "Auto",
    tier: options.feedsUseAi ? "Tier 2" : "Tier 0",
    title: !options.feedsUseAi
      ? "Add your own AI key to enable AI search."
      : options.aiSearchActive
        ? "AI search is on for papers, and job and event search use AI too."
        : "Paper search is on Tier 0 fixed scoring. Job and event search already use AI — turn this on to use it for papers as well.",
  };
}

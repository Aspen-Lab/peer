// The AI row of the wizard's closing "What Peer knows so far" list, as a pure
// function so each state is tested on its own.

import type { UserProfile } from "@/types";
import type { AuthOutcome } from "@/components/profile-sync";
import { hasUserLlmOverride } from "@/lib/feed/ai-tier";
import { providerShortLabel } from "@/components/profile/ai-setup";
import { isStepDone } from "./completeness";

/**
 * - A model will run (own key, and signed in or no sign-in configured):
 *   "Gemini key connected".
 * - A key is saved but the reader is not signed in, so it does not run yet:
 *   "Gemini key saved — sign in to use it". This used to read "No key", which
 *   was false: the key is right there in this browser.
 * - No key: "No key — reading without a model".
 *
 * Only the yes/no of `hasUserLlmOverride` and the provider's name are read,
 * never the key itself.
 */
export function aiStepSummary(profile: UserProfile, auth: AuthOutcome): string {
  const provider = providerShortLabel(profile.feedAiProvider);
  if (isStepDone("ai", profile, false, auth)) return `${provider} key connected`;
  if (hasUserLlmOverride(profile)) return `${provider} key saved — sign in to use it`;
  return "No key — reading without a model";
}

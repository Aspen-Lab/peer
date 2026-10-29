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
 * - A key is saved but the reader is signed out, so it does not run yet:
 *   "Gemini key saved — sign in to use it". This used to read "No key", which
 *   was false: the key is right there in this browser.
 * - A key is saved and the sign-in check has not answered (`"unknown"`):
 *   "Gemini key saved", with no instruction — the reader may well be signed
 *   in, and a signed-in reader must not be told to sign in (L4-fix, N1).
 * - No key: "No key — reading without a model".
 *
 * Only the yes/no of `hasUserLlmOverride` and the provider's name are read,
 * never the key itself.
 */
export function aiStepSummary(profile: UserProfile, auth: AuthOutcome): string {
  const provider = providerShortLabel(profile.feedAiProvider);
  if (isStepDone("ai", profile, false, auth)) return `${provider} key connected`;
  if (hasUserLlmOverride(profile)) {
    return auth === "signed-out" ? `${provider} key saved — sign in to use it` : `${provider} key saved`;
  }
  return "No key — reading without a model";
}

import type { UserProfile } from "@/types";
import type { AuthOutcome } from "@/components/profile-sync";

/**
 * RULING 66a / 68a — **THE ONE PREDICATE THAT DECIDES WHETHER THE FEEDS AND
 * THE REPORT ENGAGE A MODEL.**
 *
 * The defect this module exists to make unrepeatable: the dashboard's mode chip
 * and the feeds' `aiTier` were **two expressions that never met**, so the chip
 * could say "no AI" while a request went out asking for it. Ruling 32 asks for a
 * named predicate rather than a second copy — so the chip, the request builders
 * and the reader's report all call THIS, and cannot drift apart again.
 *
 * **Peer has no model key of its own.** The only model a reader can ever reach
 * is the one behind the key they pasted into the browser, so this module has two
 * answers, not three: the reader's own key (`"byok"`) or no model (`"none"`).
 * `"none"` is not a failure state — it is the reading without a model, which is
 * the whole of what Peer does for a reader who has not added a key.
 *
 * **Nothing here sends a key anywhere.** It answers a yes/no question; the
 * request builders decide what goes in the body.
 */

/** The reader brought their own provider and key. This is the one that may send an override. */
export function hasUserLlmOverride(profile: UserProfile): boolean {
  return (
    profile.feedAiProvider !== "default" &&
    Boolean(profile.feedAiApiKey?.trim())
  );
}

/**
 * Which model, if any, this reader gets: their own key, or none.
 *
 * ABC-freemium 1-14 · R-ENT-3 collapsed four separate "has the reader a key"
 * predicates into this one. The report and digest caches key on the value
 * (`ai=${mode}`), so a report written on the reader's key is never served as a
 * no-model reading and the other way round.
 *
 * **A key alone is not enough: the reader must also be signed in.** Every AI
 * route refuses a signed-out caller (the report and figure routes make Peer's
 * server fetch an address the caller names, and the hourly limit is counted per
 * account), and the feed route lowers a signed-out caller to the reading
 * without a model whatever the body says. So a signed-out reader with a key is
 * `"none"`: the chip, the Deep report toggle and the request builders then say
 * what the server will actually do. The one exception is a deployment with no
 * sign-in configured at all (`"unconfigured"`: a self-hosted copy or a test
 * run), where the server lets the call through as well.
 *
 * `"unknown"` — the auth check has not answered yet — is `"none"`: refusing a
 * model for a moment costs a reader a re-render, claiming one that the server
 * then refuses puts a wrong "AI on" on screen. The feed's auto-load already
 * waits for the auth outcome (`app/page.tsx`), so no load is built from the
 * unknown window.
 */
export type AiMode = "byok" | "none";

export function aiAvailability(profile: UserProfile, auth: AuthOutcome): AiMode {
  if (!hasUserLlmOverride(profile)) return "none";
  return auth === "signed-in" || auth === "unconfigured" ? "byok" : "none";
}

/**
 * True when the feeds will ask for tier 2. **The chip's text and all three
 * request builders' `aiTier` are this same value** — that identity is the fix,
 * and `ai-tier.test.ts` asserts it rather than trusting it.
 */
export function feedsUseAi(profile: UserProfile, auth: AuthOutcome): boolean {
  return aiAvailability(profile, auth) !== "none";
}

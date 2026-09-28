/**
 * JEV-DIRECT (§1aa point 6) — the opt-in gate and presence-only credential
 * report for the live Jev smoke runner. Mirrors `evaluation/live-channels/
 * live-channels-gate.ts` exactly.
 *
 * `credentialPresence()` calls `jevDirectConfigured()`
 * (`decisions/jev-direct-client.ts`) rather than reading
 * `process.env.JEV_API_KEY` itself: that module is the ONE file allowed to
 * read that name (enforced by `security/spend-scans.test.ts`'s placement
 * scan) and it already exposes exactly the boolean this gate needs — a
 * second, independent env read here would both violate that placement rule
 * and risk silently drifting from the real "is this configured" logic.
 */

import { jevDirectConfigured } from "@/lib/decisions/jev-direct-client";

/** The live Jev smoke run is opt-in even when a machine happens to have JEV_API_KEY set. */
export function canRunJevSmoke(): boolean {
  return process.env.PEER_RUN_JEV_SMOKE === "1";
}

export interface JevSmokeCredentialPresence {
  jevApiKey: boolean;
}

/**
 * Presence boolean only — a credential VALUE must never appear in any
 * output this runner produces. Delegates to `jevDirectConfigured()`, so this
 * function itself never touches `process.env` directly.
 */
export function credentialPresence(): JevSmokeCredentialPresence {
  return { jevApiKey: jevDirectConfigured() };
}

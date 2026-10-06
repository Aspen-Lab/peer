/**
 * The opt-in gate and presence-only credential report for the live Jev smoke
 * runner. Mirrors `evaluation/live-channels/live-channels-gate.ts`.
 *
 * Peer holds no Jev key of its own (the owner cut that path on 2026-10-06;
 * Jev is a key the reader brings), and no file reads the old company name any
 * more. The smoke runner is a developer tool that needs *a* key to make its
 * four live calls, so it reads its OWN variable, `JEV_SMOKE_API_KEY`, which only
 * the dedicated smoke config injects (`vitest.env-allowlist.ts`) and which the
 * test setup strips everywhere else. The value is handed to `callJevDirect` as
 * its `apiKey` parameter, exactly as a reader's key is.
 *
 * The functions take the environment as an argument (default: the process
 * environment) so a test can supply one without touching the real one.
 */

import { parseJevApiKey } from "@/lib/decisions/jev-key";

/** The smoke runner's own variable name. Not the old company name: nothing reads that. */
export const JEV_SMOKE_KEY_NAME = "JEV_SMOKE_API_KEY";

type Env = Record<string, string | undefined>;

/** The live Jev smoke run is opt-in even when a machine happens to have the smoke key set. */
export function canRunJevSmoke(): boolean {
  return process.env.PEER_RUN_JEV_SMOKE === "1";
}

/** The smoke key, trimmed, or `undefined` when it is unset, blank or not shaped like a key. */
export function readJevSmokeApiKey(env: Env = process.env): string | undefined {
  return parseJevApiKey(env[JEV_SMOKE_KEY_NAME]);
}

export interface JevSmokeCredentialPresence {
  jevApiKey: boolean;
}

/**
 * Presence boolean only — a credential VALUE must never appear in any output
 * this runner produces.
 */
export function credentialPresence(env: Env = process.env): JevSmokeCredentialPresence {
  return { jevApiKey: readJevSmokeApiKey(env) !== undefined };
}

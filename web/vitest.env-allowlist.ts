/**
 * ABC-freemium 1-00 (Ruling 3 point 3) — the **only** environment variables
 * `vitest.config.ts` may copy out of `.env.local` into the test process.
 *
 * This file now holds THREE independent exact-name allow-lists, one per
 * opt-in live config — never merged into one list, and never widened to a
 * prefix:
 *
 *   - `VITEST_INJECTED_ENV_NAMES` / `selectLiveEventsEnv` — what a live
 *     Vertex grounding call needs (`vitest.live-events.config.ts`). The list
 *     used to be the prefix `GOOGLE_`, which also matched `GOOGLE_API_KEY` —
 *     the operator's spendable AI Studio key. See
 *     `src/test-support/env-isolation.test.ts` for why that mattered and
 *     what asserts it now.
 *   - `LIVE_CHANNELS_ENV_NAMES` / `selectLiveChannelsEnv` — what the live
 *     Semantic Scholar / OpenAlex channel-comparison runner needs
 *     (`vitest.live-channels.config.ts`, LIVE-EVAL-4, per
 *     ABC-JEV-INTEGRATION.md §1u/§1w).
 *   - `JEV_SMOKE_ENV_NAMES` / `selectJevSmokeEnv` — what the opt-in live Jev
 *     smoke runner needs (`vitest.jev-smoke.config.ts`, JEV-DIRECT, per
 *     ABC-JEV-INTEGRATION.md §1aa point 6).
 *
 * **Do not replace either list with a prefix.** Do not add a name to either
 * list without saying which test needs it and what it costs when spent.
 *
 * It lives in its own module rather than in `vitest.config.ts` so the config
 * keeps a single default export — a config file with both a default and a named
 * export makes Vitest's bundler print a MIXED_EXPORTS warning on every run.
 */
export const VITEST_INJECTED_ENV_NAMES = [
  "GOOGLE_VERTEX_PROJECT",
  "GOOGLE_VERTEX_LOCATION",
  "GOOGLE_APPLICATION_CREDENTIALS",
] as const;

export type LiveEventsEnvName = (typeof VITEST_INJECTED_ENV_NAMES)[number];

/**
 * Picks only explicit names after Vite reads local env files. `loadEnv` takes
 * prefixes, so it cannot itself express this exact-name policy.
 *
 * Used by `vitest.live-events.config.ts` (the opt-in live events benchmark) to
 * inject exactly these names — and nothing else — into that one config's own
 * `test.env`, while the shared `vitest.config.ts` injects none at all.
 */
export function selectLiveEventsEnv(
  source: Record<string, string | undefined>,
): Partial<Record<LiveEventsEnvName, string>> {
  return Object.fromEntries(
    VITEST_INJECTED_ENV_NAMES.flatMap((name) => {
      const value = source[name];
      return value === undefined ? [] : [[name, value]];
    }),
  ) as Partial<Record<LiveEventsEnvName, string>>;
}

/**
 * LIVE-EVAL-4 (ABC-JEV-INTEGRATION.md §1u.2) — the exact three credential
 * names the opt-in live S2/OpenAlex channel-comparison runner may read from
 * `.env.local`. `SEMANTIC_SCHOLAR_API_KEY`/`OPENALEX_API_KEY` are optional on
 * both providers (a keyless request is still real and live — see that guide's
 * Finding C1a for why this gate does not also require one to be present);
 * `OPENALEX_EMAIL` is the polite-pool contact address OpenAlex's docs ask for.
 */
export const LIVE_CHANNELS_ENV_NAMES = [
  "SEMANTIC_SCHOLAR_API_KEY",
  "OPENALEX_API_KEY",
  "OPENALEX_EMAIL",
] as const;

export type LiveChannelsEnvName = (typeof LIVE_CHANNELS_ENV_NAMES)[number];

/**
 * Used by `vitest.live-channels.config.ts` to inject exactly these names —
 * and nothing else — into that one config's own `test.env`, mirroring
 * `selectLiveEventsEnv` above.
 */
export function selectLiveChannelsEnv(
  source: Record<string, string | undefined>,
): Partial<Record<LiveChannelsEnvName, string>> {
  return Object.fromEntries(
    LIVE_CHANNELS_ENV_NAMES.flatMap((name) => {
      const value = source[name];
      return value === undefined ? [] : [[name, value]];
    }),
  ) as Partial<Record<LiveChannelsEnvName, string>>;
}

/**
 * JEV-DIRECT (§1aa point 6) — the one credential name the opt-in live Jev
 * smoke runner may read from `.env.local`. Exact-name allow-list, never a
 * prefix — same rule as `LIVE_CHANNELS_ENV_NAMES` above. Deliberately its
 * own list, not merged into `LIVE_CHANNELS_ENV_NAMES`: they gate two
 * unrelated opt-in configs, and merging them would mean the S2/OpenAlex
 * runner's process could see `JEV_API_KEY` (and vice versa) with no
 * connection between the two.
 */
export const JEV_SMOKE_ENV_NAMES = ["JEV_API_KEY"] as const;

export type JevSmokeEnvName = (typeof JEV_SMOKE_ENV_NAMES)[number];

/**
 * Used by `vitest.jev-smoke.config.ts` to inject exactly this one name —
 * and nothing else — into that one config's own `test.env`, mirroring
 * `selectLiveChannelsEnv` above.
 */
export function selectJevSmokeEnv(
  source: Record<string, string | undefined>,
): Partial<Record<JevSmokeEnvName, string>> {
  return Object.fromEntries(
    JEV_SMOKE_ENV_NAMES.flatMap((name) => {
      const value = source[name];
      return value === undefined ? [] : [[name, value]];
    }),
  ) as Partial<Record<JevSmokeEnvName, string>>;
}

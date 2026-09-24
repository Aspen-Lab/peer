/**
 * ABC-freemium 1-00 (Ruling 3 point 3) — the **only** environment variables
 * `vitest.config.ts` may copy out of `.env.local` into the test process.
 *
 * These three are what a live Vertex grounding call needs, and they are the
 * three the config's own comment was written for. The list used to be the
 * prefix `GOOGLE_`, which also matched `GOOGLE_API_KEY` — the operator's
 * spendable AI Studio key. See `src/test-support/env-isolation.test.ts` for why
 * that mattered and what asserts it now.
 *
 * **Do not replace this with a prefix.** Do not add a name without saying which
 * test needs it and what it costs when spent.
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

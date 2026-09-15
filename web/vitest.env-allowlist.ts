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

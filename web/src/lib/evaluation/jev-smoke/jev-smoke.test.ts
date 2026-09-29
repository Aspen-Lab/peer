import { describe, expect, it } from "vitest";
import { canRunJevSmoke } from "./gate";
import { runJevSmoke } from "./runner";

/**
 * JEV-DIRECT (§1aa point 6) — the ONE live-calling test file for the Jev
 * smoke runner. Mirrors `evaluation/live-channels/live-channels.test.ts`'s
 * own shape exactly.
 *
 * Under the DEFAULT vitest config this file IS collected (it matches
 * `sharedVitestConfig`'s `src/**​/*.test.{ts,tsx}` glob, the same as every
 * other test file), so this top-level code runs there too — but
 * `canRunJevSmoke()` reads `PEER_RUN_JEV_SMOKE`, which only
 * `vitest.jev-smoke.config.ts` ever sets, so `describe.skipIf` always skips
 * the one `it` below under the default suite: no network call, no
 * filesystem write, from `npx vitest run`.
 *
 * NOBODY RUNS `npm run test:jev-smoke` IN THIS PASS — built and its
 * isolation proven, never executed with a real key. See this item's
 * checkpoint for the one command and what it costs.
 */
const canRun = canRunJevSmoke();

describe.skipIf(!canRun)("live Jev smoke run (opt-in, real network calls)", () => {
  it(
    "runs the fixed synthetic inputs (up to the ceiling) and writes results under output/jev-smoke/",
    async () => {
      const summary = await runJevSmoke();

      // The real evidence for this run is in output/jev-smoke/<ts>/ and in
      // the user's own read of it — this assertion is only a basic sanity
      // floor, so a run that crashed outright still fails this test, while a
      // legitimately reported per-input fault status (the whole point of
      // this runner) does not.
      expect(summary.results.length).toBeGreaterThan(0);
      expect(summary.outputDir.length).toBeGreaterThan(0);
    },
    60_000,
  );
});

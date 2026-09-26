import { describe, expect, it } from "vitest";
import { canRunLiveChannelsEval } from "./live-channels-gate";
import { runLiveChannelsEval } from "./runner";

// LIVE-EVAL-4 (ABC-JEV-INTEGRATION.md §1u.7, §1w P6) — the ONE live-calling
// test file for the S2/OpenAlex channel-comparison eval. Gated by the opt-in
// literal exactly like `events/benchmark.test.ts`'s `hasLiveSearchPath`.
//
// Under the DEFAULT vitest config this file IS collected (it matches
// sharedVitestConfig's `src/**/*.test.{ts,tsx}` glob, the same as every
// other test file), so this top-level code runs there too — but
// `canRunLiveChannelsEval()` reads `PEER_RUN_LIVE_CHANNELS_EVAL`, which only
// `vitest.live-channels.config.ts` ever sets, so `describe.skipIf` always
// skips the one `it` below under the default suite: no network call, no
// filesystem write, from `npx vitest run`.
//
// Smoke scope is PINNED by this explicit input id (a starter topic — every
// starter costs the same 5 calls) — never by file order — and is
// overridable only by the explicit `PEER_LIVE_CHANNELS_SMOKE_INPUT_ID` env
// var. Setting `PEER_LIVE_CHANNELS_FULL_RUN="1"` runs every input instead —
// that is the fresh A's run (§1u.7), never C's; C's own instructions permit
// exactly one smoke run total.
const SMOKE_INPUT_ID =
  process.env.PEER_LIVE_CHANNELS_SMOKE_INPUT_ID ?? "starter-machine-learning";

const canRun = canRunLiveChannelsEval();

describe.skipIf(!canRun)(
  "live Semantic Scholar vs OpenAlex channel comparison (opt-in, real network calls)",
  () => {
    it(
      "runs the authorized comparison for the pinned smoke input (or every input under PEER_LIVE_CHANNELS_FULL_RUN=1) and writes results under output/live-eval/",
      async () => {
        const fullRun = process.env.PEER_LIVE_CHANNELS_FULL_RUN === "1";
        const result = await runLiveChannelsEval({
          onlyInputId: fullRun ? undefined : SMOKE_INPUT_ID,
        });

        // The real evidence for this run is in output/live-eval/<ts>/ and in
        // C's/A's own checkpoint. This assertion is only a basic sanity
        // floor, so a run that crashed outright (vs. one that legitimately
        // recorded a per-channel "failed"/"not_run") still fails this test.
        expect(result.runs.length).toBeGreaterThan(0);
        expect(result.outputDir.length).toBeGreaterThan(0);
      },
      180_000,
    );
  },
);

import { describe, expect, it } from "vitest";
import defaultConfig from "../../vitest.config";
import liveEventsConfig from "../../vitest.live-events.config";
import {
  VITEST_INJECTED_ENV_NAMES,
  selectLiveEventsEnv,
} from "../../vitest.env-allowlist";

/**
 * ABC-freemium 1-00 (Ruling 3 point 3) — **THE MONEY LOCK.**
 *
 * This suite exists to make one class of accident impossible: a unit test that
 * quietly spends the operator's money. Two names do that.
 *
 *   - `GOOGLE_API_KEY` is the system AI Studio key. After item 1-11 (R-KEY-1)
 *     `resolveProvider()` returns a live Gemini provider wherever this is set —
 *     `NODE_ENV=test` no longer stops it. Any suite that reaches
 *     `resolveProvider()` without mocking the registry would then make a real,
 *     billed model call on every run of the gate.
 *   - `TAVILY_API_KEY` is the system search key. `resolveSearchProvider` selects
 *     Tavily on `Boolean(key)` alone, so a suite that drives a pipeline would
 *     spend real search credits.
 *
 * The split architecture here goes one step further than a shared allow-list:
 * the shared `vitest.config.ts` injects NO local env into the ~100 deterministic
 * suites at all (`defaultConfig.test?.env` is `undefined`, not just filtered).
 * Only the dedicated `vitest.live-events.config.ts` (the opt-in live Vertex
 * benchmark) receives the narrow three-name Vertex allow-list, via
 * `selectLiveEventsEnv`/`VITEST_INJECTED_ENV_NAMES`.
 *
 * The assertions below check every independent layer of the fix — what the
 * shared config injects (nothing), what the live-events config injects (only
 * the allow-listed names), and what actually survives into `process.env` — so
 * removing any layer turns the gate red instead of turning the meter on.
 */
describe("Vitest provider environment isolation", () => {
  it("removes ambient spendable provider keys from the default suite", () => {
    // Deleted by `vitest.setup.ts` before every suite and before every test.
    // A test that wants to prove a key is IGNORED stubs a sentinel inside its
    // own body (`registry.test.ts` is the pattern) — that is unaffected here.
    expect(process.env.GOOGLE_API_KEY).toBeUndefined();
    expect(process.env.TAVILY_API_KEY).toBeUndefined();
    expect(defaultConfig.test?.env).toBeUndefined();
  });

  it("allows only exact live benchmark credential names", () => {
    // The allow-list is the trio the Vertex live benchmark needs and nothing
    // else. If a later change widens this back to a `GOOGLE_` prefix, or adds a
    // fourth name without a stated reason, this fails.
    expect([...VITEST_INJECTED_ENV_NAMES]).toEqual([
      "GOOGLE_VERTEX_PROJECT",
      "GOOGLE_VERTEX_LOCATION",
      "GOOGLE_APPLICATION_CREDENTIALS",
    ]);
    expect(
      selectLiveEventsEnv({
        GOOGLE_VERTEX_PROJECT: "dummy-project",
        GOOGLE_VERTEX_PROJECT_EXTRA: "must-not-pass",
        GOOGLE_VERTEX_LOCATION: "dummy-location",
        GOOGLE_APPLICATION_CREDENTIALS: "dummy-credentials-path",
        GOOGLE_API_KEY: "must-not-pass",
        TAVILY_API_KEY: "must-not-pass",
      }),
    ).toEqual({
      GOOGLE_VERTEX_PROJECT: "dummy-project",
      GOOGLE_VERTEX_LOCATION: "dummy-location",
      GOOGLE_APPLICATION_CREDENTIALS: "dummy-credentials-path",
    });
    expect(liveEventsConfig.test?.env).toMatchObject({
      PEER_RUN_LIVE_EVENTS_BENCHMARK: "1",
    });
    expect(
      Object.keys(liveEventsConfig.test?.env ?? []).every(
        (name) =>
          name === "PEER_RUN_LIVE_EVENTS_BENCHMARK" ||
          VITEST_INJECTED_ENV_NAMES.includes(
            name as (typeof VITEST_INJECTED_ENV_NAMES)[number],
          ),
      ),
    ).toBe(true);
  });
});

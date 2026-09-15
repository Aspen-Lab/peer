import { describe, expect, it } from "vitest";
import vitestConfig from "../../vitest.config";
import { VITEST_INJECTED_ENV_NAMES } from "../../vitest.env-allowlist";

/**
 * ABC-freemium 1-00 (Ruling 3 point 3) — **THE MONEY LOCK.**
 *
 * This suite exists to make one class of accident impossible: a unit test that
 * quietly spends the operator's money. Two names do that.
 *
 *   - `GOOGLE_API_KEY` is the system AI Studio key. After item 1-11 (R-KEY-1)
 *     `resolveProvider()` returns a live Gemini provider wherever this is set —
 *     `NODE_ENV=test` no longer stops it. Any of the ~101 suites that reaches
 *     `resolveProvider()` without mocking the registry would then make a real,
 *     billed model call on every run of the gate.
 *   - `TAVILY_API_KEY` is the system search key. `resolveSearchProvider` selects
 *     Tavily on `Boolean(key)` alone, so a suite that drives a pipeline would
 *     spend real search credits.
 *
 * Before 1-00 both were reachable: `vitest.config.ts` injected **every**
 * `GOOGLE_`-prefixed variable out of `.env.local` into all suites, and nothing
 * cleared a shell-exported `TAVILY_API_KEY`.
 *
 * The two assertions below check the two independent layers of the fix — what
 * the config is allowed to inject, and what actually survives into
 * `process.env` — so removing either layer turns the gate red instead of turning
 * the meter on.
 */
describe("test-process environment isolation", () => {
  it("holds no spendable operator key", () => {
    // Deleted by `vitest.setup.ts` before every suite and before every test.
    // A test that wants to prove a key is IGNORED stubs a sentinel inside its
    // own body (`registry.test.ts` is the pattern) — that is unaffected here.
    expect(process.env.GOOGLE_API_KEY).toBeUndefined();
    expect(process.env.TAVILY_API_KEY).toBeUndefined();
  });

  it("injects only the three allow-listed Vertex names, never a prefix", () => {
    // The allow-list is the trio the Vertex live benchmark needs and nothing
    // else. If a later change widens this back to a `GOOGLE_` prefix, or adds a
    // fourth name without a stated reason, this fails.
    expect([...VITEST_INJECTED_ENV_NAMES]).toEqual([
      "GOOGLE_VERTEX_PROJECT",
      "GOOGLE_VERTEX_LOCATION",
      "GOOGLE_APPLICATION_CREDENTIALS",
    ]);

    // And what the config actually hands the suites is a subset of it — this is
    // the assertion that fails if `.env.local` grows a real `GOOGLE_API_KEY`
    // and the filter is removed.
    const injected = Object.keys(vitestConfig.test?.env ?? {});
    for (const name of injected) {
      expect(VITEST_INJECTED_ENV_NAMES).toContain(name);
    }
  });
});

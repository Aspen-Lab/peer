import { describe, expect, it } from "vitest";
import defaultConfig from "../../vitest.config";
import liveEventsConfig from "../../vitest.live-events.config";
import liveChannelsConfig from "../../vitest.live-channels.config";
import jevSmokeConfig from "../../vitest.jev-smoke.config";
import {
  VITEST_INJECTED_ENV_NAMES,
  selectLiveEventsEnv,
  LIVE_CHANNELS_ENV_NAMES,
  selectLiveChannelsEnv,
  JEV_SMOKE_ENV_NAMES,
  selectJevSmokeEnv,
} from "../../vitest.env-allowlist";
import { shouldStripLiveChannelsEnv, shouldStripJevSmokeEnv } from "../../vitest.setup";

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

/**
 * LIVE-EVAL-4 (ABC-JEV-INTEGRATION.md §1u.2/§1u.6, §1w P4) — the sibling
 * money lock for the live Semantic Scholar / OpenAlex channel-comparison
 * runner (`docs/jev-abc/LIVE-EVAL-4-B-20260925T044015Z.md` Finding C1e).
 * Same reasoning as the suite above: every independent layer — the
 * allow-list, the dedicated config's own env/include, and the conditional
 * second-layer lock in `vitest.setup.ts` — must fail the moment any one of
 * them is weakened, rather than letting the meter turn on quietly.
 */
describe("Live channels (S2/OpenAlex) evaluation environment isolation", () => {
  it("re-asserts the default suite still injects no env at all", () => {
    // A regression introduced by touching vitest.env-allowlist.ts or
    // vitest.setup.ts for this item specifically must fail HERE too, not
    // only in the older Vertex-focused describe block above.
    expect(defaultConfig.test?.env).toBeUndefined();
  });

  it("allows only the exact three S2/OpenAlex credential names", () => {
    expect([...LIVE_CHANNELS_ENV_NAMES]).toEqual([
      "SEMANTIC_SCHOLAR_API_KEY",
      "OPENALEX_API_KEY",
      "OPENALEX_EMAIL",
    ]);
    expect(
      selectLiveChannelsEnv({
        SEMANTIC_SCHOLAR_API_KEY: "dummy-s2-key",
        SEMANTIC_SCHOLAR_API_KEY_EXTRA: "must-not-pass",
        OPENALEX_API_KEY: "dummy-openalex-key",
        OPENALEX_EMAIL: "dummy@example.com",
        GOOGLE_API_KEY: "must-not-pass",
        TAVILY_API_KEY: "must-not-pass",
        GOOGLE_VERTEX_PROJECT: "must-not-pass",
      }),
    ).toEqual({
      SEMANTIC_SCHOLAR_API_KEY: "dummy-s2-key",
      OPENALEX_API_KEY: "dummy-openalex-key",
      OPENALEX_EMAIL: "dummy@example.com",
    });
  });

  it("injects the opt-in literal and only allow-listed names into the live-channels config", () => {
    expect(liveChannelsConfig.test?.env).toMatchObject({
      PEER_RUN_LIVE_CHANNELS_EVAL: "1",
    });
    expect(
      Object.keys(liveChannelsConfig.test?.env ?? []).every(
        (name) =>
          name === "PEER_RUN_LIVE_CHANNELS_EVAL" ||
          LIVE_CHANNELS_ENV_NAMES.includes(
            name as (typeof LIVE_CHANNELS_ENV_NAMES)[number],
          ),
      ),
    ).toBe(true);
  });

  it("pins the live-channels config to exactly one test file, never a glob", () => {
    // Guards against someone widening this config's scope later — a
    // credential-bearing config must only ever collect the one file it was
    // built for, even invoked with no path argument.
    expect(liveChannelsConfig.test?.include).toEqual([
      "src/lib/evaluation/live-channels/live-channels.test.ts",
    ]);
  });

  it('strips the S2/OpenAlex credentials from process.env unless the live-channels opt-in literal is exactly "1"', () => {
    expect(shouldStripLiveChannelsEnv({})).toBe(true);
    expect(shouldStripLiveChannelsEnv({ PEER_RUN_LIVE_CHANNELS_EVAL: "0" })).toBe(
      true,
    );
    expect(
      shouldStripLiveChannelsEnv({ PEER_RUN_LIVE_CHANNELS_EVAL: "true" }),
    ).toBe(true);
    expect(
      shouldStripLiveChannelsEnv({ PEER_RUN_LIVE_CHANNELS_EVAL: "1" }),
    ).toBe(false);
  });
});

/**
 * JEV-DIRECT (§1aa point 6) — the sibling money lock for the opt-in live Jev
 * smoke runner, built to mirror LIVE-EVAL-4's own pattern exactly (guide,
 * `docs/jev-abc/JEV-DIRECT-B-20260927T013846Z.md` §6): a CONDITIONAL
 * second-layer lock, since `JEV_API_KEY` cannot be unconditionally deleted
 * the way `GOOGLE_API_KEY`/`TAVILY_API_KEY` are — that would strip it from
 * the opt-in smoke config's own process too. Same reasoning as the describe
 * block above: every independent layer — the allow-list, the dedicated
 * config's own env/include, and the conditional second-layer lock in
 * `vitest.setup.ts` — must fail the moment any one of them is weakened.
 */
describe("Jev smoke evaluation environment isolation (JEV-DIRECT §1aa point 6)", () => {
  it("re-asserts the default suite still injects no env at all", () => {
    // A regression introduced by touching vitest.env-allowlist.ts or
    // vitest.setup.ts for this item specifically must fail HERE too, not
    // only in the older describe blocks above.
    expect(defaultConfig.test?.env).toBeUndefined();
  });

  it("allows only the exact one JEV_API_KEY credential name, never a prefix", () => {
    expect([...JEV_SMOKE_ENV_NAMES]).toEqual(["JEV_API_KEY"]);
    expect(
      selectJevSmokeEnv({
        JEV_API_KEY: "dummy-jev-key",
        JEV_API_KEY_EXTRA: "must-not-pass",
        GOOGLE_API_KEY: "must-not-pass",
        TAVILY_API_KEY: "must-not-pass",
        SEMANTIC_SCHOLAR_API_KEY: "must-not-pass",
        OPENALEX_API_KEY: "must-not-pass",
      }),
    ).toEqual({
      JEV_API_KEY: "dummy-jev-key",
    });
  });

  it("injects the opt-in literal and only the allow-listed name into the jev-smoke config", () => {
    expect(jevSmokeConfig.test?.env).toMatchObject({
      PEER_RUN_JEV_SMOKE: "1",
    });
    expect(
      Object.keys(jevSmokeConfig.test?.env ?? []).every(
        (name) =>
          name === "PEER_RUN_JEV_SMOKE" ||
          JEV_SMOKE_ENV_NAMES.includes(name as (typeof JEV_SMOKE_ENV_NAMES)[number]),
      ),
    ).toBe(true);
  });

  it("pins the jev-smoke config to exactly one test file, never a glob", () => {
    // Guards against someone widening this config's scope later — a
    // credential-bearing config must only ever collect the one file it was
    // built for, even invoked with no path argument.
    expect(jevSmokeConfig.test?.include).toEqual([
      "src/lib/evaluation/jev-smoke/jev-smoke.test.ts",
    ]);
  });

  it('strips JEV_API_KEY from process.env unless the smoke opt-in literal is exactly "1"', () => {
    expect(shouldStripJevSmokeEnv({})).toBe(true);
    expect(shouldStripJevSmokeEnv({ PEER_RUN_JEV_SMOKE: "0" })).toBe(true);
    expect(shouldStripJevSmokeEnv({ PEER_RUN_JEV_SMOKE: "true" })).toBe(true);
    expect(shouldStripJevSmokeEnv({ PEER_RUN_JEV_SMOKE: "1" })).toBe(false);
  });
});

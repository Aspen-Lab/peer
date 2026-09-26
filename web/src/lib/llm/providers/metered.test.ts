import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { meterProvider } from "./metered";
import { logLlmUsage } from "../usage-log";
import {
  setUsageEventsClientForTests,
  type UsageEventRow,
} from "@/lib/usage/events";
import { InMemoryCounterStore, getCounterStore, resetCounterStoreForTests } from "@/lib/usage/counters";
import {
  CompanySpendCapRefusedError,
  companySpendGlobalDayKey,
  companySpendPerUserDayKey,
  readCompanyBudgetConfig,
  resetCompanyBudgetConfigCacheForTests,
  type CompanyBudgetSupabaseClient,
} from "@/lib/usage/company-budget";
import type { DigestProvider, DigestResult } from "./types";

/**
 * ABC-freemium 1-04 — the tests for 1-03 (R-METER-1).
 *
 * The first case is the one that would otherwise ship a real outage: eleven
 * call sites decide whether to degrade by testing `provider?.generateJsonText`
 * / `generateVisionJsonText`, and DeepSeek deliberately has no vision method. A
 * wrapper that defined both unconditionally would turn "degrade cleanly" into
 * "call a method the provider cannot serve".
 */

const rows: UsageEventRow[] = [];

/** Let the fire-and-forget insert land before asserting on it. */
async function flush(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

beforeEach(() => {
  rows.length = 0;
  setUsageEventsClientForTests({
    from: () => ({
      insert: (inserted: UsageEventRow[]) => {
        rows.push(...inserted);
        return Promise.resolve({ error: null });
      },
    }),
  } as never);
});

afterEach(() => {
  setUsageEventsClientForTests(undefined);
  vi.restoreAllMocks();
});

function baseProvider(
  overrides: Partial<DigestProvider> = {},
): DigestProvider {
  return {
    id: "deepseek",
    generateDigest: () => Promise.resolve({ bullets: [] } as DigestResult),
    testConnection: () => Promise.resolve({ ok: true }),
    ...overrides,
  };
}

describe("meterProvider", () => {
  it("copies method presence rather than assuming it", () => {
    // The DeepSeek case: no generateVisionJsonText before, none after.
    const wrapped = meterProvider(
      baseProvider({ generateJsonText: () => Promise.resolve("{}") }),
      { userId: "u1", byok: false },
    );

    expect(typeof wrapped.generateJsonText).toBe("function");
    expect(wrapped.generateVisionJsonText).toBeUndefined();
    expect("generateVisionJsonText" in wrapped).toBe(false);
  });

  it("preserves the provider id", () => {
    const wrapped = meterProvider(baseProvider({ id: "gemini" }), {
      userId: null,
      byok: false,
    });

    expect(wrapped.id).toBe("gemini");
  });

  it("records one row per call, with the tokens the provider reported", async () => {
    const wrapped = meterProvider(
      baseProvider({
        id: "gemini",
        generateJsonText: () => {
          logLlmUsage({
            provider: "gemini",
            model: "gemini-flash",
            path: "report:pass2",
            inputTokens: 120,
            outputTokens: 45,
            thinkingTokens: 12,
            latencyMs: 987,
            ok: true,
          });
          return Promise.resolve("{}");
        },
      }),
      { userId: "user-9", byok: false },
    );

    await wrapped.generateJsonText?.({
      systemPrompt: "s",
      userPrompt: "u",
    });
    await flush();

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      user_id: "user-9",
      kind: "llm",
      path: "report:pass2",
      provider: "gemini",
      model: "gemini-flash",
      input_tokens: 120,
      output_tokens: 45,
      thinking_tokens: 12,
      latency_ms: 987,
      ok: true,
      byok: false,
    });
  });

  it("attributes a BYOK call to the user's own key", async () => {
    const wrapped = meterProvider(
      baseProvider({
        generateJsonText: () => {
          logLlmUsage({
            provider: "deepseek",
            model: "deepseek-chat",
            latencyMs: 10,
            ok: true,
          });
          return Promise.resolve("{}");
        },
      }),
      { userId: "user-9", byok: true },
    );

    await wrapped.generateJsonText?.({ systemPrompt: "s", userPrompt: "u" });
    await flush();

    expect(rows[0].byok).toBe(true);
  });

  it("re-throws, and records ok:false when nothing else logged", async () => {
    // The throw-before-any-logging case: a provider that cannot build its
    // client. Every existing catch/degrade path depends on the re-throw.
    const wrapped = meterProvider(
      baseProvider({
        generateJsonText: () =>
          Promise.reject(new Error("GOOGLE_VERTEX_PROJECT not set")),
      }),
      { userId: "user-9", byok: false, path: "digest" },
    );

    await expect(
      wrapped.generateJsonText?.({ systemPrompt: "s", userPrompt: "u" }),
    ).rejects.toThrow("GOOGLE_VERTEX_PROJECT not set");
    await flush();

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kind: "llm", ok: false, path: "digest" });
  });

  it("does not write a second row when the provider already logged the failure", async () => {
    // Every provider calls logLlmUsage on its error path as well as its success
    // path, so the wrapper must not double-count. R-METER-1 asks for one row.
    const wrapped = meterProvider(
      baseProvider({
        generateJsonText: () => {
          logLlmUsage({
            provider: "openai",
            model: "gpt",
            latencyMs: 5,
            ok: false,
          });
          return Promise.reject(new Error("upstream 500"));
        },
      }),
      { userId: "user-9", byok: false },
    );

    await expect(
      wrapped.generateJsonText?.({ systemPrompt: "s", userPrompt: "u" }),
    ).rejects.toThrow("upstream 500");
    await flush();

    expect(rows).toHaveLength(1);
    expect(rows[0].ok).toBe(false);
  });

  it("never records a key-shaped field", async () => {
    // A usage table is exactly where a leaked credential would survive longest.
    const wrapped = meterProvider(
      baseProvider({
        generateJsonText: () => {
          logLlmUsage({
            provider: "gemini",
            model: "gemini-flash",
            latencyMs: 1,
            ok: true,
          });
          return Promise.resolve("{}");
        },
      }),
      { userId: "user-9", byok: false },
    );

    await wrapped.generateJsonText?.({ systemPrompt: "s", userPrompt: "u" });
    await flush();

    const keyish = Object.keys(rows[0]).filter((name) => /key|secret/i.test(name));
    expect(keyish).toEqual([]);
  });

  it("attributes concurrent calls separately", async () => {
    // The reason the context is an AsyncLocalStorage rather than a module
    // variable: two feed loads running at once must not attribute each other's
    // spend.
    const provider = baseProvider({
      generateJsonText: async (args) => {
        await new Promise((resolve) => setTimeout(resolve, 5));
        logLlmUsage({
          provider: "gemini",
          model: "gemini-flash",
          path: args.userPrompt,
          latencyMs: 1,
          ok: true,
        });
        return "{}";
      },
    });

    await Promise.all([
      meterProvider(provider, { userId: "user-a", byok: false }).generateJsonText?.(
        { systemPrompt: "s", userPrompt: "a" },
      ),
      meterProvider(provider, { userId: "user-b", byok: true }).generateJsonText?.(
        { systemPrompt: "s", userPrompt: "b" },
      ),
    ]);
    await flush();

    const byPath = Object.fromEntries(rows.map((row) => [row.path, row]));
    expect(byPath.a.user_id).toBe("user-a");
    expect(byPath.a.byok).toBe(false);
    expect(byPath.b.user_id).toBe("user-b");
    expect(byPath.b.byok).toBe(true);
  });
});

/**
 * ABC-freemium 2-05 · R-METER-1 (amended 2026-09-05) · Ruling 5 point 6 ·
 * Ruling 6 point 5.
 *
 * "One row per call, never two, never zero" restated on the billing reading: a
 * call is one **provider request**. The `never zero` direction was a real hole —
 * the wrapper only consulted `scope.recorded` in a `catch`, so a provider that
 * returned successfully without logging was silently unmetered.
 */
describe("2-05 — at least one row per call, on both exits", () => {
  /** A provider whose method resolves WITHOUT calling `logLlmUsage`. */
  function silentProvider(): DigestProvider {
    return baseProvider({
      id: "gemini",
      generateJsonText: () => Promise.resolve("{}"),
    });
  }

  it("writes exactly one row for a SUCCESS that logged nothing", async () => {
    // THE case that fails on the pre-2-05 wrapper: it returned normally, the
    // `catch` never ran, and no row was written at all.
    const wrapped = meterProvider(silentProvider(), {
      userId: "u1",
      byok: false,
    });

    await wrapped.generateJsonText!({
      systemPrompt: "s",
      userPrompt: "u",
      maxTokens: 10,
    });
    await flush();

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      user_id: "u1",
      kind: "llm",
      provider: "gemini",
      // The wrapper has no way to know which model answered — it sees only the
      // return value. `null` is the honest value, not a guess.
      model: null,
      ok: true,
      byok: false,
    });
  });

  it("writes exactly one row for a THROW that logged nothing, and still throws", async () => {
    // The pre-existing behaviour, pinned so the catch-to-finally conversion
    // cannot regress it. A swallowed re-throw would break every degrade path in
    // the product.
    const wrapped = meterProvider(
      baseProvider({
        id: "gemini",
        generateJsonText: () => Promise.reject(new Error("boom")),
      }),
      { userId: "u1", byok: false },
    );

    await expect(
      wrapped.generateJsonText!({
        systemPrompt: "s",
        userPrompt: "u",
        maxTokens: 10,
      }),
    ).rejects.toThrow("boom");
    await flush();

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ ok: false, model: null });
  });

  it("adds NO row when the provider logged one itself", async () => {
    // The duplicate-suppression property, asserted on the success path now that
    // the wrapper runs on both exits. The provider is the preferred writer
    // because it is the only place that has the token counts.
    const wrapped = meterProvider(
      baseProvider({
        id: "gemini",
        generateJsonText: () => {
          logLlmUsage({
            provider: "gemini",
            model: "gemini-2.5-flash",
            inputTokens: 11,
            outputTokens: 22,
            latencyMs: 5,
            ok: true,
          });
          return Promise.resolve("{}");
        },
      }),
      { userId: "u1", byok: false },
    );

    await wrapped.generateJsonText!({
      systemPrompt: "s",
      userPrompt: "u",
      maxTokens: 10,
    });
    await flush();

    expect(rows).toHaveLength(1);
    // The provider's row, with the tokens — not the wrapper's model-less one.
    expect(rows[0]).toMatchObject({
      model: "gemini-2.5-flash",
      input_tokens: 11,
      output_tokens: 22,
    });
  });

  it("covers EVERY wrapped method, so a fifth cannot be added unmetered", async () => {
    // Table-driven over all four members of `DigestProvider`. A method that the
    // wrapper forgot to wrap would produce zero rows here.
    const silent = baseProvider({
      id: "gemini",
      generateDigest: () => Promise.resolve({ bullets: [] } as DigestResult),
      testConnection: () => Promise.resolve({ ok: true }),
      generateJsonText: () => Promise.resolve("{}"),
      generateVisionJsonText: () => Promise.resolve("{}"),
    });
    const wrapped = meterProvider(silent, { userId: "u1", byok: false });

    await wrapped.generateDigest({ papers: [], contextHint: "" } as never);
    await wrapped.testConnection();
    await wrapped.generateJsonText!({
      systemPrompt: "s",
      userPrompt: "u",
      maxTokens: 10,
    });
    await wrapped.generateVisionJsonText!({
      systemPrompt: "s",
      userPrompt: "u",
      images: [],
      maxTokens: 10,
    });
    await flush();

    expect(rows).toHaveLength(4);
    expect(rows.map((r) => r.path).sort()).toEqual([
      "digest",
      "json",
      "test-connection",
      "vision",
    ]);
  });

  it("records a fallback chain as TWO rows, which is the billing truth", async () => {
    // Ruling 6 point 5, asserted as a documented fact rather than left implicit.
    // Both Gemini providers loop over a model chain and log per attempt, so one
    // logical call that retries writes one row per REQUEST — one failed, one
    // succeeded. Whichever way a later round reads "one row per call", the
    // number here stops being an accident.
    const wrapped = meterProvider(
      baseProvider({
        id: "gemini",
        generateJsonText: () => {
          logLlmUsage({ provider: "gemini", model: "model-a", latencyMs: 5, ok: false });
          logLlmUsage({ provider: "gemini", model: "model-b", latencyMs: 7, ok: true });
          return Promise.resolve("{}");
        },
      }),
      { userId: "u1", byok: false },
    );

    await wrapped.generateJsonText!({
      systemPrompt: "s",
      userPrompt: "u",
      maxTokens: 10,
    });
    await flush();

    expect(rows).toHaveLength(2);
    expect(rows.map((r) => [r.model, r.ok])).toEqual([
      ["model-a", false],
      ["model-b", true],
    ]);
    // Both attributed to the same user, so the owner can see the retry cost.
    expect(new Set(rows.map((r) => r.user_id))).toEqual(new Set(["u1"]));
  });
});

/**
 * SPEND-CAP (ABC-JEV-INTEGRATION.md §1v). The R9/R10 wiring at `meterCall`'s
 * own integration level — `company-budget.test.ts` covers the pure reserve/
 * settle/estimate logic directly; this covers `meterCall` actually calling it
 * at the right moment, under the right gate, and settling exactly once.
 */
describe("SPEND-CAP — meterCall's reservation/settlement wiring", () => {
  const GENEROUS_PRICES = [
    { model_id: "gemini-3.1-flash-lite", input_usd_per_million_tokens: 1, output_usd_per_million_tokens: 1, vision_tokens_per_image: null },
    { model_id: "gemini-3.5-flash-lite", input_usd_per_million_tokens: 1, output_usd_per_million_tokens: 1, vision_tokens_per_image: null },
    { model_id: "gemini-3.6-flash", input_usd_per_million_tokens: 1, output_usd_per_million_tokens: 1, vision_tokens_per_image: null },
    { model_id: "gemini-3.8-flash", input_usd_per_million_tokens: 1, output_usd_per_million_tokens: 1, vision_tokens_per_image: null },
  ];

  function fakeClient(caps: Array<{ cap_key: string; amount_usd: number }>, prices = GENEROUS_PRICES): CompanyBudgetSupabaseClient {
    return {
      from: (table: unknown) => ({
        select: async () => (table === "company_spend_caps" ? { data: caps, error: null } : { data: prices, error: null }),
      }),
    } as unknown as CompanyBudgetSupabaseClient;
  }

  const GENEROUS_CAPS = [
    { cap_key: "global_daily_usd", amount_usd: 1000 },
    { cap_key: "per_user_daily_usd", amount_usd: 1000 },
  ];
  const ZERO_CAPS = [
    { cap_key: "global_daily_usd", amount_usd: 0 },
    { cap_key: "per_user_daily_usd", amount_usd: 0 },
  ];

  beforeEach(() => {
    resetCounterStoreForTests();
    resetCompanyBudgetConfigCacheForTests();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    resetCounterStoreForTests();
    resetCompanyBudgetConfigCacheForTests();
  });

  it("R9 — flag OFF (the default): the reservation path is never entered, even against a config that would refuse everything", async () => {
    vi.stubEnv("PEER_COMPANY_SPEND_CAP", "");
    await readCompanyBudgetConfig(new Date(), fakeClient(ZERO_CAPS, [])); // no price rows either — would refuse or fail closed on every possible reason
    const incrementSpy = vi.spyOn(InMemoryCounterStore.prototype, "increment");

    const wrapped = meterProvider(
      baseProvider({ id: "gemini", generateJsonText: () => Promise.resolve("{}") }),
      { userId: "user-off", byok: false },
    );

    await expect(
      wrapped.generateJsonText?.({ systemPrompt: "s", userPrompt: "u", maxTokens: 10, tier: "small" }),
    ).resolves.toBe("{}");
    expect(incrementSpy).not.toHaveBeenCalled();
  });

  it("BYOK is never gated (guide item 6) — the reservation path is skipped even with a guaranteed-refusal config", async () => {
    vi.stubEnv("PEER_COMPANY_SPEND_CAP", "on");
    await readCompanyBudgetConfig(new Date(), fakeClient(ZERO_CAPS));

    const wrapped = meterProvider(
      baseProvider({ id: "gemini", generateJsonText: () => Promise.resolve("{}") }),
      { userId: "user-byok", byok: true },
    );

    await expect(
      wrapped.generateJsonText?.({ systemPrompt: "s", userPrompt: "u", maxTokens: 10, tier: "small" }),
    ).resolves.toBe("{}");
  });

  it("a refused reservation throws CompanySpendCapRefusedError — a real Error every existing catch(err) already handles — and writes a breaker usage row", async () => {
    vi.stubEnv("PEER_COMPANY_SPEND_CAP", "on");
    await readCompanyBudgetConfig(new Date(), fakeClient(ZERO_CAPS));

    const wrapped = meterProvider(
      baseProvider({ id: "gemini", generateJsonText: () => Promise.resolve("{}") }),
      { userId: "user-refused", byok: false },
    );

    let caught: unknown;
    try {
      await wrapped.generateJsonText?.({ systemPrompt: "s", userPrompt: "u", maxTokens: 10, tier: "small" });
    } catch (err) {
      caught = err;
    }
    await flush();

    expect(caught).toBeInstanceOf(CompanySpendCapRefusedError);
    expect((caught as CompanySpendCapRefusedError).reason).toBe("per_user_cap_exceeded");
    expect(rows.some((r) => r.kind === "breaker" && String(r.path).startsWith("company-spend:"))).toBe(true);
  });

  it("R10 — a successful call reserves the worst case, attaches to scope, and settles to the REAL usage after every attempt finishes", async () => {
    vi.stubEnv("PEER_COMPANY_SPEND_CAP", "on");
    await readCompanyBudgetConfig(new Date(), fakeClient(GENEROUS_CAPS));
    const store = getCounterStore();

    const wrapped = meterProvider(
      baseProvider({
        id: "gemini",
        generateJsonText: () => {
          logLlmUsage({
            provider: "gemini",
            model: "gemini-3.1-flash-lite",
            inputTokens: 10,
            outputTokens: 5,
            latencyMs: 1,
            ok: true,
          });
          return Promise.resolve("{}");
        },
      }),
      { userId: "user-spend", byok: false },
    );

    // small tier -> 2 candidate models (3.1-flash-lite, 3.5-flash-lite), both
    // measured to disable thinking, so outputCap == maxTokens exactly (100).
    // Worst-case reservation = 2 x ((1 input tok x $1/M) + (100 out tok x
    // $1/M)) = 2 x 101 = 202 microUSD. Actual attempt: 10 in + 5 out = 15
    // microUSD. Refund = 202 - 15 = 187. Final = 15, on BOTH keys.
    await wrapped.generateJsonText?.({ systemPrompt: "s", userPrompt: "u", maxTokens: 100, tier: "small" });
    await flush();

    await expect(store.read(companySpendPerUserDayKey("user-spend", new Date()))).resolves.toEqual({ value: 15, ok: true });
    await expect(store.read(companySpendGlobalDayKey(new Date()))).resolves.toEqual({ value: 15, ok: true });
  });

  it("R10 — TWO chain attempts (one failed, one succeeded) settle ONCE, refunding against the SUM of both actual costs, not per attempt", async () => {
    vi.stubEnv("PEER_COMPANY_SPEND_CAP", "on");
    await readCompanyBudgetConfig(new Date(), fakeClient(GENEROUS_CAPS));
    const store = getCounterStore();

    const wrapped = meterProvider(
      baseProvider({
        id: "gemini",
        generateJsonText: () => {
          // Attempt 1: reported usage but "failed" (empty text) — still a
          // real, billed provider request.
          logLlmUsage({ provider: "gemini", model: "gemini-3.1-flash-lite", inputTokens: 10, outputTokens: 5, latencyMs: 1, ok: false });
          // Attempt 2: the chain's next model, which produced real output.
          logLlmUsage({ provider: "gemini", model: "gemini-3.5-flash-lite", inputTokens: 8, outputTokens: 4, latencyMs: 1, ok: true });
          return Promise.resolve("{}");
        },
      }),
      { userId: "user-spend-2", byok: false },
    );

    await wrapped.generateJsonText?.({ systemPrompt: "s", userPrompt: "u", maxTokens: 100, tier: "small" });
    await flush();

    // Reservation is still 202 (same worst-case chain as the single-attempt
    // test above). Actual = (10+5) + (8+4) = 27 microUSD. Refund = 175.
    await expect(store.read(companySpendPerUserDayKey("user-spend-2", new Date()))).resolves.toEqual({ value: 27, ok: true });
  });

  it("R2 — a call reached with no userId (e.g. tier2-rerank's SpendJustification path) reserves the global key only", async () => {
    vi.stubEnv("PEER_COMPANY_SPEND_CAP", "on");
    await readCompanyBudgetConfig(new Date(), fakeClient(GENEROUS_CAPS));
    const store = getCounterStore();
    const incrementSpy = vi.spyOn(store, "increment");

    const wrapped = meterProvider(
      baseProvider({ id: "gemini", generateJsonText: () => Promise.resolve("{}") }),
      { userId: null, byok: false },
    );

    await wrapped.generateJsonText?.({ systemPrompt: "s", userPrompt: "u", maxTokens: 100, tier: "small" });
    await flush();

    const keys = incrementSpy.mock.calls.map(([key]) => String(key));
    expect(keys.length).toBeGreaterThan(0);
    expect(keys.every((k) => k === companySpendGlobalDayKey(new Date()))).toBe(true);
  });
});

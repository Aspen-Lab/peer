import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The SDK is stood in for so the model chain can be driven without a key or a
// network. Everything else — the chain loop, the logging and the `ok`
// computation — stays real, because that is the subject.
const generateContentMock = vi.hoisted(() => vi.fn());
vi.mock("@google/genai", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@google/genai")>()),
  GoogleGenAI: class {
    models = { generateContent: generateContentMock };
  },
}));

import { createGeminiApiProvider, geminiProvider } from "./gemini";
import { PROVIDER_MODELS } from "../provider-models";
import {
  setUsageEventsClientForTests,
  type UsageEventRow,
} from "@/lib/usage/events";

/**
 * ABC-freemium 2-05 · R-METER-1 (amended 2026-09-05) · Ruling 6 point 5.
 *
 * **`ok` says whether the request produced usable output.** Every success path
 * in this module used to pass a literal `true`, so a model that answered with
 * empty text wrote an `ok: true` row and the chain then fell through to the
 * next model — the ledger recorded a success the caller never received. There
 * was no suite on this file at all before this item.
 */
describe("2-05 — a Gemini request's `ok` reflects what it returned", () => {
  const rows: UsageEventRow[] = [];

  beforeEach(() => {
    rows.length = 0;
    generateContentMock.mockReset();
    setUsageEventsClientForTests({
      from: () => ({
        insert: (inserted: UsageEventRow[]) => {
          rows.push(...inserted);
          return Promise.resolve({ error: null });
        },
      }),
    } as never);
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    setUsageEventsClientForTests(undefined);
    vi.restoreAllMocks();
  });

  /** Let the fire-and-forget inserts land before asserting on them. */
  async function flush(): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }

  it("writes ok:false for a request that returned EMPTY text", async () => {
    // The one-word defect. The request succeeded at the HTTP level and produced
    // nothing usable; the chain moves on, and the row must say so.
    generateContentMock.mockResolvedValue({ text: "   " });
    const provider = createGeminiApiProvider("GOOGLE-NOT-A-KEY");

    await expect(
      provider.generateJsonText!({
        systemPrompt: "s",
        userPrompt: "u",
        maxTokens: 10,
      }),
    ).rejects.toThrow();
    await flush();

    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.ok === false)).toBe(true);
  });

  it("writes ok:true for a request that returned real text", async () => {
    // The other half, so the case above is not passing by making everything
    // false.
    generateContentMock.mockResolvedValue({ text: '{"a":1}' });
    const provider = createGeminiApiProvider("GOOGLE-NOT-A-KEY");

    await provider.generateJsonText!({
      systemPrompt: "s",
      userPrompt: "u",
      maxTokens: 10,
    });
    await flush();

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kind: "llm", provider: "gemini", ok: true });
  });

  it("writes ONE ROW PER REQUEST across a fallback chain, not one per call", async () => {
    // Ruling 6 point 5's billing reading, asserted on the real chain loop: the
    // first model answers empty, the second answers properly, and the owner's
    // ledger shows both requests because both were billed.
    generateContentMock
      .mockResolvedValueOnce({ text: "" })
      .mockResolvedValue({ text: '{"a":1}' });
    const provider = createGeminiApiProvider("GOOGLE-NOT-A-KEY");

    await provider.generateJsonText!({
      systemPrompt: "s",
      userPrompt: "u",
      maxTokens: 10,
    });
    await flush();

    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.ok)).toEqual([false, true]);
    // ABC-freemium 6-02. This line used to assert the two rows named two
    // DISTINCT models, which was only ever true by accident: it held because
    // the two tiers happened to be configured with different ids, not because
    // anything promised it. Both tiers now name one id, so the distinct-count
    // is 1 — and the property that actually matters is unchanged and is what
    // is asserted instead: the rows name the configured chain, in order, one
    // row per attempt. Read from the constant rather than retyped, so it stays
    // true whichever way the two tiers are configured.
    expect(rows.map((r) => r.model)).toEqual([
      PROVIDER_MODELS.gemini.small,
      PROVIDER_MODELS.gemini.large,
    ]);
  });

  it("writes ok:false when the request throws", async () => {
    // Unchanged behaviour, pinned beside the new one.
    generateContentMock.mockRejectedValue(new Error("boom"));
    const provider = createGeminiApiProvider("GOOGLE-NOT-A-KEY");

    await expect(
      provider.generateJsonText!({
        systemPrompt: "s",
        userPrompt: "u",
        maxTokens: 10,
      }),
    ).rejects.toThrow();
    await flush();

    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.ok === false)).toBe(true);
  });
});

/**
 * ABC-freemium 6-02 · Ruling 23 point 1.
 *
 * Before this suite the whole generation-config policy had **zero** coverage,
 * and it is the only thing deciding two runtime facts for every Gemini call:
 * whether thinking is turned off, and whether the output cap gets +4096 tokens
 * of headroom for it. The policy was keyed on a regex over the MODEL NAME, so
 * moving the shipped ids silently inverted it on 100% of calls — invisibly,
 * because nothing looked.
 *
 * **The control differs by generation and the wrong one is a 400**, measured
 * live 2026-09-07 against every id in both chains: `gemini-3.5-flash-lite` and
 * `gemini-3.6-flash` reject `thinkingBudget` and accept `thinkingLevel`;
 * `gemini-3.1-flash-lite` accepts both; the 2.5 family takes `thinkingBudget`.
 * `callModel` catches and moves on, so a 400 here would empty a chain in
 * silence — which is why the first case below is the load-bearing one: it
 * walks **every id the shipped chains can send** and fails the moment one of
 * them has no control, rather than pinning today's ids.
 */
describe("6-02 — the Gemini thinking control is decided per model family", () => {
  beforeEach(() => {
    generateContentMock.mockReset();
    setUsageEventsClientForTests({
      from: () => ({ insert: () => Promise.resolve({ error: null }) }),
    } as never);
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    setUsageEventsClientForTests(undefined);
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  /** Every `config` object the chain actually handed the SDK, in call order. */
  type SentConfig = {
    maxOutputTokens?: number;
    thinkingConfig?: { thinkingBudget?: number; thinkingLevel?: string };
  };
  function sentConfigs(): SentConfig[] {
    return generateContentMock.mock.calls.map(
      (call) => (call[0] as { config: SentConfig }).config,
    );
  }
  function sentModels(): string[] {
    return generateContentMock.mock.calls.map(
      (call) => (call[0] as { model: string }).model,
    );
  }

  it("turns thinking off for EVERY model id the shipped chains can send", async () => {
    // The guard, and the reason this case is written by enumeration rather
    // than by naming ids: add a model to either chain that no family covers
    // and this fails, instead of the policy inverting in silence the way it
    // did when the 2.5 pair was retired. Global fallback is switched on so the
    // walk reaches BOTH chains, not just the regional one.
    vi.stubEnv("GOOGLE_VERTEX_PROJECT", "not-a-real-project");
    vi.stubEnv("GOOGLE_VERTEX_ALLOW_GLOBAL_FALLBACK", "true");
    generateContentMock.mockResolvedValue({ text: "" });

    await expect(
      geminiProvider.generateJsonText!({
        systemPrompt: "s",
        userPrompt: "u",
        maxTokens: 900,
      }),
    ).rejects.toThrow();

    // Both chains were walked, so this is a real enumeration and not one id.
    // Counted, never assumed unique: the two regional tiers name ONE id today,
    // and assuming otherwise is the exact mistake that made the old ledger
    // case red. Four attempts with three or more distinct ids can only happen
    // if the global chain was reached as well as the regional one.
    expect(sentModels()).toHaveLength(4);
    expect(new Set(sentModels()).size).toBeGreaterThanOrEqual(3);

    for (const config of sentConfigs()) {
      expect(config.thinkingConfig).toBeDefined();
      // No headroom: with thinking off, the caller's budget is the whole cap.
      expect(config.maxOutputTokens).toBe(900);
    }
  });

  it("sends `thinkingLevel` to the Gemini 3 family — `thinkingBudget` is a 400 there", async () => {
    generateContentMock.mockResolvedValue({ text: "" });
    const provider = createGeminiApiProvider("GOOGLE-NOT-A-KEY", [
      { id: "gemini-3.6-flash", location: "global", tier: "small" },
    ]);

    await expect(
      provider.generateJsonText!({ systemPrompt: "s", userPrompt: "u", maxTokens: 50 }),
    ).rejects.toThrow();

    expect(sentConfigs()[0].thinkingConfig).toEqual({ thinkingLevel: "MINIMAL" });
    expect(sentConfigs()[0].maxOutputTokens).toBe(50);
  });

  it("sends `thinkingBudget` to the Gemini 2.5 family, which is the control it takes", async () => {
    // The retired generation is kept covered on purpose: the families are the
    // subject, not the ids that happen to ship today.
    generateContentMock.mockResolvedValue({ text: "" });
    const provider = createGeminiApiProvider("GOOGLE-NOT-A-KEY", [
      { id: "gemini-2.5-flash-lite", location: "global", tier: "small" },
    ]);

    await expect(
      provider.generateJsonText!({ systemPrompt: "s", userPrompt: "u", maxTokens: 50 }),
    ).rejects.toThrow();

    expect(sentConfigs()[0].thinkingConfig).toEqual({ thinkingBudget: 0 });
    expect(sentConfigs()[0].maxOutputTokens).toBe(50);
  });

  it("leaves an unrecognised model thinking, with headroom — the safe direction", async () => {
    // A model nobody has measured must cost money, never 400. This is the
    // other half of the first case: it proves that case can distinguish
    // "covered" from "not covered" rather than passing on everything.
    generateContentMock.mockResolvedValue({ text: "" });
    const provider = createGeminiApiProvider("GOOGLE-NOT-A-KEY", [
      { id: "gemini-9.9-ultra-nobody-has-called", location: "global", tier: "small" },
    ]);

    await expect(
      provider.generateJsonText!({ systemPrompt: "s", userPrompt: "u", maxTokens: 50 }),
    ).rejects.toThrow();

    expect(sentConfigs()[0].thinkingConfig).toBeUndefined();
    expect(sentConfigs()[0].maxOutputTokens).toBe(50 + 4096);
  });

  it("covers the swap target itself, by the constant rather than by its spelling", async () => {
    generateContentMock.mockResolvedValue({ text: "" });
    const provider = createGeminiApiProvider("GOOGLE-NOT-A-KEY", [
      { id: PROVIDER_MODELS.gemini.small, location: "global", tier: "small" },
      { id: PROVIDER_MODELS.gemini.large, location: "global", tier: "large" },
    ]);

    await expect(
      provider.generateJsonText!({ systemPrompt: "s", userPrompt: "u", maxTokens: 120 }),
    ).rejects.toThrow();

    expect(sentConfigs()).toHaveLength(2);
    for (const config of sentConfigs()) {
      expect(config.thinkingConfig).toBeDefined();
      expect(config.maxOutputTokens).toBe(120);
    }
  });
});

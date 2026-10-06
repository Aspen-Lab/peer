import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { logDecisionUsage, logLlmUsage } from "./usage-log";

// P3-S5 — ABC-JEV-INTEGRATION.md §4 Round 3 "P3-S5 DESIGN RULING" +
// docs/jev-abc/P3-B-20260924T0525Z.md §6. `logDecisionUsage` is the Jev
// shadow's cost log, additive beside the existing `logLlmUsage`, and follows
// its EXACT "never log prompt/response text, API keys, or private profile
// context" contract — here that means never owner id, never paper id/title/
// abstract, never intent text, never a key. One line per candidate ATTEMPT,
// including a cache hit (the "cache hit/miss" field only makes sense logged
// on both).

let logSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
});

afterEach(() => {
  logSpy.mockRestore();
});

describe("logDecisionUsage", () => {
  it("emits exactly one console.log line per call, with provider/model/cache/status/tokens/latency", () => {
    logDecisionUsage({
      provider: "typesafe",
      model: "jev-1.13.0",
      cacheHit: false,
      status: "ok",
      inputTokens: 512,
      outputTokens: 0,
      latencyMs: 842.4,
    });

    expect(logSpy).toHaveBeenCalledTimes(1);
    const line = logSpy.mock.calls[0]?.join(" ") ?? "";
    expect(line).toContain("typesafe");
    expect(line).toContain("jev-1.13.0");
    expect(line).toContain("cache=miss");
    expect(line).toContain("status=ok");
    expect(line).toContain("in=512");
    expect(line).toContain("out=0");
    expect(line).toContain("842ms");
  });

  it("renders a cache hit distinctly, with an empty model and zeroed tokens/latency", () => {
    logDecisionUsage({
      provider: "typesafe",
      model: "",
      cacheHit: true,
      status: "cache_hit",
      inputTokens: 0,
      outputTokens: 0,
      latencyMs: 0,
    });

    expect(logSpy).toHaveBeenCalledTimes(1);
    const line = logSpy.mock.calls[0]?.join(" ") ?? "";
    expect(line).toContain("cache=hit");
    expect(line).toContain("status=cache_hit");
    expect(line).toContain("in=0");
    expect(line).toContain("out=0");
    // No stray "undefined"/"null" from an empty model id.
    expect(line).not.toContain("undefined");
    expect(line).not.toContain("null");
  });

  it("renders a degraded (non-ok, non-cache-hit) attempt with an empty model id and no crash", () => {
    expect(() =>
      logDecisionUsage({
        provider: "typesafe",
        model: "",
        cacheHit: false,
        status: "network_error",
        inputTokens: 0,
        outputTokens: 0,
        latencyMs: 15003,
      }),
    ).not.toThrow();

    const line = logSpy.mock.calls[0]?.join(" ") ?? "";
    expect(line).toContain("status=network_error");
    expect(line).toContain("cache=miss");
    expect(line).not.toContain("undefined");
  });

  it("output tokens are always logged as 0 (Jev's output is uncosted, kept only for shape parity)", () => {
    logDecisionUsage({
      provider: "typesafe",
      model: "jev-1.13.0",
      cacheHit: false,
      status: "ok",
      inputTokens: 900,
      outputTokens: 0,
      latencyMs: 100,
    });

    const line = logSpy.mock.calls[0]?.join(" ") ?? "";
    expect(line).toContain("out=0");
  });

  it("rounds a fractional latency rather than logging float noise", () => {
    logDecisionUsage({
      provider: "typesafe",
      model: "jev-1.13.0",
      cacheHit: false,
      status: "ok",
      inputTokens: 10,
      outputTokens: 0,
      latencyMs: 123.7,
    });

    const line = logSpy.mock.calls[0]?.join(" ") ?? "";
    expect(line).toContain("124ms");
  });
});

describe("logDecisionUsage — structural safety (never owner/paper/intent/key text)", () => {
  it("its own parameter type has no owner id, paper id/title/abstract, intent, or key field — grep this file's own source, the same structural guard jev-client.test.ts already uses", () => {
    const here = fileURLToPath(new URL(".", import.meta.url));
    const source = readFileSync(`${here}usage-log.ts`, "utf8");
    const forbidden = [
      "ownerId",
      "owner_id",
      "paperId",
      "paper_id",
      "abstract",
      "intentCard",
      "intentHash",
      "senseConcepts",
      "apiKey",
      "brokerSecret",
      "JEV_API_KEY",
    ];
    for (const term of forbidden) {
      expect(source, `usage-log.ts must never reference "${term}"`).not.toContain(term);
    }
  });

  it("only ever logs the fields the caller explicitly passed as numbers/booleans/short strings, never an arbitrary extra payload object", () => {
    logDecisionUsage({
      provider: "typesafe",
      model: "jev-1.13.0",
      cacheHit: false,
      status: "ok",
      inputTokens: 1,
      outputTokens: 0,
      latencyMs: 1,
    });

    // Exactly one arg group logged as a single joined string line (matches
    // logLlmUsage's own "one compact line" convention) — never a raw object
    // that could carry hidden extra fields through to a log aggregator.
    expect(logSpy.mock.calls[0]?.every((arg: unknown) => typeof arg === "string")).toBe(true);
  });
});

// Peer keeps no ledger of model use. `logLlmUsage` is the console line the
// API-efficiency work reads, and nothing else: it persists nothing and holds no
// reader identity, so the file imports no usage store, no async-local scope and
// no database client.
describe("logLlmUsage — one console line, no ledger", () => {
  it("emits exactly one compact line with the model, path, counts, latency and outcome", () => {
    logLlmUsage({
      provider: "gemini",
      model: "gemini-model-id",
      path: "digest",
      inputTokens: 100,
      outputTokens: 20,
      thinkingTokens: 7,
      latencyMs: 311.6,
      ok: true,
    });

    expect(logSpy).toHaveBeenCalledTimes(1);
    expect(logSpy.mock.calls[0]).toEqual([
      "[llm] gemini/gemini-model-id path=digest in=100 out=20 think=7 312ms ok",
    ]);
  });

  it("marks a failed request ERR and leaves out the counts the API did not report", () => {
    logLlmUsage({ provider: "openai", model: "m", latencyMs: 5, ok: false });

    expect(logSpy.mock.calls[0]).toEqual(["[llm] openai/m 5ms ERR"]);
  });

  it("keeps no ledger: the file imports no usage store, scope, budget or database client", () => {
    const here = fileURLToPath(new URL(".", import.meta.url));
    const source = readFileSync(`${here}usage-log.ts`, "utf8");
    const imports = source
      .split("\n")
      .filter((line) => /^\s*(import\b|\} from\b)/.test(line))
      .join("\n");
    expect(imports).not.toMatch(/@\/lib\/usage\//);
    expect(imports).not.toMatch(/supabase/);
    expect(source).not.toMatch(/usage_events|recordUsageEvent|UsageContext|companyReservation/);
  });
});


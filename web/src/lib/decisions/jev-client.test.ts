import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { captureConsole } from "@/test-support/console-capture";
import { DEFAULT_JEV_ENDPOINT, callJev, type FetchLike } from "./jev-client";
import { buildJevRequest, type JevWireRequest } from "./jev-contract";
import { JEV_MODEL_ID, allQuestionIds } from "./rubric";
import type { DecisionRequest } from "./types";
import { FEED_INTENT_VERSION, type NormalizedFeedIntent } from "@/lib/feed/intent";
import happyPathResponseFixture from "./__fixtures__/jev-happy-path-response.json";

// Obviously fake — never a real Jev credential. Chosen to be distinctive
// enough that an accidental substring match in any log/result would be
// unmistakable.
const FAKE_API_KEY = "jev-test-FAKE-KEY-do-not-use-1234567890abcdef";

function makeIntent(overrides: Partial<NormalizedFeedIntent> = {}): NormalizedFeedIntent {
  return {
    version: FEED_INTENT_VERSION,
    project: { presence: "value", value: "Improve cathode cycling stability", provenance: "user" },
    challenge: { presence: "value", value: "Need papers on capacity fade mechanisms", provenance: "user" },
    requiredConcepts: [],
    preferredConcepts: [],
    exclusions: [],
    methods: [],
    selectedSenseConcepts: [],
    ...overrides,
  };
}

function makeDecisionRequest(overrides: Partial<DecisionRequest> = {}): DecisionRequest {
  return {
    paperId: "paper-1",
    title: "A Study of Cathode Materials",
    abstract: "This paper studies cathode materials for lithium-ion batteries.",
    venue: "Journal of Materials",
    intentCard: makeIntent(),
    senseConcepts: [],
    questions: allQuestionIds(),
    ...overrides,
  };
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

/** A minimal, always-valid wire request — used by fault tests that don't care about the exact question set. */
function minimalWireRequest(): JevWireRequest {
  return buildJevRequest(makeDecisionRequest({ questions: ["project_help"] })).wireRequest;
}

describe("callJev — fault table, one test per row", () => {
  it("200 + valid schema -> ok", async () => {
    const { wireRequest } = buildJevRequest(makeDecisionRequest());
    const fetchImpl: FetchLike = vi.fn(async () => jsonResponse(200, happyPathResponseFixture));
    const result = await callJev(wireRequest, { apiKey: FAKE_API_KEY, fetchImpl });
    expect(result.status).toBe("ok");
    if (result.status !== "ok") throw new Error("expected ok");
    expect(result.modelId).toBe(JEV_MODEL_ID);
    expect(result.answers).toHaveLength(5);
    expect(result.usage.inputTokens).toBe(812);
    expect(result.usage.outputTokens).toBe(0);
    expect(Number.isFinite(result.usage.latencyMs)).toBe(true);
    expect(result.usage.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it("200 + schema validation fails -> invalid_response", async () => {
    const wireRequest = minimalWireRequest();
    const fetchImpl: FetchLike = vi.fn(async () => jsonResponse(200, { model: "wrong-model-id", answers: {}, usage: { input_tokens: 1, output_tokens: 0 } }));
    const result = await callJev(wireRequest, { apiKey: FAKE_API_KEY, fetchImpl });
    expect(result.status).toBe("invalid_response");
    if (result.status !== "invalid_response") throw new Error("expected invalid_response");
    expect(typeof result.detail).toBe("string");
    expect(result.detail.length).toBeGreaterThan(0);
  });

  it("401 -> unauthorized", async () => {
    const fetchImpl: FetchLike = vi.fn(async () => new Response("", { status: 401 }));
    const result = await callJev(minimalWireRequest(), { apiKey: FAKE_API_KEY, fetchImpl });
    expect(result).toEqual({ status: "unauthorized" });
  });

  it("422 -> invalid_request", async () => {
    const fetchImpl: FetchLike = vi.fn(async () => new Response("", { status: 422 }));
    const result = await callJev(minimalWireRequest(), { apiKey: FAKE_API_KEY, fetchImpl });
    expect(result).toEqual({ status: "invalid_request" });
  });

  it("bad_json: 200 with a non-JSON body -> bad_json", async () => {
    const fetchImpl: FetchLike = vi.fn(async () => new Response("not json{{{", { status: 200 }));
    const result = await callJev(minimalWireRequest(), { apiKey: FAKE_API_KEY, fetchImpl });
    expect(result).toEqual({ status: "bad_json" });
  });

  it("network error / fetch throws -> network_error", async () => {
    const fetchImpl: FetchLike = vi.fn(async () => {
      throw new Error("network down");
    });
    const result = await callJev(minimalWireRequest(), { apiKey: FAKE_API_KEY, fetchImpl });
    expect(result).toEqual({ status: "network_error" });
  });

  it("an undocumented status (e.g. 500) is treated conservatively as network_error, never crashes", async () => {
    const fetchImpl: FetchLike = vi.fn(async () => new Response("", { status: 500 }));
    const result = await callJev(minimalWireRequest(), { apiKey: FAKE_API_KEY, fetchImpl });
    expect(result).toEqual({ status: "network_error" });
  });
});

describe("callJev — timeout", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("maps an aborted request to a typed timeout result, never rejects", async () => {
    const fetchImpl: FetchLike = vi.fn(
      (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener("abort", () => {
            reject(new DOMException("The operation was aborted.", "AbortError"));
          });
        }),
    );

    const promise = callJev(minimalWireRequest(), { apiKey: FAKE_API_KEY, fetchImpl, timeoutMs: 5_000 });
    await vi.advanceTimersByTimeAsync(5_000);
    const result = await promise;
    expect(result).toEqual({ status: "timeout" });
  });
});

describe("callJev — bounded retry with backoff on 429/529", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("429: retries a small bounded number of times with backoff, then reports rate_limited if it never recovers", async () => {
    const fetchImpl: FetchLike = vi.fn(async () => new Response("", { status: 429 }));
    const promise = callJev(minimalWireRequest(), { apiKey: FAKE_API_KEY, fetchImpl });

    await vi.advanceTimersByTimeAsync(0);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(500);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1_500);
    expect(fetchImpl).toHaveBeenCalledTimes(3);

    const result = await promise;
    expect(result).toEqual({ status: "rate_limited" });
    // Bounded: never a 4th attempt no matter how much more time passes.
    await vi.advanceTimersByTimeAsync(60_000);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it("529: same bounded-retry treatment as 429, reports overloaded if it never recovers", async () => {
    const fetchImpl: FetchLike = vi.fn(async () => new Response("", { status: 529 }));
    const promise = callJev(minimalWireRequest(), { apiKey: FAKE_API_KEY, fetchImpl });
    await vi.advanceTimersByTimeAsync(500 + 1_500);
    const result = await promise;
    expect(result).toEqual({ status: "overloaded" });
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it("stops retrying as soon as an attempt recovers", async () => {
    let calls = 0;
    const fetchImpl: FetchLike = vi.fn(async () => {
      calls += 1;
      return calls < 2 ? new Response("", { status: 429 }) : jsonResponse(200, happyPathResponseFixture);
    });
    const request = buildJevRequest(makeDecisionRequest()).wireRequest;
    const promise = callJev(request, { apiKey: FAKE_API_KEY, fetchImpl });
    await vi.advanceTimersByTimeAsync(500);
    const result = await promise;
    expect(result.status).toBe("ok");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("an injected sleepImpl is used for the retry backoff, without needing fake timers", async () => {
    let calls = 0;
    const fetchImpl: FetchLike = vi.fn(async () => {
      calls += 1;
      return new Response("", { status: 429 });
    });
    const sleepCalls: number[] = [];
    const sleepImpl = async (ms: number) => {
      sleepCalls.push(ms);
    };
    vi.useRealTimers(); // this test proves sleepImpl works WITHOUT fake timers
    const result = await callJev(minimalWireRequest(), { apiKey: FAKE_API_KEY, fetchImpl, sleepImpl });
    expect(result).toEqual({ status: "rate_limited" });
    expect(calls).toBe(3);
    expect(sleepCalls).toEqual([500, 1_500]);
  });
});

describe("callJev — never throws", () => {
  it("never throws, across several unanticipated failure shapes", async () => {
    const scenarios: FetchLike[] = [
      vi.fn(() => {
        throw new Error("sync boom");
      }),
      vi.fn(async () => {
        throw new Error("async boom");
      }),
      // Pathological: not even a Response-shaped value.
      vi.fn(async () => undefined as unknown as Response),
      // A Response whose .json() itself throws synchronously.
      vi.fn(
        async () =>
          ({
            status: 200,
            json: () => {
              throw new Error("json boom");
            },
          }) as unknown as Response,
      ),
    ];

    for (const fetchImpl of scenarios) {
      await expect(callJev(minimalWireRequest(), { apiKey: FAKE_API_KEY, fetchImpl, timeoutMs: 50 })).resolves.toBeDefined();
    }
  });
});

describe("callJev — api key never leaks", () => {
  it("sends the key as a Bearer authorization header (proves it is actually used, not just never touched)", async () => {
    let capturedHeaders: HeadersInit | undefined;
    const fetchImpl: FetchLike = vi.fn(async (_url, init) => {
      capturedHeaders = init.headers;
      return new Response("", { status: 401 });
    });
    await callJev(minimalWireRequest(), { apiKey: FAKE_API_KEY, fetchImpl, endpoint: DEFAULT_JEV_ENDPOINT });
    const headers = new Headers(capturedHeaders);
    expect(headers.get("authorization")).toBe(`Bearer ${FAKE_API_KEY}`);
  });

  it("the key substring never appears in any returned result, across every fault kind and the happy path", async () => {
    const cases: Array<() => FetchLike> = [
      () => vi.fn(async () => new Response("", { status: 401 })),
      () => vi.fn(async () => new Response("", { status: 422 })),
      () => vi.fn(async () => new Response("not json", { status: 200 })),
      () =>
        vi.fn(async () => {
          throw new Error("network down");
        }),
      () => vi.fn(async () => jsonResponse(200, { model: "wrong", answers: {}, usage: { input_tokens: 0, output_tokens: 0 } })),
      () => vi.fn(async () => jsonResponse(200, happyPathResponseFixture)),
    ];
    for (const makeFetch of cases) {
      const request = buildJevRequest(makeDecisionRequest()).wireRequest;
      const result = await callJev(request, { apiKey: FAKE_API_KEY, fetchImpl: makeFetch() });
      expect(JSON.stringify(result)).not.toContain(FAKE_API_KEY);
    }
  });

  it("the key substring never appears in any console.log/info/debug/warn/error call", async () => {
    const consoleText = captureConsole();
    try {
      const fetchImpl: FetchLike = vi.fn(async () => jsonResponse(200, happyPathResponseFixture));
      const request = buildJevRequest(makeDecisionRequest()).wireRequest;
      await callJev(request, { apiKey: FAKE_API_KEY, fetchImpl });
      expect(consoleText.text()).not.toContain(FAKE_API_KEY);
    } finally {
      consoleText.restore();
    }
  });

  it("the source file itself never reads process.env and never imports next/* or @/lib/supabase/* (Deno-portability + no-direct-key-path structural guard)", () => {
    const path = fileURLToPath(new URL("./jev-client.ts", import.meta.url));
    const source = readFileSync(path, "utf8");
    // Matches real property access (`process.env.X` / `process.env["X"]`),
    // not this file's own doc-comment prose ABOUT avoiding it.
    expect(source).not.toMatch(/process\.env[.[]/);
    expect(source).not.toMatch(/from ["']next\//);
    expect(source).not.toMatch(/from ["']@\/lib\/supabase/);
    expect(source).not.toContain("JEV_API_KEY");
  });
});

describe("callJev — end to end through jev-contract.ts's validator", () => {
  it("round-trips a happy-path response through callJev AND the P3-S1 validator, not a reimplementation", async () => {
    const decisionRequest = makeDecisionRequest();
    const { wireRequest } = buildJevRequest(decisionRequest);
    const fetchImpl: FetchLike = vi.fn(async (url, init) => {
      expect(url).toBe(DEFAULT_JEV_ENDPOINT);
      expect(init.method).toBe("POST");
      const sentBody = JSON.parse(init.body as string);
      expect(sentBody.model).toBe(JEV_MODEL_ID);
      expect(Object.keys(sentBody.questions)).toEqual(decisionRequest.questions);
      return jsonResponse(200, happyPathResponseFixture);
    });

    const result = await callJev(wireRequest, { apiKey: FAKE_API_KEY, fetchImpl });
    expect(result.status).toBe("ok");
    if (result.status !== "ok") throw new Error("expected ok");
    expect(result.answers.map((a) => a.questionId).sort()).toEqual(
      ["core_vs_background", "method_outcome_match", "population_match", "project_help", "sense_match"].sort(),
    );
    expect(result.answers.every((a) => a.unknown === false)).toBe(true);
  });
});

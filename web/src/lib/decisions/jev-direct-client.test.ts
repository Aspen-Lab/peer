import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FEED_INTENT_VERSION, type NormalizedFeedIntent } from "@/lib/feed/intent";
import { captureConsole } from "@/test-support/console-capture";
import { buildJevRequest } from "./jev-contract";
import type { FetchLike } from "./jev-client";
import type { DecisionRequest } from "./types";
import { callJevDirect, type JevDirectClientOptions } from "./jev-direct-client";

// The direct Jev client, now on the READER'S key. The key is a parameter of
// `callJevDirect` and nothing else: no environment read, no entitlement flag,
// no reservation, no counter. (It used to read the company's key from the
// environment and reserve a daily budget first; the owner cut that path on
// 2026-10-06 and Jev became a bring-your-own-key option. The cases that tested
// the environment key, the entitlement gate and the reservation order are gone
// with those behaviours; the leak cases, the fault table and "never throws"
// are kept and now run against a key passed in.)

// Obviously fake — never a real Jev credential. Distinctive enough that an
// accidental substring match in any log/result would be unmistakable.
const FAKE_API_KEY = "jev-direct-test-FAKE-KEY-do-not-use-1234567890abcdef";
// A different invented string, put in the ENVIRONMENT to prove it is never read.
const ENV_SENTINEL = "jev-env-sentinel-must-never-be-used-0000";

function makeIntent(): NormalizedFeedIntent {
  return {
    version: FEED_INTENT_VERSION,
    project: { presence: "value", value: "Improve cathode cycling stability", provenance: "user" },
    challenge: { presence: "omitted" },
    requiredConcepts: [],
    preferredConcepts: [],
    exclusions: [],
    methods: [],
    selectedSenseConcepts: [],
  };
}

function makeRequest(): DecisionRequest {
  return {
    paperId: "paper-1",
    title: "A Study of Cathode Materials",
    abstract: "This paper studies cathode materials for lithium-ion batteries.",
    intentCard: makeIntent(),
    senseConcepts: [],
    questions: ["core_vs_background", "project_help"],
  };
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

/**
 * The RAW Jev wire response shape (`jev-contract.ts`'s `validateJevResponse`
 * input) — NOT the already-validated `JevCallResult`/`BrokerCallResult`
 * shape `broker-client.test.ts`/`shadow.test.ts` construct. `callJevDirect`
 * goes through `callJev` -> `validateJevResponse` itself (no broker
 * pre-validation hop), so the fixture here must be what Jev's real endpoint
 * actually returns: `answers` keyed by question id (not an array), `model`
 * (not `modelId`), snake_case `usage`. Criteria/levels are copied verbatim
 * from `rubric.ts` (`core_vs_background`'s 3 criteria keys, `project_help`'s
 * 4 score levels) so this validates against the same rubric the real code
 * uses, never a reinvented one.
 */
function okBody(overrides: Record<string, unknown> = {}) {
  return {
    model: "jev-1.13.0",
    answers: {
      core_vs_background: {
        type: "choice",
        choice: "core",
        probabilities: { core: 0.9, background: 0.08, insufficient_information: 0.02 },
        confidence: 0.9,
      },
      project_help: {
        type: "score",
        score: 2,
        legend: { "0": "not helpful", "1": "slightly helpful", "2": "moderately helpful", "3": "directly helpful" },
        probabilities: { "0": 0.05, "1": 0.05, "2": 0.8, "3": 0.1 },
        confidence: 0.8,
      },
    },
    usage: { input_tokens: 40, output_tokens: 0 },
    ...overrides,
  };
}

function baseOptions(overrides: Partial<JevDirectClientOptions> = {}): JevDirectClientOptions {
  return { apiKey: FAKE_API_KEY, ...overrides };
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("callJevDirect — the key is a parameter", () => {
  it("a blank, whitespace-only or key-shaped-wrong value makes no call and answers network_error", async () => {
    for (const apiKey of ["", "   ", "two words", "line\nbreak", "tab\tinside"]) {
      const fetchImpl = vi.fn();
      const result = await callJevDirect(makeRequest(), baseOptions({ apiKey, fetchImpl }));
      expect(result, JSON.stringify(apiKey)).toEqual({ status: "network_error" });
      expect(fetchImpl).not.toHaveBeenCalled();
    }
  });

  it("never reads the environment: with a key-looking value in JEV_API_KEY, a blank apiKey still makes no call", async () => {
    vi.stubEnv("JEV_API_KEY", ENV_SENTINEL);
    const fetchImpl = vi.fn();

    const result = await callJevDirect(makeRequest(), baseOptions({ apiKey: "", fetchImpl }));

    expect(result).toEqual({ status: "network_error" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("never reads the environment: with a key in JEV_API_KEY AND a parameter, the call carries the parameter only", async () => {
    vi.stubEnv("JEV_API_KEY", ENV_SENTINEL);
    let capturedHeaders: HeadersInit | undefined;
    let capturedBody = "";
    const fetchImpl: FetchLike = vi.fn(async (_url, init) => {
      capturedHeaders = init.headers;
      capturedBody = String(init.body);
      return jsonResponse(200, okBody());
    });

    const result = await callJevDirect(makeRequest(), baseOptions({ fetchImpl }));

    expect(result.status).toBe("ok");
    expect(new Headers(capturedHeaders).get("authorization")).toBe(`Bearer ${FAKE_API_KEY}`);
    expect(JSON.stringify([...new Headers(capturedHeaders).entries()])).not.toContain(ENV_SENTINEL);
    expect(capturedBody).not.toContain(ENV_SENTINEL);
  });

  it("trims the key before using it", async () => {
    let capturedHeaders: HeadersInit | undefined;
    const fetchImpl: FetchLike = vi.fn(async (_url, init) => {
      capturedHeaders = init.headers;
      return jsonResponse(200, okBody());
    });

    await callJevDirect(makeRequest(), baseOptions({ apiKey: `  ${FAKE_API_KEY}\n`, fetchImpl }));

    expect(new Headers(capturedHeaders).get("authorization")).toBe(`Bearer ${FAKE_API_KEY}`);
  });

  it("takes no entitlement flag, no counter store and no cap: its option type has none", () => {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const source = readFileSync(path.join(here, "jev-direct-client.ts"), "utf8");
    for (const gone of ["entitled", "perUserCap", "globalCap", "CounterStore", "reserveJevCall", "ownerId"]) {
      expect(source, gone).not.toContain(gone);
    }
  });
});

describe("callJevDirect — request shape sent to Jev", () => {
  it("sends exactly the wireRequest buildJevRequest produces — the key travels in a header, never in the body", async () => {
    let capturedBody = "";
    const fetchImpl: FetchLike = vi.fn(async (_url, init) => {
      capturedBody = String(init.body);
      return jsonResponse(200, okBody());
    });
    const request = makeRequest();

    await callJevDirect(request, baseOptions({ fetchImpl }));

    const expected = buildJevRequest(request).wireRequest;
    expect(JSON.parse(capturedBody)).toEqual(expected);
    expect(capturedBody).not.toContain(FAKE_API_KEY);
  });

  it("sends the key as a Bearer authorization header, never in the URL", async () => {
    let capturedUrl = "";
    let capturedHeaders: HeadersInit | undefined;
    const fetchImpl: FetchLike = vi.fn(async (url, init) => {
      capturedUrl = url;
      capturedHeaders = init.headers;
      return jsonResponse(200, okBody());
    });

    await callJevDirect(makeRequest(), baseOptions({ fetchImpl }));

    expect(capturedUrl).not.toContain(FAKE_API_KEY);
    const headers = new Headers(capturedHeaders);
    expect(headers.get("authorization")).toBe(`Bearer ${FAKE_API_KEY}`);
  });
});

describe("callJevDirect — fault passthrough (thin wrapper over callJev, no remapping)", () => {
  it.each([
    ["unauthorized", 401, undefined],
    ["invalid_request", 422, undefined],
    ["bad_json", 200, "not json{{{"],
  ] as const)("%s passes through unchanged", async (expectedStatus, httpStatus, rawBody) => {
    const fetchImpl: FetchLike = vi.fn(async () =>
      rawBody !== undefined ? new Response(rawBody, { status: httpStatus }) : new Response("", { status: httpStatus }),
    );
    const result = await callJevDirect(makeRequest(), baseOptions({ fetchImpl }));
    expect(result).toEqual({ status: expectedStatus });
  });

  it("network_error (fetch throws) passes through unchanged", async () => {
    const fetchImpl: FetchLike = vi.fn(async () => {
      throw new Error("network down");
    });
    const result = await callJevDirect(makeRequest(), baseOptions({ fetchImpl }));
    expect(result).toEqual({ status: "network_error" });
  });

  it("invalid_response (schema validation failure) passes through unchanged, with a detail string", async () => {
    const fetchImpl: FetchLike = vi.fn(async () =>
      jsonResponse(200, { model: "wrong-model-id", answers: {}, usage: { input_tokens: 1, output_tokens: 0 } }),
    );
    const result = await callJevDirect(makeRequest(), baseOptions({ fetchImpl }));
    expect(result.status).toBe("invalid_response");
    if (result.status !== "invalid_response") throw new Error("expected invalid_response");
    expect(typeof result.detail).toBe("string");
    expect(result.detail.length).toBeGreaterThan(0);
  });

  it("an undocumented status (e.g. 500) is treated conservatively as network_error, never crashes", async () => {
    const fetchImpl: FetchLike = vi.fn(async () => new Response("", { status: 500 }));
    const result = await callJevDirect(makeRequest(), baseOptions({ fetchImpl }));
    expect(result).toEqual({ status: "network_error" });
  });
});

describe("callJevDirect — rate_limited/overloaded/timeout passthrough (callJev's own bounded retry runs unchanged underneath)", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("429 -> rate_limited after callJev's own bounded retries run to exhaustion", async () => {
    vi.useFakeTimers();
    const fetchImpl: FetchLike = vi.fn(async () => new Response("", { status: 429 }));
    const promise = callJevDirect(makeRequest(), baseOptions({ fetchImpl }));
    await vi.advanceTimersByTimeAsync(500 + 1_500);
    const result = await promise;
    expect(result).toEqual({ status: "rate_limited" });
  });

  it("529 -> overloaded after callJev's own bounded retries run to exhaustion", async () => {
    vi.useFakeTimers();
    const fetchImpl: FetchLike = vi.fn(async () => new Response("", { status: 529 }));
    const promise = callJevDirect(makeRequest(), baseOptions({ fetchImpl }));
    await vi.advanceTimersByTimeAsync(500 + 1_500);
    const result = await promise;
    expect(result).toEqual({ status: "overloaded" });
  });

  it("an aborted request maps to a typed timeout result, never rejects", async () => {
    vi.useFakeTimers();
    const fetchImpl: FetchLike = vi.fn(
      (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener("abort", () => {
            reject(new DOMException("The operation was aborted.", "AbortError"));
          });
        }),
    );
    const promise = callJevDirect(makeRequest(), baseOptions({ fetchImpl, timeoutMs: 5_000 }));
    await vi.advanceTimersByTimeAsync(5_000);
    const result = await promise;
    expect(result).toEqual({ status: "timeout" });
  });
});

describe("callJevDirect — never throws (property test)", () => {
  const unanticipatedFailures: Array<[string, FetchLike]> = [
    [
      "sync throw",
      (() => {
        throw new Error("sync boom");
      }) as unknown as FetchLike,
    ],
    [
      "async rejection",
      (async () => {
        throw new Error("async boom");
      }) as FetchLike,
    ],
    ["a non-Response return value", (async () => ({}) as Response) as FetchLike],
    [
      "a .json() that itself throws",
      (async () =>
        ({
          status: 200,
          json: () => {
            throw new Error("bad json parse");
          },
        }) as unknown as Response) as FetchLike,
    ],
  ];

  it.each(unanticipatedFailures)("never throws even for: %s", async (_label, fetchImpl) => {
    await expect(callJevDirect(makeRequest(), baseOptions({ fetchImpl }))).resolves.toBeDefined();
  });

  it("never throws for a non-string key or a request that cannot be built", async () => {
    await expect(
      callJevDirect(makeRequest(), { apiKey: undefined as unknown as string, fetchImpl: vi.fn() }),
    ).resolves.toEqual({ status: "network_error" });
    await expect(
      callJevDirect(null as unknown as DecisionRequest, baseOptions({ fetchImpl: vi.fn() })),
    ).resolves.toEqual({ status: "network_error" });
  });
});

describe("callJevDirect — api key never leaks", () => {
  it("the key substring never appears in any returned result, across every fault kind and the happy path", async () => {
    const cases: Array<() => FetchLike> = [
      () => vi.fn(async () => new Response("", { status: 401 })),
      () => vi.fn(async () => new Response("", { status: 422 })),
      () => vi.fn(async () => new Response("not json", { status: 200 })),
      () =>
        vi.fn(async () => {
          throw new Error(`network down ${FAKE_API_KEY}`);
        }),
      () => vi.fn(async () => jsonResponse(200, okBody())),
    ];
    for (const makeFetch of cases) {
      const result = await callJevDirect(makeRequest(), baseOptions({ fetchImpl: makeFetch() }));
      expect(JSON.stringify(result)).not.toContain(FAKE_API_KEY);
    }
  });

  it("the key substring never appears in any console.log/info/debug/warn/error call", async () => {
    const consoleText = captureConsole();
    try {
      const failing: FetchLike = vi.fn(async () => {
        throw new Error(`network down ${FAKE_API_KEY}`);
      });
      await callJevDirect(makeRequest(), baseOptions({ fetchImpl: failing }));
      const fetchImpl: FetchLike = vi.fn(async () => jsonResponse(200, okBody()));
      await callJevDirect(makeRequest(), baseOptions({ fetchImpl }));
      expect(consoleText.text()).not.toContain(FAKE_API_KEY);
    } finally {
      consoleText.restore();
    }
  });
});

describe("jev-direct-client.ts — structural safety guards (read the file's own source text)", () => {
  function source(): string {
    const here = path.dirname(fileURLToPath(import.meta.url));
    return readFileSync(path.join(here, "jev-direct-client.ts"), "utf8");
  }

  /** Comments removed — mirrors `spend-scans.test.ts`'s own `code()` helper. */
  function code(): string {
    return source()
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/(^|[^:])\/\/.*$/gm, "$1");
  }

  it('imports "server-only" as the first statement (its own module doc comment may precede it)', () => {
    const withoutLeadingDocComment = source().replace(/^\s*\/\*[\s\S]*?\*\//, "").trimStart();
    expect(withoutLeadingDocComment.startsWith('import "server-only";')).toBe(true);
  });

  it("reads nothing from the environment at all, and does not name the old company variable even in a comment", () => {
    expect(code()).not.toMatch(/process\.env/);
    expect(source()).not.toContain("JEV_API_KEY");
  });
});

describe("decision-cache.ts — the key is not an input of the cache key", () => {
  it("the cache-key derivation module's source never contains a Jev key name or field", () => {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const source = readFileSync(path.join(here, "decision-cache.ts"), "utf8");
    expect(source).not.toContain("JEV_API_KEY");
    expect(source).not.toMatch(/apiKey|jevApiKey/);
  });
});

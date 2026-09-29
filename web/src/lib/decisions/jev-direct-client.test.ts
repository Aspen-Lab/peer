import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FEED_INTENT_VERSION, type NormalizedFeedIntent } from "@/lib/feed/intent";
import { InMemoryCounterStore } from "@/lib/usage/counters";
import { buildJevRequest } from "./jev-contract";
import type { FetchLike } from "./jev-client";
import type { DecisionRequest } from "./types";
import { callJevDirect, jevDirectConfigured, type JevDirectClientOptions } from "./jev-direct-client";

// JEV-DIRECT (§1aa): the server-only direct Jev client. Mirrors
// broker-client.test.ts's shape closely (same reservation/entitlement/key
// gate ordering, same never-throws/never-leaks guarantees) since
// jev-direct-client.ts is architecturally the direct-transport sibling of
// broker-client.ts, reusing the exact same `reserveJevCall`/`buildJevRequest`/
// `callJev` this whole area was built on.

// Obviously fake — never a real Jev credential. Distinctive enough that an
// accidental substring match in any log/result would be unmistakable.
const FAKE_API_KEY = "jev-direct-test-FAKE-KEY-do-not-use-1234567890abcdef";
const NOW = new Date("2026-09-27T00:00:00.000Z");

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
  return {
    ownerId: "owner-a",
    entitled: true,
    perUserCap: 100,
    globalCap: 1000,
    now: NOW,
    store: new InMemoryCounterStore(),
    ...overrides,
  };
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("jevDirectConfigured", () => {
  it("is false when JEV_API_KEY is unset, blank, or whitespace-only", () => {
    delete process.env.JEV_API_KEY;
    expect(jevDirectConfigured()).toBe(false);
    vi.stubEnv("JEV_API_KEY", "");
    expect(jevDirectConfigured()).toBe(false);
    vi.stubEnv("JEV_API_KEY", "   ");
    expect(jevDirectConfigured()).toBe(false);
  });

  it("is true when JEV_API_KEY is set to a non-blank value", () => {
    vi.stubEnv("JEV_API_KEY", FAKE_API_KEY);
    expect(jevDirectConfigured()).toBe(true);
  });
});

describe("callJevDirect — key gate", () => {
  it("key unset: returns disabled, never reserves, never fetches", async () => {
    delete process.env.JEV_API_KEY;
    const store = new InMemoryCounterStore();
    const incrementSpy = vi.spyOn(store, "increment");
    const fetchImpl = vi.fn();

    const result = await callJevDirect(makeRequest(), baseOptions({ store, fetchImpl }));

    expect(result).toEqual({ status: "disabled" });
    expect(incrementSpy).not.toHaveBeenCalled();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("key blank/whitespace-only: also disabled", async () => {
    vi.stubEnv("JEV_API_KEY", "   ");
    const fetchImpl = vi.fn();
    const result = await callJevDirect(makeRequest(), baseOptions({ fetchImpl }));
    expect(result).toEqual({ status: "disabled" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe("callJevDirect — entitlement gate", () => {
  beforeEach(() => {
    vi.stubEnv("JEV_API_KEY", FAKE_API_KEY);
  });

  it("not entitled: returns not_entitled, never reserves, never fetches", async () => {
    const store = new InMemoryCounterStore();
    const incrementSpy = vi.spyOn(store, "increment");
    const fetchImpl = vi.fn();

    const result = await callJevDirect(makeRequest(), baseOptions({ store, fetchImpl, entitled: false }));

    expect(result).toEqual({ status: "not_entitled" });
    expect(incrementSpy).not.toHaveBeenCalled();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("not entitled beats an otherwise-refusing reservation too — the entitlement check runs strictly first", async () => {
    const store = new InMemoryCounterStore();
    const fetchImpl = vi.fn();

    const result = await callJevDirect(makeRequest(), baseOptions({ store, fetchImpl, entitled: false, perUserCap: 0 }));

    expect(result).toEqual({ status: "not_entitled" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("entitled: true proceeds to reservation as normal", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(200, okBody()));
    const result = await callJevDirect(makeRequest(), baseOptions({ fetchImpl, entitled: true }));
    expect(result.status).toBe("ok");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});

describe("callJevDirect — reservation ordering and refusal", () => {
  beforeEach(() => {
    vi.stubEnv("JEV_API_KEY", FAKE_API_KEY);
  });

  it("reserves strictly before any fetch on the success path (call-order proof)", async () => {
    const store = new InMemoryCounterStore();
    const order: string[] = [];
    vi.spyOn(store, "increment").mockImplementation(async (...args) => {
      order.push("reserve");
      return InMemoryCounterStore.prototype.increment.apply(store, args);
    });
    const fetchImpl = vi.fn(async () => {
      order.push("fetch");
      return jsonResponse(200, okBody());
    });

    await callJevDirect(makeRequest(), baseOptions({ store, fetchImpl }));

    expect(order[0]).toBe("reserve");
    expect(order[order.length - 1]).toBe("fetch");
  });

  it("reserves strictly before any fetch on an ERROR path too", async () => {
    const store = new InMemoryCounterStore();
    const order: string[] = [];
    vi.spyOn(store, "increment").mockImplementation(async (...args) => {
      order.push("reserve");
      return InMemoryCounterStore.prototype.increment.apply(store, args);
    });
    const fetchImpl = vi.fn(async () => {
      order.push("fetch");
      throw new Error("network down");
    });

    const result = await callJevDirect(makeRequest(), baseOptions({ store, fetchImpl }));

    expect(result).toEqual({ status: "network_error" });
    expect(order).toEqual(["reserve", "reserve", "fetch"]); // per-user + global increments, then fetch
  });

  it("per-user cap refusal -> reservation_refused, fetch never attempted", async () => {
    const store = new InMemoryCounterStore();
    const fetchImpl = vi.fn();
    const result = await callJevDirect(makeRequest(), baseOptions({ store, fetchImpl, perUserCap: 0 }));
    expect(result).toEqual({ status: "reservation_refused", reason: "per_user_cap_exceeded" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("global cap refusal -> reservation_refused, fetch never attempted", async () => {
    const store = new InMemoryCounterStore();
    const fetchImpl = vi.fn();
    const result = await callJevDirect(makeRequest(), baseOptions({ store, fetchImpl, globalCap: 0 }));
    expect(result).toEqual({ status: "reservation_refused", reason: "global_cap_exceeded" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("an unreadable counter store fails closed and never calls fetch", async () => {
    const unreadableStore = {
      label: "in-memory" as const,
      increment: vi.fn(async () => ({ value: 0, ok: false })),
      read: vi.fn(async () => ({ value: 0, ok: false })),
    };
    const fetchImpl = vi.fn();

    const result = await callJevDirect(makeRequest(), baseOptions({ store: unreadableStore, fetchImpl }));

    expect(result).toEqual({ status: "reservation_refused", reason: "counter_unreadable" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe("callJevDirect — request shape sent to Jev", () => {
  beforeEach(() => {
    vi.stubEnv("JEV_API_KEY", FAKE_API_KEY);
  });

  it("sends exactly the wireRequest buildJevRequest produces — byte-for-byte the same body Jev would see whether called via broker or direct, no ownerId wrapper", async () => {
    let capturedBody = "";
    const fetchImpl: FetchLike = vi.fn(async (_url, init) => {
      capturedBody = String(init.body);
      return jsonResponse(200, okBody());
    });
    const request = makeRequest();

    await callJevDirect(request, baseOptions({ fetchImpl }));

    const expected = buildJevRequest(request).wireRequest;
    expect(JSON.parse(capturedBody)).toEqual(expected);
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
  beforeEach(() => {
    vi.stubEnv("JEV_API_KEY", FAKE_API_KEY);
  });

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
  beforeEach(() => {
    vi.stubEnv("JEV_API_KEY", FAKE_API_KEY);
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("429 -> rate_limited after callJev's own bounded retries run to exhaustion", async () => {
    const fetchImpl: FetchLike = vi.fn(async () => new Response("", { status: 429 }));
    const promise = callJevDirect(makeRequest(), baseOptions({ fetchImpl }));
    await vi.advanceTimersByTimeAsync(500 + 1_500);
    const result = await promise;
    expect(result).toEqual({ status: "rate_limited" });
  });

  it("529 -> overloaded after callJev's own bounded retries run to exhaustion", async () => {
    const fetchImpl: FetchLike = vi.fn(async () => new Response("", { status: 529 }));
    const promise = callJevDirect(makeRequest(), baseOptions({ fetchImpl }));
    await vi.advanceTimersByTimeAsync(500 + 1_500);
    const result = await promise;
    expect(result).toEqual({ status: "overloaded" });
  });

  it("an aborted request maps to a typed timeout result, never rejects", async () => {
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
  beforeEach(() => {
    vi.stubEnv("JEV_API_KEY", FAKE_API_KEY);
  });

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
});

describe("callJevDirect — api key never leaks", () => {
  beforeEach(() => {
    vi.stubEnv("JEV_API_KEY", FAKE_API_KEY);
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
      () => vi.fn(async () => jsonResponse(200, okBody())),
    ];
    for (const makeFetch of cases) {
      const result = await callJevDirect(makeRequest(), baseOptions({ fetchImpl: makeFetch() }));
      expect(JSON.stringify(result)).not.toContain(FAKE_API_KEY);
    }
  });

  it("the key substring never appears in any console.log/warn/error call", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const fetchImpl: FetchLike = vi.fn(async () => jsonResponse(200, okBody()));
      await callJevDirect(makeRequest(), baseOptions({ fetchImpl }));
      const allCalls = [...logSpy.mock.calls, ...warnSpy.mock.calls, ...errorSpy.mock.calls];
      for (const args of allCalls) {
        expect(args.join(" ")).not.toContain(FAKE_API_KEY);
      }
    } finally {
      logSpy.mockRestore();
      warnSpy.mockRestore();
      errorSpy.mockRestore();
    }
  });
});

describe("jev-direct-client.ts — structural safety guards (read the file's own source text)", () => {
  function source(): string {
    const here = path.dirname(fileURLToPath(import.meta.url));
    return readFileSync(path.join(here, "jev-direct-client.ts"), "utf8");
  }

  /** Comments removed — mirrors `spend-scans.test.ts`'s own `code()` helper. This module's job is explaining JEV_API_KEY, so its doc comments legitimately mention the name in prose; only a CODE occurrence of the read should count. */
  function code(): string {
    return source()
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/(^|[^:])\/\/.*$/gm, "$1");
  }

  it('imports "server-only" as the first statement (its own module doc comment may precede it)', () => {
    const withoutLeadingDocComment = source().replace(/^\s*\/\*[\s\S]*?\*\//, "").trimStart();
    expect(withoutLeadingDocComment.startsWith('import "server-only";')).toBe(true);
  });

  it("reads process.env.JEV_API_KEY exactly once in its own CODE (comments may mention the name in prose) — JEV-DIRECT (§1aa)", () => {
    const matches = code().match(/process\.env\.JEV_API_KEY\b/g) ?? [];
    expect(matches).toHaveLength(1);
  });

  it("reads no process.env name other than JEV_API_KEY", () => {
    const envReads = code().match(/process\.env(\.\w+|\[[^\]]+\])/g) ?? [];
    for (const read of envReads) {
      expect(read).toBe("process.env.JEV_API_KEY");
    }
  });
});

describe("decision-cache.ts — never reads JEV_API_KEY (JEV-DIRECT (§1aa) regression guard)", () => {
  it("the cache-key derivation module's source never contains JEV_API_KEY", () => {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const source = readFileSync(path.join(here, "decision-cache.ts"), "utf8");
    expect(source).not.toContain("JEV_API_KEY");
  });
});

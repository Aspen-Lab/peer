import { afterEach, describe, expect, it, vi } from "vitest";
import { FEED_INTENT_VERSION, type NormalizedFeedIntent } from "@/lib/feed/intent";
import type { DecisionCache } from "./decision-cache";
import type { DecisionResult } from "./types";
import {
  MAX_SCREEN_CANDIDATES,
  SCREEN_DEADLINE_MS,
  screenWithJev,
  type ScreenCandidate,
  type ScreenOptions,
} from "./screen";

// The per-candidate Jev screen, on the READER'S key. It takes the key as an
// option, calls Jev directly (no broker, no company budget, no Gemini
// fallback), and RETURNS the decisions it got (cache hits and fresh answers)
// so the pipeline can order the reader's papers by them. It is bounded: at most
// 50 candidates, at most 4 calls at once, a 20 second hard deadline that returns
// whatever has arrived, a stop at the first rejected key, and a stop after 3
// throttled answers in a row. Every network boundary is injected (`fetchImpl`);
// no real HTTP.
//
// This file replaced `shadow.test.ts` (the same runner, which used to return
// counts only and run after the response). The cache, concurrency, never-throws
// and candidate-cap cases carry over; the deadline case is now a race with a
// real timer; the stop rules and the returned decisions are new.

// An invented string. It is not, and never was, a key.
const API_KEY = "jev-screen-test-FAKE-KEY-do-not-use-1234567890abcdef";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

function makeIntent(overrides: Partial<NormalizedFeedIntent> = {}): NormalizedFeedIntent {
  return {
    version: FEED_INTENT_VERSION,
    project: { presence: "value", value: "Improve cathode cycling stability", provenance: "user" },
    challenge: { presence: "omitted" },
    requiredConcepts: [],
    preferredConcepts: [],
    exclusions: [],
    methods: [],
    selectedSenseConcepts: [],
    ...overrides,
  };
}

function candidate(id: string, overrides: Partial<ScreenCandidate> = {}): ScreenCandidate {
  return {
    id,
    title: `Title for ${id}`,
    abstract: `Abstract text for ${id}.`,
    venue: "Test Venue",
    ...overrides,
  };
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

/** The RAW Jev wire-response shape (what Jev's endpoint returns and `jev-contract.ts` validates). */
function okWireBody() {
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
        legend: { "0": "a", "1": "b", "2": "c", "3": "d" },
        probabilities: { "0": 0.05, "1": 0.05, "2": 0.8, "3": 0.1 },
        confidence: 0.8,
      },
    },
    usage: { input_tokens: 40, output_tokens: 0 },
  };
}

/** The title Peer sent to Jev for this call (the wire request carries paper content, never the paper id). */
function titleSent(init: RequestInit): string {
  const body = JSON.parse(String(init.body)) as { state?: { paper?: { title?: string } } };
  return body.state?.paper?.title ?? "";
}

/** Records every get/set call; never throws; never actually stores unless asked to via `hits`. */
class RecordingCache implements DecisionCache {
  getCalls: string[] = [];
  setCalls: Array<{ key: string; result: DecisionResult }> = [];
  constructor(private readonly hits = new Map<string, DecisionResult>()) {}
  async get(key: string): Promise<DecisionResult | null> {
    this.getCalls.push(key);
    return this.hits.get(key) ?? null;
  }
  async set(key: string, result: DecisionResult): Promise<void> {
    this.setCalls.push({ key, result });
  }
}

/** Always answers a hit with the same canned result, regardless of key. */
class AlwaysHitCache implements DecisionCache {
  getCalls: string[] = [];
  setCalls = 0;
  constructor(private readonly result: (key: string) => DecisionResult) {}
  async get(key: string): Promise<DecisionResult | null> {
    this.getCalls.push(key);
    return this.result(key);
  }
  async set(): Promise<void> {
    this.setCalls += 1;
  }
}

function baseOptions(overrides: Partial<ScreenOptions> = {}): ScreenOptions {
  return {
    ownerId: "owner-a",
    apiKey: API_KEY,
    intent: makeIntent(),
    senseConcepts: [],
    candidates: [candidate("p1")],
    cache: new RecordingCache(),
    fetchImpl: vi.fn(async () => jsonResponse(200, okWireBody())),
    ...overrides,
  };
}

describe("screenWithJev — cache hit", () => {
  it("returns the cached decision, makes zero Jev calls and never writes the cache", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(200, okWireBody()));
    const cached: DecisionResult = {
      paperId: "p1",
      answers: [{ questionId: "project_help", kind: "score", value: 3, confidence: 0.9, unknown: false }],
      usage: null,
      modelId: "jev-1.13.0",
    };
    const cache = new AlwaysHitCache(() => cached);

    const { decisions, summary } = await screenWithJev(
      baseOptions({ cache, fetchImpl, candidates: [candidate("p1")] }),
    );

    expect(fetchImpl).not.toHaveBeenCalled();
    expect(cache.setCalls).toBe(0);
    expect(decisions.get("p1")).toEqual(cached);
    expect(summary.cacheHits).toBe(1);
    expect(summary.attempted).toBe(0);
    expect(summary.byStatus.cache_hit).toBe(1);
  });

  it("the cache key does not depend on whose key paid: two different keys read the same entries", async () => {
    const cacheA = new RecordingCache();
    const cacheB = new RecordingCache();

    await screenWithJev(baseOptions({ cache: cacheA, apiKey: API_KEY, candidates: [candidate("p1"), candidate("p2")] }));
    await screenWithJev(
      baseOptions({ cache: cacheB, apiKey: "a-different-invented-key-0000", candidates: [candidate("p1"), candidate("p2")] }),
    );

    expect(cacheA.getCalls).toEqual(cacheB.getCalls);
    expect(cacheA.getCalls.every((key) => !key.includes("key"))).toBe(true);
  });
});

describe("screenWithJev — cache miss", () => {
  it("ok: calls Jev once with the reader's key, returns the decision and writes it to the cache", async () => {
    const cache = new RecordingCache();
    let captured: HeadersInit | undefined;
    const fetchImpl = vi.fn(async (_url: string, init: RequestInit) => {
      captured = init.headers;
      return jsonResponse(200, okWireBody());
    });

    const { decisions, summary } = await screenWithJev(baseOptions({ cache, fetchImpl, candidates: [candidate("p1")] }));

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(new Headers(captured).get("authorization")).toBe(`Bearer ${API_KEY}`);
    expect(cache.setCalls).toHaveLength(1);
    expect(decisions.get("p1")).toMatchObject({ paperId: "p1", modelId: "jev-1.13.0" });
    expect(decisions.get("p1")?.answers.length).toBeGreaterThan(0);
    expect(summary.attempted).toBe(1);
    expect(summary.cacheHits).toBe(0);
    expect(summary.byStatus.ok).toBe(1);
  });

  it.each([
    ["unauthorized", 401, undefined],
    ["invalid_request", 422, undefined],
    ["bad_json", 200, "not json"],
  ])("%s: one Jev attempt, no decision, nothing cached", async (expectedStatus, httpStatus, rawBody) => {
    const cache = new RecordingCache();
    const fetchImpl = vi.fn(async () =>
      rawBody !== undefined ? new Response(rawBody, { status: httpStatus }) : jsonResponse(httpStatus, {}),
    );

    const { decisions, summary } = await screenWithJev(baseOptions({ cache, fetchImpl, candidates: [candidate("p1")] }));

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(cache.setCalls).toHaveLength(0);
    expect(decisions.size).toBe(0);
    expect(summary.byStatus[expectedStatus as keyof typeof summary.byStatus]).toBe(1);
  });

  it("invalid_response (malformed schema): no decision, nothing cached", async () => {
    const cache = new RecordingCache();
    const fetchImpl = vi.fn(async () =>
      jsonResponse(200, { model: "wrong-model-id", answers: {}, usage: { input_tokens: 1, output_tokens: 0 } }),
    );

    const { decisions, summary } = await screenWithJev(baseOptions({ cache, fetchImpl }));

    expect(cache.setCalls).toHaveLength(0);
    expect(decisions.size).toBe(0);
    expect(summary.byStatus.invalid_response).toBe(1);
  });

  it("network_error (fetch rejects): no decision, nothing cached, no throw", async () => {
    const cache = new RecordingCache();
    const fetchImpl = vi.fn(async () => {
      throw new Error("ECONNRESET");
    });

    const { decisions, summary } = await screenWithJev(baseOptions({ cache, fetchImpl }));

    expect(cache.setCalls).toHaveLength(0);
    expect(decisions.size).toBe(0);
    expect(summary.byStatus.network_error).toBe(1);
  });

  it("a blank key makes no call at all: every candidate counts as network_error and nothing is cached", async () => {
    const cache = new RecordingCache();
    const fetchImpl = vi.fn(async () => jsonResponse(200, okWireBody()));

    const { decisions, summary } = await screenWithJev(
      baseOptions({ apiKey: "  ", cache, fetchImpl, candidates: [candidate("p1"), candidate("p2")] }),
    );

    expect(fetchImpl).not.toHaveBeenCalled();
    expect(cache.setCalls).toHaveLength(0);
    expect(decisions.size).toBe(0);
    expect(summary.byStatus.network_error).toBe(2);
  });

  it("mixed batch: the decisions are exactly the papers Jev answered, hits and fresh ones together", async () => {
    const hitDecision: DecisionResult = { paperId: "p1", answers: [], usage: null, modelId: "jev-1.13.0" };
    // p1 is a cache hit (the key is derived inside; answer the first lookup only).
    let firstLookup = true;
    const cache: DecisionCache = {
      get: async () => {
        if (firstLookup) {
          firstLookup = false;
          return hitDecision;
        }
        return null;
      },
      set: async () => {},
    };
    const fetchImpl = vi.fn(async (_url: string, init: RequestInit) =>
      titleSent(init).endsWith("p3") ? new Response("", { status: 500 }) : jsonResponse(200, okWireBody()),
    );

    const { decisions, summary } = await screenWithJev(
      baseOptions({
        cache,
        fetchImpl,
        concurrencyLimit: 1,
        candidates: [candidate("p1"), candidate("p2"), candidate("p3")],
      }),
    );

    expect([...decisions.keys()].sort()).toEqual(["p1", "p2"]);
    expect(summary.cacheHits).toBe(1);
    expect(summary.byStatus.ok).toBe(1);
    expect(summary.byStatus.network_error).toBe(1);
  });
});

describe("screenWithJev — stop at the first rejected key", () => {
  it("one candidate at a time: the first 401 stops the run after one call, and the rest are never started", async () => {
    const fetchImpl = vi.fn(async () => new Response("", { status: 401 }));
    const candidates = Array.from({ length: 10 }, (_, i) => candidate(`p${i}`));

    const { summary, decisions } = await screenWithJev(baseOptions({ fetchImpl, candidates, concurrencyLimit: 1 }));

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(summary.rejected).toBe(true);
    expect(summary.attempted).toBe(1);
    expect(summary.byStatus.unauthorized).toBe(1);
    expect(decisions.size).toBe(0);
  });

  it("at full concurrency a wrong key costs at most the calls already in flight (4), not 50", async () => {
    const fetchImpl = vi.fn(async () => new Response("", { status: 401 }));
    const candidates = Array.from({ length: 50 }, (_, i) => candidate(`p${i}`));

    const { summary } = await screenWithJev(baseOptions({ fetchImpl, candidates }));

    expect(fetchImpl.mock.calls.length).toBeLessThanOrEqual(4);
    expect(summary.rejected).toBe(true);
  });

  it("a run with no rejection reports rejected: false", async () => {
    const { summary } = await screenWithJev(baseOptions());
    expect(summary.rejected).toBe(false);
  });
});

describe("screenWithJev — stop after 3 throttled answers in a row", () => {
  it("three rate-limited candidates in a row stop the run; the rest are never started", async () => {
    vi.useFakeTimers();
    const fetchImpl = vi.fn(async () => new Response("", { status: 429 }));
    const candidates = Array.from({ length: 10 }, (_, i) => candidate(`p${i}`));

    const run = screenWithJev(baseOptions({ fetchImpl, candidates, concurrencyLimit: 1 }));
    await vi.advanceTimersByTimeAsync(15_000);
    const { summary } = await run;

    expect(summary.attempted).toBe(3);
    expect(summary.byStatus.rate_limited).toBe(3);
    expect(summary.throttled).toBe(true);
    expect(summary.rejected).toBe(false);
    // Each candidate makes the client's own bounded 3 attempts, so 3 candidates are 9 requests, not 30.
    expect(fetchImpl).toHaveBeenCalledTimes(9);
  });

  it("overloaded (529) counts the same way", async () => {
    vi.useFakeTimers();
    const fetchImpl = vi.fn(async () => new Response("", { status: 529 }));
    const candidates = Array.from({ length: 10 }, (_, i) => candidate(`p${i}`));

    const run = screenWithJev(baseOptions({ fetchImpl, candidates, concurrencyLimit: 1 }));
    await vi.advanceTimersByTimeAsync(15_000);
    const { summary } = await run;

    expect(summary.attempted).toBe(3);
    expect(summary.byStatus.overloaded).toBe(3);
    expect(summary.throttled).toBe(true);
  });

  it("an answer in between resets the count: throttled, throttled, ok, throttled, throttled is not a stop", async () => {
    vi.useFakeTimers();
    const throttledTitles = new Set(["Title for p0", "Title for p1", "Title for p3", "Title for p4"]);
    const fetchImpl = vi.fn(async (_url: string, init: RequestInit) =>
      throttledTitles.has(titleSent(init)) ? new Response("", { status: 429 }) : jsonResponse(200, okWireBody()),
    );
    const candidates = Array.from({ length: 5 }, (_, i) => candidate(`p${i}`));

    const run = screenWithJev(baseOptions({ fetchImpl, candidates, concurrencyLimit: 1 }));
    await vi.advanceTimersByTimeAsync(30_000);
    const { summary, decisions } = await run;

    expect(summary.attempted).toBe(5);
    expect(summary.throttled).toBe(false);
    expect(decisions.size).toBe(1);
  });

  it("a cache hit does not count as an answer for the throttle rule (it is not a call)", async () => {
    vi.useFakeTimers();
    // p1 is a hit; p0, p2, p3 are throttled: the hit between p0 and p2 must not reset the count.
    const cache: DecisionCache = {
      get: async () => null,
      set: async () => {},
    };
    let lookups = 0;
    cache.get = async () => {
      lookups += 1;
      return lookups === 2 ? { paperId: "p1", answers: [], usage: null, modelId: "jev-1.13.0" } : null;
    };
    const fetchImpl = vi.fn(async () => new Response("", { status: 429 }));
    const candidates = Array.from({ length: 6 }, (_, i) => candidate(`p${i}`));

    const run = screenWithJev(baseOptions({ cache, fetchImpl, candidates, concurrencyLimit: 1 }));
    await vi.advanceTimersByTimeAsync(15_000);
    const { summary } = await run;

    expect(summary.throttled).toBe(true);
    expect(summary.byStatus.rate_limited).toBe(3);
    expect(summary.cacheHits).toBe(1);
  });
});

describe("screenWithJev — the hard deadline", () => {
  it("the default is 20 seconds", () => {
    expect(SCREEN_DEADLINE_MS).toBe(20_000);
  });

  it("a hanging call does not hold the run past the deadline: it returns what has arrived", async () => {
    vi.useFakeTimers();
    // p0 and p1 answer; p2 hangs forever (a fetch that ignores its abort signal).
    const fetchImpl = vi.fn((_url: string, init: RequestInit) =>
      titleSent(init).endsWith("p2") ? new Promise<Response>(() => {}) : Promise.resolve(jsonResponse(200, okWireBody())),
    );
    const candidates = [candidate("p0"), candidate("p1"), candidate("p2"), candidate("p3")];

    let settled = false;
    const run = screenWithJev(baseOptions({ fetchImpl, candidates, concurrencyLimit: 1 })).then((result) => {
      settled = true;
      return result;
    });

    await vi.advanceTimersByTimeAsync(SCREEN_DEADLINE_MS - 1);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    const { decisions, summary } = await run;

    expect(settled).toBe(true);
    expect([...decisions.keys()].sort()).toEqual(["p0", "p1"]);
    expect(summary.deadlineExceeded).toBe(true);
    expect(summary.byStatus.ok).toBe(2);
    // p3 was never started: the run stops starting candidates once the deadline passes.
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it("an answer that arrives after the deadline cannot change the returned result", async () => {
    vi.useFakeTimers();
    let release: (response: Response) => void = () => {};
    const slow = new Promise<Response>((resolve) => {
      release = resolve;
    });
    const fetchImpl = vi.fn(() => slow);
    const cache = new RecordingCache();

    const run = screenWithJev(baseOptions({ cache, fetchImpl, deadlineMs: 1_000 }));
    await vi.advanceTimersByTimeAsync(1_000);
    const result = await run;
    expect(result.decisions.size).toBe(0);
    expect(result.summary.deadlineExceeded).toBe(true);
    const frozenSummary = JSON.stringify(result.summary);

    release(jsonResponse(200, okWireBody()));
    await vi.advanceTimersByTimeAsync(10);

    expect(result.decisions.size).toBe(0);
    expect(JSON.stringify(result.summary)).toBe(frozenSummary);
  });

  it("a run that finishes in time does not report deadlineExceeded and leaves no timer behind", async () => {
    vi.useFakeTimers();
    const run = screenWithJev(baseOptions({ candidates: [candidate("p1"), candidate("p2")] }));
    const { summary } = await run;

    expect(summary.deadlineExceeded).toBe(false);
    expect(summary.attempted).toBe(2);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("an explicit smaller deadline is honoured", async () => {
    vi.useFakeTimers();
    const fetchImpl = vi.fn(() => new Promise<Response>(() => {}));

    const run = screenWithJev(baseOptions({ fetchImpl, deadlineMs: 250 }));
    await vi.advanceTimersByTimeAsync(250);
    const { summary } = await run;

    expect(summary.deadlineExceeded).toBe(true);
  });
});

describe("screenWithJev — concurrency", () => {
  function slowCache(counters: { max: number }): DecisionCache {
    let inFlight = 0;
    return {
      get: async () => {
        inFlight += 1;
        counters.max = Math.max(counters.max, inFlight);
        await new Promise((resolve) => setTimeout(resolve, 15));
        inFlight -= 1;
        return null;
      },
      set: async () => {},
    };
  }

  it("never runs more than the requested limit at once", async () => {
    const counters = { max: 0 };
    const candidates = Array.from({ length: 12 }, (_, i) => candidate(`p${i}`));

    await screenWithJev(baseOptions({ cache: slowCache(counters), candidates, concurrencyLimit: 4 }));

    expect(counters.max).toBeLessThanOrEqual(4);
    expect(counters.max).toBeGreaterThan(1); // proves real overlap happened, not accidental serialization
  });

  it("clamps a caller-requested limit above 4 down to the hard ceiling of 4", async () => {
    const counters = { max: 0 };
    const candidates = Array.from({ length: 12 }, (_, i) => candidate(`p${i}`));

    await screenWithJev(baseOptions({ cache: slowCache(counters), candidates, concurrencyLimit: 10 }));

    expect(counters.max).toBeLessThanOrEqual(4);
  });
});

describe("screenWithJev — never throws", () => {
  it("survives a cache whose get() throws — degrades to a miss and still asks Jev", async () => {
    const cache: DecisionCache = {
      get: async () => {
        throw new Error("cache outage");
      },
      set: async () => {},
    };
    const fetchImpl = vi.fn(async () => jsonResponse(200, okWireBody()));

    const { decisions } = await screenWithJev(baseOptions({ cache, fetchImpl }));

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(decisions.size).toBe(1);
  });

  it("survives a cache whose set() throws on an ok result — the decision is still returned", async () => {
    const cache: DecisionCache = {
      get: async () => null,
      set: async () => {
        throw new Error("cache write outage");
      },
    };

    const { decisions, summary } = await screenWithJev(baseOptions({ cache }));

    expect(summary.byStatus.ok).toBe(1);
    expect(decisions.size).toBe(1);
  });

  it("survives a synchronously-throwing fetchImpl", async () => {
    const fetchImpl = vi.fn(() => {
      throw new Error("network is down");
    }) as unknown as ScreenOptions["fetchImpl"];

    await expect(screenWithJev(baseOptions({ fetchImpl }))).resolves.toBeDefined();
  });

  it("never throws across a whole batch mixing hits, misses and every fault kind", async () => {
    let call = 0;
    const cache: DecisionCache = {
      get: async (key) => (key.endsWith("HIT") ? { paperId: "hit", answers: [], usage: null, modelId: "" } : null),
      set: async () => {},
    };
    const fetchImpl = vi.fn(async () => {
      call += 1;
      if (call === 1) throw new Error("boom");
      if (call === 2) return jsonResponse(422, {});
      return jsonResponse(200, okWireBody());
    });
    const candidates = [candidate("p1"), candidate("p2"), candidate("p3")];

    await expect(screenWithJev(baseOptions({ cache, fetchImpl, candidates }))).resolves.toBeDefined();
  });

  it("an empty candidate list returns an empty result with no calls", async () => {
    const fetchImpl = vi.fn();
    const { decisions, summary } = await screenWithJev(baseOptions({ candidates: [], fetchImpl }));
    expect(decisions.size).toBe(0);
    expect(summary.totalCandidates).toBe(0);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe("screenWithJev — candidate cap", () => {
  it("never sends more than 50 candidates to Jev even if handed more", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(200, okWireBody()));
    const candidates = Array.from({ length: 65 }, (_, i) => candidate(`p${i}`));

    const { summary, decisions } = await screenWithJev(baseOptions({ fetchImpl, candidates }));

    expect(MAX_SCREEN_CANDIDATES).toBe(50);
    expect(summary.totalCandidates).toBe(50);
    expect(fetchImpl).toHaveBeenCalledTimes(50);
    expect(decisions.size).toBe(50);
  });
});

describe("screenWithJev — the key never leaves the call", () => {
  it("is in no decision, no cache key or payload, no summary and no log line, whichever way the calls go", async () => {
    const cache = new RecordingCache();
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const fetchImpl = vi.fn(async (_url: string, init: RequestInit) => {
      const title = titleSent(init);
      if (title.endsWith("p1")) throw new Error(`socket closed for ${API_KEY}`);
      if (title.endsWith("p2")) return new Response("", { status: 422 });
      return jsonResponse(200, okWireBody());
    });

    const { decisions, summary } = await screenWithJev(
      baseOptions({ cache, fetchImpl, candidates: [candidate("p0"), candidate("p1"), candidate("p2"), candidate("p3")] }),
    );

    expect(JSON.stringify([...decisions])).not.toContain(API_KEY);
    expect(JSON.stringify(summary)).not.toContain(API_KEY);
    expect(JSON.stringify(cache.setCalls)).not.toContain(API_KEY);
    expect(JSON.stringify(cache.getCalls)).not.toContain(API_KEY);
    const logged = [...logSpy.mock.calls, ...warnSpy.mock.calls, ...errorSpy.mock.calls].map((args) => args.join(" "));
    expect(logged.length).toBeGreaterThan(0); // the per-candidate usage line is real
    for (const line of logged) expect(line).not.toContain(API_KEY);
  });
});

describe("screenWithJev — nothing company-funded is left in the runner", () => {
  it("its summary names no broker, counter store, cap, entitlement or fallback", async () => {
    const { summary } = await screenWithJev(baseOptions({ candidates: [candidate("p1"), candidate("p2")] }));

    expect(Object.keys(summary).sort()).toEqual(
      ["attempted", "byStatus", "cacheHits", "deadlineExceeded", "rejected", "throttled", "totalCandidates"].sort(),
    );
  });
});

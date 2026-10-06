import { afterEach, describe, expect, it, vi } from "vitest";
import { FEED_INTENT_VERSION, type NormalizedFeedIntent } from "@/lib/feed/intent";
import type { DecisionCache } from "./decision-cache";
import type { DecisionResult } from "./types";
import { runJevShadow, type ShadowCandidate, type ShadowRunnerOptions } from "./shadow";

// The per-candidate Jev runner, on the READER'S key. `runJevShadow` takes the
// key as an option, calls Jev directly (no broker, no company budget, no
// Gemini fallback) and returns counts only. It is not called by the feed route
// in this commit; the next commit makes the route use it. Rewritten from the
// company-key version: the broker, entitlement, counter-store and Gemini-fallback
// cases are gone with those behaviours (the owner cut that path on 2026-10-06);
// the cache, deadline, concurrency, never-throws and candidate-cap cases are
// kept, now against the direct client. Every network boundary is injected
// (`fetchImpl`) — no real HTTP.

// An invented string. It is not, and never was, a key.
const API_KEY = "jev-shadow-test-FAKE-KEY-do-not-use-1234567890abcdef";

afterEach(() => {
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

function candidate(id: string, overrides: Partial<ShadowCandidate> = {}): ShadowCandidate {
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
  constructor(private readonly result: DecisionResult) {}
  async get(key: string): Promise<DecisionResult | null> {
    this.getCalls.push(key);
    return this.result;
  }
  async set(): Promise<void> {
    this.setCalls += 1;
  }
}

function baseShadowOptions(overrides: Partial<ShadowRunnerOptions> = {}): ShadowRunnerOptions {
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

describe("runJevShadow — cache hit", () => {
  it("zero Jev calls and cache.set never called", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(200, okWireBody()));
    const cachedResult: DecisionResult = { paperId: "p1", answers: [], usage: null, modelId: "jev-1.13.0" };
    const cache = new AlwaysHitCache(cachedResult);

    const summary = await runJevShadow(baseShadowOptions({ cache, fetchImpl, candidates: [candidate("p1")] }));

    expect(fetchImpl).not.toHaveBeenCalled();
    expect(cache.setCalls).toBe(0);
    expect(summary.cacheHits).toBe(1);
    expect(summary.attempted).toBe(0);
    expect(summary.byStatus.cache_hit).toBe(1);
  });
});

describe("runJevShadow — cache miss", () => {
  it("ok: calls Jev exactly once with the reader's key and writes the validated result to the cache", async () => {
    const cache = new RecordingCache();
    let captured: HeadersInit | undefined;
    const fetchImpl = vi.fn(async (_url: string, init: RequestInit) => {
      captured = init.headers;
      return jsonResponse(200, okWireBody());
    });

    const summary = await runJevShadow(baseShadowOptions({ cache, fetchImpl, candidates: [candidate("p1")] }));

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(new Headers(captured).get("authorization")).toBe(`Bearer ${API_KEY}`);
    expect(cache.setCalls).toHaveLength(1);
    expect(cache.setCalls[0]?.result).toMatchObject({ paperId: "p1", modelId: "jev-1.13.0" });
    expect(summary.attempted).toBe(1);
    expect(summary.cacheHits).toBe(0);
    expect(summary.byStatus.ok).toBe(1);
  });

  it("the key reaches the cache payload, the cache key, the summary and the log lines in no form", async () => {
    const cache = new RecordingCache();
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const summary = await runJevShadow(baseShadowOptions({ cache, candidates: [candidate("p1"), candidate("p2")] }));

    expect(JSON.stringify(cache.setCalls)).not.toContain(API_KEY);
    expect(JSON.stringify(cache.getCalls)).not.toContain(API_KEY);
    expect(JSON.stringify(summary)).not.toContain(API_KEY);
    const logged = [...logSpy.mock.calls, ...warnSpy.mock.calls, ...errorSpy.mock.calls].map((args) => args.join(" "));
    expect(logged.length).toBeGreaterThan(0); // the per-candidate usage line is real
    for (const line of logged) expect(line).not.toContain(API_KEY);
  });

  it.each([
    ["unauthorized", 401, undefined],
    ["invalid_request", 422, undefined],
    ["bad_json", 200, "not json"],
  ])("%s: one Jev attempt, nothing cached", async (expectedStatus, httpStatus, rawBody) => {
    const cache = new RecordingCache();
    const fetchImpl = vi.fn(async () =>
      rawBody !== undefined ? new Response(rawBody, { status: httpStatus }) : jsonResponse(httpStatus, {}),
    );

    const summary = await runJevShadow(baseShadowOptions({ cache, fetchImpl, candidates: [candidate("p1")] }));

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(cache.setCalls).toHaveLength(0);
    expect(summary.byStatus[expectedStatus as keyof typeof summary.byStatus]).toBe(1);
  });

  it("invalid_response (malformed schema): nothing cached", async () => {
    const cache = new RecordingCache();
    const fetchImpl = vi.fn(async () =>
      jsonResponse(200, { model: "wrong-model-id", answers: {}, usage: { input_tokens: 1, output_tokens: 0 } }),
    );

    const summary = await runJevShadow(baseShadowOptions({ cache, fetchImpl, candidates: [candidate("p1")] }));

    expect(cache.setCalls).toHaveLength(0);
    expect(summary.byStatus.invalid_response).toBe(1);
  });

  it("network_error (fetch rejects): nothing cached, no throw", async () => {
    const cache = new RecordingCache();
    const fetchImpl = vi.fn(async () => {
      throw new Error("ECONNRESET");
    });

    const summary = await runJevShadow(baseShadowOptions({ cache, fetchImpl, candidates: [candidate("p1")] }));

    expect(cache.setCalls).toHaveLength(0);
    expect(summary.byStatus.network_error).toBe(1);
  });

  it("a blank key makes no call at all: every candidate counts as network_error and nothing is cached", async () => {
    const cache = new RecordingCache();
    const fetchImpl = vi.fn(async () => jsonResponse(200, okWireBody()));

    const summary = await runJevShadow(
      baseShadowOptions({ apiKey: "  ", cache, fetchImpl, candidates: [candidate("p1"), candidate("p2")] }),
    );

    expect(fetchImpl).not.toHaveBeenCalled();
    expect(cache.setCalls).toHaveLength(0);
    expect(summary.byStatus.network_error).toBe(2);
  });
});

describe("runJevShadow — deadline", () => {
  it("stops starting new calls once the deadline passes; already-started calls still finish", async () => {
    // Serial (concurrencyLimit 1) so the deadline check is deterministic:
    // clock starts at 0, each call advances it by 100ms via a side effect
    // inside fetchImpl, and the deadline is 250ms — so candidates 1-3 start
    // (clock 0, 100, 200 all < 250) and candidate 4 never starts (clock
    // reaches 300 before that check, which is >= 250).
    let currentMs = 0;
    const clock = () => new Date(currentMs);
    const cache = new RecordingCache();
    const fetchImpl = vi.fn(async () => {
      currentMs += 100;
      return jsonResponse(200, okWireBody());
    });
    const candidates = [candidate("p1"), candidate("p2"), candidate("p3"), candidate("p4"), candidate("p5")];

    const summary = await runJevShadow(
      baseShadowOptions({ cache, fetchImpl, candidates, clock, concurrencyLimit: 1, deadlineMs: 250 }),
    );

    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(summary.deadlineExceeded).toBe(true);
    expect(summary.attempted).toBe(3);
  });

  it("does not report deadlineExceeded when every candidate finishes in time", async () => {
    const summary = await runJevShadow(
      baseShadowOptions({ candidates: [candidate("p1"), candidate("p2")], deadlineMs: 60_000 }),
    );

    expect(summary.deadlineExceeded).toBe(false);
    expect(summary.attempted).toBe(2);
  });
});

describe("runJevShadow — concurrency", () => {
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

    await runJevShadow(baseShadowOptions({ cache: slowCache(counters), candidates, concurrencyLimit: 4 }));

    expect(counters.max).toBeLessThanOrEqual(4);
    expect(counters.max).toBeGreaterThan(1); // proves real overlap happened, not accidental serialization
  });

  it("clamps a caller-requested limit above 4 down to the hard ceiling of 4", async () => {
    const counters = { max: 0 };
    const candidates = Array.from({ length: 12 }, (_, i) => candidate(`p${i}`));

    await runJevShadow(baseShadowOptions({ cache: slowCache(counters), candidates, concurrencyLimit: 10 }));

    expect(counters.max).toBeLessThanOrEqual(4);
  });
});

describe("runJevShadow — never throws", () => {
  it("survives a cache whose get() throws — degrades to a miss and still asks Jev", async () => {
    const cache: DecisionCache = {
      get: async () => {
        throw new Error("cache outage");
      },
      set: async () => {},
    };
    const fetchImpl = vi.fn(async () => jsonResponse(200, okWireBody()));

    await expect(runJevShadow(baseShadowOptions({ cache, fetchImpl }))).resolves.toBeDefined();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("survives a cache whose set() throws on an ok result — the call itself still counts as ok", async () => {
    const cache: DecisionCache = {
      get: async () => null,
      set: async () => {
        throw new Error("cache write outage");
      },
    };

    const summary = await runJevShadow(baseShadowOptions({ cache }));

    expect(summary.byStatus.ok).toBe(1);
  });

  it("survives a synchronously-throwing fetchImpl", async () => {
    const fetchImpl = vi.fn(() => {
      throw new Error("network is down");
    }) as unknown as ShadowRunnerOptions["fetchImpl"];

    await expect(runJevShadow(baseShadowOptions({ fetchImpl }))).resolves.toBeDefined();
  });

  it("never throws across a whole batch mixing hits, misses, and every fault kind", async () => {
    let call = 0;
    const cache: DecisionCache = {
      get: async (key) => (key.endsWith("HIT") ? { paperId: "hit", answers: [], usage: null, modelId: "" } : null),
      set: async () => {},
    };
    const fetchImpl = vi.fn(async () => {
      call += 1;
      if (call === 1) throw new Error("boom");
      if (call === 2) return jsonResponse(401, {});
      return jsonResponse(200, okWireBody());
    });
    const candidates = [candidate("p1"), candidate("p2"), candidate("p3")];

    await expect(runJevShadow(baseShadowOptions({ cache, fetchImpl, candidates }))).resolves.toBeDefined();
  });
});

describe("runJevShadow — candidate cap", () => {
  it("never sends more than 50 candidates to Jev even if handed more", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(200, okWireBody()));
    const candidates = Array.from({ length: 65 }, (_, i) => candidate(`p${i}`));

    const summary = await runJevShadow(baseShadowOptions({ fetchImpl, candidates }));

    expect(summary.totalCandidates).toBe(50);
    expect(fetchImpl).toHaveBeenCalledTimes(50);
  });
});

describe("runJevShadow — nothing company-funded is left in the runner", () => {
  it("its summary and options name no broker, counter store, cap, entitlement or fallback", async () => {
    const summary = await runJevShadow(baseShadowOptions({ candidates: [candidate("p1"), candidate("p2"), candidate("p3")] }));

    expect(Object.keys(summary).sort()).toEqual(
      ["attempted", "byStatus", "cacheHits", "deadlineExceeded", "totalCandidates"].sort(),
    );
  });
});

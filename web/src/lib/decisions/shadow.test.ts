import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FEED_INTENT_VERSION, type NormalizedFeedIntent } from "@/lib/feed/intent";
import { InMemoryCounterStore } from "@/lib/usage/counters";
import type { DecisionCache } from "./decision-cache";
import { mintGeminiFallbackProviderCapability, type SourcedDecisionAnswer } from "./gemini-fallback";
import type { DecisionResult } from "./types";
import { runJevShadow, type ShadowCandidate, type ShadowRunnerOptions } from "./shadow";

// P3-S5 — ABC-JEV-INTEGRATION.md §4 Round 3 "P3-S5 DESIGN RULING"
// (2026-09-24T11:29:31Z): the bounded-concurrency shadow runner. Runs AFTER
// the response (route.ts schedules it via `after()`), so it must never throw
// and must never let a slow/failing candidate block the others past the
// concurrency limit or the overall deadline. Every network boundary here is
// injected (`fetchImpl`) — no real HTTP, per the campaign's no-network rule.

const NOW = new Date("2026-09-24T12:00:00.000Z");
const BROKER_URL = "https://example.supabase.co/functions/v1/jev-broker";
const BROKER_SECRET = "broker-test-FAKE-SECRET-do-not-use";

// `callJevViaBroker` (broker-client.ts) itself reads `PEER_JEV_BROKER`
// directly and short-circuits to `{status: "disabled"}` before anything
// else when it isn't the literal "on" — in production route.ts's own gating
// already guarantees this is "on" before the hook is ever scheduled
// (flag.test.ts/route.test.ts cover that), but this module's own tests
// exercise `runJevShadow` directly and must set it themselves to reach the
// reservation/fetch code paths under test.
beforeEach(() => {
  vi.stubEnv("PEER_JEV_BROKER", "on");
});
afterEach(() => {
  vi.unstubAllEnvs();
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

function okBody(overrides: Record<string, unknown> = {}) {
  return {
    status: "ok",
    modelId: "jev-1.13.0",
    answers: [{ questionId: "project_help", kind: "score", value: 2, confidence: 0.8, unknown: false }],
    usage: { inputTokens: 40, outputTokens: 0, latencyMs: 9 },
    ...overrides,
  };
}

// P3-S6 — the bounded Gemini decision fallback's own fixtures. A default
// candidate (`makeIntent()`, no sense concepts, no methods) always asks
// exactly `["core_vs_background", "project_help"]` (rubric.ts's
// `selectQuestionsForRequest`), so these fixtures cover those two ids.

/** A Jev "ok" result where `project_help` came back `unknown` (low confidence) — the ONE condition that may trigger the fallback. */
function okBodyWithUnknownProjectHelp(overrides: Record<string, unknown> = {}) {
  return okBody({
    answers: [
      { questionId: "core_vs_background", kind: "choice", value: "core", confidence: 0.9, unknown: false },
      { questionId: "project_help", kind: "score", value: 1, confidence: 0.3, unknown: true },
    ],
    ...overrides,
  });
}

/** A Jev "ok" result that is confidently negative but NOT unknown — must never trigger the fallback (no near-threshold trigger). */
function okBodyConfidentlyNegative() {
  return okBody({
    answers: [
      { questionId: "core_vs_background", kind: "choice", value: "background", confidence: 0.97, unknown: false },
      { questionId: "project_help", kind: "score", value: 0, confidence: 0.95, unknown: false },
    ],
  });
}

/** A validator-shaped `generateJsonText` reply answering exactly `project_help`. */
function fallbackAnswerJsonForProjectHelp(): string {
  return JSON.stringify({
    answers: {
      project_help: {
        type: "score",
        score: 3,
        legend: { "0": "a", "1": "b", "2": "c", "3": "d" },
        probabilities: { "0": 0.05, "1": 0.05, "2": 0.1, "3": 0.8 },
        confidence: 0.85,
      },
    },
    usage: { input_tokens: 30, output_tokens: 0 },
  });
}

/** A validator-shaped `generateJsonText` reply for `project_help` with a strongly NEGATIVE, non-unknown answer — used by the protective "never filters a candidate" test. */
function fallbackAnswerJsonStronglyNegative(): string {
  return JSON.stringify({
    answers: {
      project_help: {
        type: "score",
        score: 0,
        legend: { "0": "a", "1": "b", "2": "c", "3": "d" },
        probabilities: { "0": 0.97, "1": 0.02, "2": 0.005, "3": 0.005 },
        confidence: 0.97,
      },
    },
    usage: { input_tokens: 30, output_tokens: 0 },
  });
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
    entitled: true,
    intent: makeIntent(),
    senseConcepts: [],
    candidates: [candidate("p1")],
    cache: new RecordingCache(),
    // JEV-DIRECT (§1aa): every existing test below re-runs unchanged with the
    // broker transport by default (this beforeEach already sets
    // PEER_JEV_BROKER="on") — the new "direct transport" describe block near
    // the end of this file overrides `transport` to re-run the same
    // eligibility/cache/deadline/concurrency/gemini-fallback-merge table
    // against the direct path instead (RED list F5).
    transport: "broker",
    brokerUrl: BROKER_URL,
    brokerSecret: BROKER_SECRET,
    perUserCap: 100,
    globalCap: 1000,
    store: new InMemoryCounterStore(),
    now: NOW,
    fetchImpl: vi.fn(async () => jsonResponse(200, okBody())),
    ...overrides,
  };
}

describe("runJevShadow — cache hit", () => {
  it("zero reservations, zero broker calls, cache.set never called", async () => {
    const store = new InMemoryCounterStore();
    const incrementSpy = vi.spyOn(store, "increment");
    const fetchImpl = vi.fn(async () => jsonResponse(200, okBody()));
    const cachedResult: DecisionResult = { paperId: "p1", answers: [], usage: null, modelId: "jev-1.13.0" };
    const cache = new AlwaysHitCache(cachedResult);

    const summary = await runJevShadow(
      baseShadowOptions({ cache, fetchImpl, store, candidates: [candidate("p1")] }),
    );

    expect(fetchImpl).not.toHaveBeenCalled();
    expect(incrementSpy).not.toHaveBeenCalled();
    expect(cache.setCalls).toBe(0);
    expect(summary.cacheHits).toBe(1);
    expect(summary.attempted).toBe(0);
    expect(summary.byStatus.cache_hit).toBe(1);
  });
});

describe("runJevShadow — cache miss", () => {
  it("ok: calls the broker exactly once and writes the validated result to the cache", async () => {
    const cache = new RecordingCache();
    const fetchImpl = vi.fn(async () => jsonResponse(200, okBody({ modelId: "jev-1.13.0" })));

    const summary = await runJevShadow(
      baseShadowOptions({ cache, fetchImpl, candidates: [candidate("p1")] }),
    );

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(cache.setCalls).toHaveLength(1);
    expect(cache.setCalls[0]?.result).toMatchObject({ paperId: "p1", modelId: "jev-1.13.0" });
    expect(summary.attempted).toBe(1);
    expect(summary.cacheHits).toBe(0);
    expect(summary.byStatus.ok).toBe(1);
  });

  it.each([
    ["unauthorized", 401, undefined],
    ["rate_limited", 429, undefined],
    ["bad_json", 200, "not json"],
  ])("%s: one broker attempt, nothing cached", async (expectedStatus, httpStatus, rawBody) => {
    const cache = new RecordingCache();
    const fetchImpl = vi.fn(async () =>
      rawBody !== undefined
        ? new Response(rawBody, { status: httpStatus })
        : jsonResponse(httpStatus, {}),
    );

    const summary = await runJevShadow(
      baseShadowOptions({ cache, fetchImpl, candidates: [candidate("p1")] }),
    );

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(cache.setCalls).toHaveLength(0);
    expect(summary.byStatus[expectedStatus as keyof typeof summary.byStatus]).toBe(1);
  });

  it("invalid_response (malformed schema): nothing cached", async () => {
    const cache = new RecordingCache();
    // Missing required "usage" -> jev-contract.ts's validator rejects it.
    const fetchImpl = vi.fn(async () =>
      jsonResponse(200, { status: "ok", modelId: "jev-1.13.0", answers: [] }),
    );

    const summary = await runJevShadow(
      baseShadowOptions({ cache, fetchImpl, candidates: [candidate("p1")] }),
    );

    expect(cache.setCalls).toHaveLength(0);
    expect(summary.byStatus.invalid_response).toBe(1);
  });

  it("network_error (fetch rejects): nothing cached, no throw", async () => {
    const cache = new RecordingCache();
    const fetchImpl = vi.fn(async () => {
      throw new Error("ECONNRESET");
    });

    const summary = await runJevShadow(
      baseShadowOptions({ cache, fetchImpl, candidates: [candidate("p1")] }),
    );

    expect(cache.setCalls).toHaveLength(0);
    expect(summary.byStatus.network_error).toBe(1);
  });
});

describe("runJevShadow — entitlement", () => {
  it("not_entitled: zero counter increments, zero broker fetch, nothing cached", async () => {
    const store = new InMemoryCounterStore();
    const incrementSpy = vi.spyOn(store, "increment");
    const cache = new RecordingCache();
    const fetchImpl = vi.fn(async () => jsonResponse(200, okBody()));

    const summary = await runJevShadow(
      baseShadowOptions({ entitled: false, store, cache, fetchImpl, candidates: [candidate("p1")] }),
    );

    expect(incrementSpy).not.toHaveBeenCalled();
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(cache.setCalls).toHaveLength(0);
    expect(summary.byStatus.not_entitled).toBe(1);
  });
});

describe("runJevShadow — deadline", () => {
  it("stops starting new calls once the deadline passes; already-started calls still finish", async () => {
    // Serial (concurrencyLimit 1) so the deadline check is deterministic:
    // clock starts at 0, each broker call advances it by 100ms via a side
    // effect inside fetchImpl, and the deadline is 250ms — so candidates 1-3
    // start (clock 0, 100, 200 all < 250) and candidate 4 never starts
    // (clock reaches 300 before that check, which is >= 250).
    let currentMs = 0;
    const clock = () => new Date(currentMs);
    const cache = new RecordingCache();
    const fetchImpl = vi.fn(async () => {
      currentMs += 100;
      return jsonResponse(200, okBody());
    });
    const candidates = [candidate("p1"), candidate("p2"), candidate("p3"), candidate("p4"), candidate("p5")];

    const summary = await runJevShadow(
      baseShadowOptions({
        cache,
        fetchImpl,
        candidates,
        clock,
        concurrencyLimit: 1,
        deadlineMs: 250,
      }),
    );

    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(summary.deadlineExceeded).toBe(true);
    expect(summary.attempted).toBe(3);
  });

  it("does not report deadlineExceeded when every candidate finishes in time", async () => {
    const cache = new RecordingCache();
    const fetchImpl = vi.fn(async () => jsonResponse(200, okBody()));

    const summary = await runJevShadow(
      baseShadowOptions({
        cache,
        fetchImpl,
        candidates: [candidate("p1"), candidate("p2")],
        deadlineMs: 60_000,
      }),
    );

    expect(summary.deadlineExceeded).toBe(false);
    expect(summary.attempted).toBe(2);
  });
});

describe("runJevShadow — concurrency", () => {
  it("never runs more than the requested limit at once", async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const cache: DecisionCache = {
      get: async () => {
        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await new Promise((resolve) => setTimeout(resolve, 15));
        inFlight -= 1;
        return null;
      },
      set: async () => {},
    };
    const fetchImpl = vi.fn(async () => jsonResponse(200, okBody()));
    const candidates = Array.from({ length: 12 }, (_, i) => candidate(`p${i}`));

    await runJevShadow(baseShadowOptions({ cache, fetchImpl, candidates, concurrencyLimit: 4 }));

    expect(maxInFlight).toBeLessThanOrEqual(4);
    expect(maxInFlight).toBeGreaterThan(1); // proves real overlap happened, not accidental serialization
  });

  it("clamps a caller-requested limit above 4 down to the hard ceiling of 4", async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const cache: DecisionCache = {
      get: async () => {
        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await new Promise((resolve) => setTimeout(resolve, 15));
        inFlight -= 1;
        return null;
      },
      set: async () => {},
    };
    const fetchImpl = vi.fn(async () => jsonResponse(200, okBody()));
    const candidates = Array.from({ length: 12 }, (_, i) => candidate(`p${i}`));

    await runJevShadow(baseShadowOptions({ cache, fetchImpl, candidates, concurrencyLimit: 10 }));

    expect(maxInFlight).toBeLessThanOrEqual(4);
  });
});

describe("runJevShadow — never throws", () => {
  it("survives a cache whose get() throws — degrades to a miss and still tries the broker", async () => {
    const cache: DecisionCache = {
      get: async () => {
        throw new Error("cache outage");
      },
      set: async () => {},
    };
    const fetchImpl = vi.fn(async () => jsonResponse(200, okBody()));

    await expect(
      runJevShadow(baseShadowOptions({ cache, fetchImpl, candidates: [candidate("p1")] })),
    ).resolves.toBeDefined();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("survives a cache whose set() throws on an ok result — the call itself still counts as ok", async () => {
    const cache: DecisionCache = {
      get: async () => null,
      set: async () => {
        throw new Error("cache write outage");
      },
    };

    const summary = await runJevShadow(baseShadowOptions({ cache, candidates: [candidate("p1")] }));

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
      return jsonResponse(200, okBody());
    });
    const candidates = [candidate("p1"), candidate("p2"), candidate("p3")];

    await expect(
      runJevShadow(baseShadowOptions({ cache, fetchImpl, candidates })),
    ).resolves.toBeDefined();
  });
});

describe("runJevShadow — candidate cap", () => {
  it("never sends more than 50 candidates to the broker even if handed more", async () => {
    const cache = new RecordingCache();
    const fetchImpl = vi.fn(async () => jsonResponse(200, okBody()));
    const candidates = Array.from({ length: 65 }, (_, i) => candidate(`p${i}`));

    const summary = await runJevShadow(baseShadowOptions({ cache, fetchImpl, candidates }));

    expect(summary.totalCandidates).toBe(50);
    expect(fetchImpl).toHaveBeenCalledTimes(50);
  });
});

// ---------------------------------------------------------------------------
// P3-S6 — the bounded Gemini decision fallback's wiring into the shadow
// runner (ABC-JEV-INTEGRATION.md §4 "P3-S6 RULING", 2026-09-24T14:35:58Z;
// §1p.H(5)). Trigger conditions (ALL required): the outer Jev call was
// `ok` AND at least one answer came back `unknown` AND `PEER_JEV_GEMINI_FALLBACK`
// is literally "on" AND a `geminiFallbackProvider` capability was supplied.
// Never on a Jev fault/refusal, never near-threshold (score proximity is
// never consulted). Respects <=5 fallback calls across the WHOLE run.
// ---------------------------------------------------------------------------

describe("runJevShadow — gemini fallback is structurally unreachable today", () => {
  it("route.ts's real call site passes no geminiFallbackProvider field at all", () => {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const routeSource = readFileSync(path.join(here, "../../app/api/feed/route.ts"), "utf8");
    expect(routeSource).not.toMatch(/geminiFallbackProvider/);
    expect(routeSource).not.toMatch(/mintGeminiFallbackProviderCapability/);
    expect(routeSource).not.toMatch(/PEER_JEV_GEMINI_FALLBACK/);
  });

  it("mirrors route.ts's exact options shape (no geminiFallbackProvider key at all): the fallback never runs even with the flag on and an unknown Jev answer", async () => {
    vi.stubEnv("PEER_JEV_GEMINI_FALLBACK", "on");
    const cache = new RecordingCache();
    const fetchImpl = vi.fn(async () => jsonResponse(200, okBodyWithUnknownProjectHelp()));

    // Deliberately the SAME options shape `runJevShadowSafely` (route.ts)
    // actually passes today — no `geminiFallbackProvider` key present at all,
    // not even `undefined` explicitly written out.
    const options: ShadowRunnerOptions = {
      ownerId: "owner-a",
      entitled: true,
      intent: makeIntent(),
      senseConcepts: [],
      candidates: [candidate("p1")],
      cache,
      transport: "broker",
      brokerUrl: BROKER_URL,
      brokerSecret: BROKER_SECRET,
      perUserCap: 100,
      globalCap: 1000,
      store: new InMemoryCounterStore(),
      now: NOW,
      fetchImpl,
    };

    const summary = await runJevShadow(options);

    expect(summary.geminiFallback.attempted).toBe(0);
    const storedAnswers = (cache.setCalls[0]?.result.answers ?? []) as SourcedDecisionAnswer[];
    expect(storedAnswers.every((a) => a.source !== "gemini-fallback")).toBe(true);
  });
});

describe("runJevShadow — gemini fallback trigger conditions", () => {
  it("provider absent -> never calls the fallback, even with the flag on and an unknown answer", async () => {
    vi.stubEnv("PEER_JEV_GEMINI_FALLBACK", "on");
    const cache = new RecordingCache();
    const fetchImpl = vi.fn(async () => jsonResponse(200, okBodyWithUnknownProjectHelp()));

    const summary = await runJevShadow(
      baseShadowOptions({ cache, fetchImpl, candidates: [candidate("p1")] /* no geminiFallbackProvider */ }),
    );

    expect(summary.geminiFallback.attempted).toBe(0);
  });

  it("flag off -> never calls the fallback, even with a provider supplied and an unknown answer", async () => {
    // PEER_JEV_GEMINI_FALLBACK deliberately left unset/off for this test.
    const cache = new RecordingCache();
    const fetchImpl = vi.fn(async () => jsonResponse(200, okBodyWithUnknownProjectHelp()));
    const generateSpy = vi.fn(async () => fallbackAnswerJsonForProjectHelp());
    const provider = mintGeminiFallbackProviderCapability(generateSpy);

    const summary = await runJevShadow(
      baseShadowOptions({ cache, fetchImpl, candidates: [candidate("p1")], geminiFallbackProvider: provider }),
    );

    expect(generateSpy).not.toHaveBeenCalled();
    expect(summary.geminiFallback.attempted).toBe(0);
  });

  it("Jev fault (not ok) -> never calls the fallback, even with the flag on and a provider supplied", async () => {
    vi.stubEnv("PEER_JEV_GEMINI_FALLBACK", "on");
    const cache = new RecordingCache();
    const fetchImpl = vi.fn(async () => jsonResponse(401, {}));
    const generateSpy = vi.fn(async () => fallbackAnswerJsonForProjectHelp());
    const provider = mintGeminiFallbackProviderCapability(generateSpy);

    const summary = await runJevShadow(
      baseShadowOptions({ cache, fetchImpl, candidates: [candidate("p1")], geminiFallbackProvider: provider }),
    );

    expect(generateSpy).not.toHaveBeenCalled();
    expect(summary.byStatus.unauthorized).toBe(1);
    expect(summary.geminiFallback.attempted).toBe(0);
  });

  it("Jev refusal (reservation_refused / not_entitled) -> never calls the fallback", async () => {
    vi.stubEnv("PEER_JEV_GEMINI_FALLBACK", "on");
    const cache = new RecordingCache();
    const fetchImpl = vi.fn(async () => jsonResponse(200, okBodyWithUnknownProjectHelp()));
    const generateSpy = vi.fn(async () => fallbackAnswerJsonForProjectHelp());
    const provider = mintGeminiFallbackProviderCapability(generateSpy);

    const summary = await runJevShadow(
      baseShadowOptions({
        entitled: false,
        cache,
        fetchImpl,
        candidates: [candidate("p1")],
        geminiFallbackProvider: provider,
      }),
    );

    expect(generateSpy).not.toHaveBeenCalled();
    expect(summary.byStatus.not_entitled).toBe(1);
    expect(summary.geminiFallback.attempted).toBe(0);
  });

  it("ok with every answer confidently NOT unknown -> never calls the fallback (no near-threshold trigger)", async () => {
    vi.stubEnv("PEER_JEV_GEMINI_FALLBACK", "on");
    const cache = new RecordingCache();
    const fetchImpl = vi.fn(async () => jsonResponse(200, okBodyConfidentlyNegative()));
    const generateSpy = vi.fn(async () => fallbackAnswerJsonForProjectHelp());
    const provider = mintGeminiFallbackProviderCapability(generateSpy);

    const summary = await runJevShadow(
      baseShadowOptions({ cache, fetchImpl, candidates: [candidate("p1")], geminiFallbackProvider: provider }),
    );

    expect(generateSpy).not.toHaveBeenCalled();
    expect(summary.geminiFallback.attempted).toBe(0);
  });

  it("ok with an unknown answer, flag on, provider present -> calls the fallback with ONLY the unknown question id", async () => {
    vi.stubEnv("PEER_JEV_GEMINI_FALLBACK", "on");
    const cache = new RecordingCache();
    const fetchImpl = vi.fn(async () => jsonResponse(200, okBodyWithUnknownProjectHelp()));
    let capturedUserPrompt = "";
    const provider = mintGeminiFallbackProviderCapability(async (args) => {
      capturedUserPrompt = args.userPrompt;
      return fallbackAnswerJsonForProjectHelp();
    });

    const summary = await runJevShadow(
      baseShadowOptions({ cache, fetchImpl, candidates: [candidate("p1")], geminiFallbackProvider: provider }),
    );

    expect(summary.geminiFallback.attempted).toBe(1);
    expect(summary.geminiFallback.byStatus.ok).toBe(1);
    const parsedPrompt = JSON.parse(capturedUserPrompt) as { questions: Record<string, unknown> };
    expect(Object.keys(parsedPrompt.questions)).toEqual(["project_help"]);
  });
});

describe("runJevShadow — gemini fallback merges answers with their source", () => {
  it("caches the ok fallback answer tagged 'gemini-fallback', and the untouched Jev answer tagged 'jev'", async () => {
    vi.stubEnv("PEER_JEV_GEMINI_FALLBACK", "on");
    const cache = new RecordingCache();
    const fetchImpl = vi.fn(async () => jsonResponse(200, okBodyWithUnknownProjectHelp()));
    const provider = mintGeminiFallbackProviderCapability(async () => fallbackAnswerJsonForProjectHelp());

    await runJevShadow(
      baseShadowOptions({ cache, fetchImpl, candidates: [candidate("p1")], geminiFallbackProvider: provider }),
    );

    expect(cache.setCalls).toHaveLength(1);
    // The cached `DecisionResult.answers` is typed as plain `DecisionAnswer[]`
    // (decisions/types.ts, Edge-mirrored, never carries `source` in its own
    // type) — the actual stored data still carries `source` at runtime
    // (shadow.ts writes `SourcedDecisionAnswer[]`, which widens fine on
    // write), so reading it back for this assertion needs the wider type.
    const stored = (cache.setCalls[0]?.result.answers ?? []) as SourcedDecisionAnswer[];
    const coreAnswer = stored.find((a) => a.questionId === "core_vs_background");
    const helpAnswer = stored.find((a) => a.questionId === "project_help");
    expect(coreAnswer?.source).toBe("jev");
    expect(helpAnswer?.source).toBe("gemini-fallback");
    // the fallback's OWN answer value/confidence actually replaced the unknown Jev one
    expect(helpAnswer?.value).toBe(3);
    expect(helpAnswer?.unknown).toBe(false);
  });

  it("a malformed fallback response leaves the original unknown Jev answer in place, tagged 'jev', nothing gemini-sourced cached", async () => {
    vi.stubEnv("PEER_JEV_GEMINI_FALLBACK", "on");
    const cache = new RecordingCache();
    const fetchImpl = vi.fn(async () => jsonResponse(200, okBodyWithUnknownProjectHelp()));
    const provider = mintGeminiFallbackProviderCapability(async () => "not valid json at all");

    await runJevShadow(
      baseShadowOptions({ cache, fetchImpl, candidates: [candidate("p1")], geminiFallbackProvider: provider }),
    );

    expect(cache.setCalls).toHaveLength(1);
    const stored = (cache.setCalls[0]?.result.answers ?? []) as SourcedDecisionAnswer[];
    const helpAnswer = stored.find((a) => a.questionId === "project_help");
    expect(helpAnswer?.source).toBe("jev");
    expect(helpAnswer?.unknown).toBe(true);
    expect(stored.every((a) => a.source !== "gemini-fallback")).toBe(true);
  });
});

describe("runJevShadow — gemini fallback <=5-per-run cap", () => {
  it("never calls the fallback more than 5 times in one run, even when every candidate has an unknown answer", async () => {
    vi.stubEnv("PEER_JEV_GEMINI_FALLBACK", "on");
    const cache = new RecordingCache();
    const fetchImpl = vi.fn(async () => jsonResponse(200, okBodyWithUnknownProjectHelp()));
    const generateSpy = vi.fn(async () => fallbackAnswerJsonForProjectHelp());
    const provider = mintGeminiFallbackProviderCapability(generateSpy);
    const candidates = Array.from({ length: 8 }, (_, i) => candidate(`p${i}`));

    const summary = await runJevShadow(
      baseShadowOptions({ cache, fetchImpl, candidates, geminiFallbackProvider: provider }),
    );

    expect(generateSpy).toHaveBeenCalledTimes(5);
    expect(summary.geminiFallback.attempted).toBe(5);
  });
});

describe("runJevShadow — gemini fallback never filters a candidate (P3-S6 protective test)", () => {
  it("keeps every candidate counted even when every fallback answer is a strong negative", async () => {
    vi.stubEnv("PEER_JEV_GEMINI_FALLBACK", "on");
    const cache = new RecordingCache();
    const fetchImpl = vi.fn(async () => jsonResponse(200, okBodyWithUnknownProjectHelp()));
    const provider = mintGeminiFallbackProviderCapability(async () => fallbackAnswerJsonStronglyNegative());
    const candidates = [candidate("p1"), candidate("p2"), candidate("p3")];

    const summary = await runJevShadow(
      baseShadowOptions({ cache, fetchImpl, candidates, geminiFallbackProvider: provider }),
    );

    expect(summary.totalCandidates).toBe(3);
    expect(summary.attempted).toBe(3);
    expect(cache.setCalls).toHaveLength(3);
    // The runner's return value has no field that could carry a filtered
    // candidate list — shadow output is never read by the visible ranking.
    expect(Object.keys(summary).sort()).toEqual(
      ["attempted", "byStatus", "cacheHits", "deadlineExceeded", "geminiFallback", "totalCandidates"].sort(),
    );
  });
});

// ---------------------------------------------------------------------------
// JEV-DIRECT (§1aa) — RED list F5: "shadow.ts's existing eligibility/cache/
// deadline/concurrency/Gemini-fallback-merge test table re-run with
// transport 'direct' as well as 'broker' — same outcomes either way." Every
// case below is the SAME behaviour already proven for the broker transport
// above, re-run with `transport: "direct"` and `JEV_API_KEY` stubbed instead
// of the broker env/options — a representative subset of that table (not a
// line-for-line duplicate of every one of the ~30 cases above), chosen to
// cover each DIMENSION once: cache hit, cache miss ok, a fault status,
// entitlement, deadline, concurrency, and one gemini-fallback-merge case.
//
// IMPORTANT — a DIFFERENT fixture shape than `okBody()`/
// `okBodyWithUnknownProjectHelp()` above. Those are the BROKER's
// already-validated `JevCallResult` shape (`status`/`modelId`/`answers` as
// an ARRAY/`usage.inputTokens`) — `callJevViaBroker` trusts the Edge
// Function already ran `jev-contract.ts`'s validator server-side, so
// `broker-client.ts` never re-validates. The direct path has no such hop:
// `callJevDirect` -> `callJev` -> `jev-contract.ts`'s `validateJevResponse`
// runs INSIDE this process, against the RAW Jev wire-response shape
// (`answers` keyed by question id, `model`, snake_case `usage`) — so this
// block's fixtures (`okWireBody()`/`okWireBodyWithUnknownProjectHelp()`)
// are wire-shaped, covering both question ids a default candidate always
// asks (`core_vs_background` + `project_help`).
// ---------------------------------------------------------------------------

/** The RAW Jev wire-response shape — see the block comment above for why this differs from `okBody()`. */
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

/** Same as `okWireBody()` but `project_help` comes back low-confidence — the ONE condition that may trigger the gemini fallback, mirroring `okBodyWithUnknownProjectHelp()` above in the wire shape the direct path actually validates. Confidence 0.3 < `UNKNOWN_CONFIDENCE_THRESHOLD` (0.5) -> `unknown: true`. */
function okWireBodyWithUnknownProjectHelp() {
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
        score: 1,
        legend: { "0": "a", "1": "b", "2": "c", "3": "d" },
        probabilities: { "0": 0.3, "1": 0.3, "2": 0.2, "3": 0.2 },
        confidence: 0.3,
      },
    },
    usage: { input_tokens: 40, output_tokens: 0 },
  };
}

describe("runJevShadow — direct transport (JEV-DIRECT §1aa, RED list F5)", () => {
  beforeEach(() => {
    vi.stubEnv("JEV_API_KEY", "jev-test-FAKE-KEY-do-not-use-1234567890abcdef");
  });

  it("cache hit: zero reservations, zero fetch calls, cache.set never called", async () => {
    const store = new InMemoryCounterStore();
    const incrementSpy = vi.spyOn(store, "increment");
    const fetchImpl = vi.fn(async () => jsonResponse(200, okWireBody()));
    const cachedResult: DecisionResult = { paperId: "p1", answers: [], usage: null, modelId: "jev-1.13.0" };
    const cache = new AlwaysHitCache(cachedResult);

    const summary = await runJevShadow(
      baseShadowOptions({ transport: "direct", cache, fetchImpl, store, candidates: [candidate("p1")] }),
    );

    expect(fetchImpl).not.toHaveBeenCalled();
    expect(incrementSpy).not.toHaveBeenCalled();
    expect(cache.setCalls).toBe(0);
    expect(summary.byStatus.cache_hit).toBe(1);
  });

  it("cache miss, ok: calls Jev directly exactly once and writes the validated result to the cache — the counter store increments exactly twice, never four times", async () => {
    const cache = new RecordingCache();
    const store = new InMemoryCounterStore();
    const incrementSpy = vi.spyOn(store, "increment");
    const fetchImpl = vi.fn(async () => jsonResponse(200, okWireBody()));

    const summary = await runJevShadow(
      baseShadowOptions({ transport: "direct", cache, store, fetchImpl, candidates: [candidate("p1")] }),
    );

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(incrementSpy).toHaveBeenCalledTimes(2);
    expect(cache.setCalls).toHaveLength(1);
    expect(cache.setCalls[0]?.result).toMatchObject({ paperId: "p1", modelId: "jev-1.13.0" });
    expect(summary.attempted).toBe(1);
    expect(summary.byStatus.ok).toBe(1);
  });

  it("unauthorized (401): one attempt, nothing cached", async () => {
    const cache = new RecordingCache();
    const fetchImpl = vi.fn(async () => new Response("", { status: 401 }));

    const summary = await runJevShadow(baseShadowOptions({ transport: "direct", cache, fetchImpl, candidates: [candidate("p1")] }));

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(cache.setCalls).toHaveLength(0);
    expect(summary.byStatus.unauthorized).toBe(1);
  });

  it("not_entitled: zero counter increments, zero fetch, nothing cached — same as the broker path", async () => {
    const store = new InMemoryCounterStore();
    const incrementSpy = vi.spyOn(store, "increment");
    const cache = new RecordingCache();
    const fetchImpl = vi.fn(async () => jsonResponse(200, okWireBody()));

    const summary = await runJevShadow(
      baseShadowOptions({ transport: "direct", entitled: false, store, cache, fetchImpl, candidates: [candidate("p1")] }),
    );

    expect(incrementSpy).not.toHaveBeenCalled();
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(cache.setCalls).toHaveLength(0);
    expect(summary.byStatus.not_entitled).toBe(1);
  });

  it("deadline: stops starting new calls once the deadline passes; already-started calls still finish", async () => {
    let currentMs = 0;
    const clock = () => new Date(currentMs);
    const cache = new RecordingCache();
    const fetchImpl = vi.fn(async () => {
      currentMs += 100;
      return jsonResponse(200, okWireBody());
    });
    const candidates = [candidate("p1"), candidate("p2"), candidate("p3"), candidate("p4"), candidate("p5")];

    const summary = await runJevShadow(
      baseShadowOptions({
        transport: "direct",
        cache,
        fetchImpl,
        candidates,
        clock,
        concurrencyLimit: 1,
        deadlineMs: 250,
      }),
    );

    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(summary.deadlineExceeded).toBe(true);
    expect(summary.attempted).toBe(3);
  });

  it("concurrency: never runs more than the requested limit at once", async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const cache: DecisionCache = {
      get: async () => {
        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await new Promise((resolve) => setTimeout(resolve, 15));
        inFlight -= 1;
        return null;
      },
      set: async () => {},
    };
    const fetchImpl = vi.fn(async () => jsonResponse(200, okWireBody()));
    const candidates = Array.from({ length: 12 }, (_, i) => candidate(`p${i}`));

    await runJevShadow(baseShadowOptions({ transport: "direct", cache, fetchImpl, candidates, concurrencyLimit: 4 }));

    expect(maxInFlight).toBeLessThanOrEqual(4);
    expect(maxInFlight).toBeGreaterThan(1);
  });

  it("gemini fallback merge: caches the ok fallback answer tagged 'gemini-fallback', and the untouched Jev answer tagged 'jev'", async () => {
    vi.stubEnv("PEER_JEV_GEMINI_FALLBACK", "on");
    const cache = new RecordingCache();
    const fetchImpl = vi.fn(async () => jsonResponse(200, okWireBodyWithUnknownProjectHelp()));
    const provider = mintGeminiFallbackProviderCapability(async () => fallbackAnswerJsonForProjectHelp());

    await runJevShadow(
      baseShadowOptions({ transport: "direct", cache, fetchImpl, candidates: [candidate("p1")], geminiFallbackProvider: provider }),
    );

    expect(cache.setCalls).toHaveLength(1);
    const stored = (cache.setCalls[0]?.result.answers ?? []) as SourcedDecisionAnswer[];
    const coreAnswer = stored.find((a) => a.questionId === "core_vs_background");
    const helpAnswer = stored.find((a) => a.questionId === "project_help");
    expect(coreAnswer?.source).toBe("jev");
    expect(helpAnswer?.source).toBe("gemini-fallback");
    expect(helpAnswer?.value).toBe(3);
    expect(helpAnswer?.unknown).toBe(false);
  });

  it("never sends more than 50 candidates even if handed more", async () => {
    const cache = new RecordingCache();
    const fetchImpl = vi.fn(async () => jsonResponse(200, okWireBody()));
    const candidates = Array.from({ length: 65 }, (_, i) => candidate(`p${i}`));

    const summary = await runJevShadow(baseShadowOptions({ transport: "direct", cache, fetchImpl, candidates }));

    expect(summary.totalCandidates).toBe(50);
    expect(fetchImpl).toHaveBeenCalledTimes(50);
  });
});

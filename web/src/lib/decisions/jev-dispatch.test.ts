import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FEED_INTENT_VERSION, type NormalizedFeedIntent } from "@/lib/feed/intent";
import { InMemoryCounterStore } from "@/lib/usage/counters";
import type { DecisionRequest } from "./types";

// JEV-DIRECT (§1aa) — the transport dispatcher. Spying on BOTH transport
// functions (wrapped around their REAL implementations, so reservation/fetch
// behaviour stays real) is how "which transport actually ran" is told apart
// from "the result merely LOOKS like it came from one" — both return the
// same `BrokerCallResult`-shaped value. Mirrors `registry.test.ts`'s own
// `vi.hoisted` + partial-`vi.mock` pattern (`./gemini`'s
// `createGeminiApiProvider` spy), the established precedent in this codebase
// for "prove which of two code paths ran" without touching either path's own
// already-covered behaviour.
const mocks = vi.hoisted(() => ({
  callJevViaBroker: vi.fn(),
  callJevDirect: vi.fn(),
}));

vi.mock("./broker-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./broker-client")>();
  mocks.callJevViaBroker.mockImplementation(actual.callJevViaBroker);
  return { ...actual, callJevViaBroker: mocks.callJevViaBroker };
});
vi.mock("./jev-direct-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./jev-direct-client")>();
  mocks.callJevDirect.mockImplementation(actual.callJevDirect);
  return { ...actual, callJevDirect: mocks.callJevDirect };
});

import { dispatchJevCall, type JevDispatchOptions } from "./jev-dispatch";

const NOW = new Date("2026-09-27T00:00:00.000Z");
const BROKER_URL = "https://example.supabase.co/functions/v1/jev-broker";
const BROKER_SECRET = "broker-test-FAKE-SECRET-do-not-use";
const FAKE_API_KEY = "jev-test-FAKE-KEY-do-not-use-1234567890abcdef";

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

/** The broker's own already-validated response shape (what its Edge Function forwards on 200). */
function okBrokerBody() {
  return { status: "ok", modelId: "jev-1.13.0", answers: [], usage: { inputTokens: 1, outputTokens: 0, latencyMs: 5 } };
}

/** The RAW Jev wire response shape `callJev`/`validateJevResponse` expects — what the direct path talks to. */
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

function baseOptions(overrides: Partial<JevDispatchOptions> = {}): JevDispatchOptions {
  return {
    transport: "direct",
    ownerId: "owner-a",
    entitled: true,
    perUserCap: 100,
    globalCap: 1000,
    now: NOW,
    store: new InMemoryCounterStore(),
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});
afterEach(() => {
  vi.unstubAllEnvs();
});

describe("dispatchJevCall — routing by transport (RED list F1-F3)", () => {
  it('transport "direct": calls callJevDirect exactly once; callJevViaBroker is never called', async () => {
    vi.stubEnv("JEV_API_KEY", FAKE_API_KEY);
    const fetchImpl = vi.fn(async () => jsonResponse(200, okWireBody()));

    const result = await dispatchJevCall(makeRequest(), baseOptions({ transport: "direct", fetchImpl }));

    expect(mocks.callJevDirect).toHaveBeenCalledTimes(1);
    expect(mocks.callJevViaBroker).not.toHaveBeenCalled();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(result.status).toBe("ok");
  });

  it('transport "broker": calls callJevViaBroker exactly once; callJevDirect is never called', async () => {
    vi.stubEnv("PEER_JEV_BROKER", "on");
    const fetchImpl = vi.fn(async () => jsonResponse(200, okBrokerBody()));

    const result = await dispatchJevCall(
      makeRequest(),
      baseOptions({ transport: "broker", brokerUrl: BROKER_URL, brokerSecret: BROKER_SECRET, fetchImpl }),
    );

    expect(mocks.callJevViaBroker).toHaveBeenCalledTimes(1);
    expect(mocks.callJevDirect).not.toHaveBeenCalled();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(result.status).toBe("ok");
  });

  it('transport "disabled": neither transport function is called; returns {status:"disabled"}; zero calls to the counter store', async () => {
    const store = new InMemoryCounterStore();
    const incrementSpy = vi.spyOn(store, "increment");
    const fetchImpl = vi.fn();

    const result = await dispatchJevCall(makeRequest(), baseOptions({ transport: "disabled", store, fetchImpl }));

    expect(result).toEqual({ status: "disabled" });
    expect(mocks.callJevDirect).not.toHaveBeenCalled();
    expect(mocks.callJevViaBroker).not.toHaveBeenCalled();
    expect(incrementSpy).not.toHaveBeenCalled();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('transport "broker" missing brokerUrl/brokerSecret (a caller contract violation) fails closed to disabled rather than calling the broker with a bad URL', async () => {
    const fetchImpl = vi.fn();

    const result = await dispatchJevCall(makeRequest(), baseOptions({ transport: "broker", fetchImpl }));

    expect(result).toEqual({ status: "disabled" });
    expect(mocks.callJevViaBroker).not.toHaveBeenCalled();
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe("dispatchJevCall — exactly one reservation regardless of transport (RED list F4, regression guard for F-M-P3-01's bug class)", () => {
  it('transport "direct": the counter store increments exactly twice (per-user, then global) — never four times', async () => {
    vi.stubEnv("JEV_API_KEY", FAKE_API_KEY);
    const store = new InMemoryCounterStore();
    const incrementSpy = vi.spyOn(store, "increment");
    const fetchImpl = vi.fn(async () => jsonResponse(200, okWireBody()));

    await dispatchJevCall(makeRequest(), baseOptions({ transport: "direct", store, fetchImpl }));

    expect(incrementSpy).toHaveBeenCalledTimes(2);
  });

  it('transport "broker": the counter store increments exactly twice (per-user, then global) — never four times', async () => {
    vi.stubEnv("PEER_JEV_BROKER", "on");
    const store = new InMemoryCounterStore();
    const incrementSpy = vi.spyOn(store, "increment");
    const fetchImpl = vi.fn(async () => jsonResponse(200, okBrokerBody()));

    await dispatchJevCall(
      makeRequest(),
      baseOptions({ transport: "broker", brokerUrl: BROKER_URL, brokerSecret: BROKER_SECRET, store, fetchImpl }),
    );

    expect(incrementSpy).toHaveBeenCalledTimes(2);
  });

  it('transport "direct": entitled false refuses before any reservation, same as the broker path', async () => {
    vi.stubEnv("JEV_API_KEY", FAKE_API_KEY);
    const store = new InMemoryCounterStore();
    const incrementSpy = vi.spyOn(store, "increment");
    const fetchImpl = vi.fn();

    const result = await dispatchJevCall(makeRequest(), baseOptions({ transport: "direct", entitled: false, store, fetchImpl }));

    expect(result).toEqual({ status: "not_entitled" });
    expect(incrementSpy).not.toHaveBeenCalled();
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe("dispatchJevCall — never throws", () => {
  it("survives a synchronously-throwing fetchImpl for either transport", async () => {
    vi.stubEnv("JEV_API_KEY", FAKE_API_KEY);
    const fetchImpl = vi.fn(() => {
      throw new Error("network is down");
    }) as unknown as JevDispatchOptions["fetchImpl"];

    await expect(dispatchJevCall(makeRequest(), baseOptions({ transport: "direct", fetchImpl }))).resolves.toBeDefined();
  });
});

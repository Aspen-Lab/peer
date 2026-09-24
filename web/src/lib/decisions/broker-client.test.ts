import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FEED_INTENT_VERSION, type NormalizedFeedIntent } from "@/lib/feed/intent";
import { InMemoryCounterStore } from "@/lib/usage/counters";
import type { DecisionRequest } from "./types";
import { callJevViaBroker, jevBrokerEnabled, type BrokerFetchLike } from "./broker-client";

const NOW = new Date("2026-09-24T12:00:00.000Z");
const BROKER_URL = "https://example.supabase.co/functions/v1/jev-broker";
const BROKER_SECRET = "broker-test-FAKE-SECRET-do-not-use";

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

function baseOptions(overrides: Partial<Parameters<typeof callJevViaBroker>[1]> = {}) {
  return {
    ownerId: "owner-a",
    // Server-derived entitlement decision (P3-S4-FIX Finding 1) — defaults to
    // entitled so every pre-existing test below still exercises the normal
    // flow; the dedicated "entitlement gate" describe block below overrides it.
    entitled: true,
    brokerUrl: BROKER_URL,
    brokerSecret: BROKER_SECRET,
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

describe("jevBrokerEnabled", () => {
  it("is enabled only by the literal string 'on'", () => {
    vi.stubEnv("PEER_JEV_BROKER", "on");
    expect(jevBrokerEnabled()).toBe(true);
    vi.stubEnv("PEER_JEV_BROKER", "true");
    expect(jevBrokerEnabled()).toBe(false);
    vi.stubEnv("PEER_JEV_BROKER", "ON");
    expect(jevBrokerEnabled()).toBe(true); // case-insensitive, still only literal "on"
    vi.stubEnv("PEER_JEV_BROKER", "1");
    expect(jevBrokerEnabled()).toBe(false);
    vi.stubEnv("PEER_JEV_BROKER", "");
    expect(jevBrokerEnabled()).toBe(false);
  });
});

describe("callJevViaBroker — flag gate", () => {
  it("flag off (default/unset): returns disabled, never reserves, never fetches", async () => {
    vi.stubEnv("PEER_JEV_BROKER", "");
    const store = new InMemoryCounterStore();
    const incrementSpy = vi.spyOn(store, "increment");
    const fetchImpl = vi.fn();

    const result = await callJevViaBroker(makeRequest(), baseOptions({ store, fetchImpl }));

    expect(result).toEqual({ status: "disabled" });
    expect(incrementSpy).not.toHaveBeenCalled();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("flag on: does not short-circuit — proceeds to reservation", async () => {
    vi.stubEnv("PEER_JEV_BROKER", "on");
    const store = new InMemoryCounterStore();
    const fetchImpl = vi.fn(async () => jsonResponse(200, { status: "ok", modelId: "jev-1.13.0", answers: [], usage: { inputTokens: 1, outputTokens: 0, latencyMs: 5 } }));

    const result = await callJevViaBroker(makeRequest(), baseOptions({ store, fetchImpl }));

    expect(result.status).toBe("ok");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});

describe("callJevViaBroker — entitlement gate (P3-S4-FIX Finding 1)", () => {
  beforeEach(() => {
    vi.stubEnv("PEER_JEV_BROKER", "on");
  });

  it("not entitled: returns not_entitled, never reserves, never fetches", async () => {
    const store = new InMemoryCounterStore();
    const incrementSpy = vi.spyOn(store, "increment");
    const fetchImpl = vi.fn();

    const result = await callJevViaBroker(makeRequest(), baseOptions({ store, fetchImpl, entitled: false }));

    expect(result).toEqual({ status: "not_entitled" });
    expect(incrementSpy).not.toHaveBeenCalled();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("not entitled beats an otherwise-refusing reservation too — the entitlement check runs first regardless of cap state", async () => {
    const store = new InMemoryCounterStore();
    const fetchImpl = vi.fn();

    // perUserCap: 0 would ALSO refuse at the reservation step; entitled: false
    // must still be the reason reported, proving the entitlement check runs
    // strictly before reservation is ever attempted.
    const result = await callJevViaBroker(makeRequest(), baseOptions({ store, fetchImpl, entitled: false, perUserCap: 0 }));

    expect(result).toEqual({ status: "not_entitled" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("entitled: true does not short-circuit — proceeds to reservation as normal", async () => {
    const store = new InMemoryCounterStore();
    const fetchImpl = vi.fn(async () => jsonResponse(200, { status: "ok", modelId: "jev-1.13.0", answers: [], usage: { inputTokens: 1, outputTokens: 0, latencyMs: 5 } }));

    const result = await callJevViaBroker(makeRequest(), baseOptions({ store, fetchImpl, entitled: true }));

    expect(result.status).toBe("ok");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});

describe("callJevViaBroker — reservation ordering and refusal", () => {
  beforeEach(() => {
    vi.stubEnv("PEER_JEV_BROKER", "on");
  });

  it("reserves strictly before any fetch on the success path (call-order proof)", async () => {
    const store = new InMemoryCounterStore();
    const order: string[] = [];
    const incrementSpy = vi.spyOn(store, "increment").mockImplementation(async (...args) => {
      order.push("reserve");
      return InMemoryCounterStore.prototype.increment.apply(store, args);
    });
    const fetchImpl = vi.fn(async () => {
      order.push("fetch");
      return jsonResponse(200, { status: "ok", modelId: "jev-1.13.0", answers: [], usage: { inputTokens: 1, outputTokens: 0, latencyMs: 5 } });
    });

    await callJevViaBroker(makeRequest(), baseOptions({ store, fetchImpl }));

    expect(incrementSpy).toHaveBeenCalled();
    expect(order[0]).toBe("reserve");
    expect(order[order.length - 1]).toBe("fetch");
    expect(order.indexOf("fetch")).toBeGreaterThan(order.lastIndexOf("reserve") - 1);
  });

  it("reserves strictly before any fetch on an ERROR path too (fetch would fail, but reservation still ran first)", async () => {
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

    const result = await callJevViaBroker(makeRequest(), baseOptions({ store, fetchImpl }));

    expect(result).toEqual({ status: "network_error" });
    expect(order).toEqual(["reserve", "reserve", "fetch"]); // per-user + global increments, then fetch
  });

  it("when the reservation is refused (per-user cap), returns reservation_refused and never calls fetch", async () => {
    const store = new InMemoryCounterStore();
    const fetchImpl = vi.fn();
    const options = baseOptions({ store, fetchImpl, perUserCap: 0 }); // any reservation exceeds a 0 cap

    const result = await callJevViaBroker(makeRequest(), options);

    expect(result).toEqual({ status: "reservation_refused", reason: "per_user_cap_exceeded" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("when the reservation is refused (global cap), returns reservation_refused and never calls fetch", async () => {
    const store = new InMemoryCounterStore();
    const fetchImpl = vi.fn();
    const options = baseOptions({ store, fetchImpl, globalCap: 0 });

    const result = await callJevViaBroker(makeRequest(), options);

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

    const result = await callJevViaBroker(makeRequest(), baseOptions({ store: unreadableStore, fetchImpl }));

    expect(result).toEqual({ status: "reservation_refused", reason: "counter_unreadable" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe("callJevViaBroker — request shape sent to the broker", () => {
  beforeEach(() => {
    vi.stubEnv("PEER_JEV_BROKER", "on");
  });

  it("sends the secret as an Authorization header, never in the URL", async () => {
    let capturedUrl = "";
    let capturedInit: RequestInit | undefined;
    const fetchImpl: BrokerFetchLike = vi.fn(async (url, init) => {
      capturedUrl = url;
      capturedInit = init;
      return jsonResponse(200, { status: "ok", modelId: "jev-1.13.0", answers: [], usage: { inputTokens: 1, outputTokens: 0, latencyMs: 5 } });
    });

    await callJevViaBroker(makeRequest(), baseOptions({ fetchImpl }));

    expect(capturedUrl).toBe(BROKER_URL);
    expect(capturedUrl).not.toContain(BROKER_SECRET);
    const headers = capturedInit?.headers as Record<string, string>;
    expect(headers.authorization).toBe(`Bearer ${BROKER_SECRET}`);
  });

  it("POSTs a body containing the owner id and a wire request built from the given DecisionRequest", async () => {
    let capturedBody = "";
    const fetchImpl: BrokerFetchLike = vi.fn(async (_url, init) => {
      capturedBody = String(init.body);
      return jsonResponse(200, { status: "ok", modelId: "jev-1.13.0", answers: [], usage: { inputTokens: 1, outputTokens: 0, latencyMs: 5 } });
    });

    await callJevViaBroker(makeRequest(), baseOptions({ fetchImpl, ownerId: "owner-xyz" }));

    const parsed = JSON.parse(capturedBody);
    expect(parsed.ownerId).toBe("owner-xyz");
    expect(parsed.wireRequest.model).toBe("jev-1.13.0");
    expect(parsed.wireRequest.questions).toHaveProperty("core_vs_background");
    expect(parsed.wireRequest.questions).toHaveProperty("project_help");
  });
});

describe("callJevViaBroker — HTTP response mapping", () => {
  beforeEach(() => {
    vi.stubEnv("PEER_JEV_BROKER", "on");
  });

  it("200 with a JevCallResult-shaped ok body is returned verbatim", async () => {
    const okBody = { status: "ok", modelId: "jev-1.13.0", answers: [{ questionId: "project_help", kind: "score", value: 2, confidence: 0.8, unknown: false }], usage: { inputTokens: 50, outputTokens: 0, latencyMs: 12 } };
    const fetchImpl: BrokerFetchLike = vi.fn(async () => jsonResponse(200, okBody));
    const result = await callJevViaBroker(makeRequest(), baseOptions({ fetchImpl }));
    expect(result).toEqual(okBody);
  });

  it("200 with a JevCallResult-shaped fault body (e.g. invalid_response from the broker's own callJev) is returned verbatim", async () => {
    const faultBody = { status: "invalid_response", detail: "model mismatch" };
    const fetchImpl: BrokerFetchLike = vi.fn(async () => jsonResponse(200, faultBody));
    const result = await callJevViaBroker(makeRequest(), baseOptions({ fetchImpl }));
    expect(result).toEqual(faultBody);
  });

  it("200 with a body that is not JevCallResult-shaped -> invalid_response, never trusted blindly", async () => {
    const fetchImpl: BrokerFetchLike = vi.fn(async () => jsonResponse(200, { hello: "world" }));
    const result = await callJevViaBroker(makeRequest(), baseOptions({ fetchImpl }));
    expect(result.status).toBe("invalid_response");
  });

  it("200 with a non-JSON body -> bad_json", async () => {
    const fetchImpl: BrokerFetchLike = vi.fn(async () => new Response("not json{{{", { status: 200 }));
    const result = await callJevViaBroker(makeRequest(), baseOptions({ fetchImpl }));
    expect(result).toEqual({ status: "bad_json" });
  });

  it("401 from the broker (bad secret) -> unauthorized", async () => {
    const fetchImpl: BrokerFetchLike = vi.fn(async () => new Response("", { status: 401 }));
    const result = await callJevViaBroker(makeRequest(), baseOptions({ fetchImpl }));
    expect(result).toEqual({ status: "unauthorized" });
  });

  // R3-CLEANUP-1: title updated to match the Edge Function's current error
  // name (renamed owner_not_entitled -> owner_not_found); assertion
  // unchanged — it only checks the HTTP status code, never the response body.
  it("403 from the broker (owner not found) -> unauthorized", async () => {
    const fetchImpl: BrokerFetchLike = vi.fn(async () => new Response("", { status: 403 }));
    const result = await callJevViaBroker(makeRequest(), baseOptions({ fetchImpl }));
    expect(result).toEqual({ status: "unauthorized" });
  });

  it("429 from the broker (its own independent cap tripped) -> rate_limited", async () => {
    const fetchImpl: BrokerFetchLike = vi.fn(async () => new Response("", { status: 429 }));
    const result = await callJevViaBroker(makeRequest(), baseOptions({ fetchImpl }));
    expect(result).toEqual({ status: "rate_limited" });
  });

  it("an undocumented status (e.g. 500) is treated conservatively as network_error, never crashes", async () => {
    const fetchImpl: BrokerFetchLike = vi.fn(async () => new Response("", { status: 500 }));
    const result = await callJevViaBroker(makeRequest(), baseOptions({ fetchImpl }));
    expect(result).toEqual({ status: "network_error" });
  });

  it("a fetch throw (network error) -> network_error, never rejects", async () => {
    const fetchImpl: BrokerFetchLike = vi.fn(async () => {
      throw new Error("network down");
    });
    await expect(callJevViaBroker(makeRequest(), baseOptions({ fetchImpl }))).resolves.toEqual({ status: "network_error" });
  });
});

describe("callJevViaBroker — timeout", () => {
  beforeEach(() => {
    vi.stubEnv("PEER_JEV_BROKER", "on");
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("maps an aborted request to a typed timeout result, never rejects", async () => {
    const fetchImpl: BrokerFetchLike = vi.fn(
      (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener("abort", () => {
            reject(new DOMException("The operation was aborted.", "AbortError"));
          });
        }),
    );

    const promise = callJevViaBroker(makeRequest(), baseOptions({ fetchImpl, timeoutMs: 5_000 }));
    await vi.advanceTimersByTimeAsync(5_000);
    const result = await promise;
    expect(result).toEqual({ status: "timeout" });
  });
});

describe("callJevViaBroker — never throws (property test)", () => {
  beforeEach(() => {
    vi.stubEnv("PEER_JEV_BROKER", "on");
  });

  const unanticipatedFailures: Array<[string, BrokerFetchLike]> = [
    ["sync throw", () => { throw new Error("sync boom"); }],
    ["async rejection", async () => { throw new Error("async boom"); }],
    ["a non-Response return value", async () => ({}) as Response],
    ["a .json() that itself throws", async () => ({ status: 200, json: () => { throw new Error("bad json parse"); } }) as unknown as Response],
  ];

  it.each(unanticipatedFailures)("never throws even for: %s", async (_label, fetchImpl) => {
    await expect(callJevViaBroker(makeRequest(), baseOptions({ fetchImpl }))).resolves.toBeDefined();
  });
});

describe("broker-client.ts — structural safety guards (read the file's own source text)", () => {
  it("never references JEV_API_KEY or the Jev domain typesafe.ai anywhere in its own source", () => {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const source = readFileSync(path.join(here, "broker-client.ts"), "utf8");
    expect(source).not.toMatch(/JEV_API_KEY/);
    expect(source).not.toMatch(/typesafe\.ai/);
  });

  it("never reads process.env for anything other than the PEER_JEV_BROKER flag", () => {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const source = readFileSync(path.join(here, "broker-client.ts"), "utf8");
    const envReads = source.match(/process\.env(\.\w+|\[[^\]]+\])/g) ?? [];
    for (const read of envReads) {
      expect(read).toBe("process.env.PEER_JEV_BROKER");
    }
  });
});

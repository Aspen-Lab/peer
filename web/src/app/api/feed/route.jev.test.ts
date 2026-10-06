import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

// Jev on the reader's own key, END TO END through the real route and the real
// pipeline (only the outside world is faked: the sign-in session, the five
// paper sources, Jev's HTTP endpoint, and the stores, which are in-memory and
// RECORD everything written to them). What this file proves that
// `route.test.ts` (pipeline mocked) and `pipeline.jev.test.ts` (route absent)
// cannot: with a key the reader's papers are in Jev's order, with no key they
// are exactly the keyless papers, and the key itself is in NO payload that
// leaves the request: not the pool cache, not the decision cache, not the
// delivery ledger, not the rollover store, not the response, not a log line.
// It is sent to Jev in one place only: the Authorization header of the call.

const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  requireAiRequest: vi.fn(),
  ledgerCtor: vi.fn(),
  rolloverCtor: vi.fn(),
  poolStore: new Map<string, unknown>(),
  poolSets: [] as Array<{ key: string; json: string }>,
  decisionStore: new Map<string, unknown>(),
  decisionGets: [] as string[],
  decisionSets: [] as Array<{ key: string; json: string }>,
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: () => Promise.resolve({ auth: { getUser: mocks.getUser } }),
}));

vi.mock("@/lib/security/ai-request", () => ({
  requireAiRequest: mocks.requireAiRequest,
  aiTierCeiling: (tier: number, request: { anonymous: boolean }) => (request.anonymous ? 0 : tier),
}));

// The private pool cache and the private decision cache are Supabase-backed in
// production. Here each is an in-memory store that records every write.
vi.mock("@/lib/opportunities/private-paper-cache", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/opportunities/private-paper-cache")>();
  class RecordingPaperPoolCache {
    async get(key: string) {
      return (mocks.poolStore.get(key) as never) ?? null;
    }
    async set(key: string, pool: unknown) {
      mocks.poolSets.push({ key, json: JSON.stringify(pool) });
      mocks.poolStore.set(key, JSON.parse(JSON.stringify(pool)));
    }
  }
  return { ...actual, PrivatePaperPoolCache: RecordingPaperPoolCache };
});

vi.mock("@/lib/decisions/private-decision-cache", () => {
  class RecordingDecisionCache {
    constructor(private readonly ownerId: string) {}
    async get(key: string) {
      mocks.decisionGets.push(key);
      return (mocks.decisionStore.get(`${this.ownerId}:${key}`) as never) ?? null;
    }
    async set(key: string, result: unknown) {
      mocks.decisionSets.push({ key, json: JSON.stringify(result) });
      mocks.decisionStore.set(`${this.ownerId}:${key}`, JSON.parse(JSON.stringify(result)));
    }
  }
  return { PrivateDecisionCache: RecordingDecisionCache };
});

vi.mock("@/lib/dashboard/delivery-ledger", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/dashboard/delivery-ledger")>();
  return { ...actual, SupabaseDashboardDeliveryLedger: mocks.ledgerCtor };
});
vi.mock("@/lib/dashboard/rollover-store", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/dashboard/rollover-store")>();
  return { ...actual, SupabaseRolloverCandidateStore: mocks.rolloverCtor };
});

import { POST } from "./route";
import { bySourceId } from "@/lib/sources";
import type { RawItem } from "@/lib/sources/types";
import { MemoryDashboardDeliveryLedger } from "@/lib/dashboard/delivery-ledger";
import { MemoryRolloverCandidateStore } from "@/lib/dashboard/rollover-store";
import { resetCounterStoreForTests } from "@/lib/usage/counters";
import { DEFAULT_JEV_ENDPOINT } from "@/lib/decisions/jev-client";
import { captureConsole, type ConsoleCapture } from "@/test-support/console-capture";

// An invented string. It is not, and never was, a key.
const KEY = "jev-e2e-sentinel-not-a-key-7f3a9c0d";
const OTHER_KEY = "jev-e2e-second-sentinel-not-a-key-1b2c";

const originalOpenalexFetch = bySourceId.openalex.fetch;

function paperFrom(id: string, label: string): RawItem {
  return {
    id: `openalex:${id}`,
    source: "openalex",
    title: `Solid-State Battery Research Note: ${label}`,
    authors: ["A. Researcher"],
    abstract: "An abstract about solid-state battery electrolytes.",
    url: `https://example.org/${id}`,
    publishedAt: "2026-07-27",
    venue: "Journal of Testing",
    tags: ["solid-state battery"],
    metadata: {},
  };
}
const fixtureItems = (count: number) => Array.from({ length: count }, (_, i) => paperFrom(`p${i}`, `Note ${i}`));
const BASELINE = ["openalex:p0", "openalex:p1", "openalex:p2", "openalex:p3", "openalex:p4"];
// Jev finds p3 directly helpful and the others weakly helpful: p3 moves up.
const WITH_JEV = ["openalex:p0", "openalex:p3", "openalex:p1", "openalex:p2", "openalex:p4"];

function wireBody(score: number) {
  const probabilities: Record<string, number> = { "0": 0.05, "1": 0.05, "2": 0.05, "3": 0.05 };
  probabilities[String(score)] = 0.85;
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
        score,
        legend: { "0": "a", "1": "b", "2": "c", "3": "d" },
        probabilities,
        confidence: 0.8,
      },
    },
    usage: { input_tokens: 40, output_tokens: 0 },
  };
}

interface JevCall {
  url: string;
  authorization: string | null;
  body: string;
}
const jevCalls: JevCall[] = [];
let jevBehaviour: "ok" | "unauthorized" = "ok";

function stubJev() {
  jevCalls.length = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit) => {
      jevCalls.push({
        url,
        authorization: new Headers(init.headers).get("authorization"),
        body: String(init.body),
      });
      if (url !== DEFAULT_JEV_ENDPOINT) throw new Error(`unexpected network call to ${url}`);
      if (jevBehaviour === "unauthorized") return new Response("", { status: 401 });
      const title = (JSON.parse(String(init.body)) as { state: { paper: { title: string } } }).state.paper.title;
      return new Response(JSON.stringify(wireBody(title.endsWith("Note 3") ? 3 : 0)), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }),
  );
}

function feedRequest(body: Record<string, unknown>): NextRequest {
  return new NextRequest("http://localhost/api/feed", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const baseBody = {
  topics: ["solid-state battery"],
  project: "solid-state battery research",
  sources: ["openalex"],
  aiTier: 0,
};

function signIn(ownerId: string) {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "public-test-key");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "");
  mocks.getUser.mockResolvedValue({ data: { user: { id: ownerId } } });
  mocks.requireAiRequest.mockResolvedValue({ user: { id: ownerId }, anonymous: false });
}

const ids = (response: { items: Array<{ id: string }> }) => response.items.map((i) => i.id);
const everythingRecorded = () =>
  JSON.stringify({
    pool: mocks.poolSets,
    decisions: mocks.decisionSets,
    decisionKeys: mocks.decisionGets,
  });

// Every console method (log, info, debug, warn, error): a key written through any of them must fail here.
let consoleCapture: ConsoleCapture;
function loggedText(): string {
  return consoleCapture.text();
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 6, 29, 9, 0));
  mocks.poolStore.clear();
  mocks.poolSets.length = 0;
  mocks.decisionStore.clear();
  mocks.decisionGets.length = 0;
  mocks.decisionSets.length = 0;
  mocks.ledgerCtor.mockReset();
  mocks.ledgerCtor.mockImplementation(function () {
    throw new Error("the delivery ledger must not be constructed with PEER_DASHBOARD_LEDGER off");
  });
  mocks.rolloverCtor.mockReset();
  mocks.rolloverCtor.mockImplementation(function () {
    return new MemoryRolloverCandidateStore();
  });
  mocks.getUser.mockReset();
  mocks.requireAiRequest.mockReset();
  resetCounterStoreForTests();
  jevBehaviour = "ok";
  stubJev();
  bySourceId.openalex.fetch = vi.fn(async () => fixtureItems(5));
  consoleCapture = captureConsole();
});

afterEach(() => {
  consoleCapture.restore();
  bySourceId.openalex.fetch = originalOpenalexFetch;
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("/api/feed with a reader's Jev key — end to end", () => {
  it("puts the reader's papers in Jev's order, and says what Jev did", async () => {
    signIn("owner-e2e-1");

    const response = await POST(feedRequest({ ...baseBody, jevApiKey: KEY }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(ids(body)).toEqual(WITH_JEV);
    expect(body.meta.jevScreening).toEqual({ status: "applied", screened: 5, of: 5 });
    expect(jevCalls).toHaveLength(5); // one call per shortlisted paper, once
    expect(jevCalls.every((call) => call.url === DEFAULT_JEV_ENDPOINT)).toBe(true);
  });

  it("sends the key to Jev in the Authorization header and in nowhere else the call can reach", async () => {
    signIn("owner-e2e-header");

    await POST(feedRequest({ ...baseBody, jevApiKey: `  ${KEY}  ` }));

    expect(jevCalls.length).toBeGreaterThan(0);
    for (const call of jevCalls) {
      expect(call.authorization).toBe(`Bearer ${KEY}`);
      expect(call.url).not.toContain(KEY);
      expect(call.body).not.toContain(KEY);
    }
  });

  it("the key is in no stored payload, no store key, no response and no log line", async () => {
    signIn("owner-e2e-leak");

    const response = await POST(feedRequest({ ...baseBody, jevApiKey: KEY }));
    const text = await response.text();

    expect(text).not.toContain(KEY);
    expect(mocks.poolSets).toHaveLength(1);
    expect(mocks.decisionSets).toHaveLength(5);
    expect(everythingRecorded()).not.toContain(KEY);
    expect(loggedText()).not.toContain(KEY);
    expect(loggedText()).toContain("[decision]"); // the per-call usage lines are real; they carry counts, not the key
    // The pool's own record of Jev is counts only.
    const pool = JSON.parse(mocks.poolSets[0].json) as { jev?: unknown };
    expect(pool.jev).toEqual({ status: "applied", screened: 5, of: 5 });
  });

  it("the next load the same day replays Jev's order: no Jev call, no source fetch, same papers, same report", async () => {
    signIn("owner-e2e-hit");
    const first = await (await POST(feedRequest({ ...baseBody, jevApiKey: KEY }))).json();
    expect(jevCalls).toHaveLength(5);

    const second = await (await POST(feedRequest({ ...baseBody, jevApiKey: KEY }))).json();

    expect(jevCalls).toHaveLength(5);
    expect(bySourceId.openalex.fetch).toHaveBeenCalledTimes(1);
    expect(ids(second)).toEqual(ids(first));
    expect(second.meta.jevScreening).toEqual(first.meta.jevScreening);
  });

  it("a day later, with the decisions cached per reader, an unchanged shortlist costs no Jev call", async () => {
    signIn("owner-e2e-decision-cache");
    await POST(feedRequest({ ...baseBody, jevApiKey: KEY }));
    expect(jevCalls).toHaveLength(5);

    // A new local day: a new pool (rebuilt), the same papers. The decisions are
    // per reader and per paper content, so Jev is not asked again.
    vi.setSystemTime(new Date(2026, 6, 30, 9, 0));
    const next = await (await POST(feedRequest({ ...baseBody, jevApiKey: KEY }))).json();

    expect(bySourceId.openalex.fetch).toHaveBeenCalledTimes(2);
    expect(jevCalls).toHaveLength(5);
    expect(ids(next)).toEqual(WITH_JEV);
  });

  it("another reader's decisions are not this reader's: the cache is per owner", async () => {
    signIn("owner-e2e-a");
    await POST(feedRequest({ ...baseBody, jevApiKey: KEY }));
    expect(jevCalls).toHaveLength(5);

    signIn("owner-e2e-b");
    await POST(feedRequest({ ...baseBody, jevApiKey: OTHER_KEY }));

    expect(jevCalls).toHaveLength(10); // b paid for their own answers, with their own key
    expect(jevCalls.slice(5).every((call) => call.authorization === `Bearer ${OTHER_KEY}`)).toBe(true);
  });
});

describe("/api/feed with no Jev key — the feed is unchanged", () => {
  it("the papers are the keyless papers, Jev is never called, and nothing about Jev is reported", async () => {
    signIn("owner-e2e-none");

    const response = await POST(feedRequest(baseBody));
    const body = await response.json();

    expect(ids(body)).toEqual(BASELINE);
    expect(jevCalls).toHaveLength(0);
    expect(body.meta).not.toHaveProperty("jevScreening");
    expect(mocks.decisionGets).toHaveLength(0);
    expect(mocks.decisionSets).toHaveLength(0);
    const pool = JSON.parse(mocks.poolSets[0].json) as Record<string, unknown>;
    expect(pool).not.toHaveProperty("jev");
  });

  it("adding the key mid-day gives a new pool for that reader; removing it returns to the keyless pool of the day", async () => {
    signIn("owner-e2e-toggle");
    const keyless = await (await POST(feedRequest(baseBody))).json();
    expect(ids(keyless)).toEqual(BASELINE);
    expect(mocks.poolStore.size).toBe(1);

    const withKey = await (await POST(feedRequest({ ...baseBody, jevApiKey: KEY }))).json();
    expect(ids(withKey)).toEqual(WITH_JEV);
    expect(mocks.poolStore.size).toBe(2); // a pool of its own, not the keyless one

    const keylessAgain = await (await POST(feedRequest(baseBody))).json();
    expect(ids(keylessAgain)).toEqual(BASELINE);
    expect(mocks.poolStore.size).toBe(2);
    expect(bySourceId.openalex.fetch).toHaveBeenCalledTimes(2); // the keyless pool was already there
  });

  it("a malformed key is ignored as if it were absent", async () => {
    signIn("owner-e2e-malformed");

    const body = await (await POST(feedRequest({ ...baseBody, jevApiKey: "two words" }))).json();

    expect(ids(body)).toEqual(BASELINE);
    expect(jevCalls).toHaveLength(0);
    expect(body.meta).not.toHaveProperty("jevScreening");
  });

  it("signed out with a key in the body: no Jev call, the keyless papers", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "public-test-key");
    mocks.getUser.mockResolvedValue({ data: { user: null } });
    mocks.requireAiRequest.mockResolvedValue({ user: null, anonymous: true });

    const body = await (await POST(feedRequest({ ...baseBody, jevApiKey: KEY }))).json();

    expect(ids(body)).toEqual(BASELINE);
    expect(jevCalls).toHaveLength(0);
  });
});

describe("/api/feed when Jev does not help", () => {
  it("a rejected key: the keyless papers, one wrong answer stops the run, and the pool is not kept so a corrected key works on the next load", async () => {
    signIn("owner-e2e-rejected");
    jevBehaviour = "unauthorized";

    const body = await (await POST(feedRequest({ ...baseBody, jevApiKey: KEY }))).json();

    expect(ids(body)).toEqual(BASELINE);
    expect(body.meta.jevScreening).toEqual({ status: "rejected", screened: 0, of: 5 });
    expect(jevCalls.length).toBeLessThanOrEqual(4); // not one failed call per shortlisted paper
    expect(mocks.poolStore.size).toBe(0);
    expect(mocks.decisionSets).toHaveLength(0);

    jevBehaviour = "ok";
    const fixed = await (await POST(feedRequest({ ...baseBody, jevApiKey: OTHER_KEY }))).json();

    expect(ids(fixed)).toEqual(WITH_JEV);
    expect(fixed.meta.jevScreening).toEqual({ status: "applied", screened: 5, of: 5 });
  });

  it("a Jev that is down: the keyless papers, reported as unavailable, and the day's pool is kept", async () => {
    signIn("owner-e2e-down");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("network down");
      }),
    );

    const body = await (await POST(feedRequest({ ...baseBody, jevApiKey: KEY }))).json();

    expect(ids(body)).toEqual(BASELINE);
    expect(body.meta.jevScreening).toEqual({ status: "unavailable", screened: 0, of: 5 });
    expect(mocks.poolStore.size).toBe(1);
  });
});

describe("/api/feed with the delivery ledger on and a reader's Jev key", () => {
  function memoryLedgerWithSpies() {
    const ledger = new MemoryDashboardDeliveryLedger();
    const prepareBatch = vi.spyOn(ledger, "prepareBatch");
    mocks.ledgerCtor.mockImplementation(function () {
      return ledger;
    });
    const rollover = new MemoryRolloverCandidateStore();
    const upsert = vi.spyOn(rollover, "upsert");
    mocks.rolloverCtor.mockImplementation(function () {
      return rollover;
    });
    return { ledger, prepareBatch, upsert };
  }

  it("the key reaches neither the batch the ledger stores nor the rollover remainder; the first load reports what Jev did, a replay of the frozen batch says nothing new", async () => {
    vi.stubEnv("PEER_DASHBOARD_LEDGER", "on");
    signIn("owner-e2e-ledger");
    const { prepareBatch, upsert } = memoryLedgerWithSpies();

    // topN 2 so three papers are left over for the rollover store.
    const first = await (await POST(feedRequest({ ...baseBody, topN: 2, jevApiKey: KEY }))).json();

    expect(first.meta.batchStatus).toBe("served");
    expect(ids(first)).toEqual(["openalex:p0", "openalex:p3"]);
    expect(first.meta.jevScreening).toEqual({ status: "applied", screened: 5, of: 5 });
    expect(prepareBatch).toHaveBeenCalledTimes(1);
    expect(upsert).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(prepareBatch.mock.calls)).not.toContain(KEY);
    expect(JSON.stringify(upsert.mock.calls)).not.toContain(KEY);
    expect(JSON.stringify(first)).not.toContain(KEY);

    // The day's batch is frozen: a second load replays it. Jev is not asked again.
    const replay = await (await POST(feedRequest({ ...baseBody, topN: 2, jevApiKey: KEY }))).json();
    expect(ids(replay)).toEqual(["openalex:p0", "openalex:p3"]);
    expect(jevCalls).toHaveLength(5);
    expect(JSON.stringify(replay)).not.toContain(KEY);
  });
});

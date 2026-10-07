import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

// P4-S5a (Round 3) — closes F-A-P4S4-01 (docs/jev-abc/P4-S4-A-20260924T0520Z.md,
// ruled at ABC-JEV-INTEGRATION.md §4 "P4-S4 fresh A: VERIFIED_OFFLINE_BOUNDED"):
// both web/src/app/api/feed/route.ts and web/src/app/api/feed/ack/route.ts
// construct their OWN `new SupabaseDashboardDeliveryLedger()` per request in
// production. Every existing offline test mocks that constructor separately
// PER TEST FILE (route.test.ts's own double never reaches ack/route.test.ts
// and vice versa), so no existing test proves the two routes actually
// observe the same durable state — the offline proof exists at "two
// separate levels" (HTTP mapping in ack/route.test.ts; ledger state machine
// in delivery-ledger.test.ts / route.test.ts's own batch-minting block) but
// never together, end to end.
//
// This file imports BOTH routes' real POST handlers and gives them ONE
// shared in-memory ledger instance through a single module-level mock of
// "@/lib/dashboard/delivery-ledger" — the exact module-mock seam
// route.test.ts's own P4-S3 "batch minting" describe block already uses
// within one file (importOriginal + override only the constructor),
// extended here across the route.ts/ack/route.ts file boundary, which is
// precisely the gap F-A-P4S4-01 named. Sources are stubbed (no network) by
// mocking @/lib/feed/pipeline's runFeedPipeline wholesale — the same
// established convention route.test.ts itself already uses; no existing
// test in this repo exercises real source adapters.

const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  runFeedPipeline: vi.fn(),
  requireAiRequest: vi.fn(),
  aiTierCeiling: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: () => Promise.resolve({ auth: { getUser: mocks.getUser } }),
}));

vi.mock("@/lib/feed/pipeline", () => ({
  runFeedPipeline: mocks.runFeedPipeline,
}));

vi.mock("@/lib/security/ai-request", () => ({
  requireAiRequest: mocks.requireAiRequest,
  aiTierCeiling: mocks.aiTierCeiling,
}));

// The ONE shared seam: web/src/app/api/feed/route.ts AND
// web/src/app/api/feed/ack/route.ts both import SupabaseDashboardDeliveryLedger
// from this same module path. Because vitest resolves both import
// specifiers to the SAME mocked module instance within this one test
// file's module graph, wiring the constructor to always return one
// already-created MemoryDashboardDeliveryLedger (see sharedMemoryLedger
// below) makes the two routes cooperate through one durable store for the
// lifetime of a test — which no other test file in this repo does.
const ledgerMocks = vi.hoisted(() => ({ ctor: vi.fn() }));
vi.mock("@/lib/dashboard/delivery-ledger", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/dashboard/delivery-ledger")>();
  return { ...actual, SupabaseDashboardDeliveryLedger: ledgerMocks.ctor };
});

// P4-S6 (Round 3) -- same shared-module-mock seam as the ledger mock just
// above, extended to the rollover store: day1's stored never-presented
// remainder must be visible to day2's mint call through the REAL route
// handler, which the per-request `new SupabaseRolloverCandidateStore()`
// construction in route.ts would otherwise defeat (each call would get its
// own separate, unconfigured, throwaway in-memory fallback -- exactly the
// F-A-P4S4-01 gap this file already exists to close for the delivery
// ledger, now closed for rollover too).
const rolloverMocks = vi.hoisted(() => ({ ctor: vi.fn() }));
vi.mock("@/lib/dashboard/rollover-store", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/dashboard/rollover-store")>();
  return { ...actual, SupabaseRolloverCandidateStore: rolloverMocks.ctor };
});

import { POST as postFeed } from "./route";
import { POST as postAck } from "./ack/route";
import { MemoryDashboardDeliveryLedger } from "@/lib/dashboard/delivery-ledger";
import { MemoryRolloverCandidateStore } from "@/lib/dashboard/rollover-store";
import { identityForRawItem } from "@/lib/feed/paper-identity";
import type { ScoredItem } from "@/lib/scoring/types";

function feedRequest(body: Record<string, unknown>): NextRequest {
  return new NextRequest("http://localhost/api/feed", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function ackRequest(body: unknown): NextRequest {
  return new NextRequest("http://localhost/api/feed/ack", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

// Local copy of route.test.ts's own fixture helper — describe blocks (and
// separate test files) don't share scoped helpers, so this mirrors it
// exactly rather than importing test-only code across files.
function scoredItem(id: string): ScoredItem {
  return {
    id,
    source: "openalex",
    title: `Title for ${id}`,
    authors: ["A. Researcher"],
    url: `https://openalex.org/${id}`,
    publishedAt: "2026-09-20",
    metadata: {},
    score: 0.5,
    scoreBreakdown: { keyword: 0, tfidf: 0, topicality: 0, recency: 0, source: 0, combined: 0.5 },
    matchedKeywords: [],
    relevanceReason: "",
  };
}

function baseMeta() {
  return {
    fetched: {},
    errors: {},
    beforeDedup: 0,
    afterDedup: 0,
    returned: 0,
    latencyMs: 1,
    generatedAt: "2026-09-24T00:00:00.000Z",
  };
}

function stubSignedIn(userId: string) {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "public-test-key");
  mocks.getUser.mockResolvedValue({ data: { user: { id: userId } } });
}

/** ONE shared, durable-for-this-test ledger both routes' constructions resolve to. */
function sharedMemoryLedger(): MemoryDashboardDeliveryLedger {
  const ledger = new MemoryDashboardDeliveryLedger();
  ledgerMocks.ctor.mockImplementation(function () {
    return ledger;
  });
  return ledger;
}

/** ONE shared rollover store both feed-route mint calls resolve to (P4-S6). */
function sharedMemoryRolloverStore(): MemoryRolloverCandidateStore {
  const store = new MemoryRolloverCandidateStore();
  rolloverMocks.ctor.mockImplementation(function () {
    return store;
  });
  return store;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 8, 24, 9, 0));
  mocks.requireAiRequest.mockResolvedValue({ user: null, anonymous: true });
  mocks.aiTierCeiling.mockImplementation((tier: number, request: { anonymous: boolean }) =>
    request.anonymous ? 0 : tier,
  );
  mocks.getUser.mockResolvedValue({ data: { user: null } });
  // Every test stubs its own env/ledger explicitly; a construction that
  // slips through unstubbed should fail loudly, not silently no-op.
  ledgerMocks.ctor.mockImplementation(function () {
    throw new Error("SupabaseDashboardDeliveryLedger must not be constructed here");
  });
  // P4-S6 (Round 3): unlike the ledger's throw-by-default guard above, the
  // rollover store defaults to a fresh, inert, empty MemoryRolloverCandidateStore
  // -- functionally identical to an unconfigured production store (empty
  // list, silent upsert). None of the PRE-EXISTING tests in this file (all
  // written before P4-S6) assert anything about rollover, so they keep
  // passing completely unmodified; only the new "rollover" describe block
  // below overrides this via `sharedMemoryRolloverStore()`.
  rolloverMocks.ctor.mockImplementation(function () {
    return new MemoryRolloverCandidateStore();
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe("dashboard ledger end-to-end: mint -> serve -> ack -> next-day exclusion (P4-S5a, F-A-P4S4-01)", () => {
  it("walks one owner's full lifecycle through the REAL feed and ack route handlers sharing ONE ledger", async () => {
    vi.stubEnv("PEER_DASHBOARD_LEDGER", "on");
    stubSignedIn("owner-integration-1");
    const ledger = sharedMemoryLedger();

    const dayOnePaper = scoredItem("paper-day-one");
    mocks.runFeedPipeline.mockResolvedValueOnce({ items: [dayOnePaper], meta: baseMeta() });

    // Day 1: mint + serve.
    const day1First = await postFeed(feedRequest({ topics: ["battery"] }));
    const day1FirstBody = await day1First.json();
    expect(day1First.status).toBe(200);
    expect(day1FirstBody.meta.batchStatus).toBe("served");
    const batchId = day1FirstBody.meta.batchId as string;
    expect(batchId).toEqual(expect.any(String));
    expect(day1FirstBody.items.map((i: { id: string }) => i.id)).toEqual(["paper-day-one"]);

    // Same-day reload BEFORE any ack: still the frozen batch, no new pipeline call.
    const day1Replay = await postFeed(feedRequest({ topics: ["battery"] }));
    const day1ReplayBody = await day1Replay.json();
    expect(day1ReplayBody.meta.batchId).toBe(batchId);
    expect(day1ReplayBody.meta.batchStatus).toBe("served");
    expect(day1ReplayBody.items).toEqual(day1FirstBody.items);
    expect(mocks.runFeedPipeline).toHaveBeenCalledTimes(1); // never re-run

    // Ack, through the REAL ack route — the thing no other test file proves
    // against the SAME ledger instance the feed route just wrote to.
    const ackFirst = await postAck(ackRequest({ batchId }));
    const ackFirstBody = await ackFirst.json();
    expect(ackFirst.status).toBe(200);
    expect(ackFirstBody).toEqual({ ok: true, alreadyAcknowledged: false });

    // Duplicate ack (e.g. a retried client POST) — still 200, no double-insert.
    const ackSecond = await postAck(ackRequest({ batchId }));
    const ackSecondBody = await ackSecond.json();
    expect(ackSecond.status).toBe(200);
    expect(ackSecondBody).toEqual({ ok: true, alreadyAcknowledged: true });

    // Same-day feed reload again: now reports acknowledged, still the same
    // frozen items, still no new pipeline call.
    const day1AfterAck = await postFeed(feedRequest({ topics: ["battery"] }));
    const day1AfterAckBody = await day1AfterAck.json();
    expect(day1AfterAckBody.meta.batchId).toBe(batchId);
    expect(day1AfterAckBody.meta.batchStatus).toBe("acknowledged");
    expect(day1AfterAckBody.items).toEqual(day1FirstBody.items);
    expect(mocks.runFeedPipeline).toHaveBeenCalledTimes(1);

    // Directly against the ledger: the acknowledgment made this paper a
    // PERMANENT delivery, not merely a served-unacknowledged one.
    const dayOneKey = identityForRawItem(dayOnePaper).key;
    expect((await ledger.listDelivered("owner-integration-1")).has(dayOneKey)).toBe(true);
    expect((await ledger.listServedUnacknowledged("owner-integration-1")).has(dayOneKey)).toBe(false);

    // Day 2: a new local day. The acknowledged day-one paper must never
    // return. Proven two ways: (a) the route's own exclusion-set wiring
    // (pipeline is mocked, so this is the route's contract, matching
    // route.test.ts's established assertion shape for this exact case) and
    // (b) the mocked pipeline's actual returned items exclude it.
    vi.setSystemTime(new Date(2026, 8, 25, 9, 0));
    const dayTwoPaper = scoredItem("paper-day-two");
    mocks.runFeedPipeline.mockResolvedValueOnce({ items: [dayTwoPaper], meta: baseMeta() });

    const day2 = await postFeed(feedRequest({ topics: ["battery"] }));
    const day2Body = await day2.json();

    expect(day2Body.meta.batchId).not.toBe(batchId);
    expect(day2Body.meta.batchStatus).toBe("served");
    expect(day2Body.items.map((i: { id: string }) => i.id)).toEqual(["paper-day-two"]);
    expect(mocks.runFeedPipeline).toHaveBeenCalledTimes(2);
    const day2Options = mocks.runFeedPipeline.mock.calls[1]?.[1] as {
      ledgerExclusions?: Set<string>;
    };
    expect(day2Options.ledgerExclusions?.has(dayOneKey)).toBe(true);
  });

  it("a served-but-NEVER-acknowledged batch still excludes its papers the next day (temporary, not permanent)", async () => {
    vi.stubEnv("PEER_DASHBOARD_LEDGER", "on");
    stubSignedIn("owner-integration-2");
    const ledger = sharedMemoryLedger();

    const unackedPaper = scoredItem("paper-served-unacked");
    mocks.runFeedPipeline.mockResolvedValueOnce({ items: [unackedPaper], meta: baseMeta() });

    const day1 = await postFeed(feedRequest({ topics: ["battery"] }));
    const day1Body = await day1.json();
    expect(day1Body.meta.batchStatus).toBe("served"); // served, ack never called this test

    const unackedKey = identityForRawItem(unackedPaper).key;
    // Distinguish the two ledger concepts directly: NOT a permanent
    // delivery, but IS a served-unacknowledged exclusion — the whole point
    // of ABC-JEV-INTEGRATION.md §1p.C.5's two-read-method design.
    expect((await ledger.listDelivered("owner-integration-2")).has(unackedKey)).toBe(false);
    expect((await ledger.listServedUnacknowledged("owner-integration-2")).has(unackedKey)).toBe(true);

    vi.setSystemTime(new Date(2026, 8, 25, 9, 0));
    mocks.runFeedPipeline.mockResolvedValueOnce({
      items: [scoredItem("paper-day-two-again")],
      meta: baseMeta(),
    });

    const day2 = await postFeed(feedRequest({ topics: ["battery"] }));
    const day2Body = await day2.json();

    expect(day2Body.meta.batchId).not.toBe(day1Body.meta.batchId);
    expect(day2Body.items.map((i: { id: string }) => i.id)).toEqual(["paper-day-two-again"]);
    const day2Options = mocks.runFeedPipeline.mock.calls[1]?.[1] as {
      ledgerExclusions?: Set<string>;
    };
    expect(day2Options.ledgerExclusions?.has(unackedKey)).toBe(true);
  });

  it("never constructs the ledger, on either route, when PEER_DASHBOARD_LEDGER is off", async () => {
    stubSignedIn("owner-integration-3");
    // PEER_DASHBOARD_LEDGER intentionally left unset — default off.
    mocks.runFeedPipeline.mockResolvedValueOnce({
      items: [scoredItem("paper-flag-off")],
      meta: baseMeta(),
    });

    const feedResponse = await postFeed(feedRequest({ topics: ["battery"] }));
    const feedBody = await feedResponse.json();
    expect(feedResponse.status).toBe(200);
    expect(feedBody.meta.batchId).toBeUndefined();
    expect(feedBody.meta.batchStatus).toBeUndefined();
    expect(ledgerMocks.ctor).not.toHaveBeenCalled();

    const getUserCallsBeforeAck = mocks.getUser.mock.calls.length;
    const ackResponse = await postAck(ackRequest({ batchId: "11111111-2222-4333-8444-555555555555" }));
    expect(ackResponse.status).toBe(404);
    await expect(ackResponse.json()).resolves.toEqual({ error: "not_enabled" });
    expect(ledgerMocks.ctor).not.toHaveBeenCalled();
    // The ack route gates the flag before auth — never even reaches getUser.
    expect(mocks.getUser.mock.calls.length).toBe(getUserCallsBeforeAck);
  });

  // P4-S5a-FIX (Round 3) — F-A-P4S5-03
  // (docs/jev-abc/P4-S5a-S3FIX-A-20260924T062754Z.md PER-CHECK VERDICT 5's
  // scope caveat): the two remaining sub-shapes of acceptance 16l/16n that
  // were, before this fix, only proven at "two separate levels" (a
  // mocked-route Promise.all test in ack/route.test.ts; a real-ledger-class-
  // but-not-through-the-route Promise.all/cross-day test in
  // delivery-ledger.test.ts) — never together, through the REAL routes
  // sharing one ledger, the way every other lifecycle step in this file
  // already is.
  it("two concurrent acknowledgments for the same batch, through the REAL route sharing one ledger, both succeed exactly once (F-A-P4S5-03, 16l)", async () => {
    vi.stubEnv("PEER_DASHBOARD_LEDGER", "on");
    stubSignedIn("owner-integration-concurrent");
    const ledger = sharedMemoryLedger();

    const paper = scoredItem("paper-concurrent-ack");
    mocks.runFeedPipeline.mockResolvedValueOnce({ items: [paper], meta: baseMeta() });

    const day1 = await postFeed(feedRequest({ topics: ["battery"] }));
    const day1Body = await day1.json();
    expect(day1Body.meta.batchStatus).toBe("served");
    const batchId = day1Body.meta.batchId as string;

    // Two devices (or a retried offline POST racing a fresh one) acknowledge
    // the same batch at the same time, through the real route, both
    // resolving against the one shared ledger instance.
    const [first, second] = await Promise.all([
      postAck(ackRequest({ batchId })),
      postAck(ackRequest({ batchId })),
    ]);
    const [firstBody, secondBody] = await Promise.all([first.json(), second.json()]);

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    // Exactly one of the two actually performed the write; the other
    // observes it already done — never two competing "fresh" acks, and
    // never a failure on either side.
    const outcomes = [firstBody, secondBody];
    expect(outcomes).toContainEqual({ ok: true, alreadyAcknowledged: false });
    expect(outcomes).toContainEqual({ ok: true, alreadyAcknowledged: true });

    const paperKey = identityForRawItem(paper).key;
    expect((await ledger.listDelivered("owner-integration-concurrent")).has(paperKey)).toBe(true);
    expect(
      (await ledger.listServedUnacknowledged("owner-integration-concurrent")).has(paperKey),
    ).toBe(false);
  });

  it("a late acknowledgment arriving on the next local day still records yesterday's batch, after today's own selection already excluded it as served-unacked (F-A-P4S5-03, 16n)", async () => {
    vi.stubEnv("PEER_DASHBOARD_LEDGER", "on");
    stubSignedIn("owner-integration-late-ack");
    const ledger = sharedMemoryLedger();

    const dayOnePaper = scoredItem("paper-late-ack-day-one");
    mocks.runFeedPipeline.mockResolvedValueOnce({ items: [dayOnePaper], meta: baseMeta() });

    // Day 1: served, but the day rolls over before any ack arrives.
    const day1 = await postFeed(feedRequest({ topics: ["battery"] }));
    const day1Body = await day1.json();
    expect(day1Body.meta.batchStatus).toBe("served");
    const day1BatchId = day1Body.meta.batchId as string;
    const dayOneKey = identityForRawItem(dayOnePaper).key;

    // Day 2 rolls over BEFORE any ack arrives. Today's own selection must
    // already exclude day 1's served-but-unacknowledged paper (temporary
    // exclusion, ABC-JEV-INTEGRATION.md §1p.C.5) — proven first, before the
    // late ack below touches anything.
    vi.setSystemTime(new Date(2026, 8, 25, 9, 0));
    const dayTwoPaper = scoredItem("paper-late-ack-day-two");
    mocks.runFeedPipeline.mockResolvedValueOnce({ items: [dayTwoPaper], meta: baseMeta() });

    const day2 = await postFeed(feedRequest({ topics: ["battery"] }));
    const day2Body = await day2.json();
    expect(day2Body.meta.batchId).not.toBe(day1BatchId);
    expect(day2Body.items.map((i: { id: string }) => i.id)).toEqual(["paper-late-ack-day-two"]);
    const day2Options = mocks.runFeedPipeline.mock.calls[1]?.[1] as {
      ledgerExclusions?: Set<string>;
    };
    expect(day2Options.ledgerExclusions?.has(dayOneKey)).toBe(true);
    expect(
      (await ledger.listServedUnacknowledged("owner-integration-late-ack")).has(dayOneKey),
    ).toBe(true);
    expect((await ledger.listDelivered("owner-integration-late-ack")).has(dayOneKey)).toBe(false);

    // NOW the late ack for day 1's batch physically arrives, through the
    // REAL route, on day 2 — acknowledgeBatch never reads localDate
    // (delivery-ledger.ts's own MemoryDashboardDeliveryLedger.acknowledgeBatch,
    // "this method never looks at 'today'/localDate, only the batch's own
    // stored state, so a cross-day late ack still succeeds"), so it must
    // still succeed and promote day 1's paper to a PERMANENT delivery, even
    // though day 2's batch already exists and already ran its own exclusion
    // without it.
    const lateAck = await postAck(ackRequest({ batchId: day1BatchId }));
    const lateAckBody = await lateAck.json();
    expect(lateAck.status).toBe(200);
    expect(lateAckBody).toEqual({ ok: true, alreadyAcknowledged: false });

    expect((await ledger.listDelivered("owner-integration-late-ack")).has(dayOneKey)).toBe(true);
    expect(
      (await ledger.listServedUnacknowledged("owner-integration-late-ack")).has(dayOneKey),
    ).toBe(false);
  });
});

describe("dashboard ledger rollover: day 1's never-presented remainder competes on day 2 (P4-S6, F-A-P4-08 remainder)", () => {
  it("stores day 1's never-presented remainder and day 2's mint reads it back as rolloverCandidates, through the REAL routes sharing one ledger and one rollover store", async () => {
    vi.stubEnv("PEER_DASHBOARD_LEDGER", "on");
    stubSignedIn("owner-rollover-e2e");
    sharedMemoryLedger();
    const rolloverStore = sharedMemoryRolloverStore();

    const finalPool = Array.from({ length: 30 }, (_, i) => scoredItem(`paper-${i + 1}`));
    mocks.runFeedPipeline.mockResolvedValueOnce({
      items: finalPool.slice(0, 10),
      meta: baseMeta(),
      finalPool,
    });

    const day1 = await postFeed(feedRequest({ topics: ["battery"], topN: 10 }));
    const day1Body = await day1.json();
    expect(day1Body.meta.batchStatus).toBe("served");
    expect(day1Body.items).toHaveLength(10);
    // finalPool never reaches the client, even in this richer end-to-end path.
    expect(day1Body).not.toHaveProperty("finalPool");

    const stored = await rolloverStore.list("owner-rollover-e2e", new Date());
    expect(stored).toHaveLength(20); // 30 final pool minus 10 presented

    vi.setSystemTime(new Date(2026, 8, 25, 9, 0)); // next local day
    mocks.runFeedPipeline.mockResolvedValueOnce({
      items: [scoredItem("day-two-fresh-paper")],
      meta: baseMeta(),
    });

    const day2 = await postFeed(feedRequest({ topics: ["battery"] }));
    const day2Body = await day2.json();

    expect(day2Body.meta.batchId).not.toBe(day1Body.meta.batchId);
    expect(mocks.runFeedPipeline).toHaveBeenCalledTimes(2);
    const day2Options = mocks.runFeedPipeline.mock.calls[1]?.[1] as {
      rolloverCandidates?: ScoredItem[];
    };
    const day2RolloverIds = new Set(day2Options.rolloverCandidates?.map((i) => i.id));
    // All 20 never-presented day-1 candidates are offered to day 2's mint...
    for (const item of finalPool.slice(10)) {
      expect(day2RolloverIds.has(item.id)).toBe(true);
    }
    // ...and none of the 10 already-presented day-1 candidates are.
    for (const item of finalPool.slice(0, 10)) {
      expect(day2RolloverIds.has(item.id)).toBe(false);
    }
  });

  it("flag off -- the rollover store is never constructed on either route", async () => {
    stubSignedIn("owner-rollover-flag-off");
    // PEER_DASHBOARD_LEDGER intentionally left unset -- default off.
    mocks.runFeedPipeline.mockResolvedValueOnce({
      items: [scoredItem("paper-flag-off")],
      meta: baseMeta(),
    });

    await postFeed(feedRequest({ topics: ["battery"] }));

    expect(rolloverMocks.ctor).not.toHaveBeenCalled();
  });
});

// P4-S6-FIX (Round 3) -- F-A-P4S6-01, docs/jev-abc/P4-S6-A-20260924T093528Z.md
// finding 2. The reviewer's reproduction, through the REAL feed route + REAL
// (shared) ledger + REAL (shared) rollover store across two simulated local
// days -- only `runFeedPipeline` itself stays mocked, the same repo-wide
// constraint every test in this file already lives with (see this file's
// own top-of-file comment: no test here exercises the real pipeline/literal
// gate against network). So "NOT returned under intent B" is proven at the
// boundary route.ts actually owns and this fix actually changes: the
// `rolloverCandidates` array handed to the (mocked) pipeline call. Before
// this fix, a stale "citation" tag from day 1's intent survived verbatim
// into day 2's completely different intent; after it, the tag is stripped
// and the candidate would have to re-qualify through the real literal gate
// exactly like an untagged candidate (that gate itself is covered
// separately and permanently by admission-channels.test.ts/combine.ts's own
// tests, which this fix does not touch).
describe("dashboard ledger rollover: admissionChannels re-validated against a changed intent (P4-S6-FIX, F-A-P4S6-01)", () => {
  it("day 1 stores a citation-tagged remainder under intent A; day 2's DIFFERENT intent strips the tag before the candidate reaches the pipeline", async () => {
    vi.stubEnv("PEER_DASHBOARD_LEDGER", "on");
    stubSignedIn("owner-rollover-intent-change");
    sharedMemoryLedger();
    sharedMemoryRolloverStore();

    const taggedCandidate: ScoredItem = {
      ...scoredItem("battery-citation-neighbor"),
      admissionChannels: ["citation"],
    };
    const finalPool = [scoredItem("day-one-presented"), taggedCandidate];
    mocks.runFeedPipeline.mockResolvedValueOnce({
      items: [finalPool[0]], // only the first is "presented" -- taggedCandidate rolls over
      meta: baseMeta(),
      finalPool,
    });

    const day1 = await postFeed(feedRequest({ topics: ["battery materials"] }));
    const day1Body = await day1.json();
    expect(day1Body.meta.batchStatus).toBe("served");

    // Day 2: a NEW local day, and the user's declared intent has genuinely
    // changed -- a different required topic entirely, zero literal overlap
    // with the stored candidate's battery-related content.
    vi.setSystemTime(new Date(2026, 8, 25, 9, 0));
    mocks.runFeedPipeline.mockResolvedValueOnce({
      items: [scoredItem("day-two-fresh-paper")],
      meta: baseMeta(),
    });

    await postFeed(feedRequest({ topics: ["quantum computing"] }));

    expect(mocks.runFeedPipeline).toHaveBeenCalledTimes(2);
    const day2Options = mocks.runFeedPipeline.mock.calls[1]?.[1] as {
      rolloverCandidates?: ScoredItem[];
    };
    const passedCandidate = day2Options.rolloverCandidates?.find(
      (i) => i.id === "battery-citation-neighbor",
    );
    expect(passedCandidate).toBeDefined();
    // The stale "citation" tag from intent A must not silently survive into
    // intent B's selection -- it has to re-qualify through the literal gate
    // like any other candidate (§1g "...subject to current eligibility").
    expect(passedCandidate?.admissionChannels).toBeUndefined();
  });

  it("day 1 stores a citation-tagged remainder; day 2's SAME intent keeps the tag intact", async () => {
    vi.stubEnv("PEER_DASHBOARD_LEDGER", "on");
    stubSignedIn("owner-rollover-same-intent");
    sharedMemoryLedger();
    sharedMemoryRolloverStore();

    const taggedCandidate: ScoredItem = {
      ...scoredItem("battery-citation-neighbor-2"),
      admissionChannels: ["citation"],
    };
    const finalPool = [scoredItem("day-one-presented-2"), taggedCandidate];
    mocks.runFeedPipeline.mockResolvedValueOnce({
      items: [finalPool[0]],
      meta: baseMeta(),
      finalPool,
    });

    await postFeed(feedRequest({ topics: ["battery materials"] }));

    vi.setSystemTime(new Date(2026, 8, 25, 9, 0));
    mocks.runFeedPipeline.mockResolvedValueOnce({
      items: [scoredItem("day-two-fresh-paper-2")],
      meta: baseMeta(),
    });

    // SAME declared topic as day 1 -- the candidate's tag must survive.
    await postFeed(feedRequest({ topics: ["battery materials"] }));

    const day2Options = mocks.runFeedPipeline.mock.calls[1]?.[1] as {
      rolloverCandidates?: ScoredItem[];
    };
    const passedCandidate = day2Options.rolloverCandidates?.find(
      (i) => i.id === "battery-citation-neighbor-2",
    );
    expect(passedCandidate?.admissionChannels).toEqual(["citation"]);
  });
});

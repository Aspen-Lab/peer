import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

// P4-S9 (Round 3) -- ABC-JEV-INTEGRATION.md §4 "Round 3 — END-OF-ROUND
// RE-MEASUREMENT part 2" RULING (archive); acceptance 16's "archive access"
// subcase; §3c "Archive is explicit old-batch access, not a new
// recommendation." Mock template follows
// web/src/app/api/feed/ack/route.test.ts (`vi.mock("@/lib/supabase/server",
// ...)` + a controllable fake ledger) for the unit-level HTTP-mapping tests,
// and web/src/app/api/feed/ledger-flow.integration.test.ts's shared-module-
// mock seam (importOriginal + override only the SupabaseDashboardDeliveryLedger
// constructor) for the key-property test, which needs the REAL feed and ack
// routes and a REAL MemoryDashboardDeliveryLedger sharing state across all
// three routes -- neither of those two existing files is in this slice's
// allowed-file list, so both patterns are reproduced here rather than
// editing them.

const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  getBatch: vi.fn(),
  listServedBatchDates: vi.fn(),
  readExclusions: vi.fn(),
  runFeedPipeline: vi.fn(),
  requireEntitledAiRequest: vi.fn(),
  entitledAiTier: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: () => Promise.resolve({ auth: { getUser: mocks.getUser } }),
}));

vi.mock("@/lib/feed/pipeline", () => ({
  runFeedPipeline: mocks.runFeedPipeline,
}));

vi.mock("@/lib/security/ai-request", () => ({
  protectAiRequest: mocks.requireEntitledAiRequest,
  requireEntitledAiRequest: mocks.requireEntitledAiRequest,
  entitledAiTier: mocks.entitledAiTier,
}));

// The ONE shared seam: this route, web/src/app/api/feed/route.ts and
// web/src/app/api/feed/ack/route.ts all import SupabaseDashboardDeliveryLedger
// from this same module path. Overriding only its constructor (keeping
// every other export, including the real MemoryDashboardDeliveryLedger,
// intact via importOriginal) lets unit tests inject a minimal fake AND lets
// the key-property test inject one real, shared, in-memory ledger.
const ledgerMocks = vi.hoisted(() => ({ ctor: vi.fn() }));
vi.mock("@/lib/dashboard/delivery-ledger", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/dashboard/delivery-ledger")>();
  return { ...actual, SupabaseDashboardDeliveryLedger: ledgerMocks.ctor };
});

import { GET } from "./route";
import { POST as postFeed } from "../route";
import { POST as postAck } from "../ack/route";
import { MemoryDashboardDeliveryLedger } from "@/lib/dashboard/delivery-ledger";
import type { ScoredItem } from "@/lib/scoring/types";

function request(query?: string): NextRequest {
  return new NextRequest(`http://localhost/api/feed/archive${query ? `?${query}` : ""}`);
}

/**
 * Minimal fake ledger for the unit-level tests below -- ONLY implements the
 * 3 read methods this route is allowed to call (getBatch,
 * listServedBatchDates, readExclusions). Calling anything else on it
 * (prepareBatch, markServed, acknowledgeBatch) throws "is not a function",
 * which is a STRONGER "this route never mints/acknowledges/writes the
 * ledger" guarantee than a spy assertion would be -- if route.ts is ever
 * changed to call one of those, every test using this double fails loudly.
 */
function useMinimalFakeLedger() {
  ledgerMocks.ctor.mockImplementation(function () {
    return {
      getBatch: mocks.getBatch,
      listServedBatchDates: mocks.listServedBatchDates,
      readExclusions: mocks.readExclusions,
    };
  });
}

/** ONE shared, durable-for-this-test ledger every route's construction resolves to (key-property test only). */
function sharedMemoryLedger(): MemoryDashboardDeliveryLedger {
  const ledger = new MemoryDashboardDeliveryLedger();
  ledgerMocks.ctor.mockImplementation(function () {
    return ledger;
  });
  return ledger;
}

// Local copies of ledger-flow.integration.test.ts's own fixture helpers --
// describe blocks (and separate test files) don't share scoped helpers, so
// these mirror them exactly rather than importing test-only code across
// files.
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

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 8, 24, 12, 0)); // 2026-09-24, local
  vi.stubEnv("PEER_DASHBOARD_LEDGER", "on");
  mocks.getUser.mockResolvedValue({ data: { user: { id: "owner-1" } } });
  mocks.readExclusions.mockResolvedValue({ status: "ok", keys: new Set() });
  mocks.getBatch.mockResolvedValue(null);
  mocks.listServedBatchDates.mockResolvedValue([]);
  mocks.requireEntitledAiRequest.mockResolvedValue({ entitlement: { userId: null } });
  mocks.entitledAiTier.mockImplementation((tier: number, entitlement: { userId: string | null }) =>
    entitlement.userId === null ? 0 : tier,
  );
  // Every test stubs its own ledger explicitly; a construction that slips
  // through unstubbed should fail loudly, not silently no-op (same
  // discipline as ledger-flow.integration.test.ts's own default guard).
  ledgerMocks.ctor.mockImplementation(function () {
    throw new Error("SupabaseDashboardDeliveryLedger must not be constructed here");
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe("GET /api/feed/archive -- flag off", () => {
  it("returns 404 not_enabled before touching auth or the ledger, with or without a date", async () => {
    vi.stubEnv("PEER_DASHBOARD_LEDGER", "");

    const withoutDate = await GET(request());
    expect(withoutDate.status).toBe(404);
    await expect(withoutDate.json()).resolves.toEqual({ error: "not_enabled" });
    expect(withoutDate.headers.get("Cache-Control")).toBe("private, no-store");

    const withDate = await GET(request("date=2026-09-20"));
    expect(withDate.status).toBe(404);
    await expect(withDate.json()).resolves.toEqual({ error: "not_enabled" });

    expect(mocks.getUser).not.toHaveBeenCalled();
    expect(ledgerMocks.ctor).not.toHaveBeenCalled();
  });

  it("stays off for near-miss spellings like 'true'/'1' -- same unforgiving parse as ledger-flag.ts", async () => {
    vi.stubEnv("PEER_DASHBOARD_LEDGER", "true");

    const response = await GET(request());

    expect(response.status).toBe(404);
    expect(ledgerMocks.ctor).not.toHaveBeenCalled();
  });
});

describe("GET /api/feed/archive -- date validation (pure, before auth or the ledger)", () => {
  const malformed = [
    "not-a-date",
    "",
    "2026/09/24",
    "20260924",
    "2026-9-24",
    "2026-13-01", // no month 13
    "2026-02-30", // February has no 30th
    "2026-00-10", // no month 0
  ];

  it.each(malformed)("rejects %j with 400 invalid_date, touching neither auth nor the ledger", async (value) => {
    const response = await GET(request(`date=${encodeURIComponent(value)}`));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "invalid_date" });
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(mocks.getUser).not.toHaveBeenCalled();
    expect(ledgerMocks.ctor).not.toHaveBeenCalled();
  });

  it("rejects a future date with 400 future_date, touching neither auth nor the ledger", async () => {
    // System time stubbed to 2026-09-24 in beforeEach.
    const response = await GET(request("date=2026-09-25"));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "future_date" });
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(mocks.getUser).not.toHaveBeenCalled();
    expect(ledgerMocks.ctor).not.toHaveBeenCalled();
  });

  it("accepts today's own local date -- not \"future\"", async () => {
    useMinimalFakeLedger();

    const response = await GET(request("date=2026-09-24"));

    // Got PAST validation into real auth/ledger logic (no batch mocked -> not_found).
    expect(response.status).toBe(404);
    expect(mocks.getUser).toHaveBeenCalled();
  });
});

describe("GET /api/feed/archive -- not signed in", () => {
  it("returns 401 unauthenticated without constructing the ledger", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null } });

    const response = await GET(request("date=2026-09-20"));

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: "unauthenticated" });
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(ledgerMocks.ctor).not.toHaveBeenCalled();
  });

  it("returns 401 unauthenticated for the no-date list path too", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null } });

    const response = await GET(request());

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: "unauthenticated" });
    expect(ledgerMocks.ctor).not.toHaveBeenCalled();
  });
});

describe("GET /api/feed/archive -- ledger read failure", () => {
  it("returns 503 ledger_unavailable when readExclusions reports unavailable (with a date)", async () => {
    useMinimalFakeLedger();
    mocks.readExclusions.mockResolvedValue({ status: "unavailable" });

    const response = await GET(request("date=2026-09-20"));

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({ error: "ledger_unavailable" });
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(mocks.getBatch).not.toHaveBeenCalled();
  });

  it("returns 503 ledger_unavailable when readExclusions reports unavailable (no date -- list mode)", async () => {
    useMinimalFakeLedger();
    mocks.readExclusions.mockResolvedValue({ status: "unavailable" });

    const response = await GET(request());

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({ error: "ledger_unavailable" });
    expect(mocks.listServedBatchDates).not.toHaveBeenCalled();
  });
});

describe("GET /api/feed/archive?date=... -- archive by date", () => {
  it("returns 200 with the stored servedItems, in their exact frozen order, for a SERVED batch", async () => {
    useMinimalFakeLedger();
    const items = [{ id: "paper-b" }, { id: "paper-a" }]; // deliberately NOT alphabetical -- order must be preserved verbatim
    mocks.getBatch.mockResolvedValue({
      id: "batch-1",
      ownerId: "owner-1",
      localDate: "2026-09-20",
      papers: [],
      status: "served",
      createdAt: "2026-09-20T00:00:00.000Z",
      servedItems: items,
    });

    const response = await GET(request("date=2026-09-20"));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ date: "2026-09-20", batchStatus: "served", items });
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(mocks.getBatch).toHaveBeenCalledWith("owner-1", "2026-09-20");
  });

  it("returns 200 for an ACKNOWLEDGED batch too", async () => {
    useMinimalFakeLedger();
    mocks.getBatch.mockResolvedValue({
      id: "batch-1",
      ownerId: "owner-1",
      localDate: "2026-09-20",
      papers: [],
      status: "acknowledged",
      createdAt: "2026-09-20T00:00:00.000Z",
      servedItems: [{ id: "x" }],
    });

    const response = await GET(request("date=2026-09-20"));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ batchStatus: "acknowledged" });
  });

  it("returns [] items (never reconstructs) for a served batch with no stored servedItems -- a legacy pre-P4-S3 row", async () => {
    useMinimalFakeLedger();
    mocks.getBatch.mockResolvedValue({
      id: "batch-legacy",
      ownerId: "owner-1",
      localDate: "2026-09-01",
      papers: [{ key: "doi:a", aliases: [] }],
      status: "served",
      createdAt: "2026-09-01T00:00:00.000Z",
      // no servedItems field at all
    });

    const response = await GET(request("date=2026-09-01"));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ date: "2026-09-01", batchStatus: "served", items: [] });
    // Never falls back to the pipeline to reconstruct -- this route has no
    // access to runFeedPipeline at all (not imported), so there is nothing
    // to assert "not called" on; the empty-array response IS the proof.
  });

  it("returns 404 not_found when no batch exists for that date", async () => {
    useMinimalFakeLedger();
    mocks.getBatch.mockResolvedValue(null);

    const response = await GET(request("date=2026-09-20"));

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: "not_found" });
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
  });

  it("returns the EXACT SAME 404 not_found for a 'prepared'-only batch -- no existence oracle, never exposes an in-flight selection", async () => {
    useMinimalFakeLedger();
    mocks.getBatch.mockResolvedValue({
      id: "batch-1",
      ownerId: "owner-1",
      localDate: "2026-09-20",
      papers: [],
      status: "prepared",
      createdAt: "2026-09-20T00:00:00.000Z",
      servedItems: [{ id: "should-never-leak" }],
    });

    const response = await GET(request("date=2026-09-20"));

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: "not_found" });
  });

  it("uses ONLY the session's owner id -- an owner-shaped query param is ignored, never read", async () => {
    useMinimalFakeLedger();
    mocks.getUser.mockResolvedValue({ data: { user: { id: "real-owner" } } });
    mocks.getBatch.mockResolvedValue(null);

    await GET(request("date=2026-09-20&ownerId=someone-else&owner_id=someone-else"));

    expect(mocks.getBatch).toHaveBeenCalledWith("real-owner", "2026-09-20");
    expect(mocks.getBatch).not.toHaveBeenCalledWith("someone-else", expect.anything());
  });
});

describe("GET /api/feed/archive -- date list (no date param)", () => {
  it("returns 200 with the bounded, most-recent-first date list straight from the ledger", async () => {
    useMinimalFakeLedger();
    mocks.listServedBatchDates.mockResolvedValue(["2026-09-24", "2026-09-20"]);

    const response = await GET(request());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ dates: ["2026-09-24", "2026-09-20"] });
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(mocks.listServedBatchDates).toHaveBeenCalledWith("owner-1", 30);
    expect(mocks.getBatch).not.toHaveBeenCalled();
  });

  it("returns 200 with an empty list for an owner with nothing archived yet -- not an error", async () => {
    useMinimalFakeLedger();
    mocks.listServedBatchDates.mockResolvedValue([]);

    const response = await GET(request());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ dates: [] });
  });
});

describe("dashboard ledger end-to-end: archive stays stable across days (P4-S9 key property)", () => {
  it("a batch delivered and acknowledged on day 1 stays visible, unchanged, in the archive for day 1 even after day 2 excludes it from a new batch -- through the REAL feed, ack and archive routes sharing one ledger", async () => {
    vi.stubEnv("PEER_DASHBOARD_LEDGER", "on");
    stubSignedIn("owner-e2e");
    sharedMemoryLedger();

    const dayOnePaper = scoredItem("paper-day-one");
    mocks.runFeedPipeline.mockResolvedValueOnce({ items: [dayOnePaper], meta: baseMeta() });

    // Day 1: mint + serve, through the REAL feed route.
    const day1Feed = await postFeed(feedRequest({ topics: ["battery"] }));
    const day1FeedBody = await day1Feed.json();
    expect(day1FeedBody.meta.batchStatus).toBe("served");
    const batchId = day1FeedBody.meta.batchId as string;

    // Acknowledge, through the REAL ack route.
    const day1Ack = await postAck(ackRequest({ batchId }));
    expect(day1Ack.status).toBe(200);

    // Day 2: a new local day. A new batch is minted; day 1's acknowledged
    // paper must never return.
    vi.setSystemTime(new Date(2026, 8, 25, 9, 0));
    const dayTwoPaper = scoredItem("paper-day-two");
    mocks.runFeedPipeline.mockResolvedValueOnce({ items: [dayTwoPaper], meta: baseMeta() });

    const day2Feed = await postFeed(feedRequest({ topics: ["battery"] }));
    const day2FeedBody = await day2Feed.json();
    expect(day2FeedBody.meta.batchId).not.toBe(batchId);
    expect(day2FeedBody.items.map((i: { id: string }) => i.id)).toEqual(["paper-day-two"]);

    // THE KEY PROPERTY: the archive for day 1, read through the REAL
    // archive route sharing the SAME ledger instance, still returns day 1's
    // paper -- unchanged, un-excluded, exactly as it was served.
    const archiveDay1 = await GET(request("date=2026-09-24"));
    const archiveDay1Body = await archiveDay1.json();
    expect(archiveDay1.status).toBe(200);
    expect(archiveDay1Body.batchStatus).toBe("acknowledged");
    expect(archiveDay1Body.items.map((i: { id: string }) => i.id)).toEqual(["paper-day-one"]);

    // The bounded date list includes day 1.
    const archiveList = await GET(request());
    const archiveListBody = await archiveList.json();
    expect(archiveList.status).toBe(200);
    expect(archiveListBody.dates).toContain("2026-09-24");
  });
});

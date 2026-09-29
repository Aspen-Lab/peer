import { afterEach, describe, expect, it, vi } from "vitest";
import type { DashboardDeliveryLedger } from "./delivery-ledger";
import type { DashboardPrepareJob } from "./prepare-job-repository";
import { createPrepareAheadBuildPool } from "./prepare-pool";

// TRIGGER-A (ABC-JEV-INTEGRATION.md §1x; guide docs/jev-abc/
// TRIGGER-A-B-20260925T044825Z.md §3 Step 2). Mirrors
// web/src/app/api/jobs/dispatch-digests/route.test.ts's own `vi.hoisted`
// mocking convention for `createAdminClient`/`runFeedPipeline`.
const mocks = vi.hoisted(() => ({
  createAdminClient: vi.fn(),
  runFeedPipeline: vi.fn(),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: mocks.createAdminClient,
}));
vi.mock("@/lib/feed/pipeline", () => ({ runFeedPipeline: mocks.runFeedPipeline }));

afterEach(() => {
  vi.clearAllMocks();
});

const JOB: DashboardPrepareJob = {
  id: "job-1",
  ownerId: "owner-1",
  localDate: "2026-09-24",
  intentVersion: '{"version":"feed-intent-v1","requiredConcepts":["battery"]}',
  status: "leased",
  leaseOwner: "worker-A",
  leaseExpiresAt: new Date("2026-09-24T13:05:00.000Z").toISOString(),
  attempts: 1,
  maxAttempts: 5,
  nextAttemptAt: new Date("2026-09-24T12:00:00.000Z").toISOString(),
  createdAt: new Date("2026-09-24T10:00:00.000Z").toISOString(),
  updatedAt: new Date("2026-09-24T12:00:00.000Z").toISOString(),
};

const BASE_ROW = {
  user_id: "owner-1",
  display_name: null,
  research_topics: ["battery materials"],
  preferred_methods: [],
  current_project: null,
  current_challenges: null,
  disliked_topics: [],
  preference_ledger: null,
  feed_focus: null,
  feed_freshness: null,
  paper_count: 12,
  feed_source_mix: null,
  feed_importance: null,
  feed_method_mode: null,
  feed_discovery_mode: null,
  feed_avoid_reviews: null,
  feed_avoid_old_papers: null,
  feed_avoid_broad_surveys: null,
  digest_enabled: true,
  digest_hour_local: 8,
  digest_timezone: "UTC",
  digest_channel: "inapp" as const,
  digest_frequency: "daily" as const,
  digest_email: null,
};

const EMPTY_INTENT_ROW = {
  ...BASE_ROW,
  research_topics: [],
  current_project: null,
  current_challenges: null,
  disliked_topics: [],
};

function makeAdmin(options: {
  profile?: { data: unknown; error: unknown };
}) {
  const profile = options.profile ?? { data: BASE_ROW, error: null };
  const maybeSingle = vi.fn(async () => profile);
  const eq = vi.fn(() => ({ maybeSingle }));
  const select = vi.fn(() => ({ eq }));
  const from = vi.fn(() => ({ select }));
  return { from } as unknown as ReturnType<typeof mocks.createAdminClient>;
}

function makeLedger(overrides: Partial<Pick<DashboardDeliveryLedger, "readExclusions">> = {}) {
  return {
    readExclusions: vi.fn(async () => ({ status: "ok" as const, keys: new Set<string>() })),
    ...overrides,
  };
}

const SAMPLE_ITEM = {
  id: "paper-1",
  source: "openalex",
  title: "A battery paper",
  metadata: {},
};

describe("createPrepareAheadBuildPool", () => {
  it("happy path: builds a request from the profile row and returns papers mapped from the pipeline result", async () => {
    mocks.runFeedPipeline.mockResolvedValueOnce({ items: [SAMPLE_ITEM] });
    const admin = makeAdmin({});
    const ledger = makeLedger();
    const buildPool = createPrepareAheadBuildPool({ admin, ledger, now: () => new Date("2026-09-24T12:00:00.000Z") });

    const outcome = await buildPool(JOB);

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) throw new Error("unreachable");
    expect(outcome.papers).toHaveLength(1);
    expect(outcome.servedItems).toEqual([SAMPLE_ITEM]);
  });

  it("P8: always calls runFeedPipeline with aiTier 0, regardless of the owner's own entitlement", async () => {
    mocks.runFeedPipeline.mockResolvedValueOnce({ items: [] });
    const buildPool = createPrepareAheadBuildPool({ admin: makeAdmin({}), ledger: makeLedger() });
    await buildPool(JOB);
    expect(mocks.runFeedPipeline).toHaveBeenCalledWith(
      expect.objectContaining({ aiTier: 0 }),
      expect.anything(),
    );
  });

  it("P6: always passes explicit empty positiveSeeds/negativeSeedPaperIds arrays, never omits them", async () => {
    mocks.runFeedPipeline.mockResolvedValueOnce({ items: [] });
    const buildPool = createPrepareAheadBuildPool({ admin: makeAdmin({}), ledger: makeLedger() });
    await buildPool(JOB);
    expect(mocks.runFeedPipeline).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ positiveSeeds: [], negativeSeedPaperIds: [] }),
    );
  });

  it("P7b: never passes rolloverCandidates to runFeedPipeline (absent or empty) — a prepared batch's candidate pool can never include a paper that rolled over unshown from a prior day, unlike a same-moment visit mint; reading the rollover pool here later is a conscious decision (ABC-JEV-INTEGRATION.md §1x, finding F-TRIGGERA-A-01), not an oversight, and this test is the guard against it happening silently", async () => {
    mocks.runFeedPipeline.mockResolvedValueOnce({ items: [] });
    const buildPool = createPrepareAheadBuildPool({ admin: makeAdmin({}), ledger: makeLedger() });
    await buildPool(JOB);
    const options = mocks.runFeedPipeline.mock.calls[0]![1] as { rolloverCandidates?: readonly unknown[] };
    expect(options.rolloverCandidates === undefined || options.rolloverCandidates.length === 0).toBe(true);
  });

  it("threads the ledger's readExclusions result into ledgerExclusions", async () => {
    mocks.runFeedPipeline.mockResolvedValueOnce({ items: [] });
    const keys = new Set(["doi:10.1/already-delivered"]);
    const buildPool = createPrepareAheadBuildPool({
      admin: makeAdmin({}),
      ledger: makeLedger({ readExclusions: vi.fn(async () => ({ status: "ok" as const, keys })) }),
    });
    await buildPool(JOB);
    expect(mocks.runFeedPipeline).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ ledgerExclusions: keys }),
    );
  });

  it("profile not found -> {ok:false}, never calls runFeedPipeline", async () => {
    const buildPool = createPrepareAheadBuildPool({
      admin: makeAdmin({ profile: { data: null, error: null } }),
      ledger: makeLedger(),
    });
    const outcome = await buildPool(JOB);
    expect(outcome).toEqual({ ok: false, error: "profile_not_found" });
    expect(mocks.runFeedPipeline).not.toHaveBeenCalled();
  });

  it("profile read errors -> {ok:false}, never calls runFeedPipeline", async () => {
    const buildPool = createPrepareAheadBuildPool({
      admin: makeAdmin({ profile: { data: null, error: { message: "supabase down" } } }),
      ledger: makeLedger(),
    });
    const outcome = await buildPool(JOB);
    expect(outcome.ok).toBe(false);
    if (outcome.ok) throw new Error("unreachable");
    expect(outcome.error).toContain("profile_read_failed");
    expect(mocks.runFeedPipeline).not.toHaveBeenCalled();
  });

  it("no usable intent on the profile row -> {ok:false, error:'intent_required'}, never calls runFeedPipeline", async () => {
    const buildPool = createPrepareAheadBuildPool({
      admin: makeAdmin({ profile: { data: EMPTY_INTENT_ROW, error: null } }),
      ledger: makeLedger(),
    });
    const outcome = await buildPool(JOB);
    expect(outcome).toEqual({ ok: false, error: "intent_required" });
    expect(mocks.runFeedPipeline).not.toHaveBeenCalled();
  });

  it("ledger exclusions unavailable -> {ok:false, error:'ledger_unavailable'}, never calls runFeedPipeline (fails closed, same as a real visit)", async () => {
    const buildPool = createPrepareAheadBuildPool({
      admin: makeAdmin({}),
      ledger: makeLedger({ readExclusions: vi.fn(async () => ({ status: "unavailable" as const })) }),
    });
    const outcome = await buildPool(JOB);
    expect(outcome).toEqual({ ok: false, error: "ledger_unavailable" });
    expect(mocks.runFeedPipeline).not.toHaveBeenCalled();
  });

  it("runFeedPipeline throwing is caught and returned as a typed failure, never an unhandled rejection", async () => {
    mocks.runFeedPipeline.mockRejectedValueOnce(new Error("source outage"));
    const buildPool = createPrepareAheadBuildPool({ admin: makeAdmin({}), ledger: makeLedger() });
    const outcome = await buildPool(JOB);
    expect(outcome).toEqual({ ok: false, error: "source outage" });
  });
});

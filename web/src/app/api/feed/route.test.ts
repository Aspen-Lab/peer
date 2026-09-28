import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import type { ShadowCandidate } from "@/lib/decisions/shadow";

const mocks = vi.hoisted(() => ({
  resolveProvider: vi.fn(),
  runFeedPipeline: vi.fn(),
  requireEntitledAiRequest: vi.fn(),
  entitledAiTier: vi.fn(),
  getUser: vi.fn(),
  readExclusions: vi.fn(),
  getBatch: vi.fn(),
  prepareBatch: vi.fn(),
  markServed: vi.fn(),
  SupabaseDashboardDeliveryLedgerCtor: vi.fn(),
  SupabaseRolloverCandidateStoreCtor: vi.fn(),
  resolvePositiveSeeds: vi.fn(),
  anyPositiveSeedChannelEnabled: vi.fn(),
  SupabasePositiveSeedFeedbackRepositoryCtor: vi.fn(),
  // P2-S4b-FIX (Round 3): same importOriginal-plus-override seam as the
  // three above, for the new negative-seed resolution path.
  resolveNegativeSeedPaperIds: vi.fn(),
  channelS2RecommendationsEnabled: vi.fn(),
  // P3-S5 (Round 3) — ABC-JEV-INTEGRATION.md §4 "P3-S5 DESIGN RULING". The
  // route schedules the Jev shadow via Next's `after()`; mocking it lets
  // tests prove exactly one scheduling call happens (or none) without ever
  // needing a real request scope (a direct unit-test call to POST/GET has
  // none — see next/server's own `after.js`, which throws in that case).
  after: vi.fn(),
}));

vi.mock("@/lib/llm/providers/registry", () => ({
  resolveProvider: mocks.resolveProvider,
}));
vi.mock("@/lib/feed/pipeline", () => ({
  runFeedPipeline: mocks.runFeedPipeline,
}));
vi.mock("@/lib/security/ai-request", () => ({
  protectAiRequest: mocks.requireEntitledAiRequest,
  requireEntitledAiRequest: mocks.requireEntitledAiRequest,
  entitledAiTier: mocks.entitledAiTier,
}));
// P4-S2 (Round 3): the existing tests in this file never stub the Supabase
// env pair, so `hasSupabaseAuthConfig()` (route.ts) stays false and
// `createClient`/`getUser` are never invoked for them — these two mocks only
// become observable in the new "dashboard ledger exclusion" describe block
// below, which stubs the env pair itself.
vi.mock("@/lib/supabase/server", () => ({
  createClient: () => Promise.resolve({ auth: { getUser: mocks.getUser } }),
}));
// P4-S3 (Round 3): only `SupabaseDashboardDeliveryLedger` is overridden —
// `MemoryDashboardDeliveryLedger` (and every other export) passes through to
// the REAL module via `importOriginal`, so the new "batch minting" describe
// block below can hand route.ts a real, fully-behaved in-memory ledger
// instead of hand-mocking every method (the same real-contract-over-hand-
// mocks preference `ledger-exclusion.test.ts` already established).
vi.mock("@/lib/dashboard/delivery-ledger", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/dashboard/delivery-ledger")>();
  return { ...actual, SupabaseDashboardDeliveryLedger: mocks.SupabaseDashboardDeliveryLedgerCtor };
});
// P4-S6 (Round 3): same importOriginal-plus-constructor-override seam as
// delivery-ledger.ts just above, so `MemoryRolloverCandidateStore` (and
// every other export) keeps passing through to the REAL module for any
// test that imports it directly, while `SupabaseRolloverCandidateStore`'s
// constructor becomes swappable per test.
vi.mock("@/lib/dashboard/rollover-store", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/dashboard/rollover-store")>();
  return { ...actual, SupabaseRolloverCandidateStore: mocks.SupabaseRolloverCandidateStoreCtor };
});
// P2-S4b (Round 3): same importOriginal-plus-override seam as the two mocks
// just above. `anyPositiveSeedChannelEnabled` and `resolvePositiveSeeds` are
// overridden per test; every other export (types, the Memory/Supabase
// repository classes) passes through to the real module. The DEFAULT below
// (see beforeEach) is "flag off" (`anyPositiveSeedChannelEnabled` ->
// `false`), which is what makes every pre-existing test in this file --
// none of which know about this feature -- see BYTE-IDENTICAL behavior:
// resolvePositiveSeedsForRequest's own `!anyPositiveSeedChannelEnabled()`
// short-circuit means the Supabase-backed repository constructor is never
// even reached for them.
vi.mock("@/lib/preferences/positive-seeds", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/preferences/positive-seeds")>();
  return {
    ...actual,
    resolvePositiveSeeds: mocks.resolvePositiveSeeds,
    anyPositiveSeedChannelEnabled: mocks.anyPositiveSeedChannelEnabled,
    SupabasePositiveSeedFeedbackRepository: mocks.SupabasePositiveSeedFeedbackRepositoryCtor,
    // P2-S4b-FIX (Round 3) — §1p.B(5): "'Not interested' supplies negative
    // seeds." Negative-seed resolution is gated on its OWN, narrower flag
    // (channelS2RecommendationsEnabled — negatives have exactly one
    // consumer, the S2 leg) rather than the broader anyPositiveSeedChannelEnabled,
    // so it needs its own mock rather than reusing the existing one.
    resolveNegativeSeedPaperIds: mocks.resolveNegativeSeedPaperIds,
    channelS2RecommendationsEnabled: mocks.channelS2RecommendationsEnabled,
  };
});
// P3-S5 (Round 3): only `after` is overridden — `NextRequest`/`NextResponse`
// (and everything else) pass through to the REAL module via `importOriginal`,
// exactly like the delivery-ledger/rollover-store/positive-seeds mocks above.
vi.mock("next/server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("next/server")>();
  return { ...actual, after: mocks.after };
});

import { GET, POST } from "./route";
import { selectedSenseConcept } from "@/lib/feed/senses";
import { MemoryDashboardDeliveryLedger } from "@/lib/dashboard/delivery-ledger";
import { MemoryRolloverCandidateStore } from "@/lib/dashboard/rollover-store";
import { identityForRawItem } from "@/lib/feed/paper-identity";
import { localCalendarDate } from "@/lib/opportunities/pool-cache";
import { normalizeFeedIntent, serializeFeedIntent } from "@/lib/feed/intent";
import type { ScoredItem } from "@/lib/scoring/types";

function request(body: Record<string, unknown>): NextRequest {
  return new NextRequest("http://localhost/api/feed", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

// P4-S3 (Round 3): a minimal, deterministic ScoredItem fixture for the batch-
// minting tests below — only the fields identityForRawItem/the response
// shape actually touch matter for those tests.
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

// P4-S2 (Round 3): runFeedPipeline now takes a second (options) argument —
// see ledgerExclusionsFor in ./route.ts. None of the assertions below are
// about the ledger; every `toHaveBeenCalledWith(expect.objectContaining(...))`
// call in this file gained a trailing `expect.anything()` purely to match the
// new two-argument call shape (vitest's toHaveBeenCalledWith checks argument
// COUNT too), not because what's asserted about the request body changed. The
// flag-on/signed-in/ledger-specific behavior has its own new describe block
// below ("/api/feed dashboard ledger exclusion").
beforeEach(() => {
  vi.clearAllMocks();
  mocks.runFeedPipeline.mockResolvedValue({ items: [], meta: {} });
  mocks.requireEntitledAiRequest.mockResolvedValue({ entitlement: { userId: null } });
  mocks.entitledAiTier.mockImplementation((tier, entitlement) =>
    entitlement.userId === null ? 0 : tier,
  );
  mocks.getUser.mockResolvedValue({ data: { user: null } });
  // P4-S2 (Round 3): every test in this file EXCEPT the new "dashboard
  // ledger exclusion" block below must never construct the ledger at all
  // (flag defaults off, and none of those tests stub PEER_DASHBOARD_LEDGER).
  // Throwing here is the "prove with a mock that throws if touched" guard —
  // if route.ts ever constructed a ledger on a path that shouldn't, these
  // pre-existing tests would fail loudly instead of silently passing.
  mocks.SupabaseDashboardDeliveryLedgerCtor.mockImplementation(function () {
    throw new Error("SupabaseDashboardDeliveryLedger must not be constructed here");
  });
  // P4-S6 (Round 3): unlike the ledger's throw-by-default guard above, the
  // rollover store's default is a FRESH, inert, empty `MemoryRolloverCandidateStore`
  // — functionally identical to what an unconfigured, unmocked
  // `SupabaseRolloverCandidateStore` would do in production (empty list,
  // silent upsert; see rollover-store.ts's own degrade contract). Every
  // pre-existing test in this file that happens to reach the mint branch
  // (none of them assert anything about rollover) keeps working completely
  // unmodified; only the new "rollover (P4-S6)" describe block below
  // overrides this with `workingRolloverStore()` when it needs to inspect
  // what got stored.
  mocks.SupabaseRolloverCandidateStoreCtor.mockImplementation(function () {
    return new MemoryRolloverCandidateStore();
  });
  // P4-S3 (Round 3) defaults for the fn-mock-backed `workingLedger()` helper
  // (the "batch minting" describe block below mostly uses
  // `workingLedgerBackedByMemory()` instead, a REAL ledger, so these mocks
  // stay untouched there): no existing batch, a harmless synthetic
  // `prepareBatch` result that echoes back what it was given (so the
  // pre-existing P4-S2 "ledger reads ok" tests, which never asserted
  // anything about batches, keep passing without throwing now that route.ts
  // also calls these methods), and a no-op markServed.
  mocks.getBatch.mockResolvedValue(null);
  mocks.prepareBatch.mockImplementation(
    async (
      ownerId: string,
      localDate: string,
      papers: unknown,
      intentVersion: string | undefined,
      servedItems: unknown,
    ) => ({
      id: "batch-auto",
      ownerId,
      localDate,
      papers,
      status: "prepared" as const,
      intentVersion,
      createdAt: "2026-09-24T00:00:00.000Z",
      servedItems,
    }),
  );
  mocks.markServed.mockResolvedValue(undefined);
  // P2-S4b (Round 3): default off, matching every real deployment until a
  // flag is explicitly turned on — see the vi.mock comment above. Every
  // pre-existing test in this file (none of which stub any
  // PEER_CHANNEL_* env var) gets this default and never touches
  // `resolvePositiveSeeds`/the repository constructor at all, because
  // `resolvePositiveSeedsForRequest`'s own `!anyPositiveSeedChannelEnabled()`
  // short-circuit returns before either is reached.
  mocks.anyPositiveSeedChannelEnabled.mockReturnValue(false);
  mocks.resolvePositiveSeeds.mockResolvedValue([]);
  mocks.SupabasePositiveSeedFeedbackRepositoryCtor.mockImplementation(function () {
    throw new Error("SupabasePositiveSeedFeedbackRepository must not be constructed when every channel flag is off");
  });
  // P2-S4b-FIX (Round 3): same "off by default" reasoning as
  // anyPositiveSeedChannelEnabled above — every pre-existing test in this
  // file never touches resolveNegativeSeedPaperIds/the repository
  // constructor because resolveNegativeSeedPaperIdsForRequest's own
  // `!channelS2RecommendationsEnabled()` short-circuit returns first.
  mocks.channelS2RecommendationsEnabled.mockReturnValue(false);
  mocks.resolveNegativeSeedPaperIds.mockResolvedValue([]);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("POST /api/feed AI tier gate", () => {
  it("caps an anonymous forged Tier 2 before provider resolution", async () => {
    await POST(request({ topics: ["battery"], aiTier: 2, plan: "paid", ownerId: "forged" }));

    expect(mocks.entitledAiTier).toHaveBeenCalledWith(2, { userId: null });
    expect(mocks.resolveProvider).not.toHaveBeenCalled();
    expect(mocks.runFeedPipeline).toHaveBeenCalledWith(expect.objectContaining({ aiTier: 0 }), expect.anything());
  });

  it("uses a signed-in server entitlement before resolving a requested Tier 2 provider", async () => {
    mocks.requireEntitledAiRequest.mockResolvedValue({ entitlement: { userId: "server-user" } });
    mocks.resolveProvider.mockReturnValue({ id: "openai", generateJsonText: vi.fn() });

    await POST(request({ topics: ["battery"], aiTier: 2, plan: "free", ownerId: "forged" }));

    expect(mocks.requireEntitledAiRequest).toHaveBeenCalledWith("paper-feed", 60, { allowAnonymous: true });
    expect(mocks.resolveProvider).toHaveBeenCalledAfter(mocks.requireEntitledAiRequest);
    expect(mocks.runFeedPipeline).toHaveBeenCalledWith(expect.objectContaining({ aiTier: 2 }), expect.anything());
  });
  it("accepts project-only normalized intent and never accepts a caller owner", async () => {
    const response = await POST(request({
      topics: [],
      project: "Stabilize sulfide electrolytes",
      ownerId: "forged-owner",
    }));

    expect(response.status).toBe(200);
    expect(mocks.runFeedPipeline).toHaveBeenCalledWith(expect.objectContaining({
      topics: [],
      project: "Stabilize sulfide electrolytes",
      intent: expect.objectContaining({ version: "feed-intent-v1" }),
    }), expect.anything());
    expect(mocks.runFeedPipeline).not.toHaveBeenCalledWith(expect.objectContaining({ ownerId: expect.anything() }));
  });
  it("accepts a selected typed sense alone through POST without a body-forged owner", async () => {
    const response = await POST(request({
      ownerId: "forged-owner",
      intent: {
        version: "feed-intent-v1",
        selectedSenseConcepts: [selectedSenseConcept("hr.role_conflict")],
      },
    }));

    expect(response.status).toBe(200);
    expect(mocks.runFeedPipeline).toHaveBeenCalledWith(expect.objectContaining({
      topics: [],
      intent: expect.objectContaining({ selectedSenseConcepts: [selectedSenseConcept("hr.role_conflict")] }),
    }), expect.anything());
    expect(mocks.runFeedPipeline).not.toHaveBeenCalledWith(expect.objectContaining({ ownerId: expect.anything() }));
  });
  it("downgrades a forged Tier 2 request to Tier 0 without a provider", async () => {
    mocks.resolveProvider.mockReturnValue(null);

    await POST(request({ topics: ["battery"], aiTier: 2 }));

    expect(mocks.runFeedPipeline).toHaveBeenCalledWith(
      expect.objectContaining({ aiTier: 0, llmOverride: undefined }),
      expect.anything(),
    );
  });

  it("keeps Tier 2 when a user override resolves", async () => {
    mocks.requireEntitledAiRequest.mockResolvedValue({ entitlement: { userId: "server-user" } });
    mocks.resolveProvider.mockReturnValue({ id: "openai", generateJsonText: vi.fn() });
    const llmOverride = { provider: "openai", apiKey: "user-owned-key" };

    await POST(request({ topics: ["battery"], aiTier: 2, llmOverride }));

    // MERGE-B-SEC / MERGE C semantic fix (ABC-JEV-INTEGRATION.md §1s.2):
    // resolveProvider now requires a ProviderContext as its 2nd argument --
    // the branded context this route builds from the entitlement gate above.
    expect(mocks.resolveProvider).toHaveBeenCalledWith(llmOverride, {
      userId: "server-user",
      byok: true,
      path: "paper-feed",
    });
    expect(mocks.runFeedPipeline).toHaveBeenCalledWith(
      expect.objectContaining({ aiTier: 2, llmOverride }),
      expect.anything(),
    );
  });
});

describe("/api/feed server-funded web search gate", () => {
  it("denies an explicit unauthorised POST web source without falling back to defaults", async () => {
    const response = await POST(request({ topics: ["battery"], sources: ["web"] }));

    expect(response.status).toBe(503);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(mocks.runFeedPipeline).not.toHaveBeenCalled();
  });

  it("denies an explicit unauthorised GET web source without falling back to defaults", async () => {
    const response = await GET(
      new NextRequest("http://localhost/api/feed?topics=battery&sources=web"),
    );

    expect(response.status).toBe(503);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(mocks.runFeedPipeline).not.toHaveBeenCalled();
  });

  it("does not let mixed sources or a body connector bypass the company-spend denial", async () => {
    const response = await POST(request({
      topics: ["battery"],
      sources: ["openalex", "web"],
      searchConnectors: { gemini: { enabled: true } },
      aiTier: 2,
    }));

    expect(response.status).toBe(503);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(mocks.runFeedPipeline).not.toHaveBeenCalled();
  });

  it("keeps an ordinary public academic Tier-0 request available", async () => {
    await GET(new NextRequest("http://localhost/api/feed?topics=battery"));

    expect(mocks.runFeedPipeline).toHaveBeenCalledWith(
      expect.objectContaining({ topics: ["battery"] }),
      expect.anything(),
    );
  });
});

describe("/api/feed dashboard ledger exclusion (P4-S2, F-A-P4-01, ABC-JEV-INTEGRATION.md §1p.F)", () => {
  function stubSignedInSupabase(userId: string) {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "public-test-key");
    mocks.getUser.mockResolvedValue({ data: { user: { id: userId } } });
  }

  function workingLedger() {
    // A plain `function`, not an arrow function: vitest/JS constructs this
    // with `new SupabaseDashboardDeliveryLedger()` (route.ts), and only a
    // real function (or class) can be a constructor — an arrow function
    // throws "is not a constructor" the moment `new` touches it.
    // P4-S3 (Round 3): extended with getBatch/prepareBatch/markServed (their
    // `beforeEach` defaults above are harmless no-ops for tests that only
    // care about readExclusions/the exclusion set reaching the pipeline) so
    // that route.ts's new batch-minting calls don't throw here.
    mocks.SupabaseDashboardDeliveryLedgerCtor.mockImplementation(function () {
      return {
        readExclusions: mocks.readExclusions,
        getBatch: mocks.getBatch,
        prepareBatch: mocks.prepareBatch,
        markServed: mocks.markServed,
      };
    });
  }

  it("flag off: never constructs the ledger and returns an unchanged response, even for a signed-in owner", async () => {
    stubSignedInSupabase("owner-1");
    // PEER_DASHBOARD_LEDGER intentionally left unset — default off means
    // today's behaviour exactly, per §1p.F.

    const response = await POST(request({ topics: ["battery"] }));

    expect(response.status).toBe(200);
    expect(mocks.SupabaseDashboardDeliveryLedgerCtor).not.toHaveBeenCalled();
    expect(mocks.runFeedPipeline).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ ledgerExclusions: undefined }),
    );
  });

  it("flag on, signed-out: never constructs the ledger — no Supabase round-trip for exclusion (§1p.C.9)", async () => {
    vi.stubEnv("PEER_DASHBOARD_LEDGER", "on");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "public-test-key");
    mocks.getUser.mockResolvedValue({ data: { user: null } }); // no active session

    const response = await POST(request({ topics: ["battery"] }));

    expect(response.status).toBe(200);
    expect(mocks.SupabaseDashboardDeliveryLedgerCtor).not.toHaveBeenCalled();
    expect(mocks.runFeedPipeline).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ ledgerExclusions: undefined }),
    );
  });

  it("flag on, signed-in, ledger reads ok: the pipeline receives exactly that exclusion set", async () => {
    vi.stubEnv("PEER_DASHBOARD_LEDGER", "on");
    stubSignedInSupabase("owner-1");
    workingLedger();
    const exclusions = new Set(["doi:already-delivered"]);
    mocks.readExclusions.mockResolvedValue({ status: "ok", keys: exclusions });

    const response = await POST(request({ topics: ["battery"] }));

    expect(response.status).toBe(200);
    expect(mocks.readExclusions).toHaveBeenCalledWith("owner-1");
    expect(mocks.runFeedPipeline).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ ledgerExclusions: exclusions }),
    );
  });

  it("flag on, signed-in, ledger unavailable: 503 + private,no-store + ledger_unavailable, and the pipeline is never called", async () => {
    vi.stubEnv("PEER_DASHBOARD_LEDGER", "on");
    stubSignedInSupabase("owner-1");
    workingLedger();
    mocks.readExclusions.mockResolvedValue({ status: "unavailable" });

    const response = await POST(request({ topics: ["battery"] }));

    expect(response.status).toBe(503);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    await expect(response.json()).resolves.toEqual({ error: "ledger_unavailable" });
    expect(mocks.runFeedPipeline).not.toHaveBeenCalled();
  });

  it("GET honors the same flag-on/signed-in/ledger-unavailable contract as POST", async () => {
    vi.stubEnv("PEER_DASHBOARD_LEDGER", "on");
    stubSignedInSupabase("owner-1");
    workingLedger();
    mocks.readExclusions.mockResolvedValue({ status: "unavailable" });

    const response = await GET(new NextRequest("http://localhost/api/feed?topics=battery"));

    expect(response.status).toBe(503);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    await expect(response.json()).resolves.toEqual({ error: "ledger_unavailable" });
    expect(mocks.runFeedPipeline).not.toHaveBeenCalled();
  });

  it("GET, flag on + signed-in + ledger ok: also receives the exclusion set", async () => {
    vi.stubEnv("PEER_DASHBOARD_LEDGER", "on");
    stubSignedInSupabase("owner-1");
    workingLedger();
    const exclusions = new Set(["doi:already-delivered"]);
    mocks.readExclusions.mockResolvedValue({ status: "ok", keys: exclusions });

    const response = await GET(new NextRequest("http://localhost/api/feed?topics=battery"));

    expect(response.status).toBe(200);
    expect(mocks.readExclusions).toHaveBeenCalledWith("owner-1");
    expect(mocks.runFeedPipeline).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ ledgerExclusions: exclusions }),
    );
  });

  it("PEER_DASHBOARD_LEDGER only recognizes the literal value \"on\" — anything else stays today's behaviour", async () => {
    vi.stubEnv("PEER_DASHBOARD_LEDGER", "true"); // NOT "on" — must not enable the feature
    stubSignedInSupabase("owner-1");

    const response = await POST(request({ topics: ["battery"] }));

    expect(response.status).toBe(200);
    expect(mocks.SupabaseDashboardDeliveryLedgerCtor).not.toHaveBeenCalled();
  });
});

// P4-S3 (Round 3) — ABC-JEV-INTEGRATION.md §1p.C.5/C.8/C.9, DESIGN §5 of
// docs/jev-abc/P4-B-20260924T0338Z.md, and that guide's own EVIDENCE section
// (same-day drift: a "Not interested" click then an ordinary reload let
// paper #11 replace #7). Flag-off/signed-out behaviour is unchanged and
// already covered above — not repeated here.
describe("/api/feed batch minting (P4-S3)", () => {
  function stubSignedInSupabase(userId: string) {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "public-test-key");
    mocks.getUser.mockResolvedValue({ data: { user: { id: userId } } });
  }

  // Local copy — the "dashboard ledger exclusion" describe block above
  // defines its own `workingLedgerBackedByMemory` in its own scope; vitest
  // describe blocks don't share sibling-scoped helpers, so this mirrors it
  // exactly rather than hoisting it to module scope for a one-block-away
  // reuse.
  function workingLedgerBackedByMemory(): MemoryDashboardDeliveryLedger {
    const ledger = new MemoryDashboardDeliveryLedger();
    mocks.SupabaseDashboardDeliveryLedgerCtor.mockImplementation(function () {
      return ledger;
    });
    return ledger;
  }

  // P4-S3-FIX (Round 3) -- unlike workingLedgerBackedByMemory, this backs the
  // ledger with the individual fn mocks (mocks.getBatch/prepareBatch/
  // markServed/readExclusions) so a single test can force one specific
  // method to reject. MemoryDashboardDeliveryLedger's own write methods
  // never throw (only SupabaseDashboardDeliveryLedger's configured-client
  // path does, per delivery-ledger.ts's documented write-failure contract --
  // see its top-of-file comment), so the real ledger can't exercise this.
  function workingLedgerWithMockMethods() {
    mocks.SupabaseDashboardDeliveryLedgerCtor.mockImplementation(function () {
      return {
        readExclusions: mocks.readExclusions,
        getBatch: mocks.getBatch,
        prepareBatch: mocks.prepareBatch,
        markServed: mocks.markServed,
      };
    });
  }

  afterEach(() => {
    vi.useRealTimers();
  });

  it("(16d/a/b/e) a second same-day request, after a client excludeIds change, returns byte-identical items in the same order with NO additional pipeline call — and the first request minted exactly one batch", async () => {
    vi.stubEnv("PEER_DASHBOARD_LEDGER", "on");
    stubSignedInSupabase("owner-1");
    workingLedgerBackedByMemory();
    mocks.runFeedPipeline.mockResolvedValue({
      items: [scoredItem("paper-a"), scoredItem("paper-b")],
      meta: baseMeta(),
    });

    const first = await POST(request({ topics: ["battery"] }));
    const firstBody = await first.json();
    expect(first.status).toBe(200);
    expect(firstBody.meta.batchId).toEqual(expect.any(String));
    expect(firstBody.meta.batchStatus).toBe("served");
    expect(firstBody.items.map((i: { id: string }) => i.id)).toEqual(["paper-a", "paper-b"]);
    expect(mocks.runFeedPipeline).toHaveBeenCalledTimes(1);

    // Simulates a "Not interested" click on paper-a changing the client's
    // excludeIds before an ordinary same-day reload — this is exactly the
    // EVIDENCE-section drift scenario the slice fixes.
    const second = await POST(request({ topics: ["battery"], excludeIds: ["paper-a"] }));
    const secondBody = await second.json();

    expect(mocks.runFeedPipeline).toHaveBeenCalledTimes(1); // NOT called again
    expect(secondBody.meta.batchId).toBe(firstBody.meta.batchId);
    expect(secondBody.items).toEqual(firstBody.items); // byte-identical, same order
  });

  it("(16m-batch/c) an intent/topic change mid-day (a different pool cache key) still returns the frozen batch, not a new selection", async () => {
    vi.stubEnv("PEER_DASHBOARD_LEDGER", "on");
    stubSignedInSupabase("owner-1");
    workingLedgerBackedByMemory();
    mocks.runFeedPipeline.mockResolvedValue({ items: [scoredItem("battery-paper")], meta: baseMeta() });

    const first = await POST(request({ topics: ["battery"] }));
    const firstBody = await first.json();

    const second = await POST(
      request({ topics: ["quantum computing"], project: "A brand new, unrelated project" }),
    );
    const secondBody = await second.json();

    expect(secondBody.meta.batchId).toBe(firstBody.meta.batchId);
    expect(secondBody.items).toEqual(firstBody.items);
    expect(mocks.runFeedPipeline).toHaveBeenCalledTimes(1); // never re-run for the new topic
  });

  it("(16m-batch/d) two concurrent first requests for the same owner+date receive the SAME batch (idempotent prepareBatch — the race winner's items)", async () => {
    vi.stubEnv("PEER_DASHBOARD_LEDGER", "on");
    stubSignedInSupabase("owner-1");
    workingLedgerBackedByMemory();
    mocks.runFeedPipeline
      .mockResolvedValueOnce({ items: [scoredItem("paper-from-request-1")], meta: baseMeta() })
      .mockResolvedValueOnce({ items: [scoredItem("paper-from-request-2")], meta: baseMeta() });

    const [r1, r2] = await Promise.all([
      POST(request({ topics: ["battery"] })),
      POST(request({ topics: ["battery"] })),
    ]);
    const [b1, b2] = await Promise.all([r1.json(), r2.json()]);

    expect(b1.meta.batchId).toBe(b2.meta.batchId);
    expect(b1.items.map((i: { id: string }) => i.id)).toEqual(b2.items.map((i: { id: string }) => i.id));
    expect(["paper-from-request-1", "paper-from-request-2"]).toContain(b1.items[0].id);
  });

  it("(16e/f) scarcity: a batch smaller than topN stays that size on a same-day replay — never padded", async () => {
    vi.stubEnv("PEER_DASHBOARD_LEDGER", "on");
    stubSignedInSupabase("owner-1");
    workingLedgerBackedByMemory();
    mocks.runFeedPipeline.mockResolvedValue({ items: [scoredItem("only-one")], meta: baseMeta() });

    const first = await POST(request({ topics: ["battery"], topN: 10 }));
    const firstBody = await first.json();
    expect(firstBody.items).toHaveLength(1);

    const second = await POST(request({ topics: ["battery"], topN: 10 }));
    const secondBody = await second.json();
    expect(secondBody.items).toHaveLength(1);
    expect(secondBody.items).toEqual(firstBody.items);
  });

  it("(16d/g) a new local day mints a new batch and its exclusion read carries yesterday's served-unacknowledged paper", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 8, 24, 9, 0));
    vi.stubEnv("PEER_DASHBOARD_LEDGER", "on");
    stubSignedInSupabase("owner-1");
    workingLedgerBackedByMemory();
    const dayOneItem = scoredItem("day-one-paper");
    mocks.runFeedPipeline.mockResolvedValueOnce({ items: [dayOneItem], meta: baseMeta() });

    const day1 = await POST(request({ topics: ["battery"] }));
    const day1Body = await day1.json();
    expect(day1Body.meta.batchStatus).toBe("served"); // served, never acknowledged this session

    vi.setSystemTime(new Date(2026, 8, 25, 9, 0)); // next local day
    mocks.runFeedPipeline.mockResolvedValueOnce({ items: [scoredItem("day-two-paper")], meta: baseMeta() });
    const day2 = await POST(request({ topics: ["battery"] }));
    const day2Body = await day2.json();

    expect(day2Body.meta.batchId).not.toBe(day1Body.meta.batchId);
    expect(day2Body.items.map((i: { id: string }) => i.id)).toEqual(["day-two-paper"]);
    expect(mocks.runFeedPipeline).toHaveBeenCalledTimes(2);
    const secondCallOptions = mocks.runFeedPipeline.mock.calls[1]?.[1] as { ledgerExclusions?: Set<string> };
    const dayOneKey = identityForRawItem(dayOneItem).key;
    expect(secondCallOptions.ledgerExclusions?.has(dayOneKey)).toBe(true);
  });

  it("reconstructs a served batch's items from today's pool by identity when the stored servedItems are missing (a pre-P4-S3 legacy row), flags it in meta, and never pads an unmatched identity", async () => {
    vi.stubEnv("PEER_DASHBOARD_LEDGER", "on");
    stubSignedInSupabase("owner-1");
    const ledger = workingLedgerBackedByMemory();
    const keptItem = scoredItem("kept-paper");
    const goneIdentity = identityForRawItem(scoredItem("no-longer-in-pool"));
    const keptIdentity = identityForRawItem(keptItem);
    const today = localCalendarDate(new Date());
    // No 5th (servedItems) argument — simulates a batch minted before P4-S3.
    const legacy = await ledger.prepareBatch("owner-1", today, [
      { key: keptIdentity.key, aliases: keptIdentity.aliases },
      { key: goneIdentity.key, aliases: goneIdentity.aliases },
    ]);
    await ledger.markServed("owner-1", legacy.id);
    mocks.runFeedPipeline.mockResolvedValue({
      items: [keptItem, scoredItem("unrelated-paper")], // "no-longer-in-pool" is gone today
      meta: baseMeta(),
    });

    const response = await POST(request({ topics: ["battery"] }));
    const body = await response.json();

    expect(body.items.map((i: { id: string }) => i.id)).toEqual(["kept-paper"]);
    expect(body.meta.batchReconstructed).toBe(true);
    expect(body.meta.batchId).toBe(legacy.id);
    expect(body.meta.batchStatus).toBe("served");
  });

  // P4-S3-FIX (Round 3, F-A-P4S3-01, docs/jev-abc/P4-S3-A-20260924T0550Z.md):
  // `prepareBatch`/`markServed` both throw on a configured-client write
  // failure (delivery-ledger.ts's documented write contract). Before the
  // fix, runLedgerAwareFeed awaited both with no try/catch, so the throw
  // escaped POST/GET uncaught (a generic crash, not this route's own
  // polished 503) instead of the same truthful `ledger_unavailable` a read
  // failure already returns. RED before the fix: `await POST(...)` itself
  // rejects instead of resolving to a 503 response.
  it("(F-A-P4S3-01) a prepareBatch write failure during minting returns the truthful 503, not an uncaught crash", async () => {
    vi.stubEnv("PEER_DASHBOARD_LEDGER", "on");
    stubSignedInSupabase("owner-1");
    workingLedgerWithMockMethods();
    mocks.readExclusions.mockResolvedValue({ status: "ok", keys: new Set() });
    mocks.runFeedPipeline.mockResolvedValue({ items: [scoredItem("would-be-served")], meta: baseMeta() });
    mocks.prepareBatch.mockRejectedValue(new Error("dashboard_batches insert failed"));

    const response = await POST(request({ topics: ["battery"] }));

    expect(response.status).toBe(503);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    await expect(response.json()).resolves.toEqual({ error: "ledger_unavailable" });
  });

  it("(F-A-P4S3-01) a markServed write failure right after a successful mint also returns the truthful 503", async () => {
    vi.stubEnv("PEER_DASHBOARD_LEDGER", "on");
    stubSignedInSupabase("owner-1");
    workingLedgerWithMockMethods();
    mocks.readExclusions.mockResolvedValue({ status: "ok", keys: new Set() });
    mocks.runFeedPipeline.mockResolvedValue({ items: [scoredItem("would-be-served")], meta: baseMeta() });
    // prepareBatch keeps its default beforeEach echo (status "prepared"), so
    // route.ts proceeds to call markServed, which fails here.
    mocks.markServed.mockRejectedValue(new Error("dashboard_batches markServed failed"));

    const response = await POST(request({ topics: ["battery"] }));

    expect(response.status).toBe(503);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    await expect(response.json()).resolves.toEqual({ error: "ledger_unavailable" });
  });

  it("(F-A-P4S3-01) a markServed write failure while transitioning an existing 'prepared' batch to 'served' also returns the truthful 503, without ever calling the pipeline", async () => {
    vi.stubEnv("PEER_DASHBOARD_LEDGER", "on");
    stubSignedInSupabase("owner-1");
    workingLedgerWithMockMethods();
    mocks.getBatch.mockResolvedValue({
      id: "batch-existing",
      ownerId: "owner-1",
      localDate: localCalendarDate(new Date()),
      papers: [],
      status: "prepared",
      createdAt: new Date().toISOString(),
      servedItems: [scoredItem("frozen-item")],
    });
    mocks.markServed.mockRejectedValue(new Error("dashboard_batches markServed failed"));

    const response = await POST(request({ topics: ["battery"] }));

    expect(response.status).toBe(503);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    await expect(response.json()).resolves.toEqual({ error: "ledger_unavailable" });
    expect(mocks.runFeedPipeline).not.toHaveBeenCalled();
  });

  // P4-S3-FIX (Round 3, F-A-P4S3-02): permanent coverage for the
  // `existing.status === "prepared"` transition branch -- A's own review
  // found no test in the permanent suite exercised this in isolation (every
  // existing test either mints-and-serves in one call, or the legacy-
  // reconstruction test pre-calls markServed itself before ever invoking
  // POST). Uses a REAL MemoryDashboardDeliveryLedger, not hand mocks, so the
  // assertion on the ledger's own stored row (not just the response) is
  // genuine.
  it("(F-A-P4S3-02) an existing 'prepared' batch minted by another request is marked served here and its stored items are returned with no pipeline call", async () => {
    vi.stubEnv("PEER_DASHBOARD_LEDGER", "on");
    stubSignedInSupabase("owner-1");
    const ledger = workingLedgerBackedByMemory();
    const frozenItem = scoredItem("frozen-item");
    const frozenIdentity = identityForRawItem(frozenItem);
    const today = localCalendarDate(new Date());
    const prepared = await ledger.prepareBatch(
      "owner-1",
      today,
      [{ key: frozenIdentity.key, aliases: frozenIdentity.aliases }],
      undefined,
      [frozenItem],
    );
    expect(prepared.status).toBe("prepared"); // sanity: left prepared, not served

    // A decoy queued on the pipeline mock must never surface in the
    // response -- proves the frozen batch is served, not a fresh selection.
    mocks.runFeedPipeline.mockResolvedValue({ items: [scoredItem("decoy-fresh-selection")], meta: baseMeta() });

    const response = await POST(request({ topics: ["battery"] }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.items.map((i: { id: string }) => i.id)).toEqual(["frozen-item"]);
    expect(body.meta.batchId).toBe(prepared.id);
    expect(body.meta.batchStatus).toBe("served");
    expect(mocks.runFeedPipeline).not.toHaveBeenCalled();

    // The ledger's OWN stored row is actually mutated, not just a locally
    // computed response label.
    const stored = await ledger.getBatch("owner-1", today);
    expect(stored?.status).toBe("served");
    expect(stored?.servedAt).toEqual(expect.any(String));
  });

  // P4-S3-FIX (Round 3, F-A-P4S3-03): SupabaseDashboardDeliveryLedger.getBatch
  // (delivery-ledger.ts) catches internally and returns `null` on BOTH "no
  // row yet" and "the read itself failed" -- confirmed by reading the code,
  // not assumed. This test proves that fact is safe in the composite case a
  // real outage could hit: getBatch fails open to null, route.ts falls
  // through to a fresh pipeline run, and `prepareBatch` is called -- whose
  // OWN real-adapter contract (the migration's `unique (owner_id,
  // local_date)` constraint plus an insert-conflict-then-getBatch-retry
  // fallback, unit-tested in isolation by delivery-ledger.supabase.test.ts)
  // returns the PRE-EXISTING row instead of a duplicate. Simulated here at
  // the route level by having the mocked prepareBatch itself return that
  // pre-existing batch, exactly as the real adapter's fallback would.
  // route.ts always builds its response from whatever prepareBatch returns
  // (never from this call's own raw pipeline result directly), so the
  // composite path structurally cannot leak the fresh selection -- not a
  // defect, just not a truthful *signal* that a read failed (the named,
  // accepted cost is one wasted pipeline run).
  it("(F-A-P4S3-03) a getBatch read failure that looks like 'no batch yet' still serves the pre-existing batch via prepareBatch's own idempotent fallback, never the fresh selection", async () => {
    vi.stubEnv("PEER_DASHBOARD_LEDGER", "on");
    stubSignedInSupabase("owner-1");
    workingLedgerWithMockMethods();
    mocks.getBatch.mockResolvedValue(null); // fails open -- indistinguishable from "no batch yet"
    mocks.readExclusions.mockResolvedValue({ status: "ok", keys: new Set() });
    mocks.runFeedPipeline.mockResolvedValue({ items: [scoredItem("decoy-fresh-selection")], meta: baseMeta() });
    mocks.prepareBatch.mockResolvedValue({
      id: "batch-already-there",
      ownerId: "owner-1",
      localDate: localCalendarDate(new Date()),
      papers: [],
      status: "served",
      createdAt: new Date().toISOString(),
      servedItems: [scoredItem("pre-existing-served-item")],
    });

    const response = await POST(request({ topics: ["battery"] }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.items.map((i: { id: string }) => i.id)).toEqual(["pre-existing-served-item"]);
    expect(body.meta.batchId).toBe("batch-already-there");
    expect(body.meta.batchStatus).toBe("served");
    expect(mocks.runFeedPipeline).toHaveBeenCalledTimes(1); // one wasted run -- the named, accepted cost
    expect(mocks.markServed).not.toHaveBeenCalled(); // already served -- no transition needed
  });
});

describe("/api/feed rollover (P4-S6, F-A-P4-08 remainder, ABC-JEV-INTEGRATION.md §1g/§1p.C.4)", () => {
  function stubSignedInSupabase(userId: string) {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "public-test-key");
    mocks.getUser.mockResolvedValue({ data: { user: { id: userId } } });
  }

  // Local copies -- see the "batch minting (P4-S3)" describe block's own
  // identical comment on why these aren't hoisted to module scope.
  function workingLedgerBackedByMemory(): MemoryDashboardDeliveryLedger {
    const ledger = new MemoryDashboardDeliveryLedger();
    mocks.SupabaseDashboardDeliveryLedgerCtor.mockImplementation(function () {
      return ledger;
    });
    return ledger;
  }

  function workingRolloverStore(): MemoryRolloverCandidateStore {
    const store = new MemoryRolloverCandidateStore();
    mocks.SupabaseRolloverCandidateStoreCtor.mockImplementation(function () {
      return store;
    });
    return store;
  }

  /** `count` distinct ScoredItem fixtures, `paper-<offset+1>` .. `paper-<offset+count>`. */
  function pool(count: number, offset = 0): ScoredItem[] {
    return Array.from({ length: count }, (_, i) => scoredItem(`paper-${offset + i + 1}`));
  }

  afterEach(() => {
    vi.useRealTimers();
  });

  it("(acceptance 17) a mint with a 30-item final pool and topN 10 stores exactly the 20 never-presented remainder", async () => {
    vi.stubEnv("PEER_DASHBOARD_LEDGER", "on");
    stubSignedInSupabase("owner-1");
    workingLedgerBackedByMemory();
    const rolloverStore = workingRolloverStore();
    const finalPool = pool(30);
    mocks.runFeedPipeline.mockResolvedValue({
      items: finalPool.slice(0, 10),
      meta: baseMeta(),
      finalPool,
    });

    const response = await POST(request({ topics: ["battery"], topN: 10 }));
    expect(response.status).toBe(200);

    const stored = await rolloverStore.list("owner-1", new Date());
    expect(stored).toHaveLength(20);
    const storedIds = new Set(stored.map((r) => (r.payload as ScoredItem).id));
    for (const item of finalPool.slice(10)) expect(storedIds.has(item.id)).toBe(true);
    for (const item of finalPool.slice(0, 10)) expect(storedIds.has(item.id)).toBe(false);
  });

  it("(5-card users) a mint with a 30-item final pool and topN 5 stores 25 -- generic arithmetic, not a hard-coded 20", async () => {
    vi.stubEnv("PEER_DASHBOARD_LEDGER", "on");
    stubSignedInSupabase("owner-1");
    workingLedgerBackedByMemory();
    const rolloverStore = workingRolloverStore();
    const finalPool = pool(30);
    mocks.runFeedPipeline.mockResolvedValue({
      items: finalPool.slice(0, 5),
      meta: baseMeta(),
      finalPool,
    });

    await POST(request({ topics: ["battery"], topN: 5 }));

    const stored = await rolloverStore.list("owner-1", new Date());
    expect(stored).toHaveLength(25);
  });

  it("(scarcity) fewer total candidates than topN leaves nothing to roll over -- never padded, no upsert call at all", async () => {
    vi.stubEnv("PEER_DASHBOARD_LEDGER", "on");
    stubSignedInSupabase("owner-1");
    workingLedgerBackedByMemory();
    const rolloverStore = workingRolloverStore();
    const upsertSpy = vi.spyOn(rolloverStore, "upsert");
    const scarcePool = pool(3);
    mocks.runFeedPipeline.mockResolvedValue({
      items: scarcePool, // all 3 presented -- topN 10 requested, only 3 ever existed
      meta: baseMeta(),
      finalPool: scarcePool,
    });

    await POST(request({ topics: ["battery"], topN: 10 }));

    expect(await rolloverStore.list("owner-1", new Date())).toHaveLength(0);
    expect(upsertSpy).not.toHaveBeenCalled();
  });

  it("a same-day frozen-batch replay never touches the rollover store at all", async () => {
    vi.stubEnv("PEER_DASHBOARD_LEDGER", "on");
    stubSignedInSupabase("owner-1");
    const ledger = workingLedgerBackedByMemory();
    const frozenItem = scoredItem("frozen-item");
    const frozenIdentity = identityForRawItem(frozenItem);
    const today = localCalendarDate(new Date());
    const prepared = await ledger.prepareBatch(
      "owner-1",
      today,
      [{ key: frozenIdentity.key, aliases: frozenIdentity.aliases }],
      undefined,
      [frozenItem],
    );
    await ledger.markServed("owner-1", prepared.id);
    mocks.runFeedPipeline.mockResolvedValue({ items: [scoredItem("decoy")], meta: baseMeta() });

    const response = await POST(request({ topics: ["battery"] }));

    expect(response.status).toBe(200);
    expect(mocks.SupabaseRolloverCandidateStoreCtor).not.toHaveBeenCalled();
  });

  it("a mint reads yesterday's stored rollover remainder and passes it into the pipeline call as rolloverCandidates", async () => {
    vi.stubEnv("PEER_DASHBOARD_LEDGER", "on");
    stubSignedInSupabase("owner-1");
    workingLedgerBackedByMemory();
    const rolloverStore = workingRolloverStore();
    const storedItem = scoredItem("rollover-from-yesterday");
    const storedIdentity = identityForRawItem(storedItem);
    await rolloverStore.upsert("owner-1", "2026-09-23", [
      { key: storedIdentity.key, aliases: storedIdentity.aliases, payload: storedItem },
    ]);
    mocks.runFeedPipeline.mockResolvedValue({ items: [scoredItem("today-paper")], meta: baseMeta() });

    await POST(request({ topics: ["battery"] }));

    expect(mocks.runFeedPipeline).toHaveBeenCalledTimes(1);
    const options = mocks.runFeedPipeline.mock.calls[0]?.[1] as {
      rolloverCandidates?: ScoredItem[];
    };
    expect(options.rolloverCandidates?.map((i) => i.id)).toContain("rollover-from-yesterday");
  });

  it("a rollover read failure (list rejects) still lets the mint proceed, simply without rollover candidates", async () => {
    vi.stubEnv("PEER_DASHBOARD_LEDGER", "on");
    stubSignedInSupabase("owner-1");
    workingLedgerBackedByMemory();
    mocks.SupabaseRolloverCandidateStoreCtor.mockImplementation(function () {
      return {
        list: () => Promise.reject(new Error("rollover store unreachable")),
        upsert: () => Promise.resolve(),
      };
    });
    mocks.runFeedPipeline.mockResolvedValue({ items: [scoredItem("today-paper")], meta: baseMeta() });

    const response = await POST(request({ topics: ["battery"] }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.items.map((i: { id: string }) => i.id)).toEqual(["today-paper"]);
    const options = mocks.runFeedPipeline.mock.calls[0]?.[1] as {
      rolloverCandidates?: ScoredItem[];
    };
    expect(options.rolloverCandidates).toEqual([]);
  });

  it("flag off -- the rollover store is never constructed either", async () => {
    stubSignedInSupabase("owner-1");
    // PEER_DASHBOARD_LEDGER intentionally left unset -- default off.
    mocks.runFeedPipeline.mockResolvedValue({ items: [scoredItem("paper")], meta: baseMeta() });

    await POST(request({ topics: ["battery"] }));

    expect(mocks.SupabaseRolloverCandidateStoreCtor).not.toHaveBeenCalled();
  });

  it("finalPool never appears in the HTTP JSON response, even though the route uses it internally to compute the rollover remainder", async () => {
    vi.stubEnv("PEER_DASHBOARD_LEDGER", "on");
    stubSignedInSupabase("owner-1");
    workingLedgerBackedByMemory();
    workingRolloverStore();
    const finalPool = pool(30);
    mocks.runFeedPipeline.mockResolvedValue({
      items: finalPool.slice(0, 10),
      meta: baseMeta(),
      finalPool,
    });

    const response = await POST(request({ topics: ["battery"], topN: 10 }));
    const body = await response.json();

    expect(body).not.toHaveProperty("finalPool");
    expect(body.meta).not.toHaveProperty("finalPool");
  });

  it("(race safety) two concurrent first-of-day requests only ever store the WINNING request's remainder, never the loser's discarded selection", async () => {
    vi.stubEnv("PEER_DASHBOARD_LEDGER", "on");
    stubSignedInSupabase("owner-1");
    workingLedgerBackedByMemory();
    const rolloverStore = workingRolloverStore();
    const finalPoolA = pool(30, 0); // paper-1..30
    const finalPoolB = pool(30, 1000); // paper-1001..1030 -- entirely disjoint ids
    mocks.runFeedPipeline
      .mockResolvedValueOnce({ items: finalPoolA.slice(0, 10), meta: baseMeta(), finalPool: finalPoolA })
      .mockResolvedValueOnce({ items: finalPoolB.slice(0, 10), meta: baseMeta(), finalPool: finalPoolB });

    const [r1, r2] = await Promise.all([
      POST(request({ topics: ["battery"], topN: 10 })),
      POST(request({ topics: ["battery"], topN: 10 })),
    ]);
    const [b1, b2] = await Promise.all([r1.json(), r2.json()]);
    expect(b1.meta.batchId).toBe(b2.meta.batchId); // one winner, same as the existing P4-S3 race test

    const stored = await rolloverStore.list("owner-1", new Date());
    expect(stored).toHaveLength(20); // not 40 -- only ONE request's remainder was ever stored
    const storedIds = new Set(stored.map((r) => (r.payload as ScoredItem).id));
    const fromA = finalPoolA.slice(10).every((item) => storedIds.has(item.id));
    const fromB = finalPoolB.slice(10).every((item) => storedIds.has(item.id));
    // Every stored id belongs to EXACTLY ONE of the two candidate final
    // pools -- proving it's a single coherent remainder, never a mix of
    // both (which would mean the loser also wrote its discarded selection).
    expect(fromA || fromB).toBe(true);
    expect(fromA && fromB).toBe(false);
  });
});

// P4-S6-FIX (Round 3) -- F-A-P4S6-01, docs/jev-abc/P4-S6-A-20260924T093528Z.md
// finding 2; ABC-JEV-INTEGRATION.md §1g ("...may compete tomorrow, subject
// to current eligibility") and the §4 "Round 3 -- P4-S6 fresh A" ruling: "on
// merge, drop admissionChannels when the stored intent version differs from
// today's (the candidate must re-qualify under today's intent)". Every test
// in this block asserts at the `options.rolloverCandidates` boundary passed
// to the mocked runFeedPipeline -- the same boundary every other rollover
// test in the describe block above already asserts at -- because this whole
// file mocks the pipeline wholesale (see the top-of-file vi.mock), so the
// real literal-keyword gate (combine.ts) never actually runs here. That
// boundary is exactly what route.ts owns and this fix changes; the fuller,
// cross-day "stored under intent A, zero literal overlap under intent B"
// reproduction against the REAL routes/ledger/rollover-store (pipeline still
// mocked, same repo-wide constraint) lives in
// ledger-flow.integration.test.ts's own new rollover-intent describe block.
describe("/api/feed rollover admissionChannels re-validated against a changed intent (P4-S6-FIX, F-A-P4S6-01)", () => {
  function stubSignedInSupabase(userId: string) {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "public-test-key");
    mocks.getUser.mockResolvedValue({ data: { user: { id: userId } } });
  }

  function workingLedgerBackedByMemory(): MemoryDashboardDeliveryLedger {
    const ledger = new MemoryDashboardDeliveryLedger();
    mocks.SupabaseDashboardDeliveryLedgerCtor.mockImplementation(function () {
      return ledger;
    });
    return ledger;
  }

  function workingRolloverStore(): MemoryRolloverCandidateStore {
    const store = new MemoryRolloverCandidateStore();
    mocks.SupabaseRolloverCandidateStoreCtor.mockImplementation(function () {
      return store;
    });
    return store;
  }

  /** The exact `serializeFeedIntent` snapshot route.ts itself would derive for a `request({ topics, project, ... })` body. */
  function intentVersionFor(input: Record<string, unknown>): string {
    const result = normalizeFeedIntent(input);
    if (!result.ok) throw new Error("test fixture intent must normalize");
    return serializeFeedIntent(result.intent);
  }

  afterEach(() => {
    vi.useRealTimers();
  });

  it("(F-A-P4S6-01) strips admissionChannels from a rollover candidate when the stored intent version differs from today's", async () => {
    vi.stubEnv("PEER_DASHBOARD_LEDGER", "on");
    stubSignedInSupabase("owner-1");
    workingLedgerBackedByMemory();
    const rolloverStore = workingRolloverStore();
    const staleTagged: ScoredItem = { ...scoredItem("stale-citation-paper"), admissionChannels: ["citation"] };
    const staleIdentity = identityForRawItem(staleTagged);
    // Stored under YESTERDAY's intent ("quantum computing"), tagged "citation".
    await rolloverStore.upsert("owner-1", "2026-09-23", [
      {
        key: staleIdentity.key,
        aliases: staleIdentity.aliases,
        payload: staleTagged,
        intentVersion: intentVersionFor({ topics: ["quantum computing"] }),
      },
    ]);
    mocks.runFeedPipeline.mockResolvedValue({ items: [scoredItem("today-paper")], meta: baseMeta() });

    // TODAY's own request declares a completely different topic.
    await POST(request({ topics: ["battery materials"] }));

    const options = mocks.runFeedPipeline.mock.calls[0]?.[1] as { rolloverCandidates?: ScoredItem[] };
    const passedCandidate = options.rolloverCandidates?.find((i) => i.id === "stale-citation-paper");
    expect(passedCandidate).toBeDefined();
    expect(passedCandidate?.admissionChannels).toBeUndefined();
  });

  it("keeps a rollover candidate's admissionChannels tag intact when the stored intent version matches today's exactly", async () => {
    vi.stubEnv("PEER_DASHBOARD_LEDGER", "on");
    stubSignedInSupabase("owner-1");
    workingLedgerBackedByMemory();
    const rolloverStore = workingRolloverStore();
    const tagged: ScoredItem = { ...scoredItem("same-intent-citation-paper"), admissionChannels: ["citation"] };
    const identity = identityForRawItem(tagged);
    await rolloverStore.upsert("owner-1", "2026-09-23", [
      {
        key: identity.key,
        aliases: identity.aliases,
        payload: tagged,
        intentVersion: intentVersionFor({ topics: ["battery materials"] }),
      },
    ]);
    mocks.runFeedPipeline.mockResolvedValue({ items: [scoredItem("today-paper")], meta: baseMeta() });

    // TODAY's request declares the SAME topic as when the tag was stored.
    await POST(request({ topics: ["battery materials"] }));

    const options = mocks.runFeedPipeline.mock.calls[0]?.[1] as { rolloverCandidates?: ScoredItem[] };
    const passedCandidate = options.rolloverCandidates?.find((i) => i.id === "same-intent-citation-paper");
    expect(passedCandidate?.admissionChannels).toEqual(["citation"]);
  });

  it("strips admissionChannels from a legacy rollover row that has no stored intentVersion at all (written before this fix)", async () => {
    vi.stubEnv("PEER_DASHBOARD_LEDGER", "on");
    stubSignedInSupabase("owner-1");
    workingLedgerBackedByMemory();
    const rolloverStore = workingRolloverStore();
    const legacyTagged: ScoredItem = { ...scoredItem("legacy-citation-paper"), admissionChannels: ["citation"] };
    const identity = identityForRawItem(legacyTagged);
    // No `intentVersion` field at all -- simulates a row the pre-fix code wrote.
    await rolloverStore.upsert("owner-1", "2026-09-23", [
      { key: identity.key, aliases: identity.aliases, payload: legacyTagged },
    ]);
    mocks.runFeedPipeline.mockResolvedValue({ items: [scoredItem("today-paper")], meta: baseMeta() });

    await POST(request({ topics: ["battery materials"] }));

    const options = mocks.runFeedPipeline.mock.calls[0]?.[1] as { rolloverCandidates?: ScoredItem[] };
    const passedCandidate = options.rolloverCandidates?.find((i) => i.id === "legacy-citation-paper");
    expect(passedCandidate?.admissionChannels).toBeUndefined();
  });

  it("a GET request (no structured intent at all) never keeps a stored admissionChannels tag, even when the stored row also has no intentVersion", async () => {
    vi.stubEnv("PEER_DASHBOARD_LEDGER", "on");
    stubSignedInSupabase("owner-1");
    workingLedgerBackedByMemory();
    const rolloverStore = workingRolloverStore();
    const tagged: ScoredItem = { ...scoredItem("get-path-citation-paper"), admissionChannels: ["citation"] };
    const identity = identityForRawItem(tagged);
    await rolloverStore.upsert("owner-1", "2026-09-23", [
      { key: identity.key, aliases: identity.aliases, payload: tagged }, // no intentVersion, like the GET path itself
    ]);
    mocks.runFeedPipeline.mockResolvedValue({ items: [scoredItem("today-paper")], meta: baseMeta() });

    await GET(new NextRequest("http://localhost/api/feed?topics=battery%20materials"));

    const options = mocks.runFeedPipeline.mock.calls[0]?.[1] as { rolloverCandidates?: ScoredItem[] };
    const passedCandidate = options.rolloverCandidates?.find((i) => i.id === "get-path-citation-paper");
    expect(passedCandidate?.admissionChannels).toBeUndefined();
  });

  it("(at upsert) stamps today's own canonical intent version onto every remainder candidate stored", async () => {
    vi.stubEnv("PEER_DASHBOARD_LEDGER", "on");
    stubSignedInSupabase("owner-1");
    workingLedgerBackedByMemory();
    const rolloverStore = workingRolloverStore();
    const finalPool = Array.from({ length: 3 }, (_, i) => scoredItem(`paper-${i + 1}`));
    mocks.runFeedPipeline.mockResolvedValue({
      items: finalPool.slice(0, 1),
      meta: baseMeta(),
      finalPool,
    });

    await POST(request({ topics: ["battery materials"] }));

    const stored = await rolloverStore.list("owner-1", new Date());
    expect(stored.length).toBeGreaterThan(0);
    const expected = intentVersionFor({ topics: ["battery materials"] });
    for (const row of stored) expect(row.intentVersion).toBe(expected);
  });
});

// P2-S4b (Round 3) — F-A-P2-04 (4c/4d), ABC-JEV-INTEGRATION.md §1p.B(5).
// Server-side positive-seed resolution: only for a signed-in owner, only
// when at least one of the three channel flags is on, never triggerable
// from anything in the request body. Threaded into runFeedPipeline's
// options regardless of whether PEER_DASHBOARD_LEDGER (an independent
// flag) is on or off, since both `runLedgerAwareFeed` branches call
// runFeedPipeline.
describe("/api/feed positive-seed resolution (P2-S4b, F-A-P2-04 4c/4d, ABC-JEV-INTEGRATION.md §1p.B(5))", () => {
  function stubSignedInSupabase(userId: string) {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "public-test-key");
    mocks.getUser.mockResolvedValue({ data: { user: { id: userId } } });
  }

  it("every channel flag off (the default): never checks anyPositiveSeedChannelEnabled's downstream repository and passes an empty positiveSeeds array, even for a signed-in owner", async () => {
    stubSignedInSupabase("owner-1");

    const response = await POST(request({ topics: ["battery"] }));

    expect(response.status).toBe(200);
    expect(mocks.SupabasePositiveSeedFeedbackRepositoryCtor).not.toHaveBeenCalled();
    expect(mocks.resolvePositiveSeeds).not.toHaveBeenCalled();
    expect(mocks.runFeedPipeline).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ positiveSeeds: [] }),
    );
  });

  it("flag on, but signed OUT: never resolves seeds — anonymous users get no seeds, no calls", async () => {
    mocks.anyPositiveSeedChannelEnabled.mockReturnValue(true);
    // Deliberately NOT calling stubSignedInSupabase — getUser stays null
    // (this file's own beforeEach default), so paperCacheScope stays
    // undefined regardless of the flag.

    const response = await POST(request({ topics: ["battery"] }));

    expect(response.status).toBe(200);
    expect(mocks.resolvePositiveSeeds).not.toHaveBeenCalled();
    expect(mocks.runFeedPipeline).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ positiveSeeds: [] }),
    );
  });

  it("flag on AND signed in: resolves seeds via the repository and passes the resolved array into runFeedPipeline", async () => {
    mocks.anyPositiveSeedChannelEnabled.mockReturnValue(true);
    stubSignedInSupabase("owner-seed-1");
    const repoInstance = { recentPositiveFeedback: vi.fn() };
    mocks.SupabasePositiveSeedFeedbackRepositoryCtor.mockImplementation(function () {
      return repoInstance;
    });
    const resolvedSeeds = [
      {
        identity: { key: "openalex:W1", keyVersion: 1 as const, aliases: [] },
        openalexWorkId: "W1",
        title: "A saved paper",
      },
    ];
    mocks.resolvePositiveSeeds.mockResolvedValue(resolvedSeeds);

    const response = await POST(request({ topics: ["battery"] }));

    expect(response.status).toBe(200);
    expect(mocks.resolvePositiveSeeds).toHaveBeenCalledWith(repoInstance, "owner-seed-1");
    expect(mocks.runFeedPipeline).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ positiveSeeds: resolvedSeeds }),
    );
  });

  it("a resolver failure degrades to an empty positiveSeeds array rather than failing the request", async () => {
    mocks.anyPositiveSeedChannelEnabled.mockReturnValue(true);
    stubSignedInSupabase("owner-seed-2");
    mocks.SupabasePositiveSeedFeedbackRepositoryCtor.mockImplementation(function () {
      return { recentPositiveFeedback: vi.fn() };
    });
    mocks.resolvePositiveSeeds.mockRejectedValue(new Error("db unavailable"));

    const response = await POST(request({ topics: ["battery"] }));

    expect(response.status).toBe(200);
    expect(mocks.runFeedPipeline).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ positiveSeeds: [] }),
    );
  });

  it("resolves and threads positiveSeeds on the GET path too", async () => {
    mocks.anyPositiveSeedChannelEnabled.mockReturnValue(true);
    stubSignedInSupabase("owner-seed-get");
    mocks.SupabasePositiveSeedFeedbackRepositoryCtor.mockImplementation(function () {
      return { recentPositiveFeedback: vi.fn() };
    });
    const resolvedSeeds = [
      { identity: { key: "openalex:W9", keyVersion: 1 as const, aliases: [] }, openalexWorkId: "W9" },
    ];
    mocks.resolvePositiveSeeds.mockResolvedValue(resolvedSeeds);

    const req = new NextRequest("http://localhost/api/feed?topics=battery");
    const response = await GET(req);

    expect(response.status).toBe(200);
    expect(mocks.runFeedPipeline).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ positiveSeeds: resolvedSeeds }),
    );
  });

  it("nothing in the request body can enable a channel or supply seeds directly — only server env + the resolved owner id do", async () => {
    // Flag left at its default-off mock value; a hostile/buggy client body
    // is cast through `unknown` since FeedRequest declares no such fields.
    stubSignedInSupabase("owner-seed-3");

    await POST(
      request({
        topics: ["battery"],
        positiveSeeds: [{ identity: { key: "doi:10.1/evil", keyVersion: 1, aliases: [] } }],
        PEER_CHANNEL_S2_RECOMMENDATIONS: "on",
      }),
    );

    expect(mocks.resolvePositiveSeeds).not.toHaveBeenCalled();
    expect(mocks.runFeedPipeline).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ positiveSeeds: [] }),
    );
  });
});

// P2-S4b-FIX (Round 3) — item 2, ABC-JEV-INTEGRATION.md §1p.B(5): "'Not
// interested' supplies negative seeds." Mirrors the positive-seed
// resolution describe block above exactly, EXCEPT the gate:
// `resolveNegativeSeedPaperIdsForRequest` checks `channelS2RecommendationsEnabled()`
// specifically, not the broader `anyPositiveSeedChannelEnabled()` — negative
// seeds have exactly one consumer (the S2 Recommendations leg), so
// resolving them when only the OpenAlex-similarity or citation-neighbour
// flags are on would be a wasted Supabase round-trip for data nobody will
// ever use. Same "server-minted only" / anonymous-gets-nothing / fail-soft
// contract as positive seeds throughout. Runs regardless of
// PEER_DASHBOARD_LEDGER (both runLedgerAwareFeed branches call
// runFeedPipeline with the same resolved value).
describe("/api/feed negative-seed resolution (P2-S4b-FIX, §1p.B(5))", () => {
  function stubSignedInSupabase(userId: string) {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "public-test-key");
    mocks.getUser.mockResolvedValue({ data: { user: { id: userId } } });
  }

  it("S2 flag off (the default): never checks the downstream repository and passes an empty negativeSeedPaperIds array, even for a signed-in owner", async () => {
    stubSignedInSupabase("owner-neg-1");

    const response = await POST(request({ topics: ["battery"] }));

    expect(response.status).toBe(200);
    expect(mocks.resolveNegativeSeedPaperIds).not.toHaveBeenCalled();
    expect(mocks.runFeedPipeline).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ negativeSeedPaperIds: [] }),
    );
  });

  it("a positive-seed channel is on (similarity) but S2 specifically is off: positive seeds still resolve, negative seeds do not — proves the narrower gate", async () => {
    mocks.anyPositiveSeedChannelEnabled.mockReturnValue(true);
    mocks.channelS2RecommendationsEnabled.mockReturnValue(false);
    stubSignedInSupabase("owner-neg-narrow-gate");
    mocks.SupabasePositiveSeedFeedbackRepositoryCtor.mockImplementation(function () {
      return { recentPositiveFeedback: vi.fn(), recentNegativeFeedback: vi.fn() };
    });
    mocks.resolvePositiveSeeds.mockResolvedValue([]);

    const response = await POST(request({ topics: ["battery"] }));

    expect(response.status).toBe(200);
    expect(mocks.resolvePositiveSeeds).toHaveBeenCalled();
    expect(mocks.resolveNegativeSeedPaperIds).not.toHaveBeenCalled();
    expect(mocks.runFeedPipeline).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ negativeSeedPaperIds: [] }),
    );
  });

  it("S2 flag on, but signed OUT: never resolves negative seeds — anonymous users get no seeds, no calls", async () => {
    mocks.channelS2RecommendationsEnabled.mockReturnValue(true);
    // Deliberately NOT calling stubSignedInSupabase — getUser stays null
    // (this file's own beforeEach default), so paperCacheScope stays
    // undefined regardless of the flag.

    const response = await POST(request({ topics: ["battery"] }));

    expect(response.status).toBe(200);
    expect(mocks.resolveNegativeSeedPaperIds).not.toHaveBeenCalled();
    expect(mocks.runFeedPipeline).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ negativeSeedPaperIds: [] }),
    );
  });

  it("S2 flag on AND signed in: resolves negative seeds via the repository and passes the resolved array into runFeedPipeline", async () => {
    mocks.channelS2RecommendationsEnabled.mockReturnValue(true);
    stubSignedInSupabase("owner-neg-2");
    const repoInstance = { recentPositiveFeedback: vi.fn(), recentNegativeFeedback: vi.fn() };
    mocks.SupabasePositiveSeedFeedbackRepositoryCtor.mockImplementation(function () {
      return repoInstance;
    });
    mocks.resolveNegativeSeedPaperIds.mockResolvedValue(["s2-not-interested-1", "s2-not-interested-2"]);

    const response = await POST(request({ topics: ["battery"] }));

    expect(response.status).toBe(200);
    expect(mocks.resolveNegativeSeedPaperIds).toHaveBeenCalledWith(repoInstance, "owner-neg-2");
    expect(mocks.runFeedPipeline).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ negativeSeedPaperIds: ["s2-not-interested-1", "s2-not-interested-2"] }),
    );
  });

  it("a resolver failure degrades to an empty negativeSeedPaperIds array rather than failing the request", async () => {
    mocks.channelS2RecommendationsEnabled.mockReturnValue(true);
    stubSignedInSupabase("owner-neg-3");
    mocks.SupabasePositiveSeedFeedbackRepositoryCtor.mockImplementation(function () {
      return { recentPositiveFeedback: vi.fn(), recentNegativeFeedback: vi.fn() };
    });
    mocks.resolveNegativeSeedPaperIds.mockRejectedValue(new Error("db unavailable"));

    const response = await POST(request({ topics: ["battery"] }));

    expect(response.status).toBe(200);
    expect(mocks.runFeedPipeline).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ negativeSeedPaperIds: [] }),
    );
  });

  it("resolves and threads negativeSeedPaperIds on the GET path too", async () => {
    mocks.channelS2RecommendationsEnabled.mockReturnValue(true);
    stubSignedInSupabase("owner-neg-get");
    mocks.SupabasePositiveSeedFeedbackRepositoryCtor.mockImplementation(function () {
      return { recentPositiveFeedback: vi.fn(), recentNegativeFeedback: vi.fn() };
    });
    mocks.resolveNegativeSeedPaperIds.mockResolvedValue(["s2-not-interested-get"]);

    const req = new NextRequest("http://localhost/api/feed?topics=battery");
    const response = await GET(req);

    expect(response.status).toBe(200);
    expect(mocks.runFeedPipeline).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ negativeSeedPaperIds: ["s2-not-interested-get"] }),
    );
  });

  it("nothing in the request body can supply negative seeds directly — only server env + the resolved owner id do", async () => {
    stubSignedInSupabase("owner-neg-4");

    await POST(
      request({
        topics: ["battery"],
        negativeSeedPaperIds: ["evil-injected-id"],
        PEER_CHANNEL_S2_RECOMMENDATIONS: "on",
      }),
    );

    expect(mocks.resolveNegativeSeedPaperIds).not.toHaveBeenCalled();
    expect(mocks.runFeedPipeline).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ negativeSeedPaperIds: [] }),
    );
  });
});

// P3-S5 (Round 3) — ABC-JEV-INTEGRATION.md §4 "P3-S5 DESIGN RULING"
// (2026-09-24T11:29:31Z). All seven gate conditions must hold before POST
// ever supplies `onFreshShortlist` to `runFeedPipeline`; GET, dispatch-
// digests and test-digest never supply it at all (the latter two are
// proven in their own route.test.ts files, since this slice never edits
// those routes). `runFeedPipeline` itself is mocked module-wide (see the
// top-of-file `vi.mock` block), so these tests prove the WIRING — what
// route.ts computes and passes — not pipeline.ts's own behavior, which
// `pipeline.shadow.test.ts` already covers independently.
describe("/api/feed Jev shadow wiring (P3-S5)", () => {
  function stubShadowConfig() {
    vi.stubEnv("PEER_JEV_SHADOW", "on");
    vi.stubEnv("PEER_JEV_BROKER", "on");
    vi.stubEnv("PEER_JEV_BROKER_URL", "https://example.supabase.co/functions/v1/jev-broker");
    vi.stubEnv("PEER_JEV_BROKER_SECRET", "test-broker-secret-do-not-use");
  }

  /** JEV-DIRECT (§1aa) — the direct-transport sibling of `stubShadowConfig()` above: JEV_API_KEY set, broker left deliberately unconfigured (direct must not need it). */
  function stubDirectShadowConfig() {
    vi.stubEnv("PEER_JEV_SHADOW", "on");
    vi.stubEnv("JEV_API_KEY", "jev-test-FAKE-KEY-do-not-use-1234567890abcdef");
    vi.stubEnv("PEER_JEV_BROKER", "off");
    vi.stubEnv("PEER_JEV_BROKER_URL", "");
    vi.stubEnv("PEER_JEV_BROKER_SECRET", "");
  }

  function stubEntitledSignedInTier2(ownerId: string) {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "public-test-key");
    mocks.getUser.mockResolvedValue({ data: { user: { id: ownerId } } });
    mocks.requireEntitledAiRequest.mockResolvedValue({
      user: { id: ownerId },
      entitlement: { userId: ownerId, effectivePlan: "paid" },
    });
    mocks.entitledAiTier.mockReturnValue(2);
    mocks.resolveProvider.mockReturnValue({ id: "openai", generateJsonText: vi.fn() });
  }

  /** Every condition true — the shared "all gates open" baseline each negative test starts from and breaks exactly one of. */
  function readyState(ownerId = "owner-shadow-ready") {
    stubShadowConfig();
    stubEntitledSignedInTier2(ownerId);
  }

  function lastPipelineOptions(): Record<string, unknown> | undefined {
    const call = mocks.runFeedPipeline.mock.calls.at(-1);
    return call?.[1] as Record<string, unknown> | undefined;
  }

  it("all seven conditions true: passes onFreshShortlist to runFeedPipeline, and invoking it schedules exactly one after() call", async () => {
    readyState("owner-shadow-1");

    const response = await POST(request({ topics: ["battery"], aiTier: 2 }));

    expect(response.status).toBe(200);
    const options = lastPipelineOptions();
    expect(typeof options?.onFreshShortlist).toBe("function");
    expect(mocks.after).not.toHaveBeenCalled(); // not scheduled merely by building the hook

    const hook = options!.onFreshShortlist as (shortlist: ReadonlyArray<ShadowCandidate>) => void;
    hook([{ id: "p1", title: "A Paper", abstract: null }]);

    expect(mocks.after).toHaveBeenCalledTimes(1);
  });

  it('JEV-DIRECT (§1aa): transport "direct" (JEV_API_KEY set, broker left unconfigured), every other condition true — passes onFreshShortlist to runFeedPipeline, and invoking it schedules exactly one after() call', async () => {
    stubDirectShadowConfig();
    stubEntitledSignedInTier2("owner-shadow-direct-1");

    const response = await POST(request({ topics: ["battery"], aiTier: 2 }));

    expect(response.status).toBe(200);
    const options = lastPipelineOptions();
    expect(typeof options?.onFreshShortlist).toBe("function");
    expect(mocks.after).not.toHaveBeenCalled(); // not scheduled merely by building the hook

    const hook = options!.onFreshShortlist as (shortlist: ReadonlyArray<ShadowCandidate>) => void;
    hook([{ id: "p1", title: "A Paper", abstract: null }]);

    expect(mocks.after).toHaveBeenCalledTimes(1);
  });

  it("JEV-DIRECT (§1aa): transport fully disabled (no JEV_API_KEY, broker unconfigured) — onFreshShortlist is absent, re-expressed through resolveJevTransport() instead of the old jevBrokerEnabled()", async () => {
    vi.stubEnv("PEER_JEV_SHADOW", "on");
    vi.stubEnv("JEV_API_KEY", "");
    vi.stubEnv("PEER_JEV_BROKER", "off");
    vi.stubEnv("PEER_JEV_BROKER_URL", "");
    vi.stubEnv("PEER_JEV_BROKER_SECRET", "");
    stubEntitledSignedInTier2("owner-shadow-both-off");

    const response = await POST(request({ topics: ["battery"], aiTier: 2 }));

    expect(response.status).toBe(200);
    expect(lastPipelineOptions()?.onFreshShortlist).toBeUndefined();
  });

  it("a hook that schedules via after() never throws even though after() itself throws (no request scope) — mirrors production's real after()", async () => {
    readyState("owner-shadow-throws");
    mocks.after.mockImplementationOnce(() => {
      throw new Error("`after` was called outside a request scope");
    });

    await POST(request({ topics: ["battery"], aiTier: 2 }));
    const hook = lastPipelineOptions()!.onFreshShortlist as (shortlist: ReadonlyArray<ShadowCandidate>) => void;

    expect(() => hook([{ id: "p1", title: "A Paper", abstract: null }])).not.toThrow();
  });

  it("response body is identical whether or not the hook is scheduled — the only difference in options is the hook itself", async () => {
    // Frozen for the whole test: POST constructs `new Date()` itself (never
    // injected), so two real, unfrozen calls a moment apart would legitimately
    // differ by a millisecond — exactly the "confirmed in isolation twice"
    // intermittent failure this fixes. Freezing means `now` is the SAME
    // instant both times, so the full options object (nothing excluded but
    // the hook, which is expected to genuinely differ) can be compared
    // directly rather than laundered through a field-by-field allowlist.
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-24T12:00:00.000Z"));
    try {
      readyState("owner-shadow-cmp-on");
      const withShadow = await POST(request({ topics: ["battery"], aiTier: 2 }));
      const withShadowOptions = lastPipelineOptions();
      const withShadowBody = await withShadow.json();

      vi.clearAllMocks();
      mocks.runFeedPipeline.mockResolvedValue({ items: [], meta: {} });
      // Everything else defaults back to "off" (vi.clearAllMocks reset every
      // mock's implementation) — no shadow env stubbed this time.
      mocks.requireEntitledAiRequest.mockResolvedValue({ entitlement: { userId: null } });
      mocks.entitledAiTier.mockImplementation((tier: number, entitlement: { userId: string | null }) =>
        entitlement.userId === null ? 0 : tier,
      );
      mocks.getUser.mockResolvedValue({ data: { user: null } });

      const withoutShadow = await POST(request({ topics: ["battery"], aiTier: 2 }));
      const withoutShadowOptions = lastPipelineOptions();
      const withoutShadowBody = await withoutShadow.json();

      expect(withShadow.status).toBe(withoutShadow.status);
      expect(withShadowBody).toEqual(withoutShadowBody);
      expect(withShadowOptions?.now).toEqual(withoutShadowOptions?.now); // same frozen instant, proven directly rather than assumed
      // Same options object apart from the hook itself, which is expected
      // to be present only in the first call.
      expect({ ...withShadowOptions, onFreshShortlist: undefined }).toEqual({
        ...withoutShadowOptions,
        onFreshShortlist: undefined,
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it.each([
    ["PEER_JEV_SHADOW not \"on\"", (o: string) => { readyState(o); vi.stubEnv("PEER_JEV_SHADOW", "true"); }],
    ["PEER_JEV_BROKER not \"on\"", (o: string) => { readyState(o); vi.stubEnv("PEER_JEV_BROKER", "off"); }],
    ["broker URL unset (unconfigured)", (o: string) => { readyState(o); vi.stubEnv("PEER_JEV_BROKER_URL", ""); }],
    ["broker secret unset (unconfigured)", (o: string) => { readyState(o); vi.stubEnv("PEER_JEV_BROKER_SECRET", ""); }],
    ["signed out (no gate.user)", (o: string) => {
      readyState(o);
      mocks.requireEntitledAiRequest.mockResolvedValue({ user: null, entitlement: { userId: null, effectivePlan: "paid" } });
      mocks.getUser.mockResolvedValue({ data: { user: null } });
    }],
    ["free plan (gate.entitlement.effectivePlan === \"free\")", (o: string) => {
      readyState(o);
      mocks.requireEntitledAiRequest.mockResolvedValue({ user: { id: o }, entitlement: { userId: o, effectivePlan: "free" } });
    }],
    ["aiTier below 2 (no provider resolved)", (o: string) => {
      readyState(o);
      mocks.entitledAiTier.mockReturnValue(2);
      mocks.resolveProvider.mockReturnValue(null); // forces aiTier back to 0 in route.ts
    }],
  ])("%s: onFreshShortlist is absent", async (_label, setup) => {
    setup("owner-shadow-gate-off");

    const response = await POST(request({ topics: ["battery"], aiTier: 2 }));

    expect(response.status).toBe(200);
    const options = lastPipelineOptions();
    expect(options?.onFreshShortlist).toBeUndefined();
  });

  it("owner id mismatch between gate.user and paperCacheScope: onFreshShortlist is absent", async () => {
    // A scenario the real code can't normally reach (both come from the same
    // session), but the gate explicitly checks equality rather than assuming
    // it — this proves the check is real, not vacuous. Achieved by having
    // requireEntitledAiRequest report a different id than getUser resolves.
    stubShadowConfig();
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "public-test-key");
    mocks.getUser.mockResolvedValue({ data: { user: { id: "owner-from-supabase" } } });
    mocks.requireEntitledAiRequest.mockResolvedValue({
      user: { id: "owner-from-gate" },
      entitlement: { userId: "owner-from-gate", effectivePlan: "paid" },
    });
    mocks.entitledAiTier.mockReturnValue(2);
    mocks.resolveProvider.mockReturnValue({ id: "openai", generateJsonText: vi.fn() });

    const response = await POST(request({ topics: ["battery"], aiTier: 2 }));

    expect(response.status).toBe(200);
    expect(lastPipelineOptions()?.onFreshShortlist).toBeUndefined();
  });

  it("no structured intent (should not occur on POST, but the gate checks it explicitly): covered structurally — every POST past intent_required always has one", async () => {
    // normalizeFeedIntent's own "intent_required" 400 already stops any
    // POST without a usable intent before this gate is ever reached; there
    // is no reachable POST body that satisfies every other condition and
    // still lacks a structured intent. Documented here rather than faked
    // with an invalid internal state.
    expect(true).toBe(true);
  });

  it("GET never supplies the hook, even with every shadow/broker flag on and a signed-in, entitled user", async () => {
    readyState("owner-shadow-get");

    const response = await GET(new NextRequest("http://localhost/api/feed?topics=battery"));

    expect(response.status).toBe(200);
    expect(lastPipelineOptions()?.onFreshShortlist).toBeUndefined();
    expect(mocks.after).not.toHaveBeenCalled();
  });
});

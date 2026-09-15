import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  deployedRuntimeEnv,
  signedIn,
  signedOut,
} from "@/test-support/route-harness";
import {
  deepReportMonthKey,
  getCounterStore,
  resetCounterStoreForTests,
} from "@/lib/usage/counters";
import { ANONYMOUS_ENTITLEMENT, type Entitlement } from "@/lib/entitlement/types";

const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  maybeSingle: vi.fn(),
  resolveEntitlement: vi.fn(),
}));

// ABC-freemium 2-03 — the GET half of this route had no coverage at all, which
// is why nothing caught `deepReportsRemaining` shipping a budget and a paid
// reader's allowance arriving as a bare `null`. The handler is driven for real;
// only the session, the profile row and the plan lookup are stubbed.
vi.mock("@/lib/supabase/server", () => ({
  createClient: () =>
    Promise.resolve({
      auth: { getUser: mocks.getUser },
      from: () => ({
        select: () => ({ eq: () => ({ maybeSingle: mocks.maybeSingle }) }),
      }),
    }),
}));

// Stubbed so each plan can be driven directly. The resolver's own behaviour is
// `resolve.test.ts`'s subject; what is under test here is what the DELIVERY
// layer does with a resolved entitlement.
vi.mock("@/lib/entitlement/resolve", () => ({
  resolveEntitlement: mocks.resolveEntitlement,
}));

import { GET, profilePatchToRow, profileRowToProfile } from "./route";

const rowFixture = {
  user_id: "user-1",
  display_name: "Peer Member",
  research_topics: ["solid-state battery"],
  preferred_methods: ["electrochemistry"],
  location_preferences: ["Chicago"],
  authorised_countries: ["United States", "Canada"],
  career_stage: "Postdoc",
  industry_vs_academia: "both",
  phd_year: null,
  school: null,
  current_project: null,
  current_challenges: null,
  disliked_topics: [],
  preference_ledger: {},
  feed_focus: "balanced" as const,
  feed_freshness: "week" as const,
  paper_count: 10 as const,
  feed_source_mix: "balanced" as const,
  feed_importance: "new" as const,
  feed_method_mode: "relatedOk" as const,
  feed_discovery_mode: "core" as const,
  feed_avoid_reviews: true,
  feed_avoid_old_papers: false,
  feed_avoid_broad_surveys: true,
  lab: null,
  digest_enabled: true,
  digest_hour_local: 8,
  digest_timezone: "America/Chicago",
  digest_channel: "inapp" as const,
  digest_frequency: "daily" as const,
  digest_email: null,
  color_theme: "system:ember" as const,
  updated_at: "2026-07-31T00:00:00.000Z",
};

describe("profile route work-authorisation mapping", () => {
  it("reads authorised countries from a remote profile row", () => {
    expect(profileRowToProfile(rowFixture).authorisedCountries).toEqual([
      "United States",
      "Canada",
    ]);
  });

  it("defaults old rows without the new column to an empty list", () => {
    const { authorised_countries: _omitted, ...oldRow } = rowFixture;
    void _omitted;
    expect(
      profileRowToProfile(oldRow).authorisedCountries,
    ).toEqual([]);
  });

  it("writes only the changed work-authorisation field in a partial patch", () => {
    expect(
      profilePatchToRow(
        { authorisedCountries: ["Germany"] },
        "user-1",
      ),
    ).toEqual({
      user_id: "user-1",
      authorised_countries: ["Germany"],
    });
  });
});

/**
 * ABC-freemium 1-16 · R-ENT-1, R-ENT-3, R-TEST-1.
 *
 * The two halves of "the plan is the server's, not the browser's". The read
 * half is that the entitlement is computed server-side and delivered; the write
 * half is that no request path can set a plan. **The write half is asserted
 * here because the SQL that enforces it — 1-13's column grants — cannot be
 * exercised from this loop.**
 */
describe("the plan is server-owned (R-ENT-1)", () => {
  it("cannot be written through PUT /api/profile", () => {
    // Send a body that tries to buy an upgrade. `profilePatchToRow` maps a
    // fixed set of fields, and none of the four plan columns is among them, so
    // the upsert payload must carry no trace of them.
    const row = profilePatchToRow(
      {
        displayName: "Peter",
        plan: "paid",
        effectivePlan: "paid",
        trial_ends_at: "2099-01-01T00:00:00.000Z",
      } as unknown as Parameters<typeof profilePatchToRow>[0],
      "user-1",
    );

    const keys = Object.keys(row);
    expect(keys).not.toContain("plan");
    expect(keys).not.toContain("trial_started_at");
    expect(keys).not.toContain("trial_ends_at");
    expect(keys).not.toContain("plan_updated_at");
    // Nothing plan-shaped at all, however it were spelled.
    expect(keys.filter((k) => /plan|trial/i.test(k))).toEqual([]);
    // And the legitimate field still went through, so this is not passing by
    // mapping nothing.
    expect(row.display_name).toBe("Peter");
  });

  it("does not leak the stored plan into the profile the browser holds", () => {
    // `select("*")` means the new columns arrive in `data` once the migration
    // is applied. Only `profileRowToProfile` decides what reaches the browser,
    // and the plan must reach it inside the entitlement instead — otherwise a
    // later round is invited to add it to the write mapping too.
    const mapped = profileRowToProfile({
      ...rowFixture,
      plan: "paid",
      trial_ends_at: "2099-01-01T00:00:00.000Z",
    } as unknown as Parameters<typeof profileRowToProfile>[0]);

    expect(Object.keys(mapped).filter((k) => /plan|trial/i.test(k))).toEqual([]);
  });
});

/**
 * ABC-freemium 2-03 · R-ENT-2 (amended 2026-09-05) · R-ENT-3 · Ruling 4 point 3
 * · Ruling 5 point 4.
 *
 * The GET half, driven through the real handler. Before this item the route had
 * no `GET` coverage at all — every existing case above tests the two pure
 * mapping functions — which is exactly why a field named "remaining" could ship
 * a plan's budget for a whole round without anything going red.
 */
describe("GET /api/profile delivers a real allowance (R-ENT-3)", () => {
  function entitlement(overrides: Partial<Entitlement>): Entitlement {
    return { ...ANONYMOUS_ENTITLEMENT, userId: "user-1", ...overrides };
  }

  const FREE = entitlement({
    plan: "free",
    effectivePlan: "free",
    deepReportsBudget: 5,
    source: "supabase",
  });
  const PAID = entitlement({
    plan: "paid",
    effectivePlan: "paid",
    deepReportsBudget: Number.POSITIVE_INFINITY,
    source: "supabase",
  });
  const TRIAL = entitlement({
    plan: "trial",
    effectivePlan: "trial",
    deepReportsBudget: 20,
    trialEndsAt: "2099-01-01T00:00:00.000Z",
    source: "supabase",
  });

  async function body(): Promise<Record<string, unknown>> {
    const response = await GET();
    return (await response.json()) as Record<string, unknown>;
  }

  beforeEach(() => {
    vi.clearAllMocks();
    resetCounterStoreForTests();
    // A deployed runtime with no service-role key: the in-memory counter store
    // answers, which is the sanctioned local path (R-METER-4).
    deployedRuntimeEnv(vi.stubEnv);
    mocks.getUser.mockResolvedValue(signedIn("user-1"));
    mocks.maybeSingle.mockResolvedValue({ data: null, error: null });
    mocks.resolveEntitlement.mockResolvedValue(FREE);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    resetCounterStoreForTests();
  });

  it("answers a signed-out visitor 401 and ships no entitlement", async () => {
    mocks.getUser.mockResolvedValue(signedOut());

    const response = await GET();

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ profile: null });
  });

  it("ships a free reader a real remainder, and NEVER the plan budget", async () => {
    const store = getCounterStore();
    await store.increment(deepReportMonthKey("user-1", new Date()), null, 2);

    const { entitlement: shipped } = (await body()) as {
      entitlement: Record<string, unknown>;
    };

    // Three of five left. Before 2-03 this shipped `5` however many were spent.
    expect(shipped.deepReportsRemaining).toBe(3);
    expect(shipped.unlimited).toBe(false);
    expect(shipped.reason).toBeUndefined();
  });

  it("THE NUMBER MOVES when a report is spent", async () => {
    // The assertion whose absence let the defect ship: every existing test
    // asserted the constant, and a constant is what the bug was.
    const store = getCounterStore();
    const key = deepReportMonthKey("user-1", new Date());

    const before = (await body()) as { entitlement: { deepReportsRemaining: number } };
    await store.increment(key, null, 1);
    const after = (await body()) as { entitlement: { deepReportsRemaining: number } };

    expect(before.entitlement.deepReportsRemaining).toBe(5);
    expect(after.entitlement.deepReportsRemaining).toBe(4);
  });

  it("never increments the counter — reading a profile costs nothing", async () => {
    // A profile fetch that consumed a deep report would be the worst possible
    // bug in this file.
    const store = getCounterStore();
    const key = deepReportMonthKey("user-1", new Date());

    for (let i = 0; i < 5; i += 1) await body();

    expect((await store.read(key)).value).toBe(0);
  });

  it("ships a paid reader `unlimited`, never Infinity and never a bare null", async () => {
    mocks.resolveEntitlement.mockResolvedValue(PAID);

    const raw = await (await GET()).text();
    const parsed = JSON.parse(raw) as { entitlement: Record<string, unknown> };

    expect(parsed.entitlement.unlimited).toBe(true);
    expect(parsed.entitlement.deepReportsRemaining).toBeNull();
    expect(parsed.entitlement.reason).toBeUndefined();
    // Asserted on the serialised text, because `Infinity` is only destroyed by
    // serialisation — an in-memory check would pass on the broken shape.
    expect(raw).not.toContain("Infinity");
  });

  it("counts a trial against the trial key, not the monthly one", async () => {
    // The keys differ: a trial's twenty live on a key with NO period segment.
    // Reading the monthly key for a trial user would always answer twenty.
    mocks.resolveEntitlement.mockResolvedValue(TRIAL);
    const store = getCounterStore();
    await store.increment("deep:user-1:trial", null, 7);

    const { entitlement: shipped } = (await body()) as {
      entitlement: Record<string, unknown>;
    };

    expect(shipped.deepReportsRemaining).toBe(13);
  });

  it("never ships the server-only budget field", async () => {
    mocks.resolveEntitlement.mockResolvedValue(PAID);

    const { entitlement: shipped } = (await body()) as {
      entitlement: Record<string, unknown>;
    };

    // `ClientEntitlement` drops it by construction, so `Infinity` cannot reach
    // a payload by someone forgetting.
    expect(Object.keys(shipped)).not.toContain("deepReportsBudget");
  });

  it("still refuses to leak the stored plan into the profile object", async () => {
    // R-ENT-1's read half, re-asserted at the route now that a route test
    // exists: the plan reaches the browser inside the entitlement and nowhere
    // else.
    mocks.maybeSingle.mockResolvedValue({
      data: { ...rowFixture, plan: "paid" },
      error: null,
    });

    const { profile } = (await body()) as { profile: Record<string, unknown> };

    expect(Object.keys(profile).filter((k) => /plan|trial/i.test(k))).toEqual([]);
  });
});

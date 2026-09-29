import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
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
import { selectedSenseConcept } from "@/lib/feed/senses";

const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  maybeSingle: vi.fn(),
  resolveEntitlement: vi.fn(),
  // Jev's own PUT-path tests need to install a different `createClient` shape
  // (one with `.upsert`) per test; theirs' GET-path tests below need the
  // fixed select-only shape. One overridable mock serves both: this file's
  // own default install (right after the `vi.mock` call) covers every test
  // that does not call `mockResolvedValueOnce` itself, and `mockResolvedValueOnce`
  // self-clears after one call so a PUT test's override can never leak into a
  // later test regardless of run order.
  createClient: vi.fn(),
}));

// ABC-freemium 2-03 — the GET half of this route had no coverage at all, which
// is why nothing caught `deepReportsRemaining` shipping a budget and a paid
// reader's allowance arriving as a bare `null`. The handler is driven for real;
// only the session, the profile row and the plan lookup are stubbed.
vi.mock("@/lib/supabase/server", () => ({
  createClient: mocks.createClient,
}));

mocks.createClient.mockImplementation(() =>
  Promise.resolve({
    auth: { getUser: mocks.getUser },
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: mocks.maybeSingle }) }),
    }),
  }),
);

// Stubbed so each plan can be driven directly. The resolver's own behaviour is
// `resolve.test.ts`'s subject; what is under test here is what the DELIVERY
// layer does with a resolved entitlement.
vi.mock("@/lib/entitlement/resolve", () => ({
  resolveEntitlement: mocks.resolveEntitlement,
}));
// Deliberately NOT mocked: "@/lib/entitlement/allowance" and
// "@/lib/usage/counters" — theirs' GET tests below need the real arithmetic
// (`toClientEntitlement`, real counter increments), and `PUT` never calls
// either module at all, so ours' PUT tests have nothing to lose by leaving
// them real too.

import { GET, PUT, profilePatchToRow, profileRowToProfile } from "./route";

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
const explicitEmptyIntent = {
  version: "feed-intent-v1" as const,
  project: { presence: "explicit-empty" as const }, challenge: { presence: "omitted" as const },
  requiredConcepts: [], preferredConcepts: [], exclusions: [], methods: [], selectedSenseConcepts: [],
};

describe("profile route work-authorisation mapping", () => {
  it("omits an absent intent but round-trips canonical empty/value cards without administrative fields", () => {
    expect(profilePatchToRow({ displayName: "Only this" }, "user-1")).not.toHaveProperty("feed_intent");
    expect(profilePatchToRow({ feedIntent: explicitEmptyIntent }, "user-1")).toMatchObject({ feed_intent: explicitEmptyIntent });
    const valued = { ...explicitEmptyIntent, project: { presence: "value" as const, value: "Battery", provenance: "user" as const }, selectedSenseConcepts: [selectedSenseConcept("hr.role_conflict")] };
    expect(profileRowToProfile({ ...rowFixture, feed_intent: valued }).feedIntent).toEqual(valued);
    expect(profileRowToProfile({ ...rowFixture, feed_intent: explicitEmptyIntent }).currentProject).toBe("");
    expect(profilePatchToRow({ plan: "paid", entitlement: { forged: true } } as never, "user-1")).toEqual({ user_id: "user-1" });
  });

  it("rejects an invalid supplied card before any upsert", async () => {
    const upsert = vi.fn();
    mocks.createClient.mockResolvedValueOnce({ auth: { getUser: async () => ({ data: { user: { id: "user-1" } } }) }, from: () => ({ upsert }) });
    const response = await PUT(new NextRequest("http://peer.test/api/profile", { method: "PUT", body: JSON.stringify({ feedIntent: { version: "not-v1" } }) }));
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "invalid_feed_intent" });
    expect(upsert).not.toHaveBeenCalled();
  });

  // SIGNIN-MERGE (§1aj) — rewritten, not deleted: the OLD behaviour this test
  // asserted (a bare 409, no retry) was the root cause of "every profile save
  // fails" (ABC-JEV-INTEGRATION.md §1ah/§1aj) — a feed_intent-carrying PUT is
  // almost every real save, since remoteProfilePayload attaches feedIntent
  // whenever the profile has any real content, so this atomically failed the
  // WHOLE upsert on every save for any account whose Supabase project lags the
  // feed_intent migration. The route must now mirror its digest_email/
  // preference_ledger siblings: strip the unavailable field and retry once, so
  // the legacy flat columns (research_topics, current_project, digest_*, …)
  // still reach the account.
  it("degrades gracefully when feed_intent's column is missing: strips it and retries so the rest of the profile still saves", async () => {
    const firstError = { message: "Could not find the 'feed_intent' column of 'profiles' in the schema cache" };
    // The route mutates its own `row` object in place before retrying
    // (`delete row.feed_intent`), so `upsert.mock.calls` would show the SAME
    // (already-mutated) object for both calls if read after the fact — each
    // call is snapshotted (shallow-copied) here, at the moment it happens,
    // to see what the first attempt actually sent.
    const seenRows: Record<string, unknown>[] = [];
    const upsert = vi.fn((row: Record<string, unknown>) => {
      seenRows.push({ ...row });
      return seenRows.length === 1
        ? { select: () => ({ single: async () => ({ data: null, error: firstError }) }) }
        : { select: () => ({ single: async () => ({ data: { ...rowFixture, research_topics: ["solid-state battery"] }, error: null }) }) };
    });
    mocks.createClient.mockResolvedValueOnce({ auth: { getUser: async () => ({ data: { user: { id: "user-1" } } }) }, from: () => ({ upsert }) });
    const response = await PUT(
      new NextRequest("http://peer.test/api/profile", {
        method: "PUT",
        body: JSON.stringify({ feedIntent: explicitEmptyIntent, researchTopics: ["solid-state battery"] }),
      }),
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      profile: { researchTopics: ["solid-state battery"] },
    });
    expect(upsert).toHaveBeenCalledTimes(2);
    // First attempt carried feed_intent…
    expect(seenRows[0]).toHaveProperty("feed_intent");
    // …the retry dropped it but kept every other field.
    expect(seenRows[1]).not.toHaveProperty("feed_intent");
    expect(seenRows[1]).toMatchObject({ research_topics: ["solid-state battery"] });
  });

  it("still reports feed_intent_schema_unavailable when the retry itself fails for an unrelated reason", async () => {
    const firstError = { message: "Could not find the 'feed_intent' column of 'profiles' in the schema cache" };
    const secondError = { message: "connection reset" };
    const upsert = vi
      .fn()
      .mockReturnValueOnce({ select: () => ({ single: async () => ({ data: null, error: firstError }) }) })
      .mockReturnValueOnce({ select: () => ({ single: async () => ({ data: null, error: secondError }) }) });
    mocks.createClient.mockResolvedValueOnce({ auth: { getUser: async () => ({ data: { user: { id: "user-1" } } }) }, from: () => ({ upsert }) });
    const response = await PUT(new NextRequest("http://peer.test/api/profile", { method: "PUT", body: JSON.stringify({ feedIntent: explicitEmptyIntent }) }));
    expect(response.status).toBe(500);
    expect(upsert).toHaveBeenCalledTimes(2);
  });
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
 * EMAIL-SETTINGS — F4/§2.3: `PUT /api/profile` must reject a client-sent
 * `digestEmail` unless it equals the account email or the value already
 * stored for that user. Without this, a confirmation flow bolted on only at
 * a separate confirm-email route would do nothing — a client could still
 * PUT an unconfirmed address directly. Confirming a genuinely new address
 * only ever happens through GET /api/profile/confirm-email's own write
 * (tested in that route's own suite), never through this one.
 */
describe("PUT /api/profile — the digest_email confirmation guard (F4)", () => {
  function fromStub(opts: {
    existingDigestEmail?: string | null;
    existingSelectError?: string;
  }) {
    const maybeSingle = vi.fn(async () =>
      opts.existingSelectError
        ? { data: null, error: { message: opts.existingSelectError } }
        : {
            data:
              opts.existingDigestEmail === undefined
                ? null
                : { digest_email: opts.existingDigestEmail },
            error: null,
          },
    );
    // Explicit `vi.fn<Signature>()` type argument, same convention as
    // src/app/api/jobs/dispatch-digests/route.test.ts's own mocks (see its
    // comment): the real `.upsert(row, {onConflict})` call site passes two
    // arguments, but a bare `() => ({...})` factory would leave
    // `.mock.calls[0]` typed as the empty tuple `[]` (TS infers a mock's
    // argument type from its implementation, not from how the route
    // actually calls it) — that's enough for the pre-existing
    // `toHaveBeenCalledWith` assertions below (loosely typed by vitest) but
    // not for indexing the written row directly, which the new
    // drop-not-reject tests (POLISH-1-SYNC §1al (b)) need to do.
    const upsert = vi.fn<
      (row: Record<string, unknown>, opts?: { onConflict: string }) => {
        select: () => { single: () => Promise<{ data: unknown; error: null }> };
      }
    >(() => ({
      select: () => ({
        single: async () => ({
          data: { ...rowFixture, digest_email: "written@example.test" },
          error: null,
        }),
      }),
    }));
    return {
      select: () => ({ eq: () => ({ maybeSingle }) }),
      upsert,
    };
  }

  function putWithDigestEmail(digestEmail: string) {
    return PUT(
      new NextRequest("http://peer.test/api/profile", {
        method: "PUT",
        body: JSON.stringify({ digestEmail }),
      }),
    );
  }

  it("accepts a value equal to the account email (case/whitespace-insensitive) and normalizes it before storing", async () => {
    const stub = fromStub({ existingDigestEmail: null });
    mocks.createClient.mockResolvedValueOnce({
      auth: { getUser: async () => ({ data: { user: { id: "user-1", email: "Person@Example.test" } } }) },
      from: () => stub,
    });

    const response = await putWithDigestEmail("  person@EXAMPLE.test  ");

    expect(response.status).toBe(200);
    expect(stub.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ digest_email: "person@example.test" }),
      { onConflict: "user_id" },
    );
  });

  it("accepts a value equal to the currently-stored digest_email", async () => {
    const stub = fromStub({ existingDigestEmail: "already@example.test" });
    mocks.createClient.mockResolvedValueOnce({
      auth: { getUser: async () => ({ data: { user: { id: "user-1", email: "person@example.test" } } }) },
      from: () => stub,
    });

    const response = await putWithDigestEmail("Already@Example.test");

    expect(response.status).toBe(200);
    expect(stub.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ digest_email: "already@example.test" }),
      { onConflict: "user_id" },
    );
  });

  it("POLISH-1-SYNC (ABC-JEV-INTEGRATION.md §1al (b)): drops a value that is neither the account email nor the stored value, instead of rejecting the whole save", async () => {
    // Superseded contract (was: 400 `digest_email_requires_confirmation`,
    // upsert never called at all — so every OTHER field in the same PUT was
    // lost too). §1al (b) rules the field alone must be dropped, not the
    // whole save; the security property (never WRITE an unconfirmed
    // address) is unchanged — see the `not.toHaveProperty` assertion below.
    const stub = fromStub({ existingDigestEmail: "already@example.test" });
    mocks.createClient.mockResolvedValueOnce({
      auth: { getUser: async () => ({ data: { user: { id: "user-1", email: "person@example.test" } } }) },
      from: () => stub,
    });

    const response = await putWithDigestEmail("someone-else@example.test");

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ ignored: ["digestEmail"] });
    expect(stub.upsert).toHaveBeenCalledTimes(1);
    const [writtenRow] = stub.upsert.mock.calls[0];
    expect(writtenRow).not.toHaveProperty("digest_email");
  });

  it("POLISH-1-SYNC (§1al (b)): the rest of a multi-field patch still saves when digestEmail is dropped", async () => {
    const stub = fromStub({ existingDigestEmail: "already@example.test" });
    mocks.createClient.mockResolvedValueOnce({
      auth: { getUser: async () => ({ data: { user: { id: "user-1", email: "person@example.test" } } }) },
      from: () => stub,
    });

    const response = await PUT(
      new NextRequest("http://peer.test/api/profile", {
        method: "PUT",
        body: JSON.stringify({ digestEmail: "someone-else@example.test", displayName: "New Name" }),
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ ignored: ["digestEmail"] });
    expect(stub.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ display_name: "New Name" }),
      { onConflict: "user_id" },
    );
    const [writtenRow] = stub.upsert.mock.calls[0];
    expect(writtenRow).not.toHaveProperty("digest_email");
  });

  it("allows clearing the field to empty unconditionally (nothing to confirm when removing a destination)", async () => {
    const stub = fromStub({ existingDigestEmail: "already@example.test" });
    mocks.createClient.mockResolvedValueOnce({
      auth: { getUser: async () => ({ data: { user: { id: "user-1", email: "person@example.test" } } }) },
      from: () => stub,
    });

    const response = await putWithDigestEmail("");

    expect(response.status).toBe(200);
    expect(stub.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ digest_email: "" }),
      { onConflict: "user_id" },
    );
  });

  it("a patch that never mentions digestEmail never reads the existing row (no added cost to other fields)", async () => {
    const upsert = vi.fn(() => ({ select: () => ({ single: async () => ({ data: rowFixture, error: null }) }) }));
    const select = vi.fn();
    mocks.createClient.mockResolvedValueOnce({
      auth: { getUser: async () => ({ data: { user: { id: "user-1", email: "person@example.test" } } }) },
      from: () => ({ select, upsert }),
    });

    const response = await PUT(
      new NextRequest("http://peer.test/api/profile", { method: "PUT", body: JSON.stringify({ displayName: "New Name" }) }),
    );

    expect(response.status).toBe(200);
    expect(select).not.toHaveBeenCalled();
  });

  it("POLISH-1-SYNC (§1al (b)): a failed pre-check read drops the field too, instead of failing the whole save with a 500", async () => {
    // Superseded contract (was: 500, upsert never called). §1al (b): a
    // failed guard read is not evidence the candidate is safe, so it is
    // treated exactly like an untrusted one — dropped, not written, save
    // continues.
    const stub = fromStub({ existingSelectError: "database unavailable" });
    mocks.createClient.mockResolvedValueOnce({
      auth: { getUser: async () => ({ data: { user: { id: "user-1", email: "person@example.test" } } }) },
      from: () => stub,
    });

    const response = await putWithDigestEmail("someone-else@example.test");

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ ignored: ["digestEmail"] });
    expect(stub.upsert).toHaveBeenCalledTimes(1);
    const [writtenRow] = stub.upsert.mock.calls[0];
    expect(writtenRow).not.toHaveProperty("digest_email");
  });

  it("a patch that never mentions digestEmail reports nothing ignored", async () => {
    const upsert = vi.fn(() => ({ select: () => ({ single: async () => ({ data: rowFixture, error: null }) }) }));
    mocks.createClient.mockResolvedValueOnce({
      auth: { getUser: async () => ({ data: { user: { id: "user-1", email: "person@example.test" } } }) },
      from: () => ({ select: vi.fn(), upsert }),
    });

    const response = await PUT(
      new NextRequest("http://peer.test/api/profile", { method: "PUT", body: JSON.stringify({ displayName: "New Name" }) }),
    );

    await expect(response.json()).resolves.toMatchObject({ ignored: [] });
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

  /**
   * GOOGLE-SIGNIN (ABC-JEV-INTEGRATION.md §1ad/§1ai) — the guide's "Peer's
   * own code identity-linking guarantee" (§0.3, §3): this route must never
   * key a lookup off provider identity, only off the session's `user.id`.
   * The mocked `eq()` in this file's shared `createClient` stub ignores its
   * arguments (matching every other test above), so what this actually
   * proves is narrower and honest: a session `user` object shaped like a
   * real Google sign-in (user_metadata/app_metadata present, provider
   * fields, no GitHub-only fields) maps to the exact same profile as every
   * GitHub-shaped test above — nothing here branches on, or trips over,
   * that shape. The write-side guarantee (the actual `user_id` reaching the
   * database) is proved directly below, where the mock DOES capture the
   * upsert argument.
   */
  it("GOOGLE-SIGNIN — maps the profile identically for a session user carrying Google-shaped user_metadata/app_metadata", async () => {
    mocks.getUser.mockResolvedValue({
      data: {
        user: {
          id: "user-1",
          email: "reader@gmail.com",
          user_metadata: {
            full_name: "Ada Lovelace",
            name: "Ada Lovelace",
            avatar_url: "https://lh3.googleusercontent.com/a/avatar.jpg",
            picture: "https://lh3.googleusercontent.com/a/avatar.jpg",
          },
          app_metadata: { provider: "google", providers: ["google", "github"] },
        },
      },
      error: null,
    });
    mocks.maybeSingle.mockResolvedValue({ data: rowFixture, error: null });

    const { profile } = (await body()) as { profile: Record<string, unknown> };

    expect(profile.authorisedCountries).toEqual(["United States", "Canada"]);
    expect(profile.displayName).toBe(rowFixture.display_name);
  });
});

/**
 * GOOGLE-SIGNIN (ABC-JEV-INTEGRATION.md §1ad/§1ai) — the write-side half of
 * the same guarantee, where the mock captures the actual upsert argument:
 * `profilePatchToRow(body, user.id)` takes `user.id` as a separate function
 * argument derived from `supabase.auth.getUser()`, never from the request
 * body — this route's own header comment already states the rule ("we
 * still derive user_id from the session server-side so clients can't claim
 * someone else's row"). These two tests are new evidence for that existing
 * rule under a Google-shaped session and a body that tries to smuggle an
 * identity-looking field, not a new mechanism.
 */
describe("GOOGLE-SIGNIN — PUT /api/profile derives user_id only from the session (identity-linking guarantee)", () => {
  it("upserts under the session's real user.id even when that session user is Google-shaped, and drops a forged user_id/provider from the body", async () => {
    const upsert = vi.fn(() => ({
      select: () => ({ single: async () => ({ data: rowFixture, error: null }) }),
    }));
    mocks.createClient.mockResolvedValueOnce({
      auth: {
        getUser: async () => ({
          data: {
            user: {
              id: "user-1",
              email: "reader@gmail.com",
              user_metadata: {
                full_name: "Ada Lovelace",
                avatar_url: "https://lh3.googleusercontent.com/a/avatar.jpg",
              },
              app_metadata: { provider: "google", providers: ["google", "github"] },
            },
          },
        }),
      },
      from: () => ({ upsert }),
    });

    const response = await PUT(
      new NextRequest("http://peer.test/api/profile", {
        method: "PUT",
        body: JSON.stringify({
          displayName: "Ada",
          // Neither field is a real UserProfile key — profilePatchToRow maps
          // a fixed, named set of fields and would drop these even if the
          // route never separately re-derived user.id; asserted anyway as
          // belt-and-braces evidence, matching "the plan is server-owned"'s
          // own style above.
          user_id: "someone-elses-id",
          provider: "google",
        } as never),
      }),
    );

    expect(response.status).toBe(200);
    const written = (upsert.mock.calls as unknown[][])[0]?.[0] as Record<string, unknown>;
    expect(written.user_id).toBe("user-1");
    expect(written.display_name).toBe("Ada");
    expect(Object.keys(written)).not.toContain("provider");
  });
});

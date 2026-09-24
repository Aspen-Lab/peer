import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveEntitlement, type EntitlementSupabaseClient } from "./resolve";
import {
  ANONYMOUS_ENTITLEMENT,
  FREE_DEEP_REPORTS_PER_MONTH,
  TRIAL_DEEP_REPORTS_TOTAL,
} from "./types";

/**
 * ABC-freemium 1-04 — the tests for 1-01 (R-ENT-2, R-ENT-5).
 *
 * R-TEST-1 names entitlement resolution explicitly: trial active, trial
 * expired, paid. The other cases here are the ones that would let a wrong value
 * through unnoticed — a typo'd dev override granting `paid`, a Vercel runtime
 * honouring a local override, and the un-migrated schema, which is the state
 * every one of these tests actually runs against today.
 */

const NOW = new Date("2026-09-04T12:00:00.000Z");

/** A stand-in for the one query `resolveEntitlement` makes. */
function clientReturning(result: {
  data: Record<string, unknown> | null;
  error: unknown;
}): EntitlementSupabaseClient {
  return {
    from: () => ({
      select: () => ({
        eq: () => ({ maybeSingle: () => Promise.resolve(result) }),
      }),
    }),
  };
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("resolveEntitlement", () => {
  it("returns the frozen anonymous entitlement for no user", async () => {
    const entitlement = await resolveEntitlement(null, NOW);

    expect(entitlement).toBe(ANONYMOUS_ENTITLEMENT);
    // Frozen on purpose: a consumer that mutated it would change what every
    // later signed-out request is allowed to do.
    expect(Object.isFrozen(entitlement)).toBe(true);
    expect(entitlement.systemSearchAllowed).toBe(false);
    expect(entitlement.poolRefreshAllowed).toBe(false);
    expect(entitlement.userId).toBeNull();
    expect(entitlement.source).toBe("anonymous");
  });

  // ONE TIER (owner, 2026-09-14): whatever the stored row says — trial, expired
  // trial, free, missing, unreadable — a signed-in reader resolves to the single
  // plan. The stored `plan` is still reported verbatim.
  it("reads a stored live trial as the one tier", async () => {
    const entitlement = await resolveEntitlement("user-1", NOW, {
      client: clientReturning({
        data: { plan: "trial", trial_ends_at: "2026-09-10T00:00:00.000Z" },
        error: null,
      }),
    });

    expect(entitlement.plan).toBe("trial");
    expect(entitlement.effectivePlan).toBe("paid");
    // REWRITTEN, NOT DELETED — ABC-freemium 5-02 · D2a (Ruling 12). This line
    // asserted `true`. The operator now funds no search for anyone, so a live
    // trial gets `false` like every other plan. `poolRefreshAllowed` is the half
    // that survives and is deliberately still asserted `true` right below: the
    // two flags used to be one expression, and this pair is what proves they
    // came apart correctly (Ruling 12 point 5).
    expect(entitlement.systemSearchAllowed).toBe(false);
    expect(entitlement.poolRefreshAllowed).toBe(true);
    expect(entitlement.deepReportsBudget).toBe(Number.POSITIVE_INFINITY);
    expect(entitlement.trialEndsAt).toBeNull();
  });

  it("reads an expired trial as the one tier too, with no write", async () => {
    // D5 — expiry is computed when the row is read. The stored column still
    // says `trial`; nothing migrates it, and the very next request sees `free`.
    const entitlement = await resolveEntitlement("user-1", NOW, {
      client: clientReturning({
        data: { plan: "trial", trial_ends_at: "2026-08-01T00:00:00.000Z" },
        error: null,
      }),
    });

    expect(entitlement.plan).toBe("trial");
    expect(entitlement.effectivePlan).toBe("paid");
    expect(entitlement.systemSearchAllowed).toBe(false);
    expect(entitlement.poolRefreshAllowed).toBe(true);
    expect(entitlement.deepReportsBudget).toBe(Number.POSITIVE_INFINITY);
    expect(entitlement.trialEndsAt).toBeNull();
  });

  it("gives a paid user unbounded deep reports but NO system search", async () => {
    // REWRITTEN, NOT DELETED — ABC-freemium 5-02 · D2a (Ruling 12).
    //
    // Was "gives a paid user unbounded deep reports and system search" and
    // asserted `systemSearchAllowed === true`. The name had to change with the
    // assertion: paying no longer buys search, on any plan. What paying buys is
    // deep reports without a monthly cap (asserted below), immediate pool
    // refresh (`poolRefreshAllowed`, asserted here so the split is visible in
    // the same case) and immediate topic changes.
    const entitlement = await resolveEntitlement("user-1", NOW, {
      client: clientReturning({ data: { plan: "paid" }, error: null }),
    });

    expect(entitlement.effectivePlan).toBe("paid");
    expect(entitlement.systemSearchAllowed).toBe(false);
    expect(entitlement.poolRefreshAllowed).toBe(true);
    expect(entitlement.deepReportsBudget).toBe(Number.POSITIVE_INFINITY);
  });

  it("treats a missing plan column exactly like a missing row", async () => {
    // This is the state the whole round runs in: the 1-13 migration is written
    // but nobody in this loop can apply it, so Supabase answers with an error
    // rather than a null row. It must resolve `free`, not throw.
    const entitlement = await resolveEntitlement("user-1", NOW, {
      client: clientReturning({
        data: null,
        error: { code: "42703", message: "column profiles.plan does not exist" },
      }),
    });

    expect(entitlement.effectivePlan).toBe("paid");
    expect(entitlement.systemSearchAllowed).toBe(false);
    expect(entitlement.userId).toBe("user-1");
    expect(entitlement.source).toBe("supabase");
  });

  it("still resolves the one tier when the store is unreachable", async () => {
    const entitlement = await resolveEntitlement("user-1", NOW, { client: null });

    expect(entitlement.effectivePlan).toBe("paid");
    expect(entitlement.deepReportsBudget).toBe(Number.POSITIVE_INFINITY);
  });

  describe("PEER_ENTITLEMENT_MODE=tiered (round 10 — the post-beta switch)", () => {
    // Round 10. `one_tier` (every test above, and the default when this
    // variable is unset) must keep reproducing beta exactly. These cases prove
    // the OTHER side of the switch still exists: set to the one literal value
    // "tiered", `fromStoredPlan` computes the nine-round free/trial/paid split
    // instead of collapsing everything to `paid`.
    afterEach(() => {
      vi.unstubAllEnvs();
    });

    it("keeps a live trial as trial, budget 20, with its end date", async () => {
      vi.stubEnv("PEER_ENTITLEMENT_MODE", "tiered");

      const entitlement = await resolveEntitlement("user-1", NOW, {
        client: clientReturning({
          data: { plan: "trial", trial_ends_at: "2026-09-10T00:00:00.000Z" },
          error: null,
        }),
      });

      expect(entitlement.plan).toBe("trial");
      expect(entitlement.effectivePlan).toBe("trial");
      expect(entitlement.systemSearchAllowed).toBe(false);
      expect(entitlement.poolRefreshAllowed).toBe(true);
      expect(entitlement.deepReportsBudget).toBe(TRIAL_DEEP_REPORTS_TOTAL);
      expect(entitlement.trialEndsAt).toBe("2026-09-10T00:00:00.000Z");
    });

    it("drops an expired trial to free at read time (D5), no write", async () => {
      vi.stubEnv("PEER_ENTITLEMENT_MODE", "tiered");

      const entitlement = await resolveEntitlement("user-1", NOW, {
        client: clientReturning({
          data: { plan: "trial", trial_ends_at: "2026-08-01T00:00:00.000Z" },
          error: null,
        }),
      });

      expect(entitlement.plan).toBe("trial");
      expect(entitlement.effectivePlan).toBe("free");
      expect(entitlement.poolRefreshAllowed).toBe(false);
      expect(entitlement.deepReportsBudget).toBe(FREE_DEEP_REPORTS_PER_MONTH);
      expect(entitlement.trialEndsAt).toBeNull();
    });

    it("gives a paid user unbounded deep reports, still no system search", async () => {
      vi.stubEnv("PEER_ENTITLEMENT_MODE", "tiered");

      const entitlement = await resolveEntitlement("user-1", NOW, {
        client: clientReturning({ data: { plan: "paid" }, error: null }),
      });

      expect(entitlement.effectivePlan).toBe("paid");
      expect(entitlement.systemSearchAllowed).toBe(false);
      expect(entitlement.poolRefreshAllowed).toBe(true);
      expect(entitlement.deepReportsBudget).toBe(Number.POSITIVE_INFINITY);
    });

    it("caps a free plan at 5 a month with no pool refresh", async () => {
      vi.stubEnv("PEER_ENTITLEMENT_MODE", "tiered");

      const entitlement = await resolveEntitlement("user-1", NOW, {
        client: clientReturning({ data: { plan: "free" }, error: null }),
      });

      expect(entitlement.effectivePlan).toBe("free");
      expect(entitlement.poolRefreshAllowed).toBe(false);
      expect(entitlement.deepReportsBudget).toBe(FREE_DEEP_REPORTS_PER_MONTH);
    });

    it("still fails to free, not a throw, when the plan column is missing", async () => {
      // Same fixture as the one_tier case above — the un-migrated-schema
      // fallback is mode-independent: `plan` is never `null` going into
      // `fromStoredPlan`, so `tiered` has nothing to branch on differently.
      vi.stubEnv("PEER_ENTITLEMENT_MODE", "tiered");

      const entitlement = await resolveEntitlement("user-1", NOW, {
        client: clientReturning({
          data: null,
          error: { code: "42703", message: "column profiles.plan does not exist" },
        }),
      });

      expect(entitlement.effectivePlan).toBe("free");
      expect(entitlement.deepReportsBudget).toBe(FREE_DEEP_REPORTS_PER_MONTH);
    });

    it("is not activated by anything other than the exact string 'tiered'", async () => {
      // Same rule asPlan() and the PEER_DEV_ENTITLEMENT tests already hold to:
      // a typo must never silently grant the stronger mode.
      vi.stubEnv("PEER_ENTITLEMENT_MODE", "Tiered");

      const entitlement = await resolveEntitlement("user-1", NOW, {
        client: clientReturning({
          data: { plan: "trial", trial_ends_at: "2026-09-10T00:00:00.000Z" },
          error: null,
        }),
      });

      expect(entitlement.effectivePlan).toBe("paid");
    });
  });

  describe("PEER_DEV_ENTITLEMENT (R-ENT-5)", () => {
    it("is honoured in local development", async () => {
      vi.stubEnv("NODE_ENV", "development");
      vi.stubEnv("PEER_DEV_ENTITLEMENT", "paid");

      const entitlement = await resolveEntitlement(null, NOW);

      expect(entitlement.effectivePlan).toBe("paid");
      expect(entitlement.source).toBe("dev-override");
      // Ruling 3 point 2 — a developer is a real user for D1's purposes.
      expect(entitlement.userId).toBe("dev-local");
    });

    it("gives a developer the one tier when unset", async () => {
      // Ruling 3 point 2. Under D1 a free developer still gets the system LLM,
      // so the day-to-day loop is unchanged; what they lose is the system Tavily
      // key, which is the leak R-KEY-3 exists to close.
      vi.stubEnv("NODE_ENV", "development");

      const entitlement = await resolveEntitlement(null, NOW);

      expect(entitlement.effectivePlan).toBe("paid");
      expect(entitlement.systemSearchAllowed).toBe(false);
      expect(entitlement.userId).toBe("dev-local");
    });

    it("gives the one tier whatever the value says", async () => {
      // A typo must never silently grant paid.
      vi.stubEnv("NODE_ENV", "development");
      vi.stubEnv("PEER_DEV_ENTITLEMENT", "Paid");

      const entitlement = await resolveEntitlement(null, NOW);

      expect(entitlement.effectivePlan).toBe("paid");
    });

    it("is ignored on a Vercel deployment", async () => {
      // Two locks stand behind this: the build guard bans the name (1-10) and
      // this runtime check holds if someone adds it to a running deployment.
      vi.stubEnv("NODE_ENV", "development");
      vi.stubEnv("VERCEL_ENV", "preview");
      vi.stubEnv("PEER_DEV_ENTITLEMENT", "paid");

      const entitlement = await resolveEntitlement(null, NOW);

      expect(entitlement).toBe(ANONYMOUS_ENTITLEMENT);
    });
  });
});

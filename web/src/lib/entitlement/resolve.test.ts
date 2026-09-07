import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveEntitlement, type EntitlementSupabaseClient } from "./resolve";
import { ANONYMOUS_ENTITLEMENT } from "./types";

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

  it("keeps a live trial on trial terms", async () => {
    const entitlement = await resolveEntitlement("user-1", NOW, {
      client: clientReturning({
        data: { plan: "trial", trial_ends_at: "2026-09-10T00:00:00.000Z" },
        error: null,
      }),
    });

    expect(entitlement.plan).toBe("trial");
    expect(entitlement.effectivePlan).toBe("trial");
    // REWRITTEN, NOT DELETED — ABC-freemium 5-02 · D2a (Ruling 12). This line
    // asserted `true`. The operator now funds no search for anyone, so a live
    // trial gets `false` like every other plan. `poolRefreshAllowed` is the half
    // that survives and is deliberately still asserted `true` right below: the
    // two flags used to be one expression, and this pair is what proves they
    // came apart correctly (Ruling 12 point 5).
    expect(entitlement.systemSearchAllowed).toBe(false);
    expect(entitlement.poolRefreshAllowed).toBe(true);
    expect(entitlement.deepReportsBudget).toBe(20);
    expect(entitlement.trialEndsAt).toBe("2026-09-10T00:00:00.000Z");
  });

  it("downgrades an expired trial at read time, with no write", async () => {
    // D5 — expiry is computed when the row is read. The stored column still
    // says `trial`; nothing migrates it, and the very next request sees `free`.
    const entitlement = await resolveEntitlement("user-1", NOW, {
      client: clientReturning({
        data: { plan: "trial", trial_ends_at: "2026-08-01T00:00:00.000Z" },
        error: null,
      }),
    });

    expect(entitlement.plan).toBe("trial");
    expect(entitlement.effectivePlan).toBe("free");
    expect(entitlement.systemSearchAllowed).toBe(false);
    expect(entitlement.poolRefreshAllowed).toBe(false);
    expect(entitlement.deepReportsBudget).toBe(5);
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

    expect(entitlement.effectivePlan).toBe("free");
    expect(entitlement.systemSearchAllowed).toBe(false);
    expect(entitlement.userId).toBe("user-1");
    expect(entitlement.source).toBe("supabase");
  });

  it("falls through to free when the store is unreachable", async () => {
    const entitlement = await resolveEntitlement("user-1", NOW, { client: null });

    expect(entitlement.effectivePlan).toBe("free");
    expect(entitlement.deepReportsBudget).toBe(5);
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

    it("defaults to free when unset, not to paid", async () => {
      // Ruling 3 point 2. Under D1 a free developer still gets the system LLM,
      // so the day-to-day loop is unchanged; what they lose is the system Tavily
      // key, which is the leak R-KEY-3 exists to close.
      vi.stubEnv("NODE_ENV", "development");

      const entitlement = await resolveEntitlement(null, NOW);

      expect(entitlement.effectivePlan).toBe("free");
      expect(entitlement.systemSearchAllowed).toBe(false);
      expect(entitlement.userId).toBe("dev-local");
    });

    it("ignores an unrecognised value rather than defaulting to it", async () => {
      // A typo must never silently grant paid.
      vi.stubEnv("NODE_ENV", "development");
      vi.stubEnv("PEER_DEV_ENTITLEMENT", "Paid");

      const entitlement = await resolveEntitlement(null, NOW);

      expect(entitlement.effectivePlan).toBe("free");
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

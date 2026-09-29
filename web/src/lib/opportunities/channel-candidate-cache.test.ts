import { describe, expect, it, vi } from "vitest";
import { createTrustedPaperCacheScope } from "./private-paper-cache";
import { PAPER_POOL_KEY_PREFIX } from "./pool-cache";
import {
  MemoryChannelCandidateCache,
  PrivateChannelCandidateCache,
  type CachedChannelCandidates,
} from "./channel-candidate-cache";

// P2-S4d (Round 3) — F-M-P2-02, ABC-JEV-INTEGRATION.md §4 "P2-S4d design
// (addendum to the P2-S4c guide) accepted". A per-owner store for the four
// read-time recommendation channels' combined result, keyed by owner + a
// signature of (positive seeds, negative seeds, topic ids, enabled legs).
// Reuses the EXISTING `private_paper_pools` table under its OWN
// `"peer-channels-v1-"` scope-key prefix — never `PrivatePaperPoolCache`
// itself, which imports `PAPER_POOL_KEY_PREFIX` (pool-cache.ts, currently
// `"peer-pool-v7-papers-"`, bumped by REQUIRED-GATE §1ao.9) for its own
// day-pool prefix/surface guard (see docs/jev-abc/P2-S4c-B-20260924T113605Z.md
// D-ADD.2) — so a channel-cache row and a day-pool row can never collide in
// either direction, with no migration.

const value: CachedChannelCandidates = {
  items: [],
  legStatus: {
    s2_recommendations: { status: "ok", lastAttemptAt: "2026-09-24T00:00:00.000Z", retryCount: 0 },
  },
  generatedAt: "2026-09-24T00:00:00.000Z",
};

function fakeClient() {
  const maybeSingle = vi.fn().mockResolvedValue({ data: { payload: value }, error: null });
  const secondEq = vi.fn(() => ({ maybeSingle }));
  const firstEq = vi.fn(() => ({ eq: secondEq }));
  const select = vi.fn(() => ({ eq: firstEq }));
  const upsert = vi.fn().mockResolvedValue({ error: null });
  const from = vi.fn(() => ({ select, upsert }));
  return { client: { from }, from, select, firstEq, secondEq, upsert };
}

// P2-S4d-FIX (Round 3) — ABC-JEV-INTEGRATION.md §4 "P2-S4c+d fresh A ...
// Finding 2" (2026-09-24T15:40:42Z) + docs/jev-abc/
// P2-S4cd-A-20260924T152147Z.md. `get()` now returns a tri-state
// (`{status:"hit",value}` / `{status:"miss"}` / `{status:"unavailable"}`)
// instead of a bare `CachedChannelCandidates | null`, so a genuine storage
// outage can no longer be confused with "nothing cached yet". Every
// assertion below that used to compare against `null`/`value` directly is
// rewritten to the new shape; `set()` is untouched (stays fail-soft/void).
describe("MemoryChannelCandidateCache", () => {
  it("get/set round-trip, scoped per owner (P2-S4d-FIX: tri-state contract)", async () => {
    const cache = new MemoryChannelCandidateCache();

    expect(await cache.get("owner-a", "peer-channels-v1-owner-a-2026-09-24-abc")).toEqual({ status: "miss" });

    await cache.set("owner-a", "peer-channels-v1-owner-a-2026-09-24-abc", value);
    expect(await cache.get("owner-a", "peer-channels-v1-owner-a-2026-09-24-abc")).toEqual({
      status: "hit",
      value,
    });

    // A different owner never sees another owner's row, even under the
    // exact same key string.
    expect(await cache.get("owner-b", "peer-channels-v1-owner-a-2026-09-24-abc")).toEqual({ status: "miss" });
  });

  it("never throws, even for an unknown key (P2-S4d-FIX: reports miss, never unavailable — an in-memory read cannot fail)", async () => {
    const cache = new MemoryChannelCandidateCache();
    await expect(cache.get("owner-a", "no-such-key")).resolves.toEqual({ status: "miss" });
    await expect(cache.set("owner-a", "any-key", value)).resolves.toBeUndefined();
  });
});

describe("PrivateChannelCandidateCache", () => {
  it("qualifies both reads and writes by authenticated owner and its own scope key, targeting the SAME private_paper_pools table", async () => {
    const fake = fakeClient();
    const scope = createTrustedPaperCacheScope({ ownerId: "owner-a", aiTier: 0 });
    const cache = new PrivateChannelCandidateCache(scope, fake.client as never);

    await expect(cache.get("owner-a", "peer-channels-v1-owner-a-2026-09-24-abc")).resolves.toEqual({
      status: "hit",
      value,
    });
    expect(fake.from).toHaveBeenCalledWith("private_paper_pools");
    expect(fake.select).toHaveBeenCalledWith("payload");
    expect(fake.firstEq).toHaveBeenCalledWith("owner_id", "owner-a");
    expect(fake.secondEq).toHaveBeenCalledWith("scope_key", "peer-channels-v1-owner-a-2026-09-24-abc");

    await cache.set("owner-a", "peer-channels-v1-owner-a-2026-09-24-abc", value);
    expect(fake.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        owner_id: "owner-a",
        scope_key: "peer-channels-v1-owner-a-2026-09-24-abc",
        payload: value,
      }),
      { onConflict: "owner_id,scope_key" },
    );
  });

  it("own prefix guard: a key not starting with \"peer-channels-v1-\" is refused by both get and set (P2-S4d-FIX: reports miss, not unavailable — a routing guard against a caller bug, not a storage failure)", async () => {
    const fake = fakeClient();
    const scope = createTrustedPaperCacheScope({ ownerId: "owner-a", aiTier: 0 });
    const cache = new PrivateChannelCandidateCache(scope, fake.client as never);

    // Deliberately using the DAY-POOL's own prefix, to prove the two caches'
    // rows can never be confused for one another in either direction.
    const dayPoolKey = `${PAPER_POOL_KEY_PREFIX}2026-09-24-abc`;
    await expect(cache.get("owner-a", dayPoolKey)).resolves.toEqual({ status: "miss" });
    expect(fake.from).not.toHaveBeenCalled();

    await cache.set("owner-a", dayPoolKey, value);
    expect(fake.from).not.toHaveBeenCalled();
  });

  it("refuses a key/owner mismatch against the scope it was constructed with (P2-S4d-FIX: reports miss, not unavailable)", async () => {
    const fake = fakeClient();
    const scope = createTrustedPaperCacheScope({ ownerId: "owner-a", aiTier: 0 });
    const cache = new PrivateChannelCandidateCache(scope, fake.client as never);

    await expect(
      cache.get("owner-mismatch", "peer-channels-v1-owner-mismatch-2026-09-24-abc"),
    ).resolves.toEqual({ status: "miss" });
    expect(fake.from).not.toHaveBeenCalled();
  });

  it("P2-S4d-FIX: unconfigured Supabase client on an otherwise-trusted call reports UNAVAILABLE, never a silent miss (set() stays fail-soft/no-op)", async () => {
    const scope = createTrustedPaperCacheScope({ ownerId: "owner-a", aiTier: 0 });
    // No client passed and no NEXT_PUBLIC_SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY
    // configured in this test environment -- constructor falls back to its
    // own `configuredChannelCacheClient()`, which must return null here.
    // Owner + key prefix are otherwise valid (this call IS meant for this
    // instance), so before P2-S4d-FIX this silently degraded to a miss —
    // letting the resolver take the live-fetch path on every request rather
    // than reporting the misconfiguration. It must now be "unavailable".
    const cache = new PrivateChannelCandidateCache(scope);

    await expect(cache.get("owner-a", "peer-channels-v1-owner-a-2026-09-24-abc")).resolves.toEqual({
      status: "unavailable",
    });
    // set() is out of P2-S4d-FIX's scope -- still fail-soft, still resolves.
    await expect(cache.set("owner-a", "peer-channels-v1-owner-a-2026-09-24-abc", value)).resolves.toBeUndefined();
  });

  it("P2-S4d-FIX: a thrown/rejected query reports UNAVAILABLE on get(); set() stays fail-soft, never throws", async () => {
    const throwing = {
      from: vi.fn(() => ({
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            eq: vi.fn(() => ({ maybeSingle: vi.fn().mockRejectedValue(new Error("db down")) })),
          })),
        })),
        upsert: vi.fn().mockRejectedValue(new Error("db down")),
      })),
    };
    const scope = createTrustedPaperCacheScope({ ownerId: "owner-a", aiTier: 0 });
    const cache = new PrivateChannelCandidateCache(scope, throwing as never);

    // Before P2-S4d-FIX this resolved `null` -- indistinguishable from a
    // genuine miss, so a real outage fetched live on every request.
    await expect(cache.get("owner-a", "peer-channels-v1-owner-a-2026-09-24-abc")).resolves.toEqual({
      status: "unavailable",
    });
    await expect(
      cache.set("owner-a", "peer-channels-v1-owner-a-2026-09-24-abc", value),
    ).resolves.toBeUndefined();
  });

  it("P2-S4d-FIX: a Supabase query that resolves with an `error` object (no throw) also reports UNAVAILABLE", async () => {
    const erroring = {
      from: vi.fn(() => ({
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            eq: vi.fn(() => ({
              maybeSingle: vi.fn().mockResolvedValue({ data: null, error: { message: "connection reset" } }),
            })),
          })),
        })),
        upsert: vi.fn().mockResolvedValue({ error: null }),
      })),
    };
    const scope = createTrustedPaperCacheScope({ ownerId: "owner-a", aiTier: 0 });
    const cache = new PrivateChannelCandidateCache(scope, erroring as never);

    // This is the realistic outage shape Fresh A's Finding 2 named: no JS
    // throw, just a populated Supabase `error` field alongside `data: null`.
    await expect(cache.get("owner-a", "peer-channels-v1-owner-a-2026-09-24-abc")).resolves.toEqual({
      status: "unavailable",
    });
  });

  it("P2-S4d-FIX: no row found (data null, no error) is a genuine MISS, not unavailable", async () => {
    const empty = {
      from: vi.fn(() => ({
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            eq: vi.fn(() => ({ maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }) })),
          })),
        })),
        upsert: vi.fn().mockResolvedValue({ error: null }),
      })),
    };
    const scope = createTrustedPaperCacheScope({ ownerId: "owner-a", aiTier: 0 });
    const cache = new PrivateChannelCandidateCache(scope, empty as never);

    await expect(cache.get("owner-a", "peer-channels-v1-owner-a-2026-09-24-abc")).resolves.toEqual({
      status: "miss",
    });
  });

  it("P2-S4d-FIX: a row whose payload fails shape validation is a self-healing MISS, not unavailable", async () => {
    const corrupt = {
      from: vi.fn(() => ({
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            eq: vi.fn(() => ({
              maybeSingle: vi.fn().mockResolvedValue({ data: { payload: { garbage: true } }, error: null }),
            })),
          })),
        })),
        upsert: vi.fn().mockResolvedValue({ error: null }),
      })),
    };
    const scope = createTrustedPaperCacheScope({ ownerId: "owner-a", aiTier: 0 });
    const cache = new PrivateChannelCandidateCache(scope, corrupt as never);

    // The READ succeeded; the stored SHAPE is wrong (e.g. an older,
    // incompatible schema version). Reported as a miss, not unavailable, so
    // it self-heals on the next successful write rather than permanently
    // wedging this signature's live legs closed behind one bad row.
    await expect(cache.get("owner-a", "peer-channels-v1-owner-a-2026-09-24-abc")).resolves.toEqual({
      status: "miss",
    });
  });
});

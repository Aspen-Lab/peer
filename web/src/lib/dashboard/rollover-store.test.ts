import { describe, expect, it } from "vitest";
import {
  MemoryRolloverCandidateStore,
  SupabaseRolloverCandidateStore,
  type RolloverCandidateInput,
} from "./rollover-store";

// P4-S6 (Round 3) -- F-A-P4-08 remainder, ABC-JEV-INTEGRATION.md
// §1g/§1p.C.4. This module is the repository interface for the
// never-delivered-only rollover mechanism: a DEDICATED table (per the
// binding ruling, NOT a jsonb column on dashboard_batches -- a day with no
// visit has no batch row at all, yet up to 30 candidates from the last
// computed final pool must still survive to compete on a later day).
//
// Unlike delivery-ledger.ts's two-tier read/write failure rules (reads
// fail-open, writes throw), EVERY method here is fail-soft in BOTH
// directions: losing rollover data (a read OR a write failure) only ever
// means fewer candidates compete tomorrow -- never a delivered paper
// returning, since that guarantee is enforced independently and entirely by
// the ledger's own exclusion filter, which a rollover candidate passes
// through unmodified once merged into the pipeline's candidate set
// (web/src/lib/feed/rollover.test.ts covers that half). So `list` always
// resolves (never throws, degrading to `[]`) and `upsert` always resolves
// (never throws, silently no-op-ing on failure).

function candidate(key: string, opts: Partial<RolloverCandidateInput> = {}): RolloverCandidateInput {
  return { key, aliases: opts.aliases ?? [], payload: opts.payload ?? { key }, intentVersion: opts.intentVersion };
}

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

describe("MemoryRolloverCandidateStore contract", () => {
  it("returns nothing for an owner with no stored candidates", async () => {
    const store = new MemoryRolloverCandidateStore();
    expect(await store.list("owner-1", new Date())).toEqual([]);
  });

  it("upsert then list returns the candidate with matching key/aliases/payload and both date fields set to the local date given", async () => {
    const store = new MemoryRolloverCandidateStore();
    const now = new Date("2026-09-24T09:00:00.000Z");
    await store.upsert("owner-1", "2026-09-24", [
      candidate("doi:10.1000/abc", { aliases: ["title:some paper"], payload: { title: "Some Paper" } }),
    ]);

    const rows = await store.list("owner-1", now);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      key: "doi:10.1000/abc",
      aliases: ["title:some paper"],
      payload: { title: "Some Paper" },
      lastPoolDate: "2026-09-24",
    });
    expect(rows[0].firstSeenAt).toEqual(expect.any(String));
  });

  it("keeps first_seen across repeated upserts of the same canonical key, but updates payload and last_pool_date", async () => {
    const store = new MemoryRolloverCandidateStore();
    await store.upsert("owner-1", "2026-09-24", [
      candidate("doi:10.1000/abc", { payload: { version: 1 } }),
    ]);
    const firstRows = await store.list("owner-1", new Date("2026-09-24T09:00:00.000Z"));
    const firstSeenAt = firstRows[0].firstSeenAt;

    await store.upsert("owner-1", "2026-09-25", [
      candidate("doi:10.1000/abc", { payload: { version: 2 } }),
    ]);
    const secondRows = await store.list("owner-1", new Date("2026-09-25T09:00:00.000Z"));

    expect(secondRows).toHaveLength(1);
    expect(secondRows[0].firstSeenAt).toBe(firstSeenAt); // unchanged
    expect(secondRows[0].lastPoolDate).toBe("2026-09-25"); // updated
    expect(secondRows[0].payload).toEqual({ version: 2 }); // updated
  });

  it("does not return a candidate whose first_seen is more than 30 days before `now`", async () => {
    const store = new MemoryRolloverCandidateStore();
    const firstSeen = new Date("2026-01-01T00:00:00.000Z");
    await store.upsert("owner-1", "2026-01-01", [candidate("doi:10.1000/stale")]);

    // Force firstSeenAt into the past by upserting, then listing far enough
    // ahead that the retention window has elapsed. MemoryRolloverCandidateStore
    // stamps firstSeenAt with the real wall clock at upsert time, so this test
    // reads it back and constructs `now` relative to it rather than assuming a
    // fixed offset from `firstSeen` above (kept only to document intent).
    const stored = await store.list("owner-1", new Date());
    const actualFirstSeenMs = Date.parse(stored[0].firstSeenAt);
    void firstSeen;

    const justExpired = new Date(actualFirstSeenMs + THIRTY_DAYS_MS + 1);
    expect(await store.list("owner-1", justExpired)).toEqual([]);
  });

  it("still returns a candidate seen just under 30 days ago", async () => {
    const store = new MemoryRolloverCandidateStore();
    await store.upsert("owner-1", "2026-01-01", [candidate("doi:10.1000/almost-stale")]);
    const stored = await store.list("owner-1", new Date());
    const actualFirstSeenMs = Date.parse(stored[0].firstSeenAt);

    const justBeforeExpiry = new Date(actualFirstSeenMs + THIRTY_DAYS_MS - 1);
    const rows = await store.list("owner-1", justBeforeExpiry);
    expect(rows.map((r) => r.key)).toContain("doi:10.1000/almost-stale");
  });

  // P4-S6-FIX (F-A-P4S6-02) -- the exact point the two tests above bracket
  // but never hit directly. This is the canonical retention definition (see
  // this module's top-of-file comment and this method's own inline
  // comment): a candidate is retained while STRICTLY less than 30 days old,
  // so exactly-30-days-old is expired. SupabaseRolloverCandidateStore is
  // now aligned to this same boundary (`.gt`, not `.gte`) -- see the
  // "configured" describe block below for the equivalent Supabase-side
  // proof with a fake client.
  it("(F-A-P4S6-02) does not return a candidate whose first_seen is EXACTLY 30 days before now -- the canonical boundary is exclusive", async () => {
    const store = new MemoryRolloverCandidateStore();
    await store.upsert("owner-1", "2026-01-01", [candidate("doi:10.1000/exact-boundary")]);
    const stored = await store.list("owner-1", new Date());
    const actualFirstSeenMs = Date.parse(stored[0].firstSeenAt);

    const exactlyAtBoundary = new Date(actualFirstSeenMs + THIRTY_DAYS_MS);
    expect(await store.list("owner-1", exactlyAtBoundary)).toEqual([]);
  });

  // P4-S6-FIX (F-A-P4S6-01) -- intentVersion round-trip contract: stamped
  // fresh on every upsert (unlike firstSeenAt, which is preserved from the
  // first write), read back unchanged, absent when the caller supplies
  // none. route.test.ts covers the actual admissionChannels-stripping
  // behaviour that consumes this field; this module only needs to prove it
  // stores/returns the opaque string faithfully.
  it("(P4-S6-FIX) upsert stores intentVersion and list returns it unchanged", async () => {
    const store = new MemoryRolloverCandidateStore();
    await store.upsert("owner-1", "2026-09-24", [
      candidate("doi:10.1000/tagged", { intentVersion: "intent-snapshot-a" }),
    ]);
    const rows = await store.list("owner-1", new Date());
    expect(rows[0].intentVersion).toBe("intent-snapshot-a");
  });

  it("(P4-S6-FIX) intentVersion is undefined by default when the caller supplies none", async () => {
    const store = new MemoryRolloverCandidateStore();
    await store.upsert("owner-1", "2026-09-24", [candidate("doi:10.1000/untagged")]);
    const rows = await store.list("owner-1", new Date());
    expect(rows[0].intentVersion).toBeUndefined();
  });

  it("(P4-S6-FIX) a re-upsert OVERWRITES intentVersion to the new value -- unlike firstSeenAt, it is never preserved from the first write", async () => {
    const store = new MemoryRolloverCandidateStore();
    await store.upsert("owner-1", "2026-09-24", [
      candidate("doi:10.1000/reintent", { intentVersion: "intent-snapshot-a" }),
    ]);
    await store.upsert("owner-1", "2026-09-25", [
      candidate("doi:10.1000/reintent", { intentVersion: "intent-snapshot-b" }),
    ]);
    const rows = await store.list("owner-1", new Date());
    expect(rows[0].intentVersion).toBe("intent-snapshot-b");
  });

  it("isolates owners: one owner's upsert never appears in another owner's list", async () => {
    const store = new MemoryRolloverCandidateStore();
    await store.upsert("owner-1", "2026-09-24", [candidate("doi:10.1000/only-owner-1")]);
    expect(await store.list("owner-2", new Date())).toEqual([]);
  });

  it("upsert with an empty candidates array is a safe no-op", async () => {
    const store = new MemoryRolloverCandidateStore();
    await expect(store.upsert("owner-1", "2026-09-24", [])).resolves.toBeUndefined();
    expect(await store.list("owner-1", new Date())).toEqual([]);
  });

  it("two candidates with different canonical keys both persist independently in one upsert call", async () => {
    const store = new MemoryRolloverCandidateStore();
    await store.upsert("owner-1", "2026-09-24", [
      candidate("doi:10.1000/a"),
      candidate("doi:10.1000/b"),
    ]);
    const rows = await store.list("owner-1", new Date());
    expect(rows.map((r) => r.key).sort()).toEqual(["doi:10.1000/a", "doi:10.1000/b"]);
  });
});

// ── SupabaseRolloverCandidateStore ──────────────────────────────────────

type RolloverClient = ConstructorParameters<typeof SupabaseRolloverCandidateStore>[0];

/** Same thenable-chain double shape delivery-ledger.supabase.test.ts already established for this codebase's hand-rolled narrow Supabase client interfaces. */
function chainableSelect(result: { data: unknown; error: unknown }) {
  const node = {
    eq: () => node,
    // P4-S6-FIX (F-A-P4S6-02): renamed from `gte` -- the real client only
    // ever calls `.gt` now (rollover-store.ts's list(), aligned to
    // MemoryRolloverCandidateStore's own exclusive/strict boundary).
    gt: () => node,
    then: (
      onFulfilled: (value: typeof result) => unknown,
      onRejected?: (reason: unknown) => unknown,
    ) => Promise.resolve(result).then(onFulfilled, onRejected),
  };
  return node;
}

/**
 * P4-S6-FIX (F-A-P4S6-02) -- unlike chainableSelect (a fixed canned array
 * regardless of what was actually filtered), this fake genuinely applies
 * `eq`/`gt` to an in-memory row set, so it can prove the REAL
 * SupabaseRolloverCandidateStore code path excludes the exact same
 * boundary row MemoryRolloverCandidateStore excludes -- without a live
 * Postgres instance (none is available to this agent). ISO-8601 UTC
 * timestamp strings (what `.toISOString()` always produces) compare
 * correctly with plain string `>`, exactly like Postgres compares the
 * equivalent timestamptz values, so this is a faithful stand-in for the
 * real comparator, not just an argument-capture spy.
 */
function boundaryFilteringClient(rows: Array<Record<string, unknown>>): RolloverClient {
  return {
    from: () => ({
      select: () => {
        let filtered = rows;
        const node = {
          eq: (column: string, value: string) => {
            filtered = filtered.filter((row) => row[column] === value);
            return node;
          },
          gt: (column: string, value: string) => {
            filtered = filtered.filter((row) => (row[column] as string) > value);
            return node;
          },
          then: (
            onFulfilled: (value: { data: unknown; error: unknown }) => unknown,
            onRejected?: (reason: unknown) => unknown,
          ) => Promise.resolve({ data: filtered, error: null }).then(onFulfilled, onRejected),
        };
        return node;
      },
    }),
  } as unknown as RolloverClient;
}

describe("SupabaseRolloverCandidateStore -- unconfigured (no client)", () => {
  it("degrades to an in-memory, non-durable fallback for both list and upsert", async () => {
    const store = new SupabaseRolloverCandidateStore(null);
    await store.upsert("owner-1", "2026-09-24", [candidate("doi:10.1000/unconfigured")]);
    const rows = await store.list("owner-1", new Date());
    expect(rows.map((r) => r.key)).toEqual(["doi:10.1000/unconfigured"]);
  });
});

describe("SupabaseRolloverCandidateStore -- configured (injected fake client, no network)", () => {
  // P4-S6-FIX (Round 3): was "...a first_seen_at >= cutoff filter..." --
  // F-A-P4S6-02 found `.gte` (inclusive) disagreed with
  // MemoryRolloverCandidateStore's strict `>` boundary. Now also records
  // the actual `.gt` call so this test proves the real client is queried
  // with the exclusive comparator and the correct cutoff value, not just
  // that some filter was applied; and the canned row/expected output both
  // gained `intent_version`/`intentVersion` (P4-S6-FIX's new field).
  it("list selects by owner_id with a first_seen_at > cutoff filter and maps rows back to RolloverCandidate, including intent_version", async () => {
    const seen: Array<{ table: string; columns: string }> = [];
    const gtCalls: Array<{ column: string; value: string }> = [];
    const client: RolloverClient = {
      from: (table: string) => {
        seen.push({ table, columns: "" });
        return {
          select: (columns: string) => {
            seen[seen.length - 1].columns = columns;
            const node = {
              eq: () => node,
              gt: (column: string, value: string) => {
                gtCalls.push({ column, value });
                return node;
              },
              then: (
                onFulfilled: (value: { data: unknown; error: unknown }) => unknown,
                onRejected?: (reason: unknown) => unknown,
              ) =>
                Promise.resolve({
                  data: [
                    {
                      canonical_key: "doi:10.1000/x",
                      aliases: ["title:x paper"],
                      payload: { title: "X" },
                      first_seen_at: "2026-09-01T00:00:00.000Z",
                      last_pool_date: "2026-09-23",
                      intent_version: "intent-snapshot-x",
                    },
                  ],
                  error: null,
                }).then(onFulfilled, onRejected),
            };
            return node;
          },
        };
      },
    } as unknown as RolloverClient;

    const store = new SupabaseRolloverCandidateStore(client);
    const rows = await store.list("owner-1", new Date("2026-09-24T00:00:00.000Z"));

    expect(seen[0].table).toBe("dashboard_rollover_candidates");
    expect(gtCalls).toEqual([
      { column: "first_seen_at", value: new Date("2026-08-25T00:00:00.000Z").toISOString() },
    ]);
    expect(rows).toEqual([
      {
        key: "doi:10.1000/x",
        aliases: ["title:x paper"],
        payload: { title: "X" },
        firstSeenAt: "2026-09-01T00:00:00.000Z",
        lastPoolDate: "2026-09-23",
        intentVersion: "intent-snapshot-x",
      },
    ]);
  });

  it("(F-A-P4S6-02) excludes a candidate whose first_seen_at is EXACTLY 30 days before now, matching MemoryRolloverCandidateStore's boundary exactly (fake client applies the real filter, no network)", async () => {
    const now = new Date("2026-09-24T00:00:00.000Z");
    const cutoffIso = new Date(now.getTime() - THIRTY_DAYS_MS).toISOString();
    const oneMsInsideIso = new Date(now.getTime() - THIRTY_DAYS_MS + 1).toISOString();
    const client = boundaryFilteringClient([
      {
        owner_id: "owner-1",
        canonical_key: "doi:10.1000/exactly-at-cutoff",
        aliases: [],
        payload: {},
        first_seen_at: cutoffIso,
        last_pool_date: "2026-08-25",
        intent_version: null,
      },
      {
        owner_id: "owner-1",
        canonical_key: "doi:10.1000/one-ms-inside",
        aliases: [],
        payload: {},
        first_seen_at: oneMsInsideIso,
        last_pool_date: "2026-08-25",
        intent_version: null,
      },
    ]);

    const store = new SupabaseRolloverCandidateStore(client);
    const rows = await store.list("owner-1", now);

    expect(rows.map((r) => r.key)).toEqual(["doi:10.1000/one-ms-inside"]);
  });

  it("(P4-S6-FIX) maps a null intent_version column to undefined, and a non-null value through unchanged", async () => {
    const client = boundaryFilteringClient([
      {
        owner_id: "owner-1",
        canonical_key: "doi:10.1000/no-intent",
        aliases: [],
        payload: {},
        first_seen_at: "2026-09-20T00:00:00.000Z",
        last_pool_date: "2026-09-23",
        intent_version: null,
      },
      {
        owner_id: "owner-1",
        canonical_key: "doi:10.1000/has-intent",
        aliases: [],
        payload: {},
        first_seen_at: "2026-09-20T00:00:00.000Z",
        last_pool_date: "2026-09-23",
        intent_version: "intent-snapshot-y",
      },
    ]);

    const store = new SupabaseRolloverCandidateStore(client);
    const rows = await store.list("owner-1", new Date("2026-09-24T00:00:00.000Z"));

    const byKey = new Map(rows.map((r) => [r.key, r]));
    expect(byKey.get("doi:10.1000/no-intent")?.intentVersion).toBeUndefined();
    expect(byKey.get("doi:10.1000/has-intent")?.intentVersion).toBe("intent-snapshot-y");
  });

  it("list fails soft to [] when the query returns an error", async () => {
    const client: RolloverClient = {
      from: () => ({
        select: () => chainableSelect({ data: null, error: "boom" }),
      }),
    } as unknown as RolloverClient;

    const store = new SupabaseRolloverCandidateStore(client);
    expect(await store.list("owner-1", new Date())).toEqual([]);
  });

  it("list fails soft to [] when the client throws", async () => {
    const client: RolloverClient = {
      from: () => {
        throw new Error("network down");
      },
    } as unknown as RolloverClient;

    const store = new SupabaseRolloverCandidateStore(client);
    expect(await store.list("owner-1", new Date())).toEqual([]);
  });

  it("upsert calls the upsert_rollover_candidates RPC once with owner id, local date, and a {key, aliases, payload} candidates array", async () => {
    const rpcCalls: unknown[] = [];
    const client: RolloverClient = {
      rpc: (fn: string, args: unknown) => {
        rpcCalls.push({ fn, args });
        return Promise.resolve({ data: null, error: null });
      },
    } as unknown as RolloverClient;

    const store = new SupabaseRolloverCandidateStore(client);
    await store.upsert("owner-1", "2026-09-24", [
      candidate("doi:10.1000/y", { aliases: ["title:y paper"], payload: { title: "Y" } }),
    ]);

    expect(rpcCalls).toEqual([
      {
        fn: "upsert_rollover_candidates",
        args: {
          p_owner_id: "owner-1",
          p_local_date: "2026-09-24",
          p_candidates: [{ key: "doi:10.1000/y", aliases: ["title:y paper"], payload: { title: "Y" } }],
        },
      },
    ]);
  });

  it("upsert never throws when the RPC itself returns an error", async () => {
    const client: RolloverClient = {
      rpc: () => Promise.resolve({ data: null, error: "boom" }),
    } as unknown as RolloverClient;

    const store = new SupabaseRolloverCandidateStore(client);
    await expect(
      store.upsert("owner-1", "2026-09-24", [candidate("doi:10.1000/z")]),
    ).resolves.toBeUndefined();
  });

  it("upsert never throws when the client itself throws", async () => {
    const client: RolloverClient = {
      rpc: () => {
        throw new Error("network down");
      },
    } as unknown as RolloverClient;

    const store = new SupabaseRolloverCandidateStore(client);
    await expect(
      store.upsert("owner-1", "2026-09-24", [candidate("doi:10.1000/z")]),
    ).resolves.toBeUndefined();
  });

  it("upsert makes no RPC call at all when candidates is empty", async () => {
    let called = false;
    const client: RolloverClient = {
      rpc: () => {
        called = true;
        return Promise.resolve({ data: null, error: null });
      },
    } as unknown as RolloverClient;

    const store = new SupabaseRolloverCandidateStore(client);
    await store.upsert("owner-1", "2026-09-24", []);
    expect(called).toBe(false);
  });

  it("(P4-S6-FIX) upsert includes intentVersion in the RPC candidates array when the caller supplies one", async () => {
    const rpcCalls: unknown[] = [];
    const client: RolloverClient = {
      rpc: (fn: string, args: unknown) => {
        rpcCalls.push({ fn, args });
        return Promise.resolve({ data: null, error: null });
      },
    } as unknown as RolloverClient;

    const store = new SupabaseRolloverCandidateStore(client);
    await store.upsert("owner-1", "2026-09-24", [
      candidate("doi:10.1000/y2", {
        aliases: ["title:y2 paper"],
        payload: { title: "Y2" },
        intentVersion: "intent-snapshot-z",
      }),
    ]);

    expect(rpcCalls).toEqual([
      {
        fn: "upsert_rollover_candidates",
        args: {
          p_owner_id: "owner-1",
          p_local_date: "2026-09-24",
          p_candidates: [
            {
              key: "doi:10.1000/y2",
              aliases: ["title:y2 paper"],
              payload: { title: "Y2" },
              intentVersion: "intent-snapshot-z",
            },
          ],
        },
      },
    ]);
  });
});

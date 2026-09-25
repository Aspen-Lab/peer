import { describe, expect, it, vi } from "vitest";
import { SupabaseDashboardDeliveryLedger, type PaperIdentity } from "./delivery-ledger";

// P4-S4 (Round 3) -- formalizes docs/jev-abc/P4-S1-A-20260924T0441Z.md's
// out-of-repo probe scenarios (finding F-A-P4S1-02) as permanent, in-repo
// tests. That fresh A found SupabaseDashboardDeliveryLedger's
// configured-client insert/select/update branches had ZERO test coverage in
// delivery-ledger.test.ts (only acknowledgeBatch's .rpc() call was
// exercised there) -- it closed the gap with 9 scratchpad-only probes
// against the real, unmodified module (all passed) and reproduced two of
// them verbatim in its own checkpoint's EVIDENCE section. The manager's
// ruling on that finding (ABC-JEV-INTEGRATION.md §1p, "P4-S1 fresh A" log
// entry, 2026-09-24T05:10Z) directs: "the next C that touches
// delivery-ledger.test.ts (P4-S4) must add in-repo tests for those
// scenarios." This is a SEPARATE new file rather than an edit to
// delivery-ledger.test.ts (not in this slice's allowed-file list), covering
// the same ground A's probes did: prepareBatch's insert-conflict fallback,
// markServed's owner-scoped update, listDelivered/listServedUnacknowledged/
// getBatch's configured-client fail-open reads, and acknowledgeBatch's RPC
// mapping/error-to-throw contract (already partly covered in
// delivery-ledger.test.ts; repeated here so this file stands alone as the
// full formalized probe set).
//
// Every test below exercises EXISTING code (P4-S1's
// SupabaseDashboardDeliveryLedger, unchanged by this slice) against an
// injected fake client -- the same constructor injection seam
// delivery-ledger.test.ts's own "configured (injected fake client, no
// network)" tests already use. None of these were expected to start red,
// and none did -- see the P4-S4 checkpoint's EVIDENCE section for the exact
// command/timestamp/counts this was confirmed with.

function paper(key: string, aliases: readonly string[] = []): PaperIdentity {
  return { key, aliases };
}

type LedgerClient = ConstructorParameters<typeof SupabaseDashboardDeliveryLedger>[0];

/**
 * A minimal thenable double for the `.select(...).eq(...)[.eq(...)]
 * [.maybeSingle()]` chains every read method issues -- serves getBatch
 * (ends in `.maybeSingle()`), listDelivered/listServedUnacknowledged
 * (awaited directly after one or two `.eq()` calls) alike. Same shape as
 * delivery-ledger.test.ts's own `chainableResult` helper.
 */
function chainableSelect(result: { data: unknown; error: unknown }) {
  const node = {
    eq: () => node,
    // P4-S9 -- passthroughs for listServedBatchDates' extra chain methods
    // (.in/.order/.limit), so every existing caller of this helper (getBatch,
    // listDelivered, listServedUnacknowledged) keeps working unchanged while
    // the same double can also back the new method's longer chain.
    in: () => node,
    order: () => node,
    limit: () => node,
    maybeSingle: () => Promise.resolve(result),
    then: (
      onFulfilled: (value: typeof result) => unknown,
      onRejected?: (reason: unknown) => unknown,
    ) => Promise.resolve(result).then(onFulfilled, onRejected),
  };
  return node;
}

/**
 * P4-S9 -- records the exact chain calls listServedBatchDates issues
 * (select columns, eq/in filters, order, limit), so the query SHAPE itself
 * (not just its resolved result) can be asserted directly -- same
 * discipline as fakeMarkServedClient's eqCalls recorder above.
 */
function fakeDatesQueryClient(result: { data: unknown; error: unknown }) {
  const calls: {
    select?: string;
    eq: Array<[string, string]>;
    in: Array<[string, readonly string[]]>;
    order?: [string, { ascending: boolean }];
    limit?: number;
  } = { eq: [], in: [] };
  const node = {
    eq: (column: string, value: string) => {
      calls.eq.push([column, value]);
      return node;
    },
    in: (column: string, values: readonly string[]) => {
      calls.in.push([column, values]);
      return node;
    },
    order: (column: string, options: { ascending: boolean }) => {
      calls.order = [column, options];
      return node;
    },
    limit: (count: number) => {
      calls.limit = count;
      return node;
    },
    then: (
      onFulfilled: (value: typeof result) => unknown,
      onRejected?: (reason: unknown) => unknown,
    ) => Promise.resolve(result).then(onFulfilled, onRejected),
  };
  const client = {
    from: (table: string) => {
      if (table !== "dashboard_batches") throw new Error(`fakeDatesQueryClient: unexpected table ${table}`);
      return {
        select: (columns: string) => {
          calls.select = columns;
          return node;
        },
      };
    },
  } as unknown as LedgerClient;
  return { client, calls };
}

function fakeSelectOnlyClient(
  table: "dashboard_batches" | "dashboard_deliveries",
  result: { data: unknown; error: unknown },
): LedgerClient {
  return {
    from: (t: string) => {
      if (t !== table) throw new Error(`fakeSelectOnlyClient: unexpected table ${t}`);
      return { select: () => chainableSelect(result) };
    },
  } as unknown as LedgerClient;
}

/** Backs prepareBatch's configured-client branch: `insert(...).select(...).maybeSingle()`, plus the fallback `select(...).eq(...).eq(...).maybeSingle()` read prepareBatch issues when the insert fails. */
function fakeBatchesInsertClient(opts: {
  insert: { data: unknown; error: unknown };
  fallbackSelect?: { data: unknown; error: unknown };
}) {
  const insertCalls: unknown[] = [];
  const client = {
    from: (table: string) => {
      if (table !== "dashboard_batches") throw new Error(`fakeBatchesInsertClient: unexpected table ${table}`);
      return {
        insert: (row: unknown) => {
          insertCalls.push(row);
          return { select: () => ({ maybeSingle: () => Promise.resolve(opts.insert) }) };
        },
        select: () => chainableSelect(opts.fallbackSelect ?? { data: null, error: null }),
      };
    },
  } as unknown as LedgerClient;
  return { client, insertCalls };
}

/** Backs markServed's configured-client branch: `update(...).eq(...).eq(...).eq(...)`, recording every eq() call so the owner/id/status scoping can be asserted directly. */
function fakeMarkServedClient(result: { error: unknown }) {
  const eqCalls: Array<[string, string]> = [];
  const updateCalls: unknown[] = [];
  const node = {
    eq: (column: string, value: string) => {
      eqCalls.push([column, value]);
      return node;
    },
    then: (
      onFulfilled: (value: typeof result) => unknown,
      onRejected?: (reason: unknown) => unknown,
    ) => Promise.resolve(result).then(onFulfilled, onRejected),
  };
  const client = {
    from: (table: string) => {
      if (table !== "dashboard_batches") throw new Error(`fakeMarkServedClient: unexpected table ${table}`);
      return {
        update: (row: unknown) => {
          updateCalls.push(row);
          return node;
        },
      };
    },
  } as unknown as LedgerClient;
  return { client, eqCalls, updateCalls };
}

function erroringUpdateChain(error: unknown) {
  const node = {
    eq: () => node,
    then: (
      onFulfilled: (value: { error: unknown }) => unknown,
      onRejected?: (reason: unknown) => unknown,
    ) => Promise.resolve({ error }).then(onFulfilled, onRejected),
  };
  return node;
}

/** One client where every read and every write errors -- formalizes P4-S1 fresh A's probe #9 ("on one always-erroring fake client, listDelivered/listServedUnacknowledged/getBatch all resolve to empty/null while prepareBatch/markServed/acknowledgeBatch all reject"). */
function alwaysErroringClient(): LedgerClient {
  const error = { message: "connection reset" };
  return {
    from: (table: string) => {
      if (table === "dashboard_deliveries") {
        return { select: () => chainableSelect({ data: null, error }) };
      }
      if (table === "dashboard_batches") {
        return {
          select: () => chainableSelect({ data: null, error }),
          insert: () => ({ select: () => ({ maybeSingle: () => Promise.resolve({ data: null, error }) }) }),
          update: () => erroringUpdateChain(error),
        };
      }
      throw new Error(`alwaysErroringClient: unexpected table ${table}`);
    },
    rpc: () => Promise.resolve({ data: null, error }),
  } as unknown as LedgerClient;
}

describe("SupabaseDashboardDeliveryLedger.prepareBatch (configured client)", () => {
  it("inserts and returns the new row, mapped from snake_case to the TS DashboardBatch shape", async () => {
    const insertedRow = {
      id: "batch-abc",
      owner_id: "owner-1",
      local_date: "2026-09-24",
      papers: [{ key: "doi:a", aliases: ["title:a"] }],
      status: "prepared" as const,
      intent_version: "intent-v1",
      created_at: "2026-09-24T00:00:00.000Z",
      served_at: null,
      acknowledged_at: null,
    };
    const { client, insertCalls } = fakeBatchesInsertClient({ insert: { data: insertedRow, error: null } });
    const ledger = new SupabaseDashboardDeliveryLedger(client);

    const result = await ledger.prepareBatch(
      "owner-1",
      "2026-09-24",
      [paper("doi:a", ["title:a"])],
      "intent-v1",
    );

    expect(insertCalls).toEqual([
      {
        owner_id: "owner-1",
        local_date: "2026-09-24",
        papers: [{ key: "doi:a", aliases: ["title:a"] }],
        status: "prepared",
        intent_version: "intent-v1",
      },
    ]);
    expect(result).toEqual({
      id: "batch-abc",
      ownerId: "owner-1",
      localDate: "2026-09-24",
      papers: [{ key: "doi:a", aliases: ["title:a"] }],
      status: "prepared",
      intentVersion: "intent-v1",
      createdAt: "2026-09-24T00:00:00.000Z",
      servedAt: undefined,
      acknowledgedAt: undefined,
    });
  });

  it("falls back to the existing row when insert fails with a unique-violation-shaped error (first-writer-wins, never merges)", async () => {
    const existingRow = {
      id: "existing-batch-id",
      owner_id: "owner-1",
      local_date: "2026-09-24",
      papers: [{ key: "doi:winner", aliases: [] }],
      status: "prepared" as const,
      intent_version: null,
      created_at: "2026-09-24T00:00:00.000Z",
      served_at: null,
      acknowledged_at: null,
    };
    const { client } = fakeBatchesInsertClient({
      insert: {
        data: null,
        error: { message: 'duplicate key value violates unique constraint "dashboard_batches_owner_id_local_date_key"' },
      },
      fallbackSelect: { data: existingRow, error: null },
    });
    const ledger = new SupabaseDashboardDeliveryLedger(client);

    const result = await ledger.prepareBatch("owner-1", "2026-09-24", [paper("doi:loser")]);

    expect(result.id).toBe("existing-batch-id");
    // The losing call's papers are discarded, never merged into the winner.
    expect(result.papers.map((p) => p.key)).toEqual(["doi:winner"]);
  });

  it("throws when insert fails and the fallback read also finds nothing (never fabricates success)", async () => {
    const { client } = fakeBatchesInsertClient({
      insert: { data: null, error: { message: "duplicate key value violates unique constraint ..." } },
      fallbackSelect: { data: null, error: null },
    });
    const ledger = new SupabaseDashboardDeliveryLedger(client);

    await expect(ledger.prepareBatch("owner-1", "2026-09-24", [paper("doi:a")])).rejects.toThrow();
  });
});

describe("SupabaseDashboardDeliveryLedger.markServed (configured client)", () => {
  it("scopes the update to this batch id, this owner, and status=prepared", async () => {
    const { client, eqCalls, updateCalls } = fakeMarkServedClient({ error: null });
    const ledger = new SupabaseDashboardDeliveryLedger(client);

    await ledger.markServed("owner-1", "batch-1");

    expect(eqCalls).toEqual([
      ["id", "batch-1"],
      ["owner_id", "owner-1"],
      ["status", "prepared"],
    ]);
    expect(updateCalls).toHaveLength(1);
    expect(updateCalls[0]).toMatchObject({ status: "served" });
  });

  it("resolves cleanly when the update succeeds", async () => {
    const { client } = fakeMarkServedClient({ error: null });
    const ledger = new SupabaseDashboardDeliveryLedger(client);

    await expect(ledger.markServed("owner-1", "batch-1")).resolves.toBeUndefined();
  });

  it("throws when the update errors, instead of silently no-op'ing the way the in-memory double does for an already-served batch", async () => {
    const { client } = fakeMarkServedClient({ error: { message: "connection reset" } });
    const ledger = new SupabaseDashboardDeliveryLedger(client);

    await expect(ledger.markServed("owner-1", "batch-1")).rejects.toThrow();
  });
});

describe("read-error degrade behaviour (configured client)", () => {
  it("listDelivered resolves to an empty Set on a configured-client error (fails open)", async () => {
    const client = fakeSelectOnlyClient("dashboard_deliveries", {
      data: null,
      error: { message: "connection reset" },
    });
    const ledger = new SupabaseDashboardDeliveryLedger(client);

    expect(await ledger.listDelivered("owner-1")).toEqual(new Set());
  });

  it("listServedUnacknowledged resolves to an empty Set on a configured-client error (fails open)", async () => {
    const client = fakeSelectOnlyClient("dashboard_batches", {
      data: null,
      error: { message: "connection reset" },
    });
    const ledger = new SupabaseDashboardDeliveryLedger(client);

    expect(await ledger.listServedUnacknowledged("owner-1")).toEqual(new Set());
  });

  it("getBatch resolves to null on a configured-client error (fails open)", async () => {
    const client = fakeSelectOnlyClient("dashboard_batches", {
      data: null,
      error: { message: "connection reset" },
    });
    const ledger = new SupabaseDashboardDeliveryLedger(client);

    expect(await ledger.getBatch("owner-1", "2026-09-24")).toBeNull();
  });

  it("listServedBatchDates resolves to an empty array on a configured-client error (fails open, P4-S9)", async () => {
    const client = fakeSelectOnlyClient("dashboard_batches", {
      data: null,
      error: { message: "connection reset" },
    });
    const ledger = new SupabaseDashboardDeliveryLedger(client);

    expect(await ledger.listServedBatchDates("owner-1", 30)).toEqual([]);
  });
});

describe("SupabaseDashboardDeliveryLedger.listServedBatchDates (configured client, P4-S9)", () => {
  it("queries dashboard_batches filtered by owner + status in [served, acknowledged], ordered by local_date desc, bounded by limit", async () => {
    const { client, calls } = fakeDatesQueryClient({
      data: [{ local_date: "2026-09-24" }, { local_date: "2026-09-22" }],
      error: null,
    });
    const ledger = new SupabaseDashboardDeliveryLedger(client);

    const result = await ledger.listServedBatchDates("owner-1", 30);

    expect(result).toEqual(["2026-09-24", "2026-09-22"]);
    expect(calls.select).toBe("local_date, status");
    expect(calls.eq).toEqual([["owner_id", "owner-1"]]);
    expect(calls.in).toEqual([["status", ["served", "acknowledged"]]]);
    expect(calls.order).toEqual(["local_date", { ascending: false }]);
    expect(calls.limit).toBe(30);
  });

  it("resolves to an empty array when the client throws synchronously (fails open, not throws)", async () => {
    const client = {
      from: () => {
        throw new Error("network down");
      },
    } as unknown as LedgerClient;
    const ledger = new SupabaseDashboardDeliveryLedger(client);

    await expect(ledger.listServedBatchDates("owner-1", 30)).resolves.toEqual([]);
  });
});

describe("SupabaseDashboardDeliveryLedger.acknowledgeBatch RPC (configured client)", () => {
  it("maps every acknowledge_dashboard_batch RPC result through unchanged", async () => {
    for (const status of ["acknowledged", "already_acknowledged", "not_found", "owner_mismatch"] as const) {
      const rpc = vi.fn().mockResolvedValue({ data: status, error: null });
      const ledger = new SupabaseDashboardDeliveryLedger({ rpc } as unknown as LedgerClient);

      await expect(ledger.acknowledgeBatch("owner-1", "batch-1")).resolves.toBe(status);
      expect(rpc).toHaveBeenCalledWith("acknowledge_dashboard_batch", {
        p_owner_id: "owner-1",
        p_batch_id: "batch-1",
      });
    }
  });

  it("throws rather than returning a fake success when the RPC itself errors (so the ack route can map it to 503, not 200)", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: { message: "connection reset" } });
    const ledger = new SupabaseDashboardDeliveryLedger({ rpc } as unknown as LedgerClient);

    await expect(ledger.acknowledgeBatch("owner-1", "batch-1")).rejects.toThrow();
  });

  it("throws on an unrecognized RPC result rather than silently passing it through as a valid AckResult", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: "something-new", error: null });
    const ledger = new SupabaseDashboardDeliveryLedger({ rpc } as unknown as LedgerClient);

    await expect(ledger.acknowledgeBatch("owner-1", "batch-1")).rejects.toThrow();
  });
});

describe("full read/write asymmetry on one always-erroring configured client (formalizes P4-S1 fresh A probe #9)", () => {
  it("every read fails open (empty Set / null); every write throws", async () => {
    const client = alwaysErroringClient();
    const ledger = new SupabaseDashboardDeliveryLedger(client);

    await expect(ledger.listDelivered("owner-1")).resolves.toEqual(new Set());
    await expect(ledger.listServedUnacknowledged("owner-1")).resolves.toEqual(new Set());
    await expect(ledger.getBatch("owner-1", "2026-09-24")).resolves.toBeNull();
    await expect(ledger.listServedBatchDates("owner-1", 30)).resolves.toEqual([]);

    await expect(ledger.prepareBatch("owner-1", "2026-09-24", [paper("doi:a")])).rejects.toThrow();
    await expect(ledger.markServed("owner-1", "batch-1")).rejects.toThrow();
    await expect(ledger.acknowledgeBatch("owner-1", "batch-1")).rejects.toThrow();
  });
});

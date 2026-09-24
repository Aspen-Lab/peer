import { afterEach, describe, expect, it, vi } from "vitest";
import {
  MemoryDashboardDeliveryLedger,
  SupabaseDashboardDeliveryLedger,
  type PaperIdentity,
} from "./delivery-ledger";

// P4-S2 (Round 3) addition -- see the bottom of this file for the
// `readExclusions` describe blocks (kept separate from the P4-S1 contract
// tests above, which are untouched). A minimal thenable double for
// SupabaseLedgerClient's `.select(...).eq(...)[.eq(...)]` chains, since
// DeliveryRow/DashboardBatchRow aren't exported (this module intentionally
// keeps its Supabase row shapes private).
function chainableResult(result: { data: unknown; error: unknown }) {
  const node = {
    eq: () => node,
    then: (
      onFulfilled: (value: typeof result) => unknown,
      onRejected?: (reason: unknown) => unknown,
    ) => Promise.resolve(result).then(onFulfilled, onRejected),
  };
  return node;
}

function fakeReadClient(
  deliveries: { data: unknown; error: unknown },
  servedBatches: { data: unknown; error: unknown },
) {
  return {
    from: (table: string) => {
      if (table === "dashboard_deliveries") {
        return { select: () => chainableResult(deliveries) };
      }
      if (table === "dashboard_batches") {
        return { select: () => chainableResult(servedBatches) };
      }
      throw new Error(`fakeReadClient: unexpected table ${table}`);
    },
  } as unknown as ConstructorParameters<typeof SupabaseDashboardDeliveryLedger>[0];
}

/**
 * P4-S1 (acceptance 16 foundation) -- ABC-JEV-INTEGRATION.md §1p.C.5-6.
 *
 * FOUNDATION ONLY: nothing here touches pipeline.ts, a route, or the store.
 * These tests are the contract itself -- P4-S2 onward builds against
 * MemoryDashboardDeliveryLedger the same way paper-daily-cache.test.ts
 * builds against MemoryPoolCache.
 */

function paper(key: string, aliases: readonly string[] = []): PaperIdentity {
  return { key, aliases };
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("MemoryDashboardDeliveryLedger", () => {
  describe("prepareBatch", () => {
    it("is idempotent per owner+local date: a second call returns the existing batch, discarding the new papers/intentVersion", async () => {
      const ledger = new MemoryDashboardDeliveryLedger();

      const first = await ledger.prepareBatch("owner-1", "2026-09-24", [paper("doi:a")], "intent-v1");
      const second = await ledger.prepareBatch("owner-1", "2026-09-24", [paper("doi:b")], "intent-v2");

      expect(second.id).toBe(first.id);
      expect(second.papers.map((p) => p.key)).toEqual(["doi:a"]);
      expect(second.intentVersion).toBe("intent-v1");
      expect(second.status).toBe("prepared");
    });

    it("keeps batches for different owners, or different dates for the same owner, independent", async () => {
      const ledger = new MemoryDashboardDeliveryLedger();

      const a = await ledger.prepareBatch("owner-1", "2026-09-24", [paper("doi:a")]);
      const b = await ledger.prepareBatch("owner-2", "2026-09-24", [paper("doi:b")]);
      const c = await ledger.prepareBatch("owner-1", "2026-09-25", [paper("doi:c")]);

      expect(new Set([a.id, b.id, c.id]).size).toBe(3);
    });

    it("freezes the papers in the order given, defensively copied", async () => {
      const ledger = new MemoryDashboardDeliveryLedger();
      const sourcePapers = [paper("doi:a"), paper("doi:b"), paper("doi:c")];

      const batch = await ledger.prepareBatch("owner-1", "2026-09-24", sourcePapers);
      sourcePapers.push(paper("doi:d")); // mutate the caller's array after the call

      expect(batch.papers.map((p) => p.key)).toEqual(["doi:a", "doi:b", "doi:c"]);
    });
  });

  describe("getBatch", () => {
    it("returns null before any batch has been prepared for that owner+date", async () => {
      const ledger = new MemoryDashboardDeliveryLedger();
      expect(await ledger.getBatch("owner-1", "2026-09-24")).toBeNull();
    });
  });

  describe("served/acknowledged transitions", () => {
    it("markServed transitions prepared -> served, recorded via getBatch", async () => {
      const ledger = new MemoryDashboardDeliveryLedger();
      const batch = await ledger.prepareBatch("owner-1", "2026-09-24", [paper("doi:a")]);
      expect(batch.status).toBe("prepared");

      await ledger.markServed("owner-1", batch.id);

      const served = await ledger.getBatch("owner-1", "2026-09-24");
      expect(served?.status).toBe("served");
      expect(served?.servedAt).toBeTruthy();
    });

    it("markServed is a silent no-op for an unknown batch id, the wrong owner, or an already-served/acknowledged batch", async () => {
      const ledger = new MemoryDashboardDeliveryLedger();
      const batch = await ledger.prepareBatch("owner-1", "2026-09-24", [paper("doi:a")]);

      await expect(ledger.markServed("owner-1", "no-such-batch")).resolves.toBeUndefined();
      await ledger.markServed("owner-intruder", batch.id);
      expect((await ledger.getBatch("owner-1", "2026-09-24"))?.status).toBe("prepared");

      await ledger.markServed("owner-1", batch.id);
      const servedAt = (await ledger.getBatch("owner-1", "2026-09-24"))?.servedAt;
      await ledger.markServed("owner-1", batch.id); // already served: no-op, not a second timestamp bump
      expect((await ledger.getBatch("owner-1", "2026-09-24"))?.servedAt).toBe(servedAt);
    });

    it("acknowledgeBatch transitions a 'prepared' batch straight to 'acknowledged' -- serving first is not required", async () => {
      const ledger = new MemoryDashboardDeliveryLedger();
      const batch = await ledger.prepareBatch("owner-1", "2026-09-24", [paper("doi:a")]);

      const result = await ledger.acknowledgeBatch("owner-1", batch.id);

      expect(result).toBe("acknowledged");
      const after = await ledger.getBatch("owner-1", "2026-09-24");
      expect(after?.status).toBe("acknowledged");
      expect(after?.acknowledgedAt).toBeTruthy();
    });

    it("acknowledgeBatch transitions a 'served' batch to 'acknowledged'", async () => {
      const ledger = new MemoryDashboardDeliveryLedger();
      const batch = await ledger.prepareBatch("owner-1", "2026-09-24", [paper("doi:a")]);
      await ledger.markServed("owner-1", batch.id);

      expect(await ledger.acknowledgeBatch("owner-1", batch.id)).toBe("acknowledged");
    });
  });

  describe("duplicate acknowledgment", () => {
    it("a second acknowledgeBatch call on the same batch is idempotent: already_acknowledged, and the ledger is not double-written", async () => {
      const ledger = new MemoryDashboardDeliveryLedger();
      const batch = await ledger.prepareBatch("owner-1", "2026-09-24", [paper("doi:a", ["title:a"])]);

      const first = await ledger.acknowledgeBatch("owner-1", batch.id);
      const second = await ledger.acknowledgeBatch("owner-1", batch.id);

      expect(first).toBe("acknowledged");
      expect(second).toBe("already_acknowledged");
      const delivered = await ledger.listDelivered("owner-1");
      expect(delivered).toEqual(new Set(["doi:a", "title:a"])); // not duplicated
    });
  });

  describe("owner mismatch", () => {
    it("acknowledgeBatch returns owner_mismatch for the wrong owner and never mutates the batch or leaks to that owner's ledger", async () => {
      const ledger = new MemoryDashboardDeliveryLedger();
      const batch = await ledger.prepareBatch("owner-1", "2026-09-24", [paper("doi:a")]);

      const result = await ledger.acknowledgeBatch("owner-intruder", batch.id);

      expect(result).toBe("owner_mismatch");
      expect((await ledger.getBatch("owner-1", "2026-09-24"))?.status).toBe("prepared");
      expect(await ledger.listDelivered("owner-intruder")).toEqual(new Set());
      expect(await ledger.listDelivered("owner-1")).toEqual(new Set());
    });
  });

  describe("not found", () => {
    it("acknowledgeBatch returns not_found for an unknown batch id", async () => {
      const ledger = new MemoryDashboardDeliveryLedger();
      expect(await ledger.acknowledgeBatch("owner-1", "no-such-batch")).toBe("not_found");
    });
  });

  describe("cross-day late acknowledgment", () => {
    it("still succeeds and still records that day's papers, even after a later day's batch already exists", async () => {
      const ledger = new MemoryDashboardDeliveryLedger();
      const yesterday = await ledger.prepareBatch("owner-1", "2026-09-23", [paper("doi:yesterday")]);
      await ledger.markServed("owner-1", yesterday.id);
      // "Today" a new, independent batch already exists -- late-acking
      // yesterday's must not be blocked by it, and must not affect it.
      const today = await ledger.prepareBatch("owner-1", "2026-09-24", [paper("doi:today")]);

      const result = await ledger.acknowledgeBatch("owner-1", yesterday.id);

      expect(result).toBe("acknowledged");
      const delivered = await ledger.listDelivered("owner-1");
      expect(delivered.has("doi:yesterday")).toBe(true);
      expect(delivered.has("doi:today")).toBe(false); // today's batch is untouched, still unacknowledged
      expect((await ledger.getBatch("owner-1", "2026-09-24"))?.id).toBe(today.id);
      expect((await ledger.getBatch("owner-1", "2026-09-24"))?.status).toBe("prepared");
    });
  });

  describe("aliases copied to the delivered set", () => {
    it("listDelivered includes both the canonical key and every alias of each acknowledged paper", async () => {
      const ledger = new MemoryDashboardDeliveryLedger();
      const batch = await ledger.prepareBatch("owner-1", "2026-09-24", [
        paper("doi:a", ["title:paper-a", "s2:123"]),
        paper("doi:b"),
      ]);

      await ledger.acknowledgeBatch("owner-1", batch.id);

      expect(await ledger.listDelivered("owner-1")).toEqual(
        new Set(["doi:a", "title:paper-a", "s2:123", "doi:b"]),
      );
    });

    it("does NOT add anything to listDelivered for a batch that is only prepared or only served", async () => {
      const ledger = new MemoryDashboardDeliveryLedger();
      const prepared = await ledger.prepareBatch("owner-1", "2026-09-24", [paper("doi:prepared")]);
      const served = await ledger.prepareBatch("owner-1", "2026-09-25", [paper("doi:served")]);
      await ledger.markServed("owner-1", served.id);
      void prepared;

      expect(await ledger.listDelivered("owner-1")).toEqual(new Set());
    });
  });

  describe("served-unacknowledged set", () => {
    it("includes keys+aliases of 'served' batches but excludes 'prepared' and 'acknowledged' ones", async () => {
      const ledger = new MemoryDashboardDeliveryLedger();
      await ledger.prepareBatch("owner-1", "2026-09-20", [paper("doi:prepared-only")]);
      const servedBatch = await ledger.prepareBatch("owner-1", "2026-09-21", [
        paper("doi:served", ["title:served"]),
      ]);
      await ledger.markServed("owner-1", servedBatch.id);
      const ackedBatch = await ledger.prepareBatch("owner-1", "2026-09-22", [paper("doi:acked")]);
      await ledger.acknowledgeBatch("owner-1", ackedBatch.id);

      expect(await ledger.listServedUnacknowledged("owner-1")).toEqual(
        new Set(["doi:served", "title:served"]),
      );
    });

    it("excludes a batch once it moves from served to acknowledged (the delivered set takes over, not both)", async () => {
      const ledger = new MemoryDashboardDeliveryLedger();
      const batch = await ledger.prepareBatch("owner-1", "2026-09-24", [paper("doi:a")]);
      await ledger.markServed("owner-1", batch.id);
      expect(await ledger.listServedUnacknowledged("owner-1")).toEqual(new Set(["doi:a"]));

      await ledger.acknowledgeBatch("owner-1", batch.id);

      expect(await ledger.listServedUnacknowledged("owner-1")).toEqual(new Set());
      expect(await ledger.listDelivered("owner-1")).toEqual(new Set(["doi:a"]));
    });
  });

  describe("no expiry logic", () => {
    it("a paper delivered long ago still counts as delivered no matter how many later local dates are prepared", async () => {
      const ledger = new MemoryDashboardDeliveryLedger();
      const oldBatch = await ledger.prepareBatch("owner-1", "2020-01-01", [paper("doi:very-old")]);
      await ledger.acknowledgeBatch("owner-1", oldBatch.id);

      for (const localDate of ["2026-01-01", "2026-06-01", "2026-09-24"]) {
        await ledger.prepareBatch("owner-1", localDate, [paper(`doi:${localDate}`)]);
      }

      expect((await ledger.listDelivered("owner-1")).has("doi:very-old")).toBe(true);
    });
  });

  describe("owner isolation", () => {
    it("never mixes one owner's delivered/served-unacknowledged state into another's", async () => {
      const ledger = new MemoryDashboardDeliveryLedger();
      const ownerOneBatch = await ledger.prepareBatch("owner-1", "2026-09-24", [paper("doi:owner-one")]);
      await ledger.acknowledgeBatch("owner-1", ownerOneBatch.id);
      const ownerTwoBatch = await ledger.prepareBatch("owner-2", "2026-09-24", [paper("doi:owner-two")]);
      await ledger.markServed("owner-2", ownerTwoBatch.id);

      expect(await ledger.listDelivered("owner-2")).toEqual(new Set());
      expect(await ledger.listServedUnacknowledged("owner-1")).toEqual(new Set());
    });
  });
});

describe("SupabaseDashboardDeliveryLedger, unconfigured", () => {
  it("degrades honestly with an explicit null client: empty reads, a well-formed but non-durable write, never throws", async () => {
    const ledger = new SupabaseDashboardDeliveryLedger(null);

    expect(await ledger.listDelivered("owner-1")).toEqual(new Set());
    expect(await ledger.listServedUnacknowledged("owner-1")).toEqual(new Set());
    expect(await ledger.getBatch("owner-1", "2026-09-24")).toBeNull();

    const batch = await ledger.prepareBatch("owner-1", "2026-09-24", [paper("doi:a")]);
    expect(batch.status).toBe("prepared");
    expect(batch.papers.map((p) => p.key)).toEqual(["doi:a"]);

    await expect(ledger.markServed("owner-1", batch.id)).resolves.toBeUndefined();
    expect(await ledger.acknowledgeBatch("owner-1", batch.id)).toBe("acknowledged");
    // The write above is real WITHIN this instance (so a same-process
    // caller sees consistent behavior)...
    expect((await ledger.listDelivered("owner-1")).has("doi:a")).toBe(true);
  });

  it("is not durable across instances: a fresh instance (standing in for a cold start) has no memory of another instance's writes", async () => {
    const first = new SupabaseDashboardDeliveryLedger(null);
    const batch = await first.prepareBatch("owner-1", "2026-09-24", [paper("doi:a")]);
    await first.acknowledgeBatch("owner-1", batch.id);

    const second = new SupabaseDashboardDeliveryLedger(null);

    expect(await second.getBatch("owner-1", "2026-09-24")).toBeNull();
    expect(await second.listDelivered("owner-1")).toEqual(new Set());
  });

  it("also degrades via the real factory (no client argument) when the Supabase env pair is absent -- no network attempted", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "");

    const ledger = new SupabaseDashboardDeliveryLedger();

    expect(await ledger.listDelivered("owner-1")).toEqual(new Set());
    expect(await ledger.getBatch("owner-1", "2026-09-24")).toBeNull();
    const batch = await ledger.prepareBatch("owner-1", "2026-09-24", [paper("doi:a")]);
    expect(batch.status).toBe("prepared");
  });
});

describe("SupabaseDashboardDeliveryLedger, configured (injected fake client, no network)", () => {
  it("maps every acknowledge_dashboard_batch RPC result through unchanged", async () => {
    for (const status of ["acknowledged", "already_acknowledged", "not_found", "owner_mismatch"] as const) {
      const rpc = vi.fn().mockResolvedValue({ data: status, error: null });
      const ledger = new SupabaseDashboardDeliveryLedger({ rpc } as unknown as ConstructorParameters<
        typeof SupabaseDashboardDeliveryLedger
      >[0]);

      await expect(ledger.acknowledgeBatch("owner-1", "batch-1")).resolves.toBe(status);
      expect(rpc).toHaveBeenCalledWith("acknowledge_dashboard_batch", {
        p_owner_id: "owner-1",
        p_batch_id: "batch-1",
      });
    }
  });

  it("throws rather than returning a fake success when the RPC itself errors (so a future route can map it to 503, not 200)", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: { message: "connection reset" } });
    const ledger = new SupabaseDashboardDeliveryLedger({ rpc } as unknown as ConstructorParameters<
      typeof SupabaseDashboardDeliveryLedger
    >[0]);

    await expect(ledger.acknowledgeBatch("owner-1", "batch-1")).rejects.toThrow();
  });

  it("throws on an unrecognized RPC result rather than silently passing it through as if it were a valid AckResult", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: "something-new", error: null });
    const ledger = new SupabaseDashboardDeliveryLedger({ rpc } as unknown as ConstructorParameters<
      typeof SupabaseDashboardDeliveryLedger
    >[0]);

    await expect(ledger.acknowledgeBatch("owner-1", "batch-1")).rejects.toThrow();
  });
});

// P4-S2 (Round 3) -- ABC-JEV-INTEGRATION.md §1p.F. `listDelivered` and
// `listServedUnacknowledged` (above) are UNCHANGED: both still fail-open to
// an empty Set on a configured-client error, exactly as the P4-S1 contract
// tests already pin. `readExclusions` is a NEW, additional method with the
// opposite, deliberately strict contract: once a caller turns the
// PEER_DASHBOARD_LEDGER flag on, it must be able to tell "this owner truly
// has nothing excluded" apart from "the read failed" so it can refuse to
// serve a fresh selection rather than silently serving one with zero
// exclusions.
describe("readExclusions", () => {
  it("MemoryDashboardDeliveryLedger always reports ok, with the union of delivered and served-unacknowledged keys/aliases", async () => {
    const ledger = new MemoryDashboardDeliveryLedger();
    const acked = await ledger.prepareBatch("owner-1", "2026-09-20", [
      paper("doi:acked", ["title:acked"]),
    ]);
    await ledger.acknowledgeBatch("owner-1", acked.id);
    const served = await ledger.prepareBatch("owner-1", "2026-09-24", [paper("doi:served")]);
    await ledger.markServed("owner-1", served.id);

    const result = await ledger.readExclusions("owner-1");

    expect(result).toEqual({
      status: "ok",
      keys: new Set(["doi:acked", "title:acked", "doi:served"]),
    });
  });

  it("MemoryDashboardDeliveryLedger reports ok with an empty set for an owner with nothing recorded", async () => {
    const ledger = new MemoryDashboardDeliveryLedger();
    expect(await ledger.readExclusions("owner-nothing-yet")).toEqual({
      status: "ok",
      keys: new Set(),
    });
  });

  it("SupabaseDashboardDeliveryLedger, unconfigured (null client): unavailable, not a silently-empty ok", async () => {
    const ledger = new SupabaseDashboardDeliveryLedger(null);
    expect(await ledger.readExclusions("owner-1")).toEqual({ status: "unavailable" });
  });

  it("SupabaseDashboardDeliveryLedger, configured, both queries succeed: ok with the flattened union", async () => {
    const client = fakeReadClient(
      { data: [{ canonical_key: "doi:a", aliases: ["title:a"] }], error: null },
      { data: [{ papers: [{ key: "doi:b", aliases: [] }], status: "served" }], error: null },
    );
    const ledger = new SupabaseDashboardDeliveryLedger(client);

    expect(await ledger.readExclusions("owner-1")).toEqual({
      status: "ok",
      keys: new Set(["doi:a", "title:a", "doi:b"]),
    });
  });

  it("SupabaseDashboardDeliveryLedger, configured: unavailable when the deliveries query errors", async () => {
    const client = fakeReadClient(
      { data: null, error: { message: "connection reset" } },
      { data: [], error: null },
    );
    const ledger = new SupabaseDashboardDeliveryLedger(client);

    expect(await ledger.readExclusions("owner-1")).toEqual({ status: "unavailable" });
  });

  it("SupabaseDashboardDeliveryLedger, configured: unavailable when the served-batches query errors (e.g. table missing)", async () => {
    const client = fakeReadClient(
      { data: [], error: null },
      { data: null, error: { message: "relation \"dashboard_batches\" does not exist" } },
    );
    const ledger = new SupabaseDashboardDeliveryLedger(client);

    expect(await ledger.readExclusions("owner-1")).toEqual({ status: "unavailable" });
  });

  it("SupabaseDashboardDeliveryLedger, configured: unavailable rather than throwing when the client itself throws", async () => {
    const client = {
      from: () => {
        throw new Error("network down");
      },
    } as unknown as ConstructorParameters<typeof SupabaseDashboardDeliveryLedger>[0];
    const ledger = new SupabaseDashboardDeliveryLedger(client);

    await expect(ledger.readExclusions("owner-1")).resolves.toEqual({ status: "unavailable" });
  });
});

// P4-S3 (Round 3) -- ABC-JEV-INTEGRATION.md §1p.C.5/C.8, docs/jev-abc/P4-B-...
// DESIGN §5's "store the served item payloads in the batch so the frozen
// batch never depends on the day's pool cache." ADDITIVE ONLY: prepareBatch
// gains a 5th, OPTIONAL, trailing parameter -- every existing 3-arg/4-arg
// call site above (and in delivery-ledger.supabase.test.ts, not edited by
// this slice) keeps compiling and behaving exactly as before, confirmed by
// that whole file staying green unmodified alongside these new tests.
describe("servedItems (P4-S3)", () => {
  it("MemoryDashboardDeliveryLedger: prepareBatch stores servedItems, retrievable via getBatch, defensively copied", async () => {
    const ledger = new MemoryDashboardDeliveryLedger();
    const items = [{ id: "paper-a" }, { id: "paper-b" }];

    const batch = await ledger.prepareBatch("owner-1", "2026-09-24", [paper("doi:a")], undefined, items);
    items.push({ id: "paper-c" }); // mutate the caller's array after the call

    expect(batch.servedItems).toEqual([{ id: "paper-a" }, { id: "paper-b" }]);
    const reread = await ledger.getBatch("owner-1", "2026-09-24");
    expect(reread?.servedItems).toEqual([{ id: "paper-a" }, { id: "paper-b" }]);
  });

  it("MemoryDashboardDeliveryLedger: prepareBatch without a 5th argument leaves servedItems undefined (every existing call site keeps working)", async () => {
    const ledger = new MemoryDashboardDeliveryLedger();
    const batch = await ledger.prepareBatch("owner-1", "2026-09-24", [paper("doi:a")]);
    expect(batch.servedItems).toBeUndefined();
  });

  it("MemoryDashboardDeliveryLedger: idempotent prepare discards a losing call's servedItems too, same as papers/intentVersion", async () => {
    const ledger = new MemoryDashboardDeliveryLedger();
    const first = await ledger.prepareBatch("owner-1", "2026-09-24", [paper("doi:a")], "v1", [{ id: "winner" }]);
    const second = await ledger.prepareBatch("owner-1", "2026-09-24", [paper("doi:b")], "v2", [{ id: "loser" }]);

    expect(second.id).toBe(first.id);
    expect(second.servedItems).toEqual([{ id: "winner" }]);
  });

  it("SupabaseDashboardDeliveryLedger, unconfigured (null client): prepareBatch with servedItems round-trips through the fallback", async () => {
    const ledger = new SupabaseDashboardDeliveryLedger(null);
    const batch = await ledger.prepareBatch("owner-1", "2026-09-24", [paper("doi:a")], undefined, [{ id: "x" }]);
    expect(batch.servedItems).toEqual([{ id: "x" }]);
  });

  it("SupabaseDashboardDeliveryLedger, configured: prepareBatch includes served_items in the insert row only when provided, and maps it back on read", async () => {
    const insertedRow = {
      id: "batch-with-items",
      owner_id: "owner-1",
      local_date: "2026-09-24",
      papers: [{ key: "doi:a", aliases: [] }],
      status: "prepared" as const,
      intent_version: null,
      created_at: "2026-09-24T00:00:00.000Z",
      served_at: null,
      acknowledged_at: null,
      served_items: [{ id: "x" }],
    };
    const insertCalls: unknown[] = [];
    const client = {
      from: (table: string) => {
        if (table !== "dashboard_batches") throw new Error(`unexpected table ${table}`);
        return {
          insert: (row: unknown) => {
            insertCalls.push(row);
            return { select: () => ({ maybeSingle: () => Promise.resolve({ data: insertedRow, error: null }) }) };
          },
        };
      },
    } as unknown as ConstructorParameters<typeof SupabaseDashboardDeliveryLedger>[0];
    const ledger = new SupabaseDashboardDeliveryLedger(client);

    const result = await ledger.prepareBatch("owner-1", "2026-09-24", [paper("doi:a")], undefined, [{ id: "x" }]);

    expect(insertCalls).toEqual([
      {
        owner_id: "owner-1",
        local_date: "2026-09-24",
        papers: [{ key: "doi:a", aliases: [] }],
        status: "prepared",
        intent_version: null,
        served_items: [{ id: "x" }],
      },
    ]);
    expect(result.servedItems).toEqual([{ id: "x" }]);
  });

  it("SupabaseDashboardDeliveryLedger, configured: prepareBatch WITHOUT servedItems omits served_items from the insert row entirely (byte-identical to the pre-P4-S3 row shape)", async () => {
    const insertedRow = {
      id: "batch-no-items",
      owner_id: "owner-1",
      local_date: "2026-09-24",
      papers: [{ key: "doi:a", aliases: [] }],
      status: "prepared" as const,
      intent_version: null,
      created_at: "2026-09-24T00:00:00.000Z",
      served_at: null,
      acknowledged_at: null,
    };
    const insertCalls: unknown[] = [];
    const client = {
      from: (table: string) => {
        if (table !== "dashboard_batches") throw new Error(`unexpected table ${table}`);
        return {
          insert: (row: unknown) => {
            insertCalls.push(row);
            return { select: () => ({ maybeSingle: () => Promise.resolve({ data: insertedRow, error: null }) }) };
          },
        };
      },
    } as unknown as ConstructorParameters<typeof SupabaseDashboardDeliveryLedger>[0];
    const ledger = new SupabaseDashboardDeliveryLedger(client);

    await ledger.prepareBatch("owner-1", "2026-09-24", [paper("doi:a")]);

    expect(insertCalls).toEqual([
      {
        owner_id: "owner-1",
        local_date: "2026-09-24",
        papers: [{ key: "doi:a", aliases: [] }],
        status: "prepared",
        intent_version: null,
      },
    ]);
    expect(Object.prototype.hasOwnProperty.call(insertCalls[0] as object, "served_items")).toBe(false);
  });
});

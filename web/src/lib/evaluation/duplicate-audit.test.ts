import { describe, expect, it } from "vitest";
import { lifetimeDuplicateCount, type ServedBatchRecord } from "./duplicate-audit";

// P5-S2 (Round 3) — "lifetime dashboard duplicate count", per
// ABC-JEV-INTEGRATION.md §4's pinned metric definitions (Round 3, "P5 B
// guide COMPLETE", ruling 5, 2026-09-24T11:57:44Z), verbatim:
//
//   "per owner, the number of papers in a served dashboard batch whose
//   identity (canonical key OR any alias — the §1p.A exclusion rule)
//   matches a paper in an EARLIER served batch of the same owner; target 0;
//   measurable only in ledger mode."
//
// This module reuses `isDeliveredIdentity` from
// web/src/lib/utils/canonical-identity.ts (the same key-OR-any-alias rule
// the real delivery ledger's exclusion check uses) rather than
// re-implementing identity matching. Its own record shape is modeled on
// (not imported from) web/src/lib/dashboard/delivery-ledger.ts's
// `DashboardBatch`/`PaperIdentity` — this module stays decoupled and pure,
// the same way delivery-ledger.ts itself never imports canonical-identity.ts.
//
// Two rules this module defines itself (the assignment explicitly leaves
// these to the implementer, "state the rule"):
//   1. "Ignores prepared-only batches": a batch whose status is exactly
//      "prepared" (never served/acknowledged) is excluded entirely — it
//      contributes no history and can never itself be flagged.
//   2. Same-batch repeats/collisions: the pinned definition requires a
//      match against an EARLIER served batch. Two items inside the SAME
//      batch are never compared against each other, only against batches
//      that precede it — see the "same-batch repeat" test below.
//   3. Ordering ties (identical servedAt): broken deterministically by
//      ascending `batchId` string comparison — see the "tie-break" test.

function batch(overrides: Partial<ServedBatchRecord> & Pick<ServedBatchRecord, "ownerId" | "batchId" | "status" | "localDate" | "items">): ServedBatchRecord {
  return { ...overrides };
}

describe("lifetimeDuplicateCount", () => {
  it("flags a later served batch's exact-key match against an earlier served batch", () => {
    const batches: ServedBatchRecord[] = [
      batch({
        ownerId: "u1",
        batchId: "batchA",
        status: "served",
        localDate: "2026-01-01",
        servedAt: "2026-01-01T08:00:00.000Z",
        items: [{ key: "doi:10.5/x1", aliases: [] }],
      }),
      batch({
        ownerId: "u1",
        batchId: "batchB",
        status: "served",
        localDate: "2026-01-02",
        servedAt: "2026-01-02T08:00:00.000Z",
        items: [{ key: "doi:10.5/x1", aliases: [] }],
      }),
    ];
    const result = lifetimeDuplicateCount(batches);
    expect(result).toEqual([
      {
        ownerId: "u1",
        duplicates: [
          {
            ownerId: "u1",
            duplicateBatchId: "batchB",
            duplicatePaperKey: "doi:10.5/x1",
            firstDeliveredBatchId: "batchA",
            firstDeliveredPaperKey: "doi:10.5/x1",
            matchedOn: "doi:10.5/x1",
          },
        ],
        total: 1,
      },
    ]);
  });

  it("counts an alias-only duplicate: different DOI, same qualifying title alias", () => {
    // P1 (batch a1): doi:10.1/aaa, alias title:deep learning for materials discovery methods
    // P2 (batch a2, later): doi:10.2/bbb (DIFFERENT doi), SAME title alias.
    // isDeliveredIdentity matches on the shared alias even though the keys differ.
    const batches: ServedBatchRecord[] = [
      batch({
        ownerId: "u2",
        batchId: "a1",
        status: "served",
        localDate: "2026-02-01",
        servedAt: "2026-02-01T08:00:00.000Z",
        items: [
          {
            key: "doi:10.1/aaa",
            aliases: ["title:deep learning for materials discovery methods"],
          },
        ],
      }),
      batch({
        ownerId: "u2",
        batchId: "a2",
        status: "served",
        localDate: "2026-02-02",
        servedAt: "2026-02-02T08:00:00.000Z",
        items: [
          {
            key: "doi:10.2/bbb",
            aliases: ["title:deep learning for materials discovery methods"],
          },
        ],
      }),
    ];
    const result = lifetimeDuplicateCount(batches);
    expect(result).toEqual([
      {
        ownerId: "u2",
        duplicates: [
          {
            ownerId: "u2",
            duplicateBatchId: "a2",
            duplicatePaperKey: "doi:10.2/bbb",
            firstDeliveredBatchId: "a1",
            firstDeliveredPaperKey: "doi:10.1/aaa",
            matchedOn: "title:deep learning for materials discovery methods",
          },
        ],
        total: 1,
      },
    ]);
  });

  it("ignores a prepared-only batch: its papers never count as an earlier delivery", () => {
    const batches: ServedBatchRecord[] = [
      batch({
        ownerId: "u3",
        batchId: "p1",
        status: "prepared",
        localDate: "2026-03-01",
        items: [{ key: "doi:10.9/p1", aliases: [] }],
      }),
      batch({
        ownerId: "u3",
        batchId: "s1",
        status: "served",
        localDate: "2026-03-02",
        servedAt: "2026-03-02T08:00:00.000Z",
        items: [{ key: "doi:10.9/p1", aliases: [] }],
      }),
    ];
    const result = lifetimeDuplicateCount(batches);
    expect(result).toEqual([{ ownerId: "u3", duplicates: [], total: 0 }]);
  });

  it("does not flag a same-batch repeat, but does count it as history for a later batch", () => {
    // Rule (stated above): items within the SAME batch are checked only
    // against strictly earlier batches, never against each other. So r1's
    // internal repeat of the same key is not itself a duplicate. But r1's
    // papers (including the repeated key) DO become history once r1 is
    // fully processed, so r2's later occurrence of the same key IS flagged.
    const batches: ServedBatchRecord[] = [
      batch({
        ownerId: "u4",
        batchId: "r1",
        status: "served",
        localDate: "2026-04-01",
        servedAt: "2026-04-01T08:00:00.000Z",
        items: [
          { key: "doi:10.7/r1", aliases: [] },
          { key: "doi:10.7/r1", aliases: [] },
        ],
      }),
      batch({
        ownerId: "u4",
        batchId: "r2",
        status: "served",
        localDate: "2026-04-02",
        servedAt: "2026-04-02T08:00:00.000Z",
        items: [{ key: "doi:10.7/r1", aliases: [] }],
      }),
    ];
    const result = lifetimeDuplicateCount(batches);
    expect(result).toEqual([
      {
        ownerId: "u4",
        duplicates: [
          {
            ownerId: "u4",
            duplicateBatchId: "r2",
            duplicatePaperKey: "doi:10.7/r1",
            firstDeliveredBatchId: "r1",
            firstDeliveredPaperKey: "doi:10.7/r1",
            matchedOn: "doi:10.7/r1",
          },
        ],
        total: 1,
      },
    ]);
  });

  it("breaks an identical-servedAt tie deterministically by ascending batchId, independent of input array order", () => {
    // Both batches share the EXACT same servedAt. "batch-a" < "batch-b"
    // lexically, so batch-a is treated as earlier regardless of servedAt
    // being tied and regardless of which one appears first in the input
    // array (batch-b is listed FIRST here, on purpose, to prove the
    // function sorts rather than trusting array order).
    const batches: ServedBatchRecord[] = [
      batch({
        ownerId: "u6",
        batchId: "batch-b",
        status: "served",
        localDate: "2026-06-02",
        servedAt: "2026-06-01T12:00:00.000Z",
        items: [{ key: "k1", aliases: [] }],
      }),
      batch({
        ownerId: "u6",
        batchId: "batch-a",
        status: "served",
        localDate: "2026-06-01",
        servedAt: "2026-06-01T12:00:00.000Z",
        items: [{ key: "k1", aliases: [] }],
      }),
    ];
    const result = lifetimeDuplicateCount(batches);
    expect(result).toEqual([
      {
        ownerId: "u6",
        duplicates: [
          {
            ownerId: "u6",
            duplicateBatchId: "batch-b",
            duplicatePaperKey: "k1",
            firstDeliveredBatchId: "batch-a",
            firstDeliveredPaperKey: "k1",
            matchedOn: "k1",
          },
        ],
        total: 1,
      },
    ]);
  });

  it("falls back to localDate ordering when servedAt is absent", () => {
    // Neither batch has servedAt (e.g. status became "served" without the
    // field being populated in this record's own source) -- ordering falls
    // back to localDate. "2026-07-01" sorts before "2026-07-02" regardless
    // of array order.
    const batches: ServedBatchRecord[] = [
      batch({
        ownerId: "u8",
        batchId: "later",
        status: "served",
        localDate: "2026-07-02",
        items: [{ key: "k2", aliases: [] }],
      }),
      batch({
        ownerId: "u8",
        batchId: "earlier",
        status: "served",
        localDate: "2026-07-01",
        items: [{ key: "k2", aliases: [] }],
      }),
    ];
    const result = lifetimeDuplicateCount(batches);
    expect(result).toEqual([
      {
        ownerId: "u8",
        duplicates: [
          {
            ownerId: "u8",
            duplicateBatchId: "later",
            duplicatePaperKey: "k2",
            firstDeliveredBatchId: "earlier",
            firstDeliveredPaperKey: "k2",
            matchedOn: "k2",
          },
        ],
        total: 1,
      },
    ]);
  });

  it("keeps owners fully isolated (a shared key across owners is not a duplicate) and sorts results by ownerId", () => {
    // u9 and u2 (scrambled input/lexical order on purpose) each independently
    // receive the SAME key "doi:10.5/x1" in their own first-ever batch --
    // neither is a duplicate of the other. Output is sorted by ownerId ("u2"
    // before "u9"), independent of input array order.
    const batches: ServedBatchRecord[] = [
      batch({
        ownerId: "u9",
        batchId: "n1",
        status: "served",
        localDate: "2026-09-01",
        servedAt: "2026-09-01T08:00:00.000Z",
        items: [{ key: "doi:10.5/x1", aliases: [] }],
      }),
      batch({
        ownerId: "u2",
        batchId: "m1",
        status: "served",
        localDate: "2026-09-01",
        servedAt: "2026-09-01T08:00:00.000Z",
        items: [{ key: "doi:10.5/x1", aliases: [] }],
      }),
    ];
    const result = lifetimeDuplicateCount(batches);
    expect(result.map((r) => r.ownerId)).toEqual(["u2", "u9"]);
    expect(result).toEqual([
      { ownerId: "u2", duplicates: [], total: 0 },
      { ownerId: "u9", duplicates: [], total: 0 },
    ]);
  });

  it("reports a clean owner (no overlaps across several served batches) as total 0, not an omitted row", () => {
    const batches: ServedBatchRecord[] = [
      batch({
        ownerId: "u10",
        batchId: "c1",
        status: "served",
        localDate: "2026-10-01",
        servedAt: "2026-10-01T08:00:00.000Z",
        items: [{ key: "doi:10.1/c1", aliases: [] }],
      }),
      batch({
        ownerId: "u10",
        batchId: "c2",
        status: "served",
        localDate: "2026-10-02",
        servedAt: "2026-10-02T08:00:00.000Z",
        items: [{ key: "doi:10.1/c2", aliases: [] }],
      }),
    ];
    const result = lifetimeDuplicateCount(batches);
    expect(result).toEqual([{ ownerId: "u10", duplicates: [], total: 0 }]);
  });

  it("treats an acknowledged batch the same as a served one (both are real deliveries)", () => {
    const batches: ServedBatchRecord[] = [
      batch({
        ownerId: "u11",
        batchId: "ack1",
        status: "acknowledged",
        localDate: "2026-11-01",
        servedAt: "2026-11-01T08:00:00.000Z",
        items: [{ key: "doi:10.1/ack", aliases: [] }],
      }),
      batch({
        ownerId: "u11",
        batchId: "s2",
        status: "served",
        localDate: "2026-11-02",
        servedAt: "2026-11-02T08:00:00.000Z",
        items: [{ key: "doi:10.1/ack", aliases: [] }],
      }),
    ];
    const result = lifetimeDuplicateCount(batches);
    expect(result[0].total).toBe(1);
    expect(result[0].duplicates[0].firstDeliveredBatchId).toBe("ack1");
  });
});

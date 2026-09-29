// P5-S2 (Round 3) — "lifetime dashboard duplicate count", per
// ABC-JEV-INTEGRATION.md §4's pinned metric definitions (Round 3, "P5 B
// guide COMPLETE", ruling 5, 2026-09-24T11:57:44Z), verbatim:
//
//   "per owner, the number of papers in a served dashboard batch whose
//   identity (canonical key OR any alias — the §1p.A exclusion rule)
//   matches a paper in an EARLIER served batch of the same owner; target 0;
//   measurable only in ledger mode."
//
// This module reuses `isDeliveredIdentity` from canonical-identity.ts (the
// same key-OR-any-alias rule the real delivery ledger's exclusion check
// uses) rather than re-implementing identity matching. Its own record shape
// (`ServedBatchRecord`) is modeled on — not imported from —
// web/src/lib/dashboard/delivery-ledger.ts's `DashboardBatch`/`PaperIdentity`:
// this module stays pure and decoupled, the same way delivery-ledger.ts
// itself never imports canonical-identity.ts. It is evaluation tooling
// only; nothing in production code imports this module yet.
//
// Two rules this module defines itself, since the pinned definition and the
// assignment leave them to the implementer ("state the rule"):
//
//   1. IGNORES PREPARED-ONLY BATCHES. A batch whose `status` is exactly
//      "prepared" (never actually sent to a client) is excluded entirely —
//      it contributes nothing to history and can never itself be flagged.
//      "served" and "acknowledged" are both treated as real deliveries
//      (an acknowledged batch was, by construction, at least once served).
//
//   2. SAME-BATCH REPEATS/COLLISIONS ARE NEVER FLAGGED AGAINST EACH OTHER.
//      The pinned definition requires a match against an EARLIER served
//      batch — two items inside the SAME batch are not "earlier" relative
//      to one another. Concretely: every item in a batch is checked against
//      only the identities claimed by STRICTLY earlier batches; only after
//      the whole batch has been checked do its own items (including an
//      internal repeat) become part of history for batches that follow. A
//      literal same-key repeat within one batch, or two different papers in
//      one batch that happen to share an alias, are both therefore a
//      same-batch collision — a real data-quality question, but outside
//      this specific metric's definition, which is about repeats ACROSS
//      batches over an owner's lifetime.
//
// Ordering ("ordering by served time"): batches are sorted by `servedAt`
// when present, falling back to `localDate` (always present on a real
// ledger batch) — both parsed as UTC instants. Ties (including two batches
// with an identical `servedAt`) are broken deterministically by ascending
// `batchId` string comparison, so the result never depends on the order
// `servedBatches` happened to be passed in.

import { isDeliveredIdentity, type CanonicalIdentity } from "@/lib/utils/canonical-identity";

export type LedgerBatchStatus = "prepared" | "served" | "acknowledged";

export interface AuditPaperIdentity {
  readonly key: string;
  readonly aliases: readonly string[];
}

export interface ServedBatchRecord {
  readonly ownerId: string;
  /** Caller-supplied batch identifier; also this module's deterministic tie-break key (see file header). */
  readonly batchId: string;
  readonly status: LedgerBatchStatus;
  /** Always present on a real ledger batch; used for ordering only when `servedAt` is absent. */
  readonly localDate: string;
  /** ISO 8601 timestamp; preferred for ordering when present. */
  readonly servedAt?: string;
  readonly items: readonly AuditPaperIdentity[];
}

export interface DuplicateOccurrence {
  readonly ownerId: string;
  /** The later batch whose paper duplicates an earlier delivery. */
  readonly duplicateBatchId: string;
  /** This paper's own canonical key, as it appears in `duplicateBatchId`. */
  readonly duplicatePaperKey: string;
  /** The earliest batch that first delivered the matching identity string. */
  readonly firstDeliveredBatchId: string;
  /** That earlier paper's own canonical key (may differ from `duplicatePaperKey` when matched via an alias). */
  readonly firstDeliveredPaperKey: string;
  /** The exact key-or-alias string the two papers share. */
  readonly matchedOn: string;
}

export interface OwnerDuplicateAudit {
  readonly ownerId: string;
  readonly duplicates: readonly DuplicateOccurrence[];
  readonly total: number;
}

/** `undefined` -> epoch (0); malformed/unparseable timestamps also fall back to epoch — sorts first, deterministically, never throws. */
function effectiveTimeMs(record: ServedBatchRecord): number {
  const iso = record.servedAt ?? `${record.localDate}T00:00:00.000Z`;
  const t = Date.parse(iso);
  return Number.isNaN(t) ? 0 : t;
}

function compareBatches(a: ServedBatchRecord, b: ServedBatchRecord): number {
  const ta = effectiveTimeMs(a);
  const tb = effectiveTimeMs(b);
  if (ta !== tb) return ta - tb;
  // Deterministic tie-break (file header, rule 3): ascending batchId.
  if (a.batchId < b.batchId) return -1;
  if (a.batchId > b.batchId) return 1;
  return 0;
}

function toCanonicalIdentity(paper: AuditPaperIdentity): CanonicalIdentity {
  return { key: paper.key, keyVersion: 1, aliases: [...paper.aliases] };
}

/**
 * Computes the pinned "lifetime dashboard duplicate count" metric, per
 * owner. Batches with `status === "prepared"` are ignored entirely (rule 1,
 * file header). Remaining batches are grouped by `ownerId`, sorted by
 * served time (rule 3), and walked in that order: each batch's items are
 * first checked against identities claimed by strictly earlier batches only
 * (rule 2 — never against the same batch's own other items), then the whole
 * batch's identities are claimed for batches that follow. A claim is
 * first-write-wins, so `firstDeliveredBatchId`/`firstDeliveredPaperKey`
 * always point at the earliest batch that actually introduced a given
 * identity string, even if a later batch repeats it more than once.
 *
 * Returns one entry per owner that has at least one non-prepared batch
 * (sorted by `ownerId`), even when that owner has zero duplicates — a clean
 * owner is a reportable "0", never an omitted row.
 */
export function lifetimeDuplicateCount(
  servedBatches: readonly ServedBatchRecord[],
): readonly OwnerDuplicateAudit[] {
  const byOwner = new Map<string, ServedBatchRecord[]>();
  for (const record of servedBatches) {
    if (record.status === "prepared") continue; // rule 1: ignored entirely
    const list = byOwner.get(record.ownerId);
    if (list) {
      list.push(record);
    } else {
      byOwner.set(record.ownerId, [record]);
    }
  }

  const ownerIds = Array.from(byOwner.keys()).sort();
  const results: OwnerDuplicateAudit[] = [];

  for (const ownerId of ownerIds) {
    const batches = [...(byOwner.get(ownerId) ?? [])].sort(compareBatches);

    // First-claim-wins: identity string -> the batch/paper that first
    // introduced it. Kept in sync with `claimedSet` (its key set) so
    // `isDeliveredIdentity` — reused, not reimplemented — can do the O(1)
    // membership check.
    const claimedBy = new Map<string, { batchId: string; paperKey: string }>();
    const claimedSet = new Set<string>();
    const duplicates: DuplicateOccurrence[] = [];

    for (const record of batches) {
      // Phase 1: check every item against STRICTLY EARLIER batches only
      // (claimedSet/claimedBy hold nothing from this batch yet — rule 2).
      for (const paper of record.items) {
        const identity = toCanonicalIdentity(paper);
        if (isDeliveredIdentity(identity, claimedSet)) {
          const matchedOn = [identity.key, ...identity.aliases].find((s) => claimedBy.has(s));
          const claim = matchedOn ? claimedBy.get(matchedOn) : undefined;
          if (matchedOn && claim) {
            duplicates.push({
              ownerId,
              duplicateBatchId: record.batchId,
              duplicatePaperKey: paper.key,
              firstDeliveredBatchId: claim.batchId,
              firstDeliveredPaperKey: claim.paperKey,
              matchedOn,
            });
          }
        }
      }
      // Phase 2: AFTER the whole batch is checked, claim its identities for
      // batches that follow (first-write-wins, so an internal same-batch
      // repeat never overwrites an earlier item's claim within this same
      // phase either — order within the batch only affects which of ITS
      // OWN items is recorded as the claimant, never whether anything in
      // this batch gets flagged).
      for (const paper of record.items) {
        const identity = toCanonicalIdentity(paper);
        for (const s of [identity.key, ...identity.aliases]) {
          if (!claimedSet.has(s)) {
            claimedSet.add(s);
            claimedBy.set(s, { batchId: record.batchId, paperKey: paper.key });
          }
        }
      }
    }

    results.push({ ownerId, duplicates, total: duplicates.length });
  }

  return results;
}

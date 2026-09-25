// Owner-level, PERMANENT dashboard delivery ledger + per-day batch tracking
// (acceptance 16, ABC-JEV-INTEGRATION.md §1p.C). This module is FOUNDATION
// ONLY for slice P4-S1: nothing here is wired into pipeline.ts, any route, or
// the feed store yet (that starts at P4-S2). It exists so the contract can be
// built and tested test-first before anything depends on it.
//
// Canonical paper identity (the `key`/`aliases` shape below) is a SEPARATE
// module owned by P2-S1 (web/src/lib/utils/canonical-identity.ts, per the
// binding ruling ABC-JEV-INTEGRATION.md §1p.A). This module never imports it:
// every method here takes a canonical key and its aliases as plain strings,
// supplied by whatever calls this ledger. That keeps this file buildable and
// testable independent of P2's schedule, and matches the manager's explicit
// instruction that a P4-S1 writer must not import a canonical-identity
// module.
//
// Batch status values are exactly 'prepared' | 'served' | 'acknowledged'
// (ABC-JEV-INTEGRATION.md §1p.C.5 binding ruling -- NOT the earlier B guide
// draft's 'presented_pending_ack'):
//   - prepared:     selected, never sent to a client.
//   - served:       returned to an authenticated client (possibly presented
//                    -- the server cannot observe that a card actually
//                    rendered in a browser, only that a response carrying it
//                    was sent).
//   - acknowledged: the client confirmed the batch rendered. This is the
//                    ONLY transition that copies the batch's papers into the
//                    permanent dashboard_deliveries ledger.
//
// Two read methods feed future exclusion, for two different reasons
// (§1p.C.5):
//   - listDelivered:            permanent, cross-day, cross-project record of
//                                every paper ever ACKNOWLEDGED to this owner.
//                                Never expires -- there is no TTL/30-day/date
//                                logic anywhere in this module (§7.2 forbids
//                                it: "正常账号使用期间不对推送记录设置每日/30
//                                天失效").
//   - listServedUnacknowledged:  papers already sent to a client but not yet
//                                confirmed rendered. A later batch must still
//                                exclude these (they were possibly already
//                                seen) WITHOUT writing them to the permanent
//                                ledger -- a render that never happened
//                                should not become a lifetime exclusion, but
//                                it also must not silently let the same
//                                papers be re-selected while the ack is still
//                                outstanding. Accepted cost, named by the
//                                ruling: a served-but-never-rendered batch
//                                withholds its papers from later batches; A
//                                tallies served-unacked batches every round.
//
// **What does an unconfigured environment do?** Honestly: nothing persists.
// SupabaseDashboardDeliveryLedger degrades exactly like PrivatePaperPoolCache
// (web/src/lib/opportunities/private-paper-cache.ts): reads return empty
// (listDelivered/listServedUnacknowledged resolve to an empty Set, getBatch
// resolves to null) and writes (prepareBatch/markServed/acknowledgeBatch)
// succeed against an in-process-only fallback that is NOT durable -- lost on
// the next cold start, never shared across server instances. This must never
// be mistaken for a working local-dev ledger: an unconfigured environment
// never blocks a paper as delivered, the same no-op precedent
// `ephemeralPaperPoolCache` already sets for the private pool cache. This
// applies only to a genuinely UNCONFIGURED environment (no Supabase env
// vars). A CONFIGURED client whose live call fails behaves differently, on
// purpose -- see the two rules below.
//
// **Two different failure rules, on purpose (mirrors counters.ts's own
// documented "two failure rules"):**
//   - READS degrade to empty/null on a configured-client failure ("a ledger
//     outage is a miss, not a broken feed" -- the same fail-open trade-off
//     pool-cache.ts already makes; named cost: a paper may be re-shown
//     during the outage).
//   - WRITES (prepareBatch/markServed/acknowledgeBatch) THROW on a
//     configured-client failure rather than silently returning a
//     success-shaped fallback value. A write that silently looked like it
//     succeeded is exactly the dangerous case DESIGN §4 warns about for the
//     acknowledgment path ("Server failure (RPC throws / DB down): route
//     returns 503; client keeps the batch pending and retries") -- a future
//     caller (the P4-S4 ack route) needs a real exception to map to 503, not
//     a synthetic 'acknowledged' that was never durably written.
//
// `MemoryDashboardDeliveryLedger` (exported, not confined to the test file)
// is the reference implementation of the state-machine contract (idempotent
// prepare, ack transitions, owner-mismatch/not-found handling, no expiry).
// It is exported rather than redefined per test file because it IS the
// contract, not a simple get/set double like the `MemoryPoolCache` doubles
// scattered across feed tests -- P4-S2's future pipeline tests need the same
// transition logic this file's own tests exercise, and duplicating a state
// machine across files is how it drifts. It is explicitly non-durable (a
// plain in-process Map, reset on every process restart) and is never a
// production fallback -- production always uses
// SupabaseDashboardDeliveryLedger, whose own unconfigured degrade path
// reuses this class internally (see below) rather than re-implementing the
// same synthetic-batch logic a second time.
//
// `localDate` is opaque to this module: a caller-supplied "YYYY-MM-DD in the
// owner's resolved local day" string (e.g. via pool-cache.ts's
// `localCalendarDate`). Deriving/validating it is the caller's job, out of
// scope here -- this module never reads a clock to decide what counts as
// "today".

import { randomUUID } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";

export interface PaperIdentity {
  /** Canonical key from P2-S1's canonicalPaperKey(), e.g. "doi:10.1000/xyz". */
  readonly key: string;
  /** Every other key this paper is also known by (title alias, etc.). */
  readonly aliases: readonly string[];
}

export type DashboardBatchStatus = "prepared" | "served" | "acknowledged";

export interface DashboardBatch {
  readonly id: string;
  readonly ownerId: string;
  readonly localDate: string;
  /** Ordered, frozen at prepare time -- never re-sliced or re-sorted after. */
  readonly papers: readonly PaperIdentity[];
  readonly status: DashboardBatchStatus;
  readonly intentVersion?: string;
  readonly createdAt: string;
  readonly servedAt?: string;
  readonly acknowledgedAt?: string;
  /**
   * P4-S3 (Round 3) addition -- ABC-JEV-INTEGRATION.md §1p.C.5/C.8, DESIGN
   * §5 of docs/jev-abc/P4-B-20260924T0338Z.md: "store the served item
   * payloads in the batch so the frozen batch never depends on the day's
   * pool cache (the pool key changes when intent changes mid-day)." Kept as
   * an opaque, caller-typed payload -- this module never imports a
   * feed-specific item shape, the same way it never imports the canonical-
   * identity module (see the top-of-file comment). Absent on a batch minted
   * without one (every call site before this addition, and any future
   * caller that still omits it) -- the route serving a batch is responsible
   * for falling back to reconstruction when this is undefined.
   */
  readonly servedItems?: readonly unknown[];
}

export type AckResult =
  | "acknowledged"
  | "already_acknowledged"
  | "not_found"
  | "owner_mismatch";

/**
 * P4-S2 (Round 3) addition -- ABC-JEV-INTEGRATION.md §1p.F. `readExclusions`
 * is deliberately additive: it does not replace or change `listDelivered`/
 * `listServedUnacknowledged` (still fail-open to an empty Set on a
 * configured-client error -- see the module comment's "two failure rules").
 * It exists because the flag-gated route needs to tell "this owner truly has
 * nothing excluded" apart from "the read itself failed," which a fail-open
 * empty Set can never distinguish. `"unavailable"` covers every case where
 * that distinction can't be made honestly: no client configured, a
 * configured client whose query errored, a missing table, or a thrown
 * exception -- once a caller has turned the ledger flag on, all of those are
 * "cannot answer," not "nothing to exclude."
 */
export type ExclusionRead =
  | { status: "ok"; keys: ReadonlySet<string> }
  | { status: "unavailable" };

export interface DashboardDeliveryLedger {
  /** Every canonical key AND alias ever acknowledged-delivered to this owner. */
  listDelivered(ownerId: string): Promise<Set<string>>;
  /** Keys+aliases of this owner's `served`-but-not-yet-`acknowledged` batches. */
  listServedUnacknowledged(ownerId: string): Promise<Set<string>>;
  /** This owner's batch row for `localDate`, if one already exists. */
  getBatch(ownerId: string, localDate: string): Promise<DashboardBatch | null>;
  /**
   * P4-S9 (acceptance 16 "archive access" subcase, ABC-JEV-INTEGRATION.md §4
   * "Round 3 — END-OF-ROUND RE-MEASUREMENT part 2" RULING (archive); §3c
   * "Archive is explicit old-batch access, not a new recommendation").
   * Bounded, most-recent-first list of this owner's local dates that have a
   * SERVED or ACKNOWLEDGED batch -- never a `'prepared'`-only date, since a
   * batch nobody has been sent yet was never "archived." Read-only: never
   * mints, never mutates.
   *
   * Fails open to `[]` on a configured-client error -- the SAME "a ledger
   * outage is a miss, not a broken feed" contract as
   * `listDelivered`/`listServedUnacknowledged` (see this module's "two
   * failure rules" comment above). This method has no `"unavailable"` state
   * of its own. A caller that must distinguish "genuinely nothing" from
   * "the read failed" checks `readExclusions`'s status first, exactly like
   * `runLedgerAwareFeed` in `web/src/app/api/feed/route.ts` already does
   * before trusting `getBatch`'s own fail-open `null` — see
   * `web/src/app/api/feed/archive/route.ts`, the only caller.
   */
  listServedBatchDates(ownerId: string, limit: number): Promise<string[]>;
  /**
   * Creates the batch row for `ownerId`/`localDate` with status 'prepared'.
   * Idempotent: if a batch already exists for that owner+date (a race, a
   * duplicate call, a retried request), returns the EXISTING batch unchanged
   * -- the `papers`/`intentVersion`/`servedItems` given on a losing call are
   * discarded, never merged or overwritten. The first prepare for a given
   * owner+date wins.
   *
   * `servedItems` (P4-S3, optional, trailing) is the exact served item
   * payload array a caller wants frozen alongside `papers`' identities --
   * see `DashboardBatch.servedItems`. Omitting it keeps every pre-P4-S3 call
   * site compiling and behaving unchanged.
   */
  prepareBatch(
    ownerId: string,
    localDate: string,
    papers: readonly PaperIdentity[],
    intentVersion?: string,
    servedItems?: readonly unknown[],
  ): Promise<DashboardBatch>;
  /**
   * Transitions a 'prepared' batch to 'served'. A silent no-op if the batch
   * is already 'served'/'acknowledged', not found, or owned by someone else
   * -- never throws for any of those, since there is nothing a caller could
   * safely do differently for any of them at this call site.
   */
  markServed(ownerId: string, batchId: string): Promise<void>;
  /**
   * Atomically marks the batch acknowledged and copies every one of its
   * papers' key+aliases into the permanent ledger. See `AckResult` for the
   * four outcomes; all four are terminal, non-throwing results, not
   * exceptions -- an ack endpoint maps each to its own HTTP status.
   */
  acknowledgeBatch(ownerId: string, batchId: string): Promise<AckResult>;
  /**
   * Strict read variant of `listDelivered` UNION `listServedUnacknowledged`
   * -- see the `ExclusionRead` doc comment for why this exists alongside
   * (not instead of) those two fail-open methods.
   */
  readExclusions(ownerId: string): Promise<ExclusionRead>;
}

// ── The in-memory reference implementation ──────────────────────────────

function clonePapers(papers: readonly PaperIdentity[]): PaperIdentity[] {
  return papers.map((paper) => ({ key: paper.key, aliases: [...paper.aliases] }));
}

/** `undefined` in, `undefined` out; anything else (including `[]`) is shallow-copied. */
function cloneServedItems(items: readonly unknown[] | undefined): unknown[] | undefined {
  return items !== undefined ? [...items] : undefined;
}

interface MutableDashboardBatch {
  id: string;
  ownerId: string;
  localDate: string;
  papers: PaperIdentity[];
  status: DashboardBatchStatus;
  intentVersion?: string;
  createdAt: string;
  servedAt?: string;
  acknowledgedAt?: string;
  servedItems?: unknown[];
}

function freeze(batch: MutableDashboardBatch): DashboardBatch {
  return {
    id: batch.id,
    ownerId: batch.ownerId,
    localDate: batch.localDate,
    papers: clonePapers(batch.papers),
    status: batch.status,
    intentVersion: batch.intentVersion,
    createdAt: batch.createdAt,
    servedAt: batch.servedAt,
    acknowledgedAt: batch.acknowledgedAt,
    servedItems: cloneServedItems(batch.servedItems),
  };
}

/**
 * Non-durable reference implementation of the full contract -- see the
 * module comment above. Process-memory only; never used in production.
 */
export class MemoryDashboardDeliveryLedger implements DashboardDeliveryLedger {
  private readonly batchesById = new Map<string, MutableDashboardBatch>();
  private readonly batchIdByOwnerDate = new Map<string, string>();
  /** owner -> every delivered canonical key UNION every alias, forever. */
  private readonly delivered = new Map<string, Set<string>>();

  private ownerDateKey(ownerId: string, localDate: string): string {
    return `${ownerId}\u0000${localDate}`;
  }

  async listDelivered(ownerId: string): Promise<Set<string>> {
    return new Set(this.delivered.get(ownerId) ?? []);
  }

  async listServedUnacknowledged(ownerId: string): Promise<Set<string>> {
    const keys = new Set<string>();
    for (const batch of this.batchesById.values()) {
      if (batch.ownerId !== ownerId || batch.status !== "served") continue;
      for (const paper of batch.papers) {
        keys.add(paper.key);
        for (const alias of paper.aliases) keys.add(alias);
      }
    }
    return keys;
  }

  async getBatch(ownerId: string, localDate: string): Promise<DashboardBatch | null> {
    const id = this.batchIdByOwnerDate.get(this.ownerDateKey(ownerId, localDate));
    const batch = id ? this.batchesById.get(id) : undefined;
    return batch ? freeze(batch) : null;
  }

  async listServedBatchDates(ownerId: string, limit: number): Promise<string[]> {
    const dates: string[] = [];
    for (const batch of this.batchesById.values()) {
      if (batch.ownerId !== ownerId) continue;
      if (batch.status !== "served" && batch.status !== "acknowledged") continue;
      dates.push(batch.localDate);
    }
    // YYYY-MM-DD sorts lexicographically = chronologically; descending gives
    // most-recent-first without needing a separate Date parse.
    dates.sort((a, b) => (a < b ? 1 : a > b ? -1 : 0));
    return dates.slice(0, Math.max(0, limit));
  }

  async prepareBatch(
    ownerId: string,
    localDate: string,
    papers: readonly PaperIdentity[],
    intentVersion?: string,
    servedItems?: readonly unknown[],
  ): Promise<DashboardBatch> {
    const dateKey = this.ownerDateKey(ownerId, localDate);
    const existingId = this.batchIdByOwnerDate.get(dateKey);
    if (existingId) {
      const existing = this.batchesById.get(existingId);
      // Idempotent: a race/duplicate/retry returns the batch as it already
      // is. This call's papers/intentVersion/servedItems are discarded, not
      // merged.
      if (existing) return freeze(existing);
    }
    const batch: MutableDashboardBatch = {
      id: randomUUID(),
      ownerId,
      localDate,
      papers: clonePapers(papers),
      status: "prepared",
      intentVersion,
      createdAt: new Date().toISOString(),
      servedItems: cloneServedItems(servedItems),
    };
    this.batchesById.set(batch.id, batch);
    this.batchIdByOwnerDate.set(dateKey, batch.id);
    return freeze(batch);
  }

  async markServed(ownerId: string, batchId: string): Promise<void> {
    const batch = this.batchesById.get(batchId);
    if (!batch || batch.ownerId !== ownerId) return; // not found / owner mismatch: no-op
    if (batch.status !== "prepared") return; // already served/acknowledged: no-op
    batch.status = "served";
    batch.servedAt = new Date().toISOString();
  }

  async acknowledgeBatch(ownerId: string, batchId: string): Promise<AckResult> {
    const batch = this.batchesById.get(batchId);
    if (!batch) return "not_found";
    if (batch.ownerId !== ownerId) return "owner_mismatch";
    if (batch.status === "acknowledged") return "already_acknowledged";

    // 'prepared' OR 'served' both succeed here (§1p.C.5) -- this method
    // never looks at "today"/localDate, only the batch's own stored state,
    // so a cross-day late ack still succeeds.
    const set = this.delivered.get(ownerId) ?? new Set<string>();
    for (const paper of batch.papers) {
      set.add(paper.key);
      for (const alias of paper.aliases) set.add(alias);
    }
    this.delivered.set(ownerId, set);

    batch.status = "acknowledged";
    batch.acknowledgedAt = new Date().toISOString();
    return "acknowledged";
  }

  // The in-memory ledger can always honestly answer -- there is no
  // "unavailable" state for a plain process-local Map. See
  // SupabaseDashboardDeliveryLedger.readExclusions for the strict contract
  // this exists to support.
  async readExclusions(ownerId: string): Promise<ExclusionRead> {
    const delivered = await this.listDelivered(ownerId);
    const servedUnacknowledged = await this.listServedUnacknowledged(ownerId);
    return { status: "ok", keys: new Set([...delivered, ...servedUnacknowledged]) };
  }
}

// ── The Supabase implementation ─────────────────────────────────────────

interface DashboardBatchRow {
  id: string;
  owner_id: string;
  local_date: string;
  papers: { key: string; aliases: string[] }[];
  status: DashboardBatchStatus;
  intent_version: string | null;
  created_at: string;
  served_at: string | null;
  acknowledged_at: string | null;
  /** P4-S3 addition -- absent/null on a row written before this column existed. */
  served_items?: unknown[] | null;
}

interface DeliveryRow {
  canonical_key: string;
  aliases: string[];
}

/**
 * Hand-rolled, narrow shapes for exactly the calls this module makes -- not
 * a copy of supabase-js's real (much larger) generic types. `.eq()` stays
 * chainable AND awaitable at every step, matching how supabase-js's own
 * query builders are thenable. `createAdminClient()`'s real client is cast
 * through `unknown` into this shape, the same pattern
 * private-paper-cache.ts and usage/counters.ts already use -- nothing here
 * is checked against the real library's types, only against this module's
 * own calls, and none of this is exercised against a live database (DB/RLS
 * proof BLOCKED for this slice -- no isolated Supabase instance available).
 */
interface SelectQuery<Row> extends PromiseLike<{ data: Row[] | null; error: unknown }> {
  eq(column: string, value: string): SelectQuery<Row>;
  /** P4-S9 -- listServedBatchDates' status-in-set filter. */
  in(column: string, values: readonly string[]): SelectQuery<Row>;
  /** P4-S9 -- listServedBatchDates' most-recent-first ordering. */
  order(column: string, options: { ascending: boolean }): SelectQuery<Row>;
  /** P4-S9 -- listServedBatchDates' bound. */
  limit(count: number): SelectQuery<Row>;
  maybeSingle(): Promise<{ data: Row | null; error: unknown }>;
}

interface UpdateQuery extends PromiseLike<{ error: unknown }> {
  eq(column: string, value: string): UpdateQuery;
}

interface NewDashboardBatchRow {
  owner_id: string;
  local_date: string;
  papers: { key: string; aliases: string[] }[];
  status: "prepared";
  intent_version: string | null;
  /** P4-S3 addition -- only present on the wire when a caller actually supplied it (see prepareBatch below). */
  served_items?: unknown[];
}

interface DashboardBatchesTable {
  select(columns: string): SelectQuery<DashboardBatchRow>;
  insert(row: NewDashboardBatchRow): {
    select(columns: string): { maybeSingle(): Promise<{ data: DashboardBatchRow | null; error: unknown }> };
  };
  update(row: { status: "served"; served_at: string }): UpdateQuery;
}

interface DashboardDeliveriesTable {
  select(columns: string): SelectQuery<DeliveryRow>;
}

interface SupabaseLedgerClient {
  from(table: "dashboard_batches"): DashboardBatchesTable;
  from(table: "dashboard_deliveries"): DashboardDeliveriesTable;
  rpc(
    fn: "acknowledge_dashboard_batch",
    args: { p_owner_id: string; p_batch_id: string },
  ): Promise<{ data: string | null; error: unknown }>;
}

function configuredDashboardLedgerClient(): SupabaseLedgerClient | null {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return null;
  }
  try {
    return createAdminClient() as unknown as SupabaseLedgerClient;
  } catch {
    return null;
  }
}

function rowToBatch(row: DashboardBatchRow): DashboardBatch {
  return {
    id: row.id,
    ownerId: row.owner_id,
    localDate: row.local_date,
    papers: (row.papers ?? []).map((paper) => ({
      key: paper.key,
      aliases: [...(paper.aliases ?? [])],
    })),
    status: row.status,
    intentVersion: row.intent_version ?? undefined,
    createdAt: row.created_at,
    servedAt: row.served_at ?? undefined,
    acknowledgedAt: row.acknowledged_at ?? undefined,
    servedItems: row.served_items ?? undefined,
  };
}

/**
 * Server-only adapter for the permanent dashboard delivery ledger. See the
 * module comment for the unconfigured degrade contract and the read/write
 * failure asymmetry.
 */
export class SupabaseDashboardDeliveryLedger implements DashboardDeliveryLedger {
  private readonly client: SupabaseLedgerClient | null;
  // Only ever consulted when `client` is null (unconfigured) -- never
  // touched once a real client is present. Reused rather than
  // re-implemented so the "synthetic, non-durable batch" degrade path is
  // the same well-tested state machine as MemoryDashboardDeliveryLedger,
  // not a second copy of it.
  private readonly fallback = new MemoryDashboardDeliveryLedger();

  constructor(client: SupabaseLedgerClient | null = configuredDashboardLedgerClient()) {
    this.client = client;
  }

  async listDelivered(ownerId: string): Promise<Set<string>> {
    if (!this.client) return this.fallback.listDelivered(ownerId);
    try {
      const { data, error } = await this.client
        .from("dashboard_deliveries")
        .select("canonical_key, aliases")
        .eq("owner_id", ownerId);
      if (error || !data) return new Set();
      const keys = new Set<string>();
      for (const row of data) {
        keys.add(row.canonical_key);
        for (const alias of row.aliases ?? []) keys.add(alias);
      }
      return keys;
    } catch {
      // A ledger-read outage degrades to "no additional exclusion", never to
      // a broken feed request -- the same trade-off pool-cache.ts's own
      // outage handling makes. Named cost: a paper may be re-shown during
      // the outage.
      return new Set();
    }
  }

  async listServedUnacknowledged(ownerId: string): Promise<Set<string>> {
    if (!this.client) return this.fallback.listServedUnacknowledged(ownerId);
    try {
      const { data, error } = await this.client
        .from("dashboard_batches")
        .select("papers, status")
        .eq("owner_id", ownerId)
        .eq("status", "served");
      if (error || !data) return new Set();
      const keys = new Set<string>();
      for (const row of data) {
        for (const paper of row.papers ?? []) {
          keys.add(paper.key);
          for (const alias of paper.aliases ?? []) keys.add(alias);
        }
      }
      return keys;
    } catch {
      return new Set();
    }
  }

  async getBatch(ownerId: string, localDate: string): Promise<DashboardBatch | null> {
    if (!this.client) return this.fallback.getBatch(ownerId, localDate);
    try {
      const { data, error } = await this.client
        .from("dashboard_batches")
        .select("*")
        .eq("owner_id", ownerId)
        .eq("local_date", localDate)
        .maybeSingle();
      if (error || !data) return null;
      return rowToBatch(data);
    } catch {
      return null;
    }
  }

  async listServedBatchDates(ownerId: string, limit: number): Promise<string[]> {
    if (!this.client) return this.fallback.listServedBatchDates(ownerId, limit);
    try {
      const { data, error } = await this.client
        .from("dashboard_batches")
        .select("local_date, status")
        .eq("owner_id", ownerId)
        .in("status", ["served", "acknowledged"])
        .order("local_date", { ascending: false })
        .limit(limit);
      if (error || !data) return [];
      return data.map((row) => row.local_date);
    } catch {
      // Same fail-open reasoning as listDelivered/listServedUnacknowledged
      // above -- a read outage here degrades to "no archived dates found",
      // never a thrown error. The route's own readExclusions probe is what
      // turns a genuine outage into a truthful 503; see this method's own
      // doc comment on the interface.
      return [];
    }
  }

  async prepareBatch(
    ownerId: string,
    localDate: string,
    papers: readonly PaperIdentity[],
    intentVersion?: string,
    servedItems?: readonly unknown[],
  ): Promise<DashboardBatch> {
    if (!this.client) {
      return this.fallback.prepareBatch(ownerId, localDate, papers, intentVersion, servedItems);
    }
    // Insert-or-detect-duplicate: same idiom as the briefing_deliveries
    // double-send fix (ABC-JEV-INTEGRATION.md F-A-P4-07). The
    // `unique (owner_id, local_date)` constraint makes a losing concurrent
    // insert safe to just re-read rather than merge or overwrite -- the
    // FIRST prepare for a given owner+date wins.
    const row: NewDashboardBatchRow = {
      owner_id: ownerId,
      local_date: localDate,
      papers: papers.map((paper) => ({ key: paper.key, aliases: [...paper.aliases] })),
      status: "prepared",
      intent_version: intentVersion ?? null,
    };
    // P4-S3 -- only put `served_items` on the wire when a caller actually
    // supplied one, so a pre-P4-S3 call site's insert row stays byte-
    // identical to before this column existed (delivery-ledger.supabase.test.ts's
    // exact `toEqual` on the insert row depends on this).
    if (servedItems !== undefined) row.served_items = [...servedItems];
    const { data, error } = await this.client
      .from("dashboard_batches")
      .insert(row)
      .select("*")
      .maybeSingle();
    if (!error && data) return rowToBatch(data);
    const existing = await this.getBatch(ownerId, localDate);
    if (existing) return existing;
    throw new Error(
      `dashboard_batches insert failed for owner ${ownerId}/${localDate} and no existing row was found afterward: ${String(error)}`,
    );
  }

  async markServed(ownerId: string, batchId: string): Promise<void> {
    if (!this.client) return this.fallback.markServed(ownerId, batchId);
    const { error } = await this.client
      .from("dashboard_batches")
      .update({ status: "served", served_at: new Date().toISOString() })
      .eq("id", batchId)
      .eq("owner_id", ownerId)
      .eq("status", "prepared");
    if (error) {
      throw new Error(`dashboard_batches markServed failed for batch ${batchId}: ${String(error)}`);
    }
  }

  async acknowledgeBatch(ownerId: string, batchId: string): Promise<AckResult> {
    if (!this.client) return this.fallback.acknowledgeBatch(ownerId, batchId);
    const { data, error } = await this.client.rpc("acknowledge_dashboard_batch", {
      p_owner_id: ownerId,
      p_batch_id: batchId,
    });
    if (error || data == null) {
      throw new Error(`acknowledge_dashboard_batch RPC failed for batch ${batchId}: ${String(error)}`);
    }
    if (
      data === "acknowledged" ||
      data === "already_acknowledged" ||
      data === "not_found" ||
      data === "owner_mismatch"
    ) {
      return data;
    }
    throw new Error(
      `acknowledge_dashboard_batch RPC returned an unrecognized status ${JSON.stringify(data)} for batch ${batchId}`,
    );
  }

  /**
   * Deliberately NOT delegating to `this.fallback` when unconfigured (unlike
   * every other method on this class): the fallback's honest empty Set is
   * correct for THEIR fail-open contract, but §1p.F treats "no client to ask"
   * exactly like "asked and failed" -- both are "cannot be read" once a
   * caller has turned the ledger flag on. This method also duplicates
   * (rather than reuses) listDelivered/listServedUnacknowledged's query
   * logic on purpose: sharing code that would make an existing method's
   * fail-open behavior depend on this method's fail-closed one is exactly
   * the kind of coupling that could silently change behavior neither this
   * slice nor its own tests are asking to change.
   */
  async readExclusions(ownerId: string): Promise<ExclusionRead> {
    if (!this.client) return { status: "unavailable" };
    try {
      const [deliveries, servedBatches] = await Promise.all([
        this.client.from("dashboard_deliveries").select("canonical_key, aliases").eq("owner_id", ownerId),
        this.client
          .from("dashboard_batches")
          .select("papers, status")
          .eq("owner_id", ownerId)
          .eq("status", "served"),
      ]);
      if (deliveries.error || !deliveries.data || servedBatches.error || !servedBatches.data) {
        return { status: "unavailable" };
      }
      const keys = new Set<string>();
      for (const row of deliveries.data) {
        keys.add(row.canonical_key);
        for (const alias of row.aliases ?? []) keys.add(alias);
      }
      for (const row of servedBatches.data) {
        for (const paper of row.papers ?? []) {
          keys.add(paper.key);
          for (const alias of paper.aliases ?? []) keys.add(alias);
        }
      }
      return { status: "ok", keys };
    } catch {
      return { status: "unavailable" };
    }
  }
}

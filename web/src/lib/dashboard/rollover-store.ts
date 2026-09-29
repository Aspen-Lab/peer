// Never-delivered-only rollover candidate storage (P4-S6, F-A-P4-08
// remainder, ABC-JEV-INTEGRATION.md §1g/§1p.C.4). Stores, per owner, the
// candidates from a prior day's "final pool" (see FINAL_POOL_SIZE in
// web/src/lib/feed/pipeline.ts) that were never actually presented, so they
// can compete again alongside newly-fetched candidates on a later day.
//
// DEDICATED table, not a jsonb column on dashboard_batches (binding ruling
// ABC-JEV-INTEGRATION.md §1p.C.4, overriding the earlier B guide draft's
// DESIGN §6 "rollover_candidates jsonb column on dashboard_batches"
// proposal, see docs/jev-abc/P4-B-20260924T0338Z.md): a day with no visit
// has NO dashboard_batches row at all (that table's rows are created only
// when a batch is actually minted, web/src/app/api/feed/route.ts's
// runLedgerAwareFeed), yet up to 30 never-delivered candidates from the LAST
// computed final pool must still survive to compete on a later day the
// owner does visit -- there may be several no-visit days in between with
// nowhere on dashboard_batches to hang that state.
//
// Canonical paper identity (the `key`/`aliases` shape below) is the SAME
// module every other P4 slice uses (web/src/lib/utils/canonical-identity.ts
// via web/src/lib/feed/paper-identity.ts's identityForRawItem, per
// ABC-JEV-INTEGRATION.md §1p.A) -- this module never imports it, exactly
// like delivery-ledger.ts never does: every method here takes a canonical
// key and its aliases as plain strings, supplied by whatever calls this
// store (web/src/app/api/feed/route.ts). `payload` is likewise kept opaque
// (`unknown`) rather than typed as a feed-specific shape, mirroring
// delivery-ledger.ts's own `DashboardBatch.servedItems` convention -- the
// caller (route.ts) knows the real shape (a ScoredItem, the same cached-item
// shape the day's pool already carries, including admissionChannels/
// identity-relevant metadata) and casts it back on read.
//
// **Failure-mode asymmetry vs. delivery-ledger.ts, and it is deliberate.**
// delivery-ledger.ts's exclusion READ fails CLOSED (an "unavailable" status
// blocks minting) because a false negative there risks re-showing a
// delivered paper -- a safety property, per §1p.F. Rollover has NO such
// safety property in either direction: losing rollover data (a read OR a
// write failure, configured-client or unconfigured) only ever means FEWER
// candidates compete tomorrow -- it can never cause a delivered paper to
// return, because that guarantee is enforced entirely and independently by
// the ledger's own exclusion filter, which every rollover candidate passes
// through unmodified once merged into the pipeline's candidate set (see
// pipeline.ts's FeedPipelineOptions.rolloverCandidates and
// web/src/lib/feed/rollover.test.ts). So BOTH methods on this interface are
// contractually NEVER-THROWING: `list` degrades to `[]`, `upsert` silently
// no-ops, on every failure mode (unconfigured, a configured-client query
// error, or a thrown exception) -- there is no "unavailable" signal to
// propagate here, unlike ExclusionRead over in delivery-ledger.ts.
//
// Retention (30 days from first_seen) is enforced entirely at READ time
// (`list`'s cutoff filter below) -- there is no purge/delete job anywhere in
// this campaign (not authorized). A row older than 30 days simply stops
// being returned by `list`; it is never physically deleted by this module.
//
// CANONICAL RETENTION DEFINITION (P4-S6-FIX, F-A-P4S6-02, stated ONCE here
// and implemented identically by both `list` implementations below): a
// candidate is retained while its age is STRICTLY LESS than 30 days --
// `firstSeenMs > cutoffMs` where `cutoffMs = now - 30d`. A candidate whose
// first_seen_at is EXACTLY 30 days before `now` is expired (the boundary is
// exclusive). Before this fix, MemoryRolloverCandidateStore already
// implemented exactly this (its own comment below predates this one), but
// SupabaseRolloverCandidateStore used an inclusive `.gte` -- disagreeing at
// the single instant a candidate turns exactly 30 days old. Aligned to the
// Memory side's definition (rather than picking a third option) as the
// smaller, already-tested, already-documented diff.
//
// CANONICAL INTENT-VERSION CONTRACT (P4-S6-FIX, F-A-P4S6-01,
// ABC-JEV-INTEGRATION.md §1g "...may compete tomorrow, subject to current
// eligibility" and the §4 "Round 3 -- P4-S6 fresh A" ruling): every
// candidate optionally carries an opaque `intentVersion` string, stamped by
// the CALLER (route.ts's `serializeFeedIntent(pipelineReq.intent)` --
// web/src/lib/feed/intent.ts, the same stable intent fingerprint
// decision-cache.ts/private-paper-cache.ts already use as cache identity;
// deliberately NOT `intent.version`, which is a constant format tag, always
// "feed-intent-v1"). This module never reads or interprets the string --
// it only stores and returns it unchanged, exactly like `payload`. Unlike
// `firstSeenAt` (preserved from the first write), `intentVersion` is
// OVERWRITTEN on every upsert, so it always reflects the most recent day
// this candidate was actually re-selected. The caller (route.ts) uses it
// at READ time to decide whether a candidate's `admissionChannels` tag may
// still be trusted, or must be stripped so the candidate re-qualifies
// through today's literal keyword gate -- see route.ts's
// `reconcileRolloverCandidateIntent`. A row with no stored `intentVersion`
// (a legacy row written before this field existed) is indistinguishable
// from a mismatch to that caller-side logic, by design.

import { createAdminClient } from "@/lib/supabase/admin";

/** 30 days, the retention window a rollover candidate survives from its first_seen_at (ABC-JEV-INTEGRATION.md §1p.C.4). Boundary is exclusive -- see the canonical retention definition in this file's top-of-file comment. */
const ROLLOVER_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

export interface RolloverCandidateInput {
  /** Canonical key from identityForRawItem(), e.g. "doi:10.1000/xyz". */
  readonly key: string;
  /** Every other key this paper is also known by (title alias, etc.). */
  readonly aliases: readonly string[];
  /** Opaque, caller-typed payload -- the minimal item data needed to re-score this candidate later. */
  readonly payload: unknown;
  /**
   * P4-S6-FIX (F-A-P4S6-01) -- the canonical intent snapshot in effect when
   * THIS upsert wrote the candidate (`serializeFeedIntent`, see this file's
   * top-of-file comment). Opaque to this module. Absent when the caller has
   * no structured intent to stamp (e.g. route.ts's GET path) or when
   * upserting from code written before this field existed.
   */
  readonly intentVersion?: string;
}

export interface RolloverCandidate extends RolloverCandidateInput {
  /** ISO timestamp of the FIRST day this candidate was ever stored -- never changes on a later upsert. */
  readonly firstSeenAt: string;
  /** YYYY-MM-DD local date of the mint that most recently saw this candidate in its final pool. */
  readonly lastPoolDate: string;
}

export interface RolloverCandidateStore {
  /**
   * Every non-expired (< 30 days since first_seen) rollover candidate stored
   * for this owner. Never throws -- degrades to `[]` on any failure, since a
   * lost read only means fewer candidates compete, never a safety issue (see
   * this module's top-of-file comment).
   */
  list(ownerId: string, now: Date): Promise<RolloverCandidate[]>;
  /**
   * Upserts each candidate keyed by canonical key: a brand-new key gets
   * firstSeenAt stamped now and lastPoolDate = localDate; an EXISTING key
   * keeps its original firstSeenAt and only updates aliases/payload/
   * lastPoolDate/intentVersion. Never throws -- a write failure silently
   * no-ops (fewer candidates survive to tomorrow, nothing else). A caller
   * should still treat this as best-effort, not a durability guarantee,
   * exactly like every other write on an unconfigured or degraded
   * environment in this codebase.
   */
  upsert(ownerId: string, localDate: string, candidates: readonly RolloverCandidateInput[]): Promise<void>;
}

// ── The in-memory reference implementation ──────────────────────────────

interface MutableRolloverRow {
  key: string;
  aliases: string[];
  payload: unknown;
  firstSeenAt: string;
  lastPoolDate: string;
  intentVersion?: string;
}

function freezeRow(row: MutableRolloverRow): RolloverCandidate {
  return {
    key: row.key,
    aliases: [...row.aliases],
    payload: row.payload,
    firstSeenAt: row.firstSeenAt,
    lastPoolDate: row.lastPoolDate,
    intentVersion: row.intentVersion,
  };
}

/**
 * Non-durable reference implementation -- process-memory only, never used in
 * production. Exported (not confined to a test file) because it IS the
 * contract's reference behaviour, matching MemoryDashboardDeliveryLedger's
 * own export-not-per-test-file convention in delivery-ledger.ts, and because
 * SupabaseRolloverCandidateStore's own unconfigured degrade path reuses it
 * internally rather than re-implementing the same logic a second time.
 */
export class MemoryRolloverCandidateStore implements RolloverCandidateStore {
  private readonly byOwner = new Map<string, Map<string, MutableRolloverRow>>();

  async list(ownerId: string, now: Date): Promise<RolloverCandidate[]> {
    const owned = this.byOwner.get(ownerId);
    if (!owned) return [];
    const cutoffMs = now.getTime() - ROLLOVER_RETENTION_MS;
    const out: RolloverCandidate[] = [];
    for (const row of owned.values()) {
      const firstSeenMs = Date.parse(row.firstSeenAt);
      // Canonical retention definition (this file's top-of-file comment,
      // F-A-P4S6-02): retained while strictly less than 30 days old;
      // exactly-30-days-old (or unparseable, defensively) is expired.
      if (Number.isFinite(firstSeenMs) && firstSeenMs > cutoffMs) {
        out.push(freezeRow(row));
      }
    }
    return out;
  }

  async upsert(
    ownerId: string,
    localDate: string,
    candidates: readonly RolloverCandidateInput[],
  ): Promise<void> {
    if (candidates.length === 0) return;
    let owned = this.byOwner.get(ownerId);
    if (!owned) {
      owned = new Map();
      this.byOwner.set(ownerId, owned);
    }
    const nowIso = new Date().toISOString();
    for (const c of candidates) {
      const existing = owned.get(c.key);
      owned.set(c.key, {
        key: c.key,
        aliases: [...c.aliases],
        payload: c.payload,
        firstSeenAt: existing?.firstSeenAt ?? nowIso,
        lastPoolDate: localDate,
        // P4-S6-FIX (F-A-P4S6-01) -- unlike firstSeenAt, always overwritten
        // to whatever the caller supplies THIS upsert (see this file's
        // top-of-file "CANONICAL INTENT-VERSION CONTRACT" comment).
        intentVersion: c.intentVersion,
      });
    }
  }
}

// ── The Supabase implementation ─────────────────────────────────────────

interface RolloverRow {
  canonical_key: string;
  aliases: string[];
  payload: unknown;
  first_seen_at: string;
  last_pool_date: string;
  /** P4-S6-FIX (F-A-P4S6-01) -- nullable: absent on every row written before this column existed. */
  intent_version: string | null;
}

/**
 * Hand-rolled, narrow shape for exactly the calls this module makes -- same
 * discipline as delivery-ledger.ts's SelectQuery/SupabaseLedgerClient
 * (nothing here is checked against supabase-js's real, larger generic
 * types, and none of this is exercised against a live database -- DB/RLS
 * proof BLOCKED, no isolated Supabase instance available to this agent).
 */
interface SelectQuery extends PromiseLike<{ data: RolloverRow[] | null; error: unknown }> {
  eq(column: string, value: string): SelectQuery;
  /** P4-S6-FIX (F-A-P4S6-02) -- exclusive (was `gte`, inclusive); see this file's canonical retention definition. */
  gt(column: string, value: string): SelectQuery;
}

interface DashboardRolloverCandidatesTable {
  select(columns: string): SelectQuery;
}

interface SupabaseRolloverClient {
  from(table: "dashboard_rollover_candidates"): DashboardRolloverCandidatesTable;
  rpc(
    fn: "upsert_rollover_candidates",
    args: { p_owner_id: string; p_local_date: string; p_candidates: unknown },
  ): Promise<{ data: unknown; error: unknown }>;
}

function configuredRolloverClient(): SupabaseRolloverClient | null {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return null;
  }
  try {
    return createAdminClient() as unknown as SupabaseRolloverClient;
  } catch {
    return null;
  }
}

/**
 * Server-only adapter for the rollover candidate store. See the module
 * comment for the unconfigured degrade contract and the (deliberately
 * symmetric, unlike delivery-ledger.ts) fail-soft read/write behaviour.
 */
export class SupabaseRolloverCandidateStore implements RolloverCandidateStore {
  private readonly client: SupabaseRolloverClient | null;
  // Only ever consulted when `client` is null (unconfigured) -- reused
  // rather than re-implemented, same reasoning as
  // SupabaseDashboardDeliveryLedger.fallback in delivery-ledger.ts.
  private readonly fallback = new MemoryRolloverCandidateStore();

  constructor(client: SupabaseRolloverClient | null = configuredRolloverClient()) {
    this.client = client;
  }

  async list(ownerId: string, now: Date): Promise<RolloverCandidate[]> {
    if (!this.client) return this.fallback.list(ownerId, now);
    try {
      // Canonical retention definition (this file's top-of-file comment,
      // F-A-P4S6-02): exclusive boundary, `.gt` not `.gte` -- a row exactly
      // 30 days old is expired, matching MemoryRolloverCandidateStore.
      const cutoffIso = new Date(now.getTime() - ROLLOVER_RETENTION_MS).toISOString();
      const { data, error } = await this.client
        .from("dashboard_rollover_candidates")
        .select("canonical_key, aliases, payload, first_seen_at, last_pool_date, intent_version")
        .eq("owner_id", ownerId)
        .gt("first_seen_at", cutoffIso);
      if (error || !data) return [];
      return data.map((row) => ({
        key: row.canonical_key,
        aliases: [...(row.aliases ?? [])],
        payload: row.payload,
        firstSeenAt: row.first_seen_at,
        lastPoolDate: row.last_pool_date,
        intentVersion: row.intent_version ?? undefined,
      }));
    } catch {
      // A read outage degrades to "no rollover candidates", never a broken
      // feed request -- see this module's top-of-file comment on why this
      // is safe (unlike delivery-ledger.ts's exclusion read).
      return [];
    }
  }

  async upsert(
    ownerId: string,
    localDate: string,
    candidates: readonly RolloverCandidateInput[],
  ): Promise<void> {
    if (!this.client) return this.fallback.upsert(ownerId, localDate, candidates);
    if (candidates.length === 0) return;
    try {
      const payload = candidates.map((c) => ({
        key: c.key,
        aliases: [...c.aliases],
        payload: c.payload,
        intentVersion: c.intentVersion,
      }));
      const { error } = await this.client.rpc("upsert_rollover_candidates", {
        p_owner_id: ownerId,
        p_local_date: localDate,
        p_candidates: payload,
      });
      if (error) {
        console.error(
          `[rollover-store] upsert_rollover_candidates failed for owner ${ownerId}/${localDate}: ${String(error)}`,
        );
      }
    } catch (err) {
      // WRITES never throw into the caller either, unlike
      // delivery-ledger.ts's prepareBatch/markServed/acknowledgeBatch: see
      // this module's top-of-file comment for why the asymmetry with that
      // module is intentional. route.ts's own call site adds a defensive
      // `.catch` too, purely as cheap extra insurance -- unlike a
      // hypothetical similar guard on the ledger's readExclusions, which
      // would be actively wrong there, double-guarding here is always safe.
      console.error(
        `[rollover-store] upsert_rollover_candidates threw for owner ${ownerId}/${localDate}: ${String(err)}`,
      );
    }
  }
}

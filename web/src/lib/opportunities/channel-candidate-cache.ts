import { createAdminClient } from "@/lib/supabase/admin";
import type { TrustedPaperCacheScope } from "./private-paper-cache";
import type { RawItem } from "@/lib/sources/types";
import type { SourceStatusEntry } from "./pool-cache";
import type { FeedChannelId } from "@/lib/feed/pipeline";

// P2-S4d (Round 3) — F-M-P2-02, ABC-JEV-INTEGRATION.md §4 "P2-S4d design
// (addendum to the P2-S4c guide) accepted" and docs/jev-abc/
// P2-S4c-B-20260924T113605Z.md ADDENDUM D-ADD.2/D-ADD.3. Before this,
// `feed/pipeline.ts`'s four read-time recommendation channels (S2
// recommendations, OpenAlex seed-similarity, positive-seed citations, and
// the new P2-S4c-1 topic-field leg) re-ran and re-reported on EVERY
// request — with any of their flags on, a batchless page open/refresh fired
// every enabled leg's live call fresh, unbounded by anything except request
// volume. This store bounds that: one combined result per owner + local
// date + signature (positive seeds, negative seeds, topic ids, enabled
// legs), reused across requests until something about that signature
// actually changes.
//
// `FeedChannelId` is imported as a TYPE ONLY — erased entirely at compile
// time, so this file has zero runtime reference back to `feed/pipeline.ts`
// despite that file also importing FROM this one. No circular-import risk.
//
// P2-S4d-FIX (Round 3) — ABC-JEV-INTEGRATION.md §4 "P2-S4c+d fresh A ...
// Finding 2" (2026-09-24T15:40:42Z) + docs/jev-abc/
// P2-S4cd-A-20260924T152147Z.md: before this fix, BOTH `get()`
// implementations below swallowed every failure to a bare `null`,
// indistinguishable from "nothing cached yet" — a genuine storage outage
// therefore looked exactly like a miss, and `resolveChannelCandidates`
// (feed/pipeline.ts) took the "fetch every enabled leg live" branch on
// every request during the outage: the exact unbounded per-open cost
// F-M-P2-02 was built to close. `get()` now returns a tri-state
// (`ChannelCacheGetResult`) so the resolver can tell "safe to fetch live
// once" (miss) apart from "the cache itself could not be read, skip every
// live leg" (unavailable). `set()` is unchanged — it stays fail-soft/void,
// per the ruling's own scope.

/** A read-time channel leg's health, in the exact same shape `SourceStatusEntry` already uses for the day-pool's own sources/build-time channels — reused, not reinvented, so `isEligibleForRetry` needs no change to work on either one. */
export type ChannelLegStatus = SourceStatusEntry;

export interface CachedChannelCandidates {
  /** Pre-score RawItems, the same shape the old (uncached) `fetchPositiveSeedCandidates` return value already was — ready to merge straight into the day-pool's items at read time. */
  items: RawItem[];
  legStatus: Partial<Record<FeedChannelId, ChannelLegStatus>>;
  generatedAt: string;
}

/**
 * P2-S4d-FIX — tri-state result for `ChannelCandidateCache.get()`:
 *  - `"hit"` — a valid cached result exists; use `value` as-is (subject to
 *    the resolver's own bounded per-leg retry).
 *  - `"miss"` — nothing cached yet for this exact signature (or a
 *    stale/malformed row that safely behaves the same as nothing cached —
 *    see `PrivateChannelCandidateCache.get`'s own doc comment for exactly
 *    which cases classify as miss vs unavailable). Safe to fetch every
 *    enabled leg live, once, and persist.
 *  - `"unavailable"` — the cache itself could not be read (a real storage
 *    outage, or — for `PrivateChannelCandidateCache` — an unconfigured
 *    client on an otherwise-trusted call). The resolver must SKIP every
 *    live leg entirely rather than fetch uncached, and report a truthful,
 *    per-leg synthetic error distinct from a real adapter failure (Policy
 *    8, ABC-JEV-INTEGRATION.md §4 "P2-S4d design ... accepted").
 */
export type ChannelCacheGetResult =
  | { status: "hit"; value: CachedChannelCandidates }
  | { status: "miss" }
  | { status: "unavailable" };

export interface ChannelCandidateCache {
  get(ownerId: string, key: string): Promise<ChannelCacheGetResult>;
  set(ownerId: string, key: string, value: CachedChannelCandidates): Promise<void>;
}

/**
 * Deliberately distinct from `PrivatePaperPoolCache`'s own
 * `"peer-pool-v6-papers-"` prefix (private-paper-cache.ts) — the two
 * classes share the SAME `private_paper_pools` table but each refuses any
 * key not carrying its own prefix, so a channel-candidate row and a
 * day-pool row can never be confused for one another in either direction.
 * No migration: the table's `payload jsonb` column is already generic.
 */
const SCOPE_KEY_PREFIX = "peer-channels-v1-";

function isValidPayload(payload: unknown): payload is CachedChannelCandidates {
  return (
    typeof payload === "object" &&
    payload !== null &&
    Array.isArray((payload as { items?: unknown }).items) &&
    typeof (payload as { generatedAt?: unknown }).generatedAt === "string"
  );
}

interface ChannelCacheResult {
  data: { payload: unknown } | null;
  error: unknown;
}

interface ChannelCacheClient {
  from(table: "private_paper_pools"): {
    select(columns: string): {
      eq(column: string, value: string): {
        eq(column: string, value: string): { maybeSingle(): Promise<ChannelCacheResult> };
      };
    };
    upsert(
      row: { owner_id: string; scope_key: string; payload: CachedChannelCandidates; created_at: string },
      options: { onConflict: string },
    ): Promise<{ error: unknown }>;
  };
}

function configuredChannelCacheClient(): ChannelCacheClient | null {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return null;
  }
  try {
    return createAdminClient() as unknown as ChannelCacheClient;
  } catch {
    return null;
  }
}

/**
 * Server-only adapter for the owner-qualified read-time channel-candidate
 * cache. Mirrors `PrivatePaperPoolCache`'s own constructor(scope, client)
 * shape and fail-soft try/catch discipline exactly (private-paper-cache.ts)
 * — "a private-cache outage falls through to a request-local fresh result"
 * — but targets its OWN scope-key prefix in the SAME table.
 */
export class PrivateChannelCandidateCache implements ChannelCandidateCache {
  private readonly client: ChannelCacheClient | null;

  constructor(private readonly scope: TrustedPaperCacheScope, client = configuredChannelCacheClient()) {
    this.client = client;
  }

  /**
   * P2-S4d-FIX classification (deciding and documenting, per the task's own
   * instruction, which cases count as unavailable vs miss):
   *  - owner/prefix guard mismatch -> MISS. This call was never meant for
   *    this instance (wrong owner, or a key belonging to a different scope
   *    prefix, e.g. the day-pool's own `"peer-pool-v6-papers-"` rows) — a
   *    routing guard against a caller bug, not a storage failure. Nothing
   *    was actually read, so reporting "unavailable" here would be both
   *    misleading and wrong: it would make the resolver SKIP live legs for
   *    a caller that simply passed a key that isn't this cache's to serve.
   *  - no configured Supabase client (env vars missing, or
   *    `createAdminClient()` itself threw) -> UNAVAILABLE. Owner + prefix
   *    both match — this IS a call this instance is scoped to answer — and
   *    it cannot even attempt the read. Per the task spec: an unconfigured
   *    cache for an otherwise-trusted call must report "unavailable",
   *    never silently fall through to a live path.
   *  - the query resolves with a Supabase `error`, or the call throws/
   *    rejects (network reset, timeout, etc.) -> UNAVAILABLE. This is the
   *    exact outage Finding 2 / F-M-P2-02 is about.
   *  - no row found (`data` null/undefined, no error) -> MISS. A genuine
   *    "nothing cached yet for this signature" case.
   *  - a row exists but its payload fails `isValidPayload` (e.g. an older,
   *    incompatible schema version) -> MISS, not unavailable. The READ
   *    succeeded; only the stored SHAPE is wrong. Treating a shape mismatch
   *    as "unavailable" would risk wedging a signature's live legs closed
   *    behind one stale/bad row indefinitely (unlike a real outage,
   *    nothing about a bad row resolves itself over time); a miss instead
   *    self-heals — the next live fetch overwrites the row with a valid
   *    payload.
   */
  async get(ownerId: string, key: string): Promise<ChannelCacheGetResult> {
    if (ownerId !== this.scope.ownerId || !key.startsWith(SCOPE_KEY_PREFIX)) {
      return { status: "miss" };
    }
    if (!this.client) {
      return { status: "unavailable" };
    }
    try {
      const { data, error } = await this.client
        .from("private_paper_pools")
        .select("payload")
        .eq("owner_id", ownerId)
        .eq("scope_key", key)
        .maybeSingle();
      if (error) return { status: "unavailable" };
      const payload = data?.payload;
      if (payload === undefined || payload === null) return { status: "miss" };
      if (!isValidPayload(payload)) return { status: "miss" };
      return { status: "hit", value: payload };
    } catch {
      return { status: "unavailable" };
    }
  }

  async set(ownerId: string, key: string, value: CachedChannelCandidates): Promise<void> {
    if (!this.client || ownerId !== this.scope.ownerId || !key.startsWith(SCOPE_KEY_PREFIX)) {
      return;
    }
    try {
      await this.client.from("private_paper_pools").upsert(
        {
          owner_id: ownerId,
          scope_key: key,
          payload: value,
          created_at: new Date().toISOString(),
        },
        { onConflict: "owner_id,scope_key" },
      );
    } catch {
      // A private-cache outage falls through to a request-local fresh
      // result — same priority `PrivatePaperPoolCache.set` already gives
      // the day-pool's own write. P2-S4d-FIX only changed `get()`'s
      // contract; `set()` deliberately stays fail-soft/void here.
    }
  }
}

/**
 * Non-durable reference implementation — mirrors
 * `MemoryPositiveSeedFeedbackRepository`'s own convention
 * (preferences/positive-seeds.ts): used by tests, and as a safe,
 * unconfigured-Supabase fallback shape. Scoped per owner internally (unlike
 * `PrivateChannelCandidateCache`, which is bound to one owner via its
 * constructor) since nothing else binds it to a single caller.
 */
export class MemoryChannelCandidateCache implements ChannelCandidateCache {
  private readonly store = new Map<string, Map<string, CachedChannelCandidates>>();

  async get(ownerId: string, key: string): Promise<ChannelCacheGetResult> {
    const value = this.store.get(ownerId)?.get(key);
    // Never "unavailable" — an in-memory Map read has no I/O to fail.
    return value ? { status: "hit", value } : { status: "miss" };
  }

  async set(ownerId: string, key: string, value: CachedChannelCandidates): Promise<void> {
    let owned = this.store.get(ownerId);
    if (!owned) {
      owned = new Map();
      this.store.set(ownerId, owned);
    }
    owned.set(key, value);
  }
}

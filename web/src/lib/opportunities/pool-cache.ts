import { createHash } from "node:crypto";
import type {
  CareerStage,
  OpportunityFacetCounts,
} from "@/types";
import type { ScoredEventItem } from "@/lib/events/types";
import type { ScoredJobItem } from "@/lib/jobs/types";
import type { ScoredItem } from "@/lib/scoring/types";
import type { SourceId } from "@/lib/sources/types";
import { localCalendarDate, localIsoWeek } from "@/lib/local-calendar-date";
import { canonicalize } from "@/lib/scoring/term-expand";

export type OpportunitySurface = "papers" | "events" | "jobs";
export type { OpportunityFacetCounts, OpportunityFormat } from "@/types";
export { localCalendarDate, localIsoWeek } from "@/lib/local-calendar-date";

interface CachedPoolBase {
  generatedAt: string;
  localDate: string;
}

interface CachedOpportunityPoolBase extends CachedPoolBase {
  facetCounts: OpportunityFacetCounts;
}

/**
 * The paper surface's daily pool — the twin of `CachedEventPool` /
 * `CachedJobPool`, and it replaced a far thinner record that held ONLY the
 * web-search discovery side-channel's query boosts. That record cached the
 * cheap half of a paper build and left the expensive half — every academic
 * source fetch and, at Tier 2, an LLM rerank — to re-run on every request, so
 * a page reload rebuilt the feed and re-spent the tokens. The side-channel
 * itself is gone; see `buildPaperPool` for why nothing was lost with it.
 *
 * Two fields have no counterpart on the other two surfaces:
 *
 * - `items` are scored WITHOUT the preference ledger, exactly as the jobs pool
 *   is, so one day's pool can be re-ranked locally when likes/dismissals move.
 * - `aiOrder` / `aiReasons` carry Tier 2's output forward. Re-scoring on a hit
 *   would otherwise discard the one part of the build that costs money, which
 *   would defeat the point of caching at all.
 */
export type SourceHealthStatus = "ok" | "empty" | "failed";

/**
 * P2-S2 (Round 3) — F-A-P2-02, ABC-JEV-INTEGRATION.md §1p.B(2). Per-source
 * health for ONE local day's papers pool, plus enough bookkeeping to bound a
 * later read's retry of a failed source: at most once per 30 minutes and at
 * most 3 times per local day (`@/lib/feed/pipeline.ts`'s
 * `isEligibleForRetry`). `lastAttemptAt` covers the ORIGINAL build too (not
 * only a retry), so eligibility reads from one timestamp rather than two.
 * `retryCount` starts at 0 on the build itself, which is not a retry.
 */
export interface SourceStatusEntry {
  status: SourceHealthStatus;
  lastAttemptAt: string;
  retryCount: number;
  /**
   * Only set when `status` is "failed" — the underlying fetch error's own
   * message, so a cache-hit response can report the SAME honest detail a
   * fresh build response would, not just the bare word "failed".
   */
  lastErrorMessage?: string;
}

export interface CachedPaperPool extends CachedPoolBase {
  surface: "papers";
  items: ScoredItem[];
  /** Tier-2 ranking order, best-first. Empty when Tier 2 did not run. */
  aiOrder: string[];
  /** Tier-2 written reasons, by paper id. Empty when Tier 2 did not run. */
  aiReasons: Record<string, string>;
  /**
   * P2-S2 (Round 3) — F-A-P2-02, ABC-JEV-INTEGRATION.md §1p.B(2)/§3c.
   * Absent on any pool built before this slice, and absent per-source for
   * any source a build never attempted: both are treated as unknown/assume
   * ok by every reader, so this field is purely additive — no migration and
   * no `PAPER_CACHE_KEY_VERSION` bump (see `feed/pipeline.ts`'s
   * `buildPaperPool`/`retryFailedSources` and this slice's checkpoint
   * DESIGN CHOICES for why a version bump was deliberately not taken: the
   * durable store's own key-prefix gate, `private-paper-cache.ts`'s
   * `"peer-pool-v6-papers-"` check, is out of this slice's allowed files).
   */
  sourceStatus?: Partial<Record<SourceId, SourceStatusEntry>>;
  /**
   * P2-S6-FIX (Round 3) — F-A-P2S6-02, ABC-JEV-INTEGRATION.md §4 "P2-S6
   * RULING" + docs/jev-abc/P2-S6-A-20260924T145415Z.md NEW FINDING #2.
   * Reciprocal-rank-fusion provenance for a pool built with
   * `PEER_RANK_FUSION=on` — same per-item shape as `FeedMeta.rrf`
   * (`feed/types.ts`), inlined here rather than imported from there (or from
   * `scoring/rrf.ts`) to avoid a new cross-module type dependency for a
   * shared, purely additive field shape, matching the same choice
   * `FeedMeta.rrf`'s own doc comment already made for the same reason.
   * Absent on any pool built before this field existed, on any pool built
   * with the flag off, and on any pool whose build had no fresh RRF
   * computation to report — every reader treats a missing key as "no
   * provenance," never as a same-shaped object with fabricated/zero values,
   * so this field is purely additive: no migration and no
   * `PAPER_CACHE_KEY_VERSION` bump (same reasoning `sourceStatus`'s own doc
   * comment above already gives for itself). Before this field existed,
   * `feed/pipeline.ts` computed this same data at build time but had
   * nowhere on the CACHED pool to put it, so a same-day cache-hit read had
   * no path to it at all — see `feed/pipeline.ts`'s `getOrBuildCachedPool`
   * call site (the `build()` callback now spreads `built.rrf` in here) and
   * its final `meta` assembly (now reads `pool.rrf` instead of gating
   * strictly on build-only `diagnostics`).
   */
  rrf?: Record<string, { fusedScore: number; channels: { channel: string; rank: number }[] }>;
}

export interface CachedEventPool extends CachedOpportunityPoolBase {
  surface: "events";
  items: ScoredEventItem[];
}

export interface CachedJobPool extends CachedOpportunityPoolBase {
  surface: "jobs";
  items: ScoredJobItem[];
}

/**
 * Enriched daily candidates with a neutral baseline score. Request-time
 * preference scoring may reorder them locally without rebuilding this pool.
 */
export type CachedPool =
  | CachedPaperPool
  | CachedEventPool
  | CachedJobPool;

export interface PoolCache {
  get(key: string): Promise<CachedPool | null>;
  set(key: string, pool: CachedPool): Promise<void>;
}

export interface DailyPoolLoad<TPool extends CachedPool> {
  pool: TPool;
  /** True for a persisted hit or an in-process request coalesced onto a build. */
  cacheHit: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isCachedPool(value: unknown): value is CachedPool {
  if (!isRecord(value)) return false;
  if (typeof value.generatedAt !== "string") return false;
  if (typeof value.localDate !== "string") return false;

  if (value.surface === "papers") {
    return (
      Array.isArray(value.items) &&
      Array.isArray(value.aiOrder) &&
      value.aiOrder.every((id) => typeof id === "string") &&
      isRecord(value.aiReasons)
    );
  }

  if (value.surface !== "events" && value.surface !== "jobs") return false;
  if (!Array.isArray(value.items)) return false;
  return isRecord(value.facetCounts);
}

export function isCachedPaperPool(pool: CachedPool): pool is CachedPaperPool {
  return pool.surface === "papers";
}

export function isCachedEventPool(pool: CachedPool): pool is CachedEventPool {
  return pool.surface === "events";
}

export function isCachedJobPool(pool: CachedPool): pool is CachedJobPool {
  return pool.surface === "jobs";
}

export interface PoolCacheKeyInput {
  uploadInterests?: string[];
  surface: OpportunitySurface;
  requiredTopics: string[];
  exploreTopics?: string[];
  careerStage?: CareerStage;
  locationPreferences?: string[];
  /**
   * Papers only. A Tier-2 pool carries an LLM ranking a Tier-0 pool does not,
   * so the tier changes the payload rather than just the view of it. Left
   * undefined by every other caller, which `JSON.stringify` omits — so the
   * events and jobs keys keep the shape they had before this field existed.
   */
  aiTier?: 0 | 1 | 2;
  /** A server-derived private paper intent identity; never supplied by HTTP. */
  paperScopeIdentity?: string;
  /** Owner is a separate private boundary, not merely part of a hash. */
  paperOwnerId?: string;
  now?: Date;
}

// Bump whenever the durable pool payload semantics change. v3 makes cached
// scores preference-neutral so one daily pool can be safely re-ranked locally.
// v4 turns the papers entry from a discovery-only record into a full daily
// pool, so a v3 papers entry can no longer satisfy a v4 read. v5 drops the
// deleted discovery side-channel's `queryBoosts`/`resultCount` from it. v6
// moves the jobs and events period from a day to an ISO week (R-POOL-1); the
// bump is **not optional**, because a v5 daily key and a v6 weekly key would
// otherwise collide in the shared `opportunity_pools` table.
const CACHE_KEY_VERSION = 6;
// Papers stay on their own version number, bumped independently for P0-01
// (owner/intent scoping joined the hashed signature — an old v5 papers-cache
// row must never be read back as if it already had that scope). v7 —
// ABC-JEV-INTEGRATION.md §1ao.9/REQUIRED-GATE
// (docs/jev-abc/REQUIRED-GATE-B-20260928T160542Z.md): the Required-topic
// gate changed from a literal whole-phrase match to a T1-T4 qualification
// union, so a v6 pool scored under the old literal-only rule must never be
// served as if it reflects the new one. v8 — ABC-JEV-INTEGRATION.md
// §1ap/SENSE-CONTEXT (docs/jev-abc/SENSE-CONTEXT-B-20260928T173815Z.md): a
// short/ambiguous Required tag's T1-T3 literal hits can now be DEMOTED and
// T4's (similarity-only) admission of such a tag now additionally requires
// a context-agreement gate, so a v7 pool that admitted a wrong-domain paper
// at full grounding, or through T4 alone, must never be served as if it
// already reflects the gate. v9 — ABC-JEV-INTEGRATION.md §1ap AMENDMENT 4
// (docs/jev-abc/SENSE-CONTEXT-C2-20260928T205712Z.md): the context-agreement
// gate itself changed from a pool-relative measure (whose verdict on the
// SAME paper could depend on how many other items were fetched that day) to
// a pool-independent one built on a fixed shipped table, and a paper that
// self-declares a conflicting abbreviation expansion is now a hard
// non-match — a v8 pool scored under the old pool-relative gate (or without
// the self-declared-expansion rule) must never be served as if it reflects
// either change. v10 — ABC-JEV-INTEGRATION.md §1au/LCO-FORMULA
// (docs/jev-abc/LCO-FORMULA-B-20260928T234855Z.md): `ABBREVIATION_GROUPS`
// gained a bare chemical-formula alias for LCO ("licoo2") and LFP
// ("lifepo4"), so a paper that only ever spells the formula (never the
// abbreviation or the spelled-out name) now qualifies those Required tags
// through T1 — a v9 pool built under the old, formula-blind vocabulary must
// never be served as if it already reflects the wider match. v11 —
// ABC-JEV-INTEGRATION.md §1av/ABBREV-RECALL
// (docs/jev-abc/ABBREV-RECALL-B-20260929T004152Z.md): `profile-compiler.ts`'s
// projectQueries now puts a reader's Required tags ahead of their project/
// challenge phrases, so a tag that free text never restates (e.g. "LCO")
// survives every source adapter's own MAX_QUERIES truncation instead of
// being silently crowded out — a v10 pool built under the old, tag-last
// ordering may be missing candidates the corrected retrieval would have
// fetched and must never be served as if it already reflects the fix. v12 —
// ABC-JEV-INTEGRATION.md §1at/SCORE-ZERO
// (docs/jev-abc/SCORE-ZERO-B-20260928T234238Z.md): `negativePenalty` no
// longer receives the system's default avoid-review words (only the
// reader's own declared dislikes), and `rerank.ts`'s review/avoid demotion
// no longer floors a shown item at exactly 0 — both change a paper's
// `score`/`scoreBreakdown`/order without changing pool membership, so a v11
// pool scored under the old double-penalty/hard-floor must never be served
// as if it already reflects the fix. v13 — ABC-JEV-INTEGRATION.md
// §1aw/DEDUP-ANGEW (docs/jev-abc/DEDUP-ANGEW-B-20260929T064532Z.md):
// `canonical-identity.ts`'s `canonicalPaperKey` now gives a
// 10.1002/ange.<N> DOI (Angewandte Chemie's German-language edition) an
// extra alias toward its 10.1002/anie.<N> sibling (the International
// Edition), so the two editions of the same article — previously shown as
// two separate cards whenever the anie copy was already strong-linked to an
// unrelated record — now merge into one via dedupe's existing pass-1 rule.
// This changes pool MEMBERSHIP (a v12 pool built under the old, alias-blind
// identity may still carry both editions as separate items), so a v12 pool
// must never be served as if it already reflects the merge. These
// bumps share their numbers with `CACHE_KEY_VERSION` above by coincidence,
// not by a shared cause — see `derivePoolCacheKey` below for how each is
// selected.
const PAPER_CACHE_KEY_VERSION = 13;
/**
 * SINGLE SOURCE OF TRUTH for the literal key prefix a durable papers-pool
 * store may accept, derived from `PAPER_CACHE_KEY_VERSION` rather than
 * hand-copied — `private-paper-cache.ts` imports this instead of keeping its
 * own hard-coded prefix string, which is exactly what let that file's guard
 * fall out of sync with this constant when v6 first shipped (REQUIRED-GATE
 * phase 1 finding, ABC-JEV-INTEGRATION.md §1ao addendum, 2026-09-28).
 */
export const PAPER_POOL_KEY_PREFIX = `peer-pool-v${PAPER_CACHE_KEY_VERSION}-papers-`;

function normalizeSet(values: string[] | undefined): string[] {
  return Array.from(
    new Set(
      (values ?? [])
        .map(canonicalize)
        .filter(Boolean),
    ),
  ).sort((left, right) => (left < right ? -1 : left > right ? 1 : 0));
}

export function derivePoolCacheKey(input: PoolCacheKeyInput): string {
  // ABC-freemium 1-17 · R-POOL-1 · D3 — **jobs and events rebuild weekly;
  // papers stay daily.** The function already knows the surface, so the fork
  // lives here and no caller changes.
  //
  // The period appears TWICE below — inside the hashed signature and again as a
  // plaintext segment of the returned key. A fix that changed only the
  // signature would leave a daily string in the key and rebuild daily anyway,
  // so both read the same `period`.
  //
  // A mid-week topic change is still a cache miss on the user's own key, because
  // `requiredTopics`/`exploreTopics` remain in the signature. D3 says that in as
  // many words ("that is their quota to spend") — intended, not a regression.
  const period =
    input.surface === "papers"
      ? localCalendarDate(input.now)
      : localIsoWeek(input.now);
  const version = input.surface === "papers" ? PAPER_CACHE_KEY_VERSION : CACHE_KEY_VERSION;
  const signature = JSON.stringify({
    version,
    surface: input.surface,
    requiredTopics: normalizeSet(input.requiredTopics),
    exploreTopics: normalizeSet(input.exploreTopics),
    careerStage: input.careerStage?.trim() ?? "",
    locationPreferences: normalizeSet(input.locationPreferences),
    aiTier: input.aiTier,
    paperScopeIdentity: input.surface === "papers" ? input.paperScopeIdentity : undefined,
    paperOwnerId: input.surface === "papers" ? input.paperOwnerId : undefined,
    uploadInterests: input.uploadInterests?.length ? normalizeSet(input.uploadInterests) : undefined,
    date: period,
  });
  const digest = createHash("sha256").update(signature).digest("hex").slice(0, 32);
  return `peer-pool-v${version}-${input.surface}-${period}-${digest}`;
}

// P4-S8a (Round 3) — F-B-P4S8-01, ABC-JEV-INTEGRATION.md §4 Round 3
// "usage-limit interruption recovered; P2-S4b-FIX2 C done; P4-S8 B complete
// + rulings" (Policy E3), docs/jev-abc/P4-S8-B-20260924T115008Z.md DESIGN
// B1 option (b). Used to be a `WeakMap<PoolCache, Map<string,
// Promise<CachedPool>>>` keyed by the CALLER's `cache` object, so two
// distinct `PoolCache` instances working the exact same key never
// coalesced. That was invisible for the anonymous/events/jobs surfaces —
// they all share one process-wide cache singleton
// (`ephemeralPaperPoolCache` / `getDefaultOpportunityPoolCache()`), so
// there was only ever one object to key on — but silently broken for
// signed-in papers: `feed/pipeline.ts`'s `runFeedPipeline` builds a
// brand-new `PrivatePaperPoolCache` on every request that omits
// `options.cache`, so two truly concurrent requests for the same owner
// (two tabs, a double click) each ran their own build, no matter how many
// landed in the same process at once.
//
// Now a single process-wide `Map<string, Promise<CachedPool>>`, keyed by
// the pool key STRING alone. Safe because `derivePoolCacheKey` (above)
// already folds everything that must isolate one flight from another into
// that string — surface, topics, date, and for papers `paperOwnerId` +
// `paperScopeIdentity` — so two owners, two surfaces, or two days can never
// produce the same key and therefore can never share a flight; keying
// single-flight by cache-OBJECT identity on top of that was redundant from
// the start. This only fixes SAME-PROCESS concurrency (two tabs landing on
// the same warm instance); it cannot and does not fix cross-INSTANCE
// concurrency on separate serverless instances, which have no memory to
// share a `Map` through at all — that residual gap is recorded in this
// slice's own checkpoint, not silently assumed away.
const inFlightByKey = new Map<string, Promise<CachedPool>>();

/**
 * Read-through daily-pool cache with per-process single-flight protection.
 * Cache failures degrade to a fresh build; they never block Tier 0.
 *
 * Leader/follower contract (unchanged by the P4-S8a key-string fix above —
 * this is the same shape the old same-object case already had, now simply
 * reachable across different `PoolCache` objects sharing one key too): the
 * first caller for a given key runs `build()` and is reported
 * `cacheHit: false`; every other caller for that same key while it is in
 * flight awaits the SAME pending promise and is reported `cacheHit: true`
 * with the identical resolved pool — never an independent second build. If
 * the leader's build (or the read-through around it) rejects, every
 * follower sharing that promise rejects with the same error rather than
 * retrying on its own. Either way the map entry for a key is deleted once
 * its flight settles, so the next call for that key — a genuine retry after
 * a failure, or a later, unrelated request — always starts a fresh flight
 * rather than replaying a stale settled one.
 *
 * @param shouldPersist P2-S2 (Round 3) — ABC-JEV-INTEGRATION.md §1p.B(2):
 * "a pool where every source failed is not cached as a valid day." Checked
 * against the freshly built pool, before it would otherwise be written.
 * Optional and defaulting to "always persist" (today's exact behavior) so
 * every existing caller — `events/pipeline.ts`, `jobs/pipeline.ts`, and any
 * papers caller that omits it — is unaffected; only `feed/pipeline.ts`
 * passes one, to skip persisting a build where every attempted source
 * failed. The fresh pool is still RETURNED to this caller either way —
 * only persistence is gated, never the response.
 */
export async function getOrBuildCachedPool<TPool extends CachedPool>(
  cache: PoolCache,
  key: string,
  accepts: (pool: CachedPool) => pool is TPool,
  build: () => Promise<TPool>,
  shouldPersist?: (pool: TPool) => boolean,
  /**
   * ABC-freemium 1-18 · R-POOL-2 — **"refresh now": skip the READ, keep the
   * WRITE and the single-flight, under the SAME key.**
   *
   * R-POOL-2 offers "key nonce or bypass" and both obvious readings are
   * defective. A **nonce in the key** stores the rebuilt pool where nobody else
   * will ever look, so the user pays for a rebuild and the next ordinary page
   * load still serves the stale pool. A **bypass around this function** skips
   * the single-flight map below, so two clicks fire two full builds — two
   * Tavily fan-outs, on the operator's key.
   *
   * This third shape gives the user a genuinely fresh pool, gives everyone else
   * that pool on their next load, and still builds **once** for a double click.
   */
  forceRebuild = false,
): Promise<DailyPoolLoad<TPool>> {
  const existing = inFlightByKey.get(key);
  if (existing) {
    const pool = await existing;
    if (accepts(pool)) return { pool, cacheHit: true };
  }

  let builtFresh = false;
  const pending = (async (): Promise<TPool> => {
    // The read is the only thing a forced rebuild skips. The write below, and
    // the single-flight map above, both still apply.
    if (!forceRebuild) {
      try {
        const cached = await cache.get(key);
        if (cached && accepts(cached)) return cached;
      } catch {
        // A cache outage is a miss, not a feed outage.
      }
    }

    builtFresh = true;
    const pool = await build();
    if (!shouldPersist || shouldPersist(pool)) {
      try {
        await cache.set(key, pool);
      } catch {
        // Returning a fresh pool is more important than persisting it.
      }
    }
    return pool;
  })();
  inFlightByKey.set(key, pending);

  try {
    return { pool: await pending, cacheHit: !builtFresh };
  } finally {
    if (inFlightByKey.get(key) === pending) inFlightByKey.delete(key);
  }
}

/**
 * P2-S2-FIX (Round 3) — F-A-P2S2-01, ABC-JEV-INTEGRATION.md §1p.B(2). The
 * SAME per-process coalescing shape `getOrBuildCachedPool` uses for a pool
 * BUILD (above), factored out so another read-time step can share it
 * instead of inventing a second limiter. `feed/pipeline.ts`'s degraded-pool
 * retry is the first caller: concurrent requests for the same (namespaced)
 * key coalesce onto ONE in-flight `run()` instead of each doing their own
 * work.
 *
 * Reuses `inFlightByKey` itself (not a second map) so callers that want
 * isolation from `getOrBuildCachedPool`'s own build-path entries — an
 * ordinary pool key — must pass a namespaced `key` (e.g. a `"retry:"`
 * prefix); this helper does not namespace on their behalf, exactly as
 * `getOrBuildCachedPool` does not either.
 *
 * P4-S8a (Round 3) — F-B-P4S8-01, Policy E3: isolation between different
 * `PoolCache` OBJECTS is no longer automatic (the shared map is keyed by
 * the string alone, matching `getOrBuildCachedPool`'s own fix above) — two
 * cache instances retrying the SAME namespaced key now coalesce onto one
 * in-process `run()` too. That's intentional here, not a regression: the
 * caller (`retryFailedSources`) still has its OWN, separate cross-instance
 * guard for this exact scenario — an atomic counter-store claim
 * (`claimSourceRetry`) that already had to exist because a single-flight
 * map, keyed either way, only ever protects ONE process's memory and was
 * never a substitute for a durable claim across real separate instances.
 * `feed/pool-degraded.test.ts`'s "second server instance" cases simulate
 * that split with two distinct cache objects and prove the FETCH count
 * stays bounded either way — this change only removes a redundant extra
 * claim attempt when both simulated "instances" happen to share one actual
 * process (as they do in-test), it does not change what gets fetched.
 * `cache` itself stays a required parameter — still the correct shape for
 * a `PoolCache`-scoped helper, and every caller's own `run()` closure
 * already captures whichever `cache` it needs for its actual I/O — even
 * though this function's own body no longer reads it for keying.
 */
export async function withCacheSingleFlight<T extends CachedPool>(
  cache: PoolCache,
  key: string,
  run: () => Promise<T>,
): Promise<T> {
  const existing = inFlightByKey.get(key);
  if (existing) return existing as Promise<T>;

  const pending = run();
  inFlightByKey.set(key, pending);
  try {
    return await pending;
  } finally {
    if (inFlightByKey.get(key) === pending) inFlightByKey.delete(key);
  }
}

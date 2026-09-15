import { createHash } from "node:crypto";
import type {
  CareerStage,
  OpportunityFacetCounts,
} from "@/types";
import type { ScoredEventItem } from "@/lib/events/types";
import type { ScoredJobItem } from "@/lib/jobs/types";
import type { ScoredItem } from "@/lib/scoring/types";
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
export interface CachedPaperPool extends CachedPoolBase {
  surface: "papers";
  items: ScoredItem[];
  /** Tier-2 ranking order, best-first. Empty when Tier 2 did not run. */
  aiOrder: string[];
  /** Tier-2 written reasons, by paper id. Empty when Tier 2 did not run. */
  aiReasons: Record<string, string>;
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
  const signature = JSON.stringify({
    version: CACHE_KEY_VERSION,
    surface: input.surface,
    requiredTopics: normalizeSet(input.requiredTopics),
    exploreTopics: normalizeSet(input.exploreTopics),
    careerStage: input.careerStage?.trim() ?? "",
    locationPreferences: normalizeSet(input.locationPreferences),
    aiTier: input.aiTier,
    date: period,
  });
  const digest = createHash("sha256").update(signature).digest("hex").slice(0, 32);
  return `peer-pool-v${CACHE_KEY_VERSION}-${input.surface}-${period}-${digest}`;
}

const inFlightByCache = new WeakMap<
  PoolCache,
  Map<string, Promise<CachedPool>>
>();

/**
 * Read-through daily-pool cache with per-process single-flight protection.
 * Cache failures degrade to a fresh build; they never block Tier 0.
 */
export async function getOrBuildCachedPool<TPool extends CachedPool>(
  cache: PoolCache,
  key: string,
  accepts: (pool: CachedPool) => pool is TPool,
  build: () => Promise<TPool>,
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
  let inFlight = inFlightByCache.get(cache);
  if (!inFlight) {
    inFlight = new Map<string, Promise<CachedPool>>();
    inFlightByCache.set(cache, inFlight);
  }

  const existing = inFlight.get(key);
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
    try {
      await cache.set(key, pool);
    } catch {
      // Returning a fresh pool is more important than persisting it.
    }
    return pool;
  })();
  inFlight.set(key, pending);

  try {
    return { pool: await pending, cacheHit: !builtFresh };
  } finally {
    if (inFlight.get(key) === pending) inFlight.delete(key);
  }
}

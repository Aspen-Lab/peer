// The jobs feed pipeline — a parallel implementation of the paper pipeline's
// five stages (sources → dedup → Tier-0 scoring → selection → mapping) for
// job postings. Tier 0 works with zero keys (remotive/arbeitnow/himalayas);
// keyed sources and LLM query generation enable themselves via env/BYOK.

import { withSourceTimeout } from "@/lib/opportunities/shared";
import { GEMINI_SOURCE_TIMEOUT_MS } from "@/lib/sources/gemini-search";
import {
  needsVertexSourceTimeout,
  webSearchOptions,
} from "@/lib/sources/vertex-search";
import { enrichJobCandidates } from "@/lib/opportunities/enrich";
import {
  derivePoolCacheKey,
  getOrBuildCachedPool,
  isCachedJobPool,
  localCalendarDate,
  type OpportunityFacetCounts,
  type PoolCache,
} from "@/lib/opportunities/pool-cache";
import { getDefaultOpportunityPoolCache } from "@/lib/opportunities/pool-cache-runtime";
import { consumeForcedRebuild } from "@/lib/usage/rebuild-breaker";
import {
  countOpportunityFacets,
  DEFAULT_OPPORTUNITY_TOP_N,
  filterOpportunitiesByFacets,
  hasActiveOpportunityFacets,
  MAX_OPPORTUNITY_POOL_ITEMS,
} from "@/lib/opportunities/facets";
import { generateSearchQueries, templateJobQueries } from "@/lib/opportunities/query-gen";
import { jobSources } from "./sources";
import { dedupJobs } from "./dedup";
import { MIN_SCORE, scoreJobs } from "./scoring";
import type { JobScoringProfile } from "./scoring";
import { scoredJobToJob } from "./mapper";
import { withRenderedRemote } from "./remote-claim";
import type {
  JobsFeedRequest,
  JobsFeedResponse,
  JobsQuery,
  JobSourceId,
  RawJobItem,
  ScoredJobItem,
} from "./types";

const DEFAULT_PER_SOURCE_LIMIT = 60;

export interface JobsPipelineOptions {
  /** Enabled only by the once-daily cache-miss build in Phase 2. */
  enrichDetails?: boolean;
}

export interface DailyJobPoolOptions {
  cache?: PoolCache;
  now?: Date;
  /**
   * ABC-freemium 1-18 · R-POOL-2 — "refresh now". Set by the route from the
   * entitlement, never from the request body, and refused for a free user by
   * serving the pool that is already there.
   */
  poolRefresh?: boolean;
}

export interface BuiltJobPool {
  items: ScoredJobItem[];
  facetCounts: OpportunityFacetCounts;
  fetched: Partial<Record<JobSourceId, number>>;
  errors: Partial<Record<JobSourceId, string>>;
  beforeDedup: number;
  afterDedup: number;
  startedAt: number;
  generatedAt: string;
  localDate: string;
  cacheHit: boolean;
}

function jobScoringProfile(
  req: JobsFeedRequest,
  includePreferenceLedger = true,
): JobScoringProfile {
  return {
    topics: req.topics,
    softTopics: req.softTopics,
    methods: req.methods,
    seedTexts: req.seedTexts,
    preferenceLedger: includePreferenceLedger
      ? req.preferenceLedger
      : undefined,
    careerStage: req.careerStage,
    industryPreference: req.industryVsAcademia,
    locations: req.locationPreferences,
  };
}

export async function scoreJobPoolCandidates(
  deduped: RawJobItem[],
  scoringProfile: JobScoringProfile,
  now: number,
  options: JobsPipelineOptions = {},
): Promise<ScoredJobItem[]> {
  let scored = scoreJobs(deduped, scoringProfile, now, {
    applyFloor: false,
  });
  if (!options.enrichDetails || scored.length === 0) return scored;

  // The first score pass supplies relevance-gate survivors and an initial
  // order. Detail fetches are capped at 40, then the complete deduped corpus
  // is scored again so enriched location affects ranking.
  const enriched = await enrichJobCandidates(scored);
  const enrichedById = new Map(enriched.map((item) => [item.id, item]));
  scored = scoreJobs(
    deduped.map((item) => enrichedById.get(item.id) ?? item),
    scoringProfile,
    now,
    { applyFloor: false },
  );
  return scored;
}

async function buildJobPool(
  req: JobsFeedRequest,
  options: JobsPipelineOptions,
  now = new Date(),
  startedAt = Date.now(),
): Promise<BuiltJobPool> {
  const queryProfile = {
    topics: req.topics,
    softTopics: req.softTopics,
    careerStage: req.careerStage,
    industryVsAcademia: req.industryVsAcademia,
    locationPreferences: req.locationPreferences,
    currentProject: req.currentProject,
  };
  // LLM-refined queries when a provider is available (Tier 2 / BYOK);
  // template queries otherwise. Never throws.
  const queries =
    (req.aiTier ?? 0) >= 2
      ? await generateSearchQueries("jobs", queryProfile, req.llmOverride)
      : templateJobQueries(queryProfile);

  const query: JobsQuery = {
    topics: req.topics,
    queries,
    locations: req.locationPreferences ?? [],
    careerStage: req.careerStage,
    industryPreference: req.industryVsAcademia,
    limit: req.perSourceLimit ?? DEFAULT_PER_SOURCE_LIMIT,
    // RULING 75 — see the matching comment in `events/pipeline.ts`. The Tavily
    // branch is untouched; the gemini branch is what turns this surface back on.
    //
    // ABC-freemium 1-05 · R-KEY-3 — the two fields below ride on both branches.
    // `systemSearchAllowed` comes from the caller's entitlement and is `false`
    // when nothing passes it, which is what keeps the nightly cron
    // (`dispatch-digests`) and `test-digest` off the operator's key (D9).
    webSearch: {
      ...(req.searchConnectors?.tavily?.enabled
        ? { tavilyApiKey: req.searchConnectors.tavily.apiKey }
        : // CREDIT MIGRATION — prefers Vertex AI Search when a Search App is
          // configured, otherwise byte-identical to `geminiWebSearchOptions`.
          webSearchOptions(req.searchConnectors)),
      systemSearchAllowed: req.systemSearchAllowed === true,
      userId: req.userId ?? null,
    },
    apiKeys: req.apiKeys,
  };

  const active = jobSources.filter((source) => source.enabled(query));
  const results = await Promise.allSettled(
    active.map((source) =>
      withSourceTimeout(
        source.id,
        source.fetch(query),
        // RULING 76a — per-source override for `jobweb` on the gemini provider
        // only. Never a global default change.
        source.id === "jobweb" &&
        needsVertexSourceTimeout(query.webSearch?.provider)
          ? GEMINI_SOURCE_TIMEOUT_MS
          : undefined,
      ),
    ),
  );

  const fetched: Partial<Record<JobSourceId, number>> = {};
  const errors: Partial<Record<JobSourceId, string>> = {};
  const allItems: RawJobItem[] = [];
  results.forEach((result, i) => {
    const sourceId = active[i].id;
    if (result.status === "fulfilled") {
      fetched[sourceId] = result.value.length;
      allItems.push(...result.value);
    } else {
      errors[sourceId] = String(result.reason);
      fetched[sourceId] = 0;
    }
  });

  const beforeDedup = allItems.length;
  const deduped = dedupJobs(allItems);
  const scoredItems = await scoreJobPoolCandidates(
    deduped,
    jobScoringProfile(req, false),
    now.getTime(),
    options,
  );
  const items = scoredItems.slice(0, MAX_OPPORTUNITY_POOL_ITEMS);

  return {
    items,
    // RULING 68b (round 26 B priced, round 26 C landed). The server used to
    // count facets from the RAW `isRemote`, while the client counted from the
    // GATED one — so the same row was `online` here and `in-person` there, and
    // `opportunityFormat` could not tell, because its parameter type carries no
    // `source`. Counting through the shared predicate makes the two sides agree
    // byte-identically. THE `Online` COUNT DROPS AND THAT IS THE FIX (Ruling
    // 72c): today clicking `Online` returns a row that does not look online.
    facetCounts: countOpportunityFacets("jobs", items.map(withRenderedRemote)),
    fetched,
    errors,
    beforeDedup,
    afterDedup: deduped.length,
    startedAt,
    generatedAt: now.toISOString(),
    localDate: localCalendarDate(now),
    cacheHit: false,
  };
}

/** Read or build the complete scored/enriched pool for this local day. */
export async function buildDailyJobPool(
  req: JobsFeedRequest,
  options: DailyJobPoolOptions = {},
): Promise<BuiltJobPool> {
  const now = options.now ?? new Date();
  const startedAt = Date.now();
  const cache = options.cache ?? getDefaultOpportunityPoolCache();
  const key = derivePoolCacheKey({
    surface: "jobs",
    requiredTopics: req.topics,
    exploreTopics: req.softTopics,
    careerStage: req.careerStage,
    locationPreferences: req.locationPreferences,
    now,
  });
  // ABC-freemium 1-18 · R-POOL-2 — the two gates, both required.
  //
  // 1. `poolRefreshAllowed` is the entitlement's, resolved by the route. A free
  //    user's forced rebuild is REFUSED, not errored: `forceRebuild` stays
  //    false and they get the cached pool exactly as they would have.
  // 2. It counts against the daily forced-rebuild breaker, and a tripped breaker
  //    also serves the cache. Without this second gate the refresh button is an
  //    unbounded spend button for a paid user.
  //
  // **Fails closed**, like every breaker (see `counters.ts`): an unreadable
  // counter means no forced rebuild, which costs the user a refresh rather than
  // costing the owner a fan-out.
  let forceRebuild = false;
  if ((options.poolRefresh ?? req.poolRefresh) && req.userId) {
    forceRebuild = await consumeForcedRebuild(req.userId, 1, now);
  }

  let fresh: BuiltJobPool | undefined;

  const loaded = await getOrBuildCachedPool(
    cache,
    key,
    isCachedJobPool,
    async () => {
      fresh = await buildJobPool(
        req,
        { enrichDetails: true },
        now,
        startedAt,
      );
      return {
        surface: "jobs",
        items: fresh.items,
        facetCounts: fresh.facetCounts,
        generatedAt: fresh.generatedAt,
        localDate: fresh.localDate,
      };
    },
    // ABC-freemium 1-18 · R-POOL-2 — the route decides this from the
    // entitlement and the forced-rebuild breaker, never from the request body alone.
    forceRebuild,
  );

  const rescored = scoreJobs(
    loaded.pool.items,
    jobScoringProfile(req),
    now.getTime(),
    { applyFloor: false },
  ).slice(0, MAX_OPPORTUNITY_POOL_ITEMS);
  const freshDiagnostics = fresh && !loaded.cacheHit ? fresh : undefined;

  return {
    items: rescored,
    // RULING 68b. The cached-pool twin of the site above; both returns feed the
    // same facet panel, so converting one and not the other would make a pool
    // disagree with its own cache.
    facetCounts: countOpportunityFacets("jobs", rescored.map(withRenderedRemote)),
    fetched: freshDiagnostics?.fetched ?? {},
    errors: freshDiagnostics?.errors ?? {},
    beforeDedup:
      freshDiagnostics?.beforeDedup ?? loaded.pool.items.length,
    afterDedup:
      freshDiagnostics?.afterDedup ?? loaded.pool.items.length,
    startedAt,
    generatedAt: loaded.pool.generatedAt,
    localDate: loaded.pool.localDate,
    cacheHit: loaded.cacheHit,
  };
}

export async function runJobsPipeline(
  req: JobsFeedRequest,
  options: DailyJobPoolOptions = {},
): Promise<JobsFeedResponse> {
  const topN = req.topN ?? DEFAULT_OPPORTUNITY_TOP_N;
  const pool = await buildDailyJobPool(req, options);
  const scored = pool.items;
  // RULING 68b — AND THE ONE TRAP IN THE ITEM, WHICH B NAMED BEFORE C WROTE
  // IT. This call's return value is the row list that goes on to the scoring
  // floor and top-N, so it MUST return the ORIGINAL objects. A naive
  // `.map()` here would hand every downstream reader a rewritten `isRemote`
  // and corrupt the three DELIBERATE raw readers A22-03(b) protects — a real
  // regression wearing a tidy-up's clothes.
  //
  // So: filter on a PROJECTION, then re-select the originals by `id`. The
  // projection is thrown away the moment the id set is built.
  const facetFilteredIds = new Set(
    filterOpportunitiesByFacets(
      "jobs",
      scored.map(withRenderedRemote),
      req.facets,
    ).map((item) => item.id),
  );
  const facetFiltered = scored.filter((item) => facetFilteredIds.has(item.id));
  const beforeScoreFloor = facetFiltered.length;
  const aboveScoreFloor = hasActiveOpportunityFacets(req.facets)
    ? facetFiltered
    : facetFiltered.filter((item) => item.score >= MIN_SCORE);
  const afterScoreFloor = aboveScoreFloor.length;

  const excludeIds =
    req.excludeIds && req.excludeIds.length > 0 ? new Set(req.excludeIds) : null;
  const fresh = excludeIds
    ? aboveScoreFloor.filter((item) => !excludeIds.has(item.id))
    : aboveScoreFloor;
  const returned = fresh.slice(0, topN);
  const mappedPool = scored.map((item) =>
    scoredJobToJob(
      item,
      req.locationPreferences,
      req.authorisedCountries,
    ),
  );

  return {
    items: returned.map((item) =>
      scoredJobToJob(
        item,
        req.locationPreferences,
        req.authorisedCountries,
      ),
    ),
    pool: mappedPool,
    facetCounts: pool.facetCounts,
    meta: {
      fetched: pool.fetched,
      errors: pool.errors,
      beforeDedup: pool.beforeDedup,
      afterDedup: pool.afterDedup,
      beforeScoreFloor,
      afterScoreFloor,
      returned: returned.length,
      latencyMs: Date.now() - pool.startedAt,
      generatedAt: pool.generatedAt,
    },
  };
}

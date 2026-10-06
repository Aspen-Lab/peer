// The events feed pipeline — parallel to the paper and jobs pipelines:
// sources → dedup → Tier-0 scoring → selection → mapping. The curated
// sources (ccfddl, confs.tech, researchseminars) are keyless; eventweb adds
// profile-driven web discovery for non-CS disciplines when a search key is
// available, with LLM-refined queries when a provider resolves.

import { withSourceTimeout } from "@/lib/opportunities/shared";
import { enrichEventCandidates } from "@/lib/opportunities/enrich";
import {
  derivePoolCacheKey,
  getOrBuildCachedPool,
  isCachedEventPool,
  localCalendarDate,
  type OpportunityFacetCounts,
  type PoolCache,
} from "@/lib/opportunities/pool-cache";
import { getDefaultOpportunityPoolCache } from "@/lib/opportunities/pool-cache-runtime";
import {
  countOpportunityFacets,
  DEFAULT_OPPORTUNITY_TOP_N,
  filterOpportunitiesByFacets,
  hasActiveOpportunityFacets,
  MAX_OPPORTUNITY_POOL_ITEMS,
} from "@/lib/opportunities/facets";
import {
  generateSearchQueries,
  templateEventQueries,
} from "@/lib/opportunities/query-gen";
import { eventSources } from "./sources";
import { dedupEvents, dedupScoredEvents, mergeContainedEventNames } from "./dedup";
import { MIN_SCORE, scoreEvents } from "./scoring";
import type { EventScoringProfile } from "./scoring";
import { scoredEventToEvent } from "./mapper";
import type {
  EventsFeedRequest,
  EventsFeedResponse,
  EventsQuery,
  EventSourceId,
  RawEventItem,
  ScoredEventItem,
} from "./types";

const DEFAULT_PER_SOURCE_LIMIT = 80;

export interface EventsPipelineOptions {
  /**
   * Detail fetching belongs to the once-daily pool build, never the ordinary
   * request path. Phase 2 enables this only on a cache miss.
   */
  enrichDetails?: boolean;
}

export interface DailyEventPoolOptions {
  cache?: PoolCache;
  now?: Date;
}

export interface BuiltEventPool {
  items: ScoredEventItem[];
  facetCounts: OpportunityFacetCounts;
  fetched: Partial<Record<EventSourceId, number>>;
  errors: Partial<Record<EventSourceId, string>>;
  beforeDedup: number;
  afterDedup: number;
  startedAt: number;
  generatedAt: string;
  localDate: string;
  cacheHit: boolean;
}

function eventScoringProfile(
  req: EventsFeedRequest,
  includePreferenceLedger = true,
): EventScoringProfile {
  return {
    topics: req.topics,
    softTopics: req.softTopics,
    methods: req.methods,
    seedTexts: req.seedTexts,
    preferenceLedger: includePreferenceLedger
      ? req.preferenceLedger
      : undefined,
    locations: req.locationPreferences,
  };
}

export async function scoreEventPoolCandidates(
  deduped: RawEventItem[],
  scoringProfile: EventScoringProfile,
  now: number,
  options: EventsPipelineOptions = {},
): Promise<ScoredEventItem[]> {
  let scored = scoreEvents(deduped, scoringProfile, now, {
    applyFloor: false,
  });

  if (!options.enrichDetails || scored.length === 0) return scored;

  // `scored` already contains only candidates that passed the required-topic
  // gate and expiry checks. Enrich at most the top 40 of those survivors,
  // merge them back by id, then score the full deduped corpus again so dates
  // and locations affect ranking without changing the TF-IDF corpus.
  const enriched = await enrichEventCandidates(scored);
  const enrichedById = new Map(enriched.map((item) => [item.id, item]));
  scored = scoreEvents(
    deduped.map((item) => enrichedById.get(item.id) ?? item),
    scoringProfile,
    now,
    { applyFloor: false },
  );
  // A34-01 part 2 (round 35 B §2.2, Ruling 96a; wired round 35 C per Ruling
  // 97 after the withheld/POLICY interval): a cross-source duplicate (e.g.
  // one row's title states a parseable date, another's doesn't) can still
  // carry two different pre-enrichment `eventDedupKey`s that the FIRST dedup
  // pass (`dedupEvents`, called on the raw pool before this function ever
  // runs) cannot catch, because enrichment — which can recover the missing
  // date — has not happened yet at that point. Running the second pass HERE,
  // after stage 2 above, means every candidate it sees has ALREADY
  // individually survived `scoreEvents`' own expiry + required-topic gate,
  // so an expired sibling cannot structurally reach the merge — no
  // hand-rolled expiry predicate is needed, and none is written.
  scored = dedupScoredEvents(scored);
  // Round 36 B §3.2 / Ruling 100 (A35-01, Ruling 99b's "genuinely different
  // wording" duplicate class): a THIRD, additive pass at this same
  // structurally-safe site — contiguous-substring name containment with a
  // four-token floor and same-year gate, catching a cross-source pair whose
  // titles are not token-set-equal (so the key-based passes above can never
  // match them) but where one title's text is a genuine literal substring
  // of the other's. See dedup.ts for the full construction.
  scored = mergeContainedEventNames(scored);
  return scored;
}

async function buildEventPool(
  req: EventsFeedRequest,
  options: EventsPipelineOptions,
  now = new Date(),
  startedAt = Date.now(),
): Promise<BuiltEventPool> {
  const queryProfile = {
    topics: req.topics,
    softTopics: req.softTopics,
    careerStage: req.careerStage,
    industryVsAcademia: req.industryVsAcademia,
    locationPreferences: req.locationPreferences,
    currentProject: req.currentProject,
  };
  const queries =
    (req.aiTier ?? 0) >= 2
      ? await generateSearchQueries("events", queryProfile, req.llmOverride)
      : templateEventQueries(queryProfile);

  const query: EventsQuery = {
    topics: req.topics,
    queries,
    limit: req.perSourceLimit ?? DEFAULT_PER_SOURCE_LIMIT,
    // The reader's own Tavily key, when they turned the connector on and pasted
    // one. Peer funds no search of its own, so with no key `webSearch` carries
    // nothing and the web source is dark: the pipeline serves its free curated
    // feeds.
    webSearch: req.searchConnectors?.tavily?.enabled
      ? { tavilyApiKey: req.searchConnectors.tavily.apiKey }
      : undefined,
  };

  const active = eventSources.filter((source) => source.enabled(query));
  const results = await Promise.allSettled(
    active.map((source) => withSourceTimeout(source.id, source.fetch(query))),
  );

  const fetched: Partial<Record<EventSourceId, number>> = {};
  const errors: Partial<Record<EventSourceId, string>> = {};
  const allItems: RawEventItem[] = [];
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
  const deduped = dedupEvents(allItems);
  const scoredItems = await scoreEventPoolCandidates(
    deduped,
    eventScoringProfile(req, false),
    now.getTime(),
    options,
  );
  const items = scoredItems.slice(0, MAX_OPPORTUNITY_POOL_ITEMS);

  return {
    items,
    facetCounts: countOpportunityFacets("events", items),
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
export async function buildDailyEventPool(
  req: EventsFeedRequest,
  options: DailyEventPoolOptions = {},
): Promise<BuiltEventPool> {
  const now = options.now ?? new Date();
  const startedAt = Date.now();
  const cache = options.cache ?? getDefaultOpportunityPoolCache();
  const key = derivePoolCacheKey({
    surface: "events",
    requiredTopics: req.topics,
    exploreTopics: req.softTopics,
    careerStage: req.careerStage,
    locationPreferences: req.locationPreferences,
    now,
  });
  let fresh: BuiltEventPool | undefined;

  const loaded = await getOrBuildCachedPool(
    cache,
    key,
    isCachedEventPool,
    async () => {
      fresh = await buildEventPool(
        req,
        { enrichDetails: true },
        now,
        startedAt,
      );
      return {
        surface: "events",
        items: fresh.items,
        facetCounts: fresh.facetCounts,
        generatedAt: fresh.generatedAt,
        localDate: fresh.localDate,
      };
    },
  );

  // The daily cache owns source collection/enrichment, not the user's mutable
  // preference score. Re-score the retained candidates locally so a facet
  // signal can affect ranking without changing the cache key or doing network
  // work again.
  const rescored = scoreEvents(
    loaded.pool.items,
    eventScoringProfile(req),
    now.getTime(),
    { applyFloor: false },
  ).slice(0, MAX_OPPORTUNITY_POOL_ITEMS);
  const freshDiagnostics = fresh && !loaded.cacheHit ? fresh : undefined;

  return {
    items: rescored,
    facetCounts: countOpportunityFacets("events", rescored),
    // Source diagnostics are not part of the durable pool. On a hit, report
    // the retained pool size without pretending that sources ran again.
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

export async function runEventsPipeline(
  req: EventsFeedRequest,
  options: DailyEventPoolOptions = {},
): Promise<EventsFeedResponse> {
  const topN = req.topN ?? DEFAULT_OPPORTUNITY_TOP_N;
  const pool = await buildDailyEventPool(req, options);
  const scored = pool.items;
  const facetFiltered = filterOpportunitiesByFacets(
    "events",
    scored,
    req.facets,
  );
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
    scoredEventToEvent(item, req.locationPreferences),
  );

  return {
    items: returned.map((item) =>
      scoredEventToEvent(item, req.locationPreferences),
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

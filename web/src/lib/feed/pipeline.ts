import { bySourceId } from "@/lib/sources";
import type { SourceId, RawItem } from "@/lib/sources/types";
import { GEMINI_SOURCE_TIMEOUT_MS } from "@/lib/sources/gemini-search";
import {
  needsVertexSourceTimeout,
  webSearchOptions,
} from "@/lib/sources/vertex-search";
import { withSourceTimeout } from "@/lib/opportunities/shared";
import { scoreItems } from "@/lib/scoring";
import type { ScoredItem } from "@/lib/scoring/types";
import { dedupItems } from "./dedup";
import { applyTier1Rerank } from "./rerank";
import { applyRerankOrder, applyTier2Rerank } from "./tier2-rerank";
import { briefToSeedTexts, compileSearchBrief } from "./profile-compiler";
import type { FeedRequest, FeedResponse } from "./types";
import { fetchCitationNeighborhood } from "@/lib/affiliation/openalex";
import {
  derivePoolCacheKey,
  getOrBuildCachedPool,
  isCachedPaperPool,
  localCalendarDate,
  type PoolCache,
} from "@/lib/opportunities/pool-cache";
import { getDefaultOpportunityPoolCache } from "@/lib/opportunities/pool-cache-runtime";

const ACADEMIC_PAPER_SOURCES: SourceId[] = [
  "openalex",
  "semantic_scholar",
  "arxiv",
  "dblp",
  "pubmed",
];

const NON_PAPER_CONTEXT_SOURCES: SourceId[] = ["hn", "web"];

function defaultSources(): SourceId[] {
  return ACADEMIC_PAPER_SOURCES;
}

function shouldIncludeNonPaperResults(req: FeedRequest): boolean {
  return Boolean(
    req.sources?.some((source) => NON_PAPER_CONTEXT_SOURCES.includes(source)),
  );
}

export interface FeedPipelineOptions {
  cache?: PoolCache;
  now?: Date;
}

/**
 * Ceiling on candidates carried in one day's cached paper pool. Matches the
 * events/jobs pool ceiling: large enough that read-time re-ranking, journal
 * boosts and exclusions all have room to move, small enough that the cached
 * blob stays a reasonable size with abstracts attached.
 */
const MAX_PAPER_POOL_ITEMS = 200;

type SearchBriefFor = ReturnType<typeof compileSearchBrief>;

/** One local day's paper candidates, scored WITHOUT the preference ledger. */
interface BuiltPaperPool {
  items: ScoredItem[];
  aiOrder: string[];
  aiReasons: Record<string, string>;
  fetched: Partial<Record<SourceId, number>>;
  errors: Partial<Record<SourceId, string>>;
  beforeDedup: number;
  afterDedup: number;
  generatedAt: string;
  localDate: string;
}

/**
 * Everything a paper build PAYS for: every academic source fetch and, at Tier
 * 2, the LLM rerank. Called only on a cache miss, so it runs at most once per
 * (topic set, AI tier) per local day.
 *
 * **THE WEB-SEARCH DISCOVERY SIDE-CHANNEL USED TO RUN HERE AND IS GONE.** It
 * spent 4 searches a day turning web hits into "query boost" strings, and the
 * pipeline had ALREADY stopped feeding those strings back into the source
 * fetch — the boosts and their result count reached exactly one place, a
 * `connectorStats` field on the response that no component, store or route
 * ever read. Papers themselves have never come from it: they come from the
 * free academic sources below, which have no monthly ceiling.
 *
 * That made it 4 searches a day, per user, per topic set, bought against the
 * user's OWN Tavily plan (the key is theirs, not the server's), for a number
 * nothing displayed. Deleting it is the only change here that gives search
 * quota back, and it costs the surface nothing it was actually using.
 */
async function buildPaperPool(
  req: FeedRequest,
  brief: SearchBriefFor,
  requestedTier: 0 | 1 | 2,
  now: Date,
): Promise<BuiltPaperPool> {
  const sources = req.sources ?? defaultSources();
  const perSourceLimit = req.perSourceLimit ?? 60;
  const includeNonPaperResults = shouldIncludeNonPaperResults(req);

  // SUB-ITEM 8 / RULING 79c. Resolved ONCE so the timeout override below reads
  // the same value the fetch is given, rather than re-deriving the provider
  // from the same ternary in two places and inviting them to disagree.
  //
  // **NO TAVILY BRANCH. THE PAPER SURFACE DOES NOT SPEND THE USER'S TAVILY
  // QUOTA, AT ALL.** Events and jobs genuinely need web search — their
  // listings exist only on the open web. Papers do not: they come from the
  // five free academic sources, and the one Tavily channel this surface had
  // was deleted for buying a number nothing displayed. The optional `web`
  // source below is dark by product choice and, if it is ever turned back on,
  // runs on the server's own Vertex project rather than on a key the user
  // pays for.
  //
  // CREDIT MIGRATION — `webSearchOptions` prefers Vertex AI Search when a
  // Search App is configured and otherwise returns exactly what
  // `geminiWebSearchOptions` returned.
  const paperWebSearch = webSearchOptions(req.searchConnectors);

  const fetchPromise = Promise.allSettled(
    sources.map((s) =>
      withSourceTimeout(
        s,
        bySourceId[s].fetch({
          topics: req.topics,
          queries: brief.generatedQueries,
          methods: req.methods,
          venues: req.venues,
          avoid: brief.avoid,
          timeWindow: brief.timeWindow,
          limit: perSourceLimit,
          // RULING 75 — the Tavily branch is exactly as it shipped. The gemini
          // branch is what keeps the paper surface's web source alive with the
          // quota-capped providers suspended.
          //
          // **RULING 79c CLOSED ROUND 28 C's DISCLOSURE.** The 8 s wall above
          // is now overridable and the `web` source gets 25 s — see the
          // override argument below for the price and the evidence.
          webSearch: s !== "web" ? undefined : paperWebSearch,
        }),
        // SUB-ITEM 8 / RULING 79c — **THE PER-SOURCE OVERRIDE, AND IT IS THE
        // SAME SHAPE RULING 76a TOOK AT THE EVENTS AND JOBS CALL SITES.** Only
        // the `web` source, only on the gemini provider; every other paper
        // source keeps the 8 s it has always had.
        //
        // **WHY, ON A MEASUREMENT RATHER THAN A PRINCIPLE.** Round 29 B timed
        // two paper-shaped grounded searches through the shipped adapter:
        // **7541 ms** (survives 8000) and **11832 ms** (KILLED). So the paper
        // surface's web source was **not uniformly dead at 8 s — it was a coin
        // flip, which is worse.** A source that always fails is honest: the
        // surface reports zero fetched and renders empty on purpose. A source
        // that fails about half the time produces a paper surface **whose
        // contents depend on grounding latency on the day** — two runs of the
        // same profile minutes apart differ, with no error a reader sees and
        // nothing in the report saying so. That is a reproducibility defect on
        // the measured surface, and every future census of it inherits it.
        //
        // **THE PRICE, NAMED (79c accepted it):** `runFeedPipeline` is on a
        // REQUEST path and `Promise.allSettled` waits for the slowest settler,
        // so the paper surface's WORST CASE goes from about 8 s to about 25 s
        // for a user who is waiting. It is only ever paid when the web source
        // is genuinely slow — every other source settles earlier. The worst
        // case is bounded by the adapter's own 21 s soft deadline
        // (`GEMINI_SEARCH_BUDGET_MS`), which is why 25 s and not more: the
        // inner budget must stay UNDER the outer wall, and before this change
        // it was 2.6x OVER it.
        //
        // **FALSIFIER, FROM B:** if a paper-surface census still shows the web
        // source reporting zero fetched with a `source-timeout` reason after
        // this raise, the wall was not the binding constraint and something
        // else is.
        // Both server-Vertex providers need the raised wall, for different
        // reasons: grounding is slow in the search itself, vertex can spend the
        // time on its page-kind fetch and its grounding backfill.
        s === "web" && needsVertexSourceTimeout(paperWebSearch?.provider)
          ? GEMINI_SOURCE_TIMEOUT_MS
          : undefined,
      ),
    ),
  );

  // Advisor citation-neighborhood discovery, in parallel with the sources.
  // Always degrades to [] on any error (the helper is fully guarded).
  if (req.affiliation?.authorId) {
    console.log(
      `[affiliation] feed request includes advisor ${req.affiliation.authorId}, ${req.affiliation.seedWorkIds?.length ?? 0} seed work ids`,
    );
  }
  const affiliationPromise: Promise<RawItem[]> =
    req.affiliation?.authorId && (req.affiliation.seedWorkIds?.length ?? 0) > 0
      ? fetchCitationNeighborhood(req.affiliation.seedWorkIds!).catch(() => [])
      : Promise.resolve([]);

  const [fetchResults, affiliationItems] = await Promise.all([
    fetchPromise,
    affiliationPromise,
  ]);

  const fetched: Partial<Record<SourceId, number>> = {};
  const errors: Partial<Record<SourceId, string>> = {};
  const allItems: RawItem[] = [];

  fetchResults.forEach((result, i) => {
    const sourceId = sources[i];
    if (result.status === "fulfilled") {
      fetched[sourceId] = result.value.length;
      allItems.push(...result.value);
    } else {
      errors[sourceId] = String(result.reason);
      fetched[sourceId] = 0;
    }
  });

  // Merge advisor neighborhood papers into the candidate pool. They're OpenAlex
  // works, so they flow through dedup + scoring like any other source, and the
  // advisor seed-text bias (passed in seedTexts) floats the relevant ones up.
  if (affiliationItems.length > 0) {
    console.log(`[affiliation] +${affiliationItems.length} citation-neighborhood candidates merged`);
    allItems.push(...affiliationItems);
  }

  const beforeDedup = allItems.length;
  const paperItems = includeNonPaperResults
    ? allItems
    : allItems.filter((item) => ACADEMIC_PAPER_SOURCES.includes(item.source));
  const deduped = dedupItems(paperItems);
  const afterDedup = deduped.length;

  // NEUTRAL SCORING, AND IT IS THE WHOLE REASON ONE POOL CAN SERVE A WHOLE DAY.
  // `preferenceLedger` is deliberately absent here and supplied at read time
  // instead: bake a user's likes into the stored scores and every later read
  // that day would be ranked by a snapshot of their taste taken this morning.
  // The jobs pool makes the same split for the same reason.
  const scored = scorePaperCandidates(deduped, req, brief, false);

  const tier1Ranked = requestedTier >= 1 ? applyTier1Rerank(scored, brief) : scored;
  const tier2 = requestedTier >= 2
    ? await applyTier2Rerank(tier1Ranked, brief, req.llmOverride)
    : { items: tier1Ranked, orderedIds: [] as string[], reasons: {} };

  return {
    items: tier2.items.slice(0, MAX_PAPER_POOL_ITEMS),
    aiOrder: tier2.orderedIds,
    aiReasons: tier2.reasons,
    fetched,
    errors,
    beforeDedup,
    afterDedup,
    generatedAt: now.toISOString(),
    localDate: localCalendarDate(now),
  };
}

/** Shared by the build and every read, so the two cannot score differently. */
function scorePaperCandidates(
  items: RawItem[],
  req: FeedRequest,
  brief: SearchBriefFor,
  includePreferenceLedger: boolean,
): ScoredItem[] {
  const userNegativeTopics = req.negativeTopics ?? [];
  const policyAvoidTopics = brief.avoid.filter(
    (topic) => !userNegativeTopics.includes(topic),
  );
  return scoreItems(
    items,
    {
      topics: req.topics,
      methods: req.methods,
      venues: req.venues,
      seedTexts: briefToSeedTexts(req, brief),
      preferenceLedger: includePreferenceLedger
        ? req.preferenceLedger
        : undefined,
      negativeTopics: policyAvoidTopics,
      legacyNegativeTopics: userNegativeTopics,
      sourceWeights: req.sourceWeights,
    },
    req.weights,
  );
}

export async function runFeedPipeline(
  req: FeedRequest,
  options: FeedPipelineOptions = {},
): Promise<FeedResponse> {
  const startedAt = Date.now();
  const now = options.now ?? new Date();
  const brief = compileSearchBrief(req);
  const topN = req.topN ?? brief.controls.paperCount;
  const requestedTier = req.aiTier ?? feedTierFromEnv();
  const cache = options.cache ?? getDefaultOpportunityPoolCache();

  // THE AI TIER IS PART OF THE KEY, unlike on the events and jobs surfaces.
  // A Tier-2 pool carries an LLM ranking a Tier-0 pool does not have, so the
  // two are genuinely different payloads rather than the same pool viewed
  // differently — sharing one entry would mean whichever tier ran first that
  // day silently decided the other's ordering for the rest of the day. The
  // price is bounded and user-initiated: toggling the AI switch can cost one
  // extra paper build per day, and a paper build is 4 web searches.
  const key = derivePoolCacheKey({
    surface: "papers",
    requiredTopics: req.topics,
    exploreTopics: req.softTopics,
    aiTier: requestedTier,
    now,
  });

  let built: BuiltPaperPool | undefined;
  const loaded = await getOrBuildCachedPool(
    cache,
    key,
    isCachedPaperPool,
    async () => {
      built = await buildPaperPool(req, brief, requestedTier, now);
      return {
        surface: "papers",
        items: built.items,
        aiOrder: built.aiOrder,
        aiReasons: built.aiReasons,
        generatedAt: built.generatedAt,
        localDate: built.localDate,
      };
    },
  );
  const pool = loaded.pool;

  // ── READ-TIME RANKING. Everything below is local, deterministic and free, so
  // a user's likes, dismissals and preferred journals move today's pool without
  // re-fetching a source or re-spending an LLM token.
  const scored = scorePaperCandidates(pool.items, req, brief, true);
  // Runs at every tier, including 0. `applyTier1Rerank` is pure local
  // computation — weighted boosts plus a per-topic/per-author diversify pass,
  // no model call and no network — so it belongs to the floor that
  // PRODUCT_DIRECTION requires to work without keys. It was gated behind
  // `requestedTier >= 1`, and the client only ever sends 0 or 2
  // (`store/feed.ts`: `hasUserLlmOverride ? 2 : 0`), so for every user without
  // their own API key the diversify pass had never executed once and a single
  // author could take six of the ten slots.
  const tier1Ranked = applyTier1Rerank(scored, brief);
  // Replays the ranking the LLM produced when the pool was built. On a Tier-0
  // pool `aiOrder` is empty and this is a no-op.
  const aiRanked = applyRerankOrder(tier1Ranked, pool.aiOrder, pool.aiReasons);
  // Preferred-journal boost: applied LAST (after every rerank) so a paper
  // published in one of the user's preferred journals reliably floats up,
  // while an exceptionally strong non-journal match can still outrank it.
  const journalRanked = applyJournalBoost(aiRanked, req.venues ?? []);
  // Don't show items the caller already showed this user recently. Run
  // AFTER ranking so the score reflects the full candidate pool, but BEFORE
  // slicing so we still return `topN` fresh items.
  const excludeIds = req.excludeIds && req.excludeIds.length > 0
    ? new Set(req.excludeIds)
    : null;
  const fresh = excludeIds
    ? journalRanked.filter((item) => !excludeIds.has(item.id))
    : journalRanked;
  const returned = fresh.slice(0, topN);

  // Fetch diagnostics only exist for the request that actually built the pool.
  // A cache hit reports the pool's size rather than inventing source counts it
  // never saw — the same choice `buildDailyJobPool` makes.
  const diagnostics = !loaded.cacheHit ? built : undefined;

  return {
    items: returned,
    meta: {
      fetched: diagnostics?.fetched ?? {},
      errors: diagnostics?.errors ?? {},
      beforeDedup: diagnostics?.beforeDedup ?? pool.items.length,
      afterDedup: diagnostics?.afterDedup ?? pool.items.length,
      returned: returned.length,
      latencyMs: Date.now() - startedAt,
      generatedAt: pool.generatedAt,
      searchBrief: brief,
      aiTierUsed: requestedTier,
      llmProviderUsed:
        requestedTier >= 2
          ? (req.llmOverride?.provider ?? "default")
          : null,
    },
  };
}

// SUB-ITEM 8 / RULING 79c (round 29 C, item 6): this pipeline's PRIVATE
// `withSourceTimeout` WAS HERE. It was byte-identical to
// `opportunities/shared.ts`'s except for one thing that mattered — it hard-coded
// `TIMEOUT_MS = 8000` and took **no override parameter**, which is why Ruling
// 76a could be implemented at the events and jobs call sites as a single
// argument and could not be implemented here at all. Round 28 C flagged exactly
// that and carried it rather than widening it without a ruling.
//
// **Deleted, not parameterised.** B's recommendation, taken as given: importing
// the shared helper is what stops the three surfaces drifting apart again, and a
// second copy that merely GAINS a parameter would leave the drift one edit away.
// The two implementations were compared line by line before the deletion — same
// race, same error string, same `finally`-clause `clearTimeout` — so this is a
// substitution, not a behaviour change for any source that keeps the 8 s
// default.

// Papers from a preferred journal get +1/3 of their own relevance score.
const JOURNAL_BOOST_FACTOR = 4 / 3;

function normalizeVenue(s: string): string {
  return s
    .toLowerCase()
    .replace(/[.\-_/&]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Multiply the relevance score of items whose venue matches one of the user's
// preferred journals. Clamped to 1.0 to keep the 0–1 score contract; across the
// normal score range this still lets a much stronger non-journal match win.
function applyJournalBoost(items: ScoredItem[], journals: string[]): ScoredItem[] {
  const needles = journals.map(normalizeVenue).filter(Boolean);
  if (needles.length === 0) return items;

  let changed = false;
  const boosted = items.map((item) => {
    const venue = normalizeVenue(item.venue ?? "");
    if (!venue) return item;
    const isPreferred = needles.some(
      (n) => venue.includes(n) || n.includes(venue),
    );
    if (!isPreferred) return item;
    changed = true;
    const score = Math.min(1, item.score * JOURNAL_BOOST_FACTOR);
    return {
      ...item,
      score,
      scoreBreakdown: { ...item.scoreBreakdown, combined: score },
    };
  });

  // Only re-sort if at least one item actually moved.
  return changed ? boosted.sort((a, b) => b.score - a.score) : items;
}

function feedTierFromEnv(): 0 | 1 | 2 {
  const raw = Number(process.env.PEER_FEED_AI_TIER ?? "0");
  if (raw >= 2) return 2;
  if (raw <= 0) return 0;
  return 1;
}

import { createHash } from "node:crypto";
import { bySourceId } from "@/lib/sources";
import type { SourceId, RawItem } from "@/lib/sources/types";
import { GEMINI_SOURCE_TIMEOUT_MS } from "@/lib/sources/gemini-search";
import {
  needsVertexSourceTimeout,
  webSearchOptions,
} from "@/lib/sources/vertex-search";
import { withSourceTimeout } from "@/lib/opportunities/shared";
import { scoreItems } from "@/lib/scoring";
import { dropStale } from "./freshness";
import type { ScoredItem, FeedAdmissionChannel } from "@/lib/scoring/types";
import { dedupItems } from "./dedup";
import { applyTier1Rerank } from "./rerank";
import { applyRerankOrder, applyTier2Rerank } from "./tier2-rerank";
import { briefToSeedTexts, compileSearchBrief } from "./profile-compiler";
import type { FeedRequest, FeedResponse } from "./types";
import { fetchCitationNeighborhood } from "@/lib/affiliation/openalex";
import { fetchOpenAlexSemantic } from "@/lib/sources/openalex-semantic";
import { fetchOpenAlexTopicField } from "@/lib/sources/openalex-topic";
import { fetchSemanticScholarRecommendations } from "@/lib/sources/semantic-scholar-recommendations";
import {
  channelS2RecommendationsEnabled,
  channelOpenAlexSeedSimilarityEnabled,
  channelPositiveSeedCitationsEnabled,
  type ResolvedPositiveSeed,
} from "@/lib/preferences/positive-seeds";
import {
  derivePoolCacheKey,
  getOrBuildCachedPool,
  isCachedPaperPool,
  localCalendarDate,
  withCacheSingleFlight,
  type CachedPaperPool,
  type PoolCache,
  type SourceStatusEntry,
} from "@/lib/opportunities/pool-cache";
import {
  ephemeralPaperPoolCache,
  isTrustedPaperCacheScope,
  PrivatePaperPoolCache,
  type TrustedPaperCacheScope,
} from "@/lib/opportunities/private-paper-cache";
import { uploadInterestTerms } from "@/lib/preferences/ledger";
import { isDeliveredIdentity } from "@/lib/utils/canonical-identity";
import {
  firstAuthorSurnameOf,
  identityForRawItem,
  publishedYearOf,
} from "@/lib/feed/paper-identity";
import { getCounterStore, type CounterStore } from "@/lib/usage/counters";
import { MAX_SHADOW_CANDIDATES, type ShadowCandidate } from "@/lib/decisions/shadow";
import { fuseRankings, type RRFCandidate, type RRFChannelInput } from "@/lib/scoring/rrf";
import { topPositiveOpenAlexTopicIds } from "@/lib/preferences/topic-seeds";
import {
  PrivateChannelCandidateCache,
  type CachedChannelCandidates,
  type ChannelCacheGetResult,
  type ChannelCandidateCache,
  type ChannelLegStatus,
} from "@/lib/opportunities/channel-candidate-cache";

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

// P2-S4a (Round 3) — F-A-P2-04 (4b/4e), ABC-JEV-INTEGRATION.md §1p.B(3).
// Two more discovery channels: OpenAlex semantic search and OpenAlex
// topic/field exploration. Server-only, default OFF, read ONLY from
// `process.env` — deliberately NEVER a `FeedRequest` field, so nothing an
// HTTP caller sends can ever turn either one on (the same "server-minted
// only" convention `FeedRequest` already documents for `paperCacheScope`/
// `companySpendCapability`). Literal `"on"`, same parsing as
// `dashboardLedgerEnabled()` (web/src/lib/dashboard/ledger-flag.ts) —
// anything else (unset, "true", "1", a typo) keeps today's behaviour
// exactly: no fetch, no cost, no change to `allItems`. A dedicated flag
// file isn't in this slice's allowed-file list, so this mirrors that
// module's exact semantics inline rather than importing/extracting one.
function channelOpenAlexSemanticEnabled(): boolean {
  return process.env.PEER_CHANNEL_OPENALEX_SEMANTIC?.trim().toLowerCase() === "on";
}

function channelOpenAlexTopicEnabled(): boolean {
  return process.env.PEER_CHANNEL_OPENALEX_TOPIC?.trim().toLowerCase() === "on";
}

// P2-S6 (Round 3) — F-A-P2-05, ABC-JEV-INTEGRATION.md §1p.B(1) and the
// P2-S6 RULING (§4). Reciprocal rank fusion over the build-time channels
// (see `buildRRFChannels` below). Same "on"-literal convention as every
// other flag in this file. Ships flag-OFF: the default flips only after P5
// evaluation sign-off (§1p.B(1)) — flag off means `buildRRFChannels`/
// `fuseRankings` are never even called (see the call site below), not just
// that their result is discarded, so there is no RRF computation at all and
// output stays byte-identical to before this slice.
function rankFusionEnabled(): boolean {
  return process.env.PEER_RANK_FUSION?.trim().toLowerCase() === "on";
}

/** Provenance shape stored per item — mirrors `FeedMeta.rrf`'s entry shape exactly (feed/types.ts), so threading `BuiltPaperPool.rrf` straight into `meta.rrf` needs no reshaping. */
interface RRFItemProvenance {
  fusedScore: number;
  channels: { channel: string; rank: number }[];
}

// P2-S6-FIX (Round 3) — F-A-P2S6-01, docs/jev-abc/P2-S6-A-20260924T145415Z.md
// NEW FINDING #1. `year`/`authors` must be forwarded onto the RRF candidate
// below using the SAME derivation `dedup.ts` uses, or RRF's own weak-link
// tier (title+year+first-author, `clusterCanonicalWorks`) could never fire
// for a candidate `toRRFCandidate` built — `RRFCandidate.year`/`.authors`
// were always omitted — even though dedupe's OWN clustering, fed these same
// two fields correctly all along, could and does weak-link the identical
// pair. See `pipeline.rrf.test.ts`'s "weak-link channel-balance matches
// dedupe" block for the reproduction. R3-CLEANUP-3 (ABC-JEV-INTEGRATION.md
// §4 Round 3 "DEDUP-FIX fresh A: FAILED_REVIEW... narrowed conflict rule
// ruled", 2026-09-24T21:21:36Z): this file used to carry its own private
// byte-for-byte mirror of `dedup.ts`'s `publishedYearOf`/
// `firstAuthorSurnameOf` (kept in sync "by inspection," since at the time
// dedup.ts exported neither) — both are now imported from
// `@/lib/feed/paper-identity`, the one shared implementation `dedup.ts` and
// `channel-comparison.ts` also use, so the "stay in sync by inspection" risk
// this comment used to warn about no longer exists.

/**
 * A RawItem's identity fields in the shape `@/lib/scoring/rrf`'s
 * `RRFCandidate` needs — never rank/order, which the caller (position in
 * its query array) already supplies. `year`/`authors` are forwarded using
 * the SAME shared helpers `dedup.ts` uses (`@/lib/feed/paper-identity`'s
 * `publishedYearOf`/`firstAuthorSurnameOf`), so RRF's weak-link tier behaves
 * identically to dedupe's for the same input — a candidate with no shared
 * id-form key across the channels that found it can still fuse into one
 * work here exactly as it already merges into one survivor there, instead
 * of silently splitting its vote (F-A-P2S6-01).
 */
function toRRFCandidate(item: RawItem): RRFCandidate {
  const surname = firstAuthorSurnameOf(item.authors);
  return {
    source: item.source,
    id: item.id,
    doi: item.metadata?.doi,
    title: item.title,
    externalIds: item.metadata?.externalIds,
    year: publishedYearOf(item.publishedAt),
    authors: surname ? [surname] : undefined,
  };
}

/**
 * P2-S6 — one retrieval path = one RRF channel (the P2-S6 RULING's own
 * definition): each academic source's own already-query-folded result array
 * (every adapter fans out its synonym queries internally and returns one
 * merged, ordered list — confirmed by reading every adapter's `fetchImpl`;
 * no adapter edit needed, and no per-channel signature change either, which
 * is what this slice's own STOP condition would have required otherwise),
 * plus "citation" (advisor neighbourhood), "semantic" (OpenAlex semantic
 * search) and "topic-field" (OpenAlex topic filter) for the three
 * non-source channels `buildPaperPool` also fetches. Deliberately excludes
 * the 3 READ-TIME positive-seed channels and rollover candidates — both are
 * fetched later, outside `buildPaperPool` entirely, and RULING point 6
 * scopes this fix to "build-time channels" only (documented gap, revisit
 * with P2-S4d). An empty/failed source contributes an empty query array,
 * which `fuseRankings` already defines as "contributes nothing" — no
 * special-casing needed here.
 *
 * P2-S4c-1 (Round 3) — the topic-field channel used to be listed here too,
 * but it was ALWAYS a dead, unreachable branch (`topicIds` was hardcoded
 * `[]` in `buildPaperPool`, so `topicFieldItems` could never be non-empty in
 * production — see this slice's checkpoint). Retiring the build-time
 * scaffold (docs/jev-abc/P2-S4c-B-20260924T113605Z.md Section B point 3,
 * manager ruling 2) moves `openalex_topic` OUT of the build-time bucket this
 * function covers entirely: it is now one of the four READ-TIME channels
 * (see `fetchChannelLegs`/`resolveChannelCandidates` below), fetched AFTER
 * `buildPaperPool` returns, so it was never a candidate for RRF fusion to
 * begin with (RULING point 6 above already scoped RRF to "build-time
 * channels" only, and read-time channels/rollover are a documented gap).
 */
function buildRRFChannels(
  sources: SourceId[],
  fetchResults: PromiseSettledResult<RawItem[]>[],
  affiliationItems: RawItem[],
  semanticItems: RawItem[],
): RRFChannelInput[] {
  const sourceChannels: RRFChannelInput[] = sources.map((sourceId, i) => {
    const result = fetchResults[i];
    const items = result.status === "fulfilled" ? result.value : [];
    return { channel: sourceId, queries: [items.map(toRRFCandidate)] };
  });
  return [
    ...sourceChannels,
    { channel: "citation", queries: [affiliationItems.map(toRRFCandidate)] },
    { channel: "semantic", queries: [semanticItems.map(toRRFCandidate)] },
  ];
}

/**
 * P2-S6 RULING points 2/3 — reorders the ALREADY-deduped, already-Tier-1-
 * ranked candidate set into RRF's fused order, without changing WHICH items
 * are in it or any item's own `score`/`scoreBreakdown` (dedupe, dropStale
 * and `scorePaperCandidates` all ran already and are untouched — RULING
 * point 6, "nothing else changes"). This one substitution is what makes
 * BOTH ruling points true at once: the caller uses the returned `ranked`
 * array everywhere it used to use `tier1Ranked` for judgment-shortlist and
 * pool-membership purposes (the `<=50` slice to Tier-2/the shadow hook, and
 * the final `MAX_PAPER_POOL_ITEMS` truncation, which is simply `tier2.items`
 * downstream of whichever array was reranked) — both become "RRF top N"
 * automatically, with no separate membership-cut code needed.
 *
 * Matching is by canonical identity (`identityForRawItem`, the same P2-S1
 * helper dedupe/ledger-exclusion use), checked against the RRF result's own
 * key first, then every alias — so a dedupe survivor whose OWN key differs
 * from the specific pre-merge channel copy `fuseRankings` saw (e.g. it won
 * survivor selection under its arXiv id, but only its DOI-form copy was fed
 * to a channel) still matches via `mergedAliases`. An item with no match at
 * all (should only happen for a candidate whose sole channel was somehow
 * excluded from `rrfChannels` — not possible with today's wiring, since
 * every channel `buildPaperPool` fetches is included) is appended AFTER
 * every RRF-matched item, in its original Tier-1 relative order — a real
 * candidate is never dropped by this reorder, only ranked conservatively
 * last.
 */
function applyRRFOrder(
  tier1Ranked: ScoredItem[],
  rrfChannels: RRFChannelInput[],
): { ranked: ScoredItem[]; provenanceByItemId: Record<string, RRFItemProvenance> } {
  const fused = fuseRankings(rrfChannels);

  const itemByCanonicalId = new Map<string, ScoredItem>();
  for (const item of tier1Ranked) {
    const identity = identityForRawItem(item);
    if (!itemByCanonicalId.has(identity.key)) itemByCanonicalId.set(identity.key, item);
    for (const alias of identity.aliases) {
      if (!itemByCanonicalId.has(alias)) itemByCanonicalId.set(alias, item);
    }
  }

  const matchedIds = new Set<string>();
  const provenanceByItemId: Record<string, RRFItemProvenance> = {};
  const rrfOrdered: ScoredItem[] = [];
  for (const result of fused) {
    const item = itemByCanonicalId.get(result.key);
    // `fused` is already sorted best-to-worst, so the FIRST RRF entry that
    // resolves to a given survivor is always its best-scored one — no extra
    // bookkeeping needed to prefer a higher score on a duplicate match.
    if (!item || matchedIds.has(item.id)) continue;
    matchedIds.add(item.id);
    rrfOrdered.push(item);
    provenanceByItemId[item.id] = { fusedScore: result.fusedScore, channels: result.channels };
  }
  const unranked = tier1Ranked.filter((item) => !matchedIds.has(item.id));

  return { ranked: [...rrfOrdered, ...unranked], provenanceByItemId };
}

export interface FeedPipelineOptions {
  cache?: PoolCache;
  now?: Date;
  /**
   * P4-S2 (Round 3) — F-A-P4-01, ABC-JEV-INTEGRATION.md §1p.A/§1p.F. Every
   * canonical key AND alias this owner's dashboard ledger already considers
   * delivered (acknowledged deliveries plus served-but-unacknowledged
   * batches — see web/src/lib/dashboard/delivery-ledger.ts). Server-minted
   * only: the route reads it from the ledger for a signed-in owner and
   * passes it here — it is NEVER part of `FeedRequest`, so it can never be
   * populated from an HTTP body or query string (same idiom as
   * `paperCacheScope`/`companySpendCapability` on FeedRequest). Absent (the
   * default) means no ledger was consulted — every caller that doesn't pass
   * it (every existing test, the digest/test-digest routes) gets output
   * byte-identical to before this option existed.
   */
  ledgerExclusions?: ReadonlySet<string>;
  /**
   * P2-S2-FIX (Round 3) — F-A-P2S2-01, ABC-JEV-INTEGRATION.md §1p.B(2). The
   * store `retryFailedSources` claims a degraded source's retry attempt
   * against before it fetches (see that function's own doc comment for
   * why an in-process single-flight alone isn't enough). Defaults to the
   * real shared store (`getCounterStore()` — Supabase when configured, the
   * labelled in-memory fallback otherwise), exactly the same "defaults to
   * the real thing, tests may substitute their own" shape `now` already
   * has on this options object: every caller that omits it talks to the
   * SAME store production already uses for rate limits and breakers, and a
   * test can inject a fresh one to make a claim deterministic or a shared
   * one to simulate two server instances, or a fake to simulate an outage.
   */
  counterStore?: CounterStore;
  /**
   * P4-S6 (Round 3) — ABC-JEV-INTEGRATION.md §1g/§1p.C.4, DESIGN §6 of
   * docs/jev-abc/P4-B-20260924T0338Z.md. Never-delivered candidates carried
   * forward from a PRIOR day's final pool (see
   * web/src/lib/dashboard/rollover-store.ts), supplied by route.ts only for
   * a signed-in owner's mint. Merged into the candidate set at read time,
   * BEFORE dropStale/scoring/reranking — see the merge site below for why
   * that placement is what makes "exactly the same eligibility as new
   * candidates, no special boost or penalty" true by construction rather
   * than by convention. Never written back to the pool cache: this is a
   * per-request, per-owner augmentation of a specific read, not a fact
   * about the shared day-pool. Absent (the default) costs nothing and
   * changes nothing — every existing caller that doesn't pass it sees
   * output byte-identical to before this option existed.
   */
  rolloverCandidates?: readonly RawItem[];
  /**
   * P4-S6 (Round 3) — ABC-JEV-INTEGRATION.md §1g "up to 30 remain unshown".
   * When true, the result additionally carries `finalPool` (see
   * `FeedPipelineResult`): the top FINAL_POOL_SIZE ranked-and-excluded
   * candidates for today, a strict superset of `items` (topN is always <=
   * FINAL_POOL_SIZE — the display count is 5 or 10, schema.sql's
   * `paper_count in (5,10)`). Opt-in, mirroring `ledgerExclusions`/
   * `counterStore` above, for one specific reason those two don't share:
   * `runLedgerAwareFeed` in route.ts sometimes returns a caller's raw
   * `runFeedPipeline` result DIRECTLY as the HTTP response body (the
   * flag-off/no-owner-scope pass-through path). If `finalPool` were
   * unconditionally attached, that path would leak a whole ranked-candidate
   * list — including papers never actually shown — into the client
   * response. Gating it behind an explicit opt-in that only the
   * owner-scoped mint path (which never forwards the raw result directly;
   * see route.ts's frozenFeedResponse) ever sets makes that leak
   * structurally impossible rather than reliant on route.ts remembering to
   * strip a field.
   */
  includeFinalPool?: boolean;
  /**
   * P2-S4b (Round 3) — F-A-P2-04 (4c/4d), ABC-JEV-INTEGRATION.md §1p.B(5).
   * A signed-in owner's recently-resolved POSITIVE feedback seeds (Save,
   * "More like this" — `preferences/positive-seeds.ts`'s
   * `resolvePositiveSeeds`), supplied by route.ts ONLY for a signed-in
   * owner when at least one positive-seed channel flag is on. Drives three
   * of the four read-time channels (S2 recommendations, OpenAlex
   * seed-similarity, citation neighbours of these seeds — see
   * `resolveChannelCandidates`/`fetchChannelLegs` below; the 4th,
   * topic-field, is driven by `req.preferenceLedger` instead, P2-S4c-1),
   * each independently flag-gated.
   *
   * Server-minted only, exactly like `ledgerExclusions`/`rolloverCandidates`
   * above: never a `FeedRequest` field, so nothing an HTTP caller sends can
   * ever supply or enable these channels (mirrors the same "server-minted
   * only" convention `FeedRequest` already documents for `paperCacheScope`/
   * `companySpendCapability`).
   *
   * **Deliberately read-time only, like `rolloverCandidates`, and for a
   * related but distinct reason (see this slice's checkpoint DESIGN
   * CHOICES): `opportunities/pool-cache.ts`'s `derivePoolCacheKey` has NO
   * seed-derived component and is outside this slice's allowed-file list,
   * so a build-time fetch here would either bake a stale seed snapshot into
   * the persisted per-day pool (wrong the moment the owner's seeds change
   * again that day) or require a cache-key change this slice cannot make.**
   * Never written back via `cache.set` — a per-request, per-owner
   * augmentation of THIS read, never a fact about the shared day-pool,
   * exactly like `rolloverCandidates`. Absent (the default) costs nothing
   * and changes nothing — every existing caller that doesn't pass it sees
   * output byte-identical to before this option existed.
   */
  positiveSeeds?: readonly ResolvedPositiveSeed[];
  /**
   * P2-S4b-FIX (Round 3) — ABC-JEV-INTEGRATION.md §1p.B(5): "'Not
   * interested' supplies negative seeds." Bare Semantic Scholar paper ids
   * (`preferences/positive-seeds.ts`'s `resolveNegativeSeedPaperIds`),
   * server-minted only exactly like `positiveSeeds` above. The ONLY
   * consumer today is the S2 Recommendations leg
   * (`fetchS2RecommendationsLeg`'s `negativePaperIds` on that request) —
   * OpenAlex seed-similarity and citation-neighbours have no
   * negative-example concept in this codebase. Has no effect at all
   * without at least one POSITIVE seed too: S2's Recommendations API needs
   * a positive example to recommend from, so that leg contributes nothing
   * when `positiveSeeds` is empty regardless of this option. Absent
   * (the default) costs nothing and changes nothing.
   *
   * P5-S2 fresh A / ABC-JEV-INTEGRATION.md §4 "S2 pre-flip conflict rule
   * folded into P2-S4c+d": an id present in BOTH this list and a resolved
   * seed's own `s2PaperId` is sent as NEITHER (see
   * `fetchS2RecommendationsLeg`) — conservative, needs no cross-record
   * recency.
   */
  negativeSeedPaperIds?: readonly string[];
  /**
   * P3-S5 (Round 3) — ABC-JEV-INTEGRATION.md §4 "P3-S5 DESIGN RULING"
   * (2026-09-24T11:29:31Z), superseding docs/jev-abc/P3-B-20260924T0525Z.md
   * DESIGN §6's original build-time-call proposal where the two differ: the
   * Jev shadow runs AFTER the response is sent (route.ts schedules it with
   * Next's `after()`), never inside the request. This option is the ONLY
   * seam that connects the two: invoked ONLY when THIS request's own call to
   * `buildPaperPool` actually ran (a genuine cache miss — never on a cache
   * hit, and never from the P2-S2 `retryFailedSources` path, which has its
   * own separate rescore logic and never calls `buildPaperPool` at all — see
   * that function's own call site below), with a COPY of the top
   * `MAX_SHADOW_CANDIDATES` Tier-1-ranked candidates, taken BEFORE Tier 2
   * reranks or truncates anything (RRF-agnostic per DESIGN §7: today this is
   * Tier-1's own ranking; once P2's RRF lands behind its own flag, this
   * becomes RRF's fused output with no change needed here). The pipeline
   * never awaits this call and wraps it in try/catch, so a throwing hook can
   * never change the built pool or crash the request — see `buildPaperPool`.
   * `route.ts` is the only caller that ever supplies one, and only for a
   * signed-in, entitled, `aiTier>=2` POST request with the shadow+broker
   * flags on and the broker configured; every other caller (GET,
   * dispatch-digests, test-digest, every pre-existing test) omits it and
   * sees output byte-identical to before this option existed
   * (`pipeline.shadow.test.ts` is the regression net for that claim).
   */
  onFreshShortlist?: (shortlist: ReadonlyArray<ShadowCandidate>) => void;
  /**
   * P2-S4d (Round 3) — F-M-P2-02. The owner-scoped store for the four
   * read-time channels' cached combined result (see
   * `resolveChannelCandidates`). Mirrors `cache` above's own optionality
   * exactly: every caller that omits it gets the real thing
   * (`new PrivateChannelCandidateCache(privateScope)`, constructed only
   * when a trusted scope actually exists — never for an anonymous
   * request), and a test may inject its own (`MemoryChannelCandidateCache`,
   * or a spied real instance) to make the cached path deterministic or to
   * simulate an outage.
   */
  channelCandidateCache?: ChannelCandidateCache;
}

/**
 * P4-S6 (Round 3) — runFeedPipeline's actual return shape, a strict
 * superset of the public `FeedResponse` HTTP contract
 * (web/src/lib/feed/types.ts). `finalPool` is deliberately NOT added to
 * `FeedResponse` itself: that type is what every route handler in this
 * codebase eventually hands to `NextResponse.json(...)` (see
 * web/src/app/api/feed/route.ts's flag-off/no-owner-scope pass-through
 * path, which forwards a caller's raw runFeedPipeline result AS the HTTP
 * body) — keeping `finalPool` off that type means a future edit to this
 * file cannot accidentally widen the client-facing contract just by adding
 * a field here; a caller that wants it has to explicitly widen through
 * THIS type instead.
 */
export interface FeedPipelineResult extends FeedResponse {
  finalPool?: ScoredItem[];
}

/**
 * Ceiling on candidates carried in one day's cached paper pool. Matches the
 * events/jobs pool ceiling: large enough that read-time re-ranking, journal
 * boosts and exclusions all have room to move, small enough that the cached
 * blob stays a reasonable size with abstracts attached.
 */
const MAX_PAPER_POOL_ITEMS = 200;

/**
 * P4-S6 (Round 3) — F-A-P4-08, ABC-JEV-INTEGRATION.md §1g ("up to 30
 * remain unshown") / §1p.C.4, acceptance 17. The curated "final pool" the
 * rollover mechanism (web/src/lib/dashboard/rollover-store.ts) operates on:
 * the top FINAL_POOL_SIZE fully-ranked, fully-excluded candidates for
 * today — a fixed, named mid-tier between the raw `MAX_PAPER_POOL_ITEMS`
 * fetch ceiling above and the `topN` display slice, distinct from both.
 * Configurable in the sense that it's a single named constant a future
 * change can move in one place, not a magic number repeated at each call
 * site.
 */
const FINAL_POOL_SIZE = 30;

type SearchBriefFor = ReturnType<typeof compileSearchBrief>;

/**
 * P2-S4a-FIX (Round 3) — F-A-P2S4a-02, ABC-JEV-INTEGRATION.md §1p.B(2)/(3).
 * Stable names for the 5 new discovery channels' truthful failure reporting
 * (docs/jev-abc/P2-S4a-A-20260924T100013Z.md NEW FINDING #2). Neither
 * `SourceId` (`sources/types.ts`) nor `FeedMeta.errors`/
 * `CachedPaperPool.sourceStatus`'s key types (`feed/types.ts`,
 * `opportunities/pool-cache.ts`) can be edited by this slice (outside the
 * allowed-file list), so this is a LOCAL widening: every `errors`/
 * `sourceStatus` map inside this file is typed `SourceId | FeedChannelId`
 * from here on, which stays structurally assignable both ways against the
 * narrower external `Partial<Record<SourceId, ...>>` types (`Partial<>`
 * makes every extra/missing key acceptable in either direction) — confirmed
 * by `tsc --noEmit`, not just reasoned through.
 *
 * P2-S4c-2 (Round 3) — docs/jev-abc/P2-S4c-B-20260924T113605Z.md Section C,
 * ABC-JEV-INTEGRATION.md §4 "P2-S4c B complete" ruling (4). `"affiliation_
 * citation"` is a 6th member: the ADVISOR citation-neighbourhood channel
 * (`req.affiliation`-driven), kept clearly distinct from `"seed_citations"`
 * (the user's OWN positive-seed citation-neighbourhood channel, below) —
 * two different citation sources, advisor-seeded vs. user-seeded.
 *
 * Exported (only this slice's addition needs to cross a file boundary — see
 * `opportunities/channel-candidate-cache.ts`, which imports this as a type
 * only, so there is no runtime circular dependency between the two files).
 */
export type FeedChannelId =
  | "openalex_semantic"
  | "openalex_topic"
  | "s2_recommendations"
  | "openalex_seed_similarity"
  | "seed_citations"
  | "affiliation_citation";

/** One local day's paper candidates, scored WITHOUT the preference ledger. */
interface BuiltPaperPool {
  items: ScoredItem[];
  aiOrder: string[];
  aiReasons: Record<string, string>;
  fetched: Partial<Record<SourceId, number>>;
  errors: Partial<Record<SourceId | FeedChannelId, string>>;
  /**
   * P2-S2 — see `CachedPaperPool.sourceStatus`'s own doc comment.
   * P2-S4a-FIX — ALSO carries an entry for `openalex_semantic` when its own
   * flag is on.
   * P2-S4c-2 — ALSO carries an entry for `affiliation_citation` when an
   * advisor is actually configured (authorId + at least one seed work id).
   * P2-S4c-1 — `openalex_topic` moved OUT of this pool-level map: it is now
   * a read-time channel, tracked in its own per-owner cache instead (see
   * `ChannelCandidateCache`/`resolveChannelCandidates`), exactly like the
   * three read-time positive-seed channels below (see
   * `fetchChannelLegs`, which are never part of THIS cached pool at all).
   * `everySourceFailed` below explicitly scopes itself to
   * `ACADEMIC_PAPER_SOURCES` so a channel entry sharing this same map can
   * never affect that verdict, and `retryFailedSources`'s own
   * `ACADEMIC_PAPER_SOURCES.includes(...)` filter means a channel entry is
   * never retried here (channel legs get their OWN, separate P2-S2-style
   * retry inside `resolveChannelCandidates`).
   */
  sourceStatus: Partial<Record<SourceId | FeedChannelId, SourceStatusEntry>>;
  beforeDedup: number;
  afterDedup: number;
  generatedAt: string;
  localDate: string;
  /**
   * P2-S6 — set only when `rankFusionEnabled()` is true, keyed by item id.
   * See `FeedMeta.rrf`'s own doc comment (feed/types.ts) for the full
   * contract; this is that same data before it reaches the HTTP response.
   */
  rrf?: Record<string, RRFItemProvenance>;
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
// P2-S3 (Round 3) — F-A-P2-03, ABC-JEV-INTEGRATION.md §1c/§1p.A/G. Tags each
// item with the channel that admitted it, ON THE ITEM rather than on the
// request — see `RawItem.admissionChannels`'s own doc comment
// (`@/lib/sources/types.ts`) for why a request-scoped tag would not survive
// a read-time rescore on a cache hit or the scheduled-digest path. Additive
// and idempotent: an item already carrying this exact channel (e.g. a
// retried fetch of the same source) is left alone rather than getting a
// duplicate entry. Leaves a clear seam for the channels P2-S4 adds
// (semantic / positive-seed / topic-field) to tag the same way.
function tagAdmissionChannel(
  items: RawItem[],
  channel: FeedAdmissionChannel,
): RawItem[] {
  return items.map((item) =>
    item.admissionChannels?.includes(channel)
      ? item
      : {
          ...item,
          admissionChannels: [...(item.admissionChannels ?? []), channel],
        },
  );
}

async function buildPaperPool(
  req: FeedRequest,
  brief: SearchBriefFor,
  requestedTier: 0 | 1 | 2,
  now: Date,
  // P3-S5 — see FeedPipelineOptions.onFreshShortlist's own doc comment.
  // Threaded in as a plain parameter (not the whole options object) to keep
  // this function's existing signature narrow and additive.
  onFreshShortlist?: (shortlist: ReadonlyArray<ShadowCandidate>) => void,
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
  //
  // ABC-freemium 1-05 · R-KEY-3 · D3 — **a hard `false`, and it is permanent.**
  // D3 says the papers surface costs zero paid search. It is not just policy:
  // `webSearchOptions` returns `{ provider }` and never a `tavilyApiKey`, and
  // `store/feed.ts` sends no `searchConnectors` for papers at all, so a user's
  // own Tavily key cannot reach this surface. The only key it could ever spend
  // is the operator's — for every plan, paid included. Combined with **D2a**'s
  // Vercel bans on Tavily, Brave and the Vertex/Gemini search names, the papers
  // `web` source returns `[]` in production. That is D3 working as written.
  //
  // ABC-freemium 5-04 — under D2a this hard `false` is now the shape EVERY
  // surface has, not a papers-only rule: the entitlement's `systemSearchAllowed`
  // is permanently `false` too. This line stays because it is the surface's own
  // statement of D3 and does not depend on the entitlement being false.
  const paperWebSearch = {
    ...webSearchOptions(req.searchConnectors, req.companySpendCapability),
    systemSearchAllowed: false,
  };

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
  // P2-S4c-2 (Round 3) — F-M-P2-02's sibling finding (docs/jev-abc/
  // P2-S4c-B-20260924T113605Z.md Section C). This gate decides BOTH whether
  // a real fetch is attempted AND (below) whether this channel's status is
  // reported at all — "authorId present" alone is not enough: an advisor
  // configured with zero seed works must be reported as "not attempted",
  // never mis-reported as empty/failed.
  const affiliationAttempted =
    Boolean(req.affiliation?.authorId) && (req.affiliation?.seedWorkIds?.length ?? 0) > 0;
  // Same failure-capture shape as `semanticError` below — the item list
  // still degrades to `[]` exactly as before (every existing
  // caller of this channel already tolerates that), but the caller can now
  // report the truth alongside it instead of discarding it completely.
  let affiliationError: string | undefined;
  const affiliationPromise: Promise<RawItem[]> = affiliationAttempted
    ? fetchCitationNeighborhood(req.affiliation!.seedWorkIds!).catch((err) => {
        affiliationError = err instanceof Error ? err.message : String(err);
        return [];
      })
    : Promise.resolve([]);

  // P2-S4a (Round 3) — F-A-P2-04 (4b), same shape as `affiliationPromise`
  // above: own timeout (inside the adapter), `.catch(() => [])` so a
  // failure degrades instead of breaking Tier 0, off unless the server env
  // flag is literally "on". Query text is "project-first" — project text
  // carries the most signal, so it goes first and survives the adapter's
  // own deterministic 2,000-char truncation before challenge/topics/
  // generated queries do.
  const semanticEnabled = channelOpenAlexSemanticEnabled();
  const semanticQueryText = semanticEnabled
    ? [brief.project, brief.challenge, brief.coreTopics.join(" "), brief.generatedQueries.join(" ")]
        .filter(Boolean)
        .join(". ")
    : "";
  // P2-S4a-FIX (Round 3) — F-A-P2S4a-02. Capture the failure (if any) in a
  // closure variable rather than swallowing it silently — the item list
  // still degrades to `[]` exactly as before, but the caller below can now
  // report the truth alongside it.
  let semanticError: string | undefined;
  const semanticPromise: Promise<RawItem[]> = semanticEnabled
    ? fetchOpenAlexSemantic(semanticQueryText).catch((err) => {
        semanticError = err instanceof Error ? err.message : String(err);
        return [];
      })
    : Promise.resolve([]);

  // P2-S4c-1 (Round 3) — the build-time OpenAlex topic/field scaffold that
  // used to live here (a hardcoded `topicIds: string[] = []`, permanently
  // unreachable — F-A-P2-04 4e) is RETIRED, per docs/jev-abc/
  // P2-S4c-B-20260924T113605Z.md Section B point 3 / manager ruling 2: a
  // permanently-dead branch sitting beside a real one, both gated by the
  // same-looking flag, is a latent confusion/regression risk in a file this
  // actively edited. `openalex_topic` is now a READ-TIME channel (see
  // `fetchChannelLegs`/`resolveChannelCandidates` below), resolving real ids
  // from the signed-in owner's own `preferenceLedger` — never baked into
  // this shared per-day pool, exactly like the other three read-time
  // channels (P2-S4b) and for the same reason (see `scorePaperCandidates`'s
  // own "NEUTRAL SCORING" comment below). `sources/openalex-topic.ts` itself
  // is unchanged and untouched by this slice.

  const [fetchResults, affiliationItems, semanticItems] =
    await Promise.all([fetchPromise, affiliationPromise, semanticPromise]);

  // P2-S6 — gathered here, right where every channel's own raw,
  // per-channel-ordered array first becomes available, and consumed after
  // Tier-1 reranking below (see `rankedForJudgment`). Built ONLY when the
  // flag is on: `rankFusionEnabled()` is checked once here rather than
  // inside `buildRRFChannels`, so a flag-off build never even constructs
  // the per-channel candidate arrays, let alone calls `fuseRankings` — "no
  // RRF computation at all" when off, not just an unused result.
  const rrfChannels: RRFChannelInput[] = rankFusionEnabled()
    ? buildRRFChannels(sources, fetchResults, affiliationItems, semanticItems)
    : [];

  const fetched: Partial<Record<SourceId, number>> = {};
  const errors: Partial<Record<SourceId | FeedChannelId, string>> = {};
  const allItems: RawItem[] = [];

  fetchResults.forEach((result, i) => {
    const sourceId = sources[i];
    if (result.status === "fulfilled") {
      fetched[sourceId] = result.value.length;
      // P2-S3 — tagged "keyword" so a dedupe merge with a non-literal
      // channel's copy of the same paper (e.g. citation-neighborhood) keeps
      // BOTH channels on the survivor. Inert for scoring on its own: the
      // literal gate in combine.ts only bypasses for semantic/positive-seed/
      // citation/topic-field, so a plain keyword-tagged item still needs its
      // own literal match exactly as `kw.score` already required.
      allItems.push(...tagAdmissionChannel(result.value, "keyword"));
    } else {
      errors[sourceId] = String(result.reason);
      fetched[sourceId] = 0;
    }
  });

  // P2-S2 (Round 3) — F-A-P2-02, ABC-JEV-INTEGRATION.md §1p.B(2). One status
  // entry per ATTEMPTED source (every entry of `sources`, whether it ended
  // up fulfilled or rejected above) — never sparse, so "every attempted
  // source failed" is well-defined later as "every entry present is
  // failed" rather than needing to re-consult `sources` itself.
  // `retryCount` starts at 0: a build is not a retry.
  const attemptedAt = now.toISOString();
  const sourceStatus: Partial<Record<SourceId | FeedChannelId, SourceStatusEntry>> = {};
  for (const sourceId of sources) {
    sourceStatus[sourceId] = sourceId in errors
      ? {
          status: "failed",
          lastAttemptAt: attemptedAt,
          retryCount: 0,
          lastErrorMessage: errors[sourceId],
        }
      : {
          status: (fetched[sourceId] ?? 0) > 0 ? "ok" : "empty",
          lastAttemptAt: attemptedAt,
          retryCount: 0,
        };
  }

  // P2-S4a-FIX (Round 3) — F-A-P2S4a-02, ABC-JEV-INTEGRATION.md §1p.B(2)/(3).
  // Truthful status for the two POOL-LEVEL new channels, stored in the SAME
  // map the 5 registered sources use above so it survives a cache-hit round
  // trip via `errorsFromSourceStatus` below. Reported ONLY when the
  // channel's own flag is on ("a channel that is off reports nothing");
  // `retryCount` stays 0 forever — `retryFailedSources`'s own
  // `ACADEMIC_PAPER_SOURCES.includes(...)` filter means neither channel key
  // is ever eligible for the self-heal retry the 5 registered sources get.
  if (semanticEnabled) {
    sourceStatus.openalex_semantic = semanticError
      ? { status: "failed", lastAttemptAt: attemptedAt, retryCount: 0, lastErrorMessage: semanticError }
      : { status: semanticItems.length > 0 ? "ok" : "empty", lastAttemptAt: attemptedAt, retryCount: 0 };
    if (semanticError) errors.openalex_semantic = semanticError;
  }
  // P2-S4c-2 (Round 3) — same capture-and-report shape as the semantic
  // channel above, gated on `affiliationAttempted` (NOT merely `authorId`'s
  // presence) so "no advisor configured" and "advisor configured with zero
  // seed works" both correctly report NOTHING here, rather than being
  // mis-read as an empty or failed channel.
  if (affiliationAttempted) {
    sourceStatus.affiliation_citation = affiliationError
      ? { status: "failed", lastAttemptAt: attemptedAt, retryCount: 0, lastErrorMessage: affiliationError }
      : { status: affiliationItems.length > 0 ? "ok" : "empty", lastAttemptAt: attemptedAt, retryCount: 0 };
    if (affiliationError) errors.affiliation_citation = affiliationError;
  }

  // Merge advisor neighborhood papers into the candidate pool. They're OpenAlex
  // works, so they flow through dedup + scoring like any other source, and the
  // advisor seed-text bias (passed in seedTexts) floats the relevant ones up.
  if (affiliationItems.length > 0) {
    console.log(`[affiliation] +${affiliationItems.length} citation-neighborhood candidates merged`);
    // P2-S3 — F-A-P2-03. THE fix: tag every citation-neighborhood candidate
    // "citation" before it enters the pool, so combine.ts's literal-topic
    // gate (which reads `item.admissionChannels` — see that file) admits it
    // even with zero literal keyword overlap, per §1c: "No automatic literal
    // required-topic gate for candidates admitted by semantic/seed/citation/
    // topic channels." Explicit exclusions, date/freshness filtering and
    // Tier-0 usefulness are untouched by this tag — they run in entirely
    // separate places (`excludeIds`/ledger filtering and `dropStale`, both
    // in `runFeedPipeline` below) that never consult `admissionChannels`.
    allItems.push(...tagAdmissionChannel(affiliationItems, "citation"));
  }

  // P2-S4a — same treatment as the citation-neighborhood merge above: tag
  // every semantic candidate before it enters the pool, so combine.ts's
  // literal-topic gate (which already recognizes "semantic" as a
  // non-literal admission channel — see that file's
  // `admittedByNonLiteralChannel`, built by P2-S3) admits it even with zero
  // literal keyword overlap, per §1c.
  //
  // P2-S4c-1 — the sibling `topic-field` merge that used to sit here is
  // GONE: `openalex_topic` moved to a read-time channel (retired scaffold,
  // see the comment above `buildPaperPool`'s `Promise.all` above), so its
  // items never pass through `allItems`/dedupe/scoring at BUILD time at
  // all — they merge into `poolItemsWithSeeds` at READ time instead,
  // alongside the other three read-time channels (see
  // `resolveChannelCandidates` in `runFeedPipeline`).
  if (semanticItems.length > 0) {
    console.log(`[openalex-semantic] +${semanticItems.length} semantic-search candidates merged`);
    allItems.push(...tagAdmissionChannel(semanticItems, "semantic"));
  }

  const beforeDedup = allItems.length;
  const paperItems = includeNonPaperResults
    ? allItems
    : allItems.filter((item) => ACADEMIC_PAPER_SOURCES.includes(item.source));
  const deduped = dedupItems(paperItems);
  const afterDedup = deduped.length;

  // A daily briefing carries news. Two sources answer without regard to date —
  // Semantic Scholar's search takes no date parameter at all — so the pool
  // arrives with the field's classics in it: the 2000 PSIPRED paper and the
  // 2020 AlphaFold paper both reached a pool built for today. They stayed out
  // of the briefing only because the old ranking valued age over relevance,
  // and that is no longer true, so the ceiling has to be stated rather than
  // fallen into.
  const fresh = dropStale(deduped, brief.timeWindow, now.getTime());

  // NEUTRAL SCORING, AND IT IS THE WHOLE REASON ONE POOL CAN SERVE A WHOLE DAY.
  // `preferenceLedger` is deliberately absent here and supplied at read time
  // instead: bake a user's likes into the stored scores and every later read
  // that day would be ranked by a snapshot of their taste taken this morning.
  // The jobs pool makes the same split for the same reason.
  const scored = scorePaperCandidates(fresh, req, brief, false);

  const tier1Ranked = requestedTier >= 1 ? applyTier1Rerank(scored, brief) : scored;

  // P2-S6 RULING points 2/3 — flag on only. `rankedForJudgment` is the
  // order every downstream consumer (the shadow hook's shortlist, Tier-2's
  // input, and therefore the final MAX_PAPER_POOL_ITEMS membership cut) now
  // reads instead of `tier1Ranked` directly. Flag off: `rankedForJudgment`
  // IS `tier1Ranked` (the same reference, not a copy) and `rrfProvenance`
  // stays undefined — byte-identical to this slice never having existed.
  const rrfApplied = rankFusionEnabled() ? applyRRFOrder(tier1Ranked, rrfChannels) : undefined;
  const rankedForJudgment = rrfApplied?.ranked ?? tier1Ranked;
  const rrfProvenance = rrfApplied?.provenanceByItemId;

  // P3-S5 — fire-and-forget, never awaited, and wrapped so a throwing hook
  // can never affect the pool being built or crash this request. This is
  // the ONLY place `onFreshShortlist` is ever invoked, and `buildPaperPool`
  // itself only ever runs on an actual cache miss inside
  // `getOrBuildCachedPool`'s `build()` callback (see `runFeedPipeline`
  // below) — never on a cache hit and never from `retryFailedSources` — so
  // "never on a cache hit, never from the retry path" is true by
  // construction here, not by convention. Runs BEFORE Tier 2 so a slow or
  // failing Tier-2 call can never suppress or delay scheduling the shadow.
  // P2-S6 — reads `rankedForJudgment` (RRF top 50 when the flag is on, the
  // same Tier-1 order as before when it's off) instead of `tier1Ranked`
  // directly, per the P2-S6 RULING point 2.
  if (onFreshShortlist) {
    try {
      const shortlist: ShadowCandidate[] = rankedForJudgment
        .slice(0, MAX_SHADOW_CANDIDATES)
        .map((item) => ({
          id: item.id,
          title: item.title,
          abstract: item.abstract ?? null,
          venue: item.venue,
        }));
      onFreshShortlist(shortlist);
    } catch {
      // A throwing hook must never affect the pool being built or crash
      // the request that triggered this build.
    }
  }

  // P2-S6 — `applyTier2Rerank`'s own internal `.slice(0, 50)` now slices
  // `rankedForJudgment` instead of `tier1Ranked` (RULING point 2), and
  // because `tier2.items` (reranked or, at Tier 0/1, `rankedForJudgment`
  // itself) is what the final `MAX_PAPER_POOL_ITEMS` slice below truncates,
  // pool membership follows RRF order too (RULING point 3) with no separate
  // membership-cut code needed.
  const tier2 = requestedTier >= 2
    ? await applyTier2Rerank(rankedForJudgment, brief, req.llmOverride)
    : { items: rankedForJudgment, orderedIds: [] as string[], reasons: {} };

  return {
    items: tier2.items.slice(0, MAX_PAPER_POOL_ITEMS),
    aiOrder: tier2.orderedIds,
    aiReasons: tier2.reasons,
    fetched,
    errors,
    sourceStatus,
    beforeDedup,
    afterDedup,
    generatedAt: now.toISOString(),
    localDate: localCalendarDate(now),
    ...(rrfProvenance ? { rrf: rrfProvenance } : {}),
  };
}

// ── P2-S2 (Round 3) — F-A-P2-02, ABC-JEV-INTEGRATION.md §1p.B(2). ──────────
//
// Bounds on a degraded pool's self-healing retry: at most once per 30
// minutes per failed source, at most 3 times per local day. "Per local day"
// needs no separate reset — `derivePoolCacheKey` already folds the local
// date into the cache key, so a new day is a new pool with fresh
// `sourceStatus` (retryCount back to 0) automatically.
const SOURCE_RETRY_INTERVAL_MS = 30 * 60 * 1000;
const MAX_SOURCE_RETRIES_PER_DAY = 3;

function isEligibleForRetry(
  entry: SourceStatusEntry | undefined,
  now: Date,
): boolean {
  if (!entry || entry.status !== "failed") return false;
  if (entry.retryCount >= MAX_SOURCE_RETRIES_PER_DAY) return false;
  const last = Date.parse(entry.lastAttemptAt);
  if (!Number.isFinite(last)) return true;
  return now.getTime() - last >= SOURCE_RETRY_INTERVAL_MS;
}

/**
 * True only when every REGISTERED ACADEMIC source this build attempted
 * failed — never true for an empty attempt set.
 *
 * P2-S4a-FIX (Round 3) — F-A-P2S4a-02. Explicitly scoped to
 * `ACADEMIC_PAPER_SOURCES` rather than a blind scan of every key in
 * `sourceStatus`: that map can now ALSO carry `openalex_semantic`/
 * `openalex_topic` channel entries (see `BuiltPaperPool.sourceStatus`'s own
 * doc comment). §1p.B(2)'s rule — "a pool where every source failed is not
 * cached as a valid day" — is about the 5 registered sources; a channel
 * succeeding must never mask a real all-sources-failed pool from this
 * guard, and a channel failing alongside a genuinely healthy source must
 * never falsely trip it either. Scoping the scan is what makes both
 * directions safe regardless of what else shares the map.
 */
function everySourceFailed(
  sourceStatus: Partial<Record<SourceId | FeedChannelId, SourceStatusEntry>> | undefined,
): boolean {
  const entries = ACADEMIC_PAPER_SOURCES
    .map((sourceId) => sourceStatus?.[sourceId])
    .filter((entry): entry is SourceStatusEntry => entry !== undefined);
  return entries.length > 0 && entries.every((entry) => entry.status === "failed");
}

/**
 * `meta.errors` must be truthful on a cache-hit response too (§1p.B(2)): a
 * degraded pool's failures don't stop being true just because this request
 * didn't pay for a fresh build. Derived straight from the stored per-source
 * status, so it reflects whatever a same-request retry (below) just did.
 */
// P2-S4a-FIX — widened to `SourceId | FeedChannelId` so the two pool-level
// channel entries (`openalex_semantic`/`openalex_topic`) flow through on a
// cache-hit read exactly like a registered source does; the logic itself is
// unchanged — every "failed" entry present is reported, regardless of key.
function errorsFromSourceStatus(
  sourceStatus: Partial<Record<SourceId | FeedChannelId, SourceStatusEntry>> | undefined,
): Partial<Record<SourceId | FeedChannelId, string>> {
  const errors: Partial<Record<SourceId | FeedChannelId, string>> = {};
  for (const [sourceId, entry] of Object.entries(sourceStatus ?? {}) as [
    SourceId | FeedChannelId,
    SourceStatusEntry,
  ][]) {
    if (entry.status === "failed") {
      errors[sourceId] = entry.lastErrorMessage ?? `${sourceId}: source unavailable`;
    }
  }
  return errors;
}

/**
 * P2-S2-FIX (Round 3) — a short, non-reversible token for the retry-claim
 * keys below. The pool cache key is already a date+topic+owner digest with
 * no raw PII in it (`derivePoolCacheKey`), but hashing it again keeps the
 * claim keys short and makes it obvious on inspection that they cannot be
 * walked back to a topic list or owner id — "do not put personal data in
 * keys beyond what the private cache key already contains" is satisfied by
 * never embedding the raw key at all, only a fresh digest of it.
 */
function hashCacheKey(key: string): string {
  return createHash("sha256").update(key).digest("hex").slice(0, 24);
}

/**
 * P2-S2-FIX (Round 3) — F-A-P2S2-01, ABC-JEV-INTEGRATION.md §1p.B(2).
 * Claims ONE source's retry attempt against the shared atomic counter
 * store before `retryFailedSources` fetches it. **Window claimed first,
 * day claimed second — on purpose.** If the day were claimed first, an
 * 8-way concurrent burst inside a single window would burn 8 day-budget
 * units even though only one of them can ever win the window and actually
 * fetch, starving later legitimate windows for nothing. Claiming the
 * window first means only the ONE caller who wins it (the others fail
 * fast, before ever touching the day key) spends a day-budget unit — so
 * "at most 3 per local day" tracks actual fetch attempts, not the number
 * of requests that happened to ask.
 *
 * Both caps use the store's atomic `increment` (never a read-then-write —
 * two concurrent claimants can never both see the same pre-increment
 * number, which is the entire point of reusing this store instead of the
 * pool's own `retryCount` field the review found racing under concurrency).
 *
 * Fails CLOSED: `!reading.ok` (the store is unreachable) returns `false` —
 * the same direction `breakerTripped` takes, and the opposite of this
 * codebase's rate-limit `underLimit` convention, because this guards a real
 * outbound spend (a source fetch) rather than a request the server has to
 * answer anyway. An unreadable counter must not be read as permission.
 */
// P2-S4d (Round 3) — F-M-P2-02. `sourceId`'s type is widened from `SourceId`
// to `SourceId | FeedChannelId` (type-only — the function's own logic has no
// dependency on the specific literal values, it only ever uses `sourceId` as
// a string-interpolation component of its own internal claim keys and as a
// type boundary). This lets `resolveChannelCandidates` below reuse this
// EXACT function, unmodified, for a read-time channel leg's own bounded
// retry — the same P2-S2 discipline (<=1 per 30 min, <=3 per local day) the
// day-pool's 5 registered sources already get, applied to a 4th kind of
// "thing that can fail and be retried" sharing the same counter store.
async function claimSourceRetry(
  store: CounterStore,
  cacheKeyHash: string,
  sourceId: SourceId | FeedChannelId,
  now: Date,
): Promise<boolean> {
  const windowStartMs =
    Math.floor(now.getTime() / SOURCE_RETRY_INTERVAL_MS) * SOURCE_RETRY_INTERVAL_MS;
  const windowKey = `pool-retry:${cacheKeyHash}:${sourceId}:${windowStartMs}`;
  const windowReading = await store.increment(
    windowKey,
    new Date(windowStartMs + SOURCE_RETRY_INTERVAL_MS),
    1,
    now,
  );
  if (!windowReading.ok || windowReading.value !== 1) return false;

  // "Per local day" matches `derivePoolCacheKey`'s own local-date framing
  // (the pool's cache key already changes on a new local day too — this
  // key is belt-and-suspenders, not the only thing resetting the count).
  const dayKey = `pool-retry-day:${cacheKeyHash}:${sourceId}:${localCalendarDate(now)}`;
  const dayReading = await store.increment(
    dayKey,
    // A GC hint only, for the in-memory fallback's own housekeeping sweep —
    // correctness comes from the local-day segment already in the key
    // above, not from this bound being exact.
    new Date(now.getTime() + 25 * 60 * 60 * 1000),
    1,
    now,
  );
  return dayReading.ok && dayReading.value <= MAX_SOURCE_RETRIES_PER_DAY;
}

/**
 * A degraded cache hit's ONE bounded, in-request self-heal attempt.
 * Scoped to the five academic paper sources only: "web"/"hn" carry their
 * own connector/timeout override wiring (see `buildPaperPool`'s
 * `paperWebSearch`/`needsVertexSourceTimeout` above) that would have to be
 * duplicated here to retry them safely — recorded as a deliberate scope
 * boundary in this slice's checkpoint rather than risking a second,
 * divergent limiter. They still get honest `sourceStatus`/`meta.errors`
 * from the build; they are just never auto-retried.
 *
 * Never runs Tier 2 (no LLM call): a retry only restores candidates a real
 * Tier-0/Tier-1 score can already rank, and a degraded-cache READ must never
 * turn into a paid rerank. Merges new items through the SAME dedupe a build
 * uses, then re-scores the WHOLE merged set with the SAME neutral
 * (preference-ledger-free) scoring a build uses — this file's one
 * dedupe/score invariant ("a paper pool's stored `items` are always the
 * direct output of `scorePaperCandidates(..., includePreferenceLedger:
 * false)`") stays true for a retry-produced pool too, never a hand-patched
 * mix of old-scored and new-unscored objects. Returns the SAME `pool`
 * object (not a copy) when nothing was eligible OR nothing could be
 * claimed (see below), so the caller can cheaply tell "nothing changed"
 * apart from "something changed" by reference.
 *
 * ── P2-S2-FIX (Round 3) — F-A-P2S2-01, ABC-JEV-INTEGRATION.md §1p.B(2). ──
 * A fresh A measured N concurrent retry-eligible requests firing N
 * independent fetches of the same already-failed source: this function had
 * no coalescing of its own, unlike `getOrBuildCachedPool`'s build path. Two
 * layers now bound it to at most one real fetch per source per 30-minute
 * window, no matter how many requests land at once or which process they
 * land in:
 *
 * 1. **In-process single-flight** (`withCacheSingleFlight`, reused from
 *    `pool-cache.ts` rather than a second limiter shape — see that
 *    function's own doc comment): concurrent callers IN THIS PROCESS for
 *    the same `(cache, key)` share one in-flight retry attempt instead of
 *    each independently deciding "eligible" from their own snapshot of
 *    `pool`. Namespaced `"retry:" + key` so it can never collide with a
 *    build's own in-flight entry, which lives on the bare key.
 * 2. **Cross-instance claim** (`claimSourceRetry`, above): the
 *    single-flight only protects one Node process, and the review
 *    confirmed the durable private-pool store's `set()` is a plain
 *    last-write-wins upsert with no compare-and-swap — so two server
 *    instances can still both think they're first. Before fetching, each
 *    eligible source's attempt is claimed against the existing atomic
 *    `usage/counters.ts` store. A source that loses its claim (or whose
 *    counter store is unreadable) is simply left out of this round's
 *    fetch; its stored status is untouched, so `errorsFromSourceStatus`
 *    keeps reporting the SAME honest failure it already had rather than
 *    silently going quiet.
 *
 * The pool-level bookkeeping (`isEligibleForRetry`'s read of
 * `sourceStatus`) still decides the CANDIDATE set — cheap, synchronous, and
 * correct for the common single-request case. The counter claim is the
 * cross-request/cross-instance backstop for exactly the concurrent case
 * that bookkeeping alone cannot see (and, as a side effect, means at most
 * one writer per window ever computes a new `sourceStatus` entry, so the
 * `retryCount` race the review measured on the stored bookkeeping itself
 * cannot recur either).
 */
async function retryFailedSources(
  pool: CachedPaperPool,
  req: FeedRequest,
  brief: SearchBriefFor,
  now: Date,
  cache: PoolCache,
  key: string,
  counterStore: CounterStore,
): Promise<CachedPaperPool> {
  const statusMap = pool.sourceStatus;
  if (!statusMap) return pool;

  const eligible = (Object.keys(statusMap) as SourceId[]).filter(
    (sourceId) =>
      ACADEMIC_PAPER_SOURCES.includes(sourceId) &&
      isEligibleForRetry(statusMap[sourceId], now),
  );
  if (eligible.length === 0) return pool;

  return withCacheSingleFlight(cache, `retry:${key}`, async () => {
    const cacheKeyHash = hashCacheKey(key);
    const claims = await Promise.all(
      eligible.map(async (sourceId) => ({
        sourceId,
        claimed: await claimSourceRetry(counterStore, cacheKeyHash, sourceId, now),
      })),
    );
    const claimed = claims.filter((c) => c.claimed).map((c) => c.sourceId);
    // Nothing claimed — either every eligible source's slot was already
    // spent by a concurrent claimant elsewhere (cross-instance) or the
    // counter store itself is unreadable (fail-closed, no extra spend).
    // Either way, the pool's EXISTING truthful status is exactly what
    // "nothing to retry" already returns below, so a skipped retry can
    // never erase an already-recorded failure.
    if (claimed.length === 0) return pool;

    const perSourceLimit = req.perSourceLimit ?? 60;
    const results = await Promise.allSettled(
      claimed.map((sourceId) =>
        withSourceTimeout(
          sourceId,
          bySourceId[sourceId].fetch({
            topics: req.topics,
            queries: brief.generatedQueries,
            methods: req.methods,
            venues: req.venues,
            avoid: brief.avoid,
            timeWindow: brief.timeWindow,
            limit: perSourceLimit,
          }),
        ),
      ),
    );

    const attemptedAt = now.toISOString();
    const nextStatus: Partial<Record<SourceId, SourceStatusEntry>> = {
      ...statusMap,
    };
    const newItems: RawItem[] = [];
    results.forEach((result, i) => {
      const sourceId = claimed[i];
      const priorCount = statusMap[sourceId]?.retryCount ?? 0;
      if (result.status === "fulfilled") {
        // P2-S3 — same "keyword" tag the initial build gives this source's
        // items (see `buildPaperPool`), so a paper recovered by a retry
        // dedupe-merges its channel tag correctly if it turns out to be the
        // same work as an already-pooled citation-admitted item.
        newItems.push(...tagAdmissionChannel(result.value, "keyword"));
        nextStatus[sourceId] = {
          status: result.value.length > 0 ? "ok" : "empty",
          lastAttemptAt: attemptedAt,
          retryCount: priorCount + 1,
        };
      } else {
        nextStatus[sourceId] = {
          status: "failed",
          lastAttemptAt: attemptedAt,
          retryCount: priorCount + 1,
          lastErrorMessage: String(result.reason),
        };
      }
    });

    if (newItems.length === 0) {
      // Every retried source is still down (or came back genuinely empty) —
      // bookkeeping moved, but there is nothing to merge into the pool.
      return { ...pool, sourceStatus: nextStatus };
    }

    // Through the EXISTING dedupe — `pool.items` (ScoredItem[]) is a
    // structurally valid RawItem[] input. Re-scoring the whole merged set
    // (not just the delta) is deliberate; see this function's own doc
    // comment.
    const merged = dedupItems([...pool.items, ...newItems]);
    const rescored = scorePaperCandidates(merged, req, brief, false);
    const ranked = applyTier1Rerank(rescored, brief).slice(0, MAX_PAPER_POOL_ITEMS);

    return {
      ...pool,
      items: ranked,
      sourceStatus: nextStatus,
    };
  });
}

/**
 * Shared by the build and every read, so the two cannot score differently.
 *
 * SCORE-ZERO (ABC-JEV-INTEGRATION.md §1at ruling 2): `negativeTopics` (→
 * `combine.ts`'s `negativePenalty`, a harsh ×0.15 cut) used to be fed
 * `policyAvoidTopics` — `brief.avoid` filtered down to (almost entirely) the
 * system's own "avoid reviews/surveys" defaults, not the reader's own
 * dislikes that penalty's name promises. That let every review-shaped paper
 * take a second, uncoordinated review penalty on top of `rerank.ts`'s
 * purpose-built one, occasionally stacking to exactly 0 with no visible
 * relevance signal (docs/jev-abc/SCORE-ZERO-B-20260928T234238Z.md). Only a
 * genuine reader-declared dislike (`userNegativeTopics`, already the value
 * `legacyNegativeTopics` gets) may reach `negativePenalty` now. The system's
 * review/survey defaults keep affecting ranking exactly once, through
 * `rerank.ts` (`brief.avoid`'s own overlap term and `reviewPenalty`), which
 * already runs unconditionally at every tier.
 */
function scorePaperCandidates(
  items: RawItem[],
  req: FeedRequest,
  brief: SearchBriefFor,
  includePreferenceLedger: boolean,
): ScoredItem[] {
  const userNegativeTopics = req.negativeTopics ?? [];
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
      negativeTopics: userNegativeTopics,
      legacyNegativeTopics: userNegativeTopics,
      sourceWeights: req.sourceWeights,
      admissionChannels: req.admissionChannels,
      exclusions: req.intent?.exclusions.map((entry) => entry.value),
      selectedSenseConcepts: req.intent?.selectedSenseConcepts,
    },
    req.weights,
  );
}

// ── P2-S4b/P2-S4c-1/P2-S4d (Round 3) — F-A-P2-04 (4c/4d/4e), F-M-P2-02, ──
// ── ABC-JEV-INTEGRATION.md §1p.B(5), §4 "P2-S4d design ... accepted".  ──
//
// Four read-time channels (see `FeedPipelineOptions.positiveSeeds`'s own
// doc comment for why READ time, never baked into the cached per-day
// pool): S2 recommendations, OpenAlex seed-similarity, positive-seed
// citation neighbours (all three P2-S4b), plus P2-S4c-1's topic-field
// (real OpenAlex topic ids resolved from the owner's own `preferenceLedger`
// — see `topic-seeds.ts`). Each leg:
//   - is independently flag-gated (server env, literal "on" only);
//   - degrades to `[]` + a captured error message on its own failure,
//     never throwing;
//   - is tagged via the SAME `tagAdmissionChannel` helper every other
//     channel uses, so combine.ts's existing non-literal admission bypass
//     needs no changes.
// Self-exclusion (never show a seed back as its own "new" recommendation)
// is applied ONCE at the end, across every fetched leg's combined output
// (topic-field included — a topic-explored candidate that happens to BE
// one of the owner's own already-saved papers is excluded too), via the
// SAME `isDeliveredIdentity` + `identityForRawItem` helpers P4's
// delivery-ledger exclusion already uses.
//
// P2-S4d — before this, these channels "simply re-ran and re-reported on
// every request" (F-M-P2-02: with any flag on, a batchless page open/
// refresh fired every enabled leg fresh, unbounded). `resolveChannelCandidates`
// below now wraps them in a per-owner/local-date/signature cache
// (`ChannelCandidateCache`), reusing the P2-S2 bounded-retry discipline
// (`claimSourceRetry`/`isEligibleForRetry`, widened type only) for a failed
// leg. SIGNED-IN OWNERS ONLY (manager ruling 3): zero fetch, zero cache
// read/write for an anonymous/untrusted request.

/** S2 shares its 1-RPS budget with the existing keyword search on the same request — kept well under the guide's 20-30 recommendation. */
const POSITIVE_SEED_S2_RECS_LIMIT = 25;
/** "One call per seed up to a small cap" (design brief) — bounds how many seeds ever get their OWN OpenAlex semantic-search call in one read. */
const MAX_SEEDS_FOR_OPENALEX_SIMILARITY = 5;
/** Results kept per-seed similarity call — small on purpose, this is exploration, not the whole pool. */
const POSITIVE_SEED_OPENALEX_SIMILARITY_LIMIT = 10;
/** Matches `fetchCitationNeighborhood`'s own sensible default explicitly, rather than leaving it implicit. */
const POSITIVE_SEED_CITATION_LIMIT = 40;

function seedIdentityKeys(seeds: readonly ResolvedPositiveSeed[]): Set<string> {
  const keys = new Set<string>();
  for (const seed of seeds) {
    keys.add(seed.identity.key);
    for (const alias of seed.identity.aliases) keys.add(alias);
  }
  return keys;
}

/** Filters out any item whose own canonical identity (key or any alias) matches one of the seeds' — never let a seed return as its own "new" recommendation. */
function excludeSeeds(items: RawItem[], seedKeys: ReadonlySet<string>): RawItem[] {
  if (seedKeys.size === 0 || items.length === 0) return items;
  return items.filter((item) => !isDeliveredIdentity(identityForRawItem(item), seedKeys));
}

/** One leg's fetch outcome: its (untagged is fine — callers tag) items and a status entry in the exact `SourceStatusEntry` shape the day-pool's own channels already use. */
interface ChannelLegResult {
  items: RawItem[];
  status: ChannelLegStatus;
}

function okOrEmptyStatus(itemCount: number, attemptedAt: string): ChannelLegStatus {
  return { status: itemCount > 0 ? "ok" : "empty", lastAttemptAt: attemptedAt, retryCount: 0 };
}

function failedStatus(err: unknown, attemptedAt: string): ChannelLegStatus {
  return {
    status: "failed",
    lastAttemptAt: attemptedAt,
    retryCount: 0,
    lastErrorMessage: err instanceof Error ? err.message : String(err),
  };
}

/**
 * P5-S2 fresh A / ABC-JEV-INTEGRATION.md §4 "S2 pre-flip conflict rule
 * folded into P2-S4c+d": "at the S2 recommendations leg, an S2 paper id
 * present in BOTH the positive and negative lists is sent as NEITHER
 * (conservative, needs no cross-record recency)." Originates from
 * P2-S4b-FIX2 fresh A's finding (b) — two different stored `item_id`s
 * resolving to the same S2 paper, with opposite latest feedback, could
 * previously send that id as both a positive example and a negative
 * example in the very same request.
 */
async function fetchS2RecommendationsLeg(
  seeds: readonly ResolvedPositiveSeed[],
  negativeSeedPaperIds: readonly string[],
  now: Date,
): Promise<ChannelLegResult> {
  const attemptedAt = now.toISOString();
  const rawPositiveIds = seeds.map((s) => s.s2PaperId).filter((id): id is string => Boolean(id));
  const negativeSet = new Set(negativeSeedPaperIds);
  const positiveSet = new Set(rawPositiveIds);
  const s2Ids = rawPositiveIds.filter((id) => !negativeSet.has(id));
  const negativePaperIds = negativeSeedPaperIds.filter((id) => !positiveSet.has(id));

  if (s2Ids.length === 0) {
    return { items: [], status: okOrEmptyStatus(0, attemptedAt) };
  }
  try {
    const results = await fetchSemanticScholarRecommendations(s2Ids, {
      limit: POSITIVE_SEED_S2_RECS_LIMIT,
      // Omit the field entirely when there's nothing to send — same
      // "only attach when non-empty" convention the adapter's own
      // request-body construction already uses for this field.
      ...(negativePaperIds.length > 0 ? { negativePaperIds } : {}),
    });
    return { items: results, status: okOrEmptyStatus(results.length, attemptedAt) };
  } catch (err) {
    return { items: [], status: failedStatus(err, attemptedAt) };
  }
}

async function fetchOpenAlexSeedSimilarityLeg(
  seeds: readonly ResolvedPositiveSeed[],
  now: Date,
): Promise<ChannelLegResult> {
  const attemptedAt = now.toISOString();
  const similaritySeeds = seeds
    .filter((s) => (s.title ?? "").trim().length > 0)
    .slice(0, MAX_SEEDS_FOR_OPENALEX_SIMILARITY);
  if (similaritySeeds.length === 0) {
    return { items: [], status: okOrEmptyStatus(0, attemptedAt) };
  }
  const settled = await Promise.allSettled(
    similaritySeeds.map((s) =>
      fetchOpenAlexSemantic(s.title!, { limit: POSITIVE_SEED_OPENALEX_SIMILARITY_LIMIT }),
    ),
  );
  const items: RawItem[] = [];
  let failure: unknown;
  for (const result of settled) {
    // One seed's own similarity call failing is reported, but never trades
    // away the OTHER seeds' successful results — same "one flaky query must
    // never take a channel down" reasoning openalex.ts's own multi-query
    // fan-out uses.
    if (result.status === "fulfilled") items.push(...result.value);
    else failure = result.reason;
  }
  return {
    items,
    status: failure ? failedStatus(failure, attemptedAt) : okOrEmptyStatus(items.length, attemptedAt),
  };
}

async function fetchSeedCitationsLeg(
  seeds: readonly ResolvedPositiveSeed[],
  now: Date,
): Promise<ChannelLegResult> {
  const attemptedAt = now.toISOString();
  const openalexWorkIds = seeds.map((s) => s.openalexWorkId).filter((id): id is string => Boolean(id));
  if (openalexWorkIds.length === 0) {
    return { items: [], status: okOrEmptyStatus(0, attemptedAt) };
  }
  try {
    const results = await fetchCitationNeighborhood(openalexWorkIds, { limit: POSITIVE_SEED_CITATION_LIMIT });
    return { items: results, status: okOrEmptyStatus(results.length, attemptedAt) };
  } catch (err) {
    return { items: [], status: failedStatus(err, attemptedAt) };
  }
}

/** P2-S4c-1 — the 4th read-time leg: real OpenAlex topic ids resolved from the owner's ledger (`topic-seeds.ts`), never a build-time fetch. `sources/openalex-topic.ts` itself is unchanged. */
async function fetchTopicFieldLeg(topicIds: readonly string[], now: Date): Promise<ChannelLegResult> {
  const attemptedAt = now.toISOString();
  if (topicIds.length === 0) {
    return { items: [], status: okOrEmptyStatus(0, attemptedAt) };
  }
  try {
    const results = await fetchOpenAlexTopicField([...topicIds]);
    return { items: results, status: okOrEmptyStatus(results.length, attemptedAt) };
  } catch (err) {
    return { items: [], status: failedStatus(err, attemptedAt) };
  }
}

interface ChannelLegsFetchResult {
  items: RawItem[];
  legStatus: Partial<Record<FeedChannelId, ChannelLegStatus>>;
}

/**
 * Fans out exactly the legs named in `legsToFetch` (never the other ones —
 * this is what lets `resolveChannelCandidates` retry ONE failed leg without
 * re-fetching its siblings), tags each leg's items with its own admission
 * channel, and self-excludes the combined output once. Used both for a
 * full cache-miss build (`legsToFetch` = every enabled leg) and for a
 * cache-hit's bounded single-leg retry (`legsToFetch` = just the claimed
 * leg(s)).
 */
async function fetchChannelLegs(
  seeds: readonly ResolvedPositiveSeed[],
  negativeSeedPaperIds: readonly string[],
  topicIds: readonly string[],
  legsToFetch: ReadonlySet<FeedChannelId>,
  now: Date,
): Promise<ChannelLegsFetchResult> {
  const [s2, similarity, citation, topic] = await Promise.all([
    legsToFetch.has("s2_recommendations")
      ? fetchS2RecommendationsLeg(seeds, negativeSeedPaperIds, now)
      : undefined,
    legsToFetch.has("openalex_seed_similarity") ? fetchOpenAlexSeedSimilarityLeg(seeds, now) : undefined,
    legsToFetch.has("seed_citations") ? fetchSeedCitationsLeg(seeds, now) : undefined,
    legsToFetch.has("openalex_topic") ? fetchTopicFieldLeg(topicIds, now) : undefined,
  ]);

  const legStatus: Partial<Record<FeedChannelId, ChannelLegStatus>> = {};
  const allItems: RawItem[] = [];
  // "positive-seed" for both recommendation-style legs (S2 recs + OpenAlex
  // similarity — both are "papers like the ones you already saved"),
  // "citation" for the citation-neighbour leg (matches the existing
  // advisor-seed citation channel's own tag), "topic-field" for the topic
  // leg (matches the retired build-time scaffold's own tag).
  if (s2) {
    allItems.push(...tagAdmissionChannel(s2.items, "positive-seed"));
    legStatus.s2_recommendations = s2.status;
  }
  if (similarity) {
    allItems.push(...tagAdmissionChannel(similarity.items, "positive-seed"));
    legStatus.openalex_seed_similarity = similarity.status;
  }
  if (citation) {
    allItems.push(...tagAdmissionChannel(citation.items, "citation"));
    legStatus.seed_citations = citation.status;
  }
  if (topic) {
    allItems.push(...tagAdmissionChannel(topic.items, "topic-field"));
    legStatus.openalex_topic = topic.status;
  }

  const seedKeys = seedIdentityKeys(seeds);
  return { items: excludeSeeds(allItems, seedKeys), legStatus };
}

/** Mirrors `errorsFromSourceStatus` exactly, over a channel leg's own status map instead of the day-pool's. */
function legErrorsFromStatus(
  legStatus: Partial<Record<FeedChannelId, ChannelLegStatus>>,
): Partial<Record<FeedChannelId, string>> {
  const errors: Partial<Record<FeedChannelId, string>> = {};
  for (const [leg, entry] of Object.entries(legStatus) as [FeedChannelId, ChannelLegStatus][]) {
    if (entry.status === "failed") {
      errors[leg] = entry.lastErrorMessage ?? `${leg}: channel unavailable`;
    }
  }
  return errors;
}

/**
 * P2-S4d — owner + local date + a sorted/hashed signature of (positive seed
 * keys, negative seed ids, topic ids, enabled legs): any feedback change,
 * topic-ledger change, or flag flip produces a different key and therefore
 * a guaranteed miss. No raw seed title or owner id inside the HASHED
 * signature itself; the owner id appears once, in the clear, as the
 * returned key's own segment and (in `PrivateChannelCandidateCache`) the
 * Supabase row's `owner_id` column — the same place it already appears for
 * the day-pool's own private cache (`private-paper-cache.ts`'s
 * `owner_id: this.scope.ownerId`), not a new disclosure. Deliberately NOT
 * `derivePoolCacheKey` (pool-cache.ts): that key's inputs/versioning are
 * specific to the day-pool and deliberately exclude seed/topic sets.
 */
function deriveChannelCacheKey(input: {
  ownerId: string;
  date: string;
  positiveSeedKeys: readonly string[];
  negativeSeedIds: readonly string[];
  topicIds: readonly string[];
  enabledLegs: readonly FeedChannelId[];
}): string {
  const sig = JSON.stringify({
    v: 1,
    date: input.date,
    seeds: [...input.positiveSeedKeys].sort(),
    neg: [...input.negativeSeedIds].sort(),
    topics: [...input.topicIds].sort(),
    legs: [...input.enabledLegs].sort(),
  });
  return `peer-channels-v1-${input.ownerId}-${input.date}-${createHash("sha256").update(sig).digest("hex").slice(0, 32)}`;
}

/**
 * P2-S4d — a small, LOCAL, DEDICATED single-flight map for the channel
 * candidate cache. Mirrors `pool-cache.ts`'s `withCacheSingleFlight`'s
 * shape (a `Map<key, Promise>` coalescing concurrent callers by key) but is
 * a genuinely separate `Map`, never `inFlightByKey` itself — that map is
 * keyed by the DAY-POOL's own key strings and typed `Promise<CachedPool>`,
 * a different interface than this cache's `CachedChannelCandidates`/
 * `{items, errors}` shapes; reusing it would require widening a shared
 * generic's type constraint for one caller, exactly the kind of change
 * this slice's own STOP conditions rule out. Ensures a burst of
 * near-simultaneous tabs/reloads for the same owner+signature triggers at
 * most one live resolution, not N.
 */
const channelCacheInFlight = new Map<string, Promise<unknown>>();

async function withChannelCacheSingleFlight<T>(key: string, run: () => Promise<T>): Promise<T> {
  const existing = channelCacheInFlight.get(key) as Promise<T> | undefined;
  if (existing) return existing;
  const pending = run();
  channelCacheInFlight.set(key, pending);
  try {
    return await pending;
  } finally {
    if (channelCacheInFlight.get(key) === pending) channelCacheInFlight.delete(key);
  }
}

interface ChannelCandidatesResult {
  items: RawItem[];
  errors: Partial<Record<FeedChannelId, string>>;
}

/**
 * P2-S4d — the gated, cached, bounded-retry wrapper around the four
 * read-time channels. See this file's own P2-S4b/P2-S4c-1/P2-S4d header
 * comment above for the full design; the STEP-BY-STEP behaviour:
 *
 * 1. No trusted private scope (anonymous, or auth not configured) -> zero
 *    fetch, zero cache read/write, immediately.
 * 2. No enabled leg (every flag off AND no positive topic ids) -> zero
 *    fetch, zero cache read/write, immediately — nothing to do.
 * 3. Everything else happens inside ONE single-flight keyed by the derived
 *    signature, so concurrent same-signature callers share one resolution.
 * 4. `cache.get` throws -> the cache is genuinely unreadable (never
 *    distinguishable from "no entry yet" at the class's own fail-soft
 *    `get()` — see `channel-candidate-cache.ts` — so this defensive catch
 *    is a belt-and-suspenders layer for a state today's shipped classes
 *    never actually produce, since they swallow their own errors to a
 *    clean `null` miss; kept because a future cache implementation might
 *    not). The safe, cost-bounded choice is to SKIP every live leg this
 *    read rather than fetch uncached — fetching anyway would silently
 *    reintroduce the exact unbounded-per-open-call problem F-M-P2-02 exists
 *    to close. Reports a truthful, per-leg synthetic error distinct from a
 *    real adapter failure.
 * 5. Cache miss -> fetch every enabled leg fresh, persist, return.
 * 6. Cache hit, nothing eligible for retry -> return the cached result as
 *    -is. ZERO live calls — this is the whole point of F-M-P2-02's fix.
 * 7. Cache hit, some legs eligible for retry (failed + `SOURCE_RETRY_
 *    INTERVAL_MS` elapsed + under `MAX_SOURCE_RETRIES_PER_DAY`) -> claim
 *    each via the EXISTING `claimSourceRetry` (type-widened only), fetch
 *    ONLY the successfully-claimed legs, merge their items into the
 *    cached items through the SAME `dedupItems` the day-pool's own
 *    `retryFailedSources` merge uses, bump each retried leg's
 *    `retryCount` (mirroring `retryFailedSources`'s own `priorCount + 1`),
 *    persist, return.
 */
async function resolveChannelCandidates(
  privateScope: TrustedPaperCacheScope | undefined,
  seeds: readonly ResolvedPositiveSeed[],
  negativeSeedPaperIds: readonly string[],
  topicIds: readonly string[],
  now: Date,
  channelCache: ChannelCandidateCache | undefined,
  counterStore: CounterStore,
): Promise<ChannelCandidatesResult> {
  if (!privateScope) return { items: [], errors: {} };

  const enabledLegs: FeedChannelId[] = [
    ...(channelS2RecommendationsEnabled() ? (["s2_recommendations"] as const) : []),
    ...(channelOpenAlexSeedSimilarityEnabled() ? (["openalex_seed_similarity"] as const) : []),
    ...(channelPositiveSeedCitationsEnabled() ? (["seed_citations"] as const) : []),
    // The topic leg's OWN flag (`channelOpenAlexTopicEnabled`) is already
    // folded into `topicIds` by the caller (empty when the flag is off or
    // the ledger has no qualifying entries), so `topicIds.length > 0` alone
    // is the correct, sufficient gate here.
    ...(topicIds.length > 0 ? (["openalex_topic"] as const) : []),
  ];
  if (enabledLegs.length === 0) return { items: [], errors: {} };

  const cache = channelCache ?? new PrivateChannelCandidateCache(privateScope);
  const key = deriveChannelCacheKey({
    ownerId: privateScope.ownerId,
    date: localCalendarDate(now),
    positiveSeedKeys: [...seedIdentityKeys(seeds)],
    negativeSeedIds: negativeSeedPaperIds,
    topicIds,
    enabledLegs,
  });

  return withChannelCacheSingleFlight(key, async () => {
    let result: ChannelCacheGetResult;
    try {
      result = await cache.get(privateScope.ownerId, key);
    } catch {
      // P2-S4d-FIX — belt-and-suspenders only: a conforming
      // `ChannelCandidateCache` reports a genuine outage via the
      // "unavailable" status below (both shipped classes now do — see
      // `channel-candidate-cache.ts`), never by throwing. This catch stays
      // as a defensive fallback for a hypothetical future implementation
      // that throws/rejects instead of returning the tri-state, and
      // degrades exactly the same way an explicit "unavailable" does.
      result = { status: "unavailable" };
    }

    // P2-S4d-FIX — ABC-JEV-INTEGRATION.md §4 "P2-S4c+d fresh A ... Finding
    // 2": before this, the cache's own failures collapsed into a bare
    // `null`, indistinguishable from "nothing cached yet" — a real storage
    // outage silently took the live-fetch branch below on every request.
    // The safe, cost-bounded choice is to SKIP every live leg this read
    // rather than fetch uncached — fetching anyway would reintroduce the
    // exact unbounded-per-open-call problem F-M-P2-02 exists to close.
    // Reports a truthful, per-leg synthetic error distinct from a real
    // adapter failure (Policy 8).
    if (result.status === "unavailable") {
      const errors: Partial<Record<FeedChannelId, string>> = {};
      for (const leg of enabledLegs) errors[leg] = `${leg}: channel candidate cache unavailable`;
      return { items: [], errors };
    }

    if (result.status === "miss") {
      const built = await fetchChannelLegs(seeds, negativeSeedPaperIds, topicIds, new Set(enabledLegs), now);
      const value: CachedChannelCandidates = {
        items: built.items,
        legStatus: built.legStatus,
        generatedAt: now.toISOString(),
      };
      try {
        await cache.set(privateScope.ownerId, key, value);
      } catch {
        // A private-cache outage falls through to a request-local fresh
        // result — same priority `PrivatePaperPoolCache.set` already gives
        // the day-pool's own write.
      }
      return { items: built.items, errors: legErrorsFromStatus(built.legStatus) };
    }

    const cached = result.value;
    const retryEligible = enabledLegs.filter((leg) => isEligibleForRetry(cached.legStatus[leg], now));
    if (retryEligible.length === 0) {
      return { items: cached.items, errors: legErrorsFromStatus(cached.legStatus) };
    }

    const cacheKeyHash = hashCacheKey(key);
    const claimed: FeedChannelId[] = [];
    for (const leg of retryEligible) {
      // Sequential, not `Promise.all` — each claim is independent and this
      // set is at most 4 legs; the day-pool's own equivalent loop makes the
      // same simplicity trade-off (see `retryFailedSources`, which DOES
      // batch its claims — the difference is scale: up to 5 academic
      // sources there vs at most 4 channel legs here, so the extra
      // complexity of batching buys negligible latency here).
      if (await claimSourceRetry(counterStore, cacheKeyHash, leg, now)) claimed.push(leg);
    }
    if (claimed.length === 0) {
      return { items: cached.items, errors: legErrorsFromStatus(cached.legStatus) };
    }

    const retried = await fetchChannelLegs(seeds, negativeSeedPaperIds, topicIds, new Set(claimed), now);
    // Bump `retryCount` for exactly the legs actually retried this round —
    // mirrors `retryFailedSources`'s own `priorCount + 1`, so
    // `isEligibleForRetry`'s day cap keeps working correctly across
    // repeated retries instead of staying stuck at 0 forever.
    const adjustedStatus: Partial<Record<FeedChannelId, ChannelLegStatus>> = {};
    for (const leg of claimed) {
      const entry = retried.legStatus[leg];
      if (!entry) continue;
      const priorCount = cached.legStatus[leg]?.retryCount ?? 0;
      adjustedStatus[leg] = { ...entry, retryCount: priorCount + 1 };
    }
    const mergedItems = dedupItems([...cached.items, ...retried.items]);
    const mergedStatus: Partial<Record<FeedChannelId, ChannelLegStatus>> = {
      ...cached.legStatus,
      ...adjustedStatus,
    };
    const value: CachedChannelCandidates = {
      items: mergedItems,
      legStatus: mergedStatus,
      generatedAt: now.toISOString(),
    };
    try {
      await cache.set(privateScope.ownerId, key, value);
    } catch {
      // Serving the merged result to this reader matters more than
      // persisting it.
    }
    return { items: mergedItems, errors: legErrorsFromStatus(mergedStatus) };
  });
}

export async function runFeedPipeline(
  req: FeedRequest,
  options: FeedPipelineOptions = {},
): Promise<FeedPipelineResult> {
  const startedAt = Date.now();
  const now = options.now ?? new Date();
  const brief = compileSearchBrief(req);
  const topN = req.topN ?? brief.controls.paperCount;
  const requestedTier = req.aiTier ?? feedTierFromEnv();
  const privateScope = isTrustedPaperCacheScope(req.paperCacheScope)
    ? req.paperCacheScope
    : undefined;
  // Paper pools contain membership and potentially Tier-2 reasons. Never use
  // the historic shared v5 adapter for them: unscoped requests stay useful but
  // are request-local, and scoped requests use an owner-qualified store.
  const cache = privateScope
    ? (options.cache ?? new PrivatePaperPoolCache(privateScope))
    : ephemeralPaperPoolCache;

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
    uploadInterests: uploadInterestTerms(req.preferenceLedger, now.getTime()),
    exploreTopics: req.softTopics,
    aiTier: requestedTier,
    paperScopeIdentity: privateScope?.identity,
    paperOwnerId: privateScope?.ownerId,
    now,
  });

  let built: BuiltPaperPool | undefined;
  const loaded = await getOrBuildCachedPool(
    cache,
    key,
    isCachedPaperPool,
    async () => {
      built = await buildPaperPool(req, brief, requestedTier, now, options.onFreshShortlist);
      return {
        surface: "papers",
        items: built.items,
        aiOrder: built.aiOrder,
        aiReasons: built.aiReasons,
        generatedAt: built.generatedAt,
        localDate: built.localDate,
        sourceStatus: built.sourceStatus,
        // P2-S6-FIX — F-A-P2S6-02. Threaded onto the PERSISTED pool object
        // (not just this response's own `diagnostics`), so a later same-day
        // cache-hit read can return the identical provenance below instead
        // of having no path to it at all. Absent when the flag was off or
        // no RRF computation ran — same conditional-spread idiom the final
        // `meta.rrf` assembly below already uses.
        ...(built.rrf ? { rrf: built.rrf } : {}),
      };
    },
    // P2-S2 — ABC-JEV-INTEGRATION.md §1p.B(2): "a pool where every source
    // failed is not cached as a valid day." An empty attempt set (no
    // sources requested) is never treated as fully failed —
    // `everySourceFailed` returns false on an empty map.
    (candidate) => !everySourceFailed(candidate.sourceStatus),
  );
  let pool = loaded.pool;

  // P2-S2 — a degraded cache hit gets ONE bounded, in-request self-heal
  // attempt (see `retryFailedSources`'s own doc comment for the bounds and
  // why it never runs Tier 2). A clean hit (nothing failed, or the pool
  // predates this slice and has no `sourceStatus` at all) costs one
  // `Object.values` scan and returns the SAME pool reference unchanged.
  if (loaded.cacheHit) {
    // F-A-P2S2FIX-01 (fresh P2-S2-FIX reviewer,
    // docs/jev-abc/P2-S2-FIX-A-20260924T090527Z.md, MEDIUM; manager-assigned
    // to the P4-S6 pipeline.ts writer). `retryFailedSources` can THROW, not
    // just resolve — `claimSourceRetry`'s `store.increment(...)` call is
    // awaited with no guard against the store itself rejecting (a live
    // Supabase-backed CounterStore's network call can reject; only a
    // resolved `{ok:false}` was ever handled). Before this fix, that throw
    // propagated all the way out of `runFeedPipeline`, crashing the whole
    // feed READ — even though a perfectly good degraded pool already
    // existed to serve as-is, which is exactly the reasoning the very next
    // line (the cache.set write-back) already had its OWN try/catch for. A
    // thrown retry attempt now degrades to "no retry this read": `pool`
    // stays its PRE-retry value, so `meta.errors` (derived from
    // `pool.sourceStatus` below) stays exactly as truthful as it already
    // was, and the served pool is never dropped or padded — only the
    // self-heal attempt itself is skipped for this one read.
    try {
      const retried = await retryFailedSources(
        pool,
        req,
        brief,
        now,
        cache,
        key,
        options.counterStore ?? getCounterStore(),
      );
      if (retried !== pool) {
        pool = retried;
        try {
          await cache.set(key, pool);
        } catch {
          // Serving the merged pool to THIS reader matters more than
          // persisting it — the same priority `getOrBuildCachedPool` itself
          // gives a build's own cache write.
        }
      }
    } catch {
      // See the comment above: a thrown retry attempt is a no-op, not a
      // failed request.
    }
  }

  // ── READ-TIME RANKING. Everything below is local, deterministic and free, so
  // a user's likes, dismissals and preferred journals move today's pool without
  // re-fetching a source or re-spending an LLM token.
  //
  // The ceiling is applied here too, not only where the pool is built. A pool
  // is a day's work and outlives the request that built it: it can have been
  // built before this rule existed, or built for a reader whose window was
  // wider. Read time is the only place that can promise a briefing holds no
  // old news, so it promises it here.
  // P4-S6 (Round 3) — merge rollover candidates into the day's pool items,
  // deduplicated against them by canonical identity via the SAME dedupItems
  // helper the in-request source-retry merge above already uses (see
  // retryFailedSources) — reusing it here means a rollover candidate that
  // turns out to already be present in today's freshly-fetched/cached pool
  // collapses into ONE candidate rather than showing twice, exactly like a
  // retry-recovered item does. Placed here, before dropStale/scoring/
  // reranking, so every read-time step below (date window, current-intent
  // scoring, tier1 rerank, journal boost, ledger/excludeIds exclusion, topN
  // slice) treats a rollover candidate identically to one fetched fresh
  // this second — there is no code path after this point that could give
  // it a special boost or penalty even by accident. Deliberately NOT
  // written back via cache.set: this is a per-request, per-owner
  // augmentation of THIS read, never a fact about the shared day-pool.
  const poolItemsWithRollover =
    options.rolloverCandidates && options.rolloverCandidates.length > 0
      ? dedupItems([...pool.items, ...options.rolloverCandidates])
      : pool.items;

  // P2-S4b/P2-S4c-1/P2-S4d — the four read-time channels (see
  // FeedPipelineOptions.positiveSeeds and `resolveChannelCandidates`'s own
  // doc comments for placement, self-exclusion and the per-owner cache).
  // Read-time only, same reasoning as the rollover merge immediately
  // above; never written back to the pool cache. `topicIds` is resolved
  // here (cheap, pure, synchronous — safe to compute regardless of
  // sign-in status) but only ever USED inside `resolveChannelCandidates`,
  // which itself is signed-in-owners-only (manager ruling 3): an
  // anonymous request's `topicIds` value is simply never reached by a
  // live fetch or a cache read/write.
  const topicIds = channelOpenAlexTopicEnabled()
    ? topPositiveOpenAlexTopicIds(req.preferenceLedger)
    : [];
  const { items: channelItems, errors: channelErrors } = await resolveChannelCandidates(
    privateScope,
    options.positiveSeeds ?? [],
    options.negativeSeedPaperIds ?? [],
    topicIds,
    now,
    options.channelCandidateCache,
    options.counterStore ?? getCounterStore(),
  );
  const poolItemsWithSeeds =
    channelItems.length > 0
      ? dedupItems([...poolItemsWithRollover, ...channelItems])
      : poolItemsWithRollover;

  const inWindow = dropStale(poolItemsWithSeeds, brief.timeWindow, now.getTime());
  const scored = scorePaperCandidates(inWindow, req, brief, true);
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
  // P4-S2 — F-A-P4-01. A signed-in owner's PERMANENT dashboard ledger, when
  // the caller supplied one (see FeedPipelineOptions.ledgerExclusions).
  // Unioned with excludeIds, never substituted for it: excludeIds also
  // carries the client's explicit-dismissal/refresh-history signal, which
  // isn't part of the permanent ledger and must keep applying on its own.
  // "Delivered" is deliberately loose (isDeliveredIdentity, per
  // ABC-JEV-INTEGRATION.md §1p.A): a candidate is dropped if ITS OWN
  // canonical key OR ANY of its aliases intersects the ledger set, so a
  // preprint shown once can't resurface as the published version under a
  // different DOI once the title matches.
  //
  // P4-S3 (Round 3) — ABC-JEV-INTEGRATION.md §1p.G(4). Identity is computed
  // via `identityForRawItem`, the SAME shared helper `dedup.ts`'s survivors
  // are keyed by, instead of a second, independent inline
  // `canonicalPaperKey({...})` call — the earlier P4-S2 inline construction
  // could not see `metadata.mergedAliases`, so a dedupe survivor that only
  // carried a delivered paper's id-form key as a MERGED-IN alias (rather
  // than as its own primary key) silently escaped exclusion
  // (docs/jev-abc/P4-S2-A-20260924T0505Z.md PER-CHECK VERDICT 6 / NEW
  // FINDING 3). For an item that was never part of a merge,
  // `identityForRawItem` returns byte-identical output to the old inline
  // call, so this is a pure identity-source swap, not a behavior change for
  // any non-merged candidate. `identityForRawItem` is only ever computed
  // when a ledger set was actually supplied — an absent/empty option costs
  // nothing and changes nothing, so every caller that doesn't pass it
  // (every pre-existing test, dispatch-digests, test-digest) sees output
  // byte-identical to before this option existed.
  const ledgerExclusions =
    options.ledgerExclusions && options.ledgerExclusions.size > 0
      ? options.ledgerExclusions
      : null;
  const fresh = journalRanked.filter((item) => {
    if (excludeIds && excludeIds.has(item.id)) return false;
    if (
      ledgerExclusions &&
      isDeliveredIdentity(identityForRawItem(item), ledgerExclusions)
    ) {
      return false;
    }
    return true;
  });
  // Scarcity is never padded: a smaller ledger-filtered/excludeIds-filtered
  // candidate set simply returns fewer than `topN` items (existing
  // `fresh.slice(0, topN)` behavior, unchanged — see the scarcity
  // regression test in ledger-exclusion.test.ts). This still holds with
  // rollover candidates merged in (web/src/lib/feed/rollover.test.ts):
  // `fresh` can only be as large as the genuinely eligible candidate count,
  // rollover or not.
  const returned = fresh.slice(0, topN);
  // P4-S6 — `finalPool` is `fresh`'s own prefix (both are `.slice(0, N)` of
  // the SAME `fresh` array from index 0), so `returned` is ALWAYS a prefix
  // of `finalPool` whenever topN <= FINAL_POOL_SIZE — true for every
  // display count this product offers. See
  // FeedPipelineOptions.includeFinalPool's own doc comment for why this is
  // only computed/attached when explicitly requested.
  const finalPool = options.includeFinalPool ? fresh.slice(0, FINAL_POOL_SIZE) : undefined;

  // Fetch diagnostics only exist for the request that actually built the pool.
  // A cache hit reports the pool's size rather than inventing source counts it
  // never saw — the same choice `buildDailyJobPool` makes. `errors` is the
  // one exception (P2-S2 — ABC-JEV-INTEGRATION.md §1p.B(2): "`meta.errors`
  // is truthful on build AND cache-hit responses"): a degraded pool's
  // failures are a fact about TODAY'S pool, not about which request paid to
  // build it, so a cache hit derives it from the pool's own stored
  // `sourceStatus` (freshly updated above if a retry just ran) instead of
  // silently reporting `{}` just because this request didn't build anything.
  const diagnostics = !loaded.cacheHit ? built : undefined;
  const cacheHitErrors = loaded.cacheHit
    ? errorsFromSourceStatus(pool.sourceStatus)
    : undefined;
  // P2-S4a-FIX/P2-S4d (Round 3) — F-A-P2S4a-02, F-M-P2-02. The 4 read-time
  // channels (s2_recommendations, openalex_seed_similarity, seed_citations,
  // openalex_topic) are never part of THIS cached day-pool — they have
  // their OWN separate per-owner cache now (`resolveChannelCandidates`) —
  // so their errors are merged in here unconditionally rather than through
  // `diagnostics`/`cacheHitErrors`, truthful whether this read hit the
  // channel cache or not.
  const errors: Partial<Record<SourceId | FeedChannelId, string>> = {
    ...(diagnostics?.errors ?? cacheHitErrors ?? {}),
    ...channelErrors,
  };

  return {
    items: returned,
    meta: {
      fetched: diagnostics?.fetched ?? {},
      errors,
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
      // P2-S6 / P2-S6-FIX (F-A-P2S6-02) — see FeedMeta.rrf's own doc comment
      // (feed/types.ts). Read from `pool.rrf` rather than `diagnostics?.rrf`
      // so a same-day CACHE-HIT read returns the same provenance a fresh
      // build did (`pool.rrf` is populated on `pool` either way: on a fresh
      // build it's the object the `build()` callback above just returned;
      // on a cache hit it's whatever `cache.get` read back, unchanged by
      // `retryFailedSources`, which always spreads `...pool` rather than
      // reconstructing it — see that function's own return statements).
      // Structurally absent (not just undefined-valued) when the flag was
      // off, no RRF computation ran, or the pool predates this field, via
      // the same conditional-spread idiom `finalPool` below already uses.
      ...(pool.rrf ? { rrf: pool.rrf } : {}),
    },
    // P4-S6 — conditional spread so the KEY itself is structurally absent
    // (not merely undefined-valued) when not requested, directly testable
    // via `expect(result).not.toHaveProperty("finalPool")`.
    ...(finalPool ? { finalPool } : {}),
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

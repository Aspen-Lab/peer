import type { SearchBrief } from "@/lib/feed/profile-compiler";
import type { PreferenceConcept } from "@/types";
import type { FeedAdmissionChannel } from "@/lib/scoring/types";

export type SourceId =
  | "openalex"
  | "arxiv"
  | "semantic_scholar"
  | "dblp"
  | "pubmed"
  | "web"
  | "hn";

// RULING 75 — `gemini` joins the union. Vertex Gemini with Google Search
// grounding is the replacement search engine while the quota-capped APIs are
// suspended; `sources/gemini-search.ts` is the adapter and owns the resolution
// order all three surfaces share.
//
// `vertex` joins it for the credit migration: Vertex AI Search (Discovery
// Engine) over a site-scoped index, roughly an order of magnitude cheaper per
// query than grounding and billed under the SKU family the project's $1000
// "GenAI App Builder" trial credit covers. `sources/vertex-search.ts` is its
// adapter and returns the identical `{title, url, snippet}` contract, so it is
// a provider swap and not a pipeline change.
export type WebSearchProvider = "auto" | "brave" | "tavily" | "gemini" | "vertex";

export interface SourceQuery {
  topics: string[];
  queries?: string[];
  methods?: string[];
  venues?: string[];
  avoid?: string[];
  timeWindow?: SearchBrief["timeWindow"];
  limit?: number;
  webSearch?: {
    provider?: WebSearchProvider;
    tavilyApiKey?: string;
    includeDomains?: string[];
    excludeDomains?: string[];
    // ABC-freemium 1-05 · R-KEY-3 · D3 — the papers surface passes a hard
    // `false` here. See the comment at `feed/pipeline.ts`'s call site: a user's
    // own Tavily key cannot reach this surface at all, so the only key it could
    // ever spend is the operator's, and D3 says papers cost zero paid search.
    systemSearchAllowed?: boolean;
    /**
     * Who to charge, for shape parity with the jobs and events queries
     * (ABC-freemium 2-04).
     *
     * **The papers pipeline does not populate this today, and that is recorded
     * rather than fixed inline.** `feed/pipeline.ts` has no user in scope at
     * all — threading one would mean changing the feed request type and the
     * `api/feed` route, which is wider than this item. It does not matter today
     * because `systemSearchAllowed` is a hard `false` on this surface, so the
     * metering branch is unreachable (Ruling 6 point 3).
     *
     * **It is the first thing anyone un-gating this surface must do.** With it
     * unset the breaker would see a `null` user and decline to charge, which is
     * a meter that looks present and counts nothing.
     */
    userId?: string | null;
  };
}

export interface RawItem {
  id: string;
  source: SourceId;
  title: string;
  authors: string[];
  /**
   * Where the first author works, when the source says so. OpenAlex returns
   * an institution per authorship inside `authorships`, which Peer has always
   * fetched whole and read one field out of — the byline said "A. Kalisz,
   * J. Simons +5" and could not say where any of them were.
   */
  leadAffiliation?: string;
  abstract?: string;
  /** Semantic Scholar's machine-written one-liner. Never merged into `abstract`; shown labelled. */
  tldr?: string;
  url: string;
  publishedAt: string;
  venue?: string;
  tags?: string[];
  /**
   * P2-S3 — which retrieval channel(s) admitted this candidate, tagged ON
   * THE ITEM at fetch/merge time in `@/lib/feed/pipeline.ts`'s
   * `buildPaperPool()`, before scoring. Read by `@/lib/scoring/combine.ts`'s
   * literal-topic gate (falling back to the older, request-scoped
   * `ScoringProfile.admissionChannels` when this is absent) so a candidate a
   * declared non-literal channel — today only citation-neighborhood
   * discovery; semantic/positive-seed/topic-field channels land in P2-S4 —
   * admitted survives even with zero literal keyword overlap
   * (ABC-JEV-INTEGRATION.md §1c/§1p.A, F-A-P2-03).
   *
   * Deliberately carried on the item rather than only on the request:
   * `scorePaperCandidates` runs at build time AND, on a cache hit, at
   * read time against a DIFFERENT `req` object (and again later from the
   * scheduled-digest path) that shares no state with whichever request
   * originally fetched the item — a tag living only on the request would
   * vanish the moment the pool was read back from the cache. Carrying it
   * here means it round-trips through dedupe (a merge survivor carries the
   * union of every merged member's channels, `@/lib/feed/dedup.ts`) and
   * through the persisted `CachedPaperPool.items` automatically, since
   * `ScoredItem extends RawItem`. Absent on an item no channel has tagged
   * and on every already-cached pool from before this field existed — both
   * fall back to the literal-keyword gate exactly as before.
   */
  admissionChannels?: FeedAdmissionChannel[];
  metadata: {
    citationCount?: number;
    doi?: string;
    semanticScholarId?: string;
    arxivCategory?: string;
    hnScore?: number;
    hnComments?: number;
    workType?: string;
    isOpenAccess?: boolean;
    preferenceSignals?: PreferenceConcept[];
    /**
     * P2-S1 — cross-source identifiers an adapter's own response already
     * carried but previously discarded (e.g. Semantic Scholar's
     * `externalIds.ArXiv`/`.PubMed`). Read by
     * `@/lib/utils/canonical-identity`'s `canonicalPaperKey` so the same
     * paper found via two different sources can be recognized as one work
     * even without a shared DOI. Additive/optional — absent on any item an
     * adapter hasn't been updated to fill, and on every already-cached pool.
     */
    externalIds?: {
      doi?: string;
      arxivId?: string;
      pmid?: string;
      openalexId?: string;
      s2Id?: string;
    };
    /**
     * P2-S1 — provenance for a dedupe survivor: every source/id that was
     * merged into this item (`@/lib/feed/dedup.ts`). A merge never silently
     * drops the loser; its identity lives on here instead. Absent on an item
     * that was never part of a merge.
     */
    mergedFrom?: { source: SourceId; id: string; rank?: number }[];
    /**
     * P2-S1-FIX — the union of every merged member's own id-form keys and
     * aliases (e.g. `["doi:10.1/x", "arxiv:2409.1", "title:..."]`), set by
     * `@/lib/feed/dedup.ts` alongside `mergedFrom`. Read by
     * `@/lib/feed/paper-identity`'s `identityForRawItem` so a merge
     * survivor's full canonical identity (including an ID contributed only
     * by a loser) is re-derivable from the item alone, without re-walking
     * the merge. Absent on an item that was never part of a merge.
     */
    mergedAliases?: string[];
  };
}

export interface SourceAdapter {
  id: SourceId;
  fetch(query: SourceQuery): Promise<RawItem[]>;
}

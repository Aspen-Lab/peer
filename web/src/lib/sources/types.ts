import type { SearchBrief } from "@/lib/feed/profile-compiler";
import type { PreferenceConcept } from "@/types";

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
  };
}

export interface SourceAdapter {
  id: SourceId;
  fetch(query: SourceQuery): Promise<RawItem[]>;
}

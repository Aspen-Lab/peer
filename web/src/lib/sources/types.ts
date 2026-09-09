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

import type { SourceAdapter, SourceQuery, RawItem } from "./types";
import { cleanDisplayText, cleanDisplayTextOrUndefined } from "@/lib/text/clean";
import { fetchSemanticScholar } from "./semantic-scholar-client";
import { searchHttpFailure } from "./search-failure";

const S2_API = "https://api.semanticscholar.org/graph/v1/paper/search";
const MAX_QUERIES = 3;

interface S2Author {
  name?: string | null;
}

interface S2Paper {
  paperId: string;
  corpusId?: number;
  title?: string | null;
  abstract?: string | null;
  authors?: S2Author[];
  year?: number | null;
  publicationDate?: string | null;
  venue?: string | null;
  citationCount?: number;
  url?: string | null;
  externalIds?: {
    DOI?: string;
    ArXiv?: string;
    PubMed?: string;
  };
  openAccessPdf?: {
    url?: string | null;
  } | null;
  fieldsOfStudy?: string[];
}

async function fetchImpl(query: SourceQuery): Promise<RawItem[]> {
  const { topics = [], queries = [], limit = 30 } = query;
  const searchQueries = buildSearchQueries(topics, queries);
  if (searchQueries.length === 0) return [];

  const perQuery = Math.max(5, Math.ceil(Math.min(limit, 50) / searchQueries.length));

  const results = await Promise.allSettled(
    searchQueries.map((q) => fetchOne(q, perQuery)),
  );

  // P2-S2 (Round 3) — F-A-P2-02, ABC-JEV-INTEGRATION.md §1p.B(2). Same rule
  // as every other academic adapter: a partial failure still yields
  // results, but if EVERY query for this source rejected, propagate that
  // instead of quietly returning `[]`.
  const all: RawItem[] = [];
  const failures: unknown[] = [];
  for (const r of results) {
    if (r.status === "fulfilled") all.push(...r.value);
    else failures.push(r.reason);
  }
  if (results.length > 0 && failures.length === results.length) {
    throw failures[0];
  }
  return uniqueById(all).slice(0, limit);
}

async function fetchOne(searchQuery: string, perQuery: number): Promise<RawItem[]> {
  const params = new URLSearchParams({
    query: searchQuery,
    limit: String(perQuery),
    fields:
      "paperId,corpusId,title,abstract,authors,year,publicationDate,venue,citationCount,url,externalIds,openAccessPdf,fieldsOfStudy",
  });

  try {
    // Ruling 20 (S23): the shared, keyed, paced client — not the generic
    // `sourceFetch` every other adapter uses — so this call queues and
    // paces alongside `papers/enrich.ts`'s own Semantic Scholar calls, and
    // sends the API key when the deployment has one.
    const res = await fetchSemanticScholar(
      `${S2_API}?${params}`,
      { next: { revalidate: 300 } },
      6000,
    );
    // P2-S2 (Round 3) — F-A-P2-02. `fetchSemanticScholar` returns `null` on
    // a network error (its own "never throws" contract) and otherwise hands
    // back whatever `Response` it got, ok or not. Both used to be logged and
    // swallowed to `[]` here, indistinguishable from S2 legitimately
    // answering "nothing matched". Throw instead in both cases — `[]` is now
    // reserved for a genuine 200-with-zero-results response.
    if (!res) {
      throw new Error("semantic_scholar: request failed (network error or timeout)");
    }
    if (!res.ok) {
      throw await searchHttpFailure("semantic_scholar", res);
    }
    const data = (await res.json()) as { data?: S2Paper[] };
    return (data.data ?? []).map(paperToRawItem);
  } catch (err) {
    console.error("[semantic-scholar] fetch error:", err instanceof Error ? err.message : err);
    throw err;
  }
}

function paperToRawItem(paper: S2Paper): RawItem {
  const arxivId = paper.externalIds?.ArXiv;
  const doi = paper.externalIds?.DOI;
  const url =
    paper.openAccessPdf?.url ||
    (arxivId ? `https://arxiv.org/abs/${arxivId}` : undefined) ||
    (doi ? `https://doi.org/${doi}` : undefined) ||
    paper.url ||
    `https://www.semanticscholar.org/paper/${paper.paperId}`;

  return {
    id: `semantic_scholar:${paper.paperId}`,
    source: "semantic_scholar",
    title: cleanDisplayText(paper.title),
    authors: (paper.authors ?? [])
      .map((author) => cleanDisplayText(author.name))
      .filter(Boolean),
    abstract: cleanDisplayTextOrUndefined(paper.abstract),
    url,
    publishedAt: paper.publicationDate || (paper.year ? `${paper.year}-01-01` : ""),
    venue: cleanDisplayTextOrUndefined(paper.venue),
    tags: (paper.fieldsOfStudy ?? []).map(cleanDisplayText).filter(Boolean),
    metadata: {
      citationCount: paper.citationCount ?? 0,
      doi,
      semanticScholarId: paper.paperId,
      // P2-S1: S2's `fields=...,externalIds,...` request (already sent,
      // unchanged) returns these cross-source ids today; they were fetched
      // and silently discarded before this change.
      externalIds: {
        doi,
        arxivId: paper.externalIds?.ArXiv,
        pmid: paper.externalIds?.PubMed,
        s2Id: paper.paperId,
      },
    },
  };
}

function buildSearchQueries(topics: string[], queries: string[]): string[] {
  const source = queries.length > 0 ? queries : topics;
  return Array.from(new Set(source.map((q) => q.trim()).filter(Boolean))).slice(0, MAX_QUERIES);
}

function uniqueById(items: RawItem[]): RawItem[] {
  return Array.from(new Map(items.map((item) => [item.id, item])).values());
}

export const semanticScholar: SourceAdapter = {
  id: "semantic_scholar",
  fetch: fetchImpl,
};

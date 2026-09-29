import type { SourceAdapter, SourceQuery, RawItem } from "./types";
import { cleanDisplayText, cleanDisplayTextOrUndefined } from "@/lib/text/clean";
import { sourceFetch } from "./_fetch";
import { searchHttpFailure } from "./search-failure";

const EUTILS = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils";
const MAX_QUERIES = 2;

// QUERY-BUDGET (ABC-JEV-INTEGRATION.md §1az, ruling 3;
// docs/jev-abc/QUERY-BUDGET-B-20260929T094059Z.md §2.4). A reader who
// declares more Required tags than MAX_QUERIES silently loses every tag past
// the cut on this source, every day. The cap rises with the reader's own
// Required-tag count, bounded so an unusual tag count cannot open the budget
// unboundedly: never more than RISE_CEILING above MAX_QUERIES. Only dblp and
// pubmed rise (both already the smallest, cheapest caps); openalex/
// semantic_scholar/arxiv stay fixed at 3 — this investigation hit the
// keyless OpenAlex rate limit twice while measuring under this exact
// constraint, so their own call-count is left alone for now.
const RISE_CEILING = 3;

function effectiveQueryCap(tagCount: number): number {
  return Math.min(MAX_QUERIES + Math.max(0, tagCount - MAX_QUERIES), MAX_QUERIES + RISE_CEILING);
}

interface PubMedSearchResponse {
  esearchresult?: {
    idlist?: string[];
  };
}

interface PubMedSummaryAuthor {
  name?: string;
}

interface PubMedArticleId {
  idtype?: string;
  value?: string;
}

interface PubMedSummary {
  uid?: string;
  pubdate?: string;
  epubdate?: string;
  sortpubdate?: string;
  source?: string;
  fulljournalname?: string;
  title?: string;
  authors?: PubMedSummaryAuthor[];
  pubtype?: string[];
  articleids?: PubMedArticleId[];
}

interface PubMedSummaryResponse {
  result?: {
    uids?: string[];
    [uid: string]: PubMedSummary | string[] | undefined;
  };
}

async function fetchImpl(query: SourceQuery): Promise<RawItem[]> {
  const searchQueries = buildSearchQueries(query);
  if (searchQueries.length === 0) return [];

  const limit = query.limit ?? 30;
  const perQuery = Math.max(5, Math.ceil(Math.min(limit, 40) / searchQueries.length));

  const results = await Promise.allSettled(
    searchQueries.map((q) => fetchOne(q, perQuery, query.timeWindow)),
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

async function fetchOne(
  searchQuery: string,
  perQuery: number,
  timeWindow: SourceQuery["timeWindow"],
): Promise<RawItem[]> {
  // P2-S2 (Round 3) — F-A-P2-02. This used to catch EVERY failure from
  // either call below (including a non-2xx, which `searchIds`/
  // `fetchSummaries` themselves used to swallow to `[]` before this slice)
  // and return `[]`, indistinguishable from PubMed legitimately answering
  // "nothing matched". `[]` is now reserved for `searchIds` genuinely
  // finding zero ids; every other failure below (including a network error
  // thrown by `sourceFetch` itself) is logged and propagated instead.
  try {
    const ids = await searchIds(searchQuery, perQuery, timeWindow);
    if (ids.length === 0) return [];
    return await fetchSummaries(ids);
  } catch (err) {
    console.error("[pubmed] fetch error:", err instanceof Error ? err.message : err);
    throw err;
  }
}

async function searchIds(
  searchQuery: string,
  limit: number,
  timeWindow: SourceQuery["timeWindow"],
): Promise<string[]> {
  const params = new URLSearchParams({
    db: "pubmed",
    retmode: "json",
    retmax: String(limit),
    sort: "pub date",
    term: dateScopedQuery(searchQuery, timeWindow),
  });

  const res = await sourceFetch(`${EUTILS}/esearch.fcgi?${params}`, {
    timeoutMs: 6000,
    revalidate: 900,
  });
  if (!res.ok) {
    // P2-S2 (Round 3) — F-A-P2-02. Throw instead of swallowing to `[]`,
    // which used to be indistinguishable from PubMed legitimately answering
    // "nothing matched".
    throw await searchHttpFailure("pubmed", res);
  }
  const data = (await res.json()) as PubMedSearchResponse;
  return data.esearchresult?.idlist ?? [];
}

async function fetchSummaries(ids: string[]): Promise<RawItem[]> {
  const params = new URLSearchParams({
    db: "pubmed",
    retmode: "json",
    id: ids.join(","),
  });

  const res = await sourceFetch(`${EUTILS}/esummary.fcgi?${params}`, {
    timeoutMs: 6000,
    revalidate: 900,
  });
  if (!res.ok) {
    // P2-S2 (Round 3) — F-A-P2-02. Same rule as `searchIds` above: throw
    // instead of swallowing to `[]`.
    throw await searchHttpFailure("pubmed", res);
  }

  const data = (await res.json()) as PubMedSummaryResponse;
  const uids = data.result?.uids ?? [];
  return uids
    .map((uid) => {
      const summary = data.result?.[uid];
      return summary && !Array.isArray(summary)
        ? summaryToRawItem(summary)
        : null;
    })
    .filter((item): item is RawItem => item !== null);
}

function summaryToRawItem(summary: PubMedSummary): RawItem | null {
  const uid = summary.uid;
  const title = cleanDisplayText(summary.title);
  if (!uid || !title) return null;

  const doi = findDoi(summary.articleids);
  const venue = cleanDisplayTextOrUndefined(summary.fulljournalname || summary.source);

  return {
    id: `pubmed:${uid}`,
    source: "pubmed",
    title,
    authors: (summary.authors ?? [])
      .map((author) => cleanDisplayText(author.name))
      .filter(Boolean),
    url: doi ? `https://doi.org/${doi}` : `https://pubmed.ncbi.nlm.nih.gov/${uid}/`,
    publishedAt: parsePubMedDate(summary.epubdate || summary.sortpubdate || summary.pubdate),
    venue,
    tags: (summary.pubtype ?? []).map(cleanDisplayText).filter(Boolean),
    metadata: {
      doi,
      workType: summary.pubtype?.[0],
    },
  };
}

function findDoi(ids: PubMedArticleId[] | undefined): string | undefined {
  return ids?.find((id) => id.idtype?.toLowerCase() === "doi")?.value;
}

function buildSearchQueries(query: SourceQuery): string[] {
  const source = query.queries?.length ? query.queries : query.topics;
  return Array.from(new Set(source.map((q) => q.trim()).filter(Boolean))).slice(
    0,
    effectiveQueryCap(query.topics.length),
  );
}

function dateScopedQuery(searchQuery: string, timeWindow: SourceQuery["timeWindow"]): string {
  if (!timeWindow) return searchQuery;
  const days = timeWindow === "today" ? 2 : timeWindow === "week" ? 14 : 45;
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const date = `${since.getFullYear()}/${String(since.getMonth() + 1).padStart(2, "0")}/${String(since.getDate()).padStart(2, "0")}`;
  return `(${searchQuery}) AND ("${date}"[Date - Publication] : "3000/12/31"[Date - Publication])`;
}

function parsePubMedDate(value: string | undefined): string {
  if (!value) return "";
  const normalized = value.replace(/\//g, "-");
  const parsed = new Date(normalized);
  if (!Number.isNaN(parsed.getTime())) return parsed.toISOString().slice(0, 10);

  const year = value.match(/\b(19|20)\d{2}\b/)?.[0];
  if (!year) return "";
  const monthName = value.match(/\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\b/i)?.[0];
  const month = monthName ? monthNumber(monthName) : "01";
  const day = value.match(/\b\d{1,2}\b(?!\d)/)?.[0] ?? "01";
  return `${year}-${month}-${day.padStart(2, "0")}`;
}

function monthNumber(name: string): string {
  const i = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"].indexOf(name.toLowerCase());
  return String(Math.max(0, i) + 1).padStart(2, "0");
}

function uniqueById(items: RawItem[]): RawItem[] {
  return Array.from(new Map(items.map((item) => [item.id, item])).values());
}

export const pubmed: SourceAdapter = {
  id: "pubmed",
  fetch: fetchImpl,
};

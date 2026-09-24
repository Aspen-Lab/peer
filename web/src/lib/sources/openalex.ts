import type { SourceAdapter, SourceQuery, RawItem } from "./types";
import {
  openAlexWorkToRawItem,
  type OpenAlexWork,
} from "@/lib/utils/openalex";
import { sourceFetch } from "./_fetch";
import { searchHttpFailure } from "./search-failure";

const OPENALEX_API = "https://api.openalex.org/works";
const MAILTO = process.env.OPENALEX_EMAIL ?? "peer@example.com";
const MAX_QUERIES = 3;

/**
 * P2-S4a (Round 3) — F-A-P2-04 (4h), ABC-JEV-INTEGRATION.md §1p.B(3).
 * Optional server-only key, sent as `Authorization: Bearer <key>` — never a
 * URL parameter, so it can never leak into a logged URL. Absent (today's
 * default, and every deployment until someone sets it): behaviour is
 * byte-identical to before this slice.
 *
 * P2-S4a-FIX (Round 3) — F-A-P2S4a-01. This used to have its own local
 * `openAlexFetch` wrapper that bypassed `sourceFetch` entirely on the keyed
 * path (a direct `fetch` call), silently dropping `revalidate` and the 429
 * retry `sourceFetch` already provides. `sourceFetch` now takes an optional
 * `headers` passthrough, so the keyed path goes through the exact same
 * function as the keyless path below — same revalidate, same retry, for
 * both.
 */
function openAlexAuthHeaders(): Record<string, string> | undefined {
  const key = process.env.OPENALEX_API_KEY?.trim();
  return key ? { Authorization: `Bearer ${key}` } : undefined;
}

async function fetchImpl(query: SourceQuery): Promise<RawItem[]> {
  const { topics = [], queries = [], limit = 30 } = query;
  const searchQueries = buildSearchQueries(topics, queries);
  if (searchQueries.length === 0) return [];

  const perQuery = Math.max(5, Math.ceil(Math.min(limit, 50) / searchQueries.length));

  const results = await Promise.allSettled(
    searchQueries.map((searchTerm) =>
      fetchOne(searchTerm, perQuery, query.timeWindow),
    ),
  );

  // P2-S2 (Round 3) — F-A-P2-02, ABC-JEV-INTEGRATION.md §1p.B(2). One flaky
  // query must never take the whole source down: keep whatever fulfilled.
  // But if EVERY query for this source rejected, that is a real outage, not
  // a quiet day — reject instead of quietly returning `[]`, so the
  // pipeline's own `Promise.allSettled` over sources records it in
  // `errors[sourceId]` rather than an indistinguishable empty fetch.
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
  searchTerm: string,
  perQuery: number,
  timeWindow: SourceQuery["timeWindow"],
): Promise<RawItem[]> {
  const params = new URLSearchParams({
    search: quoteImportantTerms(searchTerm),
    per_page: String(perQuery),
    select:
      "id,title,publication_date,authorships,primary_location,best_oa_location,open_access,abstract_inverted_index,cited_by_count,doi,topics,primary_topic,keywords,concepts,type_crossref",
    sort: "relevance_score:desc",
    mailto: MAILTO,
  });

  // NOTE: we used to filter by venue via
  // `primary_location.source.display_name.search`, but OpenAlex rejects that
  // field (HTTP 400), which broke EVERY query whenever preferred journals were
  // set. Preferred journals are honored via the post-scoring journal boost
  // instead (see applyJournalBoost in the pipeline). Filtering by journal at
  // fetch time would require resolving names → OpenAlex source IDs first.
  const filters: string[] = [];
  const fromDate = publicationStartDate(timeWindow);
  if (fromDate) filters.push(`from_publication_date:${fromDate}`);
  if (filters.length > 0) params.append("filter", filters.join(","));

  const url = `${OPENALEX_API}?${params}`;
  try {
    const res = await sourceFetch(url, {
      timeoutMs: 6000,
      revalidate: 300,
      headers: openAlexAuthHeaders(),
    });
    if (!res.ok) {
      // P2-S2 (Round 3) — F-A-P2-02. A non-2xx here used to be logged and
      // swallowed to `[]`, indistinguishable from OpenAlex legitimately
      // answering "nothing matched". Throw instead — `[]` is now reserved
      // for a genuine 200-with-zero-results response.
      throw await searchHttpFailure("openalex", res);
    }
    const data = await res.json();
    const works: OpenAlexWork[] = data.results || [];
    return works.map(openAlexWorkToRawItem);
  } catch (err) {
    console.error("[openalex] fetch error:", err instanceof Error ? err.message : err);
    throw err;
  }
}

function buildSearchQueries(topics: string[], queries: string[]): string[] {
  const source = queries.length > 0 ? queries : topics;
  return Array.from(
    new Set(
      source
        .map(sanitizeSearchTerm)
        .filter((q) => q.length >= 3),
    ),
  ).slice(0, MAX_QUERIES);
}

// OpenAlex's search parser rejects some punctuation and unbalanced quotes
// with HTTP 400. Strip the dangerous chars and collapse whitespace so each
// query is a clean phrase before we optionally wrap it in quotes.
function sanitizeSearchTerm(raw: string): string {
  if (typeof raw !== "string") return "";
  return raw
    .replace(/["“”‘’]/g, "")
    .replace(/[!?{}()\[\]\\^~*]/g, " ")
    .replace(/[:;]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function quoteImportantTerms(searchTerm: string): string {
  if (/\bOR\b/i.test(searchTerm)) return searchTerm;
  const parts = searchTerm.split(/\s+/).filter(Boolean);
  if (parts.length <= 1) return searchTerm;
  if (parts.length <= 5) return `"${searchTerm}"`;
  return searchTerm;
}

function publicationStartDate(window: SourceQuery["timeWindow"]): string | null {
  if (!window) return null;
  const now = new Date();
  const days = window === "today" ? 2 : window === "week" ? 14 : 45;
  now.setUTCDate(now.getUTCDate() - days);
  return now.toISOString().slice(0, 10);
}

function uniqueById(items: RawItem[]): RawItem[] {
  return Array.from(new Map(items.map((item) => [item.id, item])).values());
}

export const openalex: SourceAdapter = {
  id: "openalex",
  fetch: fetchImpl,
};

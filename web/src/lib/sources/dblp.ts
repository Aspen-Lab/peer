import type { SourceAdapter, SourceQuery, RawItem } from "./types";
import { cleanDisplayText, cleanDisplayTextOrUndefined } from "@/lib/text/clean";
import { sourceFetch } from "./_fetch";
import { searchHttpFailure } from "./search-failure";

const DBLP_API = "https://dblp.org/search/publ/api";
const MAX_QUERIES = 2;

interface DblpAuthor {
  text?: string;
}

interface DblpHit {
  "@id"?: string;
  info?: {
    authors?: {
      author?: DblpAuthor | DblpAuthor[];
    };
    title?: string;
    venue?: string;
    year?: string;
    type?: string;
    doi?: string;
    ee?: string;
    url?: string;
  };
}

interface DblpResponse {
  result?: {
    hits?: {
      hit?: DblpHit | DblpHit[];
    };
  };
}

async function fetchImpl(query: SourceQuery): Promise<RawItem[]> {
  const searchQueries = buildSearchQueries(query);
  if (searchQueries.length === 0) return [];

  const limit = query.limit ?? 30;
  const perQuery = Math.max(5, Math.ceil(Math.min(limit, 40) / searchQueries.length));

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
    q: searchQuery,
    format: "json",
    h: String(perQuery),
  });

  try {
    const res = await sourceFetch(`${DBLP_API}?${params}`, {
      timeoutMs: 6000,
      revalidate: 900,
    });
    if (!res.ok) {
      // P2-S2 (Round 3) — F-A-P2-02. A non-2xx here used to be logged and
      // swallowed to `[]`, indistinguishable from DBLP legitimately
      // answering "nothing matched". Throw instead — `[]` is now reserved
      // for a genuine 200-with-no-hits response.
      throw await searchHttpFailure("dblp", res);
    }
    const data = (await res.json()) as DblpResponse;
    return toArray(data.result?.hits?.hit)
      .map(hitToRawItem)
      .filter((item): item is RawItem => item !== null);
  } catch (err) {
    console.error("[dblp] fetch error:", err instanceof Error ? err.message : err);
    throw err;
  }
}

function hitToRawItem(hit: DblpHit): RawItem | null {
  const info = hit.info;
  const title = cleanDisplayText(info?.title);
  if (!info || !title) return null;

  const doi = cleanDisplayTextOrUndefined(info.doi);
  const url = cleanDisplayTextOrUndefined(info.ee) || cleanDisplayTextOrUndefined(info.url);
  const year = parseInt(info.year ?? "", 10);
  const id = hit["@id"] || info.url || doi || title;

  return {
    id: `dblp:${id}`,
    source: "dblp",
    title,
    authors: toArray(info.authors?.author)
      .map((author) => cleanDisplayText(author.text))
      .filter(Boolean),
    url: url || (doi ? `https://doi.org/${doi}` : "https://dblp.org"),
    publishedAt: Number.isFinite(year) ? `${year}-01-01` : "",
    venue: cleanDisplayTextOrUndefined(info.venue),
    tags: [info.type, info.venue].map(cleanDisplayText).filter(Boolean),
    metadata: {
      doi,
      workType: cleanDisplayTextOrUndefined(info.type),
    },
  };
}

function buildSearchQueries(query: SourceQuery): string[] {
  const source = query.queries?.length ? query.queries : query.topics;
  return Array.from(new Set(source.map((q) => q.trim()).filter(Boolean))).slice(0, MAX_QUERIES);
}

function toArray<T>(value: T | T[] | undefined): T[] {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function uniqueById(items: RawItem[]): RawItem[] {
  return Array.from(new Map(items.map((item) => [item.id, item])).values());
}

export const dblp: SourceAdapter = {
  id: "dblp",
  fetch: fetchImpl,
};

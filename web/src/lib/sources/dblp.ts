import type { SourceAdapter, SourceQuery, RawItem } from "./types";
import { cleanDisplayText, cleanDisplayTextOrUndefined } from "@/lib/text/clean";
import { sourceFetch } from "./_fetch";
import { searchHttpFailure } from "./search-failure";

const DBLP_API = "https://dblp.org/search/publ/api";
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

/**
 * DBLP-BOTWALL (ABC-JEV-INTEGRATION.md §1ba; docs/jev-abc/DBLP-BOTWALL-B-
 * 20260929T110302Z.md). dblp.org sits behind a third-party anti-automation
 * check that sometimes answers a plain search request with `HTTP 200` whose
 * body is not the requested JSON at all but a static "Making sure you're not
 * a bot!" challenge page — `res.ok` is true, so the non-2xx branch above
 * never sees it, and handing that HTML to `res.json()` used to throw a bare
 * `SyntaxError` ("Unexpected token '<'") that named the parse SYMPTOM, not
 * the real cause. This error is thrown instead, before any `JSON.parse` is
 * attempted, once the response is recognized as HTML rather than JSON (see
 * `fetchOne`'s content-type-then-first-byte check, `looksLikeHtml`) — same
 * throw contract as before (the source still fails, nothing is cached; see
 * `fetchImpl`'s "every query failed -> throw" rule), just an honest, named
 * cause. `feed/pipeline.ts` also uses `instanceof` on this class to classify
 * a failure as this specific challenge (ruling 2: back off retrying it for
 * the rest of the local day, rather than spending more requests against a
 * service that is explicitly asking automated clients to stop).
 *
 * HARD RULE this class only ever detects and reports the challenge page —
 * it never attempts to bypass, solve, or evade it.
 */
export class DblpBotCheckError extends Error {
  constructor(contentType: string | null) {
    super(
      `dblp answered with a bot-check page, not data (HTTP 200, content-type ${
        contentType ? `"${contentType}"` : "missing"
      }, expected JSON)`,
    );
    this.name = "DblpBotCheckError";
  }
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
    // DBLP-BOTWALL — checked before any parse attempt (see
    // `DblpBotCheckError`'s own doc comment). The content type alone
    // usually settles it (dblp's real challenge page is always served as
    // `text/html`), but it is not trusted blindly: a response that doesn't
    // clearly declare JSON falls back to looking at the body's own first
    // byte, the same signal browsers' MIME sniffing uses to tell markup
    // from data — real JSON here is always an object (`{`), while dblp's
    // challenge page (like any HTML document) starts with `<`. This keeps a
    // response that merely OMITS a content type, or sends a generic one
    // (e.g. a test double's default `text/plain`), from being misclassified
    // as a bot check when its body is perfectly good JSON.
    const contentType = res.headers.get("content-type");
    const declaresJson = contentType?.toLowerCase().includes("json") ?? false;
    const body = await res.text();
    if (!declaresJson && looksLikeHtml(body)) {
      throw new DblpBotCheckError(contentType);
    }
    const data = JSON.parse(body) as DblpResponse;
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
  return Array.from(new Set(source.map((q) => q.trim()).filter(Boolean))).slice(
    0,
    effectiveQueryCap(query.topics.length),
  );
}

function toArray<T>(value: T | T[] | undefined): T[] {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

// DBLP-BOTWALL — the first-byte fallback `fetchOne` uses when the content
// type doesn't already say JSON. Real JSON from this API is always an
// object (starts with `{`); an HTML document — dblp's challenge page
// included — always starts with `<`, ignoring leading whitespace. This is
// only a fallback signal (checked after the content type, and only when
// that alone was inconclusive), not the primary check.
function looksLikeHtml(body: string): boolean {
  return /^\s*</.test(body);
}

function uniqueById(items: RawItem[]): RawItem[] {
  return Array.from(new Map(items.map((item) => [item.id, item])).values());
}

export const dblp: SourceAdapter = {
  id: "dblp",
  fetch: fetchImpl,
};

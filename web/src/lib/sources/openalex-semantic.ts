// P2-S4a (Round 3) — F-A-P2-04 (4b), ABC-JEV-INTEGRATION.md §1p.B(3),
// docs/jev-abc/P2-B-20260924T0345Z.md API CONTRACTS ("OpenAlex semantic
// search", verified against https://help.openalex.org/api/semantic-search/,
// fetch UTC 2026-09-24T03:37Z): `GET /works?search.semantic=<query>`, max 50
// results, max 2,000 input characters (truncated beyond that), 1 req/s, and
// only one of `search`/`search.exact`/`search.semantic` may be used per
// request. A genuinely different endpoint shape from the lexical
// `openalex.ts` adapter's `search=` parameter, not a variant of it — hence
// its own file rather than a branch inside `fetchOne`.
//
// Flag-gated OFF by default and wired ONLY from `web/src/lib/feed/
// pipeline.ts` — this file exports a plain function and is never registered
// in `sources/index.ts`'s `bySourceId`, mirroring how
// `affiliation/openalex.ts`'s `fetchCitationNeighborhood` is called directly
// by the pipeline rather than through the source-adapter list.
//
// Failure contract matches the P2-S2 fix already shipped in `openalex.ts`
// (ABC-JEV-INTEGRATION.md §1p.B(2)): throws a typed failure on a real error
// (non-2xx, network error); `[]` is reserved for a genuine
// 200-with-zero-results response, so a dead channel is never
// indistinguishable from a quiet day.

import type { RawItem } from "./types";
import { openAlexWorkToRawItem, type OpenAlexWork } from "@/lib/utils/openalex";
import { searchHttpFailure } from "./search-failure";
import { sourceFetch } from "./_fetch";

const OPENALEX_WORKS_API = "https://api.openalex.org/works";
const MAILTO = process.env.OPENALEX_EMAIL ?? "peer@example.com";

/** OpenAlex's own documented ceiling for a semantic-search query string. */
export const OPENALEX_SEMANTIC_MAX_QUERY_CHARS = 2000;
/** OpenAlex's own documented ceiling for a semantic-search result page. */
export const OPENALEX_SEMANTIC_MAX_RESULTS = 50;
/** This channel's own conservative per-build cap — well under the API ceiling. */
const DEFAULT_LIMIT = 20;

const WORK_SELECT =
  "id,title,publication_date,authorships,primary_location,best_oa_location,open_access,abstract_inverted_index,cited_by_count,doi,topics,primary_topic,keywords,concepts,type_crossref";

/**
 * Deterministic truncation: always the FIRST `OPENALEX_SEMANTIC_MAX_QUERY_CHARS`
 * characters, never a smarter/lossy summarization — so the same input always
 * truncates to the same output, and a caller that puts its highest-priority
 * text first (see `pipeline.ts`'s "project-first" query assembly) can rely on
 * that text surviving truncation.
 */
export function truncateSemanticQuery(text: string): string {
  return text.slice(0, OPENALEX_SEMANTIC_MAX_QUERY_CHARS);
}

/**
 * P2-S4a — optional server-only key, sent as `Authorization: Bearer <key>`,
 * never a URL parameter (ABC-JEV-INTEGRATION.md §1p.B(3)).
 *
 * P2-S4a-FIX (Round 3) — F-A-P2S4a-01. This file originally called the
 * native `fetch` directly (no dependency on `sources/_fetch.ts`'s
 * `sourceFetch`, which had no headers passthrough), so NEITHER the keyed
 * NOR the keyless path ever retried a 429. `sourceFetch` now takes an
 * optional `headers` passthrough, so this file routes through it like every
 * other OpenAlex adapter — same revalidate handling (none is requested
 * here, exactly as before), same 429 retry, for both paths. Absent key:
 * `headers` is `undefined`, which `sourceFetch` treats as "no headers key
 * on `init` at all, not even `{}`" — byte-identical to before this fix.
 */
function openAlexAuthHeaders(): Record<string, string> | undefined {
  const key = process.env.OPENALEX_API_KEY?.trim();
  return key ? { Authorization: `Bearer ${key}` } : undefined;
}

export interface OpenAlexSemanticOptions {
  /** Results to keep, clamped to [1, OPENALEX_SEMANTIC_MAX_RESULTS]. Defaults to DEFAULT_LIMIT. */
  limit?: number;
  timeoutMs?: number;
}

/**
 * One semantic-search call for the whole build. `queryText` should already
 * be the caller's project-first, priority-ordered text (see `pipeline.ts`) —
 * this function only enforces the API's own length ceiling, deterministically,
 * from the front.
 *
 * Blank/whitespace-only `queryText` resolves `[]` WITHOUT a network call —
 * there is nothing to search semantically for.
 */
export async function fetchOpenAlexSemantic(
  queryText: string,
  opts: OpenAlexSemanticOptions = {},
): Promise<RawItem[]> {
  const trimmed = queryText.trim();
  if (!trimmed) return [];

  const limit = Math.max(
    1,
    Math.min(opts.limit ?? DEFAULT_LIMIT, OPENALEX_SEMANTIC_MAX_RESULTS),
  );
  const query = truncateSemanticQuery(trimmed);

  const params = new URLSearchParams({
    "search.semantic": query,
    per_page: String(limit),
    select: WORK_SELECT,
    mailto: MAILTO,
  });

  const url = `${OPENALEX_WORKS_API}?${params}`;
  try {
    const res = await sourceFetch(url, {
      timeoutMs: opts.timeoutMs ?? 7000,
      headers: openAlexAuthHeaders(),
    });
    if (!res.ok) {
      // P2-S2 contract, reused: [] is reserved for a genuine empty result.
      throw await searchHttpFailure("openalex-semantic", res);
    }
    const data = await res.json();
    const works: OpenAlexWork[] = data.results || [];
    return works.slice(0, limit).map(openAlexWorkToRawItem);
  } catch (err) {
    console.error(
      "[openalex-semantic] fetch error:",
      err instanceof Error ? err.message : err,
    );
    throw err;
  }
}

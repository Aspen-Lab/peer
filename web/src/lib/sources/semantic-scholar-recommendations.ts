// P2-S4b (Round 3) — F-A-P2-04 (4d, S2 leg), ABC-JEV-INTEGRATION.md
// §1p.B(5), docs/jev-abc/P2-B-20260924T0345Z.md API CONTRACTS ("S2
// Recommendations API"):
//
//   POST https://api.semanticscholar.org/recommendations/v1/papers/
//   body: { positivePaperIds: string[], negativePaperIds?: string[] }
//   limit default 100, max 500.
//
// P2-S4b-FIX (Round 3) — docs/jev-abc/P2-S4b-A-20260924T103042Z.md fetched
// the OFFICIAL swagger.json directly (https://api.semanticscholar.org/
// recommendations/v1/swagger.json, HTTP 200, 2026-09-24T10:32:14Z UTC) and
// found the request body field names must be CAMELCASE
// (`positivePaperIds`/`negativePaperIds`), not the snake_case this file
// previously sent — that was an unverified, incorrect carry-over from a
// community client rather than the primary source (this slice's own
// CONTRACT FIDELITY TABLE has the full field-by-field comparison). Fixed
// below; `limit`/`fields`-as-query-params, the response envelope and every
// paper field this file reads were independently re-verified correct
// against the same swagger.json and needed no change.
//
// Routed through the SAME shared paced client every other S2 call in this
// codebase already uses (`fetchSemanticScholar`, semantic-scholar-client.ts)
// so it obeys the existing 1-RPS/backoff/x-api-key logic rather than
// inventing a second limiter — reuse, not duplication, per the guide's own
// direction. `limit` is capped far below the API's own ceiling (25 default,
// `RECOMMENDATIONS_MAX_LIMIT` = 30) because this call shares the SAME
// per-second budget as the existing S2 keyword search on the same feed
// request.
//
// Flag-gated OFF by default and wired ONLY from `web/src/lib/feed/
// pipeline.ts` (`PEER_CHANNEL_S2_RECOMMENDATIONS`, see
// `preferences/positive-seeds.ts`) — this file exports a plain function and
// is never registered in `sources/index.ts`'s `bySourceId`, the same
// "pipeline calls it directly" shape `openalex-semantic.ts` and
// `affiliation/openalex.ts`'s `fetchCitationNeighborhood` already use.
//
// Failure contract matches P2-S2 (ABC-JEV-INTEGRATION.md §1p.B(2)): throws
// a typed failure on a real error (non-2xx, network error, or
// `fetchSemanticScholar`'s own "null on network failure" contract); `[]`
// is reserved for a genuine 200-with-zero-recommendations response.
//
// **RESPONSE SHAPE — verified against the official swagger.json's schema
// (P2-S4b-FIX, see file header above): `{ recommendedPapers: BasePaper[] }`,
// and every field this file reads off `BasePaper`/`AuthorInfo` is present
// and correctly cased.** This confirms the DOCUMENTED contract, not an
// actual live response — a schema can still differ from real traffic in
// ways only a live call would show, so this stays a disclosed limitation
// and must still be checked against a real response before this channel is
// ever turned on for real users (§1o.5 keeps live use BLOCKED regardless).

import type { RawItem } from "./types";
import { cleanDisplayText, cleanDisplayTextOrUndefined } from "@/lib/text/clean";
import { fetchSemanticScholar } from "./semantic-scholar-client";
import { searchHttpFailure } from "./search-failure";

const RECOMMENDATIONS_API = "https://api.semanticscholar.org/recommendations/v1/papers/";

/** This channel's own conservative default — well under the community-sourced 100 default. */
const DEFAULT_LIMIT = 20;
/** This channel's own conservative ceiling — well under the community-sourced 500 max (guide: "recommend 20-30"). */
export const RECOMMENDATIONS_MAX_LIMIT = 30;
/** Defense in depth: never send more seed ids than the resolver itself is bounded to (`preferences/positive-seeds.ts`'s `POSITIVE_SEED_LIMIT`). */
const MAX_SEED_IDS = 10;

const FIELDS =
  "paperId,corpusId,title,abstract,authors,year,publicationDate,venue,citationCount,url,externalIds,openAccessPdf,fieldsOfStudy";

interface S2Author {
  name?: string | null;
}

interface S2RecommendedPaper {
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

interface S2RecommendationsResponse {
  recommendedPapers?: S2RecommendedPaper[];
}

export interface SemanticScholarRecommendationsOptions {
  /**
   * Optional negative seed ids (from "Not interested" feedback, §1p.B(5)).
   * P2-S4b-FIX (Round 3): now actually populated, by `feed/pipeline.ts`'s
   * `fetchPositiveSeedCandidates` — see `FeedPipelineOptions.negativeSeedPaperIds`.
   * `readonly` because this function only ever reads it (`.map`/`.filter`/
   * `.slice`), so a caller holding a `readonly string[]` doesn't need to
   * copy it just to pass it here.
   */
  negativePaperIds?: readonly string[];
  /** Results to keep, clamped to [1, RECOMMENDATIONS_MAX_LIMIT]. Defaults to DEFAULT_LIMIT. */
  limit?: number;
  timeoutMs?: number;
}

/** Strips a leading "semantic_scholar:" RawItem-style prefix, if present — S2's own API wants bare paper ids. */
function bareS2Id(id: string): string {
  return id.startsWith("semantic_scholar:") ? id.slice("semantic_scholar:".length) : id;
}

function recommendedPaperToRawItem(paper: S2RecommendedPaper): RawItem {
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
      externalIds: {
        doi,
        arxivId,
        pmid: paper.externalIds?.PubMed,
        s2Id: paper.paperId,
      },
    },
  };
}

/**
 * One S2 recommendations call, seeded by the owner's positive (and,
 * optionally, negative) paper ids. `positivePaperIds` empty resolves `[]`
 * WITHOUT a network call — there is nothing to seed a recommendation with.
 */
export async function fetchSemanticScholarRecommendations(
  positivePaperIds: string[],
  opts: SemanticScholarRecommendationsOptions = {},
): Promise<RawItem[]> {
  const positive = positivePaperIds.map(bareS2Id).filter(Boolean).slice(0, MAX_SEED_IDS);
  if (positive.length === 0) return [];

  const negative = (opts.negativePaperIds ?? []).map(bareS2Id).filter(Boolean).slice(0, MAX_SEED_IDS);
  const limit = Math.max(1, Math.min(opts.limit ?? DEFAULT_LIMIT, RECOMMENDATIONS_MAX_LIMIT));

  const params = new URLSearchParams({ limit: String(limit), fields: FIELDS });
  const url = `${RECOMMENDATIONS_API}?${params}`;
  // P2-S4b-FIX (Round 3): camelCase, per the official swagger.json's
  // "Paper Input" schema — see this file's header comment.
  const body: { positivePaperIds: string[]; negativePaperIds?: string[] } = {
    positivePaperIds: positive,
    ...(negative.length > 0 ? { negativePaperIds: negative } : {}),
  };

  try {
    const res = await fetchSemanticScholar(
      url,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      },
      opts.timeoutMs ?? 7000,
    );
    // P2-S2 contract, reused (ABC-JEV-INTEGRATION.md §1p.B(2)): a fetcher
    // THROWS on a real error; `[]` is reserved for a genuine empty result.
    // `fetchSemanticScholar` returns `null` on a network error/timeout —
    // its own "never throws" contract — indistinguishable here from an
    // outage, so that also throws rather than resolving `[]`.
    if (!res) {
      throw new Error("semantic-scholar-recommendations: request failed (network error or timeout)");
    }
    if (!res.ok) {
      throw await searchHttpFailure("semantic-scholar-recommendations", res);
    }
    const data = (await res.json()) as S2RecommendationsResponse;
    return (data.recommendedPapers ?? []).map(recommendedPaperToRawItem);
  } catch (err) {
    console.error(
      "[semantic-scholar-recommendations] fetch error:",
      err instanceof Error ? err.message : err,
    );
    throw err;
  }
}

// LIVE-EVAL-4 (guide Finding C3) — resolving a seed DOI into the ids each
// provider needs, since the production resolver
// (`preferences/positive-seeds.ts`'s `resolvePositiveSeeds`) reads from
// Supabase feedback rows, not a fixed DOI list, and is not reusable here.
// Reimplements the two small, free/no-published-cost single-entity lookups
// instead, using the same URL-building idiom the codebase already relies on
// (`papers/fetch-by-id.ts`'s `fetchOpenAlexPaper`, `papers/enrich.ts`'s
// `trySS`) — not those functions themselves, since they also do unrelated
// abstract-backfill work this runner doesn't need.
//
// Both lookups are attempted for every seed DOI unconditionally (Finding C4's
// call-count table charges "2 lookups x N seeds" regardless of whether the
// first of the pair succeeds) — each wrapped separately by the caller in
// `call-budget.ts`'s `trackedCall` so a 429 on either provider is
// attributable to that provider specifically. `combineSeedLookups` below is
// the pure (no network) combining step: a seed is usable only when BOTH
// lookups succeeded (role 5 needs the S2 id, role 6 needs a title, role 7
// needs the OpenAlex work id — Finding C3 describes no partial-seed mode);
// on either side failing, the whole seed is dropped and reported with both
// providers' reasons, never silently substituted.

import { fetchSemanticScholar } from "@/lib/sources/semantic-scholar-client";
import { searchHttpFailure } from "@/lib/sources/search-failure";

export interface OpenAlexSeedLookup {
  /** Bare OpenAlex work id, e.g. "W2145737817". */
  workId: string;
  title: string;
}

const OPENALEX_WORKS_API = "https://api.openalex.org/works";

function bareOpenAlexId(id: string): string {
  return id.split("/").pop() ?? id;
}

export interface ResolveOpenAlexSeedOptions {
  fetchImpl?: typeof fetch;
  mailto?: string;
  authHeaders?: Record<string, string>;
  timeoutMs?: number;
}

/**
 * OpenAlex's documented single-entity-by-external-id form, `GET
 * /works/doi:<doi>` — **free** (single-entity lookup, guide §1t.3b), the same
 * request shape `papers/fetch-by-id.ts`'s `fetchOpenAlexPaper` already makes
 * for a bare W-id, reused here for a `doi:`-prefixed id instead. Throws on a
 * real HTTP failure (including a 404 for a DOI OpenAlex has never heard of —
 * a single-entity lookup either names a real record or it doesn't; there is
 * no "genuine empty" case the way a search endpoint has one).
 */
export async function resolveOpenAlexSeed(
  doi: string,
  opts: ResolveOpenAlexSeedOptions = {},
): Promise<OpenAlexSeedLookup> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const mailto = opts.mailto ?? "peer@example.com";
  const url = `${OPENALEX_WORKS_API}/doi:${encodeURIComponent(doi)}?mailto=${encodeURIComponent(mailto)}`;

  const res = await fetchImpl(url, {
    signal: AbortSignal.timeout(opts.timeoutMs ?? 7000),
    ...(opts.authHeaders ? { headers: opts.authHeaders } : {}),
  });
  if (!res.ok) {
    throw await searchHttpFailure("openalex-seed-resolution", res);
  }
  const work = (await res.json()) as { id?: string; title?: string };
  if (!work.id) {
    throw new Error("openalex-seed-resolution: response carried no work id");
  }
  return { workId: bareOpenAlexId(work.id), title: work.title?.trim() || "" };
}

export interface S2SeedLookup {
  paperId: string;
  title: string;
}

export interface ResolveS2SeedOptions {
  fetchImpl?: typeof fetchSemanticScholar;
  timeoutMs?: number;
}

/**
 * S2's documented single-entity-by-external-id form, `GET
 * /graph/v1/paper/DOI:<doi>`, through the same paced/keyed client every
 * other S2 call in this codebase uses (`semantic-scholar-client.ts`'s
 * `fetchSemanticScholar`) — the same idiom `papers/enrich.ts`'s `trySS`
 * already uses for a `DOI:`-prefixed external id. S2 has no published cost
 * tiers at all (guide §1t.3a) — no cost-class question for this call.
 */
export async function resolveS2Seed(
  doi: string,
  opts: ResolveS2SeedOptions = {},
): Promise<S2SeedLookup> {
  const fetchImpl = opts.fetchImpl ?? fetchSemanticScholar;
  const url = `https://api.semanticscholar.org/graph/v1/paper/DOI:${encodeURIComponent(doi)}?fields=title`;

  const res = await fetchImpl(url, {}, opts.timeoutMs ?? 7000);
  // fetchSemanticScholar's own "never throws" contract returns null on a
  // network error/timeout — indistinguishable from an outage, so this
  // throws rather than resolving as if it were a genuine empty result
  // (mirrors semantic-scholar-recommendations.ts's identical handling).
  if (!res) {
    throw new Error(
      "semantic-scholar-seed-resolution: request failed (network error or timeout)",
    );
  }
  if (!res.ok) {
    throw await searchHttpFailure("semantic-scholar-seed-resolution", res);
  }
  const paper = (await res.json()) as { paperId?: string; title?: string };
  if (!paper.paperId) {
    throw new Error("semantic-scholar-seed-resolution: response carried no paperId");
  }
  return { paperId: paper.paperId, title: paper.title?.trim() || "" };
}

export interface ResolvedSeed {
  doi: string;
  openAlexWorkId: string;
  s2PaperId: string;
  title: string;
}

export interface DroppedSeed {
  doi: string;
  reason: string;
}

export type SeedLookupOutcome<T> =
  | { ok: true; value: T }
  | { ok: false; reason: string };

/**
 * Pure combining step — no network. A seed is usable only when BOTH the
 * OpenAlex and the S2 lookup succeeded; otherwise the whole seed is dropped
 * and the reason names whichever side(s) failed, so a user reading the
 * checkpoint/output can tell a DOI typo from a provider outage.
 */
export function combineSeedLookups(
  doi: string,
  openAlex: SeedLookupOutcome<OpenAlexSeedLookup>,
  s2: SeedLookupOutcome<S2SeedLookup>,
): { seed?: ResolvedSeed; dropped?: DroppedSeed } {
  if (openAlex.ok && s2.ok) {
    return {
      seed: {
        doi,
        openAlexWorkId: openAlex.value.workId,
        s2PaperId: s2.value.paperId,
        title: openAlex.value.title || s2.value.title,
      },
    };
  }
  const reasons: string[] = [];
  if (!openAlex.ok) reasons.push(`openalex: ${openAlex.reason}`);
  if (!s2.ok) reasons.push(`s2: ${s2.reason}`);
  return { dropped: { doi, reason: reasons.join("; ") } };
}

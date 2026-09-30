// P2-S4a (Round 3) — F-A-P2-04 (4e), ABC-JEV-INTEGRATION.md §1p.B(3),
// docs/jev-abc/P2-B-20260924T0345Z.md API CONTRACTS ("OpenAlex topic
// filter"). `topics.id:<T-id>` matches a work whose topic appears ANYWHERE
// in its top-3 scored topics (broader recall than `primary_topic.id`, which
// only matches the single highest-scoring topic) — B's guide recommends
// `topics.id` for exactly this reason. Deliberately capped small
// (TOPIC_FIELD_DEFAULT_LIMIT): bounded exploration slots, not a whole-field
// dump (plan §5, quoted in the guide).
//
// `topicIds` must come entirely from the caller (`pipeline.ts`) — this file
// invents nothing. As of this slice, NO upstream code path supplies a real
// OpenAlex topic id (confirmed by reading profile-compiler.ts/senses.ts in
// full — see this slice's checkpoint DESIGN CHOICES): `SearchBrief` carries
// only free-text `coreTopics` strings, and `SelectedSenseConcept` ids are
// Peer-authored local slugs, not OpenAlex `T`-ids. An empty `topicIds` array
// is therefore the expected, honest, everyday input for now — this function
// must do nothing observable in that case: no fetch, no error, resolves [].
//
// The OR-pipe multi-id filter syntax (`topics.id:T1|T2`) follows the exact
// convention this codebase already relies on for `cites:${ids.join("|")}`
// in `affiliation/openalex.ts`'s `fetchCitationNeighborhood` — B's guide
// verified the single-id form of `topics.id`, not the multi-id-OR
// combination specifically; flagged as a CONTRACT ASSUMPTION (reasonable
// inference from the vendor's own established filter syntax, not
// independently re-fetched this round) in this slice's checkpoint.
//
// Failure contract matches the P2-S2 fix already shipped in `openalex.ts`:
// throws a typed failure on a real error; `[]` is reserved for a genuine
// empty result or a genuinely empty `topicIds` input.

import type { RawItem } from "./types";
import {
  isExcludedOpenAlexType,
  openAlexWorkToRawItem,
  type OpenAlexWork,
} from "@/lib/utils/openalex";
import { searchHttpFailure } from "./search-failure";
import { sourceFetch } from "./_fetch";

const OPENALEX_WORKS_API = "https://api.openalex.org/works";
const MAILTO = process.env.OPENALEX_EMAIL ?? "peer@example.com";

/** A small, explicit, bounded-exploration cap — not a whole-field dump. */
const TOPIC_FIELD_DEFAULT_LIMIT = 15;
/** OpenAlex's own documented result-page ceiling, same as every /works call. */
const OPENALEX_TOPIC_MAX_RESULTS = 50;
/** However many topic ids the caller supplies, only the first few drive one bounded OR filter. */
const MAX_TOPIC_IDS_PER_CALL = 5;

const WORK_SELECT =
  "id,title,publication_date,authorships,primary_location,best_oa_location,open_access,abstract_inverted_index,cited_by_count,doi,topics,primary_topic,keywords,concepts,type,type_crossref";

/** Bare an id that may arrive as a full OpenAlex URL ("https://openalex.org/T10001") or already-bare ("T10001"). */
function bareTopicId(id: string): string {
  const trimmed = id.trim();
  const tail = trimmed.split("/").pop() ?? trimmed;
  return tail;
}

/**
 * P2-S4a-FIX (Round 3) — F-A-P2S4a-01. Same optional-key contract as
 * `openalex-semantic.ts` (see that file's doc comment): routes through
 * `sources/_fetch.ts`'s `sourceFetch` now that it takes an optional
 * `headers` passthrough, so both paths get the same 429 retry.
 */
function openAlexAuthHeaders(): Record<string, string> | undefined {
  const key = process.env.OPENALEX_API_KEY?.trim();
  return key ? { Authorization: `Bearer ${key}` } : undefined;
}

export interface OpenAlexTopicOptions {
  /** Results to keep, clamped to [1, 50]. Defaults to TOPIC_FIELD_DEFAULT_LIMIT. */
  limit?: number;
  timeoutMs?: number;
}

/**
 * Bounded topic/field exploration. `topicIds` may be bare (`"T10001"`) or a
 * full OpenAlex URL; malformed entries are dropped rather than sent
 * upstream broken.
 */
export async function fetchOpenAlexTopicField(
  topicIds: string[],
  opts: OpenAlexTopicOptions = {},
): Promise<RawItem[]> {
  const ids = Array.from(
    new Set(topicIds.map(bareTopicId).filter((id) => /^T\d+$/.test(id))),
  ).slice(0, MAX_TOPIC_IDS_PER_CALL);
  if (ids.length === 0) return [];

  const limit = Math.max(
    1,
    Math.min(opts.limit ?? TOPIC_FIELD_DEFAULT_LIMIT, OPENALEX_TOPIC_MAX_RESULTS),
  );

  const params = new URLSearchParams({
    filter: `topics.id:${ids.join("|")}`,
    per_page: String(limit),
    select: WORK_SELECT,
    // Bounded exploration is ranked by prominence within the topic, not by
    // OpenAlex's `relevance_score` (which needs a `search`/`search.semantic`
    // term to be meaningful and may reject a filter-only request — the same
    // caution `openalex.ts` already records for a different rejected
    // parameter combination). `cited_by_count` is the same, already-relied-
    // upon sort `affiliation/openalex.ts`'s citation-neighborhood call uses.
    sort: "cited_by_count:desc",
    mailto: MAILTO,
  });

  const url = `${OPENALEX_WORKS_API}?${params}`;
  try {
    const res = await sourceFetch(url, {
      timeoutMs: opts.timeoutMs ?? 7000,
      headers: openAlexAuthHeaders(),
    });
    if (!res.ok) {
      throw await searchHttpFailure("openalex-topic", res);
    }
    const data = await res.json();
    const works: OpenAlexWork[] = data.results || [];
    // DATASET-RECORDS (§1bl) — same non-paper-type exclusion as the other two
    // OpenAlex adapters; see utils/openalex.ts's isExcludedOpenAlexType.
    return works
      .filter((w) => !isExcludedOpenAlexType(w))
      .slice(0, limit)
      .map(openAlexWorkToRawItem);
  } catch (err) {
    console.error(
      "[openalex-topic] fetch error:",
      err instanceof Error ? err.message : err,
    );
    throw err;
  }
}

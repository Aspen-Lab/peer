// Affiliation helpers built on the OpenAlex API (free, no key). Used to:
//   1. resolve an advisor name (+ institution) to a single confirmed author,
//   2. select that author's recent, project-relevant papers as discovery seeds,
//   3. expand those seeds into a citation neighborhood of *new* external work.
//
// All functions are defensive: any failure returns an empty/neutral result so
// the feed never breaks if OpenAlex is slow or down (Tier-0 floor stays intact).

import { sourceFetch } from "@/lib/sources/_fetch";
import { searchHttpFailure } from "@/lib/sources/search-failure";
import { openAlexWorkToRawItem, type OpenAlexWork } from "@/lib/utils/openalex";
import type { RawItem } from "@/lib/sources/types";

const OPENALEX = "https://api.openalex.org";
const MAILTO = process.env.OPENALEX_EMAIL ?? "peer@example.com";

/**
 * P2-S4a (Round 3) — F-A-P2-04 (4h), ABC-JEV-INTEGRATION.md §1p.B(3).
 * Optional server-only key, sent as `Authorization: Bearer <key>`, never a
 * URL parameter.
 *
 * P2-S4a-FIX (Round 3) — F-A-P2S4a-01. This used to have its own local
 * `openAlexFetch` wrapper that bypassed `sourceFetch` on the keyed path (a
 * direct `fetch` call), silently dropping `revalidate` and the 429 retry.
 * `sourceFetch` now takes an optional `headers` passthrough, so all 3 call
 * sites below go through it directly — same revalidate, same retry, keyed
 * or keyless.
 */
function openAlexAuthHeaders(): Record<string, string> | undefined {
  const key = process.env.OPENALEX_API_KEY?.trim();
  return key ? { Authorization: `Bearer ${key}` } : undefined;
}

const WORK_SELECT =
  "id,title,publication_date,authorships,primary_location,best_oa_location,open_access,abstract_inverted_index,cited_by_count,doi,topics,primary_topic,keywords,concepts,type_crossref";

export interface ResolvedAuthor {
  /** Bare OpenAlex author id, e.g. "A5012345678". */
  authorId: string;
  displayName: string;
  institution: string | null;
  worksCount: number;
  /** Human label for the confirm card, e.g. "Paul V. Braun · University of Illinois". */
  label: string;
}

interface OpenAlexInstitution {
  display_name?: string | null;
}
interface OpenAlexAuthorResult {
  id: string;
  display_name: string;
  works_count?: number;
  last_known_institutions?: OpenAlexInstitution[] | null;
  affiliations?: { institution?: OpenAlexInstitution | null }[] | null;
  x_concepts?: { display_name: string }[] | null;
}

function bareId(url: string): string {
  return url.split("/").pop() ?? url;
}

function norm(s: string): string {
  return s.toLowerCase().replace(/[.\-_/&,]/g, " ").replace(/\s+/g, " ").trim();
}

function institutionsOf(a: OpenAlexAuthorResult): string[] {
  const out: string[] = [];
  for (const inst of a.last_known_institutions ?? []) {
    if (inst?.display_name) out.push(inst.display_name);
  }
  for (const aff of a.affiliations ?? []) {
    if (aff.institution?.display_name) out.push(aff.institution.display_name);
  }
  return out;
}

/** True if `abbr` looks like an initialism (all uppercase, 2–6 chars). */
function isAbbreviation(s: string): boolean {
  return /^[A-Z]{2,6}$/.test(s.trim());
}

/** Check whether an initialism like "UIUC" matches an institution name by taking
 *  the first letter of each significant word ("University of Illinois Urbana-Champaign"
 *  → U I U C). */
function acronymMatches(abbr: string, institutionName: string): boolean {
  const stopWords = new Set(["of", "the", "and", "for", "in", "at", "de"]);
  const initials = institutionName
    .split(/[\s\-]+/)
    .filter((w) => w.length > 0 && !stopWords.has(w.toLowerCase()))
    .map((w) => w[0].toUpperCase())
    .join("");
  return initials.includes(abbr.toUpperCase()) || abbr.toUpperCase() === initials;
}

function institutionMatches(a: OpenAlexAuthorResult, institution: string): boolean {
  const needle = institution.trim();
  if (!needle) return false;
  return institutionsOf(a).some((inst) => {
    const hay = norm(inst);
    const needleNorm = norm(needle);
    // Substring match (e.g. "UIUC" in "UIUC" or "Illinois" in "University of Illinois")
    if (hay.includes(needleNorm) || needleNorm.includes(hay)) return true;
    // Acronym match: "UIUC" ↔ "University of Illinois Urbana-Champaign"
    if (isAbbreviation(needle) && acronymMatches(needle, inst)) return true;
    return false;
  });
}

/**
 * Resolve an advisor to a single best OpenAlex author. Prefers a candidate whose
 * institution matches the supplied school; otherwise falls back to the most
 * prolific top-relevance hit. Returns null if nothing plausible is found.
 */
/** Build one or more OpenAlex search strings from a free-text name entry.
 *  Returns a list so we can try fallback strategies:
 *    "Paul Braun"  → ["Paul Braun"]
 *    "PaulBraun"   → ["Paul Braun"]        (camelCase split)
 *    "paulbraun"   → ["paulbraun", "braun"] (raw, then surname-only fallback)
 */
function buildNameQueries(raw: string): string[] {
  const trimmed = raw.trim();
  if (!trimmed) return [];

  // Has at least one space — user typed it correctly.
  if (/\s/.test(trimmed)) return [trimmed];

  // CamelCase boundary ("PaulBraun" → "Paul Braun").
  const camel = trimmed.replace(/([a-z])([A-Z])/g, "$1 $2");
  if (camel !== trimmed) return [camel];

  // Single-word (all-lowercase or all-uppercase): search raw, then fall back
  // to just the last half as a likely surname (e.g. "braun" from "paulbraun").
  const half = trimmed.slice(Math.floor(trimmed.length / 2));
  return [trimmed, half];
}

async function searchAuthors(
  query: string,
  institution: string | undefined,
): Promise<ResolvedAuthor | null> {
  const params = new URLSearchParams({
    search: query,
    per_page: "10",
    select: "id,display_name,works_count,last_known_institutions,affiliations,x_concepts",
    mailto: MAILTO,
  });

  try {
    const res = await sourceFetch(`${OPENALEX}/authors?${params}`, {
      timeoutMs: 6000,
      revalidate: 86_400,
      headers: openAlexAuthHeaders(),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { results?: OpenAlexAuthorResult[] };
    const results = (data.results ?? []).filter((a) => (a.works_count ?? 0) > 0);
    if (results.length === 0) return null;

    // Prefer an institution match (most works first); else most-prolific overall.
    const ranked = institution
      ? [...results].sort((a, b) => {
          const am = institutionMatches(a, institution) ? 1 : 0;
          const bm = institutionMatches(b, institution) ? 1 : 0;
          if (am !== bm) return bm - am;
          return (b.works_count ?? 0) - (a.works_count ?? 0);
        })
      : [...results].sort((a, b) => (b.works_count ?? 0) - (a.works_count ?? 0));

    const best = ranked[0];
    // When using a surname-only fallback, require an institution match so we
    // don't confidently return the wrong "Braun" from a different university.
    if (institution && !institutionMatches(best, institution)) return null;

    const inst = institutionsOf(best)[0] ?? null;
    const label = inst ? `${best.display_name} · ${inst}` : best.display_name;
    return {
      authorId: bareId(best.id),
      displayName: best.display_name,
      institution: inst,
      worksCount: best.works_count ?? 0,
      label,
    };
  } catch {
    return null;
  }
}

export async function resolveAuthor(
  name: string,
  institution?: string,
): Promise<ResolvedAuthor | null> {
  const queries = buildNameQueries(name);
  if (queries.length === 0) return null;
  // Try each query strategy in order, return the first successful match.
  for (const q of queries) {
    const result = await searchAuthors(q, institution);
    if (result) return result;
  }
  return null;
}

function tokenize(text: string): Set<string> {
  return new Set(
    norm(text)
      .split(" ")
      .filter((t) => t.length >= 4),
  );
}

function seedTextOf(item: RawItem): string {
  const abstract = (item.abstract ?? "").slice(0, 360);
  return abstract ? `${item.title}. ${abstract}` : item.title;
}

export interface AdvisorSeeds {
  /** Bare OpenAlex work ids, e.g. ["W123", "W456"]. */
  workIds: string[];
  /** "Title. short abstract" snippets used to bias TF-IDF scoring. */
  texts: string[];
}

/**
 * Fetch the advisor's recent works and pick the ones most relevant to the
 * user's project/challenges as discovery seeds. Falls back to most-recent when
 * no project text is supplied.
 */
export async function fetchAdvisorSeeds(
  authorId: string,
  projectText: string,
  opts: { limit?: number; yearsBack?: number } = {},
): Promise<AdvisorSeeds> {
  const limit = opts.limit ?? 8;
  const yearsBack = opts.yearsBack ?? 3;
  const from = new Date();
  from.setUTCFullYear(from.getUTCFullYear() - yearsBack);
  const fromDate = from.toISOString().slice(0, 10);

  const params = new URLSearchParams({
    filter: `author.id:${authorId},from_publication_date:${fromDate}`,
    sort: "publication_date:desc",
    per_page: "30",
    select: WORK_SELECT,
    mailto: MAILTO,
  });

  try {
    const res = await sourceFetch(`${OPENALEX}/works?${params}`, {
      timeoutMs: 7000,
      revalidate: 86_400,
      headers: openAlexAuthHeaders(),
    });
    if (!res.ok) return { workIds: [], texts: [] };
    const data = (await res.json()) as { results?: OpenAlexWork[] };
    const works = data.results ?? [];
    if (works.length === 0) return { workIds: [], texts: [] };

    const items = works.map((w) => ({ raw: w, item: openAlexWorkToRawItem(w) }));
    const projTokens = tokenize(projectText);

    const ranked =
      projTokens.size > 0
        ? [...items].sort((a, b) => relevance(b.item, projTokens) - relevance(a.item, projTokens))
        : items; // already newest-first

    const top = ranked.slice(0, limit);
    return {
      workIds: top.map((t) => bareId(t.raw.id)),
      texts: top.map((t) => seedTextOf(t.item)),
    };
  } catch {
    return { workIds: [], texts: [] };
  }
}

function relevance(item: RawItem, projTokens: Set<string>): number {
  const hay = tokenize(`${item.title} ${item.abstract ?? ""} ${(item.tags ?? []).join(" ")}`);
  let hits = 0;
  for (const t of projTokens) if (hay.has(t)) hits++;
  return hits;
}

/**
 * Expand seed works into a citation neighborhood: recent papers that *cite* the
 * seeds (newer work building on the advisor's research). This is the discovery
 * payload — external papers the user likely hasn't seen. Bounded + guarded.
 *
 * P2-S4a-FIX (Round 3) — F-A-P2S4a-02, ABC-JEV-INTEGRATION.md §1p.B(2).
 * Failure contract now matches the rest of the OpenAlex adapters (P2-S2,
 * reused by P2-S4a's semantic/topic-field adapters): THROWS on a real
 * failure (non-2xx, network error); `[]` is reserved for a genuine
 * "zero citing papers" result or an empty `seedWorkIds` input. Before this
 * fix every failure was swallowed here to `[]`, indistinguishable from a
 * quiet day — which meant `feed/pipeline.ts`'s `seed_citations` channel
 * (a caller of this function) could never see a real outage no matter what
 * it did with the returned promise. The two OTHER callers of this same
 * function (`buildPaperPool`'s advisor `affiliationPromise`, and
 * `fetchPositiveSeedCandidates`'s `citationPromise`) both already wrap
 * every call in `.catch(() => [])`, so this is a pure visibility change for
 * them — they still degrade to no candidates on failure exactly as before,
 * they just do it by catching a real rejection instead of this function
 * swallowing it internally.
 */
export async function fetchCitationNeighborhood(
  seedWorkIds: string[],
  opts: { limit?: number; yearsBack?: number } = {},
): Promise<RawItem[]> {
  const ids = seedWorkIds.map(bareId).filter((id) => /^W\d+/.test(id)).slice(0, 8);
  if (ids.length === 0) return [];

  const limit = opts.limit ?? 40;
  const yearsBack = opts.yearsBack ?? 3;
  const from = new Date();
  from.setUTCFullYear(from.getUTCFullYear() - yearsBack);
  const fromDate = from.toISOString().slice(0, 10);

  const params = new URLSearchParams({
    filter: `cites:${ids.join("|")},from_publication_date:${fromDate}`,
    sort: "cited_by_count:desc",
    per_page: String(Math.min(limit, 50)),
    select: WORK_SELECT,
    mailto: MAILTO,
  });

  try {
    const res = await sourceFetch(`${OPENALEX}/works?${params}`, {
      timeoutMs: 7000,
      revalidate: 21_600,
      headers: openAlexAuthHeaders(),
    });
    if (!res.ok) {
      throw await searchHttpFailure("affiliation-openalex-citations", res);
    }
    const data = (await res.json()) as { results?: OpenAlexWork[] };
    return (data.results ?? []).map(openAlexWorkToRawItem).slice(0, limit);
  } catch (err) {
    console.error(
      "[affiliation openalex] citation neighborhood fetch error:",
      err instanceof Error ? err.message : err,
    );
    throw err;
  }
}

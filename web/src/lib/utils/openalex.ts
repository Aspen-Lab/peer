import type { RawItem } from "@/lib/sources/types";
import { cleanDisplayText, cleanDisplayTextOrUndefined } from "@/lib/text/clean";
import {
  normalizePreferenceConcepts,
  preferenceKey,
} from "@/lib/preferences/ledger";

export function reconstructAbstract(
  index: Record<string, number[]> | null | undefined,
): string {
  if (!index) return "";
  const words: [number, string][] = [];
  for (const [word, positions] of Object.entries(index)) {
    for (const pos of positions) words.push([pos, word]);
  }
  words.sort((a, b) => a[0] - b[0]);
  return words.map(([, w]) => w).join(" ");
}

/**
 * The first author's institution — the one line that turns a list of names
 * into a byline. `author_position` rather than index 0: OpenAlex orders
 * `authorships` by position already, but says so explicitly, and a record
 * that has lost its order should not silently promote whoever is first.
 */
function leadAffiliationOf(authorships: OpenAlexAuthorship[]): string | undefined {
  const lead =
    authorships.find((a) => a.author_position === "first") ?? authorships[0];
  const name = lead?.institutions?.find((i) => i.display_name)?.display_name;
  return cleanDisplayTextOrUndefined(name);
}

export function normalizeOpenAlexId(openalexId: string): string {
  return "openalex:" + openalexId.split("/").pop();
}

interface OpenAlexAuthorship {
  author_position?: string;
  author: { display_name: string };
  /** Present in the `authorships` field Peer already selects. */
  institutions?: { display_name?: string }[];
}

interface OpenAlexConcept {
  id?: string;
  display_name: string;
  level: number;
  score?: number;
}

interface OpenAlexTopic {
  id: string;
  display_name: string;
  score?: number;
}

interface OpenAlexKeyword {
  id: string;
  display_name: string;
  score?: number;
}

interface OpenAlexLocation {
  pdf_url?: string | null;
  landing_page_url?: string | null;
  source?: { display_name: string } | null;
}

export interface OpenAlexWork {
  id: string;
  title: string | null;
  publication_date: string | null;
  authorships: OpenAlexAuthorship[];
  primary_location: OpenAlexLocation | null;
  best_oa_location?: OpenAlexLocation | null;
  open_access?: { is_oa?: boolean; oa_url?: string | null } | null;
  abstract_inverted_index: Record<string, number[]> | null;
  cited_by_count: number;
  doi: string | null;
  concepts?: OpenAlexConcept[];
  topics?: OpenAlexTopic[];
  primary_topic?: OpenAlexTopic | null;
  keywords?: OpenAlexKeyword[];
  /**
   * DATASET-RECORDS (ABC-JEV-INTEGRATION.md §1bl,
   * docs/jev-abc/DATASET-RECORDS-B-20260930T030544Z.md): OpenAlex's own
   * normalized work type (e.g. "article", "dataset", "preprint", "review",
   * "peer-review", ...) — preferred over the legacy `type_crossref` below,
   * which came back absent on every live-probed work in that investigation (a
   * dead field in practice). See `openAlexWorkToRawItem`'s `workType`
   * assignment and `isExcludedOpenAlexType` just below.
   */
  type?: string | null;
  /** Crossref's own type field. Kept only as a fallback now — see `type` above. */
  type_crossref?: string | null;
}

// DATASET-RECORDS (ABC-JEV-INTEGRATION.md §1bl,
// docs/jev-abc/DATASET-RECORDS-B-20260930T030544Z.md): a signed-out Papers
// feed showed one Figshare DATASET record twice (a version-DOI pair), because
// nothing ever checked OpenAlex's own work `type` — every adapter fetched
// only the legacy `type_crossref`, which came back absent on every
// live-probed work, so `metadata.workType` was a dead field for every
// OpenAlex item Peer has ever fetched. Every value below is a non-textual
// artifact or an administrative notice ABOUT another work (never itself
// research content) — checked against OpenAlex's live, whole-corpus `type`
// vocabulary (25 values; `GET /works?group_by=type`, 2026-09-30) and decided
// per value, one at a time. `article`/`review`/`preprint`/`book-chapter` and
// several genuinely borderline types (conference abstracts, books,
// dissertations, reports, among others) are deliberately KEPT — see the C
// checkpoint (docs/jev-abc/DATASET-RECORDS-C-20260930T034606Z.md) for the
// full type table and the reasoning behind every kept/dropped value. Finite
// and named, not a general blocklist: widen this set only with the same
// evidence bar (confirmed to exist in OpenAlex's own vocabulary, and plainly
// not a paper) — never ad hoc, and never by guessing at a type nobody
// verified.
export const EXCLUDED_OPENALEX_TYPES = new Set([
  "dataset",
  "paratext",
  "peer-review",
  "erratum",
  "retraction",
  "libguides",
  "supplementary-materials",
  "software",
]);

/**
 * OpenAlex's own `type` if present, else the legacy `type_crossref` fallback
 * — the exact same preference `openAlexWorkToRawItem`'s `metadata.workType`
 * uses, so the exclusion filter below and the value scoring/review-detection
 * later reads are always derived from one shared definition of "this
 * record's effective type" rather than two definitions that could drift
 * apart. Lowercased only for this membership check — `metadata.workType`
 * itself keeps whatever casing OpenAlex/Crossref returned, unchanged.
 */
function effectiveOpenAlexType(w: OpenAlexWork): string | undefined {
  const raw = w.type ?? w.type_crossref;
  return raw ? raw.toLowerCase() : undefined;
}

/**
 * True when this work's effective type (see above) is one of the excluded,
 * clearly-non-paper OpenAlex types (DATASET-RECORDS, §1bl). Every OpenAlex
 * adapter filters with this immediately after fetching, before
 * `openAlexWorkToRawItem` ever runs on the excluded record — a dropped
 * record never reaches scoring or dedupe and is never shown with a label; it
 * simply never entered the pool. No new OpenAlex query parameter is
 * involved (this codebase was burned once already by an unverified filter
 * parameter rejecting every query with an HTTP 400 — see `sources/openalex.ts`'s
 * own comment on that incident).
 */
export function isExcludedOpenAlexType(w: OpenAlexWork): boolean {
  const t = effectiveOpenAlexType(w);
  return t ? EXCLUDED_OPENALEX_TYPES.has(t) : false;
}

/**
 * DATASET-RECORDS (§1bl.8 AMENDMENT). Same exclusion as `isExcludedOpenAlexType`
 * above, but keyed on an already-built RawItem/ScoredItem's own `source` +
 * `metadata.workType` — the shape every OpenAlex-derived candidate has by the
 * time it reaches dedupe, regardless of which channel produced it (a source
 * adapter, the advisor/citation-neighbourhood channel, a liked-paper seed
 * citation, ...). A fresh A's review found `affiliation/openalex.ts`'s
 * `fetchCitationNeighborhood` feeding the same scored candidate pool the
 * three adapters feed, with no adapter-level filter of its own and no `type`
 * fetched at all — so a dataset reached the feed through that path exactly
 * as before the round-1 fix. Rather than adding a fourth per-channel filter
 * (and risking a fifth path missed later the same way), this function is
 * THE single choke point `feed/dedup.ts`'s `dedupItems` applies to every
 * candidate before any clustering/merging runs, so every current and future
 * OpenAlex-derived channel is protected whether or not it remembers to
 * filter itself — the adapter-level filters stay too, as defence in depth,
 * not as the only line of defence.
 *
 * Deliberately scoped to `source === "openalex"` only: DBLP and PubMed each
 * populate `metadata.workType` from their OWN, differently-shaped
 * vocabularies (PubMed's `pubtype` legitimately includes a value literally
 * named "Dataset" — a completely different, uppercase, unrelated vocabulary
 * from OpenAlex's lowercase-kebab `type`), and B's original investigation
 * explicitly left that a future, unshipped decision (POLICY 3) rather than
 * an active one — this function must never accidentally widen today's fix
 * to sources it was never measured against.
 */
export function isExcludedOpenAlexRawItem(item: RawItem): boolean {
  if (item.source !== "openalex") return false;
  const t = item.metadata?.workType?.toLowerCase();
  return t ? EXCLUDED_OPENALEX_TYPES.has(t) : false;
}

// Pick the most useful URL for a paper. Order of preference:
//   1. Best open-access location (PDF if available, else landing page) —
//      these are confirmed-free and won't 403 the reader.
//   2. open_access.oa_url — same idea, slightly older field name.
//   3. DOI URL — canonical but often hits a paywall.
//   4. OpenAlex's own page — last resort.
function bestUrl(w: OpenAlexWork): string {
  const oa = w.best_oa_location;
  if (oa?.pdf_url) return oa.pdf_url;
  if (oa?.landing_page_url) return oa.landing_page_url;
  if (w.open_access?.oa_url) return w.open_access.oa_url;
  if (w.doi) {
    return `https://doi.org/${w.doi.replace(/^https?:\/\/doi\.org\//i, "")}`;
  }
  return w.id;
}

export function openAlexWorkToRawItem(w: OpenAlexWork): RawItem {
  const abstract = cleanDisplayText(reconstructAbstract(w.abstract_inverted_index));
  const doi = w.doi ?? undefined;
  const topicTags = [
    ...(w.primary_topic ? [w.primary_topic.display_name] : []),
    ...(w.topics ?? []).map((topic) => topic.display_name),
  ]
    .map(cleanDisplayText)
    .filter(Boolean);
  const keywordTags = (w.keywords ?? [])
    .filter((keyword) => (keyword.score ?? 0) >= 0.2)
    .map((keyword) => cleanDisplayText(keyword.display_name))
    .filter(Boolean);
  const legacyConceptTags = (w.concepts ?? [])
    .filter((c) => c.level >= 1 && c.level <= 3)
    .map((c) => cleanDisplayText(c.display_name))
    .filter(Boolean);
  const tags = Array.from(
    new Set([...keywordTags, ...topicTags, ...legacyConceptTags]),
  ).slice(0, 10);
  const preferenceSignals = normalizePreferenceConcepts([
    ...(w.primary_topic
      ? [
          {
            key: preferenceKey(
              w.primary_topic.display_name,
              "openalex_topic",
              w.primary_topic.id,
            ),
            label: cleanDisplayText(w.primary_topic.display_name),
            source: "openalex_topic" as const,
            confidence: w.primary_topic.score,
          },
        ]
      : []),
    ...(w.topics ?? []).map((topic) => ({
      key: preferenceKey(topic.display_name, "openalex_topic", topic.id),
      label: cleanDisplayText(topic.display_name),
      source: "openalex_topic" as const,
      confidence: topic.score,
    })),
    ...(w.keywords ?? []).map((keyword) => ({
      key: preferenceKey(keyword.display_name, "openalex_keyword", keyword.id),
      label: cleanDisplayText(keyword.display_name),
      source: "openalex_keyword" as const,
      confidence: keyword.score,
    })),
    ...(w.concepts ?? [])
      .filter((concept) => concept.level >= 1 && concept.level <= 5)
      .map((concept) => ({
        key: preferenceKey(
          concept.display_name,
          "openalex_concept",
          concept.id,
        ),
        label: cleanDisplayText(concept.display_name),
        source: "openalex_concept" as const,
        confidence: concept.score,
      })),
  ]);
  return {
    id: normalizeOpenAlexId(w.id),
    source: "openalex",
    title: cleanDisplayText(w.title),
    authors: (w.authorships ?? [])
      .map((a) => a.author?.display_name)
      .map(cleanDisplayText)
      .filter((n): n is string => Boolean(n)),
    leadAffiliation: leadAffiliationOf(w.authorships ?? []),
    abstract: abstract || undefined,
    url: bestUrl(w),
    publishedAt: w.publication_date || "",
    venue: cleanDisplayTextOrUndefined(w.primary_location?.source?.display_name),
    tags: tags.length > 0 ? tags : undefined,
    metadata: {
      citationCount: w.cited_by_count,
      doi,
      // DATASET-RECORDS (§1bl): prefer OpenAlex's own `type`, falling back to
      // the legacy `type_crossref` only when `type` is absent (kept
      // harmlessly in case OpenAlex ever repopulates it for some record type
      // this investigation didn't sample). Casing is passed through
      // unchanged, same as before this fix — see `isReviewLike` (which
      // lowercases before comparing) and `effectiveOpenAlexType` above
      // (the exclusion filter's own, separately-lowercased read of this same
      // preference).
      workType: cleanDisplayTextOrUndefined(w.type ?? w.type_crossref),
      preferenceSignals,
    },
  };
}

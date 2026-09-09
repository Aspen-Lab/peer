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
  type_crossref?: string | null;
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
      workType: cleanDisplayTextOrUndefined(w.type_crossref),
      preferenceSignals,
    },
  };
}

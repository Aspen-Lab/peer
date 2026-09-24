// What the reader has already read or kept that this paper stands near.
//
// A paper page that Peer could not read the full text of ended in air: the
// notes block, the record, and half a column of nothing. The one thing the
// page knows and did not say is where this paper sits among the reader's own
// papers — the ones filed under the same topics, in the library the graph on
// the briefing is drawn from. That is the reader's own context for the paper,
// and it costs no request.
//
// Topics are OpenAlex's filing plus the terms Peer cleaned from each paper's
// own words, matched case-blind. Two papers that share one topic are near;
// more shared, nearer. The paper itself is never its own neighbour.

import type { Paper } from "@/types";
import { filedUnder, type LibraryEntry } from "./graph";
import { OFF_DOMAIN } from "@/lib/papers/plate-terms";

export interface RelatedPaper {
  id: string;
  title: string;
  /** The topics it shares with this paper, as this paper spells them. */
  shared: string[];
  /** Read (in the library) or kept (on the shelf) — kept wins when both. */
  kind: "read" | "saved";
}

const MAX_RELATED = 5;

function key(label: string): string {
  return label.trim().toLocaleLowerCase().replace(/\s+/g, " ");
}

/** Every topic this paper is filed under or names, as the record spells it. */
export function topicsOf(paper: Pick<Paper, "preferenceSignals" | "summaryExperimentKeywords">): string[] {
  const seen = new Map<string, string>();
  for (const label of [
    ...filedUnder(paper),
    ...(paper.preferenceSignals ?? [])
      .filter((s) => s.source === "openalex_concept" || s.source === "openalex_keyword")
      .map((s) => s.label),
  ]) {
    // OpenAlex disambiguates into the wrong field often enough to matter:
    // a protein paper filed under "Cleavage (geology)". The bracket is the
    // tell, and `plate-terms` already keeps the list of fields that are it.
    if (OFF_DOMAIN.test(label)) continue;
    const k = key(label);
    if (k.length >= 3 && !seen.has(k)) seen.set(k, label.trim());
  }
  return [...seen.values()];
}

export function relatedInLibrary(
  paper: Pick<Paper, "id" | "preferenceSignals" | "summaryExperimentKeywords">,
  library: Record<string, LibraryEntry>,
  saved: Paper[],
  limit = MAX_RELATED,
): RelatedPaper[] {
  const mine = new Map(topicsOf(paper).map((label) => [key(label), label]));
  if (mine.size === 0) return [];

  const candidates = new Map<string, { title: string; topics: Set<string>; kind: RelatedPaper["kind"]; when: string }>();
  for (const entry of Object.values(library)) {
    if (entry.id === paper.id) continue;
    candidates.set(entry.id, {
      title: entry.title,
      topics: new Set([...entry.filed, ...entry.terms].map(key)),
      kind: "read",
      when: entry.readAt,
    });
  }
  for (const s of saved) {
    if (s.id === paper.id) continue;
    const topics = new Set(topicsOf(s).map(key));
    const existing = candidates.get(s.id);
    if (existing) {
      for (const t of topics) existing.topics.add(t);
      existing.kind = "saved";
    } else {
      candidates.set(s.id, { title: s.title, topics, kind: "saved", when: s.publishedDate ?? "" });
    }
  }

  const out: (RelatedPaper & { when: string })[] = [];
  for (const [id, c] of candidates) {
    const shared: string[] = [];
    for (const [k, label] of mine) if (c.topics.has(k)) shared.push(label);
    if (shared.length === 0) continue;
    out.push({ id, title: c.title, shared, kind: c.kind, when: c.when });
  }
  return out
    .sort((a, b) => b.shared.length - a.shared.length || b.when.localeCompare(a.when) || a.title.localeCompare(b.title))
    .slice(0, limit)
    .map(({ when: _when, ...rest }) => rest);
}

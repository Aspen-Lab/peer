// Where a search can start from, before a word is typed.
//
// The search page was a headline, a box and nothing — the reader arrived with
// a whole reading life in this browser and the page pretended not to know it.
// These are the starts it can offer without a network call:
//
//   the reader's own topics    what they told Peer they work on
//   terms from their reading   what the papers they read were actually about
//   people on their shelf      the authors they kept
//   what they searched before  this browser's own recent queries
//
// Every one of them is a query waiting to be run. None of them is fetched;
// they are all in the stores already.

import type { Paper } from "@/types";
import type { LibraryEntry } from "@/lib/library/graph";

export interface Start {
  /** The query the tap runs. */
  query: string;
  /** How many papers stand behind it, where that means something. */
  count?: number;
}

const MAX_TERMS = 12;
const MAX_AUTHORS = 8;
/** A term two papers share is a thread; one paper's term is that paper's. */
const MIN_TERM_PAPERS = 2;

function normalize(term: string): string {
  return term.trim().toLocaleLowerCase().replace(/\s+/g, " ");
}

/**
 * The terms the reader's papers were about, most-shared first. Read papers
 * carry their cleaned terms and their filed topics; saved papers carry the
 * concepts they were filed under. Case folds so "Machine learning" and
 * "machine learning" are one thread, and the first spelling seen is the one
 * shown.
 */
export function termsFromReading(
  library: Record<string, LibraryEntry>,
  saved: Paper[],
  exclude: string[] = [],
): Start[] {
  const skip = new Set(exclude.map(normalize));
  const seen = new Map<string, { label: string; papers: Set<string> }>();
  const add = (paperId: string, label: string) => {
    const key = normalize(label);
    if (!key || key.length < 3 || skip.has(key)) return;
    const entry = seen.get(key) ?? { label: label.trim(), papers: new Set<string>() };
    entry.papers.add(paperId);
    seen.set(key, entry);
  };
  for (const entry of Object.values(library)) {
    for (const t of entry.terms) add(entry.id, t);
    for (const t of entry.filed) add(entry.id, t);
  }
  for (const paper of saved) {
    for (const signal of paper.preferenceSignals ?? []) {
      if (signal.source === "openalex_topic" || signal.source === "openalex_concept") {
        add(paper.id, signal.label);
      }
    }
  }
  return [...seen.values()]
    .filter((e) => e.papers.size >= MIN_TERM_PAPERS)
    .sort((a, b) => b.papers.size - a.papers.size || a.label.localeCompare(b.label))
    .slice(0, MAX_TERMS)
    .map((e) => ({ query: e.label, count: e.papers.size }));
}

/** One name out of `authors[0]`. Some records arrive with the whole byline
 *  in the first slot — "Mrs. C. Surekha, Dr. S. A. Lohi (Bode), Ms. S.
 *  Sathiya" — and a start that long is not a person, it is a paragraph. */
function firstName(raw: string | undefined): string {
  return (raw ?? "").split(/,|;|\band\b|&/)[0].trim();
}

/** The first authors of what was kept — the people the reader chose to keep
 *  reading. First author only: a search for the ninth name on a consortium
 *  paper finds the consortium, not a person. */
export function authorsFromShelf(saved: Paper[]): Start[] {
  const seen = new Map<string, { label: string; papers: number }>();
  for (const paper of saved) {
    const first = firstName(paper.authors[0]);
    if (!first) continue;
    const key = normalize(first);
    const entry = seen.get(key) ?? { label: first, papers: 0 };
    entry.papers += 1;
    seen.set(key, entry);
  }
  return [...seen.values()]
    .sort((a, b) => b.papers - a.papers || a.label.localeCompare(b.label))
    .slice(0, MAX_AUTHORS)
    .map((e) => ({ query: e.label, count: e.papers > 1 ? e.papers : undefined }));
}

// ── Recent searches: this browser's, never uploaded ──

export const RECENT_KEY = "peer-recent-searches";
export const MAX_RECENT = 8;

/** Fired on `window` when this tab writes the list — the `storage` event
 *  only reaches OTHER tabs, and the page that just searched is this one. */
export const RECENT_EVENT = "peer:recent-searches";

/** The stored string, as a list. Guarded: a corrupt entry is an empty list,
 *  never a thrown page. */
export function parseRecent(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((x): x is string => typeof x === "string" && x.trim().length > 0).slice(0, MAX_RECENT);
  } catch {
    return [];
  }
}

/** Newest first. A private window can throw on the read itself. */
export function readRecent(storage: Pick<Storage, "getItem"> | null | undefined): string[] {
  if (!storage) return [];
  try {
    return parseRecent(storage.getItem(RECENT_KEY));
  } catch {
    return [];
  }
}

/** The list with `query` at the front and any earlier spelling of it gone. */
export function withRecent(list: string[], query: string): string[] {
  const q = query.trim();
  if (q.length < 2) return list;
  const key = normalize(q);
  return [q, ...list.filter((x) => normalize(x) !== key)].slice(0, MAX_RECENT);
}

export function writeRecent(storage: Pick<Storage, "setItem" | "removeItem"> | null | undefined, list: string[]): void {
  if (!storage) return;
  try {
    if (list.length === 0) storage.removeItem(RECENT_KEY);
    else storage.setItem(RECENT_KEY, JSON.stringify(list.slice(0, MAX_RECENT)));
    if (typeof window !== "undefined") window.dispatchEvent(new Event(RECENT_EVENT));
  } catch {
    // The search already ran; remembering it is a convenience.
  }
}

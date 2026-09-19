// Citing a paper from a note: the key it is cited by, and the words it reads as.
//
// The key is BibTeX's convention — first author's surname, year, first word
// of the title that is not a function word: `rose2024applications`. A
// reader who exports to LaTeX gets keys they would have typed themselves.
// Nothing here is guessed: every part comes from the paper's own record, and a
// part the record lacks is left out rather than filled in.

import type { Paper } from "@/types";
import type { Citable, Source } from "./types";

const FUNCTION_WORDS = new Set([
  "a", "an", "the", "on", "of", "and", "for", "to", "in", "with", "by", "from",
  "at", "as", "is", "are", "towards", "toward", "via", "using", "into", "its",
]);

const SUFFIXES = /^(jr|sr|ii|iii|iv)\.?$/i;

/** Letters only, accents folded: "Müller" → "muller". */
function slug(word: string): string {
  return word
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

/** The surname as the record writes it: "Dr. R. Reena Rose" → "Rose",
 *  "Smith, John" → "Smith". */
export function surname(author: string): string {
  const name = author.trim();
  if (!name) return "";
  const base = name.includes(",") ? name.split(",")[0] : name;
  const parts = base.split(/\s+/).filter(Boolean);
  let i = parts.length - 1;
  while (i > 0 && SUFFIXES.test(parts[i])) i--;
  return parts[i] ?? "";
}

/** The year from an ISO date or a bare year; nothing when there is none. */
export function yearOf(date?: string): number | undefined {
  const m = date?.match(/\b(1[89]\d\d|20\d\d|2100)\b/);
  return m ? Number(m[1]) : undefined;
}

function firstWord(title: string): string {
  for (const raw of title.split(/[\s:—–-]+/)) {
    const w = slug(raw);
    if (w && !FUNCTION_WORDS.has(w)) return w;
  }
  return slug(title.split(/\s+/)[0] ?? "") || "untitled";
}

/** `rose2024applications`, before it is made unique within a note. */
export function baseKey(paper: Pick<Citable, "title" | "authors" | "publishedDate">): string {
  const who = slug(surname(paper.authors[0] ?? ""));
  const year = yearOf(paper.publishedDate) ?? "";
  return `${who}${year}${firstWord(paper.title)}` || "untitled";
}

/** The key for this paper in a note that already holds `sources`: the one it
 *  already has if it is cited there, else the base key, suffixed b, c, … until
 *  no other paper holds it. */
export function keyFor(paper: Citable, sources: Record<string, Source>): string {
  const existing = Object.values(sources).find((s) => s.paperId === paper.id);
  if (existing) return existing.key;
  const base = baseKey(paper);
  if (!sources[base]) return base;
  for (let i = 1; i < 26; i++) {
    const key = `${base}${String.fromCharCode(97 + i)}`;
    if (!sources[key]) return key;
  }
  return `${base}${Object.keys(sources).length}`;
}

export function sourceOf(paper: Citable, key: string): Source {
  return {
    key,
    paperId: paper.id,
    title: paper.title,
    authors: paper.authors,
    venue: paper.venue || undefined,
    year: yearOf(paper.publishedDate),
    doi: paper.doi,
    url: paper.url,
  };
}

/** The citation as it reads in the text: "Rose et al., 2024". */
export function authorYear(source: Pick<Source, "authors" | "year" | "title">): string {
  const names = source.authors.map(surname).filter(Boolean);
  const who =
    names.length === 0
      ? source.title.split(/\s+/).slice(0, 3).join(" ")
      : names.length === 1
        ? names[0]
        : names.length === 2
          ? `${names[0]} & ${names[1]}`
          : `${names[0]} et al.`;
  return source.year ? `${who}, ${source.year}` : `${who}, n.d.`;
}

/** A paper from the shelf or the briefing, as a note sees it. */
export function citableFromPaper(paper: Paper): Citable {
  return {
    id: paper.id,
    title: paper.title,
    authors: paper.authors,
    venue: paper.venue,
    publishedDate: paper.publishedDate,
    doi: paper.doi,
    url:
      paper.linkPaper ??
      (paper.doi ? `https://doi.org/${paper.doi}` : undefined) ??
      paper.linkArxiv ??
      paper.linkScholar,
    abstract: paper.summaryIntro || undefined,
  };
}

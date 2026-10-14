// The reading map (spec D9, first half; rulings §1f.1–4): before reading, the
// paper's shape — which sections it has, what each one is for, how long each
// takes, and one line per paragraph saying how it opens.
//
// Tier 0 and pure: a function of the extracted document alone, with no model,
// no fetch and no `node:` import, so it can run in the browser. It lists
// exactly what the page's body renders — the same sections in the same order
// (`readableSections`), the same paragraphs with the same indices — so a map
// row is a body section and a paragraph line is
// `ReadingSection.paragraphs[index]`, the anchor a click scrolls to.
//
// Nothing here is inferred beyond the document's own evidence: the role is a
// reader's name for the bucket the heading already has; the opening line is
// the paragraph's own first sentence, whole — or, when that sentence is too
// long for a row's fold, cut at a word boundary and marked with one "…" —
// never rewritten.

import { tokenize } from "@/lib/scoring/tokenize";
import { canonicalize, isGenericTerm, termMatches, termOccurrences } from "@/lib/scoring/term-expand";
import { parseBlockMarker } from "@/lib/text/math";
import { headingNumber, numbersHeading, type ExtractedDocument, type ExtractedEquation, type ExtractedSection } from "./html-text";
// Type only: erased at runtime, so `reading.ts` can import this module
// without the two importing each other.
import type { ReadingEquation } from "./reading";
import { isBoilerplate, scoreSentence, splitSentences } from "./skim";

// ── The body's sections and paragraphs (§1f.1; moved from reading.ts in P1-04) ──

/**
 * One section's text, split into the paragraphs the page renders.
 *
 * A marker paragraph is where a display equation stood: the equation goes
 * after the paragraph before it, and the marker goes away. A step number on
 * its own line — LaTeXML renders an algorithm listing one cell per line, so
 * "1:" and "2:" arrive as paragraphs of their own — and anything with no
 * letter in it is debris, and goes too. Each paragraph is whitespace-
 * normalised.
 *
 * P1-01 (§1f.1): exported so the reading map enumerates exactly these
 * paragraphs, with exactly these indices — a map line ↔
 * `ReadingSection.paragraphs[index]`.
 */
export function sectionParagraphs(
  section: Pick<ExtractedSection, "text">,
  lifted: readonly ExtractedEquation[],
): { paragraphs: string[]; equations: ReadingEquation[] } {
  const paragraphs: string[] = [];
  const equations: ReadingEquation[] = [];
  for (const raw of section.text.split(/\n{2,}/)) {
    const para = raw.replace(/\s+/g, " ").trim();
    if (!para) continue;
    const k = parseBlockMarker(para);
    if (k !== null) {
      const eq = lifted[k];
      if (eq && (eq.latex || eq.text)) {
        equations.push({
          ...(eq.latex ? { latex: eq.latex } : {}),
          ...(eq.text ? { text: eq.text } : {}),
          ...(eq.number ? { number: eq.number } : {}),
          after: paragraphs.length - 1,
        });
      }
      continue;
    }
    if (/^\d+[:.]?$/.test(para) || !/\p{L}/u.test(para)) continue;
    paragraphs.push(para);
  }
  return { paragraphs, equations };
}

/**
 * The sections the page renders, in order, each with its paragraphs.
 *
 * The abstract is dropped: the page sets it from the record, sentence by
 * sentence, with the ink on it, and the extractor's copy is the same text
 * without the marks. A section with nothing under its heading is dropped too
 * — an extractor artefact, not a part of the paper — unless it numbers the
 * section after it (P10-04, review 3.3): "2. RESULTS AND DISCUSSION" holding
 * only "2.1 …" is the paper's own group heading, a row of the map and a
 * heading of the body with no paragraphs under it.
 *
 * P1-01 (§1f.1): exported so the reading map and the body are one list —
 * map row k ↔ body section k.
 */
export interface ReadableSection {
  /** The section's id — its own, or, for a document read before ids existed,
   *  the one `withSectionIds` would have given it (`s<index>` over the
   *  document's sections, the abstract included). */
  id: string;
  section: ExtractedSection;
  paragraphs: string[];
  equations: ReadingEquation[];
}

export function readableSections(doc: ExtractedDocument): ReadableSection[] {
  const out: ReadableSection[] = [];
  const lifted = doc.equations ?? [];
  doc.sections.forEach((section, index) => {
    if (section.canonical === "abstract") return;
    const { paragraphs, equations } = sectionParagraphs(section, lifted);
    if (paragraphs.length === 0 && equations.length === 0) {
      const next = doc.sections[index + 1];
      if (!next || !numbersHeading(section.heading, next.heading)) return;
    }
    out.push({ id: section.id ?? `s${index}`, section, paragraphs, equations });
  });
  return out;
}

/** What a section is for, from its bucket. `body` is the honest "not placed":
 *  the page shows no role tag for it. */
export type ReadingRole = "setup" | "method" | "evidence" | "interpretation" | "apparatus" | "body";

export interface ReadingMapParagraph {
  /** The paragraph's index in the body section — `ReadingSection.paragraphs[index]`. */
  index: number;
  /** The first non-boilerplate sentence, whole, and, while it is short, the
   *  sentences that follow it (≤ 400 characters in all). A first sentence
   *  longer than that is cut at a word boundary and ends in one "…" (P9-56):
   *  a verbatim paragraph substring, plus that mark when it is cut. Null when
   *  no non-boilerplate sentence exists. */
  opening: string | null;
}

export interface ReadingMapSection {
  id: string;
  heading: string;
  canonical: string;
  role: ReadingRole;
  /** PDFs only: the page the section starts on. */
  page?: number;
  words: number;
  minutes: number;
  paragraphs: ReadingMapParagraph[];
  /** P10-04 (review 3.3): how deep the paper numbers this heading — 1 for "2.", 2 for "2.1", 3 for "2.1.1"
   *  (deeper is 3). An unnumbered heading is 1: a heading with no number says nothing about its depth, and
   *  a guess would nest "Conclusions" under whatever numbered section stands above it. Absent in a map
   *  built before levels existed; the view then reads the depth off the heading. */
  level?: 1 | 2 | 3;
  /** The id of the nearest row before this one with a smaller level, when there is one. A row with no
   *  paragraphs and a child is a group row ("4. EXPERIMENTAL SECTION"). */
  parentId?: string;
}

export interface ReadingMap {
  sections: ReadingMapSection[];
  /** From the total word count, not the sum of the rounded section minutes. */
  totalMinutes: number;
}

/** §1f.2: the bucket, renamed for a reader. No positional guessing. */
const ROLE: Readonly<Record<string, ReadingRole>> = {
  introduction: "setup",
  related_work: "setup",
  methods: "method",
  results: "evidence",
  discussion: "interpretation",
  conclusion: "interpretation",
  limitations: "interpretation",
  references: "apparatus",
  acknowledgments: "apparatus",
  supplementary: "apparatus",
};

export function roleOf(canonical: string): ReadingRole {
  return ROLE[canonical] ?? "body";
}

/** Words per minute for a dense paper (the blueprint's conservative rate). */
const WORDS_PER_MINUTE = 180;
const OPENING_MIN = 40;
/**
 * The longest opening line, in characters: a first sentence of this length or less is shown whole, and a longer
 * one is cut with a "…" (`cutFirstSentence`), so a cut line never reads as a finished one (P9-56, N9; ruling
 * §1h.73 (b)). It was 160, and 39 of the 53 lines on the owner's paper were cut mid-sentence with no mark.
 * 400 because that paper puts 92 % of its first sentences under it (56 of the 61 long paragraphs; median 207,
 * p90 372, max 735), so nine lines in ten are whole sentences, and because an opening is read inside a row's
 * fold: a longer one would turn the map from a list of lines into a page of text.
 */
const OPENING_MAX = 400;

/** §1f.3: the same count the contents rail shows (`paper-contents.tsx`). */
function wordCount(paragraph: string): number {
  return paragraph.split(/\s+/).length;
}

/** Escape a sentence for a whitespace-flexible source lookup. `splitSentences`
 * trims sentences (and can join a lower-case continuation), so this locates
 * the exact source span without rebuilding it or losing its separators. */
function sentenceSourceSpan(paragraph: string, sentence: string, from: number): [number, number] | null {
  const source = sentence
    .split(/\s+/)
    .map((piece) => piece.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("\\s+");
  const match = new RegExp(source).exec(paragraph.slice(from));
  if (!match || match.index === undefined) return null;
  const start = from + match.index;
  return [start, start + match[0].length];
}

/**
 * A first sentence longer than `OPENING_MAX`, cut where the reader can see it is cut — the lead caption's rule
 * (`leadCaption`, P9-49): at the last whole word, with one "…" and no stop, comma, colon or dash in front of it,
 * so "films.…" never stands for a finished sentence. The line, mark included, is at most `OPENING_MAX`
 * characters: the room is one short, for the mark. What stands before the mark is the paragraph's own text; the
 * stop of an abbreviation ("et al.") that the cut lands on goes like any other.
 */
function cutFirstSentence(paragraph: string, start: number): string {
  const room = start + OPENING_MAX - 1;
  // Cut at the last white space the room reaches, the room's own last character included: a space there means
  // the room already ends on a word's end. An unbroken run (a URL) has no space before the cap; the cut is then
  // hard, and still marked.
  let cut = room;
  for (let index = room; index > start; index--) {
    if (/\s/.test(paragraph[index])) {
      cut = index;
      break;
    }
  }
  const kept = paragraph
    .slice(start, cut)
    .replace(/[\s,;:.!?\-–—(\[]+$/, "")
    // A hard cut between the halves of a surrogate pair keeps neither.
    .replace(/[\uD800-\uDBFF]$/, "");
  // A run of nothing but marks has nothing to show before the "…": show the room as it stands.
  return `${kept || paragraph.slice(start, room)}…`;
}

/**
 * §1f.21 (P1-10): start with the paragraph's first non-boilerplate sentence,
 * then extend through following complete sentences only until it reaches 40
 * characters or the next sentence would exceed 400. The span comes directly
 * from the paragraph: separators are preserved and sentence strings are never
 * joined. A later long sentence therefore cannot replace a short opening.
 * A sentence the source lookup cannot place ends the growth (P1-09b item 4):
 * before the opening has started there is nothing to show, so null; after,
 * the opening found so far stands.
 *
 * P9-56 (N9): a first sentence of at most 400 characters is the opening,
 * whole; a longer one is cut at a word with one "…" (`cutFirstSentence`).
 * The only text the opening holds that the paragraph does not is that mark.
 */
export function openingOf(paragraph: string): string | null {
  let cursor = 0;
  let start: number | null = null;
  let end: number | null = null;

  for (const sentence of splitSentences(paragraph)) {
    const span = sentenceSourceSpan(paragraph, sentence, cursor);
    if (!span) {
      if (start === null) return null;
      break;
    }
    const [sentenceStart, sentenceEnd] = span;
    cursor = sentenceEnd;

    if (start === null) {
      if (isBoilerplate(sentence)) continue;
      start = sentenceStart;
      end = sentenceEnd;
      if (end - start > OPENING_MAX) return cutFirstSentence(paragraph, start);
      continue;
    }

    if (end! - start >= OPENING_MIN || sentenceEnd - start > OPENING_MAX) break;
    end = sentenceEnd;
  }

  return start === null || end === null ? null : paragraph.slice(start, end);
}

/** The map of sections already split for the body (`readableSections`) —
 *  how `buildReading` builds it, from the same split as the body. */
export function readingMapOf(rendered: readonly ReadableSection[]): ReadingMap {
  let totalWords = 0;
  // P10-04: the rows still open above this one — each with the level it was given — so the nearest
  // shallower row before a row is its parent.
  const open: Array<{ id: string; level: 1 | 2 | 3 }> = [];
  const sections = rendered.map(({ id, section, paragraphs }): ReadingMapSection => {
    const words = paragraphs.reduce((sum, paragraph) => sum + wordCount(paragraph), 0);
    totalWords += words;
    const level = levelOf(section.heading);
    while (open.length > 0 && open[open.length - 1].level >= level) open.pop();
    const parentId = open[open.length - 1]?.id;
    open.push({ id, level });
    return {
      id,
      heading: section.heading,
      canonical: section.canonical,
      role: roleOf(section.canonical),
      ...(typeof section.page === "number" ? { page: section.page } : {}),
      words,
      minutes: words > 0 ? Math.max(1, Math.ceil(words / WORDS_PER_MINUTE)) : 0,
      paragraphs: paragraphs.map((paragraph, index) => ({ index, opening: openingOf(paragraph) })),
      level,
      ...(parentId !== undefined ? { parentId } : {}),
    };
  });
  return { sections, totalMinutes: Math.ceil(totalWords / WORDS_PER_MINUTE) };
}

/** P10-04: a heading's level — the parts of its number ("2." 1, "2.1" 2, "2.1.1" 3, deeper 3); no number, 1. */
function levelOf(heading: string): 1 | 2 | 3 {
  const number = headingNumber(heading);
  const depth = number ? number.split(".").length : 1;
  return depth >= 3 ? 3 : depth === 2 ? 2 : 1;
}

/**
 * P10-04 (review 3.3): what a group row stands for — the words and the minutes of every row under it, by
 * `parentId` (a child's own, so a nested group adds its children, and no row is counted twice). Keyed by
 * the group row's id; a row with paragraphs of its own, or none under it, is not in the map. The minutes come
 * from the summed words, as a row's do and as the map's total does (`totalMinutes`: "from the total word
 * count, not the sum of the rounded section minutes") — 1,562 words are 9 minutes, not the 11 that five
 * rows each rounded up would add to.
 */
export function groupTotals(map: ReadingMap): Map<string, { words: number; minutes: number }> {
  const byId = new Map(map.sections.map((row) => [row.id, row]));
  const totals = new Map<string, { words: number; minutes: number }>();
  for (const row of map.sections) {
    if (row.paragraphs.length > 0 || row.words > 0) continue;
    const below = map.sections.filter((other) => {
      for (let up = other.parentId; up !== undefined; up = byId.get(up)?.parentId) if (up === row.id) return true;
      return false;
    });
    if (below.length === 0) continue;
    const words = below.reduce((sum, r) => sum + r.words, 0);
    totals.set(row.id, { words, minutes: words > 0 ? Math.max(1, Math.ceil(words / WORDS_PER_MINUTE)) : 0 });
  }
  return totals;
}

export function buildReadingMap(doc: ExtractedDocument): ReadingMap {
  return readingMapOf(readableSections(doc));
}

// ── The Tier 0 route (spec D9 second half; rulings §1f.6–8, §1h.78) ────
//
// For each question and each section: how much it says about the question,
// from counts a reader can check — which of the question's specific terms the
// section mentions, how often — with one of the section's sentences, verbatim,
// as evidence. P10-06 (the owner's review 3.2, 3.4): the section's grade is
// relative to the paper's other sections. Each section has a score (a term in
// few sections counts for much, one in all of them for little; a long section
// does not win by length alone), and the tier is the score's share of the
// best one — strong, medium, faint, none — with the strongest tier worn by
// three rows at most, so a specific question lights a few sections, not the
// whole paper. The score itself is not reported (it is not a fact a reader can
// check); the counts behind it are. It runs in the browser on the reading the
// page already holds: the questions are the reader's own and never leave this
// function.

/** `strong`: among the three best sections and at least 0.6 of the best score. `medium`: at least 0.3 of it.
 *  `faint`: any mention. `none`: no mention. */
export type RouteTier = "strong" | "medium" | "faint" | "none";

export interface RouteSection {
  tier: RouteTier;
  /** The specific terms the section mentions, as the reader typed them
   *  (lower-cased), with how often; most mentioned first, then by term. */
  hits: { term: string; count: number }[];
  /** The matching sentence that says most (`scoreSentence`), verbatim.
   *  Absent when no sentence matches. */
  evidence?: string;
  /** Indices of the paragraphs that mention a term — the map's indices. */
  paragraphs: number[];
  /** P10-06 (rule 3): the paragraphs of `paragraphs` that say most by the same score over their own
   *  words — they carry the section's tier on the map's paragraph lines, the others a faint one.
   *  Absent for a section with no mention (and for a mark that is not a question's). */
  topParagraphs?: number[];
}

export interface RouteResult {
  byQuestion: {
    question: string;
    /** Fewer than two specific terms: no route for this question. */
    vague: boolean;
    sections: Record<string, RouteSection>;
  }[];
  /** Every question is vague: the page shows the "ask something more
   *  specific" hint. False with no questions. */
  vague: boolean;
}

/** A question needs this many specific terms to be routed. */
const MIN_SPECIFIC_TERMS = 2;

/**
 * P1-02b (§1f.15): words a question is made of that say nothing about what
 * it asks. `tokenize`'s own stoplist (`lib/scoring/tokenize.ts`) is shared
 * with feed scoring and has neither group, so it is left alone and the route
 * keeps its own list here:
 * - question and function words ("how", "what", "does", "about", …) — routed
 *   on, "What is LCO?" matched every section that says "what";
 * - words that name a part of any paper rather than its content ("method",
 *   "conclusions", "results", "gist", …) — every paper has them, so they
 *   point nowhere. The generic chips ("Can I use this method in my own
 *   work?", "Do the conclusions hold up?") are vague at Tier 0, which is
 *   honest: word matching cannot answer them, and the map's roles already
 *   show where the method and the conclusions are;
 * - the example templates' words (P1-09b) — "help", "relate", "say", "here"
 *   — so "Does this help with growth?" is one term and vague, and "Does
 *   this help with grain growth?" routes on `grain` and `growth`.
 * Compared on the canonical form.
 */
const ROUTE_STOPLIST: ReadonlySet<string> = new Set([
  // Question and function words.
  "how", "what", "why", "which", "when", "where", "who", "whom", "whose",
  "does", "do", "did", "can", "could", "should", "would", "will", "may", "might",
  "about", "during", "between", "than", "this", "that", "these", "those",
  // Not in §1f.15's list, added so its own requirement holds: without them
  // the chip "Just get the gist" keeps the terms `just`, `get` and is routed.
  "just", "get",
  // Words naming a part of any paper.
  "paper", "study", "work", "own", "use", "used", "using", "differ", "differs",
  "different", "difference", "hold", "holds", "conclusion", "conclusions",
  "result", "results", "method", "methods", "approach", "finding", "findings", "gist",
  // The example templates' own words (P1-09b; `ASK.examples` in
  // `components/reader/copy.ts`): "Does this help with …?", "How does this
  // relate to …?", "What does it say about …?", "Could I use … here?" route
  // on their content words alone. `could` and `use` are already above.
  "help", "helps", "relate", "relates", "related", "say", "says", "here",
]);

/**
 * `tokenize`'s own stoplist, copied: `lib/scoring/tokenize.ts` keeps `STOPWORDS` module-private
 * and `lib/scoring/` is not modified here (P9-05). It is already gone from every token
 * `specificTerms` sees; it is listed so `FUNCTION_WORDS` is a superset of it by construction, and
 * `reading-map.test.ts` fails the day the source list gains a word this copy lacks.
 */
const TOKENIZE_STOPWORDS: readonly string[] = [
  "the", "a", "an", "of", "is", "are", "was", "were", "be", "been", "being",
  "and", "or", "but", "for", "nor", "so", "yet", "to", "from", "in", "on",
  "at", "by", "with", "as", "into", "onto", "upon", "over", "under",
  "this", "that", "these", "those", "it", "its", "their", "there",
  "we", "our", "you", "your", "they", "them", "he", "she", "him", "her",
  "have", "has", "had", "do", "does", "did", "can", "could", "may", "might",
  "shall", "should", "will", "would", "must", "not", "no",
  "paper", "study", "work", "propose", "show", "present", "using", "based",
];

/**
 * P9-05 (X12): the function words a question holds, `tokenize`'s list lacking most of them. A tint's fact counts a term in the
 * body ("mentions film ×7, after ×2, change ×1"), and a preposition or an adverb counted there
 * says nothing about what the reader asked. A function word is never a term:
 * - prepositions: "after", "before", "during", "between", "within", "through", "across",
 *   "against", "among", "without" ("under" is in `tokenize`'s list);
 * - auxiliaries: "does", "did", "could", "would", "should", "might", "must" (all in
 *   `tokenize`'s list; named so the rule reads whole);
 * - determiners and pronouns: "which", "what", "whose" ("these", "those", "their", "there" are
 *   in `tokenize`'s list);
 * - adverbs and connectives: "also", "only", "very", "more", "most", "less", "than", "then",
 *   "when", "where", "while", "however", "therefore".
 * A content word stays, "change" included: a verb a reader asks about is a term.
 */
const FUNCTION_WORDS_BEYOND_TOKENIZE: readonly string[] = [
  "after", "before", "during", "between", "within", "through", "across", "against", "among", "without",
  "does", "did", "could", "would", "should", "might", "must",
  "these", "those", "their", "there", "which", "what", "whose",
  "also", "only", "very", "more", "most", "less", "than", "then", "when", "where", "while", "however", "therefore",
];

/** Compared on the canonical form, like `ROUTE_STOPLIST`. */
export const FUNCTION_WORDS: ReadonlySet<string> = new Set([...TOKENIZE_STOPWORDS, ...FUNCTION_WORDS_BEYOND_TOKENIZE]);

/**
 * §1f.6: the question's tokens (`tokenize`: lower-cased, stopwords and short
 * tokens already gone), one per canonical form, without the generic ones, without
 * `ROUTE_STOPLIST` (P1-02b) and without `FUNCTION_WORDS` (P9-05). Each is kept as the
 * reader typed it.
 */
export function specificTerms(question: string): string[] {
  const seen = new Set<string>();
  const terms: string[] = [];
  for (const token of tokenize(question)) {
    const canonical = canonicalize(token);
    if (
      !canonical ||
      seen.has(canonical) ||
      isGenericTerm(token) ||
      ROUTE_STOPLIST.has(canonical) ||
      FUNCTION_WORDS.has(canonical)
    ) {
      continue;
    }
    seen.add(canonical);
    terms.push(token);
  }
  return terms;
}

/** The idf floor: a term in every section still counts for a little, so a section that says it more often still ranks higher. */
const IDF_FLOOR = 0.1;
/** A section is strong from this share of the best score, medium from the second. */
const STRONG_SHARE = 0.6;
const MEDIUM_SHARE = 0.3;
/** At most this many rows carry the strongest tier. */
const MAX_STRONG_ROWS = 3;

/**
 * P10-06 (rule 1; review 3.2, 3.4): a score for each of `sections` from the counts of the question's terms in it.
 * `counts[i]` is how often term `i` occurs in the section (the same terms, in the same order, for every section),
 * `words` the section's length. The weight of a term is its rarity among these sections,
 * `idf = ln((N + 1) / (df + 1)) + 0.1` with N the number of sections and df the number that mention it — a term in
 * two sections counts for much, one in all of them for little — and a section scores
 * `Σ idf(term) × ln(1 + count(term)) ÷ ln(2 + words / 200)`: the log keeps a term repeated thirty times from
 * outweighing three terms said twice each, and the divisor keeps a long section from winning by length alone.
 * Pure; the score is a number to order by, never shown (it is not a fact a reader can check — the counts are).
 */
export function relevanceScores(sections: ReadonlyArray<{ counts: readonly number[]; words: number }>): number[] {
  const n = sections.length;
  const width = sections.reduce((most, section) => Math.max(most, section.counts.length), 0);
  const idf: number[] = [];
  for (let i = 0; i < width; i++) {
    const df = sections.reduce((seen, section) => seen + ((section.counts[i] ?? 0) >= 1 ? 1 : 0), 0);
    idf.push(Math.log((n + 1) / (df + 1)) + IDF_FLOOR);
  }
  return sections.map((section) => {
    let sum = 0;
    for (let i = 0; i < width; i++) sum += idf[i] * Math.log(1 + (section.counts[i] ?? 0));
    return sum / Math.log(2 + Math.max(0, section.words) / 200);
  });
}

/**
 * P10-06 (rule 2): the tier of each score, relative to the best of them. `strong` for a score of at least 0.6 of
 * the best and among the three highest (the earlier row first on a tie), so three rows at most; `medium` for at
 * least 0.3 of the best; `faint` for any other mention; `none` for a score of zero. A single mentioned section is
 * strong.
 */
export function gradeScores(scores: readonly number[]): RouteTier[] {
  const best = scores.reduce((most, score) => Math.max(most, score), 0);
  const leaders = new Set(
    scores
      .map((score, index) => ({ score, index }))
      .filter((row) => row.score > 0)
      .sort((a, b) => b.score - a.score || a.index - b.index)
      .slice(0, MAX_STRONG_ROWS)
      .map((row) => row.index),
  );
  const EPSILON = 1e-9;
  return scores.map((score, index) => {
    if (!(score > 0)) return "none";
    if (leaders.has(index) && score >= best * STRONG_SHARE - EPSILON) return "strong";
    if (score >= best * MEDIUM_SHARE - EPSILON) return "medium";
    return "faint";
  });
}

function wordsOf(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

/** What one section says about the terms, before it is graded against the paper's other sections. */
interface RoutedSection {
  section: RouteSection;
  /** How often each term occurs, aligned with the question's terms. */
  counts: number[];
  words: number;
  /** Whether the section has paragraphs of its own: a group row (a heading with only subsections) has none. */
  scored: boolean;
}

function routeSection(paragraphs: readonly string[], terms: readonly string[]): RoutedSection {
  // Canonicalised once per section per call (joined with a space), and once
  // per paragraph and per sentence for the matches below.
  const sectionText = canonicalize(paragraphs.join(" "));
  const hits = terms
    .map((term) => ({ term, count: termOccurrences(sectionText, term) }))
    .filter((hit) => hit.count >= 1)
    .sort((a, b) => b.count - a.count || (a.term < b.term ? -1 : a.term > b.term ? 1 : 0));
  const counts = terms.map((term) => hits.find((hit) => hit.term === term)?.count ?? 0);

  const mentioned: number[] = [];
  const matching: string[] = [];
  // Per paragraph, for the top paragraphs (rule 3): the counts of the terms in the ones that mention any.
  const inParagraph: Array<{ counts: number[]; words: number }> = [];
  paragraphs.forEach((paragraph, index) => {
    const text = canonicalize(paragraph);
    const mentions = terms.some((term) => termMatches(text, term));
    if (mentions) mentioned.push(index);
    inParagraph.push({ counts: mentions ? terms.map((term) => termOccurrences(text, term)) : terms.map(() => 0), words: wordsOf(paragraph) });
    for (const sentence of splitSentences(paragraph)) {
      const canonicalSentence = canonicalize(sentence);
      if (terms.some((term) => termMatches(canonicalSentence, term))) matching.push(sentence);
    }
  });

  let evidence: string | undefined;
  let best = Number.NEGATIVE_INFINITY;
  if (hits.length > 0) {
    for (const sentence of matching) {
      const score = scoreSentence(sentence, 0);
      // Strictly greater: the earlier sentence wins a tie.
      if (score > best) {
        best = score;
        evidence = sentence;
      }
    }
  }

  // The paragraphs that say most: graded by the same score over their own words, df over this section's paragraphs.
  let topParagraphs: number[] | undefined;
  if (mentioned.length > 0) {
    const scores = relevanceScores(inParagraph);
    const top = mentioned.reduce((most, index) => Math.max(most, scores[index]), 0);
    topParagraphs = mentioned.filter((index) => scores[index] >= top - 1e-9);
  }

  return {
    section: {
      // Provisional: the tier is the section's grade among the paper's sections (`routeQuestion`).
      tier: hits.length > 0 ? "faint" : "none",
      hits,
      ...(evidence !== undefined ? { evidence } : {}),
      paragraphs: mentioned,
      ...(topParagraphs ? { topParagraphs } : {}),
    },
    counts,
    words: wordsOf(paragraphs.join(" ")),
    scored: paragraphs.length > 0,
  };
}

type QuestionRoute = RouteResult["byQuestion"][number];
type RouteBody = ReadonlyArray<{ paragraphs: readonly string[] }>;

/** A map row as the route reads it: `parentId` is the hierarchy's field (a child names its group row). */
type RouteRow = ReadingMap["sections"][number] & { parentId?: string };

/** One question through the paper: the whole body is read for it, and for it alone. */
function routeQuestion(map: ReadingMap, sections: RouteBody, question: string): QuestionRoute {
  const terms = specificTerms(question);
  if (terms.length < MIN_SPECIFIC_TERMS) {
    return { question, vague: true, sections: {} as Record<string, RouteSection> };
  }
  const rows = map.sections as readonly RouteRow[];
  const routed = rows.map((_, k) => routeSection(sections[k]?.paragraphs ?? [], terms));

  // Rule 1: a score for each section with paragraphs of its own, against the paper's sections that have any.
  const own = routed.map((entry, k) => ({ entry, k })).filter(({ entry }) => entry.scored);
  const scores: number[] = rows.map(() => 0);
  relevanceScores(own.map(({ entry }) => ({ counts: entry.counts, words: entry.words }))).forEach((score, i) => {
    scores[own[i].k] = score;
  });

  // A group row (no paragraphs, with subsections under it) takes its strongest child's score, the union of the
  // children's mentions and that child's evidence. A child comes after its group, so the last row is settled first.
  const childrenOf = new Map<string, number[]>();
  rows.forEach((row, k) => {
    if (row.parentId) childrenOf.set(row.parentId, [...(childrenOf.get(row.parentId) ?? []), k]);
  });
  for (let k = rows.length - 1; k >= 0; k--) {
    const children = childrenOf.get(rows[k].id);
    if (routed[k].scored || !children || children.length === 0) continue;
    const union = new Map<string, number>();
    let strongest = children[0];
    for (const child of children) {
      for (const hit of routed[child].section.hits) union.set(hit.term, (union.get(hit.term) ?? 0) + hit.count);
      if (scores[child] > scores[strongest]) strongest = child;
    }
    scores[k] = scores[strongest];
    const hits = [...union].map(([term, count]) => ({ term, count }));
    hits.sort((a, b) => b.count - a.count || (a.term < b.term ? -1 : a.term > b.term ? 1 : 0));
    const evidence = routed[strongest].section.evidence;
    routed[k] = {
      ...routed[k],
      section: { tier: hits.length > 0 ? "faint" : "none", hits, ...(evidence !== undefined ? { evidence } : {}), paragraphs: [] },
    };
  }

  // Rule 2: the tier is the row's grade among all the rows.
  const tiers = gradeScores(scores);
  const result: Record<string, RouteSection> = {};
  rows.forEach((row, k) => {
    result[row.id] = { ...routed[k].section, tier: tiers[k] };
  });
  return { question, vague: false, sections: result };
}

function routeResult(byQuestion: QuestionRoute[]): RouteResult {
  return { byQuestion, vague: byQuestion.length > 0 && byQuestion.every((entry) => entry.vague) };
}

/**
 * Route each question through the paper. `sections` is the rendered body the
 * page holds (`PaperReading.body`), index-aligned with `map.sections` — the
 * alignment `buildReadingMap` guarantees (§1f.1, §1f.6 amended). Pure and
 * synchronous: nothing it is given changes, and the same input gives the
 * same result.
 */
export function routeByQuestions(map: ReadingMap, sections: RouteBody, questions: readonly string[]): RouteResult {
  return routeResult(questions.map((question) => routeQuestion(map, sections, question)));
}

/**
 * P7-13 (R11b): the most questions' routes kept for one body. A box holds five, and a question
 * typed a few characters at a time passes through many texts; the least recently used leave first.
 */
export const ROUTE_CACHE_LIMIT = 24;

/** Per body array, per map, per question text — all weakly held, so a paper that is gone takes its routes with it. */
const routeCache = new WeakMap<object, WeakMap<object, Map<string, QuestionRoute>>>();

/**
 * P7-13 (R11b): `routeByQuestions` with each question's route remembered, keyed by (the body
 * array, the map, the question's text). Routing is per question — the whole body is read for each
 * — so typing in one of five questions used to cost five routes (98-116 ms on a paper of the
 * owner's size, P7-02 §9(b)); here it costs the one that changed, and a repeat costs none. The
 * answer is `routeByQuestions`'s, entry for entry (equal, and for a question seen before the same
 * object — a route is read, never changed). `routeByQuestions` itself stays the pure uncached
 * function; this one is for a caller that routes the same body again and again.
 */
export function routeByQuestionsCached(map: ReadingMap, sections: RouteBody, questions: readonly string[]): RouteResult {
  let perMap = routeCache.get(sections);
  if (!perMap) routeCache.set(sections, (perMap = new WeakMap()));
  let routes = perMap.get(map);
  if (!routes) perMap.set(map, (routes = new Map()));
  const kept = routes;
  return routeResult(
    questions.map((question) => {
      const hit = kept.get(question);
      if (hit) {
        // Used again: last in line to leave.
        kept.delete(question);
        kept.set(question, hit);
        return hit;
      }
      const made = routeQuestion(map, sections, question);
      kept.set(question, made);
      if (kept.size > ROUTE_CACHE_LIMIT) kept.delete(kept.keys().next().value as string);
      return made;
    }),
  );
}


// ── "Just get the gist" (P1-03, ruling §1f.11) ─────────────────────────
//
// Not a question: the order in which to read a paper one has no question for
// — what it found and what that means first, then how it was done and why it
// was asked, the apparatus last — as tiers on the same shape the question
// route returns. No hits, no evidence, no paragraphs, and never answers (P2
// must not send a gist as a question).

export const GIST_QUESTION = "Just get the gist";

const GIST_TIER: Readonly<Record<ReadingRole, RouteTier>> = {
  interpretation: "strong",
  evidence: "strong",
  method: "faint",
  setup: "faint",
  apparatus: "none",
  body: "none",
};

export function gistRoute(map: ReadingMap): RouteResult {
  const sections: Record<string, RouteSection> = {};
  for (const row of map.sections) {
    sections[row.id] = { tier: GIST_TIER[row.role], hits: [], paragraphs: [] };
  }
  return { byQuestion: [{ question: GIST_QUESTION, vague: false, sections }], vague: false };
}

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
import { canonicalize, expandTerm, isGenericTerm, termMatches, termOccurrences } from "@/lib/scoring/term-expand";
import { parseBlockMarker } from "@/lib/text/math";
import { headingNumber, numbersHeading, type ExtractedDocument, type ExtractedEquation, type ExtractedSection, type ExtractedCodeBlock } from "./html-text";
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
  listings: readonly ExtractedCodeBlock[] = [],
): { paragraphs: string[]; equations: ReadingEquation[]; codeBlocks?: (ExtractedCodeBlock & { after: number })[] } {
  const paragraphs: string[] = [];
  const equations: ReadingEquation[] = [];
  const codeBlocks: (ExtractedCodeBlock & { after: number })[] = [];
  for (const raw of section.text.split(/\n{2,}/)) {
    const para = raw.replace(/\s+/g, " ").trim();
    if (!para) continue;
    const codeMarker = /^⟦@(\d+)⟧$/.exec(para);
    if (codeMarker) {
      const block = listings[Number(codeMarker[1])];
      if (block) codeBlocks.push({ ...block, after: paragraphs.length - 1 });
      continue;
    }
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
  return { paragraphs, equations, ...(codeBlocks.length ? { codeBlocks } : {}) };
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
  codeBlocks?: (ExtractedCodeBlock & { after: number })[];
}

export function readableSections(doc: ExtractedDocument): ReadableSection[] {
  const out: ReadableSection[] = [];
  const lifted = doc.equations ?? [];
  doc.sections.forEach((section, index) => {
    if (section.canonical === "abstract") return;
    const { paragraphs, equations, codeBlocks } = sectionParagraphs(section, lifted, doc.codeBlocks);
    if (paragraphs.length === 0 && equations.length === 0 && !codeBlocks?.length) {
      const next = doc.sections[index + 1];
      if (!next || !numbersHeading(section.heading, next.heading)) return;
    }
    out.push({ id: section.id ?? `s${index}`, section, paragraphs, equations, ...(codeBlocks ? { codeBlocks } : {}) });
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
//
// P10-06b (the owner's review 3.4): two refinements that make the strongest rows the ones that answer the
// question. The terms meet in a paragraph (`relevanceScores`): a section's score is half the best of its
// paragraphs' scores — a paragraph that names several of the question's terms together outscores one that
// names one of them often — and half the section's score as a whole. A term's forms match (`termFormsMatch`):
// "growing" is also "growth", "grown" and "grow", so a question that says growing lights the growth section.
//
// P10-06c (the walk's A11, X-A3): a group row never takes a strong slot (the cap of three is counted over the leaf rows; the
// group wears its strongest child's tier); a question that asks for parameters or conditions weighs the method and
// apparatus sections up (`METHOD_BOOST`); a term found in nearly every section weighs the idf floor alone; and the words a
// question is phrased with ("such as", "various", "learn") are never terms.
//
// P10-15 (A11 generalised; the owner's ruling §1h.89): the parameter case becomes one intent table over the map's roles
// (`questionIntent`, `ROLE_WEIGHTS`): a mechanism question weighs the discussion first and the results next, a result question
// the results, a background question the setup — and the best row of the favoured role keeps a strong slot.

/** `strong`: among the three best sections and at least 0.6 of the best score. `medium`: at least 0.4 of it.
 *  `faint`: any mention. `none`: no mention. P10-06c: the three are counted over the leaf rows (rows with paragraphs of
 *  their own); a group row wears its strongest child's tier outside the count. */
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
  /** P10-06d (rule 3): set on a group row only — a section with no paragraphs of its own whose subsections are present. It
   *  wears its strongest child's tier outside the cap of three strong rows, and the body's cap (`withStrongCap`, once a
   *  model's marks are merged over the route) skips it for the same reason. Absent on every other row. */
  group?: true;
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
 *
 * P10-06c (the walk's X-A3): the words a question is phrased with, which name nothing in the paper — "such" (from
 * "such as": the owner's second question counted "such ×3"), "various", "like", "etc", "learn", "want", "know",
 * "understand", "about", "between". They join this list, not `ROUTE_STOPLIST`; `specificTerms` reads both, and the
 * facts line, the route and the preference ledger's question terms all go through `specificTerms`. "learning",
 * "understanding" and "knowledge" are other words and stay.
 */
const FUNCTION_WORDS_BEYOND_TOKENIZE: readonly string[] = [
  "after", "before", "during", "between", "within", "through", "across", "against", "among", "without",
  "does", "did", "could", "would", "should", "might", "must",
  "these", "those", "their", "there", "which", "what", "whose",
  "also", "only", "very", "more", "most", "less", "than", "then", "when", "where", "while", "however", "therefore",
  "such", "various", "like", "etc", "learn", "want", "know", "understand", "about",
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
/** P10-06c (rule 3): a term found in at least this share of the scored sections weighs the floor alone — on the owner's paper
 *  `110` and `LCO` are in nearly every section and say nothing about which one answers. */
const UBIQUITOUS_SHARE = 0.8;
/** A section is strong from this share of the best score, medium from the second. P10-06b: the second was 0.3; on a paper
 *  about growth, a growth question has most of the rows within a third of the best, and the map must keep a third of them
 *  faint or none (rubric A11), so a row is medium from 0.4. */
const STRONG_SHARE = 0.6;
const MEDIUM_SHARE = 0.4;
/** At most this many rows carry the strongest tier — in the Tier 0 route and, P10-06b, once a model's marks are merged over it. */
export const MAX_STRONG_ROWS = 3;
/** P10-06b (rule 1): a section's score is this share its best paragraph's score, the rest the section's own. */
const PARAGRAPH_SHARE = 0.5;
/** P10-06b (rule 1): a paragraph that holds `k ≥ 2` distinct terms scores `× (1 + MEETING_BONUS × (k − 1))`. */
const MEETING_BONUS = 0.5;

/** One term's rarity among `rows`: `ln((N + 1) / (df + 1)) + 0.1`, df the rows that say it at all — and, with `ubiquity`
 *  (the sections of the paper, P10-06c), the floor alone when df is at least `UBIQUITOUS_SHARE` of N. */
function idfOf(rows: ReadonlyArray<{ counts: readonly number[] }>, ubiquity = false): number[] {
  const n = rows.length;
  const width = rows.reduce((most, row) => Math.max(most, row.counts.length), 0);
  const idf: number[] = [];
  for (let i = 0; i < width; i++) {
    const df = rows.reduce((seen, row) => seen + ((row.counts[i] ?? 0) >= 1 ? 1 : 0), 0);
    idf.push(ubiquity && df >= n * UBIQUITOUS_SHARE - 1e-9 ? IDF_FLOOR : Math.log((n + 1) / (df + 1)) + IDF_FLOOR);
  }
  return idf;
}

/** `Σ idf(term) × ln(1 + count(term)) ÷ ln(2 + words / 200)`, times the meeting bonus where asked for. */
function rowScore(counts: readonly number[], words: number, idf: readonly number[], meeting: boolean): number {
  let sum = 0;
  let distinct = 0;
  for (let i = 0; i < idf.length; i++) {
    const count = counts[i] ?? 0;
    if (count >= 1) distinct++;
    sum += idf[i] * Math.log(1 + count);
  }
  const score = sum / Math.log(2 + Math.max(0, words) / 200);
  return meeting && distinct >= 2 ? score * (1 + MEETING_BONUS * (distinct - 1)) : score;
}

/**
 * P10-06 (rule 1; review 3.2, 3.4): a score for each of `sections` from the counts of the question's terms in it.
 * `counts[i]` is how often term `i` occurs in the section (the same terms, in the same order, for every section),
 * `words` the section's length. The weight of a term is its rarity among these sections,
 * `idf = ln((N + 1) / (df + 1)) + 0.1` with N the number of sections and df the number that mention it — a term in
 * two sections counts for much, one in all of them for little — and a section scores
 * `Σ idf(term) × ln(1 + count(term)) ÷ ln(2 + words / 200)`: the log keeps a term repeated thirty times from
 * outweighing three terms said twice each, and the divisor keeps a long section from winning by length alone.
 *
 * P10-06b (rule 1): a section that gives its `paragraphs` (the counts and words of each, the terms in the same order,
 * the paragraphs that say nothing included) is scored `0.5 × (the best of its paragraphs' scores) + 0.5 × (the
 * section's score above)`, where a paragraph's score is the same formula over its own counts and words — with the
 * paper's idf — times `1 + 0.5 × (k − 1)` for the `k ≥ 2` distinct terms the paragraph holds. So a paragraph that
 * names the growth parameters, 110 and LCO together outscores a long introduction that names each somewhere. A
 * section that gives no paragraphs is scored as before.
 *
 * P10-06c (rule 3): a term found in at least 80 % of the sections weighs the floor, 0.1, alone — `ln((N + 1) / (df + 1))`
 * for df = 9 of 10 would still be 0.095 on top of it; a term everywhere says nothing about which section answers.
 *
 * Pure; the score is a number to order by, never shown (it is not a fact a reader can check — the counts are).
 */
export function relevanceScores(
  sections: ReadonlyArray<{
    counts: readonly number[];
    words: number;
    paragraphs?: ReadonlyArray<{ counts: readonly number[]; words: number }>;
  }>,
): number[] {
  const idf = idfOf(sections, true);
  return sections.map((section) => {
    const whole = rowScore(section.counts, section.words, idf, false);
    if (!section.paragraphs || section.paragraphs.length === 0) return whole;
    const best = section.paragraphs.reduce((most, paragraph) => Math.max(most, rowScore(paragraph.counts, paragraph.words, idf, true)), 0);
    return PARAGRAPH_SHARE * best + (1 - PARAGRAPH_SHARE) * whole;
  });
}

/**
 * P10-06 (rule 2): the tier of each score, relative to the best of them. `strong` for a score of at least 0.6 of
 * the best and among the three highest (the earlier row first on a tie), so three rows at most; `medium` for at
 * least 0.4 of the best; `faint` for any other mention; `none` for a score of zero. A single mentioned section is
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

// ── A term's forms (P10-06b, rule 2) ────────────────────────────────────
//
// "growing" in a question and "growth" in the paper are one word to a reader. The match is by stem, a small,
// explicit rule with no dependency: strip one of the suffixes below (never down to fewer than four letters),
// and two words match when one stem is the other's prefix and the longer is at most one letter longer —
// growing / growth / grown / grow, deposition / deposited, parameters / parameter, electrodes / electrode.
// Never for a term under four letters or one that is not all letters (`LCO`, `110`, `LiCoO2`: those match as
// they did, exactly and through the abbreviation table), and never for words that only begin alike
// (grain / grating, current / curriculum, grow / grower). The count stays under the reader's own term.

const FORM_SUFFIXES: readonly string[] = ["tion", "ing", "es", "ed", "th", "s"];
const MIN_STEM = 4;
const STEMMABLE = /^\p{L}{4,}$/u;

const stemCache = new Map<string, string>();

/** A word with one of the suffixes removed, if four letters or more are left. */
function stemOf(word: string): string {
  const kept = stemCache.get(word);
  if (kept !== undefined) return kept;
  let stem = word;
  for (const suffix of FORM_SUFFIXES) {
    if (word.endsWith(suffix) && word.length - suffix.length >= MIN_STEM) {
      stem = word.slice(0, word.length - suffix.length);
      break;
    }
  }
  if (stemCache.size > 20000) stemCache.clear();
  stemCache.set(word, stem);
  return stem;
}

function stemsMatch(a: string, b: string): boolean {
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  return long.length - short.length <= 1 && long.startsWith(short);
}

/**
 * P10-06b (rule 2): whether the question's `term` and the paper's `word` are forms of one word — by the stem rule
 * above. Both are compared lower-case; a term under four letters, or with anything but letters in it, is only ever
 * its own form (the exact match `termMatches` makes), so this answers false for them.
 */
export function termFormsMatch(term: string, word: string): boolean {
  const a = canonicalize(term);
  const b = canonicalize(word);
  if (!STEMMABLE.test(a) || !STEMMABLE.test(b)) return false;
  return stemsMatch(stemOf(a), stemOf(b));
}

/** The words of a canonical text that can have forms (letters only, four or more), each with how often it stands. */
function formWordsOf(canonicalText: string): Map<string, number> {
  const words = new Map<string, number>();
  for (const word of canonicalText.split(" ")) {
    if (word.length >= MIN_STEM && STEMMABLE.test(word)) words.set(word, (words.get(word) ?? 0) + 1);
  }
  return words;
}

/** What the route needs of one question term: its words and, if it can have forms, its stem. */
interface RouteTerm {
  term: string;
  /** Every canonical variant `termMatches` accepts (counted by `termOccurrences` already). */
  variants: ReadonlySet<string>;
  /** Set for a term of four letters or more, all letters. */
  stem?: string;
}

function routeTermOf(term: string): RouteTerm {
  const canonical = canonicalize(term);
  return {
    term,
    variants: new Set(expandTerm(term)),
    ...(STEMMABLE.test(canonical) ? { stem: stemOf(canonical) } : {}),
  };
}

/** How often the text says a form of `entry` that `termOccurrences` does not already count (the same word never twice). */
function formOccurrences(words: ReadonlyMap<string, number>, entry: RouteTerm): number {
  if (entry.stem === undefined) return 0;
  let extra = 0;
  for (const [word, count] of words) {
    if (!entry.variants.has(word) && stemsMatch(entry.stem, stemOf(word))) extra += count;
  }
  return extra;
}

/** The count a reader can check: the term as before (its plural, its abbreviation's long form) plus its other forms. */
function occurrencesOf(canonicalText: string, words: ReadonlyMap<string, number>, entry: RouteTerm): number {
  return termOccurrences(canonicalText, entry.term) + formOccurrences(words, entry);
}

function mentionedIn(canonicalText: string, words: ReadonlyMap<string, number>, entry: RouteTerm): boolean {
  return termMatches(canonicalText, entry.term) || formOccurrences(words, entry) > 0;
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
  /** The same for each paragraph (P10-06b): the terms meeting in one paragraph raise the section's score. */
  inParagraph: Array<{ counts: number[]; words: number }>;
  /** Whether the section has paragraphs of its own: a group row (a heading with only subsections) has none. */
  scored: boolean;
}

function routeSection(paragraphs: readonly string[], terms: readonly string[]): RoutedSection {
  const entries = terms.map(routeTermOf);
  // Canonicalised once per section per call (joined with a space), and once
  // per paragraph and per sentence for the matches below.
  const sectionText = canonicalize(paragraphs.join(" "));
  const sectionWords = formWordsOf(sectionText);
  const hits = entries
    .map((entry) => ({ term: entry.term, count: occurrencesOf(sectionText, sectionWords, entry) }))
    .filter((hit) => hit.count >= 1)
    .sort((a, b) => b.count - a.count || (a.term < b.term ? -1 : a.term > b.term ? 1 : 0));
  const counts = terms.map((term) => hits.find((hit) => hit.term === term)?.count ?? 0);

  const mentioned: number[] = [];
  const matching: string[] = [];
  // Per paragraph, for the top paragraphs (rule 3) and the section's score (P10-06b): the counts of the terms in it.
  const inParagraph: Array<{ counts: number[]; words: number }> = [];
  paragraphs.forEach((paragraph, index) => {
    const text = canonicalize(paragraph);
    const words = formWordsOf(text);
    const mentions = entries.some((entry) => mentionedIn(text, words, entry));
    if (mentions) mentioned.push(index);
    inParagraph.push({ counts: mentions ? entries.map((entry) => occurrencesOf(text, words, entry)) : terms.map(() => 0), words: wordsOf(paragraph) });
    if (!mentions) return;
    for (const sentence of splitSentences(paragraph)) {
      const canonicalSentence = canonicalize(sentence);
      const sentenceWords = formWordsOf(canonicalSentence);
      if (entries.some((entry) => mentionedIn(canonicalSentence, sentenceWords, entry))) matching.push(sentence);
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

  // The paragraphs that say most: graded by the same score over their own words, df over this section's paragraphs,
  // and the terms that meet in one paragraph count for more (P10-06b) — the paragraph that carries the section's
  // score is the one the map points at.
  let topParagraphs: number[] | undefined;
  if (mentioned.length > 0) {
    const idf = idfOf(inParagraph);
    const scores = inParagraph.map((paragraph) => rowScore(paragraph.counts, paragraph.words, idf, true));
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
    inParagraph,
    scored: paragraphs.length > 0,
  };
}

// ── The question's intent weighs the map's roles (P10-15, A11 generalised; the owner's ruling §1h.89) ─────────────────
//
// P10-06c built one case: a question for parameters weighs the method and apparatus sections up. The owner asked for the
// rule, not the case ("举一反三，要利用文章的结构 … 问机理，优先在 discussion 里面找，其次是 result"): the question's intent says
// which roles of the paper hold its answer, and the route weighs those roles up. One table, `ROLE_WEIGHTS`, intent × role.

/** What the question asks for. `none`: no cue, or two intents with as many cue words (the route weighs a tie by half, `intentWeights`). */
export type QuestionIntent = "parameter" | "mechanism" | "result" | "background" | "none";

const ALL_ONE: Readonly<Record<ReadingRole, number>> = { setup: 1, method: 1, evidence: 1, interpretation: 1, apparatus: 1, body: 1 };

/**
 * P10-15 (rule 1): by intent and role, what a leaf row's score is multiplied by (a row that scores nothing stays at zero).
 * - `parameter`: the sections that say how a thing was done — method, apparatus — 1.3 (P10-06c's number);
 * - `mechanism`: the discussion first (interpretation 1.3), the results next (evidence 1.15), the setup a little less (0.9);
 * - `result`: the results first (evidence 1.3), the discussion next (interpretation 1.1), the setup a little less (0.9);
 * - `background`: the introduction and the related work (setup) 1.3;
 * - `none`: every weight 1 — nothing changes for a question that names no intent.
 */
export const ROLE_WEIGHTS: Readonly<Record<QuestionIntent, Readonly<Record<ReadingRole, number>>>> = {
  parameter: { ...ALL_ONE, method: 1.3, apparatus: 1.3 },
  mechanism: { ...ALL_ONE, interpretation: 1.3, evidence: 1.15, setup: 0.9 },
  result: { ...ALL_ONE, evidence: 1.3, interpretation: 1.1, setup: 0.9 },
  background: { ...ALL_ONE, setup: 1.3 },
  none: ALL_ONE,
};

/** P10-06c's constant, kept as an alias of the table's parameter × method entry (`apparatus` has the same weight). */
export const METHOD_BOOST = ROLE_WEIGHTS.parameter.method;

/** The words that make a question one of an intent; a word matches by `termFormsMatch` as well (temperatures, explains, achieved). */
const INTENT_WORDS: Readonly<Record<Exclude<QuestionIntent, "none">, readonly string[]>> = {
  parameter: [
    "parameter", "parameters", "condition", "conditions", "temperature", "voltage", "potential", "concentration", "concentrations", "thickness",
    "electrolyte", "ph",
  ],
  mechanism: [
    "mechanism", "why", "cause", "origin", "explain", "because", "arise", "govern", "drive", "lead", "responsible", "effect",
    "influence", "dependence", "relationship", "correlate", "theory", "kinetic", "thermodynamic",
  ],
  result: ["result", "performance", "capacity", "efficiency", "retention", "achieve", "obtain", "measure", "show", "value", "improve", "compare"],
  background: ["define", "definition", "overview", "introduction", "prior"],
};

/** Cue phrases, each worth this many words; "what is" is a frame ("What is the mechanism …", "What is LCO?"), worth half a word,
 *  so a content word beside it decides and a definition question with none is background. */
const INTENT_PHRASES: ReadonlyArray<{ intent: Exclude<QuestionIntent, "none">; phrase: string; weight: number }> = [
  { intent: "result", phrase: "how much", weight: 1 },
  { intent: "result", phrase: "how many", weight: 1 },
  { intent: "background", phrase: "state of the art", weight: 1 },
  { intent: "background", phrase: "what is", weight: 0.5 },
  { intent: "background", phrase: "what are", weight: 0.5 },
];

/**
 * P10-32 (rule 2, BACKLOG-83): the words that are cues only in the phrases that mean the intent. `current`, `time`, `rate`,
 * `model` and `role` are everyday words — "the current literature", "at the same time", "rate capability", "a machine learning
 * model", "a role model" — and as bare cue words they misread a question (P10-15's list had them). Each counts once for its
 * intent when any of its phrases is in the question (a phrase matches whole words, and its last word in the plural too:
 * "scan rates"). The parameter words also count beside another process variable in a list ("temperature, current, etc.",
 * "time and temperature"; `besideVariable`). Never by themselves, and "current density" is no parameter cue: it is a quantity
 * a paper reports as often as one it sets.
 */
const EVERYDAY_CUES: ReadonlyArray<{ intent: Exclude<QuestionIntent, "none">; word: string; phrases: readonly string[] }> = [
  {
    intent: "parameter",
    word: "current",
    phrases: ["applied current", "plating current", "deposition current", "pulse current", "constant current", "limiting current", "galvanostatic current", "what current"],
  },
  {
    intent: "parameter",
    word: "time",
    phrases: [
      "how long", "time constant", "reaction time", "growth time", "deposition time", "annealing time", "heating time", "residence time", "holding time", "soaking time",
    ],
  },
  {
    intent: "parameter",
    word: "rate",
    phrases: [
      "what rate", "growth rate", "deposition rate", "plating rate", "scan rate", "sweep rate", "heating rate", "cooling rate", "ramp rate", "flow rate",
    ],
  },
  { intent: "mechanism", word: "model", phrases: ["theoretical model", "physical model", "mechanistic model", "model of the", "model for the"] },
  { intent: "mechanism", word: "role", phrases: ["the role of", "role of", "role in", "roles of", "plays a role", "play a role", "playing a role", "played a role", "key role"] },
];

/** The process variables a question lists: an everyday parameter word beside one of these is a cue. */
const LIST_VARIABLES = ["temperature", "voltage", "potential", "concentration", "pressure", "thickness", "ph", "current", "time", "rate"] as const;

/** Whether `phrase` (lower-case words) stands in `padded` (the question's words, one space apart, a space at each end), or its plural. */
function hasPhrase(padded: string, phrase: string): boolean {
  return padded.includes(` ${phrase} `) || padded.includes(` ${phrase}s `);
}

/**
 * Whether `word` stands in the lower-cased question next to another process variable in a list: "temperature, current",
 * "time and temperature", "voltage or current" — a comma, a slash, "and" or "or" between them, in either order. "current
 * density" after the word is not the word (the quantity, not the setting).
 */
function besideVariable(question: string, word: string): boolean {
  const others = LIST_VARIABLES.filter((variable) => variable !== word).join("|");
  const joint = String.raw`\s*(?:[,;/&]|\band\b|\bor\b)\s*(?:(?:and|or)\s+)?`;
  const own = String.raw`${word}s?(?![\p{L}])(?!\s+density)`;
  const other = String.raw`(?:${others})s?(?![\p{L}])`;
  const edge = String.raw`(?<![\p{L}])`;
  return new RegExp(`${edge}${other}${joint}${edge}${own}|${edge}${own}${joint}${edge}${other}`, "u").test(question);
}

/**
 * The cue counts of a question, by intent: each distinct word of the question counts once for the intent whose list holds it
 * (or a form of it), a phrase counts its weight (`INTENT_PHRASES`), and a word that is also an everyday word counts only where
 * its phrase says the intent (`EVERYDAY_CUES`, P10-32).
 */
function intentCounts(question: string): Record<Exclude<QuestionIntent, "none">, number> {
  const tokens = question.toLowerCase().match(/\p{L}+/gu) ?? [];
  const words = [...new Set(tokens)];
  const padded = ` ${tokens.join(" ")} `;
  const counts: Record<Exclude<QuestionIntent, "none">, number> = { parameter: 0, mechanism: 0, result: 0, background: 0 };
  for (const intent of Object.keys(INTENT_WORDS) as Array<keyof typeof INTENT_WORDS>) {
    for (const word of words) {
      if (INTENT_WORDS[intent].some((cue) => cue === word || termFormsMatch(cue, word))) counts[intent] += 1;
    }
  }
  for (const { intent, phrase, weight } of INTENT_PHRASES) {
    if (padded.includes(` ${phrase} `)) counts[intent] += weight;
  }
  // P10-32 (rule 2): an everyday word is a cue in its phrases (one count however many name it), or, for a parameter, beside another variable.
  const lower = question.toLowerCase();
  for (const { intent, word, phrases } of EVERYDAY_CUES) {
    if (phrases.some((phrase) => hasPhrase(padded, phrase)) || (intent === "parameter" && besideVariable(lower, word))) counts[intent] += 1;
  }
  return counts;
}

/**
 * P10-15 (rule 1): the intent of a question, read from its own words — not from `specificTerms`, which drops "why", "result",
 * "show", "how" (a route never matches the paper on them, but they say what the reader wants). The intent with more counts
 * (`intentCounts`) wins; no cue at all is `none`, and so is a tie — which the route does not read as no intent: see `tiedIntents`.
 */
export function questionIntent(question: string): QuestionIntent {
  const counts = intentCounts(question);
  const ranked = (Object.entries(counts) as Array<[Exclude<QuestionIntent, "none">, number]>).sort((a, b) => b[1] - a[1]);
  if (ranked[0][1] <= 0 || ranked[0][1] === ranked[1][1]) return "none";
  return ranked[0][0];
}

/**
 * P10-32 (rule 1, BACKLOG-83): the intents a question ties between — those with as many counts as the most, when that is at
 * least one and two or more intents have it; else none. "Why does the temperature …" has one mechanism word and one parameter
 * word: the reader asked for both, and the route weighs both by half (`intentWeights`) where it used to weigh neither.
 */
export function tiedIntents(question: string): Array<Exclude<QuestionIntent, "none">> {
  const counts = intentCounts(question);
  const most = Math.max(...Object.values(counts));
  if (!(most > 0)) return [];
  const tied = (Object.keys(counts) as Array<Exclude<QuestionIntent, "none">>).filter((intent) => counts[intent] === most);
  return tied.length > 1 ? tied : [];
}

/**
 * P10-32 (rule 1): what a leaf row's score is multiplied by, by role, for a question. One clear intent: its `ROLE_WEIGHTS`
 * row, whole. A tie between intents: the product of each tied intent's row at the square root of its weight — a half boost
 * (in the log of the score) for each favoured role, never none. No cue: every weight 1.
 */
export function intentWeights(question: string): Readonly<Record<ReadingRole, number>> {
  const intent = questionIntent(question);
  if (intent !== "none") return ROLE_WEIGHTS[intent];
  const tied = tiedIntents(question);
  if (tied.length === 0) return ROLE_WEIGHTS.none;
  const weights: Record<ReadingRole, number> = { ...ALL_ONE };
  for (const each of tied) {
    for (const role of Object.keys(weights) as ReadingRole[]) weights[role] *= Math.sqrt(ROLE_WEIGHTS[each][role]);
  }
  return weights;
}

/** The roles an intent favours: the roles with its table row's largest weight, when that is more than 1 (none for `none`). */
function favouredRoles(intent: QuestionIntent): ReadingRole[] {
  const row = ROLE_WEIGHTS[intent];
  const top = Math.max(...Object.values(row));
  return top > 1 ? (Object.keys(row) as ReadingRole[]).filter((role) => row[role] === top) : [];
}

type QuestionRoute = RouteResult["byQuestion"][number];
type RouteBody = ReadonlyArray<{ paragraphs: readonly string[] }>;

/** A map row as the route reads it: `parentId` is the hierarchy's field (a child names its group row). */
type RouteRow = ReadingMap["sections"][number] & { parentId?: string };

const TIER_ORDER: Readonly<Record<RouteTier, number>> = { none: 0, faint: 1, medium: 2, strong: 3 };

/**
 * P10-06d (rule 1), read from the table (P10-15, rule 2): a reader who asks for parameters wants the experimental section among
 * the darkest rows, and the cap of three strong leaf rows held it out when the results and the Introduction (which names every
 * term once) stood above it; the same for the discussion on a question for a mechanism, the results on a question for a result,
 * the introduction on a question for background. After the leaf grade: when the best leaf row of a favoured role (`favoured`,
 * the roles of the intent's largest weight) scores at least `STRONG_SHARE` of the best leaf but is not strong, it becomes
 * strong, and — the cap still three — the lowest-scoring strong row of role `setup` is medium instead (if no strong row is
 * `setup`, the lowest-scoring strong row). `tiers` is changed in place; nothing else is.
 */
function keepRoleSlot(
  leafAt: readonly number[],
  rows: readonly RouteRow[],
  scores: readonly number[],
  tiers: RouteTier[],
  favoured: readonly ReadingRole[],
): void {
  const best = leafAt.reduce((most, k) => Math.max(most, scores[k]), 0);
  if (!(best > 0)) return;
  let pick = -1;
  for (const k of leafAt) {
    if (favoured.includes(rows[k].role) && (pick < 0 || scores[k] > scores[pick])) pick = k;
  }
  if (pick < 0 || tiers[pick] === "strong" || scores[pick] < best * STRONG_SHARE - 1e-9) return;
  const strong = leafAt.filter((k) => tiers[k] === "strong");
  if (strong.length >= MAX_STRONG_ROWS) {
    const setup = strong.filter((k) => rows[k].role === "setup");
    // The lowest score; on a tie the later row gives way, as the earlier row comes first in the grade.
    const giving = (setup.length > 0 ? setup : strong).reduce((low, k) => (scores[k] <= scores[low] ? k : low));
    tiers[giving] = "medium";
  }
  tiers[pick] = "strong";
}

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
  relevanceScores(own.map(({ entry }) => ({ counts: entry.counts, words: entry.words, paragraphs: entry.inParagraph }))).forEach((score, i) => {
    scores[own[i].k] = score;
  });

  // P10-15 (rule 1; was P10-06c's parameter case): the question's intent weighs the map's roles.
  // P10-32 (rule 1): a tie between two intents weighs both by half; one clear intent as before.
  const intent = questionIntent(question);
  const weights = intentWeights(question);
  rows.forEach((row, k) => {
    if (routed[k].scored) scores[k] *= weights[row.role];
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

  // Rule 2: the tier is the row's grade among the leaf rows — the rows with paragraphs of their own, so the cap of three strong
  // rows is counted over them. P10-06c (rule 1): a group row takes no slot of its own; it wears its strongest child's tier,
  // outside the cap (a group row ties its best child in score, and used to take a slot with it, demoting a leaf).
  const isGroup = rows.map((row, k) => !routed[k].scored && (childrenOf.get(row.id)?.length ?? 0) > 0);
  const leafAt = rows.map((_, k) => k).filter((k) => !isGroup[k]);
  const tiers: RouteTier[] = rows.map(() => "none");
  gradeScores(leafAt.map((k) => scores[k])).forEach((tier, i) => {
    tiers[leafAt[i]] = tier;
  });
  // P10-06d (rule 1), P10-15 (rule 2): the best row of the intent's favoured role keeps a strong slot; the Introduction gives way.
  keepRoleSlot(leafAt, rows, scores, tiers, favouredRoles(intent));
  for (let k = rows.length - 1; k >= 0; k--) {
    if (!isGroup[k]) continue;
    tiers[k] = (childrenOf.get(rows[k].id) ?? []).reduce<RouteTier>((most, child) => (TIER_ORDER[tiers[child]] > TIER_ORDER[most] ? tiers[child] : most), "none");
  }
  const result: Record<string, RouteSection> = {};
  rows.forEach((row, k) => {
    result[row.id] = { ...routed[k].section, tier: tiers[k], ...(isGroup[k] ? { group: true as const } : {}) };
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

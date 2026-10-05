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
// the paragraph's own sentence, cut only at a word boundary, never rewritten.

import { tokenize } from "@/lib/scoring/tokenize";
import { canonicalize, isGenericTerm, termMatches, termOccurrences } from "@/lib/scoring/term-expand";
import type { ExtractedDocument } from "./html-text";
import { readableSections } from "./reading";
import { isBoilerplate, scoreSentence, splitSentences } from "./skim";

/** What a section is for, from its bucket. `body` is the honest "not placed":
 *  the page shows no role tag for it. */
export type ReadingRole = "setup" | "method" | "evidence" | "interpretation" | "apparatus" | "body";

export interface ReadingMapParagraph {
  /** The paragraph's index in the body section — `ReadingSection.paragraphs[index]`. */
  index: number;
  /** The paragraph's first sentence of 40+ characters that is not boilerplate,
   *  cut at a word boundary to ≤160 characters — always a verbatim substring
   *  of the paragraph — or null when it has none. */
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
const OPENING_MAX = 160;

/** §1f.3: the same count the contents rail shows (`paper-contents.tsx`). */
function wordCount(paragraph: string): number {
  return paragraph.split(/\s+/).length;
}

/**
 * §1f.4: the paragraph's first sentence of ≥40 characters that is not
 * boilerplate. Longer than 160 characters, it is cut at the last whitespace
 * at or before character 160 and trimmed — nothing appended, so it stays a
 * verbatim substring (the page may draw the ellipsis).
 */
export function openingOf(paragraph: string): string | null {
  const sentence = splitSentences(paragraph).find(
    (candidate) => candidate.length >= OPENING_MIN && !isBoilerplate(candidate),
  );
  if (!sentence) return null;
  if (sentence.length <= OPENING_MAX) return sentence;
  let cut = -1;
  for (let i = OPENING_MAX; i > 0; i--) {
    if (/\s/.test(sentence[i])) {
      cut = i;
      break;
    }
  }
  // One unbroken run of 160+ characters (a URL, a formula): a hard cut, still
  // a substring.
  return (cut > 0 ? sentence.slice(0, cut) : sentence.slice(0, OPENING_MAX)).trim();
}

export function buildReadingMap(doc: ExtractedDocument): ReadingMap {
  // An id in the shape every extractor numbers sections (`withSectionIds`:
  // `s<index>` over the document's sections, the abstract included), for a
  // document read before ids existed.
  const position = new Map(doc.sections.map((section, index) => [section, index]));
  let totalWords = 0;
  const sections = readableSections(doc).map(({ section, paragraphs }): ReadingMapSection => {
    const words = paragraphs.reduce((sum, paragraph) => sum + wordCount(paragraph), 0);
    totalWords += words;
    return {
      id: section.id ?? `s${position.get(section) ?? 0}`,
      heading: section.heading,
      canonical: section.canonical,
      role: roleOf(section.canonical),
      ...(typeof section.page === "number" ? { page: section.page } : {}),
      words,
      minutes: words > 0 ? Math.max(1, Math.ceil(words / WORDS_PER_MINUTE)) : 0,
      paragraphs: paragraphs.map((paragraph, index) => ({ index, opening: openingOf(paragraph) })),
    };
  });
  return { sections, totalMinutes: Math.ceil(totalWords / WORDS_PER_MINUTE) };
}

// ── The Tier 0 route (spec D9 second half; rulings §1f.6–8) ────────────
//
// For each question and each section: read / skim / not mentioned, from
// counts a reader can check — which of the question's specific terms the
// section mentions, how often, and in how many of its sentences — with one
// of those sentences, verbatim, as evidence. No score is reported (a score is
// not a fact a reader can check). It runs in the browser on the reading the
// page already holds: the questions are the reader's own and never leave this
// function.

export type RouteTier = "read" | "skim" | "none";

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
 *   show where the method and the conclusions are.
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
]);

/**
 * §1f.6: the question's tokens (`tokenize`: lower-cased, stopwords and short
 * tokens already gone), one per canonical form, without the generic ones and
 * without `ROUTE_STOPLIST` (P1-02b). Each is kept as the reader typed it.
 */
export function specificTerms(question: string): string[] {
  const seen = new Set<string>();
  const terms: string[] = [];
  for (const token of tokenize(question)) {
    const canonical = canonicalize(token);
    if (!canonical || seen.has(canonical) || isGenericTerm(token) || ROUTE_STOPLIST.has(canonical)) continue;
    seen.add(canonical);
    terms.push(token);
  }
  return terms;
}

function routeSection(paragraphs: readonly string[], terms: readonly string[]): RouteSection {
  // Canonicalised once per section per call (joined with a space), and once
  // per paragraph and per sentence for the matches below.
  const sectionText = canonicalize(paragraphs.join(" "));
  const hits = terms
    .map((term) => ({ term, count: termOccurrences(sectionText, term) }))
    .filter((hit) => hit.count >= 1)
    .sort((a, b) => b.count - a.count || (a.term < b.term ? -1 : a.term > b.term ? 1 : 0));

  const mentioned: number[] = [];
  const matching: string[] = [];
  paragraphs.forEach((paragraph, index) => {
    const text = canonicalize(paragraph);
    if (terms.some((term) => termMatches(text, term))) mentioned.push(index);
    for (const sentence of splitSentences(paragraph)) {
      const canonicalSentence = canonicalize(sentence);
      if (terms.some((term) => termMatches(canonicalSentence, term))) matching.push(sentence);
    }
  });

  const tier: RouteTier =
    hits.length >= 2 && matching.length >= 2 ? "read" : hits.length >= 1 ? "skim" : "none";

  let evidence: string | undefined;
  let best = Number.NEGATIVE_INFINITY;
  if (tier !== "none") {
    for (const sentence of matching) {
      const score = scoreSentence(sentence, 0);
      // Strictly greater: the earlier sentence wins a tie.
      if (score > best) {
        best = score;
        evidence = sentence;
      }
    }
  }

  return { tier, hits, ...(evidence !== undefined ? { evidence } : {}), paragraphs: mentioned };
}

/**
 * Route each question through the paper. `sections` is the rendered body the
 * page holds (`PaperReading.body`), index-aligned with `map.sections` — the
 * alignment `buildReadingMap` guarantees (§1f.1, §1f.6 amended). Pure and
 * synchronous: nothing it is given changes, and the same input gives the
 * same result.
 */
export function routeByQuestions(
  map: ReadingMap,
  sections: ReadonlyArray<{ paragraphs: readonly string[] }>,
  questions: readonly string[],
): RouteResult {
  const byQuestion = questions.map((question) => {
    const terms = specificTerms(question);
    if (terms.length < MIN_SPECIFIC_TERMS) {
      return { question, vague: true, sections: {} as Record<string, RouteSection> };
    }
    const routed: Record<string, RouteSection> = {};
    map.sections.forEach((row, k) => {
      routed[row.id] = routeSection(sections[k]?.paragraphs ?? [], terms);
    });
    return { question, vague: false, sections: routed };
  });
  return { byQuestion, vague: byQuestion.length > 0 && byQuestion.every((entry) => entry.vague) };
}


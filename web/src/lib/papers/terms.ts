// Terms to know — Tier 0 (P3-01; ruling §1h.1; blueprint §3.5 ⑤ 词).
//
// A paper that defines a word says so in a handful of set shapes: it spells a
// name out and abbreviates it in brackets ("Quantum Processing Units (QPU)"),
// the other way round, or it writes "X, defined as …", "X refers to …", "we
// define X as …". The sentence that does it is the paper's own definition, so
// the strip shows that sentence — verbatim, with its section and page — and
// nothing Peer wrote. No model, no key, no fetch: a pure function of the
// body the page already holds, so it runs in the browser (`paperDefinedTermsInReading`)
// and on a document (`paperDefinedTerms`, the one the tests and any server
// caller use) with the same answer.
//
// Where it reads: the sections the reader's route marks read or background
// when there is one (`routeTermScope`), otherwise the methods and results —
// the sections where a paper puts the words a reader needs to follow its
// numbers — and the whole body only for a paper that has neither.
//
// The abbreviation logic is `term-expand.ts`'s, imported: a bracket is an
// abbreviation of the words before it when its letters are their initials or
// when the abbreviation table (`ABBREVIATION_GROUPS`, through `expandTerm`)
// says the two are the same thing ("lithium cobalt oxide" / "LiCoO2"), and a
// term's first occurrence in the body is found through the same expansion.
//
// Tier 2: Pass 2's `terms` (verified, or Peer's words) come after the Tier 0
// ones, never before and never more than eight in all (`mergeTerms`).

import { canonicalize, expandTerm, isGenericTerm } from "@/lib/scoring/term-expand";
import { MATH_CLOSE, MATH_OPEN } from "@/lib/text/math";
import type { ExtractedDocument } from "./html-text";
import type { PaperReading } from "./reading";
import { GIST_QUESTION, readableSections } from "./reading-map";
import type { PaperTerm } from "./report";
import { splitSentences } from "./skim";

/** Same cap as Pass 2's `terms` (`REPORT_CAPS.terms`, pinned by a test). */
export const MAX_TERMS = 8;
/** Same cap as a report's evidence sentence (`REPORT_CAPS.evidenceChars`, pinned
 *  by a test): a longer sentence is not a crisp definition, and is passed over. */
export const MAX_DEFINITION_CHARS = 400;
const MAX_TERM_CHARS = 60;
/** What a PDF leaves of an equation inside a sentence: an operator. A quote of
 *  such a sentence would show the debris as the paper's words. */
const EQUATION_DEBRIS = /[=∑∈∫≤≥≈∂∇]/u;

// ── The sections a term is read from ─────────────────────────────────────

/** A section as the terms read it: the rendered paragraphs, which are what the
 *  page shows, so a definition found here is a sentence the reader can see. */
export interface TermSection {
  id: string;
  heading: string;
  canonical: string;
  page?: number;
  paragraphs: readonly string[];
}

export interface TermScope {
  sectionIds: readonly string[];
}

/** The document's sections as the body renders them (the abstract and empty
 *  sections are not part of it — `readableSections`). */
export function termSectionsOfDocument(doc: ExtractedDocument): TermSection[] {
  return readableSections(doc).map(({ id, section, paragraphs }) => ({
    id,
    heading: section.heading,
    canonical: section.canonical,
    ...(typeof section.page === "number" ? { page: section.page } : {}),
    paragraphs,
  }));
}

/** The reading's body, with each section's page from the map — what the
 *  browser holds, since it never holds the document. */
export function termSectionsOfReading(reading: Pick<PaperReading, "body" | "map">): TermSection[] {
  const pages = new Map((reading.map?.sections ?? []).map((section) => [section.id, section.page]));
  return (reading.body ?? []).map((section) => {
    const page = pages.get(section.id);
    return {
      id: section.id,
      heading: section.heading,
      canonical: section.canonical,
      ...(typeof page === "number" ? { page } : {}),
      paragraphs: section.paragraphs,
    };
  });
}

/** §1h.1: the scope's sections; with none (or none of them in the paper), the
 *  methods and results; with neither of those, the whole body. */
function sectionsInScope(sections: readonly TermSection[], scope: TermScope | undefined): TermSection[] {
  const wanted = new Set(scope?.sectionIds ?? []);
  if (wanted.size > 0) {
    const named = sections.filter((section) => wanted.has(section.id));
    if (named.length > 0) return named;
  }
  const core = sections.filter((section) => section.canonical === "methods" || section.canonical === "results");
  return core.length > 0 ? core : [...sections];
}

/**
 * The sections the reader's route points at: every section some question
 * reads or marks as background, or undefined when there is no such section
 * (no route, only vague questions, only the gist, or nothing above "skim") —
 * the default scope then applies. A vague question marks nothing, and the
 * gist is a reading order rather than a question a section could answer.
 */
export function routeTermScope(
  route:
    | {
        vague?: boolean;
        byQuestion: ReadonlyArray<{
          question: string;
          vague: boolean;
          sections: Readonly<Record<string, { tier: string }>>;
        }>;
      }
    | undefined,
): TermScope | undefined {
  if (!route || route.vague) return undefined;
  const ids = new Set<string>();
  for (const entry of route.byQuestion) {
    if (entry.vague || entry.question === GIST_QUESTION) continue;
    for (const [id, section] of Object.entries(entry.sections)) {
      if (section.tier === "read" || section.tier === "background") ids.add(id);
    }
  }
  return ids.size > 0 ? { sectionIds: [...ids] } : undefined;
}

// ── The five patterns ────────────────────────────────────────────────────

/** Words that are not a term — nor the start or end of one. */
const STOP_WORDS = new Set(
  (
    "a an the this that these those its their our his her my your it they we you he she them us which who whom whose what " +
    "is are was were be been being has have had do does did can could will would shall should may might must " +
    "of in on at by for with from to into onto over under about as and or but nor so than then there here also thus hence however " +
    "such each both all any some many more most less few several one ones former latter same other another following above below " +
    "term terms word words phrase notation symbol value values case cases way ways " +
    "paper study work section figure table equation result results"
  ).split(" "),
);

/** Words an initialism skips: "Quantum Processing Units" and "Bank of England" alike. */
const INITIAL_SKIP = new Set(["of", "and", "the", "for", "in", "on", "to", "a", "an", "with", "by", "via", "per"]);

const WORD = String.raw`[\p{L}][\p{L}\p{N}'’\-]*`;
const ABBREVIATION = String.raw`\p{Lu}[\p{L}\p{N}\-]{1,11}`;

/** `(ABBR)` — the bracket's own letters; the words before it are looked at next. */
const BRACKETED_ABBREVIATION = new RegExp(String.raw`\(\s*(${ABBREVIATION})\s*\)`, "gu");
/** `ABBR (long form)`. */
const ABBREVIATION_THEN_LONG_FORM = new RegExp(
  String.raw`(?<![\p{L}\p{N}])(${ABBREVIATION})\s*\(\s*([^()]{4,80}?)\s*\)`,
  "gu",
);
/** `X, defined as …` / `X is (then) defined as …`: the four words before it. */
const DEFINED_AS = new RegExp(
  String.raw`((?:${WORD}\s+){0,3}${WORD})\s*,?\s*(?:\(\s*)?(?:which\s+)?(?:(?:is|are)\s+)?(?:(?:then|also|formally|simply|thus|typically)\s+)?defined\s+as\b`,
  "giu",
);
/** `X refers to …`. */
const REFERS_TO = new RegExp(
  String.raw`((?:${WORD}\s+){0,3}${WORD})\s*,?\s*(?:(?:which|that)\s+)?(?:refers?|referring)\s+to\b`,
  "giu",
);
/** `we define X as …`. */
const WE_DEFINE = new RegExp(
  String.raw`\bwe\s+(?:(?:also|further|formally|first|then|now)\s+)?define\s+(?:(?:the|a|an)\s+)?[“"‘']?(${WORD}(?:\s+${WORD}){0,4}?)[”"’']?\s+as\b`,
  "giu",
);
const PHRASE_PATTERNS = [DEFINED_AS, REFERS_TO, WE_DEFINE];

function uppercaseCount(text: string): number {
  return text.match(/\p{Lu}/gu)?.length ?? 0;
}

/** The words just before a position, up to the nearest punctuation. */
function trailingWords(before: string): string[] {
  const text = before.replace(/\s+$/u, "");
  let start = 0;
  for (const mark of text.matchAll(/[^\p{L}\p{N}\p{M}\s'’\-]/gu)) start = (mark.index ?? 0) + mark[0].length;
  return text.slice(start).split(/\s+/u).filter(Boolean);
}

/**
 * Whether `abbreviation` abbreviates `longForm`: the abbreviation table says
 * they are one thing (`expandTerm` — the reuse §1h.1 asks for), or its letters
 * are the initials of the long form's words (hyphenated words count as two;
 * of / and / the and their kind may be left out). A plural "s" after capitals
 * ("SVMs") is not a letter of it.
 */
function abbreviationFits(longForm: string, abbreviation: string): boolean {
  const base = /^(.*\p{Lu})s$/u.exec(abbreviation)?.[1] ?? abbreviation;
  const long = canonicalize(longForm);
  if (long && expandTerm(base).includes(long) && canonicalize(base) !== long) return true;
  const letters = base.replace(/[^\p{L}]/gu, "").toLowerCase();
  const words = longForm.split(/[\s\p{Pd}]+/u).filter(Boolean);
  if (letters.length < 2 || words.length < 2) return false;
  const initials = (list: string[]) => list.map((word) => word[0].toLowerCase()).join("");
  return letters === initials(words) || letters === initials(words.filter((word) => !INITIAL_SKIP.has(word.toLowerCase())));
}

/** The shortest run of the words before a bracket that `abbreviation` abbreviates. */
function longFormBefore(words: readonly string[], abbreviation: string): boolean {
  for (let size = 1; size <= Math.min(words.length, 8); size++) {
    const run = words.slice(-size);
    if (STOP_WORDS.has(run[0].toLowerCase())) continue;
    if (abbreviationFits(run.join(" "), abbreviation)) return true;
  }
  return false;
}

function usable(term: string): boolean {
  if (term.length < 2 || term.length > MAX_TERM_CHARS || !/\p{L}/u.test(term)) return false;
  if (STOP_WORDS.has(term.toLowerCase())) return false;
  return !isGenericTerm(term);
}

/** A phrase a pattern captured, trimmed of the determiners, prepositions and
 *  pronouns around it; null when nothing term-like is left. */
function cleanPhrase(raw: string): string | null {
  const words = raw.split(/\s+/u).filter(Boolean);
  while (words.length > 0 && STOP_WORDS.has(words[0].toLowerCase())) words.shift();
  while (words.length > 0 && STOP_WORDS.has(words[words.length - 1].toLowerCase())) words.pop();
  if (words.length === 0 || words.length > 4) return null;
  const term = words.join(" ");
  return usable(term) ? term : null;
}

interface TermHit {
  term: string;
  at: number;
}

/** The terms one sentence defines, in the order they stand in it. */
function definitionsIn(sentence: string): TermHit[] {
  const hits: TermHit[] = [];
  for (const match of sentence.matchAll(BRACKETED_ABBREVIATION)) {
    const abbreviation = match[1];
    if (uppercaseCount(abbreviation) < 2 || !usable(abbreviation)) continue;
    if (longFormBefore(trailingWords(sentence.slice(0, match.index)), abbreviation)) {
      hits.push({ term: abbreviation, at: match.index });
    }
  }
  for (const match of sentence.matchAll(ABBREVIATION_THEN_LONG_FORM)) {
    const abbreviation = match[1];
    if (uppercaseCount(abbreviation) < 2 || !usable(abbreviation)) continue;
    if (abbreviationFits(match[2], abbreviation)) hits.push({ term: abbreviation, at: match.index });
  }
  for (const pattern of PHRASE_PATTERNS) {
    for (const match of sentence.matchAll(pattern)) {
      const term = cleanPhrase(match[1]);
      if (term) hits.push({ term, at: match.index });
    }
  }
  return hits.sort((a, b) => a.at - b.at);
}

/** One key for a term and its plural, whatever the case. */
function termKey(term: string): string {
  const key = canonicalize(term);
  return key.length > 3 ? key.replace(/s$/, "") : key;
}

// ── Tier 0 ───────────────────────────────────────────────────────────────

/**
 * The terms the sections define in their own sentences: ≤8, the first
 * occurrence of each (case and plural aside) in reading order. Each carries
 * the defining sentence verbatim as both its `definition` and its `evidence`,
 * the section's heading as `evidenceWhere`, the section's id and its page.
 * A sentence with a formula in it (a quote would show bare TeX or an equation's
 * debris) or longer than a report's evidence is passed over.
 */
export function definedTermsIn(sections: readonly TermSection[], scope?: TermScope): PaperTerm[] {
  const found: PaperTerm[] = [];
  const seen = new Set<string>();
  for (const section of sectionsInScope(sections, scope)) {
    for (const paragraph of section.paragraphs) {
      for (const sentence of splitSentences(paragraph)) {
        if (sentence.length > MAX_DEFINITION_CHARS || sentence.includes(MATH_OPEN) || EQUATION_DEBRIS.test(sentence)) continue;
        for (const hit of definitionsIn(sentence)) {
          const key = termKey(hit.term);
          if (seen.has(key)) continue;
          seen.add(key);
          found.push({
            term: hit.term,
            definition: sentence,
            evidence: sentence,
            evidenceWhere: section.heading,
            sectionId: section.id,
            ...(typeof section.page === "number" ? { page: section.page } : {}),
          });
          if (found.length >= MAX_TERMS) return found;
        }
      }
    }
  }
  return found;
}

/** The paper's own definitions, from the document (§1h.1). */
export function paperDefinedTerms(doc: ExtractedDocument, scope?: TermScope): PaperTerm[] {
  return definedTermsIn(termSectionsOfDocument(doc), scope);
}

/** The same, from the reading the page holds — the browser never holds the document. */
export function paperDefinedTermsInReading(reading: Pick<PaperReading, "body" | "map">, scope?: TermScope): PaperTerm[] {
  return definedTermsIn(termSectionsOfReading(reading), scope);
}

// ── Tier 2 ───────────────────────────────────────────────────────────────

/**
 * The Tier 0 terms first, then the model's that are not already there
 * (case and plural aside), ≤8 in all. A model term with evidence is kept as
 * Pass 2's verifier left it; one without is Peer's words and says so.
 */
export function mergeTerms(tier0: readonly PaperTerm[], model: readonly PaperTerm[] | undefined): PaperTerm[] {
  const merged: PaperTerm[] = [];
  const seen = new Set<string>();
  const add = (term: PaperTerm, fromModel: boolean) => {
    const key = termKey(term.term);
    if (merged.length >= MAX_TERMS || seen.has(key)) return;
    seen.add(key);
    merged.push(fromModel && !term.evidence ? { ...term, peer: true } : term);
  };
  for (const term of tier0) add(term, false);
  for (const term of model ?? []) add(term, true);
  return merged;
}

// ── Where a term first stands ────────────────────────────────────────────

export interface TermOccurrence {
  sectionId: string;
  /** The section's index in the body — the anchor `paper-section-<k>`. */
  sectionIndex: number;
  paragraphIndex: number;
  /** Where in the paragraph's text the words start, and how many characters they run. */
  offset: number;
  length: number;
}

/** A formula is one unbreakable box on the page, so a term never starts inside
 *  one and never spans one: its span is blanked, character for character. */
function maskMath(text: string): string {
  if (!text.includes(MATH_OPEN)) return text;
  let masked = "";
  let at = 0;
  while (at < text.length) {
    const open = text.indexOf(MATH_OPEN, at);
    if (open < 0) break;
    const close = text.indexOf(MATH_CLOSE, open + 1);
    if (close < 0) break;
    masked += text.slice(at, open) + "\u0000".repeat(close + 1 - open);
    at = close + 1;
  }
  return masked + text.slice(at);
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** A whole-word matcher for a phrase: a hyphen or a space is one, a plural ends it. */
function phraseMatcher(phrase: string, flags: string): RegExp {
  const tokens = phrase.split(/[\s\p{Pd}]+/u).filter(Boolean).map(escapeRegExp);
  return new RegExp(`(?<![\\p{L}\\p{N}\\p{M}])${tokens.join("[\\s\\p{Pd}]+")}(?:e?s)?(?![\\p{L}\\p{N}\\p{M}])`, flags);
}

/**
 * The term as written (an acronym only as capitals: "NERF" is not "nerf"),
 * and every spelling the abbreviation table gives it ("lithium cobalt oxide"
 * is also "LCO"), whatever the case.
 */
function termMatchers(term: string): RegExp[] {
  const literal = term.trim();
  if (!literal) return [];
  const acronym = !/\p{Ll}/u.test(literal.replace(/(?<=\p{Lu})s$/u, "")) && /\p{Lu}/u.test(literal);
  const own = canonicalize(literal);
  const trivial = new Set([own, `${own}s`, `${own}es`, own.replace(/s$/, "")]);
  const base = acronym ? literal.replace(/(?<=\p{Lu})s$/u, "") : literal;
  const matchers = [phraseMatcher(base, acronym ? "u" : "iu")];
  for (const variant of expandTerm(literal)) {
    if (!trivial.has(variant)) matchers.push(phraseMatcher(variant, "iu"));
  }
  return matchers;
}

/**
 * The first place the body uses the term — the earliest paragraph, and in it
 * the earliest of the term's spellings — or null when the body never does.
 * `sections` is the body (or `readableSections`): anything with an id and
 * paragraphs, in the order the page renders them.
 */
export function firstOccurrence(
  sections: ReadonlyArray<{ id: string; paragraphs: readonly string[] }>,
  term: string,
): TermOccurrence | null {
  const matchers = termMatchers(term);
  if (matchers.length === 0) return null;
  for (const [sectionIndex, section] of sections.entries()) {
    for (const [paragraphIndex, paragraph] of section.paragraphs.entries()) {
      const masked = maskMath(paragraph);
      let best: { offset: number; length: number } | null = null;
      for (const matcher of matchers) {
        const match = matcher.exec(masked);
        if (match && (best === null || match.index < best.offset)) best = { offset: match.index, length: match[0].length };
      }
      if (best) return { sectionId: section.id, sectionIndex, paragraphIndex, ...best };
    }
  }
  return null;
}

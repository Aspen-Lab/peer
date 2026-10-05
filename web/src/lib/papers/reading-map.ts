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

import type { ExtractedDocument } from "./html-text";
import { readableSections } from "./reading";
import { isBoilerplate, splitSentences } from "./skim";

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

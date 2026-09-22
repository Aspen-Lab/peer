// A PDF's text layer, read as a paper: title, sections, figure captions.
//
// This is the part that used to live in `scripts/extract_pdf_text.py`, and
// with it the sentence the reading page had to print — "the PDF is there,
// but only a self-hosted Peer reads PDFs". The helper needed Python and
// PyMuPDF, a compiled extension; a deployed Peer has neither, so every
// PDF-only paper read as "abstract only" in production while reading fine on
// a developer's machine. It is plain TypeScript now, over the text layer
// pdf.js hands back, and the same code runs in both places.
//
// What a PDF gives is words with a size, a font and a position — no
// structure. The structure is inferred here, and only from evidence the page
// carries:
//   a line      items sharing a baseline, left to right
//   a heading   a line set larger than the body, or in the body's other
//               face, or numbered ("3.1 Encoder and Decoder Stacks") — and
//               short enough to be a heading rather than a sentence
//   a paragraph a break in the vertical rhythm, or an indent
//   a caption   a line that opens "Figure 3:" or "Table 2." — the label the
//               figure pool matches against
//   furniture   a line repeated at the same height on most pages: a running
//               head, a folio, a preprint stamp. Dropped.
// Nothing is guessed beyond that: a PDF with no text layer (a scan) yields
// nothing, and says so, rather than inventing sections.
import { blockMarker } from "@/lib/text/math";

import { canonicalizeHeading } from "./html-text";

/** One run of text from the PDF's text layer. */
export interface PdfTextItem {
  str: string;
  /** Font size in points, as the page sets it. */
  height: number;
  /** How wide the run is drawn — a gap to the next one is a space the PDF
   *  never stored. */
  width: number;
  fontName: string;
  x: number;
  /** Baseline, measured from the bottom of the page. */
  y: number;
}

export interface PdfPageText {
  page: number;
  items: PdfTextItem[];
}

export interface PdfLine {
  /** A line that stands alone — a lifted equation's marker — and is never
   *  joined to the prose around it. */
  block?: true;
  page: number;
  text: string;
  x: number;
  y: number;
  size: number;
  font: string;
}

export interface OutlineSection {
  heading?: string;
  canonical?: string;
  page?: number;
  text?: string;
}

export interface OutlineCaption {
  ordinal?: number;
  label?: string;
  caption?: string;
  page?: number;
}

/** A display equation as the PDF printed it: one line of symbols, and the
 *  number the paper gave it. No TeX — a PDF has none. */
export interface OutlineEquation {
  text: string;
  number?: string;
}

export interface PdfOutline {
  title?: string | null;
  sections?: OutlineSection[];
  figureCaptions?: OutlineCaption[];
  equations?: OutlineEquation[];
  pageCount?: number;
  reason?: string | null;
}

/** Baselines this far apart (in points) are the same line. */
const LINE_TOLERANCE = 2.2;
/** A heading is at most this many characters — past it, it is a sentence. */
const HEADING_MAX = 90;
/** Text set this much larger than the body reads as a heading. */
const HEADING_SIZE_RATIO = 1.12;
/** Sections after one of these are the paper's apparatus, not its argument. */
const TERMINAL = new Set(["references", "acknowledgements", "appendix"]);
/** The first of these ends the cover and starts the paper. */
const FRONT_MATTER_END = new Set(["abstract", "introduction"]);

// Roman numerals only in caps: lower case ate the "c" of "Figure captions
// are elsewhere" and called it Figure C.
const CAPTION = /^(fig(?:ure)?|table|scheme|chart)\s*\.?\s*(\d{1,3}|[IVXL]{1,5})\b\s*[.:—–-]?\s*(.*)$/i;
const NUMBERED_HEADING = /^(\d+(?:\.\d+)*)\s*[.)]?\s+(\S.*)$/;
const FOLIO = /^(page\s*)?\d{1,4}$/i;
/** A display equation is set apart like a heading and is not one: it carries
 *  operators, or the number the paper refers to it by. */
const MATHS = /[=+×÷√∑∫∂≈≤≥∈±⟨⟩]|\(\d+\)\s*$/;
/** What a display equation is made of. */
const MATH_SYMBOL = /[=+×÷√∑∏∫∂≈≤≥∈∉±−·∞→←↔≡≠∇∆⊂⊆∪∩^_{}|]/g;
/** An equation is one printed line; past this it is a paragraph with an
 *  equals sign in it. */
const EQUATION_MAX = 120;

/**
 * Whether a line is a display equation, printed on a line of its own.
 *
 * Numbered — ending in "(3)" — with a symbol anywhere; or unnumbered and
 * made mostly of symbols: at least three of them, and fewer than half its
 * characters in words of four letters or more. "softmax(QK^T/√d_k)V" passes;
 * "the loss is defined as follows" does not, and neither does a sentence
 * that happens to end in "(2020)", which has no symbol.
 */
export function equationOf(line: PdfLine): OutlineEquation | null {
  const text = line.text.trim();
  if (!text || text.length > EQUATION_MAX) return null;
  const symbols = (text.match(MATH_SYMBOL) ?? []).length;
  const numbered = /\((\d{1,3}[a-z]?)\)\s*$/.exec(text);
  if (numbered && symbols >= 1) {
    return { text: text.slice(0, numbered.index).trim(), number: `(${numbered[1]})` };
  }
  if (symbols < 3) return null;
  const wordChars = (text.match(/[A-Za-z]{4,}/g) ?? []).join("").length;
  if (wordChars / text.length >= 0.5) return null;
  return { text };
}

function round(n: number): number {
  return Math.round(n * 10) / 10;
}

/** Items on one page, gathered into lines by baseline. */
export function linesOfPage(page: PdfPageText): PdfLine[] {
  const rows = new Map<number, PdfTextItem[]>();
  for (const item of page.items) {
    if (!item.str) continue;
    const key = [...rows.keys()].find((y) => Math.abs(y - item.y) <= LINE_TOLERANCE);
    const at = key ?? round(item.y);
    rows.set(at, [...(rows.get(at) ?? []), item]);
  }
  return [...rows.entries()]
    // Down the page: PDF y grows upward.
    .sort((a, b) => b[0] - a[0])
    .map(([y, items]) => {
      const ordered = [...items].sort((a, b) => a.x - b.x);
      // A PDF stores runs, not words: two runs set apart on the page are two
      // words even where neither carries a space ("Ashish Vaswani" and "Noam
      // Shazeer" arrived as one string until this gap was measured).
      let text = "";
      let cursor = Number.NaN;
      for (const item of ordered) {
        const gap = item.x - cursor;
        if (text && Number.isFinite(cursor) && gap > Math.max(1, item.height * 0.18) && !/\s$/.test(text)) {
          text += " ";
        }
        text += item.str;
        cursor = item.x + (item.width || 0);
      }
      text = text.replace(/\s+/g, " ").trim();
      const widest = ordered.reduce((best, i) => (i.str.trim().length > best.str.trim().length ? i : best), ordered[0]);
      return {
        page: page.page,
        text,
        x: round(ordered[0].x),
        y: round(y),
        size: round(Math.max(...ordered.map((i) => i.height))),
        font: widest.fontName,
      };
    })
    .filter((line) => line.text.length > 0);
}

/** The size and face most of the paper's words are set in. */
export function bodyStyle(lines: PdfLine[]): { size: number; font: string } {
  const bySize = new Map<number, number>();
  const byFont = new Map<string, number>();
  for (const line of lines) {
    bySize.set(line.size, (bySize.get(line.size) ?? 0) + line.text.length);
    byFont.set(line.font, (byFont.get(line.font) ?? 0) + line.text.length);
  }
  const top = <T>(counts: Map<T, number>, fallback: T): T =>
    [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? fallback;
  return { size: top(bySize, 10), font: top(byFont, "") };
}

/** Lines that repeat across pages at the same height: running heads, folios,
 *  preprint stamps. They are the page's furniture, not the paper's words. */
export function furnitureOf(lines: PdfLine[], pageCount: number): Set<string> {
  const seen = new Map<string, Set<number>>();
  for (const line of lines) {
    if (line.text.length > 120) continue;
    const key = `${Math.round(line.y / 6)}:${line.text.replace(/\d+/g, "#").toLowerCase()}`;
    seen.set(key, (seen.get(key) ?? new Set()).add(line.page));
  }
  const repeated = new Set<string>();
  const threshold = Math.max(2, Math.ceil(pageCount * 0.4));
  for (const [key, pages] of seen) if (pages.size >= threshold) repeated.add(key);
  return repeated;
}

function isFurniture(line: PdfLine, furniture: Set<string>): boolean {
  if (FOLIO.test(line.text)) return true;
  const key = `${Math.round(line.y / 6)}:${line.text.replace(/\d+/g, "#").toLowerCase()}`;
  return furniture.has(key);
}

export function captionOf(line: PdfLine): OutlineCaption | null {
  const m = line.text.match(CAPTION);
  if (!m) return null;
  const ordinal = /^\d+$/.test(m[2]) ? Number(m[2]) : undefined;
  return {
    ordinal,
    label: `${m[1]} ${m[2]}`.replace(/\s+/g, " ").trim(),
    caption: m[3].trim(),
    page: line.page,
  };
}

/** The heading this line is, or nothing. */
export function headingOf(line: PdfLine, body: { size: number; font: string }): string | null {
  const text = line.text.trim();
  if (text.length === 0 || text.length > HEADING_MAX) return null;
  if (CAPTION.test(text)) return null;
  // A sentence that happens to be short is still a sentence.
  if (/[.;,]$/.test(text) && !NUMBERED_HEADING.test(text)) return null;
  if (MATHS.test(text)) return null;
  // Letters, mostly: a row of symbols or figures is not a heading.
  const letters = (text.match(/[A-Za-z]/g) ?? []).length;
  if (letters < text.length * 0.5) return null;
  const numbered = text.match(NUMBERED_HEADING);
  // "2.1 Constant velocity model" is a heading; "10 and the flow is clearly
  // laminar" is a line of prose that happens to start with a number.
  if (numbered && numbered[2].length >= 3 && /^[A-Z(]/.test(numbered[2])) return text;
  const bigger = line.size >= body.size * HEADING_SIZE_RATIO;
  const otherFace = line.font !== body.font && line.size >= body.size * 0.95;
  if (!bigger && !otherFace) return null;
  // An unnumbered heading is a word: "Abstract", "Discussion". A row of
  // symbols set in the maths face ("qe,ic0,1 ka,ic0,iqe,1") is an equation
  // the page happens to set apart.
  if (!/[A-Za-z]{4}/.test(text)) return null;
  return text;
}

/** Lines of prose, joined the way the page breaks them: a hyphen at a line's
 *  end is a broken word, a change of rhythm or an indent starts a paragraph. */
export function joinProse(lines: PdfLine[]): string {
  const paragraphs: string[] = [];
  let current = "";
  let previous: PdfLine | null = null;
  const gaps = lines
    .map((line, i) => (i > 0 && lines[i - 1].page === line.page ? lines[i - 1].y - line.y : 0))
    .filter((gap) => gap > 0)
    .sort((a, b) => a - b);
  // The line pitch, not the average gap: a section with one paragraph break
  // in three lines has a median that IS the break, and then nothing breaks.
  const pitch = gaps.length > 0 ? gaps[Math.floor(gaps.length * 0.25)] : 0;
  const left = lines.length > 0 ? Math.min(...lines.map((l) => l.x)) : 0;

  for (const line of lines) {
    if (line.block) {
      if (current.trim()) paragraphs.push(current.trim());
      paragraphs.push(line.text);
      current = "";
      previous = line;
      continue;
    }
    const samePage = previous?.page === line.page;
    const gap = previous && samePage ? previous.y - line.y : 0;
    const breaks =
      previous !== null &&
      ((pitch > 0 && samePage && gap > pitch * 1.6) || (samePage && line.x > left + 6) || previous?.block === true);
    if (breaks && current.trim()) {
      paragraphs.push(current.trim());
      current = "";
    }
    if (!current) current = line.text;
    else if (/[‐-―-]$/.test(current)) current = `${current.slice(0, -1)}${line.text}`;
    else current = `${current} ${line.text}`;
    previous = line;
  }
  if (current.trim()) paragraphs.push(current.trim());
  return paragraphs.join("\n\n");
}

/** The paper's title: the largest words on its first page, above the body. */
function titleOf(lines: PdfLine[], body: { size: number }): string | null {
  const first = lines.filter((line) => line.page === 1 && line.size > body.size * 1.25);
  if (first.length === 0) return null;
  const biggest = Math.max(...first.map((line) => line.size));
  const title = first
    .filter((line) => line.size >= biggest - 0.6)
    .map((line) => line.text)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
  return title.length >= 6 ? title : null;
}

/**
 * The whole reading: pages of text items in, a document out. `reason` is set
 * — and everything else left empty — when the PDF carries no text to read.
 */
export function buildOutline(pages: PdfPageText[]): PdfOutline {
  const lines = pages.flatMap(linesOfPage);
  if (lines.length === 0 || lines.reduce((n, l) => n + l.text.length, 0) < 200) {
    return { pageCount: pages.length, reason: "no-text-layer" };
  }
  const body = bodyStyle(lines);
  const furniture = furnitureOf(lines, pages.length);
  const title = titleOf(lines, body);

  // A first page opens with names, affiliations and a preprint stamp — set
  // in their own sizes, so every one of them reads as a heading. The paper
  // starts at its first named part; anything above that is the cover.
  const firstNamed = lines.findIndex((line) => {
    const head = headingOf(line, body);
    return head !== null && FRONT_MATTER_END.has(canonicalizeHeading(head));
  });
  const read = firstNamed > 0 ? lines.slice(firstNamed) : lines;

  const sections: OutlineSection[] = [];
  const figureCaptions: OutlineCaption[] = [];
  const equations: OutlineEquation[] = [];
  let heading: string | null = null;
  let canonical = "body";
  let page = pages[0]?.page ?? 1;
  let held: PdfLine[] = [];
  let done = false;

  const flush = () => {
    const text = joinProse(held);
    if (text.trim().length > 0) {
      sections.push({ heading: heading ?? undefined, canonical, page, text });
    }
    held = [];
  };

  for (const line of read) {
    if (isFurniture(line, furniture)) continue;
    const caption = captionOf(line);
    if (caption) {
      // A caption belongs to the figure pool, not to the prose it interrupts.
      if (caption.caption && caption.caption.length > 0) figureCaptions.push(caption);
      continue;
    }
    const next = headingOf(line, body);
    if (next) {
      flush();
      heading = next;
      canonical = canonicalizeHeading(next);
      page = line.page;
      // The argument ends at the references; what follows is apparatus.
      if (TERMINAL.has(canonical)) done = true;
      continue;
    }
    if (done) continue;
    if (title && line.page === 1 && line.size > body.size * 1.25) continue;
    const equation = equationOf(line);
    if (equation) {
      // The equation keeps its place in the prose as a marker paragraph,
      // and its symbols go beside the sections rather than into them.
      equations.push(equation);
      held.push({ ...line, text: blockMarker(equations.length - 1), block: true });
      continue;
    }
    held.push(line);
  }
  flush();

  return {
    title,
    sections,
    figureCaptions,
    ...(equations.length > 0 ? { equations } : {}),
    pageCount: pages.length,
    reason: sections.length === 0 ? "no-sections" : null,
  };
}

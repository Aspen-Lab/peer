// A PDF's text layer, read as a paper: title, sections, figure captions.
//
// This is the part that used to live in `scripts/extract_pdf_text.py`, and
// with it the sentence the reading page had to print — "the PDF is there,
// but only a self-hosted Peer reads PDFs". The helper needed Python and
// PyMuPDF, a compiled extension; a deployed Peer has neither, so every
// PDF-only paper read as "abstract only" in production while reading fine on
// a developer's machine. It is plain TypeScript now, over the text layer
// pdf.js hands back, and the same code runs in both places — for a PDF link
// and, since P0-03, for an uploaded PDF too (the helper is deleted).
//
// What a PDF gives is words with a size, a font and a position — no
// structure. The structure is inferred here, and only from evidence the page
// carries:
//   a line      items sharing a baseline, left to right — within a column,
//               on a page set in two (the gutter between them is found, not
//               assumed), with a superscript on the line it belongs to
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
/** Sections after one of these are the paper's apparatus, not its argument.
 *  Compared against what `canonicalizeHeading` returns. */
const TERMINAL = new Set(["references"]);
/**
 * The apparatus headings no bucket can name safely, matched on the
 * heading's own words (numbered or not).
 *
 * P0-01: `TERMINAL` used to hold "acknowledgements" and "appendix", which
 * `canonicalizeHeading` never returns — it files "Acknowledgements" under
 * `acknowledgments`, and strips "Appendix A Proofs" down to "proofs" →
 * `body` — so the thank-yous and the proofs were read as the paper's
 * argument. Ending at the `acknowledgments` bucket would be wrong too: it
 * also holds "Funding", "Data availability" and "Competing interests",
 * which some templates print on page 1, under the abstract.
 */
const APPARATUS_HEADING =
  /^(?:(?:[A-Z]|[IVX]+|\d+)(?:\.\d+)*\.?\s+)?(?:acknowledge?ments?|appendix|appendices|supplementary\s+(?:materials?|information))\b/i;

function endsTheArgument(heading: string, canonical: string): boolean {
  return TERMINAL.has(canonical) || APPARATUS_HEADING.test(heading.trim());
}
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
/** A line of this many real words is a sentence with notation in it, not an
 *  equation, whatever its symbols. */
const EQUATION_PROSE_WORDS = 3;
/** A caption stops being a caption somewhere; past this it is the prose
 *  under the figure that never opened a gap. */
const CAPTION_MAX = 700;
/** A line at least this share of the body size is full-size: it bounds the
 *  page's text. */
const FULL_SIZE_RATIO = 0.9;
/** A line set smaller than this share of the body size, above the page's
 *  first or below its last full-size line, is margin print. */
const MARGIN_PRINT_RATIO = 0.8;
/** A heading that wraps: the second line is set at the first's size, within
 *  this many points... */
const HEADING_WRAP_SIZE = 0.6;
/** ...and no further below it than this many of its own sizes. */
const HEADING_WRAP_LEADING = 1.5;

/** The 25th-percentile gap between consecutive same-page lines — the pitch
 *  of a block of text, as `joinProse` reads it. 0 when there is nothing to
 *  measure. */
export function linePitch(lines: PdfLine[]): number {
  const gaps: number[] = [];
  for (let i = 1; i < lines.length; i++) {
    if (lines[i - 1].page !== lines[i].page) continue;
    const gap = lines[i - 1].y - lines[i].y;
    if (gap > 0) gaps.push(gap);
  }
  if (gaps.length === 0) return 0;
  gaps.sort((a, b) => a - b);
  return gaps[Math.floor(gaps.length * 0.25)];
}

/**
 * Whether `next` is the next printed line of the caption `previous` is part
 * of: the same page, within a line pitch and a half below, in the SAME FACE
 * as the caption's last line, at its size, and not itself a caption, the
 * page's furniture or a numbered heading.
 *
 * The face is the test, not the size: a caption is set in its own face — on
 * one real PDF, `g_d0_f1` against the body's `g_d0_f8`, both at 12pt — so
 * size told the two apart not at all, and the prose under the figure read
 * as more caption. And `headingOf` is not consulted: it takes "in the other
 * face" for a heading, which is exactly what a caption's second line is.
 */
export function continuesCaption(
  previous: PdfLine,
  next: PdfLine,
  pitch: number,
  body: { size: number; font: string },
  furniture: Set<string>,
): boolean {
  if (next.page !== previous.page) return false;
  const gap = previous.y - next.y;
  if (gap <= 0) return false;
  if (pitch > 0 && gap > pitch * 1.5) return false;
  if (next.font !== previous.font) return false;
  if (Math.abs(next.size - previous.size) > 0.6) return false;
  const text = next.text.trim();
  if (!text) return false;
  if (isFurniture(next, furniture)) return false;
  if (captionOf(next)) return false;
  if (NUMBERED_HEADING.test(text) && text.length <= HEADING_MAX) return false;
  // `body` is kept in the signature for the callers that pass it; the face
  // test above is what distinguishes caption from prose.
  void body;
  return true;
}

/** How many real words a line holds: letters only, four or more, set apart by
 *  spaces or a hyphen ("texture", "observed", the "situ" of "ex-situ" — not the
 *  "softmax" of "softmax(QK^T/√d_k)V", which is fused to its brackets).
 *  Punctuation round a word is not part of it. */
function realWords(text: string): number {
  const edge = /^[.,;:!?'"\u2018\u2019\u201c\u201d()[\]]+|[.,;:!?'"\u2018\u2019\u201c\u201d()[\]]+$/g;
  return text.split(/[\s\-\u2010\u2011]+/).filter((token) => /^[A-Za-z]{4,}$/.test(token.replace(edge, ""))).length;
}

/**
 * Whether a line is a display equation, printed on a line of its own.
 *
 * Numbered — ending in "(3)" — with a symbol anywhere (a numbered equation
 * can carry words: "where … (3)"); or unnumbered and made mostly of symbols:
 * at least three of them, fewer than three real words, and fewer than half its
 * characters in words of four letters or more. "softmax(QK^T/√d_k)V" passes;
 * "the loss is defined as follows" does not, and neither does a sentence
 * that happens to end in "(2020)", which has no symbol — nor a sentence with
 * notation in it, "⟨003⟩||ND + ⟨101⟩||ND texture was observed in the films",
 * which three words make prose whatever its symbols.
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
  if (realWords(text) >= EQUATION_PROSE_WORDS) return null;
  const wordChars = (text.match(/[A-Za-z]{4,}/g) ?? []).join("").length;
  if (wordChars / text.length >= 0.5) return null;
  return { text };
}

function round(n: number): number {
  return Math.round(n * 10) / 10;
}

// ── Lines, column by column ─────────────────────────────────────────────────
//
// A journal paper is set in two columns, and a PDF stores no column: only
// runs of text and where they sit. The columns are found from what the page
// prints — an empty vertical band, a gutter, that runs down many lines with
// text on both sides — and each is read to its end before the next begins.
// The old reading keyed a line by its baseline alone, so two columns whose
// baselines fell within 2.2pt were one line (the gutter a single space) and
// two whose baselines did not were interleaved by height.

/** The empty band between a page's two columns: `a` is where the left
 *  column's text ends, `b` where the right column's begins. */
export interface Gutter {
  a: number;
  b: number;
}

/** Runs set smaller than this share of the page's usual text height are
 *  scripts — a superscript, a subscript, an ordinal, a citation number — not
 *  text of their own. */
const SCRIPT_RATIO = 0.75;
/** A script's baseline sits at most this far above the baseline of the line
 *  it belongs to (a superscript)... */
const SCRIPT_RISE = 7.5;
/** ...or this far below it (a subscript). */
const SCRIPT_DROP = 3.5;
/** A gutter is at least this many ems wide. */
const GUTTER_EM = 2;
/** The gutter is looked for in the middle of the text's width: between these
 *  shares of it. */
const GUTTER_SEARCH: readonly [number, number] = [0.35, 0.65];
/** Fewer consecutive rows than this with an empty gutter is not a column. */
const GUTTER_MIN_ROWS = 8;
/** Each side of a gutter spans at least this share of the text's width: a
 *  column, not a margin note. */
const COLUMN_MIN_SPAN = 0.3;
/** Running prose fills its column: the median line spans at least this share
 *  of the column. Cards and table cells do not. */
const COLUMN_FILL = 0.6;
/** A row whose text has no gap wider than this many ems across the gutter is
 *  one line — a title, a caption, a full-width paragraph — not two. */
const GUTTER_BRIDGE_EM = 0.8;
/** The label a paragraph can open with, set in a face of its own:
 *  "ABSTRACT: Quillwort cathodes degrade through…". */
const RUN_IN_LABEL = /^(?:abstract|summary|synopsis|key\s*words?|highlights)\s*[:.—–-]?$/i;

/** One baseline's worth of runs. */
interface Row {
  y: number;
  items: PdfTextItem[];
}

const median = (values: number[]): number =>
  values.length > 0 ? [...values].sort((x, y) => x - y)[Math.floor(values.length / 2)] : 0;

/** The text height most of the page's characters are set at. */
function usualHeight(items: PdfTextItem[]): number {
  const chars = new Map<number, number>();
  for (const item of items) chars.set(round(item.height), (chars.get(round(item.height)) ?? 0) + item.str.trim().length);
  return [...chars.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 0;
}

/**
 * Runs gathered into rows by baseline, top of the page first. A script folds
 * into the row it belongs to, not into a row of its own placed above it:
 * "after the 1st, 20th cycle" is one line, not "st th" over "after the 1 , 20
 * cycle". `text` is the page's usual text height; 0 turns the folding off.
 */
function rowsOf(items: PdfTextItem[], text: number): Row[] {
  const rows: Row[] = [];
  const scripts: PdfTextItem[] = [];
  const place = (item: PdfTextItem) => {
    const row = rows.find((r) => Math.abs(r.y - item.y) <= LINE_TOLERANCE);
    if (row) row.items.push(item);
    else rows.push({ y: round(item.y), items: [item] });
  };
  for (const item of items) {
    if (text > 0 && item.height < text * SCRIPT_RATIO && item.str.trim()) scripts.push(item);
    else place(item);
  }
  for (const script of scripts) {
    let nearest: Row | undefined;
    for (const row of rows) {
      const rise = script.y - row.y;
      if (rise < -SCRIPT_DROP || rise > SCRIPT_RISE) continue;
      if (!nearest || Math.abs(rise) < Math.abs(script.y - nearest.y)) nearest = row;
    }
    if (nearest) nearest.items.push(script);
    else place(script);
  }
  // Down the page: PDF y grows upward.
  return rows.sort((a, b) => b.y - a.y);
}

/** The longest run of text among these: the one whose face the line is set in. */
const longestRun = (runs: PdfTextItem[]): PdfTextItem =>
  runs.reduce((best, i) => (i.str.trim().length > best.str.trim().length ? i : best), runs[0]);

/** Runs read left to right as one line. */
function lineOf(page: number, y: number, runs: PdfTextItem[]): PdfLine | null {
  // A PDF stores runs, not words: two runs set apart on the page are two
  // words even where neither carries a space ("Ashish Vaswani" and "Noam
  // Shazeer" arrived as one string until this gap was measured).
  let text = "";
  let cursor = Number.NaN;
  for (const item of runs) {
    const gap = item.x - cursor;
    if (text && Number.isFinite(cursor) && gap > Math.max(1, item.height * 0.18) && !/\s$/.test(text)) {
      text += " ";
    }
    text += item.str;
    cursor = item.x + (item.width || 0);
  }
  text = text.replace(/\s+/g, " ").trim();
  if (text.length === 0) return null;
  return {
    page,
    text,
    x: round(runs[0].x),
    y: round(y),
    size: round(Math.max(...runs.map((i) => i.height))),
    font: longestRun(runs).fontName,
  };
}

/**
 * A row as a line — or as two, when it opens with a run-in label in a face of
 * its own: "ABSTRACT:" in bold ahead of the abstract's words is a heading and
 * the line the abstract starts on, so the abstract has a heading to be found by.
 */
function linesOfRow(page: number, row: Row): PdfLine[] {
  const ordered = [...row.items].sort((a, b) => a.x - b.x);
  const [first, ...rest] = ordered;
  if (rest.length > 0 && RUN_IN_LABEL.test(first.str.trim()) && first.fontName !== longestRun(rest).fontName) {
    const label = lineOf(page, row.y, [first]);
    const words = lineOf(page, row.y, rest);
    if (label && words) return [{ ...label, text: label.text.replace(/[:.—–-]$/, "") }, words];
  }
  const line = lineOf(page, row.y, ordered);
  return line ? [line] : [];
}

/** Runs gathered into lines by baseline. */
function linesOfItems(page: number, items: PdfTextItem[], text: number): PdfLine[] {
  return rowsOf(items, text).flatMap((row) => linesOfRow(page, row));
}

/** The width of the runs a row holds, first edge to last. */
const extent = (runs: PdfTextItem[]): number =>
  Math.max(...runs.map((i) => i.x + i.width)) - Math.min(...runs.map((i) => i.x));

/** The longest run of consecutive rows no text of which touches the band
 *  `[x0, x0 + width)`. A row that does touch it ends a run. */
function longestClearRun(rows: Row[], x0: number, width: number): Row[] {
  let run: Row[] = [];
  let longest: Row[] = [];
  for (const row of rows) {
    if (row.items.every((i) => i.x + i.width <= x0 || i.x >= x0 + width)) {
      run.push(row);
      continue;
    }
    if (run.length > longest.length) longest = run;
    run = [];
  }
  return run.length > longest.length ? run : longest;
}

/**
 * The gutter of a page set in two columns, or null.
 *
 * A 2-em band is slid across the middle of the text's width, and the band
 * that stays empty for the most consecutive rows is the candidate. It is a
 * gutter when that run is at least `GUTTER_MIN_ROWS` rows with text on both
 * sides in at least that many of them, each side spans a good share of the
 * page's text and its median line fills it. Rows that cross the band — a
 * title, a figure caption — end a run but do not stop the page from being
 * two columns. A page of fewer than twice `GUTTER_MIN_ROWS` baselines has too
 * little text to show a gutter of its own; it takes the paper's
 * (`gutterPrior`). `text` is the page's usual text height; scripts are not ink.
 */
export function gutterOf(items: PdfTextItem[], text: number): Gutter | null {
  const ink = items.filter((i) => i.str.trim() && i.width > 0 && i.height >= text * SCRIPT_RATIO);
  const rows = rowsOf(ink, 0);
  if (rows.length < GUTTER_MIN_ROWS * 2) return null;
  const lo = Math.min(...ink.map((i) => i.x));
  const hi = Math.max(...ink.map((i) => i.x + i.width));
  const span = hi - lo;
  const width = GUTTER_EM * text;

  let best: { x0: number; run: Row[] } | null = null;
  for (let x0 = lo + span * GUTTER_SEARCH[0]; x0 + width <= lo + span * GUTTER_SEARCH[1]; x0 += 1) {
    const run = longestClearRun(rows, x0, width);
    if (run.length < GUTTER_MIN_ROWS || (best && run.length <= best.run.length)) continue;
    // A column can be mostly a figure (a page of one column of text and one of
    // picture): what makes a column is a run of lines, not a share of the page.
    const onLeft = run.filter((r) => r.items.some((i) => i.x + i.width <= x0)).length;
    const onRight = run.filter((r) => r.items.some((i) => i.x >= x0 + width)).length;
    if (onLeft >= GUTTER_MIN_ROWS && onRight >= GUTTER_MIN_ROWS) best = { x0, run };
  }
  if (!best) return null;

  const { x0, run } = best;
  const all = run.flatMap((r) => r.items);
  const left = all.filter((i) => i.x + i.width <= x0);
  const right = all.filter((i) => i.x >= x0 + width);
  const a = Math.max(...left.map((i) => i.x + i.width));
  const b = Math.min(...right.map((i) => i.x));
  const leftSpan = extent(left);
  const rightSpan = extent(right);
  // Each side must be a column, not a margin note...
  if (leftSpan < span * COLUMN_MIN_SPAN || rightSpan < span * COLUMN_MIN_SPAN) return null;
  // ...of prose, not cards or table cells: the median line fills its side.
  const lineWidths = (side: (r: Row) => PdfTextItem[]) => median(run.map(side).filter((r) => r.length > 0).map(extent));
  const fills =
    lineWidths((r) => r.items.filter((i) => i.x + i.width <= a + 0.5)) >= leftSpan * COLUMN_FILL &&
    lineWidths((r) => r.items.filter((i) => i.x >= b - 0.5)) >= rightSpan * COLUMN_FILL;
  return fills ? { a, b } : null;
}

/**
 * The gutter most pages of a paper agree on: what a page that shows none of
 * its own (a page of figures, a page of few lines) is set in. Null when fewer
 * than two pages agree.
 */
export function gutterPrior(pages: PdfPageText[]): Gutter | null {
  const votes = new Map<number, Gutter & { n: number }>();
  for (const { items: all } of pages) {
    const items = all.filter((i) => i.str);
    const gutter = gutterOf(items, usualHeight(items));
    if (!gutter) continue;
    const key = Math.round(gutter.b / 3);
    const vote = votes.get(key);
    // The right column's left edge is the steady one; the left edge moves with an overhang.
    votes.set(key, { a: vote ? Math.min(vote.a, gutter.a) : gutter.a, b: gutter.b, n: (vote?.n ?? 0) + 1 });
  }
  const top = [...votes.values()].sort((x, y) => y.n - x.n)[0];
  return top && top.n >= 2 ? { a: top.a, b: top.b } : null;
}

/** Whether a row's text runs unbroken across the gutter — a title, a caption,
 *  a full-width paragraph — rather than a line of each column at one height. */
function crossesGutter(row: Row, gutter: Gutter, text: number): boolean {
  const ordered = row.items.filter((i) => i.str.trim()).sort((a, b) => a.x - b.x);
  if (!ordered.some((i) => i.x < gutter.a - 1) || !ordered.some((i) => i.x + i.width > gutter.b + 1)) return false;
  let reach = -Infinity;
  for (const item of ordered) {
    // A gap wider than a word space, lying over the gutter, means two lines.
    if (reach > -Infinity && item.x - reach > GUTTER_BRIDGE_EM * text && reach < gutter.b && item.x > gutter.a) return false;
    reach = Math.max(reach, item.x + item.width);
  }
  return true;
}

/** A stretch of a page between two full-width lines: the runs of its left column and of its right. */
interface Band {
  left: PdfTextItem[];
  right: PdfTextItem[];
}

/**
 * Items on one page, gathered into lines by baseline — column by column on a
 * page set in two. `prior` is the paper's usual gutter (`gutterPrior`), for a
 * page too sparse to show one of its own.
 *
 * Reading order: down the page, a full-width line stands where it is and ends
 * the band above it; a band is its left column top to bottom, then its right
 * column top to bottom. Each column's lines are built on their own, so two
 * columns whose baselines agree are not welded and two whose baselines drift
 * are not interleaved. A run belongs to the column it starts in: a word that
 * overhangs the gutter stays with its line.
 */
export function linesOfPageWith(page: PdfPageText, prior: Gutter | null): PdfLine[] {
  const items = page.items.filter((i) => i.str);
  const text = usualHeight(items);
  const gutter = gutterOf(items, text) ?? prior;
  if (!gutter) return linesOfItems(page.page, items, text);

  const middle = (gutter.a + gutter.b) / 2;
  const pieces: ({ span: Row } | Band)[] = [];
  let band: Band | null = null;
  for (const row of rowsOf(items, text)) {
    if (crossesGutter(row, gutter, text)) {
      pieces.push({ span: row });
      band = null;
      continue;
    }
    if (!band) pieces.push((band = { left: [], right: [] }));
    for (const item of row.items) (item.x < middle ? band.left : band.right).push(item);
  }
  const made = pieces.map(
    (piece): { span: PdfLine[] } | { left: PdfLine[]; right: PdfLine[] } =>
      "span" in piece
        ? { span: linesOfRow(page.page, piece.span) }
        : { left: linesOfItems(page.page, piece.left, text), right: linesOfItems(page.page, piece.right, text) },
  );

  // The right column's indents are read from the column's own edge: most of
  // its lines start at the column's left edge, so the median start is that
  // edge, and `joinProse` (which reads an indent as x past the section's
  // leftmost line) sees the right column where the left one stands.
  const startL = median(made.flatMap((m) => ("left" in m ? m.left.map((line) => line.x) : [])));
  const startR = median(made.flatMap((m) => ("right" in m ? m.right.map((line) => line.x) : [])));
  const shift = startL && startR ? startR - startL : 0;
  return made.flatMap((m) =>
    "span" in m ? m.span : [...m.left, ...m.right.map((line) => ({ ...line, x: round(line.x - shift) }))],
  );
}

/** Items on one page, gathered into lines by baseline — column by column on a
 *  page set in two, as the page shows them. */
export function linesOfPage(page: PdfPageText): PdfLine[] {
  return linesOfPageWith(page, null);
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

/**
 * The lines that are margin print: small print above the page's first or
 * below its last full-size line — the publisher's copyright and DOI footer, a
 * download stamp. A journal prints them on its first page only, so no
 * repetition marks them as furniture, and they landed in the middle of the
 * sentence that crosses the page break.
 */
function marginPrintOf(lines: PdfLine[], body: { size: number }): (line: PdfLine) => boolean {
  const edges = new Map<number, { top: number; bottom: number }>();
  for (const line of lines) {
    if (line.size < body.size * FULL_SIZE_RATIO) continue;
    const edge = edges.get(line.page) ?? { top: -Infinity, bottom: Infinity };
    edges.set(line.page, { top: Math.max(edge.top, line.y), bottom: Math.min(edge.bottom, line.y) });
  }
  return (line) => {
    const edge = edges.get(line.page);
    return !!edge && line.size < body.size * MARGIN_PRINT_RATIO && (line.y < edge.bottom || line.y > edge.top);
  };
}

/**
 * Whether `line`, which is itself a heading (`text`), is the second line of
 * the heading `previous` began: on the same page, in the same face and size,
 * one leading below it, and not a numbered heading of its own. "2.1. Slow
 * Annealing Schedules for Quillwort Cathode" and "Films" below it are one
 * heading.
 */
function wrapsHeading(previous: PdfLine | null, line: PdfLine, text: string): boolean {
  if (!previous || previous.page !== line.page || previous.font !== line.font) return false;
  if (Math.abs(previous.size - line.size) > HEADING_WRAP_SIZE) return false;
  const drop = previous.y - line.y;
  return drop > 0 && drop <= line.size * HEADING_WRAP_LEADING && !NUMBERED_HEADING.test(text);
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

/**
 * The section number a line opens with ("3.2.1", "10."), or null. A real one is
 * one to three digits to a group and has no zero before its decimal point:
 * "0.661) (Figure 4F…" is a measurement torn from a sentence and "2026 was the
 * year" is a year, whatever capital letter follows them.
 */
function sectionNumberOf(text: string): RegExpMatchArray | null {
  const numbered = text.match(NUMBERED_HEADING);
  return numbered && !/^(?:0\.\d|\d{4,})/.test(numbered[1]) ? numbered : null;
}

/** The heading this line is, or nothing. */
export function headingOf(line: PdfLine, body: { size: number; font: string }): string | null {
  const text = line.text.trim();
  if (text.length === 0 || text.length > HEADING_MAX) return null;
  if (CAPTION.test(text)) return null;
  const numbered = sectionNumberOf(text);
  // A sentence that happens to be short is still a sentence.
  if (/[.;,]$/.test(text) && !numbered) return null;
  // An unnumbered line that ends on a hyphen is a line the page broke
  // ("…at high super-"), not a heading.
  if (/[-‐‑−]$/.test(text) && !numbered) return null;
  if (MATHS.test(text)) return null;
  // Letters, mostly: a row of symbols or figures is not a heading.
  const letters = (text.match(/[A-Za-z]/g) ?? []).length;
  if (letters < text.length * 0.5) return null;
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

/**
 * A line that is a stamp, not a title: an arXiv identifier, a DOI, a URL.
 * arXiv's own stamp runs up the margin and never reaches here (`readPages`
 * drops sideways text); one set level and large still is not the title.
 * P0-03: the upload title used to come from the Python helper, which had this
 * guard; uploads are read here now. Same pattern as the upload route's own
 * `TITLE_STAMP_RE`.
 */
const STAMP = /^(?:arXiv:\d{4}\.\d{4,5}|10\.\d{4,9}\/|https?:\/\/)/i;

/** The paper's title: the largest words on its first page, above the body. */
function titleOf(lines: PdfLine[], body: { size: number }): string | null {
  const first = lines.filter((line) => line.page === 1 && line.size > body.size * 1.25 && !STAMP.test(line.text));
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
 * `prior` is the paper's usual column gutter, which a page too sparse to show
 * one of its own is read with; it is found from `pages` unless the caller has
 * it already.
 */
export function buildOutline(pages: PdfPageText[], prior: Gutter | null = gutterPrior(pages)): PdfOutline {
  const lines = pages.flatMap((page) => linesOfPageWith(page, prior));
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

  // The line pitch across the paper — the gap between consecutive lines of
  // one block — so a caption's second line can be told from the prose that
  // resumes under the figure by the space above it.
  const pitch = linePitch(read);
  const isMarginPrint = marginPrintOf(lines, body);
  let lastHeading: PdfLine | null = null;

  for (let i = 0; i < read.length; i++) {
    const line = read[i];
    if (isFurniture(line, furniture) || isMarginPrint(line)) continue;
    const caption = captionOf(line);
    if (caption) {
      // A caption belongs to the figure pool, not to the prose it interrupts.
      // It is as many lines as it was printed on: the lines under it at the
      // line pitch, in its own size, until the gap opens or the prose's size
      // returns. The old reading took the first line and stopped, and a
      // caption arrived as "Medical image analysis pipeline showing
      // preprocessing," — a clause with its sentence cut off.
      const rest: string[] = [];
      let previous = line;
      while (i + 1 < read.length) {
        const nextLine = read[i + 1];
        if (!continuesCaption(previous, nextLine, pitch, body, furniture)) break;
        rest.push(nextLine.text.trim());
        previous = nextLine;
        i++;
      }
      const full = [caption.caption ?? "", ...rest].join(" ").replace(/\s+/g, " ").trim().slice(0, CAPTION_MAX);
      if (full.length > 0) figureCaptions.push({ ...caption, caption: full });
      continue;
    }
    const next = headingOf(line, body);
    if (next) {
      if (heading !== null && wrapsHeading(lastHeading, line, next)) {
        heading = `${heading} ${next}`;
      } else {
        flush();
        heading = next;
        page = line.page;
      }
      lastHeading = line;
      canonical = canonicalizeHeading(heading);
      // The argument ends at the references, the acknowledgements or an
      // appendix; what follows is apparatus.
      if (endsTheArgument(heading, canonical)) done = true;
      continue;
    }
    lastHeading = null;
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

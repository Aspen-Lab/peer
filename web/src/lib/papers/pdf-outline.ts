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

import { bucketInheritor, canonicalizeHeading } from "./html-text";

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
  /** How far the line's runs reach to the right of `x`. `foldStacks` compares the x-ranges of a
   *  fraction's rows by it (P9-13a). */
  reach?: number;
  /** The raised run or runs the line opens with, as P9-08's fold took them in from above the baseline,
   *  and the words after them: a fraction's numerator, ahead of the row it was set over (P9-13a). */
  head?: { text: string; rest: string; reach: number };
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

/** A display equation as the PDF printed it: the numbered line of symbols, and
 *  the number the paper gave it (P8-03: a PDF line is one only when numbered).
 *  No TeX — a PDF has none. */
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

/** A section number in front of a heading's own words ("4.", "IV", "B.2"); case-sensitive, so the
 *  "A" of "A funding model" is not one more than the article it is. */
const SECTION_LEAD = /^(?:[A-Z]|[IVX]+|\d+)(?:\.\d+)*\.?\s+/;
/**
 * P7-18 (F2, §1h.39 b): the end matter a journal prints after the argument,
 * matched on the heading's own words (numbered or not, any case). What these
 * name is never the paper's argument, wherever the template puts it:
 * "ASSOCIATED CONTENT" and its "Supporting Information", "AUTHOR INFORMATION"
 * with the authors' affiliations under it, the author contributions. "Notes"
 * is not in the list: it is end matter only because it stands after one of
 * these, and everything after the first is out already.
 */
const END_MATTER_HEADING =
  /^(?:associated\s+content|author\s+(?:information|contributions?)\b|supporting\s+information(?:\s+(?:available|statement))?\s*[:.]?\s*$)/i;
/**
 * The end-matter headings some templates print on page 1, under the abstract
 * (P0-01's own comment names three of them). They end the argument only where
 * they stand after the body's last numbered section; elsewhere they are a
 * section like any other. "Funding" is the heading alone — "Funding models
 * for research" is a body section.
 */
const END_MATTER_AFTER_BODY =
  /^(?:funding(?:\s+(?:sources?|information|statement|support))?\s*[:.]?\s*$|conflicts?\s+of\s+interests?\b|declarations?\s+of\s+(?:competing\s+|conflicting\s+)?interests?\b|competing\s+(?:financial\s+)?interests?\b|data\s+availability\b)/i;

/**
 * P8-03 (BACKLOG-34, §1h.41 c): what a template prints in front of a heading's own words — a box,
 * a bullet, an asterisk ("■ ACKNOWLEDGMENTS", "• References") — is a run of characters that are
 * neither letters nor digits; a digit is a section number, which `SECTION_LEAD` strips after it
 * ("■ 5. Funding" still reads as numbered). Behind such a run an icon font's own letters can
 * stand, up to three, lower case, apart from the words: the "sı" of "*sı Supporting Information"
 * (the journal's Supporting Information icon, which the text layer gives as two letters). Without
 * a glyph in front, a heading that starts with a letter is read as it is.
 */
const GLYPH_LEAD = /^[^\p{L}\p{N}]+(?:\p{Ll}{1,3}\s+)?/u;

/** Whether this heading, by its own words, is the paper's apparatus or end matter wherever it
 *  stands (`afterBody` false) or once the body's last numbered section is behind it (true). A glyph
 *  in front of the words is not part of them: glyphs first, then the section number. */
function endsTheArgument(heading: string, canonical: string, afterBody = false): boolean {
  const text = heading.trim().replace(GLYPH_LEAD, "");
  if (TERMINAL.has(canonical) || APPARATUS_HEADING.test(text)) return true;
  const own = text.replace(SECTION_LEAD, "");
  return END_MATTER_HEADING.test(own) || (afterBody && END_MATTER_AFTER_BODY.test(own));
}
/** The first of these ends the cover and starts the paper. */
const FRONT_MATTER_END = new Set(["abstract", "introduction"]);

// Roman numerals only in caps: lower case ate the "c" of "Figure captions
// are elsewhere" and called it Figure C.
const CAPTION = /^(fig(?:ure)?|table|scheme|chart)\s*\.?\s*(\d{1,3}|[IVXL]{1,5})\b\s*[.:—–-]?\s*(.*)$/i;
const NUMBERED_HEADING = /^(\d+(?:\.\d+)*)\s*[.)]?\s+(\S.*)$/;
const FOLIO = /^(page\s*)?\d{1,4}$/i;
/** A line of the publication history a journal prints in a box on the first
 *  page: "Received: January 24, 2026", "Accepted 9 March 2026" — one of those
 *  words and a date. */
const PUBLICATION_DATE = new RegExp(
  "^(?:received|revised|accepted|published|available\\s+online|submitted)(?:\\s*:\\s*|\\s+)" +
    "(?:\\d|(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\\.?\\s*\\d)",
  "i",
);
/** A display equation is set apart like a heading and is not one: it carries
 *  operators, or the number the paper refers to it by. */
const MATHS = /[=+×÷√∑∫∂≈≤≥∈±⟨⟩]|\(\d+\)\s*$/;
/** What a display equation is made of: a numbered line needs one of these (no `g` flag: `test` on a
 *  global pattern keeps its place from one call to the next). */
const MATH_SYMBOL = /[=+×÷√∑∏∫∂≈≤≥∈∉±−·∞→←↔≡≠∇∆⊂⊆∪∩^_{}|]/;
/** An equation is one printed line; past this it is a paragraph with an
 *  equals sign in it. */
const EQUATION_MAX = 120;
/** A caption stops being a caption somewhere; past this it is the prose
 *  under the figure that never opened a gap. With a page's columns kept apart
 *  a caption runs to its end, and a plate's runs to 1,754 characters. */
const CAPTION_MAX = 2000;
/** The indent test reads a section's left edge as this quantile of its line
 *  starts. */
const LEFT_EDGE_QUANTILE = 0.1;
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

/**
 * Whether a line is a display equation, printed on a line of its own.
 *
 * P8-03 (BACKLOG-32, §1h.41 c): only when it is numbered — it ends in "(3)" or "(3a)" and carries
 * at least one symbol anywhere (a numbered equation can carry words: "where η = 0.5 (2)"). The
 * owner chose this cheap rule knowing it loses an unnumbered equation: a PDF has no TeX, and the
 * rule that also took an unnumbered line of symbols (three of them, under three real words, under
 * half its characters in words) lifted sentence fragments out of the owner's paper — nineteen of
 * them, notation torn from the prose around it, a row of ranges — and none was an equation.
 * An unnumbered line, symbols and all, is a line of prose and joins its paragraph as any line does;
 * and a sentence that happens to end in "(2020)" has no symbol and no such number. Where a numbered
 * equation is printed over several lines the number stands on the last one, and that line alone is
 * the equation.
 *
 * P9-09 (cluster F): the one exception to "a line of symbols is prose" is a stack — two or more short
 * rows a fraction or a sum sets tighter than the page's leading, which `foldStacks` lifts as one whole
 * unnumbered block (or rejoins to the sentence around it) before the paragraphs are read. A single line
 * of symbols, and rows at the ordinary leading, stay prose exactly as above.
 */
export function equationOf(line: PdfLine): OutlineEquation | null {
  const text = line.text.trim();
  if (!text || text.length > EQUATION_MAX) return null;
  const numbered = /\((\d{1,3}[a-z]?)\)\s*$/.exec(text);
  if (!numbered || !MATH_SYMBOL.test(text)) return null;
  return { text: text.slice(0, numbered.index).trim(), number: `(${numbered[1]})` };
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
/** A script raised by more than this many points above its row's baseline is
 *  a superscript. */
const SUPERSCRIPT_RISE = 1;
/** A citation number: whole numbers joined by commas, dashes or spaces
 *  ("12", "3−5", "5,6", "89 91" — the space is where an en dash did not
 *  survive), and no longer than this. A run that carries a sign of its own is
 *  not one: a charge ("4−", "2+") or a negative exponent ("−13"), which no
 *  citation is. */
const CITATION_MARK = /^\d+(?:[\s,\u2013\u2212-]+\d+)*$/;
const CITATION_MARK_MAX = 12;
/** What a citation number stands after: the end of a clause, a bracket or a
 *  quote ("materials.12", "films,3−5", "“fatigue”16"), a suspended hyphen
 *  ("inter-5,6 and intragranular"), a word of three letters or more
 *  ("degradation17"), a capitalised pair, which is an element ("Fe30"), or a
 *  formula that already ends in digits ("ZnTiO335"). After a digit, a
 *  one-letter variable or one or two lower-case letters ("10−3", "R2", "cm2",
 *  "s−1") a raised digit is an exponent, and it is kept. */
const CITED = /(?:[.,;:!?)\]\u201D\u2019"']|\p{L}-|\p{L}{3,}|\p{Lu}\p{Ll}|[\p{L})]\d+)$/u;
/** A bracketed group with a slash in it and no space: "(i/imax)", and one that holds a bracketed
 *  label of its own, "(j/j(limiting))" (P9-13b). One raised digit after it is an exponent
 *  ("(i/imax)2"), not a citation of the group. */
const RATIO_GROUP = /\([^()\s]*\/[^()\s]*(?:\([^()\s]*\)[^()\s]*)?\)$/;
/** A run made only of combining marks: the overbar of a Miller index (U+0305), an accent, a
 *  vector arrow. The PDF draws it as a run of its own, with no width, and stores a space run
 *  behind it in the mark's own face. */
const COMBINING_RUN = /^[\u0300-\u036F\u20D0-\u20FF]+$/;
const COMBINING_TAIL = /[\u0300-\u036F\u20D0-\u20FF]+$/;
/** A mark that stands on a digit, a bracket or a sign is the middle of an index ("R3̅m",
 *  "(12̅10)"): the run behind it follows with no space when it starts within this many ems of the
 *  mark's edge, whatever else the gap would say. A mark on a letter ("x̄", an accent) ends a word
 *  as often as it ends an index, so the gap there is read as it always was. */
const MARK_REACH_EM = 0.5;
/** A script set more than this many points under its row's baseline is a subscript. */
const SUBSCRIPT_FALL = 1;
/** A label set under or over a one-letter variable that is a symbol is written joined to it:
 *  letters and digits, up to three of them ("RCT", "TH", "Eg", "Dw", "I0", "jmax"). Any other
 *  label, a word or a range ("area", "limiting", "0-4 μm"), is written in brackets: "f(area)". */
const SYMBOL_LABEL = /^[\p{L}\d]{1,3}$/u;
/** ...bar the short words that read as a word once joined to a letter ("ton", "toff", "tin"): the
 *  two ends of a switch or a flow, "t(on)" and "t(off)". */
const WORD_LABEL = /^(?:on|off|in|out)$/;
/** A raised label that is a number and a unit ("0−4 μm", "8-15 μm"): the grain-size fractions of
 *  "f 0-4 μm = 0.19". It is bracketed after its variable too. */
const RANGE_LABEL = /^\d[\d.,\u2212\u2013-]*\s+\p{L}+$/u;
/** A label touches its variable when it starts within this many ems of the variable's edge
 *  (2pt at 10pt; the page's own gaps run to 1.5): a stored space run between them, a fraction of a
 *  point wide, does not part them, and a space a word apart (0.25em and more) does. */
const LABEL_TOUCH_EM = 0.2;
/** What a raised run made only of these is written in: an exponent or a charge
 *  as Unicode superscripts ("cm²", "10⁻¹³", "Ni²⁺"). The signs a PDF uses — the
 *  minus sign, the hyphen, the en dash — are one superscript minus. */
const SUPERSCRIPT: Readonly<Record<string, string>> = {
  "0": "\u2070", "1": "\u00B9", "2": "\u00B2", "3": "\u00B3", "4": "\u2074",
  "5": "\u2075", "6": "\u2076", "7": "\u2077", "8": "\u2078", "9": "\u2079",
  "+": "\u207A", "\u2212": "\u207B", "-": "\u207B", "\u2013": "\u207B",
};

/** One baseline's worth of runs. */
interface Row {
  y: number;
  items: PdfTextItem[];
  /** The scripts folded into the row from above its baseline: superscripts. */
  raised?: Set<PdfTextItem>;
  /** The scripts folded into the row from under its baseline: subscripts. */
  lowered?: Set<PdfTextItem>;
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
 *
 * The space a journal PDF stores after a script is a run of its own, set at
 * the script's height and on its baseline: it is a script too (P9-08). Placed
 * as text it opened a row at the script's baseline, 4pt above the line the
 * script belongs to, and the script folded into that row at no distance
 * instead — a line of its own, read as an indent or thrown away as a folio.
 * Only rows of full-size runs own a script; a script with none near it is
 * small print (a footer, a note) and keeps the reading it always had.
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
    if (text > 0 && item.height < text * SCRIPT_RATIO) scripts.push(item);
    else place(item);
  }
  /** The nearest of these rows the script sits within the window of. */
  const ownerOf = (script: PdfTextItem, among: Row[]): Row | undefined => {
    let nearest: Row | undefined;
    for (const row of among) {
      const rise = script.y - row.y;
      if (rise < -SCRIPT_DROP || rise > SCRIPT_RISE) continue;
      if (!nearest || Math.abs(rise) < Math.abs(script.y - nearest.y)) nearest = row;
    }
    return nearest;
  };
  const fold = (script: PdfTextItem, row: Row) => {
    row.items.push(script);
    if (script.y - row.y > SUPERSCRIPT_RISE) (row.raised ??= new Set()).add(script);
    else if (row.y - script.y > SUBSCRIPT_FALL) (row.lowered ??= new Set()).add(script);
  };
  const base = rows.slice();
  const small: PdfTextItem[] = [];
  for (const script of scripts) {
    const row = ownerOf(script, base);
    if (row) fold(script, row);
    else small.push(script);
  }
  // Small print: a space is placed as text was before, and the words that follow
  // may join the rows made so far, small print's own among them.
  for (const script of small) if (!script.str.trim()) place(script);
  for (const script of small) {
    if (!script.str.trim()) continue;
    const row = ownerOf(script, rows);
    if (row) fold(script, row);
    else place(script);
  }
  // Down the page: PDF y grows upward.
  return rows.sort((a, b) => b.y - a.y);
}

/** The longest run of text among these: the one whose face the line is set in. */
const longestRun = (runs: PdfTextItem[]): PdfTextItem =>
  runs.reduce((best, i) => (i.str.trim().length > best.str.trim().length ? i : best), runs[0]);

/**
 * Runs read left to right as one line. A citation number raised above the line
 * (`raised`) is left out when it stands after a word or the end of a clause —
 * "…and other materials.12", "…grown on gold,3−5" — and kept where it is an
 * exponent: it carries nothing a reader of the digest needs, and glued to the
 * word before it, it reads as a digit in it. Raised runs that follow each
 * other are one mark, however the PDF split it ("21", "−", "23"). A kept mark
 * made only of digits and signs is written in Unicode superscripts ("cm²",
 * "10⁻¹³", "Ni²⁺"), so it does not read as a digit in the word (P9-08).
 *
 * A run of combining marks only (the overbar of a Miller index) sits on the glyph before it and
 * takes no space on either side: "R3̅m", "(12̅10)". The PDF stores a space run behind it, a few
 * hundredths of a point wide, and the next digit starts a fraction of a point on; neither is a
 * word break (P9-13b).
 *
 * A subscript (`lowered`) or a raised number-and-unit label ("0−4 μm") that touches a one-letter
 * variable run is that variable's label. A symbol, up to three letters or digits ("RCT", "Eg",
 * "I0", "jmax"), stays joined to it; a word or a range is written in brackets, "f(area)",
 * "f(0-4 μm)", "t(on)", so that the space the PDF puts or does not put between the two (a stored
 * run 0.15pt wide, or none) no longer shows. Inside a subscript, no space stands before a
 * parenthesis: "I0 (hkl)" is "I0(hkl)". A parenthetical set at the line's size after a subscript,
 * and any after an exponent, keeps its space: "Eg (eV)", "cm⁻² (at C/10)" (P9-13b).
 */
function lineOf(
  page: number,
  y: number,
  runs: PdfTextItem[],
  raised?: ReadonlySet<PdfTextItem>,
  lowered?: ReadonlySet<PdfTextItem>,
): PdfLine | null {
  // A PDF stores runs, not words: two runs set apart on the page are two
  // words even where neither carries a space ("Ashish Vaswani" and "Noam
  // Shazeer" arrived as one string until this gap was measured).
  let text = "";
  let cursor = Number.NaN;
  let judged = -1;
  // The raised runs up to this one are a mark of digits and signs, written as superscripts.
  let superscripts = -1;
  // The face of the combining mark just written: the space run the PDF stores behind it in that face is its own.
  let markFont: string | null = null;
  // The mark stands on a digit, a bracket or a sign: the run behind it starts within reach, or is a word apart.
  let tied = false;
  // The last run written that has text in it: the variable a label may stand under.
  let last: PdfTextItem | null = null;
  // The lowered runs up to this one have been judged as a label.
  let lowJudged = -1;
  // A label to be written in brackets: where its bracket opens in `text`, its first and its last run.
  let labelAt = -1;
  let labelFrom = -1;
  let labelTo = -1;
  /** Opens a bracket for the script runs `from..to` when they are a label that touches a one-letter variable. */
  const openLabel = (from: number, to: number) => {
    const first = runs.slice(from, to + 1).find((run) => run.str.trim());
    if (labelAt >= 0 || !last || !first || !/^\p{L}$/u.test(last.str.trim())) return;
    if (raised?.has(last) || lowered?.has(last) || first.x - cursor >= LABEL_TOUCH_EM * last.height) return;
    text = text.trimEnd();
    labelAt = text.length;
    labelFrom = from;
    labelTo = to;
  };
  for (let i = 0; i < runs.length; i++) {
    const item = runs[i];
    if (raised?.has(item) && i > judged) {
      let end = i + 1;
      while (end < runs.length && raised.has(runs[end])) end++;
      const mark = runs.slice(i, end).map((run) => run.str).join("").trim();
      const shape = mark.length <= CITATION_MARK_MAX && CITATION_MARK.test(mark);
      const before = text.trimEnd();
      if (shape && CITED.test(before) && !(mark.length === 1 && RATIO_GROUP.test(before))) {
        const last = runs[end - 1];
        // The space a raised run carried is the one the next word needs.
        if (text && /\s$/.test(last.str) && !/\s$/.test(text)) text += " ";
        cursor = last.x + (last.width || 0);
        i = end - 1;
        continue;
      }
      judged = end - 1;
      // A whole raised mark of digits and signs, with a word before it to stand on: an exponent
      // or a charge, not a footnote number at the head of a line. Letters, a point or a slash
      // in it ("st", "2a", "1/2", "0−4 μm") leave it as the PDF has it.
      superscripts = text.trim() && mark && [...mark].every((c) => c in SUPERSCRIPT) ? judged : -1;
      // A number and a unit raised behind a one-letter variable ("f" + "0−4 μm") is that variable's label.
      if (superscripts !== judged && RANGE_LABEL.test(mark)) openLabel(i, judged);
    }
    if (lowered?.has(item) && i > lowJudged) {
      let end = i + 1;
      while (end < runs.length && lowered.has(runs[end])) end++;
      lowJudged = end - 1;
      const under = runs.slice(i, end).map((run) => run.str).join("").trim();
      // A word or a range under a one-letter variable, not a symbol and not a bracketed argument: "f" + "area".
      if (/\p{L}/u.test(under) && !under.includes("(") && (!SYMBOL_LABEL.test(under) || WORD_LABEL.test(under))) openLabel(i, lowJudged);
    }
    if (!item.str.trim()) {
      // The space the PDF stores behind a combining mark, in the mark's own face, is not a word break.
      if (item.fontName === markFont) {
        cursor = item.x + (item.width || 0);
        continue;
      }
      markFont = null;
    }
    const isMark = COMBINING_RUN.test(item.str);
    const gap = item.x - cursor;
    // The parenthesis of a subscript ("I" + "0 (hkl)") follows its symbol with no space.
    const argument = !!last && !!lowered?.has(item) && !!lowered.has(last) && item.str.trimStart().startsWith("(");
    const joined = isMark || (tied && gap < MARK_REACH_EM * item.height) || i === labelFrom || argument;
    if (!joined && text && Number.isFinite(cursor) && gap > Math.max(1, item.height * 0.18) && !/\s$/.test(text)) {
      text += " ";
    }
    if (argument) text = text.trimEnd();
    // A mark sits on the glyph before it: the last that is not a mark itself.
    const base = text.replace(COMBINING_TAIL, "").slice(-1);
    const written = i <= superscripts && raised?.has(item) ? [...item.str].map((c) => SUPERSCRIPT[c] ?? c).join("") : item.str;
    text += lowered?.has(item) ? written.replace(/\s+\(/g, "(") : written;
    cursor = item.x + (item.width || 0);
    if (item.str.trim()) last = item;
    if (i === labelTo && labelAt >= 0) {
      const inner = text.slice(labelAt);
      text = `${text.slice(0, labelAt)}(${inner.trim()})${inner.slice(inner.trimEnd().length)}`;
      labelAt = labelFrom = labelTo = -1;
    }
    if (item.str.trim()) {
      markFont = isMark && base.trim() ? item.fontName : null;
      tied = isMark && !!base.trim() && !/\p{L}/u.test(base);
    }
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
    const label = lineOf(page, row.y, [first], row.raised, row.lowered);
    const words = lineOf(page, row.y, rest, row.raised, row.lowered);
    if (label && words) return [{ ...label, text: label.text.replace(/[:.—–-]$/, "") }, words];
  }
  const line = lineOf(page, row.y, ordered, row.raised, row.lowered);
  return line ? [withStackFacts(line, row, ordered)] : [];
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

// ── Line ends: the document's own words decide a hyphen (P9-09, cluster C) ──────
//
// A line that ends in a hyphen is either a word the page broke ("archi-" / "tecture") or a compound
// that happens to break at its own hyphen ("deposition-" / "rate-limiting"), and the line alone does
// not say which. The document does: a paper that writes "cross-sectional" whole elsewhere has it with
// its hyphen at a line's end too, one that writes "degradation" whole has "degra-" / "dation". The old
// rule dropped every hyphen and glued the halves: right four times in five on the one real paper of
// the set, and "deposition-rate-limiting" became "depositionrate-limiting".

/** A real hyphen: U+002D, U+2010, U+2011, the soft hyphen. An en or em dash at a line's end is
 *  punctuation, not a broken word, and keeps the space after it. */
const HYPHEN_END = /[-\u2010\u2011\u00AD]$/;

/** Prefixes English writes closed ("nanowire", "nonequilibrium"). Used only for a document that never
 *  hyphenates the prefix itself: the one place the rule trusts an English prior over the page's words. */
const CLOSED_PREFIXES = new Set([
  "nano", "micro", "macro", "meso", "poly", "mono", "multi", "inter", "intra", "electro", "chemo",
  "hetero", "homo", "semi", "ultra", "sub", "super", "hyper", "pseudo", "photo", "thermo", "non",
]);

/** What a document writes whole, in lower case: its words, its hyphenated compounds, and the
 *  prefixes it hyphenates. A piece the page broke at a line's end is none of them. */
export interface Vocabulary {
  words: ReadonlySet<string>;
  compounds: ReadonlySet<string>;
  prefixes: ReadonlySet<string>;
}

const wordForm = (token: string) => token.toLowerCase().replace(/\u00AD/g, "").replace(/[\u2010\u2011]/g, "-");

export function vocabularyOf(lines: readonly PdfLine[]): Vocabulary {
  const words = new Set<string>();
  const compounds = new Set<string>();
  const prefixes = new Set<string>();
  const broken = (line: PdfLine | undefined) => !!line && !line.block && HYPHEN_END.test(line.text.trimEnd());
  lines.forEach((line, i) => {
    if (line.block) return;
    const tokens = line.text.split(/\s+/).filter(Boolean);
    if (broken(line)) tokens.pop(); // the left piece of a word the page broke...
    if (broken(lines[i - 1])) tokens.shift(); // ...and its right piece
    for (const raw of tokens) {
      const token = wordForm(raw.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, ""));
      // A hyphen left hanging inside a line ("nano- and microstructure") elides the second word; it
      // says nothing about whether the paper hyphenates "nano" before "wire", so it is no prefix.
      if (/^\p{L}+$/u.test(token)) {
        words.add(token);
      } else if (/^\p{L}+(?:-\p{L}+)+$/u.test(token)) {
        const parts = token.split("-");
        compounds.add(token);
        for (const part of parts) words.add(part);
        for (const part of parts.slice(0, -1)) prefixes.add(part);
      }
    }
  });
  return { words, compounds, prefixes };
}

/**
 * `current` ends in a hyphen and `next` is the line that follows it: the two joined, by the first of
 * these that applies. With no evidence in the document (a one-page upload has none) every word-based
 * step falls to "join", which is what the old rule did, so a short text cannot get worse.
 *
 *  1. a digit before and a digit after is a range: keep the hyphen ("10-20");
 *  2. the next line opens with a bracket, a symbol or a digit: keep it ("non-⟨003⟩||ND");
 *  3. "and" / "or" after it is a suspended hyphen, as printed: keep it, and the space ("intra- and");
 *  4. no letter before it: after a digit keep ("3-dimensional", "CO2-free"), after a bracket join ("(de)-");
 *  5. the right token holds a digit, steps from lower to upper case twice (a formula), or opens with a
 *     capital (a Title-Case compound): keep it ("Li-NixCoyMnzO2", "Lithium-Ion");
 *  6. the joined form occurs whole in the document: join; the hyphenated form does: keep;
 *  7. either half is not a word of the document: join (a fragment of a word);
 *  8. a closed prefix the document never hyphenates: join ("nano-" + "wire");
 *  9. else both halves are words of the paper and the joined form never occurs: keep, no space.
 */
function mend(current: string, next: string, vocab: Vocabulary): string {
  const left = current.slice(0, -1);
  const joined = `${left}${next}`;
  const kept = `${left}-${next}`;
  if (/\p{N}$/u.test(left) && /^\p{N}/u.test(next)) return kept;
  if (!/^\p{L}/u.test(next)) return kept;
  const right = /^\S+/.exec(next)?.[0].replace(/[^\p{L}\p{N}]+$/u, "") ?? "";
  if (/^(?:and|or|nor)$/i.test(right)) return `${left}- ${next}`;
  const leftWord = /\p{L}+$/u.exec(left)?.[0];
  if (!leftWord) return /\p{N}$/u.test(left) ? kept : joined;
  if (/\p{N}/u.test(right) || (right.match(/\p{Ll}\p{Lu}/gu) ?? []).length >= 2 || /^\p{Lu}/u.test(right)) return kept;
  const l = wordForm(leftWord);
  const whole = wordForm(right);
  const leftToken = wordForm(/[\p{L}\u2010\u2011-]+$/u.exec(left)?.[0] ?? leftWord).replace(/^-+/, "");
  if (vocab.words.has(leftToken + whole) || vocab.compounds.has(leftToken + whole)) return joined;
  if (vocab.compounds.has(`${leftToken}-${whole}`)) return kept;
  const r = /^\p{L}+/u.exec(whole)?.[0] ?? "";
  if (!vocab.words.has(r) || !vocab.words.has(l)) return joined;
  return CLOSED_PREFIXES.has(l) && !vocab.prefixes.has(l) ? joined : kept;
}

/** A line the page cut inside a token, not between two words (P9-09, cluster H): a unit or a plane
 *  family at its slash or double bar ("mA/" + "cm2", "⟨110⟩||" + "ND"), a range or a compound at the
 *  paper's own minus sign, U+2212 ("20−" + "30", "LiOH−" + "KOH"). A slash or a minus that stands
 *  apart ("either A /" + "B", "a −" + "b") is a word of its own and keeps its space. */
const CUT_TOKEN_END = /(?:\S[/\u2212]|\|\|)$/;
/** A range cut at its dash: a digit, a hyphen or a dash, and a digit opening the next line ("20–" + "30"). */
const RANGE_DASH_END = /\p{N}[-\u2010\u2011\u2013\u2014]$/u;

/** Two lines of one paragraph, joined the way the page wrote them: a cut token with no space and its
 *  mark kept, a hyphen by the document's words, anything else with a space. */
function joinLines(current: string, next: string, vocab: Vocabulary): string {
  if (CUT_TOKEN_END.test(current) || (RANGE_DASH_END.test(current) && /^\p{N}/u.test(next))) return `${current}${next}`;
  if (HYPHEN_END.test(current)) return mend(current, next, vocab);
  return `${current} ${next}`;
}

/** The parts of one caption (its first line, then the lines under it), folded the same way. */
function foldLines(parts: readonly string[], vocab: Vocabulary): string {
  let folded = "";
  for (const part of parts) if (part) folded = folded ? joinLines(folded, part, vocab) : part;
  return folded;
}

// ── Stacked rows: an equation the page set over several tight lines (P9-09, cluster F) ──────────
//
// A fraction is set over three rows, centred, so every row is "indented" for the paragraph rule and opens a
// paragraph of its own: on the one real paper, eleven scraps, none a sentence. The rows of such a stack are
// short fragments set tighter than the page's leading (a fraction's bar needs no more room than its rows).
// Two or more of them in a run are lifted as one unnumbered block when the stack stands between sentences,
// and rejoin the sentence they interrupt when it goes on below them. This is the one exception to the cheap
// rule of §1h.41 (c): a single line of symbols stays prose, and so does one line of prose, however short.
//
// P9-13a: P9-08's fold takes a numerator set within 7.5pt above a text row INTO that row, as its first, raised run,
// and leaves the denominator, lowered more than a subscript is, a fragment row of its own. That is a fraction set
// around a text row all the same, and it is written `numerator / denominator` in the sentence, like the three rows
// of the sandwich. The lone fragment row of the same family (the numerator is somewhere else, or nowhere) joins the
// sentence it stands in, too, and never opens a paragraph.

/** A line `foldStacks` made out of rows the page set tighter than its leading: it carries on the sentence
 *  before it, wherever those rows stood. */
export interface FlowLine extends PdfLine {
  continues?: true;
}

/** A row of a stack is at most this many characters: a fragment of notation, not a line of prose. */
const STACK_ROW_MAX = 40;
/** Rows of a stack are at most this share of the leading apart. */
const STACK_TIGHT = 0.8;
/** The leading is read from gaps of at least this share of the body size: tighter rows do not pull it down. */
const LEADING_MIN_GAP = 0.6;
/** What a text row set between a numerator and a denominator opens with ("× 100, and the share of…"): the
 *  operator is what tells a fraction in a sentence from a label set above and below a prose row. */
const STACK_OPERATOR = /^[×=+÷−·∑Σ/]/;
/** A raised run of only digits, separators and signs is an exponent, a charge, a footnote or a citation number
 *  ("2", "2+", "−1", "3−5", "12"), not a numerator: a numerator carries a variable or a bracket. */
const MARK_ONLY = /^[\d\s,+\u2013\u2212-]+$/;

/** The paper's leading: the median gap between consecutive same-page lines that are at least 0.6 of the
 *  body size apart. 0 when there is nothing to measure. */
export function leadingOf(lines: readonly PdfLine[], body: { size: number }): number {
  const gaps: number[] = [];
  for (let i = 1; i < lines.length; i++) {
    if (lines[i - 1].page !== lines[i].page) continue;
    const gap = lines[i - 1].y - lines[i].y;
    if (gap >= body.size * LEADING_MIN_GAP) gaps.push(gap);
  }
  if (gaps.length === 0) return 0;
  gaps.sort((a, b) => a - b);
  return gaps[Math.floor(gaps.length / 2)];
}

/** Short, no word of four letters, a letter or a digit in it: a fragment of notation, not a line of prose. */
const isFragment = (text: string) => text.length <= STACK_ROW_MAX && !/\p{L}{4,}/u.test(text) && /[\p{L}\p{N}]/u.test(text);
const isStackRow = (line: PdfLine) => !line.block && isFragment(line.text);

/**
 * What `foldStacks` needs of a row and the line's text no longer says (P9-13a): how far the row reaches, and
 * whether it opens with a raised run, which is the fold's `raised`, with the line's words after it. The head
 * is read as `lineOf` reads a line, so it is written as the line writes it; nothing is before it for it to be
 * a citation of or an exponent on, and it is kept as the PDF has it.
 */
function withStackFacts(line: PdfLine, row: Row, ordered: PdfTextItem[]): PdfLine {
  const reachOf = (runs: PdfTextItem[]) => round(Math.max(...runs.map((run) => run.x + (run.width || 0))) - ordered[0].x);
  let end = 0;
  while (end < ordered.length && row.raised?.has(ordered[end])) end++;
  const head = end > 0 && end < ordered.length ? lineOf(line.page, row.y, ordered.slice(0, end), row.raised) : null;
  const rest = head ? lineOf(line.page, row.y, ordered.slice(end), row.raised) : null;
  return {
    ...line,
    reach: reachOf(ordered),
    ...(head && rest ? { head: { text: head.text, rest: rest.text, reach: reachOf(ordered.slice(0, end)) } } : {}),
  };
}

/** The numerator a text row opens with, when it is one: a short raised fragment with a variable or a bracket in
 *  it, and an operator opening the words after it ("× 100, and the share of…"). */
function numeratorOf(line: PdfLine): NonNullable<PdfLine["head"]> | null {
  const head = line.head;
  if (line.block || !head || isFragment(line.text) || !isFragment(head.text) || MARK_ONLY.test(head.text)) return null;
  return STACK_OPERATOR.test(head.rest) ? head : null;
}

/** Whether the row below a text row stands under its numerator: their x-ranges meet. */
const meets = (text: PdfLine, head: { reach: number }, below: PdfLine) =>
  below.x <= text.x + head.reach && text.x <= below.x + (below.reach ?? 0);

/**
 * Two or more consecutive same-page rows, each a short fragment and each within 0.8 of the leading below
 * the one before, are a stack. Between sentences (the line before ends one, or the line after opens with a
 * capital) the rows become one block, `lift`ed through the caller's equation list: the rows stay rows, and
 * the reader lifts the block out of its paragraph. Inside a sentence (the line before is unfinished and the
 * line after opens in lower case) the rows are joined into it. A fragment row, a text row that opens with an
 * operator and a fragment row, all tight, are a fraction set inside a sentence: `numerator / denominator`
 * and the row's text, one line of that sentence. Anything else is left as the page set it.
 *
 * P9-13a: the same fraction after P9-08's fold took the numerator into the text row (a text row that opens
 * with a raised fragment, then an operator) has the denominator for the next row: a fragment row, tight below
 * it, whose x-range meets the numerator's. The two are written `numerator / denominator` ahead of the row's
 * words, one line of the sentence above, which is unfinished. And a lone fragment row, tight below an
 * unfinished row that opens with no such numerator, with a lower-case line after it, is a half of the same
 * family and joins the sentence where it stands.
 */
export function foldStacks(lines: readonly PdfLine[], leading: number, lift: (text: string) => string): FlowLine[] {
  if (leading <= 0) return [...lines];
  const tight = (a: PdfLine, b: PdfLine) => a.page === b.page && a.y > b.y && a.y - b.y <= STACK_TIGHT * leading;
  const unfinished = (line: PdfLine | undefined): line is PdfLine => !!line && !line.block && !SENTENCE_END.test(line.text.trim());
  const out: FlowLine[] = [];
  for (let i = 0; i < lines.length; ) {
    const before = out[out.length - 1];
    let j = i;
    if (isStackRow(lines[i])) while (j + 1 < lines.length && isStackRow(lines[j + 1]) && tight(lines[j], lines[j + 1])) j++;
    if (j > i) {
      const rows = lines.slice(i, j + 1);
      const after = lines[j + 1]?.text.trim() ?? "";
      const last = rows[rows.length - 1];
      if (!unfinished(before) || /^\p{Lu}/u.test(after)) {
        out.push({ ...rows[0], text: lift(rows.map((row) => row.text).join("\n")), y: last.y, block: true });
      } else if (/^\p{Ll}/u.test(after)) {
        out.push({ ...rows[0], text: rows.map((row) => row.text).join(" "), x: before.x, y: last.y, continues: true });
      } else {
        out.push(...rows);
      }
      i = j + 1;
      continue;
    }
    const [numerator, row, denominator] = [lines[i], lines[i + 1], lines[i + 2]];
    if (
      unfinished(before) && isStackRow(numerator) && row && !row.block && !isStackRow(row) && STACK_OPERATOR.test(row.text) &&
      denominator && isStackRow(denominator) && tight(numerator, row) && tight(row, denominator)
    ) {
      out.push({ ...row, text: `${numerator.text} / ${denominator.text} ${row.text}`, x: before.x, y: denominator.y, continues: true });
      i += 3;
      continue;
    }
    // P9-13a: the numerator is the text row's first run (the fold took it in), the denominator the row after it.
    const raised = numeratorOf(lines[i]);
    if (unfinished(before) && raised && row && isStackRow(row) && tight(lines[i], row) && meets(lines[i], raised, row)) {
      out.push({ ...lines[i], text: `${raised.text} / ${row.text} ${raised.rest}`, x: before.x, y: row.y, continues: true });
      i += 2;
      continue;
    }
    // P9-13a: a fragment row on its own, tight under the unfinished row it belongs to (no numerator above it).
    if (unfinished(before) && !before.head && isStackRow(lines[i]) && tight(before, lines[i]) && row && !row.block && /^\p{Ll}/u.test(row.text.trim())) {
      out.push({ ...lines[i], x: before.x, continues: true });
      i++;
      continue;
    }
    out.push(lines[i]);
    i++;
  }
  return out;
}

/** A sentence ends at one of these, and a closing quote or bracket after it still ends it. */
const SENTENCE_END = /[.!?:;]["')\]”’]*$/;
/** A gap this many line pitches high is a float's, not a paragraph's (a real paragraph gap is 1.5-2). */
const FLOAT_GAP_PITCHES = 3;

export interface JoinOptions {
  /** The document's own words; found from `lines` when the caller has no more than these. */
  vocab?: Vocabulary;
}

/** Lines of prose, joined the way the page breaks them: a hyphen at a line's
 *  end is a broken word or a compound's own (the document's words say which), a
 *  change of rhythm or an indent starts a paragraph. */
export function joinProse(lines: readonly FlowLine[], options: JoinOptions = {}): string {
  const vocab = options.vocab ?? vocabularyOf(lines);
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
  // The section's usual left edge: the 10th percentile of its line starts, not
  // the leftmost one, so a margin label or one hanging line does not make every
  // other line read as indented. Under ten lines that is the minimum: too few
  // to tell an outlier from an edge.
  const starts = lines.map((l) => l.x).sort((a, b) => a - b);
  const left = starts.length > 0 ? starts[Math.floor(LEFT_EDGE_QUANTILE * (starts.length - 1))] : 0;

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
    const bigGap = pitch > 0 && samePage && gap > pitch * 1.6;
    // P9-09 (cluster E): a gap of more than three pitches is a float the page left in the column (a
    // figure, a table, a box), not a paragraph, while the sentence above it is unfinished and the
    // line below goes on in lower case, a digit or a bracket. A capital after it still breaks.
    const floatGap =
      bigGap && gap > pitch * FLOAT_GAP_PITCHES && current.trim() !== "" && !SENTENCE_END.test(current.trim()) && /^[\p{Ll}\p{N}([]/u.test(line.text);
    const breaks =
      previous !== null &&
      !line.continues &&
      ((bigGap && !floatGap) || (samePage && line.x > left + 6) || previous?.block === true);
    if (breaks && current.trim()) {
      paragraphs.push(current.trim());
      current = "";
    }
    current = current ? joinLines(current, line.text, vocab) : line.text;
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
  // P9-09: the paper's own words, read once from every line, decide each hyphen a line ends in.
  const vocab = vocabularyOf(lines);

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

  // P7-18 (F3): every heading takes its place in the numbering, a heading with nothing under it
  // too ("2. RESULTS AND DISCUSSION" holds only its subsections and is no section), so "2.1 …"
  // takes `results` from a parent that is not in the output.
  const inherit = bucketInheritor();
  // P9-09 (cluster F): the paper's leading, against which rows set tighter are a stack (an equation's rows).
  const leading = leadingOf(read, body);
  const flush = () => {
    if (heading !== null) canonical = inherit(heading, canonical);
    const lifted = foldStacks(held, leading, (rows) => {
      equations.push({ text: rows });
      return blockMarker(equations.length - 1);
    });
    const text = joinProse(lifted, { vocab });
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
  // The Received / Revised / Accepted / Published box: two or more consecutive
  // lines that each open with one of those words and a date are the journal's
  // furniture, wherever they stand (on the owner's paper, inside the
  // Introduction). One such line is a sentence or a note, and stays.
  const dated = read.map((line) => PUBLICATION_DATE.test(line.text.trim()));
  const inDateBox = (i: number) => dated[i] && (dated[i - 1] === true || dated[i + 1] === true);
  // P7-18 (F2): where the body's last numbered section stands. A heading that is end matter only
  // after the body ("Funding": some templates print it on page 1, under the abstract) ends the
  // argument only past this line; a paper with no numbered section has no such line, and there
  // those headings stay sections, as they were.
  let lastNumbered = -1;
  for (let i = read.length - 1; i >= 0 && lastNumbered < 0; i--) {
    const line = read[i];
    if (isFurniture(line, furniture) || isMarginPrint(line) || inDateBox(i)) continue;
    const head = headingOf(line, body);
    // A numbered end-matter heading ("6. Funding", "7. Acknowledgements") is not the body's.
    if (head && sectionNumberOf(head) && !endsTheArgument(head, canonicalizeHeading(head), true)) lastNumbered = i;
  }
  let lastHeading: PdfLine | null = null;

  for (let i = 0; i < read.length; i++) {
    const line = read[i];
    if (isFurniture(line, furniture) || isMarginPrint(line) || inDateBox(i)) continue;
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
      const full = foldLines([caption.caption ?? "", ...rest], vocab).replace(/\s+/g, " ").trim().slice(0, CAPTION_MAX);
      if (full.length > 0) figureCaptions.push({ ...caption, caption: full });
      continue;
    }
    const next = headingOf(line, body);
    if (next) {
      if (heading !== null && wrapsHeading(lastHeading, line, next)) {
        heading = joinLines(heading, next, vocab);
      } else {
        flush();
        heading = next;
        page = line.page;
      }
      lastHeading = line;
      canonical = canonicalizeHeading(heading);
      // The argument ends at the references, the acknowledgements or an
      // appendix, or at the end matter a journal prints after it (associated
      // content, author information, data availability, funding past the
      // body ...); what follows is apparatus.
      if (endsTheArgument(heading, canonical, lastNumbered >= 0 && i > lastNumbered)) done = true;
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

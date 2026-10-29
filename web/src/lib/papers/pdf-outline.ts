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

import { bucketInheritor, canonicalizeHeading, dropStrayHeadings, headingNumber, STRONG_BUCKETS } from "./html-text";

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
  /** P12-64: the titles the PDF itself carries (its Info dictionary's, its XMP's), as `readPages` found them. Only
   *  on a paper's first page. A witness for `titleOf` to choose among the first page's lines by; never the title. */
  embeddedTitles?: string[];
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
  /** P12-64: the size most of the line's characters are set in (`characterSize`). `size` is the tallest run's, which
   *  one oversized letter (a drop cap) lifts for the whole line it stands on; this is not. Read by `titleOf` and by
   *  the first page's title skip only; a line built by hand without it is read at `size`. */
  titleSize?: number;
  font: string;
  /** How far the line's runs reach to the right of `x`. `foldStacks` compares the x-ranges of a
   *  fraction's rows by it (P9-13a). */
  reach?: number;
  /** The raised run or runs the line opens with, as P9-08's fold took them in from above the baseline,
   *  and the words after them: a fraction's numerator, ahead of the row it was set over (P9-13a). */
  head?: { text: string; rest: string; reach: number };
  /** The runs of a row that is a fragment of notation, left to right, and the ones of them the fold raised or lowered:
   *  what the display-equation writer reads a row's cells from (P9-15). Only such a row carries them. */
  runs?: readonly PdfTextItem[];
  raised?: ReadonlySet<PdfTextItem>;
  lowered?: ReadonlySet<PdfTextItem>;
  /** P12-70: set on a row that holds a drop cap: its largest runs hold one or two characters (`letters`) and every other
   *  run is set at less than 1 / `DROP_CAP_RATIO` of them. `rest` is the size of the largest of the other runs (the
   *  words beside the cap) and `textX` where they start; `joined` that `lineOf` wrote the letters and the word after them
   *  as one (the cap opens its row and the word continues it). A cap that spans several lines stands on the last of them, so
   *  its row is not the paragraph's first line (`placeDropCaps`). A row set larger as a whole (a title, a heading)
   *  carries none. */
  cap?: { rest: number; letters?: string; textX?: number; joined?: true };
}

export interface OutlineSection {
  heading?: string;
  canonical?: string;
  page?: number;
  text?: string;
  /** P12-75: 1 for the heading of a part that holds only sub-headings and has no number ("Methods", then at once its first
   *  sub-heading: a row with no words); 2 for a sub-heading set smaller than it, which took its bucket. Absent otherwise. */
  level?: 1 | 2;
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
/** C P12-74 (R1, R4): a numbered line is a heading, or ends a caption, only at this share of the body's size or more. */
const NUMBERED_SIZE_RATIO = 0.95;
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

// ── What follows an end-matter heading (P12-51, O5) ─────────────────────────────────────────────────────
//
// The first end-matter heading closes the argument, and the outline no longer stops there. A journal prints
// Methods after its references, a second block of notes after that, and a paper that opens its end matter
// with a supporting-information line prints its acknowledgements and statements after the line. P12-62: the
// first end-matter heading is read as the later ones are (P7-18 had left it and its text out): a note opens
// its section and its text is read; the references, and an appendix, stay out. What follows is read by what
// each heading names:
//   a note      another end-matter part (acknowledgements, a statement, author contributions...): its own
//               section, in the apparatus bucket, and its text is read;
//   an argument a heading that names a part of the argument (methods above all): its own section, and its
//               sub-headings are read as the body's are;
//   out         the references: their text stays out, as it always did;
//   an appendix the bulky apparatus (an appendix, the supplementary material, a lettered "B Additional
//               results"): its text stays out as it did, and nothing after it is taken for a part of the
//               argument, whatever words its headings hold;
//   (nothing)   any other heading, which reads whatever its surroundings read (the sub-headings of an
//               argument part), and in the notes' company reads nothing (the authors' affiliation blocks, a
//               reference entry the page set as a heading).

/** The buckets that name a part of the argument. */
const ARGUMENT_PARTS = new Set(["introduction", "related_work", "methods", "results", "discussion", "conclusion", "limitations"]);
/** The apparatus too long to be a note: it stays out after the argument, as it did. */
const BULKY_END_MATTER = /^(?:appendix|appendices|supplementary\s+(?:materials?|information))\b/i;
/** A heading numbered by a letter or a numeral ("B Additional results", "C.1 Setup", "IV. Proofs"), once the
 *  argument is over, is a section of an appendix. */
const APPENDIX_NUMBER = /^(?:[A-Z]|[IVX]+)(?:\.\d+)*\.?\s+\S/;
/** A heading named only by its bucket's words is a short line: a reference entry the page set as a
 *  heading is longer than this, carries a comma after its authors or the year of its journal. */
const PLAIN_HEADING_WORDS = 8;
const PRINT_YEAR = /\b(?:1[5-9]|20)\d\d\b/;

type TailPart = "note" | "argument" | "out" | "appendix" | null;

/** What a heading met once the argument is over stands for (see above); `ends` is `endsTheArgument` of it. */
function tailPartOf(heading: string, canonical: string, ends: boolean): TailPart {
  if (canonical === "references") return "out";
  const bare = heading.trim().replace(GLYPH_LEAD, "");
  const own = bare.replace(SECTION_LEAD, "");
  if (ends) return BULKY_END_MATTER.test(own) ? "appendix" : "note";
  if (APPENDIX_NUMBER.test(bare)) return "appendix";
  if (own.split(/\s+/).length > PLAIN_HEADING_WORDS || own.includes(",") || PRINT_YEAR.test(own)) return null;
  if (canonical === "acknowledgments") return "note";
  return ARGUMENT_PARTS.has(canonical) ? "argument" : null;
}

// Roman numerals only in caps: lower case ate the "c" of "Figure captions
// are elsewhere" and called it Figure C.
const CAPTION = /^(fig(?:ure)?|table|scheme|chart)\s*\.?\s*(\d{1,3}|[IVXL]{1,5})\b\s*[.:—–-]?\s*(.*)$/i;

/** `word` as a pattern for either case of each letter. The caption pattern below cannot take the `i`
 *  flag: it asks for a capital letter, and under `i` a small letter is one too. */
const anyCase = (word: string): string => [...word].map((c) => `[${c.toLowerCase()}${c.toUpperCase()}]`).join("");

/** A panel mark in a bracket, "(a)", "(B)", "(a,b)", "(a-c)", "(ii)": one or two letters, or a short list of them. */
const PANEL_MARK = String.raw`\(\s*\p{L}{1,2}(?:\s*[,\u2013-]\s*\p{L}{1,2})*\s*\)`;

/**
 * P12-46 (R6a): `CAPTION`, and a separator after the label's number. A caption's number is followed by
 * a full stop, a colon, a bar or a dash (the dashes are the hyphen, the Unicode hyphens and dashes
 * U+2010–2015, and the minus sign U+2212), with or without a space before it; or by a space and a
 * capital letter ("Table 1 Scores of …"); or by nothing, the label standing alone on its line with its
 * words on the next. A body line that opens with a citation does not have one: "Fig. 8) is consistent
 * with …", "Fig. 3, left, …", "Fig. 2; the …", "Figure 3 shows …" (a small letter after the space).
 * The groups are an optional "Extended Data" prefix, then `CAPTION`'s: label, number, words; the words are cut
 * from the line as they always were, except that a bar is cut with the full stop and the colon (P12-56, R15a):
 * Nature sets "Fig. 1 | Title", and the bar is the separator, not the first word of the title.
 *
 * P12-56 (R14a): "Extended Data Fig. 3 | Title" is a caption of its own numbering. The prefix is read before
 * "Fig." and "Figure" only (`captionOf` refuses it before "Table"); "Supplementary Fig. 3" and "Fig. S3" are
 * not a label this pattern knows: they are figures of another file, and a PDF that does not print one lists none.
 * `CAPTION` itself stays as it was: `headingOf` uses it to keep a line that opens with a figure's label
 * out of the headings, caption or not.
 *
 * P12-56 (R6b): a space and a bracket after the number is a caption when the bracket is a panel mark and
 * a capital letter, a separator or the end of the line follows it: "Fig. 1 (a) Title", "Figure 2 (A)
 * Overview". "Fig. 5 (left) shows ...", "Fig. 1 (a) shows ..." and "Fig. 2 (see below) ..." are still
 * citations. A citation that is a panel mark and a capital ("Fig. 1 (a) Observed ...") after a line
 * that does not end a sentence is refused by `opensMidSentence`, not by this pattern.
 */
const CAPTION_SEPARATED = new RegExp(
  `^(?:(${anyCase("extended")}\\s+${anyCase("data")})\\s+)?` +
    `(${anyCase("fig")}(?:${anyCase("ure")})?|${anyCase("table")}|${anyCase("scheme")}|${anyCase("chart")})` +
    String.raw`\s*\.?\s*(\d{1,3}|[IVXLivxl]{1,5})\b` +
    String.raw`(?=\s*(?:$|[.:|\u2010-\u2015\u2212-])|\s+\p{Lu}|\s+${PANEL_MARK}\s*(?:$|\p{Lu}|[.:|\u2010-\u2015\u2212-]))` +
    String.raw`\s*[.:|—–-]?\s*(.*)$`,
  "u",
);
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

/** How far the gap under a caption's line may stand from the caption's own leading (or, where it has none to measure
 *  yet, from one line pitch), as a share of it, for the line below to be read as the caption's own next line (R7a). */
const TITLE_PITCH_TOLERANCE = 0.2;
/** A line is "smaller than the body" for a caption's face change past its first line when it is set this many points
 *  under the body's size or more: prose in the body's size is never smaller than itself (P12-82, R1-B). */
const TITLE_SMALLER_BY = 0.6;

/**
 * What `continuesCaption` is told of the caption it is extending (P12-82, R1-B): the face change, the leading and
 * the size are all read against what the caption has shown so far, not against the paper alone.
 */
export interface CaptionContext {
  /** The caption's lines so far, in order: the line that opens it first, `previous` last. */
  lines: readonly PdfLine[];
  /** The line after `next` on the page, if any: where the caption has one line so far, its leading is the gap under `next`. */
  after?: PdfLine;
}

/**
 * P12-46 (R7a), widened by P12-82 (R1-B): whether `next`, in another face than `previous`, is still the caption's next line.
 *
 * A caption changes face once, anywhere in it: a bold title, then text in the paper's face (the bold run is the longest
 * of the first line, so that line reads as bold and the regular line under it as another face). The change is let by
 * when the caption has not changed face yet, and
 *  - right after its first line (the line that opens with the label), at the caption's size (`continuesCaption` holds
 *    that); or
 *  - later (a title wrapped onto two lines, then the text face) only to a line set smaller than the body: prose
 *    resumes at the body's size, so a caption's second face must be smaller than that to be told from it.
 * Either way the gap must be the caption's OWN leading, within `TITLE_PITCH_TOLERANCE`. That is the gap between its
 * last two lines; with one line so far, the gap under `next` where the line after it goes on in `next`'s face and size
 * and within a line pitch and a half; and only with neither, the paper's pitch for the size (with no pitch to measure,
 * 0, the change is not let by). The page's pitch alone cut a caption set at 10.5 points of leading on a paper whose
 * 25th-percentile gap, figure text rows included, was 8.7. The prose that resumes under a figure sits further below or
 * at another leading, and stays out.
 * With no `context` the caption is taken not to have changed face yet and to have `previous` for its only line.
 */
function titleFaceChange(
  previous: PdfLine,
  next: PdfLine,
  gap: number,
  pitch: number,
  body: { size: number; font: string },
  context?: CaptionContext,
): boolean {
  const lines = context?.lines ?? [previous];
  if (lines.some((line, i) => i > 0 && line.font !== lines[i - 1].font)) return false;
  if (!captionOf(previous) && !(next.size <= body.size - TITLE_SMALLER_BY)) return false;
  const after = context?.after;
  const measured = after && after.page === next.page && after.font === next.font && Math.abs(after.size - next.size) <= 0.6 ? next.y - after.y : 0;
  let leading: number;
  if (lines.length >= 2) leading = lines[lines.length - 2].y - previous.y;
  else if (measured > 0 && (pitch <= 0 || measured <= pitch * 1.5)) leading = measured;
  else leading = pitch > 0 ? (body.size > 0 ? pitch * (next.size / body.size) : pitch) : 0;
  if (leading <= 0) return false;
  return Math.abs(gap - leading) <= leading * TITLE_PITCH_TOLERANCE;
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
 *
 * C P12-74 (R4): a numbered heading ends a caption only when it is set at 0.95 of the body or more (`NUMBERED_SIZE_RATIO`).
 *
 * P12-46 (R7a), P12-82 (R1-B): one change of face is let by, anywhere in the caption (`titleFaceChange`): a caption set
 * with a bold title over lines in the text face is one caption, whether the title is one line or wraps onto two.
 * A second change of face, or a first one that the size or the leading do not bear out, ends it as before.
 * `context` is what the caption has shown so far; the callers that read a caption line by line (`captionEnd`) pass it.
 */
export function continuesCaption(
  previous: PdfLine,
  next: PdfLine,
  pitch: number,
  body: { size: number; font: string },
  furniture: Set<string>,
  context?: CaptionContext,
): boolean {
  if (next.page !== previous.page) return false;
  const gap = previous.y - next.y;
  if (gap <= 0) return false;
  if (pitch > 0 && gap > pitch * 1.5) return false;
  if (next.font !== previous.font && !titleFaceChange(previous, next, gap, pitch, body, context)) return false;
  if (Math.abs(next.size - previous.size) > 0.6) return false;
  const text = next.text.trim();
  if (!text) return false;
  if (isFurniture(next, furniture)) return false;
  if (captionOf(next)) return false;
  // C P12-74 (R4): a numbered line ends a caption only at 0.95 of the body or more; a caption's own middle line that
  // opens with a number and a unit ("25 C and 45 C ...") is set as small as the rest of it and goes on.
  if (NUMBERED_HEADING.test(text) && text.length <= HEADING_MAX && next.size >= body.size * NUMBERED_SIZE_RATIO) return false;
  // The face test above is what distinguishes caption from prose; `body` only sizes the face change
  // `titleFaceChange` looks for.
  return true;
}

/**
 * P12-82 (R1-B): the index of the last line of the caption that opens at `read[start]`: the lines `continuesCaption`
 * takes in turn, each told what the caption has shown so far. The one place a caption's extent is read, so that the
 * reading (`buildOutline`), the figure text it leaves out (`figureTextOf`) and the chain `inCaption` follows agree.
 * `until` stops the walk at that index (the caller only asks whether the caption reaches it).
 */
function captionEnd(
  read: PdfLine[],
  start: number,
  pitch: number,
  body: { size: number; font: string },
  furniture: Set<string>,
  until: number = read.length - 1,
): number {
  const lines = [read[start]];
  let end = start;
  while (end < until && continuesCaption(read[end], read[end + 1], pitch, body, furniture, { lines, after: read[end + 2] })) {
    end++;
    lines.push(read[end]);
  }
  return end;
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
/** A gutter is at least this many ems wide... */
const GUTTER_EM = 2;
/** ...or this many when it lies in the middle of the text's width (P12-50): a journal that sets 9.3pt type 11pt
 *  apart has a gutter of 1.2 em, and no page of it showed a gutter of 2. */
const GUTTER_NARROW_EM = 1;
/** The middle of the text's width: a narrow gutter's centre lies between these shares of it. */
const GUTTER_MIDDLE: readonly [number, number] = [1 / 3, 2 / 3];
/** Two pages' gutters are one position when their right columns' left edges stand within this many points (P12-50)... */
const GUTTER_SAME_PT = 6;
/** ...or this share of an em, whichever is more. */
const GUTTER_SAME_EM = 0.5;
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
 *  quote ("materials.12", "films,3−5", "“fatigue”16"), a suspended hyphen of any kind (- ‐ ‑ −,
 *  P10-37) ("inter-5,6 and intragranular"), a word of three letters or more
 *  ("degradation17"), a capitalised pair, which is an element ("Fe30"), or a
 *  formula that already ends in digits ("ZnTiO335"). After a digit, a
 *  one-letter variable or one or two lower-case letters ("10−3", "R2", "cm2",
 *  "s−1") a raised digit is an exponent, and it is kept. */
const CITED = /(?:[.,;:!?)\]\u201D\u2019"']|\p{L}[-\u2010\u2011\u2212]|\p{L}{3,}|\p{Lu}\p{Ll}|[\p{L})][\d\u2080-\u2089]+)$/u;
/** A bracketed group with a slash in it and no space: "(i/imax)", and one that holds a bracketed
 *  label of its own, "(j/j(limiting))" (P9-13b). One raised digit after it is an exponent
 *  ("(i/imax)2"), not a citation of the group. */
const RATIO_GROUP = /\([^()\s]*\/[^()\s]*(?:\([^()\s]*\)[^()\s]*)?\)$/;
/** ...and a bracketed group with a maths symbol in it and no space (P10-37, BACKLOG-28): an operator between two
 *  operands, "(x+y)", "(E−Ef)", "(a×b)", or a symbol that is maths wherever it stands, "(ΔT)". An ASCII hyphen and an en
 *  dash are no operator here ("(Ni-rich)", "(1990–2000)" are names and ranges); the group's one raised digit is an
 *  exponent, as the ratio's is. */
const MATH_GROUP = /\((?:[^()\s]+[+\u2212\u00D7\u00B7=<>\u00B1][^()\s]+|[^()\s]*[\u0394\u2202\u2207\u2211\u222B\u221A][^()\s]*)\)$/;
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
/** What a lowered group made only of these is written in: the stoichiometry of a formula as
 *  Unicode subscripts ("LiCoO₂", "Li₁₋ₓCoO₂"). U+2080-U+208E, and the letter x (U+2093), the "1−x" of
 *  a solid solution. Only these have a subscript form: a group with any other character ("A1g",
 *  "RCT", "0.5") is not one (P9-14). */
const SUBSCRIPT: Readonly<Record<string, string>> = {
  "0": "\u2080", "1": "\u2081", "2": "\u2082", "3": "\u2083", "4": "\u2084",
  "5": "\u2085", "6": "\u2086", "7": "\u2087", "8": "\u2088", "9": "\u2089",
  "+": "\u208A", "\u2212": "\u208B", "-": "\u208B", "=": "\u208C", "(": "\u208D", ")": "\u208E",
  x: "\u2093",
};
/** The part of a lowered group that opens it: digits, signs and x, with a digit among them. A lone x
 *  ("Lix", "Nix") is left as P9-13b writes it: the digit of such a formula is often not a run of its own
 *  (pdf.js merges it into the full-size run before it), and "Liₓ" beside a plain "CoO2" reads worse than
 *  "Lix" beside it. */
const SUBSCRIPT_HEAD = /^(?=[+\u2212=x-]*[0-9])[0-9+\u2212=x-]+/;
/** A lowered group written whole: digits, signs, x and brackets. */
const SUBSCRIPT_WHOLE = /^[0-9+\u2212=x()-]+$/;

/**
 * How many characters, counted without the white space between them, of a lowered group are
 * written as subscripts: all of them when each has a subscript form and the brackets close
 * ("1−x", "2", "1(2)"); only its head when the rest is a bracketed argument the page lowers too
 * ("0 (hkl)" is I₀ and "(hkl)": hkl has no subscript form); none for any other group ("1g", "CT",
 * "0.5").
 */
function subscriptLength(group: string): number {
  const text = group.replace(/\s+/g, "");
  const head = SUBSCRIPT_HEAD.exec(text)?.[0];
  // A group that ends on a sign ("3+", "4−") is a charge set low, not a stoichiometry.
  if (!head || /[+\u2212=-]$/.test(head)) return 0;
  const rest = text.slice(head.length);
  if (!rest) return head.length;
  if (rest[0] !== "(" && rest[0] !== ")") return 0;
  let depth = 0;
  for (const c of text) {
    depth += c === "(" ? 1 : c === ")" ? -1 : 0;
    if (depth < 0) break;
  }
  return SUBSCRIPT_WHOLE.test(text) && depth === 0 ? text.length : head.length;
}

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
 * The runs of a raised mark that are the exponent or charge of the raised run before them, as indexes into
 * `runs[from..to)` (P9-37). A run set raised again, above the raised run before it by more than the rise a
 * script needs to be one, no larger than it, made only of characters that have a superscript form, and starting
 * within reach of its edge, is that run's own: the label "ab" with its charge "3+" above it. A sign and its digits
 * stored as two runs on that higher level ("−" "1") are one charge. Anything else in the mark, a run at the
 * label's own height, one with a letter or a point in it, one set apart, is not.
 */
function exponentsOf(runs: PdfTextItem[], from: number, to: number): number[] {
  const found: number[] = [];
  // The last run with text in it, and whether it was taken here as an exponent.
  let before: PdfTextItem | null = null;
  let taken = false;
  for (let j = from; j < to; j++) {
    const run = runs[j];
    const str = run.str.trim();
    if (!str) continue;
    const touches = !!before && run.x - (before.x + (before.width || 0)) < LABEL_TOUCH_EM * before.height;
    const digits = [...str].every((c) => c in SUPERSCRIPT);
    if (before && touches && digits && run.height <= before.height && run.y - before.y > SUPERSCRIPT_RISE) {
      found.push(j);
      taken = true;
    } else if (before && touches && digits && run.height <= before.height && taken && Math.abs(run.y - before.y) <= SUPERSCRIPT_RISE) {
      found.push(j);
    } else {
      taken = false;
    }
    before = run;
  }
  return found;
}

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
 *
 * A lowered group made only of digits, signs and x, with a digit among them, that touches a letter or
 * a closing bracket is the stoichiometry of a formula and is written with the Unicode subscripts:
 * "LiCoO₂", "Li₁₋ₓCoO₂", "I₀(hkl)" (its bracketed argument, which has no subscript form, stays plain).
 * A group with any other letter ("A1g", "RCT"), a point ("0.5"), a sign at its end (a charge set low),
 * or one that stands apart from its base is written as before. The charge stays P9-08's raised
 * superscript: "CoO₂⁻" (P9-14).
 *
 * A raised mark with a letter in it is written as the PDF has it ("st", "2a"), bar the exponent or charge
 * raised again above one of its runs (`exponentsOf`): "K" + raised "ab" + raised-again "3+" is "Kab³⁺" (P9-37).
 */
function lineOf(
  page: number,
  y: number,
  runs: PdfTextItem[],
  raised?: ReadonlySet<PdfTextItem>,
  lowered?: ReadonlySet<PdfTextItem>,
): PdfLine | null {
  // P12-70: a row a drop cap heads, if it is one.
  const capRow = capRowOf(runs);
  let capWasJoined = false;
  // A PDF stores runs, not words: two runs set apart on the page are two
  // words even where neither carries a space ("Ashish Vaswani" and "Noam
  // Shazeer" arrived as one string until this gap was measured).
  let text = "";
  let cursor = Number.NaN;
  let judged = -1;
  // The raised runs up to this one are a mark of digits and signs, written as superscripts.
  let superscripts = -1;
  // The runs of a raised mark with letters in it that are an exponent or a charge raised again above a run of it.
  const exponents = new Set<number>();
  // The face of the combining mark just written: the space run the PDF stores behind it in that face is its own.
  let markFont: string | null = null;
  // The mark stands on a digit, a bracket or a sign: the run behind it starts within reach, or is a word apart.
  let tied = false;
  // The last run written that has text in it: the variable a label may stand under.
  let last: PdfTextItem | null = null;
  // The lowered runs up to this one have been judged: as the stoichiometry of a formula or as a label.
  let lowJudged = -1;
  // A lowered group written as subscripts: its first and last run, and how many of its characters remain.
  let subFrom = -1;
  let subTo = -1;
  let subLeft = 0;
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
      if (shape && CITED.test(before) && !(mark.length === 1 && (RATIO_GROUP.test(before) || MATH_GROUP.test(before)))) {
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
      const whole = !!mark && [...mark].every((c) => c in SUPERSCRIPT);
      superscripts = text.trim() && whole ? judged : -1;
      // A mark with letters in it is written flat, bar the exponent or charge raised again above one of its
      // runs: "ab" + "3+" is "ab³⁺" (P9-37).
      if (text.trim() && mark && !whole) for (const j of exponentsOf(runs, i, end)) exponents.add(j);
      // A number and a unit raised behind a one-letter variable ("f" + "0−4 μm") is that variable's label.
      if (superscripts !== judged && RANGE_LABEL.test(mark)) openLabel(i, judged);
    }
    if (lowered?.has(item) && i > lowJudged) {
      let end = i + 1;
      while (end < runs.length && lowered.has(runs[end])) end++;
      lowJudged = end - 1;
      const under = runs.slice(i, end).map((run) => run.str).join("").trim();
      // The stoichiometry of a formula, digits and signs set under a letter or a bracket that it touches:
      // "LiCoO" + "2" is LiCoO₂, "Li" + "1−x" is Li₁₋ₓ, "I" + "0 (hkl)" is I₀(hkl). The space the PDF
      // stores between the two, a fraction of a point wide, is not one.
      const first = runs.slice(i, end).find((run) => run.str.trim());
      const length = subscriptLength(under);
      if (
        length > 0 && first && last && !raised?.has(last) && !lowered?.has(last) && /[\p{L})\]]$/u.test(last.str) &&
        first.x - (last.x + (last.width || 0)) < LABEL_TOUCH_EM * last.height
      ) {
        text = text.trimEnd();
        subFrom = i;
        subTo = lowJudged;
        subLeft = length;
      } else if (/\p{L}/u.test(under) && !under.includes("(") && (!SYMBOL_LABEL.test(under) || WORD_LABEL.test(under))) {
        // A word or a range under a one-letter variable, not a symbol and not a bracketed argument: "f" + "area".
        openLabel(i, lowJudged);
      }
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
    // A subscript follows its formula, and its own characters follow each other, with no space.
    const subscript = subLeft > 0 && i >= subFrom && i <= subTo;
    // P12-70: a drop cap is joined to the word it starts ("S" + "econdary"), though the page leaves the gap of its padding.
    const capJoined = capRow !== undefined && i === capRow.next && gap <= capRow.size * CAP_WORD_GAP_EM && CAP_CONTINUES.test(item.str);
    if (capJoined) capWasJoined = true;
    const joined = isMark || (tied && gap < MARK_REACH_EM * item.height) || i === labelFrom || argument || subscript || capJoined;
    if (!joined && text && Number.isFinite(cursor) && gap > Math.max(1, item.height * 0.18) && !/\s$/.test(text)) {
      text += " ";
    }
    if (argument) text = text.trimEnd();
    // A mark sits on the glyph before it: the last that is not a mark itself.
    const base = text.replace(COMBINING_TAIL, "").slice(-1);
    let written = (i <= superscripts || exponents.has(i)) && raised?.has(item) ? [...item.str].map((c) => SUPERSCRIPT[c] ?? c).join("") : item.str;
    if (subscript) {
      let sub = "";
      for (const c of item.str) {
        // The subscript's own characters are written, the white space between them dropped; what the group
        // holds after them (the argument "(hkl)", the space behind it) is written as it is.
        if (subLeft <= 0) sub += c;
        else if (!/\s/.test(c)) {
          sub += SUBSCRIPT[c] ?? c;
          subLeft--;
        }
      }
      written = sub;
    }
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
    titleSize: characterSize(runs),
    font: longestRun(runs).fontName,
    ...(capRow ? { cap: { rest: capRow.rest, letters: capRow.letters, textX: round(capRow.textX), ...(capWasJoined ? { joined: true as const } : {}) } } : {}),
  };
}

/** P12-64: sizes this close (points) are one size when the title is read: a title wraps onto lines set alike. */
const TITLE_SIZE_JOIN = 0.6;

/**
 * P12-64: the size most of a line's characters are set in. Each run weighs its characters (white space not
 * counted); sizes within `TITLE_SIZE_JOIN` of one another weigh together; the heaviest wins, the larger on a tie, and
 * is read as the mean of the sizes that weigh with it. A line set in one size reads that size, as `size` does; a 40 pt
 * drop cap on a line of 9 pt words reads 9, and a 24 pt title line with a raised 12 pt mark still reads 24.
 */
function characterSize(runs: readonly PdfTextItem[]): number {
  const weighed = runs
    .map((run) => ({ size: run.height, chars: [...run.str.replace(/\s+/g, "")].length }))
    .filter((run) => run.chars > 0);
  if (weighed.length === 0) return round(Math.max(...runs.map((run) => run.height)));
  let best = { anchor: -Infinity, weight: 0, mean: 0 };
  for (const { size } of weighed) {
    const near = weighed.filter((run) => Math.abs(run.size - size) <= TITLE_SIZE_JOIN);
    const weight = near.reduce((n, run) => n + run.chars, 0);
    if (weight > best.weight || (weight === best.weight && size > best.anchor)) {
      best = { anchor: size, weight, mean: near.reduce((n, run) => n + run.size * run.chars, 0) / weight };
    }
  }
  return round(best.mean);
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
 * two columns. Where no 2-em band is a gutter, a band of 1 em whose centre
 * lies in the middle third of the text's width is tried the same way (P12-50):
 * a journal can set its columns 1.2 em apart. A page of fewer than twice
 * `GUTTER_MIN_ROWS` baselines has too little text to show a gutter of its own;
 * it takes the paper's (`gutterPrior`). `text` is the page's usual text
 * height; scripts are not ink.
 */
export function gutterOf(items: PdfTextItem[], text: number): Gutter | null {
  const ink = items.filter((i) => i.str.trim() && i.width > 0 && i.height >= text * SCRIPT_RATIO);
  const rows = rowsOf(ink, 0);
  if (rows.length < GUTTER_MIN_ROWS * 2) return null;
  const lo = Math.min(...ink.map((i) => i.x));
  const hi = Math.max(...ink.map((i) => i.x + i.width));
  const span = hi - lo;

  const width = GUTTER_EM * text;
  const slid: number[] = [];
  for (let x0 = lo + span * GUTTER_SEARCH[0]; x0 + width <= lo + span * GUTTER_SEARCH[1]; x0 += 1) slid.push(x0);
  const narrow = GUTTER_NARROW_EM * text;
  return (
    gutterIn(rows, slid, width, span) ??
    gutterIn(rows, narrowStarts(ink, lo + span * GUTTER_MIDDLE[0] - narrow / 2, lo + span * GUTTER_MIDDLE[1] - narrow / 2), narrow, span)
  );
}

/**
 * Where a band of a narrow gutter's width is worth trying, from `from` to `to`: where the window opens and
 * wherever an item ends inside it. A clear band slid left stays clear until it meets the end of an item, so
 * these places are all the bands there are — a one-point slide can step over a gutter 1.05 em wide.
 */
function narrowStarts(ink: PdfTextItem[], from: number, to: number): number[] {
  const starts = new Set([from]);
  for (const i of ink) if (i.x + i.width > from && i.x + i.width <= to) starts.add(i.x + i.width);
  return [...starts].sort((x, y) => x - y);
}

/** The gutter of `rows` that a band of `width` starting at one of `starts` makes, or null: the rule `gutterOf` explains. */
function gutterIn(rows: Row[], starts: number[], width: number, span: number): Gutter | null {
  let best: { x0: number; run: Row[] } | null = null;
  for (const x0 of starts) {
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
 * its own (a page of figures, a page of few lines) is set in. The pages'
 * gutters are grouped by position — the right column's left edge, within about
 * 6pt or half an em (P12-50), for the same journal's gutter falls a few points
 * either side from page to page — and the group with the most pages is the
 * paper's. Null when fewer than two pages agree.
 */
export function gutterPrior(pages: PdfPageText[]): Gutter | null {
  const found: (Gutter & { reach: number })[] = [];
  for (const { items: all } of pages) {
    const items = all.filter((i) => i.str);
    const text = usualHeight(items);
    const gutter = gutterOf(items, text);
    if (gutter) found.push({ ...gutter, reach: Math.max(GUTTER_SAME_PT, GUTTER_SAME_EM * text) });
  }
  // Each gutter is tried as the group's centre; the first of the largest groups wins a tie.
  let top: typeof found = [];
  for (const centre of found) {
    const group = found.filter((g) => Math.abs(g.b - centre.b) <= Math.max(g.reach, centre.reach));
    if (group.length > top.length) top = group;
  }
  if (top.length < 2) return null;
  // The right column's left edge is the steady one; the left edge moves with an overhang.
  return { a: Math.min(...top.map((g) => g.a)), b: median(top.map((g) => g.b)) };
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

// ── The body's style, and what the paper's numbering and reference list rule out (P12-49) ─────────────

/**
 * The size and face the paper's body is set in, and — when the paper has any — the numbered lines its own
 * numbering and its reference list rule out of its headings (`headingOf` reads them; see `numberedOut`).
 */
export interface BodyStyle {
  size: number;
  font: string;
  /** The keys (`lineKey`) of the numbered lines that are not headings: an entry of a reference list, a
   *  number that goes back. Present only when there is one. */
  notHeadings?: ReadonlySet<string>;
}

/** A size is the body's when it holds at least this share of the heaviest size's characters... */
const BODY_SIZE_SHARE = 0.35;
/** ...and is set on at least this many lines: a title of three lines is not the body of a short page. */
const BODY_MIN_LINES = 5;

/**
 * The size and face the paper's body is set in: the **largest size that holds at least 35 % of the heaviest
 * size's characters** (and is set on a body's worth of lines: five), and the face most of that size's
 * characters are set in.
 *
 * P12-49 (O1): the size with the most characters is not the body where the methods, the references and the
 * captions are set small and outweigh it (7.5 pt against a 9.3 pt body, on the owner's third paper): every body
 * line then reads as "bigger" than the body and each short unpunctuated one became a heading — a hundred
 * sections from eleven pages. A paper whose heaviest size is its body is read as before.
 */
export function bodyStyle(lines: PdfLine[]): BodyStyle {
  const bySize = new Map<number, { chars: number; lines: number }>();
  for (const line of lines) {
    const known = bySize.get(line.size) ?? { chars: 0, lines: 0 };
    bySize.set(line.size, { chars: known.chars + line.text.length, lines: known.lines + 1 });
  }
  const heaviest = Math.max(0, ...[...bySize.values()].map((n) => n.chars));
  const holding = [...bySize]
    .filter(([, n]) => n.chars === heaviest || (n.chars >= heaviest * BODY_SIZE_SHARE && n.lines >= BODY_MIN_LINES))
    .map(([s]) => s);
  const size = heaviest > 0 ? Math.max(...holding) : 10;
  // The face follows the size: the one most of the body-size characters are set in.
  const byFont = new Map<string, number>();
  for (const line of lines) if (line.size === size) byFont.set(line.font, (byFont.get(line.font) ?? 0) + line.text.length);
  const font = [...byFont].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "";
  const body = { size, font };
  const out = numberedOut(lines, body);
  return out.size > 0 ? { ...body, notHeadings: out } : body;
}

/** A running head is on at least this many pages (P10-33, BACKLOG-84): two pages that open with the same
 *  wording are a templated paragraph, or a repeated one, not a head. */
const FURNITURE_MIN_PAGES = 3;
/** The page's top or bottom band: this many of its rows from either edge. A head and a rule, a folio and a
 *  journal line, an author line above them: three. Wording mid-page, or the fifth row down, is the body's. */
const FURNITURE_BAND_ROWS = 3;
/** A running head is on this share of the pages of the paper (P12-97, R-F: the pages that carry text). */
const FURNITURE_SHARE = 0.4;
/** A page carries text when it has this many lines: a page of figure text, a plate or a title page has fewer, and
 *  prints no running head (P12-97, R-F). */
const FURNITURE_TEXT_PAGE_LINES = 15;

/** How many pages a running head is a share of: those that carry text, or, when none does, all of them. */
function pagesWithText(lines: PdfLine[], pageCount: number): number {
  const perPage = new Map<number, number>();
  for (const { page } of lines) perPage.set(page, (perPage.get(page) ?? 0) + 1);
  const carrying = [...perPage.values()].filter((n) => n >= FURNITURE_TEXT_PAGE_LINES).length;
  return carrying > 0 ? Math.min(carrying, pageCount) : pageCount;
}

/** Which band of its page a line stands in — the top one or the bottom one (`FURNITURE_BAND_ROWS` rows from an
 *  edge, rows being the page's distinct baselines to the nearest 3 points, so two columns' lines share one) —
 *  or neither. */
function bandOf(lines: PdfLine[]): (line: PdfLine) => "top" | "bottom" | null {
  const rows = new Map<number, number[]>();
  for (const { page, y } of lines) {
    const row = Math.round(y / 3);
    const known = rows.get(page);
    if (!known) rows.set(page, [row]);
    else if (!known.includes(row)) known.push(row);
  }
  for (const known of rows.values()) known.sort((a, b) => b - a);
  return (line) => {
    const known = rows.get(line.page);
    if (!known) return null;
    const at = known.indexOf(Math.round(line.y / 3));
    if (at >= FURNITURE_BAND_ROWS && at < known.length - FURNITURE_BAND_ROWS) return null;
    return at < known.length / 2 ? "top" : "bottom";
  };
}

/** A running head by its words alone: the digits (a folio, a volume) and the case are not part of it. */
const headKey = (text: string): string => text.replace(/\d+/g, "#").replace(/\s+/g, " ").trim().toLowerCase();

/**
 * A running head by its words, with whatever stands beyond its first and last letter taken off (P12-97, R-F): the
 * page number, a bar, a volume or a date at either end. A journal prints its foot with the folio on the right of an
 * odd page and on the left of an even one, and each side is a head of its own to `headKey`, on half the pages.
 * A line with no letter in it (a bare folio) keeps its key.
 */
const footKey = (text: string): string => {
  const words = headKey(text);
  const core = words.replace(/^[^\p{L}]+/u, "").replace(/[^\p{L}]+$/u, "");
  return core.length > 0 ? core : words;
};

/** A head stands within this many points of a height it was seen at (P12-49, O4): the pages of a paper do not
 *  set it on one baseline to the hundredth, and a row of two columns' heads has two. */
const HEAD_REACH = 12;
/** A head that is only part of a longer one, or a line made of several heads, has at least this many characters:
 *  a word or two of a head are not it. */
const HEAD_PART_MIN = 8;

/**
 * The running heads `furnitureOf` found: a Set of their keys (the band they stand in, then their words, so `has`
 * and `size` read as they always did), and where each of them stood on the pages it was seen on.
 */
class RunningHeads extends Set<string> {
  /** Each head's words, and the heights (baselines) it was seen at. */
  readonly stands = new Map<string, { words: string; heights: number[] }>();

  /** Whether `words`, a line's words at height `y`, are one of the heads, or one of two heads a row holds in two
   *  columns, or the two of them set as one line. */
  covers(words: string, y: number): boolean {
    const near = (heights: number[]) => heights.some((h) => Math.abs(h - y) <= HEAD_REACH);
    for (const band of ["top", "bottom"]) {
      const own = this.stands.get(`${band}:${words}`);
      if (own && near(own.heights)) return true;
    }
    if (words.length < HEAD_PART_MIN) return false;
    // A row of two columns' heads is one line on a page whose gutter is not found and two on another: each of the
    // two is furniture where the whole row is, and the whole row where each of the two is.
    let rest = words;
    for (const head of this.stands.values()) {
      if (head.words.length < HEAD_PART_MIN || !near(head.heights)) continue;
      if (head.words !== words && wholeWords(head.words, words)) return true;
      rest = rest.split(head.words).join(" ");
    }
    return rest !== words && !/[\p{L}\p{N}]/u.test(rest.replace(/#/g, ""));
  }
}

/** Whether `part` stands in `whole` as whole words. */
function wholeWords(whole: string, part: string): boolean {
  for (let at = whole.indexOf(part); at >= 0; at = whole.indexOf(part, at + 1)) {
    const before = whole[at - 1];
    const after = whole[at + part.length];
    if ((before === undefined || before === " ") && (after === undefined || after === " ")) return true;
  }
  return false;
}

/** Lines that repeat across pages in the page's top or bottom band, on at least three pages (and 40% of the pages
 *  that carry text): running heads, folios, preprint stamps. They are the page's furniture, not the paper's words.
 *
 *  P12-97 (R-F): a head is known by the words between its first and last letter, so a foot that prints its page
 *  number on the right of an odd page and on the left of an even one is one head, not two on half the pages each;
 *  and the share is of the pages that have 15 lines or more, not of the figure-only and supplement pages that print
 *  no head (all pages, when none has so many).
 *
 *  P12-49 (O4): a head is known by its normalised words and the band it stands in, **whatever its column or its
 *  exact height**. It was keyed by its words and its height rounded to 6 pt, so a head that two pages set a point
 *  apart across a rounding edge, and a row of two heads in two columns that one page splits into two lines and
 *  another welds into one, were never found on enough pages — and the running head read as a heading. */
export function furnitureOf(lines: PdfLine[], pageCount: number): Set<string> {
  const seen = new Map<string, { words: string; pages: Set<number>; heights: number[] }>();
  const bandIn = bandOf(lines);
  for (const line of lines) {
    const band = line.text.length > 120 ? null : bandIn(line);
    if (band === null) continue;
    const words = footKey(line.text);
    const key = `${band}:${words}`;
    const entry = seen.get(key) ?? { words, pages: new Set<number>(), heights: [] };
    entry.pages.add(line.page);
    entry.heights.push(line.y);
    seen.set(key, entry);
  }
  const repeated = new RunningHeads();
  const threshold = Math.max(FURNITURE_MIN_PAGES, Math.ceil(pagesWithText(lines, pageCount) * FURNITURE_SHARE));
  for (const [key, { words, pages, heights }] of seen) {
    if (pages.size < threshold) continue;
    repeated.add(key);
    repeated.stands.set(key, { words, heights });
  }
  return repeated;
}

/** Whether this line is the page's furniture: a folio, or one of the running heads `furnitureOf` found (or one of
 *  the two heads a row holds in two columns, or the two of them set as one line). */
export function isFurniture(line: PdfLine, furniture: Set<string>): boolean {
  if (FOLIO.test(line.text)) return true;
  // A Set that is not `furnitureOf`'s knows the words only.
  return furniture instanceof RunningHeads ? furniture.covers(footKey(line.text), line.y) : furniture.has(headKey(line.text));
}

/** Small print beyond a page's text is a footer or a stamp up to this many rows (3 pt apart); past it, it is a
 *  section set small (P12-49). */
const MARGIN_PRINT_ROWS = 8;

/**
 * The lines that are margin print: small print above the page's first or
 * below its last full-size line — the publisher's copyright and DOI footer, a
 * download stamp. A journal prints them on its first page only, so no
 * repetition marks them as furniture, and they landed in the middle of the
 * sentence that crosses the page break.
 */
function marginPrintOf(lines: PdfLine[], body: { size: number; font: string }): (line: PdfLine) => boolean {
  const footnote = footnoteOf(lines, body);
  const edges = new Map<number, { top: number; bottom: number }>();
  for (const line of lines) {
    if (line.size < body.size * FULL_SIZE_RATIO) continue;
    const edge = edges.get(line.page) ?? { top: -Infinity, bottom: Infinity };
    edges.set(line.page, { top: Math.max(edge.top, line.y), bottom: Math.min(edge.bottom, line.y) });
  }
  const sideOf = (line: PdfLine): "top" | "bottom" | null => {
    const edge = edges.get(line.page);
    if (!edge || line.size >= body.size * MARGIN_PRINT_RATIO) return null;
    return line.y < edge.bottom ? "bottom" : line.y > edge.top ? "top" : null;
  };
  // P12-49 (O1): the body is now the larger size, so a section set small (the methods, the references) can stand
  // below the page's last full-size line. A footer or a stamp is a few rows; many rows of small print are a section.
  const rows = new Map<string, Set<number>>();
  for (const line of lines) {
    const side = sideOf(line);
    if (side === null) continue;
    const key = `${line.page}:${side}`;
    rows.set(key, (rows.get(key) ?? new Set<number>()).add(Math.round(line.y / 3)));
  }
  return (line) => {
    if (footnote.has(line)) return true;
    const side = sideOf(line);
    return side !== null && (rows.get(`${line.page}:${side}`)?.size ?? 0) <= MARGIN_PRINT_ROWS;
  };
}

/** C P12-74 (M6): a footnote opens with its marker: a digit or one of the footnote symbols, directly before a letter
 *  ("1 Department of ...", "∗ Corresponding author"). Without the marker a 9 pt note under the text is the paper's. */
const FOOTNOTE_MARKER = /^[\d∗*†‡§¶]\s?\p{L}/u;
/** The last line of the body's prose is at least this long: a folio or a one-word label at the foot is not prose. */
const PROSE_LINE_MIN = 30;
/** A line is in the body's size when it is within this many points of it: the running foot of a page, set a third of
 *  a point smaller, is a size of its own. */
const BODY_SIZE_SLACK = 0.3;
/** Small print is set under this share of the body's size. */
const SMALL_PRINT_RATIO = 0.95;

/**
 * C P12-74 (M6, B P12-73): the lines of the opening page's footnote — the authors' affiliations, printed on page 1 only
 * (so no repetition makes them furniture), at 0.86 of the body (so `MARGIN_PRINT_RATIO` leaves them), under the text.
 * They are **small print under the last line in the body's face and size** (the page's edge for this rule, not the last
 * full-size line: a running foot at 0.96 of the body is the edge of the other rule), set apart from that line by more
 * than a pitch, opening with a footnote marker, at most `MARGIN_PRINT_ROWS` rows, and holding no caption. None of
 * them is the paper's text. Only the opening page has a footnote of this kind; small print under the text of any other
 * page is a table or a section set small.
 */
function footnoteOf(lines: PdfLine[], body: { size: number; font: string }): Set<PdfLine> {
  const none = new Set<PdfLine>();
  let opening = Infinity;
  for (const line of lines) opening = Math.min(opening, line.page);
  // The last line of prose in the body's face and size: the edge the footnote stands under.
  let edge = Infinity;
  for (const line of lines) {
    if (line.page !== opening || line.block || line.font !== body.font || Math.abs(line.size - body.size) >= BODY_SIZE_SLACK) continue;
    if (line.text.trim().length >= PROSE_LINE_MIN) edge = Math.min(edge, line.y);
  }
  if (edge === Infinity) return none;
  const below = lines
    .filter((line) => line.page === opening && !line.block && line.y < edge && line.size < body.size * SMALL_PRINT_RATIO)
    .sort((a, b) => b.y - a.y || a.x - b.x);
  if (below.length === 0) return none;
  const pitch = linePitch(lines) || body.size * 1.2;
  if (edge - below[0].y <= pitch || !FOOTNOTE_MARKER.test(below[0].text.trim())) return none;
  if (below.some((line) => captionOf(line) !== null)) return none;
  if (new Set(below.map((line) => Math.round(line.y / 3))).size > MARGIN_PRINT_ROWS) return none;
  return new Set(below);
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

/** The ordinal of "Extended Data Fig. N" is this and N (R14a): above any "Fig. N" the figure route can draw. */
const EXTENDED_ORDINAL_BASE = 1000;

export function captionOf(line: PdfLine): OutlineCaption | null {
  const m = line.text.match(CAPTION_SEPARATED);
  if (!m) return null;
  const extended = m[1] !== undefined;
  // "Extended Data Table 1" is not read: only figures have a second numbering here.
  if (extended && !/^fig/i.test(m[2])) return null;
  // An Extended Data figure's number is its own: its ordinal is in a range of its own (1000 + N; a figure's number
  // has at most three digits), so nothing that finds a caption by its ordinal (the binder's model answer) can take
  // "Extended Data Fig. 3" for "Fig. 3".
  const ordinal = /^\d+$/.test(m[3]) ? (extended ? EXTENDED_ORDINAL_BASE : 0) + Number(m[3]) : undefined;
  return {
    ordinal,
    label: `${extended ? "Extended Data " : ""}${m[2]} ${m[3]}`.replace(/\s+/g, " ").trim(),
    caption: m[4].trim(),
    page: line.page,
  };
}

/** What a citation mark leaves at the end of a sentence's last line: a run of superscript digits ("shown.¹²,¹³") or
 *  a bracketed number list ("shown. [12, 13]"). Taken off before asking whether the line ends a sentence. */
const CITATION_TAIL = new RegExp(
  String.raw`(?:\s|[\u00B2\u00B3\u00B9\u2070-\u209F]+[,\u2013-]?|\[[\d,\s\u2013-]+\])+$`,
  "u",
);

/** Whether a line's last words close a sentence: `.` `!` `?` or `:`, a closing bracket or quote after it allowed, and
 *  a citation mark after that. */
function endsSentence(text: string): boolean {
  return /[.!?:][)\]"'\u201D\u2019\u00BB]*$/.test(text.trim().replace(CITATION_TAIL, ""));
}

/** How far a caption's own lines are looked for above a line (R6b), in lines; a caption is not longer than this. */
const CAPTION_LOOKBACK = 80;
/** A line starts in the column of the line above it when the two left edges are within this many body sizes
 *  (a paragraph's indent is one or two). */
const SAME_COLUMN_EMS = 2.5;

/**
 * P12-56 (R6b): whether the line `read[index]`, which opens with a figure's label, is the next words of a sentence the
 * line above it did not finish. That is when the line above is, in the same column and directly above (within a line
 * pitch and a half), on the same page, set in the body's size and face, and does not end a sentence (`endsSentence`):
 * "...as shown in" over "Fig. 4. Then the signal rises ...". A caption is never that: it follows a sentence's end,
 * a gap, a figure, another column or a face of its own. The line above is not body text when it is itself part of a
 * caption (the next caption of a list follows a caption's last line, which may end without a stop).
 */
function opensMidSentence(
  read: PdfLine[],
  index: number,
  pitch: number,
  body: { size: number; font: string },
  furniture: Set<string>,
  leftOut?: (index: number) => boolean,
): boolean {
  return followsOpenProse(read, index, pitch, body, furniture, leftOut) && !inCaption(read, index - 1, pitch, body, furniture, leftOut);
}

/** A line shorter than this share of the line above it (same face and size, directly under it, in its column) is a
 *  paragraph's last line: a line that wraps runs to the column's edge (P12-70). */
const SHORT_LAST_LINE = 0.5;

/**
 * P12-70: whether `read[index]` ends its paragraph by its length: it is under `SHORT_LAST_LINE` of the length of the line
 * above it, which is set in the same face and size, directly above and in the same column. The sentence it ends needs
 * no full stop for that (C P12-51's required negative: "of the new set", then a caption).
 */
function endsParagraph(
  read: PdfLine[],
  index: number,
  pitch: number,
  body: { size: number; font: string },
  leftOut?: (index: number) => boolean,
): boolean {
  const last = read[index];
  const before = index > 0 ? read[index - 1] : undefined;
  if (!before || before.page !== last.page || before.block || leftOut?.(index - 1)) return false;
  const gap = before.y - last.y;
  if (gap <= 0 || gap > (pitch > 0 ? pitch : body.size * 1.2) * 1.5) return false;
  if (Math.abs(before.x - last.x) > body.size * SAME_COLUMN_EMS) return false;
  if (before.font !== last.font || Math.abs(before.size - last.size) > HEADING_WRAP_SIZE) return false;
  return last.text.trim().length < before.text.trim().length * SHORT_LAST_LINE;
}

/**
 * `leftOut` (P12-70): the lines the reading leaves out of the prose (margin print, the dated box, the text of a
 * figure's panels). A line left out is not open prose: it is not the first half of a sentence a label line goes on
 * with, whatever its size and face. (C P12-51's figure text is set in the body's own size and face when it is a few
 * words of a plot's axis, and stands directly above the caption.)
 */
function followsOpenProse(
  read: PdfLine[],
  index: number,
  pitch: number,
  body: { size: number; font: string },
  furniture: Set<string>,
  leftOut?: (index: number) => boolean,
): boolean {
  const line = read[index];
  const above = index > 0 ? read[index - 1] : undefined;
  if (!above || above.page !== line.page || above.block || isFurniture(above, furniture) || leftOut?.(index - 1)) return false;
  const gap = above.y - line.y;
  if (gap <= 0 || gap > (pitch > 0 ? pitch : body.size * 1.2) * 1.5) return false;
  if (Math.abs(above.x - line.x) > body.size * SAME_COLUMN_EMS) return false;
  if (above.font !== body.font || Math.abs(above.size - body.size) > HEADING_WRAP_SIZE) return false;
  return above.text.trim().length > 0 && !endsSentence(above.text) && !endsParagraph(read, index - 1, pitch, body, leftOut);
}

/** Whether `read[last]` is a line of a caption, by the chain `buildOutline` reads one by: back from it to the line that
 *  opens a caption, which must run on to it (`captionEnd`; P12-82: a caption is read forward from its opener, since
 *  what it has shown so far decides whether it goes on). A line that opens like a caption but follows open prose is a
 *  caption exactly when the line above it is in one (a list of captions that end without a stop: each follows the last
 *  line of the one before). */
function inCaption(
  read: PdfLine[],
  last: number,
  pitch: number,
  body: { size: number; font: string },
  furniture: Set<string>,
  leftOut?: (index: number) => boolean,
): boolean {
  // The last line of the stretch of caption being traced back to its opener.
  let reach = last;
  for (let j = last, steps = 0; j >= 0 && steps < CAPTION_LOOKBACK; j--, steps++) {
    if (!captionOf(read[j])) continue;
    if (captionEnd(read, j, pitch, body, furniture, reach) < reach) return false;
    if (!followsOpenProse(read, j, pitch, body, furniture, leftOut)) return true;
    reach = j - 1;
  }
  return false;
}

/**
 * P12-56 (R6b): `captionOf(read[index])`, unless the line is the middle of a sentence (`opensMidSentence`): a body line
 * that begins with a figure citation after a line that ends mid-clause is prose, not a caption.
 */
export function captionAt(
  read: PdfLine[],
  index: number,
  pitch: number,
  body: { size: number; font: string },
  furniture: Set<string>,
  leftOut?: (index: number) => boolean,
): OutlineCaption | null {
  const caption = captionOf(read[index]);
  return caption && !opensMidSentence(read, index, pitch, body, furniture, leftOut) ? caption : null;
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

// ── What is not a heading: an address, an entry of a reference list, a drop cap, a run-in lead-in (P12-49) ──
//
// O3: a line that starts with a number and a capital was a numbered heading whatever it was set in — a street
// address in an affiliation block, an entry of the reference list. O7: with the body size right, a drop cap (a
// large letter, welded to the first line it stands beside) and a bold lead-in ("Battery cycling." then the
// paragraph's first words on the same line) read as headings holding a whole line of prose.

/** A capitalised word of a name or an address: "Quarry", "O'Neil", "St.". */
const CAP_WORD = String.raw`\p{Lu}[\p{L}'’.-]*`;
/** A word of a name or an address: a capitalised one, or a small connecting word. */
const NAME_WORD = `(?:${CAP_WORD}|of|and|for|the|de|la|du|van|von|der|&)`;
/** A street number ("12", never "12." or "1.2": a section number carries its point) and capitalised words up to
 *  a comma: "12 Quarry Lane, Fenwick Hall, Elmstead". */
const STREET_COMMA = new RegExp(`^\\d{1,5}\\s+${CAP_WORD}(?:\\s+${NAME_WORD})*,`, "u");
/** ...or at least two capitalised words ahead of a postal code: "5 Hamilton Court Springfield IL 62704". */
const STREET_WORDS = new RegExp(`^\\d{1,5}\\s+${CAP_WORD}(?:\\s+${NAME_WORD})+\\s`, "u");
const POSTAL_CODE = /\b(?:\d{5}(?:-\d{4})?|[A-Z]{1,2}\d[A-Z\d]?\s?\d[A-Z]{2}|\d{4}\s?[A-Z]{2})\b/;

/** Whether this line, which opens with a plain number and a capital, is a street address (an affiliation's)
 *  and not a section's number: the number, capitalised words, and a comma or a postal code. */
function isStreetAddress(text: string): boolean {
  return STREET_COMMA.test(text) || (STREET_WORDS.test(text) && POSTAL_CODE.test(text));
}

const SURNAME = String.raw`\p{Lu}[\p{L}'’-]+`;
/** The first words of a reference-list entry: its number, then the authors as a bibliography writes them —
 *  "17 Smith, J. A.; Doe", "3. J. A. Smith, B. Doe", "12 Zhang Q, Li W". */
const ENTRY_AUTHORS = new RegExp(
  `^\\d{1,3}\\.?\\s+(?:${SURNAME},\\s+(?:\\p{Lu}\\.\\s?){1,3}|(?:\\p{Lu}\\.\\s?){1,3}${SURNAME}(?:,|\\s+and\\s|\\s+&\\s|\\s+et\\s+al)|${SURNAME}\\s+\\p{Lu}{1,3},\\s)`,
  "u",
);

/** A drop cap is set at least this many times the body's size (it stands beside two lines or more). */
const DROP_CAP_RATIO = 1.8;

/** A drop cap is one or two characters (P12-70, ruling §1h.443: O7's "one or two large letters"). */
const DROP_CAP_CHARS = 2;
/** The words beside a drop cap are body-sized: within this share of the body's size above it. */
const DROP_CAP_REST_RATIO = 1.25;
/** A run is "at the row's size" from this share of the row's largest height. */
const SAME_SIZE_SHARE = 0.9;

/** A drop cap and the word it starts stand within this share of the cap's size of one another. */
const CAP_WORD_GAP_EM = 0.25;
/** What follows a drop cap in its word: more letters in lower case, or the rest of a word set in capitals ("T" + "HE"). */
const CAP_CONTINUES = /^(?:\p{Ll}|\p{Lu}{2,}(?![\p{L}]))/u;

/**
 * P12-70: a row that holds a drop cap: its largest runs hold one or two characters (`letters`) and every other run is
 * set under 1 / `DROP_CAP_RATIO` of them. `size` is the cap's, `rest` the largest of the other runs' (the words
 * beside the cap), `textX` where they start and `next` the index of the run that follows a cap that opens the row
 * (-1 when it does not). A row set in one size has none, and neither has a row whose large part is a word or more (a
 * title or a heading set large). Where the cap stands in the row, whether its baseline is the words' to the hundredth,
 * and whether the page marks the words raised for it, do not matter: the cap is a mark of one or two characters.
 */
function capRowOf(runs: PdfTextItem[]): { size: number; rest: number; letters: string; textX: number; next: number } | undefined {
  const seen = runs.map((run, index) => ({ run, index })).filter(({ run }) => run.str.trim());
  const top = Math.max(0, ...seen.map(({ run }) => run.height));
  const isLarge = ({ run }: { run: PdfTextItem }) => run.height >= top * SAME_SIZE_SHARE;
  const large = seen.filter(isLarge);
  const rest = seen.filter((entry) => !isLarge(entry));
  if (large.length === 0 || rest.length === 0) return undefined;
  const letters = large.map(({ run }) => run.str.replace(/\s/g, "")).join("");
  const restSize = Math.max(...rest.map(({ run }) => run.height));
  if (letters.length > DROP_CAP_CHARS || restSize * DROP_CAP_RATIO > top) return undefined;
  const opens = seen[0] === large[0] && large.every((entry, k) => seen[k] === entry);
  return { size: top, rest: round(restSize), letters, textX: Math.min(...rest.map(({ run }) => run.x)), next: opens ? rest[0].index : -1 };
}

/**
 * Whether this line is a drop cap: the large first letter (or two) of a paragraph, alone on its row or with the
 * first words of the paragraph that the row carries beside it (so the longest run, and the face, are the
 * body's). It is no heading; it belongs to the word it starts.
 *
 * P12-70 (ruling §1h.443): the large part of the row is at most two characters (`PdfLine.cap`, set from the row's
 * runs) and the rest of the row is body-sized. A title or a heading set large in the body's face is one run of
 * several words, and is not a drop cap.
 */
export function isDropCap(line: PdfLine, body: { size: number; font: string }): boolean {
  if (line.size < body.size * DROP_CAP_RATIO) return false;
  const text = line.text.trim();
  if (/^\p{L}{1,2}$/u.test(text)) return true;
  return (
    line.cap !== undefined &&
    line.cap.rest <= body.size * DROP_CAP_REST_RATIO &&
    line.font === body.font &&
    /^\p{Lu}/u.test(text)
  );
}

/** P12-70 (ruling §1h.448): English has two one-letter words, "A" and "I". Any other one-letter cap starts the word beside it,
 *  whatever the paper prints that bare letter as (a unit "S", a variable "T"). */
const ONE_LETTER_WORD = /^[AI]$/;

/**
 * P12-70 (ruling §1h.446): whether a one-letter cap is a word of its own ("A" before "study", "I" before "think")
 * and not the first letter of the word beside it ("S" before "nail"). The paper's own words are the witness, as for a
 * ligature (P12-67): the cap is a word when the bare letter is printed in the paper and the joined word ("astudy") is
 * printed nowhere else; otherwise it starts the word, as it always did. `vocab` holds the paper's words in lower case.
 * P12-70 (ruling §1h.448): only "A" and "I" can be a word.
 */
function capIsWord(letters: string, word: string, vocab: Vocabulary): boolean {
  return (
    ONE_LETTER_WORD.test(letters) &&
    vocab.words.has(letters.toLowerCase()) &&
    !vocab.words.has(`${letters}${word}`.toLowerCase())
  );
}

/** A drop cap spans at most this many lines; the lines it stands beside are looked for this far above its row. */
const DROP_CAP_LINES_MAX = 4;
/** A capital's height as a share of its size: how far above its baseline a drop cap reaches. */
const CAP_HEIGHT_SHARE = 0.75;
/** The first line a cap stands beside rises above the cap's row by the cap's reach less the body capital's, plus this
 *  many sizes of the words (a drop cap is set a point or two off the grid). */
const DROP_CAP_SLACK_EM = 0.7;
/** The lines of a paragraph are set within this many sizes of one another. */
const DROP_CAP_LEADING_EM = 1.6;

/**
 * P12-70 (ruling §1h.445): a drop cap that spans several lines stands on the baseline of the last of them, so its row
 * holds the capital and the words of that third (or second) line, and the lines above it are the paragraph's first,
 * indented by the cap's width ("nail density rises ...", the first word without its capital). The capital belongs at the
 * start of the paragraph's first line, joined to its first word; the row it shares a baseline with is an ordinary line
 * of the paragraph. Each drop-cap row (`isDropCap`: one or two large letters over body-sized words, `titleSize` the
 * body's) is searched for the lines above it that it stands beside: contiguous, on its page, in its face, at the size
 * of its words, starting where its words start, within the cap's reach. When there are none the cap opens its own row
 * (the usual drop cap, whose letters `lineOf` has joined to the word they start) and nothing moves. A row is never a
 * heading for it (`isDropCap`) and always prose.
 */
function placeDropCaps(lines: PdfLine[], body: { size: number; font: string }): PdfLine[] {
  let out: PdfLine[] | null = null;
  // P12-70 (ruling §1h.446): the paper's own words, read once (without the caps' letters, which would witness
  // themselves) when a one-letter cap needs them.
  let vocab: Vocabulary | undefined;
  const standsAlone = (letters: string, words: string): boolean => {
    const word = /^\p{L}+/u.exec(words)?.[0];
    if (letters.length !== 1 || !word) return false;
    vocab ??= vocabularyOf(lines.map((l) => (l.cap?.letters && l.text.startsWith(l.cap.letters) ? { ...l, text: l.text.slice(l.cap.letters.length) } : l)));
    return capIsWord(letters, word, vocab);
  };
  for (let i = 0; i < lines.length; i++) {
    const row = lines[i];
    const cap = row.cap;
    if (!cap || !cap.letters || cap.textX === undefined || !isDropCap(row, body) || !row.text.startsWith(cap.letters)) continue;
    const reach = (row.size - cap.rest) * CAP_HEIGHT_SHARE + cap.rest * DROP_CAP_SLACK_EM;
    let first = -1;
    let below = row;
    for (let j = i - 1; j >= 0 && i - j <= DROP_CAP_LINES_MAX; j--) {
      const above = lines[j];
      const gap = above.y - below.y;
      if (above.page !== row.page || above.block || above.cap || gap <= 0 || gap > cap.rest * DROP_CAP_LEADING_EM) break;
      if (above.y - row.y > reach || above.font !== row.font) break;
      if (Math.abs(above.size - cap.rest) > OPENING_SIZE_SLACK || Math.abs(above.x - cap.textX) > cap.rest) break;
      first = j;
      below = above;
    }
    const words = row.text.slice(cap.letters.length).trimStart();
    if (first < 0) {
      // The cap opens its row and `lineOf` joined it to its word: a cap that is a word of its own ("A", "I") is not.
      if (cap.joined && standsAlone(cap.letters, words)) {
        out ??= lines.slice();
        out[i] = { ...row, text: `${cap.letters} ${words}` };
      }
      continue;
    }
    if (words.length === 0) continue;
    out ??= lines.slice();
    // The lines the cap stands beside are indented by its width; they start where the cap does, or each would open a
    // paragraph of its own (`joinProse` breaks at an indent).
    for (let j = first; j < i; j++) out[j] = { ...lines[j], x: row.x };
    const head = lines[first];
    const welds = CAP_CONTINUES.test(head.text) && !standsAlone(cap.letters, head.text);
    out[first] = { ...out[first], text: `${cap.letters}${welds ? "" : " "}${head.text}` };
    const plain: PdfLine = { ...row, text: words, size: cap.rest };
    delete plain.cap;
    out[i] = plain;
  }
  return out ?? lines;
}

/** A lead-in is the first sentence of the line, ending with a period; a line of a larger size is a heading. */
const LEAD_IN = /^([^.!?]{3,80}?)\.\s+(?=[\p{Lu}\d(\[])/u;
const LEAD_IN_MAX_RATIO = 1.25;
/** The words a period follows without ending a sentence. */
const ABBREVIATION = /^(?:figs?|eqs?|refs?|vol|sec|etc|resp|approx|inc|ltd|mrs|prof)$/i;

/**
 * Whether the line opens with a run-in lead-in: a phrase ending with a period, with more text on the same line
 * — "Battery cycling. Cells were assembled in an argon-". A heading is a phrase; it has no sentence after it.
 */
function opensWithLeadIn(text: string): boolean {
  const word = LEAD_IN.exec(text)?.[1].match(/(\p{L}+)$/u)?.[1];
  return !!word && word.length >= 3 && !ABBREVIATION.test(word);
}

/** Whether the line is set apart from the body by its size or its face. */
function isSetApart(line: PdfLine, body: { size: number; font: string }): boolean {
  return line.size >= body.size * HEADING_SIZE_RATIO || (line.font !== body.font && line.size >= body.size * 0.95);
}

/** C P12-74 (R3): a lone panel letter, b to h (never "a", a word of its own): a figure's "b Discharge curve". */
const PANEL_LETTER = /(?:^|\s)[b-h](?=\s|$)/;

/** C P12-74 (R5): a key in quotes, then a colon: `'optimizer': 'adamw'`, `"lr": 0.01`. */
const QUOTED_KEY = /['"][\w .-]+['"]\s*:/;

/** The heading this line would be, judged on the line alone: its shape, its size and its face. */
function candidateOf(line: PdfLine, body: { size: number; font: string }): string | null {
  const text = line.text.trim();
  if (text.length === 0 || text.length > HEADING_MAX) return null;
  if (CAPTION.test(text)) return null;
  if (isDropCap(line, body)) return null;
  // C P12-74 (R3, B P12-73 M1): a single letter b to h between spaces, or at an end of the line, is a figure's panel
  // label ("a Charge curve  b Discharge curve"): the line is figure text, not a heading.
  if (PANEL_LETTER.test(text)) return null;
  // C P12-74 (R5, B P12-73 M1): a quoted key and a colon ("'optimizer': 'adamw'") is a line of source code or a settings
  // listing, set in a monospace face the body's other face rule takes for a heading's.
  if (QUOTED_KEY.test(text)) return null;
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
  if (numbered && numbered[2].length >= 3 && /^[A-Z(]/.test(numbered[2])) {
    // ...and neither is a street address ("12 Quarry Lane, Elmstead", unless the line is set larger than the
    // body) nor the first line of a reference-list entry ("17 Smith, J. A.; Doe, B.").
    const larger = line.size >= body.size * HEADING_SIZE_RATIO;
    if ((!larger && isStreetAddress(text)) || ENTRY_AUTHORS.test(text)) return null;
    // C P12-74 (R1, B P12-73 M1): ...nor a numbered line set smaller than the body, whatever its face: an axis
    // tick ("80 Capacity retention"), a legend, a reference entry, small print. A heading is not set smaller than
    // the text it heads (the unnumbered path below has always asked for 0.95 of the body or more).
    if (line.size < body.size * NUMBERED_SIZE_RATIO) return null;
    return text;
  }
  const bigger = line.size >= body.size * HEADING_SIZE_RATIO;
  const otherFace = line.font !== body.font && line.size >= body.size * 0.95;
  if (!bigger && !otherFace) return null;
  // An unnumbered heading is a word: "Abstract", "Discussion". A row of
  // symbols set in the maths face ("qe,ic0,1 ka,ic0,iqe,1") is an equation
  // the page happens to set apart.
  if (!/[A-Za-z]{4}/.test(text)) return null;
  // A phrase in another face with a sentence after it on the line is a paragraph's lead-in, not a heading.
  if (line.size < body.size * LEAD_IN_MAX_RATIO && opensWithLeadIn(text)) return null;
  return text;
}

/** A line, as a key that survives a copy of it: its page, its place and its words. */
const lineKey = (line: PdfLine): string => `${line.page}|${line.x}|${line.y}|${line.text}`;

/** A section number's groups: "2.10" is [2, 10]. */
const numberParts = (group: string): number[] => group.split(".").map(Number);

/** Whether the numbering `a` comes after `b` ([2, 1] after [2], [3] after [2, 4]; not [2] after [2, 1]). */
function numbersAfter(a: number[], b: number[]): boolean {
  for (let i = 0; i < Math.min(a.length, b.length); i++) if (a[i] !== b[i]) return a[i] > b[i];
  return a.length > b.length;
}

/** A top-level number this far past the last one is a heading that skipped some, and moves the numbering on;
 *  one further ("20. EXTRAS" after 3) is a heading, and leaves the numbering where it stood. */
const NUMBER_REACH = 3;

/** The words of the heading that opens a reference list. */
const REFERENCES_HEADING =
  /^(?:references?(?:\s+(?:and|&)\s+notes)?|reference\s+list|bibliography|notes\s+and\s+references|literature\s+cited|works\s+cited)\s*[:.]?\s*$/i;

/**
 * Whether a numbered line's words after its number are a **plain heading that names a part**: `tailPartOf`'s test
 * (P12-51) — at most `PLAIN_HEADING_WORDS` words, no comma, no year — and the words name a part of the argument
 * (methods above all) or an end-matter note. A reference entry has an author shape, a comma or a year.
 */
function namesAPart(head: string): boolean {
  const own = head.trim().replace(GLYPH_LEAD, "").replace(SECTION_LEAD, "");
  if (own.split(/\s+/).length > PLAIN_HEADING_WORDS || own.includes(",") || PRINT_YEAR.test(own)) return false;
  const canonical = canonicalizeHeading(head);
  const part = tailPartOf(head, canonical, endsTheArgument(head, canonical));
  return part === "argument" || part === "note";
}

/**
 * The numbered lines of a paper that are not its headings (P12-49, O3), as `lineKey`s. A numbered line is a
 * heading only when its number **continues the paper's numbering**: it comes after the last section number met
 * ([2, 1] after [2], [3] after [2, 4]), and the paper's numbering starts at its first named part, not on the cover.
 * A number that goes back is a list, an entry or a footnote: "1", "2", "3" under the references after a paper of
 * four sections. And **no line in a references section** is one — that section runs from its heading to the next
 * heading, which is a line set apart (larger, or in another face) or a plain numbered heading that names a part
 * (`namesAPart`: "5 Methods" after the references).
 *
 * The numbering is the headings that are set apart: they move it. A line in the body's own face is judged against
 * it and moves it only while no heading has (the plain fixtures of a test), so a paper's stray "2 Institute of ..."
 * in the footnote of page 1 neither takes the number of the real "2. Results" nor turns it away; and a set-apart
 * heading that goes back is taken only while the numbering is still the body-face lines' own.
 *
 * C P12-74 (R2): and a numbered line in the body's own face and size that follows open prose (`followsOpenProse`: the
 * line above is body prose in its column, one pitch up, and does not end a sentence) is the middle of that sentence,
 * not a heading, unless the line above is a heading candidate itself (stacked numbered headings).
 */
function numberedOut(lines: PdfLine[], body: { size: number; font: string }): Set<string> {
  const out = new Set<string>();
  const furniture = furnitureOf(lines, new Set(lines.map((line) => line.page)).size);
  const margin = marginPrintOf(lines, body);
  const heads: { line: PdfLine; head: string }[] = [];
  // C P12-74 (R2): where each line stands among the lines, and the pitch they are read at, for `followsOpenProse`.
  const placeOf = new Map(lines.map((line, i) => [line, i] as const));
  const pitch = linePitch(lines);
  for (const line of lines) {
    if (isFurniture(line, furniture) || margin(line)) continue;
    const head = candidateOf(line, body);
    if (head !== null) heads.push({ line, head });
  }
  // The paper starts at its first named part (as `buildOutline` reads it); above that is the cover.
  const start = Math.max(0, heads.findIndex(({ head }) => FRONT_MATTER_END.has(canonicalizeHeading(head))));
  let last: number[] = [];
  // Whether a heading set apart has moved the numbering.
  let set = false;
  let inReferences = false;
  for (const { line, head } of heads.slice(start)) {
    const numbered = sectionNumberOf(head);
    if (!numbered) {
      inReferences = REFERENCES_HEADING.test(head.replace(GLYPH_LEAD, "").trim());
      continue;
    }
    const apart = isSetApart(line, body);
    // C P12-74 (R2, B P12-73 M1): a numbered line in the body's own face and size that goes on from a sentence the line
    // above did not finish is the middle of a paragraph ("... charged at" over "4 A g-1 and then held ..."), not a
    // heading. Unless the line above is itself a heading candidate: stacked numbered headings in plain fixtures
    // ("5 Methods" over "5.1 Cell assembly", both in the body's face) are headings.
    const at = placeOf.get(line) ?? 0;
    if (
      !apart &&
      line.font === body.font &&
      followsOpenProse(lines, at, pitch, body, furniture) &&
      candidateOf(lines[at - 1], body) === null
    ) {
      out.add(lineKey(line));
      continue;
    }
    if (inReferences) {
      // A numbered line in the body's face is an entry, unless its words are a plain heading naming a part (a
      // journal that prints its Methods after the references, numbered: "5 Methods"): that ends the list.
      if (!apart && !namesAPart(head)) {
        out.add(lineKey(line));
        continue;
      }
      inReferences = false;
    }
    const parts = numberParts(numbered[1]);
    const continues = numbersAfter(parts, last);
    if (!continues && !(apart && !set)) {
      out.add(lineKey(line));
      continue;
    }
    // A number far ahead is a heading, and leaves the numbering where it stood.
    if ((apart || !set) && (!continues || parts[0] <= (last[0] ?? 0) + NUMBER_REACH)) {
      last = parts;
      set = set || apart;
    }
    inReferences = REFERENCES_HEADING.test(numbered[2].trim());
  }
  return out;
}

/** The heading this line is, or nothing. */
export function headingOf(line: PdfLine, body: BodyStyle): string | null {
  const head = candidateOf(line, body);
  return head !== null && !body.notHeadings?.has(lineKey(line)) ? head : null;
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
    // P9-15: a row that could be a row of an equation island keeps its runs, for the writer of the island.
    ...(isFragment(line.text) ? { runs: ordered, ...(row.raised ? { raised: row.raised } : {}), ...(row.lowered ? { lowered: row.lowered } : {}) } : {}),
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
        // P9-15: a display island is written on one line, left to right, where it holds a stack or a limit;
        // any other island keeps its rows, top to bottom.
        const text = writeIsland(rows, leading) ?? rows.map((row) => row.text).join("\n");
        out.push({ ...rows[0], text: lift(text), y: last.y, block: true });
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

// ── A display island, written on one line (P9-15) ───────────────────────────────────────────────────
//
// The rows of a display island used to be written as the page stacks them, top to bottom, each row's runs left to
// right: a fraction read numerator, the line it belongs to, denominator ("I(ab) Q(ab) = × 100 m I(ab)"), which is
// no equation. It is written on one line now, left to right, the way the equation is read aloud.
//
// The island is cut into cells: the runs of each row, a new cell where two runs are more than 0.9 em apart. The base
// line is the text-size row that holds `=` (else the widest text-size row); its cells that stand on its baseline are
// the line's own text. Every cell above that baseline or below it (a row of its own, or a script the fold took into
// the base line and left a few points off it) is the material of a stack: the cells of one stretch of the line with
// no text of the line in it, an upper side and a lower side that meet in x, are written `upper / lower` where that
// stretch stands in the line. A side of several cells is parenthesised. A short script-size cell between the line and
// a text-size cell of its own side, near it, is a fraction inside the stack ("1" over "N": `1/N`). A short
// script-size cell below or above an operator run (Σ ∑ ∏ ∫ lim), over the operator's x-range, is its limit and is
// written right after it. An island with neither is left as the rows were.

/** Runs of a row more than this many ems of the island's text apart are cells of their own; nearer, they meet. */
const CELL_GAP_EM = 0.9;
/** A limit ("n", "n=1") or an inner numerator ("1") is at most this many characters. */
const SCRIPT_CELL_MAX = 3;
/** The rows of a stack, and a limit, stand within this many leadings of the line they belong to. */
const STACK_REACH = 1.2;
/** A run that is an operator: a sum, a product, an integral, a limit. Its limits are written right after it. */
const OPERATOR_RUN = /^(?:[∑Σ∏∫]|lim)$/;

/** The runs of one row that sit together, as the island's writer reads them. */
interface Cell {
  line: PdfLine;
  row: number;
  runs: PdfTextItem[];
  x0: number;
  x1: number;
  /** The baseline and the height of the cell's tallest run. */
  y: number;
  size: number;
  text: string;
  /** The limits that go right after the operator run at this index. */
  limits?: Map<number, string[]>;
}

/** A cell made of `runs` (all of a row's, or a part of them), or null when they hold nothing to read. */
function cellOf(line: PdfLine, row: number, runs: PdfTextItem[], whole = false): Cell | null {
  const seen = runs.filter((run) => run.str.trim());
  if (seen.length === 0) return null;
  const text = whole ? line.text : (lineOf(line.page, line.y, runs, line.raised, line.lowered)?.text ?? "");
  if (!text) return null;
  const tallest = seen.reduce((best, run) => (run.height > best.height ? run : best), seen[0]);
  return {
    line,
    row,
    runs,
    x0: Math.min(...seen.map((run) => run.x)),
    x1: Math.max(...seen.map((run) => run.x + (run.width || 0))),
    y: tallest.y,
    size: tallest.height,
    text,
  };
}

/** A script-size run set this many ems clear of the run before it, and off that run's baseline, is a cell of its own. */
const SCRIPT_APART_EM = 0.4;

/**
 * A row's cells, left to right: a new cell wherever the next run starts more than `gap` past the ones before it, and
 * before a script that stands apart (a numerator the fold took into a row it only half belongs to, as a raised run, is
 * set clear of the text beside it; an exponent or a subscript touches its base and is not).
 */
function cellsOf(line: PdfLine, row: number, gap: number): Cell[] {
  // A line made some other way than by `linesOfRow` has no runs: its text stands in for one.
  const alone: PdfTextItem = { str: line.text, height: line.size, width: line.reach ?? line.text.length * line.size * 0.5, fontName: line.font, x: line.x, y: line.y };
  const runs: PdfTextItem[] = line.runs ? [...line.runs] : [alone];
  const groups: PdfTextItem[][] = [];
  const tallest = Math.max(...runs.map((run) => run.height));
  let edge = Number.NEGATIVE_INFINITY;
  let previous: PdfTextItem | undefined;
  for (const run of runs) {
    const visible = run.str.trim() !== "";
    const apart =
      visible && !!previous && run.height < SCRIPT_RATIO * tallest && Math.abs(run.y - previous.y) > SUPERSCRIPT_RISE && run.x - edge > SCRIPT_APART_EM * tallest;
    if (groups.length === 0 || run.x - edge > gap || apart) groups.push([run]);
    else groups[groups.length - 1].push(run);
    edge = Math.max(edge, run.x + (run.width || 0));
    if (visible) previous = run;
  }
  return groups.flatMap((group) => cellOf(line, row, group, groups.length === 1) ?? []);
}

/** Cells top to bottom, and left to right within one level (baselines within a line's tolerance of each other). */
function readingOrder(cells: readonly Cell[]): Cell[] {
  const levels: Cell[][] = [];
  for (const cell of [...cells].sort((a, b) => b.y - a.y)) {
    const level = levels[levels.length - 1];
    if (level && level[0].y - cell.y <= LINE_TOLERANCE) level.push(cell);
    else levels.push([cell]);
  }
  return levels.flatMap((level) => level.sort((a, b) => a.x0 - b.x0));
}

const gapBetween = (a: Cell, b: Cell) => Math.max(a.x0 - b.x1, b.x0 - a.x1);
const isOperatorFirst = (cell: Cell) => OPERATOR_RUN.test(cell.runs.find((run) => run.str.trim())?.str.trim() ?? "");

/**
 * The rows of a display island as one line, or null when it holds neither a stack nor a limit (a two-line equation,
 * a column of figures, rows that share no span) and is to keep its rows. `rows` run top to bottom, one page.
 */
export function writeIsland(rows: readonly PdfLine[], leading: number): string | null {
  const largest = Math.max(...rows.map((row) => row.size));
  const small = (size: number) => size < SCRIPT_RATIO * largest;
  const near = CELL_GAP_EM * largest;

  // The base line: the text-size row that holds `=`; with none, the widest text-size row. Two rows that hold `=`
  // are an equation over several lines, not a fraction, and a block with no letter and no `=` a column of figures.
  const sized = rows.map((_, i) => i).filter((i) => !small(rows[i].size));
  const holding = sized.filter((i) => rows[i].text.includes("="));
  if (holding.length > 1 || (holding.length === 0 && !rows.some((row) => /\p{L}/u.test(row.text)))) return null;
  const width = (row: PdfLine) => row.reach ?? row.text.length;
  const base = holding[0] ?? sized.reduce((best, i) => (width(rows[i]) > width(rows[best]) ? i : best));
  const baseY = rows[base].y;
  const sideOf = (cell: Cell): "above" | "below" | "line" => {
    if (cell.row !== base) return cell.row < base ? "above" : "below";
    return cell.y > baseY + LINE_TOLERANCE ? "above" : cell.y < baseY - LINE_TOLERANCE ? "below" : "line";
  };

  let cells = rows.flatMap((row, i) => cellsOf(row, i, near));
  const textOf = (cell: Cell): string => {
    if (!cell.limits) return cell.text;
    let out = "";
    let from = 0;
    const add = (runs: PdfTextItem[]) => {
      const text = lineOf(cell.line.page, cell.y, runs, cell.line.raised, cell.line.lowered)?.text ?? "";
      out = out && text ? `${out} ${text}` : out || text;
    };
    for (const k of [...cell.limits.keys()].sort((a, b) => a - b)) {
      add(cell.runs.slice(from, k + 1));
      out += (cell.limits.get(k) ?? []).join(" ");
      from = k + 1;
    }
    add(cell.runs.slice(from));
    return out;
  };

  // A limit: a short script-size cell under or over an operator run, over the run's x-range, goes right after it.
  let limits = 0;
  for (const op of [...cells]) {
    for (let k = 0; k < op.runs.length; k++) {
      const run = op.runs[k];
      if (!OPERATOR_RUN.test(run.str.trim())) continue;
      const found = [-1, 1].flatMap((direction) => {
        let nearest: Cell | undefined;
        for (const cell of cells) {
          const rise = cell.y - run.y;
          if (cell === op || !small(cell.size) || cell.text.trim().length > SCRIPT_CELL_MAX) continue;
          if (Math.sign(rise) !== direction || Math.abs(rise) <= SUPERSCRIPT_RISE || Math.abs(rise) > STACK_REACH * leading) continue;
          if (cell.x0 > run.x + (run.width || 0) || cell.x1 < run.x) continue;
          if (!nearest || Math.abs(rise) < Math.abs(nearest.y - run.y)) nearest = cell;
        }
        return nearest ? [nearest] : [];
      });
      if (found.length === 0) continue;
      (op.limits ??= new Map()).set(k, found.map((cell) => cell.text));
      cells = cells.filter((cell) => !found.includes(cell));
      limits += found.length;
    }
  }

  // A fraction inside a side: a short script-size cell between the base line and a text-size cell of its own side,
  // within a cell gap of it, is set over (or under) that cell: "1" over "N" is `1/N`. A cell that opens with an
  // operator is not the one: the sign stands beside the fraction, not under it.
  for (const side of ["above", "below"] as const) {
    for (const inner of cells.filter((c) => sideOf(c) === side && small(c.size) && c.text.trim().length <= SCRIPT_CELL_MAX && !c.limits)) {
      let other: Cell | undefined;
      let best = near;
      for (const cell of cells) {
        if (cell === inner || sideOf(cell) !== side || small(cell.size) || isOperatorFirst(cell)) continue;
        const farther = side === "below" ? cell.y < inner.y - SUPERSCRIPT_RISE : cell.y > inner.y + SUPERSCRIPT_RISE;
        const gap = gapBetween(inner, cell);
        if (farther && gap <= best) [best, other] = [gap, cell];
      }
      if (!other) continue;
      const joined: Cell = {
        ...other,
        runs: [],
        x0: Math.min(inner.x0, other.x0),
        x1: Math.max(inner.x1, other.x1),
        text: side === "below" ? `${inner.text}/${textOf(other)}` : `${textOf(other)}/${inner.text}`,
        limits: undefined,
      };
      cells = cells.flatMap((cell) => (cell === other ? [joined] : cell === inner ? [] : [cell]));
    }
  }

  // The stretches of the line with none of the line's own text in them hold the stacks.
  const own = cells.filter((cell) => sideOf(cell) === "line");
  const ownRuns = own.flatMap((cell) => cell.runs.filter((run) => run.str.trim()));
  const clusters: Cell[][] = [];
  let edge = Number.NEGATIVE_INFINITY;
  const material = cells.filter((c) => sideOf(c) !== "line" && Math.abs(c.y - baseY) <= STACK_REACH * leading);
  for (const cell of material.sort((a, b) => a.x0 - b.x0)) {
    const apart = ownRuns.some((run) => run.x >= edge && run.x + (run.width || 0) <= cell.x0);
    if (clusters.length > 0 && !apart) {
      clusters[clusters.length - 1].push(cell);
      edge = Math.max(edge, cell.x1);
    } else {
      clusters.push([cell]);
      edge = cell.x1;
    }
  }
  const stacks = clusters.filter((cluster) => {
    const above = cluster.filter((c) => sideOf(c) === "above");
    const below = cluster.filter((c) => sideOf(c) === "below");
    return above.some((a) => below.some((b) => gapBetween(a, b) <= near));
  });
  if (stacks.length === 0 && limits === 0) return null;

  const sideText = (cluster: Cell[], which: "above" | "below") => {
    const group = readingOrder(cluster.filter((c) => sideOf(c) === which));
    const text = group.map(textOf).join(" ");
    return group.length > 1 ? `(${text})` : text;
  };
  const at = stacks.map((stack) => (Math.min(...stack.map((c) => c.x0)) + Math.max(...stack.map((c) => c.x1))) / 2);
  // The line's own cells stand either side of each stack; a stack that falls between two runs of one cell cuts it.
  const pieces = own.flatMap((cell) =>
    at.reduce<Cell[]>(
      (parts, cx) =>
        parts.flatMap((part) => {
          if (part.limits) return [part];
          const left = part.runs.filter((run) => run.x + (run.width || 0) / 2 < cx);
          const a = cellOf(part.line, part.row, left);
          const b = cellOf(part.line, part.row, part.runs.filter((run) => !left.includes(run)));
          return a && b ? [a, b] : [part];
        }),
      [cell],
    ),
  );
  const flow = [
    ...pieces.map((piece) => ({ at: (piece.x0 + piece.x1) / 2, text: textOf(piece) })),
    ...stacks.map((stack, k) => ({ at: at[k], text: `${sideText(stack, "above")} / ${sideText(stack, "below")}` })),
  ].sort((a, b) => a.at - b.at);
  // Whatever has no partner across the line stays after it, as the rows had it.
  const stacked = new Set(stacks.flat());
  const rest = cells.filter((c) => sideOf(c) !== "line" && !stacked.has(c)).sort((a, b) => a.row - b.row || a.x0 - b.x0);
  return [...flow.map((part) => part.text), ...rest.map(textOf)].filter(Boolean).join(" ");
}

/** A sentence ends at one of these, and a closing quote or bracket after it still ends it. */
const SENTENCE_END = /[.!?:;]["')\]”’]*$/;
/** A sentence that a page break may not cut (P10-33): a full stop, a question or an exclamation, with a closing
 *  quote or bracket after it. A colon or a semicolon at a page's foot leads on to the next page's line. */
const PAGE_END = /[.!?]["')\]”’]*$/;
/** ...but not when the full stop closes an abbreviation (P10-37): "et al.", "e.g.", "i.e.", "Fig.", "Eq.", "Ref.", or a
 *  single capital initial ("J."). What follows is the rest of the same sentence, so the block on the next page goes on. */
const ABBREVIATION_END = /(?:^|[\s(\[])(?:[Ee]t\s+al|e\.g|i\.e|[Ff]ig|[Ee]q|[Rr]ef|\p{Lu})\.["')\]”’]*$/u;
/** A line that opens a heading or a list item (P10-42): a bullet, "1." or "2)", "iv.", "a)" / "(A)"-style letter marker, a
 *  numbered heading ("3.2 Annealing"), or a line set in capitals alone ("MATERIALS AND METHODS"). It starts a block of its
 *  own, so a cut sentence above it is not carried on into it. */
const HEADING_OR_LIST_OPENER =
  /^(?:[•▪◦‣●■–—*-]\s|(?:\d{1,2}|[ivx]{1,4})[.)]\s|\p{L}\)\s|[IVX]{2,4}\)\s|\d+(?:\.\d+)+\.?\s+\p{Lu}\p{Ll}{2,}|\p{Lu}[\p{Lu}\d-]+(?:\s+[\p{Lu}\d&,:-]+)+$)/u;

/**
 * P10-33 (BACKLOG-84), widened by P10-42 (X-A9): whether the block on the next page carries the paragraph `current`
 * began on. It does when `current` stops short of a sentence's end (no `. ? !`, a closing quote or bracket allowed,
 * an abbreviation's stop not counted), whatever the block opens with (a technique's name, a symbol, a number, a
 * capital), unless that line opens a heading or a list item. Two paragraphs that happen to meet at a page break (the
 * foot of one, the head of the next) stay two: the first ends its sentence.
 */
function continuesAcrossPage(current: string, next: string): boolean {
  const before = current.trim();
  return (!PAGE_END.test(before) || ABBREVIATION_END.test(before)) && !HEADING_OR_LIST_OPENER.test(next.trim());
}
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
  // A page's usual left edge: the 10th percentile of its line starts, not the
  // leftmost one, so a margin label or one hanging line does not make every
  // other line read as indented. Under ten lines that is the minimum: too few
  // to tell an outlier from an edge. C P12-76 (M8): the page's own, not the
  // section's. A page set at another origin (its text starts at x = -26 where
  // the others' start at 40) is more than the tenth that sets the quantile when
  // taken over the whole section, and every line of every other page then read
  // as an indent and began a paragraph.
  const startsOf = new Map<number, number[]>();
  for (const l of lines) {
    const xs = startsOf.get(l.page);
    if (xs) xs.push(l.x);
    else startsOf.set(l.page, [l.x]);
  }
  const leftOf = new Map<number, number>();
  for (const [page, xs] of startsOf) {
    xs.sort((a, b) => a - b);
    leftOf.set(page, xs[Math.floor(LEFT_EDGE_QUANTILE * (xs.length - 1))]);
  }

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
    // figure, a table, a box), not a paragraph, while the sentence above it is unfinished and the line
    // below goes on. P10-42 (X-A9): it goes on whatever it opens with (a capital too), unless it opens a
    // heading or a list item.
    const floatGap =
      bigGap && gap > pitch * FLOAT_GAP_PITCHES && current.trim() !== "" && !SENTENCE_END.test(current.trim()) && !HEADING_OR_LIST_OPENER.test(line.text.trim());
    const breaks =
      previous !== null &&
      !line.continues &&
      ((bigGap && !floatGap) ||
        (samePage && line.x > (leftOf.get(line.page) ?? 0) + 6) ||
        previous?.block === true ||
        (previous.page !== line.page && current.trim() !== "" && !continuesAcrossPage(current, line.text)));
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

/** P12-64: the size a line is read at for the title: the size most of its characters are set in. */
const titleSizeOf = (line: PdfLine): number => line.titleSize ?? line.size;

/** P12-64: a row of one or two letters is a drop cap standing alone on its baseline, never a title. */
const CAP_ROW = /^\p{L}{1,2}$/u;

/** The first page's lines set larger than the body, in classes of one size (`TITLE_SIZE_JOIN`), the largest first. */
interface TitleClass {
  size: number;
  lines: PdfLine[];
  text: string;
  /** The class's words as `titleWords` reads them. */
  words: string[];
  /** Where its highest line stands on the page. */
  top: number;
}

/** P12-64: a word, for the title's comparisons: letters and digits, lower case, accents and ligatures folded. */
const titleWords = (text: string): string[] =>
  text.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];

function titleClassesOf(candidates: PdfLine[]): TitleClass[] {
  const anchors: number[] = [];
  for (const size of [...new Set(candidates.map(titleSizeOf))].sort((a, b) => b - a)) {
    if (anchors.length === 0 || size < anchors[anchors.length - 1] - TITLE_SIZE_JOIN) anchors.push(size);
  }
  const classes = anchors.map((size): TitleClass => ({ size, lines: [], text: "", words: [], top: -Infinity }));
  for (const line of candidates) {
    const at = anchors.findIndex((anchor) => titleSizeOf(line) >= anchor - TITLE_SIZE_JOIN);
    classes[at].lines.push(line);
    classes[at].top = Math.max(classes[at].top, line.y);
  }
  for (const cls of classes) {
    cls.text = cls.lines.map((line) => line.text).join(" ").replace(/\s+/g, " ").trim();
    cls.words = titleWords(cls.text);
  }
  return classes.filter((cls) => !cls.lines.every((line) => CAP_ROW.test(line.text.trim())));
}

/** P12-64: an embedded title is a witness only when it has at least this many words. */
const WITNESS_MIN_WORDS = 3;
/** …and the longest, in characters, a title field may be and still be read (a field that holds an abstract is no title). */
const WITNESS_MAX_CHARS = 300;
/** A file name, or the name an authoring tool gives a document it has no title for. */
const FILE_NAME_TITLE =
  /\.(?:pdf|docx?|dotx?|tex|dvi|ps|eps|rtf|odt|indd|pages|pptx?|xlsx?|html?|xml|txt|tmp)\b|^(?:microsoft\s+(?:word|powerpoint|excel)\b|untitled\b|powerpoint presentation\b)|^\S+$|_.*_/i;
/** A size class counts for the first page's words in an embedded title when this share of its words is in it… */
const WITNESS_INSIDE = 0.8;
/** …and at least this many words are. */
const WITNESS_MIN_MATCHES = 2;
/** A masthead stands over a title set at least this share of its own size; a smaller line below it is the authors'. */
const MASTHEAD_TITLE_RATIO = 0.7;
/** A masthead of fewer words than this, above a title block, is a name (a journal's), not a title. */
const MASTHEAD_MAX_WORDS = 3;
/** A line of a running head sits in this many of the first or last rows of a page, as `bandOf` counts them. */
const HEAD_ROWS = 3;

/** The words of an embedded title, or null when it is no witness: under three words, a file name, a stamp, too long. */
function witnessWords(raw: string): Set<string> | null {
  const text = raw.replace(/\s+/g, " ").trim();
  if (text.length > WITNESS_MAX_CHARS || STAMP.test(text) || FILE_NAME_TITLE.test(text)) return null;
  const words = titleWords(text);
  return words.length >= WITNESS_MIN_WORDS ? new Set(words) : null;
}

/** The words of the lines that stand in the first or last rows of the pages after the first, joined one string per
 *  line and with the pages that carry each: what a running head says. */
function runningHeads(lines: PdfLine[]): Map<string, Set<number>> {
  const rows = new Map<number, number[]>();
  for (const { page, y } of lines) {
    if (page === 1) continue;
    const row = Math.round(y / 3);
    const known = rows.get(page);
    if (!known) rows.set(page, [row]);
    else if (!known.includes(row)) known.push(row);
  }
  for (const known of rows.values()) known.sort((a, b) => b - a);
  const heads = new Map<string, Set<number>>();
  for (const line of lines) {
    const known = rows.get(line.page);
    if (!known || line.text.length > 120) continue;
    const at = known.indexOf(Math.round(line.y / 3));
    if (at >= HEAD_ROWS && at < known.length - HEAD_ROWS) continue;
    const words = titleWords(line.text).join(" ");
    if (words) heads.set(words, (heads.get(words) ?? new Set<number>()).add(line.page));
  }
  return heads;
}

/**
 * The paper's title: the largest words on its first page, above the body.
 *
 * P12-64 (rule 1): "largest" is by the size most of a line's characters are set in (`titleSize`), not by its
 * tallest run, so one oversized letter (a drop cap) no longer lifts the body line it stands on; and a row of
 * one or two letters that stands alone is a drop cap, not a title.
 *
 * P12-64 (rule 2): the first page's lines fall into classes of one size, and the PDF's own title (`embedded`: the
 * Info and XMP titles `readPages` found) is a witness to choose among them by. A witness counts when it has three
 * words or more and is not a file name, a stamp, or the journal's name; the class chosen is the one most of whose
 * words are in it (80%, and two at least), the most words in it winning, the larger size a tie. The title returned is
 * the page's own text, never the embedded string. With no witness, or none that matches, it is the largest class
 * that is not a masthead. A masthead is a class above a title block (a class of three words or more, set at 70% of
 * its size or more) that is a line the running heads repeat (a journal's name stands on every page), or is under three
 * words and matches no witness (a name, not a title). A paper whose masthead is neither, with no embedded title, still
 * reads its masthead. Within the class a witness chose, only the lines most of whose words are in the witness are the
 * title (an article-type label set at the title's size is not).
 */
function titleOf(lines: PdfLine[], body: { size: number }, embedded: readonly string[] = []): string | null {
  const first = lines.filter((line) => line.page === 1 && titleSizeOf(line) > body.size * 1.25 && !STAMP.test(line.text));
  const classes = titleClassesOf(first);
  if (classes.length === 0) return null;

  let heads: Map<string, Set<number>> | null = null;
  const pageCount = lines.reduce((n, line) => Math.max(n, line.page), 1);
  const repeated = (cls: TitleClass): boolean => {
    if (cls.words.length === 0) return false;
    heads ??= runningHeads(lines);
    const needle = ` ${cls.words.join(" ")} `;
    const pages = new Set<number>();
    for (const [head, on] of heads) if (` ${head} `.includes(needle)) for (const page of on) pages.add(page);
    return pages.size >= 2 && pages.size >= (pageCount - 1) * 0.4;
  };
  /** Whether a class of three words or more, below `cls` and not smaller than a title would be, is the title block. */
  const standsOver = (cls: TitleClass): boolean =>
    classes.some(
      (c) => c !== cls && c.top < cls.top && c.words.length >= MASTHEAD_MAX_WORDS && c.size >= cls.size * MASTHEAD_TITLE_RATIO && !repeated(c),
    );
  const isMasthead = (cls: TitleClass, witnessed: boolean): boolean =>
    standsOver(cls) && (repeated(cls) || (!witnessed && cls.words.length < MASTHEAD_MAX_WORDS));

  const matched = new Set<TitleClass>();
  let best: { cls: TitleClass; inside: number; witness: Set<string> } | null = null;
  for (const raw of embedded) {
    const witness = witnessWords(raw);
    if (!witness) continue;
    for (const cls of classes) {
      const inside = cls.words.filter((word) => witness.has(word)).length;
      if (inside < WITNESS_MIN_MATCHES || inside < cls.words.length * WITNESS_INSIDE) continue;
      matched.add(cls);
      // A witness that names a masthead is the journal's name, not the paper's.
      if (isMasthead(cls, true)) continue;
      if (!best || inside > best.inside) best = { cls, inside, witness };
    }
  }

  if (best) {
    // The class's own lines that are in the witness: an article-type label set at the title's size is not the title.
    const { cls, witness } = best;
    const inWitness = cls.lines.filter((line) => {
      const words = titleWords(line.text);
      const n = words.filter((word) => witness.has(word)).length;
      return n > 0 && n >= words.length / 2;
    });
    const text = (inWitness.length > 0 ? inWitness : cls.lines).map((line) => line.text).join(" ").replace(/\s+/g, " ").trim();
    return text.length >= 6 ? text : null;
  }
  const chosen = classes.find((cls) => !isMasthead(cls, matched.has(cls))) ?? classes[0];
  return chosen.text.length >= 6 ? chosen.text : null;
}

// ── The opening of a paper that names no abstract or introduction (P12-51, O6) ────────────────────────────
//
// The paper starts at its first named part, and the cover above it is cut. A paper that names neither
// (a journal that prints a summary paragraph and goes straight on, with no heading over its introduction)
// had no such part to start at: the cover stayed, every name and affiliation read as a heading of its own,
// and the introduction fell under the last of them. Its prose is found by its style instead: the first
// run of lines set in the body's size and face. What stands above the run is the cover, and the run is the
// paper's opening, which the first heading after it closes as a section with no heading of its own.

/** A line is in the body's style when it is set in the body's face within this many points of its size. */
const OPENING_SIZE_SLACK = 0.6;
/** The opening is a run of at least this many such lines: a name, a date or a note is not one. */
const OPENING_RUN_LINES = 3;
/** A line of this many characters or fewer, between the opening's lines, is a drop cap or a mark, not a break. */
const OPENING_MARK_MAX = 2;
/** The lines above the opening that are all headings, at least this many, are a paragraph set apart (a
 *  summary in another face), not a heading with prose under it. */
const COVER_HEADING_STACK = 3;

/**
 * Where the paper's opening starts, as an index into `lines`, or 0 when there is nothing to cut: no run of
 * body-style lines on the first page that has text, no cover above it, or a real heading standing directly
 * over it (then the prose belongs to that heading, and the paper is read as it always was). Furniture,
 * margin print and the dated box are not lines here, as they are not in the reading itself.
 */
function openingStart(
  lines: PdfLine[],
  body: { size: number; font: string },
  furniture: Set<string>,
  isMarginPrint: (line: PdfLine) => boolean,
): number {
  const dated = lines.map((line) => PUBLICATION_DATE.test(line.text.trim()));
  const live: number[] = [];
  lines.forEach((line, i) => {
    const inBox = dated[i] && (dated[i - 1] === true || dated[i + 1] === true);
    if (!isFurniture(line, furniture) && !isMarginPrint(line) && !inBox) live.push(i);
  });
  if (live.length === 0) return 0;
  const firstPage = lines[live[0]].page;
  // P12-70 (ruling §1h.444): a line is set in the body's size when its tallest run is, or when the only taller part is a
  // drop cap (one or two large letters, welded to the body-sized words of the first line) and the size most of its
  // characters are set in is the body's.
  const bodySized = (line: PdfLine): boolean =>
    Math.abs(line.size - body.size) <= OPENING_SIZE_SLACK ||
    (isDropCap(line, body) && Math.abs(titleSizeOf(line) - body.size) <= OPENING_SIZE_SLACK);
  const isProse = (i: number): boolean => {
    const line = lines[i];
    return (
      line.page === firstPage &&
      !line.block &&
      line.font === body.font &&
      bodySized(line) &&
      !captionOf(line) &&
      headingOf(line, body) === null
    );
  };
  let at = -1;
  for (let k = 0; k < live.length && lines[live[k]].page === firstPage; k++) {
    if (!isProse(live[k])) continue;
    let end = k;
    while (end + 1 < live.length && isProse(live[end + 1])) end++;
    if (end - k + 1 >= OPENING_RUN_LINES) {
      at = k;
      break;
    }
    k = end;
  }
  if (at < 0) return 0;
  // A drop cap sits between the first lines of the opening and the rest; the lines before it are the opening's.
  while (at > 0 && (isProse(live[at - 1]) || lines[live[at - 1]].text.trim().length <= OPENING_MARK_MAX)) at--;
  if (at === 0) return 0;
  const above = lines[live[at - 1]];
  if (headingOf(above, body) !== null) {
    let stack = 0;
    for (let k = at - 1; k >= 0 && headingOf(lines[live[k]], body) !== null; k--) stack++;
    if (stack < COVER_HEADING_STACK) return 0;
  }
  return live[at];
}

// ── Figure text (P12-51, O8) ─────────────────────────────────────────────────────────────────────────────
//
// A figure's panels are text in the PDF: panel letters, tick strings, axis labels. They arrive as lines of
// a few characters, and the outline read them as the paper's prose, as rows of their own when one has the
// shape of a heading ("5 Min"), and as an equation when they stand close enough to fold. The text next to a
// figure's caption that is nothing else is dropped: three or more lines in a row, each short, unpunctuated
// and either free of any word of four letters or set smaller than the body. P12-97 (R-B): a line set smaller than
// the body may be up to 60 characters; at the body's size the limit stays 25.

/** A line of figure text is at most this many characters. */
const PANEL_LINE_MAX = 25;
/** P12-97 (R-B): a line set smaller than the body (`SMALLER_THAN_BODY`) is figure text up to this many characters. An
 *  axis title, a legend entry or a panel title is set small in the figure's own face and runs to a line of a sentence;
 *  at 25 it was no panel line, and it cut the tick strings on either side of it into runs too short to be figure text.
 *  At the body's size the limit stays `PANEL_LINE_MAX`: a body line of 26 to 60 characters is a line of prose. */
const PANEL_SMALL_LINE_MAX = 60;
/** Fewer lines in a row than this are not figure text: the short last line of a paragraph is one. */
const PANEL_RUN_MIN = 3;
/** Figure text is "next to" a caption within this many body sizes of it on the page. */
const PANEL_REACH = 8;
/** A line is set smaller than the body below this share of its size. */
const SMALLER_THAN_BODY = 0.95;

function isPanelLine(line: PdfLine, body: { size: number }): boolean {
  const text = line.text.trim();
  const small = line.size < body.size * SMALLER_THAN_BODY;
  if (line.block || text.length === 0 || text.length > (small ? PANEL_SMALL_LINE_MAX : PANEL_LINE_MAX)) return false;
  if (SENTENCE_END.test(text) || captionOf(line) || equationOf(line)) return false;
  return !/\p{L}{4,}/u.test(text) || small;
}

/**
 * The indices into `read` of the lines that are figure text. `skipped` marks the lines the reading leaves
 * out anyway (furniture, margin print, the dated box); a caption and the lines it runs on to (the reading's
 * own `continuesCaption`) are the caption's and never figure text.
 */
function figureTextOf(
  read: PdfLine[],
  skipped: boolean[],
  body: { size: number; font: string },
  pitch: number,
  furniture: Set<string>,
): Set<number> {
  const captions: PdfLine[] = [];
  const taken = new Set<number>();
  for (let i = 0; i < read.length; i++) {
    if (skipped[i] || !captionOf(read[i])) continue;
    captions.push(read[i]);
    taken.add(i);
    const end = captionEnd(read, i, pitch, body, furniture);
    while (i < end) taken.add(++i);
  }
  const figure = new Set<number>();
  if (captions.length === 0) return figure;
  const reach = body.size * PANEL_REACH;
  let run: number[] = [];
  const close = () => {
    if (run.length >= PANEL_RUN_MIN) {
      const page = read[run[0]].page;
      const beside = captions.some((c) => c.page === page && run.some((i) => Math.abs(c.y - read[i].y) <= reach));
      if (beside) for (const i of run) figure.add(i);
    }
    run = [];
  };
  for (let i = 0; i < read.length; i++) {
    if (skipped[i]) continue;
    if (taken.has(i) || !isPanelLine(read[i], body)) {
      close();
      continue;
    }
    if (run.length > 0 && read[run[0]].page !== read[i].page) close();
    run.push(i);
  }
  close();
  return figure;
}

/**
 * P12-75 (B P12-73, M2): the whole heading names a part of the argument. A heading that is one of these, has no number and
 * no text of its own, only sub-headings under it, is the part's group row ("Methods" in a paper that numbers nothing).
 * Only the whole heading counts: a descriptive heading that holds one of the words is not a part name.
 */
const PART_NAME =
  /^(?:(?:online|extended)\s+)?(?:(?:materials?|experimental)\s+(?:and|&)\s+)?(?:methods?|methodology|experimental(?:\s+(?:section|procedures?|details?|methods?|part))?)$|^results(?:\s+(?:and|&)\s+discussions?)?$|^discussions?$|^conclusions?$|^introduction$/i;
/** P12-75: a sub-heading is smaller than its part's heading by more than this many points. */
const GROUP_STEP = 0.3;

/**
 * The whole reading: pages of text items in, a document out. `reason` is set
 * — and everything else left empty — when the PDF carries no text to read.
 * `prior` is the paper's usual column gutter, which a page too sparse to show
 * one of its own is read with; it is found from `pages` unless the caller has
 * it already.
 */
export function buildOutline(pages: PdfPageText[], prior: Gutter | null = gutterPrior(pages)): PdfOutline {
  const drawn = pages.flatMap((page) => linesOfPageWith(page, prior));
  if (drawn.length === 0 || drawn.reduce((n, l) => n + l.text.length, 0) < 200) {
    return { pageCount: pages.length, reason: "no-text-layer" };
  }
  const body = bodyStyle(drawn);
  // P12-70 (§1h.445): the capital of a drop cap that spans several lines goes to the start of the paragraph's first line.
  const lines = placeDropCaps(drawn, body);
  const furniture = furnitureOf(lines, pages.length);
  const title = titleOf(lines, body, pages[0]?.embeddedTitles);
  // P9-09: the paper's own words, read once from every line, decide each hyphen a line ends in.
  const vocab = vocabularyOf(lines);

  // A first page opens with names, affiliations and a preprint stamp — set
  // in their own sizes, so every one of them reads as a heading. The paper
  // starts at its first named part; anything above that is the cover.
  const firstNamed = lines.findIndex((line) => {
    const head = headingOf(line, body);
    return head !== null && FRONT_MATTER_END.has(canonicalizeHeading(head));
  });
  const isMarginPrint = marginPrintOf(lines, body);
  // P12-51 (O6): a paper that names neither starts at its opening, found by its style; what stands above
  // it is the cover. The opening is read as text before the first heading, a section with no heading.
  const start = firstNamed > 0 ? firstNamed : firstNamed < 0 ? openingStart(lines, body, furniture, isMarginPrint) : 0;
  const read = start > 0 ? lines.slice(start) : lines;

  const sections: OutlineSection[] = [];
  const figureCaptions: OutlineCaption[] = [];
  const equations: OutlineEquation[] = [];
  let heading: string | null = null;
  let canonical = "body";
  let page = (firstNamed < 0 && start > 0 ? read[0]?.page : undefined) ?? pages[0]?.page ?? 1;
  let held: PdfLine[] = [];
  // P12-51 (O5): the first end-matter heading closes the argument (`tail`); what the lines under a heading
  // are is read by what the heading names (`tailPartOf`), and they are read (`reading`) or not. P12-62: the
  // first end-matter heading is named the same way, as a note, the references or an appendix. `resumed`: the
  // current stretch is a part of the argument, whose sub-headings are read; `opensTail`: the heading that
  // closed the argument, which stays closed when a wrapped second line joins it (and is named again by the
  // joined words); `appendix`: an appendix has begun (P12-62: the first end-matter heading may be one), and
  // no heading after it opens a part of the argument again.
  let tail = false;
  let reading = true;
  let resumed = false;
  let opensTail = false;
  let appendix = false;
  // P12-75 (M2): the part an unnumbered, empty named heading opens ("Methods", then at once its first sub-heading): the
  // bucket it gives and the size its heading was set in. The unnumbered headings that follow it, set smaller, are its
  // sub-headings and take the bucket (as numbered ones take their parent's); a heading as large, a numbered one or one
  // that names a structural bucket (limitations, references, acknowledgments, supplementary, abstract) ends it.
  let group: { canonical: string; size: number } | null = null;
  let headingSize = 0;

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
    let level: 1 | 2 | undefined;
    // P12-75 (item 2, §1h.452): a heading whose own words are a part name starts a part, whatever its size; it is never
    // a sub-heading of the part before it ("Discussion" set smaller than an empty "Results" is not a results child).
    const partName = heading !== null && PART_NAME.test(heading.replace(GLYPH_LEAD, "").trim());
    if (heading === null || headingNumber(heading) !== null) {
      group = null;
    } else if (group !== null && !partName && !STRONG_BUCKETS.has(canonical) && headingSize < group.size - GROUP_STEP) {
      canonical = group.canonical;
      level = 2;
    } else {
      group = null;
      if (text.trim().length === 0 && reading && headingSize > 0 && partName) {
        group = { canonical, size: headingSize };
        level = 1;
      }
    }
    if (text.trim().length > 0) {
      sections.push({ heading: heading ?? undefined, canonical, page, text, ...(level === 2 ? { level } : {}) });
    } else if (heading !== null && reading && level === 1) {
      // P12-75: the group row, with no words. `dropStrayHeadings` keeps it only when a sub-heading with text follows.
      sections.push({ heading, canonical, page, text: "", level });
    } else if (heading !== null && reading && headingNumber(heading) !== null) {
      // P10-04 (review 3.3): a numbered heading with nothing under it may be the paper's own group
      // heading ("2. RESULTS AND DISCUSSION", then "2.1 …"). Kept here with empty text; `dropStrayHeadings`
      // below keeps it if the next section's number is its child, and drops it (a stray) if not. Never one
      // whose text is not read (the references, the first end-matter heading).
      sections.push({ heading, canonical, page, text: "" });
    }
    held = [];
  };

  // The line pitch across the paper — the gap between consecutive lines of
  // one block — so a caption's second line can be told from the prose that
  // resumes under the figure by the space above it.
  const pitch = linePitch(read);
  // The Received / Revised / Accepted / Published box: two or more consecutive
  // lines that each open with one of those words and a date are the journal's
  // furniture, wherever they stand (on the owner's paper, inside the
  // Introduction). One such line is a sentence or a note, and stays.
  const dated = read.map((line) => PUBLICATION_DATE.test(line.text.trim()));
  const inDateBox = (i: number) => dated[i] && (dated[i - 1] === true || dated[i + 1] === true);
  // P12-51 (O8): the text of a figure's panels is the figure's, not a section's: out of the prose and never a heading.
  const skipped = read.map((line, i) => isFurniture(line, furniture) || isMarginPrint(line) || inDateBox(i));
  const figureText = figureTextOf(read, skipped, body, pitch, furniture);
  // P7-18 (F2): where the body's last numbered section stands. A heading that is end matter only
  // after the body ("Funding": some templates print it on page 1, under the abstract) ends the
  // argument only past this line; a paper with no numbered section has no such line, and there
  // those headings stay sections, as they were.
  let lastNumbered = -1;
  for (let i = read.length - 1; i >= 0 && lastNumbered < 0; i--) {
    const line = read[i];
    if (skipped[i] || figureText.has(i)) continue;
    const head = headingOf(line, body);
    // A numbered end-matter heading ("6. Funding", "7. Acknowledgements") is not the body's.
    if (head && sectionNumberOf(head) && !endsTheArgument(head, canonicalizeHeading(head), true)) lastNumbered = i;
  }
  let lastHeading: PdfLine | null = null;

  for (let i = 0; i < read.length; i++) {
    const line = read[i];
    if (skipped[i] || figureText.has(i)) continue;
    const caption = captionAt(read, i, pitch, body, furniture, (j) => skipped[j] || figureText.has(j));
    if (caption) {
      // A caption belongs to the figure pool, not to the prose it interrupts.
      // It is as many lines as it was printed on: the lines under it at the
      // line pitch, in its own size, until the gap opens or the prose's size
      // returns. The old reading took the first line and stopped, and a
      // caption arrived as "Medical image analysis pipeline showing
      // preprocessing," — a clause with its sentence cut off.
      const end = captionEnd(read, i, pitch, body, furniture);
      const rest = read.slice(i + 1, end + 1).map((l) => l.text.trim());
      i = end;
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
        headingSize = line.size;
        page = line.page;
        opensTail = false;
      }
      lastHeading = line;
      canonical = canonicalizeHeading(heading);
      // The argument ends at the references, the acknowledgements or an
      // appendix, or at the end matter a journal prints after it (associated
      // content, author information, data availability, funding past the
      // body ...); what follows is apparatus. P12-51 (O5): the first of them
      // closes the argument and the outline reads on; a heading after it that
      // names an argument part or another end-matter part opens a section of
      // its own. P12-62: so does the first of them, as a note: a data
      // statement, the acknowledgements, a supporting-information line open
      // their sections and their text is read; the references, and an appendix
      // (the bulky apparatus), stay out as they do later.
      const ends = endsTheArgument(heading, canonical, lastNumbered >= 0 && i > lastNumbered);
      if (!tail && ends) {
        tail = true;
        opensTail = true;
      }
      if (tail) {
        // The heading that closed the argument ends it by definition, and is named like the ones after it.
        let part = tailPartOf(heading, canonical, opensTail || ends);
        if (part === "appendix") appendix = true;
        else if (part === "argument" && appendix) part = null;
        if (part !== null) {
          reading = part === "note" || part === "argument";
          resumed = part === "argument";
        } else {
          reading = resumed;
        }
        // An end-matter part no bucket names ("Associated content") is the apparatus bucket's, as its notes are.
        if (part === "note" && canonical === "body") canonical = "acknowledgments";
      }
      continue;
    }
    lastHeading = null;
    if (!reading) continue;
    if (title && line.page === 1 && titleSizeOf(line) > body.size * 1.25) continue;
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

  const kept = dropStrayHeadings(sections);
  return {
    title,
    sections: kept,
    figureCaptions,
    ...(equations.length > 0 ? { equations } : {}),
    pageCount: pages.length,
    reason: kept.length === 0 ? "no-sections" : null,
  };
}

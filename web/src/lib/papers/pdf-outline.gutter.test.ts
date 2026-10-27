// P12-50 (B P12-40 O2): the columns of a journal paper whose gutter is narrow, and the gutter the paper's
// other pages stand on.
//
// Rule 1 — a clear band down to 1 em is a gutter when it lies in the middle third of the text's width and is
// clear over at least 8 rows; elsewhere the 2 em rule stands. A paper set at 9.3pt with an 11pt gutter (1.2 em)
// had no gutter on any page, so each page's two columns were read welded at one height: a heading welded to
// the other column's line, the first paragraphs welded.
//
// Every page here is invented: runs placed by the test (`PdfTextItem`), or a PDF built by `minimalPdf`.
import { describe, expect, it } from "vitest";
import { minimalPdf, type Run } from "./minimal-pdf.test-helper";
import { gutterOf, linesOfPage, type PdfTextItem } from "./pdf-outline";
import { extractPdfTextFromBytes, readPages } from "./pdf-text";

const BODY = 9.3;
/** The narrowest gutter the 2 em rule finds, in ems. */
const WIDE_EM = 2;

const item = (str: string, at: Partial<PdfTextItem>): PdfTextItem => ({ str, height: BODY, width: str.length * 5, fontName: "body", x: 0, y: 0, ...at });
/** A line of 48 characters: it fills whatever width the run is given. */
const filled = (label: string) => `${label} ${"lorem ipsum ".repeat(5)}`.slice(0, 48);

/** Where a page's columns stand: the left column from `left` to `a`, the right from `b` to `right`. */
interface Layout {
  left: number;
  a: number;
  b: number;
  right: number;
  /** The text height of the page. */
  body?: number;
}
/** An 11pt gutter at a 9.3pt body (1.18 em): the column of 240pt each, 50→290 and 301→541. */
const NARROW: Layout = { left: 50, a: 290, b: 301, right: 541 };
/** The same page set with a gutter of 24pt (2.6 em). */
const WIDE: Layout = { left: 50, a: 290, b: 314, right: 554 };
/** A layout whose right column starts at `b`, with a gutter `gap` wide. */
const gutterAt = (b: number, gap: number): Layout => ({ left: 50, a: b - gap, b, right: b + 240 });

type RowKind = "pair" | "full";
const label = (side: "L" | "R" | "F", tag: string, n: number) => `${side}${tag}${String(n + 1).padStart(2, "0")}`;

/** Rows from `top`, one pitch apart: a "pair" is a line of each column at one height, a "full" a line across both. */
function page(kinds: RowKind[], at: Layout, tag = "", top = 700): PdfTextItem[] {
  const body = at.body ?? BODY;
  return kinds.flatMap((kind, n): PdfTextItem[] => {
    const y = top - n * body * 1.24;
    if (kind === "full") return [item(filled(label("F", tag, n)), { x: at.left, y, width: at.right - at.left, height: body })];
    return [
      item(filled(label("L", tag, n)), { x: at.left, y, width: at.a - at.left, height: body }),
      item(filled(label("R", tag, n)), { x: at.b, y, width: at.right - at.b, height: body }),
    ];
  });
}
const columns = (rows: number, at: Layout = NARROW, tag = "") => page(Array<RowKind>(rows).fill("pair"), at, tag);
const labels = (lines: { text: string }[]) => lines.map((l) => l.text.split(" ")[0]);
const sequence = (side: "L" | "R", from: number, to: number, tag = "") =>
  Array.from({ length: to - from + 1 }, (_, n) => label(side, tag, from + n));

// ── Rule 1 ───────────────────────────────────────────────────────────────────────────────────────

describe("a gutter of 1 em in the middle of the text is a gutter (P12-50, rule 1)", () => {
  it("finds an 11pt gutter at a 9.3pt body: 1.2 em, where the 2 em rule found none", () => {
    expect((NARROW.b - NARROW.a) / BODY).toBeLessThan(WIDE_EM);
    expect(gutterOf(columns(20), BODY)).toEqual({ a: 290, b: 301 });
  });

  it("reads such a page column by column, not each pair of lines welded at one height", () => {
    const lines = linesOfPage({ page: 1, items: columns(20) });
    expect(lines).toHaveLength(40);
    expect(labels(lines)).toEqual([...sequence("L", 0, 19), ...sequence("R", 0, 19)]);
    for (const line of lines) expect(line.text.match(/[LR]\d\d/g), line.text).toHaveLength(1);
  });

  it("does not weld a heading in the right column to the left column's line at its height", () => {
    const items = columns(20);
    // the right column's ninth line is a heading; the left column's ninth line stands at its height
    const y = items.find((i) => i.str.startsWith("R09"))!.y;
    const heading = item("2 Experimental methods", { x: NARROW.b, y, width: 110 });
    const lines = linesOfPage({ page: 1, items: [...items.filter((i) => !(i.x === NARROW.b && i.y === y)), heading] }).map((l) => l.text);
    expect(lines).toContain("2 Experimental methods");
    expect(lines.filter((text) => text.startsWith("L09"))).toEqual([filled("L09")]);
  });

  it("lets a full-width line stand where it is between the bands above and below it", () => {
    const kinds: RowKind[] = [...Array<RowKind>(9).fill("pair"), "full", ...Array<RowKind>(10).fill("pair")];
    const lines = linesOfPage({ page: 1, items: page(kinds, NARROW) });
    expect(labels(lines)).toEqual([
      ...sequence("L", 0, 8),
      ...sequence("R", 0, 8),
      "F10",
      ...sequence("L", 10, 19),
      ...sequence("R", 10, 19),
    ]);
  });

  it("finds a gutter a little over 1 em wherever a one-point slide would fall, and none under 1 em", () => {
    const gutter = (gap: number): Layout => ({ left: 50, a: 300, b: 300 + gap, right: 540 + gap });
    for (const gap of [9.5, 9.8, 10.1, 10.45]) {
      expect(gutterOf(columns(20, gutter(gap)), BODY), `${gap}pt`).toEqual({ a: 300, b: 300 + gap });
    }
    // 0.95 em and 0.9 em: narrower than the narrowest gutter
    for (const gap of [8.8, 8.4]) expect(gutterOf(columns(20, gutter(gap)), BODY), `${gap}pt`).toBeNull();
  });

  it("keeps a wide gutter exactly as the 2 em rule found it", () => {
    expect(gutterOf(columns(20, WIDE), BODY)).toEqual({ a: 290, b: 314 });
    expect(gutterOf(columns(20, gutterAt(320, 20)), BODY)).toEqual({ a: 300, b: 320 });
  });
});

describe("elsewhere the 2 em rule stands, and a narrow gap that is not a column is no gutter (P12-50, rule 1)", () => {
  it("wants the narrow gutter's centre in the middle third of the text's width", () => {
    // 50→205 | 215→541: the gap's centre is at 32.6% of the text's width, a third of it or a little less
    const outside: Layout = { left: 50, a: 205, b: 215, right: 541 };
    expect(gutterOf(columns(20, outside), BODY)).toBeNull();
    // 50→222 | 232→541: 36.0%
    const inside: Layout = { left: 50, a: 222, b: 232, right: 541 };
    expect(gutterOf(columns(20, inside), BODY)).toEqual({ a: 222, b: 232 });
    // the mirror image of the first
    const mirrored: Layout = { left: 50, a: 376, b: 386, right: 541 };
    expect(gutterOf(columns(20, mirrored), BODY)).toBeNull();
  });

  it("is not made by a centred 10pt gap over 4 rows of a single-column page", () => {
    const kinds = (gapRows: number[]) => Array.from({ length: 20 }, (_, n): RowKind => (gapRows.includes(n) ? "pair" : "full"));
    const single: Layout = { left: 50, a: 290, b: 300, right: 540 };
    const four = page(kinds([8, 9, 10, 11]), single);
    expect(gutterOf(four, BODY)).toBeNull();
    expect(linesOfPage({ page: 1, items: four })).toHaveLength(20);
  });

  it("wants 8 consecutive rows: 7 are not enough, 4 and 4 either side of a line across are not, 8 are", () => {
    const single: Layout = { left: 50, a: 290, b: 300, right: 540 };
    const at = (...gapRows: number[]) => page(Array.from({ length: 20 }, (_, n): RowKind => (gapRows.includes(n) ? "pair" : "full")), single);
    const run = (from: number, count: number) => Array.from({ length: count }, (_, n) => from + n);
    expect(gutterOf(at(...run(6, 7)), BODY)).toBeNull();
    expect(gutterOf(at(...run(4, 4), ...run(9, 4)), BODY)).toBeNull();
    expect(gutterOf(at(...run(6, 8)), BODY)).toEqual({ a: 290, b: 300 });
  });

  it("is not made by a display equation's spacing: lines of three runs, a narrow gap in each", () => {
    const equation = (y: number): PdfTextItem[] => [
      item("a", { x: 190, y, width: 12 }),
      item("= b + c", { x: 212, y, width: 70 }),
      item("(1)", { x: 292, y, width: 16 }),
    ];
    const rows = Array.from({ length: 20 }, (_, n) => (n >= 8 && n < 12 ? equation(700 - n * 11.5) : page(["full"], { left: 50, a: 290, b: 300, right: 540 }, "", 700 - n * 11.5)));
    expect(gutterOf(rows.flat(), BODY)).toBeNull();
  });

  it("is not made by a table's short cells with a narrow gap, however many rows it has", () => {
    const table = Array.from({ length: 12 }, (_, n) => [
      item("0.25", { x: 250, y: 600 - n * 11.5, width: 40 }),
      item("0.31", { x: 300, y: 600 - n * 11.5, width: 40 }),
    ]).flat();
    const prose = page(Array<RowKind>(8).fill("full"), { left: 50, a: 290, b: 300, right: 540 }, "", 700);
    const after = page(Array<RowKind>(8).fill("full"), { left: 50, a: 290, b: 300, right: 540 }, "", 600 - 12 * 11.5 - 11.5);
    expect(gutterOf([...prose, ...table, ...after], BODY)).toBeNull();
  });

  it("is not made by the narrow gap between two columns of a page that has too few rows", () => {
    expect(gutterOf(columns(12), BODY)).toBeNull();
  });
});

// ── Rule 1, through a real PDF ──────────────────────────────────────────────────────────────────

const LEFT_X = 50;
const LINE_WORDS = "alpha bravo charlie delta echo foxtrot golf";
/** Every line of a column is as wide as its neighbours: a digit is as wide as another in Helvetica. */
const lineText = (page: number, side: "L" | "R", n: number, word = "") =>
  `P${page}${side}${String(n + 1).padStart(2, "0")} ${LINE_WORDS}${word && ` ${word}`}`;
const MENTION = /P([1-9])([LR])(\d\d)/g;
const mentionsOf = (text: string) => [...text.matchAll(MENTION)].map((m) => `P${m[1]}${m[2]}${m[3]}`);
const tokens = (page: number, side: "L" | "R", from: number, to: number) =>
  Array.from({ length: to - from + 1 }, (_, n) => `P${page}${side}${String(from + n + 1).padStart(2, "0")}`);
const HEADING = "1 Introduction and Background to Reading in Columns";
const SECOND = "2 Experimental methods";

/** The page's two columns at 9.3pt: `rows` lines each, the right column's first line at `b`; page 1 opens with a heading across both. */
function pdfPage(page: number, rows: number, b: number, word = ""): Run[] {
  const left = Array.from({ length: rows }, (_, i): Run => [lineText(page, "L", i, word), LEFT_X, 110 + i * 11.5, BODY]);
  const right = Array.from({ length: rows }, (_, i): Run => [lineText(page, "R", i, word), b, 110 + i * 11.5, BODY]);
  return [...(page === 1 ? [[HEADING, LEFT_X, 80, 12, true] as Run] : []), ...left, ...right];
}

describe("a two-column PDF set with an 11pt gutter at 9.3pt is read in columns (P12-50, rule 1)", () => {
  // Where the left column ends is what pdf.js says it is; the right column starts 11pt (1.18 em) after.
  async function narrowBytes(): Promise<{ bytes: Buffer; a: number }> {
    const probe = await readPages(minimalPdf([[[lineText(1, "L", 0), LEFT_X, 110, BODY]]]));
    const a = Math.max(...probe[0].items.filter((i) => i.str.trim()).map((i) => i.x + i.width));
    const b = a + 11;
    const heading: Run = [SECOND, b, 110 + 9 * 11.5, 11.5, true];
    const page1 = pdfPage(1, 24, b).filter((r) => !(r[1] === b && r[2] === heading[2]));
    return { bytes: minimalPdf([[...page1, heading], pdfPage(2, 24, b)]), a };
  }

  it("has a gutter 1.2 em wide", async () => {
    const { bytes, a } = await narrowBytes();
    const pages = await readPages(bytes);
    const gutter = gutterOf(pages[1].items.filter((i) => i.str), BODY);
    expect(gutter?.a).toBeCloseTo(a, 1);
    expect(gutter!.b - gutter!.a).toBeCloseTo(11, 1);
  });

  it("reads each page's left column before its right, and every printed line once", async () => {
    const { bytes } = await narrowBytes();
    const result = await extractPdfTextFromBytes(bytes);
    expect(result.ok).toBe(true);
    const text = (result.doc?.sections ?? []).map((s) => `${s.heading}\n${s.text}`).join("\n\n");
    expect(mentionsOf(text)).toEqual([
      ...[1, 2].flatMap((page) => [...tokens(page, "L", 0, 23), ...tokens(page, "R", 0, 23)]).filter((t) => t !== "P1R10"),
    ]);
  });

  it("finds the heading in the right column as a heading, not welded to the left column's line at its height", async () => {
    const { bytes } = await narrowBytes();
    const result = await extractPdfTextFromBytes(bytes);
    expect(result.doc?.sections.map((s) => [s.heading, s.page])).toEqual([[HEADING, 1], [SECOND, 1]]);
  });
});

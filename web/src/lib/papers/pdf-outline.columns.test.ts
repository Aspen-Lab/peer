// P7-10 (the owner's R8, core): a two-column journal paper is read column by
// column. `linesOfPage` used to gather every run whose baseline lay within
// 2.2pt of a row into one line across the whole page, so the two columns'
// lines were welded into one (baselines shared) or interleaved by height
// (baselines a few points apart), and the 24pt gutter became a single space.
//
// The fixture is a real PDF (`minimalPdf`, read by pdf.js like a paper): two
// pages of two 24-line columns, the left at x=50 and the right at x=320 on a
// 595pt page (a 24pt gutter), a heading across both columns above them on
// page 1, and page 2's right column set 5pt off the left's baselines, the way
// a paper's columns drift when one of them opens with a heading block. Every
// line starts with its own token — P1L07 is page 1, left column, line 7 — so
// the order the extractor reads them in can be counted.
import { describe, expect, it } from "vitest";
import { minimalPdf, type Run } from "./minimal-pdf.test-helper";
import { gutterOf, gutterPrior, linesOfPage, linesOfPageWith, type PdfPageText, type PdfTextItem } from "./pdf-outline";
import { extractPdfTextFromBytes, readPages } from "./pdf-text";

const WORDS = ["alpha", "bravo", "charlie", "delta", "echo", "foxtrot", "golf", "hotel", "india", "juliet", "kilo", "lima"];
const LEFT_X = 50;
const RIGHT_X = 320;
const HEADING = "1 Introduction and Background to Reading in Columns";

type Side = "L" | "R";
const token = (page: number, side: Side, n: number) => `P${page}${side}${String(n + 1).padStart(2, "0")}`;

/** One printed line of a column: its token, then words to fill the column's width (about 46–49 characters at 10pt). */
function columnLine(page: number, side: Side, n: number): string {
  let text = token(page, side, n);
  const room = 46 + ((n * 7) % 4);
  for (let k = 0; ; k++) {
    const word = WORDS[(n * 5 + page * 3 + k) % WORDS.length];
    if (text.length + 1 + word.length > room) return text;
    text += ` ${word}`;
  }
}

/** A page of two columns of `rows` lines. `drift` sets the right column's baselines that many points off the left's. */
function twoColumnPage(page: number, rows: number, drift: number, order: "columns" | "rows"): Run[] {
  const left = Array.from({ length: rows }, (_, i): Run => [columnLine(page, "L", i), LEFT_X, 110 + i * 14, 10]);
  const right = Array.from({ length: rows }, (_, i): Run => [columnLine(page, "R", i), RIGHT_X, 110 + i * 14 + drift, 10]);
  const runs = order === "columns" ? [...left, ...right] : left.flatMap((run, i) => [run, right[i]]);
  // Across both columns: the heading's run is wider than the left column, so it crosses the gutter.
  return page === 1 ? [[HEADING, LEFT_X, 80, 12, true], ...runs] : runs;
}

const MENTION = /P([123])([LR])(\d\d)/g;
const mentionsOf = (text: string) => [...text.matchAll(MENTION)].map((m) => ({ page: Number(m[1]), side: m[2] as Side, n: Number(m[3]) }));
const tokensIn = (text: string) => text.match(MENTION) ?? [];
const range = (n: number) => Array.from({ length: n }, (_, i) => i);

describe.each([
  ["column by column", "columns"],
  ["row by row", "rows"],
] as const)("a two-column paper whose file stores its text %s (P7-10)", (_name, order) => {
  const bytes = minimalPdf([twoColumnPage(1, 24, 0, order), twoColumnPage(2, 24, 5, order)]);

  it("reads each page's left column before its right column: one side switch per page, in line order", async () => {
    const result = await extractPdfTextFromBytes(bytes);
    expect(result.ok).toBe(true);
    const text = (result.doc?.sections ?? []).map((s) => s.text).join("\n\n");
    const mentions = mentionsOf(text);

    expect(mentions).toHaveLength(96);
    for (const page of [1, 2]) {
      const onPage = mentions.filter((m) => m.page === page);
      const switches = onPage.filter((m, i) => i > 0 && m.side !== onPage[i - 1].side).length;
      expect(switches, `page ${page}: side switches`).toBe(1);
    }
    expect(mentions.map((m) => token(m.page, m.side, m.n - 1))).toEqual(
      [1, 2].flatMap((page) => (["L", "R"] as const).flatMap((side) => range(24).map((n) => token(page, side, n)))),
    );
  });

  it("keeps the heading that crosses both columns as a section of its own", async () => {
    const result = await extractPdfTextFromBytes(bytes);
    expect(result.doc?.sections.map((s) => [s.heading, s.canonical, s.page])).toEqual([[HEADING, "introduction", 1]]);
  });

  it("never joins a line of one column to a line of the other, and reads each printed line once", async () => {
    const lines = (await readPages(bytes)).flatMap(linesOfPage);
    const printed = lines.filter((line) => tokensIn(line.text).length > 0);
    expect(printed).toHaveLength(96);
    for (const line of printed) expect(tokensIn(line.text), line.text).toHaveLength(1);
  });

  it("reads the right column's lines as the column's own, not as indents: one paragraph, as printed", async () => {
    const result = await extractPdfTextFromBytes(bytes);
    const body = result.doc?.sections[0].text ?? "";
    expect(body.split("\n\n")).toHaveLength(1);
  });

  it("hands the upload route page 1's text in the same order", async () => {
    const result = await extractPdfTextFromBytes(bytes);
    const mentions = mentionsOf(result.page1Text ?? "");
    expect(mentions.map((m) => token(m.page, m.side, m.n - 1))).toEqual(
      (["L", "R"] as const).flatMap((side) => range(24).map((n) => token(1, side, n))),
    );
  });
});

// ── The same, one level down: runs of text with a position, as pdf.js hands them over ──

const run = (str: string, at: Partial<PdfTextItem>): PdfTextItem => ({ str, height: 10, width: str.length * 5, fontName: "body", x: 0, y: 0, ...at });
/** A line that fills its column: 48 characters at 5pt a character, 240pt. */
const fill = (label: string) => `${label} ${"lorem ipsum ".repeat(5)}`.slice(0, 48);
const LEFT = { x: 50, edge: 290 };
const RIGHT = { x: 314, edge: 554 };
/** `rows` lines of each of two columns — the left 50→290, the right 314→554, a 24pt gutter — from `top`, 12pt apart. */
function columns(rows: number, tag = "", top = 700, from = 0): PdfTextItem[] {
  const at = (n: number) => top - (from + n) * 12;
  return Array.from({ length: rows }, (_, n) => [
    run(fill(`L${tag}${String(from + n + 1).padStart(2, "0")}`), { x: LEFT.x, y: at(n) }),
    run(fill(`R${tag}${String(from + n + 1).padStart(2, "0")}`), { x: RIGHT.x, y: at(n) }),
  ]).flat();
}
const labels = (lines: { text: string }[]) => lines.map((l) => l.text.split(" ")[0]);

describe("the gutter of a page set in two columns (P7-10)", () => {
  it("finds where the left column ends and the right begins", () => {
    expect(gutterOf(columns(20), 10)).toEqual({ a: LEFT.edge, b: RIGHT.x });
  });

  it("finds none on a page of running text across its whole width", () => {
    const page = Array.from({ length: 20 }, (_, n) => run(fill("x").repeat(2).slice(0, 100), { x: 50, y: 700 - n * 12 }));
    expect(gutterOf(page, 10)).toBeNull();
  });

  it("wants a run of lines: too few rows on the page, or too few on one side, is not a column", () => {
    expect(gutterOf(columns(12), 10)).toBeNull();
    // twenty lines on the left, six on the right
    const lopsided = [...columns(20).filter((i) => i.x === LEFT.x), ...columns(6).filter((i) => i.x === RIGHT.x)];
    expect(gutterOf(lopsided, 10)).toBeNull();
  });

  it("does not take a table's cells for columns, or short lines for prose", () => {
    const cells = Array.from({ length: 20 }, (_, n) => [50, 250, 450].map((x) => run("cell 1", { x, y: 700 - n * 12 }))).flat();
    expect(gutterOf(cells, 10)).toBeNull();
    // a left side of short lines with a few long ones: the median line does not fill the column
    const short = columns(20).map((i) => (i.x === LEFT.x && Math.round((700 - i.y) / 12) >= 4 ? { ...i, width: 60 } : i));
    expect(gutterOf(short, 10)).toBeNull();
  });
});

describe("reading order on a page set in two columns (P7-10)", () => {
  it("reads the left column to its end, then the right, whatever the file's own order", () => {
    const items = columns(20);
    for (const ordered of [items, [...items].reverse()]) {
      const lines = linesOfPage({ page: 1, items: ordered });
      expect(labels(lines)).toEqual([
        ...Array.from({ length: 20 }, (_, n) => `L${String(n + 1).padStart(2, "0")}`),
        ...Array.from({ length: 20 }, (_, n) => `R${String(n + 1).padStart(2, "0")}`),
      ]);
    }
  });

  it("does not interleave two columns whose baselines drift apart, or weld two whose baselines agree", () => {
    const drifting = columns(20).map((i) => (i.x === RIGHT.x ? { ...i, y: i.y - 5 } : i));
    for (const items of [columns(20), drifting]) {
      const lines = linesOfPage({ page: 1, items });
      expect(lines).toHaveLength(40);
      expect(labels(lines).slice(0, 20).every((l) => l.startsWith("L"))).toBe(true);
      expect(labels(lines).slice(20).every((l) => l.startsWith("R"))).toBe(true);
    }
  });

  it("lets a full-width line stand where it is, between the band above it and the band below", () => {
    const caption = run(`Figure 1: ${fill("a caption across both columns").repeat(2)}`.slice(0, 100), { x: 50, y: 700 - 10 * 12 });
    const items = [...columns(10, "a"), caption, ...columns(10, "b", 700, 11)];
    const lines = linesOfPage({ page: 1, items });
    expect(labels(lines)).toEqual([
      ...Array.from({ length: 10 }, (_, n) => `La${String(n + 1).padStart(2, "0")}`),
      ...Array.from({ length: 10 }, (_, n) => `Ra${String(n + 1).padStart(2, "0")}`),
      "Figure",
      ...Array.from({ length: 10 }, (_, n) => `Lb${String(n + 12).padStart(2, "0")}`),
      ...Array.from({ length: 10 }, (_, n) => `Rb${String(n + 12).padStart(2, "0")}`),
    ]);
  });

  it("keeps a word that overhangs the gutter with the column it starts in", () => {
    // the left column's tenth line runs 8pt on into the gutter, still a word space short of the right column
    const items = columns(20).map((i) => (i.x === LEFT.x && i.y === 700 - 9 * 12 ? { ...i, width: LEFT.edge - LEFT.x + 8 } : i));
    const lines = linesOfPage({ page: 1, items });
    expect(lines).toHaveLength(40);
    expect(labels(lines).slice(0, 20).every((l) => l.startsWith("L"))).toBe(true);
    expect(labels(lines)[9]).toBe("L10");
  });

  it("gives the right column's lines the left column's indent, so prose is not broken into paragraphs by a column", () => {
    const lines = linesOfPage({ page: 1, items: columns(20) });
    expect(lines).toHaveLength(40);
    expect(new Set(lines.map((l) => l.x))).toEqual(new Set([LEFT.x]));
  });
});

describe("the paper's gutter stands in for a page that shows none (P7-10)", () => {
  const page = (n: number, items: PdfTextItem[]): PdfPageText => ({ page: n, items });
  const full = (n: number) => page(n, columns(20, String(n)));
  const sparse = page(1, columns(6));

  it("is the gutter two pages or more agree on", () => {
    expect(gutterPrior([sparse, full(2), full(3)])).toEqual({ a: LEFT.edge, b: RIGHT.x });
    expect(gutterPrior([sparse, full(2)])).toBeNull();
    expect(gutterPrior([sparse])).toBeNull();
  });

  it("reads a page of too few lines in columns with it, and row by row without it", () => {
    const prior = gutterPrior([sparse, full(2), full(3)]);
    expect(labels(linesOfPageWith(sparse, prior))).toEqual(["L01", "L02", "L03", "L04", "L05", "L06", "R01", "R02", "R03", "R04", "R05", "R06"]);
    // alone, the page cannot tell: its rows are two columns' lines welded
    expect(linesOfPage(sparse)).toHaveLength(6);
  });
});

describe("a first page too sparse to show a gutter of its own takes the paper's (P7-10)", () => {
  const bytes = minimalPdf([twoColumnPage(1, 6, 0, "columns"), twoColumnPage(2, 24, 0, "columns"), twoColumnPage(3, 24, 5, "columns")]);
  const expected = (pages: [number, number][], first = 1) =>
    pages.flatMap(([page, rows]) => (["L", "R"] as const).flatMap((side) => range(rows).map((n) => token(page, side, n)))).slice(first - 1);

  it("reads the body in columns on every page, the sparse one included", async () => {
    const result = await extractPdfTextFromBytes(bytes);
    const text = (result.doc?.sections ?? []).map((s) => s.text).join("\n\n");
    expect(mentionsOf(text).map((m) => token(m.page, m.side, m.n - 1))).toEqual(expected([[1, 6], [2, 24], [3, 24]]));
  });

  it("hands the upload route page 1's text in columns too: a DOI beside another column's line is not welded to it", async () => {
    const result = await extractPdfTextFromBytes(bytes);
    expect(mentionsOf(result.page1Text ?? "").map((m) => token(m.page, m.side, m.n - 1))).toEqual(expected([[1, 6]]));
  });
});

// P7-11: a citation number is dropped in a real PDF too, in either column. The
// runs are raised 4.4pt and set at 6.7pt, as a journal sets them, at the end of
// lines that close on a word.
describe("a citation number raised above a column's line is dropped with it (P7-11)", () => {
  const cite = (page: number, side: Side, n: number, mark: string): Run => [
    mark,
    (side === "L" ? LEFT_X : RIGHT_X) + 232,
    110 + n * 14 + (page === 2 && side === "R" ? 5 : 0) - 4.4,
    6.7,
  ];
  const bytes = minimalPdf([
    [...twoColumnPage(1, 24, 0, "columns"), cite(1, "L", 3, "73"), cite(1, "R", 9, "74,75")],
    [...twoColumnPage(2, 24, 5, "columns"), cite(2, "L", 11, "88"), cite(2, "R", 20, "89–91")],
  ]);

  it("leaves none of the numbers in the text, and every printed line in it", async () => {
    const result = await extractPdfTextFromBytes(bytes);
    const text = (result.doc?.sections ?? []).map((s) => s.text).join("\n\n");
    for (const mark of ["73", "74", "75", "88", "89", "91"]) expect(text, mark).not.toContain(mark);
    expect(mentionsOf(text)).toHaveLength(96);
  });

  it("ends each of the four lines on its last word, not on the number", async () => {
    const lines = (await readPages(bytes)).flatMap(linesOfPage);
    const cited = lines.filter((line) => /^P1L04 |^P1R10 |^P2L12 |^P2R21 /.test(line.text));
    expect(cited).toHaveLength(4);
    for (const line of cited) expect(line.text, line.text).toMatch(/[a-z]$/);
    expect(lines.filter((line) => tokensIn(line.text).length > 0)).toHaveLength(96);
  });
});

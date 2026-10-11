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
import { linesOfPage } from "./pdf-outline";
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

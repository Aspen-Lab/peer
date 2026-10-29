// P12-45 (R1a): a paper that sets the figure label ("Fig. 1") as its own text
// line, left of the caption text and outside the picture's width, lost every
// margin figure: the label line has no horizontal overlap with the picture, so
// it was never a typed caption, the nearest line left was the label-less first
// body line, and the route's label filter dropped the region (404). The engine
// now joins a label-only line with the line of its own block on the same row.
// Every PDF and every caption here is invented; no paper is a fixture.
import { describe, expect, it } from "vitest";
import { FIGURE_EXTRACTION_REVISION } from "./figure-revision";
import { figurePdf, type FigurePage, type TextRun } from "./figure-pdf.test-helper";
import { extractPdfFigures, joinLabelOnlyLines } from "./pdf-engine";

/** The widths of the labels below in 9 pt Helvetica (the engine reads "Fig. 1" at x 40 as 40 to 62.5). */
const FIG_WIDTH = 22.5;
const FIGURE_WIDTH = 33;
const BODY = "Invented caption text for the picture above, set to the right of its label on the row.";
const CONTINUATION = "Second caption line continues here under the first.";
const options = { maxPages: 24, maxFigures: 12, measureOnly: true } as const;

/** A label-only run at `x`, and the caption's first line `gap` pt to its right on the same baseline. */
const labelRow = (label: string, labelWidth: number, x: number, top: number, gap: number, body = BODY): TextRun[] => [
  [label, x, top, 9],
  [body, x + labelWidth + gap, top, 9],
];

/** The P1 shape: a raster, and under it the label at the left margin (outside the raster's width) with the caption to its right. */
const marginLabelPage = (gap: number): FigurePage => ({
  text: [...labelRow("Fig. 1", FIG_WIDTH, 40, 268, gap), [CONTINUATION, 40 + FIG_WIDTH + gap, 280, 9]],
  shapes: [{ kind: "image", x: 127, top: 100, w: 341, h: 140 }],
});

const pick = async (page: FigurePage, label?: string) => {
  const result = await extractPdfFigures(figurePdf([page]), {
    ...options, ...(label ? { onlyPage: 1, label, maxFigures: 1 } : {}),
  });
  return result.figures.map(({ box, caption }) => ({ box, caption }));
};

describe("P12-45: a label-only line joins its caption text on the row", () => {
  const joined = `Fig. 1 ${BODY} ${CONTINUATION}`;

  it("pairs the label with the caption text in the whole-document call", async () => {
    expect(await pick(marginLabelPage(10))).toEqual([{ box: [127, 100, 468, 240], caption: joined }]);
  });

  it("lists the region for the margin's route shape, by Figure 1 and by Fig. 1, and never for another number", async () => {
    expect(await pick(marginLabelPage(10), "Figure 1")).toEqual([{ box: [127, 100, 468, 240], caption: joined }]);
    expect(await pick(marginLabelPage(10), "Fig. 1")).toEqual([{ box: [127, 100, 468, 240], caption: joined }]);
    expect(await pick(marginLabelPage(10), "Figure 2")).toEqual([]);
  });

  it("finds each of two figures on a page by its own label", async () => {
    const page: FigurePage = {
      text: [...labelRow("Fig. 1", FIG_WIDTH, 40, 218, 10), ...labelRow("Figure 2", FIGURE_WIDTH, 40, 458, 10, "Another invented caption for the lower picture.")],
      shapes: [{ kind: "image", x: 127, top: 60, w: 341, h: 140 }, { kind: "image", x: 127, top: 300, w: 341, h: 140 }],
    };
    expect((await pick(page)).map(({ box }) => box)).toEqual([[127, 60, 468, 200], [127, 300, 468, 440]]);
    expect(await pick(page, "Figure 1")).toEqual([{ box: [127, 60, 468, 200], caption: `Fig. 1 ${BODY}` }]);
    expect(await pick(page, "Figure 2")).toEqual([{ box: [127, 300, 468, 440], caption: "Figure 2 Another invented caption for the lower picture." }]);
  });

  it("joins when the text starts 11 pt right of the label and not when it starts 14 pt right", async () => {
    expect((await pick(marginLabelPage(11), "Figure 1")).map(({ box }) => box)).toEqual([[127, 100, 468, 240]]);
    // Past the 12 pt reach the lines stay apart, as before: the region has only a label-less caption and the route's filter drops it.
    expect(await pick(marginLabelPage(14), "Figure 1")).toEqual([]);
    expect((await pick(marginLabelPage(14)))[0].caption).toBe(BODY);
  });

  it("keeps two column captions on one row apart: the label takes only the text next to it", async () => {
    const page: FigurePage = {
      text: [...labelRow("Fig. 1", FIG_WIDTH, 40, 268, 10, "Left caption words."), ["Fig. 2. Right raster.", 340, 268, 9]],
      shapes: [{ kind: "image", x: 100, top: 100, w: 180, h: 150 }, { kind: "image", x: 340, top: 100, w: 180, h: 150 }],
    };
    expect(await pick(page)).toEqual([
      { box: [100, 100, 280, 250], caption: "Fig. 1 Left caption words." },
      { box: [340, 100, 520, 250], caption: "Fig. 2. Right raster." },
    ]);
  });
});

describe("P12-45: joinLabelOnlyLines", () => {
  const line = (text: string, x0: number, x1: number, top = 258, blockId = 1) => ({ rect: [x0, top, x1, top + 12] as [number, number, number, number], text, blockId });

  it("joins a label-only line with the same-block line on its row: union rectangle, text 'label body'", () => {
    expect(joinLabelOnlyLines([line("Fig. 1.", 40, 62.5), line("Invented body words.", 70, 300, 259)])).toEqual([
      { rect: [40, 258, 300, 271], text: "Fig. 1. Invented body words.", blockId: 1 },
    ]);
  });

  it("joins whichever of the two comes first in the list", () => {
    expect(joinLabelOnlyLines([line("Invented body words.", 70, 300), line("Figure 2", 40, 62.5)])).toEqual([
      { rect: [40, 258, 300, 270], text: "Figure 2 Invented body words.", blockId: 1 },
    ]);
  });

  it.each(["Fig. 3", "Fig. 3a", "Figure 4:", "Figure 5 |", "FIG. 6.", "Fig.7"])("treats %j as a label-only line", (label) => {
    expect(joinLabelOnlyLines([line(label, 40, 62.5), line("Body.", 70, 120)])).toHaveLength(1);
  });

  it.each(["Fig. 3 shows the result", "Figure 4 and 5", "Fig. 3a, b", "Table 1", "Figure", "Fig. one"])("does not treat %j as a label-only line", (text) => {
    const lines = [line(text, 40, 62.5), line("Body.", 70, 120)];
    expect(joinLabelOnlyLines(lines)).toEqual(lines);
  });

  it("reaches 12 pt to the right of the label, no further", () => {
    expect(joinLabelOnlyLines([line("Fig. 1", 40, 62.5), line("Body.", 74.5, 120)])).toHaveLength(1);
    expect(joinLabelOnlyLines([line("Fig. 1", 40, 62.5), line("Body.", 74.6, 120)])).toHaveLength(2);
  });

  it("does not join across blocks, to a line left of the label, or to a line on another row", () => {
    const apart = [line("Fig. 1", 40, 62.5), line("Body.", 70, 120, 258, 2)];
    expect(joinLabelOnlyLines(apart)).toEqual(apart);
    const leftOf = [line("Fig. 1", 140, 162.5), line("Body.", 40, 120)];
    expect(joinLabelOnlyLines(leftOf)).toEqual(leftOf);
    const below = [line("Fig. 1", 40, 62.5), line("Body.", 70, 120, 272)];
    expect(joinLabelOnlyLines(below)).toEqual(below);
  });

  it("merges only label-only lines: ordinary same-row neighbours and typed captions stay apart", () => {
    const columns = [line("Left words.", 40, 120), line("Right words.", 126, 200)];
    expect(joinLabelOnlyLines(columns)).toEqual(columns);
    const typed = [line("Fig. 1", 40, 62.5), line("Fig. 2. Right caption.", 70, 200)];
    expect(joinLabelOnlyLines(typed)).toEqual(typed);
    const other = [line("Fig. 1", 40, 62.5), line("Table 2. Neighbour table.", 70, 200)];
    expect(joinLabelOnlyLines(other)).toEqual(other);
    const twoLabels = [line("Fig. 1", 40, 62.5), line("Fig. 2", 70, 92.5)];
    expect(joinLabelOnlyLines(twoLabels)).toEqual(twoLabels);
  });

  it("takes the nearest line when two start within reach, and uses each line once", () => {
    expect(joinLabelOnlyLines([line("Fig. 1", 40, 62.5), line("Far words.", 72, 100), line("Near words.", 66, 71)]).map(({ text }) => text))
      .toEqual(["Far words.", "Fig. 1 Near words."]);
    // Two labels both within reach of one line: the first in the list takes it, the other is left alone.
    expect(joinLabelOnlyLines([line("Fig. 1", 40, 62.5), line("Fig. 2", 44, 66), line("Body.", 70, 120)]).map(({ text }) => text))
      .toEqual(["Fig. 2", "Fig. 1 Body."]);
  });

  it("leaves a page's lines unchanged when there is no label-only line", () => {
    const lines = [line("Plain text.", 40, 120), line("More plain text.", 40, 140, 272)];
    expect(joinLabelOnlyLines(lines)).toEqual(lines);
  });

  it("examines at most 200 label-only lines a page, so a hostile page costs a bounded amount", () => {
    const lines = Array.from({ length: 250 }, (_, i) => [line("Fig. 1", 40, 62.5, 10 + i * 20, i + 1), line("Body.", 70, 120, 10 + i * 20, i + 1)]).flat();
    expect(joinLabelOnlyLines(lines)).toHaveLength(300);
  });
});

describe("P12-45: the figure revision", () => {
  it("moved past 3, the revision before label-only lines joined their rows, so derived figure caches are rebuilt", () => {
    expect(Number(FIGURE_EXTRACTION_REVISION)).toBeGreaterThanOrEqual(4);
  });
});

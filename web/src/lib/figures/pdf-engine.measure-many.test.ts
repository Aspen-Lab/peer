// P12-61 (§1h.434, part 3) — `measurePdfFigures`: the sizes of many figures of one PDF with one open of it
// (`withFigureSizes` opened a 25 MB paper once per caption). Each size is the one `measurePdfFigure` gives; the
// file is opened once, whatever the number of figures; a budget that runs out leaves the rest unmeasured, not
// "nothing". The PDF is invented.

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { barChart, bodyText, figurePdf, panel, type FigurePage } from "./figure-pdf.test-helper";

// Every file the engine opens, counted.
const opened = vi.hoisted(() => ({ files: 0 }));
vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return {
    ...actual,
    openSync: ((...args: Parameters<typeof actual.openSync>) => {
      opened.files += 1;
      return actual.openSync(...args);
    }) as typeof actual.openSync,
  };
});

import { measurePdfFigure, measurePdfFigures } from "./pdf-engine";

const dir = mkdtempSync(path.join(tmpdir(), "peer-measure-many-test-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));
beforeEach(() => {
  opened.files = 0;
});

const prose = bodyText(["Synthetic body text, one line.", "Synthetic body text, a second line."], 80);
const PAGES: FigurePage[] = [
  { text: prose },
  {
    text: [
      ["Figure 3. The wide panel of a two-figure page.", 100, 262, 9],
      ["Figure 4. The narrow panel of a two-figure page.", 100, 492, 9],
    ],
    shapes: [...panel(100, 80, 370, 160), ...panel(100, 330, 250, 140)],
  },
  { text: [...prose, ["Figure 5. A synthetic vector bar chart.", 72, 440, 9]], shapes: barChart(110, 250) },
];
const PDF = figurePdf(PAGES);
const TARGETS = [
  { page: 2, fig: 3 },
  { page: 2, fig: 4 },
  { page: 3, fig: 5 },
  { page: 2, fig: 9 }, // the page has no such figure
  { page: 9, fig: 1 }, // there is no such page
  { page: 1, fig: 3 }, // the figure is on another page
];

describe("measurePdfFigures (P12-61)", () => {
  it("gives each figure the size measurePdfFigure gives it, and null where there is nothing", async () => {
    const many = await measurePdfFigures(PDF, TARGETS);
    const one = await Promise.all(TARGETS.map((target) => measurePdfFigure(PDF, target.page, target.fig)));
    expect(many).toEqual(one);
    expect(many.slice(0, 3).every((size) => size && size.width > 0 && size.height > 0)).toBe(true);
    expect(many.slice(3)).toEqual([null, null, null]);
    // two different figures, two different sizes
    expect(many[0]).not.toEqual(many[1]);
  });

  it("opens a PDF on disk once for all of its figures — measurePdfFigure opens it once each", async () => {
    const filePath = path.join(dir, "paper.pdf");
    writeFileSync(filePath, PDF);
    opened.files = 0;

    const many = await measurePdfFigures({ filePath }, TARGETS);
    expect(opened.files).toBe(1);

    opened.files = 0;
    for (const target of TARGETS) await measurePdfFigure({ filePath }, target.page, target.fig);
    expect(opened.files).toBe(TARGETS.length);
    expect(many.slice(0, 3).every((size) => size !== null)).toBe(true);
  });

  it("answers null for each when the PDF cannot be read: not a PDF, empty, a file that is missing", async () => {
    expect(await measurePdfFigures(Buffer.from("not a PDF, only invented words"), TARGETS)).toEqual(TARGETS.map(() => null));
    expect(await measurePdfFigures(new Uint8Array(0), TARGETS)).toEqual(TARGETS.map(() => null));
    expect(await measurePdfFigures({ filePath: path.join(dir, "missing.pdf") }, TARGETS)).toEqual(TARGETS.map(() => null));
    expect(await measurePdfFigures(PDF, [])).toEqual([]);
  });

  it("leaves a figure unmeasured (undefined), not nothing (null), when the budget has run out", async () => {
    expect(await measurePdfFigures(PDF, TARGETS.slice(0, 2), 0)).toEqual([undefined, undefined]);
  });
});

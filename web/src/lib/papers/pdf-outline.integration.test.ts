import { describe, expect, it } from "vitest";
import { buildOutline, captionAt, type PdfLine, type PdfPageText, type PdfTextItem } from "./pdf-outline";

// P12-70: where the rules of the P12 Cs meet in `captionAt` (C P12-56's R6b: a label line after a line that ends
// mid-sentence is prose) and in the outline's other rules (C P12-51's O8: the text of a figure's panels is out of the
// prose). Every text is invented.

const BODY = { size: 10, font: "body" };
const GHOST = "Fig. 4. Then the signal rises with the load on the cell in the same order.";
const FULL = "The rate of deposition of the film increased with the supply of precursor, as shown in";

function line(text: string, at: Partial<PdfLine> = {}): PdfLine {
  return { page: 1, text, x: 100, y: 500, size: 10, font: "body", ...at };
}

describe("a line the reading leaves out is not open prose (P12-70: R6b with O8)", () => {
  const read = [line("5 Min", { y: 512 }), line("Figure 4: Capacity after five minutes.", { y: 500 })];

  it("makes a label line under figure text a caption, though the text above is in the body's size and face and ends no sentence", () => {
    expect(captionAt(read, 1, 12, BODY, new Set()), "without the knowledge: R6b's reading").toBeNull();
    expect(captionAt(read, 1, 12, BODY, new Set(), (j) => j === 0)).toMatchObject({ label: "Figure 4" });
  });

  it("leaves a label line under real prose refused, whatever else the reading leaves out", () => {
    const prose = [line(FULL, { y: 512 }), line(GHOST, { y: 500 })];
    expect(captionAt(prose, 1, 12, BODY, new Set(), (j) => j === 5)).toBeNull();
    expect(captionAt(prose, 1, 12, BODY, new Set(), () => false)).toBeNull();
  });

  it("holds in the whole reading: three short lines of figure text in the body's face, then the caption, are listed and out of the prose", () => {
    const item = (str: string, y: number, at: Partial<PdfTextItem> = {}): PdfTextItem => ({ str, height: 10, width: str.length * 4.6, fontName: "body", x: 100, y, ...at });
    const prose = [
      "Quillwort cathodes degrade through slow loss of lithium at the grain edges of the film.",
      "We follow the loss over four hundred cycles and ask which edge goes first in each sample.",
      "The answer decides how the films are annealed before they are built into a cell.",
    ];
    const page: PdfPageText = {
      page: 1,
      items: [
        item("A Paper About Quillwort Cathodes", 780, { height: 17 }),
        item("1 Introduction", 760),
        ...prose.map((text, i) => item(text, 746 - i * 14)),
        item("5 Min", 692),
        item("10 Min", 678),
        item("20 Min", 664),
        item("Figure 4: Capacity after five, ten and twenty minutes.", 652),
      ],
    };
    const outline = buildOutline([page]);
    expect(outline.figureCaptions?.map((c) => c.label)).toEqual(["Figure 4"]);
    expect((outline.sections ?? []).map((s) => s.text).join(" ")).toBe(prose.join(" "));
  });
});

describe("a paragraph's short last line ends its paragraph without a full stop (P12-70: R6b with O8's required negative)", () => {
  const caption = "Figure 3: Capacity of the films over the cycles.";
  const full = "We follow the loss over four hundred cycles and ask which edge goes first in each sample";

  it("makes a label line under a short last line a caption", () => {
    const read = [line(full, { y: 524 }), line("of the new set", { y: 512 }), line(caption, { y: 500 })];
    expect(captionAt(read, 2, 12, BODY, new Set())).toMatchObject({ label: "Figure 3" });
  });

  it("does not make a mid-sentence line that is only a little shorter than the one above it a paragraph's end", () => {
    // a ragged right edge: the line above wraps at 70% of the one before it, and the label line goes on with its sentence
    const wrapped = full.slice(0, Math.round(full.length * 0.7)).replace(/\s+\S*$/, "");
    const read = [line(full, { y: 524 }), line(wrapped, { y: 512 }), line(GHOST, { y: 500 })];
    expect(captionAt(read, 2, 12, BODY, new Set())).toBeNull();
    // and a line of full width: the ghost of R6b, as before
    expect(captionAt([line(full, { y: 524 }), line(FULL, { y: 512 }), line(GHOST, { y: 500 })], 2, 12, BODY, new Set())).toBeNull();
  });

  it("needs the line before it to be a line of the same paragraph: same page, directly above, same column, same face and size", () => {
    const short = line("of the new set", { y: 512 });
    const refused = (before: PdfLine) => captionAt([before, short, line(GHOST, { y: 500 })], 2, 12, BODY, new Set());
    expect(refused(line(full, { y: 524 })), "the paragraph's line").toMatchObject({ label: "Fig 4" });
    expect(refused(line(full, { y: 524, page: 2 })), "another page").toBeNull();
    expect(refused(line(full, { y: 560 })), "a gap").toBeNull();
    expect(refused(line(full, { y: 524, x: 340 })), "another column").toBeNull();
    expect(refused(line(full, { y: 524, font: "bold" })), "another face").toBeNull();
    expect(refused(line(full, { y: 524, size: 14 })), "another size").toBeNull();
  });
});

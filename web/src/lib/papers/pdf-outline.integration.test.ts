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

describe("the opening of a paper that names no introduction starts at a line headed by a drop cap (P12-70, ruling §1h.444: O6 with O7 and P12-64)", () => {
  const item = (str: string, y: number, at: Partial<PdfTextItem> = {}): PdfTextItem => ({ str, height: 10, width: str.length * 4.6, fontName: "body", x: 100, y, ...at });
  const OPENING = [
    "econdary cathodes degrade through slow loss of lithium at the grain edges of the film.",
    "We follow the loss over four hundred cycles and ask which edge goes first in each sample.",
    "The answer decides how the films are annealed before they are built into a cell.",
    "Films that were cooled quickly lost a third of their capacity before the hundredth cycle.",
  ];
  const RESULT = [
    "The capacity of the annealed films held at ninety percent of its first value over the run.",
    "Films that were cooled quickly lost a third of their capacity before the hundredth cycle.",
    "The edges of the slow-cooled grains stayed whole under the microscope after the last cycle.",
  ];
  /** A title, an author line, a two-line summary in another face, and an opening whose first line begins with a drop cap `cap` pt high, `gap` pt from the rest of the word. */
  const paper = (cap = 40, gap = 3): PdfPageText[] => [
    {
      page: 1,
      items: [
        item("Slow Annealing Keeps Quillwort Films Whole", 760, { height: 17 }),
        item("Ada Fenwick and Boris Lund", 735, { height: 11, fontName: "display" }),
        item("Quillwort cathodes keep their capacity when the films are cooled slowly after growth and lose it when they are", 705, { height: 10.5, fontName: "display" }),
        item("not, because the edges of the grains are spared the strain of the cooling that the quick films are put through.", 692, { height: 10.5, fontName: "display" }),
        item("S", 660, { height: cap, width: cap * 0.6 }),
        item(OPENING[0], 660, { x: 100 + cap * 0.6 + gap }),
        item(OPENING[1], 646),
        item(OPENING[2], 632),
        item(OPENING[3], 618),
        item("Slow cooling spares the grain edges", 590, { height: 12, fontName: "display" }),
        ...RESULT.map((text, i) => item(text, 576 - i * 14)),
      ],
    },
  ];

  it("keeps the drop cap's line in the opening, its first paragraph starts with the whole first word", () => {
    const sections = buildOutline(paper()).sections ?? [];
    expect(sections.map((s) => s.heading)).toEqual([undefined, "Slow cooling spares the grain edges"]);
    expect(sections[0].text?.split("\n\n")[0].startsWith("Secondary cathodes degrade through slow loss of lithium")).toBe(true);
    expect(sections[0].text).toContain(OPENING[3]);
    expect(sections[0].text).not.toMatch(/Fenwick|Quillwort cathodes keep|S econdary/);
    expect(sections[1].text).toBe(RESULT.join(" "));
    expect(buildOutline(paper()).title).toBe("Slow Annealing Keeps Quillwort Films Whole");
  });

  it("holds for a cap of any size from twice the body to five times, and for the padding the page leaves beside it (up to a fifth of the cap)", () => {
    for (const cap of [20, 28, 40, 50]) {
      for (const gap of [0, 1, 3, cap * 0.2]) {
        const sections = buildOutline(paper(cap, gap)).sections ?? [];
        expect(sections[0].text?.startsWith("Secondary cathodes degrade"), `${cap} pt, ${gap} pt apart`).toBe(true);
      }
    }
  });

  it("does not join a large mark to a word that is not the rest of its own: a capital and a capitalised word stay two", () => {
    const [first] = paper();
    const page: PdfPageText = {
      ...first,
      items: [...first.items, item("A", 520, { height: 30, width: 18 }), item("Results of the second season were as before.", 520, { x: 121 })],
    };
    const text = (buildOutline([page]).sections ?? []).map((s) => s.text).join(" ");
    expect(text).toContain("A Results of the second season were as before.");
    expect(text).not.toContain("AResults");
  });
});

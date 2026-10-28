import { describe, expect, it } from "vitest";
import { bodyStyle, buildOutline, headingOf, type PdfLine, type PdfPageText, type PdfTextItem } from "./pdf-outline";

// C P12-74 (B P12-73, M1 and M6; ruling §1h.449): figure text and the middle of a sentence are not headings, and a
// first page's footnote is margin print. Every text below is invented; no sentence of any paper.

/** A run of text on a page, as pdf.js hands it over. */
function item(str: string, at: Partial<PdfTextItem> = {}): PdfTextItem {
  return { str, height: 10, width: str.length * 4.6, fontName: "body", x: 100, y: 500, ...at };
}

function line(text: string, at: Partial<PdfLine> = {}): PdfLine {
  return { page: 1, text, x: 100, y: 500, size: 10, font: "body", ...at };
}

const BODY = { size: 10, font: "body" };
const SENTENCE = "Recurrent neural networks have long been established in sequence modelling and transduction.";
const prose = (y: number, text = SENTENCE) => item(text, { y });

/** A one-page paper: a title, an unnamed-number heading ("Introduction", set larger), six lines of prose from y = 726
 *  down to 666, then `middle` (which starts at y = 654, the next line of the same block), then three lines of prose. */
function paperOf(middle: PdfTextItem[], rest: number[] = [560, 548, 536]): PdfPageText[] {
  return [
    {
      page: 1,
      items: [
        item("A Paper About Cathodes", { height: 17, y: 760 }),
        item("Introduction", { y: 740, height: 12, fontName: "display" }),
        ...[726, 714, 702, 690, 678, 666].map((y) => prose(y)),
        ...middle,
        ...rest.map((y) => prose(y)),
      ],
    },
  ];
}

const headingsOf = (pages: PdfPageText[]) => (buildOutline(pages).sections ?? []).map((s) => s.heading);
const textOf = (pages: PdfPageText[]) => (buildOutline(pages).sections ?? []).map((s) => s.text).join(" ");

/** `count` lines of prose from `top` down, one pitch (12) apart, each ending a sentence. */
const proseLines = (top: number, count: number): PdfLine[] => Array.from({ length: count }, (_, i) => line(SENTENCE, { y: top - i * 12 }));

// ── R2: a numbered line that goes on from open prose is no heading ──────────────────────────────────────

describe("a numbered line in the body's face that goes on from a sentence is no heading (C P12-74, R2)", () => {
  const goingOn = (): PdfLine[] => [
    line("Introduction", { size: 12, font: "display", y: 800 }),
    ...proseLines(780, 6),
    line("modelling and transduction and were charged and discharged at a rate of", { y: 708 }),
    line("3 A g-1 and then held at the cut-off voltage until the current fell", { y: 696 }),
    line("below the limit set for the test of every cell in the series.", { y: 684 }),
    line("2 Results", { y: 660 }),
    ...proseLines(648, 3),
  ];

  it("end to end: the line stays in the paragraph it goes on in, and no section opens at it", () => {
    const pages = paperOf([
      prose(654, "modelling and transduction and were charged and discharged at a rate of"),
      prose(642, "3 A g-1 and then held at the cut-off voltage until the current fell"),
      prose(630, "below the limit set for the test of every cell in the series."),
    ]);
    expect(headingsOf(pages)).toEqual(["Introduction"]);
    expect(textOf(pages)).toContain("at a rate of 3 A g-1 and then held at the cut-off voltage until the current fell below the limit");
  });

  it("refuses the line once the paper around it is read, and not the line alone", () => {
    const lines = goingOn();
    const style = bodyStyle(lines);
    expect(headingOf(lines[8], style)).toBeNull();
    // alone, a number and a capital word are a numbered heading (the shape has not changed)
    expect(headingOf(lines[8], BODY)).toBe("3 A g-1 and then held at the cut-off voltage until the current fell");
  });

  it("does not let the refused number move the paper's numbering: the next heading is still taken", () => {
    const lines = goingOn();
    const style = bodyStyle(lines);
    expect(headingOf(lines[10], style)).toBe("2 Results");
  });

  it("still takes a numbered line that follows the end of a sentence", () => {
    const lines = goingOn();
    lines[7] = line("modelling and transduction and were charged and discharged at a rate.", { y: 708 });
    const style = bodyStyle(lines);
    expect(headingOf(lines[8], style)).toBe("3 A g-1 and then held at the cut-off voltage until the current fell");
  });

  it("still takes stacked numbered headings in the body's own face: a heading is not the middle of a sentence", () => {
    // "5 Methods" has no stop and the line under it stands one pitch below: without the exemption the second reads
    // as the sentence's next words.
    const stacked = [
      line("Introduction", { size: 12, font: "display", y: 800 }),
      ...proseLines(780, 6),
      line("5 Methods", { y: 690 }),
      line("5.1 Cell assembly", { y: 678 }),
      ...proseLines(654, 3),
    ];
    const style = bodyStyle(stacked);
    expect(headingOf(stacked[7], style)).toBe("5 Methods");
    expect(headingOf(stacked[8], style)).toBe("5.1 Cell assembly");
  });
});

// ── R1: a numbered line set smaller than the body is no heading ─────────────────────────────────────────

describe("a numbered line set smaller than the body is no heading (C P12-74, R1)", () => {
  it("refuses an axis line, a legend and a small reference entry that open with a number", () => {
    for (const [text, size, font] of [
      ["80 Capacity retention percent", 5, "plot"],
      ["25 Voltage window of the cell", 6.1, "plot"],
      ["17 Journal of Invented Studies Volume 12 Pages 345", 7.2, "refs"],
      ["3 Rate test at the highest current", 8.4, "body"],
    ] as const) {
      expect(headingOf(line(text, { size, font }), BODY), text).toBeNull();
    }
  });

  it("stops at 0.95 of the body: a line a little under it is out, at it and above it the number still makes a heading", () => {
    expect(headingOf(line("2 Voltage window of the cell", { size: 9.4 }), BODY)).toBeNull();
    expect(headingOf(line("2 Voltage window of the cell", { size: 9.6 }), BODY)).toBe("2 Voltage window of the cell");
    expect(headingOf(line("2 Voltage window of the cell", { size: 10 }), BODY)).toBe("2 Voltage window of the cell");
    expect(headingOf(line("2 Voltage window of the cell", { size: 12, font: "display" }), BODY)).toBe("2 Voltage window of the cell");
  });

  it("end to end: an axis line and a small reference entry open no section", () => {
    const axis = paperOf([item("80 Capacity retention percent", { y: 654, height: 5, fontName: "plot" })]);
    expect(headingsOf(axis)).toEqual(["Introduction"]);
    expect(textOf(axis)).toContain("80 Capacity retention percent");
    const entry = paperOf([item("17 Journal of Invented Studies Volume 12 Pages 345", { y: 654, height: 7.2, fontName: "refs" })]);
    expect(headingsOf(entry)).toEqual(["Introduction"]);
  });
});

describe("a paper that numbers its headings is read as it was (C P12-74, R1 and R2 together)", () => {
  const heading = (text: string, y: number, height = 12) => item(text, { y, height, fontName: "display" });
  const plain = (text: string, y: number) => item(text, { y });
  // 1, 2, 2.1, 2.2 and 3: three set apart, "2.2 Cycling" in the body's own face after the end of a sentence.
  const numbered: PdfPageText[] = [
    {
      page: 1,
      items: [
        item("A Paper About Cathodes", { height: 17, y: 780 }),
        heading("1 Introduction", 760),
        plain("Recurrent neural networks have long been established in sequence modelling.", 746),
        plain("They are used in cells of every size, from watches to grid stores.", 734),
        plain("The rest of the paper takes up the grains in turn.", 722),
        heading("2 Methods", 696),
        plain("Cells were assembled in an argon filled glovebox with less than one part.", 682),
        plain("They were cycled at twenty five degrees at the rate the supplier gave.", 670),
        heading("2.1 Cell assembly", 644, 11),
        plain("Each film was cut to a disc and dried under vacuum for a full day.", 630),
        plain("The discs were weighed and stacked in the glovebox before sealing.", 618),
        plain("2.2 Cycling", 592),
        plain("The cells rested for a day and were then cycled between two limits.", 580),
        plain("The current was set from the mass of the film in each cell.", 568),
        heading("3 Conclusions", 542),
        plain("The coating slows the fade of every film in the series of cells.", 528),
        plain("The next step is to test the thick films in the same way as these.", 516),
      ],
    },
  ];

  it("keeps every numbered heading, its bucket and its text, exactly as the outline read them before", () => {
    expect(buildOutline(numbered)).toEqual({
      title: "A Paper About Cathodes",
      sections: [
        {
          heading: "1 Introduction",
          canonical: "introduction",
          page: 1,
          text: "Recurrent neural networks have long been established in sequence modelling. They are used in cells of every size, from watches to grid stores. The rest of the paper takes up the grains in turn.",
        },
        {
          heading: "2 Methods",
          canonical: "methods",
          page: 1,
          text: "Cells were assembled in an argon filled glovebox with less than one part. They were cycled at twenty five degrees at the rate the supplier gave.",
        },
        {
          heading: "2.1 Cell assembly",
          canonical: "methods",
          page: 1,
          text: "Each film was cut to a disc and dried under vacuum for a full day. The discs were weighed and stacked in the glovebox before sealing.",
        },
        {
          heading: "2.2 Cycling",
          canonical: "methods",
          page: 1,
          text: "The cells rested for a day and were then cycled between two limits. The current was set from the mass of the film in each cell.",
        },
        {
          heading: "3 Conclusions",
          canonical: "conclusion",
          page: 1,
          text: "The coating slows the fade of every film in the series of cells. The next step is to test the thick films in the same way as these.",
        },
      ],
      figureCaptions: [],
      pageCount: 1,
      reason: null,
    });
  });
});

// ── R3: a lone panel letter makes a line figure text ────────────────────────────────────────────────────

describe("a line with a lone panel letter b to h is figure text, not a heading (C P12-74, R3)", () => {
  it("refuses a row of panel labels in the figure's own face, the letter first, inside or last", () => {
    for (const text of [
      "a Charge curve b Discharge curve c Rate test",
      "b Discharge curve at the rate of the test",
      "Rate test at the highest current d",
      "Capacity e retention after cycling",
      "Cell h",
    ]) {
      expect(headingOf(line(text, { font: "plot" }), BODY), text).toBeNull();
    }
    // a numbered row too
    expect(headingOf(line("2 Charge curve c Discharge curve", { font: "display", size: 12 }), BODY)).toBeNull();
  });

  it("keeps a heading whose words only hold those letters, and a lone a or i", () => {
    for (const text of ["Bulk phase behaviour", "Studies on a Lattice", "Group i Structures", "Discussion and Outlook"]) {
      expect(headingOf(line(text, { font: "display", size: 12 }), BODY), text).toBe(text);
    }
    expect(headingOf(line("2.1 Cell assembly", { font: "display", size: 12 }), BODY)).toBe("2.1 Cell assembly");
  });

  it("end to end: a row of panel labels in the figure's face opens no section", () => {
    const pages = paperOf([item("a Charge curve  b Discharge curve  c Rate test", { y: 654, fontName: "plot" })]);
    expect(headingsOf(pages)).toEqual(["Introduction"]);
    expect(textOf(pages)).toContain("a Charge curve b Discharge curve c Rate test");
  });
});

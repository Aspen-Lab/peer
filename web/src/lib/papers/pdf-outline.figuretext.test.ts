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

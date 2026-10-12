// P9-13a (round P9, round-3 Theme 1): a fraction set around a text row is written `numerator / denominator`
// in its sentence, not left as a torn paragraph.
//
// A fraction inside a sentence is set over three rows: a numerator above the text row, the text row ("× 100, and
// the share of each as a"), a denominator below it. P9-09 joined the three when all of them were rows of their own;
// P9-08's fold then took a numerator set within 7.5pt above the text row INTO that row, as its first, raised run, and
// left the denominator (3.5pt is the most a script is lowered and still joins a row) a fragment row of its own. The
// row that opens with the numerator is no stack row, the lone denominator is not a stack (one row), and the indent
// rule opened a paragraph at it: the one paragraph of the owner's paper still torn after Theme 1.
//
// The fixtures are invented words and symbols on the shape the owner's page has (a 7pt numerator 5pt above a 10pt
// row, a 7pt denominator 7pt below it, the leading 16pt): nothing here is a line of the owner's paper.
import { describe, expect, it } from "vitest";
import { buildOutline, type PdfTextItem } from "./pdf-outline";

/** A run of text, as pdf.js hands it over: ten points high unless the test says it is a script. */
function item(str: string, at: Partial<PdfTextItem> = {}): PdfTextItem {
  const height = at.height ?? 10;
  return { str, height, width: str.length * height * 0.46, fontName: "body", x: 100, y: 500, ...at };
}

const FILLER = "Quillwort cathodes were annealed in air before every measurement was taken.";
const LEADING = 16;
/** The text row's baseline; the line above it is one leading higher, the line below it one leading lower. */
const ROW = 628;
const ABOVE = "The shares are calculated as";
const WORDS = "× 100, and the share of each as a";

interface Setup {
  /** The line above the fraction, unfinished by default. */
  above?: string;
  /** What the text row says, after its numerator. */
  row?: string;
  /** The numerator: its text, its height above the text row's baseline, its left edge; null for none. */
  numerator?: { str: string; rise: number; x?: number } | null;
  /** The denominator: its text, its depth below the text row's baseline, its left edge; null for none. */
  denominator?: { str: string; drop: number; x?: number } | null;
  /** Where the words of the text row start: past the numerator's, or at the column's edge when there is none. */
  rowX?: number;
  /** The line below the fraction, and how far under the text row it stands. */
  below?: string;
  belowDrop?: number;
  /** Full-size runs the text row opens with, ahead of its words (a unit with its exponent, say). */
  opening?: PdfTextItem[];
}

/** A page: a title, a heading, prose, then the rows of a fraction around the text row, then prose. */
function page({
  above = ABOVE,
  row = WORDS,
  numerator = { str: "P(ab)", rise: 5 },
  denominator = { str: "m P(ab)", drop: 7 },
  rowX = numerator ? 128 : 100,
  below = "three-phase system is shown below.",
  belowDrop = LEADING,
  opening = [],
}: Setup = {}): PdfTextItem[] {
  const filler = (y: number) => item(FILLER, { y });
  const script = (str: string, y: number, x: number) => item(str, { x, y, height: 7, width: str.length * 3.2 });
  return [
    item("A Paper About Cathodes", { height: 17, y: 760 }),
    item("1 Methods", { y: 740 }),
    ...[724, 708, 692, 676, 660].map(filler),
    item(above, { y: ROW + LEADING }),
    ...(numerator ? [script(numerator.str, ROW + numerator.rise, numerator.x ?? 104)] : []),
    ...opening,
    item(row, { x: rowX, y: ROW }),
    ...(denominator ? [script(denominator.str, ROW - denominator.drop, denominator.x ?? 108)] : []),
    item(below, { y: ROW - belowDrop }),
    ...[1, 2, 3, 4, 5, 6].map((n) => filler(ROW - belowDrop - LEADING * n)),
  ];
}

const read = (items: PdfTextItem[]) => buildOutline([{ page: 1, items }]);
/** The section's paragraphs. The filler is one paragraph at the leading, so a sentence that is whole is in it. */
const paragraphsOf = (items: PdfTextItem[]) => (read(items).sections?.[0].text ?? "").split("\n\n");

const FRACTION = "The shares are calculated as P(ab) / m P(ab) × 100, and the share of each as a three-phase system is shown below.";

/** The page reads as one paragraph, and this sentence is in it whole. */
function expectOneParagraph(items: PdfTextItem[], sentence: string) {
  const paragraphs = paragraphsOf(items);
  expect(paragraphs).toHaveLength(1);
  expect(paragraphs[0]).toContain(sentence);
}

describe("a fraction around a text row is written numerator / denominator in its sentence (P9-13a)", () => {
  it("the fold takes the numerator into the text row, the denominator is a fragment row: one paragraph, the fraction readable", () => {
    const items = page();
    expectOneParagraph(items, FRACTION);
    // None of it is lifted as an equation.
    expect(read(items).equations).toBeUndefined();
  });

  it("the numerator more than 7.5pt above is not folded: P9-09's three rows still join into the same sentence", () => {
    expectOneParagraph(page({ numerator: { str: "P(ab)", rise: 9 } }), FRACTION);
  });

  it("a numerator and a denominator of other heights and widths, a space inside the brackets as the PDF stores it", () => {
    const items = page({ numerator: { str: "I(hkl )", rise: 4, x: 105 }, denominator: { str: "n I(hkl )", drop: 6, x: 109 }, rowX: 134 });
    expectOneParagraph(items, "The shares are calculated as I(hkl ) / n I(hkl ) × 100, and the share of each as a three-phase system is shown below.");
  });
});

describe("what is not a fraction around a text row stays as the page set it (P9-13a guards)", () => {
  /** The whole section text, which must not hold a fraction's bar. */
  const noBar = (items: PdfTextItem[]) => {
    const text = paragraphsOf(items).join("\n\n");
    expect(text).not.toContain(" / ");
    return text;
  };

  it("a raised citation number at the head of a row is not a numerator", () => {
    const text = noBar(page({ numerator: { str: "12", rise: 5 } }));
    expect(text).toContain("12 × 100, and the share of each as a");
  });

  it("a raised exponent or charge at the head of a row is not a numerator", () => {
    noBar(page({ numerator: { str: "2", rise: 5 } }));
    noBar(page({ numerator: { str: "2+", rise: 5 } }));
    noBar(page({ numerator: { str: "−1", rise: 5 } }));
  });

  it("an exponent inside the row is not a numerator: the row opens at full size", () => {
    const items = page({
      numerator: null,
      row: "per second × 100, and the share of each as a",
      // "cm" is 9.2pt wide and the exponent stands against its end, as the PDF sets it.
      opening: [item("cm", { x: 104, y: ROW }), item("2", { x: 113.2, y: ROW + 5, height: 7, width: 3.2 })],
      rowX: 120,
    });
    expect(noBar(items)).toContain("cm² per second × 100");
  });

  it("a raised label ahead of a prose row with no operator in it is not a fraction", () => {
    noBar(page({ row: "μm was observed at room temperature and held", numerator: { str: "g(ab)", rise: 5 }, denominator: { str: "8−15", drop: 7 } }));
  });

  it("a denominator that stands elsewhere on the line (no x-range in common) is not this numerator's", () => {
    noBar(page({ denominator: { str: "m P(ab)", drop: 7, x: 360 } }));
  });

  it("a fragment set looser than the fraction's rows is a line of its own, not its denominator", () => {
    // 0.8 of the 16pt leading is 12.8pt: this one is 13pt under the text row.
    noBar(page({ denominator: { str: "m P(ab)", drop: 13 }, belowDrop: 31 }));
  });

  it("a fraction after a finished sentence is not joined to it", () => {
    noBar(page({ above: "The shares are calculated below." }));
  });

  it("two ordinary prose rows at the leading are untouched", () => {
    expectOneParagraph(page({ numerator: null, denominator: null }), "The shares are calculated as × 100, and the share of each as a three-phase system is shown below.");
  });
});

describe("a lone fragment row under an unfinished row, before a lower-case continuation, joins the sentence (P9-13a, the other half)", () => {
  it("a denominator with no raised numerator above it is written inline, never a paragraph of its own", () => {
    expectOneParagraph(page({ numerator: null }), "The shares are calculated as × 100, and the share of each as a m P(ab) three-phase system is shown below.");
  });

  it("not when the line below opens a sentence of its own", () => {
    const paragraphs = paragraphsOf(page({ numerator: null, below: "Three phases are shown below." }));
    expect(paragraphs.some((p) => p.includes("as a m P(ab)"))).toBe(false);
    expect(paragraphs.some((p) => p.startsWith("m P(ab)"))).toBe(true);
  });

  it("not when the row above it is finished", () => {
    const paragraphs = paragraphsOf(page({ numerator: null, row: "× 100 and the share of each is shown below." }));
    expect(paragraphs.some((p) => p.includes("below. m P(ab)"))).toBe(false);
    expect(paragraphs.some((p) => p.startsWith("m P(ab)"))).toBe(true);
  });

  it("not when the fragment is set looser than the fraction's rows", () => {
    const paragraphs = paragraphsOf(page({ numerator: null, denominator: { str: "m P(ab)", drop: 13 }, belowDrop: 31 }));
    expect(paragraphs.some((p) => p.includes("as a m P(ab)"))).toBe(false);
  });
});

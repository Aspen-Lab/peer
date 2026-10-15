// P9-15 (round P9, round-3 Theme 1, cluster F of the round-2 blind read): a display equation island is written
// as one line that reads left to right.
//
// A display island is the rows of a stack a fraction or a sum sets tighter than the page's leading, lifted whole
// between two sentences. Until now the lift wrote its rows top to bottom, each row's runs left to right, so a
// stacked fraction read numerator, then the line it belongs to, then its denominator ("I(ab) Q(ab) = × 100 m I(ab)"):
// not an equation anyone can read. The writer now takes the row that holds `=` (else the widest row of text size) as
// the base line, finds the numerator and the denominator by where they stand against the gaps of that line, and
// writes `numerator / denominator` at the gap they stand over; a limit stands right after its operator.
//
// The fixtures are invented symbols on the shape of a real page (text 10pt, a numerator row 8pt above the base line,
// a denominator row 8pt below it, the leading 12pt, a 7pt script folded into the row it belongs to): nothing here is
// a line of any real paper.
import { describe, expect, it } from "vitest";
import { blockMarker } from "@/lib/text/math";
import { buildOutline, linesOfPage, type PdfTextItem } from "./pdf-outline";

/** A run of text, as pdf.js hands it over: ten points high unless the test says it is a script. */
function item(str: string, at: Partial<PdfTextItem> = {}): PdfTextItem {
  const height = at.height ?? 10;
  return { str, height, width: str.length * height * 0.46, fontName: "body", x: 100, y: 500, ...at };
}

const FILLER = "Quillwort cathodes were annealed in air before every measurement was taken.";
const filler = (y: number) => item(FILLER, { y });
/** The base line of every island below. */
const BASE = 630;
/** A numerator row, a denominator row, and a script as the page sets them against that line. */
const UP = BASE + 8;
const DOWN = BASE - 8;
const script = (str: string, x: number, y: number) => item(str, { x, y, height: 7 });

/** A page: prose, a finished sentence, the island's runs, a sentence that opens with a capital, prose. */
function page(runs: PdfTextItem[], after: PdfTextItem[] = [591, 579, 567].map(filler)): PdfTextItem[] {
  return [
    item("A Paper About Cathodes", { height: 17, y: 760 }),
    item("1 Methods", { y: 740 }),
    ...[726, 714, 702, 690, 678, 666].map(filler),
    item("The coefficient was obtained from the relation below.", { y: 654 }),
    ...runs,
    item("Here the symbols are defined as follows, with every term in kelvin.", { y: 603 }),
    ...after,
  ];
}

const read = (items: PdfTextItem[]) => buildOutline([{ page: 1, items }]);
const equationsOf = (runs: PdfTextItem[], after?: PdfTextItem[]) => read(page(runs, after)).equations ?? [];

describe("a display island reads left to right: a stacked fraction as numerator / denominator at its gap (P9-15)", () => {
  it("writes the numerator, a slash and the denominator where the base line has its gap", () => {
    const outline = read(
      page([
        item("Q(ab) =", { x: 100, y: BASE }),
        item("× 100", { x: 190, y: BASE }),
        item("I(ab)", { x: 150, y: UP }),
        item("m I(ab)", { x: 148, y: DOWN }),
      ]),
    );
    expect(outline.equations).toEqual([{ text: "Q(ab) = I(ab) / m I(ab) × 100" }]);
    // The marker keeps its place between the two sentences, and nothing else of the island is a paragraph.
    const paragraphs = (outline.sections?.[0].text ?? "").split("\n\n");
    const at = paragraphs.indexOf(blockMarker(0));
    expect(paragraphs[at - 1]).toMatch(/obtained from the relation below\.$/);
    expect(paragraphs[at + 1]).toMatch(/^Here the symbols are defined/);
    expect(paragraphs.filter((p) => p.length < 20 && p !== blockMarker(0))).toEqual([]);
  });

  it("does the same when the fold took the numerator into the base line as a raised run", () => {
    // A 7pt numerator 5pt above the base line is folded into it (P9-08); the denominator stays a row of its own.
    expect(
      equationsOf([
        item("Q(ab) =", { x: 100, y: BASE }),
        item("× 100", { x: 190, y: BASE }),
        script("I(ab)", 150, BASE + 5),
        item("m I(ab)", { x: 148, y: DOWN }),
      ]),
    ).toEqual([{ text: "Q(ab) = I(ab) / m I(ab) × 100" }]);
  });

  it("puts the fraction at the end of the line when nothing follows its gap", () => {
    expect(
      equationsOf([
        item("R =", { x: 100, y: BASE }),
        item("I(ab)/J(ab)", { x: 140, y: UP }),
        item("m I(ab)", { x: 150, y: DOWN }),
      ]),
    ).toEqual([{ text: "R = I(ab)/J(ab) / m I(ab)" }]);
  });

  it("keeps a limit that stands under no sum sign before the row it stands under", () => {
    // The text layer of a PDF does not always carry the sum sign: the lowered `n` is then just a letter of its row.
    expect(
      equationsOf([
        item("Q(ab) =", { x: 100, y: BASE }),
        item("× 100", { x: 190, y: BASE }),
        item("I(ab)", { x: 150, y: UP }),
        script("n", 148, DOWN - 3),
        item("I(ab)", { x: 156, y: DOWN }),
      ]),
    ).toEqual([{ text: "Q(ab) = I(ab) / n I(ab) × 100" }]);
  });

  it("writes each of two fractions of one line at its own gap", () => {
    expect(
      equationsOf([
        item("R =", { x: 100, y: BASE }),
        item("+", { x: 150, y: BASE }),
        item("I(ab)", { x: 120, y: UP }),
        item("J(ab)", { x: 165, y: UP }),
        item("m", { x: 125, y: DOWN }),
        item("k", { x: 170, y: DOWN }),
      ]),
    ).toEqual([{ text: "R = I(ab) / m + J(ab) / k" }]);
  });

  it("finds the gap even where the base line leaves less room than a cell gap", () => {
    // The base line's runs are 8.7pt apart (under one em): the fraction stands between them all the same.
    expect(
      equationsOf([
        item("R =", { x: 100, y: BASE }),
        item("+ c", { x: 122.5, y: BASE }),
        item("a", { x: 118, y: UP }),
        item("b", { x: 118, y: DOWN }),
      ]),
    ).toEqual([{ text: "R = a / b + c" }]);
  });

  it("parenthesises a numerator or a denominator of several parts", () => {
    expect(
      equationsOf([
        item("R =", { x: 100, y: BASE }),
        item("I(ab)", { x: 140, y: UP }),
        item("+", { x: 173, y: UP }),
        item("J(ab)", { x: 190, y: UP }),
        item("m", { x: 160, y: DOWN }),
      ]),
    ).toEqual([{ text: "R = (I(ab) + J(ab)) / m" }]);
  });
});

describe("a nested fraction and a limit are written inside the stack (P9-15)", () => {
  // A mean over the sum of N terms: the base line `R =`; above it a ratio; below it `1` over `N`, then the sum.
  // The `1` is a 7pt script 3.4pt under the base line, which the fold takes into that line (P9-08), and it stands
  // a little way along from the `N` it is set over.
  const ratio = (y: number, x: number) => item("I(ab)/J(ab)", { x, y });

  it("writes `1` over `N` as a small fraction in the denominator, which is then parenthesised", () => {
    expect(
      equationsOf([
        item("R =", { x: 100, y: BASE }),
        script("1", 136, BASE - 3.4),
        ratio(UP, 133),
        item("N", { x: 126, y: DOWN }),
        script("n", 150, DOWN - 3),
        ratio(DOWN, 156),
      ]),
    ).toEqual([{ text: "R = I(ab)/J(ab) / (1/N n I(ab)/J(ab))" }]);
  });

  it.each([4.5, 5.5])(
    "sets `1` over `N` whichever row the fold gave it: %s pt under the base line it is a raised run of the denominator's row",
    (drop) => {
      // The fold gives a script to the nearest row within its window: past 3.5pt under the base line that is the
      // denominator's row, and the `1` is then a raised run of it, 5pt clear of the `N` beside it.
      expect(
        equationsOf([
          item("R =", { x: 100, y: BASE }),
          script("1", 136, BASE - drop),
          ratio(UP, 133),
          item("N", { x: 126, y: DOWN }),
          script("n", 150, DOWN - 3),
          ratio(DOWN, 156),
        ]),
      ).toEqual([{ text: "R = I(ab)/J(ab) / (1/N n I(ab)/J(ab))" }]);
    },
  );

  it("keeps the sum sign and its limit together: `1` is not set over the sign", () => {
    expect(
      equationsOf([
        item("R =", { x: 100, y: BASE }),
        script("1", 136, BASE - 3.4),
        ratio(UP, 133),
        item("N", { x: 126, y: DOWN }),
        item("Σ", { x: 142, y: DOWN }),
        script("n", 143.4, DOWN - 3),
        ratio(DOWN, 150),
      ]),
    ).toEqual([{ text: "R = I(ab)/J(ab) / (1/N Σn I(ab)/J(ab))" }]);
  });

  it("writes a limit that stands in a row of its own right after the sum sign", () => {
    // The `n` is 5.5pt under the sign's row: past the fold's reach, so a row of its own, tight under the denominator.
    expect(
      equationsOf([
        item("S =", { x: 100, y: BASE }),
        item("× 100", { x: 200, y: BASE }),
        item("I(ab)", { x: 150, y: UP }),
        item("Σ", { x: 146, y: DOWN }),
        item("I(ab)", { x: 156, y: DOWN }),
        script("n", 147.5, DOWN - 5.5),
      ]),
    ).toEqual([{ text: "S = I(ab) / Σn I(ab) × 100" }]);
  });

  it("writes a limit folded into the sign's row right after it too", () => {
    expect(
      equationsOf([
        item("S =", { x: 100, y: BASE }),
        item("× 100", { x: 200, y: BASE }),
        item("I(ab)", { x: 150, y: UP }),
        item("Σ", { x: 146, y: DOWN }),
        script("n", 147.5, DOWN - 3),
        item("I(ab)", { x: 156, y: DOWN }),
      ]),
    ).toEqual([{ text: "S = I(ab) / Σn I(ab) × 100" }]);
  });

  it("writes a limit under a sum sign that stands on the base line right after it, with no fraction at all", () => {
    // Two rows: the line `S = Σ I(ab)` and a limit 5.5pt below it. No stack, but the limit is still the sign's.
    expect(
      equationsOf([item("S =", { x: 100, y: BASE }), item("Σ", { x: 150, y: BASE }), item("I(ab)", { x: 160, y: BASE }), script("n", 151.5, BASE - 5.5)]),
    ).toEqual([{ text: "S = Σn I(ab)" }]);
  });
});

describe("an island's cells follow the lowered-label rule of the line (P9-13b inside P9-15)", () => {
  // A lowered word after a one-letter variable is a label and is written in brackets ("t" + "on" is `t(on)`): the rule
  // reads the row's lowered runs. An island row is cut into cells and each is read on its own, so the cell must be
  // given the row's lowered runs too, or the same label reads `ton` inside an equation and `t(on)` outside one.
  const label = (x: number, y: number) => [item("t", { x, y }), script("on", x + 4.6, y - 3)];

  it("writes a lowered label inside a cell of the base line as it is written in a sentence", () => {
    expect(
      equationsOf([
        item("Q(ab) =", { x: 100, y: BASE }),
        ...label(190, BASE),
        item("I(ab)", { x: 150, y: UP }),
        item("m I(ab)", { x: 148, y: DOWN }),
      ]),
    ).toEqual([{ text: "Q(ab) = I(ab) / m I(ab) t(on)" }]);
    // The same two runs in a sentence of the same page.
    const sentence = read([
      item("A Paper About Cathodes", { height: 17, y: 760 }),
      item("1 Methods", { y: 740 }),
      ...[726, 714, 702, 690, 678, 666].map(filler),
      item("The pulse is held for a time", { x: 100, y: 654 }),
      ...label(232, 654),
      item("of ten seconds.", { x: 245, y: 654 }),
      ...[642, 630, 618].map(filler),
    ]);
    expect(sentence.sections?.[0].text).toContain("held for a time t(on) of ten seconds.");
  });
});

describe("what is not a stack across a base line keeps the order the rows have (P9-15 guards)", () => {
  it("a two-line equation with no stack keeps its order", () => {
    expect(equationsOf([item("Q(ab) = × 100", { x: 100, y: BASE }), item("m I(ab)", { x: 148, y: DOWN })])).toEqual([
      { text: "Q(ab) = × 100\nm I(ab)" },
    ]);
  });

  it("a row above and a row below that share no span are not a fraction", () => {
    expect(
      equationsOf([
        item("I(ab)", { x: 300, y: UP }),
        item("Q(ab) =", { x: 100, y: BASE }),
        item("m I(ab)", { x: 100, y: DOWN }),
      ]),
    ).toEqual([{ text: "I(ab)\nQ(ab) =\nm I(ab)" }]);
  });

  it("a column of figures is not a fraction", () => {
    expect(equationsOf([item("12.5", { x: 100, y: UP }), item("8.25", { x: 100, y: BASE }), item("4.5", { x: 100, y: DOWN })])).toEqual([
      { text: "12.5\n8.25\n4.5" },
    ]);
  });

  it("an island with two rows that hold `=` has no base line to read against", () => {
    expect(
      equationsOf([item("I(ab)", { x: 120, y: UP }), item("Q = R", { x: 100, y: BASE }), item("S = T", { x: 120, y: DOWN })]),
    ).toEqual([{ text: "I(ab)\nQ = R\nS = T" }]);
  });

  it("a stack inside a sentence is still joined into it, top to bottom, as P9-09 wrote it", () => {
    const outline = read([
      item("A Paper About Cathodes", { height: 17, y: 760 }),
      item("1 Methods", { y: 740 }),
      ...[726, 714, 702, 690].map(filler),
      item("The coefficient is the ratio", { y: 678 }),
      item("I(ab)", { x: 150, y: 670 }),
      item("Q(ab) = × 100", { x: 100, y: 662 }),
      item("m I(ab)", { x: 148, y: 654 }),
      item("of the two quantities in every run of the sweep.", { y: 639 }),
      ...[627, 615, 603].map(filler),
    ]);
    expect(outline.equations).toBeUndefined();
    const sentence = (outline.sections?.[0].text ?? "").split("\n\n").filter((p) => p.includes("The coefficient is the ratio"));
    expect(sentence).toHaveLength(1);
    expect(sentence[0]).toContain("The coefficient is the ratio I(ab) Q(ab) = × 100 m I(ab) of the two quantities");
  });

  it("a numbered equation beside an island keeps its number, and the island stays unnumbered", () => {
    const equations = equationsOf(
      [
        item("Q(ab) =", { x: 100, y: BASE }),
        item("× 100", { x: 190, y: BASE }),
        item("I(ab)", { x: 150, y: UP }),
        item("m I(ab)", { x: 148, y: DOWN }),
      ],
      [item("W = m I(ab) (3)", { y: 591 }), ...[579, 567, 555].map(filler)],
    );
    expect(equations).toContainEqual({ text: "W = m I(ab)", number: "(3)" });
    expect(equations).toContainEqual({ text: "Q(ab) = I(ab) / m I(ab) × 100" });
    expect(equations).toHaveLength(2);
  });
});

describe("an island in the right column of a two-column page (P9-15)", () => {
  // The right column's lines are shifted to the left edge the left column stands at; the island's runs are not, and
  // the writer reads the runs, so a fraction in the right column is written the same.
  const prose = (n: number) => `Quillwort cathodes were annealed in air ${String(n).padStart(2, "0")} before runs.`.slice(0, 46);
  const items = [
    item("A Paper About Cathodes", { height: 17, y: 760, x: 50 }),
    item("1 Methods", { y: 740, x: 50 }),
    ...Array.from({ length: 24 }, (_, i) => item(prose(i), { x: 50, y: 700 - i * 14 })),
    ...Array.from({ length: 8 }, (_, i) => item(prose(i + 30), { x: 320, y: 700 - i * 14 })),
    item("The coefficient was obtained from the relation below.", { x: 320, y: 580 }),
    item("Q(ab) =", { x: 330, y: 560 }),
    item("× 100", { x: 420, y: 560 }),
    item("I(ab)", { x: 380, y: 568 }),
    item("m I(ab)", { x: 378, y: 552 }),
    item("Here the symbols are defined as follows, with every term in kelvin.", { x: 320, y: 536 }),
    ...Array.from({ length: 8 }, (_, i) => item(prose(i + 50), { x: 320, y: 522 - i * 14 })),
  ];

  it("writes the fraction of a right-column island at its gap", () => {
    // The page is read as two columns: the island's base line starts at the left column's edge plus its own indent.
    expect(linesOfPage({ page: 1, items }).find((line) => line.text === "Q(ab) = × 100")?.x).toBeLessThan(100);
    expect(buildOutline([{ page: 1, items }]).equations).toEqual([{ text: "Q(ab) = I(ab) / m I(ab) × 100" }]);
  });
});

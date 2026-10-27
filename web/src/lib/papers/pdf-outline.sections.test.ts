import { describe, expect, it } from "vitest";
import { buildOutline, type OutlineSection, type PdfPageText, type PdfTextItem } from "./pdf-outline";

// P12-51 (C, Theme C, §1h.426): section assembly. Three things the outline did to the parts of a paper
// that stand outside its named body, each on invented text only (a paper about quillwort cathodes; no
// sentence of any real paper):
//   O5  an end-matter heading ended the outline: what followed the references (Methods, a second block of
//       notes) and what followed a supporting-information line (acknowledgements, statements) was dropped;
//   O6  a paper that names neither an abstract nor an introduction had no row for its unheaded opening;
//   O8  the text of a figure's panels (axis labels, panel letters, tick strings) became rows and prose.
// The pages are one column, as the engine's other tests set them: a row is {text, kind, gap}.

type Kind =
  | "body" //     a line of the paper's prose, 10 pt, the body face
  | "head" //     a heading set larger (12 pt)
  | "num" //      a numbered heading in the body's size ("2 Results")
  | "sub" //      a sub-heading in the other face (11 pt)
  | "title" //    the paper's title (17 pt)
  | "author" //   the author line (11 pt, the other face)
  | "affil" //    the affiliation print (8.5 pt, the body face)
  | "summary" //  a summary paragraph set in the other face (10.5 pt)
  | "italic" //   a line in an italic face (an affiliation block)
  | "dropcap" //  a drop cap: one large letter on a baseline of its own (30 pt)
  | "panel"; //   a line of figure text, set small (7 pt)
interface Row {
  text: string;
  kind?: Kind;
  /** Points between this row's baseline and the one above it; the pitch is 14, a paragraph break 28. */
  gap?: number;
}

function item(str: string, at: Partial<PdfTextItem> = {}): PdfTextItem {
  return { str, height: 10, width: str.length * 4.6, fontName: "body", x: 100, y: 500, ...at };
}

const STYLE: Record<Kind, Partial<PdfTextItem>> = {
  body: {},
  head: { height: 12 },
  num: {},
  sub: { height: 11, fontName: "display" },
  title: { height: 17 },
  author: { height: 11, fontName: "display" },
  affil: { height: 8.5 },
  summary: { height: 10.5, fontName: "display" },
  italic: { fontName: "italic" },
  dropcap: { height: 30 },
  panel: { height: 7 },
};

function page(n: number, rows: Row[], top = 780): PdfPageText {
  let y = top;
  return {
    page: n,
    items: rows.map((row, i) => {
      y -= i === 0 ? 0 : (row.gap ?? 14);
      return item(row.text, { y, ...STYLE[row.kind ?? "body"] });
    }),
  };
}

const r = (text: string, kind: Kind = "body", gap?: number): Row => ({ text, kind, gap });
/** Lines of prose that run to full width; each is an invented sentence about the same subject. */
const prose = (...lines: string[]): Row[] => lines.map((text) => r(text));
/** The same, the first line set a paragraph apart from the row above. */
const para = (...lines: string[]): Row[] => lines.map((text, i) => r(text, "body", i === 0 ? 28 : undefined));

const INTRO = [
  "Quillwort cathodes degrade through slow loss of lithium at the grain edges of the film.",
  "We follow the loss over four hundred cycles and ask which edge goes first in each sample.",
  "The answer decides how the films are annealed before they are built into a cell.",
];
const RESULTS = [
  "The capacity of the annealed films held at ninety percent of its first value over the run.",
  "Films that were cooled quickly lost a third of their capacity before the hundredth cycle.",
  "The edges of the slow-cooled grains stayed whole under the microscope after the last cycle.",
];
const REFERENCES = [
  "[1] Someone, A. A paper about films. Journal of Films 12, 1-9 (2015).",
  "[2] Another, B. A second paper about cathodes. Journal of Cells 4, 22-30 (2016).",
];
const METHODS_ONE = [
  "Films were grown on polished steel discs in a furnace held at a fixed temperature.",
  "Each disc was weighed before and after growth and the mass gained was written down.",
  "Three discs from each batch were kept aside as controls and were never cycled.",
];
const METHODS_TWO = [
  "Cells were cycled between two voltages at a constant current in a sealed glove box.",
  "The current was set from the mass of each film and the cell was rested between cycles.",
  "Every cell was cycled until its capacity fell below half of the first value it showed.",
];

const sectionsOf = (pages: PdfPageText[]): OutlineSection[] => buildOutline(pages).sections ?? [];
const headingsOf = (pages: PdfPageText[]) => sectionsOf(pages).map((s) => s.heading);
const textOf = (pages: PdfPageText[]) => sectionsOf(pages).map((s) => s.text ?? "").join("\n\n");
const bucketsOf = (pages: PdfPageText[]) => sectionsOf(pages).map((s) => [s.heading, s.canonical]);

// ── O5: what follows an end-matter heading ──────────────────────────────────────────────────────────────

const BODY_ROWS: Row[] = [
  r("A Paper About Quillwort Cathodes", "title"),
  r("1 Introduction", "num", 20),
  ...prose(...INTRO),
  r("2 Results", "num", 20),
  ...prose(...RESULTS),
];
const BODY_HEADINGS = ["1 Introduction", "2 Results"];
const section = (heading: string, canonical: string, text: string): OutlineSection => ({ heading, canonical, page: 1, text });

/** (a) The references, then a Methods heading with two paragraphs, then two end-matter notes. */
const afterTheReferences = (): PdfPageText[] => [
  page(1, [
    ...BODY_ROWS,
    r("References", "head", 20),
    ...prose(...REFERENCES),
    r("Methods", "head", 20),
    ...prose(...METHODS_ONE),
    ...para(...METHODS_TWO),
    r("Data availability", "head", 20),
    r("The numbers behind every figure are kept with the authors and are shared on request."),
    r("Competing interests", "head", 20),
    r("The authors declare that they have no competing interests in this work."),
  ]),
];

/** The supporting-information line comes first and the acknowledgements and statements after it. */
const supportingFirst = (): PdfPageText[] => [
  page(1, [
    ...BODY_ROWS,
    r("Supporting Information", "head", 20),
    r("The Supporting Information is available free of charge from the publisher."),
    r("Acknowledgements", "head", 20),
    r("We thank the staff of the furnace room for their patience and their time."),
    r("Author Contributions", "head", 20),
    r("A.F. grew the films and B.L. cycled the cells; both wrote the paper."),
    r("Competing interests", "head", 20),
    r("The authors declare that they have no competing interests in this work."),
    r("References", "head", 20),
    ...prose(...REFERENCES),
  ]),
];

/** Methods after the references, with sub-headings of its own, then a note, then a block of affiliations. */
const methodsAfterReferences = (): PdfPageText[] => [
  page(1, [
    ...BODY_ROWS,
    r("References", "head", 20),
    ...prose(...REFERENCES),
    r("Methods", "head", 20),
    ...prose(...METHODS_ONE),
    r("Cell assembly", "sub", 20),
    ...prose(...METHODS_TWO),
    r("Statistics", "sub", 20),
    r("Every figure reports the mean of three cells and the spread between them."),
    r("Acknowledgements", "head", 20),
    r("We thank the staff of the furnace room for their patience and their time."),
    r("Ada Fenwick - Department of Films, University of Tarn", "italic", 20),
    r("Port Merrow, Tarn Province, a place the notes keep to themselves."),
  ]),
];

/** Reference entries that the page sets as numbered lines, some of them with an argument word in them. */
const referenceHeadings = (): PdfPageText[] => [
  page(1, [
    ...BODY_ROWS,
    r("References", "head", 20),
    r("12 Zhang, X. Methods for growing quillwort films on steel"),
    r("A second line of that entry, which carries the journal and the year of it."),
    r("13 Tarn, B. A model of grain-edge loss in cathodes (2019)"),
    r("A second line of that entry, which carries the journal and the year of it."),
  ]),
];

/** An appendix after the references stays where it was: out. */
const appendixAfterReferences = (): PdfPageText[] => [
  page(1, [
    ...BODY_ROWS,
    r("References", "head", 20),
    ...prose(...REFERENCES),
    r("Appendix A Proofs", "head", 20),
    r("Proof of the lemma follows from the triangle inequality applied twice over here."),
  ]),
];

/** The numbered Methods after the references, with a numbered sub-section of it. */
const numberedMethodsAfterReferences = (): PdfPageText[] => [
  page(1, [
    ...BODY_ROWS,
    r("References", "head", 20),
    ...prose(...REFERENCES),
    r("5 Methods", "num", 20),
    ...prose(...METHODS_ONE),
    r("5.1 Cell assembly", "num", 20),
    ...prose(...METHODS_TWO),
  ]),
];

/** (d) A numbered paper that names every part; its acknowledgements are the first end matter. */
const numberedPaper = (): PdfPageText[] => [
  page(1, [
    r("A Paper About Quillwort Cathodes", "title"),
    r("Ada Fenwick", "author", 20),
    r("Abstract", "head", 20),
    ...prose("Quillwort cathodes degrade slowly, and slow cooling after growth keeps their edges whole."),
    r("1 Introduction", "num", 20),
    ...prose(...INTRO),
    r("2 Methods", "num", 20),
    ...prose(...METHODS_ONE),
    r("3 Results", "num", 20),
    ...prose(...RESULTS),
    r("4 Conclusion", "num", 20),
    ...prose("Slow cooling keeps the grain edges whole, and the films keep their capacity for it."),
    r("Acknowledgements", "head", 20),
    r("We thank the staff of the furnace room for their patience and their time."),
    r("References", "head", 20),
    ...prose(...REFERENCES),
  ]),
];

describe("an end-matter heading no longer ends the outline (P12-51, O5)", () => {
  it("reads the Methods and the notes that follow the references, as sections", () => {
    // Before: the references ended the outline and the Methods and both notes were discarded.
    expect(sectionsOf(afterTheReferences())).toEqual([
      section("1 Introduction", "introduction", INTRO.join(" ")),
      section("2 Results", "results", RESULTS.join(" ")),
      section("Methods", "methods", `${METHODS_ONE.join(" ")}\n\n${METHODS_TWO.join(" ")}`),
      section("Data availability", "acknowledgments", "The numbers behind every figure are kept with the authors and are shared on request."),
      section("Competing interests", "acknowledgments", "The authors declare that they have no competing interests in this work."),
    ]);
  });

  it("keeps the reference entries out of the prose, as it always did", () => {
    const text = textOf(afterTheReferences());
    expect(text).not.toContain("Someone");
    expect(text).not.toContain("Another, B.");
    expect(text).not.toContain("Journal of");
  });

  it("reads the acknowledgements and statements that follow a supporting-information line", () => {
    // Before: the supporting-information line ended the outline and everything after it was discarded.
    expect(bucketsOf(supportingFirst())).toEqual([
      ["1 Introduction", "introduction"],
      ["2 Results", "results"],
      ["Acknowledgements", "acknowledgments"],
      ["Author Contributions", "acknowledgments"],
      ["Competing interests", "acknowledgments"],
    ]);
    const text = textOf(supportingFirst());
    expect(text).toContain("We thank the staff of the furnace room");
    expect(text).toContain("A.F. grew the films");
    expect(text).not.toContain("Someone");
  });

  it("still leaves the first end-matter heading, and the text under it, out", () => {
    // P7-18: the supporting-information line is the first end matter, so what it holds stays out...
    expect(textOf(supportingFirst())).not.toContain("Supporting Information is available");
    // ...and so does a first Acknowledgements, and what it holds.
    const first: Row[] = [...BODY_ROWS, r("Acknowledgements", "head", 20), r("We thank the staff of the furnace room for their patience.")];
    expect(headingsOf([page(1, first)])).toEqual(BODY_HEADINGS);
    expect(textOf([page(1, first)])).not.toContain("We thank");
  });

  it("reads the sub-headings of a Methods after the references as the body's, and its notes after it", () => {
    expect(bucketsOf(methodsAfterReferences())).toEqual([
      ["1 Introduction", "introduction"],
      ["2 Results", "results"],
      ["Methods", "methods"],
      ["Cell assembly", "body"],
      ["Statistics", "body"],
      ["Acknowledgements", "acknowledgments"],
    ]);
    expect(textOf(methodsAfterReferences())).toContain("Every figure reports the mean of three cells");
  });

  it("keeps a block of affiliations that follows a note out: a heading no bucket names reads nothing there", () => {
    const text = textOf(methodsAfterReferences());
    expect(text).not.toContain("Port Merrow");
    expect(headingsOf(methodsAfterReferences())).not.toContain("Ada Fenwick - Department of Films, University of Tarn");
  });

  it("gives a numbered Methods after the references, and its numbered sub-section, the methods bucket", () => {
    expect(bucketsOf(numberedMethodsAfterReferences()).slice(2)).toEqual([
      ["5 Methods", "methods"],
      ["5.1 Cell assembly", "methods"],
    ]);
  });

  it("does not open a section at a reference entry the page set as a heading, whatever word it holds", () => {
    // "Methods" and "model" would name a part of the argument; the comma after the authors and the year do not let them.
    expect(headingsOf(referenceHeadings())).toEqual(BODY_HEADINGS);
    expect(textOf(referenceHeadings())).not.toContain("second line of that entry");
  });

  it("leaves an appendix after the references out, as it always was", () => {
    expect(headingsOf(appendixAfterReferences())).toEqual(BODY_HEADINGS);
    expect(textOf(appendixAfterReferences())).not.toContain("triangle inequality");
  });

  it("files an end-matter part that no bucket names under the apparatus bucket", () => {
    const rows: Row[] = [
      ...BODY_ROWS,
      r("AUTHOR INFORMATION", "head", 20),
      r("Not read: this heading is the first end matter."),
      r("ASSOCIATED CONTENT", "head", 20),
      r("The online content of this paper is kept with the publisher."),
    ];
    expect(bucketsOf([page(1, rows)])).toEqual([...BODY_HEADINGS.map((h, i) => [h, ["introduction", "results"][i]]), ["ASSOCIATED CONTENT", "acknowledgments"]]);
  });

  it("reads a paper that names every part exactly as it did", () => {
    // (d) Byte-identical to the outline before P12-51: its acknowledgements are the first end matter and its references end it.
    expect(buildOutline(numberedPaper())).toEqual({
      title: "A Paper About Quillwort Cathodes",
      sections: [
        section("Abstract", "abstract", "Quillwort cathodes degrade slowly, and slow cooling after growth keeps their edges whole."),
        section("1 Introduction", "introduction", INTRO.join(" ")),
        section("2 Methods", "methods", METHODS_ONE.join(" ")),
        section("3 Results", "results", RESULTS.join(" ")),
        section("4 Conclusion", "conclusion", "Slow cooling keeps the grain edges whole, and the films keep their capacity for it."),
      ],
      figureCaptions: [],
      pageCount: 1,
      reason: null,
    });
  });
});

// ── O6: the opening of a paper that names no abstract or introduction ───────────────────────────────────────

const COVER: Row[] = [
  r("Slow Annealing Keeps Quillwort Films Whole", "title"),
  r("Ada Fenwick and Boris Lund", "author", 20),
  r("Department of Films, University of Tarn", "affil"),
  r("Institute of Cells, Port Merrow", "affil"),
];
const SUMMARY: Row[] = [
  r("Quillwort cathodes keep their capacity when the films are cooled slowly after growth", "summary", 20),
  r("and lose it when they are not, because the edges of the grains are spared the strain.", "summary"),
];
const OPENING_ONE = [
  "The work below tests that reading on forty films grown in one furnace over a single week.",
  "It reports the capacity of each film and the state of its grain edges after the last cycle.",
  "Nothing is claimed here about films grown in any other way than the one described.",
];

/** (b) A cover (title, authors, affiliations, a summary in another face), the paper's body-style opening in two
 *  paragraphs, then a descriptive heading: no part of it is called an abstract or an introduction. */
const unheadedOpening = (): PdfPageText[] => [
  page(1, [
    ...COVER,
    ...SUMMARY,
    ...INTRO.map((text, i) => r(text, "body", i === 0 ? 20 : undefined)),
    ...para(...OPENING_ONE),
    r("Slow cooling spares the grain edges", "head", 24),
    ...prose(...RESULTS),
  ]),
];

/** The same cover, but the paper names its introduction. */
const namedIntroduction = (): PdfPageText[] => [
  page(1, [
    ...COVER,
    ...SUMMARY,
    r("Introduction", "head", 24),
    ...prose(...INTRO),
    r("Slow cooling spares the grain edges", "head", 24),
    ...prose(...RESULTS),
  ]),
];

/** A paper with a title and prose and no heading at all. */
const headlessPaper = (): PdfPageText[] => [
  page(1, [r("A Survey of Quillwort Films", "title"), ...prose(...INTRO), ...para(...RESULTS), ...para(...METHODS_ONE)]),
];

/** A cover, then a real section heading directly over the first prose: nothing there is an opening. */
const coverThenHeading = (): PdfPageText[] => [
  page(1, [
    r("Slow Annealing Keeps Quillwort Films Whole", "title"),
    r("Ada Fenwick and Boris Lund", "author", 20),
    r("Department of Films, University of Tarn", "affil"),
    r("Slow cooling spares the grain edges", "head", 24),
    ...prose(...RESULTS),
    r("Discussion", "head", 24),
    ...prose(...METHODS_ONE),
  ]),
];

/** The opening starts with a drop cap: its first line, the large letter on a baseline of its own, the rest. */
const openingWithDropCap = (): PdfPageText[] => [
  page(1, [
    ...COVER,
    ...SUMMARY,
    r(INTRO[0], "body", 20),
    r("S", "dropcap", 12),
    r(INTRO[1]),
    r(INTRO[2]),
    ...para(...OPENING_ONE),
    r("Slow cooling spares the grain edges", "head", 24),
    ...prose(...RESULTS),
  ]),
];

/** The summary's last line has no full stop, so every line of the summary reads as a heading. */
const summaryWithoutFullStop = (): PdfPageText[] => [
  page(1, [
    ...COVER,
    r("Quillwort cathodes keep their capacity when the films are cooled slowly after growth", "summary", 20),
    r("and lose it when they are not, because the edges of the grains are spared the", "summary"),
    r("strain of the cooling that the quick films are put through", "summary"),
    ...INTRO.map((text, i) => r(text, "body", i === 0 ? 20 : undefined)),
    r("Slow cooling spares the grain edges", "head", 24),
    ...prose(...RESULTS),
  ]),
];

/** A real heading that wraps over two lines stands over the first prose. */
const wrappedHeadingOverProse = (): PdfPageText[] => [
  page(1, [
    r("Slow Annealing Keeps Quillwort Films Whole", "title"),
    r("Ada Fenwick and Boris Lund", "author", 20),
    r("Department of Films, University of Tarn", "affil"),
    r("Why Slow Cooling Spares the Grain Edges of the", "head", 24),
    r("Quillwort Films", "head", 14),
    ...prose(...RESULTS),
  ]),
];

/** Two body-style lines under the cover are a note, not an opening. */
const twoLinesOfProse = (): PdfPageText[] => [
  page(1, [
    ...COVER,
    ...SUMMARY,
    ...prose(INTRO[0], INTRO[1]),
    r("Slow cooling spares the grain edges", "head", 24),
    ...prose(...RESULTS),
  ]),
];

describe("a paper that names no abstract or introduction opens with its unheaded prose (P12-51, O6)", () => {
  it("emits the body-style paragraphs before the first heading as the first section, with no heading", () => {
    // Before: a row for the author line, one for the summary (as a heading) holding the introduction, and the third.
    const sections = sectionsOf(unheadedOpening());
    expect(sections).toEqual([
      { heading: undefined, canonical: "body", page: 1, text: `${INTRO.join(" ")}\n\n${OPENING_ONE.join(" ")}` },
      section("Slow cooling spares the grain edges", "body", RESULTS.join(" ")),
    ]);
    // The interface C P12-48's rule A1 reads: the first section, no heading, the bucket body.
    expect(sections[0].heading).toBeUndefined();
    expect(sections[0].canonical).toBe("body");
  });

  it("cuts the cover: the title, the authors, the affiliations and the summary are in no section", () => {
    const text = textOf(unheadedOpening());
    const headings = headingsOf(unheadedOpening()).join(" ");
    for (const cover of ["Fenwick", "Department of Films", "Institute of Cells", "Quillwort cathodes keep their capacity", "and lose it when they are not"]) {
      expect(text).not.toContain(cover);
      expect(headings).not.toContain(cover);
    }
  });

  it("keeps the first lines of the opening when a drop cap stands between them and the rest", () => {
    const sections = sectionsOf(openingWithDropCap());
    expect(sections[0].heading).toBeUndefined();
    expect(sections[0].text?.startsWith(INTRO[0])).toBe(true);
    expect(sections[0].text).toContain(INTRO[2]);
    expect(sections[0].text).not.toContain("Fenwick");
  });

  it("reads a summary of three heading lines as the cover, not as the heading of the opening", () => {
    const sections = sectionsOf(summaryWithoutFullStop());
    expect(sections[0].heading).toBeUndefined();
    expect(sections[0].text).toBe(INTRO.join(" "));
    expect(sections.map((s) => s.heading)).toEqual([undefined, "Slow cooling spares the grain edges"]);
  });

  it("leaves a paper that names its introduction exactly as it was", () => {
    // Byte-identical to the outline before P12-51: the introduction is the first named part and the cover above it is cut.
    expect(buildOutline(namedIntroduction())).toEqual({
      title: "Slow Annealing Keeps Quillwort Films Whole",
      sections: [
        section("Introduction", "introduction", INTRO.join(" ")),
        section("Slow cooling spares the grain edges", "body", RESULTS.join(" ")),
      ],
      figureCaptions: [],
      pageCount: 1,
      reason: null,
    });
  });

  it("leaves a paper with a title and no heading, and a real heading over the first prose, as they were", () => {
    expect(buildOutline(headlessPaper()).sections).toEqual([
      section("A Survey of Quillwort Films", "body", `${INTRO.join(" ")}\n\n${RESULTS.join(" ")}\n\n${METHODS_ONE.join(" ")}`),
    ]);
    expect(buildOutline(coverThenHeading()).sections).toEqual([
      section("Ada Fenwick and Boris Lund", "body", "Department of Films, University of Tarn"),
      section("Slow cooling spares the grain edges", "body", RESULTS.join(" ")),
      section("Discussion", "discussion", METHODS_ONE.join(" ")),
    ]);
  });

  it("does not take a heading of two lines for a cover, or two lines of prose for an opening", () => {
    const wrapped = sectionsOf(wrappedHeadingOverProse());
    expect(wrapped.map((s) => s.heading)).toEqual([
      "Ada Fenwick and Boris Lund",
      "Why Slow Cooling Spares the Grain Edges of the Quillwort Films",
    ]);
    expect(wrapped[1].text).toBe(RESULTS.join(" "));
    expect(sectionsOf(twoLinesOfProse()).every((s) => s.heading !== undefined)).toBe(true);
  });
});

// ── O8: the text of a figure's panels ────────────────────────────────────────────────────────────────────

/** (c) A figure: panel letters, tick strings and axis labels above its caption, between two paragraphs. */
const figurePage = (): PdfPageText[] => [
  page(1, [
    ...BODY_ROWS.slice(0, 5),
    r("a", "panel", 24),
    r("b", "panel", 10),
    r("3.6 3.4 3.2", "panel", 10),
    r("0 20 40 60 80", "panel", 10),
    r("Time (s)", "panel", 10),
    r("Voltage (V)", "panel", 10),
    r("Figure 2: Capacity of the films over the cycles.", "body", 12),
    ...para(...RESULTS),
  ]),
];

/** Figure text of the given lines, in the given kind, set `gap` apart, above a caption with a paragraph after it. */
const panelRun = (labels: string[], kind: Kind = "panel", gap = 10): PdfPageText[] => [
  page(1, [
    ...BODY_ROWS.slice(0, 5),
    ...labels.map((text, i) => r(text, kind, i === 0 ? 24 : gap)),
    r("Figure 2: Capacity of the films over the cycles.", "body", 12),
    ...para(...RESULTS),
  ]),
];

/** Short lines that read as headings by their shape ("5 Min": a number and a capital word), above a caption. */
const labelsLikeHeadings = (): PdfPageText[] => [
  page(1, [
    ...BODY_ROWS.slice(0, 5),
    r("5 Min", "body", 24),
    r("10 Min", "body", 14),
    r("20 Min", "body", 14),
    r("Figure 4: Capacity after five, ten and twenty minutes.", "body", 12),
    ...para(...RESULTS),
  ]),
];

/** A paragraph that ends on a short line (`last`), and a caption straight after it. */
const shortLastLine = (last: string): PdfPageText[] => [
  page(1, [
    r("A Paper About Quillwort Cathodes", "title"),
    r("1 Introduction", "num", 20),
    ...prose(
      "Quillwort cathodes degrade through slow loss of lithium at the grain edges of the film.",
      "We follow the loss over four hundred cycles and ask which edge goes first in each sample",
      last,
    ),
    r("Figure 3: Capacity of the films over the cycles.", "body", 14),
    ...para(...RESULTS),
  ]),
];

/** Three panel-style lines far from the one caption on the page. */
const panelLikeLinesFarFromACaption = (): PdfPageText[] => [
  page(1, [
    ...BODY_ROWS.slice(0, 5),
    r("a", "panel", 24),
    r("b", "panel", 14),
    r("c", "panel", 14),
    ...para(...RESULTS),
    ...para(...METHODS_ONE),
    ...para(...METHODS_TWO),
    ...para(...INTRO),
    ...para(...RESULTS),
    r("Figure 2: Capacity of the films over the cycles.", "body", 40),
  ]),
];

/** A caption that runs over three short lines of its own, none of them punctuated. */
const narrowCaption = (): PdfPageText[] => [
  page(1, [
    ...BODY_ROWS.slice(0, 5),
    r("Figure 5: Rates", "body", 24),
    r("of the new set", "body", 12),
    r("up to ten", "body", 12),
    r("on it", "body", 12),
    ...para(...RESULTS),
  ]),
];

describe("the text of a figure's panels is out of the prose and never a heading (P12-51, O8)", () => {
  const PANEL_STRINGS = ["Time (s)", "Voltage (V)", "0 20 40 60 80", "3.6 3.4 3.2"];

  it("leaves axis labels, tick strings and panel letters beside a caption out of the section's prose", () => {
    // Before: the labels were prose paragraphs ("0 20 40 60 80 Time (s)") and the panel letters an equation.
    const outline = buildOutline(figurePage());
    const text = (outline.sections ?? []).map((s) => s.text).join("\n\n");
    for (const label of PANEL_STRINGS) expect(text).not.toContain(label);
    expect(text).toBe(`${INTRO.join(" ")}\n\n${RESULTS.join(" ")}`);
    expect(outline.equations).toBeUndefined();
    expect(outline.figureCaptions).toEqual([
      { ordinal: 2, label: "Figure 2", caption: "Capacity of the films over the cycles.", page: 1 },
    ]);
  });

  it("never reads a short line of figure text as a heading, though its shape is a numbered heading's", () => {
    // Before: "5 Min", "10 Min" and "20 Min" were headings, and the last of them took the paragraph under the figure.
    expect(headingsOf(labelsLikeHeadings())).toEqual(["1 Introduction"]);
    expect(textOf(labelsLikeHeadings())).toBe(`${INTRO.join(" ")}\n\n${RESULTS.join(" ")}`);
  });

  it("keeps the short last line of a body paragraph in its paragraph, with or without a full stop, beside a caption", () => {
    // Required negative: one short line is not a run, and a caption right after it does not make it figure text.
    expect(textOf(shortLastLine("of the new set"))).toContain("in each sample of the new set\n\n");
    expect(textOf(shortLastLine("of the new set."))).toContain("in each sample of the new set.\n\n");
  });

  it("takes a run of three but not of two", () => {
    expect(textOf(panelRun(["a", "Time (s)", "Voltage (V)"], "panel", 14))).not.toMatch(/Time \(s\)|Voltage/);
    expect(textOf(panelRun(["a", "Time (s)"], "panel", 14))).toContain("a Time (s)");
  });

  it("takes a line of 25 characters or fewer, and not a longer one", () => {
    const short = "ab ".repeat(8).trim(); // 23 characters, no word of four letters
    const long = "ab ".repeat(9).trim(); // 26 characters
    expect(textOf(panelRun([short, short, short], "body", 14))).not.toContain(short);
    expect(textOf(panelRun([long, long, long], "body", 14))).toContain(long);
  });

  it("takes a line with no word of four letters, or any line set smaller than the body, and not a larger-word line at body size", () => {
    expect(textOf(panelRun(["to be on it", "as is, to us", "up to us all"], "body", 14))).not.toContain("to be on it");
    expect(textOf(panelRun(["Time axis", "Mass axis", "Cost axis"], "panel", 14))).not.toContain("Time axis");
    expect(textOf(panelRun(["Time axis", "Mass axis", "Cost axis"], "body", 14))).toContain("Time axis Mass axis Cost axis");
  });

  it("does not take a line that ends a sentence", () => {
    expect(textOf(panelRun(["a.", "b.", "c."], "panel", 14))).toContain("a. b. c.");
  });

  it("takes only what stands beside a caption, on the same page", () => {
    expect(textOf(panelLikeLinesFarFromACaption())).toContain("a b c");
  });

  it("leaves a caption's own lines to the caption, short as they are", () => {
    const outline = buildOutline(narrowCaption());
    expect(outline.figureCaptions?.[0]?.caption).toBe("Rates of the new set up to ten on it");
  });
});

// ── O5, the appendix: what is not read after the references although a heading's words name an argument part ─

/** Appendices numbered by letters, as a machine-learning paper prints them after its references. */
const lettersAfterReferences = (): PdfPageText[] => [
  page(1, [
    ...BODY_ROWS,
    r("Acknowledgements", "head", 20),
    r("We thank the staff of the furnace room for their patience and their time."),
    r("References", "head", 20),
    ...prose(...REFERENCES),
    r("A Proofs", "head", 20),
    r("Proof of the lemma follows from the triangle inequality applied twice over here."),
    r("B Additional Results", "head", 20),
    r("More cells were cycled and the extra curves are shown below for the reader."),
    r("C.1 Experimental Details", "sub", 20),
    r("Each cell was built in a glove box by the same hand on the same day of the week."),
  ]),
];

/** Words that name an argument part, under an appendix the paper does not call by a letter. */
const argumentWordsAfterAppendix = (): PdfPageText[] => [
  page(1, [
    ...BODY_ROWS,
    r("References", "head", 20),
    ...prose(...REFERENCES),
    r("Supplementary Material", "head", 20),
    r("Everything the paper could not hold is kept in this part of the file."),
    r("Additional results", "sub", 20),
    r("More cells were cycled and the extra curves are shown below for the reader."),
    r("Methods", "head", 20),
    r("Each cell was built in a glove box by the same hand on the same day of the week."),
  ]),
];

describe("an appendix after the references is not read although its headings name an argument part (P12-51, O5)", () => {
  it("leaves lettered appendix sections out, whatever words their headings hold", () => {
    expect(headingsOf(lettersAfterReferences())).toEqual(BODY_HEADINGS);
    const text = textOf(lettersAfterReferences());
    for (const appendixText of ["triangle inequality", "extra curves", "glove box"]) expect(text).not.toContain(appendixText);
  });

  it("reads no part of the argument after supplementary material, as it read nothing there before", () => {
    expect(headingsOf(argumentWordsAfterAppendix())).toEqual(BODY_HEADINGS);
    const text = textOf(argumentWordsAfterAppendix());
    for (const appendixText of ["kept in this part", "extra curves", "glove box"]) expect(text).not.toContain(appendixText);
  });

  it("still reads a Methods that follows the references when no appendix has begun", () => {
    expect(headingsOf(methodsAfterReferences())).toContain("Methods");
    expect(headingsOf(afterTheReferences())).toContain("Methods");
  });
});

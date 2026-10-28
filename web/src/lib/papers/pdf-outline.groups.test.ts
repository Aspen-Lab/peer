import { describe, expect, it } from "vitest";
import { buildOutline, type OutlineSection, type PdfPageText, type PdfTextItem } from "./pdf-outline";

// P12-75 (C, Theme C, B P12-73 M2): the group row of an unnumbered part. A paper that numbers nothing (a Nature-style
// paper: its results under descriptive headings, then "Methods" with no text of its own and its sub-headings set smaller)
// lost the "Methods" heading, because the outline kept an empty heading only when it was numbered; its sub-headings were
// then bucketed by their own words (`body`) and the roles ran on from the neighbours. Now a heading that is a part's whole
// name, has no number and no text keeps its row, with no words, at `level` 1; the unnumbered headings after it, set
// smaller by more than 0.3 pt, are its children at `level` 2 and take its bucket.
// Every fixture is invented (a paper about quillwort cathodes); the pages are one column, as the engine's other tests set
// them: a row is {text, kind, gap, size}.

type Kind =
  | "body" //   a line of the paper's prose, 10 pt, the body face
  | "head" //   a heading set larger (12 pt)
  | "num" //    a numbered heading in the body's size ("2 Methods")
  | "sub" //    a sub-heading in the other face (11 pt)
  | "title"; // the paper's title (17 pt)
interface Row {
  text: string;
  kind?: Kind;
  /** Points between this row's baseline and the one above it; the pitch is 14, a paragraph break 28. */
  gap?: number;
  /** The type size, where the case is the size itself. */
  size?: number;
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
};

function page(n: number, rows: Row[], top = 780): PdfPageText {
  let y = top;
  return {
    page: n,
    items: rows.map((row, i) => {
      y -= i === 0 ? 0 : (row.gap ?? 14);
      return item(row.text, { y, ...STYLE[row.kind ?? "body"], ...(row.size ? { height: row.size } : {}) });
    }),
  };
}

const r = (text: string, kind: Kind = "body", gap?: number, size?: number): Row => ({ text, kind, gap, size });
/** Lines of prose that run to full width; each is an invented sentence about the same subject. */
const prose = (...lines: string[]): Row[] => lines.map((text) => r(text));

const INTRO = [
  "Quillwort cathodes degrade through slow loss of lithium at the grain edges of the film.",
  "We follow the loss over four hundred cycles and ask which edge goes first in each sample.",
  "The answer decides how the films are annealed before they are built into a cell.",
];
const RESULTS_ONE = [
  "The capacity of the annealed films held at ninety percent of its first value over the run.",
  "Films that were cooled quickly lost a third of their capacity before the hundredth cycle.",
  "The edges of the slow-cooled grains stayed whole under the microscope after the last cycle.",
];
const RESULTS_TWO = [
  "Cooling at a faster rate opened seams along the grain edges that the slow rate never showed.",
  "The seams widened with every cycle and the capacity fell at the same pace as the seams grew.",
  "A film cooled quickly and then held warm for a day closed most of its seams again.",
];
const METHODS = [
  "Films were grown on polished steel discs in a furnace held at a fixed temperature.",
  "Each disc was weighed before and after growth and the mass gained was written down.",
  "Three discs from each batch were kept aside as controls and were never cycled.",
];
const NOTE = ["Any methods, extra references and statements of the authors are available in the online version."];
const END_ONE = ["The numbers behind every figure are kept with the authors and are shared on request."];
const END_TWO = ["The authors declare that they have no competing interests in this work."];

const TITLE = "Slow Annealing Keeps Quillwort Films Whole";
const SUBS = ["Film growth", "Cell assembly", "Cycling protocol", "Microscopy", "Statistics"];
/** A part heading, then each of its sub-headings over its prose, in the given sub-heading kind. */
const methodsPart = (name = "Methods", head: Kind = "head", sub: Kind = "sub", subs = SUBS): Row[] => [
  r(name, head, 20),
  ...subs.flatMap((text) => [r(text, sub, 20), ...prose(...METHODS)]),
];

const sectionsOf = (pages: PdfPageText[]): OutlineSection[] => buildOutline(pages).sections ?? [];
const rowsOf = (pages: PdfPageText[]) => sectionsOf(pages).map((s) => [s.heading, s.canonical, s.level, (s.text ?? "").length > 0]);

/** (a) A Nature-style paper: the opening with no heading, results under descriptive headings, "Methods" on the second
 *  page, then the end matter. */
const methodsAtTheEnd = (): PdfPageText[] => [
  page(1, [
    r(TITLE, "title"),
    ...prose(...INTRO),
    r("Slow cooling spares the grain edges", "head", 20),
    ...prose(...RESULTS_ONE),
    r("Fast cooling splits the film along its seams", "head", 20),
    ...prose(...RESULTS_TWO),
  ]),
  page(2, [
    ...methodsPart(),
    r("Data availability", "head", 20),
    ...prose(...END_ONE),
    r("Competing interests", "head", 20),
    ...prose(...END_TWO),
  ]),
];

/** (b) The same, with the journal's "Online content" note ahead of "Methods" (the order of other Nature-style papers). */
const methodsAfterTheNote = (): PdfPageText[] => [
  page(1, [
    r(TITLE, "title"),
    ...prose(...INTRO),
    r("Slow cooling spares the grain edges", "head", 20),
    ...prose(...RESULTS_ONE),
    r("Fast cooling splits the film along its seams", "head", 20),
    ...prose(...RESULTS_TWO),
    r("Online content", "head", 20),
    ...prose(...NOTE),
  ]),
  page(2, [
    ...methodsPart(),
    r("Data availability", "head", 20),
    ...prose(...END_ONE),
    r("Competing interests", "head", 20),
    ...prose(...END_TWO),
  ]),
];

describe("buildOutline — the group row of an unnumbered part (P12-75, M2)", () => {
  it("(a) keeps 'Methods' as a row with no words and gives its five sub-headings its bucket, one level down", () => {
    expect(rowsOf(methodsAtTheEnd())).toEqual([
      [TITLE, "body", undefined, true],
      ["Slow cooling spares the grain edges", "body", undefined, true],
      ["Fast cooling splits the film along its seams", "body", undefined, true],
      ["Methods", "methods", 1, false],
      ["Film growth", "methods", 2, true],
      ["Cell assembly", "methods", 2, true],
      ["Cycling protocol", "methods", 2, true],
      ["Microscopy", "methods", 2, true],
      ["Statistics", "methods", 2, true],
      ["Data availability", "acknowledgments", undefined, true],
      ["Competing interests", "acknowledgments", undefined, true],
    ]);
    const methods = sectionsOf(methodsAtTheEnd())[3];
    expect(methods.text).toBe("");
    expect(methods.page).toBe(2);
  });

  it("(b) does the same when the journal's 'Online content' note stands ahead of 'Methods'", () => {
    expect(rowsOf(methodsAfterTheNote())).toEqual([
      [TITLE, "body", undefined, true],
      ["Slow cooling spares the grain edges", "body", undefined, true],
      ["Fast cooling splits the film along its seams", "body", undefined, true],
      ["Online content", "acknowledgments", undefined, true],
      ["Methods", "methods", 1, false],
      ["Film growth", "methods", 2, true],
      ["Cell assembly", "methods", 2, true],
      ["Cycling protocol", "methods", 2, true],
      ["Microscopy", "methods", 2, true],
      ["Statistics", "methods", 2, true],
      ["Data availability", "acknowledgments", undefined, true],
      ["Competing interests", "acknowledgments", undefined, true],
    ]);
  });

  it("(c) makes no group of an empty descriptive heading, whatever is set smaller under it", () => {
    const pages = [
      page(1, [
        r(TITLE, "title"),
        ...prose(...INTRO),
        r("How the films were cooled", "head", 20),
        r("Slow cooling", "sub", 20),
        ...prose(...RESULTS_ONE),
        r("Fast cooling", "sub", 20),
        ...prose(...RESULTS_TWO),
      ]),
    ];
    expect(rowsOf(pages)).toEqual([
      [TITLE, "body", undefined, true],
      ["Slow cooling", "body", undefined, true],
      ["Fast cooling", "body", undefined, true],
    ]);
  });

  it("(c) keeps a part name that holds text of its own as it was: no group, and its sub-headings are not its children", () => {
    const pages = [
      page(1, [
        r(TITLE, "title"),
        ...prose(...INTRO),
        r("Methods", "head", 20),
        ...prose(...METHODS),
        r("Film growth", "sub", 20),
        ...prose(...METHODS),
      ]),
    ];
    expect(rowsOf(pages)).toEqual([
      [TITLE, "body", undefined, true],
      ["Methods", "methods", undefined, true],
      ["Film growth", "body", undefined, true],
    ]);
  });

  it("drops a part name that nothing smaller follows, as it drops any empty heading", () => {
    const pages = [
      page(1, [
        r(TITLE, "title"),
        ...prose(...INTRO),
        r("Slow cooling spares the grain edges", "head", 20),
        ...prose(...RESULTS_ONE),
        r("Methods", "head", 20),
        r("Data availability", "head", 20),
        ...prose(...END_ONE),
      ]),
    ];
    expect(sectionsOf(pages).map((s) => s.heading)).toEqual([TITLE, "Slow cooling spares the grain edges", "Data availability"]);
  });

  it("(d) leaves a numbered paper as it was: no row of it has a level", () => {
    const pages = [
      page(1, [
        r(TITLE, "title"),
        r("1 Introduction", "num", 20),
        ...prose(...INTRO),
        r("2 Results", "num", 20),
        ...prose(...RESULTS_ONE),
        r("3 Methods", "num", 20),
        r("3.1 Film growth", "num", 20),
        ...prose(...METHODS),
        r("3.2 Cell assembly", "num", 20),
        ...prose(...METHODS),
        r("Data availability", "head", 20),
        ...prose(...END_ONE),
      ]),
    ];
    const sections = sectionsOf(pages);
    expect(sections.map((s) => [s.heading, s.canonical])).toEqual([
      ["1 Introduction", "introduction"],
      ["2 Results", "results"],
      ["3 Methods", "methods"],
      ["3.1 Film growth", "methods"],
      ["3.2 Cell assembly", "methods"],
      ["Data availability", "acknowledgments"],
    ]);
    expect(sections.every((s) => !("level" in s))).toBe(true);
  });

  it("ends a group at a numbered heading: it gives it no bucket and no level", () => {
    const pages = [
      page(1, [
        r(TITLE, "title"),
        ...prose(...INTRO),
        r("Methods", "head", 20),
        r("Film growth", "sub", 20),
        ...prose(...METHODS),
        r("4 Notes on the furnace", "num", 20),
        ...prose(...METHODS),
        r("Cell assembly", "sub", 20),
        ...prose(...METHODS),
      ]),
    ];
    expect(rowsOf(pages)).toEqual([
      [TITLE, "body", undefined, true],
      ["Methods", "methods", 1, false],
      ["Film growth", "methods", 2, true],
      ["4 Notes on the furnace", "body", undefined, true],
      ["Cell assembly", "body", undefined, true],
    ]);
  });

  it("ends a group at a heading as large as its own, and at one that names a structural bucket", () => {
    const aslarge = [
      page(1, [
        r(TITLE, "title"),
        ...prose(...INTRO),
        r("Methods", "head", 20),
        r("Film growth", "sub", 20),
        ...prose(...METHODS),
        r("Why the seams matter", "head", 20),
        ...prose(...RESULTS_ONE),
        r("Cell assembly", "sub", 20),
        ...prose(...METHODS),
      ]),
    ];
    expect(rowsOf(aslarge)).toEqual([
      [TITLE, "body", undefined, true],
      ["Methods", "methods", 1, false],
      ["Film growth", "methods", 2, true],
      ["Why the seams matter", "body", undefined, true],
      ["Cell assembly", "body", undefined, true],
    ]);
    const strong = [
      page(1, [
        r(TITLE, "title"),
        ...prose(...INTRO),
        r("Methods", "head", 20),
        r("Film growth", "sub", 20),
        ...prose(...METHODS),
        r("Limitations", "sub", 20),
        ...prose(...RESULTS_ONE),
        r("Cell assembly", "sub", 20),
        ...prose(...METHODS),
      ]),
    ];
    expect(rowsOf(strong)).toEqual([
      [TITLE, "body", undefined, true],
      ["Methods", "methods", 1, false],
      ["Film growth", "methods", 2, true],
      ["Limitations", "limitations", undefined, true],
      ["Cell assembly", "body", undefined, true],
    ]);
  });

  it("takes a heading as a child only when it is smaller by more than 0.3 pt", () => {
    const sized = (size: number): PdfPageText[] => [
      page(1, [
        r(TITLE, "title"),
        ...prose(...INTRO),
        r("Methods", "head", 20),
        r("Film growth", "sub", 20, size),
        ...prose(...METHODS),
      ]),
    ];
    expect(rowsOf(sized(11.6)).map((row) => row[2])).toEqual([undefined, 1, 2]);
    expect(rowsOf(sized(11.8)).map((row) => row[2])).toEqual([undefined, undefined]);
  });

  it.each(["Methods", "METHODS", "Online methods", "Extended methods", "Materials and methods", "Experimental procedures", "Methodology"])(
    "reads '%s' as the name of a part",
    (name) => {
      const rows = rowsOf([page(1, [r(TITLE, "title"), ...prose(...INTRO), ...methodsPart(name, "head", "sub", SUBS.slice(0, 2))])]);
      expect(rows.map((row) => [row[1], row[2]])).toEqual([["body", undefined], ["methods", 1], ["methods", 2], ["methods", 2]]);
    },
  );

  it.each([
    ["Results", "results"],
    ["Results and discussion", "results"],
    ["Discussion", "discussion"],
    ["Conclusions", "conclusion"],
  ])("reads '%s' as the name of a part, and its children take the %s bucket", (name, bucket) => {
    const rows = rowsOf([
      page(1, [
        r(TITLE, "title"),
        ...prose(...INTRO),
        r(name, "head", 20),
        r("Slow cooling", "sub", 20),
        ...prose(...RESULTS_ONE),
        r("Fast cooling", "sub", 20),
        ...prose(...RESULTS_TWO),
      ]),
    ]);
    expect(rows.map((row) => [row[1], row[2]])).toEqual([["body", undefined], [bucket, 1], [bucket, 2], [bucket, 2]]);
  });

  it.each(["Methods for annealing thin films", "Our methods", "Model", "Methods summary", "Results of the cycling run"])(
    "does not read the descriptive heading '%s' as the name of a part",
    (name) => {
      const rows = rowsOf([page(1, [r(TITLE, "title"), ...prose(...INTRO), ...methodsPart(name, "head", "sub", SUBS.slice(0, 2))])]);
      expect(rows.every((row) => row[2] === undefined)).toBe(true);
      expect(rows.map((row) => row[0])).toEqual([TITLE, SUBS[0], SUBS[1]]);
    },
  );
});

// P12-75 (M5): a methods sub-heading that holds the word "experiments" was bucketed results by its words. Under a part's
// heading it takes the part's bucket (its own words are the weakest evidence, as a numbered child's are); on its own, with
// no part heading above it, its words name the procedure and file it as methods.
describe("buildOutline — a procedure's experiments are methods (P12-75, M5)", () => {
  const PROCEDURE = "Sample preparation and NMR experiments";

  it("files a sub-heading that holds 'experiments' under its part's bucket", () => {
    const rows = rowsOf([
      page(1, [r(TITLE, "title"), ...prose(...INTRO), ...methodsPart("Methods", "head", "sub", [PROCEDURE, "Cycling experiments"])]),
    ]);
    expect(rows.map((row) => [row[0], row[1], row[2]])).toEqual([
      [TITLE, "body", undefined],
      ["Methods", "methods", 1],
      [PROCEDURE, "methods", 2],
      ["Cycling experiments", "methods", 2],
    ]);
  });

  it("files a lone heading that names a procedure and its experiments as methods, and one that names only experiments as results", () => {
    const rows = rowsOf([
      page(1, [
        r(TITLE, "title"),
        ...prose(...INTRO),
        r(PROCEDURE, "head", 20),
        ...prose(...METHODS),
        r("Cycling experiments", "head", 20),
        ...prose(...RESULTS_ONE),
      ]),
    ]);
    expect(rows.map((row) => [row[0], row[1], row[2]])).toEqual([
      [TITLE, "body", undefined],
      [PROCEDURE, "methods", undefined],
      ["Cycling experiments", "results", undefined],
    ]);
  });
});

// P12-75 (M7): the part headed "Implications" between the last results and the named conclusion is the discussion.
describe("buildOutline — a part headed 'Implications' is the discussion (P12-75, M7)", () => {
  it("files 'Implications' under discussion, between the results and the conclusion", () => {
    const rows = rowsOf([
      page(1, [
        r(TITLE, "title"),
        ...prose(...INTRO),
        r("Slow cooling spares the grain edges", "head", 20),
        ...prose(...RESULTS_ONE),
        r("Implications", "head", 20),
        ...prose(...RESULTS_TWO),
        r("Conclusions", "head", 20),
        ...prose(...END_TWO),
      ]),
    ]);
    expect(rows.map((row) => [row[0], row[1]])).toEqual([
      [TITLE, "body"],
      ["Slow cooling spares the grain edges", "body"],
      ["Implications", "discussion"],
      ["Conclusions", "conclusion"],
    ]);
  });
});

// P12-75 (item 2, §1h.452): a bare "Experimental" heading, with only sub-headings under it, is the methods part. It was
// filed results by `^experiment…`, so the group row and every sub-heading under it took the results bucket.
describe("buildOutline — a bare 'Experimental' heading is a methods group (P12-75, item 2)", () => {
  it.each(["Experimental", "Experimental part"])("makes '%s' a methods group row and its sub-headings methods children", (name) => {
    const rows = rowsOf([page(1, [r(TITLE, "title"), ...prose(...INTRO), ...methodsPart(name, "head", "sub", SUBS.slice(0, 2))])]);
    expect(rows.map((row) => [row[0], row[1], row[2]])).toEqual([
      [TITLE, "body", undefined],
      [name, "methods", 1],
      [SUBS[0], "methods", 2],
      [SUBS[1], "methods", 2],
    ]);
  });

  it("keeps 'Experiments' with only sub-headings under it a results heading with no group (not a part name)", () => {
    const rows = rowsOf([page(1, [r(TITLE, "title"), ...prose(...INTRO), ...methodsPart("Experiments", "head", "sub", SUBS.slice(0, 2))])]);
    expect(rows.map((row) => [row[0], row[1], row[2]])).toEqual([
      [TITLE, "body", undefined],
      [SUBS[0], "body", undefined],
      [SUBS[1], "body", undefined],
    ]);
  });
});

import { describe, expect, it } from "vitest";
import { buildOutline, type PdfPageText, type PdfTextItem } from "./pdf-outline";

// P12-97 (C, Theme C, backlog O6; B P12-93): the text a figure prints in its panels - tick strings, axis titles,
// legend entries, panel titles - is the figure's, not the paper's paragraphs. Two rules widen what `figureTextOf`
// takes, each on invented text only (a paper about quillwort cathodes; no sentence of any real paper):
//   R-B  a line set smaller than the body may be up to 60 characters, not 25: an axis title or a legend entry in
//        the figure's own small face is as long as a line of a sentence;
//   R-A  a run of panel lines is beside a caption when only non-body lines lie between them, however tall the figure
//        (it was: within 8 body sizes of the caption).
// The body is 10 pt in the "body" face; a figure's text is 7 pt. A page is one column; a row is {text, kind, gap}.

type Kind =
  | "body" //   a line of the paper's prose, 10 pt
  | "title" //  the paper's title (17 pt)
  | "num" //    a numbered heading in the body's size ("2 Results")
  | "small" //  a line of figure text, set small (7 pt)
  | "larger" // a line a little larger than the body (11.5 pt): a panel title in the figure's face
  | "near"; //  a line a hair under the body (9.6 pt, within 5 %)
interface Row {
  text: string;
  kind?: Kind;
  /** Points between this row's baseline and the one above it; the pitch is 14, a paragraph break 28. */
  gap?: number;
}

function item(str: string, at: Partial<PdfTextItem> = {}): PdfTextItem {
  return { str, height: 10, width: str.length * 4.6, fontName: "body", x: 100, y: 500, ...at };
}

const HEIGHT: Record<Kind, number> = { body: 10, title: 17, num: 10, small: 7, larger: 11.5, near: 9.6 };

function page(n: number, rows: Row[], top = 780): PdfPageText {
  let y = top;
  return {
    page: n,
    items: rows.map((row, i) => {
      y -= i === 0 ? 0 : (row.gap ?? 14);
      return item(row.text, { y, height: HEIGHT[row.kind ?? "body"] });
    }),
  };
}

const r = (text: string, kind: Kind = "body", gap?: number): Row => ({ text, kind, gap });
/** Lines of prose that run to full width. */
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
const METHODS = [
  "Films were grown on polished steel discs in a furnace held at a fixed temperature.",
  "Each disc was weighed before and after growth and the mass gained was written down.",
  "Three discs from each batch were kept aside as controls and were never cycled.",
];
const CAPTION = "Figure 2: Capacity of the films over the cycles.";

/** The paper's opening, as every fixture below starts. */
const opening = (): Row[] => [r("A Paper About Quillwort Cathodes", "title"), r("1 Introduction", "num", 20), ...prose(...INTRO)];

const outlineOf = (pages: PdfPageText[]) => buildOutline(pages);
const textOf = (pages: PdfPageText[]) => (outlineOf(pages).sections ?? []).map((s) => s.text ?? "").join("\n\n");
const headingsOf = (pages: PdfPageText[]) => (outlineOf(pages).sections ?? []).map((s) => s.heading);
const PROSE = `${INTRO.join(" ")}\n\n${RESULTS.join(" ")}`;

/** `labels` set in `kind`, `gap` apart (a line of body size needs the pitch, 14, or its rows fold as a stack), above the
 *  caption, with a paragraph of results after it. */
const labelled = (labels: string[], kind: Kind = "small", gap = 10): PdfPageText[] => [
  page(1, [
    ...opening(),
    ...labels.map((text, i) => r(text, kind, i === 0 ? 24 : gap)),
    r(CAPTION, "body", 12),
    ...para(...RESULTS),
  ]),
];

/** Labels of 30 to 55 characters, as a figure's legend, axis titles and panel titles are: none of them ends a sentence. */
const LABELS = [
  "Mean discharge capacity per cycle",
  "Annealed at the slow cooling rate",
  "Cooled quickly in still air at once",
  "Capacity retained after cycle four hundred",
  "Grain edge loss measured by microscopy",
];

// ── R-B: a small line may be longer ──────────────────────────────────────────────────────────────────────

describe("a line set smaller than the body is figure text up to 60 characters (P12-97, R-B)", () => {
  it("leaves the small-type labels of a figure, 30 to 55 characters each, out of the prose", () => {
    for (const label of LABELS) expect(label.length).toBeGreaterThan(30);
    expect(Math.max(...LABELS.map((l) => l.length))).toBeLessThanOrEqual(55);
    // Before: each label was longer than 25 characters, so none was a panel line and every one stayed a paragraph.
    expect(textOf(labelled(LABELS))).toBe(PROSE);
    expect(outlineOf(labelled(LABELS)).figureCaptions).toEqual([
      { ordinal: 2, label: "Figure 2", caption: "Capacity of the films over the cycles.", page: 1 },
    ]);
  });

  it("takes an axis title that stands among tick strings, which it used to cut into runs of two", () => {
    const among = labelled(["0 20 40", "60 80", "Mean discharge capacity per cycle", "3.6 3.4", "3.2 3.0"]);
    expect(textOf(among)).toBe(PROSE);
  });

  it("takes a small line of 60 characters and not one of 61", () => {
    const sixty = "Capacity retained after the four hundredth cycle in the runs";
    expect(sixty).toHaveLength(60);
    expect(textOf(labelled([sixty, sixty, sixty]))).not.toContain(sixty);
    const over = `${sixty} x`;
    expect(over).toHaveLength(62);
    expect(textOf(labelled([over, over, over]))).toContain(over);
  });

  it("keeps the limit at 25 for a line at the body's size, and for one a hair under it", () => {
    const thirty = "so as to be on it if we go on"; // 29 characters, no word of four letters
    expect(thirty.length).toBeGreaterThan(25);
    expect(textOf(labelled([thirty, thirty, thirty], "body", 14))).toContain(thirty);
    expect(textOf(labelled([thirty, thirty, thirty], "near", 14))).toContain(thirty);
    // The same three lines are figure text at 25 or fewer, in either size.
    const short = "it is to be on it as a go"; // 25 characters
    expect(short).toHaveLength(25);
    expect(textOf(labelled([short, short, short], "body", 14))).not.toContain(short);
    expect(textOf(labelled([short, short, short], "near", 14))).not.toContain(short);
  });

  it("does not take a small line that ends a sentence, or a run of two", () => {
    const sentences = ["Capacity fell by a third in the first run.", "The slow cooled films kept their edges whole.", "Every cell was cycled to its last cycle."];
    for (const text of sentences) expect(text.length).toBeGreaterThan(25);
    expect(textOf(labelled(sentences))).toContain(sentences[0]);
    expect(textOf(labelled(LABELS.slice(0, 2)))).toContain(LABELS[0]);
  });

  it("keeps a heading a heading, and a caption a caption, with small labels beside them", () => {
    const pages = [
      page(1, [
        ...opening(),
        ...LABELS.map((text, i) => r(text, "small", i === 0 ? 24 : 10)),
        r(CAPTION, "body", 12),
        r("2 Results", "num", 24),
        ...prose(...RESULTS),
      ]),
    ];
    expect(headingsOf(pages)).toEqual(["1 Introduction", "2 Results"]);
    expect(textOf(pages)).toBe(PROSE);
    expect(outlineOf(pages).figureCaptions?.map((c) => c.label)).toEqual(["Figure 2"]);
  });

  it("keeps a small paragraph that stands nowhere near a caption", () => {
    const pages = [page(1, [...opening(), ...LABELS.map((text, i) => r(text, "small", i === 0 ? 28 : 10)), ...para(...RESULTS), ...para(...METHODS)])];
    expect(textOf(pages)).toContain(LABELS[0]);
  });
});

// ── R-A: the stretch to the caption ──────────────────────────────────────────────────────────────────────

/** Tick strings: panel lines of any size, none with a word of four letters. */
const TICKS = ["0.0 0.5 1.0", "1.5 2.0", "0 100 200", "300 400"];
/** A line at the body's size of 30 characters with words of four letters: not a panel line, and not a body line (40). */
const AXIS_TITLE = "Discharge capacity over cycles";
const FORTY = "Mean discharge capacity at the fifth one"; // 40 characters, at the body's size
const THIRTY_NINE = "Mean discharge capacity at the fifth on"; // 39 characters

/** A tall figure: its tick strings `distance` body sizes (10 pt) above its caption, nothing but the drawing between. */
const tall = (distance: number, ticks: Row[] = TICKS.map((t, i) => r(t, "small", i === 0 ? 24 : 14))): PdfPageText[] => [
  page(1, [...opening(), ...ticks, r(CAPTION, "body", distance * 10), ...para(...RESULTS)]),
];

describe("a run of panel lines is beside a caption when only non-body lines lie between (P12-97, R-A)", () => {
  it.each([10, 25, 40, 50])("takes tick strings %i body sizes above the caption of a tall figure", (distance) => {
    // Before: the run was beside a caption only within 8 body sizes of it, and these stayed paragraphs.
    expect(textOf(tall(distance))).toBe(PROSE);
    expect(outlineOf(tall(distance)).figureCaptions?.map((c) => c.label)).toEqual(["Figure 2"]);
  });

  it("takes tick strings at the body's size too: a short numeric line is not a body line", () => {
    const body = TICKS.map((t, i) => r(t, "body", i === 0 ? 24 : 14));
    expect(textOf(tall(40, body))).toBe(PROSE);
  });

  it("takes a run below a caption, a table's rows under its title, as far as the first body line", () => {
    const table = [page(1, [...opening(), r("Table 2: Capacity of the films over the cycles.", "body", 24), ...TICKS.map((t, i) => r(t, "small", i === 0 ? 400 : 14)), ...para(...RESULTS)])];
    expect(textOf(table)).toBe(PROSE);
  });

  it("passes the lines of the figure that are not panel lines, to reach a run beyond them", () => {
    // Two runs of ticks, an axis title between them (30 characters at the body's size: no panel line and no body line)
    // and the caption 40 body sizes under the first. The axis title stays where it is; both runs go.
    const rows: Row[] = [
      r(TICKS[0], "small", 24),
      r(TICKS[1], "small", 14),
      r(TICKS[2], "small", 14),
      r(AXIS_TITLE, "body", 14),
      r(TICKS[3], "small", 14),
      r("5 10 15", "small", 14),
      r("20 25", "small", 14),
    ];
    const text = textOf(tall(40, rows));
    expect(text).not.toMatch(/0\.0 0\.5|1\.5 2\.0|0 100 200|300 400|5 10 15|20 25/);
    expect(text).toContain(AXIS_TITLE);
  });

  it("stops at the first body line: a paragraph between the figure's text and its caption keeps the text a paragraph", () => {
    // The run is 12 body sizes above the caption in a straight line, but a paragraph of six lines of prose stands
    // between: the run is the end of the section above the figure, not the figure's text.
    const pages = [
      page(1, [
        ...opening(),
        ...TICKS.slice(0, 3).map((t, i) => r(t, "small", i === 0 ? 24 : 14)),
        ...para(...RESULTS, ...METHODS),
        r(CAPTION, "body", 28),
        ...para(...INTRO),
      ]),
    ];
    expect(textOf(pages)).toContain(TICKS.slice(0, 3).join(" "));
    expect(textOf(pages)).toContain(RESULTS[0]);
  });

  it("counts a body line from 40 characters, set within 5 % of the body's size", () => {
    expect(FORTY).toHaveLength(40);
    expect(THIRTY_NINE).toHaveLength(39);
    const between = (line: string, kind: Kind): PdfPageText[] => [
      page(1, [
        ...opening(),
        ...TICKS.slice(0, 3).map((t, i) => r(t, "small", i === 0 ? 24 : 14)),
        r(line, kind, 14),
        r(CAPTION, "body", 80),
        ...para(...RESULTS),
      ]),
    ];
    // 40 characters: a body line, so the stretch from the caption ends at it, and the run above it (94 points, more
    // than 8 body sizes, from the caption) stays. At 39 it is the figure's own line and the stretch goes on.
    expect(textOf(between(FORTY, "body"))).toContain(TICKS.slice(0, 3).join(" "));
    expect(textOf(between(FORTY, "near")), "9.6 pt is within 5 % of 10").toContain(TICKS.slice(0, 3).join(" "));
    expect(textOf(between(THIRTY_NINE, "body"))).not.toContain(TICKS[0]);
    expect(textOf(between(THIRTY_NINE, "body"))).toContain(THIRTY_NINE);
  });

  it("does not reach across a page: a run at the foot of one page is not beside the caption that opens the next", () => {
    // Page 1 ends on the run and a line of 30 characters at the body's size (a non-body line, so the stretch would go on
    // through it, and the line keeps the run from being the page's margin print); page 2 opens on a caption.
    const pages = [
      page(1, [...opening(), ...TICKS.slice(0, 3).map((t, i) => r(t, "small", i === 0 ? 24 : 14)), r(AXIS_TITLE, "body", 14)]),
      page(2, [r(CAPTION, "body"), ...para(...RESULTS)]),
    ];
    expect(textOf(pages)).toContain(TICKS.slice(0, 3).join(" "));
  });

  it("still takes the run within 8 body sizes of the caption, whatever stands between", () => {
    // The old reach, kept as one way to be beside a caption: a body line 4 body sizes above the caption does not take
    // the run beyond it out of reach.
    const pages = [
      page(1, [
        ...opening(),
        ...TICKS.slice(0, 3).map((t, i) => r(t, "small", i === 0 ? 24 : 14)),
        r(RESULTS[0], "body", 14),
        r(CAPTION, "body", 14),
        ...para(...RESULTS.slice(1)),
      ]),
    ];
    expect(textOf(pages)).not.toContain(TICKS[0]);
    expect(textOf(pages)).toContain(RESULTS[0]);
  });

  it("keeps a heading a heading and a caption a caption, with a tall figure beside them", () => {
    const pages = [
      page(1, [
        ...opening(),
        ...TICKS.map((t, i) => r(t, "small", i === 0 ? 24 : 14)),
        r(CAPTION, "body", 400),
        r("2 Results", "num", 24),
        ...prose(...RESULTS),
      ]),
    ];
    expect(headingsOf(pages)).toEqual(["1 Introduction", "2 Results"]);
    expect(textOf(pages)).toBe(PROSE);
    expect(outlineOf(pages).figureCaptions).toEqual([
      { ordinal: 2, label: "Figure 2", caption: "Capacity of the films over the cycles.", page: 1 },
    ]);
  });

  it("keeps a heading with a body-sized tick string above it, a heading", () => {
    const pages = [
      page(1, [
        ...opening(),
        r("2 Results", "num", 24),
        ...TICKS.map((t, i) => r(t, "small", i === 0 ? 24 : 14)),
        r(CAPTION, "body", 300),
        ...para(...RESULTS),
      ]),
    ];
    expect(headingsOf(pages)).toEqual(["1 Introduction", "2 Results"]);
    expect(textOf(pages)).toBe(PROSE);
  });
});

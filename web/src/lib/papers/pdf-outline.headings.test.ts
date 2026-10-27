import { describe, expect, it } from "vitest";
import {
  bodyStyle,
  buildOutline,
  type PdfLine,
  type PdfPageText,
  type PdfTextItem,
} from "./pdf-outline";

// P12-49 (Theme C, §1h.426): which lines of a PDF are headings. The body's size is the largest size that holds a
// real share of the paper's characters (not the size with the most); an address and a reference entry are no
// numbered heading; a running head is furniture whatever its column and its exact height; a drop cap and a
// run-in lead-in are no heading. Every text below is invented; no sentence of any paper.

/** A run of text on a page, as pdf.js hands it over. */
function item(str: string, at: Partial<PdfTextItem> = {}): PdfTextItem {
  return { str, height: 10, width: str.length * 4.6, fontName: "body", x: 100, y: 500, ...at };
}

function line(text: string, at: Partial<PdfLine> = {}): PdfLine {
  return { page: 1, text, x: 100, y: 500, size: 10, font: "body", ...at };
}

type Row = [string, Partial<PdfTextItem>?];
/** A page of rows, one under the other from the top. */
const pageOf = (n: number, rows: Row[], top = 780, pitch = 12): PdfPageText => ({
  page: n,
  items: rows.map(([text, at], i) => item(text, { y: top - i * pitch, ...at })),
});

const textOf = (pages: PdfPageText[]) => (buildOutline(pages).sections ?? []).map((s) => s.text).join(" ");

/** The rule the body size followed before P12-49: the size with the most characters, the face with the most. */
function legacyBodyStyle(lines: PdfLine[]): { size: number; font: string } {
  const bySize = new Map<number, number>();
  const byFont = new Map<string, number>();
  for (const l of lines) {
    bySize.set(l.size, (bySize.get(l.size) ?? 0) + l.text.length);
    byFont.set(l.font, (byFont.get(l.font) ?? 0) + l.text.length);
  }
  const top = <T,>(counts: Map<T, number>, fallback: T): T => [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? fallback;
  return { size: top(bySize, 10), font: top(byFont, "") };
}

/** `count` lines of `size` and `font`, each `width` characters wide. */
const block = (count: number, width: number, size: number, font = "body"): PdfLine[] =>
  Array.from({ length: count }, (_, i) => line("x".repeat(width), { size, font, y: 700 - i * 12 }));

/** (a) A paper whose methods, set at 7.5 pt, outweigh its 9.3 pt body: 36 lines of 62 characters against 16 of 55. */
function smallMethodsPaper(): { pages: PdfPageText[]; bodyLines: string[] } {
  // Lines the page broke: the ones that end on no punctuation are the ones a smaller "body" makes headings of.
  const bodyLines = [
    "Quillwort cathodes fade when the lattice strains under",
    "repeated cycling, and the fade can be slowed by a coating,",
    "that carries part of the strain away from the grain edges",
    "of each film, so that the cell keeps most of its charge,",
    "through the first thousand cycles of the slow test",
    "run at the rate the supplier gave for the coin cells,",
    "and then fades along a curve that the model below",
    "describes with one rate constant for every film we made,",
    "in the bench series, the thin ones and the thick ones",
    "alike, as the figure for the whole series shows at,",
    "the end of this section of the paper where the data",
    "are laid out for each of the cells in the same order,",
    "as the cycling table gives them for the reader who",
    "wants to follow the argument cell by cell through the,",
    "series before turning to the methods that follow it.",
    "The rest of the paper takes up the grains in turn.",
  ];
  const methodLines = Array.from({ length: 36 }, (_, i) => `Cells ${i} were assembled in an argon filled glovebox with less than`);
  const page = pageOf(
    1,
    [
      ["Quillwort Cathodes Under Strain", { height: 17 }],
      ["1 Introduction", { height: 9.3 }],
      ...bodyLines.map((text): Row => [text, { height: 9.3 }]),
      ["2 Methods", { height: 9.3 }],
      ...methodLines.map((text): Row => [text, { height: 7.5 }]),
    ],
    780,
    10,
  );
  return { pages: [page], bodyLines };
}

// ── Rule 1 (O1): the body is the largest size that holds a real share of the paper's words ──────────────

describe("bodyStyle — the body is the largest size holding 35 % of the heaviest size's characters (P12-49, O1)", () => {
  it("takes the 9.3 pt body of a paper whose methods, references and captions, set at 7.5 pt, outweigh it", () => {
    // 36 lines x 62 characters at 7.5 pt (2,232) against 16 x 55 at 9.3 pt (880): 39 %.
    const lines = [...block(36, 62, 7.5), ...block(16, 55, 9.3), line("A Paper Title", { size: 17 })];
    expect(bodyStyle(lines)).toEqual({ size: 9.3, font: "body" });
    expect(legacyBodyStyle(lines).size).toBe(7.5);
  });

  it("holds the line at 35 %: a size with 840 of 2,400 characters is the body, one with 832 is not", () => {
    const heavy = block(24, 100, 7.5); // 2,400
    expect(bodyStyle([...heavy, ...block(8, 105, 9.3)]).size).toBe(9.3); // 840 = 35.0 %
    expect(bodyStyle([...heavy, ...block(8, 104, 9.3)]).size).toBe(7.5); // 832 = 34.7 %
  });

  it("leaves a paper whose heaviest size is its body as it was", () => {
    const papers: PdfLine[][] = [
      // the body, a title, a heading size, small captions
      [...block(40, 70, 10), ...block(2, 40, 18), ...block(6, 30, 12), ...block(10, 50, 8)],
      // a larger abstract and a smaller reference list, neither near a third of the body
      [...block(60, 66, 9), ...block(4, 80, 10), ...block(12, 60, 7.5)],
      // one size throughout
      block(30, 60, 11),
    ];
    for (const lines of papers) expect(bodyStyle(lines)).toEqual(legacyBodyStyle(lines));
    expect(bodyStyle(papers[0]).size).toBe(10);
    expect(bodyStyle(papers[1]).size).toBe(9);
  });

  it("takes the face of the body's own size, not the face with the most characters overall", () => {
    const lines = [...block(40, 70, 7.5, "small"), ...block(20, 60, 9.3, "serif"), ...block(3, 20, 9.3, "bold")];
    expect(bodyStyle(lines)).toEqual({ size: 9.3, font: "serif" });
    expect(legacyBodyStyle(lines).font).toBe("small");
  });

  it("does not take a title of three lines for the body of a short page", () => {
    // Three 18 pt lines (176 characters) against six 11 pt ones (223): the title is no body.
    const lines = [...block(3, 59, 18), ...block(6, 37, 11)];
    expect(bodyStyle(lines).size).toBe(11);
  });

  it("reads a paper whose small-type methods outweigh the body without a heading per short line", () => {
    const { pages, bodyLines } = smallMethodsPaper();
    const outline = buildOutline(pages);
    // The body is the 9.3 pt type; the 7.5 pt methods are not "the body" with every body line bigger than it.
    expect(outline.sections?.map((s) => s.heading)).toEqual(["1 Introduction", "2 Methods"]);
    const intro = outline.sections?.[0].text ?? "";
    for (const text of bodyLines) expect(intro).toContain(text.split(" ").slice(0, 4).join(" "));
    expect(outline.sections?.[1].text).toContain("Cells 35 were assembled");
  });
});

// ── The margin print the O1 repair meets ─────────────────────────────────────────────────────────────────

describe("margin print is a few rows, not a section set small (P12-49, O1)", () => {
  it("keeps a methods section of small type that stands below the page's last full-size line", () => {
    const rows: Row[] = [
      ["Quillwort Cathodes Under Strain", { height: 17 }],
      ["1 Introduction"],
      ...Array.from({ length: 10 }, (_, i): Row => [`Quillwort cathodes fade when strained, as row ${i} of the introduction shows.`]),
      ["2 Methods"],
      ...Array.from({ length: 12 }, (_, i): Row => [`Small methods row ${i} says how the cells were assembled and cycled.`, { height: 7 }]),
    ];
    const text = textOf([pageOf(1, rows, 780, 10)]);
    expect(text).toContain("Small methods row 0");
    expect(text).toContain("Small methods row 11");
  });

  it("still drops a footer of a few rows", () => {
    const rows: Row[] = [
      ["Quillwort Cathodes Under Strain", { height: 17 }],
      ["1 Introduction"],
      ...Array.from({ length: 10 }, (_, i): Row => [`Quillwort cathodes fade when strained, as row ${i} of the introduction shows.`]),
    ];
    const page = pageOf(1, rows, 780, 12);
    page.items.push(item("© 2026 Example Society https://doi.org/10.1000/example.2026", { y: 34, height: 6.3 }));
    expect(textOf([page])).not.toContain("Example Society");
  });
});

import { describe, expect, it } from "vitest";
import {
  bodyStyle,
  buildOutline,
  furnitureOf,
  headingOf,
  isDropCap,
  isFurniture,
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

const BODY = { size: 10, font: "body" };

type Row = [string, Partial<PdfTextItem>?];
/** A page of rows, one under the other from the top. */
const pageOf = (n: number, rows: Row[], top = 780, pitch = 12): PdfPageText => ({
  page: n,
  items: rows.map(([text, at], i) => item(text, { y: top - i * pitch, ...at })),
});

const headingsOf = (pages: PdfPageText[]) => (buildOutline(pages).sections ?? []).map((s) => s.heading);
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

/** (b) A first page with an affiliation block (street addresses) set between the halves of the introduction, and
 *  a reference list whose heading is not set apart, so nothing stops the numbered entries. */
function affiliationsAndReferences(): PdfPageText[] {
  const prose = (text: string): Row => [text];
  return [
    pageOf(1, [

    ["Quillwort Cathodes Under Strain", { height: 17 }],
    ["Abstract", { height: 12 }],
    prose("Quillwort cathodes fade through chemistry and strain together."),
    ["1 Introduction", { fontName: "display" }],
    prose("Quillwort cathodes are an important class of cathode materials for cells."),
    prose("They are used in cells of every size, from watches to grid stores."),
    // the footnote block of the first page, set small, between the two halves of the introduction
    ["1 Department of Materials Science, University of Elmstead, Fenwick 12345", { height: 7.5 }],
    ["2 Institute of Invented Results, 12 Quarry Lane, Elmstead, Fenwick", { height: 7.5 }],
    ["3 Quarry Lane Laboratory 14 Fenwick Road Elmstead 62704", { height: 7.5 }],
    prose("The rest of the introduction sets out the questions the paper answers."),
    prose("It names the cells, the series and the order of the sections that follow."),
    ["2 Methods", { fontName: "display" }],
    prose("Cells were assembled in an argon filled glovebox with less than one part."),
    prose("They were cycled at twenty five degrees at the rate the supplier gave."),
    ["3 Conclusions", { fontName: "display" }],
    prose("The coating slows the fade of every film in the series of cells."),
    prose("The next step is to test the thick films in the same way as these."),
    // the heading of the list is not set apart, and no heading stops it: the entries stand where they stand
    prose("References"),
    ["1 Smith, J. A.; Doe, B. Growth of quillwort films. J. Invented Res.", { height: 8 }],
    prose("2015, 12, 345."),
    ["2 Zhang Q, Li W, Wu H. Strain in cathodes. Fenwick Mater. 2019, 4, 12.", { height: 8 }],
    prose("A second line of the entry."),
    ["3. J. A. Smith, B. Doe, Cathode letters, Elmstead Phys. 2020, 8, 1.", { height: 8 }],
    prose("A second line of the entry."),
    ]),
  ];
}

// ── Rule 2 (O3): an address and a reference entry are no numbered heading ────────────────────────────────

describe("headingOf — a street address is no numbered heading (P12-49, O3)", () => {
  it("refuses a number, capitalised words and a comma", () => {
    expect(headingOf(line("12 Quarry Lane, Fenwick Hall, Elmstead"), BODY)).toBeNull();
    expect(headingOf(line("1 Department of Materials Science, University of Elmstead"), BODY)).toBeNull();
    expect(headingOf(line("77 Quillwort Avenue, Fenwick"), BODY)).toBeNull();
  });

  it("refuses a number, capitalised words and a postal code", () => {
    expect(headingOf(line("5 Hamilton Court Springfield IL 62704"), BODY)).toBeNull();
    expect(headingOf(line("9 Quarry Lane Laboratory Elmstead AB1 2CD"), BODY)).toBeNull();
  });

  it("still takes a section number with its point, whatever commas the heading has", () => {
    expect(headingOf(line("2.3. Electrochemical Growth of Twinned, Coincident Site Lattice Interfaces"), BODY)).toBe(
      "2.3. Electrochemical Growth of Twinned, Coincident Site Lattice Interfaces",
    );
    expect(headingOf(line("4. Synthesis, Characterization, and Testing"), BODY)).toBe("4. Synthesis, Characterization, and Testing");
  });

  it("still takes a heading set larger than the body, comma or not", () => {
    expect(headingOf(line("3 Synthesis, Characterization and Testing", { size: 12 }), BODY)).toBe("3 Synthesis, Characterization and Testing");
  });

  it("still takes a plain numbered heading without a comma or a code", () => {
    expect(headingOf(line("2 Experimental Methods"), BODY)).toBe("2 Experimental Methods");
    expect(headingOf(line("3 Results and Discussion"), BODY)).toBe("3 Results and Discussion");
  });
});

describe("headingOf — a reference entry is no numbered heading (P12-49, O3)", () => {
  it("refuses the first line of an entry that opens with its authors", () => {
    expect(headingOf(line("17 Smith, J. A.; Doe, B. Growth of quillwort films"), BODY)).toBeNull();
    expect(headingOf(line("3. J. A. Smith, B. Doe, Cathode letters of the series"), BODY)).toBeNull();
    expect(headingOf(line("12 Zhang Q, Li W, Wu H. Strain in the cathode grains"), BODY)).toBeNull();
    expect(headingOf(line("8. Lopez, M. et al. Slow annealing of quillwort films"), BODY)).toBeNull();
  });

  it("still takes a heading with a name in it, and a dotted number with words", () => {
    expect(headingOf(line("4 Smith's Model of Cathode Fade"), BODY)).toBe("4 Smith's Model of Cathode Fade");
    expect(headingOf(line("4.5 Macrotexture Analysis"), BODY)).toBe("4.5 Macrotexture Analysis");
  });
});

describe("a numbered line is a heading only when its number continues the paper's numbering (P12-49, O3)", () => {
  /** A paper of numbered sections 1 to 3, set in the body's face (as the fixtures of this suite do), a list under
   *  the third and a fourth section after it. The lines are in the order the paper prints them. */
  const sections = [
    line("Abstract", { size: 12, y: 700 }),
    line("1 Introduction", { y: 680 }),
    line("2 Methods", { y: 660 }),
    line("3 Results", { y: 640 }),
    line("1 Mix the powders by hand", { y: 620 }),
    line("2 Anneal at eight hundred degrees", { y: 600 }),
    line("4 Conclusions", { y: 580 }),
    ...block(30, 70, 10).map((l, i) => ({ ...l, y: 560 - i * 12 })),
  ];
  const style = bodyStyle(sections);
  const [, intro, methods, results, mix, anneal, conclusions] = sections;

  it("takes the next number and the sub-numbers of the current one", () => {
    expect(headingOf(intro, style)).toBe("1 Introduction");
    expect(headingOf(methods, style)).toBe("2 Methods");
    expect(headingOf(results, style)).toBe("3 Results");
    expect(headingOf(conclusions, style)).toBe("4 Conclusions");
    const sub = [
      line("Abstract", { size: 12, y: 700 }),
      line("1 Introduction", { y: 680 }),
      line("2 Methods", { y: 660 }),
      line("2.1 Cell Design", { y: 640 }),
      line("2.2 Cell Cycling", { y: 620 }),
      line("2.2.1 Rates Used", { y: 600 }),
      line("3 Results", { y: 580 }),
      line("3.1 Fade of the Films", { y: 560 }),
      ...block(30, 70, 10).map((l, i) => ({ ...l, y: 540 - i * 12 })),
    ];
    const subStyle = bodyStyle(sub);
    expect(sub.slice(1, 8).map((l) => headingOf(l, subStyle))).toEqual(sub.slice(1, 8).map((l) => l.text));
  });

  it("refuses a number that goes back: a list under a section, whatever its words", () => {
    expect(headingOf(mix, style)).toBeNull();
    expect(headingOf(anneal, style)).toBeNull();
    // without the paper around them the same lines read as they always did
    expect(headingOf(mix, BODY)).toBe("1 Mix the powders by hand");
  });

  it("goes on past a heading that skipped some numbers, and past a far one", () => {
    const skipping = [line("Abstract", { size: 12 }), line("1 Introduction"), line("6 Acknowledgements"), line("20 Extras Appended Late")];
    const skippingStyle = bodyStyle([...skipping, ...block(30, 70, 10)]);
    expect(headingOf(skipping[2], skippingStyle)).toBe("6 Acknowledgements");
    expect(headingOf(skipping[3], skippingStyle)).toBe("20 Extras Appended Late");
  });

  it("counts the numbering from the paper's first named part, not from its cover", () => {
    const cover = [
      line("7 Invented Institute of Results", { y: 760 }),
      line("Abstract", { size: 12, y: 740 }),
      line("1 Introduction", { y: 720 }),
      line("2 Methods", { y: 700 }),
      ...block(30, 70, 10),
    ];
    const coverStyle = bodyStyle(cover);
    expect(headingOf(cover[2], coverStyle)).toBe("1 Introduction");
    expect(headingOf(cover[3], coverStyle)).toBe("2 Methods");
  });

  it("does not turn a heading set apart away because a stray line took its number before it", () => {
    // The paper's headings are in the body's face here: the stray "2 ..." moves the numbering, the real "2" is set apart.
    const stray = [
      line("Abstract", { size: 12, y: 760 }),
      line("1 Introduction", { y: 740 }),
      line("2 Institute of Invented Results Elmstead", { size: 8, y: 720 }),
      line("2 Results and Discussion", { font: "display", y: 700 }),
      line("3 Conclusions", { font: "display", y: 680 }),
      ...block(30, 70, 10),
    ];
    const strayStyle = bodyStyle(stray);
    expect(headingOf(stray[3], strayStyle)).toBe("2 Results and Discussion");
    expect(headingOf(stray[4], strayStyle)).toBe("3 Conclusions");
  });

  it("holds the numbering a set-apart heading gave: a stray after it neither moves it nor takes a real number", () => {
    const set = [
      line("Abstract", { size: 12, y: 760 }),
      line("1 Introduction", { font: "display", y: 740 }),
      line("2 Institute of Invented Results Elmstead", { size: 8, y: 720 }),
      line("3 School of Quillwort Studies Fenwick", { size: 8, y: 710 }),
      line("2 Results and Discussion", { font: "display", y: 700 }),
      line("3 Conclusions", { font: "display", y: 680 }),
      // an entry list in the face of a heading, numbered from one again
      line("1 Journal of Invented Results Volume 12", { font: "display", y: 660 }),
      line("2 Quillwort Society Reports Series Nine", { font: "display", y: 648 }),
      ...block(30, 70, 10),
    ];
    const setStyle = bodyStyle(set);
    expect(headingOf(set[4], setStyle)).toBe("2 Results and Discussion");
    expect(headingOf(set[5], setStyle)).toBe("3 Conclusions");
    expect(headingOf(set[6], setStyle)).toBeNull();
    expect(headingOf(set[7], setStyle)).toBeNull();
  });
});

describe("no line inside a references section is a numbered heading (P12-49, O3)", () => {
  const list = [
    line("Abstract", { size: 12, y: 800 }),
    line("1 Introduction", { y: 780 }),
    line("2 Conclusions", { y: 760 }),
    line("References", { size: 12, y: 740 }),
    // entries a number and a capital open, in no author shape: only their place says what they are. RE-AIMED
    // (P12-49, with P12-51): the first read "...Invented Results Volume 12..."; its plain words (eight, no comma,
    // no year) name a part of the argument, which now ends the list ("5 Methods" after the references), so the
    // entry names no part here.
    line("3 Journal of Invented Studies Volume 12 Pages 345", { size: 8, y: 720 }),
    line("4 Another Odd Entry Title Held Here For The Test", { size: 8, y: 708 }),
    line("5 Quillwort Society Reports Series Number Nine", { size: 8, y: 696 }),
    line("6 Appendix Proofs Of The Lemmas", { size: 12, y: 600 }),
    ...block(30, 70, 10),
  ];
  const style = bodyStyle(list);

  it("refuses an entry, however it reads, from the references heading to the next heading", () => {
    for (const entry of list.slice(4, 7)) expect(headingOf(entry, style), entry.text).toBeNull();
    // without the paper around them the same words, at the body's size, are a numbered heading, as they were.
    // RE-AIMED (C P12-74, R1): the entry is set at 8 pt, 0.8 of the 10 pt body, and a numbered line under 0.95 of the
    // body is no heading even alone (an axis tick, a legend, a small entry); the in-paper assertion above is untouched.
    expect(headingOf(list[4], BODY)).toBeNull();
    expect(headingOf({ ...list[4], size: 10 }, BODY)).toBe("3 Journal of Invented Studies Volume 12 Pages 345");
  });

  it("takes the numbered heading that follows the list, set apart as a heading", () => {
    expect(headingOf(list[7], style)).toBe("6 Appendix Proofs Of The Lemmas");
  });

  it("takes the heading itself, numbered or not", () => {
    expect(headingOf(list[3], style)).toBe("References");
    const numbered = [...list];
    numbered[3] = line("3 References", { size: 12, y: 740 });
    const numberedStyle = bodyStyle(numbered);
    expect(headingOf(numbered[3], numberedStyle)).toBe("3 References");
    expect(headingOf(numbered[4], numberedStyle)).toBeNull();
  });
});

describe("a plain numbered heading that names a part ends the references, an entry does not (P12-49, O3, with P12-51)", () => {
  // A journal prints its Methods after the references, numbered, in the body's size and face.
  const list = [
    line("Abstract", { size: 12, y: 800 }),
    line("1 Introduction", { y: 780 }),
    line("2 Results", { y: 760 }),
    line("References", { size: 12, y: 740 }),
    line("3 Journal of Invented Studies Volume 12 Pages 345", { size: 8, y: 720 }),
    line("4 Methods in Cathode Research, Elmstead Press 2020", { size: 8, y: 708 }),
    line("5 Methods", { y: 600 }),
    line("5.1 Cell assembly", { y: 588 }),
    line("6 Smith, J. (2020) Methods for cathode films", { y: 570 }),
    line("7 Acknowledgements", { y: 540 }),
    ...block(30, 70, 10),
  ];
  const style = bodyStyle(list);

  it("takes '5 Methods' after the references, and its numbered sub-section", () => {
    expect(headingOf(list[6], style)).toBe("5 Methods");
    expect(headingOf(list[7], style)).toBe("5.1 Cell assembly");
  });

  it("takes an end-matter note named by its words, numbered, after the references", () => {
    expect(headingOf(list[9], style)).toBe("7 Acknowledgements");
  });

  it("still refuses an entry: one in the shape of its authors, or with a comma or a year in its words", () => {
    expect(headingOf(list[8], style)).toBeNull();
    // no author shape: only its comma and its year keep "Methods" from naming a part
    expect(headingOf(list[5], style)).toBeNull();
    // and an entry no word names, however plain
    expect(headingOf(list[4], style)).toBeNull();
  });
});

describe("the whole reading — an affiliation and a reference list are no sections (P12-49, O3)", () => {
  const pages = affiliationsAndReferences();

  it("keeps the introduction whole and the sections the paper numbers", () => {
    const outline = buildOutline(pages);
    expect(outline.sections?.map((s) => s.heading)).toEqual(["Abstract", "1 Introduction", "2 Methods", "3 Conclusions"]);
    const intro = outline.sections?.[1].text ?? "";
    expect(intro).toContain("rest of the introduction sets out the questions");
    expect(intro).toContain("order of the sections that follow");
  });

  // RE-AIMED (C P12-74, M6 block): this test said the affiliation AND the reference entries stay in the text. The
  // affiliation block stands between the halves of the introduction, so it does; the entries are small print (8 pt,
  // 0.8 of the body) under the last line of prose, set apart by more than a pitch, the first opening with a marker
  // (a digit before a letter), three rows: the opening page's footnote, margin print now (a first page's small
  // print under the text is not the paper's). Kept: the affiliation stays, and neither makes a section of its own.
  it("leaves the affiliation in the text it stands in, takes the small print under the last line for margin print, and makes no section of either", () => {
    const text = textOf(pages);
    expect(text).toContain("Department of Materials Science");
    expect(text).toContain("62704");
    expect(text).not.toContain("Zhang Q, Li W, Wu H");
    expect(headingsOf(pages)).toEqual(["Abstract", "1 Introduction", "2 Methods", "3 Conclusions"]);
  });
});

/** (c) Three pages whose running heads (two, on one row in two columns, set in another face) sit a point apart. */
function runningHeadsPaper(): PdfPageText[] {
  const height = [771.4, 770.6, 771.2];
  return [1, 2, 3].map((n) => ({
    page: n,
    items: [
      item("Quillwort Cathode Letters", { x: 60, y: height[n - 1], fontName: "display" }),
      item("Annealing Schedules", { x: 330, y: height[n - 1], fontName: "display" }),
      ...Array.from({ length: 10 }, (_, i) =>
        item(n === 1 && i === 0 ? "1 Introduction" : `Line ${i} of page ${n} reads on and on and on and on and on and on.`, { y: 740 - i * 12 }),
      ),
    ],
  }));
}

// ── Rule 3 (O4): a running head is furniture whatever its column and its exact height ───────────────────

describe("furnitureOf — a running head repeats in the top or bottom band, whatever its column or height (P12-49, O4)", () => {
  /** A page of body lines, so the band has something to be the edge of. */
  const bodyOn = (page: number): PdfLine[] =>
    [700, 660, 620, 580, 540, 500, 460, 420, 380, 340].map((y, i) => line(`Body line ${"abcdefghij"[page]}${"abcdefghij"[i]} reads on.`, { page, y }));

  it("takes both heads of a row of two columns, though no two pages set them at one height", () => {
    // Heights a point apart that straddle the 6 pt rounding edge the heads used to be keyed by.
    const lines = [1, 2, 3].flatMap(bodyOn);
    for (const [page, y] of [[1, 771.4], [2, 770.6], [3, 771.2]] as const) {
      lines.push(line("Quillwort Cathode Letters", { page, y, x: 60 }), line("Annealing Schedules, Volume 12", { page, y: y - 1.5, x: 330 }));
    }
    const furniture = furnitureOf(lines, 3);
    expect(furniture.size).toBe(2);
    for (const l of lines.filter((l) => l.y > 700 && l.text.length > 20)) expect(isFurniture(l, furniture), l.text).toBe(true);
    expect(isFurniture(line("Body line aa reads on.", { page: 1, y: 700 }), furniture)).toBe(false);
  });

  it("takes a head whose digits differ and whose case differs", () => {
    const lines = [1, 2, 3, 4].flatMap(bodyOn);
    for (const page of [1, 2, 3, 4]) lines.push(line(page % 2 ? `JOURNAL OF INVENTED RESULTS ${page}` : `Journal of Invented Results ${page}`, { page, y: 780 + page }));
    expect(furnitureOf(lines, 4).size).toBe(1);
  });

  it("takes the two heads of a row that one page splits into two lines and the others weld into one", () => {
    // Pages 1 to 3 print "Elmstead Journal of Cathodes" and "Fenwick Cathode Letters" as one line; pages 4 and 5,
    // which have a gutter, as two lines. Neither alone is on enough pages, and each is on the row of the whole.
    const lines = [1, 2, 3, 4, 5].flatMap(bodyOn);
    for (const page of [1, 2, 3]) lines.push(line("Elmstead Journal of Cathodes Fenwick Cathode Letters", { page, y: 780 }));
    for (const page of [4, 5]) lines.push(line("Elmstead Journal of Cathodes", { page, y: 780, x: 60 }), line("Fenwick Cathode Letters", { page, y: 780, x: 330 }));
    const furniture = furnitureOf(lines, 5);
    expect(lines.filter((l) => l.y === 780 && isFurniture(l, furniture))).toHaveLength(7);
  });

  it("takes the welded row where the two heads are the ones repeated", () => {
    const lines = [1, 2, 3, 4].flatMap(bodyOn);
    for (const page of [1, 2, 3]) lines.push(line("Elmstead Journal of Cathodes", { page, y: 780, x: 60 }), line("Fenwick Cathode Letters", { page, y: 780, x: 330 }));
    lines.push(line("Elmstead Journal of Cathodes Fenwick Cathode Letters", { page: 4, y: 780 }));
    const furniture = furnitureOf(lines, 4);
    expect(isFurniture(lines[lines.length - 1], furniture)).toBe(true);
  });

  it("does not take a one-off line, a line of two pages in a paper of five, or one mid-page", () => {
    const lines = [1, 2, 3, 4, 5].flatMap(bodyOn);
    lines.push(line("Quillwort Cathode Letters", { page: 1, y: 780 }));
    for (const page of [2, 3]) lines.push(line("Preprint, under review at an invented journal", { page, y: 780 }));
    for (const page of [1, 2, 3, 4, 5]) lines.push(line("Table of invented counts continues here", { page, y: 481 }));
    const furniture = furnitureOf(lines, 5);
    expect(furniture.size).toBe(0);
    expect(lines.some((l) => isFurniture(l, furniture))).toBe(false);
  });

  it("does not take a body line for a head because it has the head's words, away from the head's height", () => {
    const lines = [1, 2, 3].flatMap(bodyOn);
    for (const page of [1, 2, 3]) lines.push(line("Annealing Schedules", { page, y: 780 }));
    const furniture = furnitureOf(lines, 3);
    expect(isFurniture(line("Annealing Schedules", { page: 2, y: 780 }), furniture)).toBe(true);
    expect(isFurniture(line("Annealing Schedules", { page: 2, y: 481 }), furniture)).toBe(false);
  });

  it("does not take the same words at the top of two pages and the bottom of a third for a head", () => {
    const lines = [1, 2, 3].flatMap(bodyOn);
    for (const page of [1, 2]) lines.push(line("Quillwort Cathode Letters", { page, y: 780 }));
    lines.push(line("Quillwort Cathode Letters", { page: 3, y: 90 }));
    expect(furnitureOf(lines, 3).size).toBe(0);
  });

  it("keeps a running head from becoming a heading: three pages whose heads sit a point apart", () => {
    expect(headingsOf(runningHeadsPaper())).toEqual(["1 Introduction"]);
  });
});

/** The first page of the invented paper the drop-cap and lead-in fixtures share. */
const firstPage = (): PdfPageText =>
  pageOf(1, [
    ["Quillwort Cathodes Under Strain", { height: 17 }],
    ["Abstract", { height: 12 }],
    ["Quillwort cathodes fade through chemistry and strain together."],
    ["1 Introduction", { fontName: "display" }],
    ["Quillwort cathodes are an important class of cathode materials for cells."],
    ["They are used in cells of every size, from watches to grid stores."],
    ["2 Methods", { fontName: "display" }],
    ["Cells were assembled in an argon filled glovebox with less than one part."],
  ]);

/** (d) A section on page 2 that opens with a drop cap: the letter 28 pt large, the rest of its word flush behind it
 *  on the cap's baseline. */
function dropCapPaper(): PdfPageText[] {
  const second: PdfPageText = {
    page: 2,
    items: [
      item("3 Results", { y: 700, fontName: "display" }),
      item("S", { y: 660, height: 28, width: 16, x: 100 }),
      item("tarting from the observation that cells fade", { y: 660, x: 116 }),
      item("under strain, the series was cycled again and again.", { y: 648 }),
      item("The fade followed one curve for every film of the series.", { y: 636 }),
      item("Each curve was fitted with a single rate constant, as shown.", { y: 624 }),
    ],
  };
  return [firstPage(), second];
}

/** (d) A section whose heading is followed by a bold lead-in: one row, whose longest run is the bold phrase. */
function leadInPaper(): PdfPageText[] {
  const y = 700;
  const lead = "Battery cycling and electrochemical characterisation.";
  const second: PdfPageText = {
    page: 2,
    items: [
      item("Cycling", { y: y + 12, fontName: "bold" }),
      item(lead, { y, fontName: "bold" }),
      item(" Cells were", { y, x: 100 + lead.length * 4.6 }),
      item("assembled in an argon filled glovebox with less than one part.", { y: y - 12 }),
      item("They were cycled at twenty five degrees at the rate given.", { y: y - 24 }),
    ],
  };
  return [firstPage(), second];
}

// ── Rule 4 (O7): a drop cap and a run-in lead-in are no heading ──────────────────────────────────────────

describe("a drop cap is no heading (P12-49, O7)", () => {
  // P12-70 (ruling §1h.443), RE-AIMED: a row of words in the body's face is a drop cap only when its large part is one
  // or two characters (`PdfLine.cap`, set by `lineOf` from the row's runs). The two fixtures below that stand for "the cap
  // and the words beside it" now say so (`cap: { rest: 10 }`: the words are set at 10 pt); before, any capitalised row at
  // 1.8 times the body in the body's face was one. The real reading of such a row is pinned by "leaves the paragraph
  // it starts whole" below, which is unchanged.
  const WITH_WORDS = { size: 28, cap: { rest: 10 } };

  it("is the large first letter of a paragraph with the words the row carries beside it", () => {
    expect(isDropCap(line("Starting from the observation that", WITH_WORDS), BODY)).toBe(true);
    expect(isDropCap(line("S", { size: 28, font: "display" }), BODY)).toBe(true);
    expect(isDropCap(line("In", { size: 24, font: "display" }), BODY)).toBe(true);
  });

  it("is not a heading, welded to its first line or alone", () => {
    expect(headingOf(line("Starting from the observation that", WITH_WORDS), BODY)).toBeNull();
    expect(headingOf(line("S tarting from the observation that cells", WITH_WORDS), BODY)).toBeNull();
    expect(headingOf(line("S", { size: 28, font: "display" }), BODY)).toBeNull();
  });

  it("is not a heading a title or a heading set larger would be", () => {
    // a heading in the body's face a half as large again, or a large heading in a face of its own
    expect(isDropCap(line("Discussion", { size: 15 }), BODY)).toBe(false);
    expect(headingOf(line("Discussion", { size: 15 }), BODY)).toBe("Discussion");
    expect(isDropCap(line("Quillwort Cathodes Under Strain", { size: 28, font: "display" }), BODY)).toBe(false);
    expect(isDropCap(line("starting lower case", { size: 28 }), BODY)).toBe(false);
  });

  it("is one or two large characters: a heading of several words set large in the body's face is not a drop cap (P12-70)", () => {
    // three words at twice the body's size, in the body's face, as a title or a section heading is set
    for (const text of ["Annealing Under Strain", "Quillwort Cathodes Under", "Results and discussion"]) {
      expect(isDropCap(line(text, { size: 20 }), BODY), text).toBe(false);
      expect(headingOf(line(text, { size: 20 }), BODY), text).toBe(text);
    }
    // ...whatever size it is set at, and whether or not the row has smaller words after it
    expect(isDropCap(line("Annealing Under Strain", { size: 28 }), BODY)).toBe(false);
    // a large mark with words beside it that are themselves large is a heading's first word, not a cap
    expect(isDropCap(line("Starting from the observation that", { size: 28, cap: { rest: 20 } }), BODY)).toBe(false);
  });

  it("reads such a heading as a section's heading and the cap beside it as no heading, in the same reading (P12-70)", () => {
    const pages = [
      firstPage(),
      pageOf(2, [
        ["3 Results", { fontName: "display" }],
        ["Annealing Under Strain", { height: 20 }],
        ["The films were cycled again and again under the same strain."],
        ["The fade followed one curve for every film of the series."],
        ["S", { y: 720, height: 28, width: 16 }],
        ["tarting from the observation that cells fade under strain, the series was cycled.", { y: 720, x: 116 }],
        ["Each curve was fitted with a single rate constant, as shown."],
      ]),
    ];
    const headings = headingsOf(pages);
    expect(headings).toContain("Annealing Under Strain");
    expect(headings.some((h) => /^S\b|Starting/.test(h ?? ""))).toBe(false);
    expect(textOf(pages)).toContain("Starting from the observation that cells fade under strain");
  });

  it("leaves the paragraph it starts whole: the cap and the rest of its word are one string", () => {
    const outline = buildOutline(dropCapPaper());
    expect(outline.sections?.map((s) => s.heading)).toEqual(["Abstract", "1 Introduction", "2 Methods", "3 Results"]);
    expect(outline.sections?.[3].text).toMatch(/^Starting from the observation that cells fade/);
  });
});

describe("a run-in lead-in is no heading (P12-49, O7)", () => {
  const bold = { font: "bold" };

  it("is a phrase in another face ending with a period, with text after it on the same line", () => {
    expect(headingOf(line("Battery cycling. Cells were assembled in an argon-", bold), BODY)).toBeNull();
    expect(headingOf(line("Calculations of ionic conductivity. All energies were", bold), BODY)).toBeNull();
    expect(headingOf(line("Statistics. Each cell was cycled five times and the", bold), BODY)).toBeNull();
  });

  it("is not welded to the heading it sits under: it stays at the start of its paragraph", () => {
    const outline = buildOutline(leadInPaper());
    expect(outline.sections?.map((s) => s.heading)).toEqual(["Abstract", "1 Introduction", "2 Methods", "Cycling"]);
    expect(outline.sections?.[3].text).toMatch(/^Battery cycling and electrochemical characterisation\. Cells were assembled/);
  });

  it("is not a heading a phrase alone, an abbreviation or a larger line would be", () => {
    // the phrase alone (nothing after it) is a heading, as ever
    expect(headingOf(line("Battery cycling", bold), BODY)).toBe("Battery cycling");
    // a period that ends an abbreviation, not a sentence
    expect(headingOf(line("Vol. 3 Methods and Materials", bold), BODY)).toBe("Vol. 3 Methods and Materials");
    // set clearly larger, a line is a heading
    expect(headingOf(line("Cycling Results. Part One of the Series", { ...bold, size: 14 }), BODY)).toBe("Cycling Results. Part One of the Series");
  });
});

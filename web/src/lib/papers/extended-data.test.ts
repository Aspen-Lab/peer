import { describe, expect, it } from "vitest";
import { bodyText, figurePdf, panel, pngInfo, type FigurePage } from "@/lib/figures/figure-pdf.test-helper";
import { extractPdfFigures, measurePdfFigure } from "@/lib/figures/pdf-engine";
import { extractPdfCandidatesFromBytes } from "@/lib/figures/pdf-extract";
import { FIGURE_EXTRACTION_REVISION } from "@/lib/figures/figure-revision";
import type { FigurePool, FigurePoolEntry } from "@/lib/figures/extract";
import { bindFiguresToReport } from "./figure-binding";
import type { ExtractedFigureCaption } from "./html-text";
import { buildOutline, captionAt, captionOf, type PdfLine, type PdfTextItem } from "./pdf-outline";
import { extractPdfTextFromBytes, withFigureSizes } from "./pdf-text";
import { buildReading, pdfFigureUrl, pictureNumber, placeFigures, type ReadingSection } from "./reading";
import type { PaperReport } from "./report";
import type { Paper } from "@/types";

// P12-56 (B P12-41, M6, M14, M15): what the outline takes for a figure's caption when a journal sets
// "Fig. 1 | Title" and "Extended Data Fig. 1 | Title", and when a body line opens with a citation.
// All of it is invented text, built the way `pdf-outline.captions.test.ts` builds a page: runs on
// baselines, in a face and a size.

/** A run of text on a page, as pdf.js hands it over. */
function item(str: string, at: Partial<PdfTextItem> = {}): PdfTextItem {
  return { str, height: 10, width: str.length * 4.6, fontName: "body", x: 100, y: 500, ...at };
}

function line(text: string, at: Partial<PdfLine> = {}): PdfLine {
  return { page: 1, text, x: 100, y: 500, size: 10, font: "body", ...at };
}

/** A line of the paper's prose; at 12 points apart these set the line pitch the outline reads. */
const filler = (y: number) => item("Recurrent neural networks have long been established in sequence modelling and transduction.", { y });

/** A one-page paper: a title, a heading, six lines of prose from y = 726 down to 666, then `middle`,
 *  then three lines of prose again. */
function paper(middle: PdfTextItem[], after = 560) {
  return buildOutline([
    {
      page: 1,
      items: [
        item("A Paper", { height: 17, y: 760 }),
        item("1 Introduction", { y: 740 }),
        ...[726, 714, 702, 690, 678, 666].map(filler),
        ...middle,
        ...[after, after - 12, after - 24].map(filler),
      ],
    },
  ]);
}

const captionsOf = (outline: ReturnType<typeof buildOutline>) => outline.figureCaptions ?? [];
const labelsOf = (outline: ReturnType<typeof buildOutline>) => captionsOf(outline).map((c) => c.label);

describe("the bar after a caption's number is a separator, not the first word of the title (P12-56, R15a)", () => {
  it("cuts the bar like the full stop and the colon, with or without spaces around it", () => {
    for (const text of ["Fig. 1 | Soil moisture", "Fig. 1| Soil moisture", "Fig. 1 |Soil moisture", "Fig. 1|Soil moisture"]) {
      expect(captionOf(line(text)), text).toMatchObject({ ordinal: 1, label: "Fig 1", caption: "Soil moisture" });
    }
    expect(captionOf(line("Figure 2 | Soil moisture")), "Figure").toMatchObject({ label: "Figure 2", caption: "Soil moisture" });
    expect(captionOf(line("Table 3 | Parameters of the model")), "Table").toMatchObject({ label: "Table 3", caption: "Parameters of the model" });
    expect(captionOf(line("Fig. 4. Soil moisture")), "the full stop still goes").toMatchObject({ caption: "Soil moisture" });
    expect(captionOf(line("Fig. 5: Soil moisture")), "the colon still goes").toMatchObject({ caption: "Soil moisture" });
  });

  it("cuts only the one separator: a bar inside the title stays, and a lone label with its bar has no words", () => {
    expect(captionOf(line("Fig. 6 | Strain | rate curves of the film")), "inner bar").toMatchObject({ caption: "Strain | rate curves of the film" });
    expect(captionOf(line("Fig. 7 |")), "label and bar alone").toMatchObject({ ordinal: 7, label: "Fig 7", caption: "" });
  });

  it("end to end: fifteen captions set as 'Fig. N | Title' list without a bar in any of them", () => {
    // One page per caption would be heavy; the captions stand in one block, a title line in bold and
    // the rest in the text face, as Nature sets them.
    const middle: PdfTextItem[] = [];
    let y = 654;
    for (let n = 1; n <= 15; n++) {
      middle.push(item(`Fig. ${n} | Title number ${n}.`, { y, fontName: "bold" }));
      y -= 12;
      middle.push(item(`Words under title ${n}, set in the text face, after it.`, { y }));
      y -= 20;
    }
    const outline = paper(middle, y - 12);
    const captions = captionsOf(outline);
    expect(captions).toHaveLength(15);
    for (const c of captions) {
      expect(c.caption, c.label).not.toMatch(/^\|/);
      expect(c.caption, c.label).not.toContain(" | ");
      expect(c.caption, c.label).toMatch(/^Title number \d+\. Words under title \d+/);
    }
  });
});

const proseOf = (outline: ReturnType<typeof buildOutline>) => (outline.sections ?? []).map((s) => s.text).join(" ");

describe("a line that opens with a figure label after a line that ends mid-sentence is prose (P12-56, R6b)", () => {
  const ghost = "Fig. 4. Then the signal rises with the load on the cell in the same order.";

  it("end to end: 'as shown in' over 'Fig. 4. Then ...' is one paragraph and lists no figure", () => {
    const outline = paper([
      item("The rate of deposition of the film increased with the supply of precursor, as shown in", { y: 654 }),
      item(ghost, { y: 642 }),
    ]);
    expect(labelsOf(outline)).toEqual([]);
    expect(proseOf(outline)).toContain(ghost);
  });

  it("end to end: the same line after a finished sentence is a caption, as it was", () => {
    const outline = paper([
      item("The rate of deposition of the film increased with the supply of precursor, as shown below.", { y: 654 }),
      item(ghost, { y: 630 }),
    ]);
    expect(labelsOf(outline)).toEqual(["Fig 4"]);
  });

  it("a sentence is finished by a stop, a mark, a colon, and by a closing bracket, quote or citation mark after one", () => {
    const body = { size: 10, font: "body" };
    const endings = [
      "was measured at the low rate.",
      "was measured at the low rate!",
      "was measured at the low rate?",
      "was measured at the low rate, as follows:",
      "was measured at the low rate (see Methods).",
      'was measured at the low "rate."',
      "was measured at the low rate.\u00B9\u00B2",
      "was measured at the low rate.\u00B9\u00B2,\u00B9\u00B3",
      "was measured at the low rate. [12, 13]",
      "was measured at the low rate.  ",
    ];
    for (const ending of endings) {
      const read = [line(ending, { y: 512 }), line(ghost, { y: 500 })];
      expect(captionAt(read, 1, 12, body, new Set()), ending).toMatchObject({ label: "Fig 4" });
    }
    const open = ["was measured at the low rate,", "was measured at the low rate and", "was measured at the low rate (", "was measured at the low rate;", "was measured at ref. 12", "is shown in"];
    for (const ending of open) {
      const read = [line(ending, { y: 512 }), line(ghost, { y: 500 })];
      expect(captionAt(read, 1, 12, body, new Set()), ending).toBeNull();
    }
  });

  it("holds only for body text directly above, in the same column, on the same page", () => {
    const body = { size: 10, font: "body" };
    const open = "The rate of deposition of the film increased with the supply of precursor, as shown in";
    const caption = line(ghost, { y: 500 });
    const refused = (above: PdfLine) => captionAt([above, caption], 1, 12, body, new Set());
    expect(refused(line(open, { y: 512 })), "directly above").toBeNull();
    expect(refused(line(open, { y: 512, x: 112 })), "an indent").toBeNull();
    expect(refused(line(open, { y: 480 })), "below it, so the other column's last line").toMatchObject({ label: "Fig 4" });
    expect(refused(line(open, { y: 512, x: 340 })), "another column").toMatchObject({ label: "Fig 4" });
    expect(refused(line(open, { y: 540 })), "a gap wider than a line and a half: a figure between").toMatchObject({ label: "Fig 4" });
    expect(refused(line(open, { y: 512, page: 2 })), "another page").toMatchObject({ label: "Fig 4" });
    expect(refused(line(open, { y: 512, size: 7.5, font: "sans" })), "the text of a figure: another size and face").toMatchObject({ label: "Fig 4" });
    expect(refused(line(open, { y: 512, size: 14 })), "a heading's size").toMatchObject({ label: "Fig 4" });
    expect(refused(line(open, { y: 512, font: "bold" })), "a heading's face").toMatchObject({ label: "Fig 4" });
    expect(captionAt([caption], 0, 12, body, new Set()), "nothing above").toMatchObject({ label: "Fig 4" });
    expect(captionAt([line(open, { y: 512 }), caption], 1, 12, body, new Set([`${Math.round(512 / 6)}:${open.toLowerCase()}`])), "furniture above").toMatchObject({ label: "Fig 4" });
    expect(captionAt([line(open, { y: 512 }), caption], 1, 0, body, new Set()), "no pitch to measure: a line and a half of the body size").toBeNull();
  });

  it("the line above a caption in a list of captions is a caption's line, not open prose", () => {
    const body = { size: 10, font: "body" };
    const read = [
      line("The three covers differ in their yield and in their moisture.", { y: 524 }),
      line("Figure 1: First list entry", { y: 512 }),
      line("Figure 2: Second list entry", { y: 500 }),
      line("Figure 3: Third list entry", { y: 488 }),
    ];
    expect(captionAt(read, 1, 12, body, new Set())).toMatchObject({ label: "Figure 1" });
    expect(captionAt(read, 2, 12, body, new Set())).toMatchObject({ label: "Figure 2" });
    expect(captionAt(read, 3, 12, body, new Set())).toMatchObject({ label: "Figure 3" });
    // a caption of two lines, the second without a stop, then the next caption
    const two = [
      line("The three covers differ in their yield and in their moisture.", { y: 524 }),
      line("Figure 1: First list entry", { y: 512 }),
      line("with a second line that has no stop", { y: 500 }),
      line("Figure 2: Second list entry", { y: 488 }),
    ];
    expect(captionAt(two, 3, 12, body, new Set())).toMatchObject({ label: "Figure 2" });
  });

  it("a second ghost in the same paragraph is refused too", () => {
    const outline = paper([
      item("The rate of deposition of the film increased with the supply of precursor, as shown in", { y: 654 }),
      item("Fig. 4. Then the signal rises with the load on the cell and, in the same order,", { y: 642 }),
      item("Fig. 5. Then the signal falls again once the supply of the precursor is closed off, as in", { y: 630 }),
      item("Fig. 6. Then it settles at the level it began from at the start of the run in the cell.", { y: 618 }),
    ]);
    expect(labelsOf(outline)).toEqual([]);
  });

  it("a real caption in its own face under a finished paragraph and above its figure's text is still listed", () => {
    const outline = paper([
      item("Fig. 7 | Soil moisture under the three covers.", { y: 630, fontName: "bold" }),
      item("Measured weekly at ten depths in the spring and summer, and averaged over the plots.", { y: 618 }),
    ]);
    expect(labelsOf(outline)).toEqual(["Fig 7"]);
    expect(captionsOf(outline)[0].caption).toMatch(/^Soil moisture under the three covers\. Measured weekly/);
  });
});

describe("'Fig. 1 (a) Title' is a caption again, 'Fig. 5 (left) shows' is not (P12-56, R6b with R6a relaxed)", () => {
  const body = { size: 10, font: "body" };
  const finished = line("The rate of deposition of the film increased with the supply of precursor.", { y: 512 });
  const unfinished = line("The rate of deposition of the film increased with the supply of precursor, as in", { y: 512 });
  const at = (text: string, above: PdfLine) => captionAt([above, line(text, { y: 500 })], 1, 12, body, new Set());

  it("reads a panel mark and a capital, a separator or the end of the line as a caption after a finished paragraph", () => {
    expect(at("Fig. 1 (a) Overview of the set-up.", finished)).toMatchObject({ ordinal: 1, label: "Fig 1", caption: "(a) Overview of the set-up." });
    expect(at("Figure 2 (A) Overview", finished)).toMatchObject({ ordinal: 2, label: "Figure 2" });
    expect(at("Fig. 3 (a,b) Soil moisture", finished)).toMatchObject({ label: "Fig 3" });
    expect(at("Fig. 3 (a, b, c, d) Soil moisture", finished)).toMatchObject({ label: "Fig 3" });
    expect(at("Fig. 3 (a-c) Soil moisture", finished)).toMatchObject({ label: "Fig 3" });
    expect(at("Fig. 3 (ii) Soil moisture", finished)).toMatchObject({ label: "Fig 3" });
    expect(at("Fig. 3 (a)", finished)).toMatchObject({ label: "Fig 3" });
    expect(at("Fig. 3 (a). Soil moisture", finished)).toMatchObject({ label: "Fig 3" });
    expect(at("Fig. 3 (a) | Soil moisture", finished)).toMatchObject({ label: "Fig 3" });
  });

  it("refuses the same line after a line that does not end a sentence", () => {
    expect(at("Fig. 1 (a) Overview of the set-up.", unfinished)).toBeNull();
    expect(at("Figure 2 (A) Overview", unfinished)).toBeNull();
  });

  it("still refuses a citation in a bracket: a word, a small letter after the mark, a bracket that is no panel mark", () => {
    for (const text of [
      "Fig. 5 (left) is the one that",
      "Fig. 5 (Left) is the one that",
      "Fig. 5 (top) Overview",
      "Fig. 1 (a) shows the setup and the",
      "Fig. 1 (a) and (b) show the",
      "Fig. 2 (see below) The",
      "Fig. 2 (abc) The",
      "Fig. 2 (1) The",
      "Fig. 1(a) Shows the",
      "Fig. 2 () The",
    ]) {
      expect(at(text, finished), text).toBeNull();
    }
  });
});

// ── R14a: Extended Data figures are listed and open ──────────────────────────────────────────────────────────

describe("an Extended Data figure is a caption of its own numbering (P12-56, R14a)", () => {
  it("reads the prefix before Fig. and Figure, in any case and spacing, and keeps it in the label", () => {
    const shapes: [string, string, string][] = [
      ["Extended Data Fig. 3 | Soil moisture", "Extended Data Fig 3", "Soil moisture"],
      ["Extended Data Figure 12 | Soil moisture", "Extended Data Figure 12", "Soil moisture"],
      ["EXTENDED DATA FIG. 4 | SOIL MOISTURE", "Extended Data FIG 4", "SOIL MOISTURE"],
      ["extended data fig. 5. Soil moisture", "Extended Data fig 5", "Soil moisture"],
      ["Extended  Data   Fig.6: Soil moisture", "Extended Data Fig 6", "Soil moisture"],
      ["Extended Data Fig. 7", "Extended Data Fig 7", ""],
    ];
    for (const [text, label, caption] of shapes) {
      expect(captionOf(line(text)), text).toMatchObject({ label, caption, page: 1 });
      // its own numbering takes no ordinal: nothing that finds a caption by number can take it for "Fig. N"
      expect(captionOf(line(text))?.ordinal, text).toBeUndefined();
    }
    expect(captionOf(line("Fig. 3 | Soil moisture")), "the paper's own Fig. 3 is as it was").toMatchObject({ ordinal: 3, label: "Fig 3", caption: "Soil moisture" });
  });

  it("refuses what is not a label of a figure this PDF prints: a citation, a table, a figure of another file", () => {
    for (const text of [
      "Extended Data Fig. 3 shows the same ordering as the",
      "Extended Data Fig. 3, left, shows",
      "Extended Data Fig. 3) is consistent with",
      "Extended Data Table 1 | Parameters",
      "Extended Data Fig. S3 | Title",
      "Extended Data | Title",
      "Extended Data",
      "Supplementary Fig. 3 | Title",
      "Supplementary Figure 3. Title",
      "Supplementary Information Fig. 3 | Title",
      "Fig. S3 | Title",
      "Figure S3. Title",
      "Fig. S3 Title",
    ]) {
      expect(captionOf(line(text)), text).toBeNull();
    }
  });

  it("end to end: 'Fig. 1 | Title' and 'Extended Data Fig. 1 | Title' are two entries with their own labels and no bar", () => {
    const outline = paper([
      item("Fig. 1 | Soil moisture under the three covers.", { y: 630, fontName: "bold" }),
      item("Measured weekly at ten depths in the spring and summer, and averaged over the plots.", { y: 618 }),
      item("Extended Data Fig. 1 | Soil moisture in the spring.", { y: 590, fontName: "bold" }),
      item("Measured weekly at ten depths in the spring only, and averaged over the three plots.", { y: 578 }),
    ], 540);
    expect(labelsOf(outline)).toEqual(["Fig 1", "Extended Data Fig 1"]);
    const [main, extended] = captionsOf(outline);
    expect(main.caption).toMatch(/^Soil moisture under the three covers\. Measured weekly/);
    expect(extended.caption).toMatch(/^Soil moisture in the spring\. Measured weekly at ten depths in the spring only/);
    expect(main.ordinal).toBe(1);
    expect(extended.ordinal).toBeUndefined();
  });

  it("end to end: a body line that opens by citing an Extended Data figure after unfinished prose is no caption (R6b)", () => {
    const outline = paper([
      item("The rate of deposition of the film increased with the supply of precursor, as shown in", { y: 654 }),
      item("Extended Data Fig. 4. Then the signal rises with the load on the cell in the same order.", { y: 642 }),
    ]);
    expect(labelsOf(outline)).toEqual([]);
  });
});

describe("pictureNumber and pdfFigureUrl give an Extended Data figure its own URL (P12-56, R14a)", () => {
  it("names a number for Fig. N and the token ed<N> for Extended Data Fig. N, and nothing for any other figure", () => {
    expect(pictureNumber("Fig 3")).toBe(3);
    expect(pictureNumber("Figure 12")).toBe(12);
    expect(pictureNumber("Extended Data Fig 3")).toBe("ed3");
    expect(pictureNumber("Extended Data Figure 10")).toBe("ed10");
    expect(pictureNumber("extended data fig. 3")).toBe("ed3");
    for (const label of [
      "Fig. S3", "Figure S3", "Supplementary Fig. 3", "Supplementary Figure 3", "Extended Data Fig. S3",
      "Extended Data Table 1", "Extended Data Fig. 0", "Extended Data Fig. 03", "Extended Data Fig. 1000", "Extended Data Fig. 3b",
      "Extended Data 3", "Fig. 3b", "Figure IV", "Table 1",
    ]) {
      expect(pictureNumber(label), label).toBeNull();
    }
  });

  it("puts the token in the route's fig parameter, distinct from the number's URL", () => {
    expect(pdfFigureUrl("arxiv:2610.00001", 5, 3)).toBe(`/api/papers/arxiv%3A2610.00001/figure-image?page=5&fig=3&v=${FIGURE_EXTRACTION_REVISION}`);
    expect(pdfFigureUrl("arxiv:2610.00001", 5, "ed3")).toBe(`/api/papers/arxiv%3A2610.00001/figure-image?page=5&fig=ed3&v=${FIGURE_EXTRACTION_REVISION}`);
  });

  it("the figure revision moved with the pairing: it is no longer the 4 the unextended-data URLs carried", () => {
    expect(FIGURE_EXTRACTION_REVISION).not.toBe("4");
  });
});

const caption = (label: string, over: Partial<ExtractedFigureCaption> = {}): ExtractedFigureCaption => ({
  ordinal: 0,
  label,
  caption: `${label} title.`,
  page: 5,
  at: 0.9,
  ...over,
});
const section = (id: string, ...paragraphs: string[]): ReadingSection => ({ id, heading: id, canonical: "body", paragraphs });
const figuresOf = (sections: ReadingSection[]) =>
  sections.flatMap((s, si) => (s.figures ?? []).map((f) => ({ label: f.label, section: si, after: f.after, url: f.imageUrl })));
const PAPER = "arxiv:2610.00056";

describe("placeFigures keeps Fig. N, Extended Data Fig. N and a supplementary figure apart (P12-56, R14a, ruling §1h.433)", () => {
  it("(b) both printed: each opens its own figure, at the paragraph that cites it, whichever is cited first", () => {
    for (const [first, second] of [
      ["Extended Data Fig. 3", "Fig. 3"],
      ["Fig. 3", "Extended Data Fig. 3"],
    ]) {
      const sections = [section("s0", "Opening words with no citation at all.", `The control run (${first}) is flat.`, `The treated run (${second}) rises.`)];
      const placed = placeFigures(
        sections,
        [caption("Fig 3", { page: 4, ordinal: 3 }), caption("Extended Data Fig 3", { page: 9 })],
        { paperId: PAPER },
      );
      const at = Object.fromEntries(figuresOf(placed).map((f) => [f.label, f]));
      const expectedMain = first === "Fig. 3" ? 1 : 2;
      expect(at["Fig 3"], first).toMatchObject({ after: expectedMain, url: pdfFigureUrl(PAPER, 4, 3) });
      expect(at["Extended Data Fig 3"], first).toMatchObject({ after: 3 - expectedMain, url: pdfFigureUrl(PAPER, 9, "ed3") });
      expect(at["Fig 3"].url).not.toBe(at["Extended Data Fig 3"].url);
      expect(at["Extended Data Fig 3"].url).toContain("fig=ed3&");
      expect(at["Fig 3"].url).toContain("fig=3&");
    }
  });

  it("a paragraph that cites only Extended Data Fig. 3 does not place Fig. 3, and the other way round", () => {
    const sections = [section("s0", "The control run (Extended Data Fig. 3) is flat.", "Closing words with no citation.")];
    const placed = placeFigures(sections, [caption("Fig 3", { page: 4, ordinal: 3, at: 1 }), caption("Extended Data Fig 3", { page: 9 })], { paperId: PAPER });
    const at = Object.fromEntries(figuresOf(placed).map((f) => [f.label, f]));
    expect(at["Extended Data Fig 3"].after, "after the paragraph that cites it").toBe(0);
    expect(at["Fig 3"].after, "Fig. 3 is cited nowhere: it stays where the caption sat, at the end").toBe(1);

    const back = placeFigures(
      [section("s0", "The treated run (Fig. 3) rises.", "Closing words with no citation.")],
      [caption("Fig 3", { page: 4, ordinal: 3 }), caption("Extended Data Fig 3", { page: 9, at: 1 })],
      { paperId: PAPER },
    );
    const atBack = Object.fromEntries(figuresOf(back).map((f) => [f.label, f]));
    expect(atBack["Fig 3"].after).toBe(0);
    expect(atBack["Extended Data Fig 3"].after).toBe(1);
  });

  it("(a) the PDF prints only Fig. 3: a citation of Fig. S3 or Supplementary Fig. 3 is plain text and opens nothing", () => {
    const sections = [
      section("s0", "The raw traces are in Fig. S3 and Supplementary Fig. 3 of the other file.", "Supplementary Figure 3 and Fig. S3 show the same.", "The main result (Fig. 3) is a rise."),
      section("s1", "Closing words with no citation."),
    ];
    const placed = placeFigures(sections, [caption("Fig 3", { page: 4, ordinal: 3 })], { paperId: PAPER });
    const figures = figuresOf(placed);
    expect(figures).toHaveLength(1);
    expect(figures[0]).toMatchObject({ label: "Fig 3", section: 0, after: 2, url: pdfFigureUrl(PAPER, 4, 3) });
    // the supplementary mentions were not read as Fig. 3: with only those, the figure goes by its caption's place
    const onlySupplementary = placeFigures(
      [section("s0", "See Fig. S3, Supplementary Fig. 3, Supp. Fig. 3, Supplemental Figure 3 and Supplementary Information Fig. 3."), section("s1", "Closing words.")],
      [caption("Fig 3", { page: 4, ordinal: 3, at: 1 })],
      { paperId: PAPER },
    );
    expect(figuresOf(onlySupplementary)).toEqual([{ label: "Fig 3", section: 1, after: 0, url: pdfFigureUrl(PAPER, 4, 3) }]);
  });

  it("lists no supplementary figure the PDF does not print as a caption, and no extended one it does not", () => {
    const placed = placeFigures(
      [section("s0", "See Fig. S3, Supplementary Fig. 3 and Extended Data Fig. 3 for the rest of it.")],
      [caption("Fig 1", { page: 4, ordinal: 1 })],
      { paperId: PAPER },
    );
    expect(figuresOf(placed).map((f) => f.label)).toEqual(["Fig 1"]);
  });

  it("dedupes by label: Fig 3 and Extended Data Fig 3 are two figures, a repeated Extended Data Fig 3 is one", () => {
    const placed = placeFigures(
      [section("s0", "Words (Fig. 3) and (Extended Data Fig. 3).")],
      [caption("Fig 3", { page: 4, ordinal: 3 }), caption("Extended Data Fig 3", { page: 9 }), caption("Extended Data Fig 3", { page: 11 })],
      { paperId: PAPER },
    );
    expect(figuresOf(placed).map((f) => f.label).sort()).toEqual(["Extended Data Fig 3", "Fig 3"]);
  });

  it("offers an Extended Data figure no URL when the document is not a PDF, as it offers Fig. N none", () => {
    const placed = placeFigures([section("s0", "Words (Extended Data Fig. 3).")], [caption("Extended Data Fig 3")], null);
    expect(figuresOf(placed)).toEqual([{ label: "Extended Data Fig 3", section: 0, after: 0, url: undefined }]);
  });
});

describe("the binder keeps the same three numberings apart (P12-56, R14a, ruling §1h.433)", () => {
  const MAIN = "Soil water against depth under three seaweed layers.";
  const EXTENDED = "Runoff loss after the storm, terrace by terrace.";
  const PNG_MAIN = "data:image/png;base64,MAIN-MAIN";
  const PNG_EXTENDED = "data:image/png;base64,EXTENDED-EXTENDED";
  const captions: ExtractedFigureCaption[] = [
    { ordinal: 3, label: "Fig 3", caption: MAIN, page: 4, at: 0.2 },
    { ordinal: 1, label: "Extended Data Fig 3", caption: EXTENDED, page: 9, at: 0.8 },
  ];
  const entry = (over: Partial<FigurePoolEntry> & Pick<FigurePoolEntry, "imageUrl" | "caption">): FigurePoolEntry => ({
    source: "open-access",
    ordinal: 0,
    qualityHint: "high",
    ...over,
  });
  // The extended entry comes first and is of the higher quality: nothing but the numbering tells the two apart.
  const pool: FigurePool = {
    attempted: true,
    entries: [
      entry({ imageUrl: PNG_EXTENDED, caption: `Extended Data Fig. 3 | ${EXTENDED}`, qualityHint: "high" }),
      entry({ imageUrl: PNG_MAIN, caption: `Fig. 3 | ${MAIN}`, qualityHint: "low" }),
    ],
  };
  const reportOf = (proposal: string, evidence: string): PaperReport => ({
    skim: [],
    whatItProposes: { summary: proposal, methods: [] },
    resultsAndSignificance: { summary: "", keyResults: [{ title: "A", detail: "Detail.", evidence }] },
    provenance: { basis: "model-fulltext", droppedClaims: 0 },
  });
  const bind = (report: PaperReport, over: { captions?: ExtractedFigureCaption[]; pool?: FigurePool | null } = {}) =>
    bindFiguresToReport({
      paper: { title: "Seaweed mulch", id: PAPER },
      report,
      captions: over.captions ?? captions,
      provider: null,
      figurePool: over.pool === undefined ? pool : over.pool,
    });

  it("(b) a citation of Extended Data Fig. 3 binds the Extended Data figure, a citation of Fig. 3 binds Fig. 3, each with its own URL", async () => {
    const bound = await bind(reportOf("The setup is described in prose only.", "The runoff fell (Extended Data Fig. 3)."));
    const result = bound.resultsAndSignificance.keyResults[0];
    expect(result.figureLabel).toBe("Extended Data Fig 3");
    expect(result.figureImageUrl).toBe(pdfFigureUrl(PAPER, 9, "ed3"));
    expect(result.figureCaption).toBe(`Extended Data Fig. 3 | ${EXTENDED}`);

    const main = await bind(reportOf("The setup is described in prose only.", "The index rose with depth (Fig. 3)."));
    const mainResult = main.resultsAndSignificance.keyResults[0];
    expect(mainResult.figureLabel).toBe("Fig 3");
    expect(mainResult.figureImageUrl).toBe(pdfFigureUrl(PAPER, 4, 3));
    expect(mainResult.figureCaption).toBe(`Fig. 3 | ${MAIN}`);
  });

  it("(b) the proposal and a result can bind one each, and neither takes the other's", async () => {
    const bound = await bind(reportOf("As Extended Data Fig. 3 shows, the runoff fell.", "The index rose with depth (Fig. 3)."));
    expect(bound.whatItProposes.figureLabel).toBe("Extended Data Fig 3");
    expect(bound.whatItProposes.figureImageUrl).toBe(pdfFigureUrl(PAPER, 9, "ed3"));
    expect(bound.resultsAndSignificance.keyResults[0].figureLabel).toBe("Fig 3");
    expect(bound.resultsAndSignificance.keyResults[0].figureImageUrl).toBe(pdfFigureUrl(PAPER, 4, 3));
  });

  it("with only one of the two in the pool, the other numbering finds no picture rather than the wrong one", async () => {
    const onlyMain: FigurePool = { attempted: true, entries: [entry({ imageUrl: PNG_MAIN, caption: `Fig. 3 | ${MAIN}` })] };
    const bound = await bind(reportOf("The setup is described in prose only.", "The runoff fell (Extended Data Fig. 3)."), { pool: onlyMain });
    const result = bound.resultsAndSignificance.keyResults[0];
    expect(result.figureLabel).toBe("Extended Data Fig 3");
    expect(result.figureImageUrl).toBeNull();
    const onlyExtended: FigurePool = { attempted: true, entries: [entry({ imageUrl: PNG_EXTENDED, caption: `Extended Data Fig. 3 | ${EXTENDED}` })] };
    const main = await bind(reportOf("The setup is described in prose only.", "The index rose with depth (Fig. 3)."), { pool: onlyExtended });
    expect(main.resultsAndSignificance.keyResults[0].figureLabel).toBe("Fig 3");
    expect(main.resultsAndSignificance.keyResults[0].figureImageUrl).toBeNull();
  });

  it("(a) the PDF prints only Fig. 3: a citation of Fig. S3 or Supplementary Fig. 3 binds no figure, and never Fig. 3", async () => {
    const printed = [captions[0]];
    for (const evidence of [
      "The raw amplifier traces drift (Fig. S3).",
      "The raw amplifier traces drift (Supplementary Fig. 3).",
      "The raw amplifier traces drift (Supplementary Figure 3).",
      "The raw amplifier traces drift (Supp. Fig. 3 and Fig. S3).",
    ]) {
      const bound = await bind(reportOf("The setup is described in prose only.", evidence), { captions: printed });
      const result = bound.resultsAndSignificance.keyResults[0];
      expect(result.figureLabel, evidence).toBeNull();
      expect(result.figureImageUrl, evidence).toBeNull();
    }
    // a supplementary citation beside a printed one: the printed one binds
    const beside = await bind(reportOf("The setup is described in prose only.", "See Fig. S3 and Supplementary Fig. 3, and above all Fig. 3."), { captions: printed });
    expect(beside.resultsAndSignificance.keyResults[0].figureLabel).toBe("Fig 3");
    expect(beside.resultsAndSignificance.keyResults[0].figureImageUrl).toBe(pdfFigureUrl(PAPER, 4, 3));
  });
});

// ── The whole chain on an invented PDF: the outline, the sizes, the reading, the engine ───────────────────

/** A paper in Nature's shape: "Fig. 1 | Title" and "Extended Data Fig. 1 | Title" under their panels, and a body
 *  that cites Fig. 1, Extended Data Fig. 1 and the supplementary file's Fig. S3 / Supplementary Fig. 3. */
function natureLikePdf(): Buffer {
  const first: FigurePage = {
    text: [["A Synthetic Paper About Seaweed Mulch", 72, 60, 18], ["Abstract", 72, 100, 13], ...bodyText(["An invented abstract of one sentence, long enough to read as prose in the page."], 118)],
  };
  const second: FigurePage = {
    text: [
      ["1. Introduction", 72, 80, 13],
      ...bodyText(
        [
          "Seaweed mulch kept the soil wetter under all three covers in the first season (Fig. 1).",
          "The longer series of the second season is held back for the supplementary file, where the",
          "raw traces are plotted in Fig. S3 and again in Supplementary Fig. 3 for each plot alone.",
        ],
        126,
      ),
      ["Fig. 1 | Soil moisture under the three covers.", 100, 470, 9],
    ],
    shapes: panel(100, 250, 370, 150),
  };
  const third: FigurePage = {
    text: [
      ["2. Results", 72, 80, 13],
      ...bodyText(
        [
          "The effect was weaker in the spring, as the control plots show (Extended Data Fig. 1), and it",
          "faded by the end of the second season, which the supplementary file also records in full.",
        ],
        106,
      ),
      ["Extended Data Fig. 1 | Soil moisture in the spring.", 100, 330, 9],
    ],
    shapes: panel(100, 140, 300, 150),
  };
  return figurePdf([first, second, third]);
}

describe("the whole chain on a PDF that prints Fig. 1 and Extended Data Fig. 1 (P12-56, R14a)", () => {
  it("(a) lists both with their own labels and no bar, sizes both, and the engine draws each one's own picture", async () => {
    const pdf = natureLikePdf();
    const result = await extractPdfTextFromBytes(pdf);
    expect(result.ok).toBe(true);
    const captions = result.doc?.figureCaptions ?? [];
    expect(captions.map((c) => c.label)).toEqual(["Fig 1", "Extended Data Fig 1"]);
    expect(captions.map((c) => c.caption)).toEqual(["Soil moisture under the three covers.", "Soil moisture in the spring."]);
    expect(captions.map((c) => c.page)).toEqual([2, 3]);
    // sized: each by its own engine call, the Extended Data one by its token
    for (const [cap, label] of [[captions[0], "Figure 1"], [captions[1], "Extended Data Fig. 1"]] as const) {
      expect(cap.width && cap.width > 0 && cap.height && cap.height > 0, cap.label).toBe(true);
      const { figures } = await extractPdfFigures(new Uint8Array(pdf), { maxPages: 300, maxFigures: 1, onlyPage: cap.page, label });
      const info = pngInfo(figures[0].png);
      expect([cap.width, cap.height], cap.label).toEqual([info.width, info.height]);
    }
    expect(captions[0].width).not.toBe(captions[1].width);
  });

  it("(a) the reading offers two figures, two URLs; the citation of Extended Data Fig. 1 reaches the Extended Data figure", async () => {
    const result = await extractPdfTextFromBytes(natureLikePdf());
    const paper = { id: PAPER, title: "A Synthetic Paper About Seaweed Mulch" } as unknown as Paper;
    const reading = buildReading(paper, { status: "ok", doc: result.doc, sourceLink: { kind: "pdf", url: "https://example.org/x.pdf" } } as never);
    const placed = (reading.body ?? []).flatMap((s, si) => (s.figures ?? []).map((f) => ({ label: f.label, heading: s.heading, section: si, url: f.imageUrl, after: f.after, caption: f.caption })));
    expect(placed.map((f) => f.label)).toEqual(["Fig 1", "Extended Data Fig 1"]);
    expect(placed[0].url).toBe(pdfFigureUrl(PAPER, 2, 1));
    expect(placed[1].url).toBe(pdfFigureUrl(PAPER, 3, "ed1"));
    expect(placed[0].section, "Fig. 1 follows the Introduction, which cites it").toBeLessThan(placed[1].section);
    expect(placed[0].heading).toMatch(/Introduction/);
    expect(placed[1].heading).toMatch(/Results/);
    // Fig. S3 and Supplementary Fig. 3 are plain text: no figure of that name, and none of the two is placed by them
    expect(placed.some((f) => /S3|Supp/i.test(f.label))).toBe(false);
    expect(placed.map((f) => f.caption).join(" ")).not.toContain("|");
  });

  it("the engine draws the Extended Data figure for its own label and refuses a supplementary one", async () => {
    const pdf = new Uint8Array(natureLikePdf());
    const own = await extractPdfFigures(pdf, { maxPages: 300, maxFigures: 1, onlyPage: 3, label: "Extended Data Fig. 1" });
    expect(own.figures).toHaveLength(1);
    // the same page asked for "Figure 1": the caption there is Extended Data Fig. 1, not Fig. 1
    const notMain = await extractPdfFigures(pdf, { maxPages: 300, maxFigures: 1, onlyPage: 3, label: "Figure 1" });
    expect(notMain.figures).toHaveLength(0);
    const notExtended = await extractPdfFigures(pdf, { maxPages: 300, maxFigures: 1, onlyPage: 2, label: "Extended Data Fig. 1" });
    expect(notExtended.figures).toHaveLength(0);
    for (const label of ["Figure S3", "Fig. S3", "Supplementary Fig. 3", "Extended Data Fig. S3", "Extended Data"]) {
      const refused = await extractPdfFigures(pdf, { maxPages: 300, maxFigures: 1, onlyPage: 2, label });
      expect(refused.figures, label).toHaveLength(0);
      expect(refused.reason, label).toContain("does not name a figure");
    }
  });

  it("measurePdfFigure sizes an Extended Data figure by its token, as the route would draw it", async () => {
    const pdf = new Uint8Array(natureLikePdf());
    const drawn = await extractPdfFigures(pdf, { maxPages: 300, maxFigures: 1, onlyPage: 3, label: "Extended Data Fig. 1" });
    const info = pngInfo(drawn.figures[0].png);
    expect(await measurePdfFigure(pdf, 3, "ed1")).toEqual({ width: info.width, height: info.height });
    expect(await measurePdfFigure(pdf, 2, 1)).not.toBeNull();
    expect(await measurePdfFigure(pdf, 2, "ed1")).toBeNull();
    for (const token of ["ed", "ed0", "ed03", "ED1", "s3", "S3", "1", "ed1a", "ed1000"]) {
      expect(await measurePdfFigure(pdf, 3, token), token).toBeNull();
    }
  });

  it("withFigureSizes sizes a caption labelled Extended Data by its token", async () => {
    const pdf = new Uint8Array(natureLikePdf());
    const sized = await withFigureSizes(
      { sections: [], figureCaptions: [{ ordinal: 0, label: "Extended Data Fig 1", caption: "Soil moisture in the spring.", page: 3 }], source: "pdf" } as never,
      pdf,
    );
    const info = pngInfo((await extractPdfFigures(pdf, { maxPages: 300, maxFigures: 1, onlyPage: 3, label: "Extended Data Fig. 1" })).figures[0].png);
    expect(sized.figureCaptions[0]).toMatchObject({ width: info.width, height: info.height });
  });
});

describe("the whole-document pool covers a paper's main figures and its Extended Data (P12-56, R14a)", () => {
  it("lists all fifteen figures of a paper with five main and ten Extended Data, the last one included", async () => {
    const pages: FigurePage[] = [];
    for (let n = 1; n <= 5; n++) pages.push({ text: [[`Fig. ${n} | Invented main figure number ${n}.`, 100, 262, 9]], shapes: panel(100, 80, 370, 160) });
    for (let n = 1; n <= 10; n++) pages.push({ text: [[`Extended Data Fig. ${n} | Invented extended figure number ${n}.`, 100, 262, 9]], shapes: panel(100, 80, 370, 160) });
    const result = await extractPdfCandidatesFromBytes(new Uint8Array(figurePdf(pages)), "publisher");
    expect(result.status).toBe("candidates");
    expect(result.candidates).toHaveLength(15);
    const captions = result.candidates.map((c) => c.caption ?? "");
    expect(captions[0]).toMatch(/^Fig\. 1 \|/);
    expect(captions[14]).toMatch(/^Extended Data Fig\. 10 \|/);
  }, 120_000);
});

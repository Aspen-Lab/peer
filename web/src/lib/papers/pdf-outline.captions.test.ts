import { describe, expect, it } from "vitest";
import { buildOutline, captionOf, continuesCaption, headingOf, type PdfLine, type PdfTextItem } from "./pdf-outline";

// P12-46 (B P12-39, M6): what the outline takes for a figure's caption. All of it is invented text,
// built the way `pdf-outline.test.ts` builds a page: runs on baselines, in a face and a size.

/** A run of text on a page, as pdf.js hands it over. */
function item(str: string, at: Partial<PdfTextItem> = {}): PdfTextItem {
  return { str, height: 10, width: str.length * 4.6, fontName: "body", x: 100, y: 500, ...at };
}

function line(text: string, at: Partial<PdfLine> = {}): PdfLine {
  return { page: 1, text, x: 100, y: 500, size: 10, font: "body", ...at };
}

const BODY = { size: 10, font: "body" };

/** A line of the paper's prose; at 12 points apart these set the line pitch the outline reads. */
const filler = (y: number) => item("Recurrent neural networks have long been established in sequence modelling and transduction.", { y });

/** A one-page paper: a title, a heading, six lines of prose from y = 726 down to 666, then `middle`
 *  (which starts at y = 654, the next line of the same block), then three lines of prose again. */
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

const proseOf = (outline: ReturnType<typeof buildOutline>) => (outline.sections ?? []).map((s) => s.text).join(" ");
const labelsOf = (outline: ReturnType<typeof buildOutline>) => (outline.figureCaptions ?? []).map((c) => c.label);

describe("a caption has a separator after its label's number (P12-46, R6a)", () => {
  it("reads every shape a real caption is printed in", () => {
    const shapes: [string, string, string][] = [
      ["Figure 1: The Transformer - model architecture.", "Figure 1", "The Transformer - model architecture."],
      ["Fig. 2. Soil moisture under three covers.", "Fig 2", "Soil moisture under three covers."],
      ["Fig 3: Soil moisture", "Fig 3", "Soil moisture"],
      ["Figure 4 — Soil moisture", "Figure 4", "Soil moisture"],
      ["Figure 5 – Soil moisture", "Figure 5", "Soil moisture"],
      ["Fig. 6 - Soil moisture", "Fig 6", "Soil moisture"],
      ["Table 7 Scores of the three covers", "Table 7", "Scores of the three covers"],
      ["Table 8. BLEU scores", "Table 8", "BLEU scores"],
      ["Scheme 1. Route to the film", "Scheme 1", "Route to the film"],
      ["Chart 2: Share of the yield", "Chart 2", "Share of the yield"],
      ["FIGURE 9. SOIL MOISTURE", "FIGURE 9", "SOIL MOISTURE"],
      ["figure 10: soil moisture", "figure 10", "soil moisture"],
      ["Figure IV. Soil moisture", "Figure IV", "Soil moisture"],
      ["Fig.11: Soil moisture", "Fig 11", "Soil moisture"],
    ];
    for (const [text, label, caption] of shapes) {
      expect(captionOf(line(text)), text).toMatchObject({ label, caption });
    }
  });

  it("reads a bar, a lone label and a dash of any kind as the separator they are", () => {
    expect(captionOf(line("Table 3 | Parameters of the model")), "bar").toMatchObject({ ordinal: 3, label: "Table 3" });
    expect(captionOf(line("Fig. 4|Parameters")), "bar, no space").toMatchObject({ ordinal: 4, label: "Fig 4" });
    expect(captionOf(line("Figure 5")), "label alone").toMatchObject({ ordinal: 5, label: "Figure 5", caption: "" });
    expect(captionOf(line("Figure 6 ")), "label alone, a space after").toMatchObject({ ordinal: 6, caption: "" });
    for (const code of [0x2010, 0x2011, 0x2012, 0x2013, 0x2014, 0x2015, 0x2212, 0x2d]) {
      const dash = String.fromCodePoint(code);
      expect(captionOf(line(`Figure 7 ${dash} Soil moisture`)), `U+${code.toString(16)}`).toMatchObject({ ordinal: 7, label: "Figure 7" });
    }
  });

  it("refuses a line that opens by citing a figure: ) , ; or a small letter after the number", () => {
    const citations = [
      "Fig. 8) is consistent with the trend we measured at the low rate.",
      "Fig. 8), which the model also predicts, is",
      "Figure 8) and the table agree on the order",
      "Fig. 3, left, shows the same ordering as",
      "Fig. 2; the curve bends over at the",
      "Figure 3 shows the same ordering as the",
      "Table 2 lists the three covers and",
      "Fig. 1(a) shows the setup and the",
      "Figure 4 and 5 show how the",
      "Fig. 5 (left) is the one that",
      "Figure IV shows the setup and",
      "Fig. 8a) is the panel that",
    ];
    for (const text of citations) expect(captionOf(line(text)), text).toBeNull();
  });

  it("still refuses what was never a label", () => {
    expect(captionOf(line("Figure captions are elsewhere"))).toBeNull();
    expect(captionOf(line("Figures 3 and 4 show the same"))).toBeNull();
    expect(captionOf(line("Tables are listed in the appendix."))).toBeNull();
    expect(captionOf(line("Figure"))).toBeNull();
  });

  it("keeps a line that opens with a figure's label out of the headings, caption or not", () => {
    expect(headingOf(line("Figure 1: The Transformer - model architecture.", { size: 12 }), BODY)).toBeNull();
    expect(headingOf(line("Fig. 8) is consistent with the trend we measured", { size: 12 }), BODY)).toBeNull();
    expect(headingOf(line("Figure 3 shows the same ordering as the", { size: 12 }), BODY)).toBeNull();
  });

  it("end to end: a body line that begins with a parenthesised figure citation is prose, not a figure on the list", () => {
    const outline = paper([
      item("Fig. 8) is consistent with the trend we measured at the low rate of deposition.", { y: 654 }),
      item("Figure 1: Medical image analysis pipeline.", { y: 630, fontName: "caption" }),
    ]);
    expect(labelsOf(outline)).toEqual(["Figure 1"]);
    expect(outline.figureCaptions?.[0].caption).toBe("Medical image analysis pipeline.");
    expect(proseOf(outline)).toContain("Fig. 8) is consistent with the trend we measured at the low rate of deposition.");
  });

  it("end to end: a line that opens 'Figure 3 shows' joins its paragraph and is no caption either", () => {
    const outline = paper([item("Figure 3 shows the same ordering as the two earlier runs of the experiment.", { y: 654 })]);
    expect(labelsOf(outline)).toEqual([]);
    expect(proseOf(outline)).toContain("Figure 3 shows the same ordering as the two earlier runs of the experiment.");
  });
});

describe("a caption may change face once, right after its first line (P12-46, R7a)", () => {
  // A margin caption: a bold title line, then lines in the text face, one block at one leading.
  const BODY12 = { size: 12, font: "body" };
  const first = line("Figure 2: Soil moisture under the three covers.", { y: 330, size: 12, font: "titlebold" });
  const second = line("Measured weekly at ten depths in the spring and summer,", { y: 318, size: 12, font: "body" });
  const next = (over: Partial<PdfLine>, from: PdfLine = first) => line("and averaged over the three plots of each cover.", { y: from.y - 12, size: 12, font: "body", ...over });
  const ends = (previous: PdfLine, following: PdfLine, pitch = 12, body = BODY12) => !continuesCaption(previous, following, pitch, body, new Set());

  it("takes the text-face line under a title-face first line, at the caption's size and one line pitch", () => {
    expect(continuesCaption(first, second, 12, BODY12, new Set())).toBe(true);
    // The leading of one block, a little either way.
    expect(continuesCaption(first, next({ y: first.y - 13.5 }), 12, BODY12, new Set())).toBe(true);
    expect(continuesCaption(first, next({ y: first.y - 10 }), 12, BODY12, new Set())).toBe(true);
  });

  it("ends at a line of another leading: the prose under a figure sits further below, or tighter", () => {
    expect(ends(first, next({ y: first.y - 17 })), "1.4 pitches").toBe(true);
    expect(ends(first, next({ y: first.y - 15 })), "1.25 pitches").toBe(true);
    expect(ends(first, next({ y: first.y - 9 })), "0.75 pitch").toBe(true);
    expect(ends(first, next({ y: first.y - 19 })), "past the pitch and a half, as before").toBe(true);
  });

  it("ends at a line of another size", () => {
    expect(ends(first, next({ size: 9 }))).toBe(true);
    expect(ends(first, next({ size: 14 }))).toBe(true);
  });

  it("lets only the one change by: a second change of face ends the caption", () => {
    expect(continuesCaption(second, next({ font: "body" }, second), 12, BODY12, new Set())).toBe(true);
    expect(ends(second, next({ font: "italic" }, second)), "third line in a third face").toBe(true);
    expect(ends(second, next({ font: "titlebold" }, second)), "the title face again").toBe(true);
    // The first line and a second in the same face, then a change: that is the first change, but not right after the first line.
    const secondBold = line("Measured weekly at ten depths in the spring and summer,", { y: 318, size: 12, font: "titlebold" });
    expect(continuesCaption(first, secondBold, 12, BODY12, new Set())).toBe(true);
    expect(ends(secondBold, next({ font: "body" }, secondBold)), "after a second line in the title face").toBe(true);
  });

  it("lets it by only directly after the caption's first line, the line that opens with the label", () => {
    const notALabel = line("a line of the paper, set in the title face", { y: 330, size: 12, font: "titlebold" });
    expect(ends(notALabel, next({}, notALabel))).toBe(true);
    expect(ends(line("Figure 2) is the one we", { y: 330, size: 12, font: "titlebold" }), next({}))).toBe(true);
  });

  it("does not let a face change by when there is no line pitch to hold it to", () => {
    expect(ends(first, second, 0)).toBe(true);
    // The same face needs none, as before.
    const sameFace = line("feature extraction, and classification stages", { y: 318, size: 12, font: "titlebold" });
    expect(continuesCaption(first, sameFace, 0, BODY12, new Set())).toBe(true);
  });

  it("reads the leading for the size the caption is set in: a caption smaller than the text has a tighter pitch", () => {
    const small = line("Figure 3: Soil moisture under the three covers.", { y: 330, size: 9, font: "titlebold" });
    const smallNext = (gap: number) => line("Measured weekly at ten depths in the spring.", { y: small.y - gap, size: 9, font: "body" });
    // The paper's pitch is 15 for 12-point text: 11.25 for 9-point.
    expect(continuesCaption(small, smallNext(11), 15, BODY12, new Set())).toBe(true);
    expect(ends(small, smallNext(15), 15)).toBe(true);
    expect(ends(small, smallNext(7), 15)).toBe(true);
  });

  it("keeps the old tests' answers: prose back in the text face under a caption's last line ends it", () => {
    const cap = line("Figure 1: Medical image analysis pipeline showing preprocessing,", { y: 330, size: 12, font: "caption" });
    const capSecond = line("feature extraction, and classification stages", { y: 314, size: 12, font: "caption" });
    const proseBack = line("Drug Formation and Innovation:-The long and costly process", { y: 298, size: 12, font: "body" });
    expect(continuesCaption(cap, capSecond, 16, BODY12, new Set())).toBe(true);
    expect(continuesCaption(capSecond, proseBack, 16, BODY12, new Set())).toBe(false);
  });

  // Whole papers. The lines under the caption's first line are at y = 642, 630...; the prose of the page is 12 apart.
  it("end to end: a caption with a bold first line and text-face lines of the same size and pitch is all of its lines", () => {
    const outline = paper([
      item("Figure 2: Soil moisture under the three covers.", { y: 654, fontName: "titlebold" }),
      item("Measured weekly at ten depths in the spring and summer,", { y: 642 }),
      item("and averaged over the three plots of each cover.", { y: 630 }),
    ]);
    expect(outline.figureCaptions).toEqual([
      {
        ordinal: 2,
        label: "Figure 2",
        caption: "Soil moisture under the three covers. Measured weekly at ten depths in the spring and summer, and averaged over the three plots of each cover.",
        page: 1,
      },
    ]);
    const prose = proseOf(outline);
    expect(prose).not.toContain("Measured weekly");
    expect(prose).not.toContain("averaged over the three plots");
    expect(prose).toContain("Recurrent neural networks");
  });

  it("end to end: prose under a figure in another face, at another pitch, stays outside the caption", () => {
    const outline = paper([
      item("Figure 2: Soil moisture under the three covers.", { y: 654, fontName: "titlebold" }),
      item("The deeper layers hold more water than the straw does in every one of the four seasons.", { y: 637 }),
    ]);
    expect(outline.figureCaptions?.map((c) => c.caption)).toEqual(["Soil moisture under the three covers."]);
    expect(proseOf(outline)).toContain("The deeper layers hold more water than the straw does in every one of the four seasons.");
  });

  it("end to end: a third face after the text-face line ends the caption there", () => {
    const outline = paper([
      item("Figure 2: Soil moisture under the three covers.", { y: 654, fontName: "titlebold" }),
      item("Measured weekly at ten depths in the spring and summer,", { y: 642 }),
      item("and averaged over the three plots of each cover.", { y: 630, fontName: "italic" }),
    ]);
    expect(outline.figureCaptions?.map((c) => c.caption)).toEqual(["Soil moisture under the three covers. Measured weekly at ten depths in the spring and summer,"]);
    expect(JSON.stringify(outline.sections)).toContain("averaged over the three plots of each cover.");
  });
});

describe("a number-led line ends a caption only when it is set at 0.95 of the body or more (C P12-74, R4)", () => {
  const caption = (size: number) => line("Figure 3: Capacity retention of the coated cells at three", { y: 330, size, font: "cap" });
  const middle = (size: number, text = "25 C and 45 C and 60 C with the uncoated cell shown for") => line(text, { y: 318, size, font: "cap" });

  it("takes a caption's own middle line that opens with a number, set as small as the caption", () => {
    expect(continuesCaption(caption(8.4), middle(8.4), 12, BODY, new Set())).toBe(true);
    expect(continuesCaption(caption(9.4), middle(9.4), 12, BODY, new Set())).toBe(true);
    // a line that does not open with a number goes on as it did
    expect(continuesCaption(caption(8.4), middle(8.4, "with the uncoated cell shown for comparison"), 12, BODY, new Set())).toBe(true);
  });

  it("still ends the caption at a numbered line set at 0.95 of the body or more", () => {
    expect(continuesCaption(caption(9.6), middle(9.6), 12, BODY, new Set())).toBe(false);
    expect(continuesCaption(caption(10), middle(10, "2 Methods"), 12, BODY, new Set())).toBe(false);
    expect(continuesCaption(caption(12), middle(12, "2.1 Cell assembly"), 12, BODY, new Set())).toBe(false);
  });

  it("end to end: a caption set small keeps its number-led middle line, and it opens no section", () => {
    const outline = paper([
      item("Figure 3: Capacity retention of the coated cells at three", { y: 654, height: 8.4, fontName: "cap" }),
      item("25 C and 45 C and 60 C with the uncoated cell shown for", { y: 644, height: 8.4, fontName: "cap" }),
      item("comparison in each panel of the figure.", { y: 634, height: 8.4, fontName: "cap" }),
    ]);
    expect(outline.figureCaptions?.map((c) => c.caption)).toEqual([
      "Capacity retention of the coated cells at three 25 C and 45 C and 60 C with the uncoated cell shown for comparison in each panel of the figure.",
    ]);
    expect(proseOf(outline)).not.toContain("25 C and 45 C");
    expect(outline.sections?.map((s) => s.heading)).toEqual(["1 Introduction"]);
  });
});

describe("a caption goes on through its title's face change (C P12-82, K1, R1-B)", () => {
  // The shapes a real caption is printed in, invented: a bold title and the text face. The face of a line is the face
  // of its longest run, so a first line whose bold title is longer than its text-face tail reads as bold, and the
  // text-face line under it as another face. The paper's prose is at 10 points on a 12-point grid (pitch 12).
  const TITLE = "titlebold";
  const TAIL = "captext";
  const piece = (str: string, y: number, at: Partial<PdfTextItem> = {}) => item(str, { y, ...at });
  const captionsOf = (outline: ReturnType<typeof buildOutline>) => (outline.figureCaptions ?? []).map((c) => c.caption);

  // The tails of a caption, in the order they are printed.
  const T1 = "Measured at ten depths in the spring and summer,";
  const T2 = "and averaged over the three plots of each cover.";
  const W1 = "spring and summer of the second year of the trial.";

  it("takes the whole caption whose bold title is longer than the text-face tail of its first line (P3's Fig. 1 shape)", () => {
    const title = "Figure 1: Soil moisture under the three covers across the spring and summer. ";
    const outline = paper([
      piece(title, 654, { height: 8, fontName: TITLE }),
      piece("Weekly means, n = 3.", 654, { height: 8, fontName: TAIL, x: 100 + title.length * 4.6 }),
      piece(T1, 642, { height: 8, fontName: TAIL }),
      piece(T2, 630, { height: 8, fontName: TAIL }),
    ]);
    expect(captionsOf(outline)).toEqual([`Soil moisture under the three covers across the spring and summer. Weekly means, n = 3. ${T1} ${T2}`]);
    // Set at 8 points on the paper's 12-point grid, its leading is not the page pitch's (9.6 for 8 points): its own is.
    expect(proseOf(outline)).not.toContain("Measured at ten depths");
    expect(proseOf(outline)).not.toContain("averaged over the three plots");
    expect(proseOf(outline)).toContain("Recurrent neural networks");
  });

  it("takes the text-face lines under a title wrapped onto two lines, set smaller than the body (P4's and P5's shape)", () => {
    const outline = paper([
      piece("Figure 4: Soil moisture under the three covers across the", 654, { height: 7.4, fontName: TITLE }),
      piece(W1, 642, { height: 7.4, fontName: TITLE }),
      // The caption's text face is the body's own face, set smaller.
      piece(T1, 630, { height: 7 }),
      piece(T2, 618, { height: 7 }),
    ]);
    expect(captionsOf(outline)).toEqual([`Soil moisture under the three covers across the ${W1} ${T1} ${T2}`]);
    expect(proseOf(outline)).not.toContain("Measured at ten depths");
  });

  it("ends a caption at a body paragraph in the body's face and size, however the title is wrapped", () => {
    const outline = paper([
      piece("Figure 5: Soil moisture under the three covers across the", 654, { fontName: TITLE }),
      piece(W1, 642, { fontName: TITLE }),
      piece("The deeper layers hold more water than the straw does in every", 630),
      piece("one of the four seasons, which the second plot confirms in turn.", 618),
    ]);
    expect(captionsOf(outline)).toEqual([`Soil moisture under the three covers across the ${W1}`]);
    expect(proseOf(outline)).toContain("The deeper layers hold more water than the straw does in every one of the four seasons");
  });

  it("ends a caption at its second change of face after the first line, at the body's size", () => {
    const outline = paper([
      piece("Figure 6: Soil moisture under the three covers across the", 654, { fontName: TITLE }),
      piece(W1, 642, { fontName: TAIL }),
      piece(T2, 630, { fontName: "italic" }),
    ]);
    expect(captionsOf(outline)).toEqual([`Soil moisture under the three covers across the ${W1}`]);
    expect(proseOf(outline)).toContain(T2);
  });

  it("ends a caption at its second change of face even when the line is set smaller than the body", () => {
    // Bold, bold, text face (the one change, smaller than the body), then a third face: the third ends it.
    const outline = paper([
      piece("Figure 7: Soil moisture under the three covers across the", 654, { height: 8, fontName: TITLE }),
      piece(W1, 642, { height: 8, fontName: TITLE }),
      piece(T1, 630, { height: 8, fontName: TAIL }),
      piece(T2, 618, { height: 8, fontName: "italic" }),
    ]);
    expect(captionsOf(outline)).toEqual([`Soil moisture under the three covers across the ${W1} ${T1}`]);
    expect(proseOf(outline)).toContain(T2);
  });

  it("ends a caption that goes back to its first face after the one change", () => {
    const outline = paper([
      piece("Figure 8: Soil moisture under the three covers across the", 654, { height: 8, fontName: TITLE }),
      piece(W1, 642, { height: 8, fontName: TITLE }),
      piece(T1, 630, { height: 8, fontName: TAIL }),
      piece(T2, 618, { height: 8, fontName: TITLE }),
    ]);
    expect(captionsOf(outline)).toEqual([`Soil moisture under the three covers across the ${W1} ${T1}`]);
    expect(proseOf(outline)).toContain(T2);
  });

  it("holds the change to the caption's own leading: a text-face line at another gap than the title's lines ends it", () => {
    // Title lines 12 apart; the line in the text face 17 below (1.4 pitches): not the caption's leading.
    const outline = paper([
      piece("Figure 9: Soil moisture under the three covers across the", 654, { height: 8, fontName: TITLE }),
      piece(W1, 642, { height: 8, fontName: TITLE }),
      piece(T1, 625, { height: 8, fontName: TAIL }),
    ]);
    expect(captionsOf(outline)).toEqual([`Soil moisture under the three covers across the ${W1}`]);
    expect(proseOf(outline)).toContain(T1);
    // And under a one-line title, with the line after at the leading of its own block: 17 below the title is not 12.
    const first = paper([
      piece("Figure 9: Soil moisture under the three covers across the", 654, { height: 8, fontName: TITLE }),
      piece(W1, 637, { height: 8, fontName: TAIL }),
      piece(T1, 625, { height: 8, fontName: TAIL }),
    ]);
    expect(captionsOf(first)).toEqual(["Soil moisture under the three covers across the"]);
  });

  describe("continuesCaption, told what the caption has shown", () => {
    const BODY10 = { size: 10, font: "body" };
    const title1 = line("Figure 1: Soil moisture under the three covers, set in bold.", { y: 330, size: 8, font: TITLE });
    const title2 = line("Second line of the title, set in bold.", { y: 318, size: 8, font: TITLE });
    const tail = (y: number, over: Partial<PdfLine> = {}) => line("Measured weekly at ten depths in the spring.", { y, size: 8, font: TAIL, ...over });
    const goes = (previous: PdfLine, next: PdfLine, lines: PdfLine[], after?: PdfLine, pitch = 12) =>
      continuesCaption(previous, next, pitch, BODY10, new Set(), { lines, after });

    it("reads the leading of a one-line caption from the line after: its own, within a line pitch and a half", () => {
      // The page pitch is 12 (9.6 for 8 points); the caption is set 12 apart and the page's 9.6 would not hold it.
      expect(continuesCaption(title1, tail(318), 12, BODY10, new Set())).toBe(false);
      expect(goes(title1, tail(318), [title1], tail(306))).toBe(true);
      // A line after in another face, another size or too far below is no measure: the page's pitch decides, as it did.
      expect(goes(title1, tail(318), [title1], tail(306, { font: "other" }))).toBe(false);
      expect(goes(title1, tail(318), [title1], tail(306, { size: 10 }))).toBe(false);
      expect(goes(title1, tail(318), [title1], tail(290))).toBe(false);
      expect(goes(title1, tail(320.4), [title1], tail(290)), "9.6 below the title is the page's leading").toBe(true);
      expect(goes(title1, tail(318), [title1], undefined)).toBe(false);
    });

    it("reads the leading of a longer caption from its last two lines", () => {
      const lines = [title1, title2];
      expect(goes(title2, tail(306), lines)).toBe(true);
      expect(goes(title2, tail(306 + 2), lines), "10 below, 17% under").toBe(true);
      expect(goes(title2, tail(306 - 2), lines), "14 below, 17% over").toBe(true);
      expect(goes(title2, tail(306 - 4), lines), "16 below").toBe(false);
      expect(goes(title2, tail(306 + 4), lines), "8 below").toBe(false);
    });

    it("lets one change of face by after the first line only to a line smaller than the body", () => {
      const lines = [title1, title2];
      expect(goes(title2, tail(306, { size: 8 }), lines)).toBe(true);
      expect(goes(title2, tail(306, { size: 8.5 }), lines)).toBe(true);
      // The body is 10; a line under it by 0.6 or more is smaller (the line must also be within 0.6 of the title's size).
      expect(goes({ ...title2, size: 9.3 }, tail(306, { size: 9.3 }), lines)).toBe(true);
      expect(goes({ ...title2, size: 9.5 }, tail(306, { size: 9.5 }), lines)).toBe(false);
      expect(goes({ ...title2, size: 10 }, tail(306, { size: 10 }), lines)).toBe(false);
    });

    it("lets a change by right after the first line at the caption's own size, the body's included", () => {
      const open = line("Figure 2: Soil moisture under the three covers, set in bold.", { y: 330, size: 10, font: TITLE });
      const next = line("Measured weekly at ten depths in the spring.", { y: 318, size: 10, font: TAIL });
      const after = line("and averaged over the three plots of each cover.", { y: 306, size: 10, font: TAIL });
      expect(goes(open, next, [open], after)).toBe(true);
    });

    it("lets only one change by: a caption that has changed face does not change again, smaller or not", () => {
      const first = line("Figure 3: Soil moisture under the three covers, set in bold.", { y: 330, size: 8, font: TITLE });
      const second = tail(318);
      const lines = [first, second];
      expect(goes(second, tail(306, { font: "italic" }), lines)).toBe(false);
      expect(goes(second, tail(306, { font: TITLE }), lines)).toBe(false);
      expect(goes(second, tail(306), lines), "the same face goes on").toBe(true);
      const third = tail(306);
      expect(goes(third, tail(294), [first, second, third])).toBe(true);
    });
  });

  it("end to end: a caption that goes on through its title's face change keeps the next caption of a list a caption (R6b)", () => {
    // Figure 1's text lines are in the body's face and size, 15 below each other and the title, and end without a stop;
    // Figure 2 follows the last of them, 15 below. A line that opens with a label directly under open prose is the next
    // words of a sentence unless it is under a caption's own line: Figure 1's chain has to reach the line above.
    const wide = "Measured at ten depths in the spring and summer on all of the three plots,";
    const wide2 = "averaged over the plots of each cover and compared with the open ground,";
    const outline = paper([
      piece("Figure 1: Soil moisture under the three covers across the spring and summer. ", 654, { fontName: TITLE }),
      piece(wide, 639),
      piece(wide2, 624),
      piece("Figure 2: Soil temperature under the three covers across the year", 609, { fontName: TAIL }),
    ]);
    expect(labelsOf(outline)).toEqual(["Figure 1", "Figure 2"]);
    expect(captionsOf(outline)[0]).toBe(`Soil moisture under the three covers across the spring and summer. ${wide} ${wide2}`);
  });

  it("end to end: the lines of a caption are not figure text, so the tick labels under it do not become a run with them", () => {
    // A figure's panel text is lifted from the prose when three or more short lines stand together beside a caption.
    // The two short text-face lines of this caption are caption (they are taken in), and the two tick labels after it
    // are too few to be a run: they stay in the prose. Were the caption's lines counted in, four would be lifted out.
    const outline = paper([
      piece("Figure 3: Soil moisture under the three covers across the spring and summer. ", 654, { height: 8, fontName: TITLE }),
      piece("in each of the plots", 642, { height: 8, fontName: TAIL }),
      piece("of the three covers", 630, { height: 8, fontName: TAIL }),
      piece("0.5", 618, { height: 8, fontName: "tick" }),
      piece("1.0", 606, { height: 8, fontName: "tick" }),
    ]);
    expect(captionsOf(outline)).toEqual(["Soil moisture under the three covers across the spring and summer. in each of the plots of the three covers"]);
    const prose = proseOf(outline);
    expect(prose).toContain("0.5");
    expect(prose).toContain("1.0");
  });
});

import { describe, expect, it } from "vitest";
import { buildOutline, captionAt, captionOf, type PdfLine, type PdfTextItem } from "./pdf-outline";

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

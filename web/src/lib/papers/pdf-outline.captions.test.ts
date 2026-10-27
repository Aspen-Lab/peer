import { describe, expect, it } from "vitest";
import { buildOutline, captionOf, headingOf, type PdfLine, type PdfTextItem } from "./pdf-outline";

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

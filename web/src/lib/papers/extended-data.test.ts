import { describe, expect, it } from "vitest";
import { buildOutline, captionOf, type PdfLine, type PdfTextItem } from "./pdf-outline";

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

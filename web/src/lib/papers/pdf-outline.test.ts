import { describe, expect, it } from "vitest";
import { blockMarker } from "@/lib/text/math";
import {
  bodyStyle,
  buildOutline,
  continuesCaption,
  equationOf,
  linePitch,
  captionOf,
  furnitureOf,
  headingOf,
  joinProse,
  linesOfPage,
  type PdfLine,
  type PdfPageText,
  type PdfTextItem,
} from "./pdf-outline";

/** A run of text on a page, as pdf.js hands it over. */
function item(str: string, at: Partial<PdfTextItem> = {}): PdfTextItem {
  return { str, height: 10, width: str.length * 4.6, fontName: "body", x: 100, y: 500, ...at };
}

function line(text: string, at: Partial<PdfLine> = {}): PdfLine {
  return { page: 1, text, x: 100, y: 500, size: 10, font: "body", ...at };
}

const BODY = { size: 10, font: "body" };

describe("lines", () => {
  it("gathers items on one baseline, left to right, and spaces the gaps", () => {
    // A PDF stores runs, not words: "Ashish Vaswani" and "Noam Shazeer" came
    // back as one string until the gap between them was measured.
    const page: PdfPageText = {
      page: 1,
      items: [
        item("Noam Shazeer", { x: 220, y: 549 }),
        item("Ashish Vaswani", { x: 133, y: 549 }),
        item("Google Brain", { x: 133, y: 535 }),
      ],
    };
    expect(linesOfPage(page).map((l) => l.text)).toEqual([
      "Ashish Vaswani Noam Shazeer",
      "Google Brain",
    ]);
  });

  it("reads the size and face the paper is mostly set in", () => {
    const lines = [
      line("a".repeat(400)),
      line("A HEADING", { size: 18, font: "display" }),
      line("b".repeat(300)),
    ];
    expect(bodyStyle(lines)).toEqual({ size: 10, font: "body" });
  });

  it("finds the page's furniture: what repeats at the same height", () => {
    const lines = [1, 2, 3, 4].map((page) => line("Preprint — under review", { page, y: 720 }));
    const furniture = furnitureOf([...lines, line("A real sentence", { y: 400 })], 4);
    expect(furniture.size).toBe(1);
  });
});

describe("headings", () => {
  it("takes a numbered heading, at any depth", () => {
    expect(headingOf(line("3.2.1 Scaled Dot-Product Attention"), BODY)).toBe("3.2.1 Scaled Dot-Product Attention");
    expect(headingOf(line("2. Mathematical model"), BODY)).toBe("2. Mathematical model");
  });

  it("takes a heading set larger, or in the other face", () => {
    expect(headingOf(line("Abstract", { size: 12 }), BODY)).toBe("Abstract");
    expect(headingOf(line("Discussion", { font: "display" }), BODY)).toBe("Discussion");
  });

  it("refuses prose that happens to start with a number", () => {
    // Real line from a chromatography paper, broken across a column.
    expect(headingOf(line("10 and the flow is clearly laminar, diffusion then is"), BODY)).toBeNull();
  });

  it("refuses a display equation, however it is set apart", () => {
    expect(headingOf(line("= kac − kdq . (2)", { size: 12 }), BODY)).toBeNull();
    expect(headingOf(line("qe,ic0,1 ka,ic0,iqe,1", { font: "maths", size: 11 }), BODY)).toBeNull();
    expect(headingOf(line("Attention(Q, K, V ) = softmax(QKT )V", { size: 12 }), BODY)).toBeNull();
  });

  it("refuses a caption, a sentence, and body text", () => {
    expect(headingOf(line("Figure 1: The Transformer - model architecture.", { size: 12 }), BODY)).toBeNull();
    expect(headingOf(line("We trained on the WMT 2014 corpus.", { size: 12 }), BODY)).toBeNull();
    expect(headingOf(line("ordinary body text"), BODY)).toBeNull();
  });
});

describe("captions", () => {
  it("reads the label, the number and the words", () => {
    expect(captionOf(line("Figure 1: The Transformer - model architecture."))).toMatchObject({
      ordinal: 1,
      label: "Figure 1",
      caption: "The Transformer - model architecture.",
    });
    expect(captionOf(line("Table 2. BLEU scores"))).toMatchObject({ ordinal: 2, label: "Table 2" });
    expect(captionOf(line("Figure captions are elsewhere"))).toBeNull();
  });
});

describe("prose", () => {
  it("mends a word the page broke, and keeps the paragraphs", () => {
    const lines = [
      line("The encoder is composed of a stack of six identical archi-", { y: 500 }),
      line("tecture layers.", { y: 488 }),
      line("Each layer has two sub-layers.", { y: 450 }),
    ];
    expect(joinProse(lines)).toBe(
      "The encoder is composed of a stack of six identical architecture layers.\n\nEach layer has two sub-layers.",
    );
  });
});

describe("the whole reading", () => {
  const page = (n: number, rows: [string, Partial<PdfTextItem>?][]): PdfPageText => ({
    page: n,
    items: rows.map(([text, at], i) => item(text, { y: 700 - i * 14, ...at })),
  });

  it("starts at the paper, buckets its parts, and sets the captions aside", () => {
    const outline = buildOutline([
      page(1, [
        ["Attention Is All You Need", { height: 17 }],
        ["Ashish Vaswani", { height: 11, fontName: "display" }],
        ["avaswani@google.com", { height: 9 }],
        ["Abstract", { height: 12 }],
        ["The dominant sequence transduction models are based on complex networks."],
        ["1 Introduction"],
        ["Recurrent neural networks have long been established in sequence modelling."],
        ["Figure 1: The Transformer - model architecture."],
        ["References", { height: 12 }],
        ["[1] Someone. A paper. 2015."],
      ]),
    ]);

    expect(outline.title).toBe("Attention Is All You Need");
    expect(outline.sections?.map((s) => [s.canonical, s.heading])).toEqual([
      ["abstract", "Abstract"],
      ["introduction", "1 Introduction"],
    ]);
    // The cover is not a section, the references are not the argument, and a
    // caption belongs to the figure pool rather than the prose it interrupts.
    const prose = (outline.sections ?? []).map((s) => s.text).join(" ");
    expect(prose).not.toContain("avaswani@google.com");
    expect(prose).not.toContain("Someone");
    expect(prose).not.toContain("Figure 1");
    expect(outline.figureCaptions).toEqual([
      { ordinal: 1, label: "Figure 1", caption: "The Transformer - model architecture.", page: 1 },
    ]);
  });

  it("says a scan is a scan rather than inventing sections", () => {
    const outline = buildOutline([{ page: 1, items: [] }, { page: 2, items: [] }]);
    expect(outline.sections).toBeUndefined();
    expect(outline.reason).toBe("no-text-layer");
    expect(outline.pageCount).toBe(2);
  });
});


describe("equations", () => {
  it("knows a numbered equation, and keeps its number apart from its symbols", () => {
    expect(equationOf(line("Attention(Q, K, V ) = softmax(QK T / √d k )V (1)"))).toEqual({
      text: "Attention(Q, K, V ) = softmax(QK T / √d k )V",
      number: "(1)",
    });
  });

  it("knows an unnumbered equation by what it is made of", () => {
    expect(equationOf(line("L = −∑ y_i log p_i + λ‖w‖^2"))).toEqual({ text: "L = −∑ y_i log p_i + λ‖w‖^2" });
  });

  it("refuses prose, a year in brackets, and a line too long to be one", () => {
    expect(equationOf(line("The loss is defined as follows and then minimised."))).toBeNull();
    expect(equationOf(line("as shown by Vaswani et al. (2017)"))).toBeNull();
    expect(equationOf(line(("x = " + "a + ".repeat(60)).slice(0, 130)))).toBeNull();
  });

  it("stands an equation on a paragraph of its own inside the section", () => {
    const outline = buildOutline([
      {
        page: 1,
        // Enough prose that the page reads as a text layer, not a scan.
        items: [
          item("Attention Is All You Need", { height: 17, y: 700 }),
          item("1 Introduction", { y: 680 }),
          ...Array.from({ length: 6 }, (_, i) =>
            item("Recurrent neural networks have long been established in sequence modelling and transduction.", { y: 666 - i * 12 }),
          ),
          item("The attention is computed as", { y: 590 }),
          item("Attention(Q, K, V ) = softmax(QK T )V (1)", { y: 576 }),
          item("where the keys have size d.", { y: 562 }),
          ...Array.from({ length: 6 }, (_, i) =>
            item("The encoder is composed of a stack of six identical layers, each with two sub-layers.", { y: 548 - i * 12 }),
          ),
        ],
      },
    ]);
    expect(outline.equations).toEqual([{ text: "Attention(Q, K, V ) = softmax(QK T )V", number: "(1)" }]);
    const paragraphs = (outline.sections?.[0].text ?? "").split("\n\n");
    const at = paragraphs.indexOf(blockMarker(0));
    expect(at).toBeGreaterThan(0);
    expect(paragraphs[at - 1]).toMatch(/computed as$/);
    expect(paragraphs[at + 1]).toMatch(/^where the keys/);
  });
});


describe("captions across lines", () => {
  const BODY = { size: 10, font: "body" };

  it("reads the line pitch of a block", () => {
    const lines = [line("a", { y: 500 }), line("b", { y: 488 }), line("c", { y: 476 }), line("d", { y: 440 })];
    expect(linePitch(lines)).toBe(12);
    expect(linePitch([])).toBe(0);
  });

  it("knows the next line of a caption from the prose that resumes under the figure", () => {
    const cap = line("Figure 1: Medical image analysis pipeline showing preprocessing,", { y: 300, size: 9 });
    const second = line("segmentation and classification of the scan.", { y: 289, size: 9 });
    const proseBack = line("The pipeline is trained end to end on the corpus.", { y: 270, size: 10 });
    const afterGap = line("still small type, but a gap above it", { y: 262, size: 9 });
    expect(continuesCaption(cap, second, 12, BODY, new Set())).toBe(true);
    // The body's size is back: that is the paper again.
    expect(continuesCaption(second, proseBack, 12, BODY, new Set())).toBe(false);
    // Too far below the last line to be the same block.
    expect(continuesCaption(second, afterGap, 12, BODY, new Set())).toBe(false);
    // A new caption or a heading is never the tail of this one.
    expect(continuesCaption(cap, line("Figure 2: Another.", { y: 289, size: 9 }), 12, BODY, new Set())).toBe(false);
  });

  it("keeps a two-line caption whole, and hands the prose back to the section", () => {
    const filler = (y: number) => item("Recurrent neural networks have long been established in sequence modelling and transduction.", { y });
    const outline = buildOutline([
      {
        page: 1,
        items: [
          item("A Paper", { height: 17, y: 760 }),
          item("1 Introduction", { y: 740 }),
          ...[726, 714, 702, 690, 678, 666].map(filler),
          item("Figure 1: Medical image analysis pipeline showing preprocessing,", { y: 640, height: 9 }),
          item("segmentation and classification of the scan.", { y: 629, height: 9 }),
          item("The pipeline is trained end to end on the corpus of scans we collected.", { y: 605 }),
          ...[593, 581, 569].map(filler),
        ],
      },
    ]);
    expect(outline.figureCaptions).toEqual([
      {
        ordinal: 1,
        label: "Figure 1",
        caption: "Medical image analysis pipeline showing preprocessing, segmentation and classification of the scan.",
        page: 1,
      },
    ]);
    const prose = (outline.sections ?? []).map((s) => s.text).join(" ");
    expect(prose).toContain("trained end to end");
    expect(prose).not.toContain("segmentation and classification");
  });
});

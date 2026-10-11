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

  // P0-01 (spec D2): `TERMINAL` held "acknowledgements" and "appendix", but
  // `canonicalizeHeading` never returns either — it files the first under
  // `acknowledgments` and strips "Appendix A" down to what follows it — so
  // the thank-yous and the proofs were read as the paper's argument.
  it("stops at a numbered Acknowledgements heading, before the references", () => {
    const outline = buildOutline([
      page(1, [
        ["A Paper About Sequence Models", { height: 17 }],
        ["1 Introduction"],
        ["Recurrent neural networks have long been established in sequence modelling."],
        ["Attention mechanisms have become an integral part of compelling models."],
        ["6 Acknowledgements"],
        ["We thank the anonymous reviewers and our funders for their generous support."],
        ["References", { height: 12 }],
        ["[1] Someone. A paper. 2015."],
      ]),
    ]);
    expect(outline.sections?.map((s) => [s.canonical, s.heading])).toEqual([
      ["introduction", "1 Introduction"],
    ]);
    const prose = (outline.sections ?? []).map((s) => s.text).join(" ");
    expect(prose).toContain("integral part of compelling models");
    expect(prose).not.toContain("We thank the anonymous reviewers");
  });

  it("stops at an appendix the heading's own words name, numbered or not", () => {
    const outline = buildOutline([
      page(1, [
        ["A Paper About Sequence Models", { height: 17 }],
        ["1 Introduction"],
        ["Recurrent neural networks have long been established in sequence modelling."],
        ["Attention mechanisms have become an integral part of compelling models."],
        ["Appendix A Proofs", { height: 12 }],
        ["Proof of Lemma 1 follows from the triangle inequality applied twice over here."],
      ]),
    ]);
    expect(outline.sections?.map((s) => s.heading)).toEqual(["1 Introduction"]);
    const prose = (outline.sections ?? []).map((s) => s.text).join(" ");
    expect(prose).not.toContain("triangle inequality");
  });

  it("says a scan is a scan rather than inventing sections", () => {
    const outline = buildOutline([{ page: 1, items: [] }, { page: 2, items: [] }]);
    expect(outline.sections).toBeUndefined();
    expect(outline.reason).toBe("no-text-layer");
    expect(outline.pageCount).toBe(2);
  });

  // P5-04b, N1 (§1h.16 (c); §1e.4 accepted the number): a PDF whose lines
  // total fewer than 200 characters is a scan with a stray running head, not a
  // paper. Nothing held the 200, so a thinner text layer could have started
  // to read as a document without a test noticing. Same shape on both sides:
  // a title, a numbered heading and two sentences, one word longer by a
  // character (six / nine cells) on the 200 side.
  describe("the scan threshold: under 200 characters of text is a scan (P5-04b, N1)", () => {
    const TITLE = "Quillwort Cathodes Under Fast Charging"; // 38
    const FIRST = "Quillwort cathodes are used in small cells since they hold charge."; // 66
    const second = (cells: string) => `We cycled ${cells} quillwort cells at three charge rates for one month in a warm room.`; // 81 / 82
    const onePage = (cells: string): PdfPageText[] => [
      page(1, [[TITLE, { height: 17 }], ["1 Introduction"], [FIRST], [second(cells)]]),
    ];
    const twoPages = (cells: string): PdfPageText[] => [
      page(1, [[TITLE, { height: 17 }], ["1 Introduction"], [FIRST]]),
      page(2, [[second(cells)]]),
    ];
    const characters = (pages: PdfPageText[]) => pages.flatMap(linesOfPage).reduce((n, l) => n + l.text.length, 0);

    it("199 characters in all is a scan: the page count and the reason, nothing else", () => {
      expect(characters(onePage("six"))).toBe(199);
      expect(buildOutline(onePage("six"))).toEqual({ pageCount: 1, reason: "no-text-layer" });
      // The total is over the whole PDF, not per page.
      expect(characters(twoPages("six"))).toBe(199);
      expect(buildOutline(twoPages("six"))).toEqual({ pageCount: 2, reason: "no-text-layer" });
    });

    it("200 characters in all, the same shape, is read: its title and section, no scan reason", () => {
      // 200 is the smallest total at or above the threshold, and it already
      // reads as an outline (a title, "1 Introduction", its two sentences).
      expect(characters(onePage("nine"))).toBe(200);
      for (const pages of [onePage("nine"), twoPages("nine")]) {
        const outline = buildOutline(pages);
        expect(outline.reason).toBeNull();
        expect(outline.title).toBe(TITLE);
        expect(outline.pageCount).toBe(pages.length);
        expect(outline.sections?.map((s) => [s.canonical, s.heading])).toEqual([["introduction", "1 Introduction"]]);
        expect(outline.sections?.[0].text).toContain(FIRST);
        expect(outline.sections?.[0].text).toContain("We cycled nine quillwort cells");
      }
    });
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
    // The real case: caption and body both 12pt, told apart by face alone.
    const cap = line("Figure 1: Medical image analysis pipeline showing preprocessing,", { y: 330, size: 12, font: "caption" });
    const second = line("feature extraction, and classification stages", { y: 314, size: 12, font: "caption" });
    const proseBack = line("Drug Formation and Innovation:-The long and costly process", { y: 298, size: 12, font: "body" });
    const afterGap = line("caption face again, but a gap above it", { y: 280, size: 12, font: "caption" });
    expect(continuesCaption(cap, second, 16, BODY, new Set())).toBe(true);
    // The body's face is back: that is the paper again.
    expect(continuesCaption(second, proseBack, 16, BODY, new Set())).toBe(false);
    // Too far below the last line to be the same block.
    expect(continuesCaption(second, afterGap, 16, BODY, new Set())).toBe(false);
    // A new caption or a numbered heading is never the tail of this one.
    expect(continuesCaption(cap, line("Figure 2: Another.", { y: 314, size: 12, font: "caption" }), 16, BODY, new Set())).toBe(false);
    expect(continuesCaption(cap, line("2 Methods", { y: 314, size: 12, font: "caption" }), 16, BODY, new Set())).toBe(false);
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
          item("Figure 1: Medical image analysis pipeline showing preprocessing,", { y: 640, fontName: "caption" }),
          item("segmentation and classification of the scan.", { y: 628, fontName: "caption" }),
          item("The pipeline is trained end to end on the corpus of scans we collected.", { y: 616 }),
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


// P7-10 (the owner's R8): the line builder reads what a journal page prints.
// Item-level fixtures, shaped like the runs pdf.js handed over for the
// owner's two-column paper (a superscript is a run of its own, 4pt above its
// line and two thirds its size; the publisher's footer is small print under
// the last line of text; a run-in "ABSTRACT:" is a bold run ahead of the
// abstract's words).

/** Runs set one after another on a line, with no gap between them. */
function chain(parts: [string, Partial<PdfTextItem>?][], at: { x?: number; y?: number } = {}): PdfTextItem[] {
  let x = at.x ?? 100;
  const y = at.y ?? 500;
  return parts.map(([str, own]) => {
    const run = item(str, { x, y, ...own });
    x += run.width;
    return run;
  });
}
/** A superscript as pdf.js hands it over: two thirds the size, 4.4pt above the line. */
const sup = (y = 500): Partial<PdfTextItem> => ({ height: 6.7, y: y + 4.4 });
/** A subscript: two thirds the size, 2pt below the line. */
const sub = (y = 500): Partial<PdfTextItem> => ({ height: 6.7, y: y - 2 });

describe("superscripts and subscripts stay on their line (P7-10)", () => {
  it("reads '1st, 20th' as one string, not as a row of 'st th' placed above the line", () => {
    const page: PdfPageText = {
      page: 1,
      items: [
        ...chain([["after the 1"], ["st", sup()], [", 20"], ["th", sup()], [" charge cycle"]]),
        ...chain([["the next line of the paragraph"]], { y: 488 }),
      ],
    };
    expect(linesOfPage(page).map((l) => l.text)).toEqual(["after the 1st, 20th charge cycle", "the next line of the paragraph"]);
  });

  it("folds a citation number into its line, at the line's own height and size", () => {
    const page: PdfPageText = {
      page: 1,
      items: chain([["The cathode shape"], ["17", sup()], [" and the film"]]),
    };
    const lines = linesOfPage(page);
    expect(lines).toHaveLength(1);
    expect(lines[0].text).toMatch(/^The cathode shape ?17 and the film$/);
    expect(lines[0]).toMatchObject({ y: 500, size: 10 });
  });

  it("folds a subscript too", () => {
    const page: PdfPageText = { page: 1, items: chain([["Films of TiO"], ["2", sub()], [" were grown on gold"]]) };
    expect(linesOfPage(page).map((l) => l.text)).toEqual(["Films of TiO2 were grown on gold"]);
  });

  it("keeps a small line of its own where no line is near enough to own it", () => {
    // 14pt under the line is a footnote, not a subscript.
    const page: PdfPageText = {
      page: 1,
      items: [
        ...chain([["The cathode shape was measured at room temperature"]]),
        ...chain([["a note set small, a line below"]], { y: 486 }).map((r) => ({ ...r, height: 6.7 })),
      ],
    };
    expect(linesOfPage(page).map((l) => l.text)).toEqual([
      "The cathode shape was measured at room temperature",
      "a note set small, a line below",
    ]);
  });
});

describe("margin print is not the paper's text (P7-10)", () => {
  const prose = (y: number, text = "Recurrent neural networks have long been established in sequence modelling.") => item(text, { y });
  const small = (text: string, y: number) => item(text, { y, height: 6.3 });

  it("drops small print below a page's last full-size line and above its first, so a sentence crossing the page break is whole", () => {
    // The publisher's copyright and DOI line is printed on page 1 only (no
    // repetition marks it as furniture) and a library's download stamp on
    // page 2 only; both used to land inside the sentence that crosses.
    const outline = buildOutline([
      {
        page: 1,
        items: [
          item("A Paper About Sequence Models", { height: 17, y: 760 }),
          item("1 Introduction", { y: 740 }),
          ...[726, 714, 702, 690, 678].map((y) => prose(y)),
          prose(666, "The recurrent models carry the sentence that"),
          small("© 2026 Example Society https://doi.org/10.1000/example.2026", 34),
        ],
      },
      {
        page: 2,
        items: [
          small("Downloaded by a library on February 22, 2026", 790),
          prose(740, "carries over to the next page and ends there."),
          ...[728, 716, 704].map((y) => prose(y)),
        ],
      },
    ]);
    const text = (outline.sections ?? []).map((s) => s.text).join(" ");
    expect(text).toContain("the sentence that carries over to the next page and ends there.");
    expect(text).not.toContain("Example Society");
    expect(text).not.toContain("Downloaded by");
  });

  it("keeps a line that is only a little smaller than the body: a 9pt caption-size line is not margin print", () => {
    const outline = buildOutline([
      {
        page: 1,
        items: [
          item("A Paper About Sequence Models", { height: 17, y: 760 }),
          item("1 Introduction", { y: 740 }),
          ...[726, 714, 702, 690, 678, 666].map((y) => prose(y)),
          item("Note: the cells were cycled at 25 C.", { y: 100, height: 9 }),
        ],
      },
    ]);
    expect((outline.sections ?? []).map((s) => s.text).join(" ")).toContain("the cells were cycled at 25 C.");
  });
});

describe("a heading set over two lines is one heading (P7-10)", () => {
  const prose = (y: number) => item("Recurrent neural networks have long been established in sequence modelling.", { y });
  const heading = (text: string, y: number) => item(text, { y, height: 9.5, fontName: "display" });
  const page = (rows: PdfTextItem[]): PdfPageText[] => [
    { page: 1, items: [item("A Paper About Sequence Models", { height: 17, y: 760 }), item("1 Introduction", { y: 740 }), ...[726, 714, 702].map(prose), ...rows] },
  ];

  it("joins the second line of a heading to the first: same face and size, one leading below, not numbered", () => {
    const outline = buildOutline(
      page([heading("2.1. Slow Annealing Schedules for Quillwort Cathode", 680), heading("Films", 668.6), ...[656, 644, 632].map(prose)]),
    );
    expect(outline.sections?.map((s) => s.heading)).toEqual([
      "1 Introduction",
      "2.1. Slow Annealing Schedules for Quillwort Cathode Films",
    ]);
    expect(outline.sections?.[1].text).toMatch(/^Recurrent neural networks/);
  });

  it("does not join a numbered heading to the one above it", () => {
    const outline = buildOutline(
      page([heading("2.1 First Part", 680), heading("2.2 Second Part", 668.6), ...[656, 644, 632].map(prose)]),
    );
    expect(outline.sections?.map((s) => s.heading)).toEqual(["1 Introduction", "2.2 Second Part"]);
  });

  it("does not join two headings that have text between them", () => {
    const outline = buildOutline(
      page([heading("Growth Conditions", 680), ...[668, 656].map(prose), heading("Film Thickness", 644), ...[632, 620].map(prose)]),
    );
    expect(outline.sections?.map((s) => s.heading)).toEqual(["1 Introduction", "Growth Conditions", "Film Thickness"]);
  });

  it("does not join a heading to a second line set in another face or a line further below", () => {
    const outline = buildOutline(
      page([
        heading("Growth Conditions", 680),
        item("Annealing", { y: 668.6, height: 9.5, fontName: "another" }),
        ...[656, 644].map(prose),
        heading("Film Thickness", 600),
        heading("Substrates", 560),
        ...[548, 536].map(prose),
      ]),
    );
    // "Growth Conditions" and "Film Thickness" have no text of their own, so they are not sections;
    // neither was joined to the heading under it.
    expect(outline.sections?.map((s) => s.heading)).toEqual(["1 Introduction", "Annealing", "Substrates"]);
  });
});

describe("a run-in label is a heading of its own (P7-10)", () => {
  it("splits 'ABSTRACT:' set in its own face from the words that follow it on the line", () => {
    const page: PdfPageText = {
      page: 1,
      items: chain([["ABSTRACT:", { fontName: "label" }], [" Quillwort cathodes degrade through chemistry and strain together"]]),
    };
    const lines = linesOfPage(page);
    expect(lines.map((l) => l.text)).toEqual(["ABSTRACT", "Quillwort cathodes degrade through chemistry and strain together"]);
    expect(lines[0].font).toBe("label");
    expect(lines[0].y).toBe(lines[1].y);
  });

  it("leaves a first run that is more than the label, or in the body's own face, in its line", () => {
    const sameFace = chain([["Abstract:"], [" the same face as the words after it"]]);
    expect(linesOfPage({ page: 1, items: sameFace }).map((l) => l.text)).toEqual(["Abstract: the same face as the words after it"]);
    const more = chain([["Summary statistics", { fontName: "label" }], [" were computed over all of the cells"]]);
    expect(linesOfPage({ page: 1, items: more }).map((l) => l.text)).toEqual(["Summary statistics were computed over all of the cells"]);
  });

  it("gives the abstract a heading to be found by, and keeps the cover above it out", () => {
    const outline = buildOutline([
      {
        page: 1,
        items: [
          item("Quillwort Cathodes Under Chemistry and Strain", { height: 17, y: 760 }),
          item("A. Author, B. Author", { y: 740, height: 11, fontName: "display" }),
          ...chain([["ABSTRACT:", { fontName: "label" }], [" Quillwort cathodes fade through chemistry and strain together."]], { y: 700 }),
          item("The two couple, and the coupling decides how long a cell lasts in use.", { y: 688 }),
          item("1. INTRODUCTION", { y: 650 }),
          item("Quillwort cathodes are an important class of cathode materials for small cells.", { y: 636 }),
          item("They are used in cells of every size, from watches to cars and grid stores.", { y: 624 }),
        ],
      },
    ]);
    expect(outline.sections?.map((s) => [s.canonical, s.heading])).toEqual([
      ["abstract", "ABSTRACT"],
      ["introduction", "1. INTRODUCTION"],
    ]);
    expect(outline.sections?.[0].text).toBe(
      "Quillwort cathodes fade through chemistry and strain together. The two couple, and the coupling decides how long a cell lasts in use.",
    );
    expect((outline.sections ?? []).map((s) => s.text).join(" ")).not.toContain("A. Author");
  });
});


// P7-11 (the owner's R8, second half): small rules the owner's paper showed
// once its columns were in order. Every line below is invented; the shapes are
// the ones a real paper printed.

describe("a line the page broke, or led by a decimal, is not a heading (P7-11)", () => {
  it("refuses an unnumbered 'heading' that ends in a hyphen: it is a line that goes on", () => {
    // Set in the other face, so only the hyphen keeps it from being a heading.
    for (const dash of ["-", "‐", "‑", "−"]) {
      expect(headingOf(line(`of the cathode film in Quillwort Cathodes at high super${dash}`, { font: "display" }), BODY)).toBeNull();
    }
    expect(headingOf(line("Growth Conditions at High Supersaturation", { font: "display" }), BODY)).toBe(
      "Growth Conditions at High Supersaturation",
    );
  });

  it("refuses a measurement or a year as a section number: a decimal with a leading zero, a first group of four digits", () => {
    expect(headingOf(line("0.661) (Figure 4F shows the film thickness in the cell"), BODY)).toBeNull();
    expect(headingOf(line("0.55 NA, yielding a spatial resolution of 589 nm"), BODY)).toBeNull();
    expect(headingOf(line("2026 Annual Review of Cathode Materials"), BODY)).toBeNull();
    expect(headingOf(line("1000 Cycles at Room Temperature"), BODY)).toBeNull();
    // A sentence is a sentence even when a decimal opens it.
    expect(headingOf(line("0.661) (Figure 4F shows the film."), BODY)).toBeNull();
  });

  it("still takes a real section number: one to three digits to a group", () => {
    expect(headingOf(line("2.1. Electrochemically Tuned Growth"), BODY)).toBe("2.1. Electrochemically Tuned Growth");
    expect(headingOf(line("4.5 Macrotexture Analysis"), BODY)).toBe("4.5 Macrotexture Analysis");
    expect(headingOf(line("10. Conclusion"), BODY)).toBe("10. Conclusion");
    expect(headingOf(line("100 Methods and Materials"), BODY)).toBe("100 Methods and Materials");
  });

  it("leaves a title set larger alone even when it opens with a year: it is a heading by its size, not by a number", () => {
    expect(headingOf(line("2026 Roadmap for Cathodes", { size: 14 }), BODY)).toBe("2026 Roadmap for Cathodes");
  });
});

describe("a sentence with notation in it is not a display equation (P7-11)", () => {
  it("refuses a line of three or more words, whatever its symbols", () => {
    // Notation the page break tore out of a sentence: symbols, and the words around them.
    expect(equationOf(line("⟨003⟩||ND + ⟨101⟩||ND texture was observed in the films"))).toBeNull();
    expect(equationOf(line("x_i = y + z_j for each cell term"))).toBeNull();
  });

  it("counts words as letters only, four or more, set apart by spaces or a hyphen: two are still an equation", () => {
    expect(equationOf(line("x_i = y + z_j for each term"))).toEqual({ text: "x_i = y + z_j for each term" });
    // A function name fused to its brackets is not a word, however often it comes.
    expect(equationOf(line("softmax(QK^T/√d_k)V + softmax(QK^T/√d_k)V"))).toEqual({ text: "softmax(QK^T/√d_k)V + softmax(QK^T/√d_k)V" });
    // A word with a hyphen in it is its parts: "situ" is the third of three.
    expect(equationOf(line("⟨003⟩||ND and ⟨110⟩||ND, ex-situ, indicate localized"))).toBeNull();
    expect(equationOf(line("⟨003⟩||ND and ⟨110⟩||ND, ex-situ, indicate"))).toEqual({ text: "⟨003⟩||ND and ⟨110⟩||ND, ex-situ, indicate" });
  });

  it("keeps a numbered line, words and all: a numbered display equation can carry words", () => {
    expect(equationOf(line("E = mc^2 (1)"))).toEqual({ text: "E = mc^2", number: "(1)" });
    expect(equationOf(line("where the total x = a + b is taken over every term (3)"))).toEqual({
      text: "where the total x = a + b is taken over every term",
      number: "(3)",
    });
  });

  it("leaves such a sentence in its paragraph instead of lifting it out as an equation", () => {
    const outline = buildOutline([
      {
        page: 1,
        items: [
          item("A Paper About Cathode Texture", { height: 17, y: 700 }),
          item("1 Introduction", { y: 680 }),
          ...Array.from({ length: 6 }, (_, i) =>
            item("Recurrent neural networks have long been established in sequence modelling and transduction.", { y: 666 - i * 12 }),
          ),
          item("⟨003⟩||ND + ⟨101⟩||ND texture was observed in the films", { y: 590 }),
          item("and the cells held their charge for a month in a warm room.", { y: 578 }),
        ],
      },
    ]);
    expect(outline.equations).toBeUndefined();
    expect(outline.sections?.[0].text).toContain("⟨003⟩||ND + ⟨101⟩||ND texture was observed in the films and the cells held their charge");
  });
});

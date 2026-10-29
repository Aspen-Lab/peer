import { describe, expect, it } from "vitest";
import { blockMarker } from "@/lib/text/math";
import { sectionParagraphs } from "./reading-map";
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

// ── P9-09 (cluster C): a hyphen at a line's end is decided by the document's own words ───────────────
//
// Before this the hyphen was dropped and the next line glued on, whatever the halves were: right four
// times in five on the one real paper of the set, and "deposition-" / "rate-limiting" became
// "depositionrate-limiting". The words are invented (B P9-02, Appendix A); nothing is a paper's.
describe("a hyphen at a line's end follows the document's own words (P9-09, cluster C)", () => {
  /** Lines one pitch (12) apart, top first. */
  const flow = (texts: string[], y0 = 700, step = 12): PdfLine[] => texts.map((text, i) => line(text, { y: y0 - i * step }));
  const FILLER = "Quillwort cathodes were annealed in air before every measurement was taken.";
  const filler = (y: number) => item(FILLER, { y });
  const readOne = (items: PdfTextItem[]) =>
    buildOutline([{ page: 1, items: [item("A Paper About Cathodes", { height: 17, y: 760 }), item("1 Methods", { y: 740 }), ...items] }]);

  it("keeps the hyphen when both halves are words of the document and the joined form never occurs", () => {
    const lines = flow([
      "The pellet density was fixed and the ramp rate was slow.",
      "A hold step follows the ramp. The rate was logged twice.",
      "The furnace schedule sets the ramp-",
      "rate limit for every run.",
    ]);
    expect(joinProse(lines)).toContain("sets the ramp-rate limit for every run.");
  });

  it("joins when the joined form occurs whole elsewhere", () => {
    const lines = flow(["The film showed delamination at the corners.", "No more crack growth was seen after the delami-", "nation event."]);
    expect(joinProse(lines)).toContain("after the delamination event.");
  });

  it("keeps the hyphen when the paper writes the compound whole elsewhere", () => {
    const lines = flow(["A low-energy path was taken.", "The cells then followed a low-", "energy route to the end."]);
    expect(joinProse(lines)).toContain("followed a low-energy route");
  });

  it("joins when the right half is not a word of the document", () => {
    expect(joinProse(flow(["The two layers synergisti-", "cally control the crack."]))).toContain("synergistically control");
  });

  it("does not count the pieces of a broken word as words: a fragment at a line's end is not evidence", () => {
    // "cally" is whole later in the text, and "synergisti" only at a line's end: the left half is no word.
    const lines = flow(["The two layers synergisti-", "cally control the crack, and cally is not a word here."]);
    expect(joinProse(lines)).toContain("synergistically control");
  });

  it("joins when there is no evidence at all: a short text keeps the old reading", () => {
    expect(joinProse(flow(["The furnace sets the ramp-", "rate limit."]))).toContain("the ramprate limit.");
  });

  it("keeps the hyphen before a bracketed symbol or a digit", () => {
    expect(joinProse(flow(["The condition holds for any non-", "⟨003⟩||ND film."]))).toContain("any non-⟨003⟩||ND film.");
    expect(joinProse(flow(["The sample was labelled Type-", "2 and kept dry."]))).toContain("labelled Type-2 and");
  });

  it("keeps the hyphen of a Title-Case compound and of a formula", () => {
    expect(joinProse(flow(["A review of Lithium-", "Ion cells."]))).toContain("Lithium-Ion cells.");
    expect(joinProse(flow(["The doped Li-", "NixCoyMnzO2 (NMC) powders."]))).toContain("Li-NixCoyMnzO2 (NMC)");
  });

  it("keeps a range between digits whole: no glued number", () => {
    expect(joinProse(flow(["The current was swept from 10-", "20 mA over the cycle."]))).toContain("from 10-20 mA");
  });

  it("keeps the hyphen after a digit or a formula too: 3-dimensional, CO2-free", () => {
    expect(joinProse(flow(["A 3-", "dimensional lattice formed."]))).toContain("A 3-dimensional lattice");
    expect(joinProse(flow(["The CO2-", "free route was used."]))).toContain("The CO2-free route");
  });

  it("joins after a bracket: no letters before the hyphen, the piece is a fragment", () => {
    expect(joinProse(flow(["The (de)-", "intercalated phase formed."]))).toContain("The (de)intercalated phase");
  });

  it("joins a closed prefix when the document never hyphenates it", () => {
    // Both halves are words of the document and "nanowire" never occurs whole: only the prefix says join.
    const lines = flow(["Each nano structure was a thin wire in the array.", "The grown ZnO nano-", "wire arrays were rinsed."]);
    expect(joinProse(lines)).toContain("ZnO nanowire arrays");
  });

  it("keeps a closed prefix's hyphen when the document hyphenates it itself", () => {
    const lines = flow(["A nano-scale wire and a nano rod were grown.", "The grown ZnO nano-", "wire arrays were rinsed."]);
    expect(joinProse(lines)).toContain("ZnO nano-wire arrays");
  });

  it("keeps the inner hyphen of the right half and joins the left: a word the page broke inside a compound", () => {
    const lines = flow(["The crystallo-mechanical coupling was weak.", "It was a crys-", "tallo-mechanical effect."]);
    expect(joinProse(lines)).toContain("It was a crystallo-mechanical effect.");
  });

  it("leaves a suspended hyphen as the paper printed it: intra- and intercrystal", () => {
    expect(joinProse(flow(["Both intra-", "and intercrystal cracks were seen."]))).toContain("Both intra- and intercrystal cracks");
  });

  it("does not eat a dash that ends a line: only a hyphen is a broken word", () => {
    expect(joinProse(flow(["The cell takes typing —", "everything else is fixed."]))).toContain("typing — everything");
    expect(joinProse(flow(["The cell takes typing –", "everything else is fixed."]))).toContain("typing – everything");
  });

  it("mends a caption's broken words by the same rule", () => {
    const outline = readOne([
      filler(726), filler(714), filler(702),
      item("The supersaturations stayed low through the first hour of growth in every run.", { y: 690 }),
      item("Figure 1: Growth at high super-", { y: 650, fontName: "caption", height: 9 }),
      item("saturations in the film and its low-", { y: 640, fontName: "caption", height: 9 }),
      item("energy path under the low rate.", { y: 630, fontName: "caption", height: 9 }),
      item("The energy of the path was low in every run of the sweep.", { y: 600 }),
      filler(588), filler(576),
    ]);
    expect(outline.figureCaptions?.[0].caption).toBe("Growth at high supersaturations in the film and its low-energy path under the low rate.");
  });

  it("mends a wrapped heading by the same rule", () => {
    const outline = readOne([
      filler(726), filler(714),
      item("The supersaturations stayed low through the first hour of growth in every run.", { y: 702 }),
      item("2.1 Growth Under Super-", { y: 670, height: 14, fontName: "display" }),
      item("saturations", { y: 654, height: 14, fontName: "display" }),
      filler(630), filler(618), filler(606),
    ]);
    expect((outline.sections ?? []).map((s) => s.heading)).toContain("2.1 Growth Under Supersaturations");
  });

  it("keeps a lowercase continuation in a numbered heading at body size", () => {
    const outline = readOne([
      filler(726), filler(714),
      item("3.4 Training and open-ended", { y: 680, fontName: "display" }),
      item("responses", { y: 668, fontName: "display" }),
      filler(644), filler(632), filler(620),
    ]);
    expect((outline.sections ?? []).map((s) => s.heading)).toContain("3.4 Training and open-ended responses");
  });

  it("keeps a long alternate-font line at normal paragraph spacing in the prose", () => {
    const outline = readOne([
      filler(726), filler(714),
      item("Each response received a point.", { y: 702 }),
      item("Incorrect and uncertain responses received no points in the score", { y: 690, fontName: "alternate" }),
      item("for the descriptive analysis.", { y: 678 }),
      filler(666), filler(654),
    ]);
    expect((outline.sections ?? []).map((s) => s.heading)).not.toContain("Incorrect and uncertain responses received no points in the score");
    expect((outline.sections ?? []).map((s) => s.text).join(" ")).toContain("Incorrect and uncertain responses received no points in the score");
  });
});

// ── P9-09 (cluster H): no space where the page cut a token ─────────────────────────────────────────
//
// A line that ends in "/", in "||", in a minus sign (U+2212: the paper's own range mark) or in a dash
// between digits was cut inside a token, not between two words: "mA/" + "cm2" is "mA/cm2", "20−" + "30"
// is "20−30", and a range that ended in an en dash read "2030" once the dash was dropped. Every other
// line end still takes a space.
describe("a line cut at a slash, a double bar, a minus or a digit-dash joins with no space (P9-09, cluster H)", () => {
  const two = (first: string, second: string) => joinProse([line(first, { y: 500 }), line(second, { y: 488 })]);

  it("joins a unit cut at its slash", () => {
    expect(two("The current density was 7 mA/", "cm2 or less.")).toBe("The current density was 7 mA/cm2 or less.");
    expect(two("The ratio [Li+]/", "[Co2+] was held fixed.")).toBe("The ratio [Li+]/[Co2+] was held fixed.");
    expect(two("Cycled at a rate of C/", "10 with a hold.")).toBe("Cycled at a rate of C/10 with a hold.");
  });

  it("joins a plane family cut at its double bar", () => {
    expect(two("A texture along ⟨110⟩||", "ND was seen.")).toBe("A texture along ⟨110⟩||ND was seen.");
  });

  it("joins a range or a compound cut at the paper's minus sign", () => {
    expect(two("A swing of 20−", "30 mA was applied.")).toBe("A swing of 20−30 mA was applied.");
    expect(two("Values of 4.68−", "12.50 were found.")).toBe("Values of 4.68−12.50 were found.");
    expect(two("A eutectic LiOH−", "KOH melt was used.")).toBe("A eutectic LiOH−KOH melt was used.");
  });

  it("keeps a range between digits whole when it was cut at an en dash or an em dash: never \"2030\"", () => {
    expect(two("A swing of 20–", "30 mA was applied.")).toBe("A swing of 20–30 mA was applied.");
    expect(two("A swing of 20—", "30 mA was applied.")).toBe("A swing of 20—30 mA was applied.");
    expect(two("A swing of 20-", "30 mA was applied.")).toBe("A swing of 20-30 mA was applied.");
  });

  it("still puts a space after a slash that stands apart, a dash between words, a sentence end", () => {
    expect(two("Either A /", "B was used.")).toBe("Either A / B was used.");
    expect(two("The difference a −", "b was small.")).toBe("The difference a − b was small.");
    expect(two("The film was grown.", "30 mA was applied.")).toBe("The film was grown. 30 mA was applied.");
    expect(two("The cell takes typing —", "everything else is fixed.")).toBe("The cell takes typing — everything else is fixed.");
    // A year range does not turn a dash after words into a glue: only a digit before the dash does.
    expect(two("The result of the phase –", "30 mA was applied.")).toBe("The result of the phase – 30 mA was applied.");
  });
});

// ── P9-09 (cluster E): a float's gap is not a paragraph break inside a sentence ───────────────────────
//
// The caption of a figure set in the middle of a column cuts nothing: it is taken out of the flow. What
// cuts the sentence is the figure's own height, a gap of dozens of line pitches that the paragraph rule
// read as a paragraph break; the figure was then filed after the first half, the one that names it.
// A gap of more than three pitches is a float, not a paragraph, while the sentence above is unfinished
// and the line below it goes on in lower case, a digit or a bracket (P10-42, X-A9: a capital too, unless it opens
// a heading or a list item).
describe("a float's gap inside an unfinished sentence is not a paragraph break (P9-09, cluster E)", () => {
  const flow = (texts: string[], y0: number, step = 12): PdfLine[] => texts.map((text, i) => line(text, { y: y0 - i * step }));
  const sentenceCut = (after: string, gap = 300) => [
    ...flow(["A closer look at the texture along the growth direction in the", "important film (Figure 5, expanded view of Figure"], 700),
    ...flow([after, "is random with small crystals."], 676 - gap),
  ];

  it("keeps the sentence whole across a gap of many pitches", () => {
    const paragraphs = joinProse(sentenceCut("4C(iii)) reveals that the orientation of the first region")).split("\n\n");
    expect(paragraphs).toHaveLength(1);
    expect(paragraphs[0]).toContain("expanded view of Figure 4C(iii)) reveals");
  });

  // P10-42 (re-aimed, X-A9): a capital after the gap goes on too, a cut sentence being a cut sentence whatever its next word.
  it("goes on across the gap at a lower-case letter, a digit, a bracket or a capital", () => {
    expect(joinProse(sentenceCut("and the orientation of the first region")).split("\n\n")).toHaveLength(1);
    expect(joinProse(sentenceCut("(iii)) reveals the orientation of the first region")).split("\n\n")).toHaveLength(1);
    expect(joinProse(sentenceCut("Raman maps then show that the first region")).split("\n\n")).toHaveLength(1);
  });

  it("still breaks after a finished sentence", () => {
    const lines = [
      ...flow(["A closer look at the texture along the growth direction.", "It is shown in Figure 5."], 700),
      ...flow(["The orientation of the first region", "is random with small crystals."], 376),
    ];
    expect(joinProse(lines).split("\n\n")).toHaveLength(2);
    // A closing quote or bracket after the full stop is still a finished sentence.
    const quoted = [
      ...flow(["A closer look at the texture along the growth direction.", "It is shown in the film (see Figure 5.)"], 700),
      ...flow(["the orientation of the first region", "is random with small crystals."], 376),
    ];
    expect(joinProse(quoted).split("\n\n")).toHaveLength(2);
  });

  it("still breaks at an ordinary paragraph gap, two pitches, even when the line above has no full stop", () => {
    const lines = [
      ...flow(["The shares were weighed before each run of the", "annealing schedule described here"], 700),
      ...flow(["particle size was logged for every pellet", "that went into the furnace."], 664),
    ];
    expect(joinProse(lines).split("\n\n")).toHaveLength(2);
  });

  it("end to end: a caption set in the column does not cut the paragraph, and stays in the figure pool", () => {
    const outline = buildOutline([
      {
        page: 1,
        items: [
          item("A Paper About Cathodes", { height: 17, y: 760 }),
          item("1 Methods", { y: 740 }),
          item("Quillwort cathodes were annealed in air before every measurement was taken.", { y: 726 }),
          item("Quillwort cathodes were annealed in air before every measurement was taken.", { y: 714 }),
          item("An examination of the texture (Figure 1, expanded view of Figure", { y: 702 }),
          item("Figure 1: Texture through the thickness of the film.", { y: 420, fontName: "caption", height: 9 }),
          item("2C(iii)) shows that the first region is random with small crystals.", { y: 380 }),
          item("Quillwort cathodes were annealed in air before every measurement was taken.", { y: 368 }),
          item("Quillwort cathodes were annealed in air before every measurement was taken.", { y: 356 }),
        ],
      },
    ]);
    const paragraphs = (outline.sections?.[0].text ?? "").split("\n\n");
    expect(outline.figureCaptions).toHaveLength(1);
    expect(paragraphs.filter((p) => p.includes("expanded view of Figure"))).toHaveLength(1);
    expect(paragraphs.find((p) => p.includes("expanded view of Figure"))).toContain("Figure 2C(iii)) shows that");
  });
});

// ── P9-09 (cluster F): an equation printed over stacked rows is one block, not a paragraph per row ───
//
// A fraction is set over three rows, centred, so every row is "indented" for the paragraph rule and opens
// a paragraph of its own: eleven scraps on the owner's paper, none a sentence. The rows of such a stack
// are short fragments set tighter than the page's leading; two or more of them in a run are lifted as one
// unnumbered block (display), or rejoin the sentence they interrupt (inline, and the fraction set inside
// a text row, the sandwich). This is the one exception to the cheap rule of §1h.41 (c): a single line of
// symbols stays prose. The rows below are full-size so the tests do not depend on how scripts are folded.
describe("stacked equation rows are one block, or rejoin their sentence (P9-09, cluster F)", () => {
  const FILLER = "Quillwort cathodes were annealed in air before every measurement was taken.";
  const filler = (y: number) => item(FILLER, { y });
  const rows = (spec: [string, number, number][]) => spec.map(([text, x, y]) => item(text, { x, y }));
  const read = (items: PdfTextItem[]) =>
    buildOutline([{ page: 1, items: [item("A Paper About Cathodes", { height: 17, y: 760 }), item("1 Methods", { y: 740 }), ...items] }]);
  const paragraphsOf = (outline: ReturnType<typeof buildOutline>) => (outline.sections?.[0].text ?? "").split("\n\n");

  it("lifts a run of short symbol rows set tighter than the leading into one unnumbered block", () => {
    const outline = read([
      filler(726), filler(714), filler(702), filler(690), filler(678), filler(666),
      item("The balance coefficient was obtained from the relation", { y: 654 }),
      ...rows([["Q /Q", 160, 639], ["(ab) 0(ab)", 163, 634], ["BC =", 110, 629], ["(ab) 1", 122, 624], ["M Q /Q", 148, 619], ["m (ab) 0(ab)", 170, 614]]),
      item("Here the symbols are defined as follows, with every term in kelvin.", { y: 599 }),
      filler(587), filler(575), filler(563),
    ]);
    // P9-15 re-aimed this one expectation: the island used to be written as its rows, top to bottom ("Q /Q\n(ab) 0(ab)\n
    // BC =\n…"); it is one line now, the base line `BC =` first, then the stack over it (two rows above, two within
    // reach below, a parenthesised side each), and the sixth row, out of reach of the base line, after it.
    expect(outline.equations).toEqual([{ text: "BC = (Q /Q (ab) 0(ab)) / ((ab) 1 M Q /Q) m (ab) 0(ab)" }]);
    const paragraphs = paragraphsOf(outline);
    expect(paragraphs.filter((p) => p.length < 20 && p !== blockMarker(0))).toEqual([]);
    const at = paragraphs.indexOf(blockMarker(0));
    expect(paragraphs[at - 1]).toMatch(/obtained from the relation$/);
    expect(paragraphs[at + 1]).toMatch(/^Here the symbols are defined/);
    // The reader lifts it from its section: one equation after the sentence that led to it, no scraps.
    const lifted = sectionParagraphs({ text: outline.sections?.[0].text ?? "" }, outline.equations ?? []);
    expect(lifted.equations).toHaveLength(1);
    expect(lifted.paragraphs.every((p) => p.length >= 20)).toBe(true);
    expect(lifted.paragraphs[lifted.equations[0].after]).toMatch(/obtained from the relation$/);
  });

  it("lifts a stack after a finished sentence even when the text goes on in lower case", () => {
    const outline = read([
      filler(726), filler(714), filler(702), filler(690),
      item("The balance coefficient follows from the relation below.", { y: 678 }),
      ...rows([["Q /Q", 160, 663], ["(ab) 0", 163, 658]]),
      item("where every term is in kelvin and the sweep was slow.", { y: 643 }),
      filler(631), filler(619),
    ]);
    expect(outline.equations).toEqual([{ text: "Q /Q\n(ab) 0" }]);
  });

  it("folds rows set inside a sentence back into it: the sentence is unfinished and goes on in lower case", () => {
    const outline = read([
      filler(726), filler(714), filler(702), filler(690),
      item("The coefficient is the ratio", { y: 678 }),
      ...rows([["Q /Q", 160, 666], ["(ab) 0", 163, 661]]),
      item("of the two quantities in every run of the sweep.", { y: 649 }),
      filler(637), filler(625),
    ]);
    expect(outline.equations).toBeUndefined();
    const paragraphs = paragraphsOf(outline);
    const sentence = paragraphs.filter((p) => p.includes("The coefficient is the ratio"));
    expect(sentence).toHaveLength(1);
    expect(sentence[0]).toContain("The coefficient is the ratio Q /Q (ab) 0 of the two quantities in every run of the sweep.");
  });

  it("folds a fraction set inside a sentence (numerator above, denominator below the text row) back into it", () => {
    const outline = read([
      filler(726), filler(714), filler(702), filler(690),
      item("The shares are calculated as", { y: 654 }),
      item("P(ab )", { x: 104, y: 643 }),
      item("× 100, and the quantitative share of each as a", { x: 178, y: 638 }),
      item("m P(ab )", { x: 104, y: 631 }),
      item("three-phase system is shown below.", { y: 619 }),
      filler(607), filler(595),
    ]);
    const sentence = paragraphsOf(outline).filter((p) => p.includes("The shares are calculated as"));
    expect(sentence).toHaveLength(1);
    expect(sentence[0]).toContain(
      "The shares are calculated as P(ab ) / m P(ab ) × 100, and the quantitative share of each as a three-phase system is shown below.",
    );
    expect(outline.equations).toBeUndefined();
  });

  it("leaves a script-like label around a prose row alone: the row must open with an operator", () => {
    const outline = read([
      filler(726), filler(714), filler(702), filler(690),
      item("The labelled share f", { y: 654 }),
      item("0−4", { x: 104, y: 643 }),
      item("μm was observed at room temperature and held", { x: 104, y: 638 }),
      item("8−15", { x: 104, y: 631 }),
      item("for the whole of the sweep.", { y: 619 }),
      filler(607), filler(595),
    ]);
    expect(outline.equations).toBeUndefined();
    expect(paragraphsOf(outline).join(" ")).not.toContain(" / ");
  });

  it("leaves prose alone: short lines at the ordinary leading, and a table of numbers at it, are not stacks", () => {
    const outline = read([
      filler(726), filler(714),
      item("of the", { y: 702 }), item("in a", { y: 690 }),
      filler(678), filler(666),
      item("0.12 0.34 0.56", { y: 654 }), item("0.21 0.43 0.65", { y: 642 }),
      filler(630), filler(618),
    ]);
    expect(outline.equations).toBeUndefined();
    expect(paragraphsOf(outline).join(" ")).toContain("of the in a");
  });

  it("does not take a tight pair of lines with a real word in them for a stack", () => {
    const outline = read([
      filler(726), filler(714), filler(702), filler(690),
      item("Q /Q", { x: 160, y: 678 }), item("ratio", { x: 160, y: 673 }),
      filler(661), filler(649), filler(637),
    ]);
    expect(outline.equations).toBeUndefined();
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

  // P8-03 (BACKLOG-32), re-aimed: this test pinned "an unnumbered equation is known by what it is made of".
  // The owner chose the cheap rule — only a numbered line is a display equation in a PDF — so the same
  // line now stays prose.
  it("does not take an unnumbered line of symbols for an equation", () => {
    expect(equationOf(line("L = −∑ y_i log p_i + λ‖w‖^2"))).toBeNull();
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
    // P7-11 (product call: drop, do not mark): the number folds into the line
    // and is then left out of it, after a word, instead of reading "shape17".
    // The same fold, kept as an exponent, is the next test.
    expect(lines[0].text).toBe("The cathode shape and the film");
    expect(lines[0]).toMatchObject({ y: 500, size: 10 });
  });

  it("folds an exponent into its line the same way, and keeps it (P7-11)", () => {
    const page: PdfPageText = {
      page: 1,
      items: chain([["The diffusivity was 3 x 10"], ["12", sup()], [" and the film"]]),
    };
    const lines = linesOfPage(page);
    expect(lines).toHaveLength(1);
    // P9-08 (cluster G): the kept exponent is a Unicode superscript, 10¹², not the digits glued to the 10.
    expect(lines[0].text).toMatch(/^The diffusivity was 3 x 10 ?¹² and the film$/);
    expect(lines[0]).toMatchObject({ y: 500, size: 10 });
  });

  it("folds a subscript too", () => {
    const page: PdfPageText = { page: 1, items: chain([["Films of TiO"], ["2", sub()], [" were grown on gold"]]) };
    // P9-14: the lowered digit is written as a subscript, TiO₂.
    expect(linesOfPage(page).map((l) => l.text)).toEqual(["Films of TiO₂ were grown on gold"]);
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

  // P8-03 (BACKLOG-32), re-aimed: this test pinned the word count of the unnumbered branch ("two words are
  // still an equation"). The branch is gone with the owner's cheap rule, so every one of these unnumbered
  // lines is prose, however few its words; the same lines with a number are equations, words and all.
  it("takes no unnumbered line for an equation, however few its words", () => {
    expect(equationOf(line("x_i = y + z_j for each term"))).toBeNull();
    expect(equationOf(line("softmax(QK^T/√d_k)V + softmax(QK^T/√d_k)V"))).toBeNull();
    expect(equationOf(line("⟨003⟩||ND and ⟨110⟩||ND, ex-situ, indicate localized"))).toBeNull();
    expect(equationOf(line("⟨003⟩||ND and ⟨110⟩||ND, ex-situ, indicate"))).toBeNull();
    expect(equationOf(line("x_i = y + z_j for each term (4)"))).toEqual({ text: "x_i = y + z_j for each term", number: "(4)" });
    expect(equationOf(line("⟨003⟩||ND and ⟨110⟩||ND, ex-situ, indicate (5)"))).toEqual({
      text: "⟨003⟩||ND and ⟨110⟩||ND, ex-situ, indicate",
      number: "(5)",
    });
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

// ── P8-03 (BACKLOG-32, §1h.41 c): only a numbered line is a display equation in a PDF ───────────────
//
// The owner chose the cheap rule, knowing it loses an unnumbered equation: on the owner's paper the
// "equations" were nineteen sentence fragments (notation torn from a sentence), none of them an equation,
// and the one real equation of §4.5 was never one. A line is a display equation only when it ends in
// "(n)" / "(3a)" and carries at least one maths symbol; everything else joins its paragraph as any line does.
//
// P9-09 (cluster F) makes the one exception: a stack of two or more short rows set tighter than the page's
// leading (a fraction's numerator, bar and denominator) is lifted whole as an unnumbered block, or rejoins
// its sentence; see "stacked equation rows" below. A single line of symbols, and rows at the ordinary
// leading as in every test of this block, are prose as before.
describe("only a numbered line is a display equation in a PDF (P8-03, BACKLOG-32)", () => {
  it("does not take an unnumbered line of symbols for an equation", () => {
    expect(equationOf(line("softmax(QK^T/√d_k)V"))).toBeNull();
    expect(equationOf(line("L = −∑ y_i log p_i + λ‖w‖^2"))).toBeNull();
    // A table row of measurements: three symbols and no words.
    expect(equationOf(line("0.12 ± 0.03   0.34 ± 0.05   0.56 ± 0.02"))).toBeNull();
    expect(equationOf(line("0.12 0.34 0.56 0.78"))).toBeNull();
  });

  it("still takes a numbered line, with its number apart from its symbols", () => {
    expect(equationOf(line("softmax(QK^T/√d_k)V (1)"))).toEqual({ text: "softmax(QK^T/√d_k)V", number: "(1)" });
    expect(equationOf(line("σ = Σ w_i x_i (3a)"))).toEqual({ text: "σ = Σ w_i x_i", number: "(3a)" });
    expect(equationOf(line("0.12 ± 0.03 (12)"))).toEqual({ text: "0.12 ± 0.03", number: "(12)" });
  });

  it("still takes a numbered line of words with one symbol", () => {
    expect(equationOf(line("where η = 0.5 (2)"))).toEqual({ text: "where η = 0.5", number: "(2)" });
  });

  it("does not take a numbered line with no symbol, or a year in brackets", () => {
    expect(equationOf(line("as set out in the second of the two cases (2)"))).toBeNull();
    expect(equationOf(line("as shown by Vaswani et al. (2017)"))).toBeNull();
  });

  const page = (rows: [string, number][]): PdfPageText[] => [
    {
      page: 1,
      items: [
        item("A Paper About Cathode Texture", { height: 17, y: 700 }),
        item("1 Introduction", { y: 680 }),
        ...Array.from({ length: 6 }, (_, i) =>
          item("Recurrent neural networks have long been established in sequence modelling and transduction.", { y: 666 - i * 12 }),
        ),
        ...rows.map(([text, y]) => item(text, { y })),
      ],
    },
  ];

  it("leaves an unnumbered symbol line in its paragraph, whatever its symbols", () => {
    const outline = buildOutline(
      page([
        ["The attention is computed as", 590],
        ["softmax(QK^T/√d_k)V", 578],
        ["where the keys have size d.", 566],
      ]),
    );
    expect(outline.equations).toBeUndefined();
    expect(outline.sections?.[0].text).toContain("The attention is computed as softmax(QK^T/√d_k)V where the keys have size d.");
  });

  // The rows here are at the ordinary leading (12), so they are not a stack (P9-09, cluster F): that is the
  // exception, rows set tighter than the leading, and this remains the rule.
  it("leaves a whole unnumbered equation, printed over several lines, in its paragraph", () => {
    const outline = buildOutline(
      page([
        ["The loss is", 590],
        ["L = −∑ y_i log p_i", 578],
        ["+ λ‖w‖^2 + μ‖v‖^2", 566],
        ["with both penalties small.", 554],
      ]),
    );
    expect(outline.equations).toBeUndefined();
    expect(outline.sections?.[0].text).toContain("The loss is L = −∑ y_i log p_i + λ‖w‖^2 + μ‖v‖^2 with both penalties small.");
  });

  // Where a numbered equation is printed over two lines the number stands on the last one, and that
  // line alone is the equation: the line above it is prose. Recorded as built; the owner's rule was cheap.
  it("takes the last line of a numbered equation printed over two lines, and leaves the first in the prose", () => {
    const outline = buildOutline(
      page([
        ["The loss is", 590],
        ["L = −∑ y_i log p_i", 578],
        ["+ λ‖w‖^2 (4)", 566],
        ["with the penalty small.", 554],
      ]),
    );
    expect(outline.equations).toEqual([{ text: "+ λ‖w‖^2", number: "(4)" }]);
    const paragraphs = (outline.sections?.[0].text ?? "").split("\n\n");
    const at = paragraphs.indexOf(blockMarker(0));
    expect(at).toBeGreaterThan(0);
    expect(paragraphs[at - 1]).toMatch(/The loss is L = −∑ y_i log p_i$/);
    expect(paragraphs[at + 1]).toMatch(/^with the penalty small\.$/);
  });
});

describe("the paragraph indent is read against the section's usual left edge (P7-11)", () => {
  const rows = (xs: number[]) => xs.map((x, i) => line(`line ${i + 1} of one paragraph that runs straight on`, { x, y: 700 - i * 12 }));
  const paragraphs = (xs: number[]) => joinProse(rows(xs)).split("\n\n");

  it("does not read every line as indented because one margin label stands further left", () => {
    // Eleven lines: one at x = 20, ten at x = 72, no other break.
    expect(paragraphs([20, ...Array<number>(10).fill(72)])).toHaveLength(1);
  });

  it("nor because one hanging line does, wherever it stands in the section", () => {
    const xs = Array<number>(12).fill(72);
    xs[6] = 30;
    expect(paragraphs(xs)).toHaveLength(1);
  });

  it("still starts a paragraph at an indent", () => {
    const xs = Array<number>(20).fill(72);
    xs[5] = 84;
    xs[12] = 84;
    expect(paragraphs(xs)).toHaveLength(3);
  });

  it("keeps the minimum for a section of fewer than ten lines: too few to tell an outlier from an edge", () => {
    // 9 and 10 lines read against x = 20, so each line past the first is an indent; 11 read against x = 72.
    expect(paragraphs([20, ...Array<number>(8).fill(72)])).toHaveLength(9);
    expect(paragraphs([20, ...Array<number>(9).fill(72)])).toHaveLength(10);
    expect(paragraphs([20, ...Array<number>(10).fill(72)])).toHaveLength(1);
  });
});

describe("the received / accepted date box is furniture (P7-11)", () => {
  const prose = (y: number, text = "Recurrent neural networks have long been established in sequence modelling.") => item(text, { y });
  // Set a point under the body, as a journal sets it: smaller, but not margin print.
  const dated = (text: string, y: number) => item(text, { y, height: 9 });
  const body = (outline: ReturnType<typeof buildOutline>) => (outline.sections ?? []).map((s) => s.text).join(" ");
  const cover = [item("A Paper About Sequence Models", { height: 17, y: 760 }), item("1 Introduction", { y: 740 })];

  it("drops a run of two or more such lines at the foot of a page, so the sentence that crosses the break is whole", () => {
    const outline = buildOutline([
      {
        page: 1,
        items: [
          ...cover,
          ...[726, 714, 702, 690, 678].map((y) => prose(y)),
          prose(666, "The recurrent models carry the sentence that"),
          dated("Received: January 24, 2026", 114),
          dated("Revised: March 2, 2026", 103),
          dated("Accepted: March 9, 2026", 92),
          dated("Published: March 20, 2026", 81),
        ],
      },
      { page: 2, items: [prose(740, "carries over to the next page and ends there."), ...[728, 716, 704].map((y) => prose(y))] },
    ]);
    expect(body(outline)).toContain("the sentence that carries over to the next page and ends there.");
    expect(body(outline)).not.toMatch(/Received|Revised|Accepted|Published/);
  });

  it("drops it wherever it stands, inside the body too, in any case", () => {
    const outline = buildOutline([
      {
        page: 1,
        items: [
          ...cover,
          ...[726, 714, 702].map((y) => prose(y)),
          dated("RECEIVED 24 January 2026", 678),
          dated("accepted: 9 March 2026", 667),
          ...[640, 628, 616].map((y) => prose(y)),
        ],
      },
    ]);
    expect(body(outline)).not.toMatch(/received|accepted/i);
    expect(body(outline)).toContain("sequence modelling.");
  });

  it("keeps a single such line: one line is a sentence or a note, not a box", () => {
    const outline = buildOutline([
      { page: 1, items: [...cover, ...[726, 714, 702].map((y) => prose(y)), dated("Accepted: 12 May 2026", 678), ...[650, 638, 626].map((y) => prose(y))] },
    ]);
    expect(body(outline)).toContain("Accepted: 12 May 2026");
  });

  it("keeps body sentences that open with those words, even two in a row: no date follows the word", () => {
    const outline = buildOutline([
      {
        page: 1,
        items: [
          ...cover,
          ...[726, 714].map((y) => prose(y)),
          prose(702, "Published data suggest that quillwort cells fade under fast charging."),
          prose(690, "Accepted values for the rate were taken from the first study."),
          ...[678, 666, 654].map((y) => prose(y)),
        ],
      },
    ]);
    expect(body(outline)).toContain("Published data suggest that quillwort cells fade under fast charging.");
    expect(body(outline)).toContain("Accepted values for the rate were taken from the first study.");
  });
});

describe("a figure caption may run to 2,000 characters (P7-11)", () => {
  const filler = (y: number) => item("Recurrent neural networks have long been established in sequence modelling and transduction.", { y });
  /** A figure caption of `lines` printed lines in a face of its own, under six lines of prose, with prose again below it. */
  const paperWithCaption = (lines: number) => {
    const words = Array.from({ length: lines }, (_, i) => `line ${String(i + 1).padStart(2, "0")} of a long caption that runs on and on, as a plate's caption does`);
    const outline = buildOutline([
      {
        page: 1,
        items: [
          item("A Paper", { height: 17, y: 760 }),
          item("1 Introduction", { y: 740 }),
          ...[726, 714, 702, 690, 678, 666].map(filler),
          ...words.map((text, i) => item(i === 0 ? `Figure 1: ${text}` : text, { y: 640 - i * 12, fontName: "caption" })),
          ...[640 - lines * 12 - 8, 640 - lines * 12 - 20, 640 - lines * 12 - 32].map(filler),
        ],
      },
    ]);
    return { outline, caption: words.join(" ") };
  };

  it("runs a caption of fifteen hundred characters to its end", () => {
    const { outline, caption } = paperWithCaption(22);
    expect(caption.length).toBeGreaterThan(1400);
    expect(caption.length).toBeLessThan(2000);
    expect(outline.figureCaptions).toHaveLength(1);
    expect(outline.figureCaptions?.[0].caption).toBe(caption);
    // None of it is left in the prose.
    expect((outline.sections ?? []).map((s) => s.text).join(" ")).not.toContain("runs on and on");
  });

  it("stops a caption at 2,000 characters: past that it is the prose under the figure", () => {
    const { outline, caption } = paperWithCaption(32);
    expect(caption.length).toBeGreaterThan(2000);
    expect(outline.figureCaptions?.[0].caption).toBe(caption.slice(0, 2000));
  });
});

describe("a citation number is dropped, an exponent is kept (P7-11)", () => {
  const read = (parts: [string, Partial<PdfTextItem>?][]) => linesOfPage({ page: 1, items: chain(parts) }).map((l) => l.text);

  it("drops a number raised above a word that ends a sentence, a clause or a bracket: 'materials.12', 'films,3−5'", () => {
    for (const [before, mark, after] of [
      ["Quillwort cathodes are used in many small cells and other materials.", "12", " They also fade."],
      ["Quillwort films were grown on gold,", "3−5", " and then annealed."],
      ["Quillwort films were grown on gold (see below)", "4", " and then annealed."],
      ["Quillwort films were grown on gold [Li]", "4", " and then annealed."],
      ["Quillwort films were grown on gold;", "2,3", " they then fade."],
      ["Quillwort films were grown on gold–silver", "5", " and then annealed."],
    ] as const) {
      expect(read([[before], [mark, sup()], [after]]), mark).toEqual([`${before}${after}`]);
    }
  });

  it("drops a number raised above a word of three letters or more, with no mark before it", () => {
    expect(read([["Quillwort cathode degradation"], ["17", sup()], [" is slow in cells."]])).toEqual(["Quillwort cathode degradation is slow in cells."]);
    expect(read([["Quillwort cathode degradation"], ["17,18", sup()], [" is slow in cells."]])).toEqual(["Quillwort cathode degradation is slow in cells."]);
  });

  it("closes the gap the number leaves: the next word is a word of its own, not glued to the one before", () => {
    // No space stored: the PDF only leaves a gap between the superscript and "They".
    const runs = chain([["Quillwort cathodes are used in many small cells and other materials."], ["12", sup()]]);
    const last = runs[runs.length - 1];
    const items = [...runs, item("They also fade.", { x: last.x + last.width + 2.6 })];
    expect(linesOfPage({ page: 1, items }).map((l) => l.text)).toEqual(["Quillwort cathodes are used in many small cells and other materials. They also fade."]);
  });

  it("drops a range the PDF stored as three raised runs, and keeps the word space a raised run carried", () => {
    expect(read([["Quillwort cathodes degrade."], ["21", sup()], ["\u2212", sup()], ["23 ", sup()], ["They fade."]])).toEqual(["Quillwort cathodes degrade. They fade."]);
    // "4 " ends in the space the next word needs: it is not glued to the one before.
    expect(read([["Quillwort cathodes degrade,"], ["4 ", sup()], ["and then fade."]])).toEqual(["Quillwort cathodes degrade, and then fade."]);
  });

  it("keeps an exponent: a script after a digit, or after a one- or two-letter unit, stays glued", () => {
    // P9-08 (cluster G): kept, and set in Unicode superscripts (10⁻³, cm², s⁻¹), no longer glued as digits.
    expect(read([["a rate of 5 x 10"], ["−3", sup()], [" per second"]])).toEqual(["a rate of 5 x 10⁻³ per second"]);
    expect(read([["a diffusivity in cm"], ["2", sup()], [" per second"]])).toEqual(["a diffusivity in cm² per second"]);
    expect(read([["a rate in s"], ["−1", sup()], [" at room temperature"]])).toEqual(["a rate in s⁻¹ at room temperature"]);
    expect(read([["a current of 12.5 mA cm"], ["−2", sup()], [" was used"]])).toEqual(["a current of 12.5 mA cm⁻² was used"]);
    expect(read([["the fit gave R"], ["2", sup()], [" above 0.99"]])).toEqual(["the fit gave R² above 0.99"]);
    expect(read([["an area of 4 mm"], ["2", sup()], [" each"]])).toEqual(["an area of 4 mm² each"]);
    expect(read([["a capacity in mAh g"], ["−1", sup()], [" at C/10"]])).toEqual(["a capacity in mAh g⁻¹ at C/10"]);
  });

  it("keeps a negative exponent after a long unit: a citation never opens with a minus", () => {
    // P9-08 (cluster G): ⁻¹, for the minus sign and the hyphen alike.
    expect(read([["a rate in mol"], ["−1", sup()], [" of lithium"]])).toEqual(["a rate in mol⁻¹ of lithium"]);
    expect(read([["a rate in min"], ["-1", sup()], [" of lithium"]])).toEqual(["a rate in min⁻¹ of lithium"]);
  });

  it("keeps a negative exponent the PDF stored as two raised runs, a sign and a digit", () => {
    // P9-08 (cluster G): the two runs are one mark, ⁻¹ and ⁻¹².
    expect(read([["a rate in mol"], ["\u2212", sup()], ["1", sup()], [" of lithium"]])).toEqual(["a rate in mol⁻¹ of lithium"]);
    expect(read([["a rate of 5 x 10"], ["\u2212", sup()], ["12 ", sup()], ["per second"]])).toEqual(["a rate of 5 x 10⁻¹² per second"]);
  });

  it("leaves a subscript, an ordinal and a mark that is not a citation number where they are", () => {
    // Below the baseline: a subscript.
    // (P9-14: the subscript is written TiO₂; it is still not a citation.)
    expect(read([["Films of TiO"], ["2", sub()], [" were grown."]])).toEqual(["Films of TiO₂ were grown."]);
    // Letters in it: an ordinal or a footnote letter.
    expect(read([["after the 1"], ["st", sup()], [", 20"], ["th", sup()], [" cycle."]])).toEqual(["after the 1st, 20th cycle."]);
    expect(read([["Quillwort films"], ["2a", sup()], [" were grown."]])).toEqual(["Quillwort films2a were grown."]);
    // Raised by a point or less: on the line, not above it.
    expect(read([["Quillwort cathodes degrade."], ["12", { height: 6.7, y: 500.8 }], [" They fade."]])).toEqual(["Quillwort cathodes degrade.12 They fade."]);
    // Longer than a list of citations is.
    expect(read([["Quillwort cathodes degrade."], ["1,2,3,4,5,6,7", sup()], [" They fade."]])).toEqual(["Quillwort cathodes degrade.1,2,3,4,5,6,7 They fade."]);
    expect(read([["Quillwort cathodes degrade."], ["1,2,3,4,5,6", sup()], [" They fade."]])).toEqual(["Quillwort cathodes degrade. They fade."]);
  });

  it("keeps a number at the head of a line: nothing before it for it to be a citation of", () => {
    expect(read([["1", sup()], ["Department of Materials Science"]])).toEqual(["1Department of Materials Science"]);
  });
});

// ── P9-08 (round P9, Theme 1; B P9-01 §2): a raised run joins its text row ───────────────────────────
//
// A journal PDF stores the space that follows a citation number or an exponent as a run of its own,
// at the script's height and on the script's baseline (114 of the 578 script-size runs of the
// owner's paper). That run used to be placed as if it were text: it opened a row at the script's
// baseline, the script folded into that row at no distance instead of into the text row 4pt below,
// and the raised-only row became a line of its own: read as an indent in `joinProse`, or, a lone
// digit, thrown away as a folio. The fixtures of P7-10 and P7-11 never carried the run, which is how
// the rule shipped green; `chainSpaced` is `chain` with it, so a later test cannot pass without it.

/** What the PDF stores after a script: the space as a run of its own, at the script's height and baseline. */
const spaceAfter = (run: PdfTextItem): PdfTextItem => item(" ", { x: run.x + run.width, y: run.y, height: run.height, width: 0.7 });

/** `chain`, with that space run after the last run of every script, the runs after it moved on by its width. */
function chainSpaced(parts: [string, Partial<PdfTextItem>?][], at: { x?: number; y?: number } = {}): PdfTextItem[] {
  let x = at.x ?? 100;
  const y = at.y ?? 500;
  return parts.flatMap(([str, own], i) => {
    const run = item(str, { x, y, ...own });
    x += run.width;
    // The space follows a script's last run, not a sign and the digit after it: "−" "1" " ".
    if (run.height >= 8 || (parts[i + 1]?.[1]?.height ?? 10) < 8) return [run];
    const space = spaceAfter(run);
    x += space.width;
    return [run, space];
  });
}

// P7-11's table, row by row (a number raised after what it follows is dropped or kept), read with and without the
// run the PDF stores after a script: the reading must not depend on it.
const DROPPED: [string, string, string][] = [
  ["Quillwort cathodes are used in many small cells and other materials.", "12", " They also fade."],
  ["Quillwort films were grown on gold,", "3−5", " and then annealed."],
  ["Quillwort films were grown on gold (see below)", "4", " and then annealed."],
  ["Quillwort films were grown on gold [Li]", "4", " and then annealed."],
  ["Quillwort films were grown on gold;", "2,3", " they then fade."],
  ["Quillwort films were grown on gold–silver", "5", " and then annealed."],
  ["Quillwort cathode degradation", "17", " is slow in cells."],
];
/** A kept raised run of digits and signs as the line prints it now: in Unicode superscripts (P9-08, cluster G). */
const superOf = (mark: string): string =>
  [...mark].map((c) => (/\d/.test(c) ? "⁰¹²³⁴⁵⁶⁷⁸⁹"[Number(c)] : c === "+" ? "⁺" : "⁻")).join("");
const KEPT: [string, string, string][] = [
  ["a rate of 5 x 10", "−3", " per second"],
  ["a diffusivity in cm", "2", " per second"],
  ["a rate in s", "−1", " at room temperature"],
  ["a current of 12.5 mA cm", "−2", " was used"],
  ["the fit gave R", "2", " above 0.99"],
  ["an area of 4 mm", "2", " each"],
  ["a rate in mol", "−1", " of lithium"],
  ["a rate in min", "-1", " of lithium"],
];

describe("a raised run joins its text row, the space the PDF stores after it too (P9-08, cluster A)", () => {
  const UPPER = "kinetics of the quillwort film are set by the grain size and by the";

  it("a citation mid-line does not become a line of its own", () => {
    const cited = chain([["grains part at the particle interfaces,"], ["10−15", sup(488.9)]], { y: 488.9 });
    const last = cited[cited.length - 1];
    const rest = chain([[" a process the field calls"]], { x: last.x + last.width + 0.7, y: 488.9 });
    const lines = linesOfPage({ page: 1, items: [...chain([[UPPER]], { y: 500 }), ...cited, spaceAfter(last), ...rest] });
    expect(lines.map((l) => l.text)).toEqual([UPPER, "grains part at the particle interfaces, a process the field calls"]);
    // The old reading made a third line of the number, mid-line, which the paragraph rule read as an indent.
    expect(joinProse(lines).split("\n\n")).toHaveLength(1);
  });

  it("an exponent keeps its place: a unit's exponent twice on one line, never '2 2' in front of it", () => {
    const items = chainSpaced([["a current density from 15 mA/cm"], ["2", sup()], [" to 30 mA/cm"], ["2", sup()], [" at room temperature"]]);
    expect(linesOfPage({ page: 1, items }).map((l) => l.text)).toEqual(["a current density from 15 mA/cm² to 30 mA/cm² at room temperature"]);
  });

  it("a lone raised digit is not thrown away as a folio", () => {
    const prose = (y: number) => item("Recurrent neural networks have long been established in sequence modelling.", { y });
    const page: PdfPageText = {
      page: 1,
      items: [
        item("A Paper About Sequence Models", { height: 17, y: 760 }),
        item("1 Introduction", { y: 740 }),
        ...[726, 714, 702].map(prose),
        ...chainSpaced([["The current was held at 7 mA/cm"], ["2", sup(690)], [" until the film was whole"]], { y: 690 }),
        ...[678, 666].map(prose),
      ],
    };
    // The lone "2" was a line of its own, and a line of one to four digits is a page number.
    expect(linesOfPage(page).map((l) => l.text)).not.toContain("2");
    const text = (buildOutline([page]).sections ?? []).map((s) => s.text).join(" ");
    expect(text).toContain("The current was held at 7 mA/cm² until the film was whole");
  });

  it("a script as high as the window reaches (7.25pt, the stacked label's charge) still belongs to its line", () => {
    const items = chainSpaced([["the ion Co"], ["2+", { height: 6.7, y: 507.25 }], [" binds the film"]]);
    expect(linesOfPage({ page: 1, items }).map((l) => l.text)).toEqual(["the ion Co²⁺ binds the film"]);
  });

  it("small print with no line near it keeps a line of its own, its space run with it", () => {
    // 14pt under the line is a footnote, not a subscript: the run the PDF stores after it is the note's.
    const note = chainSpaced([["a note set small, a line below", { height: 6.7 }]], { y: 486 });
    const items = [...chain([["The cathode shape was measured at room temperature"]]), ...note];
    expect(linesOfPage({ page: 1, items }).map((l) => l.text)).toEqual([
      "The cathode shape was measured at room temperature",
      "a note set small, a line below",
    ]);
  });

  it("the space run after a subscript folds as it did", () => {
    const items = chainSpaced([["Films of TiO"], ["2", sub()], [" were grown on gold"]]);
    // P9-14: written TiO₂; the space run behind it folds as it did.
    expect(linesOfPage({ page: 1, items }).map((l) => l.text)).toEqual(["Films of TiO₂ were grown on gold"]);
  });

  describe.each([
    ["without the space run", chain],
    ["with the space run", chainSpaced],
  ] as const)("P7-11's table %s", (_name, build) => {
    const read = (parts: [string, Partial<PdfTextItem>?][]) => linesOfPage({ page: 1, items: build(parts) }).map((l) => l.text);
    it.each(DROPPED)("drops %s + %s", (before, mark, after) => {
      expect(read([[before], [mark, sup()], [after]])).toEqual([`${before}${after}`]);
    });
    it.each(KEPT)("keeps %s + %s", (before, mark, after) => {
      expect(read([[before], [mark, sup()], [after]])).toEqual([`${before}${superOf(mark)}${after}`]);
    });
    it("keeps a negative exponent stored as two raised runs, a sign and a digit", () => {
      expect(read([["a rate in mol"], ["−", sup()], ["1", sup()], [" of lithium"]])).toEqual(["a rate in mol⁻¹ of lithium"]);
    });
  });
});

// ── P9-08 (round P9, Theme 1; B P9-01 §3): what a raised number is, a citation or an exponent ────────
//
// A citation number is dropped, an exponent is kept (P7-11). The rule that told them apart read the
// word before the number: punctuation, or three ASCII letters. It missed a suspended hyphen
// ("inter-" … "and intragranular"), a closing quote, an element symbol of two letters (Fe, Ni) and a
// formula that ends in digits (ZnTiO3): the number fused to the word, "ZnTiO335". And it dropped an
// exponent after a closing bracket, "(i/imax)2". Cluster A's fold alone would have let the fused cites
// appear (a lone cite used to be thrown away by accident, as a folio), so A and B ship together.

describe.each([
  ["without the space run", chain],
  ["with the space run", chainSpaced],
] as const)("what a raised number is: a citation or an exponent, %s (P9-08, cluster B)", (_name, build) => {
  const read = (parts: [string, Partial<PdfTextItem>?][]) => linesOfPage({ page: 1, items: build(parts) }).map((l) => l.text);

  it("drops a citation after a suspended hyphen, a closing quote, an element symbol or a formula that ends in digits", () => {
    // a suspended hyphen: kept, and the citation after it goes ("inter- and intragranular")
    expect(read([["a quillwort grain-"], ["2", sup()], [" (size) and film-dependent growth"]])).toEqual(["a quillwort grain- (size) and film-dependent growth"]);
    expect(read([["cells that crack inter-"], ["5,6", sup()], [" and intragranular"]])).toEqual(["cells that crack inter- and intragranular"]);
    // a closing quote, curly or straight
    expect(read([["the film shows “fatigue”"], ["16", sup()], [" (a term used here)"]])).toEqual(["the film shows “fatigue” (a term used here)"]);
    expect(read([['the film shows "fatigue"'], ["16", sup()], [" (a term used here)"]])).toEqual(['the film shows "fatigue" (a term used here)']);
    expect(read([["called ‘fatigue’"], ["7", sup()], [" in cells"]])).toEqual(["called ‘fatigue’ in cells"]);
    // an element symbol, two letters, the second lower case
    expect(read([["a layer of Fe"], ["30", sup()], [" and Ni"], ["24", sup()], [" in the cell"]])).toEqual(["a layer of Fe and Ni in the cell"]);
    // a formula that already ends in digits
    expect(read([["this holds for ZnTiO3"], ["35", sup()], [" (Figure S12)."]])).toEqual(["this holds for ZnTiO3 (Figure S12)."]);
    expect(read([["such as Sn, Pb, and Sb2Se3"], ["52", sup()], [" also twin"]])).toEqual(["such as Sn, Pb, and Sb2Se3 also twin"]);
  });

  it("drops every row of P7-11's table, and keeps its exponents", () => {
    for (const [before, mark, after] of DROPPED) expect(read([[before], [mark, sup()], [after]]), `${before} + ${mark}`).toEqual([`${before}${after}`]);
    for (const [before, mark, after] of KEPT) expect(read([[before], [mark, sup()], [after]]), `${before} + ${mark}`).toEqual([`${before}${superOf(mark)}${after}`]);
  });

  it("an exponent stays: after a unit of one or two lower-case letters, a one-letter variable, a bare number, or with its own sign", () => {
    expect(read([["a diffusivity in cm"], ["2", sup()], [" per second"]])).toEqual(["a diffusivity in cm² per second"]);
    expect(read([["a current density in mA/cm"], ["2", sup()], [" was held"]])).toEqual(["a current density in mA/cm² was held"]);
    expect(read([["the fit gave R"], ["2", sup()], [" above 0.99"]])).toEqual(["the fit gave R² above 0.99"]);
    expect(read([["a rate of 5 x 10"], ["12", sup()], [" per second"]])).toEqual(["a rate of 5 x 10¹² per second"]);
    expect(read([["a wavenumber of 595 cm"], ["−1", sup()], [" was seen"]])).toEqual(["a wavenumber of 595 cm⁻¹ was seen"]);
    expect(read([["a toughness of 2.1 MPam"], ["1/2", sup()], [" was seen"]])).toEqual(["a toughness of 2.1 MPam1/2 was seen"]);
  });

  it("a charge stays: a digit with its sign, however the formula before it ends", () => {
    expect(read([["the complex Fe(CN)6"], ["4−", sup()], [" is stable"]])).toEqual(["the complex Fe(CN)6⁴⁻ is stable"]);
    expect(read([["the ion Ni"], ["2+", sup()], [" binds the film"]])).toEqual(["the ion Ni²⁺ binds the film"]);
    expect(read([["a lone hydroxide OH"], ["−", sup()], [" was found"]])).toEqual(["a lone hydroxide OH⁻ was found"]);
  });

  it("a single raised digit after a bracketed group with a slash and no space is an exponent: '(i/imax)2'", () => {
    expect(read([["the plot of (i/imax)"], ["2", sup()], [" against t/tmax"]])).toEqual(["the plot of (i/imax)² against t/tmax"]);
  });

  it("any other number after a closing bracket is still a citation: a name, a phrase with a space, two digits", () => {
    expect(read([["a layer of the cathode (ABC)"], ["12", sup()], [" was tested"]])).toEqual(["a layer of the cathode (ABC) was tested"]);
    expect(read([["as shown in (Figure 2)"], ["12", sup()], [" for the film"]])).toEqual(["as shown in (Figure 2) for the film"]);
    expect(read([["the plot of (i/imax)"], ["12", sup()], [" against t/tmax"]])).toEqual(["the plot of (i/imax) against t/tmax"]);
    expect(read([["a layer of the cathode (ABC)"], ["2", sup()], [" was tested"]])).toEqual(["a layer of the cathode (ABC) was tested"]);
  });
});

describe("what a raised number is, across runs (P9-08, cluster B)", () => {
  const read = (parts: [string, Partial<PdfTextItem>?][]) => linesOfPage({ page: 1, items: chain(parts) }).map((l) => l.text);

  it("a charge stays when a bracket follows it: '[OH−]/[Ni2+]'", () => {
    expect(read([["a ratio [OH"], ["−", sup()], ["]/[Ni"], ["2+", sup()], ["]"]])).toEqual(["a ratio [OH⁻]/[Ni²⁺]"]);
  });

  it("a mark that carries its own sign is never a citation: '4−', '2+', '−13'", () => {
    // After a word of three letters, where a bare number would go.
    expect(read([["the cathode"], ["2+", sup()], [" binds"]])).toEqual(["the cathode²⁺ binds"]);
    expect(read([["the cathode"], ["4−", sup()], [" binds"]])).toEqual(["the cathode⁴⁻ binds"]);
    expect(read([["the cathode"], ["−13", sup()], [" binds"]])).toEqual(["the cathode⁻¹³ binds"]);
  });

  it("a range keeps its shape: a dash, a comma or the space a PDF leaves where an en dash was", () => {
    expect(read([["grown on gold,"], ["3−5", sup()], [" and annealed"]])).toEqual(["grown on gold, and annealed"]);
    expect(read([["grown on gold,"], ["89 91", sup()], [" and annealed"]])).toEqual(["grown on gold, and annealed"]);
    expect(read([["grown on gold,"], ["5,6", sup()], [" and annealed"]])).toEqual(["grown on gold, and annealed"]);
  });
});

// ── P9-08 (round P9, Theme 1; B P9-01 §4): a raised run of digits and signs is a Unicode superscript ──
//
// The PDF sets an exponent or a charge as a run of its own, raised: "cm" + "2", "10" + "−13", "Ni" + "2+".
// The line used to print it as plain digits glued to the word ("cm2", "10−13", "Ni2+"), which reads as a
// digit in the word. A *whole* raised run made only of digits and signs is now written in Unicode
// superscripts (cm², 10⁻¹³, Ni²⁺); a raised run with a letter, a unit, a point or a slash in it ("st",
// "1/2", "0−4 μm") is left as the PDF has it, and so are lowered runs and the digits set inline in a
// formula ("H2O": no geometry to read). The page shows them only once the PDF's text clean keeps them
// (`cleanDisplayText` still flattens them with NFKC): this is the line builder's half.

describe.each([
  ["without the space run", chain],
  ["with the space run", chainSpaced],
] as const)("a raised run of digits and signs is read as Unicode superscripts, %s (P9-08, cluster G)", (_name, build) => {
  const read = (parts: [string, Partial<PdfTextItem>?][]) => linesOfPage({ page: 1, items: build(parts) }).map((l) => l.text);

  it("a raised 2 after a unit prints ², and a sign with it prints ⁻ or ⁺", () => {
    expect(read([["a diffusivity in cm"], ["2", sup()], [" per second"]])).toEqual(["a diffusivity in cm² per second"]);
    expect(read([["a current density in mA/cm"], ["2", sup()], [" was held"]])).toEqual(["a current density in mA/cm² was held"]);
    expect(read([["a wavenumber of 595 cm"], ["−1", sup()], [" was seen"]])).toEqual(["a wavenumber of 595 cm⁻¹ was seen"]);
    expect(read([["a rate in s"], ["-1", sup()], [" at room temperature"]])).toEqual(["a rate in s⁻¹ at room temperature"]);
    expect(read([["the ion Ni"], ["2+", sup()], [" binds the film"]])).toEqual(["the ion Ni²⁺ binds the film"]);
  });

  it("a raised −13 after 10 prints ⁻¹³, however many digits, and a raised 4− prints ⁴⁻", () => {
    expect(read([["a diffusivity of 4.6 x 10"], ["−13", sup()], [" cm2/s"]])).toEqual(["a diffusivity of 4.6 x 10⁻¹³ cm2/s"]);
    expect(read([["a rate of 5 x 10"], ["12", sup()], [" per second"]])).toEqual(["a rate of 5 x 10¹² per second"]);
    expect(read([["the complex Fe(CN)6"], ["4−", sup()], [" is stable"]])).toEqual(["the complex Fe(CN)6⁴⁻ is stable"]);
    expect(read([["a lone hydroxide OH"], ["−", sup()], [" was found"]])).toEqual(["a lone hydroxide OH⁻ was found"]);
  });

  it("a sign and its digits stored as two raised runs print as one mark", () => {
    expect(read([["a rate in mol"], ["\u2212", sup()], ["1", sup()], [" of lithium"]])).toEqual(["a rate in mol⁻¹ of lithium"]);
    expect(read([["a rate of 5 x 10"], ["\u2013", sup()], ["12", sup()], [" per second"]])).toEqual(["a rate of 5 x 10⁻¹² per second"]);
  });

  it("a raised run with a letter, a unit, a point or a slash in it stays exactly as the PDF has it", () => {
    expect(read([["after the 1"], ["st", sup()], [" charge cycle"]])).toEqual(["after the 1st charge cycle"]);
    expect(read([["a toughness of 2.1 MPam"], ["1/2", sup()], [" was seen"]])).toEqual(["a toughness of 2.1 MPam1/2 was seen"]);
    expect(read([["Quillwort films"], ["2a", sup()], [" were grown."]])).toEqual(["Quillwort films2a were grown."]);
    expect(read([["a width of 4 mm"], ["2.5", sup()], [" each"]])).toEqual(["a width of 4 mm2.5 each"]);
    expect(read([["the label f"], ["0−4 μm", sup()], [" was set"]])).toEqual(["the label f0−4 μm was set"]);
  });

  // P9-14: the lowered digit is a subscript now (TiO₂); a charge set low and the digits typed inline are still not touched.
  it("a subscript is written TiO₂, and a charge set low and the digits set inline in a formula are not touched", () => {
    expect(read([["Films of TiO"], ["2", sub()], [" were grown on gold"]])).toEqual(["Films of TiO₂ were grown on gold"]);
    expect(read([["Films of Ti"], ["3+", sub()], [" were grown on gold"]])).toEqual(["Films of Ti3+ were grown on gold"]);
    expect(read([["cells of LiCoO2 and H2O cycled at TC101 for hours"]])).toEqual(["cells of LiCoO2 and H2O cycled at TC101 for hours"]);
  });

  it("a raised run that is dropped as a citation is not printed in any form", () => {
    expect(read([["Quillwort cathodes degrade."], ["12", sup()], [" They fade."]])).toEqual(["Quillwort cathodes degrade. They fade."]);
  });
});

describe("a raised run at the head of a line is not converted to superscripts (P9-08, cluster G)", () => {
  const read = (parts: [string, Partial<PdfTextItem>?][]) => linesOfPage({ page: 1, items: chain(parts) }).map((l) => l.text);

  it("nothing is before it for it to stand on: a footnote number, a charge", () => {
    expect(read([["1", sup()], ["Department of Materials Science"]])).toEqual(["1Department of Materials Science"]);
    expect(read([["2+", sup()], [" is the charge"]])).toEqual(["2+ is the charge"]);
  });
});

// ── P9-37 (round P9, Theme 1; round 3's one residual): a run raised again above a raised run is its exponent ──
//
// A symbol can carry a label set raised and, above that label, a charge raised again: a base at the body's
// baseline, a label of letters raised 3.9pt, and its charge or exponent raised again to 7.25pt, smaller still,
// then the line goes on at the baseline. The fold takes both raised runs into the one mark; with letters in it,
// the whole mark was written flat ("Kab3+"). The higher run, made only of digits and signs and touching the run
// before it, is that run's own exponent or charge and is written in superscripts ("Kab³⁺"); the run below it
// keeps the letters the PDF has. Every other mark is read as it was (P9-08's one-level mark, its citation, the
// label with a point or slash in it, the label rule).
describe.each([
  ["without the space run", chain],
  ["with the space run", chainSpaced],
] as const)("a run raised again above a raised run is that run's exponent or charge, %s (P9-37)", (_name, build) => {
  const read = (parts: [string, Partial<PdfTextItem>?][]) => linesOfPage({ page: 1, items: build(parts) }).map((l) => l.text);
  /** The label, raised 3.9pt above the baseline at two thirds the size; its charge, raised again to 7.25pt, smaller. */
  const label = { height: 6.7, y: 503.9 };
  const again = { height: 4.5, y: 507.25 };

  it("writes the charge in superscripts and keeps the letters of the run below it", () => {
    expect(read([["the value of K"], ["ab", label], ["3+", again], [" was found"]])).toEqual(["the value of Kab³⁺ was found"]);
    expect(read([["the value of K"], ["ab", label], ["−2", again], [" was found"]])).toEqual(["the value of Kab⁻² was found"]);
    expect(read([["the value of K"], ["ab", label], ["-1", again], [" was found"]])).toEqual(["the value of Kab⁻¹ was found"]);
  });

  it("writes it again each time the line does, and a sign and its digits stored as two runs on the higher level are one charge", () => {
    expect(read([["K"], ["ab", label], ["3+", again], [" and K"], ["ab", label], ["3+", again], [" alike"]])).toEqual(["Kab³⁺ and Kab³⁺ alike"]);
    expect(read([["the value of K"], ["ab", label], ["−", again], ["1", again], [" was found"]])).toEqual(["the value of Kab⁻¹ was found"]);
  });

  it("leaves a second-level run that is not that run's exponent as the PDF has it", () => {
    // a letter in it
    expect(read([["the value of K"], ["ab", label], ["c3", again], [" was found"]])).toEqual(["the value of Kabc3 was found"]);
    // a point in it
    expect(read([["the value of K"], ["ab", label], ["2.5", again], [" was found"]])).toEqual(["the value of Kab2.5 was found"]);
    // at the first run's own height: one mark, written flat
    expect(read([["the value of K"], ["ab", label], ["3+", label], [" was found"]])).toEqual(["the value of Kab3+ was found"]);
    // not above it by more than the rise a script needs to be one (1pt)
    expect(read([["the value of K"], ["ab", { height: 6.7, y: 504 }], ["3+", { height: 4.5, y: 505 }], [" was found"]])).toEqual(["the value of Kab3+ was found"]);
    // larger than the run below it
    expect(read([["the value of K"], ["ab", { height: 6, y: 503.9 }], ["3+", { height: 6.7, y: 507.25 }], [" was found"]])).toEqual(["the value of Kab3+ was found"]);
  });

  it("leaves a one-level mark as P9-08 wrote it: a charge, an exponent, a citation after a word", () => {
    expect(read([["the ion Ni"], ["2+", sup()], [" binds the film"]])).toEqual(["the ion Ni²⁺ binds the film"]);
    expect(read([["a diffusivity in cm"], ["2", sup()], [" per second"]])).toEqual(["a diffusivity in cm² per second"]);
    expect(read([["Quillwort cathode degradation"], ["17", sup()], [" is slow in cells."]])).toEqual(["Quillwort cathode degradation is slow in cells."]);
    expect(read([["the label f"], ["0−4 μm", sup()], [" was set"]])).toEqual(["the label f0−4 μm was set"]);
    expect(read([["a toughness of 2.1 MPam"], ["1/2", sup()], [" was seen"]])).toEqual(["a toughness of 2.1 MPam1/2 was seen"]);
  });

  it("leaves a mark with nothing before it to stand on as it was: a label raised at the head of a line", () => {
    expect(read([["ab", label], ["3+", again], [" was found"]])).toEqual(["ab3+ was found"]);
  });
});

describe("a run raised again above a raised run, as the PDF stores a line (P9-37)", () => {
  const label = { height: 6.7, y: 503.9 };
  const again = { height: 4.5, y: 507.25 };

  it("follows its run with no space, and the text after it with none: the line goes straight on at the baseline", () => {
    const read = (parts: [string, Partial<PdfTextItem>?][]) => linesOfPage({ page: 1, items: chain(parts) }).map((l) => l.text);
    expect(read([["the value of K"], ["ab", label], ["3+", again], ["(1 K) was found"]])).toEqual(["the value of Kab³⁺(1 K) was found"]);
    expect(read([["K"], ["ab", label], ["3+", again], ["(1 K) and K"], ["ab", label], ["3+", again], ["(2 K) alike"]])).toEqual([
      "Kab³⁺(1 K) and Kab³⁺(2 K) alike",
    ]);
  });

  it("starts inside the run before it, as the PDF's own width of a raised word can overrun", () => {
    // The raised word's stored width reaches past the start of the charge on the page: a negative gap still touches.
    const [k, ab] = chain([["the value of K"], ["ab", label]]);
    const items = [k, ab, item("3+", { ...again, x: ab.x + ab.width - 3, width: 4.6 }), item("(1 K) was found", { x: ab.x + ab.width + 1.6 })];
    expect(linesOfPage({ page: 1, items }).map((l) => l.text)).toEqual(["the value of Kab³⁺(1 K) was found"]);
  });

  it("does not take a run set apart from the one below it: a space's width away, it is a word of its own", () => {
    const [k, ab] = chain([["the value of K"], ["ab", label]]);
    const items = [k, ab, item("3+", { ...again, x: ab.x + ab.width + 3, width: 4.6 }), item(" was found", { x: ab.x + ab.width + 8 })];
    expect(linesOfPage({ page: 1, items }).map((l) => l.text)).toEqual(["the value of Kab 3+ was found"]);
  });

  it("reaches the paragraph the section is made of", () => {
    const prose = (y: number) => item("Recurrent neural networks have long been established in sequence modelling.", { y });
    const page: PdfPageText = {
      page: 1,
      items: [
        item("A Paper About Sequence Models", { height: 17, y: 760 }),
        item("1 Introduction", { y: 740 }),
        ...[726, 714, 702].map(prose),
        ...chain([["The value of K"], ["ab", { ...label, y: 690 + 3.9 }], ["3+", { ...again, y: 690 + 7.25 }], ["(1 K) was held until the film was whole"]], { y: 690 }),
        ...[678, 666].map(prose),
      ],
    };
    const text = (buildOutline([page]).sections ?? []).map((s) => s.text).join(" ");
    expect(text).toContain("The value of Kab³⁺(1 K) was held until the film was whole");
    expect(text).not.toContain("Kab3+");
  });
});

// ── P7-18 (§1h.39 b, c): the end matter after the argument, and the subsections' buckets ────────────
//
// The owner's paper (a 19-page, two-column journal article) ends its argument at 4.5 and then prints
// ASSOCIATED CONTENT, AUTHOR INFORMATION (with the authors' affiliations, set in italic blocks the
// outline reads as headings) and Notes, before ACKNOWLEDGMENTS and REFERENCES. Rows are written as a
// page of lines: ["H", text] a heading set larger, ["S", text] a sub-heading in another face (two
// headings of one face and size, a leading apart, are one heading set over two lines), ["N", text] a
// numbered heading in the body's size, ["I", text] a line in an italic face (an affiliation block),
// ["P", text] a line of prose.

type PageRow = ["H" | "S" | "N" | "I" | "P", string];
const PROSE = "Recurrent neural networks have long been established in sequence modelling.";
const P: PageRow = ["P", PROSE];
const rowsPage = (rows: PageRow[]): PdfPageText[] => [
  {
    page: 1,
    items: [
      item("A Paper About Sequence Models", { height: 17, y: 790 }),
      ...rows.map(([kind, text], i): PdfTextItem => {
        const y = 770 - i * 14;
        if (kind === "H") return item(text, { y, height: 12 });
        if (kind === "S") return item(text, { y, height: 11, fontName: "display" });
        if (kind === "I") return item(text, { y, fontName: "italic" });
        return item(text, { y });
      }),
    ],
  },
];
const headingsOf = (rows: PageRow[]) => buildOutline(rowsPage(rows)).sections?.map((s) => s.heading);
const textOf = (rows: PageRow[]) => (buildOutline(rowsPage(rows)).sections ?? []).map((s) => s.text).join(" ");
const marker = (text: string): PageRow => ["P", `${text} and nothing else follows from it in this test.`];

/** The owner's paper, heading by heading (19 of them, as A counted), with the end matter's
 *  sub-headings and affiliation blocks as the paper prints them. */
const OWNER_PAPER: PageRow[] = [
  ["H", "ABSTRACT"], P,
  ["N", "1. INTRODUCTION"], P,
  ["N", "2. RESULTS AND DISCUSSION"],
  ["N", "2.1. Electrochemically Tuned Growth and Form of LiCoO2 Crystals"], P,
  ["N", "2.2. Electrochemically Governed Crystal Morphogenesis during Growth"], P,
  ["N", "2.3. Electrochemical Growth of Twinned, Coincident Site Lattice Interfaces"], P,
  ["N", "2.4. Effect of Crystal Tectonics on Electrochemical Performance"], P,
  ["N", "2.5. Crystal Tectonics Guided Electrochemomechanics"], P,
  ["N", "3. CONCLUSION"], P,
  ["N", "4. EXPERIMENTAL SECTION"],
  ["N", "4.1. Material Growth of Electrodeposited LiCoO2"], P,
  ["N", "4.2. Electrochemical Data Acquisition and Analysis"], P,
  ["N", "4.3. EBSD Sample Preparation, Data Acquisition and Analysis"], P,
  ["N", "4.4. Raman Spectroscopy"], P,
  ["N", "4.5. Macrotexture Analysis and Construction of Predominance Diagrams"], P,
  ["H", "ASSOCIATED CONTENT"],
  ["S", "Supporting Information"], marker("The Supporting Information is available free of charge"),
  ["H", "AUTHOR INFORMATION"],
  ["S", "Corresponding Authors"],
  ["I", "Paul V. Braun - Department of Materials Science and"],
  ["I", "Urbana, Illinois 61801, United States; Materials Research"],
  ["S", "Authors"],
  ["I", "Arghya Patra - Department of Materials Science and"],
  ["I", "Urbana, Illinois 61801, United States"],
  ["S", "Notes"], marker("The authors declare no competing financial interest"),
  ["H", "ACKNOWLEDGMENTS"], marker("The authors thank the funders"),
  ["H", "REFERENCES"], marker("Smith, J. A paper. 2015"),
];
// P10-04 (review 3.3), RE-AIMED: "2. RESULTS AND DISCUSSION" and "4. EXPERIMENTAL SECTION" hold only their
// subsections; they were no sections here, and the map lacked the paper's own group headings. A numbered
// heading that numbers the next one is kept (with empty text) now, so the owner's 19 headings read 15 in the body.
const BODY_HEADINGS = [
  "ABSTRACT",
  "1. INTRODUCTION",
  "2. RESULTS AND DISCUSSION",
  "2.1. Electrochemically Tuned Growth and Form of LiCoO2 Crystals",
  "2.2. Electrochemically Governed Crystal Morphogenesis during Growth",
  "2.3. Electrochemical Growth of Twinned, Coincident Site Lattice Interfaces",
  "2.4. Effect of Crystal Tectonics on Electrochemical Performance",
  "2.5. Crystal Tectonics Guided Electrochemomechanics",
  "3. CONCLUSION",
  "4. EXPERIMENTAL SECTION",
  "4.1. Material Growth of Electrodeposited LiCoO2",
  "4.2. Electrochemical Data Acquisition and Analysis",
  "4.3. EBSD Sample Preparation, Data Acquisition and Analysis",
  "4.4. Raman Spectroscopy",
  "4.5. Macrotexture Analysis and Construction of Predominance Diagrams",
];

describe("the end matter after the argument is not the paper's (P7-18, F2)", () => {
  it("ends the map after 4.5 on the owner's paper's heading list: associated content, author information and the affiliation blocks are out", () => {
    expect(headingsOf(OWNER_PAPER)).toEqual(BODY_HEADINGS);
    const text = textOf(OWNER_PAPER);
    expect(text).not.toContain("Supporting Information is available");
    expect(text).not.toContain("Urbana");
    expect(text).not.toContain("Department of Materials");
    expect(text).not.toContain("competing financial interest");
    expect(text).not.toContain("Smith, J.");
  });

  const AFTER_THE_ARGUMENT: PageRow[] = [
    ["H", "ABSTRACT"], P, ["N", "1. INTRODUCTION"], P, ["N", "2. METHODS"], P, ["N", "3. CONCLUSION"], P,
  ];
  it.each([
    "ASSOCIATED CONTENT",
    "Associated Content",
    "AUTHOR INFORMATION",
    "Author Information",
    "Author Contributions",
    "Author contribution",
    "Supporting Information",
    "Supporting Information Available",
    "Conflicts of Interest",
    "Conflict of Interest",
    "Declaration of Competing Interest",
    "Declaration of interests",
    "Competing interests",
    "Data availability",
    "Data Availability Statement",
    "5. Data availability",
    "Funding",
    "Funding Sources",
    "6. Funding",
  ])("%s, printed after the last numbered section, ends the argument and takes what follows with it", (heading) => {
    const numbered = /^\d/.test(heading);
    const rows: PageRow[] = [...AFTER_THE_ARGUMENT, numbered ? ["N", heading] : ["H", heading], marker("Under the end matter")];
    expect(headingsOf(rows)).toEqual(["ABSTRACT", "1. INTRODUCTION", "2. METHODS", "3. CONCLUSION"]);
    expect(textOf(rows)).not.toContain("Under the end matter");
  });

  it("takes everything from the first such heading on, sub-headings and text, to the references", () => {
    const rows: PageRow[] = [...AFTER_THE_ARGUMENT, ["H", "AUTHOR INFORMATION"], ["S", "Funding"], marker("Funding text"), ["H", "Methods addendum"], marker("Addendum text")];
    expect(headingsOf(rows)).toEqual(["ABSTRACT", "1. INTRODUCTION", "2. METHODS", "3. CONCLUSION"]);
    expect(textOf(rows)).not.toMatch(/Funding text|Addendum text/);
  });

  // A template that prints Funding (or Data availability, Competing interests) on page 1 under the
  // abstract must not end the argument there: P0-01's own comment names these as page-1 headings.
  it("does not end anything at a Funding printed on page 1 under the abstract", () => {
    const rows: PageRow[] = [
      ["H", "ABSTRACT"], P,
      ["H", "Funding"], marker("This work was supported by a grant"),
      ["N", "1. INTRODUCTION"], P, ["N", "2. METHODS"], P, ["N", "3. CONCLUSION"], P,
    ];
    expect(headingsOf(rows)).toEqual(["ABSTRACT", "Funding", "1. INTRODUCTION", "2. METHODS", "3. CONCLUSION"]);
    expect(textOf(rows)).toContain("This work was supported by a grant");
  });

  it.each(["Data availability", "Competing interests", "Conflicts of Interest", "Declaration of Competing Interest"])(
    "does not end anything at %s printed on page 1 under the abstract either",
    (heading) => {
      const rows: PageRow[] = [
        ["H", "ABSTRACT"], P,
        ["H", heading], marker("Printed on the first page"),
        ["N", "1. INTRODUCTION"], P, ["N", "2. METHODS"], P, ["N", "3. CONCLUSION"], P,
      ];
      expect(headingsOf(rows)).toEqual(["ABSTRACT", heading, "1. INTRODUCTION", "2. METHODS", "3. CONCLUSION"]);
    },
  );

  it("leaves a Funding in a paper with no numbered sections where it is: there is no body's last section to stand after", () => {
    const rows: PageRow[] = [["H", "Abstract"], P, ["H", "Introduction"], P, ["H", "Methods"], P, ["H", "Funding"], marker("Unnumbered funding text")];
    expect(headingsOf(rows)).toEqual(["Abstract", "Introduction", "Methods", "Funding"]);
  });

  it("does not take a body section for end matter because its words begin like one", () => {
    const rows: PageRow[] = [
      ["H", "ABSTRACT"], P, ["N", "1. INTRODUCTION"], P,
      ["N", "2. Notes on the method"], P,
      ["N", "3. Supporting information retrieval"], P,
      ["N", "4. CONCLUSION"], P,
      // After the body's last numbered section, and still the paper's: not the heading "Funding".
      ["H", "Funding models for research"], marker("Why a funder pays for a method"),
    ];
    expect(headingsOf(rows)).toEqual([
      "ABSTRACT", "1. INTRODUCTION", "2. Notes on the method", "3. Supporting information retrieval",
      "4. CONCLUSION", "Funding models for research",
    ]);
  });

  it("keeps a plain Notes section of the body: Notes is end matter only where end matter has already begun", () => {
    const rows: PageRow[] = [["H", "ABSTRACT"], P, ["N", "1. INTRODUCTION"], P, ["H", "Notes"], marker("Notes the body keeps"), ["N", "2. CONCLUSION"], P];
    expect(headingsOf(rows)).toEqual(["ABSTRACT", "1. INTRODUCTION", "Notes", "2. CONCLUSION"]);
    const after: PageRow[] = [...AFTER_THE_ARGUMENT, ["H", "ASSOCIATED CONTENT"], ["S", "Notes"], marker("Notes the end matter holds")];
    expect(textOf(after)).not.toContain("Notes the end matter holds");
  });
});

// ── P8-03 (BACKLOG-34, §1h.41 c): a glyph in front of an end-matter heading ──────────────────────────
//
// A template sets a box, a bullet or an icon in front of some end-matter headings, and the extracted
// line reads "■ ACKNOWLEDGMENTS" or "*sı Supporting Information" (an icon font's two letters after the
// asterisk): the heading matches were anchored at its first character, so the glyph hid the heading and
// the argument went on into the apparatus. The match is on the heading's own words.
describe("a glyph before an end-matter heading does not hide it (P8-03, BACKLOG-34)", () => {
  const BODY_ROWS: PageRow[] = [
    ["H", "ABSTRACT"], P, ["N", "1. INTRODUCTION"], P, ["N", "2. METHODS"], P, ["N", "3. CONCLUSION"], P,
  ];
  const BODY_HEADINGS_ONLY = ["ABSTRACT", "1. INTRODUCTION", "2. METHODS", "3. CONCLUSION"];

  it.each([
    "■ ACKNOWLEDGMENTS",
    "■ Acknowledgements",
    "* Acknowledgments",
    "• Appendix A Proofs",
    "*sı Supporting Information",
    "* Supporting Information",
    "▪ ASSOCIATED CONTENT",
    "■ AUTHOR INFORMATION",
    "• Author Contributions",
    "■ Data availability",
    "■ 5. Funding",
    "• Funding",
    "• References",
  ])("%s, printed after the last numbered section, ends the argument and takes what follows with it", (heading) => {
    const rows: PageRow[] = [...BODY_ROWS, ["H", heading], marker("Under the glyph heading")];
    expect(headingsOf(rows)).toEqual(BODY_HEADINGS_ONLY);
    expect(textOf(rows)).not.toContain("Under the glyph heading");
  });

  it("takes a Notes after such a heading out with the rest, as it does after a plain one", () => {
    for (const glyphHeading of ["■ ACKNOWLEDGMENTS", "*sı Supporting Information", "• Appendix A"]) {
      const rows: PageRow[] = [...BODY_ROWS, ["H", glyphHeading], ["S", "Notes"], marker("Notes behind the glyph")];
      expect(textOf(rows)).not.toContain("Notes behind the glyph");
      expect(headingsOf(rows)).toEqual(BODY_HEADINGS_ONLY);
    }
  });

  it("reads the glyph first and the section number second: a numbered Funding behind a glyph is still the numbered one", () => {
    // Funding is end matter only after the body's last numbered section; page 1, under the abstract, it is a section.
    const early: PageRow[] = [
      ["H", "ABSTRACT"], P,
      ["H", "■ Funding"], marker("Printed on the first page"),
      ["N", "1. INTRODUCTION"], P, ["N", "2. METHODS"], P, ["N", "3. CONCLUSION"], P,
    ];
    expect(headingsOf(early)).toEqual(["ABSTRACT", "■ Funding", "1. INTRODUCTION", "2. METHODS", "3. CONCLUSION"]);
    expect(textOf(early)).toContain("Printed on the first page");
    const late: PageRow[] = [...BODY_ROWS, ["H", "■ 6. Funding"], marker("Under the numbered glyph heading")];
    expect(textOf(late)).not.toContain("Under the numbered glyph heading");
  });

  it("leaves a heading that merely starts with a letter, or a body heading behind a glyph, as it was", () => {
    const rows: PageRow[] = [
      ["H", "ABSTRACT"], P, ["N", "1. INTRODUCTION"], P,
      ["H", "■ Supporting information retrieval"], marker("Retrieval text"),
      ["H", "• Notes on the method"], marker("Method notes text"),
      ["N", "2. CONCLUSION"], P,
      ["H", "Supporting information retrieval again"], marker("Still the paper's"),
    ];
    expect(headingsOf(rows)).toEqual([
      "ABSTRACT", "1. INTRODUCTION", "■ Supporting information retrieval", "• Notes on the method",
      "2. CONCLUSION", "Supporting information retrieval again",
    ]);
    expect(textOf(rows)).toContain("Still the paper's");
    // The icon's letters are dropped only behind a glyph: without one, "sı Supporting Information" is just a heading.
    const bare: PageRow[] = [...BODY_ROWS, ["H", "sı Supporting Information"], marker("Bare icon text")];
    expect(headingsOf(bare)).toEqual([...BODY_HEADINGS_ONLY, "sı Supporting Information"]);
  });
});

describe("a numbered subsection takes its parent's bucket, even when the parent has no text of its own (P7-18, F3)", () => {
  // "2. RESULTS AND DISCUSSION" and "4. EXPERIMENTAL SECTION" hold only their subsections: the outline
  // writes no section for a heading with nothing under it, so "2.1 …" and "4.1 …" were filed `body` —
  // `withInheritedBuckets` runs on what the outline wrote and never saw the parent's number.
  const sectionsOf = (rows: PageRow[]) => buildOutline(rowsPage(rows)).sections ?? [];
  const bucketsOf = (rows: PageRow[]) => sectionsOf(rows).map((s) => [s.heading, s.canonical]);

  it("files 2.1–2.5 under results and 4.1–4.5 under methods on the owner's paper's headings", () => {
    const sections = sectionsOf(OWNER_PAPER);
    const counts: Record<string, number> = {};
    for (const s of sections) counts[s.canonical ?? "body"] = (counts[s.canonical ?? "body"] ?? 0) + 1;

    // P10-04, RE-AIMED: the two group headings are sections too, each in its bucket (results 5 -> 6, methods 5 -> 6).
    expect(counts).toEqual({ abstract: 1, introduction: 1, results: 6, conclusion: 1, methods: 6 });
    for (const s of sections) {
      if (/^2\.\d?/.test(s.heading ?? "")) expect(s.canonical).toBe("results");
      if (/^4\.\d?/.test(s.heading ?? "")) expect(s.canonical).toBe("methods");
    }
  });

  it("reaches past every empty level: 5.1.1 under an empty 5.1 under an empty 5", () => {
    const rows: PageRow[] = [
      ["H", "ABSTRACT"], P, ["N", "1. INTRODUCTION"], P,
      ["N", "5. EXPERIMENTS"], ["N", "5.1 Setup of the cells"], ["N", "5.1.1 Hardware used in the tests"], P,
      ["N", "5.2 Cycling protocol"], P,
    ];
    // P10-04, RE-AIMED: the two empty levels above 5.1.1 are kept as sections (empty text), in their bucket.
    expect(bucketsOf(rows)).toEqual([
      ["ABSTRACT", "abstract"],
      ["1. INTRODUCTION", "introduction"],
      ["5. EXPERIMENTS", "results"],
      ["5.1 Setup of the cells", "results"],
      ["5.1.1 Hardware used in the tests", "results"],
      ["5.2 Cycling protocol", "results"],
    ]);
  });

  it("lets a subsection whose own heading names a strong bucket keep it", () => {
    const rows: PageRow[] = [
      ["H", "ABSTRACT"], P, ["N", "1. INTRODUCTION"], P,
      ["N", "4. EXPERIMENTAL SECTION"], ["N", "4.1 Material growth"], P, ["N", "4.2 Limitations of the setup"], P,
    ];
    // P10-04, RE-AIMED: the empty parent "4. EXPERIMENTAL SECTION" is the first of the three.
    expect(bucketsOf(rows).slice(2)).toEqual([
      ["4. EXPERIMENTAL SECTION", "methods"],
      ["4.1 Material growth", "methods"],
      ["4.2 Limitations of the setup", "limitations"],
    ]);
  });

  it("leaves a subsection with no numbered ancestor, an unnumbered paper and a sibling's number alone", () => {
    const rows: PageRow[] = [
      ["H", "Abstract"], P, ["H", "Introduction"], P,
      ["N", "2.1 Something stands alone"], P,
      ["H", "Methods"], P,
    ];
    expect(bucketsOf(rows)).toEqual([
      ["Abstract", "abstract"],
      ["Introduction", "introduction"],
      ["2.1 Something stands alone", "body"],
      ["Methods", "methods"],
    ]);
  });
});

// ── P10-04 (review 3.3; A10): the paper's own group headings stay ────────────────────────────────────
//
// The owner: "the big title 4 experimental section is gone, and the results title too". A heading that has
// no text of its own but numbers the heading after it ("2." then "2.1") is a section with empty text; one
// that numbers nothing is a stray and is dropped, as every empty heading was.
describe("an empty numbered parent is kept as a section with empty text (P10-04, review 3.3)", () => {
  const sectionsOf = (rows: PageRow[]) => buildOutline(rowsPage(rows)).sections ?? [];

  it("keeps '2. RESULTS AND DISCUSSION' and '4. EXPERIMENTAL SECTION' of the owner's paper, in order, with no text and their page", () => {
    const sections = sectionsOf(OWNER_PAPER);
    const groups = sections.filter((s) => (s.text ?? "").length === 0);

    expect(groups.map((s) => s.heading)).toEqual(["2. RESULTS AND DISCUSSION", "4. EXPERIMENTAL SECTION"]);
    expect(groups.map((s) => s.canonical)).toEqual(["results", "methods"]);
    expect(groups.every((s) => s.page === 1)).toBe(true);
    // In the document's order: each stands directly before its first child.
    const headings = sections.map((s) => s.heading);
    expect(headings.indexOf("2. RESULTS AND DISCUSSION") + 1).toBe(headings.indexOf("2.1. Electrochemically Tuned Growth and Form of LiCoO2 Crystals"));
    expect(headings.indexOf("4. EXPERIMENTAL SECTION") + 1).toBe(headings.indexOf("4.1. Material Growth of Electrodeposited LiCoO2"));
    // Every other section still has its text.
    expect(sections.filter((s) => (s.text ?? "").length > 0)).toHaveLength(sections.length - 2);
  });

  it("drops an empty numbered heading that numbers nothing, and one at the end of the paper", () => {
    const rows: PageRow[] = [
      ["H", "ABSTRACT"], P, ["N", "1. INTRODUCTION"], P,
      ["N", "2. LAYOUT OF THE CELLS"],
      ["N", "3. CONCLUSION"], P,
      ["N", "4. OUTLOOK"],
    ];
    expect(sectionsOf(rows).map((s) => s.heading)).toEqual(["ABSTRACT", "1. INTRODUCTION", "3. CONCLUSION"]);
  });

  it("keeps a parent only for a child its number opens: '2.' then '2.1', not '2.' then '3.1' or '20.1'", () => {
    const rows: PageRow[] = [
      ["H", "ABSTRACT"], P, ["N", "1. INTRODUCTION"], P,
      ["N", "2. RESULTS"], ["N", "3.1 Elsewhere in the paper"], P,
      ["N", "20. EXTRAS"], ["N", "20.1 Something under twenty"], P,
    ];
    expect(sectionsOf(rows).map((s) => s.heading)).toEqual([
      "ABSTRACT", "1. INTRODUCTION", "3.1 Elsewhere in the paper", "20. EXTRAS", "20.1 Something under twenty",
    ]);
  });

  it("does not keep an empty numbered heading that is end matter", () => {
    const rows: PageRow[] = [
      ["H", "ABSTRACT"], P, ["N", "1. INTRODUCTION"], P, ["N", "2. CONCLUSION"], P,
      ["N", "3. ACKNOWLEDGMENTS"], ["N", "3.1 Thanks"], marker("We thank the funders"),
    ];
    expect(sectionsOf(rows).map((s) => s.heading)).toEqual(["ABSTRACT", "1. INTRODUCTION", "2. CONCLUSION"]);
  });
});

// ── P9-13b (round P9, round 3, Theme 1): a combining mark's run, a lowered label ─────────────────────
//
// A Miller index is set with an overbar over a digit: pdf.js hands it over as a run of its own (U+0305,
// no width, in the font of the accents) and, behind it, a run holding the space the PDF stores after
// it, in that same face and a few hundredths of a point wide, before the next digit starts 0.1-0.4pt
// on. Both were read as text, so `R3̅m` came out `R3̅ m` and `(12̅10)` as `(12̅ 10)`. The fixtures below
// carry that stored space run the way the page does.

/** Runs set left to right, each `gap` points after the one before it (none by default). */
function laid(parts: [string, (Partial<PdfTextItem> & { gap?: number })?][], at: { x?: number; y?: number } = {}): PdfTextItem[] {
  let x = at.x ?? 100;
  const y = at.y ?? 500;
  return parts.map(([str, own]) => {
    const { gap = 0, ...rest } = own ?? {};
    x += gap;
    const run = item(str, { x, y, ...rest });
    x += run.width;
    return run;
  });
}
const linesOf = (parts: Parameters<typeof laid>[0]) => linesOfPage({ page: 1, items: laid(parts) }).map((l) => l.text);

type Part = [string, (Partial<PdfTextItem> & { gap?: number })?];
/** COMBINING OVERLINE as the page stores it: a run of its own, no width, a hair behind the digit's edge. */
const BAR: Part = ["\u0305", { width: 0, gap: -0.2, fontName: "accents" }];
/** The space the PDF stores after the mark, in the mark's own face: a few hundredths of a point wide. */
const BAR_SPACE: Part = [" ", { width: 0.04, gap: 0.2, fontName: "accents" }];

describe("a combining mark's run joins its neighbours with no space, whatever the gap (P9-13b)", () => {
  it.each([0, 0.4, 2, 3.5])("a digit, its overbar and a letter %d pt on read as one index: R3̅m", (gap) => {
    expect(linesOf([["the space group R3"], BAR, ["m", { gap }], [" is common"]])).toEqual(["the space group R3\u0305m is common"]);
  });

  it("drops the space the PDF stores after the overbar, in its own face", () => {
    expect(linesOf([["the space group R3"], BAR, BAR_SPACE, ["m", { gap: 0.08 }], [" is common"]])).toEqual(["the space group R3\u0305m is common"]);
  });

  it("reads (12, the bar, 10) as one index with or without the stored space: (12̅10)", () => {
    expect(linesOf([["the (12"], BAR, ["10)", { gap: 0.2 }], [" plane"]])).toEqual(["the (12\u030510) plane"]);
    expect(linesOf([["the (12"], BAR, BAR_SPACE, ["10)", { gap: 0.4 }], [" plane"]])).toEqual(["the (12\u030510) plane"]);
  });

  it("closes every bar of an index and a direction, not only the first: (21̅30)[4̅4̅15]", () => {
    expect(
      linesOf([["the (21"], BAR, BAR_SPACE, ["30)[4", { gap: 0.4 }], BAR, BAR_SPACE, ["4", { gap: 0.37 }], BAR, BAR_SPACE, ["15]", { gap: 0.41 }], [" axis"]]),
    ).toEqual(["the (21\u030530)[4\u03054\u030515] axis"]);
  });

  it("puts no space before a mark either, however far its run sits from the digit", () => {
    expect(linesOf([["the plane 2"], ["\u0305", { width: 0, gap: 2.6, fontName: "accents" }], ["m", { gap: 0.1 }]])).toEqual(["the plane 2\u0305m"]);
  });

  it("joins a stack of marks, and the combining arrows (U+20D0 block), the same way", () => {
    expect(linesOf([["the index 4"], ["\u0305\u0332", { width: 0, gap: -0.2, fontName: "accents" }], BAR_SPACE, ["7", { gap: 0.3 }]])).toEqual(["the index 4\u0305\u03327"]);
    expect(linesOf([["the field B"], ["\u20D7", { width: 0, gap: -0.2, fontName: "accents" }], BAR_SPACE, ["0", { gap: 0.2 }]])).toEqual(["the field B\u20D70"]);
  });

  it("keeps the word space after an index when the next word starts a real space away", () => {
    // The stored space is in the body's face and the next word starts 6pt on: the mark ends a word.
    expect(linesOf([["a plane 2"], BAR, [" ", { width: 0.7, gap: 0.2 }], ["and", { gap: 6 }], [" a line"]])).toEqual(["a plane 2\u0305 and a line"]);
    expect(linesOf([["a plane 2"], BAR, ["and", { gap: 6 }]])).toEqual(["a plane 2\u0305 and"]);
  });

  it("joins a mark on a letter to the stored space's far side, and leaves the word break after it alone: an accent or an arrow ends a word as often as an index", () => {
    expect(linesOf([["the index (hk"], BAR, BAR_SPACE, ["l)", { gap: 0.3 }]])).toEqual(["the index (hk\u0305l)"]);
    expect(linesOf([["Jose"], ["\u0301", { width: 0, gap: -0.2, fontName: "accents" }], BAR_SPACE, ["Smith", { gap: 2.5 }]])).toEqual(["Jose\u0301 Smith"]);
    expect(linesOf([["the field v"], ["\u20D7", { width: 0, gap: -0.2, fontName: "accents" }], BAR_SPACE, ["is", { gap: 2.5 }]])).toEqual(["the field v\u20D7 is"]);
    // The accent run sits at the start of the run it belongs to, far from its letter: the space stored behind it is still its own.
    const name = "Jovanovic, A. Z.; Pas";
    const width = name.length * 4.6;
    expect(
      linesOf([[name], ["\u030C", { width: 0, gap: -width + 0.3, fontName: "accents" }], [" ", { width: 0, gap: width - 0.3, fontName: "accents" }], ["ti, I. A."]]),
    ).toEqual(["Jovanovic, A. Z.; Pas\u030Cti, I. A."]);
  });

  it("leaves a mark that opens a line, and a line that ends on one, as they are", () => {
    expect(linesOf([["\u0305", { width: 0, fontName: "accents" }], ["x", { gap: 2.5 }]])).toEqual(["\u0305 x"]);
    expect(linesOf([["the index 5"], BAR, BAR_SPACE])).toEqual(["the index 5\u0305"]);
  });
});

// A lowered label after a variable. The PDF sets a subscript (`R` + `CT`, `f` + `area`) as a run of
// two thirds the size 2pt under the line, touching the variable, and the f-range labels of a grain-size
// fraction as a raised run of the same size, 3.9pt over it, behind a stored space run 0.15pt wide
// when the variable is an `f` and none when it is not: `f 0-4 μm` beside `f4-8 μm`. A label that is a
// symbol (`CT`, `H`, `g`) is written joined; a label that is a word or a range with a unit is written
// `f(area)`, `f(0-4 μm)`, which reads the same wherever the PDF put its stored space.

/** A subscript, two thirds the size, 2pt under the line. */
const low: Partial<PdfTextItem> = { height: 6.7, y: 498 };
/** A raised label, two thirds the size, 3.9pt over the line (the f-range labels). */
const label: Partial<PdfTextItem> = { height: 6.7, y: 503.9 };
const VAR: Partial<PdfTextItem> = { fontName: "italic" };

describe("a lowered label after a one-letter variable: symbols join, words and ranges are bracketed (P9-13b)", () => {
  it("writes a word as f(area), j/j(limiting), t(on), t(off)", () => {
    expect(linesOf([["the fraction "], ["f", VAR], ["area", { ...low, gap: -0.01 }], [" = 0.61"]])).toEqual(["the fraction f(area) = 0.61"]);
    expect(linesOf([["the ratio "], ["j", VAR], ["/", { gap: 0 }], ["j", VAR], ["limiting", { ...low, gap: -0.05 }], [" is large"]])).toEqual(["the ratio j/j(limiting) is large"]);
    expect(linesOf([["a "], ["t", VAR], ["on", { ...low, gap: 0 }], [" of 10 s and a "], ["t", VAR], ["off", { ...low, gap: 0 }], [" of 75 s"]])).toEqual(["a t(on) of 10 s and a t(off) of 75 s"]);
  });

  it("writes a range with a unit as f(0-4 μm), lowered or raised, with the stored space run before it or without", () => {
    /** The label as the page stores it: the number, the stored space, the unit in two runs, then the text. */
    const runs = (own: Partial<PdfTextItem>, gap: number): Part[] => [
      ["0-4", { ...own, gap }],
      [" ", { ...own, width: 0.33 }],
      ["μ", own],
      ["m ", own],
      ["= 0.191, "],
    ];
    // The brief's fixture: lowered.
    expect(linesOf([["fractions "], ["f", VAR], ...runs(low, 0)])).toEqual(["fractions f(0-4 μm) = 0.191,"]);
    // As the page sets it: raised, behind a stored space run 0.15pt wide, 1.37pt short of the label.
    expect(linesOf([["fractions "], ["f", VAR], [" ", { width: 0.15 }], ...runs(label, 1.37)])).toEqual(["fractions f(0-4 μm) = 0.191,"]);
    // And touching, with no stored space: the other two labels of the paper.
    expect(linesOf([["fractions "], ["f", VAR], ...runs(label, -0.01)])).toEqual(["fractions f(0-4 μm) = 0.191,"]);
  });

  it("keeps a symbol joined: RCT, TH, Eg, Dw, I0, N2, MLi, jmax, xij", () => {
    for (const [variable, sub, expected] of [
      ["R", "CT", "RCT"],
      ["T", "H", "TH"],
      ["E", "g", "Eg"],
      ["D", "w", "Dw"],
      // P9-14: a lowered digit is a subscript character, I₀ and N₂.
      ["I", "0", "I₀"],
      ["N", "2", "N₂"],
      ["M", "Li", "MLi"],
      ["j", "max", "jmax"],
      ["x", "ij", "xij"],
      ["T", "eff", "Teff"],
    ] as const) {
      expect(linesOf([["the "], [variable, VAR], [sub, { ...low, gap: -0.02 }], [" value"]]), expected).toEqual([`the ${expected} value`]);
    }
  });

  it("brackets the short words that read as a word once joined: t(in) and t(out), as t(on) and t(off)", () => {
    expect(linesOf([["a "], ["t", VAR], ["in", { ...low, gap: 0 }], [" and a "], ["t", VAR], ["out", { ...low, gap: 0 }], [" of 4 s"]])).toEqual(["a t(in) and a t(out) of 4 s"]);
  });

  it("brackets a label whose variable it touches within 2pt, the page's own gap running to 1.5, and not one a word space off", () => {
    expect(linesOf([["the "], ["f", VAR], [" ", { width: 0.17 }], ["8-15", { ...label, gap: 1.52 }], [" ", { ...label, width: 0.36 }], ["μm", { ...label, gap: 2 }], [" = 0.6"]])).toEqual(["the f(8-15 μm) = 0.6"]);
    expect(linesOf([["the "], ["f", VAR], ["8-15 μm", { ...label, gap: 2.6 }], [" = 0.6"]])).toEqual(["the f 8-15 μm = 0.6"]);
  });

  it("keeps an exponent behind a bracketed label: (j/j(limiting))² and (j/jmax)², as (i/imax)² was kept", () => {
    expect(linesOf([["the ratio (j/"], ["j", VAR], ["limiting", { ...low, gap: -0.02 }], [")"], ["2", { height: 6.7, y: 504.4 }], [" is large"]])).toEqual(["the ratio (j/j(limiting))² is large"]);
    expect(linesOf([["the ratio (j/"], ["j", VAR], ["max", { ...low, gap: -0.02 }], [")"], ["2", { height: 6.7, y: 504.4 }], [" is large"]])).toEqual(["the ratio (j/jmax)² is large"]);
  });

  it("leaves a lowered run after a word of two letters or more, or after a digit, as it is", () => {
    expect(linesOf([["Li"], ["x", { ...low, gap: 0 }], ["CoO2"]])).toEqual(["LixCoO2"]);
    expect(linesOf([["a film"], ["area", { ...low, gap: 0 }], [" in cm"]])).toEqual(["a filmarea in cm"]);
    expect(linesOf([["a 10"], ["on", { ...low, gap: 0 }], [" signal"]])).toEqual(["a 10on signal"]);
  });

  it("leaves a label a word space away from its variable as it is: only a label that touches belongs to it", () => {
    expect(linesOf([["the "], ["f", VAR], ["area", { ...low, gap: 2.6 }], [" = 0.61"]])).toEqual(["the f area = 0.61"]);
  });

  it("leaves a raised exponent as it is: cm², a unit's 1/2, a letter exponent, a symbol's charge label", () => {
    expect(linesOf([["a diffusivity in cm"], ["2", { height: 6.7, y: 504.4 }], [" per second"]])).toEqual(["a diffusivity in cm² per second"]);
    expect(linesOf([["a toughness in MPa m"], ["1/2", { height: 6.7, y: 504.4 }], [" at room temperature"]])).toEqual(["a toughness in MPa m1/2 at room temperature"]);
    expect(linesOf([["a power x"], ["n", { height: 6.7, y: 504.4 }], [" of the field"]])).toEqual(["a power xn of the field"]);
    expect(linesOf([["its "], ["D", VAR], ["Cod2+", { ...label, gap: 0 }], ["(350 C)"]])).toEqual(["its DCod2+(350 C)"]);
  });
});

describe("a subscript's parenthesis follows with no space (P9-13b)", () => {
  it("reads the PDF's I, a lowered '0 (' and a lowered hkl) as I0(hkl)", () => {
    // The space is inside the subscript's own run: the author typed "0 (hkl)" in the lowered face.
    expect(linesOf([["measured I"], ["0 (", { ...low, width: 7.3 }], ["hkl", { ...low }], [")", { ...low }], [": standard intensity"]])).toEqual(["measured I₀(hkl): standard intensity"]);
  });

  it("closes the gap before a lowered run that opens with a parenthesis, whatever the gap", () => {
    // P9-14: the 0 is a subscript character, I₀; the parenthesis still follows it with no space.
    expect(linesOf([["measured I"], ["0", { ...low }], ["(hkl)", { ...low, gap: 2.5 }], [": standard"]])).toEqual(["measured I₀(hkl): standard"]);
    expect(linesOf([["measured I"], ["0", { ...low }], [" ", { ...low, width: 0.7 }], ["(hkl)", { ...low, gap: 1.5 }], [": standard"]])).toEqual(["measured I₀(hkl): standard"]);
  });

  it("keeps the space before a parenthetical set at the line's size, and before one that follows an exponent", () => {
    expect(linesOf([["its gap "], ["E", VAR], ["g", { ...low, gap: -0.02 }], ["(eV)", { gap: 3 }]])).toEqual(["its gap Eg (eV)"]);
    expect(linesOf([["its rate in mA cm"], ["−2", { height: 6.7, y: 504.4 }], ["(at C/10)", { gap: 3 }]])).toEqual(["its rate in mA cm⁻² (at C/10)"]);
  });
});

// ── P9-14 (round P9, round 3, Theme 1): a lowered run of digits is a subscript ──────────────────────────
//
// A chemical formula is set with its stoichiometry lowered: `LiCoO` and a lowered `2`. The line builder
// wrote the digit plain, `LiCoO2`, as it wrote a raised one before P9-08; a reader met `LiCoO2` as a word
// with a digit in it. A lowered group whose every character has a subscript form (the digits, `+ − - = ( )`
// and the letter `x`, U+2080-U+208E and U+2093) is written with those characters, `LiCoO₂`, `Li₁₋ₓCoO₂`.
// All formulas below are invented.

/** A raised run, as the P9-13b fixtures set one. */
const high: Partial<PdfTextItem> = { height: 6.7, y: 504.4 };

describe("a lowered run of digits is written with the Unicode subscript characters (P9-14)", () => {
  it("writes LiCoO + a lowered 2 as LiCoO₂, and H₂O, O₂, Li₄Ti₅O₁₂ the same way", () => {
    expect(linesOf([["Films of LiCoO"], ["2", low], [" were cycled"]])).toEqual(["Films of LiCoO₂ were cycled"]);
    expect(linesOf([["the H"], ["2", low], ["O and O"], ["2", low], [" gases"]])).toEqual(["the H₂O and O₂ gases"]);
    expect(linesOf([["spinel Li"], ["4", low], ["Ti"], ["5", low], ["O"], ["12", low], [" anodes"]])).toEqual(["spinel Li₄Ti₅O₁₂ anodes"]);
  });

  it("writes the 1-x of a solid solution as ₁₋ₓ, whether the PDF stores it as one run or three, with a minus sign or a hyphen", () => {
    expect(linesOf([["layered Li"], ["1−x", low], ["CoO"], ["2", low], [" films"]])).toEqual(["layered Li₁₋ₓCoO₂ films"]);
    expect(linesOf([["layered Li"], ["1-x", low], ["CoO"], ["2", low], [" films"]])).toEqual(["layered Li₁₋ₓCoO₂ films"]);
    expect(linesOf([["layered Li"], ["1", low], ["−", low], ["x", low], ["CoO"], ["2", low], [" films"]])).toEqual(["layered Li₁₋ₓCoO₂ films"]);
    // A space the PDF stores inside the subscript is not part of it.
    expect(linesOf([["layered Li"], ["1 ", low], ["− ", low], ["x", low], ["CoO"], ["2", low], [" films"]])).toEqual(["layered Li₁₋ₓCoO₂ films"]);
  });

  it("writes the sum of a stoichiometry as ₊, and leaves a lowered x with no digit in it as P9-13b writes it: Lix", () => {
    expect(linesOf([["a phase M"], ["1+x", low], ["O"], [" forms"]])).toEqual(["a phase M₁₊ₓO forms"]);
    expect(linesOf([["lithiated Li"], ["x", low], ["CoO2"]])).toEqual(["lithiated LixCoO2"]);
    expect(linesOf([["lithiated Li"], ["x", low], ["CoO"], ["2", low]])).toEqual(["lithiated LixCoO₂"]);
  });

  it("keeps the charge a superscript behind a subscript: CoO₂⁻, Ni₃²⁺", () => {
    expect(linesOf([["the CoO"], ["2", low], ["−", high], [" ion"]])).toEqual(["the CoO₂⁻ ion"]);
    expect(linesOf([["the Ni"], ["3", low], ["2+", high], [" ion"]])).toEqual(["the Ni₃²⁺ ion"]);
  });

  it("writes I + a lowered 0 and (hkl) as I₀(hkl), in the shapes the page has", () => {
    // The page's own: the space and the parenthesis are inside the subscript's runs.
    expect(linesOf([["measured I"], ["0 (", { ...low, width: 7.3 }], ["hkl", low], [")", low], [": standard intensity"]])).toEqual(["measured I₀(hkl): standard intensity"]);
    // The brief's: a lowered 0, then the index lowered a word-space away, with or without a stored space run.
    expect(linesOf([["measured I"], ["0", low], ["(hkl)", { ...low, gap: 2.5 }], [": standard"]])).toEqual(["measured I₀(hkl): standard"]);
    expect(linesOf([["measured I"], ["0", low], [" ", { ...low, width: 0.7 }], ["(hkl)", { ...low, gap: 1.5 }], [": standard"]])).toEqual(["measured I₀(hkl): standard"]);
    // And the index set at the line's size.
    expect(linesOf([["measured I"], ["0", low], ["(hkl)"], [": standard"]])).toEqual(["measured I₀(hkl): standard"]);
  });

  it("writes brackets in a subscript when the whole group is digits and brackets: Ca₃(PO₄)₂, T₁₍₂₎", () => {
    expect(linesOf([["apatite Ca"], ["3", low], ["(PO"], ["4", low], [")"], ["2", low], [" powder"]])).toEqual(["apatite Ca₃(PO₄)₂ powder"]);
    expect(linesOf([["the term T"], ["1(2)", low], [" is small"]])).toEqual(["the term T₁₍₂₎ is small"]);
  });

  it("keeps a group with any other letter as P9-13b writes it: A1g, RCT, TH, Eg, jmax, f(area)", () => {
    expect(linesOf([["the A"], ["1g", low], [" mode"]])).toEqual(["the A1g mode"]);
    expect(linesOf([["the A"], ["1", low], ["g", low], [" mode"]])).toEqual(["the A1g mode"]);
    for (const [variable, sub, expected] of [["R", "CT", "RCT"], ["T", "H", "TH"], ["E", "g", "Eg"], ["j", "max", "jmax"]] as const) {
      expect(linesOf([["the "], [variable, VAR], [sub, { ...low, gap: -0.02 }], [" value"]]), expected).toEqual([`the ${expected} value`]);
    }
    expect(linesOf([["the fraction "], ["f", VAR], ["area", { ...low, gap: -0.01 }], [" = 0.61"]])).toEqual(["the fraction f(area) = 0.61"]);
  });

  it("writes 1-x as a subscript after a one-letter variable too, not as a bracketed label: y₁₋ₓ", () => {
    expect(linesOf([["the term "], ["y", VAR], ["1-x", { ...low, gap: -0.02 }], [" is small"]])).toEqual(["the term y₁₋ₓ is small"]);
  });

  it("leaves a lowered charge, a group that ends on a sign, as it is: Ti3+, Fe4−", () => {
    expect(linesOf([["films of Ti"], ["3+", low], [" were grown"]])).toEqual(["films of Ti3+ were grown"]);
    expect(linesOf([["the complex Fe"], ["4\u2212", low], [" is stable"]])).toEqual(["the complex Fe4\u2212 is stable"]);
  });

  it("leaves a lowered decimal, which has no subscript form for its point, as it is: Ni0.5", () => {
    expect(linesOf([["spinel LiNi"], ["0.5", low], ["Mn"], ["1.5", low], [" oxide"]])).toEqual(["spinel LiNi0.5Mn1.5 oxide"]);
  });

  it("leaves a lowered digit that stands on no formula as it is: after a word space, after a digit, at a line's head, after a space", () => {
    expect(linesOf([["see Figure"], ["2", { ...low, gap: 3 }], [" below"]])).toEqual(["see Figure 2 below"]);
    expect(linesOf([["see Figure "], ["2", low], [" below"]])).toEqual(["see Figure 2 below"]);
    expect(linesOf([["a 10"], ["3", low], [" signal"]])).toEqual(["a 103 signal"]);
    expect(linesOf([["2", low], ["O stands at the head"]])).toEqual(["2O stands at the head"]);
  });

  it("leaves a plain digit alone: Figure 2, LiCoO2 typed on the line, a raised exponent as P9-08 wrote it", () => {
    expect(linesOf([["See Figure 2 for the LiCoO2 films in S1 and 1g of CoO2."]])).toEqual(["See Figure 2 for the LiCoO2 films in S1 and 1g of CoO2."]);
    expect(linesOf([["a diffusivity in cm"], ["2", high], [" per second"]])).toEqual(["a diffusivity in cm² per second"]);
    expect(linesOf([["the Co"], ["2+", high], [" ion"]])).toEqual(["the Co²⁺ ion"]);
  });

  it("reads the stored space run behind the base or behind the subscript as it always did: no space in front, one behind", () => {
    expect(linesOf([["a LiCoO"], [" ", { width: 0.15 }], ["2", { ...low, gap: 0.5 }], [" ", { ...low, width: 0.7 }], ["cathode"]])).toEqual(["a LiCoO₂ cathode"]);
    expect(linesOf([["a LiCoO"], ["2 ", low], ["cathode"]])).toEqual(["a LiCoO₂ cathode"]);
  });

  it("still drops a citation number that stands behind a formula ending in a subscript, and keeps an exponent behind a unit", () => {
    expect(linesOf([["the LiCoO"], ["2", low], ["35", high], [" cathode"]])).toEqual(["the LiCoO₂ cathode"]);
    expect(linesOf([["the Li"], ["1−x", low], ["CoO"], ["2", low], ["17", high], [", then"]])).toEqual(["the Li₁₋ₓCoO₂, then"]);
    expect(linesOf([["its rate in s"], ["−1", high], [" at 5"]])).toEqual(["its rate in s⁻¹ at 5"]);
  });

  it("runs through the page's rows the way a PDF stores them, into the paragraph", () => {
    const rows = [
      ...laid([["The LiCoO"], ["2", low], [" film and the Li"], ["1−x", low], ["CoO"], ["2", low], [" film"]], { y: 500 }),
      ...laid([["are measured at Co"], ["2+", { height: 6.7, y: 492.4 }], [" sites."]], { y: 488 }),
    ];
    expect(linesOfPage({ page: 1, items: rows }).map((l) => l.text)).toEqual(["The LiCoO₂ film and the Li₁₋ₓCoO₂ film", "are measured at Co²⁺ sites."]);
  });
});

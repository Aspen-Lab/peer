import { describe, expect, it } from "vitest";
import { buildOutline, joinProse, type PdfLine, type PdfTextItem } from "./pdf-outline";

// P10-42 (X-A9): a block that ends with no sentence terminator is a cut sentence, whatever the next block's
// first word is (a technique's name, a symbol, a capital): it joins the next one across a page break or a
// floating figure, unless the next block opens a heading or a list item. A full stop (with a closing quote or
// bracket, and not an abbreviation's) still ends the paragraph. Every text is invented; no sentence of any paper.

function line(text: string, at: Partial<PdfLine> = {}): PdfLine {
  return { page: 1, text, x: 100, y: 500, size: 10, font: "body", ...at };
}
function item(str: string, at: Partial<PdfTextItem> = {}): PdfTextItem {
  return { str, height: 10, width: str.length * 4.6, fontName: "body", x: 100, y: 500, ...at };
}

describe("joinProse — a page break after a cut sentence joins whatever the next word is (P10-42, X-A9)", () => {
  const first = (text: string) => line(text, { page: 1, y: 100 });
  const second = (text: string) => line(text, { page: 2, y: 700 });
  const paragraphs = (a: string, b: string) => joinProse([first(a), second(b)]).split("\n\n");

  it.each([
    ["The reefs were mapped from the air with", "Synthetic Aperture Radar and checked on foot."],
    ["The salinity of each pool was read by", "Raman spectroscopy at low tide."],
    ["The slope was fitted over the range of", "ΔT between the two dives."],
    ["The mooring was inspected after", "Hurricane Delta, and again in spring."],
    ["The depth followed", "Eq (3) for the whole tide."],
  ])("joins %j to %j", (a, b) => {
    expect(paragraphs(a, b)).toEqual([`${a} ${b}`]);
  });

  it("still starts a new paragraph after a full stop, a question mark or an exclamation mark, a closing quote or bracket included", () => {
    expect(paragraphs("The team counted ten sites near the marsh.", "Synthetic Aperture Radar then mapped the reefs.")).toHaveLength(2);
    expect(paragraphs("Did the team count ten sites near the marsh?", "Synthetic Aperture Radar then mapped the reefs.")).toHaveLength(2);
    expect(paragraphs("The team counted ten sites near the marsh!", "Synthetic Aperture Radar then mapped the reefs.")).toHaveLength(2);
    expect(paragraphs("The team counted ten sites near the marsh (see the map.)", "Synthetic Aperture Radar then mapped the reefs.")).toHaveLength(2);
    expect(paragraphs("The team said \"ten sites near the marsh.\"", "Synthetic Aperture Radar then mapped the reefs.")).toHaveLength(2);
  });

  it("takes an abbreviation's stop (P10-37) for no end, and a real sentence's for one", () => {
    expect(paragraphs("The survey followed the earlier one by Ortega et al.", "Synthetic Aperture Radar then mapped the reefs.")).toHaveLength(1);
    expect(paragraphs("The survey followed the earlier one by Ortega et al. in 2019.", "Synthetic Aperture Radar then mapped the reefs.")).toHaveLength(2);
  });

  it("does not join a heading or a list item to the cut line above it", () => {
    for (const next of [
      "3.2 Annealing schedule",
      "MATERIALS AND METHODS",
      "• Synthetic Aperture Radar was used",
      "- Synthetic Aperture Radar was used",
      "1. Synthetic Aperture Radar was used",
      "A) Synthetic Aperture Radar was used",
      "iv. Synthetic Aperture Radar was used",
    ]) {
      expect(paragraphs("The reefs were mapped from the air with", next), next).toHaveLength(2);
    }
  });
});

describe("joinProse — a floating figure after a cut sentence joins whatever the next word is (P10-42, X-A9)", () => {
  const flow = (texts: string[], y0: number, step = 12): PdfLine[] => texts.map((text, i) => line(text, { y: y0 - i * step }));
  const cut = (after: string, gap = 300) => [
    ...flow(["The reefs along the northern shore were mapped from the air with"], 700),
    ...flow([after, "and checked on foot at low tide."], 688 - gap),
  ];

  it("keeps the sentence whole across a gap of many pitches, whatever the next word", () => {
    for (const after of ["Synthetic Aperture Radar", "Raman spectroscopy", "ΔT"]) {
      const paragraphs = joinProse(cut(after)).split("\n\n");
      expect(paragraphs, after).toHaveLength(1);
      expect(paragraphs[0]).toContain(`with ${after}`);
    }
  });

  it("still breaks after a finished sentence, and at an ordinary paragraph gap", () => {
    const finished = [
      ...flow(["The reefs along the northern shore were mapped from the air."], 700),
      ...flow(["Synthetic Aperture Radar", "then checked them on foot at low tide."], 388),
    ];
    expect(joinProse(finished).split("\n\n")).toHaveLength(2);
    const ordinary = [
      ...flow(["The reefs along the northern shore were mapped from the air with"], 700),
      ...flow(["Synthetic Aperture Radar", "then checked them on foot at low tide."], 664),
    ];
    expect(joinProse(ordinary).split("\n\n")).toHaveLength(2);
  });

  it("does not join a heading or a list item to the cut line above the gap", () => {
    expect(joinProse(cut("3.2 Annealing schedule")).split("\n\n")).toHaveLength(2);
    expect(joinProse(cut("• Synthetic Aperture Radar")).split("\n\n")).toHaveLength(2);
  });
});

describe("the outline — a cut sentence around a figure, on a page and across a page (P10-42, X-A9)", () => {
  const filler = "Quillwort cathodes were annealed in air before every measurement was taken.";
  const head = (y: number) => [item("A Paper About Cathodes", { height: 17, y }), item("1 Methods", { y: y - 20 })];

  it("a caption set in the column does not cut the paragraph before a capital", () => {
    const outline = buildOutline([
      {
        page: 1,
        items: [
          ...head(760),
          item(filler, { y: 726 }),
          item(filler, { y: 714 }),
          item("The film was imaged by", { y: 702 }),
          item("Figure 1: Texture through the thickness of the film.", { y: 420, fontName: "caption", height: 9 }),
          item("Scanning Transmission Electron Microscopy and found to be random.", { y: 380 }),
          item(filler, { y: 368 }),
          item(filler, { y: 356 }),
        ],
      },
    ]);
    const paragraphs = (outline.sections?.[0].text ?? "").split("\n\n");
    expect(outline.figureCaptions).toHaveLength(1);
    expect(paragraphs.filter((p) => p.includes("imaged by"))).toHaveLength(1);
    expect(paragraphs.find((p) => p.includes("imaged by"))).toContain("imaged by Scanning Transmission Electron Microscopy and found");
  });

  it("a page break with a caption between joins the two halves before a capital, and a full stop still splits", () => {
    const pages = (end: string) => [
      {
        page: 1,
        items: [...head(760), item(filler, { y: 726 }), item(filler, { y: 714 }), item(end, { y: 702 }), item("Figure 1: Texture through the thickness of the film.", { y: 200, fontName: "caption", height: 9 })],
      },
      {
        page: 2,
        items: [item("Scanning Transmission Electron Microscopy and found to be random.", { y: 760 }), item(filler, { y: 748 }), item(filler, { y: 736 })],
      },
    ];
    const joined = (buildOutline(pages("The film was imaged by")).sections?.[0].text ?? "").split("\n\n");
    expect(joined.filter((p) => p.includes("imaged by"))).toHaveLength(1);
    expect(joined.find((p) => p.includes("imaged by"))).toContain("imaged by Scanning Transmission Electron Microscopy");
    const split = (buildOutline(pages("The film was imaged.")).sections?.[0].text ?? "").split("\n\n");
    expect(split.find((p) => p.includes("was imaged."))).not.toContain("Scanning");
  });
});

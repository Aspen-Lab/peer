import { describe, expect, it } from "vitest";
import { canonicalizeHeading, withInheritedBuckets, withSectionIds, type ExtractedDocument } from "./html-text";
import { buildOutline, captionAt, isDropCap, linesOfPageWith, type PdfLine, type PdfPageText, type PdfTextItem } from "./pdf-outline";
import { buildReadingMap, readableSections } from "./reading-map";
import { closingPartition } from "./reading-partition";

// P12-70: where the rules of the P12 Cs meet in `captionAt` (C P12-56's R6b: a label line after a line that ends
// mid-sentence is prose) and in the outline's other rules (C P12-51's O8: the text of a figure's panels is out of the
// prose). Every text is invented.

const BODY = { size: 10, font: "body" };
const GHOST = "Fig. 4. Then the signal rises with the load on the cell in the same order.";
const FULL = "The rate of deposition of the film increased with the supply of precursor, as shown in";

function line(text: string, at: Partial<PdfLine> = {}): PdfLine {
  return { page: 1, text, x: 100, y: 500, size: 10, font: "body", ...at };
}

describe("a line the reading leaves out is not open prose (P12-70: R6b with O8)", () => {
  const read = [line("5 Min", { y: 512 }), line("Figure 4: Capacity after five minutes.", { y: 500 })];

  it("makes a label line under figure text a caption, though the text above is in the body's size and face and ends no sentence", () => {
    expect(captionAt(read, 1, 12, BODY, new Set()), "without the knowledge: R6b's reading").toBeNull();
    expect(captionAt(read, 1, 12, BODY, new Set(), (j) => j === 0)).toMatchObject({ label: "Figure 4" });
  });

  it("leaves a label line under real prose refused, whatever else the reading leaves out", () => {
    const prose = [line(FULL, { y: 512 }), line(GHOST, { y: 500 })];
    expect(captionAt(prose, 1, 12, BODY, new Set(), (j) => j === 5)).toBeNull();
    expect(captionAt(prose, 1, 12, BODY, new Set(), () => false)).toBeNull();
  });

  it("holds in the whole reading: three short lines of figure text in the body's face, then the caption, are listed and out of the prose", () => {
    const item = (str: string, y: number, at: Partial<PdfTextItem> = {}): PdfTextItem => ({ str, height: 10, width: str.length * 4.6, fontName: "body", x: 100, y, ...at });
    const prose = [
      "Quillwort cathodes degrade through slow loss of lithium at the grain edges of the film.",
      "We follow the loss over four hundred cycles and ask which edge goes first in each sample.",
      "The answer decides how the films are annealed before they are built into a cell.",
    ];
    const page: PdfPageText = {
      page: 1,
      items: [
        item("A Paper About Quillwort Cathodes", 780, { height: 17 }),
        item("1 Introduction", 760),
        ...prose.map((text, i) => item(text, 746 - i * 14)),
        item("5 Min", 692),
        item("10 Min", 678),
        item("20 Min", 664),
        item("Figure 4: Capacity after five, ten and twenty minutes.", 652),
      ],
    };
    const outline = buildOutline([page]);
    expect(outline.figureCaptions?.map((c) => c.label)).toEqual(["Figure 4"]);
    expect((outline.sections ?? []).map((s) => s.text).join(" ")).toBe(prose.join(" "));
  });
});

describe("a paragraph's short last line ends its paragraph without a full stop (P12-70: R6b with O8's required negative)", () => {
  const caption = "Figure 3: Capacity of the films over the cycles.";
  const full = "We follow the loss over four hundred cycles and ask which edge goes first in each sample";

  it("makes a label line under a short last line a caption", () => {
    const read = [line(full, { y: 524 }), line("of the new set", { y: 512 }), line(caption, { y: 500 })];
    expect(captionAt(read, 2, 12, BODY, new Set())).toMatchObject({ label: "Figure 3" });
  });

  it("does not make a mid-sentence line that is only a little shorter than the one above it a paragraph's end", () => {
    // a ragged right edge: the line above wraps at 70% of the one before it, and the label line goes on with its sentence
    const wrapped = full.slice(0, Math.round(full.length * 0.7)).replace(/\s+\S*$/, "");
    const read = [line(full, { y: 524 }), line(wrapped, { y: 512 }), line(GHOST, { y: 500 })];
    expect(captionAt(read, 2, 12, BODY, new Set())).toBeNull();
    // and a line of full width: the ghost of R6b, as before
    expect(captionAt([line(full, { y: 524 }), line(FULL, { y: 512 }), line(GHOST, { y: 500 })], 2, 12, BODY, new Set())).toBeNull();
  });

  it("needs the line before it to be a line of the same paragraph: same page, directly above, same column, same face and size", () => {
    const short = line("of the new set", { y: 512 });
    const refused = (before: PdfLine) => captionAt([before, short, line(GHOST, { y: 500 })], 2, 12, BODY, new Set());
    expect(refused(line(full, { y: 524 })), "the paragraph's line").toMatchObject({ label: "Fig 4" });
    expect(refused(line(full, { y: 524, page: 2 })), "another page").toBeNull();
    expect(refused(line(full, { y: 560 })), "a gap").toBeNull();
    expect(refused(line(full, { y: 524, x: 340 })), "another column").toBeNull();
    expect(refused(line(full, { y: 524, font: "bold" })), "another face").toBeNull();
    expect(refused(line(full, { y: 524, size: 14 })), "another size").toBeNull();
  });
});

describe("the opening of a paper that names no introduction starts at a line headed by a drop cap (P12-70, ruling §1h.444: O6 with O7 and P12-64)", () => {
  const item = (str: string, y: number, at: Partial<PdfTextItem> = {}): PdfTextItem => ({ str, height: 10, width: str.length * 4.6, fontName: "body", x: 100, y, ...at });
  const OPENING = [
    "econdary cathodes degrade through slow loss of lithium at the grain edges of the film.",
    "We follow the loss over four hundred cycles and ask which edge goes first in each sample.",
    "The answer decides how the films are annealed before they are built into a cell.",
    "Films that were cooled quickly lost a third of their capacity before the hundredth cycle.",
  ];
  const RESULT = [
    "The capacity of the annealed films held at ninety percent of its first value over the run.",
    "Films that were cooled quickly lost a third of their capacity before the hundredth cycle.",
    "The edges of the slow-cooled grains stayed whole under the microscope after the last cycle.",
  ];
  /** A title, an author line, a two-line summary in another face, and an opening whose first line begins with a drop cap `cap` pt high, `gap` pt from the rest of the word. */
  const paper = (cap = 40, gap = 3): PdfPageText[] => [
    {
      page: 1,
      items: [
        item("Slow Annealing Keeps Quillwort Films Whole", 760, { height: 17 }),
        item("Ada Fenwick and Boris Lund", 735, { height: 11, fontName: "display" }),
        item("Quillwort cathodes keep their capacity when the films are cooled slowly after growth and lose it when they are", 705, { height: 10.5, fontName: "display" }),
        item("not, because the edges of the grains are spared the strain of the cooling that the quick films are put through.", 692, { height: 10.5, fontName: "display" }),
        item("S", 660, { height: cap, width: cap * 0.6 }),
        item(OPENING[0], 660, { x: 100 + cap * 0.6 + gap }),
        item(OPENING[1], 646),
        item(OPENING[2], 632),
        item(OPENING[3], 618),
        item("Slow cooling spares the grain edges", 590, { height: 12, fontName: "display" }),
        ...RESULT.map((text, i) => item(text, 576 - i * 14)),
      ],
    },
  ];

  it("keeps the drop cap's line in the opening, its first paragraph starts with the whole first word", () => {
    const sections = buildOutline(paper()).sections ?? [];
    expect(sections.map((s) => s.heading)).toEqual([undefined, "Slow cooling spares the grain edges"]);
    expect(sections[0].text?.split("\n\n")[0].startsWith("Secondary cathodes degrade through slow loss of lithium")).toBe(true);
    expect(sections[0].text).toContain(OPENING[3]);
    expect(sections[0].text).not.toMatch(/Fenwick|Quillwort cathodes keep|S econdary/);
    expect(sections[1].text).toBe(RESULT.join(" "));
    expect(buildOutline(paper()).title).toBe("Slow Annealing Keeps Quillwort Films Whole");
  });

  it("holds for a cap of any size from twice the body to five times, and for the padding the page leaves beside it (up to a fifth of the cap)", () => {
    for (const cap of [20, 28, 40, 50]) {
      for (const gap of [0, 1, 3, cap * 0.2]) {
        const sections = buildOutline(paper(cap, gap)).sections ?? [];
        expect(sections[0].text?.startsWith("Secondary cathodes degrade"), `${cap} pt, ${gap} pt apart`).toBe(true);
      }
    }
  });

  it("does not join a large mark to a word that is not the rest of its own: a capital and a capitalised word stay two", () => {
    const [first] = paper();
    const page: PdfPageText = {
      ...first,
      items: [...first.items, item("A", 520, { height: 30, width: 18 }), item("Results of the second season were as before.", 520, { x: 121 })],
    };
    const text = (buildOutline([page]).sections ?? []).map((s) => s.text).join(" ");
    expect(text).toContain("A Results of the second season were as before.");
    expect(text).not.toContain("AResults");
  });
});

// ── A drop cap that spans three lines and stands on the third (P12-70, ruling §1h.445) ──────────────────────
//
// A Nature-style first page: a 20 pt label, an 8 pt DOI line, two 24 pt title lines, a 12 pt author line, 7 pt
// affiliations, a nine-line summary at 9.5 pt in another face, and the opening in the body face at 9.3 pt. The
// opening's first paragraph is set around a drop cap 41.6 pt high that spans its first three lines: the first two lines
// are body lines indented by the cap's width ("nail density ..." - the first word without its capital), and the cap
// stands on the baseline of the third, so a row holds the capital and the third line's words. Every text is invented.

describe("a drop cap on the third line of the opening's first paragraph (P12-70, ruling §1h.445)", () => {
  const BODY_SIZE = 9.3;
  const PITCH = 11.4;
  const CAP = 41.6;
  const INDENT = 130;
  const text = (str: string, y: number, at: Partial<PdfTextItem> = {}): PdfTextItem => ({ str, height: BODY_SIZE, width: str.length * 4.3, fontName: "body", x: 100, y, ...at });

  const SUMMARY_LINES = [
    "Snails of the rocky shore live where the waves break, and how thick their shells grow is a long-standing question of",
    "the intertidal. We surveyed forty shores on three coasts over two years and counted snails in every quadrat that we",
    "laid, and we weighed the shells of those we collected. The counts rise with the force of the waves on each shore",
    "and the shells grow thicker where crabs are many, but these two patterns are not the same pattern: the shells",
    "are thickest on the calm shores where the crabs are many, and thinnest where the waves are strong. This reading",
    "of the shore sets the effect of the waves apart from the effect of the crabs and shows that the crabs, not the",
    "waves, set the thickness of the shell. The result holds on all three coasts and in both years of the survey, and",
    "it holds when the shores are ranked by exposure alone. It bears on how the shells of snails will change when the",
    "crabs of these shores move with the warming of the sea.",
  ];
  /** The first paragraph: lines 1 to 3 are indented by the cap; the cap's capital is "S" of "Snail". */
  const FIRST = [
    "nail density rises with wave exposure on the rocky shores",
    "and the shells grow thicker where the crabs are many and",
    "the water is calm, a pattern we followed on three coasts",
  ];
  const FIRST_REST = [
    "over two years of survey work on the shore at low tide, and the counts of the snails in each quadrat.",
    "We weighed the shells of those we collected and ranked the shores by the force of the waves upon them.",
  ];
  const ANNOUNCE = "Here we show that wave exposure raises snail density and that crab predation thickens shells.";
  const SUMMARY = "Taken together, we show that wave exposure raises snail density and that crab predation thickens the shells.";
  const OUTLOOK = "Future surveys could follow the recovery of algal cover after storm scouring across more shores.";
  const SNAILS = "Snail density rises with wave exposure";
  const SHELLS = "Shell thickness follows crab predation";
  const STORMS = "Recovery after storm scouring";
  const plain = (n: number, seed = 0): string[] =>
    Array.from({ length: n }, (_, k) => `The survey logged ${10 + k + seed} counts of limpets on the rocky shore and in the pools beside it, on every coast.`);

  interface Row {
    items: PdfTextItem[];
    /** Points between the row above's baseline and this one's. */
    before: number;
  }
  /** Rows flowed down the pages from the top, a new page when one runs out. */
  function pages(rows: Row[]): PdfPageText[] {
    const out: PdfPageText[] = [{ page: 1, items: [] }];
    let y = 800;
    rows.forEach((row, i) => {
      y -= i === 0 ? 0 : row.before;
      if (y < 60) {
        out.push({ page: out.length + 1, items: [] });
        y = 780;
      }
      out[out.length - 1].items.push(...row.items.map((it) => ({ ...it, y: it.y + y })));
    });
    return out;
  }
  /** A row of runs at baseline offsets from the row's own. */
  const row = (before: number, ...items: PdfTextItem[]): Row => ({ before, items });
  const line = (str: string, before = PITCH, at: Partial<PdfTextItem> = {}): Row => row(before, text(str, 0, at));
  const paragraph = (lines: string[], before = 24): Row[] => lines.map((str, i) => line(str, i === 0 ? before : PITCH));

  /** What a test changes of the paper: the large mark (`cap`), the paragraph's first three lines and the rest of it, and the row the cap stands in (3 by default, 1 for the usual cap). */
  interface Variant {
    cap?: string;
    first?: string[];
    rest?: string[];
    capRow?: 1 | 3;
  }
  /** `capDrop`: how far the cap's baseline stands under the words' (a cap rarely sits to the hundredth); `capGap`: the padding between the cap and the words. */
  function nature(capDrop = 0, capGap = 4, indented = true, v: Variant = {}): PdfTextItem[][] {
    const cap = v.cap ?? "S";
    const first = v.first ?? FIRST;
    const after = v.rest ?? FIRST_REST;
    const rows: Row[] = [
      line("ARTICLE", 0, { height: 20, fontName: "display", width: 90 }),
      line("https://doi.org/10.0000/s00000-000-00000-0", 20, { height: 8, width: 160 }),
      line("Shore snails thicken their shells under", 30, { height: 24, fontName: "display", width: 360 }),
      line("crab predation across wave exposure", 28, { height: 24, fontName: "display", width: 330 }),
      line("Ada Fenwick, Boris Lund, Cy Orme", 28, { height: 12, fontName: "display", width: 190 }),
      line("Department of Shore Ecology, University of Tarn, Elmstead", 12, { height: 7, width: 200 }),
      line("Institute of Cells, Fenwick Hall, Elmstead", 8, { height: 7, width: 160 }),
      ...SUMMARY_LINES.map((str, i) => line(str, i === 0 ? 20 : PITCH, { height: 9.5, fontName: "display" })),
      ...(v.capRow === 1
        ? [
            row(28, text(cap, -capDrop, { x: 100, height: CAP, width: INDENT - 100 - capGap }), text(first[0], 0, { x: INDENT })),
            line(first[1], PITCH, { x: INDENT }),
            line(first[2], PITCH, { x: INDENT }),
          ]
        : [
            line(first[0], 28, { x: indented ? INDENT : 100 }),
            line(first[1], PITCH, { x: indented ? INDENT : 100 }),
            row(PITCH, text(cap, -capDrop, { x: 100, height: CAP, width: INDENT - 100 - capGap }), text(first[2], 0, { x: INDENT })),
          ]),
      ...after.map((str) => line(str)),
      ...paragraph([ANNOUNCE]),
      line(SNAILS, 30, { height: 11, fontName: "display", width: 190 }),
      ...paragraph(plain(14, 1), 16),
      line(SHELLS, 30, { height: 11, fontName: "display", width: 190 }),
      ...paragraph(plain(14, 2), 16),
      line(STORMS, 30, { height: 11, fontName: "display", width: 190 }),
      ...paragraph(plain(4, 3).slice(0, 2)),
      ...paragraph(plain(3, 4)),
      ...paragraph([SUMMARY]),
      ...paragraph([OUTLOOK]),
      line("References", 30, { height: 11, fontName: "display", width: 90 }),
      line("[1] Someone, A. A paper about snails. Journal of Shores 12, 1-9 (2015).", 16),
      line("[2] Another, B. A second paper about shells. Journal of Crabs 4, 22-30 (2016).", PITCH),
    ];
    return pages(rows).map((p) => p.items);
  }
  const pagesOf = (capDrop = 0, capGap = 4, indented = true, v: Variant = {}): PdfPageText[] =>
    nature(capDrop, capGap, indented, v).map((items, i) => ({ page: i + 1, items }));
  const outlineOf = (capDrop = 0, capGap = 4, indented = true, v: Variant = {}) => buildOutline(pagesOf(capDrop, capGap, indented, v));

  /** The outline's sections as the reading would receive them (a section with no heading is "Body"), as a document. */
  function documentOf(outline: ReturnType<typeof buildOutline>): ExtractedDocument {
    return {
      sections: withSectionIds(
        withInheritedBuckets(
          (outline.sections ?? []).map((s) => {
            const heading = s.heading || "Body";
            return { heading, canonical: canonicalizeHeading(heading), text: s.text ?? "" };
          }),
        ),
      ),
      figureCaptions: [],
      source: "pdf",
    };
  }

  it("starts the opening with the whole first word, though the cap stands on the third line", () => {
    for (const [drop, gap] of [[0, 4], [1.5, 4], [0, 9], [-1.5, 2]] as const) {
      const sections = outlineOf(drop, gap).sections ?? [];
      const opening = sections[0];
      expect(opening.heading, `${drop}/${gap}`).toBeUndefined();
      expect(opening.text?.split("\n\n")[0], `${drop}/${gap}`).toBe(`Snail ${FIRST[0].slice(5)} ${FIRST[1]} ${FIRST[2]} ${FIRST_REST.join(" ")}`);
      expect(opening.text, `${drop}/${gap}`).not.toMatch(/Sthe|S nail|S the/);
    }
  });

  it("makes no heading of the cap's row, nor of the cover, and keeps the cover out of the opening", () => {
    const outline = outlineOf();
    expect((outline.sections ?? []).map((s) => s.heading)).toEqual([undefined, SNAILS, SHELLS, STORMS]);
    const opening = outline.sections?.[0].text ?? "";
    for (const cover of ["doi.org", "Fenwick", "Department of Shore", "Snails of the rocky shore", "ARTICLE"]) expect(opening).not.toContain(cover);
    expect(opening.split("\n\n")[1]).toBe(ANNOUNCE);
    expect(outline.title).toBe("Shore snails thicken their shells under crab predation across wave exposure");
  });

  it("reads the cap's row as prose and never a heading even when no line above it is one it stands beside", () => {
    // the two lines above are not indented, so the capital cannot be moved to a first line: the row stays as the page has it
    const outline = outlineOf(0, 4, false);
    expect((outline.sections ?? []).map((s) => s.heading)).toEqual([undefined, SNAILS, SHELLS, STORMS]);
    const opening = outline.sections?.[0].text ?? "";
    expect(opening.startsWith(FIRST[0])).toBe(true);
    expect(opening).toContain(FIRST_REST[1]);
    for (const cover of ["doi.org", "Fenwick", "Snails of the rocky shore"]) expect(opening).not.toContain(cover);
  });

  it("leaves the closing split its echo: the opening's last paragraph is the announcement, not the DOI line", () => {
    const doc = documentOf(outlineOf());
    const body = readableSections(doc).map(({ id, section, paragraphs }) => ({ id, canonical: section.canonical, paragraphs }));
    const map = buildReadingMap(doc);
    const storms = map.sections.find((r) => r.heading === STORMS)!;
    const split = closingPartition(map, body, null);
    expect(split).toMatchObject({ sectionId: storms.id, closing: true });
    expect(split?.parts.map((part) => part.role)).toEqual(["results", "conclusion"]);
  });

  it("is no drop cap when the large part of the row is a word of three letters or more, and nothing is moved from it (ruling §1h.443 (c))", () => {
    // "Sna" is 41.6 pt, in the body's face, with body-sized words after it in the same row: a large first word welded to
    // its line, not one or two large letters. The two lines above it are indented as if it were a cap.
    const word: Variant = { cap: "Sna", first: ["il density rises with wave exposure on the rocky shores", FIRST[1], FIRST[2]] };
    const lines = pagesOf(0, 4, true, word).flatMap((page) => linesOfPageWith(page, null));
    const row = lines.find((l) => l.size > 40)!;
    expect(row.text.startsWith("Sna")).toBe(true);
    expect(row.cap).toBeUndefined();
    expect(isDropCap(row, { size: 9.3, font: "body" })).toBe(false);
    // ...and the reading takes nothing from the row to the line above: the first line stays "il density ...", the word is not joined to it
    const outline = outlineOf(0, 4, true, word);
    const all = (outline.sections ?? []).flatMap((s) => [s.heading ?? "", s.text ?? ""]).join("\n");
    expect(all).toContain("il density rises with wave exposure on the rocky shores");
    expect(all).not.toContain("Snail density rises with wave exposure on");
    expect(all).not.toMatch(/Sna(?:il)? ?il density rises with wave exposure on/);
    // one or two letters are a cap and three are not, the rest of the row being the same
    expect(outlineOf(0, 4, true, { cap: "S" }).sections?.[0].text).toMatch(/^Snail density/);
    expect(outlineOf(0, 4, true, { cap: "Sn", first: ["ail density rises with wave exposure on the rocky shores", FIRST[1], FIRST[2]] }).sections?.[0].text).toMatch(/^Snail density/);
  });

  describe("a one-letter cap that is a whole word is not joined to the word beside it (ruling §1h.446)", () => {
    const LINES_2_3 = ["first year, and the counts of the snails were taken at every", "quadrat that we laid on the shore at low tide over two years"];
    const opening = (v: Variant, where: 1 | 3) => outlineOf(0, 4, true, { ...v, capRow: where }).sections?.[0].text?.split("\n\n")[0] ?? "";

    it("keeps the space when the bare word is printed in the paper and the joined word is printed nowhere", () => {
      // "A" + "study": the paper prints "a" ("with a count", "is a long-standing question") and never "astudy"
      const study: Variant = {
        cap: "A",
        first: ["study of the rocky shore snails began on three coasts in the", ...LINES_2_3],
        rest: ["over two years of survey work on the shore, with a count of the snails in each quadrat.", FIRST_REST[1]],
      };
      for (const where of [3, 1] as const) {
        expect(opening(study, where).startsWith("A study of the rocky shore snails began"), `cap on row ${where}`).toBe(true);
        expect(opening(study, where), `cap on row ${where}`).not.toContain("Astudy");
      }
      // "I" + "think", the same: the paper prints "I" ("and I counted") and never "ithink"
      const think: Variant = {
        cap: "I",
        first: ["think the shells of the rocky shore snails grow thick on three coasts in the", ...LINES_2_3],
        rest: ["over two years of survey work on the shore, and I counted the snails in each quadrat.", FIRST_REST[1]],
      };
      for (const where of [3, 1] as const) expect(opening(think, where).startsWith("I think the shells"), `cap on row ${where}`).toBe(true);
    });

    it("joins when the joined word is printed elsewhere, though the bare word is printed too", () => {
      // "A" + "lmost": the paper prints "almost" in its second line of the paragraph, and "a" as well
      const almost: Variant = {
        cap: "A",
        first: ["lmost every snail of the rocky shore was counted on three coasts in the", ...LINES_2_3],
        rest: ["over two years of survey work on the shore, with a count of the snails, and we weighed almost all the shells.", FIRST_REST[1]],
      };
      for (const where of [3, 1] as const) {
        expect(opening(almost, where).startsWith("Almost every snail of the rocky shore"), `cap on row ${where}`).toBe(true);
        expect(opening(almost, where), `cap on row ${where}`).not.toMatch(/A lmost|Almostevery/);
      }
    });

    it("joins as it always did when the bare letter is no word of the paper", () => {
      // "Q" + "uillwort": no "q" is printed and "quillwort" is printed nowhere else
      const quillwort: Variant = { cap: "Q", first: ["uillwort snails of the rocky shore began on three coasts in the", ...LINES_2_3] };
      for (const where of [3, 1] as const) expect(opening(quillwort, where).startsWith("Quillwort snails of the rocky shore began"), `cap on row ${where}`).toBe(true);
    });
  });
});

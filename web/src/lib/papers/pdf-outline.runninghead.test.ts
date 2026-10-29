import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { buildOutline, furnitureOf, isFurniture, joinProse, type PdfLine, type PdfPageText, type PdfTextItem } from "./pdf-outline";
import { minimalPdf, type Run } from "./minimal-pdf.test-helper";
import { extractPdfTextFromPath } from "./pdf-text";

// P10-33 (BACKLOG-84): a running head is a line in the page's top or bottom band on at least three
// pages; a body paragraph whose words repeat is kept. And a paragraph crosses a page break only when
// it continues. Every text is invented; no sentence of any paper.

function line(text: string, at: Partial<PdfLine> = {}): PdfLine {
  return { page: 1, text, x: 100, y: 500, size: 10, font: "body", ...at };
}

const LETTERS = "abcdefghij"; // no digits: a digit is normalised away, and two pages' lines would read as one

/** A page of body lines at the given heights, so the band has something to be the edge of. */
function bodyLines(page: number): PdfLine[] {
  return [700, 660, 620, 580, 540, 500, 460, 420, 380, 340].map((y, i) => line(`Body line ${LETTERS[page]}${LETTERS[i]} reads on.`, { page, y }));
}

describe("furnitureOf — a running head sits in the page's top or bottom band on at least three pages (P10-33)", () => {
  it("keeps a paragraph's lines that repeat at the top of two pages out of the furniture", () => {
    // Pages 2 and 4 open with the same three lines at the same height: a templated paragraph, not a head.
    const repeated = ["Survey paragraph # looks at the tide pools.", "The team counted # sites near the tide pools.", "The rest of it is set out below."];
    const lines = [1, 2, 3, 4].flatMap(bodyLines);
    for (const page of [2, 4]) repeated.forEach((text, i) => lines.push(line(text, { page, y: 780 - i * 14 })));
    expect(furnitureOf(lines, 4).size).toBe(0);
  });

  it("takes a head repeated in the top band of three pages, whatever its digits", () => {
    const lines = [1, 2, 3, 4].flatMap(bodyLines);
    for (const page of [1, 2, 3]) lines.push(line(`Journal of Invented Results ${page}`, { page, y: 790 }));
    expect(furnitureOf(lines, 4).size).toBe(1);
  });

  it("takes a footer repeated in the bottom band of three pages", () => {
    const lines = [1, 2, 3, 4].flatMap(bodyLines);
    for (const page of [2, 3, 4]) lines.push(line("Invented Society preprint, do not cite", { page, y: 40 }));
    expect(furnitureOf(lines, 4).size).toBe(1);
  });

  it("does not take a line repeated at the same height in the middle of the page", () => {
    // Same words, same height, four pages — but between the page's lines, where a head never stands.
    const lines = [1, 2, 3, 4].flatMap(bodyLines);
    for (const page of [1, 2, 3, 4]) lines.push(line("Table of invented counts continues here", { page, y: 481 }));
    expect(furnitureOf(lines, 4).size).toBe(0);
  });

  it("does not take a head that two pages of a three-page paper carry", () => {
    const lines = [1, 2, 3].flatMap(bodyLines);
    for (const page of [1, 2]) lines.push(line("Journal of Invented Results", { page, y: 790 }));
    expect(furnitureOf(lines, 3).size).toBe(0);
  });
});

describe("joinProse — a paragraph crosses a page break only when it continues (P10-33)", () => {
  const first = (text: string) => line(text, { page: 1, y: 100 });
  const second = (text: string) => line(text, { page: 2, y: 700 });
  const paragraphs = (a: string, b: string) => joinProse([first(a), second(b)]).split("\n\n");

  it("joins an unfinished sentence to the lower-case line that carries it on", () => {
    expect(paragraphs("The tide pools were counted at low water on", "the second morning of the visit.")).toEqual([
      "The tide pools were counted at low water on the second morning of the visit.",
    ]);
  });

  it("joins an unfinished sentence to a continuing word, capitalised or not", () => {
    expect(paragraphs("The kelp beds were sampled twice,", "And the gull colonies once.")).toHaveLength(1);
    expect(paragraphs("The sand ripples were measured with a ruler of the kind", "Of course the surveyors used.")).toHaveLength(1);
  });

  it("joins an unfinished sentence to a digit or a bracket", () => {
    expect(paragraphs("The marsh held about", "40 sites in all.")).toHaveLength(1);
    expect(paragraphs("The mussel banks were counted", "(twice) by the team.")).toHaveLength(1);
  });

  it("starts a new paragraph when the first block ends its sentence", () => {
    expect(paragraphs("The team counted ten sites near the marsh.", "the next paragraph begins in lower case by accident.")).toHaveLength(2);
    expect(paragraphs("The team counted ten sites near the marsh?", "Then the tide came in.")).toHaveLength(2);
    expect(paragraphs("The team counted ten sites near the marsh!", "Then the tide came in.")).toHaveLength(2);
  });

  it("starts a new paragraph when a closing bracket follows the full stop", () => {
    expect(paragraphs("The team counted ten sites near the marsh (see the map.)", "Then the tide came in.")).toHaveLength(2);
    expect(paragraphs("The team counted ten sites near the marsh (see the map).", "Then the tide came in.")).toHaveLength(2);
  });

  // P10-42 (re-aimed, X-A9): the first block ends its sentence now; with no sentence end it joins whatever the next
  // block opens with (pdf-outline.cutsentence.test.ts).
  it("starts a new paragraph when the second block opens a sentence of its own", () => {
    expect(paragraphs("The team counted ten sites near the marsh.", "Then the tide came in and the count stopped.")).toHaveLength(2);
  });

  it("leaves the lines of one page as they were", () => {
    const lines = [line("The team counted ten sites near the marsh.", { y: 700 }), line("Then the tide came in.", { y: 686 })];
    expect(joinProse(lines).split("\n\n")).toHaveLength(1);
  });
});

// The invented PDF A P10-14 walked (BACKLOG-84): thirty short paragraphs on pages that repeat their wording
// every six paragraphs, so a page opens with the lines another page opens with. Thirty in, thirty out.
const TOPICS = ["tide pools", "kelp beds", "gull colonies", "sand ripples", "salt marsh", "mussel banks"];
const SENTENCES = (k: number) => {
  const topic = TOPICS[k % TOPICS.length];
  return [`Survey paragraph ${k} looks at the ${topic}.`, `The team counted ${10 + k} sites near the ${topic} on one visit.`];
};
function pagesOf(paragraphs: number, perPage: number): Run[][] {
  const pages: Run[][] = [];
  for (let start = 0; start < paragraphs; start += perPage) {
    const runs: Run[] = start === 0 ? [["A Survey of Shore Ecology", 72, 80, 20]] : [];
    let top = start === 0 ? 130 : 80;
    for (let k = start; k < Math.min(paragraphs, start + perPage); k += 1) {
      SENTENCES(k).forEach((text, i) => runs.push([text, 72, top + i * 14, 11]));
      top += 2 * 14 + 14;
    }
    pages.push(runs);
  }
  return pages;
}

describe("the extractor on an invented PDF whose paragraphs repeat their wording (P10-33)", () => {
  let dir: string;
  beforeAll(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "peer-p10-33-"));
  });
  afterAll(async () => {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  });

  it("reads thirty paragraphs on four pages (nine to a page) as thirty paragraphs", async () => {
    const file = path.join(dir, "thirty.pdf");
    await writeFile(file, minimalPdf(pagesOf(30, 9)));
    const result = await extractPdfTextFromPath(file);
    expect(result.ok).toBe(true);
    const paragraphs = result.doc!.sections.flatMap((s) => s.text.split("\n\n"));
    expect(paragraphs).toHaveLength(30);
    for (let k = 0; k < 30; k += 1) expect(paragraphs[k]).toContain(`Survey paragraph ${k} looks`);
  });
});

// ── P12-97, R-F: the running foot whose folio alternates sides, and the share of the pages that carry text ─────
//
// A journal prints its name, volume and date at the foot of every page of its main text, with the page number on
// the right of an odd page and on the left of an even one. Keyed by its words, the two printings were two feet,
// each on half the pages; and the threshold was a share of every page of the file, the figure-only and the
// supplement pages that carry no foot among them. The foot then stayed in the prose, and once the figure rules
// took the figure text out from between the page's last line and the foot, it fused to the paragraph above.
// Every text is invented; no sentence of any paper.

/** A page of `count` body lines whose words differ from every other page's, so none of them can repeat. */
function textPage(page: number, count = 20): PdfLine[] {
  const word = (n: number) => String.fromCharCode(97 + (n % 26)) + String.fromCharCode(97 + Math.floor(n / 26));
  return Array.from({ length: count }, (_, i) => line(`Row ${word(page)}${word(i)} reads on in this paper.`, { page, y: 740 - i * 12 }));
}
/** A page of figure text only: a few short lines, too few to be a page of text, each different from the other pages'. */
const figurePage = (page: number): PdfLine[] =>
  [700, 600, 500, 400, 300].map((y, i) => line(`Tick ${String.fromCharCode(97 + (page % 26))}${String.fromCharCode(97 + i)}`, { page, y }));

const FOOT = "Elmstead Journal of Shore Notes 12 (2026)";
/** The foot of `page`: the folio on the right of an odd page, on the left of an even one, a bar between. */
const footOf = (page: number): PdfLine => line(page % 2 === 1 ? `${FOOT} | ${340 + page}` : `${340 + page} | ${FOOT}`, { page, y: 40 });

describe("furnitureOf — a foot whose folio alternates sides is one foot (P12-97, R-F)", () => {
  it("takes the foot of a twelve-page paper whose page number stands on the right of odd pages and the left of even ones", () => {
    // Seven pages carry the foot: four odd, three even. Each printing is on fewer than the five pages (40 % of 12) the
    // threshold asks; together they are on seven.
    const lines = Array.from({ length: 12 }, (_, i) => textPage(i + 1)).flat();
    for (let page = 1; page <= 7; page += 1) lines.push(footOf(page));
    const furniture = furnitureOf(lines, 12);
    expect(furniture.size).toBe(1);
    for (let page = 1; page <= 7; page += 1) expect(isFurniture(footOf(page), furniture), `page ${page}`).toBe(true);
    expect(isFurniture(line("Row aa reads on in this paper.", { page: 1, y: 740 }), furniture)).toBe(false);
  });

  it("takes a foot with the folio on the right of every page just as before", () => {
    const lines = Array.from({ length: 12 }, (_, i) => textPage(i + 1)).flat();
    for (let page = 1; page <= 6; page += 1) lines.push(line(`${FOOT} | ${340 + page}`, { page, y: 40 }));
    expect(furnitureOf(lines, 12).size).toBe(1);
  });

  it("takes a foot that is on the same side of every page, and no bar", () => {
    const lines = Array.from({ length: 12 }, (_, i) => textPage(i + 1)).flat();
    for (let page = 1; page <= 6; page += 1) lines.push(line(page % 2 ? `${FOOT} ${340 + page}` : `${340 + page} ${FOOT}`, { page, y: 40 }));
    expect(furnitureOf(lines, 12).size).toBe(1);
  });

  it("counts the share from the pages that carry text: a foot on 7 of the 9 pages of text is furniture in a 21-page file", () => {
    // Twelve pages of figures only. Counted over all 21 pages the foot needs 9 and has 7; counted over the 9 that carry
    // text (15 lines or more) it needs 4.
    const lines = [
      ...Array.from({ length: 9 }, (_, i) => textPage(i + 1)).flat(),
      ...Array.from({ length: 12 }, (_, i) => figurePage(i + 10)).flat(),
    ];
    for (let page = 1; page <= 7; page += 1) lines.push(line(`${FOOT} | ${340 + page}`, { page, y: 40 }));
    expect(furnitureOf(lines, 21).size).toBe(1);
  });

  it("still asks 40 % of the pages of text: a foot on 3 of the 9 is no foot", () => {
    const lines = [
      ...Array.from({ length: 9 }, (_, i) => textPage(i + 1)).flat(),
      ...Array.from({ length: 12 }, (_, i) => figurePage(i + 10)).flat(),
    ];
    for (let page = 1; page <= 3; page += 1) lines.push(line(`${FOOT} | ${340 + page}`, { page, y: 40 }));
    expect(furnitureOf(lines, 21).size).toBe(0);
  });

  it("reads the share of all the pages when none carries 15 lines, as it did", () => {
    // Five pages of ten lines (the pages of the tests above): the foot on 2 of 5 is not on 3, the floor.
    const lines = [1, 2, 3, 4, 5].flatMap((page) => textPage(page, 10));
    for (const page of [1, 2]) lines.push(line(`${FOOT} | ${340 + page}`, { page, y: 40 }));
    expect(furnitureOf(lines, 5).size).toBe(0);
  });

  it("keeps two different feet apart: the folio is not what is compared", () => {
    // A journal's foot on the odd pages and a preprint stamp on the even ones are two feet, each on 4 of 12 pages.
    const lines = Array.from({ length: 12 }, (_, i) => textPage(i + 1)).flat();
    for (const page of [1, 3, 5, 7]) lines.push(line(`${FOOT} | ${340 + page}`, { page, y: 40 }));
    for (const page of [2, 4, 6, 8]) lines.push(line(`${340 + page} | Invented Preprint Server, not peer reviewed`, { page, y: 40 }));
    expect(furnitureOf(lines, 12).size).toBe(0);
  });

  it("does not fold a number into a head that is only numbers", () => {
    // A bare folio is a folio, kept as it was: it is the page's furniture by its shape, not by repeating.
    const lines = Array.from({ length: 12 }, (_, i) => textPage(i + 1)).flat();
    for (let page = 1; page <= 12; page += 1) lines.push(line(`${page}`, { page, y: 40 }));
    const furniture = furnitureOf(lines, 12);
    expect(furniture.size).toBe(1);
    expect(isFurniture(line("12", { page: 12, y: 40 }), furniture)).toBe(true);
  });
});

// The paper end to end: twelve pages, the foot on the first eight (four odd, four even), a ninth page of text without
// it, and three pages of figures only.

function itemOf(str: string, at: Partial<PdfTextItem> = {}): PdfTextItem {
  return { str, height: 10, width: str.length * 4.6, fontName: "body", x: 100, y: 500, ...at };
}

/** Eighteen body lines in six paragraphs of three; the first page opens with a title and a numbered heading. */
function proseItems(page: number): PdfTextItem[] {
  const word = (n: number) => String.fromCharCode(97 + (n % 26)) + String.fromCharCode(97 + Math.floor(n / 26));
  const items: PdfTextItem[] = [];
  let y = page === 1 ? 700 : 760;
  for (let para = 0; para < 6; para += 1) {
    for (let l = 0; l < 3; l += 1) {
      items.push(itemOf(`Row ${word(page)}${word(para * 3 + l)} counts ${l === 2 ? "the tidal pools once more." : "the tidal pools on the shore"}`, { y }));
      y -= l === 2 ? 28 : 14;
    }
  }
  return items;
}

function shorePaper(): PdfPageText[] {
  const pages: PdfPageText[] = [];
  for (let page = 1; page <= 9; page += 1) {
    const items = proseItems(page);
    if (page === 1) items.unshift(itemOf("A Paper About Shore Notes", { height: 17, y: 760 }), itemOf("1 Introduction", { y: 730 }));
    if (page <= 8) items.push(itemOf(page % 2 === 1 ? `${FOOT} | ${340 + page}` : `${340 + page} | ${FOOT}`, { y: 40 }));
    pages.push({ page, items });
  }
  for (let page = 10; page <= 12; page += 1) {
    pages.push({
      page,
      items: [
        itemOf(`Figure ${page - 9}: Counts of the tidal pools by month.`, { y: 300 }),
        ...["0", "20", "40", "60"].map((t, i) => itemOf(t, { y: 700 - i * 10, height: 7 })),
      ],
    });
  }
  return pages;
}

describe("the foot of an invented twelve-page paper whose folio alternates sides is not read as text (P12-97, R-F)", () => {
  const textOf = (pages: PdfPageText[]) => (buildOutline(pages).sections ?? []).map((s) => s.text).join("\n\n");

  it("leaves the foot of every page out of the paragraphs", () => {
    const text = textOf(shorePaper());
    expect(text).not.toContain("Elmstead Journal");
    expect(text).not.toMatch(/\b34\d\b/);
  });

  it("keeps every line of the prose", () => {
    const text = textOf(shorePaper());
    expect(text.match(/Row [a-z]{4} counts/g)).toHaveLength(9 * 18);
  });
});

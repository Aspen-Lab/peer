import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { furnitureOf, joinProse, type PdfLine } from "./pdf-outline";
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

  it("recognizes all four lines of a repeated journal footer", () => {
    const lines = [1, 2, 3, 4].flatMap(bodyLines);
    const footer = ["Volume 15 Issue 10", "Open access journal", "example.org", "Page 1"];
    for (const page of [1, 2, 3, 4]) footer.forEach((text, i) => lines.push(line(text, { page, y: 52 - i * 12 })));
    expect(furnitureOf(lines, 4).size).toBe(4);
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

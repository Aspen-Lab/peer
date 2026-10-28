// P12-64: the page title is the paper's title, not the journal's masthead or a drop-capped line.
//
// Every PDF here is invented: a synthetic page drawn by `minimalPdf` (the way `pdf-text.test.ts` draws its layouts),
// or hand-made text items. Nothing of anyone's own paper is read, copied or quoted.

import { describe, expect, it } from "vitest";
import { minimalPdf, type Run } from "./minimal-pdf.test-helper";
import { buildOutline, linesOfPage, type PdfPageText, type PdfTextItem } from "./pdf-outline";
import { extractPdfTextFromBytes, readPages } from "./pdf-text";

const TITLE_LINES = ["Reversible Sodium Storage in", "Layered Oxide Cathodes Revisited"];
const TITLE = TITLE_LINES.join(" ");

/** Distinct 9 pt sentences, 70 to 80 characters each, so the body is the page's mode size. */
const SENTENCES = [
  "Layered oxides take up sodium ions between their sheets as the cell charges.",
  "Each sheet holds a plane of transition metal atoms in octahedral coordination.",
  "The spacing of the sheets widens when the larger ions enter the interlayer gap.",
  "A cell was cycled at a fixed rate between two voltage limits for many weeks.",
  "Capacity faded slowly, and the loss was traced to a thin film on the surface.",
  "The film grew thicker wherever the electrolyte met the freshly exposed grains.",
  "Coating the grains with a stable oxide slowed the growth of that film a good deal.",
  "We report the capacity, the voltage profile and the impedance after each hundred cycles.",
  "The measurements were repeated on three cells made from separate batches of powder.",
  "Their spread is small compared with the difference between coated and bare grains.",
];

const at = (lines: string[], top: number, x = 72, pitch = 12): Run[] =>
  lines.map((text, i): Run => [text, x, top + i * pitch, 9]);

/** A first page: optional masthead lines, the title (24 pt), authors (12 pt), an abstract and an introduction. */
function firstPage(options: { above?: Run[]; intro?: Run[]; title?: string[] } = {}): Run[] {
  return [
    ...(options.above ?? []),
    ...(options.title ?? TITLE_LINES).map((text, i): Run => [text, 72, 100 + i * 32, 24]),
    ["Alice Quill and Bob Marrow", 72, 172, 12],
    ["Abstract", 72, 206, 11, true],
    ...at(SENTENCES.slice(0, 4), 224),
    ["1 Introduction", 72, 290, 11, true],
    ...(options.intro ?? at(SENTENCES.slice(4, 10), 308)),
  ];
}

/** Other sentences, for a second page: the first page's paragraphs are not repeated on it. */
const LATER = [
  "Electrodes were cast from a slurry of powder, carbon black and a polymer binder.",
  "The coin cells were assembled in an argon glovebox and rested for twelve hours.",
  "Impedance spectra were fitted to an equivalent circuit with two parallel elements.",
  "The charge transfer resistance rose threefold in the bare cells over the same period.",
  "These results agree with the thickening of the surface film seen under the microscope.",
  "We conclude that a stable oxide coating is the simplest way to keep the capacity.",
];

/** A second page of body text, so the paper has a body past its first page. */
const secondPage = (): Run[] => at(LATER, 100);

async function read(pages: Run[][]) {
  return extractPdfTextFromBytes(minimalPdf(pages));
}

const flat = (text: string | undefined): string => (text ?? "").replace(/\s+/g, " ");

describe("rule 1: the title is ranked by the size most of a line's characters are set in", () => {
  it("(c) a normal paper keeps the title it had: the largest lines of its first page, joined", async () => {
    const result = await read([firstPage(), secondPage()]);
    expect(result.ok).toBe(true);
    expect(result.doc?.title).toBe(TITLE);
  });

  it("(b) a 40 pt drop cap on a 9 pt body line does not make that line the title", async () => {
    // The cap stands on the baseline of the third line of the paragraph and is welded to its first word.
    const intro: Run[] = [
      ...at(SENTENCES.slice(4, 6), 308, 100),
      ["T", 72, 332, 40],
      [SENTENCES[6], 96.5, 332, 9],
      ...at(SENTENCES.slice(7, 10), 344),
    ];
    const result = await read([firstPage({ intro }), secondPage()]);
    expect(result.ok).toBe(true);
    expect(result.doc?.title).toBe(TITLE);
  });

  it("(b) a drop cap alone on its baseline is no title either", async () => {
    // The cap hangs between two lines, on a baseline no line shares: a row of one letter, 40 pt.
    const intro: Run[] = [
      ...at(SENTENCES.slice(4, 6), 308, 100),
      ["T", 72, 338, 40],
      ...at(SENTENCES.slice(6, 10), 344, 100),
    ];
    const result = await read([firstPage({ intro }), secondPage()]);
    expect(result.ok).toBe(true);
    expect(result.doc?.title).toBe(TITLE);
  });

  it("a page-1 drop cap keeps the drop-capped paragraph's text whole: the line the cap stands on is not skipped as the title", async () => {
    const intro: Run[] = [
      ...at(SENTENCES.slice(4, 6), 308, 100),
      ["T", 72, 332, 40],
      [SENTENCES[6], 96.5, 332, 9],
      ...at(SENTENCES.slice(7, 10), 344),
    ];
    const result = await read([firstPage({ intro }), secondPage()]);
    const introduction = result.doc?.sections.find((section) => /introduction/i.test(section.heading));
    const text = flat(introduction?.text);
    for (const sentence of SENTENCES.slice(4, 10)) {
      // The cap is welded to its row's first word, so the sentence is checked from its second word on.
      expect(text).toContain(sentence.split(" ").slice(1).join(" "));
    }
  });

  it("gives each line the size most of its characters are set in, and leaves `size` the tallest run's", () => {
    const run = (str: string, height: number, x: number): PdfTextItem => ({
      str,
      height,
      width: str.length * height * 0.5,
      fontName: "f",
      x,
      y: 500,
    });
    const page = (items: PdfTextItem[]): PdfPageText => ({ page: 1, items });
    const [capped] = linesOfPage(page([run("T", 40, 72), run("he words that follow it on its line", 9, 92)]));
    expect(capped.size).toBe(40);
    expect(capped.titleSize).toBe(9);
    // A line set in one size reads that size, as `size` does.
    const [plain] = linesOfPage(page([run("A line of one size", 11.9, 72)]));
    expect(plain.titleSize).toBe(plain.size);
    // A title line with a raised mark in a smaller size is still the title's size.
    const [marked] = linesOfPage(page([run("Layered Oxide Cathodes", 24, 72), run("1", 14, 340)]));
    expect(marked.size).toBe(24);
    expect(marked.titleSize).toBe(24);
    // Sizes within 0.6 pt of each other weigh together: a face that sets 0.4 pt apart is one size.
    const [two] = linesOfPage(page([run("seven", 9, 72), run("eight", 9.4, 120), run("t", 12, 160)]));
    expect(two.titleSize).toBeCloseTo(9.2, 1);
    // The tie goes to the larger size.
    const [tie] = linesOfPage(page([run("ab", 24, 72), run("cd", 12, 120)]));
    expect(tie.titleSize).toBe(24);
  });

  it("rule 3: the outline's sections do not change with the title's size", () => {
    // The same page read with and without the cap's oversized letter: the section headings are the same.
    const pages = async (cap: boolean) => {
      const intro: Run[] = cap
        ? [...at(SENTENCES.slice(4, 6), 308, 100), ["T", 72, 332, 40], [SENTENCES[6], 96.5, 332, 9], ...at(SENTENCES.slice(7, 10), 344)]
        : at(SENTENCES.slice(4, 10), 308);
      return readPages(minimalPdf([firstPage({ intro }), secondPage()]));
    };
    return Promise.all([pages(true), pages(false)]).then(([withCap, without]) => {
      const headings = (p: PdfPageText[]) => (buildOutline(p).sections ?? []).map((section) => section.heading);
      expect(headings(withCap)).toEqual(headings(without));
    });
  });
});

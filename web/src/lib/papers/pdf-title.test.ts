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

async function read(pages: Run[][], meta?: { info?: string; xmp?: string }) {
  const pdf = minimalPdf(pages);
  return extractPdfTextFromBytes(meta ? withMetadata(pdf, meta) : pdf);
}

/** A PDF string: UTF-16 with its byte-order mark, in hex, the way an authoring tool writes a title. */
const pdfString = (text: string): string => `<FEFF${Buffer.from(text, "utf16le").swap16().toString("hex")}>`;

const xmpPacket = (title: string): string =>
  `<?xpacket begin="" id="W5M0MpCehiHzreSzNTczkc9d"?>\n` +
  `<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">` +
  `<rdf:Description rdf:about="" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title><rdf:Alt>` +
  `<rdf:li xml:lang="x-default">${title.replace(/&/g, "&amp;").replace(/</g, "&lt;")}</rdf:li>` +
  `</rdf:Alt></dc:title></rdf:Description></rdf:RDF></x:xmpmeta>\n<?xpacket end="w"?>`;

/**
 * The PDF with an Info title and / or an XMP title added by an incremental update: new objects after the old file,
 * a new cross-reference section, and a trailer that points back at the old one. What `minimalPdf` leaves out.
 */
function withMetadata(pdf: Buffer, meta: { info?: string; xmp?: string }): Buffer {
  let out = pdf.toString("latin1");
  const trailer = /\/Size (\d+) \/Root (\d+) 0 R/.exec(out)!;
  const root = Number(trailer[2]);
  const previous = Number(/startxref\n(\d+)/.exec(out)![1]);
  const pagesRef = /\/Pages (\d+) 0 R/.exec(out.slice(out.indexOf(`\n${root} 0 obj`)))![1];
  const added: [number, number][] = [];
  let next = Number(trailer[1]);
  const add = (num: number, body: string) => {
    added.push([num, Buffer.byteLength(out, "latin1")]);
    out += `${num} 0 obj\n${body}\nendobj\n`;
  };
  let infoRef = "";
  if (meta.info !== undefined) {
    add(next, `<< /Title ${pdfString(meta.info)} >>`);
    infoRef = ` /Info ${next++} 0 R`;
  }
  if (meta.xmp !== undefined) {
    const packet = xmpPacket(meta.xmp);
    add(next, `<< /Type /Metadata /Subtype /XML /Length ${Buffer.byteLength(packet, "latin1")} >>\nstream\n${packet}\nendstream`);
    add(root, `<< /Type /Catalog /Pages ${pagesRef} 0 R /Metadata ${next++} 0 R >>`);
  }
  const xref = Buffer.byteLength(out, "latin1");
  out += `xref\n${added.map(([num, at]) => `${num} 1\n${String(at).padStart(10, "0")} 00000 n \n`).join("")}`;
  out += `trailer\n<< /Size ${next} /Root ${root} 0 R${infoRef} /Prev ${previous} >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, "latin1");
}

const JOURNAL = "Journal of Applied Cathodes";

/** A masthead set larger than the title, above it. */
const MASTHEAD: Run[] = [[JOURNAL, 72, 50, 30]];

/** The second and third pages, each with the journal's running head at the top. */
const pagesWithHeads = (): Run[][] => [
  [[`${JOURNAL} 12 (2024) 100-110`, 72, 40, 8], ...at(LATER, 100)],
  [[`${JOURNAL} 12 (2024) 100-110`, 72, 40, 8], ...at(SENTENCES.slice(0, 6), 100)],
];

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

describe("rule 2: the PDF's embedded title is a witness to choose the first page's title by", () => {
  it("reads the Info title and the XMP title of an invented PDF, on the first page, and nothing when there is none", async () => {
    const pdf = minimalPdf([firstPage(), secondPage()]);
    expect((await readPages(pdf))[0].embeddedTitles).toBeUndefined();
    expect((await readPages(withMetadata(pdf, { info: "An Info Title Of Four Words" })))[0].embeddedTitles).toEqual([
      "An Info Title Of Four Words",
    ]);
    expect((await readPages(withMetadata(pdf, { xmp: "An XMP Title & Its Words" })))[0].embeddedTitles).toEqual(["An XMP Title & Its Words"]);
    const both = await readPages(withMetadata(pdf, { info: "The Info One Here", xmp: "The XMP One Here" }));
    expect(both[0].embeddedTitles).toEqual(["The Info One Here", "The XMP One Here"]);
    expect(both[1].embeddedTitles).toBeUndefined();
  });

  it("(a) a masthead set larger than the title, with the title embedded: the title, not the masthead", async () => {
    const pages = [firstPage({ above: MASTHEAD }), secondPage()];
    const result = await read(pages, { info: TITLE });
    expect(result.ok).toBe(true);
    expect(result.doc?.title).toBe(TITLE);
    // The same page with no embedded title reads the masthead: it is three words, larger, and no head repeats it.
    expect((await read(pages)).doc?.title).toBe(JOURNAL);
  });

  it("(a) reads the XMP title as well as the Info title, and whichever of them is the paper's", async () => {
    const pages = [firstPage({ above: MASTHEAD }), secondPage()];
    expect((await read(pages, { xmp: TITLE })).doc?.title).toBe(TITLE);
    // The Info field holds a file name, which is no witness; the XMP holds the title.
    expect((await read(pages, { info: "Microsoft Word - draft_v3.docx", xmp: TITLE })).doc?.title).toBe(TITLE);
  });

  it("outputs the page's own text, not the embedded string", async () => {
    const pages = [firstPage({ above: MASTHEAD }), secondPage()];
    const result = await read(pages, { info: `${TITLE.toUpperCase()}.` });
    expect(result.doc?.title).toBe(TITLE);
  });

  it("an embedded title that is the journal's name does not choose the masthead", async () => {
    // The journal's name is on every later page's running head: it is a masthead, and the witness that names it is ignored.
    const pages = [firstPage({ above: MASTHEAD }), ...pagesWithHeads()];
    expect((await read(pages, { info: `${JOURNAL} Letters` })).doc?.title).toBe(TITLE);
    expect((await read(pages, { info: `${JOURNAL} 2024` })).doc?.title).toBe(TITLE);
  });

  it("an embedded title that holds the paper's title and the journal's name still chooses the paper's title", async () => {
    const pages = [firstPage({ above: MASTHEAD }), secondPage()];
    // Both classes are inside it; the title has the most words in it.
    expect((await read(pages, { info: `${TITLE} - ${JOURNAL}` })).doc?.title).toBe(TITLE);
  });

  it("is no witness when it is a file name, a stamp, or too long, whatever words it holds", async () => {
    const pages = [firstPage({ above: MASTHEAD }), secondPage()];
    const witnesses = [
      `${TITLE.replace(/ /g, "_")}.pdf`,
      `Microsoft Word - ${TITLE}`,
      `${TITLE} - final copy.docx`,
      `arXiv:2401.12345v2 ${TITLE}`,
      `${TITLE} `.repeat(6),
    ];
    for (const info of witnesses) expect((await read(pages, { info })).doc?.title, info).toBe(JOURNAL);
    // The same words as a title are a witness.
    expect((await read(pages, { info: TITLE })).doc?.title).toBe(TITLE);
  });

  it("is no witness under three words, nor when nothing on the page is in it", async () => {
    const short = [firstPage({ above: MASTHEAD, title: ["Sodium Cathodes"] }), secondPage()];
    expect((await read(short, { info: "Sodium Cathodes" })).doc?.title).toBe(JOURNAL);
    expect((await read(short, { info: "Sodium Cathodes Revisited" })).doc?.title).toBe("Sodium Cathodes");
    const pages = [firstPage({ above: MASTHEAD }), secondPage()];
    expect((await read(pages, { info: "A Quite Different Study Of Goats" })).doc?.title).toBe(JOURNAL);
  });

  it("a witness leaves out a line of the title's size that is not in it: an article-type label", async () => {
    const above: Run[] = [["RESEARCH ARTICLE", 72, 60, 24]];
    const pages = [firstPage({ above }), secondPage()];
    expect((await read(pages, { info: TITLE })).doc?.title).toBe(TITLE);
    // With no witness the class is read whole, as it always was.
    expect((await read(pages)).doc?.title).toBe(`RESEARCH ARTICLE ${TITLE}`);
  });

  it("(c) a normal paper is unchanged by its own embedded title", async () => {
    const pages = [firstPage(), secondPage()];
    expect((await read(pages)).doc?.title).toBe(TITLE);
    expect((await read(pages, { info: TITLE, xmp: TITLE })).doc?.title).toBe(TITLE);
  });
});

describe("rule 2: with no embedded title, the largest class that is not a masthead", () => {
  it("(d) a masthead of fewer than three words above the title is a name, not the title", async () => {
    const pages = [firstPage({ above: [["Applied Cathodes", 72, 50, 30]] }), secondPage()];
    expect((await read(pages)).doc?.title).toBe(TITLE);
  });

  it("(d) a masthead the running heads repeat is a masthead, whatever its words", async () => {
    const pages = [firstPage({ above: MASTHEAD }), ...pagesWithHeads()];
    expect((await read(pages)).doc?.title).toBe(TITLE);
  });

  it("(d) the limit: a masthead of three words that no running head repeats, with no embedded title, is read as the title", async () => {
    // What cannot be told from a title without a witness. Pinned so the choice is a deliberate one.
    expect((await read([firstPage({ above: MASTHEAD }), secondPage()])).doc?.title).toBe(JOURNAL);
  });

  it("a short title is not taken for a masthead: the authors under it are set much smaller", async () => {
    const result = await read([firstPage({ title: ["Sodium Cathodes"] }), secondPage()]);
    expect(result.doc?.title).toBe("Sodium Cathodes");
  });

  it("a title the running heads repeat is not taken for a masthead when only the authors stand below it", async () => {
    const heads: Run[][] = [
      [["Reversible Sodium Storage in Layered Oxide Cathodes Revisited", 72, 40, 8], ...at(LATER, 100)],
      [["Reversible Sodium Storage in Layered Oxide Cathodes Revisited", 72, 40, 8], ...at(SENTENCES.slice(0, 6), 100)],
    ];
    expect((await read([firstPage(), ...heads])).doc?.title).toBe(TITLE);
  });
});

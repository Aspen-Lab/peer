import { afterEach, describe, expect, it, vi } from "vitest";
import { CASE_MIN_HITS, CASE_MIN_LETTERS, learnCaseFonts, withPageCase } from "./case-repair";
import { minimalPdf, prose, type Run } from "./minimal-pdf.test-helper";
import type { PdfPageText } from "./pdf-outline";
import { extractPdfTextFromBytes, readPages, tryExtractPdfText } from "./pdf-text";

// P12-83 (§1h.463, B P12-80 K2, R2-C): a font whose own map turns capital letters into lowercase ones is read as
// capitals again, from the paper's own evidence. Every paper below is invented; the shapes are the ones the symptom
// showed ("s" + "E", "l" + "CO", "DF" + "t", "l" + "YC", "ss" + "Bs", "l" + "i-").

type Item = PdfPageText["items"][number];

const SIZE = 8;
/** Every glyph of the invented fonts is this wide: 0.6 em. */
const GLYPH = 0.6 * SIZE;
/** A word space on the page, 0.3 em. */
const SPACE = 0.3 * SIZE;

const BOLD = "g_d0_f8"; // the font whose map is damaged, where a test says so
const BODY = "g_d0_f3";
const OTHER = "g_d0_f9";

/**
 * One row of items on a baseline, left to right. Each part is an item that touches the one before it (`overlap` pt of
 * it drawn over the previous item's edge, as kerning does); a part that is a single space is a word space, not an item.
 */
function row(font: string, y: number, parts: readonly string[], overlap = 0, x0 = 72): Item[] {
  const items: Item[] = [];
  let x = x0;
  let touching = false;
  for (const part of parts) {
    if (part === " ") {
      x += SPACE;
      touching = false;
      continue;
    }
    if (touching) x -= overlap;
    const width = part.length * GLYPH;
    items.push({ str: part, height: SIZE, width, fontName: font, x, y });
    x += width;
    touching = true;
  }
  return items;
}

const page = (n: number, ...rows: Item[][]): PdfPageText => ({ page: n, items: rows.flat() });
const strs = (pages: readonly PdfPageText[]) => pages.map((p) => p.items.map((item) => item.str));

/** The four hits B found on the invented paper: s, l, t, l, over three letters, in `font`. */
function hitRows(font: string, y = 700): Item[][] {
  return [
    row(font, y, ["s", "E"]),
    row(font, y - 20, ["l", "CO"]),
    row(font, y - 40, ["DF", "t"]),
    row(font, y - 60, ["l", "YC"]),
  ];
}

describe("withPageCase — a font whose own map lowercases capitals is repaired from the document's evidence (P12-83)", () => {
  it("reads sE, lCO, DFt and lYC as SE, LCO, DFT and LYC when one font shows them three or more times", () => {
    const before = [page(1, ...hitRows(BOLD))];
    const after = withPageCase(before);
    expect(strs(before)).toEqual([["s", "E", "l", "CO", "DF", "t", "l", "YC"]]);
    expect(strs(after)).toEqual([["S", "E", "L", "CO", "DF", "T", "L", "YC"]]);
  });

  it("reads a two-letter run too (ss + Bs is SS + Bs), and leaves the capital-led item beside it exactly as it is", () => {
    const pages = [page(1, ...hitRows(BOLD), row(BOLD, 600, ["ss", "Bs"]))];
    const out = withPageCase(pages);
    expect(out[0]?.items.slice(-2).map((item) => item.str)).toEqual(["SS", "Bs"]);
    expect(out[0]?.items[out[0].items.length - 1]).toBe(pages[0]?.items[pages[0].items.length - 1]);
  });

  it("reads the first letter of a word that stands alone before a lowercase item (l + i- is Li-)", () => {
    const pages = [page(1, ...hitRows(BOLD), row(BOLD, 600, ["l", "i-"]), row(BOLD, 580, ["l", "i-ion"]))];
    const out = withPageCase(pages);
    expect(out[0]?.items.slice(-4).map((item) => item.str)).toEqual(["L", "i-", "L", "i-ion"]);
  });

  it("collects the evidence across the whole document: one hit on each of three pages is three hits", () => {
    const pages = [
      page(1, row(BOLD, 700, ["s", "E"]), row(BODY, 680, ["Some body text"])),
      page(2, row(BOLD, 700, ["l", "CO"])),
      page(3, row(BOLD, 700, ["DF", "t"])),
    ];
    expect(strs(withPageCase(pages))).toEqual([["S", "E", "Some body text"], ["L", "CO"], ["DF", "T"]]);
  });

  it("repairs a hit on a page of its own, once the document has shown the font three times elsewhere", () => {
    const pages = [page(1, ...hitRows(BOLD)), page(2, row(BOLD, 700, ["l", "YC"]), row(BODY, 680, ["Unrelated text"]))];
    const out = withPageCase(pages);
    expect(strs(out)[1]).toEqual(["L", "YC", "Unrelated text"]);
  });

  it("reads a lowercase run that continues an acronym (XRD + s is XRDS) in a font that has shown the letter", () => {
    const out = withPageCase([page(1, ...hitRows(BOLD), row(BOLD, 600, ["XRD", "s"]))]);
    expect(out[0]?.items.slice(-2).map((item) => item.str)).toEqual(["XRD", "S"]);
  });

  it("changes nothing else: every other item is the same object, a page without a change is the same page", () => {
    const body = row(BODY, 400, ["Plain body text that happens to be here"]);
    const other = row(OTHER, 380, ["p", "H"]);
    const pages = [page(1, ...hitRows(BOLD), body, other), page(2, row(BODY, 700, ["Only body text"]))];
    const out = withPageCase(pages);
    expect(out[1]).toBe(pages[1]);
    const kept = out[0]?.items.filter((item, i) => item === pages[0]?.items[i]) ?? [];
    expect(kept.map((item) => item.str)).toEqual(["E", "CO", "DF", "YC", "Plain body text that happens to be here", "p", "H"]);
    // the repaired items carry the geometry they had
    const repaired = out[0]?.items[0];
    expect(repaired).toEqual({ ...pages[0]?.items[0], str: "S" });
  });

  it("returns the very same array when nothing is learned", () => {
    const pages = [page(1, row(BODY, 700, ["Ordinary text"]), row(BODY, 680, ["p", "H"]), row(BODY, 660, ["e", "V"]))];
    expect(withPageCase(pages)).toBe(pages);
    const empty: PdfPageText[] = [];
    expect(withPageCase(empty)).toBe(empty);
    expect(withPageCase([page(1)])).toHaveLength(1);
  });

  it("does not change its input, is deterministic, and repairs nothing twice", () => {
    const pages = [page(1, ...hitRows(BOLD), row(BOLD, 600, ["l", "i-"]))];
    const frozen = structuredClone(pages);
    for (const p of pages) {
      for (const item of p.items) Object.freeze(item);
      Object.freeze(p.items);
      Object.freeze(p);
    }
    Object.freeze(pages);
    const once = withPageCase(pages);
    expect(pages).toEqual(frozen);
    expect(withPageCase(pages)).toEqual(once);
    expect(withPageCase(once)).toBe(once);
  });
});

describe("withPageCase — what stays as it is (P12-83)", () => {
  // Units and names that begin in lowercase and carry a capital: set as split items they have the shape of a hit.
  const UNITS: ReadonlyArray<readonly string[]> = [["p", "H"], ["e", "V"], ["m", "M"], ["k", "Da"], ["i", "Phone"], ["m", "Ah"]];

  it.each(UNITS)("leaves %s + %s alone: one hit is no evidence", (small, big) => {
    const pages = [page(1, row(BODY, 700, ["A reading of "]), row(OTHER, 680, [small as string, big as string]))];
    expect(withPageCase(pages)).toBe(pages);
  });

  it("leaves a body font that sets its units as split items alone: it prints the capitals those letters would be", () => {
    // pH, eV, mM, kDa, iPhone, mAh in one font, among words that print P, E, M, K, I, A and H as capitals.
    const pages = [
      page(
        1,
        ...UNITS.map(([small, big], i) => row(BODY, 700 - i * 20, [small as string, big as string])),
        row(BODY, 560, ["Peer Experiment Methods Kinetics In Analysis Hydrogen"]),
      ),
    ];
    expect(learnCaseFonts(pages).size).toBe(0);
    expect(withPageCase(pages)).toBe(pages);
  });

  it("wants three hits: two are left alone", () => {
    const pages = [page(1, row(BOLD, 700, ["s", "E"]), row(BOLD, 680, ["l", "CO"]))];
    expect(CASE_MIN_HITS).toBe(3);
    expect(withPageCase(pages)).toBe(pages);
  });

  it("wants two different letters: three hits in one letter are left alone", () => {
    const pages = [page(1, row(BOLD, 700, ["s", "E"]), row(BOLD, 680, ["s", "CO"]), row(BOLD, 660, ["ss", "Bs"]), row(BOLD, 640, ["s", "YC"]))];
    expect(CASE_MIN_LETTERS).toBe(2);
    expect(learnCaseFonts(pages).size).toBe(0);
    expect(withPageCase(pages)).toBe(pages);
  });

  it("counts the hits of each font by itself: two in one font and two in another are not four", () => {
    const pages = [
      page(1, row(BOLD, 700, ["s", "E"]), row(BOLD, 680, ["l", "CO"]), row(OTHER, 660, ["DF", "t"]), row(OTHER, 640, ["l", "YC"])),
    ];
    expect(withPageCase(pages)).toBe(pages);
  });

  it("leaves the same shapes alone in another font, while the font that shows them is repaired", () => {
    const pages = [page(1, ...hitRows(BOLD), row(OTHER, 500, ["s", "E"]), row(OTHER, 480, ["l", "CO"]), row(OTHER, 460, ["l", "i-"]))];
    const out = withPageCase(pages);
    expect(out[0]?.items.slice(0, 8).map((item) => item.str)).toEqual(["S", "E", "L", "CO", "DF", "T", "L", "YC"]);
    expect(out[0]?.items.slice(8)).toEqual(pages[0]?.items.slice(8));
    out[0]?.items.slice(8).forEach((item, i) => expect(item).toBe(pages[0]?.items[8 + i]));
  });

  it("leaves the first letter of a word alone when it is not a letter the font has shown", () => {
    const pages = [page(1, ...hitRows(BOLD), row(BOLD, 600, ["q", "ui"]), row(BOLD, 580, ["j", "ob"]))];
    expect(learnCaseFonts(pages).get(BOLD)).toEqual(new Set(["s", "l", "t"]));
    expect(withPageCase(pages)[0]?.items.slice(-4).map((item) => item.str)).toEqual(["q", "ui", "j", "ob"]);
  });

  it("does not read as damaged a letter that its font also prints as a capital", () => {
    // A font that prints a capital S is not one whose capital S reads as "s": that letter is out; the hits of l and t stay.
    const withS = [page(1, ...hitRows(BOLD), row(BOLD, 600, ["Sample"]))];
    expect(learnCaseFonts(withS).get(BOLD)).toEqual(new Set(["l", "t"]));
    expect(withPageCase(withS)[0]?.items.slice(0, 8).map((item) => item.str)).toEqual(["s", "E", "L", "CO", "DF", "T", "L", "YC"]);
    // …and when that leaves fewer than three hits, the font is not read as damaged at all.
    const withL = [page(1, ...hitRows(BOLD), row(BOLD, 600, ["Layer"]))];
    expect(learnCaseFonts(withL).size).toBe(0);
    expect(withPageCase(withL)).toBe(withL);
  });

  it("does not take a lowercase run inside a lowercase word", () => {
    // "wa" + "s" + "E": the "s" belongs to the word before it.
    const out = withPageCase([page(1, ...hitRows(BOLD), row(BOLD, 600, ["wa", "s", "E"]))]);
    expect(out[0]?.items.slice(-3).map((item) => item.str)).toEqual(["wa", "s", "E"]);
  });

  it("does not take a run after capitals that goes on in lowercase (DF + t + ext)", () => {
    const out = withPageCase([page(1, ...hitRows(BOLD), row(BOLD, 600, ["DF", "t", "ext"]))]);
    expect(out[0]?.items.slice(-3).map((item) => item.str)).toEqual(["DF", "t", "ext"]);
  });

  it("does not take a run after a single capital: T + o, W + e, I + s are words", () => {
    const pages = [page(1, row(BOLD, 700, ["T", "o"]), row(BOLD, 680, ["W", "e"]), row(BOLD, 660, ["I", "s"]), row(BOLD, 640, ["A", "t"]))];
    expect(learnCaseFonts(pages).size).toBe(0);
    expect(withPageCase(pages)).toBe(pages);
  });

  it("does not take a run set apart by a word space, and does not count it", () => {
    const apart = (y: number, a: string, b: string) => row(BOLD, y, [a, " ", b]);
    const pages = [page(1, row(BOLD, 700, ["s", "E"]), row(BOLD, 680, ["l", "CO"]), apart(660, "t", "YC"), apart(640, "l", "DF"))];
    expect(learnCaseFonts(pages).size).toBe(0);
    expect(withPageCase(pages)).toBe(pages);
    const withThree = [page(1, ...hitRows(BOLD), apart(600, "s", "BB"))];
    expect(withPageCase(withThree)[0]?.items.slice(-2).map((item) => item.str)).toEqual(["s", "BB"]);
  });

  it("reads touching as the outline does: a gap under a word space is touching, a kerning overlap is touching, more is not", () => {
    const hit = (overlap: number) => withPageCase([page(1, ...hitRows(BOLD), row(BOLD, 600, ["s", "E"], overlap))])[0]?.items.slice(-2)[0]?.str;
    expect(hit(0)).toBe("S");
    expect(hit(1.5)).toBe("S"); // a glyph drawn 1.5 pt over its neighbour's edge, as in "l" + "YC"
    expect(hit(-1)).toBe("S"); // a 1 pt gap is under the outline's own space threshold
    expect(hit(3)).toBe("s"); // 3 pt over the edge is another item altogether
    expect(hit(-2.4)).toBe("s"); // a 2.4 pt gap is a word space
  });

  it("does not take a run on another baseline, an item with no width, or a run of three letters", () => {
    const raised = row(BOLD, 600, ["s", "E"]).map((item, i) => (i === 0 ? { ...item, y: item.y + 3 } : item));
    const noWidth = row(BOLD, 580, ["l", "CO"]).map((item, i) => (i === 0 ? { ...item, width: 0 } : item));
    const three = row(BOLD, 560, ["ssl", "CO"]);
    const out = withPageCase([page(1, ...hitRows(BOLD), raised, noWidth, three)]);
    expect(out[0]?.items.slice(-6).map((item) => item.str)).toEqual(["s", "E", "l", "CO", "ssl", "CO"]);
  });

  it("does not take the first letter of a word that has a letter touching it, one set apart, or two letters", () => {
    const out = withPageCase([
      page(
        1,
        ...hitRows(BOLD),
        row(BOLD, 600, ["a", "l", "i-"]), // the "l" ends a word that began with "a"
        row(BOLD, 580, ["l", " ", "i-"]), // set apart: a word of its own
        row(BOLD, 560, ["ss", "ent"]), // two letters are not the first letter of a word
      ),
    ]);
    expect(out[0]?.items.slice(-7).map((item) => item.str)).toEqual(["a", "l", "i-", "l", "i-", "ss", "ent"]);
  });

  it("leaves punctuation, digits and letters beyond ASCII alone", () => {
    const out = withPageCase([page(1, ...hitRows(BOLD), row(BOLD, 600, ["é", "CO"]), row(BOLD, 580, ["1", "CO"]), row(BOLD, 560, [".", "CO"]))]);
    expect(out[0]?.items.slice(-6).map((item) => item.str)).toEqual(["é", "CO", "1", "CO", ".", "CO"]);
  });
});

// ── the whole path: a PDF whose bold font maps S, L, T, I, U to lowercase letters ──────────────────────────────

/** The capitals the invented bold font's own map turns into lowercase letters. */
const DAMAGED = "SLTIU";
/** Items of the bold font touch with this much of the next glyph drawn over the last one's edge: more than pdf.js's own
 *  0.2 em, which is what makes it start a new item there, as the real file's did. */
const OVERLAP = 1.7;
/** A word space of the invented bold face, in ems: wider than the 0.6 em pdf.js reads as a space inside one item, so a
 *  damaged capital that opens a word is an item of its own, behind a white-space item, as in the real file. */
const WORD_GAP = 0.7;

/**
 * A real PDF, built in the test, read by pdf.js as the owner's papers are. The bold face (F2) is drawn glyph run by glyph
 * run: a run of the damaged capitals is a text object of its own, touching the run beside it. When `damaged`, the face's
 * ToUnicode map is written with the lowercase letters for those capitals' codes, and nothing else differs: the same
 * file with the face's map right is the control.
 */
function damagedPdf(pages: Run[][], damaged: boolean): Buffer {
  const cmapLines = [...DAMAGED].map(
    (c) => `<${c.charCodeAt(0).toString(16).padStart(2, "0")}> <${c.toLowerCase().charCodeAt(0).toString(16).padStart(4, "0")}>`,
  );
  const cmap =
    "/CIDInit /ProcSet findresource begin 12 dict begin begincmap /CMapName /Adobe-Identity-UCS def /CMapType 2 def " +
    `1 begincodespacerange <00> <FF> endcodespacerange ${cmapLines.length} beginbfchar ${cmapLines.join(" ")} endbfchar ` +
    "endcmap CMapName currentdict /CMap defineresource pop end end";
  const widths = Array.from({ length: 95 }, (_, i) => (i + 32 === 32 ? 300 : 600)).join(" ");
  const objects: string[] = [];
  const add = (body: string) => objects.push(body);
  add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>");
  add(
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding " +
      `/FirstChar 32 /LastChar 126 /Widths [${widths}]${damaged ? " /ToUnicode 4 0 R" : ""} >>`,
  );
  const pagesId = add("");
  add(`<< /Length ${cmap.length} >>\nstream\n${cmap}\nendstream`);
  const escape = (s: string) => s.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
  /** A bold run as text objects: words apart by a word space, each word cut where a damaged capital begins or ends. */
  const boldRun = (text: string, x0: number, y: number, size: number): string[] => {
    const ops: string[] = [];
    let x = x0;
    for (const [w, word] of text.split(" ").entries()) {
      if (w > 0) x += WORD_GAP * size;
      const cuts = word.match(new RegExp(`[${DAMAGED}]+|[^${DAMAGED}]+`, "g")) ?? [];
      cuts.forEach((cut, c) => {
        if (c > 0) x -= (OVERLAP * size) / SIZE;
        ops.push(`BT /F2 ${size} Tf ${x} ${y} Td (${escape(cut)}) Tj ET`);
        x += cut.length * 0.6 * size;
      });
    }
    return ops;
  };
  const kids: number[] = [];
  for (const runs of pages) {
    const ops = runs.flatMap(([text, x, top, size, bold]) =>
      bold ? boldRun(text, x, 842 - top, size) : [`BT /F1 ${size} Tf ${x} ${842 - top} Td (${escape(text)}) Tj ET`],
    );
    const stream = ops.join("\n");
    const contents = add(`<< /Length ${Buffer.byteLength(stream, "latin1")} >>\nstream\n${stream}\nendstream`);
    kids.push(
      add(
        `<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 595 842] ` +
          `/Resources << /Font << /F1 1 0 R /F2 2 0 R >> >> /Contents ${contents} 0 R >>`,
      ),
    );
  }
  objects[pagesId - 1] = `<< /Type /Pages /Kids [${kids.map((k) => `${k} 0 R`).join(" ")}] /Count ${kids.length} >>`;
  const catalog = add(`<< /Type /Catalog /Pages ${pagesId} 0 R >>`);
  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((body, i) => {
    offsets.push(Buffer.byteLength(out, "latin1"));
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = Buffer.byteLength(out, "latin1");
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  out += offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("");
  out += `trailer\n<< /Size ${objects.length + 1} /Root ${catalog} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, "latin1");
}

const CAPTION = "Figure 1: SEM and LCO images of Li-ion cells, and the DFT map.";
const PAPER: Run[][] = [
  [
    ["Invented Cathode Study", 72, 80, 18],
    ["Abstract", 72, 130, 14],
    ...prose(
      [
        "We study how an invented cathode ages over two hundred cycles of charge.",
        "The first survey was kept short, and the notes explain why it was.",
      ],
      150,
    ),
    ["1 Introduction", 72, 210, 11],
    ...prose(
      [
        "Every cell in this paper was built by hand and read the same way each day.",
        "A cell has a life, and the life is easy to see at the end of the test.",
      ],
      230,
    ),
  ],
  [
    ["2 Methods", 72, 80, 11],
    ...prose(["We took the cells to be alike, and the wear of the cases to be small."], 100),
    ["3 SEM Results", 72, 160, 11, true],
    ...prose(["The effect was clear at the edges, where the film came away more slowly."], 180),
    [CAPTION, 72, 250, 9, true],
  ],
];

describe("extractPdfTextFromBytes — the capitals a font's map reads as lowercase are read as capitals (P12-83)", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("reads the damaged PDF the way pdf.js gives it, and the document the way the same file with a right map reads", async () => {
    const damaged = damagedPdf(PAPER, true);
    const control = damagedPdf(PAPER, false);

    // the precondition: pdf.js hands over the lowercase letters, in items of their own, as it does for the owner's papers
    const raw = (await readPages(damaged)).flatMap((p) => p.items.map((item) => item.str));
    expect(raw).toEqual(expect.arrayContaining(["s", "EM", "l", "CO", "DF", "t", "l", "i-ion"]));
    const rawControl = (await readPages(control)).flatMap((p) => p.items.map((item) => item.str));
    expect(rawControl).toEqual(expect.arrayContaining(["S", "EM", "L", "CO", "DF", "T", "L", "i-ion"]));

    const result = await extractPdfTextFromBytes(damaged);
    const expected = await extractPdfTextFromBytes(control);
    expect(expected.ok).toBe(true);
    expect(result.ok).toBe(true);
    // the heading, the map and the caption read as the PDF with the right map reads
    expect(result.doc).toEqual(expected.doc);
    expect(result.page1Text).toEqual(expected.page1Text);
    const all = JSON.stringify(result.doc);
    expect(all).toContain("SEM Results");
    expect(all).toContain(CAPTION.replace("Figure 1: ", ""));
    expect(all).not.toMatch(/\bsEM\b|\blCO\b|DFt\b/);
  });

  it("reads a PDF fetched from a link the same way (tryExtractPdfText)", async () => {
    const control = await extractPdfTextFromBytes(damagedPdf(PAPER, false));
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(new Uint8Array(damagedPdf(PAPER, true)), { status: 200, headers: { "content-type": "application/pdf" } })),
    );
    const result = await tryExtractPdfText("https://example.org/p12-83-damaged-case.pdf");
    expect(result.ok).toBe(true);
    expect(result.doc).toEqual(control.doc);
    expect(JSON.stringify(result.doc)).toContain("SEM Results");
  });

  it("reads a PDF with no such font exactly as before", async () => {
    const bytes = minimalPdf(
      PAPER.map((runs) => runs.map(([text, x, top, size, bold]): Run => [text, x, top, size, bold])).map((runs, n) =>
        n === 1 ? [...runs, ...prose(["The pools were read for pH, for eV and for mM, and the mass in kDa."], 300)] : runs,
      ),
    );
    const pages = await readPages(bytes);
    expect(withPageCase(pages)).toBe(pages);
    const result = await extractPdfTextFromBytes(bytes);
    expect(result.ok).toBe(true);
    expect(result.doc?.sections.map((section) => section.text).join("\n")).toContain("read for pH, for eV and for mM, and the mass in kDa");
    expect(JSON.stringify(result.doc)).toContain("SEM Results");
  });
});

// P12-61 (§1h.434, part 2) — `cutPdfPage`: one page of a PDF as a PDF of its own, so a later look at a figure on
// that page opens a file of kilobytes. The figure the engine finds in the page file is the figure it finds on that
// page of the whole file (the same PNG, caption and box); a layer the whole PDF hides by default stays hidden
// (`graftPage` alone loses `/OCProperties`: the control below shows the hazard on the same fixture); rotation and
// crop inherited from the page tree survive; and what cannot be cut safely comes back null. Every PDF here is
// invented; the owner's papers are never read.

import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { barChart, bodyText, figurePdf, panel, type FigurePage } from "./figure-pdf.test-helper";
import { cutPdfPage, extractPdfFigures } from "./pdf-engine";

const dir = mkdtempSync(path.join(tmpdir(), "peer-cut-page-test-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const prose = bodyText(["Synthetic body text, one line.", "Synthetic body text, a second line."], 80);
const PAGES: FigurePage[] = [
  { text: prose },
  {
    text: [
      ["Figure 3. The wide panel of a two-figure page.", 100, 262, 9],
      ["Figure 4. The narrow panel of a two-figure page.", 100, 492, 9],
    ],
    shapes: [...panel(100, 80, 370, 160), ...panel(100, 330, 250, 140)],
  },
  { text: [...prose, ["Figure 5. A synthetic vector bar chart.", 72, 440, 9]], shapes: barChart(110, 250) },
  { shapes: [{ kind: "image", x: 100, top: 100, w: 200, h: 200 }], text: [["Figure 6. A synthetic raster drawn into a box.", 72, 320, 9]] },
];
const WHOLE = figurePdf(PAGES);

const fingerprint = (figure: { png: Uint8Array; caption: string; box?: number[]; kind: string; width: number; height: number }) => ({
  png: Buffer.from(figure.png).toString("base64"),
  caption: figure.caption,
  box: figure.box,
  kind: figure.kind,
  size: `${figure.width}x${figure.height}`,
});

const FIGURES_BY_PAGE: [page: number, label: string][] = [[2, "Figure 3"], [2, "Figure 4"], [3, "Figure 5"], [4, "Figure 6"]];

describe("cutPdfPage — a page file made from an invented PDF (P12-61)", () => {
  it("is a PDF of exactly one page, and holds the figure the whole PDF holds on that page: the same PNG, caption and box", async () => {
    for (const [page, label] of FIGURES_BY_PAGE) {
      const cut = await cutPdfPage(WHOLE, page);
      expect(cut, `page ${page}`).not.toBeNull();
      expect(Buffer.from(cut!.subarray(0, 5)).toString("latin1")).toBe("%PDF-");

      const onePage = await extractPdfFigures(cut!, { maxPages: 24, maxFigures: 12 });
      expect(onePage.figures.length).toBeGreaterThan(0);
      expect(onePage.figures.every((figure) => figure.page === 1)).toBe(true);
      const fromCut = await extractPdfFigures(cut!, { maxPages: 1, maxFigures: 1, onlyPage: 1, label });
      const fromWhole = await extractPdfFigures(WHOLE, { maxPages: 24, maxFigures: 1, onlyPage: page, label });
      expect(fromWhole.figures).toHaveLength(1);
      expect(fromCut.figures).toHaveLength(1);
      expect(fingerprint(fromCut.figures[0])).toEqual(fingerprint(fromWhole.figures[0]));
    }
  });

  it("does not hold the other pages' figures: a figure of another page is not found in it", async () => {
    const cut = await cutPdfPage(WHOLE, 2);
    const other = await extractPdfFigures(cut!, { maxPages: 24, maxFigures: 1, label: "Figure 5" });
    expect(other.figures).toHaveLength(0);
  });

  it("makes a file of kilobytes of a PDF of megabytes — the page, not the paper", async () => {
    // The same invented PDF with six megabytes of an object no page refers to, added by an incremental update.
    const text = WHOLE.toString("latin1");
    const size = Number(/\/Size (\d+)/.exec(text)![1]);
    const root = /\/Root (\d+) 0 R/.exec(text)![1];
    const previous = /startxref\n(\d+)\n%%EOF\s*$/.exec(text)![1];
    const junk = Buffer.alloc(6_000_000);
    for (let i = 0; i < junk.length; i++) junk[i] = (i * 2654435761) >>> 24;
    const head = Buffer.concat([WHOLE, Buffer.from(`${size} 0 obj\n<< /Length ${junk.length} >>\nstream\n`, "latin1"), junk, Buffer.from("\nendstream\nendobj\n", "latin1")]);
    const tail =
      `xref\n${size} 1\n${String(WHOLE.byteLength).padStart(10, "0")} 00000 n \n` +
      `trailer\n<< /Size ${size + 1} /Root ${root} 0 R /Prev ${previous} >>\nstartxref\n${head.byteLength}\n%%EOF\n`;
    const big = Buffer.concat([head, Buffer.from(tail, "latin1")]);
    const filePath = path.join(dir, "big.pdf");
    writeFileSync(filePath, big);

    const fromFile = await cutPdfPage({ filePath }, 3);
    const fromBytes = await cutPdfPage(big, 3);
    const small = await cutPdfPage(WHOLE, 3);

    expect(big.byteLength).toBeGreaterThan(6_000_000);
    expect(fromFile!.byteLength).toBeLessThan(20_000);
    // The same page file whichever way the PDF was opened, and the same as from the PDF without the padding.
    expect(Buffer.compare(Buffer.from(fromFile!), Buffer.from(fromBytes!))).toBe(0);
    expect(Buffer.compare(Buffer.from(fromFile!), Buffer.from(small!))).toBe(0);
  });

  it("leaves no descriptor open when it cuts from a file", async () => {
    const filePath = path.join(dir, "fd.pdf");
    writeFileSync(filePath, WHOLE);
    const count = () => (existsSync("/proc/self/fd") ? readdirSync("/proc/self/fd").length : null);
    const before = count();
    expect(await cutPdfPage({ filePath }, 2)).not.toBeNull();
    expect(await cutPdfPage({ filePath }, 99)).toBeNull();
    if (before !== null) expect(count()).toBe(before);
  });

  it.each([
    ["a page past the end", WHOLE, 5],
    ["page 0", WHOLE, 0],
    ["a page that is not a whole number", WHOLE, 1.5],
    ["bytes that are not a PDF", Buffer.from("these are invented words, not a PDF"), 1],
    ["an empty source", Buffer.alloc(0), 1],
  ])("is null for %s", async (_name, source, page) => {
    expect(await cutPdfPage(source, page)).toBeNull();
  });

  it("is null for a PDF that needs a password", async () => {
    const mupdf = await import("mupdf");
    mupdf.setLog(() => undefined);
    const plain = mupdf.Document.openDocument(WHOLE, "application/pdf") as import("mupdf").PDFDocument;
    const locked = plain.saveToBuffer("encrypt=aes-128,user-password=invented,owner-password=invented-owner");
    const bytes = new Uint8Array(locked.asUint8Array());
    locked.destroy();
    plain.destroy();
    expect(Buffer.from(bytes.subarray(0, 5)).toString("latin1")).toBe("%PDF-");
    expect(await cutPdfPage(bytes, 1)).toBeNull();
  });

  it("is null for a file that is missing", async () => {
    expect(await cutPdfPage({ filePath: path.join(dir, "nothing-here.pdf") }, 1)).toBeNull();
  });
});

// ── The fixtures that have no helper: a PDF written by hand and left for MuPDF to repair (no xref table). ──

/** A one-page PDF: a red square in the lower left drawn in a layer, a blue square in the upper right outside it. */
function layered(hiddenByDefault: boolean): Buffer {
  const config = hiddenByDefault ? "/D << /OFF [5 0 R] /Order [5 0 R] >>" : "/D << /Order [5 0 R] >>";
  return Buffer.from(`%PDF-1.5
1 0 obj << /Type /Catalog /Pages 2 0 R /OCProperties << /OCGs [5 0 R] ${config} >> >> endobj
2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 /MediaBox [0 0 200 200] >> endobj
3 0 obj << /Type /Page /Parent 2 0 R /Contents 4 0 R /Resources << /Properties << /oc1 5 0 R >> >> >> endobj
4 0 obj << /Length 120 >>
stream
/OC /oc1 BDC 1 0 0 rg 0 0 100 100 re f EMC 0 0 1 rg 100 100 100 100 re f
endstream
endobj
5 0 obj << /Type /OCG /Name (an invented layer) >> endobj
trailer << /Root 1 0 R /Size 6 >>
%%EOF
`, "latin1");
}

/** A page whose MediaBox, CropBox and Rotate all come from the page tree node above it (inherited). */
const INHERITED = Buffer.from(`%PDF-1.5
1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj
2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 /MediaBox [0 0 200 300] /CropBox [10 20 150 250] /Rotate 90 >> endobj
3 0 obj << /Type /Page /Parent 2 0 R /Contents 4 0 R >> endobj
4 0 obj << /Length 40 >>
stream
0 0 1 rg 20 30 100 100 re f
endstream
endobj
trailer << /Root 1 0 R /Size 5 >>
%%EOF
`, "latin1");

async function pixelAt(bytes: Uint8Array, x: number, y: number): Promise<number[]> {
  const mupdf = await import("mupdf");
  mupdf.setLog(() => undefined);
  const doc = mupdf.Document.openDocument(bytes, "application/pdf");
  const page = doc.loadPage(0);
  const pixmap = page.toPixmap(mupdf.Matrix.identity, mupdf.ColorSpace.DeviceRGB, false, true);
  try {
    const at = (y * pixmap.getWidth() + x) * 3;
    const pixels = pixmap.getPixels();
    return [pixels[at], pixels[at + 1], pixels[at + 2]];
  } finally {
    pixmap.destroy();
    page.destroy();
    doc.destroy();
  }
}

async function boundsOf(bytes: Uint8Array): Promise<number[]> {
  const mupdf = await import("mupdf");
  mupdf.setLog(() => undefined);
  const doc = mupdf.Document.openDocument(bytes, "application/pdf");
  const page = doc.loadPage(0);
  try {
    return [...page.getBounds()];
  } finally {
    page.destroy();
    doc.destroy();
  }
}

describe("cutPdfPage — optional content and inherited page attributes (P12-61)", () => {
  // The pixel (50, 150) from the top is in the layer's square: white when the layer is hidden, red when drawn.
  const WHITE = [255, 255, 255];
  const RED = [255, 0, 0];

  it("keeps a layer the PDF hides by default hidden in the page file", async () => {
    const whole = layered(true);
    expect(await pixelAt(whole, 50, 150)).toEqual(WHITE);

    const cut = await cutPdfPage(whole, 1);

    expect(cut).not.toBeNull();
    expect(await pixelAt(cut!, 50, 150)).toEqual(WHITE);
    // The visible content of the page is drawn.
    expect(await pixelAt(cut!, 150, 50)).toEqual([0, 0, 255]);
  });

  it("keeps a layer the PDF shows by default shown", async () => {
    const whole = layered(false);
    expect(await pixelAt(whole, 50, 150)).toEqual(RED);
    expect(await pixelAt((await cutPdfPage(whole, 1))!, 50, 150)).toEqual(RED);
  });

  it("(control) a plain graft of the same page — without OCProperties — draws the hidden layer: the fixture can see the hazard", async () => {
    const mupdf = await import("mupdf");
    mupdf.setLog(() => undefined);
    const source = mupdf.Document.openDocument(layered(true), "application/pdf") as import("mupdf").PDFDocument;
    const plain = new mupdf.PDFDocument();
    plain.graftPage(-1, source, 0);
    const saved = plain.saveToBuffer("garbage=compact,compress");
    const bytes = new Uint8Array(saved.asUint8Array());
    expect(await pixelAt(bytes, 50, 150)).toEqual(RED);
    saved.destroy();
    plain.destroy();
    source.destroy();
  });

  it("keeps the rotation and crop a page inherits from the page tree: the same bounds as on the whole PDF", async () => {
    const wholeBounds = await boundsOf(INHERITED);
    // Rotated by 90 degrees and cropped to 140 x 230: 230 wide, 140 high.
    expect(wholeBounds[2] - wholeBounds[0]).toBeCloseTo(230, 1);
    expect(wholeBounds[3] - wholeBounds[1]).toBeCloseTo(140, 1);

    const cut = await cutPdfPage(INHERITED, 1);

    expect(cut).not.toBeNull();
    const cutBounds = await boundsOf(cut!);
    cutBounds.forEach((value, i) => expect(value).toBeCloseTo(wholeBounds[i], 1));
  });
});

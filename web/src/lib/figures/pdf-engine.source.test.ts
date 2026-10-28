// P12-61 (§1h.434, part 3) — the engine opens a PDF through a MuPDF `Stream`, not a
// `Buffer`: MuPDF asks for the bytes it needs, so a PDF held in memory is not
// copied a third and fourth time (JS, then the WASM heap), and a PDF on disk is
// not read into memory at all. Every PDF here is invented (the helper's, plus
// an unreferenced block of filler bytes added by an incremental update, so the
// file is large and its figures are not): the owner's papers are never read.

import { existsSync, mkdtempSync, readdirSync, rmSync, truncateSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { barChart, bodyText, figurePdf, panel, pngInfo, type FigurePage } from "./figure-pdf.test-helper";

// Every byte the engine reads from a file descriptor, counted.
const reads = vi.hoisted(() => ({ calls: 0, bytes: 0 }));
vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return {
    ...actual,
    readSync: ((...args: Parameters<typeof actual.readSync>) => {
      const count = (actual.readSync as (...a: unknown[]) => number)(...args);
      reads.calls += 1;
      reads.bytes += count;
      return count;
    }) as typeof actual.readSync,
  };
});

import { MAX_PDF_BYTES, extractPdfFigures, measurePdfFigure } from "./pdf-engine";

const dir = mkdtempSync(path.join(tmpdir(), "peer-engine-source-test-"));
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
];
const SMALL = figurePdf(PAGES);

/** The PDF with `filler` bytes of an object no page refers to, added by an incremental update (a new xref
 *  at the end that points back to the old one). A reader that asks only for what a page needs never reads it. */
function padded(pdf: Buffer, filler: number): Buffer {
  const text = pdf.toString("latin1");
  const size = Number(/\/Size (\d+)/.exec(text)![1]);
  const root = /\/Root (\d+) 0 R/.exec(text)![1];
  const previous = /startxref\n(\d+)\n%%EOF\s*$/.exec(text)![1];
  const junk = Buffer.alloc(filler);
  for (let i = 0; i < filler; i++) junk[i] = (i * 2654435761) >>> 24;
  const head = Buffer.concat([pdf, Buffer.from(`${size} 0 obj\n<< /Length ${filler} >>\nstream\n`, "latin1"), junk, Buffer.from("\nendstream\nendobj\n", "latin1")]);
  const tail =
    `xref\n${size} 1\n${String(pdf.byteLength).padStart(10, "0")} 00000 n \n` +
    `trailer\n<< /Size ${size + 1} /Root ${root} 0 R /Prev ${previous} >>\nstartxref\n${head.byteLength}\n%%EOF\n`;
  return Buffer.concat([head, Buffer.from(tail, "latin1")]);
}

function onDisk(name: string, bytes: Uint8Array): { filePath: string } {
  const filePath = path.join(dir, name);
  writeFileSync(filePath, bytes);
  return { filePath };
}

/** Open descriptors of this process (Linux); null where /proc is not there. */
const openFiles = () => (existsSync("/proc/self/fd") ? readdirSync("/proc/self/fd").length : null);

const fingerprint = (figure: { png: Uint8Array; caption: string; box?: number[]; kind: string; width: number; height: number }) => ({
  png: Buffer.from(figure.png).toString("base64"),
  caption: figure.caption,
  box: figure.box,
  kind: figure.kind,
  size: `${figure.width}x${figure.height}`,
});

beforeEach(() => {
  reads.calls = 0;
  reads.bytes = 0;
});

describe("extractPdfFigures — the source of the PDF (P12-61)", () => {
  it("gives the same figure from a file on disk as from the same bytes: the PNG, the caption, the box", async () => {
    const source = onDisk("small.pdf", SMALL);
    for (const [page, label] of [[2, "Figure 3"], [2, "Figure 4"], [3, "Figure 5"]] as const) {
      const options = { maxPages: 24, maxFigures: 1, onlyPage: page, label };
      const fromBytes = await extractPdfFigures(SMALL, options);
      const fromFile = await extractPdfFigures(source, options);
      expect(fromBytes.reason).toBeNull();
      expect(fromBytes.figures).toHaveLength(1);
      expect(pngInfo(fromBytes.figures[0].png).signature).toBe(true);
      expect(fromFile.reason).toBeNull();
      expect(fromFile.figures.map(fingerprint)).toEqual(fromBytes.figures.map(fingerprint));
    }
    expect(reads.calls).toBeGreaterThan(0);
  });

  it("gives the same figures for the whole document from a file as from bytes", async () => {
    const options = { maxPages: 24, maxFigures: 12 };
    const fromBytes = await extractPdfFigures(SMALL, options);
    const fromFile = await extractPdfFigures(onDisk("small-whole.pdf", SMALL), options);
    expect(fromBytes.figures).toHaveLength(3);
    expect(fromFile.figures.map(fingerprint)).toEqual(fromBytes.figures.map(fingerprint));
  });

  it("reads bytes given as a view into a larger buffer (a Node Buffer from a pool, a subarray) at the right offset", async () => {
    const options = { maxPages: 24, maxFigures: 1, onlyPage: 2, label: "Figure 4" };
    const whole = new Uint8Array(SMALL.byteLength + 4093 + 77);
    whole.set(SMALL, 4093);
    const view = whole.subarray(4093, 4093 + SMALL.byteLength);
    expect(view.byteOffset).toBe(4093);
    const expected = await extractPdfFigures(new Uint8Array(SMALL), options);
    const viewed = await extractPdfFigures(view, options);
    expect(viewed.figures.map(fingerprint)).toEqual(expected.figures.map(fingerprint));
    expect(viewed.figures).toHaveLength(1);
  });

  it("measures from a file the same size it measures from bytes", async () => {
    const source = onDisk("measure.pdf", SMALL);
    const fromBytes = await measurePdfFigure(SMALL, 2, 3);
    expect(fromBytes).not.toBeNull();
    expect(await measurePdfFigure(source, 2, 3)).toEqual(fromBytes);
  });

  it("reads from a file only what the page needs: a few kilobytes of a PDF with six megabytes nobody refers to", async () => {
    const big = padded(SMALL, 6_000_000);
    expect(big.byteLength).toBeGreaterThan(6_000_000);
    const source = onDisk("big.pdf", big);

    const { figures, reason } = await extractPdfFigures(source, { maxPages: 24, maxFigures: 1, onlyPage: 2, label: "Figure 3" });

    expect(reason).toBeNull();
    expect(figures).toHaveLength(1);
    expect(reads.calls).toBeGreaterThan(0);
    // Not the file: under a twentieth of it.
    expect(reads.bytes).toBeLessThan(big.byteLength / 20);
    // And the same picture as the small PDF's.
    const small = await extractPdfFigures(SMALL, { maxPages: 24, maxFigures: 1, onlyPage: 2, label: "Figure 3" });
    expect(fingerprint(figures[0])).toEqual(fingerprint(small.figures[0]));
  });

  it("leaves no descriptor open: after a figure, after no figure, after a page past the end, after a file that is not a PDF", async () => {
    const before = openFiles();
    const good = onDisk("fd-good.pdf", SMALL);
    const garbage = onDisk("fd-garbage.pdf", Buffer.from("this is not a PDF, only invented words"));
    const got = await extractPdfFigures(good, { maxPages: 24, maxFigures: 1, onlyPage: 2, label: "Figure 3" });
    const none = await extractPdfFigures(good, { maxPages: 24, maxFigures: 1, onlyPage: 1, label: "Figure 3" });
    const past = await extractPdfFigures(good, { maxPages: 24, maxFigures: 1, onlyPage: 9, label: "Figure 3" });
    const notPdf = await extractPdfFigures(garbage, { maxPages: 24, maxFigures: 1 });
    expect(got.figures).toHaveLength(1);
    expect(none.figures).toHaveLength(0);
    expect(past.reason).toContain("no page 9");
    expect(notPdf.figures).toHaveLength(0);
    expect(notPdf.reason).toContain("failed");
    expect(reads.calls).toBeGreaterThan(0);
    if (before !== null) expect(openFiles()).toBe(before);
  });

  it("closes the descriptor when MuPDF fails to open the file, and when the engine does a measuring only", async () => {
    const before = openFiles();
    await extractPdfFigures(onDisk("fd-empty-body.pdf", Buffer.from("%PDF-1.4\n")), { maxPages: 24, maxFigures: 1 });
    await extractPdfFigures(onDisk("fd-measure.pdf", SMALL), { maxPages: 24, maxFigures: 1, onlyPage: 2, label: "Figure 4", measureOnly: true });
    if (before !== null) expect(openFiles()).toBe(before);
  });

  it("answers, without throwing, for a file that is missing, empty or over the byte ceiling", async () => {
    const missing = await extractPdfFigures({ filePath: path.join(dir, "nothing-here.pdf") }, { maxPages: 24, maxFigures: 1 });
    expect(missing.figures).toEqual([]);
    expect(missing.reason).toContain("could not be opened");

    const empty = await extractPdfFigures(onDisk("empty.pdf", new Uint8Array(0)), { maxPages: 24, maxFigures: 1 });
    expect(empty.figures).toEqual([]);
    expect(empty.reason).toBe("The PDF is empty.");

    // A sparse file: over the ceiling by size alone, nothing is written or read.
    const huge = onDisk("huge.pdf", new Uint8Array(0));
    truncateSync(huge.filePath, MAX_PDF_BYTES + 1);
    const tooLarge = await extractPdfFigures(huge, { maxPages: 24, maxFigures: 1 });
    expect(tooLarge.figures).toEqual([]);
    expect(tooLarge.reason).toContain("too large");
    expect(reads.calls).toBe(0);
  });
});

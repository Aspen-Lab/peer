// P12-54 (R13b) — a one-page figure call takes a PDF up to the upload limit.
//
// The upload route accepts 25 MiB (26,214,400 bytes) and the engine used to refuse anything over 18,000,000, so an
// uploaded paper in between was read but every margin figure and every size answered "too large". A call for one
// page (`onlyPage` set: the margin's picture and the sizing) now has a ceiling of 27,000,000; the whole-document
// call keeps 18,000,000 and its reason.
//
// Every PDF is invented and built here: the helper's small figure PDF, then an incremental update appends one
// embedded stream of incompressible bytes (a seeded xorshift, so a run is repeatable) and is reachable from the
// catalog. Nothing large is committed, and the owner's papers are never read.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { FIGURE_EXTRACTION_REVISION } from "./figure-revision";
import { CHART_CAPTION, barChart, bodyText, figurePdf, pngInfo } from "./figure-pdf.test-helper";
import { MAX_ONE_PAGE_PDF_BYTES, MAX_PDF_BYTES, extractPdfFigures } from "./pdf-engine";

/** The upload route's limit, 25 MiB (`api/papers/upload/route.ts` keeps it in a module-private constant). */
const UPLOAD_LIMIT = 25 * 1024 * 1024;
const TOO_LARGE = "The PDF is too large for Peer to extract its figures safely.";

const PAGE_CALL = { maxPages: 300, maxFigures: 1, onlyPage: 1, label: "Figure 1" };
const WHOLE_CALL = { maxPages: 24, maxFigures: 12 };

/** Incompressible bytes: a seeded xorshift32 stream. */
function noise(length: number): Buffer {
  const words = new Uint32Array(Math.ceil(length / 4));
  let state = 0x9e3779b9;
  for (let i = 0; i < words.length; i++) {
    state ^= state << 13;
    state >>>= 0;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    words[i] = state;
  }
  return Buffer.from(words.buffer, 0, length);
}

/** The invented one-page chart (Figure 1) as a PDF of exactly `total` bytes: an incremental update appends a
 *  catalog that points at one raw embedded stream of noise, sized to land on `total`. */
function paddedFigurePdf(total: number): Buffer {
  const base = figurePdf([
    { text: [...bodyText(["Synthetic body text, one line."], 80), [CHART_CAPTION, 72, 440, 9]], shapes: barChart(110, 250) },
  ]);
  const text = base.toString("latin1");
  const size = Number(/\/Size (\d+)/.exec(text)![1]);
  const root = Number(/\/Root (\d+) 0 R/.exec(text)![1]);
  const pages = Number(new RegExp(`(?:^|\\n)${root} 0 obj\\n<<[^>]*?/Pages (\\d+) 0 R`).exec(text)![1]);
  const previous = Number(/startxref\n(\d+)\n%%EOF\n$/.exec(text)![1]);
  const padding = size; // the new object's number

  const assemble = (length: number): Buffer => {
    const catalogAt = base.length;
    const catalog = `${root} 0 obj\n<< /Type /Catalog /Pages ${pages} 0 R /Padding ${padding} 0 R >>\nendobj\n`;
    const streamAt = catalogAt + Buffer.byteLength(catalog, "latin1");
    const head = `${padding} 0 obj\n<< /Length ${length} >>\nstream\n`;
    const tail = "\nendstream\nendobj\n";
    const xrefAt = streamAt + Buffer.byteLength(head, "latin1") + length + Buffer.byteLength(tail, "latin1");
    const offset = (at: number) => `${String(at).padStart(10, "0")} 00000 n \n`;
    const trailer =
      `xref\n${root} 1\n${offset(catalogAt)}${padding} 1\n${offset(streamAt)}` +
      `trailer\n<< /Size ${size + 1} /Root ${root} 0 R /Prev ${previous} >>\nstartxref\n${xrefAt}\n%%EOF\n`;
    return Buffer.concat([
      base,
      Buffer.from(catalog + head, "latin1"),
      length > 0 ? noise(length) : Buffer.alloc(0),
      Buffer.from(tail + trailer, "latin1"),
    ]);
  };

  // The stream's length is spelled in the PDF (and so is where the xref sits), so settle on it by iteration.
  let length = Math.max(0, total - assemble(0).length);
  for (let attempt = 0; attempt < 6; attempt++) {
    const built = assemble(length);
    if (built.length === total) return built;
    length = Math.max(0, length + (total - built.length));
  }
  throw new Error(`could not build an invented PDF of exactly ${total} bytes`);
}

const FIGURE_FOUND = (result: Awaited<ReturnType<typeof extractPdfFigures>>) => {
  expect(result.reason).toBeNull();
  expect(result.figures).toHaveLength(1);
  const [figure] = result.figures;
  expect(figure.page).toBe(1);
  expect(figure.kind).toBe("drawing");
  expect(figure.caption).toBe(CHART_CAPTION);
  return figure;
};

describe("the ceilings", () => {
  it("keep 18,000,000 for a whole document and 27,000,000 for one page, above the upload limit", () => {
    expect(MAX_PDF_BYTES).toBe(18_000_000);
    expect(MAX_ONE_PAGE_PDF_BYTES).toBe(27_000_000);
    expect(UPLOAD_LIMIT).toBe(26_214_400);
    expect(MAX_ONE_PAGE_PDF_BYTES).toBeGreaterThan(UPLOAD_LIMIT);
  });

  it("still cover what the upload route accepts (its limit is read from the route, not only mirrored here)", () => {
    const route = readFileSync(resolve(process.cwd(), "src/app/api/papers/upload/route.ts"), "utf8");
    const declared = /const MAX_UPLOAD_BYTES = (\d+) \* (\d+) \* (\d+);/.exec(route);
    expect(declared).not.toBeNull();
    const limit = Number(declared![1]) * Number(declared![2]) * Number(declared![3]);
    expect(limit).toBe(UPLOAD_LIMIT);
    expect(MAX_ONE_PAGE_PDF_BYTES).toBeGreaterThanOrEqual(limit);
  });

  it("went with a new figure revision, because sizes were cached as none for such papers", () => {
    // Revision "3" is the one under which a 25 MB paper's sizes were stored as "none"; any later number retires them.
    const revision = Number(FIGURE_EXTRACTION_REVISION);
    expect(Number.isInteger(revision)).toBe(true);
    expect(revision).toBeGreaterThan(3);
  });
});

describe("P12-54 a one-page call on an invented PDF padded past 18,000,000 bytes", () => {
  let padded: Buffer;
  beforeAll(() => {
    padded = paddedFigurePdf(MAX_PDF_BYTES + 500_000);
  }, 30_000);

  it("is built past the whole-document ceiling and still under the one-page one", () => {
    expect(padded.byteLength).toBe(18_500_000);
    expect(padded.byteLength).toBeGreaterThan(MAX_PDF_BYTES);
    expect(padded.byteLength).toBeLessThan(MAX_ONE_PAGE_PDF_BYTES);
  });

  it("is a sound PDF (no repair) whose catalog reaches the incompressible stream", async () => {
    const mupdf = await import("mupdf");
    const doc = new mupdf.PDFDocument(padded);
    try {
      expect(doc.wasRepaired()).toBe(false);
      expect(doc.countPages()).toBe(1);
      const stream = doc.getTrailer().get("Root").get("Padding");
      expect(stream.isStream()).toBe(true);
      const raw = stream.readRawStream();
      expect(raw.getLength()).toBeGreaterThan(18_400_000);
      raw.destroy();
    } finally {
      doc.destroy();
    }
  }, 60_000);

  it("finds the figure and draws it (the margin's picture)", async () => {
    const figure = FIGURE_FOUND(await extractPdfFigures(padded, PAGE_CALL));
    expect(pngInfo(figure.png).signature).toBe(true);
    expect(figure.png.byteLength).toBeGreaterThan(0);
  }, 60_000);

  it("finds the figure and sizes it without drawing (the sizing)", async () => {
    const figure = FIGURE_FOUND(await extractPdfFigures(padded, { ...PAGE_CALL, measureOnly: true }));
    expect(figure.png.byteLength).toBe(0);
    expect(figure.width).toBeGreaterThan(0);
    expect(figure.height).toBeGreaterThan(0);
  }, 60_000);

  it("is still refused by the whole-document call, with its reason, before a byte is parsed", async () => {
    const result = await extractPdfFigures(padded, WHOLE_CALL);
    expect(result.figures).toEqual([]);
    expect(result.reason).toBe(TOO_LARGE);
  });

  it("is still refused by a whole-document call that asks for a label (no onlyPage)", async () => {
    const result = await extractPdfFigures(padded, { ...WHOLE_CALL, label: "Figure 1" });
    expect(result.figures).toEqual([]);
    expect(result.reason).toBe(TOO_LARGE);
  });
});

describe("P12-54 the upload limit and the one-page ceiling", () => {
  it("a PDF of exactly the upload limit (26,214,400 bytes) is read by a one-page call", async () => {
    const atUpload = paddedFigurePdf(UPLOAD_LIMIT);
    expect(atUpload.byteLength).toBe(UPLOAD_LIMIT);
    FIGURE_FOUND(await extractPdfFigures(atUpload, PAGE_CALL));
    expect((await extractPdfFigures(atUpload, WHOLE_CALL)).reason).toBe(TOO_LARGE);
  }, 90_000);

  it("a PDF of exactly 27,000,000 bytes is read by a one-page call; one byte more is refused", async () => {
    const atCeiling = paddedFigurePdf(MAX_ONE_PAGE_PDF_BYTES);
    expect(atCeiling.byteLength).toBe(MAX_ONE_PAGE_PDF_BYTES);
    FIGURE_FOUND(await extractPdfFigures(atCeiling, PAGE_CALL));

    const over = await extractPdfFigures(new Uint8Array(MAX_ONE_PAGE_PDF_BYTES + 1), PAGE_CALL);
    expect(over.figures).toEqual([]);
    expect(over.reason).toBe(TOO_LARGE);
    const overMeasuring = await extractPdfFigures(new Uint8Array(MAX_ONE_PAGE_PDF_BYTES + 1), { ...PAGE_CALL, measureOnly: true });
    expect(overMeasuring.reason).toBe(TOO_LARGE);
  }, 90_000);
});

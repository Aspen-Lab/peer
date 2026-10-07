import { existsSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { minimalPdf, prose, type Run } from "./minimal-pdf.test-helper";
import { extractPdfTextFromPath, tryExtractPdfText } from "./pdf-text";

// The smallest thing `downloadPdf` accepts as a PDF: the magic bytes.
const PDF_BYTES = new TextEncoder().encode("%PDF-1.4\n%âã\n1 0 obj\n<< >>\nendobj\n");

// P0-01 (spec D1 + D2): a PDF's sections carry an id in document order and
// the page their heading sits on. The outline always knew the page;
// `normalize()` dropped it.
describe("tryExtractPdfText — section ids and pages (P0-01)", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("numbers the sections s0…sN and keeps the page each one starts on", async () => {
    const bytes = minimalPdf([
      [
        ["Reading Papers With A Question In Mind", 72, 80, 18],
        ["Abstract", 72, 130, 14],
        ...prose(
          [
            "We study how readers find the few sentences that answer their question.",
            "A map of the paper before reading shortens the search considerably.",
          ],
          150,
        ),
        ["1 Introduction", 72, 210, 11],
        ...prose(
          [
            "Every paper is a haystack and the reader is looking for a few needles in it.",
            "Without a map, the only strategy is to read everything from the first page.",
          ],
          230,
        ),
      ],
      [
        ["2 Methods", 72, 80, 11],
        ...prose(["We built a map from the outline the extractor reads off the text layer."], 100),
        ["2.1 Setup", 72, 140, 11],
        ...prose(["Twelve readers each brought one question to three papers they chose."], 160),
      ],
      [
        ["3 Results", 72, 80, 11],
        ...prose(["Readers with a map found their answer in fewer minutes than readers without."], 100),
      ],
    ]);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(new Uint8Array(bytes), { status: 200, headers: { "content-type": "application/pdf" } })),
    );

    const result = await tryExtractPdfText("https://example.org/p0-01-ids-and-pages.pdf");

    expect(result.ok).toBe(true);
    expect(result.doc?.sections.map((s) => [s.id, s.heading, s.page])).toEqual([
      ["s0", "Abstract", 1],
      ["s1", "1 Introduction", 1],
      ["s2", "2 Methods", 2],
      ["s3", "2.1 Setup", 2],
      ["s4", "3 Results", 3],
    ]);
  });
});

describe("tryExtractPdfText", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(PDF_BYTES, { status: 200, headers: { "content-type": "application/pdf" } })),
    );
  });

  afterEach(() => vi.unstubAllGlobals());

  it("says a PDF with nothing to read is unreadable, not missing", async () => {
    // This used to be the `no-python` case — the reading ran in a helper that
    // needed an interpreter, so a deployed Peer could never read any PDF. It
    // reads PDFs in-process now; what is left is the file that carries no
    // text, and the reading page names that rather than claiming no full text.
    const result = await tryExtractPdfText("https://example.org/paper.pdf");

    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/no-text-layer|no-sections|InvalidPDF|Invalid/i);
  });

  it("refuses a landing page dressed as a PDF link", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("<html><body>Sign in</body></html>", { status: 200 })),
    );

    const result = await tryExtractPdfText("https://example.org/paywall");

    expect(result).toEqual({
      ok: false,
      reason: "Response was not a PDF (likely a landing/paywall page).",
    });
  });
});

// P0-03 (spec D3, decision 3): an uploaded PDF is read by pdf.js, the same
// `readPages` → `buildOutline` → `normalize` path as a PDF link — there is no
// Python text helper any more. The protective tests below were written
// against `scripts/extract_pdf_text.py` (PyMuPDF) and skipped wherever
// PyMuPDF was missing, which is everywhere Peer is deployed and this
// container too. They now draw the same layouts with `minimalPdf` and assert
// the same shapes through pdf.js, on every machine. Where pdf.js reads a
// layout differently from the old helper, the assertion follows pdf.js and
// says so.
async function onDisk(name: string, pages: Run[][]): Promise<string> {
  const pdfPath = path.join(tempDir, name);
  await writeFile(pdfPath, minimalPdf(pages));
  return pdfPath;
}

let tempDir: string;

beforeAll(async () => {
  tempDir = await mkdtemp(path.join(tmpdir(), "peer-pdf-upload-"));
});

afterAll(async () => {
  await rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
});

/** Enough prose under a heading that the page reads as a text layer, not a
 *  scan (`buildOutline` wants 200 characters). */
const FILLER: Run[] = prose(
  [
    "1 Introduction",
    "Superlattices let the layer ratio be tuned one unit cell at a time across the stack.",
    "The tuning changes how the electrons order, and with it the critical temperature here.",
  ],
  260,
);

// 2-06 (Ruling 9, A2-01) — rewritten for P0-03: the uploaded-PDF title is
// the largest words on page 1, joined across the lines a long title wraps
// onto, and never a stamp.
describe("extractPdfTextFromPath's title — 2-06 synthetic layouts, read by pdf.js (P0-03)", () => {
  it("joins a wrapped title's consecutive largest-font lines, not just the first", async () => {
    const pdfPath = await onDisk("wrapped-title.pdf", [
      [
        ["Electronic Structure and Superconductivity in Complex Oxide", 72, 100, 18],
        ["Artificial High-Tc Superlattices Probed by Advanced Methods", 72, 130, 18],
        ["Combining Hard and Soft X-ray Spectroscopy Techniques Fully", 72, 160, 18],
        ["J. Smith, A. Doe, University of Nowhere", 72, 200, 11],
        ...FILLER,
      ],
    ]);

    const result = await extractPdfTextFromPath(pdfPath);

    expect(result.ok).toBe(true);
    expect(result.doc?.title).toBe(
      "Electronic Structure and Superconductivity in Complex Oxide " +
        "Artificial High-Tc Superlattices Probed by Advanced Methods " +
        "Combining Hard and Soft X-ray Spectroscopy Techniques Fully",
    );
  });

  it("never returns an arXiv margin stamp as the title, even when the stamp is the largest text on the page", async () => {
    const pdfPath = await onDisk("stamp-above-title.pdf", [
      [
        ["arXiv:2401.12345v2", 350, 700, 20],
        ["A Study Of Interesting Reactions In Modern Battery Chemistry", 72, 100, 16],
        ["J. Smith, University of Nowhere", 72, 130, 11],
        ...FILLER,
      ],
    ]);

    const result = await extractPdfTextFromPath(pdfPath);

    expect(result.ok).toBe(true);
    expect(result.doc?.title).toBe("A Study Of Interesting Reactions In Modern Battery Chemistry");
    expect(result.doc?.title).not.toContain("arXiv");
    expect(result.doc?.title).not.toBeNull();
  });
});

// 4-03 (Ruling 10, A3-05) — rewritten for P0-03: a running page-number+DOI
// footer, repeated on every page with its own number, must never be spliced
// into the sentence that crosses the page break around it. pdf.js reads it
// as the page's furniture (`furnitureOf`: the same line at the same height
// on most pages).
describe("extractPdfTextFromPath's furniture-splice removal — 4-03, read by pdf.js (P0-03)", () => {
  it("removes a repeated page-number+DOI footer instead of splicing it mid-sentence", async () => {
    const pdfPath = await onDisk("furniture-splice.pdf", [
      [
        ["Introduction", 72, 72, 14],
        ["Body text discusses electrodes of identical", 72, 100, 11],
        ["1 DOI: 10.1234/test.0001", 72, 800, 8],
      ],
      [
        ["thickness but different pore size were fabricated.", 72, 72, 11],
        ["2 DOI: 10.1234/test.0001", 72, 800, 8],
      ],
      [
        ["Further discussion continues on this page.", 72, 72, 11],
        ["3 DOI: 10.1234/test.0001", 72, 800, 8],
      ],
    ]);

    const result = await extractPdfTextFromPath(pdfPath);

    expect(result.ok).toBe(true);
    const introduction = result.doc?.sections.find((section) => section.canonical === "introduction");
    expect(introduction?.text).toContain(
      "electrodes of identical thickness but different pore size were fabricated.",
    );
    expect(introduction?.text).not.toContain("DOI: 10.1234/test.0001");
  });
});

// 4-05 (Ruling 11, A3-05 residual) — rewritten for P0-03. The Python helper
// removed a bare number line only when its value tracked the page sequence,
// and kept any other bare number where it stood. pdf.js's reading
// (`pdf-outline.ts`) is simpler: a line that is nothing but a 1–4 digit
// number is a folio (`FOLIO`), and a line repeated at the same height on
// most pages is furniture. So page numbers still never splice into a
// sentence — and a lone "2024" line is dropped too, which the old helper
// kept. The assertions below state pdf.js's contract; the difference is
// recorded in the P0-03 checkpoint. One prose line was added to each layout
// so the page carries the 200 characters `buildOutline` needs to call it a
// text layer rather than a scan.
describe("extractPdfTextFromPath's page-number furniture removal — 4-05, read by pdf.js (P0-03)", () => {
  it("removes bare page-number lines that track the page sequence; a bare '2024' line is a folio to pdf.js too", async () => {
    const pdfPath = await onDisk("page-number-furniture.pdf", [
      [
        ["Introduction", 72, 72, 14],
        ["Body text discusses electrodes of identical", 72, 100, 11],
        ["1", 72, 800, 8],
      ],
      [
        ["thickness but different pore size were fabricated.", 72, 72, 11],
        ["2024", 72, 150, 11],
        ["2", 72, 800, 8],
      ],
      [
        ["Further discussion continues on this page.", 72, 72, 11],
        ["3", 72, 800, 8],
      ],
      [
        ["The study concludes with final remarks here.", 72, 72, 11],
        ["Nothing else follows in this short fixture.", 72, 86, 11],
        ["4", 72, 800, 8],
      ],
    ]);

    const result = await extractPdfTextFromPath(pdfPath);

    expect(result.ok).toBe(true);
    const introduction = result.doc?.sections.find((section) => section.canonical === "introduction");
    // Exact join: "1"/"2"/"3"/"4" are gone from every seam they could have
    // spliced into. P0-03: so is the lone "2024" (pdf.js's `FOLIO`).
    expect(introduction?.text).toBe(
      "Body text discusses electrodes of identical thickness but different pore size were fabricated. " +
        "Further discussion continues on this page. The study concludes with final remarks here. " +
        "Nothing else follows in this short fixture.",
    );
  });

  it("drops a bare number repeated at the same height on every page — furniture to pdf.js, where the old helper left it", async () => {
    const pdfPath = await onDisk("page-number-not-tracking.pdf", [
      [
        ["Introduction", 72, 72, 14],
        ["Experimental values were measured across three", 72, 100, 11],
        ["2024", 72, 800, 8],
      ],
      [
        ["trials to assess performance under load.", 72, 72, 11],
        ["2024", 72, 800, 8],
      ],
      [
        ["A separate note follows here for completeness.", 72, 72, 11],
        ["Each trial ran for the same number of cycles at room temperature.", 72, 86, 11],
        ["2024", 72, 800, 8],
      ],
    ]);

    const result = await extractPdfTextFromPath(pdfPath);

    expect(result.ok).toBe(true);
    const introduction = result.doc?.sections.find((section) => section.canonical === "introduction");
    // P0-03: the old helper kept "2024" three times here, because its value
    // never tracked the page number. pdf.js sees one line at one height on
    // every page — a running footer — and leaves it out of the prose.
    expect(introduction?.text).toBe(
      "Experimental values were measured across three trials to assess performance under load. " +
        "A separate note follows here for completeness. " +
        "Each trial ran for the same number of cycles at room temperature.",
    );
  });
});

// P0-03 (spec D3, §3d items 2 and 3): the upload path's own contract.
describe("extractPdfTextFromPath — uploads read with pdf.js only (P0-03)", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("reads an uploaded PDF into sections with ids and pages, and hands back page 1's text", async () => {
    const pdfPath = await onDisk("upload-contract.pdf", [
      [
        ["A Paper Uploaded By Its Reader", 72, 80, 18],
        ["https://doi.org/10.1234/peer.upload.0001", 72, 110, 9],
        ["Abstract", 72, 140, 14],
        ...prose(["We read an uploaded paper the way we read one from a link, with nothing else needed."], 160),
        ["1 Introduction", 72, 200, 11],
        ...prose(["The upload path used a separate helper that a deployed server could never run."], 220),
      ],
      [
        ["2 Methods", 72, 80, 11],
        ...prose(
          [
            "Both paths now share one reading of the text layer, page by page, in TypeScript.",
            "The outline finds the headings by their size, their face and their numbers.",
          ],
          100,
        ),
        ["Figure 1: The two reading paths, merged into one.", 72, 150, 9],
        ...prose(["A second paragraph starts after the figure, where the page leaves a gap."], 190),
      ],
    ]);

    const result = await extractPdfTextFromPath(pdfPath);

    expect(result.ok).toBe(true);
    expect(result.doc?.source).toBe("pdf");
    expect(result.doc?.pageCount).toBe(2);
    expect(result.doc?.sections.map((s) => [s.id, s.heading, s.page])).toEqual([
      ["s0", "Abstract", 1],
      ["s1", "1 Introduction", 1],
      ["s2", "2 Methods", 2],
    ]);
    // Paragraphs are kept, and a caption goes to the figure pool with its
    // page and its place in the document — not into the prose.
    const methods = result.doc?.sections[2].text ?? "";
    expect(methods.split("\n\n")).toHaveLength(2);
    expect(methods).not.toContain("Figure 1");
    expect(result.doc?.figureCaptions).toEqual([
      { ordinal: 1, label: "Figure 1", caption: "The two reading paths, merged into one.", page: 2, at: 0.75 },
    ]);
    // Page 1's lines, joined: what the upload route searches for a DOI and
    // hands the title fallback.
    expect(result.page1Text).toContain("A Paper Uploaded By Its Reader");
    expect(result.page1Text).toContain("10.1234/peer.upload.0001");
    expect(result.page1Text).not.toContain("Both paths now share");
  });

  it("needs no Python: it reads the same with no interpreter on PATH and PYTHON_BIN pointing nowhere", async () => {
    const pdfPath = await onDisk("no-python.pdf", [[["A Paper Read Without Python", 72, 80, 18], ...FILLER]]);
    vi.stubEnv("PATH", "");
    vi.stubEnv("PYTHON_BIN", "/nonexistent/python");

    const result = await extractPdfTextFromPath(pdfPath);

    expect(result.ok).toBe(true);
    expect(result.doc?.sections.map((s) => s.canonical)).toEqual(["introduction"]);
  });

  it("says a scan is a scan: no text layer reads as pdf-empty, the marker the reading page looks for", async () => {
    const pdfPath = await onDisk("scan.pdf", [[], []]);

    const result = await extractPdfTextFromPath(pdfPath);

    expect(result.ok).toBe(false);
    expect(result.doc).toBeUndefined();
    expect(result.reason).toMatch(/^pdf-empty: /);
  });

  it("fails plainly, not as a scan, when the file is not a readable PDF", async () => {
    const pdfPath = path.join(tempDir, "not-a-pdf.pdf");
    await writeFile(pdfPath, "%PDF-1.4\nthis is not a PDF body\n");

    const result = await extractPdfTextFromPath(pdfPath);

    expect(result.ok).toBe(false);
    expect(result.reason).not.toMatch(/pdf-empty/);
  });
});

// P0-03 smoke input: the one real PDF the repository carries (a design
// document with a real text layer, not a paper). Skipped, by name, where
// the file is absent.
const SPEC_PDF = fileURLToPath(new URL("../../../../Peer-design-spec-original.pdf", import.meta.url));

describe.skipIf(!existsSync(SPEC_PDF))(
  "extractPdfTextFromPath smoke — Peer-design-spec-original.pdf (skipped when the file is absent) (P0-03)",
  () => {
    it("reads the repository's real PDF through pdf.js alone", async () => {
      const result = await extractPdfTextFromPath(SPEC_PDF);

      expect(result.ok).toBe(true);
      expect(result.doc?.sections.length ?? 0).toBeGreaterThanOrEqual(1);
      expect(result.doc?.pageCount ?? 0).toBeGreaterThan(1);
      expect(result.page1Text?.trim().length ?? 0).toBeGreaterThan(0);
      // Every section has its id in order and the page it starts on.
      const sections = result.doc?.sections ?? [];
      expect(sections.map((s) => s.id)).toEqual(sections.map((_, i) => `s${i}`));
      expect(sections.every((s) => typeof s.page === "number" && s.page >= 1)).toBe(true);
    }, 60_000);
  },
);

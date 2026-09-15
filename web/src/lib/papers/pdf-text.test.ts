import { execFile, execFileSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { extractPdfTextFromPath, tryExtractPdfText } from "./pdf-text";

const execFileAsync = promisify(execFile);

// The smallest thing `downloadPdf` accepts as a PDF: the magic bytes.
const PDF_BYTES = new TextEncoder().encode("%PDF-1.4\n%âã\n1 0 obj\n<< >>\nendobj\n");

describe("tryExtractPdfText", () => {
  const savedPath = process.env.PATH;
  const savedPython = process.env.PYTHON_BIN;

  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(PDF_BYTES, { status: 200, headers: { "content-type": "application/pdf" } })),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    process.env.PATH = savedPath;
    if (savedPython === undefined) delete process.env.PYTHON_BIN;
    else process.env.PYTHON_BIN = savedPython;
  });

  it("reports no-python when no interpreter can be spawned", async () => {
    // No PATH and a PYTHON_BIN that does not exist: every runner ENOENTs,
    // which is what a Vercel function sees.
    process.env.PATH = "";
    process.env.PYTHON_BIN = "/nonexistent/python3";

    const result = await tryExtractPdfText("https://example.org/paper.pdf");

    expect(result).toEqual({ ok: false, reason: "no-python" });
  });
});

// 2-06 (Ruling 9, A2-01): protective synthetic-layout tests for the uploaded-
// PDF title heuristic (`extract_pdf_text.py`'s `extract_title`). Ruling 9
// asks for these at the Python level; this repo has no Python test runner
// wired up at all (confirmed — no `test_*.py`/`conftest.py` anywhere), so
// per B's own authorized fallback these run at the TypeScript level instead,
// invoking the real script through the same `extractPdfTextFromPath` entry
// point the upload route uses — exercising the actual script, not a
// reimplementation of its logic. Only `python` (never `python3` — a Windows
// Store alias stub that can hang rather than fail fast) is tried; on a
// machine with no working `python`+PyMuPDF this describe block is skipped
// rather than failing the gate, the same graceful-degradation shape as any
// environment-optional integration test.
function pythonWithPyMuPdfAvailable(): boolean {
  try {
    execFileSync("python", ["-c", "import pymupdf"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}
const PYTHON_AVAILABLE = pythonWithPyMuPdfAvailable();

describe.skipIf(!PYTHON_AVAILABLE)("extract_pdf_text.py's extract_title — 2-06 synthetic layouts", () => {
  let tempDir: string;

  beforeAll(async () => {
    tempDir = await mkdtemp(path.join(tmpdir(), "peer-pdftitle-"));
  });

  afterAll(async () => {
    await rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
  });

  async function buildPdf(script: string, fileName: string): Promise<string> {
    const outputPath = path.join(tempDir, fileName);
    await execFileAsync("python", ["-c", script, outputPath]);
    return outputPath;
  }

  it("joins a wrapped title's consecutive largest-font lines, not just the first", async () => {
    const pdfPath = await buildPdf(
      `
import sys
import pymupdf as fitz
doc = fitz.open()
page = doc.new_page()
page.insert_text((72, 100), "Electronic Structure and Superconductivity in Complex Oxide", fontsize=18, fontname="helv")
page.insert_text((72, 130), "Artificial High-Tc Superlattices Probed by Advanced Methods", fontsize=18, fontname="helv")
page.insert_text((72, 160), "Combining Hard and Soft X-ray Spectroscopy Techniques Fully", fontsize=18, fontname="helv")
page.insert_text((72, 200), "J. Smith, A. Doe, University of Nowhere", fontsize=11, fontname="helv")
doc.save(sys.argv[1])
`,
      "wrapped-title.pdf",
    );

    const result = await extractPdfTextFromPath(pdfPath);

    expect(result.ok).toBe(true);
    expect(result.doc?.title).toBe(
      "Electronic Structure and Superconductivity in Complex Oxide " +
        "Artificial High-Tc Superlattices Probed by Advanced Methods " +
        "Combining Hard and Soft X-ray Spectroscopy Techniques Fully",
    );
  });

  it("never returns an arXiv margin stamp as the title, even when the stamp is the largest text on the page", async () => {
    const pdfPath = await buildPdf(
      `
import sys
import pymupdf as fitz
doc = fitz.open()
page = doc.new_page()
page.insert_text((350, 700), "arXiv:2401.12345v2", fontsize=20, fontname="helv")
page.insert_text((72, 100), "A Study Of Interesting Reactions In Modern Battery Chemistry", fontsize=16, fontname="helv")
page.insert_text((72, 130), "J. Smith, University of Nowhere", fontsize=11, fontname="helv")
doc.save(sys.argv[1])
`,
      "stamp-above-title.pdf",
    );

    const result = await extractPdfTextFromPath(pdfPath);

    expect(result.ok).toBe(true);
    expect(result.doc?.title).toBe("A Study Of Interesting Reactions In Modern Battery Chemistry");
    expect(result.doc?.title).not.toContain("arXiv");
    expect(result.doc?.title).not.toBeNull();
  });
});

// 4-03 (Ruling 10, A3-05): protective test for `find_running_furniture` in
// extract_pdf_text.py — a running page-number+DOI footer line, repeated
// verbatim (modulo its own incrementing page number) on every page, must
// never be spliced into the flowing sentence that crosses the page break
// around it. Same real-PDF, same-Python-level test shape as the 2-06 block
// above (there is no Python test runner wired up in this repo).
describe.skipIf(!PYTHON_AVAILABLE)("extract_pdf_text.py's furniture-splice removal — 4-03", () => {
  let tempDir: string;

  beforeAll(async () => {
    tempDir = await mkdtemp(path.join(tmpdir(), "peer-pdffurniture-"));
  });

  afterAll(async () => {
    await rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
  });

  async function buildPdf(script: string, fileName: string): Promise<string> {
    const outputPath = path.join(tempDir, fileName);
    await execFileAsync("python", ["-c", script, outputPath]);
    return outputPath;
  }

  it("removes a repeated page-number+DOI footer instead of splicing it mid-sentence", async () => {
    const pdfPath = await buildPdf(
      `
import sys
import pymupdf as fitz
doc = fitz.open()

page1 = doc.new_page()
page1.insert_text((72, 72), "Introduction", fontsize=14, fontname="helv")
page1.insert_text((72, 100), "Body text discusses electrodes of identical", fontsize=11, fontname="helv")
page1.insert_text((72, 800), "1 DOI: 10.1234/test.0001", fontsize=8, fontname="helv")

page2 = doc.new_page()
page2.insert_text((72, 72), "thickness but different pore size were fabricated.", fontsize=11, fontname="helv")
page2.insert_text((72, 800), "2 DOI: 10.1234/test.0001", fontsize=8, fontname="helv")

page3 = doc.new_page()
page3.insert_text((72, 72), "Further discussion continues on this page.", fontsize=11, fontname="helv")
page3.insert_text((72, 800), "3 DOI: 10.1234/test.0001", fontsize=8, fontname="helv")

doc.save(sys.argv[1])
`,
      "furniture-splice.pdf",
    );

    const result = await extractPdfTextFromPath(pdfPath);

    expect(result.ok).toBe(true);
    const introduction = result.doc?.sections.find((section) => section.canonical === "introduction");
    expect(introduction?.text).toContain(
      "electrodes of identical thickness but different pore size were fabricated.",
    );
    expect(introduction?.text).not.toContain("DOI: 10.1234/test.0001");
  });
});

// 4-05 (Ruling 11, A3-05 residual): protective test for
// `find_page_number_furniture` in extract_pdf_text.py — 4-03 only caught a
// page number glued to OTHER footer text on the same line; PyMuPDF can also
// emit the page number as its own bare line, which `find_running_furniture`
// never sees as a repeat (nothing else on the line to strip it against). A
// bare 1-4 digit line is furniture only when its value tracks the page
// sequence (int(line) == page_index + k for one constant k, >= 3 pages); a
// bare number that does NOT track the sequence (a table cell, a year
// sitting alone on its own line) must be left exactly where it is. Same
// real-PDF, same-Python-level test shape as the 4-03 block above.
describe.skipIf(!PYTHON_AVAILABLE)("extract_pdf_text.py's page-number furniture removal — 4-05", () => {
  let tempDir: string;

  beforeAll(async () => {
    tempDir = await mkdtemp(path.join(tmpdir(), "peer-pdfpagenum-"));
  });

  afterAll(async () => {
    await rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
  });

  async function buildPdf(script: string, fileName: string): Promise<string> {
    const outputPath = path.join(tempDir, fileName);
    await execFileAsync("python", ["-c", script, outputPath]);
    return outputPath;
  }

  it("removes bare page-number lines that track the page sequence, but keeps a bare '2024' that doesn't", async () => {
    const pdfPath = await buildPdf(
      `
import sys
import pymupdf as fitz
doc = fitz.open()

page1 = doc.new_page()
page1.insert_text((72, 72), "Introduction", fontsize=14, fontname="helv")
page1.insert_text((72, 100), "Body text discusses electrodes of identical", fontsize=11, fontname="helv")
page1.insert_text((72, 800), "1", fontsize=8, fontname="helv")

page2 = doc.new_page()
page2.insert_text((72, 72), "thickness but different pore size were fabricated.", fontsize=11, fontname="helv")
page2.insert_text((72, 150), "2024", fontsize=11, fontname="helv")
page2.insert_text((72, 800), "2", fontsize=8, fontname="helv")

page3 = doc.new_page()
page3.insert_text((72, 72), "Further discussion continues on this page.", fontsize=11, fontname="helv")
page3.insert_text((72, 800), "3", fontsize=8, fontname="helv")

page4 = doc.new_page()
page4.insert_text((72, 72), "The study concludes with final remarks here.", fontsize=11, fontname="helv")
page4.insert_text((72, 800), "4", fontsize=8, fontname="helv")

doc.save(sys.argv[1])
`,
      "page-number-furniture.pdf",
    );

    const result = await extractPdfTextFromPath(pdfPath);

    expect(result.ok).toBe(true);
    const introduction = result.doc?.sections.find((section) => section.canonical === "introduction");
    // Exact join: proves "1"/"2"/"3"/"4" (each tracking page_index + 1) are
    // gone from every seam they used to splice into, while "2024" (present
    // on only one page, so it can never reach the >= 3-page bar) survives
    // untouched in the middle of the text.
    expect(introduction?.text).toBe(
      "Body text discusses electrodes of identical thickness but different pore size were fabricated. " +
        "2024 Further discussion continues on this page. The study concludes with final remarks here.",
    );
  });

  it("leaves a bare number alone when it does not track the page sequence", async () => {
    const pdfPath = await buildPdf(
      `
import sys
import pymupdf as fitz
doc = fitz.open()

page1 = doc.new_page()
page1.insert_text((72, 72), "Introduction", fontsize=14, fontname="helv")
page1.insert_text((72, 100), "Experimental values were measured across three", fontsize=11, fontname="helv")
page1.insert_text((72, 800), "2024", fontsize=8, fontname="helv")

page2 = doc.new_page()
page2.insert_text((72, 72), "trials to assess performance under load.", fontsize=11, fontname="helv")
page2.insert_text((72, 800), "2024", fontsize=8, fontname="helv")

page3 = doc.new_page()
page3.insert_text((72, 72), "A separate note follows here for completeness.", fontsize=11, fontname="helv")
page3.insert_text((72, 800), "2024", fontsize=8, fontname="helv")

doc.save(sys.argv[1])
`,
      "page-number-not-tracking.pdf",
    );

    const result = await extractPdfTextFromPath(pdfPath);

    expect(result.ok).toBe(true);
    const introduction = result.doc?.sections.find((section) => section.canonical === "introduction");
    // "2024" repeated as-is (not incrementing with the page) never shares a
    // single k = value - page_index across pages, so it must stay exactly
    // where the PDF put it — the un-tracking case a fuzzy matcher would get
    // wrong.
    expect(introduction?.text).toBe(
      "Experimental values were measured across three 2024 trials to assess performance under load. " +
        "2024 A separate note follows here for completeness. 2024",
    );
  });
});

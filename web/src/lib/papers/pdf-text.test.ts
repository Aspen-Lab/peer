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

/** One run of text: the words, x, y measured from the TOP of an A4 page (the
 *  way the old PyMuPDF fixtures placed them), the size, and whether it is set
 *  in the bold face. */
type Run = [text: string, x: number, top: number, size: number, bold?: boolean];

/**
 * A real, minimal PDF — one text layer, base-14 Helvetica — built in the test
 * so pdf.js reads it exactly as it reads a paper. No dependency and no
 * Python: the fixtures the PyMuPDF tests used to draw are drawn here. A page
 * with no runs is a page with no text layer, the way a scan reads.
 */
function minimalPdf(pages: Run[][]): Buffer {
  const objects: string[] = [];
  const add = (body: string) => objects.push(body);
  add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>");
  add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>");
  const pagesId = add("");
  const kids: number[] = [];
  const escape = (s: string) => s.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
  for (const runs of pages) {
    const stream = runs
      .map(([text, x, top, size, bold]) => `BT /${bold ? "F2" : "F1"} ${size} Tf ${x} ${842 - top} Td (${escape(text)}) Tj ET`)
      .join("\n");
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

/** Prose lines, `pitch` apart, starting at `top`. */
function prose(lines: string[], top: number, pitch = 14): Run[] {
  return lines.map((text, i): Run => [text, 72, top + i * pitch, 11]);
}

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

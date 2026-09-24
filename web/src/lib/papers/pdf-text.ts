// Downloads a legal PDF and reads it into the same shape as the HTML
// extractors.
//
// The URL path used to hand the bytes to `scripts/extract_pdf_text.py`,
// which needs Python and PyMuPDF — a compiled extension. A developer's
// machine has both; a deployed Peer has neither, so every PDF-only paper
// read as "abstract only" in production while reading fine locally, and the
// page had to say so ("only a self-hosted Peer reads PDFs"). That reading is
// plain TypeScript now — `pdf-outline.ts` over pdf.js's text layer — so one
// behaviour runs in both places. What a scan (a PDF with no text layer)
// cannot give, it still cannot give; that now reads as what it is.
//
// Merge note (2026-09-23): `extractPdfTextFromPath` — the private-upload
// feature's from-disk path (an uploaded PDF already on this server's own
// disk, see `papers/upload-store.ts`) — still runs the Python helper. That
// feature is already documented (HANDOFF-upload-profile-fulltext-pdf.md
// §6.5) as not yet production-storage-ready, so porting it off Python is
// separate follow-up work, not something to fold in silently here.

import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { cleanDisplayText } from "@/lib/text/clean";
import { buildOutline, type PdfOutline, type PdfPageText } from "./pdf-outline";
import { withInheritedBuckets } from "./html-text";
import type { ExtractedDocument, ExtractedSection, ExtractedFigureCaption } from "./html-text";

const execFileAsync = promisify(execFile);

const FETCH_TIMEOUT_MS = 12_000;
const MAX_PDF_BYTES = 18_000_000;
const MAX_STDIO_BYTES = 18_000_000;
// S3 (2026-09-15 ruling): 100 pages, up from 40 — a full paper's text reaching
// pass 1 needs the extractor to see the whole PDF, not the first 40 pages.
// Shared by both extraction paths below (the pdf.js page loop and the
// Python helper's `--max-pages`) so neither quietly reads a shorter paper
// than the other. Extracted text (no embedded images, unlike
// extract_pdf_figures.py) stays well under MAX_STDIO_BYTES even at 100 pages.
const MAX_PDF_PAGES = 100;
const FETCH_VERSION = "2026-05-01-pdf-text";

interface ExtractorSection {
  heading?: string;
  canonical?: string;
  page?: number;
  text?: string;
}

interface ExtractorCaption {
  ordinal?: number;
  label?: string;
  caption?: string;
  page?: number;
}

interface ExtractorOutput {
  title?: string | null;
  sections?: ExtractorSection[];
  figureCaptions?: ExtractorCaption[];
  pageCount?: number;
  /** 2-06, step (b): page 1's raw joined text, for the upload route's
   *  small-tier-model title fallback when extract_title (step a) can't
   *  produce one — never carried in `sections`, which drops everything
   *  before the first recognized heading. */
  page1Text?: string;
  reason?: string | null;
}

export interface PdfTextResult {
  ok: boolean;
  doc?: ExtractedDocument;
  reason?: string;
  /**
   * The HTTP status the PDF fetch itself returned, when the failure happened
   * there (not on a later step like the byte-size or magic-bytes checks).
   * `full-text.ts`'s `tryPdfLink` uses this to tell a real paywall/access
   * gate (401/402/403/451) from every other "could not get the PDF" reason —
   * see 1-16.
   */
  status?: number;
  /** 2-06, step (b): forwarded from `ExtractorOutput.page1Text` — see there. */
  page1Text?: string;
}

async function downloadPdf(
  url: string,
): Promise<{ bytes: Buffer; finalUrl: string } | { error: string; status?: number }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      cache: "no-store",
      headers: {
        "User-Agent": "PeerBot/0.1 (+https://peer.research)",
        "X-Peer-Text-Version": FETCH_VERSION,
        Accept: "application/pdf,*/*;q=0.8",
      },
    });
    // 1-16: `status` rides along so the caller can tell a real paywall/access
    // gate (401/402/403/451) from any other non-2xx — previously only the
    // reason *string* reached the caller, and "PDF fetch returned 403"
    // matches no paywall-phrase regex, so every hard-403 was reported as
    // plain "source unavailable".
    if (!res.ok) return { error: `PDF fetch returned ${res.status}`, status: res.status };

    const lengthHeader = Number.parseInt(res.headers.get("content-length") ?? "", 10);
    if (Number.isFinite(lengthHeader) && lengthHeader > MAX_PDF_BYTES) {
      return { error: "PDF too large for safe extraction." };
    }

    const bytes = Buffer.from(await res.arrayBuffer());
    if (bytes.byteLength === 0) return { error: "PDF response was empty." };
    if (bytes.byteLength > MAX_PDF_BYTES) return { error: "PDF too large for safe extraction." };
    if (bytes.subarray(0, 5).toString("ascii") !== "%PDF-") {
      return { error: "Response was not a PDF (likely a landing/paywall page)." };
    }
    return { bytes, finalUrl: res.url || url };
  } catch (err) {
    return { error: String(err) };
  } finally {
    clearTimeout(timer);
  }
}

const BYTES_TTL_MS = 15 * 60 * 1000;
const BYTES_KEEP = 6;
const recentBytes = new Map<string, { bytes: Buffer; ts: number }>();

/**
 * The PDF at `url`, from the last quarter-hour's downloads where it was one
 * of them. Six at most, oldest out first — a few megabytes each, on a
 * function that also holds the text cache.
 */
export async function getPdfBytes(url: string): Promise<{ bytes: Buffer } | { error: string; status?: number }> {
  const hit = recentBytes.get(url);
  if (hit && Date.now() - hit.ts < BYTES_TTL_MS) return { bytes: hit.bytes };
  const download = await downloadPdf(url);
  if ("error" in download) return download;
  recentBytes.set(url, { bytes: download.bytes, ts: Date.now() });
  while (recentBytes.size > BYTES_KEEP) {
    const oldest = recentBytes.keys().next().value;
    if (oldest === undefined) break;
    recentBytes.delete(oldest);
  }
  return { bytes: download.bytes };
}

/** The PDF's text layer, page by page, as `pdf-outline` wants it. Exported
 *  for the probes that look at a real PDF's lines when the outline misreads. */
export async function readPages(bytes: Buffer): Promise<PdfPageText[]> {
  // `unpdf` ships pdf.js built for a server runtime: no worker, no canvas,
  // no native code — the only build that runs unchanged in a function.
  const { getDocumentProxy } = await import("unpdf");
  const doc = await getDocumentProxy(new Uint8Array(bytes));
  const pages: PdfPageText[] = [];
  const count = Math.min(doc.numPages, MAX_PDF_PAGES);
  for (let n = 1; n <= count; n++) {
    const page = await doc.getPage(n);
    const content = await page.getTextContent();
    const items: PdfPageText["items"] = [];
    for (const item of content.items) {
      if (!("str" in item) || typeof item.str !== "string") continue;
      const transform = item.transform as number[] | undefined;
      if (!transform) continue;
      // Sideways text is the page's, not the paper's: the arXiv stamp down
      // the left margin is set larger than the title and read as one.
      if (Math.abs(transform[1] ?? 0) > 0.1 || Math.abs(transform[2] ?? 0) > 0.1) continue;
      items.push({
        str: item.str,
        height: typeof item.height === "number" && item.height > 0 ? item.height : Math.abs(transform[3] ?? 0),
        width: typeof item.width === "number" ? item.width : 0,
        fontName: String(item.fontName ?? ""),
        x: transform[4] ?? 0,
        y: transform[5] ?? 0,
      });
    }
    pages.push({ page: n, items });
  }
  return pages;
}

function normalize(extractor: PdfOutline): ExtractedDocument {
  // Numbered subsections inherit their parent's bucket here too — the same
  // one-heading-at-a-time bucketing the HTML extractor and the Python path's
  // own `normalizePythonOutput` (below) both use.
  const sections: ExtractedSection[] = withInheritedBuckets(
    (extractor.sections ?? [])
    .map((section) => ({
      heading: cleanDisplayText(section.heading) || "Body",
      canonical: section.canonical || "body",
      text: cleanDisplayText(section.text),
    }))
    .filter((section) => section.text.length > 0),
  );

  const pageCount = typeof extractor.pageCount === "number" ? extractor.pageCount : undefined;
  const figureCaptions: ExtractedFigureCaption[] = (extractor.figureCaptions ?? [])
    .map((cap, index) => ({
      ordinal: typeof cap.ordinal === "number" ? cap.ordinal : index,
      label: cleanDisplayText(cap.label) || `Figure ${index + 1}`,
      caption: cleanDisplayText(cap.caption),
      ...(typeof cap.page === "number" ? { page: cap.page } : {}),
      // Its place in the document, so a figure the prose never names by
      // number still lands near where the paper put it.
      ...(typeof cap.page === "number" && pageCount ? { at: (cap.page - 0.5) / pageCount } : {}),
    }))
    .filter((cap) => cap.caption.length > 0);

  const equations = (extractor.equations ?? [])
    .map((eq) => ({ text: cleanDisplayText(eq.text), ...(eq.number ? { number: eq.number } : {}) }))
    .filter((eq) => eq.text.length > 0);

  return {
    title: cleanDisplayText(extractor.title) || null,
    sections,
    figureCaptions,
    ...(equations.length > 0 ? { equations } : {}),
    source: "pdf",
    pageCount,
    reason: extractor.reason ?? null,
  };
}

/**
 * Download a legal PDF and extract sectioned text + figure captions. The
 * URL path: pdf.js over a server-safe build (`unpdf`), so it reads the same
 * way on a developer's machine and on a deployed Peer.
 */
export async function tryExtractPdfText(url: string): Promise<PdfTextResult> {
  const download = await getPdfBytes(url);
  if ("error" in download) {
    return { ok: false, reason: download.error, status: download.status };
  }

  try {
    const pages = await readPages(download.bytes);
    const outline = buildOutline(pages);
    if (!outline.sections || outline.sections.length === 0) {
      // A scan carries pictures of words, not words: say that, rather than
      // "no full text" as if the paper had none.
      return { ok: false, reason: outline.reason ?? "no-sections" };
    }
    return { ok: true, doc: normalize(outline) };
  } catch (err) {
    console.warn("[papers/pdf-text] read failed:", err);
    return { ok: false, reason: String(err) };
  }
}

/**
 * Why the helper did not run. `no-python` and `no-script` are the two the
 * reading page names: on Vercel no interpreter can be spawned, or the helper
 * script is missing from a function bundle it was not traced into, and the
 * page must say plainly that the PDF is there and this deployment cannot read
 * it, rather than "no full text" as if the paper had none. Both reach the
 * caller as a machine reason (`no-python` / `no-extractor`), never as prose.
 */
type ExtractorFailure = "no-python" | "no-script" | "failed";

function resolveHelperScript(): string | null {
  const candidates = [
    path.join(process.cwd(), "scripts", "extract_pdf_text.py"),
    path.join(process.cwd(), "web", "scripts", "extract_pdf_text.py"),
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

async function runExtractor(
  pdfPath: string,
): Promise<{ output: ExtractorOutput } | { failure: ExtractorFailure }> {
  const helperScript = resolveHelperScript();
  if (!helperScript) return { failure: "no-script" };

  // macOS and most Linux images ship `python3` and no `python`; the old list
  // tried `python` then `py -3`, so on a Mac every PDF quietly yielded null.
  const runners = [
    ...(process.env.PYTHON_BIN
      ? [{ command: process.env.PYTHON_BIN, args: [] as string[] }]
      : []),
    { command: "python3", args: [] as string[] },
    { command: "python", args: [] as string[] },
    { command: "py", args: ["-3"] },
  ];

  for (const runner of runners) {
    try {
      const { stdout } = await execFileAsync(
        runner.command,
        [
          ...runner.args,
          helperScript,
          "--input",
          pdfPath,
          "--max-pages",
          String(MAX_PDF_PAGES),
        ],
        // Raised from 45s alongside MAX_PDF_PAGES 40 -> 100: PyMuPDF text
        // extraction (no image work, unlike the figure extractor) scales
        // roughly linearly with page count, so the old timeout tuned for 40
        // pages was tight for the new cap.
        { timeout: 100_000, maxBuffer: MAX_STDIO_BYTES },
      );
      // MuPDF prints format warnings ("cmsOpenProfileFromMem failed") to
      // stdout ahead of the JSON; take the document from its first brace.
      const start = stdout.indexOf("{");
      if (start < 0) throw new Error("PDF text helper produced no JSON");
      return { output: JSON.parse(stdout.slice(start)) as ExtractorOutput };
    } catch (err) {
      const message = String(err);
      // Windows ships a `python3` that is not Python: a Store alias stub that
      // prints "Python was not found" and exits 9009. It is not ENOENT, so it
      // used to end the search here and the real `python` two entries down
      // was never tried — every deep report on this machine read no PDF.
      if (/not recognized|ENOENT|Python was not found/i.test(message)) continue;
      console.warn("[papers/pdf-text] extractor failed:", err);
      return { failure: "failed" };
    }
  }
  return { failure: "no-python" };
}

function normalizePythonOutput(extractor: ExtractorOutput): ExtractedDocument {
  // Numbered subsections inherit their parent's bucket here too — the Python
  // extractor buckets one heading at a time, the same way the HTML one did.
  const sections: ExtractedSection[] = withInheritedBuckets(
    (extractor.sections ?? [])
    .map((section) => ({
      heading: cleanDisplayText(section.heading) || "Body",
      canonical: section.canonical || "body",
      text: cleanDisplayText(section.text),
    }))
    .filter((section) => section.text.length > 0),
  );

  const figureCaptions: ExtractedFigureCaption[] = (extractor.figureCaptions ?? [])
    .map((cap, index) => ({
      ordinal: typeof cap.ordinal === "number" ? cap.ordinal : index,
      label: cleanDisplayText(cap.label) || `Figure ${index + 1}`,
      caption: cleanDisplayText(cap.caption),
    }))
    .filter((cap) => cap.caption.length > 0);

  return {
    title: cleanDisplayText(extractor.title) || null,
    sections,
    figureCaptions,
    source: "pdf",
    pageCount: typeof extractor.pageCount === "number" ? extractor.pageCount : undefined,
    reason: extractor.reason ?? null,
  };
}

/**
 * Run the Python extractor against a PDF that already lives on disk, and
 * normalize its output. Split out of the old `tryExtractPdfText` (1-24) for
 * an uploaded PDF (`web/.local-data/uploads/<hash16>.pdf`, see
 * `papers/upload-store.ts`): the file is already private, server-local
 * storage, so there is no reason to download it again or copy it into a
 * *second* temp path only to run the same extractor — the caller owns the
 * file's lifetime (for an upload, that's "as long as the upload exists on
 * disk", not "for the duration of this one extraction"), so this function
 * has no temp-dir lifecycle of its own.
 *
 * Still Python-based (see the merge note at the top of this file) — the
 * URL path above moved to pdf.js in production; this from-disk path has
 * not, because the feature that calls it is not yet deployed.
 */
export async function extractPdfTextFromPath(pdfPath: string): Promise<PdfTextResult> {
  const ran = await runExtractor(pdfPath);
  if ("failure" in ran) {
    return {
      ok: false,
      reason:
        ran.failure === "no-python"
          ? "no-python"
          : ran.failure === "no-script"
            ? "no-extractor"
            : "PDF text extractor failed on this server.",
    };
  }
  const extractor = ran.output;
  if (extractor.reason && (!extractor.sections || extractor.sections.length === 0)) {
    return { ok: false, reason: extractor.reason };
  }
  const doc = normalizePythonOutput(extractor);
  return { ok: true, doc, page1Text: extractor.page1Text };
}

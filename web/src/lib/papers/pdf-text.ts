// Reads a PDF into the same shape as the HTML extractors — a legal PDF
// downloaded from a link, or a private upload already in its storage (disk or a
// private bucket).
//
// Both paths used to hand the bytes to `scripts/extract_pdf_text.py`, which
// needs Python and PyMuPDF — a compiled extension. A developer's machine has
// both; a deployed Peer has neither, so every PDF-only paper read as
// "abstract only" in production while reading fine locally, and the page had
// to say so ("only a self-hosted Peer reads PDFs"). That reading is plain
// TypeScript now — `pdf-outline.ts` over pdf.js's text layer — so one
// behaviour runs in both places. What a scan (a PDF with no text layer)
// cannot give, it still cannot give; that now reads as what it is.
//
// Merge note, closed (P0-03, 2026-10-05): the upload path was the last caller
// of the Python helper; it is deleted (decision 3 of the goal-directed-reading
// blueprint: one path, one behaviour). A private upload is read from its
// storage's bytes (`extractPdfTextFromBytes`, whichever backend holds it —
// `papers/upload-store.ts`) by the same `readPages` → `buildOutline` →
// `normalize` as a link; `extractPdfTextFromPath` is the same reading for a
// file on disk. The Python figure extractor (`lib/figures/pdf-extract.ts`) is
// separate and unchanged.

import { readFile } from "node:fs/promises";
import { cleanDisplayText } from "@/lib/text/clean";
import { buildOutline, linesOfPage, type PdfOutline, type PdfPageText } from "./pdf-outline";
import { withInheritedBuckets, withSectionIds } from "./html-text";
import type { ExtractedDocument, ExtractedSection, ExtractedFigureCaption } from "./html-text";

const FETCH_TIMEOUT_MS = 12_000;
const MAX_PDF_BYTES = 18_000_000;
// S3 (2026-09-15 ruling): 100 pages, up from 40 — a full paper's text reaching
// pass 1 needs the extractor to see the whole PDF, not the first 40 pages.
// The one page loop below (`readPages`) serves a link and an upload alike.
const MAX_PDF_PAGES = 100;
const FETCH_VERSION = "2026-05-01-pdf-text";

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
  /**
   * 2-06, step (b) — uploads only: page 1's lines as printed, joined with
   * spaces, before any of them is set aside as the cover. The upload route
   * searches it for a DOI and hands it to the small-tier title fallback;
   * `sections` drops everything above the paper's first named part, which is
   * exactly where a title and a DOI are printed.
   */
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
  // one-heading-at-a-time bucketing the HTML extractor uses. P0-01: each section keeps
  // the page its heading sits on (the outline always knew it; this used to
  // drop it), and the ids are numbered last, so they follow the final order.
  const sections: ExtractedSection[] = withSectionIds(
    withInheritedBuckets(
      (extractor.sections ?? [])
        .map((section) => ({
          heading: cleanDisplayText(section.heading) || "Body",
          canonical: section.canonical || "body",
          text: cleanDisplayText(section.text),
          ...(typeof section.page === "number" ? { page: section.page } : {}),
        }))
        .filter((section) => section.text.length > 0),
    ),
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
 * The same reading as `tryExtractPdfText`, for a PDF already in hand — a
 * private upload, read from its storage (`papers/upload-store.ts`): its bytes
 * through pdf.js (`readPages`), the outline (`buildOutline`), and the same
 * `normalize`. Also hands back page 1's text, which the upload route's title
 * fallback and DOI search read: `sections` drops everything before the first
 * heading, where a title is printed.
 *
 * P0-03 (spec D3): there is no Python helper. A scan — no text layer, or no
 * sections in what text there is — comes back as `{ ok: false, reason:
 * "no-text-layer" | "no-sections" }`; the callers that report it to the reader
 * (`full-text.ts`, the upload route) turn that into the `pdf-empty` marker the
 * reading page looks for to say "this PDF has no readable text".
 */
export async function extractPdfTextFromBytes(bytes: Buffer): Promise<PdfTextResult> {
  try {
    const pages = await readPages(bytes);
    // Page 1's lines as printed, joined with spaces, before any of them is set
    // aside as the cover.
    const page1Text = pages[0]
      ? linesOfPage(pages[0])
          .map((line) => line.text)
          .join(" ")
          .replace(/\s+/g, " ")
          .trim()
      : "";
    const outline = buildOutline(pages);
    if (!outline.sections || outline.sections.length === 0) {
      return { ok: false, reason: outline.reason ?? "no-sections", page1Text: page1Text || undefined };
    }
    return { ok: true, doc: normalize(outline), page1Text: page1Text || undefined };
  } catch (err) {
    // The file is not a PDF pdf.js can open. Not a scan: say it failed. The
    // error names the problem, never the text.
    console.warn("[papers/pdf-text] read failed:", err);
    return { ok: false, reason: String(err) };
  }
}

/**
 * The same reading for a PDF that already lives on this machine's disk (the
 * caller owns the file's lifetime; nothing is copied or downloaded). A scan
 * comes back as `{ ok: false, reason: "pdf-empty: …" }`: `pdf-empty` is the
 * marker the reading page looks for to say "this PDF has no readable text".
 * The app reads uploads through `extractPdfTextFromBytes`, whichever storage
 * holds the file; this entry point is the path-shaped form of it. It has no
 * production caller and stays on purpose: `pdf-text.test.ts` reads its synthetic
 * layouts through it.
 */
export async function extractPdfTextFromPath(pdfPath: string): Promise<PdfTextResult> {
  let bytes: Buffer;
  try {
    bytes = await readFile(pdfPath);
  } catch (err) {
    // Not readable at all. Not a scan: say it failed. The error names the
    // problem, never the text.
    console.warn("[papers/pdf-text] could not read a PDF file:", err instanceof Error ? err.message : String(err));
    return { ok: false, reason: "PDF text extractor failed on this server." };
  }
  const result = await extractPdfTextFromBytes(bytes);
  if (result.ok) return result;
  if (result.reason === "no-text-layer" || result.reason === "no-sections") {
    return { ok: false, reason: `pdf-empty: ${result.reason}`, page1Text: result.page1Text };
  }
  return { ok: false, reason: "PDF text extractor failed on this server." };
}

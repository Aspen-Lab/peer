// Downloads a legal PDF and reads it into the same shape as the HTML
// extractors.
//
// It used to hand the bytes to `scripts/extract_pdf_text.py`, which needs
// Python and PyMuPDF — a compiled extension. A developer's machine has both;
// a deployed Peer has neither, so every PDF-only paper read as "abstract
// only" in production while reading fine locally, and the page had to say so
// ("only a self-hosted Peer reads PDFs"). The reading is plain TypeScript
// now — `pdf-outline.ts` over pdf.js's text layer — so one behaviour runs in
// both places. What a scan (a PDF with no text layer) cannot give, it still
// cannot give; that now reads as what it is.

import { cleanDisplayText } from "@/lib/text/clean";
import { buildOutline, type PdfOutline, type PdfPageText } from "./pdf-outline";
import { withInheritedBuckets } from "./html-text";
import type { ExtractedDocument, ExtractedSection, ExtractedFigureCaption } from "./html-text";

const FETCH_TIMEOUT_MS = 12_000;
const MAX_PDF_BYTES = 18_000_000;
const MAX_PDF_PAGES = 40;
const FETCH_VERSION = "2026-05-01-pdf-text";

export interface PdfTextResult {
  ok: boolean;
  doc?: ExtractedDocument;
  reason?: string;
}

async function downloadPdf(url: string): Promise<{ bytes: Buffer; finalUrl: string } | { error: string }> {
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
    if (!res.ok) return { error: `PDF fetch returned ${res.status}` };

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
export async function getPdfBytes(url: string): Promise<{ bytes: Buffer } | { error: string }> {
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
 * Download a legal PDF and extract sectioned text + figure captions.
 */
export async function tryExtractPdfText(url: string): Promise<PdfTextResult> {
  const download = await getPdfBytes(url);
  if ("error" in download) {
    return { ok: false, reason: download.error };
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

// Adapted from DeerFlow's MIT-licensed PDF-first retrieval approach.
// See docs/THIRD_PARTY_NOTICES.md.

import { readFile } from "node:fs/promises";
import { classifyHardAccessStatus } from "@/lib/papers/paywall-status";
import { cleanDisplayText } from "@/lib/text/clean";
import { extractPdfFigures, MAX_PDF_BYTES } from "./pdf-engine";

const FETCH_TIMEOUT_MS = 10_000;
const MAX_PDF_PAGES = 24;
/**
 * The whole-document pool's figures, in document order. P12-56 (R14a): 24, from 12. A Nature paper prints up to ten
 * Extended Data figures after its eight or so main ones, and at 12 the pool stopped before the last of them, so a
 * report that bound one found no picture for it. 24 is the ceiling the sizing already has (`MEASURE_MAX` in
 * `pdf-text.ts`). The work it adds is one render per figure past the twelfth (a PNG of at most 4.5 megapixels,
 * about a megabyte as a `data:` URL) on a paper that has them; the clock (`EXTRACTION_BUDGET_MS`) and the 24 pages
 * read still bound the call, and a paper of 12 figures or fewer is read exactly as before.
 */
const MAX_PDF_FIGURES = 24;
const FETCH_VERSION = "2026-05-01-pdf-vision";
const OPEN_ACCESS_HOST_PATTERNS = [
  /(^|\.)pmc\.ncbi\.nlm\.nih\.gov$/i,
  /(^|\.)arxiv\.org$/i,
  /(^|\.)ar5iv\.labs\.arxiv\.org$/i,
  /(^|\.)biorxiv\.org$/i,
  /(^|\.)medrxiv\.org$/i,
];

type FigureSource = "semantic-scholar" | "ar5iv" | "publisher" | "open-access" | "og";

export interface PdfFigureCandidate {
  imageUrl: string;
  caption?: string | null;
  source: FigureSource;
  ordinal: number;
  /**
   * PDF-rendered figures are always rasterized at ~200 DPI from vector
   * source, so they're guaranteed high-resolution. Surfacing this lets the
   * shared figure scorer prefer them over publisher HTML thumbnails (which
   * often embed images at 440px wide with no URL hint).
   */
  qualityHint?: "high" | "medium" | "low";
}

export interface PdfAttemptResult {
  status: "candidates" | "paywalled" | "no_figures" | "source_unavailable";
  candidates: PdfFigureCandidate[];
  reason?: string;
}

function paywallReason(url: string): string {
  try {
    const host = new URL(url).hostname.replace(/^www\./, "");
    return `Peer reached ${host}, but that source appears to require paid or institutional access for figures.`;
  } catch {
    return "Peer reached the source, but it appears to require paid or institutional access for figures.";
  }
}

/**
 * 2-01 (Ruling 9, §1j): an aggregator/free host's own 401/402/403/451 is an
 * anti-bot block, not a subscription gate — worded separately from
 * `paywallReason` so figure-lookup honesty never claims a paywall on a host
 * that was never a publisher in the first place.
 */
function blockedReason(url: string): string {
  try {
    const host = new URL(url).hostname.replace(/^www\./, "");
    return `Peer reached ${host}, but that source blocked this request.`;
  } catch {
    return "Peer reached the source, but it blocked this request.";
  }
}

function hostLooksOpenAccess(url: string): boolean {
  try {
    const host = new URL(url).hostname;
    return OPEN_ACCESS_HOST_PATTERNS.some((pattern) => pattern.test(host));
  } catch {
    return false;
  }
}

function appearsPaywalled(res: Response, html: string): boolean {
  if (hostLooksOpenAccess(res.url)) return false;
  if (/captcha/i.test(html)) return true;
  const lowered = html.toLowerCase();
  const phrases = [
    "purchase access",
    "buy this article",
    "access through your institution",
    "institutional access",
    "sign in to access",
    "log in to access",
    "subscribe to continue",
    "subscription required",
    "preview of subscription content",
    "rent this article",
    "subscribe for full access",
  ];
  return phrases.some((phrase) => lowered.includes(phrase)) && !/creative commons|cc-by|free full text|open access/i.test(html);
}

// EuropePMC, JSTOR, and several publisher CDNs explicitly 403 any UA matching
// the "Bot" pattern. Since we're fetching legal open-access PDFs that those
// hosts make available to readers, send a real browser UA. Peer still
// identifies itself via X-Peer-Figure-Version for server logs that care.
const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Peer/0.1";

async function fetchPdfResponse(url: string): Promise<Response | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    return await fetch(url, {
      signal: controller.signal,
      cache: "no-store",
      redirect: "follow",
      headers: {
        "User-Agent": BROWSER_UA,
        "X-Peer-Figure-Version": FETCH_VERSION,
        Accept: "application/pdf,text/html,application/xhtml+xml;q=0.9,*/*;q=0.8",
      },
    });
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function decodePreview(bytes: Buffer): string {
  return bytes.toString("utf-8", 0, Math.min(bytes.byteLength, 25_000));
}

export async function tryPdfCandidates(
  url: string,
  source: FigureSource,
): Promise<PdfAttemptResult> {
  const res = await fetchPdfResponse(url);
  if (!res || !res.ok) {
    // 2-01 (Ruling 9, §1j): a hard 401/402/403/451 on an aggregator/free
    // host is a block, not a paywall — the shared helper's own host list
    // replaces this call site's narrower `hostLooksOpenAccess` guard (still
    // used below by the phrase-based `appearsPaywalled`, unrelated to this).
    if (res) {
      const verdict = classifyHardAccessStatus(url, res.status);
      if (verdict === "paywalled") return { status: "paywalled", candidates: [], reason: paywallReason(url) };
      if (verdict === "blocked") return { status: "source_unavailable", candidates: [], reason: blockedReason(url) };
    }
    return {
      status: "source_unavailable",
      candidates: [],
      reason: `Peer could not reach ${url}.`,
    };
  }

  const contentLength = Number.parseInt(res.headers.get("content-length") ?? "", 10);
  if (Number.isFinite(contentLength) && contentLength > MAX_PDF_BYTES) {
    return {
      status: "source_unavailable",
      candidates: [],
      reason: "The legal PDF source was reachable, but the file was too large for Peer to extract safely.",
    };
  }

  const bytes = Buffer.from(await res.arrayBuffer());
  if (bytes.byteLength === 0) {
    return {
      status: "source_unavailable",
      candidates: [],
      reason: "The legal PDF source returned an empty file.",
    };
  }
  if (bytes.byteLength > MAX_PDF_BYTES) {
    return {
      status: "source_unavailable",
      candidates: [],
      reason: "The legal PDF source was reachable, but the file was too large for Peer to extract safely.",
    };
  }

  const looksLikePdf =
    (res.headers.get("content-type") ?? "").toLowerCase().includes("pdf") ||
    bytes.subarray(0, 5).toString("ascii") === "%PDF-";
  if (!looksLikePdf) {
    const preview = decodePreview(bytes);
    if (appearsPaywalled(res, preview)) {
      return {
        status: "paywalled",
        candidates: [],
        reason: paywallReason(res.url || url),
      };
    }
    return {
      status: "source_unavailable",
      candidates: [],
      reason: "The source looked like a landing page instead of a figure-readable PDF file.",
    };
  }

  return extractPdfCandidatesFromBytes(bytes, source);
}

/**
 * Run the figure engine against a PDF that already lives on disk. Split out of
 * `tryPdfCandidates` (1-25, mirrors `papers/pdf-text.ts`'s 1-24) for an
 * uploaded PDF: the file is already private, server-local storage, so it is
 * read once into memory and handed to the engine — no second copy on disk, no
 * temp directory, and the caller still owns the file's lifetime.
 */
export async function extractPdfCandidatesFromPath(
  pdfPath: string,
  source: FigureSource,
): Promise<PdfAttemptResult> {
  try {
    return await extractPdfCandidatesFromBytes(await readFile(pdfPath), source);
  } catch (err) {
    console.warn("[figures/pdf-extract] failed:", err);
    return unfinished();
  }
}

/**
 * Run the figure engine (`pdf-engine.ts`, MuPDF's WASM build, in this process)
 * on a PDF's bytes and map each figure to a candidate: the PNG as a
 * `data:image/png;base64,…` URL, `qualityHint: "high"`. Nothing touches the
 * disk — two users' PDFs extracted at once cannot meet in a shared file.
 */
export async function extractPdfCandidatesFromBytes(
  bytes: Uint8Array,
  source: FigureSource,
): Promise<PdfAttemptResult> {
  try {
    const extracted = await extractPdfFigures(bytes, {
      maxPages: MAX_PDF_PAGES,
      maxFigures: MAX_PDF_FIGURES,
    });

    const candidates = extracted.figures
      .filter((figure) => figure.png.byteLength > 0)
      .map((figure): PdfFigureCandidate => {
        const png = Buffer.from(figure.png.buffer, figure.png.byteOffset, figure.png.byteLength);
        return {
          imageUrl: `data:image/png;base64,${png.toString("base64")}`,
          caption: cleanDisplayText(figure.caption),
          source,
          ordinal: figure.ordinal,
          qualityHint: "high",
        };
      });

    if (candidates.length === 0) {
      return {
        status: "no_figures",
        candidates: [],
        reason:
          cleanDisplayText(extracted.reason) ||
          "Peer opened a legal PDF for this paper, but did not extract any usable figures from it.",
      };
    }

    return {
      status: "candidates",
      candidates,
      reason: cleanDisplayText(extracted.reason),
    };
  } catch (err) {
    console.warn("[figures/pdf-extract] failed:", err);
    return unfinished();
  }
}

function unfinished(): PdfAttemptResult {
  return {
    status: "source_unavailable",
    candidates: [],
    reason: "Peer found a legal PDF, but could not finish extracting its figures.",
  };
}

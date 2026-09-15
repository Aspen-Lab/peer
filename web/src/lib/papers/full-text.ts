// Full-text orchestrator for deep paper reports.
//
// Given a paper identifier, walks the prioritized source-link list and
// returns the first source that yields useful sectioned text. HTML hosts
// (ar5iv, PMC, bioRxiv, OA publishers) are tried first because their text
// is cleaner and cheaper to parse than PDF. PDF is the fallback.
//
// Output is cached per paper for 1 hour so repeated report renders / figure
// binding share the same fetch.

import {
  chooseHtmlExtractor,
  looksLikeFullText,
  type ExtractedDocument,
} from "./html-text";
import { classifyHardAccessStatus } from "./paywall-status";
import { extractPdfTextFromPath, tryExtractPdfText } from "./pdf-text";
import { collectSourceLinks, type SourceLink } from "./source-links";
import { bareUploadId, pdfPath } from "./upload-store";

const FETCH_TIMEOUT_MS = 12_000;
const MAX_HTML_BYTES = 4_000_000;
const CACHE_TTL_MS = 60 * 60 * 1000;

export interface FullTextInput {
  paperId: string;
  url?: string | null;
  doi?: string | null;
  arxivId?: string | null;
  openAlexId?: string | null;
}

export type FullTextStatus =
  | "ok"
  | "paywalled"
  | "no_full_text"
  | "source_unavailable";

export interface FullTextResult {
  status: FullTextStatus;
  /** The extracted document — only populated when status === "ok". */
  doc?: ExtractedDocument;
  /** Which source link supplied the document. */
  sourceLink?: SourceLink;
  /** Human-readable reason for non-ok statuses (used in paywall banner). */
  reason?: string;
  /** Every link we tried, for telemetry / debugging. */
  attempts: Array<{ link: SourceLink; outcome: string }>;
}

interface CachedResult {
  result: FullTextResult;
  ts: number;
}

const cache = new Map<string, Promise<FullTextResult> | CachedResult>();

const PAYWALL_PHRASES = [
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

function appearsPaywalled(html: string): boolean {
  if (/captcha/i.test(html)) return true;
  const lowered = html.toLowerCase();
  const hasPaywallPhrase = PAYWALL_PHRASES.some((p) => lowered.includes(p));
  const looksOpen = /creative commons|cc-by|free full text|open access/i.test(html);
  return hasPaywallPhrase && !looksOpen;
}

async function fetchHtml(url: string): Promise<{ ok: true; html: string; finalUrl: string; res: Response } | { ok: false; reason: string; isPdf?: boolean; status?: number }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      cache: "no-store",
      headers: {
        "User-Agent": "PeerBot/0.1 (+https://peer.research)",
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
    });
    if (!res.ok) return { ok: false, reason: `Fetch returned ${res.status}`, status: res.status };

    const contentType = res.headers.get("content-type") ?? "";
    // Some PDF links serve directly when the URL looks HTML — let the PDF
    // path handle them by signalling no-HTML here.
    if (/pdf/i.test(contentType)) return { ok: false, reason: "Server returned PDF, not HTML.", isPdf: true };
    if (contentType && !/html|xml/i.test(contentType)) {
      return { ok: false, reason: `Unsupported content-type: ${contentType}` };
    }

    const reader = res.body?.getReader();
    if (!reader) {
      const html = await res.text();
      return { ok: true, html, finalUrl: res.url || url, res };
    }
    const decoder = new TextDecoder("utf-8");
    let bytes = 0;
    let out = "";
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      out += decoder.decode(value, { stream: true });
      if (bytes >= MAX_HTML_BYTES) {
        try { await reader.cancel(); } catch { /* ignore */ }
        break;
      }
    }
    out += decoder.decode();
    return { ok: true, html: out, finalUrl: res.url || url, res };
  } catch (err) {
    return { ok: false, reason: String(err) };
  } finally {
    clearTimeout(timer);
  }
}

async function tryHtmlLink(link: SourceLink): Promise<{ status: FullTextStatus; doc?: ExtractedDocument; reason?: string }> {
  const fetched = await fetchHtml(link.url);
  if (!fetched.ok) {
    // A link filed as HTML that serves a PDF is read as one, here, rather
    // than dropped. This is how every arXiv paper lost its full text: the
    // caller's `arxiv.org/pdf/<id>` has no `.pdf` suffix, was filed as HTML
    // at a rank that beat the builder's own PDF entry for the same URL, and
    // then failed here with "Server returned PDF" — the PDF path never ran
    // and the deep report fell back to the abstract (measured 2026-09-14).
    if (fetched.isPdf) return tryPdfLink(link);
    // 1-16: a hard 401/402/403/451 here is a publisher access gate, not
    // "could not reach the source" — Wiley/ACS both hard-403 after the DOI
    // redirect resolves correctly, and were misreported as source_unavailable.
    // 2-01: except on an aggregator/free host (Ruling 9, §1j) — there a hard
    // status is an anti-bot block, not a subscription gate.
    if (typeof fetched.status === "number") {
      const verdict = classifyHardAccessStatus(link.url, fetched.status);
      if (verdict === "paywalled") return { status: "paywalled", reason: paywallReason(link.url) };
      if (verdict === "blocked") return { status: "source_unavailable", reason: blockedReason(link.url) };
    }
    return { status: "source_unavailable", reason: fetched.reason };
  }
  if (appearsPaywalled(fetched.html)) {
    return {
      status: "paywalled",
      reason: paywallReason(fetched.finalUrl),
    };
  }
  const extractor = chooseHtmlExtractor(fetched.finalUrl);
  const doc = extractor(fetched.html);
  if (!looksLikeFullText(doc)) {
    return {
      status: "no_full_text",
      reason: "Page reached but did not look like full text.",
    };
  }
  return { status: "ok", doc };
}

async function tryPdfLink(link: SourceLink): Promise<{ status: FullTextStatus; doc?: ExtractedDocument; reason?: string }> {
  const result = await tryExtractPdfText(link.url);
  if (result.ok && result.doc) {
    return { status: "ok", doc: result.doc };
  }
  // 1-16: the status code from the PDF fetch itself (when that's where it
  // failed) is checked first — a hard 401/402/403/451 there is the same
  // publisher-gate signal as the HTML path's, and previously reached here
  // only as an un-matchable reason string ("PDF fetch returned 403").
  // 2-01: except on an aggregator/free host, where it's a block, not a paywall.
  if (typeof result.status === "number") {
    const verdict = classifyHardAccessStatus(link.url, result.status);
    if (verdict === "paywalled") return { status: "paywalled", reason: paywallReason(link.url) };
    if (verdict === "blocked") return { status: "source_unavailable", reason: blockedReason(link.url) };
  }
  // Otherwise fall back to the phrase-based reasons already produced
  // elsewhere in the PDF pipeline (e.g. downloadPdf's "likely a
  // landing/paywall page" when the response wasn't really a PDF).
  const reason = result.reason ?? "PDF unavailable.";
  if (/paywall|subscription|purchase|access/i.test(reason)) {
    return { status: "paywalled", reason };
  }
  return { status: "source_unavailable", reason };
}

function paywallReason(url: string): string {
  try {
    const host = new URL(url).hostname.replace(/^www\./, "");
    return `${host} requires paid or institutional access — Peer could not read the full paper, so the report falls back to the abstract.`;
  } catch {
    return "The publisher requires paid or institutional access — Peer could not read the full paper, so the report falls back to the abstract.";
  }
}

/**
 * 2-01 (Ruling 9, §1j): an aggregator/free host's own 401/402/403/451 is an
 * anti-bot block, not a subscription gate — worded separately from
 * `paywallReason` so the honest reason a report falls back to the abstract
 * never claims a paywall that isn't there.
 */
function blockedReason(url: string): string {
  try {
    const host = new URL(url).hostname.replace(/^www\./, "");
    return `${host} blocked this request — Peer could not read the full paper, so the report falls back to the abstract.`;
  } catch {
    return "The source blocked this request — Peer could not read the full paper, so the report falls back to the abstract.";
  }
}

/**
 * 1-28: an uploaded PDF already lives on this server (`upload-store.ts`), so
 * reading it is a local file read, not a fetch — no `collectSourceLinks`
 * walk, no network attempt, no paywall to hit. Mirrors `tryPdfLink`'s
 * shape/reasoning so `buildResult`'s single `attempts` entry reads the same
 * way a normal PDF attempt would.
 */
async function tryUploadLink(hash16: string): Promise<{ status: FullTextStatus; doc?: ExtractedDocument; reason?: string }> {
  const result = await extractPdfTextFromPath(pdfPath(hash16));
  if (result.ok && result.doc) {
    return { status: "ok", doc: result.doc };
  }
  if (result.reason === "no-python" || result.reason === "no-extractor") {
    // Same "the file is there, this deployment cannot read it" fact
    // `pdfUnreadableHere` (reading.ts) already detects for a normal PDF
    // link — kept as the exact same reason string so that detector needs no
    // upload-specific branch of its own.
    return { status: "no_full_text", reason: result.reason };
  }
  if (result.reason && /produced no sections/i.test(result.reason)) {
    // Python ran fine and read every page; there was simply no text to find
    // (most likely a scanned PDF with no text layer). A genuinely different
    // fact from every other `no_full_text` reason here — reading.ts's
    // `pdfHasNoText` looks for this exact marker so the reading page can say
    // "this PDF has no readable text" instead of a generic "no full text."
    return { status: "no_full_text", reason: `pdf-empty: ${result.reason}` };
  }
  return { status: "no_full_text", reason: result.reason ?? "PDF text extractor failed on this server." };
}

async function buildResult(input: FullTextInput): Promise<FullTextResult> {
  const uploadHash16 = bareUploadId(input.paperId);
  if (uploadHash16) {
    const link: SourceLink = {
      url: `/api/papers/upload/${uploadHash16}/file`,
      kind: "pdf",
      label: "upload",
      rank: 0,
    };
    const outcome = await tryUploadLink(uploadHash16);
    const attempts: FullTextResult["attempts"] = [
      { link, outcome: outcome.status + (outcome.reason ? `: ${outcome.reason}` : "") },
    ];
    if (outcome.status === "ok" && outcome.doc) {
      return { status: "ok", doc: outcome.doc, sourceLink: link, attempts };
    }
    return {
      status: "no_full_text",
      reason: outcome.reason ?? "This PDF has no readable text.",
      attempts,
    };
  }

  const links = await collectSourceLinks({
    url: input.url ?? undefined,
    doi: input.doi ?? undefined,
    arxivId: input.arxivId ?? undefined,
    openAlexId: input.openAlexId ?? undefined,
  });

  const attempts: FullTextResult["attempts"] = [];
  let lastPaywallReason: string | null = null;

  for (const link of links) {
    const outcome =
      link.kind === "html" ? await tryHtmlLink(link) : await tryPdfLink(link);
    attempts.push({
      link,
      outcome: outcome.status + (outcome.reason ? `: ${outcome.reason}` : ""),
    });
    if (outcome.status === "ok" && outcome.doc) {
      return {
        status: "ok",
        doc: outcome.doc,
        sourceLink: link,
        attempts,
      };
    }
    if (outcome.status === "paywalled" && outcome.reason) {
      lastPaywallReason = outcome.reason;
    }
  }

  if (lastPaywallReason) {
    return { status: "paywalled", reason: lastPaywallReason, attempts };
  }
  return {
    status: "no_full_text",
    reason: "No legal full-text source returned readable body text.",
    attempts,
  };
}

/**
 * Cache-aware full-text fetch. Returns the same shape regardless of whether
 * the text came from HTML or PDF.
 */
export async function getFullText(input: FullTextInput): Promise<FullTextResult> {
  const key = input.paperId;
  const cached = cache.get(key);
  if (cached) {
    if (cached instanceof Promise) return cached;
    if (Date.now() - cached.ts <= CACHE_TTL_MS) return cached.result;
    cache.delete(key);
  }

  const pending = buildResult(input);
  cache.set(key, pending);
  try {
    const result = await pending;
    cache.set(key, { result, ts: Date.now() });
    return result;
  } catch (err) {
    cache.delete(key);
    throw err;
  }
}

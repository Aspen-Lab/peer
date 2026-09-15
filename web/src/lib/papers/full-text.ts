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
import { tryExtractPdfText } from "./pdf-text";
import { collectSourceLinks, type SourceLink } from "./source-links";

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

/**
 * A hard 401/402/403/451 is as clear a paywall signal as a fetch ever gets.
 * 1-16: this used to live inside `appearsPaywalled`, which is only ever
 * called after a successful (2xx) fetch — a real 401/402/403/451 response
 * never reached it, since `fetchHtml`/`downloadPdf` already return on
 * `!res.ok` one branch earlier. Moved here so the early-return paths can
 * check it directly, before falling through to the generic
 * "source_unavailable" a non-paywall failure gets.
 */
function looksLikePaywallStatus(status: number): boolean {
  return [401, 402, 403, 451].includes(status);
}

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
    if (typeof fetched.status === "number" && looksLikePaywallStatus(fetched.status)) {
      return { status: "paywalled", reason: paywallReason(link.url) };
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
  if (typeof result.status === "number" && looksLikePaywallStatus(result.status)) {
    return { status: "paywalled", reason: paywallReason(link.url) };
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

async function buildResult(input: FullTextInput): Promise<FullTextResult> {
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

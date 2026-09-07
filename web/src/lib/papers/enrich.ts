// Abstract enrichment for papers OpenAlex doesn't have abstracts for.
//
// Order of attempts:
//   1. Semantic Scholar `abstract` field (works for many open-access papers).
//   2. Crossref `abstract` field (publisher-supplied JATS XML).
//   3. Publisher DOI landing page `<meta property="og:description">` —
//      Nature, Springer, Wiley, etc. all expose the abstract here even when
//      they don't license it to OpenAlex / Semantic Scholar.

import { cleanDisplayText } from "@/lib/text/clean";

const TIMEOUT_MS = 6_000;
const REVALIDATE_S = 86_400;

interface SSPaperData {
  abstract?: string | null;
  tldr?: { text?: string } | null;
}

async function timedFetchText(url: string, headers: HeadersInit = {}): Promise<string | null> {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      next: { revalidate: REVALIDATE_S },
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; PeerBot/0.1)",
        Accept: "text/html,application/xhtml+xml,application/json",
        ...headers,
      },
    });
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

// ── Strategy 1: Semantic Scholar ───────────────────────────────

/**
 * What Semantic Scholar holds for a paper. The two fields are kept apart on
 * purpose: `tldr` is machine-written, and it used to be returned in place of
 * the abstract when S2 had none, which put a model's one-liner on the page as
 * the authors' own words. A caller that wants the abstract takes `abstract`;
 * the reading page shows `tldr` under its own label.
 */
export interface SemanticScholarText {
  abstract: string | null;
  tldr: string | null;
}

async function trySS(externalId: string): Promise<SemanticScholarText | null> {
  const url =
    `https://api.semanticscholar.org/graph/v1/paper/${encodeURIComponent(externalId)}` +
    `?fields=abstract,tldr`;
  const text = await timedFetchText(url, { Accept: "application/json" });
  if (!text) return null;
  try {
    const data = JSON.parse(text) as SSPaperData;
    return {
      abstract: cleanDisplayText(data.abstract) || null,
      tldr: cleanDisplayText(data.tldr?.text) || null,
    };
  } catch {
    return null;
  }
}

// ── Strategy 2: Crossref ───────────────────────────────────────

interface CrossrefData {
  message?: { abstract?: string };
}

async function tryCrossref(doi: string): Promise<string | null> {
  const cleanDoi = doi.replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, "");
  const url = `https://api.crossref.org/works/${encodeURIComponent(cleanDoi)}`;
  const text = await timedFetchText(url, { Accept: "application/json" });
  if (!text) return null;
  try {
    const data = JSON.parse(text) as CrossrefData;
    const raw = data.message?.abstract;
    if (!raw) return null;
    // Crossref abstracts come wrapped in JATS XML — strip tags.
    return cleanDisplayText(raw
      .replace(/<jats:[^>]+>/gi, "")
      .replace(/<\/jats:[^>]+>/gi, "")
      .replace(/<[^>]+>/g, "")
      .replace(/\s+/g, " ")
      .trim()) || null;
  } catch {
    return null;
  }
}

// ── Strategy 3: scrape publisher DOI page meta tags ────────────

async function tryDoiPageMeta(doi: string): Promise<string | null> {
  const cleanDoi = doi.replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, "");
  const html = await timedFetchText(`https://doi.org/${cleanDoi}`);
  if (!html) return null;

  // Try og:description first (best for Nature/Springer), then standard description.
  const patterns = [
    /<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:description["']/i,
    /<meta[^>]+name=["']citation_abstract["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i,
  ];
  for (const re of patterns) {
    const m = html.match(re);
    if (m?.[1]) {
      const text = m[1].trim();
      // Skip obviously generic descriptions ("Cited by 12 articles" etc.)
      if (text.length > 60) return cleanDisplayText(text);
    }
  }
  return null;
}

// ── Public API ─────────────────────────────────────────────────

/**
 * Best-effort abstract fetch by external ID(s). Tries Semantic Scholar,
 * then Crossref, then the publisher DOI page. Returns null only if all
 * three miss.
 */
export async function fetchAbstract(opts: {
  openalexId?: string;
  arxivId?: string;
  doi?: string;
}): Promise<string | null> {
  // 1. Semantic Scholar — try whichever ID we have. Only a real abstract
  // counts here; the TLDR is not one.
  if (opts.arxivId) {
    const a = (await trySS(`arXiv:${opts.arxivId}`))?.abstract;
    if (a) return a;
  }
  if (opts.openalexId) {
    const a = (await trySS(`OpenAlex:${opts.openalexId}`))?.abstract;
    if (a) return a;
  }
  if (opts.doi) {
    const a = (await trySS(`DOI:${opts.doi.replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, "")}`))?.abstract;
    if (a) return a;
  }

  // 2. Crossref (DOI required)
  if (opts.doi) {
    const a = await tryCrossref(opts.doi);
    if (a) return a;
  }

  // 3. Publisher DOI page meta tag
  if (opts.doi) {
    const a = await tryDoiPageMeta(opts.doi);
    if (a) return a;
  }

  return null;
}

/** Semantic Scholar's abstract and TLDR for one external id, kept apart. */
export async function fetchSemanticScholarText(
  externalId: string,
): Promise<SemanticScholarText | null> {
  return trySS(externalId);
}

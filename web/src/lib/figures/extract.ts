import { tryPdfCandidates } from "./pdf-extract";
import { matchFigureSemantically } from "./semantic-match";
import { matchFigureVisually } from "./vision-match";

const FETCH_TIMEOUT_MS = 7_000;
const MAX_BODY_BYTES = 2_500_000;
// Part of the candidate cache key (`cacheKey`), so bumping it is how a
// change to what this module extracts reaches a reader who already has a
// figure cached — the captions stopped carrying LaTeXML's duplicate TeX.
const FETCH_VERSION = "2026-09-08-caption-annotation";

interface ExtractInput {
  itemId: string;
  url?: string;
  doi?: string;
  query?: string;
  figureIndex?: number;
  paperTitle?: string;
}

export type FigureStatus =
  | "found"
  | "paywalled"
  | "caption_mismatch"
  | "no_figures"
  | "source_unavailable"
  | "rate_limited";

export interface FigureResult {
  imageUrl: string | null;
  caption?: string | null;
  source?: "semantic-scholar" | "ar5iv" | "publisher" | "open-access" | "og" | null;
  status: FigureStatus;
  reason?: string | null;
  hideFigure?: boolean;
  matchedBy?: "keyword" | "semantic" | "vision" | "fallback" | null;
}

interface FigureCandidate {
  imageUrl: string;
  caption?: string | null;
  source: NonNullable<FigureResult["source"]>;
  ordinal: number;
  qualityHint?: "high" | "medium" | "low";
}

interface AttemptResult {
  status: "candidates" | "paywalled" | "no_figures" | "source_unavailable" | "rate_limited";
  candidates: FigureCandidate[];
  reason?: string;
}

interface CandidateSelection {
  candidate: FigureCandidate | null;
  status: "found" | "caption_mismatch";
  reason?: string;
  matchedBy?: NonNullable<FigureResult["matchedBy"]>;
}

interface SourceLink {
  url: string;
  kind: "html" | "pdf";
  label: "input" | "doi" | "unpaywall" | "europepmc" | "derived";
}

interface EuropePmcResult {
  pmcid?: string;
  fullTextUrlList?: {
    fullTextUrl?:
      | {
          availability?: string;
          availabilityCode?: string;
          documentStyle?: string;
          url?: string;
        }
      | {
          availability?: string;
          availabilityCode?: string;
          documentStyle?: string;
          url?: string;
        }[];
  };
}

interface UnpaywallLocation {
  url?: string | null;
  url_for_pdf?: string | null;
  url_for_landing_page?: string | null;
}

interface UnpaywallRecord {
  best_oa_location?: UnpaywallLocation | null;
  oa_locations?: UnpaywallLocation[] | null;
}

// EuropePMC, JSTOR, and several publisher CDNs explicitly 403 any UA
// matching the "Bot" pattern. Send a real browser UA — we identify
// ourselves via X-Peer-Figure-Version for server logs that care.
const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Peer/0.1";

async function timedFetch(url: string, init?: RequestInit): Promise<Response | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal,
      cache: "no-store",
      redirect: "follow",
      headers: {
        "User-Agent": BROWSER_UA,
        "X-Peer-Figure-Version": FETCH_VERSION,
        Accept: "text/html,application/xhtml+xml,application/json",
        ...(init?.headers ?? {}),
      },
    });
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function readBoundedText(res: Response): Promise<string> {
  const reader = res.body?.getReader();
  if (!reader) return res.text();
  const decoder = new TextDecoder("utf-8");
  let bytes = 0;
  let out = "";

  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    out += decoder.decode(value, { stream: true });
    if (bytes >= MAX_BODY_BYTES) {
      try {
        await reader.cancel();
      } catch {
        // ignore cancellation failures
      }
      break;
    }
  }

  out += decoder.decode();
  return out;
}

function asArray<T>(value: T | T[] | null | undefined): T[] {
  if (value == null) return [];
  return Array.isArray(value) ? value : [value];
}

function bareArxivId(itemId: string): string | null {
  const match = itemId.match(/^arxiv:(.+)$/i);
  return match ? match[1].replace(/^abs\//, "") : null;
}

function bareOpenAlexId(itemId: string): string | null {
  const match = itemId.match(/^openalex:(.+)$/i);
  return match ? match[1] : null;
}

function cleanDoi(doi: string): string {
  return doi.replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, "").trim();
}

function doiUrl(doi: string): string {
  return `https://doi.org/${cleanDoi(doi)}`;
}

function arxivIdFromUrl(url: string): string | null {
  const match = url.match(/arxiv\.org\/(?:abs|pdf)\/([0-9]{4}\.[0-9]+(?:v\d+)?)/i);
  return match ? match[1] : null;
}

function arxivIdFromDoi(doi: string): string | null {
  const match = cleanDoi(doi).match(/^10\.48550\/arxiv\.([0-9]{4}\.[0-9]+(?:v\d+)?)/i);
  return match ? match[1] : null;
}

const BAD_URL_PATTERNS: RegExp[] = [
  /static\.arxiv\.org/i,
  /\barxiv-logo\b/i,
  /\bar5iv-logo\b/i,
  /\b(logo|favicon|sprite|placeholder|icons?)[-_./]/i,
  /\/static\/(?:icons?|images?|logos?)\//i,
  /og[-_]?image[-_]?default/i,
  /twitter[-_]?(?:card|image)[-_]?default/i,
  /opengraph[-_]?default/i,
];
const LOW_RES_URL_PATTERNS: RegExp[] = [
  /\bthumb(?:nail)?s?\b/i,
  /(?:^|[-_./])small(?:[-_./]|$)/i,
  /(?:^|[-_./])low(?:res|resolution)?(?:[-_./]|$)/i,
  /(?:^|[-_./])preview(?:[-_./]|$)/i,
  /(?:^|[-_./])tiny(?:[-_./]|$)/i,
  /\/(?:thumb|thumbnail|small|preview)\//i,
  /[?&](?:width|w)=([1-5]?\d{1,2})(?:&|$)/i,
  /[?&](?:height|h)=([1-5]?\d{1,2})(?:&|$)/i,
];
const HIGH_RES_URL_PATTERNS: RegExp[] = [
  /\b(?:full|large|hi[-_]?res|high[-_]?res|original|download)\b/i,
  /\/(?:full|large|hires|original)\//i,
  /[?&](?:width|w)=([8-9]\d{2}|\d{4,})(?:&|$)/i,
  /[?&](?:height|h)=([8-9]\d{2}|\d{4,})(?:&|$)/i,
];
const OPEN_ACCESS_HOST_PATTERNS = [
  /(^|\.)pmc\.ncbi\.nlm\.nih\.gov$/i,
  /(^|\.)arxiv\.org$/i,
  /(^|\.)ar5iv\.labs\.arxiv\.org$/i,
  /(^|\.)biorxiv\.org$/i,
  /(^|\.)medrxiv\.org$/i,
];
// 1-19: a journal cover/masthead image is not caught by BAD_URL_PATTERNS's
// logo/icon patterns above, but it is exactly the "never fabricate" case the
// og:image honesty guard exists to reject — kept separate from the general
// logo list rather than folded in, since it only matters for the og:image
// fallback below, not the wider candidate-scoring code that reuses
// BAD_URL_PATTERNS for other purposes.
const COVER_IMAGE_URL_PATTERNS: RegExp[] = [
  /\/covers?\//i,
  /journal[-_]?cover/i,
  /\bmasthead\b/i,
  /\bbanner\b/i,
];

function looksLikeCoverImage(url: string): boolean {
  return COVER_IMAGE_URL_PATTERNS.some((pattern) => pattern.test(url));
}

function looksLikeLogo(url: string): boolean {
  return BAD_URL_PATTERNS.some((pattern) => pattern.test(url));
}

function looksLowResUrl(url: string): boolean {
  return LOW_RES_URL_PATTERNS.some((pattern) => pattern.test(url));
}

function looksHighResUrl(url: string): boolean {
  return HIGH_RES_URL_PATTERNS.some((pattern) => pattern.test(url));
}

function hostLooksOpenAccess(url: string): boolean {
  try {
    const host = new URL(url).hostname;
    return OPEN_ACCESS_HOST_PATTERNS.some((pattern) => pattern.test(host));
  } catch {
    return false;
  }
}

function absolutize(src: string, baseUrl: string): string {
  try {
    return new URL(src, baseUrl).toString();
  } catch {
    return src;
  }
}

function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&apos;|&#39;/gi, "'")
    .replace(/&#(\d+);/g, (_, code: string) =>
      String.fromCodePoint(Number.parseInt(code, 10)),
    )
    .replace(/&#x([0-9a-f]+);/gi, (_, code: string) =>
      String.fromCodePoint(Number.parseInt(code, 16)),
    );
}

function stripTags(html: string): string {
  return decodeHtmlEntities(
    html
      .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
      .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
      // LaTeXML writes every formula twice — the rendered MathML and the TeX
      // it came from, in an <annotation> — and a caption came out reading
      // "d = 3 d=3 surrogate subspace". The same removal is in
      // `papers/html-text.ts`; this module has its own tag stripper because
      // it wants none of that one's paragraph breaks.
      .replace(/<annotation(?:-xml)?\b[^>]*>[\s\S]*?<\/annotation(?:-xml)?>/gi, " ")
      .replace(/<[^>]+>/g, " "),
  )
    .replace(/\s+/g, " ")
    .trim();
}

function readAttr(markup: string, attr: string): string | null {
  const pattern = new RegExp(
    `\\b${attr}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'=<>]+))`,
    "i",
  );
  const match = markup.match(pattern);
  return match?.[1] ?? match?.[2] ?? match?.[3] ?? null;
}

function srcFromSrcset(srcset: string): string | null {
  const candidates = srcset
    .split(",")
    .map((part, order) => {
      const [url, descriptor] = part.trim().split(/\s+/);
      if (!url) return null;
      const width = descriptor?.match(/^(\d+)w$/i);
      const density = descriptor?.match(/^([0-9.]+)x$/i);
      const score = width
        ? Number.parseInt(width[1], 10)
        : density
          ? Number.parseFloat(density[1]) * 1000
          : order;
      return { url, score };
    })
    .filter((candidate): candidate is { url: string; score: number } => candidate !== null)
    .sort((a, b) => b.score - a.score);
  return candidates[0]?.url ?? null;
}

function candidateLooksImageUrl(url: string): boolean {
  if (/\.(?:png|jpe?g|webp|gif|tiff?|svg)(?:[?#]|$)/i.test(url)) return true;
  if (/\b(?:fig|figure|image|graphic|media|download|hires|large|full|original)\b/i.test(url)) {
    return !/\.(?:html?|pdf|xml)(?:[?#]|$)/i.test(url);
  }
  return false;
}

function htmlImageUrlScore(url: string): number {
  let score = 0;
  if (looksHighResUrl(url)) score += 10;
  if (looksLowResUrl(url)) score -= 12;
  if (/\.(?:png|jpe?g|webp|tiff?)(?:[?#]|$)/i.test(url)) score += 3;
  if (/\.svg(?:[?#]|$)/i.test(url)) score -= 2;
  if (/\b(?:logo|icon|sprite)\b/i.test(url)) score -= 20;
  return score;
}

function addImageCandidate(
  target: Map<string, string>,
  value: string | null,
  baseUrl: string,
  requireImageLike = false,
) {
  if (!value || value.startsWith("data:")) return;
  const absolute = absolutize(value, baseUrl);
  if (looksLikeLogo(absolute)) return;
  if (requireImageLike && !candidateLooksImageUrl(absolute)) return;
  target.set(absolute, absolute);
}

function bestImageSrc(markup: string, baseUrl: string): string | null {
  const img = markup.match(/<img\b[^>]*>/i)?.[0];
  const source = markup.match(/<source\b[^>]*>/i)?.[0];
  const urls = new Map<string, string>();

  if (source) addImageCandidate(urls, srcFromSrcset(readAttr(source, "srcset") ?? ""), baseUrl);
  if (img) addImageCandidate(urls, srcFromSrcset(readAttr(img, "srcset") ?? ""), baseUrl);

  const highResAttrs = [
    "data-hires",
    "data-high-res-src",
    "data-full",
    "data-full-src",
    "data-original",
    "data-large",
    "data-download-url",
  ];
  for (const attr of highResAttrs) {
    if (img) addImageCandidate(urls, readAttr(img, attr), baseUrl);
    addImageCandidate(urls, readAttr(markup, attr), baseUrl);
  }

  if (img) {
    addImageCandidate(urls, readAttr(img, "data-src"), baseUrl);
    addImageCandidate(urls, readAttr(img, "src"), baseUrl);
  }
  addImageCandidate(urls, readAttr(markup, "href"), baseUrl, true);

  const ranked = Array.from(urls.values())
    .filter((url) => !looksLikeLogo(url))
    .sort((a, b) => htmlImageUrlScore(b) - htmlImageUrlScore(a));

  return ranked[0] ?? null;
}

function captionFromFigure(markup: string): string | null {
  const figcaption =
    markup.match(/<figcaption\b[^>]*>([\s\S]*?)<\/figcaption>/i)?.[1] ??
    markup.match(/<[^>]*class=["'][^"']*(?:fig-caption|caption)[^"']*["'][^>]*>([\s\S]*?)<\/[^>]+>/i)?.[1];
  if (figcaption) return stripTags(figcaption);
  const img = markup.match(/<img\b[^>]*>/i)?.[0];
  const alt = img ? readAttr(img, "alt") : null;
  return alt ? stripTags(alt) : null;
}

function blockCandidates(html: string): string[] {
  const blocks: string[] = [];
  const figureRe = /<figure\b[^>]*>[\s\S]*?<\/figure>/gi;
  for (const match of html.matchAll(figureRe)) blocks.push(match[0]);
  const highwireFigRe =
    /<div\b[^>]*class=["'][^"']*\bfig(?:ure)?\b[^"']*["'][^>]*>[\s\S]*?<\/div>\s*<\/div>?/gi;
  for (const match of html.matchAll(highwireFigRe)) blocks.push(match[0]);
  return blocks;
}

function htmlFigureCandidates(
  html: string,
  baseUrl: string,
  source: FigureCandidate["source"],
): FigureCandidate[] {
  const blocks = blockCandidates(html);
  if (blocks.length === 0) return [];

  const candidates: FigureCandidate[] = [];
  for (const block of blocks) {
    const imageUrl = bestImageSrc(block, baseUrl);
    if (!imageUrl) continue;
    candidates.push({
      imageUrl,
      caption: captionFromFigure(block),
      source,
      ordinal: candidates.length,
      qualityHint: looksLowResUrl(imageUrl) ? "low" : looksHighResUrl(imageUrl) ? "high" : "medium",
    });
  }

  return candidates;
}

const STOP_WORDS = new Set([
  "about",
  "after",
  "also",
  "analysis",
  "and",
  "are",
  "based",
  "can",
  "cell",
  "data",
  "does",
  "figure",
  "from",
  "has",
  "into",
  "its",
  "key",
  "main",
  "method",
  "new",
  "paper",
  "rechargeable",
  "result",
  "results",
  "show",
  "shows",
  "study",
  "system",
  "that",
  "the",
  "their",
  "this",
  "using",
  "was",
  "were",
  "what",
  "when",
  "where",
  "which",
  "with",
]);

function normalizeToken(token: string): string {
  if (token === "li") return "lithium";
  if (token.endsWith("ies") && token.length > 4) return `${token.slice(0, -3)}y`;
  if (token.endsWith("s") && token.length > 4) return token.slice(0, -1);
  return token;
}

function tokenize(text?: string | null): string[] {
  if (!text) return [];
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .split(/\s+/)
    .map(normalizeToken)
    .filter((token) => token.length >= 2 && !STOP_WORDS.has(token));
}

function explicitFigureNumber(text?: string | null): string | null {
  if (!text) return null;
  const match = text.match(/\bfig(?:ure)?\.?\s*(\d+)([a-z]?)/i);
  if (!match) return null;
  return `${match[1]}${(match[2] ?? "").toLowerCase()}`;
}

function candidateMatchesFigureNumber(
  candidate: FigureCandidate,
  wanted: string,
): boolean {
  const caption = candidate.caption ?? "";
  const found = explicitFigureNumber(caption);
  return found === wanted;
}

function figureScore(candidate: FigureCandidate, query: string): number {
  const queryTokens = new Set(tokenize(query));
  if (queryTokens.size === 0) return 0;
  const captionTokens = new Set(tokenize(candidate.caption ?? ""));
  let score = 0;

  for (const token of queryTokens) {
    if (captionTokens.has(token)) score += token.length >= 6 ? 2 : 1;
  }

  return score;
}

function sourcePriority(source: FigureCandidate["source"]): number {
  if (source === "open-access") return 60;
  if (source === "ar5iv") return 56;
  if (source === "publisher") return 52;
  if (source === "semantic-scholar") return 18;
  if (source === "og") return 0;
  return 0;
}

function candidateQualityScore(candidate: FigureCandidate): number {
  let score = sourcePriority(candidate.source);
  if (candidate.imageUrl.startsWith("data:image/")) score += 18;
  if (candidate.qualityHint === "high") score += 12;
  if (candidate.qualityHint === "low") score -= 16;
  if (looksHighResUrl(candidate.imageUrl)) score += 10;
  if (looksLowResUrl(candidate.imageUrl)) score -= 18;
  if (candidate.caption?.trim()) score += 2;
  return score;
}

function candidateMatchScore(candidate: FigureCandidate, textScore: number): number {
  return textScore * 30 + candidateQualityScore(candidate);
}

function compareCandidateQuality(a: FigureCandidate, b: FigureCandidate): number {
  return (
    candidateQualityScore(b) - candidateQualityScore(a) ||
    a.ordinal - b.ordinal
  );
}

function bestQualityCandidate(candidates: FigureCandidate[]): FigureCandidate | null {
  return [...candidates].sort(compareCandidateQuality)[0] ?? null;
}

function normalizedCaptionKey(text?: string | null): string | null {
  const tokens = tokenize(text).slice(0, 24);
  return tokens.length >= 4 ? tokens.join(" ") : null;
}

function sameFigureCandidate(a: FigureCandidate, b: FigureCandidate): boolean {
  const aFigure = explicitFigureNumber(a.caption);
  const bFigure = explicitFigureNumber(b.caption);
  if (aFigure && bFigure && aFigure === bFigure) return true;

  const aKey = normalizedCaptionKey(a.caption);
  const bKey = normalizedCaptionKey(b.caption);
  return Boolean(aKey && bKey && aKey === bKey);
}

function upgradeCandidateQuality(
  selected: FigureCandidate,
  candidates: FigureCandidate[],
): FigureCandidate {
  const related = candidates.filter((candidate) =>
    candidate === selected ? true : sameFigureCandidate(candidate, selected),
  );
  return bestQualityCandidate(related) ?? selected;
}

function visionShortlist(
  candidates: FigureCandidate[],
  scored: Array<{ candidate: FigureCandidate; score: number }>,
): FigureCandidate[] {
  const ordered = scored.length > 0 ? scored.map((entry) => entry.candidate) : candidates;
  return ordered.slice(0, 3);
}

async function chooseCandidate(
  candidates: FigureCandidate[],
  n: number,
  query?: string,
  paperTitle?: string,
): Promise<CandidateSelection> {
  const valid = candidates.filter((candidate) => !looksLikeLogo(candidate.imageUrl));
  if (valid.length === 0) {
    return {
      candidate: null,
      status: "caption_mismatch",
      reason: "The source exposed figure slots, but Peer could not extract a usable figure image.",
    };
  }

  if (!query?.trim()) {
    const fallback = valid[n] ?? bestQualityCandidate(valid) ?? valid[0] ?? null;
    return {
      candidate: fallback ? upgradeCandidateQuality(fallback, valid) : null,
      status: "found",
      matchedBy: "fallback",
    };
  }

  const requestedFigure = explicitFigureNumber(query);
  if (requestedFigure) {
    const explicitCandidate = bestQualityCandidate(
      valid.filter((candidate) =>
        candidateMatchesFigureNumber(candidate, requestedFigure),
      ),
    );
    if (explicitCandidate) {
      return {
        candidate: explicitCandidate,
        status: "found",
        matchedBy: "keyword",
      };
    }
  }

  const scored = valid
    .map((candidate) => ({
      candidate,
      score: figureScore(candidate, query),
    }))
    .sort(
      (a, b) =>
        candidateMatchScore(b.candidate, b.score) -
          candidateMatchScore(a.candidate, a.score) ||
        a.candidate.ordinal - b.candidate.ordinal,
    );

  const queryTokens = tokenize(query);
  const threshold = queryTokens.length <= 3 ? 1 : 2;
  const best = scored.find((entry) => entry.score >= threshold);
  if (best) {
    return {
      candidate: upgradeCandidateQuality(best.candidate, valid),
      status: "found",
      matchedBy: "keyword",
    };
  }

  const semantic = await matchFigureSemantically({
    paperTitle,
    query,
    candidates: scored
      .map((entry) => entry.candidate)
      .filter((candidate) => candidate.caption?.trim())
      .slice(0, 8)
      .map((candidate) => ({
        ordinal: candidate.ordinal,
        caption: candidate.caption ?? "",
      })),
  });

  if (semantic?.ordinal != null && semantic.confidence !== "low") {
    const semanticCandidate =
      valid.find((candidate) => candidate.ordinal === semantic.ordinal) ?? null;
    if (semanticCandidate) {
      return {
        candidate: upgradeCandidateQuality(semanticCandidate, valid),
        status: "found",
        reason: semantic.reason,
        matchedBy: "semantic",
      };
    }
  }

  const visual = await matchFigureVisually({
    paperTitle,
    query,
    candidates: visionShortlist(valid, scored).map((candidate) => ({
      ordinal: candidate.ordinal,
      imageUrl: candidate.imageUrl,
      caption: candidate.caption ?? null,
    })),
  });

  if (visual?.ordinal != null && visual.confidence !== "low") {
    const visualCandidate =
      valid.find((candidate) => candidate.ordinal === visual.ordinal) ?? null;
    if (visualCandidate) {
      return {
        candidate: upgradeCandidateQuality(visualCandidate, valid),
        status: "found",
        reason: visual.reason,
        matchedBy: "vision",
      };
    }
  }

  // Last resort: when no high-confidence match was found, fall back to the
  // requested figure index (n) from the actual paper. The report section
  // assigned this index intentionally, so showing it — even with a "fallback"
  // tag — is far more useful than a "no match" placeholder. The user has been
  // explicit: prefer showing a real figure from the paper over hiding it.
  const fallbackCandidate = valid[n] ?? bestQualityCandidate(valid) ?? valid[0] ?? null;
  if (fallbackCandidate) {
    return {
      candidate: upgradeCandidateQuality(fallbackCandidate, valid),
      status: "found",
      matchedBy: "fallback",
    };
  }

  return {
    candidate: null,
    status: "caption_mismatch",
    reason: "The source exposed figure slots, but Peer could not extract a usable figure image.",
  };
}

function candidateResult(
  selection: CandidateSelection,
  fallbackReason?: string,
): FigureResult {
  if (!selection.candidate) {
    return {
      imageUrl: null,
      source: null,
      status: "caption_mismatch",
      reason: selection.reason ?? fallbackReason ?? null,
      hideFigure: false,
      matchedBy: null,
    };
  }

  return {
    imageUrl: selection.candidate.imageUrl,
    caption: selection.candidate.caption ?? null,
    source: selection.candidate.source,
    status: "found",
    reason: selection.reason ?? fallbackReason ?? null,
    hideFigure: false,
    matchedBy: selection.matchedBy ?? null,
  };
}

interface SSFigure {
  caption?: string;
  url?: string;
}

// 1-20: a briefing loads a whole page's worth of papers together, and every
// one of them used to fire its Semantic Scholar figure lookup at once —
// against an unauthenticated per-IP rate limit, this reliably drew 429s.
// Module-level state (same shape as `candidatePoolCache` above — process-wide
// for a different reason) caps concurrent requests and spaces consecutive
// starts out, shared across every call in this Node process regardless of
// which paper or which request triggered it.
const SEMANTIC_SCHOLAR_MAX_CONCURRENT = 2;
const SEMANTIC_SCHOLAR_MIN_INTERVAL_MS = 350;
let semanticScholarActive = 0;
let semanticScholarLastStart = 0;
// Chains each caller's admission check onto the previous one, so concurrent
// callers are granted a slot in call order rather than racing each other.
let semanticScholarAdmission: Promise<void> = Promise.resolve();

function waitMs(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function acquireSemanticScholarSlot(): Promise<void> {
  const myTurn = semanticScholarAdmission.then(async () => {
    while (semanticScholarActive >= SEMANTIC_SCHOLAR_MAX_CONCURRENT) {
      await waitMs(25);
    }
    const wait = semanticScholarLastStart + SEMANTIC_SCHOLAR_MIN_INTERVAL_MS - Date.now();
    if (wait > 0) await waitMs(wait);
    semanticScholarLastStart = Date.now();
    semanticScholarActive += 1;
  });
  // Swallow here (not at the caller) so one rejected admission never breaks
  // the chain for everyone queued behind it; the caller still awaits `myTurn`
  // directly and sees any rejection itself.
  semanticScholarAdmission = myTurn.catch(() => {});
  await myTurn;
}

function releaseSemanticScholarSlot(): void {
  semanticScholarActive = Math.max(0, semanticScholarActive - 1);
}

// Exported for tests only (1-20) — the limiter's module-level state persists
// across test cases in the same file.
export function __resetSemanticScholarLimiterForTests(): void {
  semanticScholarActive = 0;
  semanticScholarLastStart = 0;
  semanticScholarAdmission = Promise.resolve();
}

// Exported for tests only (1-20) — every other caller reaches it through
// `buildCandidatePool`.
export async function trySemanticScholarCandidates(ssPaperId: string): Promise<AttemptResult> {
  await acquireSemanticScholarSlot();
  try {
    const apiUrl =
      `https://api.semanticscholar.org/graph/v1/paper/${encodeURIComponent(ssPaperId)}` +
      "?fields=figures,title";
    const res = await timedFetch(apiUrl, {
      headers: {
        Accept: "application/json",
        ...(process.env.SEMANTIC_SCHOLAR_API_KEY
          ? { "x-api-key": process.env.SEMANTIC_SCHOLAR_API_KEY }
          : {}),
      },
    });
    if (res?.status === 429) {
      // Honest attempt status: a 429 means Peer never got an answer, not
      // that Semantic Scholar has nothing — `finalDiagnostic` must not
      // report this the same way as a confirmed-empty source.
      return {
        status: "rate_limited",
        candidates: [],
        reason: "Semantic Scholar rate-limited Peer's figure lookup for this paper.",
      };
    }
    if (!res || !res.ok) return { status: "source_unavailable", candidates: [] };

    try {
      const data = (await res.json()) as { figures?: SSFigure[] };
      const candidates = (data.figures ?? [])
        .map((figure, ordinal): FigureCandidate | null => {
          if (!figure.url || looksLikeLogo(figure.url)) return null;
          return {
            imageUrl: figure.url,
            caption: figure.caption ?? null,
            source: "semantic-scholar",
            ordinal,
            qualityHint: looksLowResUrl(figure.url) ? "low" : looksHighResUrl(figure.url) ? "high" : "medium",
          };
        })
        .filter((candidate): candidate is FigureCandidate => candidate !== null);
      return candidates.length > 0
        ? { status: "candidates", candidates }
        : { status: "no_figures", candidates: [], reason: "Semantic Scholar did not expose any paper figures for this record." };
    } catch {
      return { status: "source_unavailable", candidates: [] };
    }
  } finally {
    releaseSemanticScholarSlot();
  }
}

function isAr5ivErrorPage(html: string): boolean {
  return (
    /ar5iv\s+could\s+not\s+(?:generate|render|process)/i.test(html) ||
    /failed\s+to\s+(?:convert|render|process)\s+the\s+source/i.test(html) ||
    /no\s+ar5iv\s+rendering\s+available/i.test(html) ||
    /conversion\s+to\s+html\s+had\s+a\s+fatal\s+error/i.test(html)
  );
}

function safeHostname(url: string): string | null {
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

// 1-21: a generic "this looks like a stub, not real content" check, the same
// kind `isAr5ivErrorPage` above already is for a different stub — applies to
// any publisher whose access gateway bounces an unauthenticated request
// through an identity-check page rather than serving (or cleanly rejecting)
// the article. Not a nature.com-specific branch (per §1d), even though
// Nature is the only host this round observed it on.
function looksLikeBouncePage(finalUrl: string, html: string): boolean {
  const host = safeHostname(finalUrl);
  const hostLooksLikeIdp = Boolean(host && /^idp\./i.test(host));
  const pathLooksLikeTransit = /\/transit(?:[/?]|$)/i.test(finalUrl);
  const looksLikeThinCookieStub = html.length < 8_000 && /cookie/i.test(html);
  return hostLooksLikeIdp || pathLooksLikeTransit || looksLikeThinCookieStub;
}

function bouncePageReason(finalUrl: string): string {
  const host = safeHostname(finalUrl) ?? finalUrl;
  return `Peer reached an access-check page at ${host}, not the article itself.`;
}

/**
 * arXiv's own LaTeXML rendering, which is where a modern preprint's figures
 * live. This used to try ar5iv alone, and ar5iv now serves a stub for recent
 * papers — seven images, all site chrome. Measured across seven papers from one
 * briefing, ar5iv returned "no figures" for every one while arxiv.org/html
 * carried 26 `<figure>` elements for the same ids.
 *
 * ar5iv stays as the fallback: it still renders many older papers that the
 * native endpoint does not cover.
 */
async function tryArxivHtmlCandidates(
  htmlUrl: string,
  source: FigureCandidate["source"],
): Promise<AttemptResult> {
  const res = await timedFetch(htmlUrl);
  if (!res || !res.ok) return { status: "source_unavailable", candidates: [] };
  const html = await readBoundedText(res);
  if (isAr5ivErrorPage(html)) {
    return {
      status: "source_unavailable",
      candidates: [],
      reason: "The arXiv HTML view could not render this paper into a figure-readable page.",
    };
  }
  const candidates = htmlFigureCandidates(html, htmlUrl, source);
  return candidates.length > 0
    ? { status: "candidates", candidates }
    : { status: "no_figures", candidates: [], reason: "The arXiv HTML view was reachable, but Peer did not find extractable figures." };
}

async function tryAr5ivCandidates(arxivId: string): Promise<AttemptResult> {
  const id = encodeURIComponent(arxivId);
  const native = await tryArxivHtmlCandidates(
    `https://arxiv.org/html/${id}`,
    "ar5iv",
  );
  if (native.status === "candidates") return native;
  return tryArxivHtmlCandidates(
    `https://ar5iv.labs.arxiv.org/html/${id}`,
    "ar5iv",
  );
}

function inferLinkKind(url: string): "html" | "pdf" {
  return /\.pdf(?:$|[?#])/i.test(url) ? "pdf" : "html";
}

function deriveHtmlAlternatives(url: string): string[] {
  const alternatives: string[] = [];

  const arxivPdf = url.match(/https?:\/\/arxiv\.org\/pdf\/([^?#]+?)(?:\.pdf)?(?:[?#].*)?$/i);
  if (arxivPdf?.[1]) alternatives.push(`https://arxiv.org/abs/${arxivPdf[1]}`);

  if (/https?:\/\/(?:www\.)?(?:bio|med)rxiv\.org\//i.test(url) && /\.pdf(?:$|[?#])/i.test(url)) {
    alternatives.push(url.replace(/\.pdf(?:$|[?#].*)/i, ""));
  }

  const pmcMatch = url.match(/PMC\d+/i);
  if (pmcMatch) alternatives.push(`https://pmc.ncbi.nlm.nih.gov/articles/${pmcMatch[0].toUpperCase()}/`);

  return Array.from(new Set(alternatives));
}

function derivePdfAlternatives(url: string): string[] {
  const alternatives: string[] = [];
  const pmcMatch = url.match(/PMC\d+/i);
  if (pmcMatch) {
    alternatives.push(`https://europepmc.org/articles/${pmcMatch[0].toUpperCase()}?pdf=render`);
  }
  return Array.from(new Set(alternatives));
}

function validApiEmail(): string | null {
  const email = (process.env.UNPAYWALL_EMAIL ?? process.env.OPENALEX_EMAIL ?? "").trim();
  if (!email || !/@/.test(email) || /example\.com$/i.test(email)) return null;
  return email;
}

async function lookupUnpaywallLinks(doi: string): Promise<SourceLink[]> {
  const email = validApiEmail();
  if (!email) return [];

  const apiUrl = `https://api.unpaywall.org/v2/${encodeURIComponent(cleanDoi(doi))}?email=${encodeURIComponent(email)}`;
  const res = await timedFetch(apiUrl, { headers: { Accept: "application/json" } });
  if (!res || !res.ok) return [];

  try {
    const data = (await res.json()) as UnpaywallRecord;
    const rawLinks = [
      data.best_oa_location,
      ...asArray(data.oa_locations),
    ]
      .flatMap((location) => [
        location?.url_for_landing_page ?? null,
        location?.url_for_pdf ?? null,
        location?.url ?? null,
      ])
      .filter((value): value is string => Boolean(value));

    return rawLinks.flatMap((url) => [
      { url, kind: inferLinkKind(url), label: "unpaywall" as const },
      ...derivePdfAlternatives(url).map((derivedUrl) => ({
        url: derivedUrl,
        kind: "pdf" as const,
        label: "derived" as const,
      })),
      ...deriveHtmlAlternatives(url).map((derivedUrl) => ({
        url: derivedUrl,
        kind: "html" as const,
        label: "derived" as const,
      })),
    ]);
  } catch {
    return [];
  }
}

async function lookupEuropePmcLinks(doi: string): Promise<SourceLink[]> {
  const apiUrl =
    "https://www.ebi.ac.uk/europepmc/webservices/rest/search" +
    `?query=DOI:${encodeURIComponent(cleanDoi(doi))}&resultType=core&format=json`;
  const res = await timedFetch(apiUrl, { headers: { Accept: "application/json" } });
  if (!res || !res.ok) return [];

  try {
    const data = (await res.json()) as {
      resultList?: { result?: EuropePmcResult[] };
    };
    const result = data.resultList?.result?.[0];
    if (!result) return [];

    const links = asArray(result.fullTextUrlList?.fullTextUrl)
      .map((entry) => entry.url)
      .filter((value): value is string => Boolean(value))
      .flatMap((url) => [
        { url, kind: inferLinkKind(url), label: "europepmc" as const },
        ...deriveHtmlAlternatives(url).map((derivedUrl) => ({
          url: derivedUrl,
          kind: "html" as const,
          label: "derived" as const,
        })),
      ]);

    if (result.pmcid) {
      links.push({
        url: `https://pmc.ncbi.nlm.nih.gov/articles/${result.pmcid}/`,
        kind: "html",
        label: "europepmc",
      });
      links.push({
        url: `https://europepmc.org/articles/${result.pmcid}?pdf=render`,
        kind: "pdf",
        label: "europepmc",
      });
    }

    return links;
  } catch {
    return [];
  }
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
 * A hard 401/402/403/451 is as clear a paywall signal as a fetch ever gets.
 * 1-22 (mirrors 1-16 in papers/full-text.ts): this used to live inside
 * `appearsPaywalled`, which is only ever called after a successful (2xx)
 * fetch in `tryHtmlCandidates` — a real 401/402/403/451 response returns on
 * the earlier `!res.ok` branch and never reached it, so Wiley/ACS's genuine
 * 403s were reported as `source_unavailable` instead of `paywalled` here too.
 */
function looksLikePaywallStatus(status: number): boolean {
  return [401, 402, 403, 451].includes(status);
}

function appearsPaywalled(url: string, html: string): boolean {
  if (hostLooksOpenAccess(url)) return false;
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

// Exported for tests only (1-22) — every other caller in this file reaches
// it through `buildCandidatePool`/`getCandidatePool`.
export async function tryHtmlCandidates(
  url: string,
  source: FigureCandidate["source"],
): Promise<AttemptResult> {
  const res = await timedFetch(url);
  if (!res || !res.ok) {
    // 1-22: a hard 401/402/403/451 here is the same publisher access gate
    // 1-16 fixed for the report's own full-text path — Wiley/ACS both
    // hard-403 after their DOI redirect resolves correctly, and were
    // reported as `source_unavailable` ("could not reach") instead.
    if (res && !hostLooksOpenAccess(url) && looksLikePaywallStatus(res.status)) {
      return { status: "paywalled", candidates: [], reason: paywallReason(url) };
    }
    return {
      status: "source_unavailable",
      candidates: [],
      reason: `Peer could not reach ${url}.`,
    };
  }

  const contentType = res.headers.get("content-type") ?? "";
  if (/pdf/i.test(contentType)) {
    return tryPdfCandidates(res.url || url, source);
  }

  if (contentType && !/html|xml/i.test(contentType)) {
    return {
      status: "source_unavailable",
      candidates: [],
      reason: "The source response was not a figure-readable HTML page.",
    };
  }

  let finalUrl = res.url || url;
  let html = await readBoundedText(res);
  if (appearsPaywalled(finalUrl, html)) {
    return {
      status: "paywalled",
      candidates: [],
      reason: paywallReason(finalUrl),
    };
  }

  // 1-21: a 2xx HTML response can still be an intermediate identity-check
  // stub rather than the article — Nature's DOI resolution sends every
  // unauthenticated request through one (`idp.nature.com/transit`, ~3KB,
  // a "checking your browser" cookie notice). Reporting this as "reached
  // the source page, but it did not expose extractable figures" (today's
  // `no_figures` message, a few lines down) would be false — Peer never saw
  // the article. One retry first: a generic "small bounce page" heuristic
  // (not a nature.com-specific branch, per §1d) since some publishers' bounce
  // is a one-off transient hiccup a plain retry clears. Live-verified against
  // a real Nature.com DOI this round: for Nature specifically, neither a
  // plain retry nor one that replayed the bounce page's own Set-Cookie header
  // as a Cookie header got past it (both bounced again, with a fresh transit
  // code each time) — so this gateway is not a transient/cookie-missing case
  // a Node-side retry can clear, and no cookie-relay mechanism was added
  // (nothing to commit to that was shown to work). The retry still runs
  // because it is cheap and may help a different, genuinely transient bounce
  // this round never observed; when it does not clear, the result is at
  // least an honest `source_unavailable` instead of a false `no_figures`.
  if (looksLikeBouncePage(finalUrl, html)) {
    const retryRes = await timedFetch(url);
    const retryFinalUrl = retryRes?.url || url;
    const retryHtml = retryRes?.ok ? await readBoundedText(retryRes) : "";
    if (retryRes?.ok && !looksLikeBouncePage(retryFinalUrl, retryHtml)) {
      finalUrl = retryFinalUrl;
      html = retryHtml;
    } else {
      return {
        status: "source_unavailable",
        candidates: [],
        reason: bouncePageReason(finalUrl),
      };
    }
  }

  const candidates = htmlFigureCandidates(html, finalUrl, source);
  // 1-19: fold the graphical-abstract/og:image fallback in here (rather than
  // only in `extractFigure`'s query-less last resort) so `getFigurePool` —
  // used by every deep-report section's figure binding, and by `/api/figure`
  // whenever a `query` is supplied — can reach it too. Pushed as one extra,
  // low-priority candidate (`sourcePriority` already ranks "og" below
  // "semantic-scholar") so a real in-article figure still wins when both
  // exist.
  const ogCandidate = ogImageCandidate(html, finalUrl, candidates.length);
  if (ogCandidate) candidates.push(ogCandidate);

  if (candidates.length === 0) {
    return {
      status: "no_figures",
      candidates: [],
      reason: "Peer reached the source page, but it did not expose extractable figures.",
    };
  }

  return {
    status: "candidates",
    candidates,
  };
}

function addSourceLink(target: Map<string, SourceLink>, link: SourceLink) {
  const normalized = link.url.trim();
  if (!normalized) return;
  if (!target.has(normalized)) target.set(normalized, link);
}

async function collectSourceLinks(input: ExtractInput): Promise<SourceLink[]> {
  const links = new Map<string, SourceLink>();
  const inputUrlWasPdf = input.url ? inferLinkKind(input.url) === "pdf" : false;

  if (input.url) {
    addSourceLink(links, {
      url: input.url,
      kind: inferLinkKind(input.url),
      label: "input",
    });
    for (const alt of deriveHtmlAlternatives(input.url)) {
      addSourceLink(links, { url: alt, kind: "html", label: "derived" });
    }
    for (const alt of derivePdfAlternatives(input.url)) {
      addSourceLink(links, { url: alt, kind: "pdf", label: "derived" });
    }
  }

  if (input.doi) {
    addSourceLink(links, {
      url: doiUrl(input.doi),
      kind: "html",
      label: "doi",
    });

    const cleaned = cleanDoi(input.doi);
    if (/^10\.1101\//i.test(cleaned)) {
      for (const host of ["biorxiv.org", "medrxiv.org"]) {
        addSourceLink(links, {
          url: `https://www.${host}/content/${cleaned}v1.full`,
          kind: "html",
          label: "derived",
        });
      }
    }

    for (const link of await lookupUnpaywallLinks(input.doi)) addSourceLink(links, link);
    for (const link of await lookupEuropePmcLinks(input.doi)) addSourceLink(links, link);
  }

  return Array.from(links.values()).sort((a, b) => {
    const rank = (link: SourceLink) =>
      inputUrlWasPdf && link.label === "derived" && link.kind === "html"
        ? -1
        : link.label === "input"
          ? 0
          : link.label === "unpaywall"
            ? 1
            : link.label === "europepmc"
              ? 2
              : link.label === "doi"
                ? 3
                : 4;
    return rank(a) - rank(b);
  });
}

function finalDiagnostic(
  attempts: AttemptResult[],
  mismatchReason?: string,
): FigureResult {
  if (mismatchReason) {
    return {
      imageUrl: null,
      source: null,
      status: "caption_mismatch",
      reason: mismatchReason,
      hideFigure: false,
      matchedBy: null,
    };
  }

  const paywalled = attempts.find((attempt) => attempt.status === "paywalled");
  if (paywalled) {
    return {
      imageUrl: null,
      source: null,
      status: "paywalled",
      reason: paywalled.reason ?? "The figure source appears paywalled.",
      hideFigure: true,
      matchedBy: null,
    };
  }

  const noFigures = attempts.find((attempt) => attempt.status === "no_figures");
  if (noFigures) {
    return {
      imageUrl: null,
      source: null,
      status: "no_figures",
      reason: noFigures.reason ?? "Peer reached the source page, but did not find extractable figures.",
      hideFigure: false,
      matchedBy: null,
    };
  }

  // 1-20: a real "reached the page, nothing there" verdict above is still the
  // more informative message when one exists — this only replaces the
  // generic "could not reach" fallback below, for the case where every
  // attempt on this paper was some flavor of unreachable and at least one of
  // those was specifically a throttled Semantic Scholar lookup. Saying
  // "no figures" here would be dishonest: the truth is Peer never got an
  // answer, not that it checked and found nothing.
  const rateLimited = attempts.find((attempt) => attempt.status === "rate_limited");
  if (rateLimited) {
    return {
      imageUrl: null,
      source: null,
      status: "rate_limited",
      reason:
        rateLimited.reason ??
        "A figure source rate-limited Peer's request; try again in a moment.",
      hideFigure: false,
      matchedBy: null,
    };
  }

  return {
    imageUrl: null,
    source: null,
    status: "source_unavailable",
    reason:
      attempts.find((attempt) => attempt.reason)?.reason ??
      "Peer could not reach a usable full-text source for this paper's figures.",
    hideFigure: false,
    matchedBy: null,
  };
}

// ── Per-paper candidate-pool cache ──────────────────────────────────────
// Different report sections each call /api/figure with the same paper but
// different (figureIndex, query). Without caching, each call independently
// re-fetches ar5iv + downloads the PDF + spawns Python. Random network hiccups
// then cause one section to "find figures" while another shows "no extractable
// figures" for the SAME paper. This cache fetches the unified candidate pool
// ONCE per paper, then every section picks from it deterministically.
interface CachedPool {
  candidates: FigureCandidate[];
  attempts: AttemptResult[];
  ts: number;
}
const CANDIDATE_CACHE_TTL_MS = 30 * 60 * 1000;
const candidatePoolCache = new Map<string, CachedPool | Promise<CachedPool>>();

function poolCacheKey(input: ExtractInput): string {
  return [FETCH_VERSION, input.itemId, input.url ?? "", input.doi ?? ""].join("|");
}

async function buildCandidatePool(input: ExtractInput): Promise<CachedPool> {
  const attempts: AttemptResult[] = [];
  const candidates: FigureCandidate[] = [];

  // Prefer original paper sources first. Semantic Scholar is useful, but its
  // figure URLs are often thumbnails, so it should enrich the pool rather than
  // short-circuit HTML/PDF extraction.
  const arxivId =
    bareArxivId(input.itemId) ??
    (input.doi ? arxivIdFromDoi(input.doi) : null) ??
    (input.url ? arxivIdFromUrl(input.url) : null);
  const openAlexId = bareOpenAlexId(input.itemId);

  const originalTasks: Promise<AttemptResult>[] = [];
  const semanticTasks: Promise<AttemptResult>[] = [];
  if (arxivId) {
    originalTasks.push(tryAr5ivCandidates(arxivId));
    originalTasks.push(tryPdfCandidates(`https://arxiv.org/pdf/${arxivId}`, "open-access"));
    semanticTasks.push(trySemanticScholarCandidates(`arXiv:${arxivId}`));
  }
  if (openAlexId) {
    semanticTasks.push(trySemanticScholarCandidates(`OpenAlex:${openAlexId}`));
  }
  if (input.doi) {
    semanticTasks.push(trySemanticScholarCandidates(`DOI:${cleanDoi(input.doi)}`));
  }

  const originalSettled = await Promise.allSettled(originalTasks);
  for (const r of originalSettled) {
    if (r.status !== "fulfilled") continue;
    attempts.push(r.value);
    if (r.value.status === "candidates") candidates.push(...r.value.candidates);
  }

  // For non-arxiv papers (or arxiv papers where above produced nothing), walk
  // publisher/open-access source links — PDFs first, HTML last — and add their
  // candidates to the pool too. This runs sequentially to respect external rate
  // limits on publisher sites.
  if (!arxivId) {
    const sourceLinks = await collectSourceLinks(input);
    for (const link of sourceLinks) {
      const attempt =
        link.kind === "pdf"
          ? await tryPdfCandidates(
              link.url,
              link.label === "input" || link.label === "doi" ? "publisher" : "open-access",
            )
          : await tryHtmlCandidates(
              link.url,
              link.label === "input" || link.label === "doi" ? "publisher" : "open-access",
            );
      attempts.push(attempt);
      if (attempt.status === "candidates") {
        candidates.push(...attempt.candidates);
        const originalCount = candidates.filter(
          (candidate) => candidate.source !== "semantic-scholar",
        ).length;
        const hasPdfCandidates = candidates.some((candidate) =>
          candidate.imageUrl.startsWith("data:image/"),
        );
        if (originalCount >= 12 && hasPdfCandidates) break;
      }
    }
  }

  const semanticSettled = await Promise.allSettled(semanticTasks);
  for (const r of semanticSettled) {
    if (r.status !== "fulfilled") continue;
    attempts.push(r.value);
    if (r.value.status === "candidates") candidates.push(...r.value.candidates);
  }

  // Re-ordinalize so figure indices in the unified pool are stable 0..N-1.
  const reordered: FigureCandidate[] = candidates
    .filter((c) => !looksLikeLogo(c.imageUrl))
    .map((c, i) => ({ ...c, ordinal: i }));

  return { candidates: reordered, attempts, ts: Date.now() };
}

async function getCandidatePool(input: ExtractInput): Promise<CachedPool> {
  const key = poolCacheKey(input);
  const existing = candidatePoolCache.get(key);
  if (existing) {
    const resolved = existing instanceof Promise ? await existing : existing;
    if (Date.now() - resolved.ts <= CANDIDATE_CACHE_TTL_MS && resolved.candidates.length > 0) {
      return resolved;
    }
    // Expired or empty — fall through to rebuild.
    candidatePoolCache.delete(key);
  }
  const pending = buildCandidatePool(input);
  candidatePoolCache.set(key, pending);
  try {
    const pool = await pending;
    candidatePoolCache.set(key, pool);
    return pool;
  } catch (err) {
    candidatePoolCache.delete(key);
    throw err;
  }
}

/**
 * Public, cached snapshot of the figure candidate pool for one paper. Used
 * by the deep-report binding flow so it can attach the actual high-quality
 * image URL (and source label) to each report section directly — no second
 * round-trip through `/api/figure` is needed once binding picks a winner.
 *
 * The shape mirrors the internal `FigureCandidate` so the binding can apply
 * the same caption/quality scoring without re-implementing it.
 */
export interface FigurePoolEntry {
  imageUrl: string;
  caption: string | null;
  source: NonNullable<FigureResult["source"]>;
  ordinal: number;
  qualityHint?: "high" | "medium" | "low";
}

export interface FigurePool {
  entries: FigurePoolEntry[];
  /** True when at least one extractor attempt completed (regardless of result). */
  attempted: boolean;
}

export async function getFigurePool(input: ExtractInput): Promise<FigurePool> {
  const pool = await getCandidatePool(input);
  return {
    entries: pool.candidates.map((c) => ({
      imageUrl: c.imageUrl,
      caption: c.caption ?? null,
      source: c.source,
      ordinal: c.ordinal,
      qualityHint: c.qualityHint,
    })),
    attempted: pool.attempts.length > 0,
  };
}

/**
 * Caption-aware best-of helpers for the binding path. Mirrors the scoring
 * used by `chooseCandidate` so the bound figure stays consistent with what
 * `extractFigure` would have picked for the same query — but lets the deep
 * report ship the URL/caption/source straight to the client, skipping the
 * second-extractor handoff that previously dropped explicit-figure matches.
 */
export function pickFigureForCaption(
  pool: FigurePool,
  matchedCaption: string,
  matchedFigureLabel?: string | null,
): FigurePoolEntry | null {
  if (pool.entries.length === 0) return null;
  const wantedNumber = explicitFigureNumber(
    matchedFigureLabel ?? matchedCaption,
  );

  // Phase 1: when we know the explicit figure number ("Figure 3"), keep only
  // candidates whose caption matches that same number, then pick the highest
  // quality. This survives even when one extractor labels captions and the
  // other strips the prefix — we filter by the binding's chosen number.
  if (wantedNumber) {
    const matched = pool.entries.filter((entry) =>
      candidateMatchesFigureNumber(
        { caption: entry.caption } as FigureCandidate,
        wantedNumber,
      ),
    );
    if (matched.length > 0) {
      return matched.slice().sort((a, b) =>
        candidateQualityScore(b as FigureCandidate) -
          candidateQualityScore(a as FigureCandidate),
      )[0];
    }
  }

  // Phase 2: caption-token similarity. Pick the entry whose caption shares
  // the most tokens with the matched caption, weighted by quality.
  const queryTokens = new Set(tokenize(matchedCaption));
  let best: { entry: FigurePoolEntry; score: number } | null = null;
  for (const entry of pool.entries) {
    const captionTokens = new Set(tokenize(entry.caption ?? ""));
    let textScore = 0;
    for (const token of queryTokens) {
      if (captionTokens.has(token)) textScore += 1;
    }
    const composite =
      textScore * 30 + candidateQualityScore(entry as FigureCandidate);
    if (!best || composite > best.score) best = { entry, score: composite };
  }
  return best?.entry ?? null;
}

export async function extractFigure(input: ExtractInput): Promise<FigureResult> {
  const n = input.figureIndex ?? 0;
  const paperTitle = input.paperTitle;
  const query = input.query;

  const pool = await getCandidatePool(input);

  if (pool.candidates.length > 0) {
    const selection = await chooseCandidate(pool.candidates, n, query, paperTitle);
    if (selection.status === "found") {
      return candidateResult(selection);
    }
    // Hard guarantee: if we have ANY candidates, never return a placeholder.
    // The user explicitly asked for a real figure in every section.
    const fallback =
      pool.candidates[n] ??
      bestQualityCandidate(pool.candidates) ??
      pool.candidates[0];
    if (fallback) {
      return candidateResult({
        candidate: upgradeCandidateQuality(fallback, pool.candidates),
        status: "found",
        matchedBy: "fallback",
      });
    }
  }

  // Truly nothing available anywhere — preserve the original OG-image
  // fallback for shapes `buildCandidatePool` never fetches `input.url` for
  // (e.g. an arXiv paper, which skips `collectSourceLinks` entirely). Reuses
  // 1-19's guarded helper rather than the bare `metaOgImage` call this used
  // to make directly — otherwise this path could accept an og:image the
  // candidate-pool path (same URL, same guard) had already rejected, which
  // would make the honesty guard inconsistent depending on which code path
  // happened to run.
  if (!query?.trim() && input.url) {
    const res = await timedFetch(input.url);
    if (res?.ok) {
      const html = await readBoundedText(res);
      const finalUrl = res.url || input.url;
      const ogCandidate = ogImageCandidate(html, finalUrl, 0);
      if (ogCandidate) {
        return {
          imageUrl: ogCandidate.imageUrl,
          source: "og",
          status: "found",
          hideFigure: false,
          matchedBy: "fallback",
        };
      }
    }
  }

  return finalDiagnostic(pool.attempts);
}

function metaOgImage(html: string, baseUrl: string): string | null {
  const patterns = [
    /<meta[^>]+property=["']og:image(?::secure_url|:url)?["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image(?::secure_url|:url)?["']/i,
    /<meta[^>]+name=["']twitter:image["'][^>]+content=["']([^"']+)["']/i,
  ];

  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (!match?.[1]) continue;
    const src = match[1].trim();
    if (src.startsWith("data:")) continue;
    const absolute = absolutize(src, baseUrl);
    if (looksLikeLogo(absolute)) continue;
    return absolute;
  }

  return null;
}

// 1-19: a publisher's og:image/twitter:image meta tag is often the article's
// own graphical abstract, but the same tag is just as often a journal cover
// or a generic social-share default. Ruling: only accept it when the image
// URL itself carries an identifying path segment the article page's own URL
// also carries — most publisher CDNs key a graphical abstract's filename by
// the DOI suffix or article id, but a shared cover/masthead image does not.
// No identifying segment to check against -> reject. Unsure is a reason to
// show nothing, never a reason to guess (§1d, "never fabricate a figure").
function articleSpecificToken(articleUrl: string): string | null {
  try {
    const segments = new URL(articleUrl).pathname.split("/").filter(Boolean);
    // The DOI suffix (e.g. "adfm.78026") or a similarly-shaped last path
    // segment is the part a publisher's own CDN is most likely to echo back
    // in an image filename. Require some digits so a bare word like "full"
    // or "abstract" never counts as identifying.
    const candidate = segments[segments.length - 1];
    if (candidate && candidate.length >= 4 && /\d/.test(candidate)) {
      return candidate.toLowerCase();
    }
    return null;
  } catch {
    return null;
  }
}

function ogImageCandidate(
  html: string,
  articleUrl: string,
  ordinal: number,
): FigureCandidate | null {
  const imageUrl = metaOgImage(html, articleUrl);
  if (!imageUrl) return null;
  if (looksLikeCoverImage(imageUrl)) return null;
  const token = articleSpecificToken(articleUrl);
  if (!token || !imageUrl.toLowerCase().includes(token)) return null;
  return {
    imageUrl,
    caption: null,
    source: "og",
    ordinal,
    qualityHint: "low",
  };
}

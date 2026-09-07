// Report-driven figure binding.
//
// Phase 5 of the deep-report flow. Runs AFTER the text report is finalized:
// for the proposal/novelty section and for each key result, look at the
// figure captions in the extracted document and decide whether the section
// has a good caption match. Only attach a figure when the match is confident;
// UI shows "no figure" otherwise.
//
// Matching strategy (in order):
//   1. Explicit reference in the result's evidence/detail ("as shown in
//      Fig. 3" / "Figure 2b").
//   2. Keyword overlap between the section text and a caption.
//   3. Semantic match via the small LLM (caption-only — cheap, no images).

import type { DigestProvider } from "@/lib/llm/providers/types";
import type { ExtractedFigureCaption } from "./html-text";
import type { PaperReport, PaperReportKeyResult } from "./report";
import {
  pickFigureForCaption,
  type FigurePool,
  type FigurePoolEntry,
} from "@/lib/figures/extract";

const KEYWORD_THRESHOLD_LONG_QUERY = 3;
const KEYWORD_THRESHOLD_SHORT_QUERY = 2;

const STOPWORDS = new Set([
  "the", "and", "for", "with", "from", "this", "that", "these", "those",
  "show", "shows", "showed", "showing", "uses", "used", "using",
  "we", "our", "their", "it", "its", "is", "was", "were", "are", "be",
  "in", "of", "on", "at", "to", "by", "as", "an", "a",
  "figure", "fig", "table", "results", "result", "method", "methods",
  "paper", "study", "approach", "model", "system",
]);

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .split(/\s+/)
    .filter((token) => token.length >= 3 && !STOPWORDS.has(token));
}

function extractExplicitFigureLabel(text: string): string | null {
  if (!text) return null;
  const match = text.match(/\b(fig(?:ure)?\.?\s*(\d+)([a-z]?))\b/i);
  if (!match) return null;
  const suffix = (match[3] ?? "").toUpperCase();
  return `Figure ${match[2]}${suffix}`;
}

function normalizeLabel(label: string): string {
  const match = label.match(/(\d+)([a-z]?)/i);
  if (!match) return label.trim();
  return `Figure ${match[1]}${(match[2] ?? "").toUpperCase()}`.trim();
}

function findCaptionByLabel(
  captions: ExtractedFigureCaption[],
  label: string,
): ExtractedFigureCaption | null {
  const wanted = normalizeLabel(label).toLowerCase();
  for (const cap of captions) {
    if (normalizeLabel(cap.label).toLowerCase() === wanted) return cap;
  }
  return null;
}

function labelKey(label: string): string {
  return normalizeLabel(label).toLowerCase();
}

function keywordScore(
  query: string,
  caption: ExtractedFigureCaption,
): { score: number; matched: number } {
  const queryTokens = new Set(tokenize(query));
  const capTokens = new Set(tokenize(caption.caption));
  let matched = 0;
  for (const token of queryTokens) {
    if (capTokens.has(token)) matched += 1;
  }
  return { score: matched, matched };
}

function pickBestKeywordMatch(
  query: string,
  captions: ExtractedFigureCaption[],
): { caption: ExtractedFigureCaption; matched: number } | null {
  if (captions.length === 0 || !query.trim()) return null;
  const tokens = tokenize(query);
  const threshold =
    tokens.length <= 5 ? KEYWORD_THRESHOLD_SHORT_QUERY : KEYWORD_THRESHOLD_LONG_QUERY;

  let best: { caption: ExtractedFigureCaption; matched: number } | null = null;
  for (const cap of captions) {
    const { matched } = keywordScore(query, cap);
    if (matched < threshold) continue;
    if (!best || matched > best.matched) best = { caption: cap, matched };
  }
  return best;
}

interface SemanticMatchResult {
  ordinal: number;
  confidence: "low" | "medium" | "high";
  reason?: string;
}

const SEMANTIC_SYSTEM = [
  "You are a careful research assistant matching paper figure captions to a query.",
  "Pick AT MOST ONE figure whose caption most directly illustrates the query.",
  "Return low confidence when no caption is a clear illustration of the query.",
  "Never invent figures that are not in the supplied list.",
  "Return only valid JSON.",
].join(" ");

async function matchSemantically(args: {
  query: string;
  paperTitle?: string;
  captions: ExtractedFigureCaption[];
  provider: DigestProvider;
}): Promise<SemanticMatchResult | null> {
  if (!args.provider.generateJsonText) return null;
  if (args.captions.length === 0) return null;

  const payload = JSON.stringify({
    task: "Pick the figure caption that best illustrates the query, or return confidence: low if none does.",
    paperTitle: args.paperTitle ?? "",
    query: args.query,
    captions: args.captions.map((cap) => ({
      ordinal: cap.ordinal,
      label: cap.label,
      caption: cap.caption.slice(0, 360),
    })),
    outputSchema: {
      ordinal: "integer matching one supplied caption ordinal, or -1 if no good match",
      confidence: "low|medium|high",
      reason: "one short sentence justifying the match (or why none fits)",
    },
  });

  try {
    const raw = await args.provider.generateJsonText({
      systemPrompt: SEMANTIC_SYSTEM,
      userPrompt: payload,
      maxTokens: 200,
      tier: "small",
    });
    const json = safeJson(raw);
    if (!json) return null;
    const ordinal = Number(json.ordinal);
    const confidence = String(json.confidence ?? "low").toLowerCase();
    if (!Number.isFinite(ordinal) || ordinal < 0) {
      return { ordinal: -1, confidence: "low" };
    }
    return {
      ordinal,
      confidence:
        confidence === "high" ? "high" : confidence === "medium" ? "medium" : "low",
      reason: typeof json.reason === "string" ? json.reason : undefined,
    };
  } catch (err) {
    console.warn("[figure-binding] semantic match failed:", err);
    return null;
  }
}

async function pickFigureLabelForQuery(
  queryText: string,
  captions: ExtractedFigureCaption[],
  provider: DigestProvider | null,
  paperTitle?: string,
): Promise<string | null> {
  // 1. Explicit reference in the evidence sentence or detail.
  const explicit = extractExplicitFigureLabel(queryText);
  if (explicit) {
    const match = findCaptionByLabel(captions, explicit);
    if (match) return match.label;
  }

  // 2. Keyword overlap match.
  const keywordMatch = pickBestKeywordMatch(queryText, captions);
  if (keywordMatch && keywordMatch.matched >= 4) {
    return keywordMatch.caption.label;
  }

  // 3. Semantic match via LLM (small tier).
  if (provider?.generateJsonText) {
    const semantic = await matchSemantically({
      query: queryText,
      paperTitle,
      captions,
      provider,
    });
    if (
      semantic &&
      semantic.ordinal >= 0 &&
      semantic.confidence !== "low"
    ) {
      const matchedCaption = captions.find((c) => c.ordinal === semantic.ordinal);
      if (matchedCaption) return matchedCaption.label;
    }
  }

  // Keyword match with lower threshold as a soft last resort.
  if (keywordMatch && keywordMatch.matched >= 2) {
    return keywordMatch.caption.label;
  }

  return null;
}

function safeJson(text: string): Record<string, unknown> | null {
  const candidates = [
    text.trim(),
    text.replace(/^```json\s*/i, "").replace(/```\s*$/g, "").trim(),
  ];
  const match = text.match(/\{[\s\S]*\}/);
  if (match) candidates.push(match[0]);
  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate) as Record<string, unknown>;
    } catch {
      continue;
    }
  }
  return null;
}

interface BindArgs {
  paper: { title?: string };
  report: PaperReport;
  captions: ExtractedFigureCaption[];
  provider: DigestProvider | null;
  /**
   * Optional figure-image pool from the figures pipeline. When supplied,
   * figure-binding attaches the actual image URL (and source label) to each
   * bound section so the UI can render directly without a second
   * `/api/figure` round-trip. Without it, only `figureLabel` is set and the
   * client falls back to the legacy resolver.
   */
  figurePool?: FigurePool | null;
}

interface AttachedImage {
  imageUrl: string | null;
  caption: string | null;
  source: string | null;
}

const NO_IMAGE: AttachedImage = {
  imageUrl: null,
  caption: null,
  source: null,
};

/**
 * Look up the best image in the pool for a chosen caption + label. Returns
 * the URL/caption/source so the binding can attach them to the report.
 */
function resolveImage(
  pool: FigurePool | null | undefined,
  matchedCaption: string,
  matchedLabel: string,
): AttachedImage {
  if (!pool || pool.entries.length === 0) return NO_IMAGE;
  const entry: FigurePoolEntry | null = pickFigureForCaption(
    pool,
    matchedCaption,
    matchedLabel,
  );
  if (!entry) return NO_IMAGE;
  return {
    imageUrl: entry.imageUrl,
    caption: entry.caption,
    source: entry.source,
  };
}

/**
 * Walk the proposal plus every result-section claim and try to bind a figure
 * caption to each. Duplicate result labels are preserved so the UI can group
 * those claims around a single shared figure. When a `figurePool` is
 * supplied, the bound section also carries the actual image URL/caption/
 * source so the UI can render directly.
 */
export async function bindFiguresToReport(
  args: BindArgs,
): Promise<PaperReport> {
  const { report, captions, provider, paper, figurePool } = args;
  if (captions.length === 0) {
    return {
      ...report,
      whatItProposes: {
        ...report.whatItProposes,
        figureLabel: null,
        figureImageUrl: null,
        figureCaption: null,
        figureSource: null,
      },
      resultsAndSignificance: {
        ...report.resultsAndSignificance,
        keyResults: report.resultsAndSignificance.keyResults.map((r) => ({
          ...r,
          figureLabel: null,
          figureImageUrl: null,
          figureCaption: null,
          figureSource: null,
        })),
      },
    };
  }

  const proposalQuery = [
    report.whatItProposes.summary,
    ...report.whatItProposes.methods.map((m) => m.text),
  ]
    .filter(Boolean)
    .join(" ");
  // The proposal-figure pick and each key-result binding are independent LLM
  // calls, so run them concurrently instead of in a sequential await-loop.
  // Promise.all preserves array order, which allocateUniqueFigures relies on.
  const [proposalFigureLabel, boundResults] = await Promise.all([
    pickFigureLabelForQuery(proposalQuery, captions, provider, paper.title),
    Promise.all(
      report.resultsAndSignificance.keyResults.map((result) =>
        bindOneResult(result, captions, provider, paper.title),
      ),
    ),
  ]);

  const allocated = allocateUniqueFigures(
    proposalFigureLabel,
    boundResults,
  );

  // Attach actual image URLs from the figures pool. The pool's caption
  // texts may differ from the html-text extractor's captions (different
  // strippers, different label handling), so we match on the caption text
  // we matched against — `pickFigureForCaption` handles both explicit
  // figure-number filtering AND token similarity.
  const proposalCaptionMatch = allocated.proposalFigureLabel
    ? findCaptionByLabel(captions, allocated.proposalFigureLabel)
    : null;
  const proposalImage = allocated.proposalFigureLabel
    ? resolveImage(
        figurePool,
        proposalCaptionMatch?.caption ?? proposalQuery,
        allocated.proposalFigureLabel,
      )
    : NO_IMAGE;

  const resultsWithImages: PaperReportKeyResult[] = allocated.keyResults.map(
    (result) => {
      if (!result.figureLabel) {
        return {
          ...result,
          figureImageUrl: null,
          figureCaption: null,
          figureSource: null,
        };
      }
      const captionMatch = findCaptionByLabel(captions, result.figureLabel);
      const captionText =
        captionMatch?.caption ??
        [result.title, result.detail, result.evidence]
          .filter(Boolean)
          .join(" ");
      const image = resolveImage(figurePool, captionText, result.figureLabel);
      return {
        ...result,
        figureImageUrl: image.imageUrl,
        figureCaption: image.caption,
        figureSource: image.source,
      };
    },
  );

  return {
    ...report,
    whatItProposes: {
      ...report.whatItProposes,
      figureLabel: allocated.proposalFigureLabel,
      figureImageUrl: proposalImage.imageUrl,
      figureCaption: proposalImage.caption,
      figureSource: proposalImage.source,
    },
    resultsAndSignificance: {
      ...report.resultsAndSignificance,
      keyResults: resultsWithImages,
    },
  };
}

function allocateUniqueFigures(
  proposalFigureLabel: string | null,
  keyResults: PaperReportKeyResult[],
): { proposalFigureLabel: string | null; keyResults: PaperReportKeyResult[] } {
  const resultCounts = new Map<string, number>();
  for (const label of keyResults.map((result) => result.figureLabel ?? null)) {
    if (!label) continue;
    const key = labelKey(label);
    resultCounts.set(key, (resultCounts.get(key) ?? 0) + 1);
  }

  const proposalKey = proposalFigureLabel ? labelKey(proposalFigureLabel) : null;
  const proposalWouldDuplicateGroupedResult =
    proposalKey !== null && (resultCounts.get(proposalKey) ?? 0) > 1;
  const allocatedProposalLabel = proposalWouldDuplicateGroupedResult
    ? null
    : proposalFigureLabel;
  const allocatedProposalKey = allocatedProposalLabel
    ? labelKey(allocatedProposalLabel)
    : null;

  const allocatedResults = keyResults.map((result) => {
    if (!result.figureLabel) return { ...result, figureLabel: null };
    const key = labelKey(result.figureLabel);
    if (key === allocatedProposalKey) {
      return { ...result, figureLabel: null };
    }
    return result;
  });

  return {
    proposalFigureLabel: allocatedProposalLabel,
    keyResults: allocatedResults,
  };
}

async function bindOneResult(
  result: PaperReportKeyResult,
  captions: ExtractedFigureCaption[],
  provider: DigestProvider | null,
  paperTitle?: string,
): Promise<PaperReportKeyResult> {
  const queryText = [result.title, result.detail, result.evidence]
    .filter(Boolean)
    .join(" ");
  const figureLabel = await pickFigureLabelForQuery(
    queryText,
    captions,
    provider,
    paperTitle,
  );
  return { ...result, figureLabel };
}

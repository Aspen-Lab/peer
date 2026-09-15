// Adapted from DeerFlow's MIT-licensed image-viewing workflow.
// See docs/THIRD_PARTY_NOTICES.md.

import { resolveProvider } from "@/lib/llm/providers/registry";
import type { FigureMatchContext } from "./match-context";
import { entitledContext } from "@/lib/security/entitled-context";
import type { VisionImageInput } from "@/lib/llm/providers/types";
import { cleanDisplayText } from "@/lib/text/clean";

const FETCH_TIMEOUT_MS = 7_000;
const MAX_IMAGE_BYTES = 6_000_000;
const SUPPORTED_IMAGE_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
]);

export interface VisionMatchCandidate {
  ordinal: number;
  imageUrl: string;
  caption?: string | null;
}

export interface VisionFigureMatch {
  ordinal: number | null;
  confidence: "high" | "medium" | "low";
  reason: string;
}

interface ParsedVisionVerdict {
  supports: boolean;
  confidence: "high" | "medium" | "low";
  reason: string;
}

function parseJsonObject<T>(text: string): T | null {
  const candidates = [
    text.trim(),
    text.replace(/^```json\s*/i, "").replace(/```\s*$/g, "").trim(),
  ];
  const objectMatch = text.match(/\{[\s\S]*\}/);
  if (objectMatch) candidates.push(objectMatch[0]);

  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate) as T;
    } catch {
      // Try the next candidate.
    }
  }

  return null;
}

function parseVerdict(text: string): ParsedVisionVerdict | null {
  const parsed = parseJsonObject<Partial<ParsedVisionVerdict>>(text);
  if (!parsed) return null;

  return {
    supports: parsed.supports === true,
    confidence:
      parsed.confidence === "high" ||
      parsed.confidence === "medium" ||
      parsed.confidence === "low"
        ? parsed.confidence
        : "low",
    reason: cleanDisplayText(parsed.reason),
  };
}

function parseDataUrlImage(url: string): VisionImageInput | null {
  const match = url.match(/^data:(image\/[a-z0-9.+-]+);base64,(.+)$/i);
  if (!match?.[1] || !match[2]) return null;
  const mimeType = match[1].toLowerCase();
  if (!SUPPORTED_IMAGE_TYPES.has(mimeType)) return null;
  return {
    dataBase64: match[2],
    mimeType: mimeType as VisionImageInput["mimeType"],
  };
}

async function fetchImageInput(url: string): Promise<VisionImageInput | null> {
  const dataUrl = parseDataUrlImage(url);
  if (dataUrl) return dataUrl;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent": "PeerBot/0.1 (+https://peer.research)",
        Accept: "image/png,image/jpeg,image/webp,image/gif,*/*;q=0.8",
      },
      cache: "force-cache",
      next: { revalidate: 86_400 },
    });
    if (!res.ok) return null;

    const mimeType = (res.headers.get("content-type") ?? "")
      .split(";")[0]
      .trim()
      .toLowerCase();
    if (!SUPPORTED_IMAGE_TYPES.has(mimeType)) return null;

    const contentLength = Number.parseInt(res.headers.get("content-length") ?? "", 10);
    if (Number.isFinite(contentLength) && contentLength > MAX_IMAGE_BYTES) return null;

    const bytes = Buffer.from(await res.arrayBuffer());
    if (bytes.byteLength === 0 || bytes.byteLength > MAX_IMAGE_BYTES) return null;

    return {
      dataBase64: bytes.toString("base64"),
      mimeType: mimeType as VisionImageInput["mimeType"],
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function confidenceRank(confidence: VisionFigureMatch["confidence"]): number {
  if (confidence === "high") return 3;
  if (confidence === "medium") return 2;
  return 1;
}

/** ABC-freemium 1-07 · R-SEC-1 — see the note on `matchFigureSemantically`. */
export async function matchFigureVisually(args: {
  paperTitle?: string;
  query: string;
  candidates: VisionMatchCandidate[];
  ctx: FigureMatchContext;
}): Promise<VisionFigureMatch | null> {
  // ABC-freemium 3-02 — minted from the entitlement `api/figure` resolved, so
  // this acquisition carries compile-checked proof rather than a hand-made
  // `{ userId, byok }` that anyone could have written.
  const provider = resolveProvider(
    args.ctx.override ?? null,
    entitledContext(args.ctx.entitlement, "figure:vision", args.ctx.byok),
  );
  if (!provider?.generateVisionJsonText) return null;
  if (!args.query.trim() || args.candidates.length === 0) return null;

  const systemPrompt = [
    "You are Peer, a careful research assistant.",
    "Inspect the actual paper figure image and decide whether it supports the report section by meaning.",
    "Use both the visible figure content and the caption when available.",
    "Only approve a figure when the match is defensible.",
    "Return only valid JSON.",
  ].join(" ");

  let best: VisionFigureMatch | null = null;

  for (const candidate of args.candidates) {
    const image = await fetchImageInput(candidate.imageUrl);
    if (!image) continue;

    const userPrompt = JSON.stringify({
      task: "Decide whether this paper figure image supports the report section.",
      paperTitle: cleanDisplayText(args.paperTitle),
      reportSection: cleanDisplayText(args.query),
      candidate: {
        ordinal: candidate.ordinal,
        caption: cleanDisplayText(candidate.caption),
      },
      outputSchema: {
        supports: "boolean",
        confidence: '"high" | "medium" | "low"',
        reason: "one short sentence explaining the decision",
      },
    });

    try {
      const text = await provider.generateVisionJsonText({
        systemPrompt,
        userPrompt,
        images: [image],
        maxTokens: 300,
        // Figure verification is a small vision classification — pin the cheap
        // vision model rather than letting a flash miss escalate to pro.
        tier: "small",
      });
      const verdict = parseVerdict(text);
      if (!verdict?.supports || verdict.confidence === "low") continue;

      const nextBest: VisionFigureMatch = {
        ordinal: candidate.ordinal,
        confidence: verdict.confidence,
        reason: verdict.reason,
      };
      if (
        !best ||
        confidenceRank(nextBest.confidence) > confidenceRank(best.confidence)
      ) {
        best = nextBest;
      }
    } catch (err) {
      console.warn("[figures/vision-match] provider failed:", err);
      return null;
    }
  }

  return (
    best ?? {
      ordinal: null,
      confidence: "low",
      reason:
        "Peer inspected the available real figure images, but none clearly supported this report section.",
    }
  );
}

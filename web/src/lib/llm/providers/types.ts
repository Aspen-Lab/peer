import { cleanDisplayText } from "@/lib/text/clean";

export type ProviderId = "anthropic" | "gemini" | "openai" | "qwen" | "deepseek" | "ollama";

/**
 * Model intelligence tier. `small` = cheap/fast (classification, simple JSON
 * extraction); `large` = strong (deep paper reading, multi-step reasoning).
 * Each provider maps these to its own small/large model id — see provider
 * implementations. Callers pass a tier; the provider handles the mapping.
 */
export type ModelTier = "small" | "large";

export interface ProviderOverrideConfig {
  provider: Exclude<ProviderId, "ollama">;
  apiKey: string;
  model?: string;
}

export interface PaperLite {
  id: string;
  title: string;
  authors?: string[];
  venue?: string;
  abstract?: string;
}

export interface DigestBullet {
  paperId: string;
  text: string;
}

export interface DigestResult {
  bullets: DigestBullet[];
}

export interface VisionImageInput {
  dataBase64: string;
  mimeType: "image/png" | "image/jpeg" | "image/webp" | "image/gif";
}

export interface DigestProvider {
  id: ProviderId;
  /**
   * P3-02c (ruling §1h.4 amendment): true when `generateJsonText` honours its
   * `webSearch` argument. Both Gemini providers say so; every other provider
   * leaves it out and ignores the argument, so a caller that asks for search of
   * one that cannot gets a plain answer, and the caller says so (the explain
   * route answers `searched: false`). The registry returns the provider object
   * itself, wrapped in nothing, so the flag is read off it exactly as set.
   */
  supportsWebSearch?: true;
  generateDigest(args: {
    papers: PaperLite[];
    contextHint?: string;
  }): Promise<DigestResult>;
  generateJsonText?(args: {
    systemPrompt: string;
    userPrompt: string;
    maxTokens?: number;
    /**
     * Optional intelligence tier. `small` routes economical daily work;
     * `large` routes stronger deep-report reading. Exact IDs live in the shared
     * provider-model catalog. If omitted, providers use their default model so
     * legacy call sites keep working unchanged.
     */
    tier?: ModelTier;
    /**
     * P3-02c (ruling §1h.4 amendment): let the model use web search for this one
     * call (Gemini: the Google Search grounding tool). Honoured only by a
     * provider with `supportsWebSearch`; every other provider ignores it. A
     * grounded call is not in JSON mode — Gemini refuses the two together — so
     * the text comes back as the model wrote it and the caller parses it.
     */
    webSearch?: boolean;
  }): Promise<string>;
  generateVisionJsonText?(args: {
    systemPrompt: string;
    userPrompt: string;
    images: VisionImageInput[];
    maxTokens?: number;
    tier?: ModelTier;
  }): Promise<string>;
  testConnection(): Promise<{ ok: boolean; error?: string }>;
}

// ── Shared prompt helpers (same prompt across all providers) ────

export const DIGEST_SYSTEM_PROMPT = `You are Peer, a calm research messenger that produces a structured daily briefing for a researcher.

Your task: given today's papers and the user's project context, write ONE focused sentence per paper that captures its key result — not the topic, the actual finding. Tone: weather-forecast — confident, distilled, never breathless. Lead with the result (e.g. "Pulsed electrodeposition achieves (104)-oriented LCO at sub-5 mA/cm² without 500 °C anneal."), not a description of what the paper does.

RELEVANCE: every paper shown was selected because it matches one of the user's stated "Required interests" (provided in the context). In each sentence, make that connection explicit — naturally name the specific interest/keyword the paper addresses (e.g. mention "LCO" or "solid-state battery") so the reader instantly sees why it's relevant, even when the paper's title doesn't contain that word. Still lead with the concrete result; weave the keyword in, don't tack it on.

IMPORTANT — formatting: Write in plain readable text only. Do NOT use LaTeX notation (no $...$ math, no _{...} subscripts, no ^{...} superscripts). Write chemical formulas and math in plain Unicode — use actual subscript characters (₀₁₂₃₄₅₆₇₈₉) or write them inline (e.g. Na0.66Mn0.8Fe0.2O2, CO2, Li-ion, x=0.5). This applies to ALL output strings.

Return ONLY valid JSON matching this schema exactly:
{
  "bullets": [
    { "paperId": "<exact paper id from input>", "text": "One-sentence finding." }
  ]
}

Include one bullet per paper, in the same order as the input list. Never fabricate numbers.`;

export function buildUserPrompt(papers: PaperLite[], contextHint?: string): string {
  const contextSection = contextHint
    ? `User context (their current project / open challenges):\n${contextHint}\n\n`
    : "";
  const papersSection = papers
    .map((p, i) => {
      const authors = p.authors?.slice(0, 3).join(", ") ?? "";
      const title = cleanDisplayText(p.title);
      const abstract = p.abstract ? cleanDisplayText(p.abstract) : "(no abstract available)";
      return `[${i + 1}] id=${p.id}\nTitle: ${title}\nAuthors: ${authors}\nVenue: ${p.venue ?? "—"}\nAbstract: ${abstract}\n`;
    })
    .join("\n");
  return `${contextSection}Papers:\n\n${papersSection}\n\nProduce the JSON now.`;
}

export function safeParseDigest(text: string): DigestResult | null {
  // Gemini 2.5 thinking models may include reasoning text before/after the JSON.
  // Strategy: try direct parse, then strip fences, then extract first {...} block.
  const candidates: string[] = [
    text.trim(),
    text.replace(/^```json\s*/i, "").replace(/```\s*$/g, "").trim(),
  ];

  // Extract the first top-level JSON object from anywhere in the text.
  const match = text.match(/\{[\s\S]*\}/);
  if (match) candidates.push(match[0]);

  for (const candidate of candidates) {
    try {
      const obj = JSON.parse(candidate) as Partial<DigestResult>;
      if (!Array.isArray(obj.bullets) || obj.bullets.length === 0) continue;
      return {
        bullets: obj.bullets.filter(
          (b) => typeof b.paperId === "string" && typeof b.text === "string"
        ).map((b) => ({ paperId: b.paperId, text: cleanDisplayText(b.text) })),
      };
    } catch {
      // try next candidate
    }
  }

  console.warn("[digest] Could not parse JSON from model response. First 300 chars:", text.slice(0, 300));
  return null;
}

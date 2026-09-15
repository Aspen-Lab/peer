import {
  createPartFromBase64,
  createPartFromText,
  createUserContent,
  GoogleGenAI,
} from "@google/genai";
import type {
  DigestProvider,
  DigestResult,
  ModelTier,
  VisionImageInput,
} from "./types";
import { DIGEST_SYSTEM_PROMPT, buildUserPrompt, safeParseDigest } from "./types";
import { logLlmUsage, now } from "../usage-log";
import { PROVIDER_MODELS } from "../provider-models";

type ModelTarget = {
  id: string;
  location: "regional" | "global";
  tier: ModelTier;
};

// The server's own Vertex project. Global endpoint only, by the founder's
// call (2026-09-14): Gemini 3 is served from nowhere else — measured on this
// project, every 3.x id answered 404 on us-central1 and 200 on global — and
// the retired 2.5 family is not kept as a regional fallback. Small before
// large: the digest walks the whole chain and takes the first model that
// answers.
const VERTEX_MODEL_CHAIN = [
  { id: PROVIDER_MODELS.gemini.small, location: "global", tier: "small" },
  { id: "gemini-3.5-flash-lite", location: "global", tier: "small" },
  { id: PROVIDER_MODELS.gemini.large, location: "global", tier: "large" },
  { id: "gemini-3.8-flash", location: "global", tier: "large" },
] satisfies ModelTarget[];

// The reader's own Gemini API key. Google retired the 2.5 family for accounts
// created after their successors shipped (a fresh key answers `404 "no longer
// available to new users"`, measured 2026-09-13), so no 2.5 id is tried here:
// each would cost a new key a failed round-trip on every call. Each tier is
// the chosen model, then the next one up the same line.
const GEMINI_API_MODEL_CHAIN = [
  { id: PROVIDER_MODELS.gemini.small, location: "global", tier: "small" },
  { id: "gemini-3.5-flash-lite", location: "global", tier: "small" },
  { id: PROVIDER_MODELS.gemini.large, location: "global", tier: "large" },
  { id: "gemini-3.8-flash", location: "global", tier: "large" },
] satisfies ModelTarget[];

// For tier-aware calls, narrow the chain to a single appropriate model. The
// default chain stays economical-first for digests. `small`/`large` are
// explicit roles rather than guesses from model-name suffixes.
function chainForTier(chain: ModelTarget[], tier?: ModelTier): ModelTarget[] {
  if (!tier) return chain;
  return chain.filter((target) => target.tier === tier);
}

// ── Generation-config policy ─────────────────────────────────────────
//
// Two Gemini-specific gotchas the old code ignored:
//   1. It never forwarded the caller's `maxTokens`, so every call ran with an
//      unbounded output cap.
//   2. It set no `thinkingConfig`, so every model ran its default thinking —
//      hidden reasoning tokens billed + latency on every call, even for
//      bounded JSON extraction/ranking/classification.
// Everything Peer asks a model for is bounded JSON, so thinking is held to the
// floor each family offers: `thinkingBudget: 0` on 2.5 Flash (Flash-Lite is
// off by default and rejects the level field), `thinkingLevel: "minimal"` on
// the Gemini 3 models that accept it. Measured 2026-09-13: 3.6 Flash spends
// 145 thinking tokens on a one-word answer at its default and 0 at minimal;
// 3.8 Flash refuses minimal (`INVALID_ARGUMENT`) and is left at its default,
// with headroom on the cap so its thinking cannot truncate the answer.

const GEN_TIMEOUT_MS = 120_000; // generous per-attempt hang guard, not a latency cap
const THINKING_HEADROOM = 4096;

/** The 2.5 Flash family: thinking off by budget. */
function budgetOff(modelId: string): boolean {
  return /gemini-2\.5-flash/.test(modelId);
}

/** The Gemini 3 models that accept `thinkingLevel: "minimal"`. */
function minimalThinking(modelId: string): boolean {
  return /^gemini-3\.[15]-flash-lite$|^gemini-3\.6-flash$/.test(modelId);
}

/** Output cap including thinking headroom wherever the model may still think. */
function outputCap(modelId: string, maxTokens?: number): number | undefined {
  if (maxTokens == null) return undefined;
  return budgetOff(modelId) ? maxTokens : maxTokens + THINKING_HEADROOM;
}

function thinkingConfig(modelId: string): { thinkingConfig: Record<string, unknown> } | Record<string, never> {
  if (budgetOff(modelId)) return { thinkingConfig: { thinkingBudget: 0 } };
  if (minimalThinking(modelId)) return { thinkingConfig: { thinkingLevel: "minimal" } };
  return {};
}

function genConfig(modelId: string, systemInstruction: string, maxTokens?: number) {
  const cap = outputCap(modelId, maxTokens);
  return {
    systemInstruction,
    responseMimeType: "application/json" as const,
    httpOptions: { timeout: GEN_TIMEOUT_MS },
    ...thinkingConfig(modelId),
    ...(cap ? { maxOutputTokens: cap } : {}),
  };
}

type GeminiResult = {
  text?: string;
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    thoughtsTokenCount?: number;
  };
};

function logGemini(
  modelId: string,
  path: string | undefined,
  result: GeminiResult | undefined,
  started: number,
  ok: boolean,
): void {
  const u = result?.usageMetadata;
  logLlmUsage({
    provider: "gemini",
    model: modelId,
    path,
    inputTokens: u?.promptTokenCount,
    outputTokens: u?.candidatesTokenCount,
    thinkingTokens: u?.thoughtsTokenCount,
    latencyMs: now() - started,
    ok,
  });
}

const clients = new Map<string, GoogleGenAI>();
const apiClients = new Map<string, GoogleGenAI>();

function getModelChain(): ModelTarget[] {
  return VERTEX_MODEL_CHAIN;
}

function getClient(location: string): GoogleGenAI | null {
  const project = process.env.GOOGLE_VERTEX_PROJECT;
  if (!project) return null;

  const cached = clients.get(location);
  if (cached) return cached;

  const client = new GoogleGenAI({
    vertexai: true,
    project,
    location,
  });
  clients.set(location, client);
  return client;
}

function getApiKeyClient(apiKey: string): GoogleGenAI {
  const cached = apiClients.get(apiKey);
  if (cached) return cached;

  const client = new GoogleGenAI({ apiKey });
  apiClients.set(apiKey, client);
  return client;
}

type CallOpts = { maxTokens?: number; path?: string };

async function callModel(
  location: string,
  modelId: string,
  prompt: string,
  systemInstruction = DIGEST_SYSTEM_PROMPT,
  opts: CallOpts = {},
): Promise<string> {
  const client = getClient(location);
  if (!client) throw new Error("GOOGLE_VERTEX_PROJECT not set");

  const started = now();
  try {
    const result = (await client.models.generateContent({
      model: modelId,
      contents: prompt,
      config: genConfig(modelId, systemInstruction, opts.maxTokens),
    })) as GeminiResult;
    logGemini(modelId, opts.path, result, started, true);
    return result.text ?? "";
  } catch (err) {
    logGemini(modelId, opts.path, undefined, started, false);
    throw err;
  }
}

async function callVisionModel(
  location: string,
  modelId: string,
  systemInstruction: string,
  userPrompt: string,
  images: VisionImageInput[],
  opts: CallOpts = {},
): Promise<string> {
  const client = getClient(location);
  if (!client) throw new Error("GOOGLE_VERTEX_PROJECT not set");

  const started = now();
  try {
    const result = (await client.models.generateContent({
      model: modelId,
      contents: createUserContent([
        createPartFromText(userPrompt),
        ...images.map((image) =>
          createPartFromBase64(image.dataBase64, image.mimeType),
        ),
      ]),
      config: genConfig(modelId, systemInstruction, opts.maxTokens),
    })) as GeminiResult;
    logGemini(modelId, opts.path, result, started, true);
    return result.text ?? "";
  } catch (err) {
    logGemini(modelId, opts.path, undefined, started, false);
    throw err;
  }
}

export const geminiProvider: DigestProvider = {
  id: "gemini",

  async generateDigest({ papers, contextHint }): Promise<DigestResult> {
    const regionalLocation = process.env.GOOGLE_VERTEX_LOCATION ?? "us-central1";
    const prompt = buildUserPrompt(papers, contextHint);

    let text = "";
    for (const { id, location } of getModelChain()) {
      const resolvedLocation = location === "global" ? "global" : regionalLocation;
      try {
        text = await callModel(resolvedLocation, id, prompt, DIGEST_SYSTEM_PROMPT, {
          maxTokens: 1500,
          path: "digest",
        });
        if (text.trim()) break;
      } catch (err) {
        console.warn(`[gemini] ${id} @ ${resolvedLocation} failed:`, err);
      }
    }

    if (!text.trim()) throw new Error("All Gemini models returned empty response");
    const parsed = safeParseDigest(text);
    if (!parsed) throw new Error("Failed to parse digest JSON from Gemini");
    return parsed;
  },

  async generateJsonText({ systemPrompt, userPrompt, maxTokens, tier }): Promise<string> {
    const regionalLocation = process.env.GOOGLE_VERTEX_LOCATION ?? "us-central1";
    const chain = chainForTier(getModelChain(), tier);
    const fallback = chain.length > 0 ? chain : getModelChain();

    for (const { id, location } of fallback) {
      const resolvedLocation = location === "global" ? "global" : regionalLocation;
      try {
        const text = await callModel(resolvedLocation, id, userPrompt, systemPrompt, {
          maxTokens,
          path: "json",
        });
        if (text.trim()) return text.trim();
      } catch (err) {
        console.warn(`[gemini] ${id} @ ${resolvedLocation} failed:`, err);
      }
    }

    throw new Error("All Gemini models returned empty response");
  },

  async generateVisionJsonText({ systemPrompt, userPrompt, images, maxTokens, tier }): Promise<string> {
    if (images.length === 0) throw new Error("No images supplied");

    const regionalLocation = process.env.GOOGLE_VERTEX_LOCATION ?? "us-central1";
    const chain = chainForTier(getModelChain(), tier);
    const fallback = chain.length > 0 ? chain : getModelChain();

    for (const { id, location } of fallback) {
      const resolvedLocation = location === "global" ? "global" : regionalLocation;
      try {
        const text = await callVisionModel(
          resolvedLocation,
          id,
          systemPrompt,
          userPrompt,
          images,
          { maxTokens, path: "vision" },
        );
        if (text.trim()) return text.trim();
      } catch (err) {
        console.warn(`[gemini-vision] ${id} @ ${resolvedLocation} failed:`, err);
      }
    }

    throw new Error("All Gemini vision-capable calls returned empty response");
  },

  async testConnection(): Promise<{ ok: boolean; error?: string }> {
    const project = process.env.GOOGLE_VERTEX_PROJECT;
    if (!project) return { ok: false, error: "GOOGLE_VERTEX_PROJECT not set" };

    const [{ id, location }] = getModelChain();
    const regionalLocation = process.env.GOOGLE_VERTEX_LOCATION ?? "us-central1";
    const resolvedLocation = location === "global" ? "global" : regionalLocation;

    try {
      await callModel(resolvedLocation, id, "ping", DIGEST_SYSTEM_PROMPT, { path: "test" });
      return { ok: true };
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  },
};

export function createGeminiApiProvider(
  apiKey: string,
  modelChain: ModelTarget[] = GEMINI_API_MODEL_CHAIN,
): DigestProvider {
  const getClientForApiKey = () => {
    if (!apiKey) throw new Error("GOOGLE_API_KEY not set");
    return getApiKeyClient(apiKey);
  };

  const callApiModel = async (
    modelId: string,
    prompt: string,
    systemInstruction = DIGEST_SYSTEM_PROMPT,
    opts: CallOpts = {},
  ) => {
    const client = getClientForApiKey();
    const started = now();
    try {
      const result = (await client.models.generateContent({
        model: modelId,
        contents: prompt,
        config: genConfig(modelId, systemInstruction, opts.maxTokens),
      })) as GeminiResult;
      logGemini(modelId, opts.path, result, started, true);
      return result.text ?? "";
    } catch (err) {
      logGemini(modelId, opts.path, undefined, started, false);
      throw err;
    }
  };

  const callApiVisionModel = async (
    modelId: string,
    systemInstruction: string,
    userPrompt: string,
    images: VisionImageInput[],
    opts: CallOpts = {},
  ) => {
    const client = getClientForApiKey();
    const started = now();
    try {
      const result = (await client.models.generateContent({
        model: modelId,
        contents: createUserContent([
          createPartFromText(userPrompt),
          ...images.map((image) =>
            createPartFromBase64(image.dataBase64, image.mimeType),
          ),
        ]),
        config: genConfig(modelId, systemInstruction, opts.maxTokens),
      })) as GeminiResult;
      logGemini(modelId, opts.path, result, started, true);
      return result.text ?? "";
    } catch (err) {
      logGemini(modelId, opts.path, undefined, started, false);
      throw err;
    }
  };

  return {
    id: "gemini",

    async generateDigest({ papers, contextHint }): Promise<DigestResult> {
      const prompt = buildUserPrompt(papers, contextHint);
      let text = "";

      for (const { id } of modelChain) {
        try {
          text = await callApiModel(id, prompt, DIGEST_SYSTEM_PROMPT, {
            maxTokens: 1500,
            path: "digest",
          });
          if (text.trim()) break;
        } catch (err) {
          console.warn(`[gemini-api] ${id} failed:`, err);
        }
      }

      if (!text.trim()) throw new Error("All Gemini API models returned empty response");
      const parsed = safeParseDigest(text);
      if (!parsed) throw new Error("Failed to parse digest JSON from Gemini API");
      return parsed;
    },

    async generateJsonText({ systemPrompt, userPrompt, maxTokens, tier }): Promise<string> {
      const chain = chainForTier(modelChain, tier);
      const fallback = chain.length > 0 ? chain : modelChain;
      for (const { id } of fallback) {
        try {
          const text = await callApiModel(id, userPrompt, systemPrompt, {
            maxTokens,
            path: "json",
          });
          if (text.trim()) return text.trim();
        } catch (err) {
          console.warn(`[gemini-api] ${id} failed:`, err);
        }
      }
      throw new Error("All Gemini API models returned empty response");
    },

    async generateVisionJsonText({ systemPrompt, userPrompt, images, maxTokens, tier }): Promise<string> {
      if (images.length === 0) throw new Error("No images supplied");
      const chain = chainForTier(modelChain, tier);
      const fallback = chain.length > 0 ? chain : modelChain;

      for (const { id } of fallback) {
        try {
          const text = await callApiVisionModel(id, systemPrompt, userPrompt, images, {
            maxTokens,
            path: "vision",
          });
          if (text.trim()) return text.trim();
        } catch (err) {
          console.warn(`[gemini-api-vision] ${id} failed:`, err);
        }
      }

      throw new Error("All Gemini API vision calls returned empty response");
    },

    async testConnection(): Promise<{ ok: boolean; error?: string }> {
      if (!apiKey) return { ok: false, error: "GOOGLE_API_KEY not set" };
      try {
        await callApiModel(modelChain[0].id, "ping", DIGEST_SYSTEM_PROMPT, { path: "test" });
        return { ok: true };
      } catch (err) {
        return { ok: false, error: String(err) };
      }
    },
  };
}

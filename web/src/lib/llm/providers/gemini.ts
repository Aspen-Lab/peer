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

const REGIONAL_MODEL_CHAIN = [
  {
    id: PROVIDER_MODELS.gemini.small,
    location: "regional",
    tier: "small",
  },
  {
    id: PROVIDER_MODELS.gemini.large,
    location: "regional",
    tier: "large",
  },
] satisfies ModelTarget[];

const GLOBAL_FALLBACK_CHAIN = [
  { id: "gemini-3.5-flash-lite", location: "global", tier: "small" },
  { id: "gemini-3.6-flash", location: "global", tier: "large" },
] satisfies ModelTarget[];

// The reader's own Gemini API key. Google retired the 2.5 models for accounts
// created after their successors shipped: measured 2026-09-13, a fresh key
// answered `404 "models/gemini-2.5-flash-lite is no longer available to new
// users. Please update your code to use models/gemini-3.5-flash-lite"` (and
// 3.6-flash for 2.5-flash), so every report on that key failed. Each tier
// keeps its cost-optimised 2.5 model first — an older key still has it — and
// falls through to the successor Google names. Vertex is unaffected: its
// regional chain above still serves 2.5.
const GEMINI_API_MODEL_CHAIN = [
  { id: PROVIDER_MODELS.gemini.small, location: "global", tier: "small" },
  { id: "gemini-3.5-flash-lite", location: "global", tier: "small" },
  { id: PROVIDER_MODELS.gemini.large, location: "global", tier: "large" },
  { id: "gemini-3.6-flash", location: "global", tier: "large" },
] satisfies ModelTarget[];

// For tier-aware calls, narrow the chain to a single appropriate model. The
// default chain stays economical-first for digests. `small`/`large` are
// explicit roles rather than guesses from model-name suffixes.
function chainForTier(chain: ModelTarget[], tier?: ModelTier): ModelTarget[] {
  if (!tier) return chain;
  return chain.filter((target) => target.tier === tier);
}

// ── Generation-config policy (the fix) ──────────────────────────────
//
// Two Gemini-specific gotchas the old code ignored:
//   1. It never forwarded the caller's `maxTokens`, so every call ran with an
//      unbounded output cap.
//   2. It set no `thinkingConfig`, so every 2.5 model ran default "dynamic
//      thinking" — hidden reasoning tokens billed + latency on every call,
//      even for bounded JSON extraction/ranking/classification.
// This stays model-aware: the cost-optimized 2.5 Flash-Lite / Flash pair runs
// bounded JSON work with thinking disabled. Gemini 3 fallbacks use a different
// control, so we leave them alone and reserve headroom for their thinking.

const GEN_TIMEOUT_MS = 120_000; // generous per-attempt hang guard, not a latency cap
const THINKING_HEADROOM = 4096;

/** The cost-optimized Gemini 2.5 Flash family runs bounded JSON with thinking off. */
function disableThinking(modelId: string): boolean {
  return /gemini-2\.5-flash/.test(modelId);
}

/** Output cap including thinking headroom where the model still thinks. */
function outputCap(modelId: string, maxTokens?: number): number | undefined {
  if (maxTokens == null) return undefined;
  return disableThinking(modelId) ? maxTokens : maxTokens + THINKING_HEADROOM;
}

function genConfig(modelId: string, systemInstruction: string, maxTokens?: number) {
  const cap = outputCap(modelId, maxTokens);
  return {
    systemInstruction,
    responseMimeType: "application/json" as const,
    httpOptions: { timeout: GEN_TIMEOUT_MS },
    ...(disableThinking(modelId) ? { thinkingConfig: { thinkingBudget: 0 } } : {}),
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
  if (process.env.GOOGLE_VERTEX_ALLOW_GLOBAL_FALLBACK === "true") {
    return [...REGIONAL_MODEL_CHAIN, ...GLOBAL_FALLBACK_CHAIN];
  }
  return REGIONAL_MODEL_CHAIN;
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

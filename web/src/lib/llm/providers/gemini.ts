import {
  createPartFromBase64,
  createPartFromText,
  createUserContent,
  GoogleGenAI,
  ThinkingLevel,
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

const GEMINI_API_MODEL_CHAIN = [
  { id: PROVIDER_MODELS.gemini.small, location: "global", tier: "small" },
  { id: PROVIDER_MODELS.gemini.large, location: "global", tier: "large" },
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
//   2. It set no `thinkingConfig`, so every model ran default "dynamic
//      thinking" — hidden reasoning tokens billed + latency on every call,
//      even for bounded JSON extraction/ranking/classification.
//
// Everything this provider sends is bounded JSON work, so thinking is turned
// OFF for every Gemini Flash model in the chains above. **The control is not
// the same across generations, and sending the wrong one is a 400, not a
// warning** — and `callModel` catches, so a 400 here would empty the chain in
// silence. That is why this matches by FAMILY, and why each family's control
// is the one that was actually observed to work.
//
// ABC-freemium 6-02 · measured live against every id in both chains,
// 2026-09-07, one ping each:
//
//   id                      thinkingBudget:0   thinkingLevel:"MINIMAL"
//   gemini-3.1-flash-lite   OK                 OK
//   gemini-3.5-flash-lite   400 INVALID_ARG    OK
//   gemini-3.6-flash        400 INVALID_ARG    OK
//
// So 2.5 Flash takes `thinkingBudget`, 3.x Flash takes `thinkingLevel`, and
// the swap target happens to accept both. Left with no control at all,
// `gemini-3.6-flash` billed 139 thought tokens for a one-line ping, so this is
// a real charge on the fallback path and not a theoretical one.
//
// A model no family matches keeps thinking ON and gets `THINKING_HEADROOM`, so
// an unmeasured model costs money rather than 400-ing — and
// `gemini.test.ts` fails the moment a chain gains an id no family covers,
// which is the guard that stops the next swap re-opening this.

const GEN_TIMEOUT_MS = 120_000; // generous per-attempt hang guard, not a latency cap
const THINKING_HEADROOM = 4096;

/** Gemini 2.5 Flash — the generation whose thinking control is `thinkingBudget`. */
const GEMINI_2_5_FLASH_FAMILY = /gemini-2\.5-flash\b/;
/** Gemini 3.x Flash — the generation whose thinking control is `thinkingLevel`. */
const GEMINI_3_FLASH_FAMILY = /gemini-3(?:\.\d+)?-flash\b/;

type ThinkingOff =
  | { thinkingBudget: 0 }
  | { thinkingLevel: ThinkingLevel.MINIMAL };

/**
 * The `thinkingConfig` that turns this model's reasoning off, or `undefined`
 * when no control has been verified for it — in which case thinking stays on
 * and the cap reserves headroom for it.
 */
function thinkingOffConfig(modelId: string): ThinkingOff | undefined {
  if (GEMINI_2_5_FLASH_FAMILY.test(modelId)) return { thinkingBudget: 0 };
  if (GEMINI_3_FLASH_FAMILY.test(modelId)) {
    return { thinkingLevel: ThinkingLevel.MINIMAL };
  }
  return undefined;
}

/** True when this model's thinking can be turned off, so its cap needs no headroom. */
function disableThinking(modelId: string): boolean {
  return thinkingOffConfig(modelId) !== undefined;
}

/** Output cap including thinking headroom where the model still thinks. */
function outputCap(modelId: string, maxTokens?: number): number | undefined {
  if (maxTokens == null) return undefined;
  return disableThinking(modelId) ? maxTokens : maxTokens + THINKING_HEADROOM;
}

function genConfig(modelId: string, systemInstruction: string, maxTokens?: number) {
  const cap = outputCap(modelId, maxTokens);
  const thinkingConfig = thinkingOffConfig(modelId);
  return {
    systemInstruction,
    responseMimeType: "application/json" as const,
    httpOptions: { timeout: GEN_TIMEOUT_MS },
    ...(thinkingConfig ? { thinkingConfig } : {}),
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

/**
 * One `usage_events` row per **provider request** (ABC-freemium 2-05 ·
 * Ruling 6 point 5 · R-METER-1 as amended 2026-09-05).
 *
 * A "call" for billing purposes is one HTTP request to a model, so each attempt
 * in a fallback chain gets its own row with its own `ok` and `model`. Both
 * Gemini providers loop over a model chain, so one `generateJsonText` that
 * falls back from model A to model B legitimately writes **two** rows — that is
 * the ledger telling the owner about a retry they paid for, not a defect.
 *
 * **`ok` means "this request produced usable output", not "the HTTP call
 * returned".** Every caller of the four call sites below used to pass a literal
 * `true` on the success path, so a model that answered with empty text wrote an
 * `ok: true` row and the chain then fell through to the next model. The ledger
 * recorded a success the caller never received. The four sites now pass
 * `(result.text ?? "").trim().length > 0`.
 */
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
    logGemini(modelId, opts.path, result, started, (result.text ?? "").trim().length > 0);
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
    logGemini(modelId, opts.path, result, started, (result.text ?? "").trim().length > 0);
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
      logGemini(modelId, opts.path, result, started, (result.text ?? "").trim().length > 0);
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
      logGemini(modelId, opts.path, result, started, (result.text ?? "").trim().length > 0);
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

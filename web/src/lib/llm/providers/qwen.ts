// Alibaba Qwen via DashScope's OpenAI-compatible endpoint. The wire format is
// identical to OpenAI Chat Completions, so we share the call shape and only
// vary the base URL and the model id table.

import type {
  DigestProvider,
  DigestResult,
  ModelTier,
  VisionImageInput,
} from "./types";
import { DIGEST_SYSTEM_PROMPT, buildUserPrompt, safeParseDigest } from "./types";
import { logLlmUsage, now } from "../usage-log";
import { EmptyAnswerError } from "./empty-answer";
import { PROVIDER_MODELS } from "../provider-models";

const QWEN_CHAT_API =
  "https://dashscope-intl.aliyuncs.com/compatible-mode/v1/chat/completions";
const DEFAULT_MODEL = PROVIDER_MODELS.qwen.small;
const SMALL_MODEL = PROVIDER_MODELS.qwen.small;
const LARGE_MODEL = PROVIDER_MODELS.qwen.large;

function modelForTier(defaultModel: string, tier?: ModelTier): string {
  if (tier === "large") return LARGE_MODEL;
  if (tier === "small") return SMALL_MODEL;
  return defaultModel;
}

interface QwenChatResponse {
  choices?: Array<{
    message?: {
      content?: string | null;
    };
  }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}

function apiKeyFromEnv(): string | undefined {
  return process.env.QWEN_API_KEY?.trim() || process.env.DASHSCOPE_API_KEY?.trim() || undefined;
}

async function callQwenChat(args: {
  apiKey: string;
  model: string;
  systemPrompt: string;
  userPrompt: string;
  maxTokens?: number;
  images?: VisionImageInput[];
  jsonMode?: boolean;
}): Promise<string> {
  const {
    apiKey,
    model,
    systemPrompt,
    userPrompt,
    maxTokens = 1500,
    images = [],
    jsonMode = true,
  } = args;

  const textContent =
    images.length === 0
      ? userPrompt
      : [
          { type: "text", text: userPrompt },
          ...images.map((image) => ({
            type: "image_url",
            image_url: {
              url: `data:${image.mimeType};base64,${image.dataBase64}`,
            },
          })),
        ];

  const started = now();
  const res = await fetch(QWEN_CHAT_API, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: textContent },
      ],
      max_tokens: maxTokens,
      enable_thinking: false,
      ...(jsonMode ? { response_format: { type: "json_object" } } : {}),
    }),
    signal: AbortSignal.timeout(20000),
    cache: "no-store",
  });

  if (!res.ok) {
    logLlmUsage({ provider: "qwen", model, latencyMs: now() - started, ok: false });
    const detail = await res.text().catch(() => "");
    throw new Error(`Qwen API error ${res.status}: ${detail.slice(0, 400)}`);
  }

  const data = (await res.json()) as QwenChatResponse;
  logLlmUsage({
    provider: "qwen",
    model,
    inputTokens: data.usage?.prompt_tokens,
    outputTokens: data.usage?.completion_tokens,
    latencyMs: now() - started,
    ok: true,
  });
  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new EmptyAnswerError("Qwen returned empty content");
  return content.trim();
}

export function createQwenProvider(
  apiKey = apiKeyFromEnv(),
  defaultModel: string = DEFAULT_MODEL,
): DigestProvider {
  return {
    id: "qwen",

    async generateDigest({ papers, contextHint }): Promise<DigestResult> {
      if (!apiKey) throw new Error("QWEN_API_KEY not set");
      const text = await callQwenChat({
        apiKey,
        model: defaultModel,
        systemPrompt: DIGEST_SYSTEM_PROMPT,
        userPrompt: buildUserPrompt(papers, contextHint),
        maxTokens: 1800,
      });
      const parsed = safeParseDigest(text);
      if (!parsed) throw new Error("Failed to parse digest JSON from Qwen");
      return parsed;
    },

    async generateJsonText({ systemPrompt, userPrompt, maxTokens = 1500, tier }): Promise<string> {
      if (!apiKey) throw new Error("QWEN_API_KEY not set");
      return callQwenChat({
        apiKey,
        model: modelForTier(defaultModel, tier),
        systemPrompt,
        userPrompt,
        maxTokens,
      });
    },

    async generateVisionJsonText({
      systemPrompt,
      userPrompt,
      images,
      maxTokens = 1200,
      tier,
    }): Promise<string> {
      if (!apiKey) throw new Error("QWEN_API_KEY not set");
      if (images.length === 0) throw new Error("No images supplied");
      const visionModel = modelForTier(defaultModel, tier);
      return callQwenChat({
        apiKey,
        model: visionModel,
        systemPrompt,
        userPrompt,
        maxTokens,
        images,
      });
    },

    async testConnection(): Promise<{ ok: boolean; error?: string }> {
      if (!apiKey) return { ok: false, error: "QWEN_API_KEY not set" };
      try {
        await callQwenChat({
          apiKey,
          model: SMALL_MODEL,
          systemPrompt: "Reply with JSON.",
          userPrompt: '{"ping":true}',
          maxTokens: 32,
        });
        return { ok: true };
      } catch (err) {
        // An empty answer is still an accepted request: the key works.
        if (err instanceof EmptyAnswerError) return { ok: true };
        return { ok: false, error: String(err) };
      }
    },
  };
}

export const qwenProvider: DigestProvider = createQwenProvider();

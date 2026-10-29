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

const OPENAI_CHAT_API = "https://api.openai.com/v1/chat/completions";
const DEFAULT_MODEL = PROVIDER_MODELS.openai.small;
const SMALL_MODEL = PROVIDER_MODELS.openai.small;
const LARGE_MODEL = PROVIDER_MODELS.openai.large;

function modelForTier(defaultModel: string, tier?: ModelTier): string {
  if (tier === "large") return LARGE_MODEL;
  if (tier === "small") return SMALL_MODEL;
  return defaultModel;
}

interface OpenAIChatResponse {
  choices?: Array<{
    message?: {
      content?: string | null;
    };
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    completion_tokens_details?: { reasoning_tokens?: number };
  };
}

function apiKeyFromEnv(): string | undefined {
  return process.env.OPENAI_API_KEY?.trim() || undefined;
}

async function callOpenAIChat(args: {
  apiKey: string;
  model?: string;
  systemPrompt: string;
  userPrompt: string;
  maxTokens?: number;
  images?: VisionImageInput[];
}): Promise<string> {
  const {
    apiKey,
    model = DEFAULT_MODEL,
    systemPrompt,
    userPrompt,
    maxTokens = 1500,
    images = [],
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
  const res = await fetch(OPENAI_CHAT_API, {
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
      max_completion_tokens: maxTokens,
      reasoning_effort: "none",
      response_format: { type: "json_object" },
    }),
    signal: AbortSignal.timeout(15000),
    cache: "no-store",
  });

  if (!res.ok) {
    logLlmUsage({ provider: "openai", model, latencyMs: now() - started, ok: false });
    const detail = await res.text().catch(() => "");
    throw new Error(`OpenAI API error ${res.status}: ${detail.slice(0, 400)}`);
  }

  const data = (await res.json()) as OpenAIChatResponse;
  logLlmUsage({
    provider: "openai",
    model,
    inputTokens: data.usage?.prompt_tokens,
    outputTokens: data.usage?.completion_tokens,
    thinkingTokens: data.usage?.completion_tokens_details?.reasoning_tokens,
    latencyMs: now() - started,
    ok: true,
  });
  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new EmptyAnswerError("OpenAI returned empty content");
  return content.trim();
}

export function createOpenAIProvider(
  apiKey = apiKeyFromEnv(),
  model: string = DEFAULT_MODEL,
): DigestProvider {
  return {
    id: "openai",

    async generateDigest({ papers, contextHint }): Promise<DigestResult> {
      if (!apiKey) throw new Error("OPENAI_API_KEY not set");
      const text = await callOpenAIChat({
        apiKey,
        model,
        systemPrompt: DIGEST_SYSTEM_PROMPT,
        userPrompt: buildUserPrompt(papers, contextHint),
        maxTokens: 1800,
      });
      const parsed = safeParseDigest(text);
      if (!parsed) throw new Error("Failed to parse digest JSON from OpenAI");
      return parsed;
    },

    async generateJsonText({ systemPrompt, userPrompt, maxTokens = 1500, tier }): Promise<string> {
      if (!apiKey) throw new Error("OPENAI_API_KEY not set");
      return callOpenAIChat({
        apiKey,
        model: modelForTier(model, tier),
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
      if (!apiKey) throw new Error("OPENAI_API_KEY not set");
      if (images.length === 0) throw new Error("No images supplied");
      return callOpenAIChat({
        apiKey,
        model: modelForTier(model, tier),
        systemPrompt,
        userPrompt,
        maxTokens,
        images,
      });
    },

    async testConnection(): Promise<{ ok: boolean; error?: string }> {
      if (!apiKey) return { ok: false, error: "OPENAI_API_KEY not set" };
      try {
        await callOpenAIChat({
          apiKey,
          model,
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

export const openaiProvider: DigestProvider = createOpenAIProvider();

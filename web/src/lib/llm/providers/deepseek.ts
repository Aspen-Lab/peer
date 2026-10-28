// DeepSeek via its OpenAI-compatible Chat Completions endpoint. The wire format
// matches OpenAI exactly, so this mirrors the Qwen provider and only varies the
// base URL and the model id table.
//
// Peer intentionally omits `generateVisionJsonText` for DeepSeek, so
// capability-checking figure callers skip image analysis and degrade
// gracefully. Text work uses V4 Flash for frequent tasks and V4 Pro for deep
// extraction, with thinking disabled for predictable budgeted JSON output.

import type {
  DigestProvider,
  DigestResult,
  ModelTier,
} from "./types";
import { DIGEST_SYSTEM_PROMPT, buildUserPrompt, safeParseDigest } from "./types";
import { logLlmUsage, now } from "../usage-log";
import { EmptyAnswerError } from "./empty-answer";
import { PROVIDER_MODELS } from "../provider-models";

const DEEPSEEK_CHAT_API = "https://api.deepseek.com/chat/completions";
const DEFAULT_MODEL = PROVIDER_MODELS.deepseek.small;
const SMALL_MODEL = PROVIDER_MODELS.deepseek.small;
const LARGE_MODEL = PROVIDER_MODELS.deepseek.large;

function modelForTier(defaultModel: string, tier?: ModelTier): string {
  if (tier === "large") return LARGE_MODEL;
  if (tier === "small") return SMALL_MODEL;
  return defaultModel;
}

interface DeepseekChatResponse {
  choices?: Array<{
    message?: {
      content?: string | null;
    };
  }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}

function apiKeyFromEnv(): string | undefined {
  return process.env.DEEPSEEK_API_KEY?.trim() || undefined;
}

async function callDeepseekChat(args: {
  apiKey: string;
  model: string;
  systemPrompt: string;
  userPrompt: string;
  maxTokens?: number;
  jsonMode?: boolean;
}): Promise<string> {
  const {
    apiKey,
    model,
    systemPrompt,
    userPrompt,
    maxTokens = 1500,
    jsonMode = true,
  } = args;

  const started = now();
  const res = await fetch(DEEPSEEK_CHAT_API, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      max_tokens: maxTokens,
      thinking: { type: "disabled" },
      ...(jsonMode ? { response_format: { type: "json_object" } } : {}),
    }),
    signal: AbortSignal.timeout(20000),
    cache: "no-store",
  });

  if (!res.ok) {
    logLlmUsage({ provider: "deepseek", model, latencyMs: now() - started, ok: false });
    const detail = await res.text().catch(() => "");
    throw new Error(`DeepSeek API error ${res.status}: ${detail.slice(0, 400)}`);
  }

  const data = (await res.json()) as DeepseekChatResponse;
  logLlmUsage({
    provider: "deepseek",
    model,
    inputTokens: data.usage?.prompt_tokens,
    outputTokens: data.usage?.completion_tokens,
    latencyMs: now() - started,
    ok: true,
  });
  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new EmptyAnswerError("DeepSeek returned empty content");
  return content.trim();
}

export function createDeepseekProvider(
  apiKey = apiKeyFromEnv(),
  defaultModel: string = DEFAULT_MODEL,
): DigestProvider {
  return {
    id: "deepseek",

    async generateDigest({ papers, contextHint }): Promise<DigestResult> {
      if (!apiKey) throw new Error("DEEPSEEK_API_KEY not set");
      const text = await callDeepseekChat({
        apiKey,
        model: defaultModel,
        systemPrompt: DIGEST_SYSTEM_PROMPT,
        userPrompt: buildUserPrompt(papers, contextHint),
        maxTokens: 1800,
      });
      const parsed = safeParseDigest(text);
      if (!parsed) throw new Error("Failed to parse digest JSON from DeepSeek");
      return parsed;
    },

    async generateJsonText({ systemPrompt, userPrompt, maxTokens = 1500, tier }): Promise<string> {
      if (!apiKey) throw new Error("DEEPSEEK_API_KEY not set");
      return callDeepseekChat({
        apiKey,
        model: modelForTier(defaultModel, tier),
        systemPrompt,
        userPrompt,
        maxTokens,
      });
    },

    async testConnection(): Promise<{ ok: boolean; error?: string }> {
      if (!apiKey) return { ok: false, error: "DEEPSEEK_API_KEY not set" };
      try {
        await callDeepseekChat({
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

export const deepseekProvider: DigestProvider = createDeepseekProvider();

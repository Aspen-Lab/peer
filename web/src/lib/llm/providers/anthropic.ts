import Anthropic from "@anthropic-ai/sdk";
import type {
  DigestProvider,
  DigestResult,
  ModelTier,
  VisionImageInput,
} from "./types";
import { DIGEST_SYSTEM_PROMPT, buildUserPrompt, safeParseDigest } from "./types";
import { logLlmUsage, now } from "../usage-log";
import { PROVIDER_MODELS } from "../provider-models";

// Generous per-request hang guard so a stuck call can't pin a serverless
// invocation open. Above p95 for a normal Haiku/Sonnet completion.
const REQUEST_TIMEOUT_MS = 60_000;

// Default model = the cheap tier. Existing call sites (digest) stay cheap.
// `large` tier maps to Sonnet for deep paper-reading workflows.
const MODEL = PROVIDER_MODELS.anthropic.small;
const SMALL_MODEL = PROVIDER_MODELS.anthropic.small;
const LARGE_MODEL = PROVIDER_MODELS.anthropic.large;

function modelForTier(defaultModel: string, tier?: ModelTier): string {
  if (tier === "large") return LARGE_MODEL;
  if (tier === "small") return SMALL_MODEL;
  return defaultModel;
}

function getClient(apiKey?: string): Anthropic | null {
  const key = apiKey ?? process.env.ANTHROPIC_API_KEY;
  if (!key) return null;
  return new Anthropic({ apiKey: key, timeout: REQUEST_TIMEOUT_MS });
}

type AnthropicUsage = { input_tokens?: number; output_tokens?: number };

function logAnthropic(
  model: string,
  path: string,
  usage: AnthropicUsage | undefined,
  started: number,
  ok: boolean,
): void {
  logLlmUsage({
    provider: "anthropic",
    model,
    path,
    inputTokens: usage?.input_tokens,
    outputTokens: usage?.output_tokens,
    latencyMs: now() - started,
    ok,
  });
}

export function createAnthropicProvider(
  apiKey?: string,
  model: string = MODEL,
): DigestProvider {
  return {
    id: "anthropic",

    async generateDigest({ papers, contextHint }): Promise<DigestResult> {
      const client = getClient(apiKey);
      if (!client) throw new Error("ANTHROPIC_API_KEY not set");

      const started = now();
      const response = await client.messages.create({
        model,
        max_tokens: 1500,
        system: DIGEST_SYSTEM_PROMPT,
        messages: [{ role: "user", content: buildUserPrompt(papers, contextHint) }],
      });
      logAnthropic(model, "digest", response.usage, started, true);

      const block = response.content[0];
      if (!block || block.type !== "text") throw new Error("Unexpected response shape");
      const parsed = safeParseDigest(block.text);
      if (!parsed) throw new Error("Failed to parse digest JSON");
      return parsed;
    },

    async generateJsonText({ systemPrompt, userPrompt, maxTokens = 1500, tier }): Promise<string> {
      const client = getClient(apiKey);
      if (!client) throw new Error("ANTHROPIC_API_KEY not set");

      const chosen = modelForTier(model, tier);
      const started = now();
      const response = await client.messages.create({
        model: chosen,
        max_tokens: maxTokens,
        thinking: { type: "disabled" },
        system: systemPrompt,
        messages: [{ role: "user", content: userPrompt }],
      });
      logAnthropic(chosen, "json", response.usage, started, true);

      const block = response.content[0];
      if (!block || block.type !== "text") throw new Error("Unexpected response shape");
      return block.text.trim();
    },

    async generateVisionJsonText({
      systemPrompt,
      userPrompt,
      images,
      maxTokens = 1200,
      tier,
    }): Promise<string> {
      const client = getClient(apiKey);
      if (!client) throw new Error("ANTHROPIC_API_KEY not set");
      if (images.length === 0) throw new Error("No images supplied");

      const chosen = modelForTier(model, tier);
      const started = now();
      const response = await client.messages.create({
        model: chosen,
        max_tokens: maxTokens,
        thinking: { type: "disabled" },
        system: systemPrompt,
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: userPrompt },
              ...images.map((image: VisionImageInput) => ({
                type: "image" as const,
                source: {
                  type: "base64" as const,
                  data: image.dataBase64,
                  media_type: image.mimeType,
                },
              })),
            ],
          },
        ],
      });
      logAnthropic(chosen, "vision", response.usage, started, true);

      const block = response.content[0];
      if (!block || block.type !== "text") throw new Error("Unexpected response shape");
      return block.text.trim();
    },

    // "Check key" (`app/api/ai/check-key`) runs this on the reader's own key. One check is
    // one request: the SDK's default retries (two, on a 408, 409, 429, 5xx or a dropped
    // connection) are turned off for it, and only for it. It writes the same one usage line
    // as every other call, under path "test", whether the provider accepted or refused.
    async testConnection(): Promise<{ ok: boolean; error?: string }> {
      const client = getClient(apiKey);
      if (!client) return { ok: false, error: "ANTHROPIC_API_KEY not set" };
      const started = now();
      try {
        const response = await client.messages.create(
          {
            model,
            max_tokens: 10,
            messages: [{ role: "user", content: "ping" }],
          },
          { maxRetries: 0 },
        );
        logAnthropic(model, "test", response.usage, started, true);
        return { ok: true };
      } catch (err) {
        logAnthropic(model, "test", undefined, started, false);
        return { ok: false, error: String(err) };
      }
    },
  };
}

export const anthropicProvider: DigestProvider = createAnthropicProvider();

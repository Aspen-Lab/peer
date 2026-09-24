import type {
  DigestProvider,
  ProviderId,
  ProviderOverrideConfig,
} from "./types";
import { anthropicProvider, createAnthropicProvider } from "./anthropic";
import { geminiProvider, createGeminiApiProvider } from "./gemini";
import { openaiProvider, createOpenAIProvider } from "./openai";
import { qwenProvider, createQwenProvider } from "./qwen";
import { deepseekProvider, createDeepseekProvider } from "./deepseek";
import { isLocalDevRuntime } from "@/lib/env/local-dev";

const providers: Record<ProviderId, DigestProvider> = {
  anthropic: anthropicProvider,
  gemini: geminiProvider,
  openai: openaiProvider,
  qwen: qwenProvider,
  deepseek: deepseekProvider,
  ollama: geminiProvider, // placeholder until an Ollama provider exists
};

const USER_PROVIDER_IDS = new Set<ProviderOverrideConfig["provider"]>([
  "anthropic",
  "gemini",
  "openai",
  "qwen",
  "deepseek",
]);

/**
 * Server-owned model credentials are a local-development convenience only.
 * Preview, production, tests, and `vercel dev` must all fail closed so a
 * deployed Peer instance can never spend the operator's model account.
 */
export function canUseLocalServerProvider(): boolean {
  return isLocalDevRuntime();
}

export function hasUsableProviderOverride(
  override: ProviderOverrideConfig | null | undefined,
): override is ProviderOverrideConfig {
  return Boolean(
    override &&
      USER_PROVIDER_IDS.has(override.provider) &&
      override.apiKey?.trim() &&
      override.apiKey.trim().length <= 4096 &&
      (!override.model || override.model.trim().length <= 160),
  );
}

function resolveUserProvider(
  override: ProviderOverrideConfig,
): DigestProvider | null {
  const apiKey = override.apiKey.trim();
  switch (override.provider) {
    case "anthropic":
      return createAnthropicProvider(apiKey, override.model);
    case "gemini":
      return createGeminiApiProvider(apiKey);
    case "openai":
      return createOpenAIProvider(apiKey, override.model);
    case "qwen":
      return createQwenProvider(apiKey, override.model);
    case "deepseek":
      return createDeepseekProvider(apiKey, override.model);
    default:
      return null;
  }
}

function resolveLocalServerProvider(): DigestProvider | null {
  const explicit = process.env.PEER_DIGEST_PROVIDER as ProviderId | undefined;
  if (explicit && explicit in providers) {
    return providers[explicit];
  }

  if (process.env.GOOGLE_VERTEX_PROJECT) return geminiProvider;
  if (process.env.GOOGLE_API_KEY) {
    return createGeminiApiProvider(process.env.GOOGLE_API_KEY);
  }
  if (process.env.ANTHROPIC_API_KEY) return anthropicProvider;
  if (process.env.OPENAI_API_KEY) return openaiProvider;
  if (process.env.QWEN_API_KEY || process.env.DASHSCOPE_API_KEY) return qwenProvider;
  if (process.env.DEEPSEEK_API_KEY) return deepseekProvider;
  return null;
}

/**
 * Resolve a provider without ever giving deployed users an operator-funded
 * fallback.
 *
 * Resolution order:
 *   1. Valid per-request BYOK override supplied by the current user.
 *   2. Local `next dev` server credentials (developer convenience only).
 *   3. null (Tier 0 fallback everywhere else).
 */
export function resolveProvider(
  override?: ProviderOverrideConfig | null,
): DigestProvider | null {
  if (hasUsableProviderOverride(override)) {
    return resolveUserProvider(override);
  }
  return canUseLocalServerProvider() ? resolveLocalServerProvider() : null;
}

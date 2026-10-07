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
 * **May this runtime honour a local developer opt-in?**
 *
 * It decides the one thing that stays local: whether `PEER_DIGEST_PROVIDER` may
 * point the resolver at a provider that holds its own key in the developer's
 * environment (Vertex, Anthropic, OpenAI and the rest). The build guard bans
 * that name, and every provider key, on Vercel, and this refuses it at runtime:
 * a deployed Peer holds no model key at all.
 *
 * Exported because `registry.test.ts` imports it. Body lives in
 * `lib/env/local-dev.ts`.
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

/**
 * **The explicit local opt-in, and nothing else.**
 *
 * `PEER_DIGEST_PROVIDER` names the provider outright:
 * `PEER_DIGEST_PROVIDER=gemini` is how a developer reaches the Vertex singleton,
 * and the other providers' own env keys are reached the same way through the
 * `providers` record. It is a developer's convenience on a developer's machine
 * (`canUseLocalServerProvider`), never a reader's: the build guard bans the
 * variable on Vercel.
 */
function resolveLocalOptInProvider(): DigestProvider | null {
  const explicit = process.env.PEER_DIGEST_PROVIDER as ProviderId | undefined;
  if (explicit && explicit in providers) {
    return providers[explicit];
  }
  return null;
}

/**
 * Resolve the model this request should use: **the reader's own key, or none.**
 *
 * Peer holds no model key of its own, so there is no server-owned default to
 * fall back to and nothing here reads one (`GOOGLE_API_KEY` is read by no code
 * and is banned on Vercel by the build guard). Resolution order:
 *   1. **A valid override** (the reader's provider and key, sent with the
 *      request), in any environment.
 *   2. **The explicit local opt-in** (`PEER_DIGEST_PROVIDER`, local runtimes
 *      only, banned on Vercel). A developer's own env key on a developer's
 *      machine.
 *   3. **null** — the reading without a model. Every call site already handles
 *      it (`provider?.generateJsonText` guards in digest and the report routes,
 *      the tier-2 rerank, the query generator).
 *
 * The caller must already have passed `requireAiRequest`, which is what keeps a
 * signed-out stranger from reaching this at all; `spend-scans.test.ts` asserts
 * that ordering for every route that calls it.
 *
 * The provider is returned exactly as it was built: Peer wraps it in nothing
 * and keeps no record of the call, so any flag or optional method the provider
 * object carries is read by the caller as the provider set it.
 *
 * This function stays **synchronous** — its call sites use the result without
 * `await`.
 */
export function resolveProvider(
  override: ProviderOverrideConfig | null | undefined,
): DigestProvider | null {
  if (hasUsableProviderOverride(override)) return resolveUserProvider(override);
  return canUseLocalServerProvider() ? resolveLocalOptInProvider() : null;
}

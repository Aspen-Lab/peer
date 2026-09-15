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
import { meterProvider } from "./metered";
import {
  isEntitledContext,
  type ProviderContext,
} from "@/lib/security/entitled-context";

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
 * **May this runtime honour a local operator opt-in?**
 *
 * ABC-freemium 1-11 · R-KEY-1 — the name is kept and the body is unchanged, but
 * its *meaning* has narrowed and the change matters. It used to answer "may a
 * server-owned provider be used at all", and it was the single lock that made a
 * deployed Peer BYOK-only. D1 removes that lock: the system Gemini key is the
 * default model for every signed-in user in **every** environment.
 *
 * What it still decides is the one thing that stays local: whether
 * `PEER_DIGEST_PROVIDER` may point the resolver at an operator-owned provider
 * (Vertex, Anthropic, OpenAI and the rest). The build guard bans that name on
 * Vercel, and this refuses it at runtime.
 *
 * **Deliberately not deleted.** It is exported, `registry.test.ts` imports it,
 * and a silently removed export is what turns a test rewrite into a test
 * deletion. Body lives in `lib/env/local-dev.ts` (1-01).
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
 * ABC-freemium 1-11 · R-KEY-1 — **the explicit local opt-in, and nothing else.**
 *
 * This used to be a seven-step ladder that turned any operator credential into a
 * provider, with `GOOGLE_VERTEX_PROJECT` **ahead of** `GOOGLE_API_KEY` — so with
 * both set, Vertex won. R-KEY-1 says the system key must never be outranked, and
 * that Vertex stays "reachable only by an explicit local opt-in".
 *
 * Six of those seven steps are gone. What is left is `PEER_DIGEST_PROVIDER`,
 * which names the provider outright: `PEER_DIGEST_PROVIDER=gemini` is how a
 * developer reaches the Vertex singleton now, and the other operator keys are
 * reached the same way through the `providers` record. The build guard bans that
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
 * Steps 2 and 3 of the order documented on `resolveProvider`.
 *
 * The system key is read here and **only** here in this module, so "which
 * runtimes have a model" has one answer: every runtime where the key is set.
 */
function resolveSystemProvider(): DigestProvider | null {
  if (canUseLocalServerProvider()) {
    const optIn = resolveLocalOptInProvider();
    if (optIn) return optIn;
  }
  if (process.env.GOOGLE_API_KEY) {
    return createGeminiApiProvider(process.env.GOOGLE_API_KEY);
  }
  return null;
}

/**
 * Resolve the model this request should use.
 *
 * ABC-freemium 1-11 · R-KEY-1 · D1 — **the system key resolves in EVERY
 * environment.** Before this, `canUseLocalServerProvider()` gated the whole
 * server-provider branch, so a deployed Peer had no model at all unless the
 * reader supplied their own; that is the lock D1 removes.
 *
 * Resolution order, and why the middle step sits where it does:
 *   1. **A valid BYOK override**, in any environment. The reader's own key wins
 *      over the operator's — R-KEY-1 and R-KEY-2 both say so.
 *   2. **The explicit local opt-in** (`PEER_DIGEST_PROVIDER`, local runtimes
 *      only, banned on Vercel by the build guard). R-KEY-1 says three steps
 *      *and* says Vertex stays reachable by an explicit local opt-in; those two
 *      sentences can only both be true if the opt-in sits **between** BYOK and
 *      the system key, because after D1 the system key is always present and an
 *      opt-in placed after it would be permanently unreachable.
 *   3. **The system key** (`GOOGLE_API_KEY` via `createGeminiApiProvider`).
 *      `GOOGLE_VERTEX_PROJECT` no longer outranks it — it is no longer a trigger
 *      at all.
 *   4. **null** — the existing tier-0 path, which D1 says stays. Every one of the
 *      thirteen call sites already handles it (`provider?.generateJsonText`
 *      guards in digest and the report routes, `return null` in the two figure
 *      matchers), and 1-11 touches none of them.
 *
 * ABC-freemium 1-03 · R-METER-1 — the result is wrapped by `meterProvider` at
 * this single return point, so every acquisition site is metered without a user
 * id threaded through any of them.
 *
 * ── ABC-freemium 3-02 · R-SEC-2 · Ruling 7 point 3 · Ruling 9 point 5 ────────
 *
 * **The second argument is now REQUIRED and branded.** This supersedes the note
 * that stood here from 1-03/1-11 — *"the second argument is optional and stays
 * optional… making it required would be a thirteen-site edit"* — which Ruling 7
 * point 3 (2026-09-05) reverses, so the comment is rewritten rather than left to
 * argue with the code. Its "thirteen" was also stale: it counted acquisition
 * sites before 1-07 gave the figure matchers a required context. **The measured
 * figure is ten production call sites, eight of which already passed a
 * context.**
 *
 * The old note's defence of the optional form was that "a call site that omits
 * it still meters, with a null `user_id`, which is the honest value for a
 * library-level call". That is true about *metering* and it was never the
 * question: R-SEC-2 is about a caller that forgets the **entitlement check**,
 * and a metered row for spend nobody authorised is a receipt, not a guard.
 *
 * A caller must now supply either an `EntitledContext` — mintable only from a
 * real `Entitlement`, i.e. only downstream of `requireEntitledAiRequest` — or a
 * named `SpendJustification` saying which *other* guard is doing the work and
 * where. Both are compile-checked; forgetting the argument, passing a
 * correct-looking plain object, and inventing a justification kind are all
 * compile errors. See `@/lib/security/entitled-context` for what the brand does
 * and, as importantly, the three attacks it does not stop.
 *
 * This function stays **synchronous** — eleven call sites use its result without
 * `await`, and wrapping is pure object construction.
 */
export function resolveProvider(
  override: ProviderOverrideConfig | null | undefined,
  ctx: ProviderContext,
): DigestProvider | null {
  const byok = hasUsableProviderOverride(override);
  const provider = byok
    ? resolveUserProvider(override)
    : resolveSystemProvider();
  if (!provider) return null;
  // A justification carries no reader: the two pool-build closures run outside
  // any entitled request, and `null` is the honest `user_id` for them — the
  // same value the optional form used to produce, now stated rather than
  // defaulted into existence.
  const entitled = isEntitledContext(ctx) ? ctx : null;
  return meterProvider(provider, {
    userId: entitled?.userId ?? null,
    byok: entitled?.byok ?? byok,
    path: entitled?.path,
  });
}

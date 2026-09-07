import type { UserAiProvider } from "@/types";

export type UserCloudAiProvider = Exclude<UserAiProvider, "default">;

export type ProviderModelPlan = {
  small: string;
  large: string;
  vision: boolean;
};

/**
 * One client-safe source of truth for the BYOK model plan.
 *
 * The provider adapters import these IDs for actual requests, and onboarding
 * imports them for its plain-language model explanation. Keeping both sides on
 * the same constants prevents the walkthrough from drifting away from runtime.
 */
export const PROVIDER_MODELS = {
  gemini: {
    // ABC-freemium 6-02 (Ruling 22 · Ruling 23). Both 2.5 ids that used to sit
    // here return HTTP 404 on a key issued today — Google stopped serving them
    // to new keys — so the product could not complete a single Gemini call.
    // One id now fills both roles: it is the cheapest endpoint that still
    // answers, and it benchmarks above the `gemini-2.5-flash` it replaces.
    // The two tiers stay separate on purpose. `chainForTier` keys on the
    // `tier` field, never on the id, so two equal values change no routing —
    // and keeping the roles named is what lets one of them move again alone.
    small: "gemini-3.1-flash-lite",
    large: "gemini-3.1-flash-lite",
    vision: true,
  },
  openai: {
    small: "gpt-5.4-nano",
    large: "gpt-5.4-mini",
    vision: true,
  },
  qwen: {
    small: "qwen3.5-flash",
    large: "qwen3.7-plus",
    vision: true,
  },
  anthropic: {
    small: "claude-haiku-4-5-20251001",
    large: "claude-sonnet-5",
    vision: true,
  },
  deepseek: {
    small: "deepseek-v4-flash",
    large: "deepseek-v4-pro",
    vision: false,
  },
} as const satisfies Record<UserCloudAiProvider, ProviderModelPlan>;

export function providerModelForTier(
  provider: UserCloudAiProvider,
  tier: "small" | "large",
): string {
  return PROVIDER_MODELS[provider][tier];
}

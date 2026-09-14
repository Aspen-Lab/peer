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
  // Chosen 2026-09-13 from Google's live model and price lists, after the 2.5
  // family was retired for new API accounts. 3.1 Flash-Lite is the cheapest
  // model on the price list ($0.25 / $1.50 per 1M) and accepts minimal
  // thinking; 3.6 Flash is the Flash Google names as 2.5 Flash's successor,
  // priced with 3.7 and 3.8 ($0.75 / $3.75) but the only one of the three
  // that accepts minimal thinking — 3.8 refuses it and spends ~190 thinking
  // tokens on a one-word JSON answer. On Vertex both are global-endpoint only.
  gemini: {
    small: "gemini-3.1-flash-lite",
    large: "gemini-3.6-flash",
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

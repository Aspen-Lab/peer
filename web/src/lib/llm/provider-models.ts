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
    // ABC-freemium 6-02 (Ruling 22 · Ruling 23). Both 2.5 ids that used to sit
    // here return HTTP 404 on a key issued today — Google stopped serving them
    // to new keys — so the product could not complete a single Gemini call.
    // `small` moved to the cheapest 3.x endpoint that still answers.
    // The two tiers stay separate on purpose. `chainForTier` keys on the
    // `tier` field, never on the id, so the roles can move independently.
    //
    // Merge note (2026-09-23): main had both roles on `3.1-flash-lite` as the
    // one id known to answer. The follow-up line has been writing reports on
    // `3.6-flash` since 2026-09-15 — the user's explicit choice, "3.6 flash for
    // report and 3.1 flash-lite for other lighter work" — and it has been
    // exercised live throughout rounds 5-9. So `large` keeps 3.6 here.
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

/**
 * Which tier writes the paper report (the deep pass and the abstract tier).
 * Everything else — pass-1 extraction, the skim, the digest, figure binding —
 * runs on the small tier regardless.
 *
 * Measured 2026-09-14 on the same 39-page PDF, two runs each: 3.6 Flash
 * (large) wrote 3 key results with 3–4 methods and dropped 0 claims both
 * times; 3.1 Flash-Lite (small) wrote 1–2 results with 2 methods and dropped
 * 0–1. Tokens per report put the difference at about half a cent, so the
 * default is the larger model; `PEER_REPORT_MODEL_TIER=small` in the local
 * env flips it for a trial.
 */
export function reportModelTier(): "small" | "large" {
  return process.env.PEER_REPORT_MODEL_TIER === "small" ? "small" : "large";
}

export function providerModelForTier(
  provider: UserCloudAiProvider,
  tier: "small" | "large",
): string {
  return PROVIDER_MODELS[provider][tier];
}

import { describe, expect, it } from "vitest";
import { PROVIDER_MODELS, providerModelForTier } from "./provider-models";

describe("BYOK provider model catalog", () => {
  it("keeps the economical and deep-work routes explicit", () => {
    // ABC-freemium 6-02: the two Gemini 2.5 ids that used to be pinned here
    // both 404 on a key issued today, so both roles moved to the one Gemini
    // id that still answers. They are deliberately equal — the roles stay
    // named so either can move again on its own.
    expect(providerModelForTier("gemini", "small")).toBe(
      "gemini-3.1-flash-lite",
    );
    expect(providerModelForTier("gemini", "large")).toBe("gemini-3.1-flash-lite");
    expect(providerModelForTier("openai", "small")).toBe("gpt-5.4-nano");
    expect(providerModelForTier("openai", "large")).toBe("gpt-5.4-mini");
    expect(providerModelForTier("qwen", "small")).toBe("qwen3.5-flash");
    expect(providerModelForTier("qwen", "large")).toBe("qwen3.7-plus");
    expect(providerModelForTier("anthropic", "small")).toBe(
      "claude-haiku-4-5-20251001",
    );
    expect(providerModelForTier("anthropic", "large")).toBe("claude-sonnet-5");
    expect(providerModelForTier("deepseek", "small")).toBe(
      "deepseek-v4-flash",
    );
    expect(providerModelForTier("deepseek", "large")).toBe(
      "deepseek-v4-pro",
    );
  });

  it("makes DeepSeek's missing image path visible to UI and runtime checks", () => {
    expect(PROVIDER_MODELS.deepseek.vision).toBe(false);
    expect(PROVIDER_MODELS.gemini.vision).toBe(true);
    expect(PROVIDER_MODELS.openai.vision).toBe(true);
    expect(PROVIDER_MODELS.qwen.vision).toBe(true);
    expect(PROVIDER_MODELS.anthropic.vision).toBe(true);
  });
});

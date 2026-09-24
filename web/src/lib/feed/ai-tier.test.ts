import { describe, expect, it } from "vitest";
import { defaultProfile, type UserProfile } from "@/types";
import {
  ANONYMOUS_CLIENT_ENTITLEMENT,
  type ClientEntitlement,
} from "@/lib/entitlement/allowance";
import { opportunityRequestBody } from "@/store/feed";
import {
  aiAvailability,
  aiModeChip,
  feedsUseAi,
  hasUserLlmOverride,
} from "./ai-tier";

const BYOK: UserProfile = {
  ...defaultProfile,
  feedAiProvider: "openai",
  feedAiApiKey: "  not-a-real-key  ",
};
const DEFAULT_PROVIDER: UserProfile = {
  ...defaultProfile,
  feedAiProvider: "default",
  feedAiApiKey: "",
};

const SIGNED_OUT = ANONYMOUS_CLIENT_ENTITLEMENT;
const SIGNED_IN: ClientEntitlement = {
  ...ANONYMOUS_CLIENT_ENTITLEMENT,
  userId: "known-user",
  source: "supabase",
};

describe("feedsUseAi — server-derived capability", () => {
  it("keeps a signed-out default-provider reader at Tier 0", () => {
    expect(aiAvailability(DEFAULT_PROVIDER, SIGNED_OUT)).toBe("none");
    expect(feedsUseAi(DEFAULT_PROVIDER, SIGNED_OUT)).toBe(false);
  });

  it("allows a signed-in reader to use the server-authorized system tier", () => {
    expect(aiAvailability(DEFAULT_PROVIDER, SIGNED_IN)).toBe("system");
    expect(feedsUseAi(DEFAULT_PROVIDER, SIGNED_IN)).toBe(true);
    expect(hasUserLlmOverride(DEFAULT_PROVIDER)).toBe(false);
  });

  it("puts BYOK before system entitlement and retains its override", () => {
    expect(aiAvailability(BYOK, SIGNED_OUT)).toBe("byok");
    expect(aiAvailability(BYOK, SIGNED_IN)).toBe("byok");
    expect(feedsUseAi(BYOK, SIGNED_OUT)).toBe(true);
    expect(hasUserLlmOverride(BYOK)).toBe(true);
  });

  it("fails closed while the browser entitlement is unknown", () => {
    expect(feedsUseAi(DEFAULT_PROVIDER, { userId: null })).toBe(false);
    expect(aiAvailability(DEFAULT_PROVIDER, { userId: null })).toBe("none");
  });

  it("rejects a selected provider without a nonblank key", () => {
    expect(feedsUseAi({ ...BYOK, feedAiApiKey: "   " }, SIGNED_OUT)).toBe(false);
    expect(feedsUseAi({ ...BYOK, feedAiApiKey: undefined }, SIGNED_IN)).toBe(true);
  });
});

describe("aiModeChip", () => {
  it("reports shared feed capability independently of the papers toggle", () => {
    const systemOff = aiModeChip({ feedsUseAi: true, aiSearchActive: false });
    const systemOn = aiModeChip({ feedsUseAi: true, aiSearchActive: true });
    const anonymous = aiModeChip({ feedsUseAi: false, aiSearchActive: false });

    expect(systemOff).toMatchObject({ tier: "Tier 2", label: "Auto" });
    expect(systemOn).toMatchObject({ tier: "Tier 2", label: "AI search" });
    expect(anonymous).toEqual({
      tier: "Tier 0",
      label: "Auto",
      title: "Add your own AI key to enable AI search.",
    });
  });
});

describe("the chip and opportunity requests", () => {
  it("keeps anonymous, server-system, BYOK, and unknown request tiers aligned", () => {
    for (const [profile, entitlement, expectedTier] of [
      [DEFAULT_PROVIDER, SIGNED_OUT, 0],
      [DEFAULT_PROVIDER, SIGNED_IN, 2],
      [BYOK, SIGNED_OUT, 2],
      [DEFAULT_PROVIDER, null, 0],
    ] as const) {
      for (const surface of ["jobs", "events"] as const) {
        expect(opportunityRequestBody(profile, surface, [], entitlement).aiTier).toBe(expectedTier);
      }
    }
  });

  it("sends an override only for BYOK, never for the server system tier", () => {
    expect(opportunityRequestBody(DEFAULT_PROVIDER, "jobs", [], SIGNED_IN)).toMatchObject({
      aiTier: 2,
      llmOverride: undefined,
    });
    expect(opportunityRequestBody(BYOK, "jobs", [], SIGNED_OUT)).toMatchObject({
      aiTier: 2,
      llmOverride: { provider: "openai", apiKey: "not-a-real-key" },
    });
  });
});

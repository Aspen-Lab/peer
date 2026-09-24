import { afterEach, describe, expect, it, vi } from "vitest";
import {
  entitledAiTier,
  protectAiRequest,
  requireEntitledAiRequest,
} from "./ai-request";
import { ANONYMOUS_ENTITLEMENT } from "@/lib/entitlement/types";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("protectAiRequest", () => {
  it("keeps local next dev available without cloud auth", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("VERCEL", "");
    vi.stubEnv("VERCEL_ENV", "");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");

    await expect(protectAiRequest("test")).resolves.toBeNull();
  });

  it("fails closed when a deployment has no auth configuration", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "");

    const response = await protectAiRequest("test");
    expect(response?.status).toBe(503);
  });
});

describe("entitlement-first request helpers", () => {
  it("keeps an anonymous request at Tier 0 regardless of its requested tier", () => {
    expect(entitledAiTier(2, ANONYMOUS_ENTITLEMENT)).toBe(0);
  });

  it("returns an entitlement-bearing result for local development", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("VERCEL", "");
    vi.stubEnv("VERCEL_ENV", "");
    await expect(requireEntitledAiRequest("test", 60, { allowAnonymous: true }))
      .resolves.not.toBeNull();
  });
});

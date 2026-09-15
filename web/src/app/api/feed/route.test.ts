import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import {
  deployedRuntimeEnv,
  signedIn,
  signedOut,
  supabaseServerStub,
} from "@/test-support/route-harness";

const mocks = vi.hoisted(() => ({
  resolveProvider: vi.fn(),
  runFeedPipeline: vi.fn(),
  getUser: vi.fn(),
}));

// ABC-freemium 1-06 — the route resolves an entitlement before it resolves a
// provider, and the entitlement comes from the session. Stubbing the session is
// what lets this suite construct a signed-out visitor and a signed-in user.
vi.mock("@/lib/supabase/server", () => ({
  createClient: () => Promise.resolve(supabaseServerStub(mocks.getUser)),
}));

// ABC-freemium 1-06 — the routes now ask the registry whether the request
// carries a usable BYOK override, so the metering wrapper can attribute the
// call. The mock must export it or the module has a hole where a real function
// used to be.
vi.mock("@/lib/llm/providers/registry", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/llm/providers/registry")>();
  return { ...actual, resolveProvider: mocks.resolveProvider };
});
vi.mock("@/lib/feed/pipeline", () => ({
  runFeedPipeline: mocks.runFeedPipeline,
}));

import { POST } from "./route";

function request(body: Record<string, unknown>): NextRequest {
  return new NextRequest("http://localhost/api/feed", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.runFeedPipeline.mockResolvedValue({ items: [], meta: {} });
  mocks.getUser.mockResolvedValue(signedIn("user-1"));
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("POST /api/feed AI tier gate", () => {
  // ABC-freemium 1-06 · R-SEC-3 — REWRITTEN, NOT DELETED. This case used to
  // assert that a forged `aiTier: 2` was downgraded because **no provider
  // resolved**. That predicate stops being a defence the moment R-KEY-1 makes a
  // provider always resolve, which is the whole point of the requirement: the
  // downgrade must be "not entitled", not "nothing configured". The case now
  // asserts the new reason, with a provider deliberately available so a
  // regression to the old predicate cannot pass.
  it("downgrades a forged Tier 2 request from a signed-out visitor", async () => {
    deployedRuntimeEnv(vi.stubEnv);
    mocks.getUser.mockResolvedValue(signedOut());
    mocks.resolveProvider.mockReturnValue({
      id: "gemini",
      generateJsonText: vi.fn(),
    });

    await POST(request({ topics: ["battery"], aiTier: 2 }));

    // The tier the pipeline is given is the whole contract: at 0 it uses
    // template queries and no rerank, so nothing operator-funded is reachable.
    expect(mocks.runFeedPipeline).toHaveBeenCalledWith(
      expect.objectContaining({ aiTier: 0, llmOverride: undefined }),
    );
    // R-ENT-4 — a signed-out visitor still gets the feed, built from free
    // structured sources. Degrade, never 401, on this surface.
    expect(mocks.runFeedPipeline).toHaveBeenCalledTimes(1);
  });

  it("keeps Tier 2 for a signed-in user", async () => {
    deployedRuntimeEnv(vi.stubEnv);
    mocks.getUser.mockResolvedValue(signedIn("user-1"));
    mocks.resolveProvider.mockReturnValue({
      id: "gemini",
      generateJsonText: vi.fn(),
    });

    await POST(request({ topics: ["battery"], aiTier: 2 }));

    // D1 — every signed-in user gets the model, free included. The ceiling is
    // `userId !== null`, never `effectivePlan`.
    expect(mocks.runFeedPipeline).toHaveBeenCalledWith(
      expect.objectContaining({ aiTier: 2 }),
    );
  });

  it("keeps Tier 2 when a user override resolves", async () => {
    mocks.resolveProvider.mockReturnValue({ id: "openai", generateJsonText: vi.fn() });
    const llmOverride = { provider: "openai", apiKey: "user-owned-key" };

    await POST(request({ topics: ["battery"], aiTier: 2, llmOverride }));

    // ABC-freemium 1-06 — the route no longer resolves a provider itself; it
    // only ever did so to decide the downgrade, which R-SEC-3 replaces with the
    // entitlement. The override still reaches the pipeline, which is what
    // actually spends it.
    expect(mocks.resolveProvider).not.toHaveBeenCalled();
    expect(mocks.runFeedPipeline).toHaveBeenCalledWith(
      expect.objectContaining({ aiTier: 2, llmOverride }),
    );
  });
});

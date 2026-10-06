import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import {
  deployedRuntimeEnv,
  signedIn,
  signedOut,
  supabaseServerStub,
} from "@/test-support/route-harness";
import { resetCounterStoreForTests } from "@/lib/usage/counters";

const mocks = vi.hoisted(() => ({
  resolveProvider: vi.fn(),
  generateDigest: vi.fn(),
  getUser: vi.fn(),
}));

vi.mock("@/lib/llm/providers/registry", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/llm/providers/registry")>();
  return { ...actual, resolveProvider: mocks.resolveProvider };
});
// The session, for the cases below that drive the deployed-runtime gate.
vi.mock("@/lib/supabase/server", () => ({
  createClient: () => Promise.resolve(supabaseServerStub(mocks.getUser)),
}));

import { POST } from "./route";

function request(body: Record<string, unknown>): NextRequest {
  return new NextRequest("http://localhost/api/digest", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  resetCounterStoreForTests();
  mocks.generateDigest.mockResolvedValue({
    bullets: [{ paperId: "paper-1", text: "Finding" }],
  });
});

afterEach(() => {
  vi.unstubAllEnvs();
  resetCounterStoreForTests();
});

describe("POST /api/digest", () => {
  it("returns Tier 0 without making a model call when no provider resolves", async () => {
    mocks.resolveProvider.mockReturnValue(null);

    const response = await POST(
      request({ papers: [{ id: "paper-1", title: "Paper" }] }),
    );

    expect(await response.json()).toEqual({ bullets: [], noLlm: true });
    expect(mocks.generateDigest).not.toHaveBeenCalled();
  });

  it("passes the user's override and bounds model input", async () => {
    mocks.resolveProvider.mockReturnValue({
      id: "openai",
      generateDigest: mocks.generateDigest,
    });
    const llmOverride = { provider: "openai", apiKey: "user-key" };
    const papers = Array.from({ length: 25 }, (_, index) => ({
      id: `paper-${index + 1}`,
      title: "x".repeat(900),
    }));

    const response = await POST(
      request({ papers, contextHint: "c".repeat(5_000), llmOverride }),
    );

    expect(response.status).toBe(200);
    // The provider is resolved from the reader's own override and nothing
    // else: one argument, asserted so a call that grows a second one (a
    // server-owned fallback) cannot pass.
    expect(mocks.resolveProvider).toHaveBeenCalledWith(llmOverride);
    expect(mocks.generateDigest).toHaveBeenCalledWith({
      papers: expect.arrayContaining([
        expect.objectContaining({ id: "paper-1" }),
      ]),
      contextHint: "c".repeat(4_000),
    });
    const call = mocks.generateDigest.mock.calls[0][0];
    expect(call.papers).toHaveLength(20);
    expect(call.papers[0].title).toHaveLength(800);
  });

  describe("in a deployed runtime", () => {
    const papers = [{ id: "paper-1", title: "Paper" }];

    beforeEach(() => {
      deployedRuntimeEnv(vi.stubEnv);
    });

    it("answers a signed-out caller 401 and resolves no provider", async () => {
      mocks.getUser.mockResolvedValue(signedOut());

      const response = await POST(request({ papers }));

      expect(response.status).toBe(401);
      expect(mocks.resolveProvider).not.toHaveBeenCalled();
      expect(mocks.generateDigest).not.toHaveBeenCalled();
    });

    it("gives a signed-in reader with no key of their own the reading without a model", async () => {
      // Peer holds no model key, so the registry answers null for a request
      // that carries no override (`registry.test.ts` pins that); the route
      // then answers with the reading without a model, not an error.
      mocks.getUser.mockResolvedValue(signedIn("user-1"));
      mocks.resolveProvider.mockReturnValue(null);

      const response = await POST(request({ papers }));

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ bullets: [], noLlm: true });
      expect(mocks.resolveProvider).toHaveBeenCalledWith(null);
    });
  });
});

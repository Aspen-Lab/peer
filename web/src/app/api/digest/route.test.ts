import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  resolveProvider: vi.fn(),
  generateDigest: vi.fn(),
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
  mocks.generateDigest.mockResolvedValue({
    bullets: [{ paperId: "paper-1", text: "Finding" }],
  });
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
    // ABC-freemium 1-03/1-06 — the second argument is the metering context,
    // asserted so a call that loses it cannot pass.
    expect(mocks.resolveProvider).toHaveBeenCalledWith(
      llmOverride,
      expect.objectContaining({ byok: true, path: "digest" }),
    );
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
});

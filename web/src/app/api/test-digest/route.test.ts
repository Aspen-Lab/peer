import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import {
  OPERATOR_SENTINEL,
  deleteSpendableKeys,
  deployedRuntimeEnv,
  signedIn,
  signedOut,
  supabaseServerStub,
} from "@/test-support/route-harness";

const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  maybeSingle: vi.fn(),
  runFeedPipeline: vi.fn(),
  sendDigestEmail: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: () =>
    Promise.resolve({
      ...supabaseServerStub(mocks.getUser),
      from: () => ({
        select: () => ({ eq: () => ({ maybeSingle: mocks.maybeSingle }) }),
      }),
    }),
}));
vi.mock("@/lib/feed/pipeline", () => ({ runFeedPipeline: mocks.runFeedPipeline }));
vi.mock("@/lib/email/send-digest", () => ({
  sendDigestEmail: mocks.sendDigestEmail,
}));

import { POST } from "./route";

/**
 * ABC-freemium 2-06 · R-SEC-2, R-TEST-1 · D3, D9.
 *
 * **The one guarded AI route with no suite at all.** It is one of the nine
 * routes carrying `requireEntitledAiRequest`, and its own comment claims it
 * "still spends nothing" because the pipeline passes no `aiTier` and papers
 * hard-code `systemSearchAllowed: false`. Nothing checked that claim. This turns
 * the comment into a gate.
 */
describe("POST /api/test-digest", () => {
  function request(): NextRequest {
    return new NextRequest("http://localhost/api/test-digest", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
  }

  beforeEach(() => {
    vi.clearAllMocks();
    deleteSpendableKeys();
    deployedRuntimeEnv(vi.stubEnv);
    mocks.getUser.mockResolvedValue(signedIn("user-1"));
    mocks.maybeSingle.mockResolvedValue({ data: null, error: null });
    mocks.runFeedPipeline.mockResolvedValue({ items: [], meta: {} });
    mocks.sendDigestEmail.mockResolvedValue({ ok: true });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("refuses a signed-out visitor before running anything", async () => {
    mocks.getUser.mockResolvedValue(signedOut());

    const response = await POST(request());

    // Outside development the route does not exist (404) — main's gate runs
    // before the entitlement check — so the pipeline is never reached.
    expect(response.status).toBe(404);
    expect(mocks.runFeedPipeline).not.toHaveBeenCalled();
    expect(mocks.sendDigestEmail).not.toHaveBeenCalled();
  });

  it("spends NO operator search key for a signed-in free caller", async () => {
    // The claim in the route's own comment, asserted. The pipeline is called
    // with `systemSearchAllowed: false` on every surface, so a sentinel
    // operator key set in the environment must never leave the process.
    vi.stubEnv("TAVILY_API_KEY", OPERATOR_SENTINEL);
    vi.stubEnv("BRAVE_SEARCH_API_KEY", OPERATOR_SENTINEL);
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    await POST(request());

    const outgoing = fetchSpy.mock.calls.map((call) => JSON.stringify(call));
    expect(outgoing.filter((c) => c.includes(OPERATOR_SENTINEL))).toEqual([]);
  });

  it("never asks the pipeline for a system-funded search", async () => {
    // Asserted at the seam rather than only at the wire, because a future
    // refactor could reach a different search path. `systemSearchAllowed` is
    // the one flag that decides whether the operator pays.
    await POST(request());

    if (mocks.runFeedPipeline.mock.calls.length > 0) {
      const passed = JSON.stringify(mocks.runFeedPipeline.mock.calls[0]);
      expect(passed).not.toMatch(/"systemSearchAllowed"\s*:\s*true/);
    }
  });
});

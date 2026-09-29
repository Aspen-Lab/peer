import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";
import { selectedSenseConcept } from "@/lib/feed/senses";

const mocks = vi.hoisted(() => ({
  canUseLocalServerProvider: vi.fn(),
  requireEntitledAiRequest: vi.fn(),
  getUser: vi.fn(),
  select: vi.fn(),
  maybeSingle: vi.fn(),
  runFeedPipeline: vi.fn(),
  sendDigestEmail: vi.fn(),
}));

vi.mock("@/lib/llm/providers/registry", () => ({
  canUseLocalServerProvider: mocks.canUseLocalServerProvider,
}));
vi.mock("@/lib/security/ai-request", () => ({
  requireEntitledAiRequest: mocks.requireEntitledAiRequest,
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: () => Promise.resolve({
    auth: { getUser: mocks.getUser },
    from: () => ({ select: mocks.select }),
  }),
}));
vi.mock("@/lib/feed/pipeline", () => ({ runFeedPipeline: mocks.runFeedPipeline }));
vi.mock("@/lib/email/send-digest", () => ({ sendDigestEmail: mocks.sendDigestEmail }));

import { POST, testDigestFeedRequestFromProfile } from "./route";

function request(): NextRequest {
  return new NextRequest("http://localhost/api/test-digest", { method: "POST" });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.maybeSingle.mockReset();
  mocks.canUseLocalServerProvider.mockReturnValue(true);
  mocks.requireEntitledAiRequest.mockResolvedValue({ entitlement: { userId: "server-user" } });
  mocks.getUser.mockResolvedValue({ data: { user: { id: "server-user", email: "person@example.test" } } });
  mocks.select.mockImplementation(() => ({ eq: () => ({ maybeSingle: mocks.maybeSingle }) }));
  mocks.maybeSingle.mockResolvedValue({
    data: {
      display_name: "Person Example", research_topics: [], preferred_methods: [],
      current_project: "Stabilize sulfide electrolytes", current_challenges: null,
      disliked_topics: [], preference_ledger: null, paper_count: 10,
    }, error: null,
  });
  mocks.runFeedPipeline.mockResolvedValue({ items: [], meta: {} });
  mocks.sendDigestEmail.mockResolvedValue({ ok: true });
});

describe("POST /api/test-digest intent transport", () => {
  it("conceals production before entitlement or profile work", async () => {
    mocks.canUseLocalServerProvider.mockReturnValue(false);

    const response = await POST(request());

    expect(response.status).toBe(404);
    expect(mocks.requireEntitledAiRequest).not.toHaveBeenCalled();
    expect(mocks.getUser).not.toHaveBeenCalled();
    expect(mocks.select).not.toHaveBeenCalled();
  });

  it("does not run feed or email when the shared entitlement gate rejects", async () => {
    mocks.requireEntitledAiRequest.mockResolvedValue(
      NextResponse.json({ error: "denied" }, { status: 401, headers: { "Cache-Control": "no-store" } }),
    );

    const response = await POST(request());

    expect(response.status).toBe(401);
    expect(mocks.select).not.toHaveBeenCalled();
    expect(mocks.runFeedPipeline).not.toHaveBeenCalled();
    expect(mocks.sendDigestEmail).not.toHaveBeenCalled();
  });

  it("runs permitted project-only intent at Tier 0 with no company source or capability", async () => {
    await POST(request());

    expect(mocks.runFeedPipeline).toHaveBeenCalledWith(expect.objectContaining({
      aiTier: 0,
      topics: [],
      project: "Stabilize sulfide electrolytes",
    }));
    expect(mocks.runFeedPipeline).not.toHaveBeenCalledWith(expect.objectContaining({
      sources: expect.anything(), companySpendCapability: expect.anything(),
    }));
    expect(mocks.runFeedPipeline).toHaveBeenCalledTimes(1);
    expect(mocks.sendDigestEmail).toHaveBeenCalledTimes(1);
  });

  it("retries exactly once with legacy columns for the profile route's feed_intent schema-cache error", async () => {
    mocks.maybeSingle
      .mockResolvedValueOnce({
        data: null,
        error: { message: "Could not find the 'feed_intent' column of 'profiles' in the schema cache" },
      })
      .mockResolvedValueOnce({
        data: {
          display_name: "Legacy Person", research_topics: ["solid state batteries"], preferred_methods: ["impedance spectroscopy"],
          current_project: "Stabilize sulfide electrolytes", current_challenges: "Lower interfacial resistance",
          disliked_topics: ["review"], preference_ledger: null, paper_count: 10,
        }, error: null,
      });

    const response = await POST(request());

    expect(response.status).toBe(200);
    expect(mocks.select).toHaveBeenCalledTimes(2);
    expect(mocks.select.mock.calls[0]?.[0]).toContain("feed_intent");
    expect(mocks.select.mock.calls[1]?.[0]).not.toContain("feed_intent");
    expect(mocks.runFeedPipeline).toHaveBeenCalledWith(expect.objectContaining({
      topics: ["solid state batteries"], methods: ["impedance spectroscopy"], negativeTopics: ["review"],
      project: "Stabilize sulfide electrolytes", challenge: "Lower interfacial resistance",
    }));
    expect(mocks.runFeedPipeline).toHaveBeenCalledTimes(1);
    expect(mocks.sendDigestEmail).toHaveBeenCalledTimes(1);
  });

  it("uses persisted feed_intent on one modern profile query", async () => {
    mocks.maybeSingle.mockResolvedValueOnce({
      data: {
        display_name: "Modern Person", research_topics: ["legacy topic"], preferred_methods: [],
        current_project: "legacy project", current_challenges: null, disliked_topics: [], preference_ledger: null, paper_count: 10,
        feed_intent: {
          version: "feed-intent-v1",
          project: { presence: "value", value: "persisted project", provenance: "user" },
          selectedSenseConcepts: [selectedSenseConcept("statistics.structural_equation_modeling")],
        },
      }, error: null,
    });

    const response = await POST(request());

    expect(response.status).toBe(200);
    expect(mocks.select).toHaveBeenCalledTimes(1);
    expect(mocks.select.mock.calls[0]?.[0]).toContain("feed_intent");
    expect(mocks.runFeedPipeline).toHaveBeenCalledWith(expect.objectContaining({
      topics: [], project: "persisted project",
      intent: expect.objectContaining({ selectedSenseConcepts: [selectedSenseConcept("statistics.structural_equation_modeling")] }),
    }));
  });

  it("does not retry unrelated profile errors or run duplicate effects", async () => {
    mocks.maybeSingle.mockResolvedValueOnce({ data: null, error: { message: "database unavailable" } });

    const response = await POST(request());

    expect(response.status).toBe(500);
    expect(mocks.select).toHaveBeenCalledTimes(1);
    expect(mocks.runFeedPipeline).not.toHaveBeenCalled();
    expect(mocks.sendDigestEmail).not.toHaveBeenCalled();
  });
  it("normalizes the same project-only profile shape as the scheduled dispatcher", () => {
    const result = testDigestFeedRequestFromProfile({
      research_topics: [],
      preferred_methods: [],
      current_project: "Stabilize sulfide electrolytes",
      current_challenges: "Lower interfacial resistance",
      disliked_topics: ["review"],
    });

    expect(result).toMatchObject({
      ok: true,
      request: {
        topics: [],
        project: "Stabilize sulfide electrolytes",
        challenge: "Lower interfacial resistance",
        intent: {
          version: "feed-intent-v1",
          exclusions: [{ kind: "exclude-term", value: "review" }],
        },
      },
    });
  });

  it("accepts the same persisted selected sense alone as cron", () => {
    const result = testDigestFeedRequestFromProfile({
      research_topics: [], preferred_methods: [], current_project: null, current_challenges: null, disliked_topics: [],
      feed_intent: { version: "feed-intent-v1", selectedSenseConcepts: [selectedSenseConcept("statistics.structural_equation_modeling")] },
    });
    expect(result).toMatchObject({ ok: true, request: { topics: [], intent: { selectedSenseConcepts: [selectedSenseConcept("statistics.structural_equation_modeling")] } } });
  });
});

// EMPTY-EMAIL-REASON (ABC-JEV-INTEGRATION.md §1bj) -- this sender must pass
// the pipeline's own emptyReasonCode through to sendDigestEmail unchanged;
// the rendered-sentence behaviour itself is covered by digest-template.
// test.ts (real renderer) and send-digest.test.ts (forwarding into the
// renderers) -- this test only proves THIS route's own plumbing.
describe("passes feed.meta.emptyReasonCode through to sendDigestEmail (EMPTY-EMAIL-REASON)", () => {
  it("forwards a real code when the pipeline resolves one", async () => {
    mocks.runFeedPipeline.mockResolvedValue({
      items: [],
      meta: { emptyReasonCode: "sources-unreachable" },
    });

    await POST(request());

    expect(mocks.sendDigestEmail).toHaveBeenCalledWith(
      expect.objectContaining({ emptyReasonCode: "sources-unreachable" }),
    );
  });

  it("forwards undefined when the pipeline returned items (no code to resolve)", async () => {
    mocks.runFeedPipeline.mockResolvedValue({ items: [], meta: {} });

    await POST(request());

    const call = mocks.sendDigestEmail.mock.calls[0][0];
    expect(call.emptyReasonCode).toBeUndefined();
  });
});

// P3-S5 (Round 3) — ABC-JEV-INTEGRATION.md §4 "P3-S5 DESIGN RULING": the
// Jev shadow's `onFreshShortlist` hook is wired ONLY in
// app/api/feed/route.ts's POST handler — this route is never edited by
// that slice. Proves the structural reason the hook cannot reach this call
// site (runFeedPipeline is called with a single argument here, no options
// object at all).
describe("POST /api/test-digest -- never schedules the Jev shadow (P3-S5)", () => {
  it("calls runFeedPipeline with a single argument (no options object) -- structurally cannot carry onFreshShortlist", async () => {
    await POST(request());

    expect(mocks.runFeedPipeline).toHaveBeenCalledTimes(1);
    const call = mocks.runFeedPipeline.mock.calls[0];
    expect(call).toHaveLength(1);
    expect((call?.[0] as Record<string, unknown>)).not.toHaveProperty("onFreshShortlist");
  });
});

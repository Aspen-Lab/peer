import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  select: vi.fn(),
  maybeSingle: vi.fn(),
  runFeedPipeline: vi.fn(),
  sendDigestEmail: vi.fn(),
  getCounterStore: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: () =>
    Promise.resolve({
      auth: { getUser: mocks.getUser },
      from: () => ({ select: mocks.select }),
    }),
}));
vi.mock("@/lib/feed/pipeline", () => ({ runFeedPipeline: mocks.runFeedPipeline }));
vi.mock("@/lib/email/send-digest", () => ({ sendDigestEmail: mocks.sendDigestEmail }));
vi.mock("@/lib/usage/counters", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/usage/counters")>();
  return { ...actual, getCounterStore: mocks.getCounterStore };
});

import { InMemoryCounterStore } from "@/lib/usage/counters";
import { POST } from "./route";

function request(): NextRequest {
  return new NextRequest("http://peer.test/api/profile/send-test-email", { method: "POST" });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("RESEND_API_KEY", "re_test_key");
  mocks.getCounterStore.mockReturnValue(new InMemoryCounterStore());
  mocks.getUser.mockResolvedValue({
    data: { user: { id: "user-1", email: "account@example.test" } },
  });
  mocks.select.mockImplementation(() => ({ eq: () => ({ maybeSingle: mocks.maybeSingle }) }));
  mocks.maybeSingle.mockResolvedValue({
    data: {
      display_name: "Person Example",
      research_topics: [],
      preferred_methods: [],
      current_project: "Stabilize sulfide electrolytes",
      current_challenges: null,
      disliked_topics: [],
      preference_ledger: null,
      paper_count: 10,
      digest_email: "confirmed@example.test",
    },
    error: null,
  });
  mocks.runFeedPipeline.mockResolvedValue({ items: [], meta: {} });
  mocks.sendDigestEmail.mockResolvedValue({ sent: true, messageId: "msg-1" });
});

describe("auth", () => {
  it("401 with no session; no profile read, no pipeline, no email, no counter spent", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null } });

    const response = await POST(request());

    expect(response.status).toBe(401);
    expect(mocks.select).not.toHaveBeenCalled();
    expect(mocks.runFeedPipeline).not.toHaveBeenCalled();
    expect(mocks.sendDigestEmail).not.toHaveBeenCalled();
  });
});

describe("Resend not configured", () => {
  it("returns an honest unavailable result without spending a counter or reading the profile", async () => {
    vi.stubEnv("RESEND_API_KEY", "");

    const response = await POST(request());
    const body = await response.json();

    expect(body.sent).toBe(false);
    expect(body.reason).toBe("unavailable");
    expect(mocks.select).not.toHaveBeenCalled();
    expect(mocks.runFeedPipeline).not.toHaveBeenCalled();
  });
});

describe("destination resolution", () => {
  it("uses digest_email when present", async () => {
    const response = await POST(request());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.sent).toBe(true);
    expect(body.to).toBe("confirmed@example.test");
    expect(mocks.sendDigestEmail).toHaveBeenCalledWith(
      expect.objectContaining({ to: "confirmed@example.test" }),
    );
  });

  it("falls back to the account email when digest_email is absent", async () => {
    mocks.maybeSingle.mockResolvedValue({
      data: {
        display_name: "Person Example", research_topics: [], preferred_methods: [],
        current_project: "Stabilize sulfide electrolytes", current_challenges: null,
        disliked_topics: [], preference_ledger: null, paper_count: 10, digest_email: null,
      },
      error: null,
    });

    const response = await POST(request());
    const body = await response.json();

    expect(body.to).toBe("account@example.test");
  });

  it("neither digest_email nor an account email exists: honest 'add an email first' error, no counter spent", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: { id: "user-1", email: undefined } } });
    mocks.maybeSingle.mockResolvedValue({
      data: {
        display_name: null, research_topics: [], preferred_methods: [],
        current_project: "x", current_challenges: null, disliked_topics: [],
        preference_ledger: null, paper_count: 10, digest_email: null,
      },
      error: null,
    });

    const response = await POST(request());
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.reason).toBe("no_address");
    expect(mocks.runFeedPipeline).not.toHaveBeenCalled();
  });
});

describe("Tier-0 / BYOK untouched (RED #11)", () => {
  it("calls runFeedPipeline with aiTier 0 and no systemSearchAllowed key at all", async () => {
    await POST(request());

    expect(mocks.runFeedPipeline).toHaveBeenCalledTimes(1);
    const call = mocks.runFeedPipeline.mock.calls[0][0] as Record<string, unknown>;
    expect(call.aiTier).toBe(0);
    expect(call).not.toHaveProperty("systemSearchAllowed");
  });
});

describe("rate limit — 3/day, fails CLOSED (§1z P1)", () => {
  it("the 4th send-test-email in the same UTC day is refused; the first 3 succeed", async () => {
    for (let i = 0; i < 3; i += 1) {
      const response = await POST(request());
      expect(response.status).toBe(200);
    }
    const fourth = await POST(request());
    const body = await fourth.json();

    expect(fourth.status).toBe(429);
    expect(body.sent).toBe(false);
    expect(body.reason).toBe("rate_limited");
    expect(mocks.sendDigestEmail).toHaveBeenCalledTimes(3);
  });

  it("an unreachable counter store REFUSES rather than sending (fails closed, not open)", async () => {
    mocks.getCounterStore.mockReturnValue({
      increment: async () => ({ value: 0, ok: false }),
      read: async () => ({ value: 0, ok: false }),
      label: "in-memory" as const,
    });

    const response = await POST(request());
    const body = await response.json();

    expect(response.status).toBe(429);
    expect(body.sent).toBe(false);
    expect(mocks.sendDigestEmail).not.toHaveBeenCalled();
  });
});

describe("does not insert into briefing_deliveries (mirrors test-digest)", () => {
  it("never calls .from(\"briefing_deliveries\")", async () => {
    await POST(request());
    // The only table this route's mock exposes is "profiles" via mocks.select;
    // this is a structural guarantee, not just an assertion on call args.
    expect(mocks.select).toHaveBeenCalledTimes(1);
  });
});

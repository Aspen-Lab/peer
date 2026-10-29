import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";

const mocks = vi.hoisted(() => ({ search: vi.fn(), gate: vi.fn(), screen: vi.fn(), local: vi.fn() }));
vi.mock("../route", () => ({ GET: mocks.search }));
vi.mock("@/lib/security/ai-request", () => ({ requireAiRequest: mocks.gate }));
vi.mock("@/lib/env/local-dev", () => ({ isLocalDevRuntime: mocks.local }));
vi.mock("@/lib/decisions/screen", () => ({ screenWithJev: mocks.screen, MAX_SCREEN_CANDIDATES: 50 }));
import { POST } from "./route";

const secret = "jev-search-test-only-key";
const papers = ["a", "b", "c"].map((id) => ({ id, title: `Paper ${id}`, abstract: "A useful paper", venue: "Journal" }));
function request(overrides: Record<string, unknown> = {}) {
  return new NextRequest("http://localhost/api/papers/search/jev", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query: "battery research", filters: "sort=relevance&oa=1", jevApiKey: secret, ...overrides }),
  });
}
function answer(id: string, core: "core" | "background") {
  return { paperId: id, modelId: "model", usage: null, answers: [{ questionId: "core_vs_background", kind: "choice", value: core, confidence: 0.99, unknown: false }] };
}

describe("Jev search ranking", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.gate.mockResolvedValue({ user: { id: "owner" }, anonymous: false });
    mocks.local.mockReturnValue(false);
    mocks.search.mockResolvedValue(NextResponse.json({ results: papers, total: 3 }));
    mocks.screen.mockResolvedValue({
      decisions: new Map([["a", answer("a", "background")], ["b", answer("b", "core")], ["c", answer("c", "core")]]),
      summary: { rejected: false },
    });
  });
  it("ranks OpenAlex results for the search query, while keeping every result and the key private", async () => {
    const response = await POST(request());
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(body.jev.status).toBe("applied");
    expect(body.results.map((p: { id: string }) => p.id)).toEqual(["b", "c", "a"]);
    const upstream = mocks.search.mock.calls[0][0] as NextRequest;
    expect(upstream.nextUrl.searchParams.get("q")).toBe("battery research");
    expect(upstream.nextUrl.searchParams.get("oa")).toBe("1");
    expect(upstream.nextUrl.searchParams.get("per_page")).toBe("12");
    expect(upstream.url).not.toContain(secret);
    expect(JSON.stringify(body)).not.toContain(secret);
    const options = mocks.screen.mock.calls[0][0];
    expect(options.apiKey).toBe(secret);
    expect(options.ownerId).toBe("owner");
    expect(options.intent.project.value).toBe("battery research");
    expect(options.candidates).toHaveLength(3);
  });
  it("keeps OpenAlex order if Jev rejects the key or cannot answer", async () => {
    mocks.screen.mockResolvedValue({ decisions: new Map(), summary: { rejected: true } });
    const body = await (await POST(request())).json();
    expect(body.jev.status).toBe("rejected");
    expect(body.results).toEqual(papers);
  });
  it("requires a key, relevance sorting and a signed-in or local developer", async () => {
    expect((await POST(request({ jevApiKey: "" }))).status).toBe(400);
    expect((await POST(request({ filters: "sort=newest" }))).status).toBe(400);
    mocks.gate.mockResolvedValue(NextResponse.json({ error: "sign in" }, { status: 401 }));
    expect((await POST(request())).status).toBe(401);
    expect(mocks.search).not.toHaveBeenCalled();
    expect(mocks.screen).not.toHaveBeenCalled();
  });
  it("limits the shortlist and does not call Jev when OpenAlex fails", async () => {
    mocks.search.mockResolvedValueOnce(NextResponse.json({ error: "upstream" }, { status: 502 }));
    expect((await POST(request())).status).toBe(502);
    expect(mocks.screen).not.toHaveBeenCalled();
    mocks.search.mockResolvedValueOnce(NextResponse.json({ results: Array.from({ length: 30 }, (_, i) => ({ id: String(i), title: `Paper ${i}`, abstract: "", venue: "" })) }));
    await POST(request());
    expect(mocks.screen.mock.calls[0][0].candidates).toHaveLength(12);
  });
});

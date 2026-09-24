import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

// P2-S4b (Round 3) — F-A-P2-04 (4c), ABC-JEV-INTEGRATION.md §1p.B(5),
// docs/jev-abc/P2-B-20260924T0345Z.md F-A-P2-04 point 3 (4c(i)). This
// route.ts had no test file before this slice. Covers ONLY the additive
// `resolvedIds` payload capture this slice adds — auth (401) and body
// validation (400) are also exercised as a byte-identical-behavior
// regression net, since this slice touches the same handler.
//
// The client (store/feed.ts, not edited by this slice) sends only
// `{title, concepts}` as `payload` for a paper today — no DOI, no
// abstract. `itemId` itself is already `"source:nativeId"`, so the route
// derives a typed `resolvedIds` object from it (openalexId/s2Id/arxivId/
// pmid, whichever the source directly is) and merges it into the stored
// payload — additive only, no auth/validation change, no schema change.

const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  insert: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: () =>
    Promise.resolve({
      auth: { getUser: mocks.getUser },
      from: () => ({ insert: mocks.insert }),
    }),
}));

import { POST } from "./route";

function request(body: unknown): NextRequest {
  return new NextRequest("http://localhost/api/feedback", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  mocks.getUser.mockReset();
  mocks.insert.mockReset();
  mocks.getUser.mockResolvedValue({ data: { user: { id: "user-1" } } });
  mocks.insert.mockResolvedValue({ error: null });
});

describe("POST /api/feedback — unchanged behavior (regression net)", () => {
  it("401s when there is no signed-in user", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null } });
    const res = await POST(request({ itemId: "openalex:W1", itemKind: "paper", feedback: "saved" }));
    expect(res.status).toBe(401);
    expect(mocks.insert).not.toHaveBeenCalled();
  });

  it("400s when a required field is missing", async () => {
    const res = await POST(request({ itemId: "openalex:W1", itemKind: "paper" }));
    expect(res.status).toBe(400);
    expect(mocks.insert).not.toHaveBeenCalled();
  });

  it("always inserts under the session's own user_id, regardless of any itemId shape", async () => {
    await POST(request({ itemId: "openalex:W1", itemKind: "paper", feedback: "saved" }));
    expect(mocks.insert).toHaveBeenCalledWith(expect.objectContaining({ user_id: "user-1" }));
  });

  it("retries without payload when the insert fails on a payload-column error (legacy schema)", async () => {
    mocks.insert
      .mockResolvedValueOnce({ error: { message: "column \"payload\" does not exist" } })
      .mockResolvedValueOnce({ error: null });

    const res = await POST(
      request({ itemId: "openalex:W1", itemKind: "paper", feedback: "saved", payload: { title: "X" } }),
    );

    expect(res.status).toBe(200);
    expect(mocks.insert).toHaveBeenCalledTimes(2);
    expect(mocks.insert.mock.calls[1][0]).not.toHaveProperty("payload");
  });
});

describe("POST /api/feedback — additive resolvedIds capture (P2-S4b, F-A-P2-04 4c)", () => {
  it("derives resolvedIds.openalexId from an openalex-sourced itemId and merges it into payload", async () => {
    await POST(
      request({
        itemId: "openalex:W123",
        itemKind: "paper",
        feedback: "saved",
        payload: { title: "A battery paper" },
      }),
    );
    expect(mocks.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: { title: "A battery paper", resolvedIds: { openalexId: "W123" } },
      }),
    );
  });

  it("derives resolvedIds.s2Id from a semantic_scholar-sourced itemId", async () => {
    await POST(
      request({ itemId: "semantic_scholar:abc123", itemKind: "paper", feedback: "moreLikeThis", payload: {} }),
    );
    expect(mocks.insert).toHaveBeenCalledWith(
      expect.objectContaining({ payload: { resolvedIds: { s2Id: "abc123" } } }),
    );
  });

  it("derives resolvedIds.arxivId from an arxiv-sourced itemId", async () => {
    await POST(request({ itemId: "arxiv:2409.00001", itemKind: "paper", feedback: "saved", payload: {} }));
    expect(mocks.insert).toHaveBeenCalledWith(
      expect.objectContaining({ payload: { resolvedIds: { arxivId: "2409.00001" } } }),
    );
  });

  it("derives resolvedIds.pmid from a pubmed-sourced itemId", async () => {
    await POST(request({ itemId: "pubmed:99999999", itemKind: "paper", feedback: "saved", payload: {} }));
    expect(mocks.insert).toHaveBeenCalledWith(
      expect.objectContaining({ payload: { resolvedIds: { pmid: "99999999" } } }),
    );
  });

  it("leaves payload byte-identical when the source is not one of the four recognized id forms", async () => {
    await POST(
      request({ itemId: "dblp:conf/xyz", itemKind: "paper", feedback: "saved", payload: { title: "T" } }),
    );
    expect(mocks.insert).toHaveBeenCalledWith(expect.objectContaining({ payload: { title: "T" } }));
  });

  it("leaves payload byte-identical for a non-paper itemKind, even with an openalex-shaped itemId", async () => {
    await POST(
      request({ itemId: "openalex:W1", itemKind: "job", feedback: "saved", payload: { title: "A job" } }),
    );
    expect(mocks.insert).toHaveBeenCalledWith(expect.objectContaining({ payload: { title: "A job" } }));
  });

  it("stores null payload unchanged when itemKind is not paper and no payload was sent", async () => {
    await POST(request({ itemId: "openalex:W1", itemKind: "event", feedback: "saved" }));
    expect(mocks.insert).toHaveBeenCalledWith(expect.objectContaining({ payload: null }));
  });

  it("still derives resolvedIds when payload was omitted entirely for a paper", async () => {
    await POST(request({ itemId: "openalex:W1", itemKind: "paper", feedback: "saved" }));
    expect(mocks.insert).toHaveBeenCalledWith(
      expect.objectContaining({ payload: { resolvedIds: { openalexId: "W1" } } }),
    );
  });

  it("never trusts itemId for authorization — insert always scoped to the session user regardless of resolvedIds", async () => {
    await POST(
      request({ itemId: "openalex:W1", itemKind: "paper", feedback: "saved", payload: { title: "X" } }),
    );
    const call = mocks.insert.mock.calls[0][0];
    expect(call.user_id).toBe("user-1");
  });
});

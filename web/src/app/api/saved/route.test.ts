import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

// P9-31 (C1 of stopping jobs and events, the owner's decision §1a.18 (f); B P9-26 §5, rulings
// §1h.60). /api/saved keeps papers only: a row of kind 'event' or 'job' is neither written nor
// read. This route had no test file before this one.

const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  select: vi.fn(),
  upsert: vi.fn(),
  del: vi.fn(),
  eq: vi.fn(),
  order: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: () =>
    Promise.resolve({
      auth: { getUser: mocks.getUser },
      from: () => ({ select: mocks.select, upsert: mocks.upsert, delete: mocks.del }),
    }),
}));

import { DELETE, GET, POST } from "./route";

function post(body: unknown): NextRequest {
  return new NextRequest("http://localhost/api/saved", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  for (const mock of Object.values(mocks)) mock.mockReset();
  mocks.getUser.mockResolvedValue({ data: { user: { id: "user-1" } } });
  // select("*").eq(...).eq(...).order(...) resolves to the rows; every .eq is recorded.
  const chain = { eq: mocks.eq, order: mocks.order };
  mocks.select.mockReturnValue(chain);
  mocks.eq.mockReturnValue(chain);
  mocks.order.mockResolvedValue({
    data: [
      {
        user_id: "user-1",
        item_id: "openalex:W1",
        item_kind: "paper",
        payload: { id: "openalex:W1", title: "A paper" },
        saved_at: "2026-10-12T00:00:00Z",
      },
    ],
    error: null,
  });
  mocks.upsert.mockResolvedValue({ error: null });
  mocks.del.mockReturnValue({ eq: mocks.eq });
});

describe("GET /api/saved — papers only", () => {
  it("401s when there is no signed-in user, and reads nothing", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null } });
    const res = await GET();
    expect(res.status).toBe(401);
    expect(mocks.select).not.toHaveBeenCalled();
  });

  it("asks the table for the session user's rows of kind paper, and only those", async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    expect(mocks.eq.mock.calls).toEqual([
      ["user_id", "user-1"],
      ["item_kind", "paper"],
    ]);
    expect(await res.json()).toEqual({
      items: [
        {
          itemId: "openalex:W1",
          itemKind: "paper",
          payload: { id: "openalex:W1", title: "A paper" },
          savedAt: "2026-10-12T00:00:00Z",
        },
      ],
    });
  });
});

describe("POST /api/saved — papers only", () => {
  it("401s when there is no signed-in user", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null } });
    const res = await POST(post({ itemId: "openalex:W1", itemKind: "paper", payload: {} }));
    expect(res.status).toBe(401);
    expect(mocks.upsert).not.toHaveBeenCalled();
  });

  it("stores a paper under the session's own user_id", async () => {
    const res = await POST(post({ itemId: "openalex:W1", itemKind: "paper", payload: { title: "P" } }));
    expect(res.status).toBe(200);
    expect(mocks.upsert).toHaveBeenCalledWith(
      { user_id: "user-1", item_id: "openalex:W1", item_kind: "paper", payload: { title: "P" } },
      { onConflict: "user_id,item_id" },
    );
  });

  it.each(["event", "job", "note", ""])("refuses kind %j with a 400 and stores nothing", async (itemKind) => {
    const res = await POST(post({ itemId: "x:1", itemKind, payload: { name: "Not a paper" } }));
    expect(res.status).toBe(400);
    expect(mocks.upsert).not.toHaveBeenCalled();
  });

  it("400s when a required field is missing", async () => {
    const res = await POST(post({ itemId: "openalex:W1", itemKind: "paper" }));
    expect(res.status).toBe(400);
    expect(mocks.upsert).not.toHaveBeenCalled();
  });
});

describe("DELETE /api/saved — unchanged", () => {
  it("removes one saved item, scoped to the session user", async () => {
    mocks.eq.mockReturnValueOnce({ eq: mocks.eq }).mockResolvedValueOnce({ error: null });
    const res = await DELETE(
      new NextRequest("http://localhost/api/saved?itemId=openalex%3AW1", { method: "DELETE" }),
    );
    expect(res.status).toBe(200);
    expect(mocks.eq.mock.calls).toEqual([
      ["user_id", "user-1"],
      ["item_id", "openalex:W1"],
    ]);
  });
});

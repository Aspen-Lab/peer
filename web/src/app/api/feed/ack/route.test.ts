import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

// P4-S4 (Round 3) -- docs/jev-abc/P4-B-20260924T0338Z.md DESIGN §4,
// ABC-JEV-INTEGRATION.md §1p.C.5-7 and §1p.F. Mock template follows
// web/src/app/api/test-digest/route.test.ts exactly (`vi.mock("@/lib/
// supabase/server", ...)` + `vi.hoisted`); the ledger is additionally
// mocked (this route's own brief calls for it) so these tests pin the
// route's HTTP-mapping contract without touching Supabase at all -- the
// ledger's own DB-adjacent behavior is covered separately by
// delivery-ledger.supabase.test.ts.

const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  acknowledgeBatch: vi.fn(),
  ledgerConstructor: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: () =>
    Promise.resolve({
      auth: { getUser: mocks.getUser },
    }),
}));

vi.mock("@/lib/dashboard/delivery-ledger", () => {
  class FakeLedger {
    constructor() {
      mocks.ledgerConstructor();
    }
    acknowledgeBatch(...args: unknown[]) {
      return mocks.acknowledgeBatch(...args);
    }
  }
  return { SupabaseDashboardDeliveryLedger: FakeLedger };
});

import { POST } from "./route";

const VALID_BATCH_ID = "11111111-2222-4333-8444-555555555555";
const OTHER_VALID_BATCH_ID = "99999999-8888-4777-8666-555555555555";

function request(body: unknown): NextRequest {
  return new NextRequest("http://localhost/api/feed/ack", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("PEER_DASHBOARD_LEDGER", "on");
  mocks.getUser.mockResolvedValue({ data: { user: { id: "owner-1" } } });
  mocks.acknowledgeBatch.mockResolvedValue("acknowledged");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("POST /api/feed/ack", () => {
  describe("flag off", () => {
    it("returns 404 not_enabled before touching auth or the ledger", async () => {
      vi.stubEnv("PEER_DASHBOARD_LEDGER", "");

      const response = await POST(request({ batchId: VALID_BATCH_ID }));

      expect(response.status).toBe(404);
      await expect(response.json()).resolves.toEqual({ error: "not_enabled" });
      expect(response.headers.get("Cache-Control")).toBe("private, no-store");
      expect(mocks.getUser).not.toHaveBeenCalled();
      expect(mocks.ledgerConstructor).not.toHaveBeenCalled();
      expect(mocks.acknowledgeBatch).not.toHaveBeenCalled();
    });

    it("stays off for near-miss spellings like 'true'/'1' -- same unforgiving parse as ledger-flag.ts", async () => {
      vi.stubEnv("PEER_DASHBOARD_LEDGER", "true");

      const response = await POST(request({ batchId: VALID_BATCH_ID }));

      expect(response.status).toBe(404);
      expect(mocks.acknowledgeBatch).not.toHaveBeenCalled();
    });
  });

  describe("invalid body -- 400, no DB call", () => {
    const invalidBodies: Array<[string, unknown]> = [
      ["missing batchId", {}],
      ["wrong type", { batchId: 12345 }],
      ["not UUID-shaped", { batchId: "not-a-uuid" }],
      ["empty string", { batchId: "" }],
      ["null body", null],
      ["array body", [VALID_BATCH_ID]],
    ];

    it.each(invalidBodies)(
      "rejects %s with 400 invalid_batch_id and touches neither auth nor the ledger",
      async (_label, body) => {
        const response = await POST(request(body));

        expect(response.status).toBe(400);
        await expect(response.json()).resolves.toEqual({ error: "invalid_batch_id" });
        expect(response.headers.get("Cache-Control")).toBe("private, no-store");
        expect(mocks.getUser).not.toHaveBeenCalled();
        expect(mocks.acknowledgeBatch).not.toHaveBeenCalled();
      },
    );

    it("rejects unparseable JSON with 400 and touches neither auth nor the ledger", async () => {
      const response = await POST(request("{not json"));

      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toEqual({ error: "invalid_batch_id" });
      expect(mocks.getUser).not.toHaveBeenCalled();
      expect(mocks.acknowledgeBatch).not.toHaveBeenCalled();
    });

    it("ignores per-card data in the body -- only batchId is ever forwarded to the ledger", async () => {
      const response = await POST(
        request({ batchId: VALID_BATCH_ID, items: ["x", "y"], paperId: "should-be-ignored" }),
      );

      expect(response.status).toBe(200);
      expect(mocks.acknowledgeBatch).toHaveBeenCalledWith("owner-1", VALID_BATCH_ID);
      expect(mocks.acknowledgeBatch).toHaveBeenCalledTimes(1);
    });
  });

  describe("not signed in", () => {
    it("returns 401 unauthenticated without calling the ledger", async () => {
      mocks.getUser.mockResolvedValue({ data: { user: null } });

      const response = await POST(request({ batchId: VALID_BATCH_ID }));

      expect(response.status).toBe(401);
      await expect(response.json()).resolves.toEqual({ error: "unauthenticated" });
      expect(response.headers.get("Cache-Control")).toBe("private, no-store");
      expect(mocks.acknowledgeBatch).not.toHaveBeenCalled();
    });
  });

  describe("successful acknowledgment", () => {
    it("maps 'acknowledged' to 200 { ok: true, alreadyAcknowledged: false }", async () => {
      mocks.acknowledgeBatch.mockResolvedValue("acknowledged");

      const response = await POST(request({ batchId: VALID_BATCH_ID }));

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({ ok: true, alreadyAcknowledged: false });
      expect(response.headers.get("Cache-Control")).toBe("private, no-store");
      expect(mocks.acknowledgeBatch).toHaveBeenCalledWith("owner-1", VALID_BATCH_ID);
    });

    it("maps 'already_acknowledged' to 200 { ok: true, alreadyAcknowledged: true } -- duplicate ack is success, not an error", async () => {
      mocks.acknowledgeBatch.mockResolvedValue("already_acknowledged");

      const response = await POST(request({ batchId: VALID_BATCH_ID }));

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({ ok: true, alreadyAcknowledged: true });
    });

    it("a duplicate ack call (same batch, twice, sequentially) is 200 both times, second one alreadyAcknowledged", async () => {
      mocks.acknowledgeBatch
        .mockResolvedValueOnce("acknowledged")
        .mockResolvedValueOnce("already_acknowledged");

      const first = await POST(request({ batchId: VALID_BATCH_ID }));
      const second = await POST(request({ batchId: VALID_BATCH_ID }));

      expect(first.status).toBe(200);
      await expect(first.json()).resolves.toEqual({ ok: true, alreadyAcknowledged: false });
      expect(second.status).toBe(200);
      await expect(second.json()).resolves.toEqual({ ok: true, alreadyAcknowledged: true });
      expect(mocks.acknowledgeBatch).toHaveBeenCalledTimes(2);
    });

    it("two 'devices' acking the same batch concurrently both get 200, exactly one alreadyAcknowledged", async () => {
      // The route does no serialization of its own -- that's the DB row
      // lock behind acknowledgeBatch (see delivery-ledger.supabase.test.ts
      // for that guarantee). This pins that the route faithfully forwards
      // whatever the ledger resolves for each of two truly-parallel POSTs.
      mocks.acknowledgeBatch
        .mockResolvedValueOnce("acknowledged")
        .mockResolvedValueOnce("already_acknowledged");

      const [a, b] = await Promise.all([
        POST(request({ batchId: VALID_BATCH_ID })),
        POST(request({ batchId: VALID_BATCH_ID })),
      ]);

      expect(a.status).toBe(200);
      expect(b.status).toBe(200);
      const [aBody, bBody] = await Promise.all([a.json(), b.json()]);
      const alreadyAckedFlags = [aBody.alreadyAcknowledged, bBody.alreadyAcknowledged].sort();
      expect(alreadyAckedFlags).toEqual([false, true]);
      expect(mocks.acknowledgeBatch).toHaveBeenCalledTimes(2);
    });

    it("a cross-day late ack still succeeds -- the route applies no date logic, it forwards batchId verbatim", async () => {
      mocks.acknowledgeBatch.mockResolvedValue("acknowledged");

      const response = await POST(request({ batchId: VALID_BATCH_ID }));

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({ ok: true, alreadyAcknowledged: false });
      expect(mocks.acknowledgeBatch).toHaveBeenCalledWith("owner-1", VALID_BATCH_ID);
      expect(mocks.acknowledgeBatch.mock.calls[0]).toHaveLength(2); // no date/localDate argument
    });
  });

  describe("not_found and owner_mismatch -- identical response, no existence oracle", () => {
    it("maps 'not_found' to 404 { error: 'batch_not_found' }", async () => {
      mocks.acknowledgeBatch.mockResolvedValue("not_found");

      const response = await POST(request({ batchId: VALID_BATCH_ID }));

      expect(response.status).toBe(404);
      await expect(response.json()).resolves.toEqual({ error: "batch_not_found" });
      expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    });

    it("maps 'owner_mismatch' to the exact SAME 404 { error: 'batch_not_found' } -- never reveals the batch belongs to someone else", async () => {
      mocks.acknowledgeBatch.mockResolvedValue("owner_mismatch");

      const response = await POST(request({ batchId: OTHER_VALID_BATCH_ID }));

      expect(response.status).toBe(404);
      await expect(response.json()).resolves.toEqual({ error: "batch_not_found" });
    });
  });

  describe("ledger write throws", () => {
    it("maps a thrown error from acknowledgeBatch to 503 ledger_unavailable", async () => {
      mocks.acknowledgeBatch.mockRejectedValue(new Error("acknowledge_dashboard_batch RPC failed"));

      const response = await POST(request({ batchId: VALID_BATCH_ID }));

      expect(response.status).toBe(503);
      await expect(response.json()).resolves.toEqual({ error: "ledger_unavailable" });
      expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    });
  });
});

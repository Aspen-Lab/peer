import { afterEach, describe, expect, it, vi } from "vitest";
import type { DecisionResult } from "./types";
import { PrivateDecisionCache } from "./private-decision-cache";

const result: DecisionResult = {
  paperId: "paper-1",
  answers: [
    { questionId: "core_vs_background", kind: "choice", value: "core", confidence: 0.9, unknown: false },
  ],
  usage: { inputTokens: 100, outputTokens: 0, latencyMs: 50 },
  modelId: "jev-1.13.0",
};

function fakeClient(overrides?: { maybeSingleResult?: { data: unknown; error: unknown } }) {
  const maybeSingle = vi
    .fn()
    .mockResolvedValue(overrides?.maybeSingleResult ?? { data: { payload: result }, error: null });
  const secondEq = vi.fn(() => ({ maybeSingle }));
  const firstEq = vi.fn(() => ({ eq: secondEq }));
  const select = vi.fn(() => ({ eq: firstEq }));
  const upsert = vi.fn().mockResolvedValue({ error: null });
  const from = vi.fn(() => ({ select, upsert }));
  return { client: { from }, from, select, firstEq, secondEq, upsert, maybeSingle };
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("PrivateDecisionCache", () => {
  it("qualifies both reads and writes by the constructor's owner id and the given scope key", async () => {
    const fake = fakeClient();
    const cache = new PrivateDecisionCache("owner-a", fake.client as never);

    await expect(cache.get("decision-key-1")).resolves.toEqual(result);
    expect(fake.from).toHaveBeenCalledWith("private_decisions");
    expect(fake.select).toHaveBeenCalledWith("payload");
    expect(fake.firstEq).toHaveBeenCalledWith("owner_id", "owner-a");
    expect(fake.secondEq).toHaveBeenCalledWith("scope_key", "decision-key-1");

    await cache.set("decision-key-1", result);
    expect(fake.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ owner_id: "owner-a", scope_key: "decision-key-1", payload: result }),
      { onConflict: "owner_id,scope_key" },
    );
  });

  it("different owners reading the same scope key never see each other's cached decision", async () => {
    // One shared fake backing store, two PrivateDecisionCache instances
    // scoped to different owners — proves isolation is by owner_id, not by
    // trusting the hashed key alone.
    const store = new Map<string, unknown>();
    const client = {
      from: () => ({
        select: () => ({
          eq: (_col1: string, ownerId: string) => ({
            eq: (_col2: string, key: string) => ({
              maybeSingle: async () => {
                const row = store.get(`${ownerId}:${key}`);
                return { data: row ? { payload: row } : null, error: null };
              },
            }),
          }),
        }),
        upsert: async (row: { owner_id: string; scope_key: string; payload: unknown }) => {
          store.set(`${row.owner_id}:${row.scope_key}`, row.payload);
          return { error: null };
        },
      }),
    };
    const ownerACache = new PrivateDecisionCache("owner-a", client as never);
    const ownerBCache = new PrivateDecisionCache("owner-b", client as never);

    await ownerACache.set("shared-scope-key", result);

    expect(await ownerACache.get("shared-scope-key")).toEqual(result);
    expect(await ownerBCache.get("shared-scope-key")).toBeNull();
  });

  it("degrades to a miss (never throws) when passed an unconfigured (null) client", async () => {
    const cache = new PrivateDecisionCache("owner-a", null);
    await expect(cache.get("any-key")).resolves.toBeNull();
    await expect(cache.set("any-key", result)).resolves.toBeUndefined();
  });

  it("degrades to a miss without any network call when Supabase env vars are absent (default resolution, no client override)", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "");
    const cache = new PrivateDecisionCache("owner-a");
    await expect(cache.get("any-key")).resolves.toBeNull();
    await expect(cache.set("any-key", result)).resolves.toBeUndefined();
  });

  it("degrades to a miss when the read errors, without throwing", async () => {
    const fake = fakeClient({ maybeSingleResult: { data: null, error: new Error("boom") } });
    const cache = new PrivateDecisionCache("owner-a", fake.client as never);
    await expect(cache.get("decision-key-1")).resolves.toBeNull();
  });

  it("degrades to a no-op (never throws) when the write itself rejects", async () => {
    const fake = fakeClient();
    fake.upsert.mockRejectedValueOnce(new Error("network down"));
    const cache = new PrivateDecisionCache("owner-a", fake.client as never);
    await expect(cache.set("decision-key-1", result)).resolves.toBeUndefined();
  });

  it("rejects (treats as a miss) a stored payload that is not shaped like a DecisionResult", async () => {
    const fake = fakeClient({ maybeSingleResult: { data: { payload: { not: "a decision" } }, error: null } });
    const cache = new PrivateDecisionCache("owner-a", fake.client as never);
    await expect(cache.get("decision-key-1")).resolves.toBeNull();
  });

  it("treats a maybeSingle throw (not just an error field) as a miss", async () => {
    const fake = fakeClient();
    fake.maybeSingle.mockRejectedValueOnce(new Error("connection reset"));
    const cache = new PrivateDecisionCache("owner-a", fake.client as never);
    await expect(cache.get("decision-key-1")).resolves.toBeNull();
  });
});

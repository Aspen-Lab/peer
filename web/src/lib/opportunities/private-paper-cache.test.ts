import { describe, expect, it, vi } from "vitest";
import type { CachedPaperPool } from "./pool-cache";
import {
  createTrustedPaperCacheScope,
  isTrustedPaperCacheScope,
  PrivatePaperPoolCache,
} from "./private-paper-cache";

const pool: CachedPaperPool = {
  surface: "papers",
  generatedAt: "2026-09-22T00:00:00.000Z",
  localDate: "2026-09-22",
  items: [],
  aiOrder: [],
  aiReasons: {},
};

function fakeClient() {
  const maybeSingle = vi.fn().mockResolvedValue({ data: { payload: pool }, error: null });
  const secondEq = vi.fn(() => ({ maybeSingle }));
  const firstEq = vi.fn(() => ({ eq: secondEq }));
  const select = vi.fn(() => ({ eq: firstEq }));
  const upsert = vi.fn().mockResolvedValue({ error: null });
  const from = vi.fn(() => ({ select, upsert }));
  return { client: { from }, from, select, firstEq, secondEq, upsert };
}

describe("PrivatePaperPoolCache", () => {
  it("only accepts scopes minted by the server-side capability factory", () => {
    const trusted = createTrustedPaperCacheScope({ ownerId: "owner-a", aiTier: 0 });

    expect(isTrustedPaperCacheScope(trusted)).toBe(true);
    expect(isTrustedPaperCacheScope({ ...trusted })).toBe(false);
  });

  it("changes the canonical private identity for project, methods, seeds, controls, and policy", () => {
    const common = { ownerId: "owner-a", project: "electrolytes", aiTier: 2 as const };
    const baseline = createTrustedPaperCacheScope({
      ...common,
      challenge: "lower resistance",
      methods: ["impedance"],
      seedTexts: ["sulfide"],
      controls: { timeWindow: "30d" },
      policyVersion: "v1",
    });
    const variants = [
      createTrustedPaperCacheScope({ ...common, challenge: "improve cycling" }),
      createTrustedPaperCacheScope({ ...common, methods: ["xrd"] }),
      createTrustedPaperCacheScope({ ...common, seedTexts: ["oxide"] }),
      createTrustedPaperCacheScope({ ...common, controls: { timeWindow: "7d" } }),
      createTrustedPaperCacheScope({ ...common, policyVersion: "v2" }),
    ];

    expect(variants.every((scope) => scope.identity !== baseline.identity)).toBe(true);
  });

  it("qualifies both reads and writes by authenticated owner and private scope key", async () => {
    const fake = fakeClient();
    const scope = createTrustedPaperCacheScope({ ownerId: "owner-a", aiTier: 0 });
    const cache = new PrivatePaperPoolCache(scope, fake.client as never);

    await expect(cache.get("peer-pool-v6-papers-private")).resolves.toEqual(pool);
    expect(fake.from).toHaveBeenCalledWith("private_paper_pools");
    expect(fake.select).toHaveBeenCalledWith("payload");
    expect(fake.firstEq).toHaveBeenCalledWith("owner_id", "owner-a");
    expect(fake.secondEq).toHaveBeenCalledWith("scope_key", "peer-pool-v6-papers-private");

    await cache.set("peer-pool-v6-papers-private", pool);
    expect(fake.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ owner_id: "owner-a", scope_key: "peer-pool-v6-papers-private", payload: pool }),
      { onConflict: "owner_id,scope_key" },
    );

    await expect(cache.get("peer-pool-v5-papers-unsafe")).resolves.toBeNull();
    expect(fake.from).toHaveBeenCalledTimes(2);
  });
});

import { afterEach, describe, expect, it, vi } from "vitest";
import { arxiv } from "./arxiv";

// P2-S2 (Round 3) — F-A-P2-02. Same fix as every other academic adapter:
// `fetchOne` used to catch a non-2xx response or a thrown network/parse
// error and return `[]`, identical to a legitimately empty Atom feed. Now it
// throws on a genuine failure and reserves `[]` for a feed with no <entry>.

const EMPTY_FEED = `<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom"></feed>`;

function feedWithOneEntry(): string {
  return `<?xml version="1.0"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <entry>
    <id>http://arxiv.org/abs/2607.12345v1</id>
    <published>2026-07-01T00:00:00Z</published>
    <title>A Real Paper</title>
    <summary>An abstract.</summary>
    <author><name>A. Researcher</name></author>
  </entry>
</feed>`;
}

describe("arxiv adapter — failure visibility (P2-S2)", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("still resolves [] when the API answers 200 with an empty feed (unchanged contract)", async () => {
    globalThis.fetch = vi.fn(
      async () => new Response(EMPTY_FEED, { status: 200 }),
    ) as unknown as typeof fetch;

    const items = await arxiv.fetch({
      topics: ["a topic with genuinely no matches"],
      limit: 10,
    });
    expect(items).toEqual([]);
  });

  it("rejects instead of resolving [] when every query gets a non-2xx response", async () => {
    globalThis.fetch = vi.fn(
      async () => new Response("upstream exploded", { status: 500 }),
    ) as unknown as typeof fetch;

    await expect(
      arxiv.fetch({ topics: ["solid-state batteries"], limit: 10 }),
    ).rejects.toThrow();
  });

  it("rejects instead of resolving [] when every query throws a network error", async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new Error("network down");
    }) as unknown as typeof fetch;

    await expect(
      arxiv.fetch({ topics: ["solid-state batteries"], limit: 10 }),
    ).rejects.toThrow();
  });

  it("still resolves with the successful subset when only some queries fail", async () => {
    let call = 0;
    globalThis.fetch = vi.fn(async () => {
      call += 1;
      if (call === 1) return new Response("boom", { status: 500 });
      return new Response(feedWithOneEntry(), { status: 200 });
    }) as unknown as typeof fetch;

    const items = await arxiv.fetch({
      topics: ["solid-state batteries", "cathode interfaces"],
      limit: 10,
    });
    expect(items.map((item) => item.id)).toEqual(["arxiv:2607.12345"]);
  });
});

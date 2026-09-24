import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  __resetSemanticScholarClientForTests,
  fetchSemanticScholar,
} from "./semantic-scholar-client";

// Ruling 20 (round 7, S23): this queue/backoff mechanism moved here from
// `lib/figures/extract.ts`'s own 1-20 queue (the figure-lookup branch it
// used to serve is gone — the Graph API has no `figures` field). These
// tests are the same shape as the ones that used to exercise it there,
// rewritten against this file's own exported `fetchSemanticScholar`
// instead of the retired `trySemanticScholarCandidates`.

describe("fetchSemanticScholar — concurrency cap + minimum interval", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.useFakeTimers();
    __resetSemanticScholarClientForTests();
  });

  afterEach(() => {
    vi.useRealTimers();
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
    // In afterEach, not just at the end of the one test that stubs it — a
    // test that fails its own assertion before reaching its cleanup line
    // must not leak SEMANTIC_SCHOLAR_API_KEY into every test that runs
    // after it in this file.
    vi.unstubAllEnvs();
  });

  it("never runs more than 2 requests at once", async () => {
    let active = 0;
    let maxActive = 0;
    const pending: Array<() => void> = [];
    globalThis.fetch = vi.fn(async () => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise<void>((resolve) => pending.push(resolve));
      active -= 1;
      return new Response("{}", { status: 200 });
    }) as unknown as typeof fetch;

    const calls = [1, 2, 3, 4].map((n) => fetchSemanticScholar(`https://api.semanticscholar.org/${n}`));

    // Let call 1 through admission immediately; call 2 is gated behind the
    // ~350ms minimum interval, not the concurrency cap, so it needs time to
    // pass before it starts too.
    await vi.advanceTimersByTimeAsync(0);
    expect(pending.length).toBe(1);
    await vi.advanceTimersByTimeAsync(400);
    expect(pending.length).toBe(2);
    expect(maxActive).toBe(2);

    // Calls 3 and 4 must wait for a slot to free, no matter how much time
    // passes, since both existing calls are still in flight.
    await vi.advanceTimersByTimeAsync(10_000);
    expect(pending.length).toBe(2);
    expect(maxActive).toBe(2);

    // Free one slot; a queued call should take it (after its own interval
    // wait), never pushing concurrent-in-flight above 2.
    pending.shift()!();
    await vi.advanceTimersByTimeAsync(400);
    expect(maxActive).toBeLessThanOrEqual(2);

    pending.shift()!();
    await vi.advanceTimersByTimeAsync(400);
    pending.forEach((resolve) => resolve());
    await vi.advanceTimersByTimeAsync(400);
    await Promise.all(calls);
    expect(maxActive).toBeLessThanOrEqual(2);
  });

  it("spaces consecutive request starts by at least ~350ms unkeyed", async () => {
    const starts: number[] = [];
    globalThis.fetch = vi.fn(async () => {
      starts.push(Date.now());
      return new Response("{}", { status: 200 });
    }) as unknown as typeof fetch;

    const p1 = fetchSemanticScholar("https://api.semanticscholar.org/1");
    await vi.advanceTimersByTimeAsync(0);
    const p2 = fetchSemanticScholar("https://api.semanticscholar.org/2");
    await vi.advanceTimersByTimeAsync(0);
    expect(starts.length).toBe(1);

    await vi.advanceTimersByTimeAsync(349);
    expect(starts.length).toBe(1);

    await vi.advanceTimersByTimeAsync(2);
    expect(starts.length).toBe(2);
    expect(starts[1] - starts[0]).toBeGreaterThanOrEqual(350);

    await Promise.all([p1, p2]);
  });

  it("paces to one request per 1.5s when SEMANTIC_SCHOLAR_API_KEY is set", async () => {
    // Ruling 20: paced wider than the keyed publish limit (1 RPS) because
    // the manager's own live testing found 429s still appearing between
    // 200s at a 1.1-3s pace — the key's limit is enforced with some burst
    // memory, and the key is shared by every reader of a deployment.
    vi.stubEnv("SEMANTIC_SCHOLAR_API_KEY", "test-key");
    const starts: number[] = [];
    globalThis.fetch = vi.fn(async () => {
      starts.push(Date.now());
      return new Response("{}", { status: 200 });
    }) as unknown as typeof fetch;

    const p1 = fetchSemanticScholar("https://api.semanticscholar.org/1");
    await vi.advanceTimersByTimeAsync(0);
    const p2 = fetchSemanticScholar("https://api.semanticscholar.org/2");
    await vi.advanceTimersByTimeAsync(0);
    expect(starts.length).toBe(1);

    await vi.advanceTimersByTimeAsync(1_499);
    expect(starts.length).toBe(1);

    await vi.advanceTimersByTimeAsync(1);
    expect(starts.length).toBe(2);
    expect(starts[1] - starts[0]).toBeGreaterThanOrEqual(1_500);

    await Promise.all([p1, p2]);
  });

  it("retries a 429 with exponential backoff: 1s, 2s, 4s, then gives up", async () => {
    globalThis.fetch = vi.fn(async () => new Response("", { status: 429 })) as unknown as typeof fetch;

    const promise = fetchSemanticScholar("https://api.semanticscholar.org/1");
    await vi.advanceTimersByTimeAsync(0);
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(999);
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(globalThis.fetch).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(globalThis.fetch).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(4_000);
    const res = await promise;

    expect(res?.status).toBe(429);
    expect(globalThis.fetch).toHaveBeenCalledTimes(4);
  });

  it("stops retrying as soon as a retry succeeds", async () => {
    let calls = 0;
    globalThis.fetch = vi.fn(async () => {
      calls += 1;
      return calls < 3
        ? new Response("", { status: 429 })
        : new Response("{}", { status: 200 });
    }) as unknown as typeof fetch;

    const promise = fetchSemanticScholar("https://api.semanticscholar.org/1");
    await vi.advanceTimersByTimeAsync(1_000 + 2_000);
    const res = await promise;

    expect(res?.status).toBe(200);
    expect(globalThis.fetch).toHaveBeenCalledTimes(3);
  });

  it("returns null, never throws, on a network error", async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new Error("network down");
    }) as unknown as typeof fetch;

    const promise = fetchSemanticScholar("https://api.semanticscholar.org/1");
    await vi.advanceTimersByTimeAsync(0);
    await expect(promise).resolves.toBeNull();
  });
});

describe("fetchSemanticScholar — x-api-key header", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    __resetSemanticScholarClientForTests();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it("sends x-api-key when SEMANTIC_SCHOLAR_API_KEY is set", async () => {
    vi.stubEnv("SEMANTIC_SCHOLAR_API_KEY", "test-key-123");
    let sentHeaders: Headers | undefined;
    globalThis.fetch = vi.fn(async (_url, init?: RequestInit) => {
      sentHeaders = new Headers(init?.headers);
      return new Response("{}", { status: 200 });
    }) as unknown as typeof fetch;

    await fetchSemanticScholar("https://api.semanticscholar.org/1");

    expect(sentHeaders?.get("x-api-key")).toBe("test-key-123");
  });

  it("omits x-api-key when SEMANTIC_SCHOLAR_API_KEY is not set", async () => {
    vi.stubEnv("SEMANTIC_SCHOLAR_API_KEY", "");
    let sentHeaders: Headers | undefined;
    globalThis.fetch = vi.fn(async (_url, init?: RequestInit) => {
      sentHeaders = new Headers(init?.headers);
      return new Response("{}", { status: 200 });
    }) as unknown as typeof fetch;

    await fetchSemanticScholar("https://api.semanticscholar.org/1");

    expect(sentHeaders?.has("x-api-key")).toBe(false);
  });
});

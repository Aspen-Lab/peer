import { afterEach, describe, expect, it, vi } from "vitest";
import { sourceFetch } from "./_fetch";

// P2-S4a-FIX (Round 3) — F-A-P2S4a-01, ABC-JEV-INTEGRATION.md §1p.B(3).
// Before this fix, `sourceFetch` had no way to carry a request header at
// all, so 4 call sites (sources/openalex.ts, sources/openalex-semantic.ts,
// sources/openalex-topic.ts, affiliation/openalex.ts) each hand-rolled a
// local `openAlexFetch` wrapper that, once a key was configured, called
// `fetch` directly instead of `sourceFetch` — silently dropping the
// `revalidate` (Next.js data-cache) option AND the 429-retry-with-backoff
// `sourceFetch` already provides. This file proves the fix at its source:
// an optional `headers` option that (a) changes nothing when omitted and
// (b) gets the SAME revalidate/retry treatment as every other option.
//
// No live call, ever, from this file — every test stubs `globalThis.fetch`.

describe("sourceFetch — headers passthrough (P2-S4a-FIX)", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("sends no headers key at all when `headers` is omitted (byte-identical to before this fix)", async () => {
    let capturedInit: RequestInit | undefined;
    globalThis.fetch = vi.fn(async (_url: string, init?: RequestInit) => {
      capturedInit = init;
      return new Response("{}", { status: 200 });
    }) as unknown as typeof fetch;

    await sourceFetch("https://api.openalex.org/works?search=x", {
      timeoutMs: 6000,
      revalidate: 300,
    });

    expect(capturedInit).toBeDefined();
    expect(Object.prototype.hasOwnProperty.call(capturedInit!, "headers")).toBe(false);
  });

  it("passes the given headers through to fetch on the first attempt", async () => {
    let capturedHeaders: HeadersInit | undefined;
    globalThis.fetch = vi.fn(async (_url: string, init?: RequestInit) => {
      capturedHeaders = init?.headers;
      return new Response("{}", { status: 200 });
    }) as unknown as typeof fetch;

    await sourceFetch("https://api.openalex.org/works?search=x", {
      timeoutMs: 6000,
      headers: { Authorization: "Bearer secret-key-abc" },
    });

    expect(new Headers(capturedHeaders).get("Authorization")).toBe("Bearer secret-key-abc");
  });

  it("still applies `revalidate` on the Next.js fetch-cache option when headers are also present", async () => {
    const capturedInits: (RequestInit & { next?: { revalidate?: number } })[] = [];
    globalThis.fetch = vi.fn(async (_url: string, init?: RequestInit) => {
      capturedInits.push(init as RequestInit & { next?: { revalidate?: number } });
      return new Response("{}", { status: 200 });
    }) as unknown as typeof fetch;

    await sourceFetch("https://api.openalex.org/works?search=x", {
      timeoutMs: 6000,
      revalidate: 300,
      headers: { Authorization: "Bearer secret-key-abc" },
    });

    expect(capturedInits[0].next?.revalidate).toBe(300);
    expect(new Headers(capturedInits[0].headers).get("Authorization")).toBe(
      "Bearer secret-key-abc",
    );
  });

  it("retries once on 429 and carries the SAME headers on the retried request", async () => {
    const capturedHeaders: (HeadersInit | undefined)[] = [];
    let call = 0;
    globalThis.fetch = vi.fn(async (_url: string, init?: RequestInit) => {
      capturedHeaders.push(init?.headers);
      call += 1;
      if (call === 1) {
        return new Response("rate limited", {
          status: 429,
          headers: { "Retry-After": "0" },
        });
      }
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }) as unknown as typeof fetch;

    const res = await sourceFetch("https://api.openalex.org/works?search=x", {
      timeoutMs: 6000,
      headers: { Authorization: "Bearer secret-key-abc" },
    });

    expect(call).toBe(2);
    expect(res.status).toBe(200);
    expect(capturedHeaders).toHaveLength(2);
    for (const headers of capturedHeaders) {
      expect(new Headers(headers).get("Authorization")).toBe("Bearer secret-key-abc");
    }
  });

  it("still retries once on 429 when no headers are given at all (pre-existing keyless behavior, unchanged)", async () => {
    let call = 0;
    globalThis.fetch = vi.fn(async () => {
      call += 1;
      if (call === 1) {
        return new Response("rate limited", { status: 429 });
      }
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }) as unknown as typeof fetch;

    const res = await sourceFetch("https://api.openalex.org/works?search=x", {
      timeoutMs: 6000,
      revalidate: 300,
    });

    expect(call).toBe(2);
    expect(res.status).toBe(200);
  });
});

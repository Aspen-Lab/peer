// P10-45 (BACKLOG-92): a double effect — React StrictMode in dev — must start one figure request, not
// one that is aborted before the server sees it and one that is kept. The reading page showed
// `ERR_ABORTED` for `/api/figure` for exactly this; `useReading` (P10-40) and `useModelReport` open their
// request after one microtask and ask whether they are still wanted. Here every effect runs the way
// StrictMode runs it: effect, its cleanup, effect again.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mode = vi.hoisted(() => ({ cleanupOnly: false }));

vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  const { hookRuntime } = await import("@/test-support/hook-runtime");
  const strict = (effect: () => void | (() => void), deps?: readonly unknown[]) =>
    hookRuntime.hooks.useEffect(() => {
      const cleanup = effect();
      if (typeof cleanup === "function") cleanup();
      // The reader left in the same tick: the effect is cleaned up and does not run again.
      if (mode.cleanupOnly) return;
      return effect();
    }, deps);
  return { ...actual, ...hookRuntime.hooks, useEffect: strict };
});

import { hookRuntime } from "@/test-support/hook-runtime";
import { useResolvedFigure } from "./paper-figure";

const started: Array<{ url: string; method: string; signal: AbortSignal | undefined }> = [];

describe("useResolvedFigure — one request per mount under a double effect (P10-45, BACKLOG-92)", () => {
  beforeEach(() => {
    started.length = 0;
    mode.cleanupOnly = false;
    vi.stubGlobal("fetch", async (url: string, init: RequestInit = {}) => {
      started.push({ url, method: init.method ?? "GET", signal: init.signal ?? undefined });
      return new Response(JSON.stringify({ imageUrl: "https://example.org/f.png", caption: "Figure 1", source: "publisher", status: "found" }));
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  it("a public paper (GET): the effect run twice starts one request, and it is not aborted", async () => {
    const opened = await hookRuntime.mount(() => useResolvedFigure({ itemId: "arxiv:2610.45001" }));

    expect(started).toHaveLength(1);
    expect(started[0].signal?.aborted).toBe(false);
    expect(opened.value.status).toBe("found");
    opened.unmount();
  });

  it("a private upload (POST): the same", async () => {
    const opened = await hookRuntime.mount(() =>
      useResolvedFigure({ itemId: "upload:0123456789abcd45", revision: 1, query: "invented query" }),
    );

    expect(started).toHaveLength(1);
    expect(started[0].method).toBe("POST");
    expect(started[0].signal?.aborted).toBe(false);
    expect(opened.value.status).toBe("found");
    opened.unmount();
  });

  it("a reader who leaves in the first tick sends nothing at all", async () => {
    mode.cleanupOnly = true;
    const opened = await hookRuntime.mount(() => useResolvedFigure({ itemId: "arxiv:2610.45002" }));
    opened.unmount();

    expect(started).toHaveLength(0);
  });

  it("two plates asking the same figure still share one request, and it is the page's, not aborted", async () => {
    const opened = await hookRuntime.mount(() => {
      const plate = useResolvedFigure({ itemId: "arxiv:2610.45003" });
      useResolvedFigure({ itemId: "arxiv:2610.45003" });
      return plate;
    });

    expect(started).toHaveLength(1);
    expect(started[0].signal?.aborted).toBe(false);
    opened.unmount();
  });
});

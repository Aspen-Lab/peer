import { afterEach, describe, expect, it, vi } from "vitest";
import { withZoomTransition } from "@/lib/theme";

// S22 (round 7, item 7-02): guard-clause coverage for `withZoomTransition`
// — B's own recommended-but-not-mandated test, since these branches are
// pure-function testable without a real paint/animation timeline. This
// repo's tests run in Vitest's Node environment (vitest.config.ts), so
// there is no `document`/`window` at all unless a test stubs one — the
// first `it` below exercises exactly that default. The later tests stub
// just enough of `document`/`window` (`vi.stubGlobal`, the same pattern
// this repo already uses for `fetch` in src/lib/opportunities/*) to reach
// the reduced-motion and no-element branches. The actual visual fade is a
// live paint, not testable here — same ceiling `withThemeTransition`'s own
// (untested) history already established (6-06).

describe("withZoomTransition", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("runs bare, synchronously, when document/window are unavailable", () => {
    const run = vi.fn();
    withZoomTransition(run);
    expect(run).toHaveBeenCalledOnce();
  });

  it("runs bare under prefers-reduced-motion, without looking for an element to fade", () => {
    const querySelector = vi.fn();
    vi.stubGlobal("window", { matchMedia: () => ({ matches: true }) });
    vi.stubGlobal("document", { querySelector });
    const run = vi.fn();
    withZoomTransition(run);
    expect(run).toHaveBeenCalledOnce();
    expect(querySelector).not.toHaveBeenCalled();
  });

  it("runs bare when no [data-zoom-root] element exists (defensive, not expected live)", () => {
    vi.stubGlobal("window", { matchMedia: () => ({ matches: false }) });
    vi.stubGlobal("document", { querySelector: () => null });
    const run = vi.fn();
    withZoomTransition(run);
    expect(run).toHaveBeenCalledOnce();
  });

  it("adds the zoom-transition class before running the change, then removes it after the transition window", () => {
    vi.useFakeTimers();
    const classList = new Set<string>();
    const root = {
      classList: {
        add: (c: string) => classList.add(c),
        remove: (c: string) => classList.delete(c),
      },
      offsetHeight: 0,
    };
    vi.stubGlobal("window", {
      matchMedia: () => ({ matches: false }),
      // Delegates to the ambient (faked, via vi.useFakeTimers above) timer
      // so `vi.advanceTimersByTime` below actually fires the cleanup.
      setTimeout: (...args: Parameters<typeof setTimeout>) => setTimeout(...args),
    });
    vi.stubGlobal("document", { querySelector: () => root });
    const run = vi.fn(() => {
      // The class must already be on the element when `run` fires, so
      // there is a "before" value the transition can ease from — the same
      // add-then-change ordering withThemeTransition's own comment
      // documents and this project already confirmed by execution there.
      expect(classList.has("zoom-transition")).toBe(true);
    });
    withZoomTransition(run);
    expect(run).toHaveBeenCalledOnce();
    expect(classList.has("zoom-transition")).toBe(true);
    vi.advanceTimersByTime(400);
    expect(classList.has("zoom-transition")).toBe(false);
  });
});

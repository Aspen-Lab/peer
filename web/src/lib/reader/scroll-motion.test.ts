import { afterEach, describe, expect, it, vi } from "vitest";
import { scrollBehavior } from "./scroll-motion";

// P11-32 (BACKLOG-107): the one place a script scroll learns whether the reader wants it animated. The three scrolls that use it are held in
// `script-scrolls.test.ts`.

afterEach(() => vi.unstubAllGlobals());

describe("scrollBehavior", () => {
  it("is 'auto' (the stylesheet's rule: instant) while the reader prefers reduced motion", () => {
    vi.stubGlobal("window", { matchMedia: (query: string) => ({ matches: query === "(prefers-reduced-motion: reduce)" }) });
    expect(scrollBehavior()).toBe("auto");
  });

  it("is 'smooth' for a reader who has not asked for less motion", () => {
    vi.stubGlobal("window", { matchMedia: () => ({ matches: false }) });
    expect(scrollBehavior()).toBe("smooth");
  });

  it("asks the query each time: a setting changed while the page stands is the next scroll's", () => {
    let reduce = false;
    vi.stubGlobal("window", { matchMedia: () => ({ matches: reduce }) });
    expect(scrollBehavior()).toBe("smooth");
    reduce = true;
    expect(scrollBehavior()).toBe("auto");
    reduce = false;
    expect(scrollBehavior()).toBe("smooth");
  });

  it("is 'smooth' where there is no window, or a window that cannot answer (a server render, a test in plain Node)", () => {
    expect(scrollBehavior()).toBe("smooth");
    vi.stubGlobal("window", {});
    expect(scrollBehavior()).toBe("smooth");
  });
});

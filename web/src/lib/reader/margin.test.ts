import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The hook runs on the minimal hook runtime (this project's tests run in plain Node: no DOM, no @testing-library).
vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  const { hookRuntime } = await import("@/test-support/hook-runtime");
  const runtime = hookRuntime.hooks;
  // `useSyncExternalStore` on the same runtime: the snapshot in a state, a subscription in an effect.
  const storeShim = <T,>(subscribe: (onChange: () => void) => () => void, getSnapshot: () => T): T => {
    const [value, setValue] = runtime.useState<T>(getSnapshot);
    runtime.useEffect(() => {
      setValue(getSnapshot());
      return subscribe(() => setValue(getSnapshot()));
    }, [subscribe]);
    return value;
  };
  return { ...actual, ...hookRuntime.hooks, useSyncExternalStore: storeShim };
});

import { useEffect } from "react";
import { DOCK_TOP_PX, columnBottomPx, legendHeightPx } from "@/components/reader/explain-dock";
import { hookRuntime } from "@/test-support/hook-runtime";
import {
  MARGIN_CARD_SELECTOR,
  MARGIN_SELECTOR,
  marginRectOf,
  placeInMargin,
  readPageZoom,
  registerMargin,
  useMarginRect,
  useMarginStore,
  type MarginEnv,
  type MarginRect,
} from "./margin";

// P11-10 rule 1 (B P11-01 §3.1; ruling §1h.113 (d)): the margin as a measured rectangle, and where a card stands in it. Every box
// here is invented.

const RECT: MarginRect = { left: 1080, width: 360, top: 48, bottom: 860 };

/** A margin cell whose box a test can change, and the page around it. */
function page(initial = { left: 1080, width: 360 }, height = 900, zoom = 1) {
  const state = { box: { ...initial }, height, zoom };
  const grid = {} as unknown as HTMLElement;
  const el = { getBoundingClientRect: () => ({ ...state.box }), parentElement: grid } as unknown as HTMLElement;
  const watched: Array<readonly Element[]> = [];
  const observers = new Set<() => void>();
  const resizers = new Set<() => void>();
  const env: MarginEnv = {
    viewportHeight: () => state.height,
    zoom: () => state.zoom,
    observe: (els, cb) => {
      watched.push(els);
      observers.add(cb);
      return () => observers.delete(cb);
    },
    onResize: (cb) => {
      resizers.add(cb);
      return () => resizers.delete(cb);
    },
  };
  return { state, el, grid, watched, env, observers, resizers, resize: () => resizers.forEach((cb) => cb()), observe: () => observers.forEach((cb) => cb()) };
}

beforeEach(() => useMarginStore.setState({ rect: null }));
afterEach(() => useMarginStore.setState({ rect: null }));

describe("the selectors", () => {
  it("name the shell's margin cell and the cards that stand in it", () => {
    expect(MARGIN_SELECTOR).toBe("[data-reader-margin]");
    expect(MARGIN_CARD_SELECTOR).toBe("[data-margin-card]");
  });
});

describe("placeInMargin — a card level with its anchor, inside the band", () => {
  it("stands at the anchor where the whole card fits below it", () => {
    expect(placeInMargin(RECT, 300, 200)).toBe(300);
    expect(placeInMargin(RECT, 48, 200)).toBe(48);
    expect(placeInMargin(RECT, 660, 200)).toBe(660);
  });

  it("never stands above the masthead's foot", () => {
    expect(placeInMargin(RECT, 10, 200)).toBe(48);
    expect(placeInMargin(RECT, -400, 200)).toBe(48);
  });

  it("is lifted until its foot stands on the band's bottom, never lower", () => {
    expect(placeInMargin(RECT, 700, 200)).toBe(660);
    expect(placeInMargin(RECT, 5000, 200)).toBe(660);
  });

  it("stands at the top of the band when it is taller than the band", () => {
    expect(placeInMargin(RECT, 300, 2000)).toBe(48);
    expect(placeInMargin(RECT, 5000, 813)).toBe(48);
  });
});

describe("marginRectOf — the cell's horizontal extent and the viewport's vertical band", () => {
  it("takes left and width from the cell and the band from the dock's numbers", () => {
    expect(marginRectOf({ left: 1080, width: 360 }, 900, 1)).toEqual({ left: 1080, width: 360, top: DOCK_TOP_PX, bottom: columnBottomPx(900, legendHeightPx(1)) });
    // 900 - max(40, 28 + 8) = 860.
    expect(marginRectOf({ left: 1080, width: 360 }, 900, 1)).toEqual(RECT);
  });

  it("the band starts at the masthead's foot, 48 px, at every window", () => {
    expect(DOCK_TOP_PX).toBe(48);
    for (const height of [600, 720, 900, 1080]) expect(marginRectOf({ left: 0, width: 280 }, height, 1).top).toBe(48);
  });

  it("the band ends at the foot legend's top, which Fit's zoom lifts (the legend is 28 px at zoom 1, 28 x zoom under Fit)", () => {
    expect(marginRectOf({ left: 0, width: 360 }, 720, 1).bottom).toBe(680);
    // zoom 1.5: the legend is 42 px, and 8 px of margin: 1080 - 50.
    expect(marginRectOf({ left: 0, width: 360 }, 1080, 1.5).bottom).toBe(1030);
    expect(marginRectOf({ left: 0, width: 360 }, 1080, 1.5).bottom).toBeLessThan(marginRectOf({ left: 0, width: 360 }, 1080, 1).bottom);
  });

  it("takes a zoom it cannot read as no zoom", () => {
    expect(marginRectOf({ left: 0, width: 360 }, 900, Number.NaN).bottom).toBe(860);
  });
});

describe("readPageZoom", () => {
  it("is 1 where there is no DOM to ask (a plain Node test, a server render)", () => {
    expect(readPageZoom()).toBe(1);
  });
});

describe("registerMargin", () => {
  it("publishes the cell's rect at once", () => {
    const p = page();
    const stop = registerMargin(p.el, p.env);
    expect(useMarginStore.getState().rect).toEqual({ left: 1080, width: 360, top: 48, bottom: 860 });
    stop();
  });

  it("watches the cell and the grid it stands in: a scrollbar that appears moves the cell without resizing it, and resizes the grid", () => {
    const p = page();
    const stop = registerMargin(p.el, p.env);
    expect(p.watched).toEqual([[p.el, p.grid]]);
    stop();
  });

  it("re-reads when the cell is resized (a divider drag) and when the window is", () => {
    const p = page();
    const stop = registerMargin(p.el, p.env);

    p.state.box = { left: 980, width: 460 };
    p.observe();
    expect(useMarginStore.getState().rect).toEqual({ left: 980, width: 460, top: 48, bottom: 860 });

    p.state.height = 720;
    p.resize();
    expect(useMarginStore.getState().rect).toEqual({ left: 980, width: 460, top: 48, bottom: 680 });
    stop();
  });

  it("follows Fit's zoom: the band's foot is the legend as the zoom scales it", () => {
    const p = page({ left: 1000, width: 440 }, 1080, 1);
    const stop = registerMargin(p.el, p.env);
    expect(useMarginStore.getState().rect?.bottom).toBe(1040);
    p.state.zoom = 1.5;
    p.observe();
    expect(useMarginStore.getState().rect?.bottom).toBe(1030);
    stop();
  });

  it("does not publish a rect that is the same as the one it holds (no render for a read that found nothing new)", () => {
    const p = page();
    const stop = registerMargin(p.el, p.env);
    const seen: Array<MarginRect | null> = [];
    const unsubscribe = useMarginStore.subscribe((state) => seen.push(state.rect));
    p.observe();
    p.resize();
    p.observe();
    expect(seen).toEqual([]);
    p.state.box = { left: 1000, width: 440 };
    p.observe();
    expect(seen).toHaveLength(1);
    unsubscribe();
    stop();
  });

  it("goes back to null when it is stopped, and stops listening", () => {
    const p = page();
    const stop = registerMargin(p.el, p.env);
    expect(p.observers.size + p.resizers.size).toBe(2);
    stop();
    expect(useMarginStore.getState().rect).toBeNull();
    expect(p.observers.size + p.resizers.size).toBe(0);

    p.state.box = { left: 500, width: 300 };
    p.observe();
    p.resize();
    expect(useMarginStore.getState().rect).toBeNull();
  });

  it("leaves a later margin's rect alone when an earlier one is stopped", () => {
    const first = page({ left: 1000, width: 360 });
    const second = page({ left: 900, width: 460 });
    const stopFirst = registerMargin(first.el, first.env);
    const stopSecond = registerMargin(second.el, second.env);
    expect(useMarginStore.getState().rect?.left).toBe(900);

    stopFirst();
    expect(useMarginStore.getState().rect).toEqual({ left: 900, width: 460, top: 48, bottom: 860 });
    // The earlier cell is gone: its observers no longer move the rect.
    first.state.box = { left: 1, width: 1 };
    first.observe();
    expect(useMarginStore.getState().rect?.left).toBe(900);

    stopSecond();
    expect(useMarginStore.getState().rect).toBeNull();
  });
});

describe("useMarginRect", () => {
  it("is null while no shell has registered a margin", async () => {
    const mounted = await hookRuntime.mount(() => useMarginRect());
    expect(mounted.value).toBeNull();
    mounted.unmount();
  });

  it("is the rect of a margin that was registered before the component mounted", async () => {
    const p = page();
    const stop = registerMargin(p.el, p.env);
    const mounted = await hookRuntime.mount(() => useMarginRect());
    expect(mounted.value).toEqual({ left: 1080, width: 360, top: 48, bottom: 860 });
    mounted.unmount();
    stop();
  });

  it("follows a shell that registers after it mounted, and goes back to null when the shell goes", async () => {
    const p = page();
    const seen: Array<MarginRect | null> = [];
    let stop: (() => void) | undefined;
    const mounted = await hookRuntime.mount(() => {
      const rect = useMarginRect();
      seen.push(rect);
      // The shell mounting its margin once the component stands...
      useEffect(() => {
        stop = registerMargin(p.el, p.env);
      }, []);
      // ...and going away once the component has seen the rect.
      useEffect(() => {
        if (rect !== null) stop?.();
      }, [rect]);
      return rect;
    });
    expect(seen[0]).toBeNull();
    expect(seen).toContainEqual({ left: 1080, width: 360, top: 48, bottom: 860 });
    expect(mounted.value).toBeNull();
    mounted.unmount();
  });

  it("has no listener left on the store once the component has gone", async () => {
    let listeners = 0;
    const subscribe = useMarginStore.subscribe;
    const spy = vi.spyOn(useMarginStore, "subscribe").mockImplementation((listener) => {
      listeners += 1;
      const stop = subscribe(listener);
      return () => {
        listeners -= 1;
        stop();
      };
    });
    const mounted = await hookRuntime.mount(() => useMarginRect());
    expect(listeners).toBe(1);
    mounted.unmount();
    expect(listeners).toBe(0);
    spy.mockRestore();
  });
});

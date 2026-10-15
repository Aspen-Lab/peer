import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// P1-08 (§1a.6, §1f.19 amended): an uploaded PDF's page has no swipe-left —
// without `onSwipeLeft` a left drag is held at the start, nothing is
// revealed and nothing commits; swipe-right-to-save is unchanged. No DOM in
// this project's Vitest: the card's own pointer handlers are driven on the
// minimal hook runtime, and the markup is rendered with react-dom/server.
vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  const { hookRuntime } = await import("@/test-support/hook-runtime");
  return { ...actual, ...hookRuntime.hooks };
});

import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { hookRuntime } from "@/test-support/hook-runtime";
import { SwipeableCard, dragOffset, releaseDirection } from "./swipe-card";

type Handlers = {
  onPointerDown: (event: unknown) => void;
  onPointerMove: (event: unknown) => void;
  onPointerUp: (event: unknown) => void;
};

/** Drag a mounted card from x=200 to `toX` (and release), as a finger would. */
async function drag(props: Parameters<typeof SwipeableCard>[0], toX: number) {
  const mounted = await hookRuntime.mount(() => SwipeableCard(props) as ReactElement<Handlers>);
  const { onPointerDown, onPointerMove, onPointerUp } = mounted.value.props;
  const target = { setPointerCapture: () => {}, clientWidth: 360 };
  onPointerDown({ pointerType: "touch", clientX: 200, clientY: 100, timeStamp: 0, currentTarget: target });
  onPointerMove({ pointerId: 1, clientX: toX, clientY: 102, timeStamp: 100, currentTarget: target });
  onPointerUp({ pointerId: 1, clientX: toX, clientY: 102, timeStamp: 200, currentTarget: target });
  mounted.unmount();
}

describe("SwipeableCard — no swipe-left without its handler (P1-08)", () => {
  beforeEach(() => {
    // Reduced motion: a committed left swipe calls its handler at once.
    vi.stubGlobal("window", { matchMedia: () => ({ matches: true }), setTimeout });
  });
  afterEach(() => vi.unstubAllGlobals());

  it("holds a left drag at the start and never commits it when there is no left action", () => {
    expect(dragOffset(-150, false)).toBe(0);
    expect(dragOffset(-40, false)).toBe(0);
    expect(releaseDirection(-150, -1, false)).toBeNull();
    // Right is unchanged.
    expect(dragOffset(150, false)).toBe(dragOffset(150, true));
    expect(releaseDirection(150, 1, false)).toBe("right");
  });

  it("with a left action, a left drag follows the finger and commits, as before", () => {
    expect(dragOffset(-40, true)).toBe(-40);
    expect(releaseDirection(-150, -1, true)).toBe("left");
  });

  it("a real left drag on a card without onSwipeLeft does nothing; with it, it dismisses", async () => {
    const save = vi.fn();
    await drag({ children: null, onSwipeRight: save, rightLabel: "Save" }, 40);
    expect(save).not.toHaveBeenCalled();

    const dismiss = vi.fn();
    await drag({ children: null, onSwipeRight: save, onSwipeLeft: dismiss, rightLabel: "Save", leftLabel: "Not interested" }, 40);
    expect(dismiss).toHaveBeenCalledTimes(1);
  });

  it("a right drag still saves, with or without a left action", async () => {
    const save = vi.fn();
    await drag({ children: null, onSwipeRight: save, rightLabel: "Save" }, 360);
    expect(save).toHaveBeenCalledTimes(1);
  });
});

describe("SwipeableCard — the reveal (P1-08)", () => {
  it("draws no 'Not interested' reveal without a left action", async () => {
    // The card's own render on the hook runtime, then its host-element tree
    // as markup.
    const markup = async (props: Parameters<typeof SwipeableCard>[0]) => {
      const mounted = await hookRuntime.mount(() => SwipeableCard(props));
      mounted.unmount();
      return renderToStaticMarkup(mounted.value);
    };
    const without = await markup({ children: "paper", onSwipeRight: () => {}, rightLabel: "Save" });
    const withLeft = await markup({ children: "paper", onSwipeRight: () => {}, onSwipeLeft: () => {}, rightLabel: "Save", leftLabel: "Not interested" });

    expect(withLeft).toContain("Not interested");
    expect(withLeft).toContain("M18 6 6 18");
    expect(without).not.toContain("Not interested");
    expect(without).not.toContain("M18 6 6 18");
  });
});

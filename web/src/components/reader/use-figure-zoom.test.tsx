import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

// P11-11 (B P11-05 §2.2; ruling §1h.113 (c) D1, D7): the pointer, the wheel and the keys of a zoomable figure — the hook the Summary's
// lightbox and the margin's figure card share. The lightbox's settings (two steps, no wheel, no keys) are the behaviour it had; the
// card's (fit to 6x, the wheel at the pointer, the keys while the focus is on the picture) are the new ones. The numbers are
// figure-zoom.test.ts; this file is what the hook does with a pointer, a wheel and a key.
//
// No DOM (this project's tests run in plain Node): the staged hook runtime renders the hook, a "surface" is an object that records the
// native listeners put on it and answers the few members the hook reads, and an event is an object with the fields the hook reads. The
// surface's rect is the drawn picture, computed from the last render as a browser would, so the wheel's anchor is the real thing.
// The last block mounts the Summary's FigureViewer itself on the same runtime (useId is the one hook the runtime does not have).
vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  const { stagedRuntime } = await import("@/test-support/staged-runtime");
  return { ...actual, ...stagedRuntime.hooks, useId: () => "figure-caption" };
});

import type { PointerEvent, ReactElement, ReactNode } from "react";
import { stagedRuntime } from "@/test-support/staged-runtime";
import { clampFigureSize, SUMMARY_ZOOM_STEPS } from "./figure-zoom";
import { FigureViewer } from "./figure-lightbox";
import { useFigureZoom, type FigureZoom, type FigureZoomOptions } from "./use-figure-zoom";

// A 600 x 400 picture in a 400 x 300 box is fitted to 384 x 256; at 2x it is 768 x 512, which may be panned 184 across and 106 down.
const NATURAL = { width: 600, height: 400 };
const BOX = { width: 400, height: 300 };
/** Where the box's centre is on the screen. */
const CENTRE = { x: 500, y: 400 };

type Listener = { fn: (event: never) => void; options: unknown };

class Surface {
  listeners: Record<string, Listener[]> = {};
  captured = new Set<number>();
  focusTaken = 0;
  /** Set by the harness: the drawn picture as of the last render. */
  rectOf: () => { left: number; top: number; width: number; height: number } = () => ({ left: 0, top: 0, width: 0, height: 0 });

  addEventListener(type: string, fn: Listener["fn"], options?: unknown) {
    (this.listeners[type] ??= []).push({ fn, options });
  }
  removeEventListener(type: string, fn: Listener["fn"]) {
    this.listeners[type] = (this.listeners[type] ?? []).filter((listener) => listener.fn !== fn);
  }
  getBoundingClientRect() {
    return this.rectOf();
  }
  focus() {
    this.focusTaken += 1;
  }
  setPointerCapture(id: number) {
    this.captured.add(id);
  }
  releasePointerCapture(id: number) {
    this.captured.delete(id);
  }
  hasPointerCapture(id: number) {
    return this.captured.has(id);
  }
  count(type: string) {
    return (this.listeners[type] ?? []).length;
  }
  fire(type: string, event: unknown) {
    for (const listener of this.listeners[type] ?? []) listener.fn(event as never);
  }
}

interface Run {
  surface: Surface;
  input: FigureZoomOptions;
  /** What the hook returned on the last render. */
  readonly now: FigureZoom;
  /** A discrete event: the handler, then React's render. */
  act: (handler: () => void) => void;
  /** A render nothing discrete started (the parent re-rendered with a new box). */
  render: () => void;
  pointer: (type: string, x: number, y: number, extra?: Record<string, unknown>) => PointerEvent<HTMLElement>;
  press: (type: "onPointerDown" | "onPointerMove" | "onPointerUp" | "onPointerCancel" | "onLostPointerCapture", x: number, y: number, extra?: Record<string, unknown>) => PointerEvent<HTMLElement>;
  wheel: (deltaY: number, x?: number, y?: number, extra?: Record<string, unknown>) => ReturnType<typeof vi.fn>;
  key: (key: string, extra?: Record<string, unknown>) => { preventDefault: ReturnType<typeof vi.fn>; stopPropagation: ReturnType<typeof vi.fn> };
  unmount: () => void;
}

function open(options: Partial<FigureZoomOptions> = {}): Run {
  const surface = new Surface();
  const input: FigureZoomOptions = { natural: NATURAL, viewport: BOX, ...options };
  // A ref callback runs when the element mounts, not at every render: give the surface to the hook once.
  let attached = false;
  const mounted = stagedRuntime.mount(() => useFigureZoom(input), (output) => {
    if (attached) return;
    attached = true;
    output.surfaceRef(surface as unknown as HTMLElement);
  });
  surface.rectOf = () => {
    const out = mounted.value;
    const width = out.size.width * out.scale;
    const height = out.size.height * out.scale;
    return { left: CENTRE.x + out.offset.x - width / 2, top: CENTRE.y + out.offset.y - height / 2, width, height };
  };
  // The first commit gave the surface to the hook; this render (and the passive effects after it) puts the listeners on it.
  stagedRuntime.event(() => {});
  const run: Run = {
    surface,
    input,
    get now() {
      return mounted.value;
    },
    act: (handler) => stagedRuntime.event(handler),
    render: () => {
      stagedRuntime.rerender();
      stagedRuntime.flush();
    },
    pointer: (type, x, y, extra = {}) =>
      ({ type, clientX: x, clientY: y, pointerId: 1, button: 0, isPrimary: true, currentTarget: surface, preventDefault: vi.fn(), ...extra }) as unknown as PointerEvent<HTMLElement>,
    press: (name, x, y, extra) => {
      const type = { onPointerDown: "pointerdown", onPointerMove: "pointermove", onPointerUp: "pointerup", onPointerCancel: "pointercancel", onLostPointerCapture: "lostpointercapture" }[name];
      const event = run.pointer(type, x, y, extra);
      stagedRuntime.event(() => run.now.surface[name](event));
      return event;
    },
    wheel: (deltaY, x = CENTRE.x, y = CENTRE.y, extra = {}) => {
      const preventDefault = vi.fn();
      stagedRuntime.event(() => surface.fire("wheel", { deltaY, deltaMode: 0, clientX: x, clientY: y, ctrlKey: false, preventDefault, ...extra }));
      return preventDefault;
    },
    key: (key, extra = {}) => {
      const event = { key, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, preventDefault: vi.fn(), stopPropagation: vi.fn(), ...extra };
      stagedRuntime.event(() => surface.fire("keydown", event));
      return event;
    },
    unmount: () => mounted.unmount(),
  };
  return run;
}

const click = (run: Run) => run.act(() => run.now.surface.onClick());
/** A pan clamped to nothing can come out as -0, which `toEqual` tells from 0. */
const at = (point: { x: number; y: number }) => ({ x: point.x + 0, y: point.y + 0 });
const SUMMARY: Partial<FigureZoomOptions> = { steps: SUMMARY_ZOOM_STEPS, wheel: false, keys: false };

describe("at rest", () => {
  it("the picture is fitted to the box, centred, not zoomed, not dragging; its style is the lightbox's own", () => {
    const run = open();

    expect(run.now.size).toEqual({ width: 384, height: 256 });
    expect(run.now.scale).toBe(1);
    expect(at(run.now.offset)).toEqual({ x: 0, y: 0 });
    expect(run.now.zoomed).toBe(false);
    expect(run.now.dragging).toBe(false);
    expect(run.now.canZoomIn).toBe(true);
    expect(run.now.canZoomOut).toBe(false);
    expect(run.now.style).toEqual({ width: 384, height: 256, transform: "translate(0px, 0px) scale(1)" });
  });

  it("with the picture's size not known yet the fitted size is nothing", () => {
    const run = open({ natural: null });

    expect(run.now.size).toEqual({ width: 0, height: 0 });
    expect(run.now.style).toEqual({ width: 0, height: 0, transform: "translate(0px, 0px) scale(1)" });
  });
});

describe("the Summary's settings: two steps, no wheel, no keys — the lightbox as it was", () => {
  it("a click toggles fit <-> 2x, and the label state follows (zoomed)", () => {
    const run = open(SUMMARY);

    click(run);
    expect(run.now.zoomed).toBe(true);
    expect(run.now.scale).toBe(2);
    expect(run.now.style.transform).toBe("translate(0px, 0px) scale(2)");

    click(run);
    expect(run.now.zoomed).toBe(false);
    expect(run.now.scale).toBe(1);
    expect(run.now.style.transform).toBe("translate(0px, 0px) scale(1)");
  });

  it("puts no native listener on the surface — no wheel, no keydown — so the page's wheel and the lightbox's capture handler are untouched", () => {
    const run = open(SUMMARY);

    expect(run.surface.count("wheel")).toBe(0);
    expect(run.surface.count("keydown")).toBe(0);
  });

  it("a click on a zoomed picture that was panned fits it, centred", () => {
    const run = open(SUMMARY);
    click(run);
    run.press("onPointerDown", 100, 100);
    run.press("onPointerMove", 20, 60);
    run.press("onPointerUp", 20, 60);
    expect(at(run.now.offset)).toEqual({ x: -80, y: -40 });
    click(run); // the click that ends the drag: swallowed
    click(run);

    expect(run.now.zoomed).toBe(false);
    expect(at(run.now.offset)).toEqual({ x: 0, y: 0 });
  });
});

describe("the drag", () => {
  it("does nothing at fit: no capture, no focus, no drag", () => {
    const run = open();
    const down = run.press("onPointerDown", 100, 100);

    expect(run.now.dragging).toBe(false);
    expect(run.surface.captured.size).toBe(0);
    expect(run.surface.focusTaken).toBe(0);
    expect(down.preventDefault).not.toHaveBeenCalled();
  });

  it("a zoomed press takes the pointer and the focus; a move under 4 px is still a click, 4 px starts the pan", () => {
    const run = open();
    click(run);
    const down = run.press("onPointerDown", 100, 100);

    expect(run.now.dragging).toBe(true);
    expect([...run.surface.captured]).toEqual([1]);
    expect(run.surface.focusTaken).toBe(1);
    expect(down.preventDefault).toHaveBeenCalledTimes(1);

    run.press("onPointerMove", 103, 100); // 3 px
    expect(at(run.now.offset)).toEqual({ x: 0, y: 0 });
    run.press("onPointerMove", 102, 102); // 2.83 px
    expect(at(run.now.offset)).toEqual({ x: 0, y: 0 });
    run.press("onPointerMove", 104, 100); // 4 px
    expect(at(run.now.offset)).toEqual({ x: 4, y: 0 });
    run.press("onPointerMove", 80, 70); // from the press, not from the last move
    expect(at(run.now.offset)).toEqual({ x: -20, y: -30 });
  });

  it("the pan stops where every edge is still reachable", () => {
    const run = open();
    click(run);
    run.press("onPointerDown", 100, 100);
    run.press("onPointerMove", -900, -900);
    expect(at(run.now.offset)).toEqual({ x: -184, y: -106 });
    run.press("onPointerMove", 1100, 1100);
    expect(at(run.now.offset)).toEqual({ x: 184, y: 106 });
  });

  it("the click that ends a real drag is swallowed — once; the next click toggles", () => {
    const run = open();
    click(run);
    run.press("onPointerDown", 100, 100);
    run.press("onPointerMove", 60, 100);
    run.press("onPointerUp", 60, 100);

    expect(run.now.dragging).toBe(false);
    expect(run.surface.captured.size).toBe(0);
    click(run);
    expect(run.now.zoomed).toBe(true);
    expect(at(run.now.offset)).toEqual({ x: -40, y: 0 });
    click(run);
    expect(run.now.zoomed).toBe(false);
  });

  it("a press that never moved 4 px is a click: the release does not swallow it", () => {
    const run = open();
    click(run);
    run.press("onPointerDown", 100, 100);
    run.press("onPointerMove", 102, 100);
    run.press("onPointerUp", 102, 100);
    click(run);

    expect(run.now.zoomed).toBe(false);
  });

  it("a cancelled or lost pointer swallows the next click, as a drag does", () => {
    for (const name of ["onPointerCancel", "onLostPointerCapture"] as const) {
      const run = open();
      click(run);
      run.press("onPointerDown", 100, 100);
      run.press(name, 100, 100);
      expect(run.now.dragging).toBe(false);
      click(run);
      expect(run.now.zoomed).toBe(true);
      click(run);
      expect(run.now.zoomed).toBe(false);
    }
  });

  it("the lost-capture that follows a pointer release is not a second end: a press that never moved still clicks", () => {
    const run = open();
    click(run);
    run.press("onPointerDown", 100, 100);
    run.press("onPointerUp", 100, 100);
    run.press("onLostPointerCapture", 100, 100); // the browser's own, after releasePointerCapture
    click(run);

    expect(run.now.zoomed).toBe(false);
  });

  it("only the primary button of the primary pointer, and only its own pointer id, drags", () => {
    const run = open();
    click(run);
    run.press("onPointerDown", 100, 100, { button: 2 });
    expect(run.now.dragging).toBe(false);
    run.press("onPointerDown", 100, 100, { isPrimary: false });
    expect(run.now.dragging).toBe(false);

    run.press("onPointerDown", 100, 100);
    run.press("onPointerMove", 50, 100, { pointerId: 2 });
    expect(at(run.now.offset)).toEqual({ x: 0, y: 0 });
    run.press("onPointerUp", 50, 100, { pointerId: 2 });
    expect(run.now.dragging).toBe(true);
  });
});

describe("the wheel — an option, off by default", () => {
  it("is not listened for unless asked: the page's wheel is untouched", () => {
    expect(open().surface.count("wheel")).toBe(0);
    expect(open({ wheel: false }).surface.count("wheel")).toBe(0);
  });

  it("is a native listener on the surface, NOT passive (React's root wheel listener is, and could not preventDefault)", () => {
    const run = open({ wheel: true });

    expect(run.surface.count("wheel")).toBe(1);
    expect(run.surface.listeners.wheel[0].options).toEqual({ passive: false });
  });

  it("stops listening when the surface goes or the hook unmounts", () => {
    const gone = open({ wheel: true });
    gone.act(() => gone.now.surfaceRef(null));
    expect(gone.surface.count("wheel")).toBe(0);
    expect(gone.surface.count("keydown")).toBe(0);

    const unmounted = open({ wheel: true });
    unmounted.unmount();
    expect(unmounted.surface.count("wheel")).toBe(0);
  });

  it("zooms in on scroll-up and out on scroll-down, and always takes the event (no page scroll, no page zoom)", () => {
    const run = open({ wheel: true });

    const first = run.wheel(-100);
    expect(first).toHaveBeenCalledTimes(1);
    expect(run.now.scale).toBeCloseTo(Math.exp(0.15), 9);
    const second = run.wheel(100);
    expect(second).toHaveBeenCalledTimes(1);
    expect(run.now.scale).toBeCloseTo(1, 9);
  });

  it("Ctrl / Cmd + wheel (and a trackpad pinch, which arrives as one) zooms the same and is taken too", () => {
    const run = open({ wheel: true });

    const pinch = run.wheel(-100, CENTRE.x, CENTRE.y, { ctrlKey: true });
    expect(pinch).toHaveBeenCalledTimes(1);
    expect(run.now.scale).toBeCloseTo(Math.exp(0.15), 9);
    const command = run.wheel(-100, CENTRE.x, CENTRE.y, { metaKey: true });
    expect(command).toHaveBeenCalledTimes(1);
    expect(run.now.scale).toBeCloseTo(Math.exp(0.3), 9);
  });

  it("zooms at the pointer: the picture point under it stays under it", () => {
    const run = open({ wheel: true });
    const pointer = { x: CENTRE.x + 60, y: CENTRE.y + 30 };
    // The point under the pointer, from the picture's centre, in the picture's own pixels.
    const under = () => ({ x: (pointer.x - CENTRE.x - run.now.offset.x) / run.now.scale, y: (pointer.y - CENTRE.y - run.now.offset.y) / run.now.scale });
    const before = under();

    run.wheel(-500, pointer.x, pointer.y);

    expect(run.now.scale).toBeCloseTo(Math.exp(0.75), 9);
    expect(run.now.offset.x).toBeLessThan(0);
    expect(run.now.offset.y).toBeLessThan(0);
    expect(under().x).toBeCloseTo(before.x, 9);
    expect(under().y).toBeCloseTo(before.y, 9);

    // …and again from a zoomed, panned picture, on the other side of the centre, zooming out.
    const other = { x: CENTRE.x - 90, y: CENTRE.y - 20 };
    const point = () => ({ x: (other.x - CENTRE.x - run.now.offset.x) / run.now.scale, y: (other.y - CENTRE.y - run.now.offset.y) / run.now.scale });
    const then = point();
    run.wheel(150, other.x, other.y);
    expect(run.now.scale).toBeLessThan(Math.exp(0.75));
    expect(point().x).toBeCloseTo(then.x, 9);
    expect(point().y).toBeCloseTo(then.y, 9);
  });

  it("holds the zoom between fit and 6x — at both ends — and still takes the event there", () => {
    const run = open({ wheel: true });

    expect(run.wheel(300)).toHaveBeenCalledTimes(1);
    expect(run.now.scale).toBe(1);
    for (let i = 0; i < 12; i++) run.wheel(-300);
    expect(run.now.scale).toBe(6);
    expect(run.wheel(-300)).toHaveBeenCalledTimes(1);
    expect(run.now.scale).toBe(6);
    for (let i = 0; i < 12; i++) run.wheel(300);
    expect(run.now.scale).toBe(1);
    expect(at(run.now.offset)).toEqual({ x: 0, y: 0 });
  });

  it("several wheel events in one frame, before React has rendered, add up", () => {
    const run = open({ wheel: true });

    run.act(() => {
      run.surface.fire("wheel", { deltaY: -100, deltaMode: 0, clientX: CENTRE.x, clientY: CENTRE.y, ctrlKey: false, preventDefault: vi.fn() });
      run.surface.fire("wheel", { deltaY: -100, deltaMode: 0, clientX: CENTRE.x, clientY: CENTRE.y, ctrlKey: false, preventDefault: vi.fn() });
      run.surface.fire("wheel", { deltaY: -100, deltaMode: 0, clientX: CENTRE.x, clientY: CENTRE.y, ctrlKey: false, preventDefault: vi.fn() });
    });

    expect(run.now.scale).toBeCloseTo(Math.exp(0.45), 9);
  });

  it("the Summary's steps cap the wheel at 2x if it were turned on", () => {
    const run = open({ steps: SUMMARY_ZOOM_STEPS, wheel: true, keys: false });
    for (let i = 0; i < 6; i++) run.wheel(-300);

    expect(run.now.scale).toBe(2);
  });
});

describe("the keys — while the focus is on the surface", () => {
  it("+ and = zoom in a step, - zooms out a step, 0 fits; each is taken (preventDefault and stopPropagation)", () => {
    const run = open();
    const taken = (event: { preventDefault: ReturnType<typeof vi.fn>; stopPropagation: ReturnType<typeof vi.fn> }) => {
      expect(event.preventDefault).toHaveBeenCalledTimes(1);
      expect(event.stopPropagation).toHaveBeenCalledTimes(1);
    };

    taken(run.key("+"));
    expect(run.now.scale).toBe(1.5);
    taken(run.key("="));
    expect(run.now.scale).toBe(2);
    taken(run.key("+", { shiftKey: true }));
    expect(run.now.scale).toBe(3);
    taken(run.key("-"));
    expect(run.now.scale).toBe(2);
    taken(run.key("0"));
    expect(run.now.scale).toBe(1);
    expect(at(run.now.offset)).toEqual({ x: 0, y: 0 });
  });

  it("stops at 6x and at fit, and still takes the key there", () => {
    const run = open();
    for (let i = 0; i < 8; i++) run.key("+");
    expect(run.now.scale).toBe(6);
    expect(run.now.canZoomIn).toBe(false);
    const more = run.key("+");
    expect(more.preventDefault).toHaveBeenCalledTimes(1);
    expect(run.now.scale).toBe(6);

    run.key("0");
    const less = run.key("-");
    expect(less.preventDefault).toHaveBeenCalledTimes(1);
    expect(run.now.scale).toBe(1);
    expect(run.now.canZoomOut).toBe(false);
  });

  it("the arrows pan a zoomed picture the way a scroll would (Right shows more to the right: the picture goes left) and stop at the edges", () => {
    const run = open();
    run.key("="); // 1.5x
    run.key("="); // 2x: may pan 184 across, 106 down

    run.key("ArrowRight");
    expect(at(run.now.offset)).toEqual({ x: -48, y: 0 });
    run.key("ArrowDown");
    expect(at(run.now.offset)).toEqual({ x: -48, y: -48 });
    run.key("ArrowLeft");
    run.key("ArrowLeft");
    expect(at(run.now.offset)).toEqual({ x: 48, y: -48 });
    run.key("ArrowUp");
    expect(at(run.now.offset)).toEqual({ x: 48, y: 0 });
    for (let i = 0; i < 10; i++) run.key("ArrowRight");
    for (let i = 0; i < 10; i++) run.key("ArrowDown");
    expect(at(run.now.offset)).toEqual({ x: -184, y: -106 });
  });

  it("at fit the arrows move nothing and are still taken: a reader who focused the figure never leaves the paper by accident", () => {
    const run = open();

    for (const name of ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"]) {
      const event = run.key(name);
      expect(event.preventDefault).toHaveBeenCalledTimes(1);
      expect(event.stopPropagation).toHaveBeenCalledTimes(1);
    }
    expect(at(run.now.offset)).toEqual({ x: 0, y: 0 });
    expect(run.now.scale).toBe(1);
  });

  it("a key with Ctrl, Cmd or Alt is never taken — the reading scale's + and -, the browser's zoom, history — and moves nothing", () => {
    const run = open();
    run.key("="); // 1.5x, so the arrows have something to move

    for (const [key, modifier] of [["+", "ctrlKey"], ["=", "ctrlKey"], ["-", "ctrlKey"], ["0", "ctrlKey"], ["+", "metaKey"], ["-", "metaKey"], ["0", "metaKey"],
      ["ArrowRight", "ctrlKey"], ["ArrowLeft", "metaKey"], ["ArrowLeft", "altKey"], ["ArrowRight", "altKey"]] as const) {
      const event = run.key(key, { [modifier]: true });
      expect(event.preventDefault, `${modifier} ${key}`).not.toHaveBeenCalled();
      expect(event.stopPropagation, `${modifier} ${key}`).not.toHaveBeenCalled();
    }
    expect(run.now.scale).toBe(1.5);
    expect(at(run.now.offset)).toEqual({ x: 0, y: 0 });
  });

  it("every other key passes: j k s, Enter, Space, Tab, Escape", () => {
    const run = open();

    for (const key of ["j", "k", "s", "n", "h", "e", "Enter", " ", "Tab", "Escape", "Home", "PageDown", "1"]) {
      const event = run.key(key);
      expect(event.preventDefault, key).not.toHaveBeenCalled();
      expect(event.stopPropagation, key).not.toHaveBeenCalled();
    }
    expect(run.now.scale).toBe(1);
  });

  it("with keys turned off nothing is listened for (the lightbox's capture handler keeps every key)", () => {
    expect(open({ keys: false }).surface.count("keydown")).toBe(0);
    expect(open().surface.count("keydown")).toBe(1);
  });
});

describe("the buttons: zoomIn, zoomOut, reset, toggle", () => {
  it("step through the card's steps about the box's centre, and say when an end is reached", () => {
    const run = open();
    const seen: number[] = [];
    for (let i = 0; i < 6; i++) {
      run.act(() => run.now.zoomIn());
      seen.push(run.now.scale);
    }
    expect(seen).toEqual([1.5, 2, 3, 4, 6, 6]);
    expect(run.now.canZoomIn).toBe(false);
    expect(run.now.canZoomOut).toBe(true);

    for (let i = 0; i < 6; i++) run.act(() => run.now.zoomOut());
    expect(run.now.scale).toBe(1);
    expect(run.now.canZoomOut).toBe(false);
    expect(run.now.canZoomIn).toBe(true);
  });

  it("zooming in keeps the box's centre point still: a panned picture's pan scales with the zoom", () => {
    const run = open();
    run.act(() => run.now.zoomIn());
    run.act(() => run.now.zoomIn()); // 2x
    run.press("onPointerDown", 100, 100);
    run.press("onPointerMove", 0, 50); // pan (-100, -50)
    run.press("onPointerUp", 0, 50);
    run.act(() => run.now.zoomIn()); // 3x: the pan x1.5

    expect(run.now.scale).toBe(3);
    expect(at(run.now.offset)).toEqual({ x: -150, y: -75 });
    run.act(() => run.now.zoomOut()); // 2x again
    expect(run.now.scale).toBe(2);
    expect(run.now.offset.x).toBeCloseTo(-100, 9);
    expect(run.now.offset.y).toBeCloseTo(-50, 9);
  });

  it("reset fits, centred; toggle goes from any zoom to fit, and from fit to 2x — the Summary's click, whatever the steps", () => {
    const run = open();
    run.act(() => run.now.zoomIn());
    run.act(() => run.now.zoomIn());
    run.act(() => run.now.zoomIn()); // 3x
    run.act(() => run.now.toggle());
    expect(run.now.scale).toBe(1);

    run.act(() => run.now.toggle());
    expect(run.now.scale).toBe(2);

    run.act(() => run.now.zoomIn());
    run.act(() => run.now.reset());
    expect(run.now.scale).toBe(1);
    expect(at(run.now.offset)).toEqual({ x: 0, y: 0 });
  });
});

describe("the pan is clamped at every size change", () => {
  it("a smaller box draws a panned picture inside its new edges; the box growing back gives the pan back (the view asked for is not rewritten)", () => {
    const run = open();
    click(run);
    run.press("onPointerDown", 100, 100);
    run.press("onPointerMove", -900, -900);
    run.press("onPointerUp", -900, -900);
    expect(at(run.now.offset)).toEqual({ x: -184, y: -106 });

    // A 300 x 200 box refits the picture to 288 x 192; at 2x it may be panned 138 across and 92 down.
    run.input.viewport = { width: 300, height: 200 };
    run.render();
    expect(run.now.size).toEqual({ width: 288, height: 192 });
    expect(at(run.now.offset)).toEqual({ x: -138, y: -92 });

    run.input.viewport = BOX;
    run.render();
    expect(at(run.now.offset)).toEqual({ x: -184, y: -106 });
  });

  it("a pan after the resize starts from the pan that is drawn, not from the one that was asked for", () => {
    const run = open();
    click(run);
    run.press("onPointerDown", 100, 100);
    run.press("onPointerMove", -900, -900);
    run.press("onPointerUp", -900, -900);
    run.input.viewport = { width: 300, height: 200 };
    run.render();

    run.key("ArrowLeft"); // +48 from the drawn -138
    expect(at(run.now.offset)).toEqual({ x: -90, y: -92 });
  });

  it("an axis the new box holds whole is centred; the other keeps its pan", () => {
    const run = open();
    click(run);
    run.press("onPointerDown", 100, 100);
    run.press("onPointerMove", -900, -900);
    run.press("onPointerUp", -900, -900);
    // A 400 x 1000 box: the picture is still 384 x 256 (the width limits it), 768 x 512 at 2x — wider than the box, shorter than it.
    run.input.viewport = { width: 400, height: 1000 };
    run.render();

    expect(run.now.size).toEqual({ width: 384, height: 256 });
    expect(at(run.now.offset)).toEqual({ x: -184, y: 0 });
  });
});

// ── The Summary's lightbox: this hook, with the Summary's settings ─────────────────────────────────────────────────────────────────
// B P11-05 invariant 1: the lightbox is as it was. Its pixels are measured in a browser (the p02 script, before and after: identical);
// what a unit can pin is what it asks of the hook and what it does with the answer — the labels, the two states, the cursor, the
// style, the handlers on the button, and that nothing else is put on that button (no ref: no wheel, no keys).

type Tree = ReactElement<Record<string, unknown> & { children?: ReactNode }>;
function elements(node: ReactNode): Tree[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!node || typeof node !== "object" || !("props" in node)) return [];
  const element = node as Tree;
  return [element, ...elements(element.props.children)];
}

describe("the Summary's lightbox (FigureViewer) is the shared zoom core with the Summary's settings", () => {
  afterEach(() => vi.unstubAllGlobals());

  /** The viewer mounted with a 1000 x 800 overlay and a 40-px caption: a viewport of 968 x 656 for the picture. */
  function viewer() {
    const document = { activeElement: null, body: { style: { overflow: "" } }, addEventListener: vi.fn(), removeEventListener: vi.fn() };
    vi.stubGlobal("document", document);
    vi.stubGlobal("HTMLElement", class {}); // the cleanup asks `previousFocus instanceof HTMLElement`
    // The observer reports the overlay's size the moment it is asked to watch it.
    vi.stubGlobal("ResizeObserver", class { callback: () => void; constructor(callback: () => void) { this.callback = callback; } observe() { this.callback(); } disconnect() {} });
    const overlay = { clientWidth: 1000, clientHeight: 800, querySelectorAll: () => [] };
    const caption = { getBoundingClientRect: () => ({ height: 40 }) };
    const close = { focus: () => {} };
    const attach = (tree: ReactNode) => {
      const all = elements(tree);
      const give = (el: Tree | undefined, value: unknown) => {
        const ref = el?.props.ref as { current: unknown } | undefined;
        if (ref) ref.current = value;
      };
      give(all.find((el) => el.type === "div" && el.props.role === "dialog"), overlay);
      give(all.find((el) => el.type === "figcaption"), caption);
      give(all.find((el) => el.type === "button" && el.props["aria-label"] === "Close figure"), close);
    };
    const onClose = vi.fn(); // one function for every render: the keydown effect depends on it
    const mounted = stagedRuntime.mount(
      () => FigureViewer({ src: "https://example.com/figure.png", alt: "Figure 1", caption: "A caption", natural: NATURAL, onClose }),
      attach,
    );
    stagedRuntime.flush(); // the first commit's effects: the observer reports the frame
    stagedRuntime.rerender(); // …and the picture is drawn
    stagedRuntime.flush();
    const button = () => elements(mounted.value).find((el) => el.type === "button" && el.props["aria-pressed"] !== undefined) as Tree;
    const fire = (name: string, x: number, y: number, extra: Record<string, unknown> = {}) => {
      const surface = { setPointerCapture: () => {}, releasePointerCapture: () => {}, hasPointerCapture: () => true, focus: () => {} };
      const event = { type: name.toLowerCase().replace(/^on/, ""), clientX: x, clientY: y, pointerId: 1, button: 0, isPrimary: true, currentTarget: surface, preventDefault: () => {}, ...extra };
      stagedRuntime.event(() => (button().props[name] as (event: unknown) => void)(event));
    };
    return { button, fire, document };
  }

  const fitted = clampFigureSize(NATURAL, { width: 968, height: 656 });

  it("draws the picture on a button at fit: the Zoom-in label, not pressed, the zoom-in cursor, the style the lightbox always had", () => {
    const { button } = viewer();

    expect(button().props["aria-label"]).toBe("Zoom in on figure");
    expect(button().props["aria-pressed"]).toBe(false);
    expect(button().props.title).toBe("Click to zoom in");
    expect(String(button().props.className)).toContain("cursor-zoom-in");
    expect(button().props.style).toEqual({ width: fitted.width, height: fitted.height, transform: "translate(0px, 0px) scale(1)" });
  });

  it("a click goes to 2x and back: the labels flip, pressed follows, the cursor is grab", () => {
    const { button } = viewer();

    stagedRuntime.event(() => (button().props.onClick as () => void)());
    expect(button().props["aria-label"]).toBe("Fit figure to screen");
    expect(button().props["aria-pressed"]).toBe(true);
    expect(button().props.title).toBe("Drag to pan; click to fit to screen");
    expect(String(button().props.className)).toMatch(/cursor-grab$/);
    expect((button().props.style as { transform: string }).transform).toBe("translate(0px, 0px) scale(2)");

    stagedRuntime.event(() => (button().props.onClick as () => void)());
    expect(button().props["aria-label"]).toBe("Zoom in on figure");
    expect((button().props.style as { transform: string }).transform).toBe("translate(0px, 0px) scale(1)");
  });

  it("a drag pans the 2x picture (cursor grabbing while it lasts) and its release does not fit it", () => {
    const { button, fire } = viewer();
    stagedRuntime.event(() => (button().props.onClick as () => void)());

    fire("onPointerDown", 500, 400);
    expect(String(button().props.className)).toContain("cursor-grabbing");
    fire("onPointerMove", 380, 360); // (-120, -40), the measured drag
    expect((button().props.style as { transform: string }).transform).toBe("translate(-120px, -40px) scale(2)");
    fire("onPointerUp", 380, 360);
    expect(String(button().props.className)).toMatch(/cursor-grab$/);
    stagedRuntime.event(() => (button().props.onClick as () => void)()); // the click that ends the drag
    expect(button().props["aria-pressed"]).toBe(true);
  });

  it("puts the shared handlers on the button and nothing else: no ref, so no wheel and no key listener of the core is ever attached", () => {
    const { button } = viewer();

    for (const name of ["onClick", "onPointerDown", "onPointerMove", "onPointerUp", "onPointerCancel", "onLostPointerCapture"]) {
      expect(typeof button().props[name], name).toBe("function");
    }
    expect(button().props.ref).toBeUndefined();
    expect(button().props.onWheel).toBeUndefined();
    expect(button().props.onKeyDown).toBeUndefined();
  });

  it("asks the core for the Summary's settings, and keeps its own capture keydown effect literally (read from the source)", () => {
    const source = readFileSync(resolve(process.cwd(), "src/components/reader/figure-lightbox.tsx"), "utf8").replace(/\s+/g, " ");

    expect(source).toContain("export function FigureViewer(");
    expect(source).toContain("useFigureZoom({ natural, viewport, steps: SUMMARY_ZOOM_STEPS, wheel: false, keys: false })");
    expect(source).toContain('document.addEventListener("keydown", onKeyDown, true)');
    expect(source).toMatch(/event\.stopPropagation\(\); if \(event\.key === "Escape"\) \{ event\.preventDefault\(\); onClose\(\);/);
    expect(source).toContain("export { clampFigurePan, clampFigureSize, DETAIL_ZOOM };");
  });

  it("registers its Escape / Tab handler on the document in capture, as it did", () => {
    const { document } = viewer();

    expect(document.addEventListener).toHaveBeenCalledWith("keydown", expect.any(Function), true);
  });
});

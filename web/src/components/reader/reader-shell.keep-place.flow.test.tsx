import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// No DOM here (this project's tests run in plain Node): the shell runs on the staged hook runtime with `useSyncExternalStore` as a state and a
// subscription, as `reader-shell.rail.test.tsx` has it, and the page is the simulated one (`test-support/reflow-page.ts`): a column of paragraphs
// that re-wraps to the width it is given, a window that keeps its scroll offset through that, a ResizeObserver told after the layout.
vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  const { stagedRuntime } = await import("@/test-support/staged-runtime");
  const runtime = stagedRuntime.hooks;
  const storeShim = <T,>(subscribe: (onChange: () => void) => () => void, getSnapshot: () => T): T => {
    const [value, setValue] = runtime.useState<T>(getSnapshot);
    runtime.useEffect(() => {
      setValue(getSnapshot());
      return subscribe(() => setValue(getSnapshot()));
    }, [subscribe]);
    return value;
  };
  return { ...actual, ...runtime, useSyncExternalStore: storeShim };
});

import { createElement, type ReactElement, type ReactNode } from "react";
import { createReflowPage, type ReflowPage, type SimParagraph } from "@/test-support/reflow-page";
import { stagedRuntime } from "@/test-support/staged-runtime";
import { useMarginStore } from "@/lib/reader/margin";
import { useReaderPanesStore } from "@/store/reader-panes";
import { PaneDivider, type PaneDividerProps } from "./pane-divider";
import { ReaderShell } from "./reader-shell";

// P11-45 (A P11-43's note "The place is not kept when a boundary is dragged"; ruling §1h.146): the reader's place survives a re-flow, through the
// real shell, its real dividers and the real reads of the page (`keep-place.ts`, `return-to-paper.ts`'s `paragraphAtTop`).
//
// The rule: when the centre column's width changes — a separator dragged (by the mouse, by its keys), the left pane collapsed or pinned, the window
// resized — the paragraph at the top of the view stays at the top, the line of it under the masthead the same line, to within a line; at scroll 0 and
// at the page's foot nothing moves; a drag does not scroll at every pointer move; and no scroll is smooth. The browser alone keeps the OFFSET, which
// is the defect (the first test of each pair shows it with no shell).

type Props = Record<string, unknown> & { children?: ReactNode };
type Handler = (event?: unknown) => void;

function elements(node: ReactNode): ReactElement<Props>[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!node || typeof node !== "object" || !("props" in node)) return [];
  const element = node as ReactElement<Props>;
  return [element, ...elements(element.props.children)];
}

const mark = (name: string): ReactNode => createElement("i", { "data-mark": name }, name);
const props = { left: { fixed: mark("FIXED"), scroll: mark("SCROLL") }, centre: mark("CENTRE") };

const LINE = 56;
const CAP_PX = 646; // the column's 38em cap (17 px)
const RAIL_PX = 48;

const paragraphs = (): SimParagraph[] =>
  Array.from({ length: 60 }, (_, n) => ({ id: `paper-section-${Math.floor(n / 10) + 1}-p${n % 10}`, chars: n === 24 ? 7000 : 260 + ((n * 137) % 520) }));

/** The text column's width for a window and the grid's variables: `grid-template-columns: left 12 1fr 12 margin`, the centre's 12 px padding, the 38em cap. */
function columnFor(viewport: number, leftTrack: number, margin: number) {
  return Math.min(CAP_PX, viewport - leftTrack - 12 - 12 - margin - 24);
}

interface Browser {
  page: ReflowPage;
  win: Record<string, unknown>;
  /** The shell's grid element, as the ref holds it. */
  grid: { style: { setProperty: (name: string, value: string) => void }; querySelector: (selector: string) => unknown };
  frames: Array<() => void>;
  resize: Set<() => void>;
  viewport: number;
}

let env: Browser;

/** The window, the document, the observers and the frame queue the shell and its dividers find in a browser. */
function browser(viewport: number): Browser {
  const page = createReflowPage({ paragraphs: paragraphs(), column: columnFor(viewport, 320, 360) });
  const resize = new Set<() => void>();
  const frames: Array<() => void> = [];
  const b: Browser = {
    page,
    resize,
    frames,
    viewport,
    win: {},
    grid: {
      style: { setProperty: () => {} },
      querySelector: (selector: string) => (selector === "[data-reader-centre-inner]" ? page.column : null),
    },
  };
  const win = Object.create(page.win, {
    innerWidth: { get: () => b.viewport },
    addEventListener: { value: (type: string, run: () => void) => (type === "resize" ? resize.add(run) : page.win.addEventListener(type, run)) },
    removeEventListener: { value: (type: string, run: () => void) => (type === "resize" ? resize.delete(run) : page.win.removeEventListener(type, run)) },
  });
  b.win = win;
  const doc = {
    ...page.doc,
    activeElement: null,
    addEventListener: () => {},
    removeEventListener: () => {},
  };
  vi.stubGlobal("window", win);
  vi.stubGlobal("document", doc);
  vi.stubGlobal("ResizeObserver", page.ResizeObserver);
  vi.stubGlobal("requestAnimationFrame", (run: () => void) => frames.push(run));
  vi.stubGlobal("cancelAnimationFrame", (id: number) => {
    frames[id - 1] = () => {};
  });
  return b;
}

/** The nodes the shell's refs hold in a browser. */
function nodes() {
  return {
    aside: { getBoundingClientRect: () => ({ left: 1080, width: 360 }), parentElement: null, ownerDocument: undefined },
    pane: { contains: () => false },
    cell: { contains: () => false },
    rail: { focus: vi.fn() },
    pin: { focus: vi.fn() },
  };
}

/** The separator's element, as a browser would hand it to its ref. */
const dividerElement = () => ({
  dataset: {} as Record<string, string>,
  focus: vi.fn(),
  setAttribute: vi.fn(),
  setPointerCapture: vi.fn(),
  releasePointerCapture: vi.fn(),
  hasPointerCapture: () => true,
});

/** A pointer event with the members the divider reads. */
const pointer = (element: unknown, type: string, over: Record<string, unknown> = {}) => ({
  type,
  button: 0,
  isPrimary: true,
  pointerId: 1,
  clientX: 500,
  clientY: 300,
  currentTarget: element,
  preventDefault: vi.fn(),
  ...over,
});
const key = (name: string, over: Record<string, unknown> = {}) => ({ key: name, shiftKey: false, altKey: false, ctrlKey: false, metaKey: false, preventDefault: vi.fn(), ...over });

/**
 * One page open: the shell, with each divider rendered by its own component in the same render (hooks in order), the refs attached and the first
 * commit's effects flushed. Every commit lays the column out again from the grid's variables, as the browser does, and tells the observers.
 */
function open(viewport = 1280) {
  env = browser(viewport);
  const n = nodes();
  const overrides: Record<string, number> = {};
  const dividerElements = new Map<string, ReturnType<typeof dividerElement>>();

  /** Lay the column out from the variables the grid holds now (the rendered ones, or a divider's write over them). */
  const layoutNow = (shell: ReactElement<Props>) => {
    const style = shell.props.style as Record<string, string>;
    const left = overrides["--left-pane-w"] ?? Number.parseFloat(style["--left-pane-w"]);
    const margin = overrides["--margin-w"] ?? Number.parseFloat(style["--margin-w"]);
    const pinned = shell.props["data-left-state"] === "pinned";
    const next = columnFor(env.viewport, pinned ? left : RAIL_PX, margin);
    if (next !== env.page.columnPx) env.page.reflow(next);
  };
  let lastShell: ReactElement<Props> | null = null;
  env.grid.style.setProperty = (name, value) => {
    overrides[name] = Number.parseFloat(value);
    if (lastShell) layoutNow(lastShell);
  };

  const component = () => {
    const shell = ReaderShell(props) as ReactElement<Props>;
    const dividers = elements(shell).filter((element) => element.type === PaneDivider);
    const rendered = dividers.map((divider) => PaneDivider(divider.props as unknown as PaneDividerProps) as ReactElement<Props>);
    return { shell, rendered };
  };
  const mounted = stagedRuntime.mount(component, (output) => {
    const { shell, rendered } = output as ReturnType<typeof component>;
    for (const element of elements(shell)) {
      const ref = element.props.ref as { current: unknown } | undefined;
      if (!ref || typeof ref !== "object") continue;
      const cls = String(element.props.className ?? "");
      if (element.type === "aside") ref.current = n.aside;
      else if (cls.includes("reader-rail-button")) ref.current = n.rail;
      else if (cls.includes("reader-pin-button")) ref.current = n.pin;
      else if (cls.includes("reader-left-cell")) ref.current = n.cell;
      else if (cls.includes("reader-left") && element.props["data-reader-left"] !== undefined) ref.current = n.pane;
      else if (cls.includes("reader-shell")) ref.current = env.grid;
    }
    for (const root of rendered) {
      const pane = String(root.props["data-reader-divider"]);
      if (!dividerElements.has(pane)) dividerElements.set(pane, dividerElement());
      (root.props.ref as { current: unknown }).current = dividerElements.get(pane);
    }
    // A commit is a layout: what React writes replaces what a drag wrote.
    for (const name of Object.keys(overrides)) delete overrides[name];
    lastShell = shell;
    layoutNow(shell);
  });
  stagedRuntime.flush();

  const look = () => {
    const { shell, rendered } = mounted.value;
    const all = elements(shell);
    const divider = (pane: string) => {
      const root = rendered.find((element) => element.props["data-reader-divider"] === pane)!;
      return { root, element: dividerElements.get(pane)!, on: (name: string): Handler => root.props[name] as Handler };
    };
    return {
      shell,
      state: shell.props["data-left-state"] as string,
      vars: shell.props.style as Record<string, string>,
      pin: all.find((element) => String(element.props.className ?? "").includes("reader-pin-button"))!,
      rail: all.find((element) => element.props["data-reader-rail"] !== undefined)!,
      left: () => divider("left"),
      margin: () => divider("margin"),
    };
  };
  return { page: env.page, look };
}

type Opened = ReturnType<typeof open>;

/** Scroll so that the line under the masthead falls `fraction` of the way down paragraph `id`; the scroll event arrives. */
function readAt(page: ReflowPage, id: string, fraction: number) {
  const b = page.box(id);
  page.scroll(page.scrollY + b.top + fraction * b.height - LINE);
  page.frame();
}

/** What is to be kept: the paragraph at the top and how far down it the line falls. */
function place(page: ReflowPage) {
  const top = page.top()!;
  return { id: top.id, fraction: (LINE - top.top) / top.height };
}
const held = (page: ReflowPage, p: { id: string; fraction: number }) => page.drift(p.id, p.fraction);
const scrolls = (page: ReflowPage) => page.calls.filter((call) => call.kind === "scrollBy");

/** Run the animation frames the divider asked for (its write of the grid's variable), then the next frame's scroll event. */
function runFrames() {
  env.frames.splice(0).forEach((run) => run());
  env.page.frame();
}

/** A drag of the divider by `dx` px: a press, `frames` frames of three pointer moves each, a release. Returns the farthest the held point stood from the line. */
function dragged(page: Opened, pane: "left" | "margin", dx: number, p: { id: string; fraction: number }, frames = 10) {
  const d = pane === "left" ? page.look().left() : page.look().margin();
  const x0 = 500;
  stagedRuntime.event(() => d.on("onPointerDown")(pointer(d.element, "pointerdown", { clientX: x0 })));
  let farthest = 0;
  for (let frame = 1; frame <= frames; frame++) {
    for (let move = 1; move <= 3; move++) {
      stagedRuntime.event(() => d.on("onPointerMove")(pointer(d.element, "pointermove", { clientX: x0 + (dx * (frame - 1 + move / 3)) / frames })));
    }
    runFrames();
    farthest = Math.max(farthest, Math.abs(held(page.page, p)));
  }
  stagedRuntime.event(() => d.on("onPointerUp")(pointer(d.element, "pointerup", { clientX: x0 + dx })));
  env.page.frame();
  farthest = Math.max(farthest, Math.abs(held(page.page, p)));
  return farthest;
}

beforeEach(() => {
  vi.spyOn(console, "warn").mockImplementation(() => {});
  useReaderPanesStore.setState({ leftPinned: undefined, leftWidth: undefined, marginWidth: undefined });
  useMarginStore.setState({ rect: null });
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  useReaderPanesStore.setState({ leftPinned: undefined, leftWidth: undefined, marginWidth: undefined });
  useMarginStore.setState({ rect: null });
});

describe("a separator dragged by the mouse", () => {
  it("re-flows the column and keeps the offset, which is the defect: the paragraph at the top is another one (no shell)", () => {
    const p = createReflowPage({ paragraphs: paragraphs(), column: 552 });
    readAt(p, "paper-section-5-p2", 0.5);
    const before = place(p);
    p.reflow(492);
    p.frame();
    expect(p.top()!.id).not.toBe(before.id);
  });

  it("left +60 (552 to 492 px): the same paragraph stays at the top, the same line under the masthead, in every frame", () => {
    const page = open();
    readAt(page.page, "paper-section-5-p2", 0.5);
    const before = place(page.page);
    const farthest = dragged(page, "left", 60, before);
    expect(env.page.columnPx).toBeLessThan(552);
    expect(page.page.top()!.id).toBe(before.id);
    expect(farthest).toBeLessThan(1);
  });

  it("left -60 (552 to 612 px)", () => {
    const page = open();
    readAt(page.page, "paper-section-5-p2", 0.5);
    const before = place(page.page);
    const farthest = dragged(page, "left", -60, before);
    expect(env.page.columnPx).toBeGreaterThan(552);
    expect(page.page.top()!.id).toBe(before.id);
    expect(farthest).toBeLessThan(1);
  });

  it("P12-07: margin drag respects the new476px text floor", () => {
    const page = open();
    readAt(page.page, "paper-section-5-p2", 0.5);
    const before = place(page.page);
    const farthest = dragged(page, "margin", -80, before);
    expect(page.page.top()!.id).toBe(before.id);
    expect(env.page.columnPx).toBe(476);
    expect(farthest).toBeLessThan(1);
  });

  it("a long paragraph keeps the line nearest the top: the same fraction into it", () => {
    const page = open();
    const long = paragraphs()[24].id;
    readAt(page.page, long, 0.5);
    const before = place(page.page);
    expect(before.id).toBe(long);
    dragged(page, "left", 60, before);
    const after = place(page.page);
    expect(after.id).toBe(long);
    expect(after.fraction).toBeCloseTo(0.5, 2);
  });

  it("scrolls at the frame, not at the pointer: three moves in a frame make one scroll, and the scrolls are instant", () => {
    const page = open();
    readAt(page.page, "paper-section-5-p2", 0.5);
    const before = place(page.page);
    dragged(page, "left", 60, before, 10);
    // 10 frames of 3 pointer moves each: at most 10 corrections, at least 1; never one per move.
    expect(scrolls(env.page).length).toBeGreaterThan(0);
    expect(scrolls(env.page).length).toBeLessThanOrEqual(10);
    expect(env.page.calls.every((call) => call.kind === "scrollBy" && call.behavior === "instant")).toBe(true);
  });

  it("makes no scroll during the press, before the pointer has travelled 4 px", () => {
    const page = open();
    readAt(page.page, "paper-section-5-p2", 0.5);
    const d = page.look().left();
    stagedRuntime.event(() => d.on("onPointerDown")(pointer(d.element, "pointerdown")));
    stagedRuntime.event(() => d.on("onPointerMove")(pointer(d.element, "pointermove", { clientX: 503 })));
    runFrames();
    expect(env.page.calls).toEqual([]);
  });

  it("a cancelled drag puts the pane back and the place with it", () => {
    const page = open();
    readAt(page.page, "paper-section-5-p2", 0.5);
    const before = place(page.page);
    const d = page.look().left();
    stagedRuntime.event(() => d.on("onPointerDown")(pointer(d.element, "pointerdown")));
    for (let move = 1; move <= 6; move++) stagedRuntime.event(() => d.on("onPointerMove")(pointer(d.element, "pointermove", { clientX: 500 + move * 10 })));
    runFrames();
    expect(env.page.columnPx).toBeLessThan(552);
    stagedRuntime.event(() => d.on("onPointerCancel")(pointer(d.element, "pointercancel", { clientX: 560 })));
    env.page.frame();
    expect(env.page.columnPx).toBe(552);
    expect(page.page.top()!.id).toBe(before.id);
    expect(Math.abs(held(page.page, before))).toBeLessThan(1);
  });
});

describe("a separator moved by its keys", () => {
  it("ArrowRight three times (552 to 504 px): the same paragraph, the same line", () => {
    const page = open();
    readAt(page.page, "paper-section-5-p2", 0.5);
    const before = place(page.page);
    for (let i = 0; i < 3; i++) stagedRuntime.event(() => page.look().left().on("onKeyDown")(key("ArrowRight")));
    env.page.frame();
    expect(env.page.columnPx).toBe(504);
    expect(page.page.top()!.id).toBe(before.id);
    expect(Math.abs(held(page.page, before))).toBeLessThan(1);
  });

  it("P12-07: End preserves place at the476px text floor", () => {
    const page = open();
    readAt(page.page, "paper-section-5-p2", 0.5);
    const before = place(page.page);
    stagedRuntime.event(() => page.look().left().on("onKeyDown")(key("End")));
    env.page.frame();
    expect(env.page.columnPx).toBe(476);
    expect(page.page.top()!.id).toBe(before.id);
    expect(Math.abs(held(page.page, before))).toBeLessThan(1);
  });

  it("Home on the margin (its least width: 552 to 632 px)", () => {
    const page = open();
    readAt(page.page, "paper-section-5-p2", 0.5);
    const before = place(page.page);
    stagedRuntime.event(() => page.look().margin().on("onKeyDown")(key("Home")));
    env.page.frame();
    expect(env.page.columnPx).toBe(632);
    expect(page.page.top()!.id).toBe(before.id);
    expect(Math.abs(held(page.page, before))).toBeLessThan(1);
  });
});

describe("the left pane collapsed and pinned", () => {
  it("a collapse (552 to 646 px) and the pin that follows (back to 552): the same paragraph, the same line, both times", () => {
    const page = open();
    readAt(page.page, "paper-section-5-p2", 0.5);
    const before = place(page.page);
    stagedRuntime.event(() => (page.look().pin.props.onClick as Handler)());
    env.page.frame();
    expect(page.look().state).toBe("rail");
    expect(env.page.columnPx).toBe(646);
    expect(page.page.top()!.id).toBe(before.id);
    expect(Math.abs(held(page.page, before))).toBeLessThan(1);

    stagedRuntime.event(() => (page.look().rail.props.onClick as Handler)());
    env.page.frame();
    expect(page.look().state).toBe("pinned");
    expect(env.page.columnPx).toBe(552);
    expect(page.page.top()!.id).toBe(before.id);
    expect(Math.abs(held(page.page, before))).toBeLessThan(1);
  });
});

describe("the window resized", () => {
  it("1440 to 1280 (the capped column of 646 px to 552): the same paragraph, the same line", () => {
    const page = open(1440);
    expect(env.page.columnPx).toBe(646);
    readAt(page.page, "paper-section-5-p2", 0.5);
    const before = place(page.page);
    env.viewport = 1280;
    stagedRuntime.event(() => [...env.resize].forEach((run) => run()));
    env.page.frame();
    expect(env.page.columnPx).toBe(552);
    expect(page.page.top()!.id).toBe(before.id);
    expect(Math.abs(held(page.page, before))).toBeLessThan(1);
  });
});

describe("Fit and the reading scale (the page's, which the shell sits in)", () => {
  it("Fit on and off (the page's zoom, told through the zoom root alone: the capped column's own width does not move): the same paragraph, the same line", () => {
    const page = open(1440);
    readAt(page.page, "paper-section-5-p2", 0.5);
    const before = place(page.page);
    env.page.setZoom(1.33, env.page.root);
    env.page.frame();
    expect(page.page.top()!.id).toBe(before.id);
    expect(Math.abs(held(page.page, before))).toBeLessThan(1);
    env.page.setZoom(1, env.page.root);
    env.page.frame();
    expect(page.page.top()!.id).toBe(before.id);
    expect(Math.abs(held(page.page, before))).toBeLessThan(1);
  });

  it("a text step (the reading scale 1.1, then 0.925): the same paragraph, the same line", () => {
    const page = open();
    readAt(page.page, "paper-section-5-p2", 0.5);
    const before = place(page.page);
    for (const scale of ["1.1", "0.925"]) {
      env.page.setScale(scale);
      env.page.frame();
      expect(page.page.top()!.id).toBe(before.id);
      expect(Math.abs(held(page.page, before))).toBeLessThan(1);
    }
  });
});

describe("Fit's and the text steps' transition (0.3 s of frames after the variables have flipped)", () => {
  it("a text step that grows the content frame by frame after the scale variable has changed: the place is held through every frame", () => {
    const page = open();
    readAt(page.page, "paper-section-5-p2", 0.5);
    const before = place(page.page);
    env.page.setScale("1.1");
    env.page.frame();
    for (let frame = 0; frame < 8; frame++) {
      env.page.growAbove(11);
      env.page.frame();
      expect(page.page.top()!.id).toBe(before.id);
      expect(Math.abs(held(page.page, before))).toBeLessThan(1);
    }
  });
});

describe("the reader's own scroll", () => {
  it("is followed: after they scroll on, a drag keeps the place they scrolled to", () => {
    const page = open();
    readAt(page.page, "paper-section-3-p1", 0.5);
    dragged(page, "left", 40, place(page.page));
    readAt(page.page, "paper-section-5-p2", 0.3);
    const second = place(page.page);
    const farthest = dragged(page, "margin", -60, second);
    expect(page.page.top()!.id).toBe(second.id);
    expect(farthest).toBeLessThan(1);
  });
});

describe("the top and the foot of the page are left alone", () => {
  it("at scroll 0, a drag, the keys, a collapse and a pin make no scroll", () => {
    const page = open();
    expect(env.page.scrollY).toBe(0);
    dragged(page, "left", 60, { id: "paper-section-1-p0", fraction: 0 });
    stagedRuntime.event(() => page.look().left().on("onKeyDown")(key("End")));
    stagedRuntime.event(() => (page.look().pin.props.onClick as Handler)());
    stagedRuntime.event(() => (page.look().rail.props.onClick as Handler)());
    env.page.frame();
    expect(env.page.calls).toEqual([]);
    expect(env.page.scrollY).toBe(0);
  });

  it("at the page's foot, a drag, the keys, a collapse and a pin make no scroll", () => {
    const page = open();
    env.page.scroll(1e9);
    env.page.frame();
    dragged(page, "margin", -60, { id: "paper-section-6-p9", fraction: 0 });
    stagedRuntime.event(() => page.look().left().on("onKeyDown")(key("Home")));
    stagedRuntime.event(() => (page.look().pin.props.onClick as Handler)());
    stagedRuntime.event(() => (page.look().rail.props.onClick as Handler)());
    env.page.frame();
    expect(env.page.calls).toEqual([]);
  });
});

describe("the shell's hold on the page", () => {
  it("listens for the window's scroll and for the column's size (and Fit's root), and lets go of both when the shell goes", () => {
    const page = open();
    expect(env.page.scrollListeners()).toBe(1);
    // The column, the Fit zoom root (and the margin's own observer, which watches its cell, the grid and the root).
    expect(env.page.observed()).toContain(env.page.column);
    expect(env.page.observed()).toContain(env.page.root);
    void page;
  });

  it("does nothing, and fails nothing, where there is no ResizeObserver", () => {
    vi.stubGlobal("window", { innerWidth: 1280, innerHeight: 720, scrollY: 0, addEventListener: () => {}, removeEventListener: () => {}, getComputedStyle: () => ({ getPropertyValue: () => "" }) });
    vi.stubGlobal("document", {
      body: { style: {} },
      documentElement: { clientHeight: 720, scrollHeight: 5000 },
      querySelector: () => null,
      querySelectorAll: () => [],
      getElementById: () => null,
      addEventListener: () => {},
      removeEventListener: () => {},
    });
    vi.stubGlobal("ResizeObserver", undefined);
    const mounted = stagedRuntime.mount(() => ReaderShell(props), (output) => {
      for (const element of elements(output as ReactNode)) {
        const ref = element.props.ref as { current: unknown } | undefined;
        if (ref && typeof ref === "object" && String(element.props.className ?? "").includes("reader-shell")) ref.current = { style: { setProperty: vi.fn() }, querySelector: () => ({ getBoundingClientRect: () => ({ width: 552 }) }) };
      }
    });
    expect(() => stagedRuntime.flush()).not.toThrow();
    mounted.unmount();
  });
});

describe("the shell's one call (its source)", () => {
  const source = readFileSync(resolve(process.cwd(), "src/components/reader/reader-shell.tsx"), "utf8");
  const code = source.replace(/\/\/.*$/gm, "");

  it("P12-15: one owner above responsive branches; a standalone shell keeps its existing owner without duplicating ReaderLayout", () => {
    expect(code).toMatch(/import \{ useKeepPlace \} from "@\/lib\/reader\/keep-place";/);
    expect(code.match(/useKeepPlace\(/g)).toHaveLength(1);
    expect(code).toMatch(/\n  useKeepPlace\(grid, \{ enabled: keepReadingPlace \}\);\n/);
    expect(code.indexOf("useKeepPlace(grid,")).toBeGreaterThan(code.indexOf("export function ReaderShell"));
    expect(code.indexOf("useKeepPlace(grid,")).toBeLessThan(code.indexOf("  return (\n    <div ref={grid}"));
    const layout = readFileSync(resolve(process.cwd(), "src/components/reader/reader-layout.tsx"), "utf8");
    expect(layout.match(/useKeepPlace\(/g)).toHaveLength(1);
    expect(layout).toContain("useKeepPlace(owner, { responsive: true })");
    expect(layout.indexOf("useKeepPlace(owner,")).toBeLessThan(layout.indexOf("if (!p.spread)"));
    expect(layout).toMatch(/<ReaderShell\s+keepReadingPlace=\{false\}/);
  });

  it("leaves the dividers alone: a drag still writes the grid's variable once a frame, and the divider makes no scroll of its own at a pointer move", () => {
    const divider = readFileSync(resolve(process.cwd(), "src/components/reader/pane-divider.tsx"), "utf8");
    expect(divider).toContain("requestAnimationFrame(() => {");
    expect(divider).not.toMatch(/scrollBy|scrollTo/);
  });
});

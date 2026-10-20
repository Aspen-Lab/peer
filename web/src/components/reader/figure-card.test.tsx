import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// P11-15 rule 1 (owner item 1; B P11-05 §2.1, §2.3, §3; ruling §1h.113 (c) D1-D4, D7, D8): the figure card — a Paper-digestion figure opened
// in the margin. `FigureCardView` has no state and no hook, so it is read as markup (react-dom/server) and as an element tree; `FigureCard`
// owns the zoom and measures the mat's box, and runs on the staged hook runtime (no DOM in this suite): the refs are attached by the test as
// React attaches them, the passive effects wait for the flush as they do in a browser. Every text is invented.
vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  const { stagedRuntime } = await import("@/test-support/staged-runtime");
  return { ...actual, ...stagedRuntime.hooks };
});

import type { ReactElement, ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { stagedRuntime } from "@/test-support/staged-runtime";
import type { FigureRef } from "@/lib/reader/figure-viewer";
import { clampFigureSize, FIGURE_ZOOM_STEPS } from "./figure-zoom";
import {
  FIGURE_CAPTION_SHARE,
  FIGURE_MAT_PAD_PX,
  FIGURE_WINDOW_ID,
  FIGURE_ZOOM_ROW_PX,
  FigureCard,
  FigureCardView,
  captionMaxHeight,
  figureViewport,
  type FigureCardProps,
  type FigureCardViewProps,
  type FigureCardZoom,
} from "./figure-card";
import { MarginCardShell } from "./margin-card";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");
const CARD = read("src/components/reader/figure-card.tsx");
/** The source with its comments stripped: the pins below read code, not prose. */
const code = (source: string) =>
  source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("//"))
    .join("\n");

type Props = Record<string, unknown> & { children?: ReactNode };
/** The element tree with the hook-free function components (the view, the shell, the header) expanded. */
function elements(node: ReactNode): ReactElement<Props>[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!node || typeof node !== "object" || !("props" in node)) return [];
  const element = node as ReactElement<Props>;
  if (typeof element.type === "function") return [element, ...elements((element.type as (p: Props) => ReactNode)(element.props))];
  return [element, ...elements(element.props.children)];
}
const withLabel = (tree: ReactNode, label: string) => elements(tree).find((el) => el.props["aria-label"] === label);
const withAttr = (tree: ReactNode, attr: string) => elements(tree).find((el) => el.props[attr] !== undefined);
const textOf = (node: ReactNode): string => {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join("");
  if (node && typeof node === "object" && "props" in node) return textOf((node as ReactElement<Props>).props.children);
  return "";
};

const CAPTION = "Terrace plots under shade cloth; the deeper layers hold more water than the straw does in every one of the four seasons.";
const FRAME = { left: 1000, width: 400 };

function zoomOf(over: Partial<FigureCardZoom> = {}): FigureCardZoom {
  return {
    scale: 1,
    zoomed: false,
    dragging: false,
    canZoomIn: true,
    canZoomOut: false,
    zoomIn: vi.fn(),
    zoomOut: vi.fn(),
    reset: vi.fn(),
    surface: {
      onClick: vi.fn(),
      onPointerDown: vi.fn(),
      onPointerMove: vi.fn(),
      onPointerUp: vi.fn(),
      onPointerCancel: vi.fn(),
      onLostPointerCapture: vi.fn(),
    },
    style: { width: 300, height: 200, transform: "translate(0px, 0px) scale(1)" },
    ...over,
  };
}

function view(over: Partial<FigureCardViewProps> = {}): FigureCardViewProps {
  return {
    label: "Figure 3",
    caption: CAPTION,
    src: "/api/figure/p1/3",
    front: true,
    top: 48,
    height: 812,
    z: 62,
    frame: FRAME,
    zoom: zoomOf(),
    onClose: vi.fn(),
    onRaise: vi.fn(),
    ...over,
  };
}

const markup = (over: Partial<FigureCardViewProps> = {}) => renderToStaticMarkup(<FigureCardView {...view(over)} />);
const tree = (over: Partial<FigureCardViewProps> = {}) => FigureCardView(view(over));

describe("the figure card, as the margin shows it", () => {
  it("is a card of the margin's stack of kind figure, in its frame, at the row the stack gives it", () => {
    const root = tree() as ReactElement<Props>;
    expect(root.type).toBe(MarginCardShell);
    expect(root.props).toMatchObject({ id: FIGURE_WINDOW_ID, kind: "figure", front: true, top: 48, height: 812, z: 62, frame: FRAME });
    const html = markup();
    expect(html).toContain('data-margin-card="figure"');
    expect(html).toContain('data-margin-id="figure"');
    expect(html).toContain("left:1000px;width:400px;top:48px;z-index:62;height:812px");
  });

  it("is a non-modal region named by its label: no aria-modal, no Tab trap", () => {
    const html = markup();
    expect(html).toContain('role="region"');
    expect(html).toContain('aria-label="Figure 3"');
    expect(html).not.toContain("aria-modal");
    expect(html).not.toContain('role="dialog"');
    // Tab is not trapped: no key handler on the card at all.
    expect(html).not.toContain("onKeyDown");
    expect(code(CARD)).not.toMatch(/aria-modal|onKeyDown|"Tab"/);
  });

  it("has a header 40 px tall: the label, the caption's head, and a 40 px accent X at the top right", () => {
    const html = markup();
    const header = html.slice(html.indexOf('<div class="flex h-10 shrink-0 items-stretch">'));
    expect(header).toContain('class="eyebrow shrink-0 text-heading">Figure 3<');
    expect(header).toContain(">Terrace plots under shade cloth");
    // The X follows the header's button in the row, so it stands at the right; it is a 40 px square in the accent.
    expect(header.indexOf("data-margin-header")).toBeLessThan(header.indexOf('aria-label="Close Figure 3"'));
    const close = header.slice(header.indexOf('<button type="button" aria-label="Close Figure 3"'));
    expect(close.slice(0, close.indexOf(">"))).toMatch(/class="[^"]*\bh-10 w-10\b[^"]*\bbg-accent\b/);
    expect(withLabel(tree(), "Close Figure 3")).toBeDefined();
  });

  it("shows only the head of a long caption in the header, and the whole of it below", () => {
    const long = `${CAPTION} ${CAPTION} ${CAPTION}`;
    const html = markup({ caption: long });
    const head = html.slice(html.indexOf("font-reading text-body-sm italic text-text-muted"), html.indexOf("Close Figure 3"));
    expect(head).toContain("…");
    expect(head.length).toBeLessThan(260);
    // The caption, whole.
    expect(textOf(withAttr(tree({ caption: long }), "data-figure-caption"))).toBe(long);
  });

  it("brings the card forward on a header press, and the X closes it and brings nothing forward", () => {
    const props = view();
    const root = FigureCardView(props) as ReactElement<Props>;
    const header = elements(root).find((el) => el.props["data-margin-header"] !== undefined)!;
    (header.props.onClick as () => void)();
    expect(props.onRaise).toHaveBeenCalledTimes(1);
    expect(props.onClose).not.toHaveBeenCalled();
    const stop = vi.fn();
    const close = elements(root).find((el) => el.props["aria-label"] === "Close Figure 3")!;
    (close.props.onClick as (event: { stopPropagation: () => void }) => void)({ stopPropagation: stop });
    expect(props.onClose).toHaveBeenCalledTimes(1);
    expect(props.onRaise).toHaveBeenCalledTimes(1);
    expect(stop).toHaveBeenCalledTimes(1);
  });
});

describe("the zoom row: minus, readout, plus, Fit (only while in front)", () => {
  it("is 36 px tall and reads the zoom as drawn, in whole percent", () => {
    const html = markup({ zoom: zoomOf({ scale: 1.5, zoomed: true, canZoomOut: true }) });
    expect(html).toContain("data-figure-zoom-row");
    expect(html).toContain(`height:${FIGURE_ZOOM_ROW_PX}px`);
    expect(textOf(withAttr(tree({ zoom: zoomOf({ scale: 1.5 }) }), "data-figure-readout"))).toBe("150 %");
    expect(textOf(withAttr(tree({ zoom: zoomOf({ scale: 6 }) }), "data-figure-readout"))).toBe("600 %");
    expect(textOf(withAttr(tree({ zoom: zoomOf({ scale: 1.1234 }) }), "data-figure-readout"))).toBe("112 %");
    expect(FIGURE_ZOOM_ROW_PX).toBe(36);
  });

  it("has minus, plus and Fit, which call the zoom core's own steps", () => {
    const zoom = zoomOf({ scale: 2, zoomed: true, canZoomOut: true });
    const root = tree({ zoom });
    (withLabel(root, "Zoom out")!.props.onClick as () => void)();
    (withLabel(root, "Zoom in")!.props.onClick as () => void)();
    const fit = elements(root).find((el) => el.props.title === "Fit the figure to the card")!;
    expect(textOf(fit)).toBe("Fit");
    (fit.props.onClick as () => void)();
    expect(zoom.zoomOut).toHaveBeenCalledTimes(1);
    expect(zoom.zoomIn).toHaveBeenCalledTimes(1);
    expect(zoom.reset).toHaveBeenCalledTimes(1);
  });

  it("marks the ends aria-disabled (the focus stays on the button): no minus at fit, no plus at 6x, no Fit at fit", () => {
    const atFit = tree({ zoom: zoomOf({ scale: 1, zoomed: false, canZoomIn: true, canZoomOut: false }) });
    expect(withLabel(atFit, "Zoom out")!.props["aria-disabled"]).toBe(true);
    expect(withLabel(atFit, "Zoom in")!.props["aria-disabled"]).toBe(false);
    expect(elements(atFit).find((el) => el.props.title === "Fit the figure to the card")!.props["aria-disabled"]).toBe(true);
    const atTop = tree({ zoom: zoomOf({ scale: 6, zoomed: true, canZoomIn: false, canZoomOut: true }) });
    expect(withLabel(atTop, "Zoom out")!.props["aria-disabled"]).toBe(false);
    expect(withLabel(atTop, "Zoom in")!.props["aria-disabled"]).toBe(true);
    expect(elements(atTop).find((el) => el.props.title === "Fit the figure to the card")!.props["aria-disabled"]).toBe(false);
    // Never the native attribute: a disabled button drops the focus.
    expect(markup()).not.toMatch(/ disabled=/);
  });

  it("goes from fit to 6x, the zoom core's range", () => {
    expect(FIGURE_ZOOM_STEPS[0]).toBe(1);
    expect(FIGURE_ZOOM_STEPS[FIGURE_ZOOM_STEPS.length - 1]).toBe(6);
  });
});

describe("the picture: the zoom core's surface on the plate mat", () => {
  it("is one button with the core's handlers and style, over the picture", () => {
    const zoom = zoomOf();
    const surface = withLabel(tree({ zoom }), "Zoom in on figure")!;
    expect(surface.type).toBe("button");
    for (const name of Object.keys(zoom.surface) as (keyof typeof zoom.surface)[]) expect(surface.props[name]).toBe(zoom.surface[name]);
    expect(surface.props.style).toBe(zoom.style);
    expect(surface.props["aria-pressed"]).toBe(false);
    expect(String(surface.props.className)).toMatch(/\bcursor-zoom-in\b/);
    expect(String(surface.props.className)).toMatch(/\btouch-none\b/);
    const html = markup();
    expect(html).toContain('src="/api/figure/p1/3"');
    expect(html).toContain('draggable="false"');
    expect(html).toContain("bg-[var(--plate-mat)]");
  });

  it("grabs when zoomed and while dragging, and offers to fit", () => {
    const zoomed = withLabel(tree({ zoom: zoomOf({ scale: 2, zoomed: true, canZoomOut: true }) }), "Fit figure to the card")!;
    expect(String(zoomed.props.className)).toMatch(/\bcursor-grab\b/);
    expect(zoomed.props["aria-pressed"]).toBe(true);
    const dragging = withLabel(tree({ zoom: zoomOf({ scale: 2, zoomed: true, dragging: true, canZoomOut: true }) }), "Fit figure to the card")!;
    expect(String(dragging.props.className)).toMatch(/\bcursor-grabbing\b/);
  });

  it("is fitted into the mat's box less its padding", () => {
    expect(FIGURE_MAT_PAD_PX).toBe(8);
    expect(figureViewport(null)).toEqual({ width: 0, height: 0 });
    expect(figureViewport({ width: 344, height: 500 })).toEqual({ width: 328, height: 484 });
    expect(figureViewport({ width: 10, height: 12 })).toEqual({ width: 0, height: 0 });
    expect(markup()).toContain("padding:8px");
  });
});

describe("the caption: whole, scrolling, at most 30 % of the card", () => {
  it("scrolls inside, is reached by Tab, and is never taller than 30 % of the card", () => {
    expect(FIGURE_CAPTION_SHARE).toBe(0.3);
    expect(captionMaxHeight(812)).toBe(243);
    expect(captionMaxHeight(592)).toBe(177);
    expect(captionMaxHeight(240)).toBe(72);
    expect(captionMaxHeight(0)).toBe(0);
    expect(captionMaxHeight(-5)).toBe(0);
    const caption = withAttr(tree({ height: 592 }), "data-figure-caption")!;
    expect(caption.props.tabIndex).toBe(0);
    expect((caption.props.style as { maxHeight: number }).maxHeight).toBe(177);
    expect(String(caption.props.className)).toMatch(/\boverflow-y-auto\b/);
    expect(String(caption.props.className)).toMatch(/\boverscroll-contain\b/);
    expect(textOf(caption)).toBe(CAPTION);
  });

  it("is in the reading face after the picture; none where the figure has no caption", () => {
    const html = markup();
    expect(html.indexOf("data-figure-box")).toBeLessThan(html.indexOf("data-figure-caption"));
    expect(html).toContain("font-reading");
    const bare = markup({ caption: "   " });
    expect(bare).not.toContain("data-figure-caption");
    // No headline in the header either.
    expect(bare).not.toContain("italic text-text-muted");
  });
});

describe("behind another card: its header alone", () => {
  it("draws no zoom row, no picture and no caption, and keeps the header and the X", () => {
    const html = markup({ front: false, height: 40 });
    expect(html).toContain('data-margin-card="figure"');
    expect(html).toContain("height:40px");
    expect(html).toContain("data-margin-header");
    expect(html).toContain('aria-label="Close Figure 3"');
    expect(html).not.toContain("data-figure-zoom-row");
    expect(html).not.toContain("data-figure-box");
    expect(html).not.toContain("<img");
    expect(html).not.toContain("data-figure-caption");
    expect(withLabel(tree({ front: false, height: 40 }), "Zoom in")).toBeUndefined();
  });
});

// ── The stateful card, on the staged runtime ──────────────────────────────

class Observer {
  static all: Observer[] = [];
  gone = false;
  constructor(public notify: () => void) {
    Observer.all.push(this);
  }
  observe() {}
  disconnect() {
    this.gone = true;
  }
}

type Listener = { fn: (event: never) => void; options: unknown };
class Surface {
  listeners: Record<string, Listener[]> = {};
  focused: unknown[] = [];
  addEventListener(type: string, fn: Listener["fn"], options?: unknown) {
    (this.listeners[type] ??= []).push({ fn, options });
  }
  removeEventListener(type: string, fn: Listener["fn"]) {
    this.listeners[type] = (this.listeners[type] ?? []).filter((one) => one.fn !== fn);
  }
  getBoundingClientRect() {
    return { left: 0, top: 0, width: 0, height: 0 };
  }
  focus(options?: unknown) {
    this.focused.push(options);
  }
  count(type: string) {
    return (this.listeners[type] ?? []).length;
  }
}

const REF = (over: Partial<FigureRef> = {}): FigureRef => ({
  key: "Figure 3:3",
  src: "/api/figure/p1/3",
  label: "Figure 3",
  caption: CAPTION,
  natural: { width: 600, height: 400 },
  origin: null,
  ...over,
});

interface Run {
  surface: Surface;
  box: { clientWidth: number; clientHeight: number };
  props: FigureCardProps;
  readonly view: FigureCardViewProps;
  act: (handler: () => void) => void;
  /** A new render with changed props, then whatever the layout effects asked for. */
  update: (over: Partial<FigureCardProps>) => void;
  unmount: () => void;
}

function settle() {
  // A layout effect's state update renders again before the paint; the staged runtime renders once per event, so ask for as many as it takes.
  for (let i = 0; i < 4; i += 1) stagedRuntime.event(() => {});
}

function mount(over: Partial<FigureCardProps> = {}): Run {
  const surface = new Surface();
  const box = { clientWidth: 344, clientHeight: 500 };
  const run = { boxOn: false, surfaceOn: false };
  const props: FigureCardProps = { figure: REF(), frame: FRAME, front: true, top: 48, height: 812, z: 62, onClose: vi.fn(), onRaise: vi.fn(), ...over };
  const state = { props };
  const mounted = stagedRuntime.mount(
    () => FigureCard(state.props),
    (output) => {
      // React calls a ref when its element comes onto the page and with null when it leaves.
      const element = output as ReactElement<FigureCardViewProps>;
      const shown = state.props.front;
      if (shown && !run.boxOn) {
        run.boxOn = true;
        (element.props.boxRef as (node: unknown) => void)(box);
      } else if (!shown && run.boxOn) {
        run.boxOn = false;
        (element.props.boxRef as (node: unknown) => void)(null);
      }
      if (shown && !run.surfaceOn) {
        run.surfaceOn = true;
        (element.props.surfaceRef as (node: unknown) => void)(surface);
      } else if (!shown && run.surfaceOn) {
        run.surfaceOn = false;
        (element.props.surfaceRef as (node: unknown) => void)(null);
      }
    },
  );
  settle();
  return {
    surface,
    box,
    get props() {
      return state.props;
    },
    get view() {
      return (mounted.value as ReactElement<FigureCardViewProps>).props;
    },
    act: (handler) => {
      stagedRuntime.event(handler);
      settle();
    },
    update: (next) => {
      state.props = { ...state.props, ...next };
      stagedRuntime.rerender();
      stagedRuntime.flush();
      settle();
    },
    unmount: () => mounted.unmount(),
  };
}

beforeEach(() => {
  Observer.all = [];
  vi.stubGlobal("ResizeObserver", Observer);
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("FigureCard: the zoom, the box and the focus", () => {
  it("fits the picture into the mat's measured box less its padding, and measures again when the box is resized", () => {
    const card = mount();
    const viewport = figureViewport({ width: 344, height: 500 });
    const fit = clampFigureSize({ width: 600, height: 400 }, viewport);
    expect(card.view.zoom.style.width).toBeCloseTo(fit.width, 6);
    expect(card.view.zoom.style.height).toBeCloseTo(fit.height, 6);
    expect(Observer.all).toHaveLength(1);
    // A divider drag resizes the margin, and the box with it: the picture is fitted again, never fitted to a constant 360.
    card.box.clientWidth = 444;
    card.act(() => Observer.all[0].notify());
    const wider = clampFigureSize({ width: 600, height: 400 }, figureViewport({ width: 444, height: 500 }));
    expect(card.view.zoom.style.width).toBeCloseTo(wider.width, 6);
    expect(wider.width).toBeGreaterThan(fit.width);
  });

  it("keeps the last measured box while the card is behind, and the picture is there the moment it is brought forward", () => {
    const card = mount();
    const before = card.view.zoom.style.width;
    card.update({ front: false, height: 40 });
    expect(card.view.zoom.style.width).toBe(before);
    expect(Observer.all[0].gone).toBe(true);
    card.update({ front: true, height: 812 });
    expect(card.view.zoom.style.width).toBe(before);
  });

  it("keeps its zoom and pan while it is behind: a header press brings it back as it was left", () => {
    const card = mount();
    card.act(() => card.view.zoom.zoomIn());
    card.act(() => card.view.zoom.zoomIn());
    expect(card.view.zoom.scale).toBe(2);
    const transform = card.view.zoom.style.transform;
    card.update({ front: false, height: 40 });
    expect(card.view.zoom.scale).toBe(2);
    card.update({ front: true, height: 812 });
    expect(card.view.zoom.scale).toBe(2);
    expect(card.view.zoom.style.transform).toBe(transform);
    // Fit still resets it.
    card.act(() => card.view.zoom.reset());
    expect(card.view.zoom.scale).toBe(1);
  });

  it("zooms with the wheel at the pointer and takes the keys, natively and not passively", () => {
    const card = mount();
    expect(card.surface.count("wheel")).toBe(1);
    expect((card.surface.listeners.wheel[0].options as { passive: boolean }).passive).toBe(false);
    expect(card.surface.count("keydown")).toBe(1);
    const prevented = vi.fn();
    card.act(() => card.surface.listeners.wheel[0].fn({ deltaY: -300, deltaMode: 0, clientX: 0, clientY: 0, ctrlKey: false, preventDefault: prevented } as never));
    expect(prevented).toHaveBeenCalled();
    expect(card.view.zoom.scale).toBeGreaterThan(1);
    expect(card.view.zoom.scale).toBeLessThanOrEqual(6);
  });

  it("gives the picture the focus when the card is in front: once per press, and not for a header press", () => {
    const card = mount();
    expect(card.surface.focused).toEqual([{ preventScroll: true }]);
    // The card renders again (the zoom changed): no new press, no new focus.
    card.act(() => card.view.zoom.zoomIn());
    expect(card.surface.focused).toHaveLength(1);
    // Brought forward by its header after being sent behind: the same press, the focus is not moved.
    card.update({ front: false, height: 40 });
    card.update({ front: true, height: 812 });
    expect(card.surface.focused).toHaveLength(1);
    // The same figure pressed again is a new ref: the picture takes the focus again.
    card.update({ figure: REF() });
    expect(card.surface.focused).toHaveLength(2);
  });

  it("waits for the front when a press finds the card behind, then takes the focus once", () => {
    const card = mount();
    card.update({ front: false, height: 40 });
    card.update({ figure: REF() });
    expect(card.surface.focused).toHaveLength(1);
    card.update({ front: true, height: 812 });
    expect(card.surface.focused).toHaveLength(2);
  });

  it("reads the picture's own size from the picture when the figure's record had none", () => {
    const card = mount({ figure: REF({ natural: null }) });
    expect(card.view.zoom.style.width).toBe(0);
    card.act(() => card.view.onPictureLoad!({ currentTarget: { naturalWidth: 0, naturalHeight: 0 } } as never));
    expect(card.view.zoom.style.width).toBe(0);
    card.act(() => card.view.onPictureLoad!({ currentTarget: { naturalWidth: 600, naturalHeight: 400 } } as never));
    const fit = clampFigureSize({ width: 600, height: 400 }, figureViewport({ width: 344, height: 500 }));
    expect(card.view.zoom.style.width).toBeCloseTo(fit.width, 6);
  });

  it("hands its close and raise to the view and its figure's label, caption and picture", () => {
    const card = mount();
    expect(card.view).toMatchObject({ label: "Figure 3", caption: CAPTION, src: "/api/figure/p1/3", front: true, top: 48, height: 812, z: 62, frame: FRAME });
    card.view.onClose();
    card.view.onRaise();
    expect(card.props.onClose).toHaveBeenCalledTimes(1);
    expect(card.props.onRaise).toHaveBeenCalledTimes(1);
  });
});

describe("the card's source", () => {
  it("keeps the hook in the wrapper that stays mounted, asks for the wheel, and asks nothing of the page", () => {
    const c = code(CARD);
    expect(c).toContain("useFigureZoom({ natural: figure.natural ?? loaded, viewport: figureViewport(box), wheel: true })");
    // The view is hook-free; the frame is a prop.
    const view = c.slice(c.indexOf("export function FigureCardView"), c.indexOf("export interface FigureCardProps"));
    expect(view).not.toMatch(/\buse[A-Z]\w+\(/);
    expect(c).not.toMatch(/useMarginRect|useWindows|holdInPlace|localStorage|sessionStorage|fetch\(/);
  });
});

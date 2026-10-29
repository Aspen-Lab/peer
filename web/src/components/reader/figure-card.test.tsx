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
import * as figureCardModule from "./figure-card";
import {
  FIGURE_CAPTION_SHARE,
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
import { FIGURE_CHROME_PX, FIGURE_STACKED_CAPTION_SHARE } from "@/lib/reader/windows";

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

  // P11-17c rule 3 (the owner: "enlarged into the whole right margin"; C P11-15 "For the manager" 5), RE-AIMED (§1c) from "is fitted into the
  // mat's box less its padding": the 8-px mat around the surface is dropped, so the picture is the zoom core's fit of the box WHOLE — the card's
  // whole inner width. At Fit it was 366.7 px in a 400-px margin (398 inside the border, less 16, times the core's 0.96); now 382.1.
  it("is fitted into the box whole: the card's whole inner width, no mat around the picture", () => {
    expect("FIGURE_MAT_PAD_PX" in figureCardModule).toBe(false);
    expect(figureViewport(null)).toEqual({ width: 0, height: 0 });
    expect(figureViewport({ width: 344, height: 500 })).toEqual({ width: 344, height: 500 });
    expect(figureViewport({ width: 10, height: 12 })).toEqual({ width: 10, height: 12 });
    expect(markup()).not.toContain("padding:");
  });

  it("fills a 400-px margin at Fit: a wide figure is at least 380 px wide (it was 366.7)", () => {
    // 400 px across, less the card's 1-px border on each side: the box the card measures.
    const fit = clampFigureSize({ width: 1200, height: 950 }, figureViewport({ width: 398, height: 640 }));
    expect(fit.width).toBeGreaterThanOrEqual(380);
    expect(fit.width).toBeCloseTo(398 * 0.96, 6);
    // A tall figure is held by the box's height, the other way: whole in the box, never past it.
    const tall = clampFigureSize({ width: 465, height: 1556 }, figureViewport({ width: 398, height: 640 }));
    expect(tall.height).toBeCloseTo(640 * 0.96, 6);
    expect(tall.width).toBeLessThanOrEqual(398);
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

// P12-04 harness adaptation: the shared scroll track adds a stable portal/fragment
// around the same view; all zoom, image, pan and focus assertions stay unchanged.
function cardViewIn(node: ReactNode): ReactElement<FigureCardViewProps> {
  if (Array.isArray(node)) {
    for (const child of node) { const found = cardViewIn(child); if (found) return found; }
  } else if (node && typeof node === "object" && "props" in node) {
    const element = node as ReactElement<{ children?: ReactNode }>;
    if (element.type === FigureCardView) return element as ReactElement<FigureCardViewProps>;
    return cardViewIn(element.props.children);
  }
  return undefined as unknown as ReactElement<FigureCardViewProps>;
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
      const element = cardViewIn(output);
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
      return cardViewIn(mounted.value).props;
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
  // The pictures the card keeps by address live as long as the tab; each case starts without them.
  figureCardModule.forgetPictures();
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

// ── P11-26 rule 2 (A P11-22 X-3; ruling §1h.122): the caption while the card stands in front of other cards ──────────────────────────
//
// Alone, the caption keeps the 30 % of the card it always had (the test above). In front of other cards the picture box must be at least half
// the band's height (`windows.test.ts`), so the caption takes at most 20 % of the card — still whole, still scrolling inside.
describe("the caption while stacked: at most 20 % of the card, whole and scrolling (P11-26 rule 2; X-3)", () => {
  // `stacked` is the card's one new property: handed in through a variable, so the view is asked what the card will be asked.
  const stackedView = (over: Partial<FigureCardViewProps> = {}) => ({ ...view(over), stacked: true });

  it("caps the caption at a fifth of the card in front of other cards, and at three tenths alone", () => {
    const stackedCaption = withAttr(FigureCardView(stackedView({ height: 446 })), "data-figure-caption")!;
    expect((stackedCaption.props.style as { maxHeight: number }).maxHeight).toBe(89);
    const aloneCaption = withAttr(FigureCardView(view({ height: 446 })), "data-figure-caption")!;
    expect((aloneCaption.props.style as { maxHeight: number }).maxHeight).toBe(133);
  });

  it("is a fifth in the pure rule too: captionMaxHeight asks whether the card is stacked, and the zoom row is the stack's own number", () => {
    expect(FIGURE_STACKED_CAPTION_SHARE).toBe(0.2);
    expect(captionMaxHeight(446, true)).toBe(89);
    expect(captionMaxHeight(592, true)).toBe(118);
    expect(captionMaxHeight(0, true)).toBe(0);
    expect(captionMaxHeight(-5, true)).toBe(0);
    // Alone, or with the flag false: three tenths, as ever.
    expect(captionMaxHeight(446)).toBe(133);
    expect(captionMaxHeight(446, false)).toBe(133);
    // The stack counts the card's furniture to keep the picture box at half the band: its zoom row is this card's.
    expect(FIGURE_ZOOM_ROW_PX).toBe(36);
    expect(FIGURE_CHROME_PX).toBe(2 + 40 + FIGURE_ZOOM_ROW_PX);
  });

  it("keeps the caption whole, in the reading face, reached by Tab and scrolling inside, when stacked", () => {
    const caption = withAttr(FigureCardView(stackedView({ height: 446 })), "data-figure-caption")!;
    expect(textOf(caption)).toBe(CAPTION);
    expect(caption.props.tabIndex).toBe(0);
    expect(String(caption.props.className)).toMatch(/\boverflow-y-auto\b/);
    expect(String(caption.props.className)).toMatch(/\bfont-reading\b/);
  });

  it("draws the same card otherwise: the zoom row, the box, the picture and the X", () => {
    const html = renderToStaticMarkup(<FigureCardView {...stackedView({ height: 446 })} />);
    for (const part of ["data-figure-zoom-row", "data-figure-box", "data-figure-caption", 'aria-label="Close Figure 3"']) expect(html).toContain(part);
  });
});

// ── P11-26 rule 3 (§1h.123; round 1's readers): the card never shows an empty box ────────────────────────────────────────────────────
//
// For 0.2 to 1.9 s after the card opened or was raised the picture area was a blank grey box: the card asked for its image again even when the
// body's `<img>` had loaded it (the figure route answers a private upload `no-store`, so a second `<img>` of the same address is a second
// request and a second render of the page on the server — a clone of the loaded element asks again too). The card now draws the picture the
// body (or the card itself, earlier) already loaded — a canvas, no request — and, while a picture that is not loaded arrives, shows the
// figure's own label and a quiet "Loading the figure…", never an empty box.
describe("the picture the card draws is the one already loaded; until one is, it says so (P11-26 rule 3; §1h.123)", () => {
  /** A loaded picture, as the browser holds one (the card draws it into a canvas; it never asks for its address again). */
  const loadedPicture = (src: string) => ({ src, complete: true, naturalWidth: 600, naturalHeight: 400 });
  const pictureProps = (picture: unknown) => ({ picture, pictureRef: vi.fn() }) as unknown as Partial<FigureCardViewProps>;
  const withKey = (tree: ReactNode, tag: string) => elements(tree).filter((el) => el.type === tag);

  it("draws a loaded picture into a canvas, and requests nothing: no <img> with an address", () => {
    const html = markup(pictureProps(loadedPicture("/api/figure/p1/3")));
    expect(html).toContain("<canvas");
    expect(html).not.toContain("<img");
    expect(html).not.toContain('src="/api/figure/p1/3"');
    // It is still the zoom core's surface: the same button, the same style.
    const surface = withLabel(FigureCardView(view(pictureProps(loadedPicture("/api/figure/p1/3")))), "Zoom in on figure")!;
    expect(withKey(surface, "canvas")).toHaveLength(1);
    expect(withKey(surface, "img")).toHaveLength(0);
  });

  it("hands the picture to the canvas's ref, which draws it once per picture (the ref is the card's, stable across renders)", () => {
    const props = view(pictureProps(loadedPicture("/api/figure/p1/3")));
    const canvases = withKey(FigureCardView(props), "canvas");
    expect(canvases).toHaveLength(1);
    expect(canvases[0].props.ref).toBe((props as unknown as { pictureRef: unknown }).pictureRef);
  });

  it("asks for the picture itself, under a quiet loading line with the figure's label, while none is loaded", () => {
    const html = markup();
    expect(html).toContain('src="/api/figure/p1/3"');
    const loading = withAttr(tree(), "data-figure-loading")!;
    expect(loading).toBeDefined();
    expect(textOf(loading)).toContain("Figure 3");
    expect(textOf(loading)).toContain("Loading the figure…");
    expect(loading.props.role).toBe("status");
    // Quiet: the faint annotation face, no spinner.
    expect(String(loading.props.className)).toMatch(/text-text-faint/);
  });

  it("shows no loading line once a picture is drawn, and none behind another card (a header alone)", () => {
    expect(markup(pictureProps(loadedPicture("/api/figure/p1/3")))).not.toContain("data-figure-loading");
    expect(markup({ front: false, height: 40 })).not.toContain("data-figure-loading");
  });

  describe("the stateful card", () => {
    const FIGURE = (name: string) => REF({ key: `Figure 3:${name}`, src: `/api/figure/p1/${name}` });
    const drawnPicture = (card: Run) => (card.view as unknown as { picture?: unknown }).picture;
    const bodyDocument = (images: unknown[]) => vi.stubGlobal("document", { images });
    const bodyImage = (src: string, over: Record<string, unknown> = {}) => ({
      getAttribute: (name: string) => (name === "src" ? src : null),
      closest: () => null,
      complete: true,
      naturalWidth: 813,
      naturalHeight: 1043,
      ...over,
    });

    it("has no picture to draw until one has loaded, then draws the one its own <img> loaded", () => {
      const card = mount({ figure: FIGURE("own-load") });
      expect(drawnPicture(card)).toBeUndefined();
      const loaded = { naturalWidth: 600, naturalHeight: 400 };
      card.act(() => card.view.onPictureLoad!({ currentTarget: loaded } as never));
      expect(drawnPicture(card)).toBe(loaded);
    });

    it("keeps the picture it drew while it is behind another card: the raise shows it at once, with no second request", () => {
      const card = mount({ figure: FIGURE("raise") });
      const loaded = { naturalWidth: 600, naturalHeight: 400 };
      card.act(() => card.view.onPictureLoad!({ currentTarget: loaded } as never));
      card.update({ front: false, height: 40 });
      card.update({ front: true, height: 812 });
      expect(drawnPicture(card)).toBe(loaded);
    });

    it("draws the same picture when the same figure is opened again after it was closed (a new card, the same address)", () => {
      const first = mount({ figure: FIGURE("reopen") });
      const loaded = { naturalWidth: 600, naturalHeight: 400 };
      first.act(() => first.view.onPictureLoad!({ currentTarget: loaded } as never));
      first.unmount();
      const again = mount({ figure: FIGURE("reopen") });
      expect(drawnPicture(again)).toBe(loaded);
    });

    it("draws the picture the body already loaded, at the first render, with nothing requested", () => {
      const body = bodyImage("/api/figure/p1/from-body");
      bodyDocument([body]);
      const card = mount({ figure: FIGURE("from-body") });
      expect(drawnPicture(card)).toBe(body);
    });

    it("does not take a body picture that is not loaded yet, nor another figure's, nor one standing in a margin card", () => {
      bodyDocument([
        bodyImage("/api/figure/p1/not-yet", { complete: false, naturalWidth: 0 }),
        bodyImage("/api/figure/p1/other-figure"),
        bodyImage("/api/figure/p1/in-card", { closest: () => ({}) }),
      ]);
      for (const name of ["not-yet", "in-card"]) {
        const card = mount({ figure: FIGURE(name) });
        expect(drawnPicture(card), name).toBeUndefined();
        card.unmount();
      }
    });
  });
});

// ── P11-26 rule 3: the helpers the card draws with ────────────────────────────────────────────────────

describe("drawPicture and the kept pictures (P11-26 rule 3; §1h.123)", () => {
  const picture = (name: string) => ({ src: name, complete: true, naturalWidth: 600, naturalHeight: 400 }) as unknown as figureCardModule.LoadedPicture;

  it("draws a picture at its own size into the canvas: the canvas is the picture's pixels, drawn once", () => {
    const drawImage = vi.fn();
    const canvas = { width: 300, height: 150, getContext: vi.fn(() => ({ drawImage })) };
    const shown = picture("drawn");
    figureCardModule.drawPicture(canvas as never, shown as never);
    expect(canvas.width).toBe(600);
    expect(canvas.height).toBe(400);
    expect(canvas.getContext).toHaveBeenCalledWith("2d");
    expect(drawImage).toHaveBeenCalledTimes(1);
    expect(drawImage).toHaveBeenCalledWith(shown, 0, 0, 600, 400);
  });

  it("draws nothing, and throws nothing, where the canvas has no 2d context", () => {
    expect(() => figureCardModule.drawPicture({ width: 0, height: 0, getContext: () => null } as never, picture("none") as never)).not.toThrow();
  });

  it("keeps the last six pictures by address, the one used last the longest, and gives the kept one back", () => {
    for (let i = 0; i < 8; i += 1) figureCardModule.keepPicture(`/api/figure/p1/kept-${i}`, picture(`kept-${i}`));
    expect(figureCardModule.keptPicture("/api/figure/p1/kept-0")).toBeNull();
    expect(figureCardModule.keptPicture("/api/figure/p1/kept-1")).toBeNull();
    // Using the oldest of the six makes it the newest: two more pushes the others out first.
    const second = figureCardModule.keptPicture("/api/figure/p1/kept-2");
    expect(second).not.toBeNull();
    figureCardModule.keepPicture("/api/figure/p1/kept-8", picture("kept-8"));
    figureCardModule.keepPicture("/api/figure/p1/kept-9", picture("kept-9"));
    expect(figureCardModule.keptPicture("/api/figure/p1/kept-2")).toBe(second);
    expect(figureCardModule.keptPicture("/api/figure/p1/kept-3")).toBeNull();
  });

  it("says so when the card's own request fails, instead of 'Loading the figure…'", () => {
    const html = markup({ failed: true } as Partial<FigureCardViewProps>);
    expect(html).toContain("The figure could not be loaded.");
    expect(html).not.toContain("Loading the figure…");
  });

  it("marks the card's own request as failed from the picture's error", () => {
    const card = mount({ figure: REF({ key: "Figure 3:err", src: "/api/figure/p1/err" }) });
    expect((card.view as unknown as { failed?: boolean }).failed).toBe(false);
    card.act(() => (card.view as unknown as { onPictureError: () => void }).onPictureError());
    expect((card.view as unknown as { failed?: boolean }).failed).toBe(true);
  });
});

// A page that re-flows, for tests in plain Node (no DOM, no jsdom): a column of paragraphs whose heights follow the column's width, a window
// that scrolls, and the three things the browser does when the column changes width. P11-45 (the reader's place across a re-flow).
//
//   1. The layout changes at once, and the scroll OFFSET is kept (clamped to the new height): the paragraphs above the reader grow or
//      shrink, and the words under the eye are different ones. That is the defect, in the browser, measured: the top paragraph moved by one
//      or two at 1280 x 720, scrolled to 8,000.
//   2. A ResizeObserver is told (`reflow` calls `notify`): after the layout, before the paint — the point at which a correction is invisible.
//   3. A scroll event is dispatched at the next frame, if the offset has changed since the last one (`frame`): the reader's, a clamp's or a
//      correction's. Delivered by the test, so the order of the three is the test's to show.
//
// Heights: a paragraph of `chars` characters at `charPx` each, wrapped to the column's width (in the column's own px), is
// `ceil(chars * charPx / column)` lines of `lineHeight`; the reading scale scales the text, Fit's `zoom` everything painted. Nothing else is modelled.

export interface SimParagraph {
  id: string;
  chars: number;
}

export interface SimOptions {
  paragraphs: SimParagraph[];
  /** The column's width, in its own px. */
  column: number;
  viewportHeight?: number;
  /** What stands above the first paragraph, and below the last, in the column's own px. */
  head?: number;
  foot?: number;
  lineHeight?: number;
  charPx?: number;
  /** The space between two paragraphs. */
  gap?: number;
}

type Listener = () => void;

export function createReflowPage(options: SimOptions) {
  const viewportHeight = options.viewportHeight ?? 720;
  const head = options.head ?? 900;
  const foot = options.foot ?? 400;
  const lineHeight = options.lineHeight ?? 29;
  const charPx = options.charPx ?? 8.6;
  const gap = options.gap ?? 16;

  let column = options.column;
  let zoom = 1;
  let scale = "1";
  let scrollY = 0;
  let delivered = 0;
  const scrollListeners = new Set<Listener>();
  const observers = new Set<{ run: Listener; targets: Set<unknown> }>();
  const calls: Array<{ kind: "scrollBy" | "scrollTo"; top: number; behavior: unknown }> = [];

  const factor = () => Number.parseFloat(scale) || 1;
  const heightOf = (p: SimParagraph) => Math.max(1, Math.ceil((p.chars * charPx * factor()) / column)) * lineHeight * factor() * zoom;
  const layout = () => {
    const boxes = new Map<string, { top: number; height: number }>();
    let y = head * zoom;
    for (const p of options.paragraphs) {
      const height = heightOf(p);
      boxes.set(p.id, { top: y, height });
      y += height + gap * zoom;
    }
    return { boxes, total: y + foot * zoom };
  };
  const maxScroll = () => Math.max(0, layout().total - viewportHeight);
  const clamp = (y: number) => Math.min(Math.max(0, y), maxScroll());

  const elements = new Map<string, { id: string; getBoundingClientRect(): { top: number; bottom: number; height: number; left: number; width: number } }>();
  for (const p of options.paragraphs) {
    elements.set(p.id, {
      id: p.id,
      getBoundingClientRect() {
        const box = layout().boxes.get(p.id)!;
        return { top: box.top - scrollY, bottom: box.top - scrollY + box.height, height: box.height, left: 0, width: column * zoom };
      },
    });
  }

  const columnElement = {
    getBoundingClientRect: () => ({ top: 0, left: 0, width: column * zoom, height: layout().total, bottom: layout().total }),
    ownerDocument: { querySelector: () => root },
  };
  const root = { id: "zoom-root", getBoundingClientRect: () => ({ width: 1280, height: layout().total }) };

  const win = {
    get scrollY() {
      return scrollY;
    },
    get innerHeight() {
      return viewportHeight;
    },
    scrollBy(arg: { top?: number; behavior?: unknown }) {
      calls.push({ kind: "scrollBy", top: arg.top ?? 0, behavior: arg.behavior });
      scrollY = clamp(scrollY + (arg.top ?? 0));
    },
    scrollTo(arg: { top?: number; behavior?: unknown }) {
      calls.push({ kind: "scrollTo", top: arg.top ?? 0, behavior: arg.behavior });
      scrollY = clamp(arg.top ?? 0);
    },
    addEventListener(type: string, run: Listener) {
      if (type === "scroll") scrollListeners.add(run);
    },
    removeEventListener(type: string, run: Listener) {
      if (type === "scroll") scrollListeners.delete(run);
    },
    getComputedStyle() {
      return { getPropertyValue: (name: string) => (name === "--page-zoom" ? String(zoom) : name === "--reading-scale" ? scale : "") };
    },
  };
  const doc = {
    getElementById: (id: string) => elements.get(id) ?? null,
    querySelectorAll: () => [...elements.values()],
    querySelector: () => root,
    documentElement: {
      get clientHeight() {
        return viewportHeight;
      },
      get scrollHeight() {
        return layout().total;
      },
    },
    body: { style: { userSelect: "", cursor: "" } },
  };

  class FakeResizeObserver {
    private entry = { run: () => {}, targets: new Set<unknown>() };
    constructor(run: Listener) {
      this.entry.run = run;
      observers.add(this.entry);
    }
    observe(target: unknown) {
      this.entry.targets.add(target);
    }
    unobserve(target: unknown) {
      this.entry.targets.delete(target);
    }
    disconnect() {
      observers.delete(this.entry);
    }
  }

  return {
    win,
    doc,
    column: columnElement,
    root,
    ResizeObserver: FakeResizeObserver,
    /** Every script scroll the page was asked for. */
    calls,
    scrollListeners: () => scrollListeners.size,
    observed: () => [...observers].flatMap((o) => [...o.targets]),
    get scrollY() {
      return scrollY;
    },
    get scrollHeight() {
      return layout().total;
    },
    get columnPx() {
      return column;
    },
    box: (id: string) => {
      const box = layout().boxes.get(id)!;
      return { top: box.top - scrollY, height: box.height };
    },
    /** The reader scrolls (a wheel, a key, a scrollbar); the event arrives at the next `frame`. */
    scroll(y: number) {
      scrollY = clamp(y);
    },
    /** The next frame's scroll event, if the offset has moved since the last one. */
    frame() {
      if (scrollY === delivered) return;
      delivered = scrollY;
      [...scrollListeners].forEach((run) => run());
    },
    /** Tell the observers of `target` (or all, with none) that their box has changed: after the layout, before the paint. */
    notify(target?: unknown) {
      [...observers].filter((o) => target === undefined || o.targets.has(target)).forEach((o) => o.run());
    },
    /** The column takes a new width; the browser keeps the offset (clamped), and the observers are told. */
    reflow(px: number) {
      column = px;
      scrollY = Math.min(scrollY, maxScroll());
      this.notify();
    },
    /** Fit (or the window's zoom) changes: everything painted scales; the offset stays. `only` tells that one target's observers and no other. */
    setZoom(z: number, only?: unknown) {
      zoom = z;
      scrollY = Math.min(scrollY, maxScroll());
      this.notify(only);
    },
    /** A text step: the reading scale (`--reading-scale`) changes, and the text with it. */
    setScale(s: string) {
      scale = s;
      scrollY = Math.min(scrollY, maxScroll());
      this.notify();
    },
    /** The paragraph at the top, as a reader would name it: the first that reaches below `line`, and where its top stands. */
    top(line = 56) {
      for (const p of options.paragraphs) {
        const b = elements.get(p.id)!.getBoundingClientRect();
        if (b.bottom > line) return { id: p.id, top: b.top, height: b.height };
      }
      return null;
    },
    /** How far, in px, the point of paragraph `id` that stood `fraction` of the way down it under `line` is from `line` now. */
    drift(id: string, fraction: number, line = 56) {
      const b = elements.get(id)!.getBoundingClientRect();
      return b.top + fraction * b.height - line;
    },
    lineHeight: lineHeight,
  };
}

export type ReflowPage = ReturnType<typeof createReflowPage>;

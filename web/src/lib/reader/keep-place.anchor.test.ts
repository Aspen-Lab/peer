import { afterEach, describe, expect, it, vi } from "vitest";
import { PLACE_LINE_PX, SETTLE_MS, domEnv, keepPlace, type KeepPlaceEnv as Base, type View } from "./keep-place";

// P11-54 (round 4's Theme-A walk, E2; ruling §1h.159): the reader's place is kept to the LINE, not only to the paragraph.
//
// P11-45 keeps the paragraph at the top, and inside it the FRACTION of its height that is above the line under the masthead. A long paragraph's
// lines are not equally full (a short last line, a long unbroken run, an inline formula), so after a large change of column the same fraction is
// another word: the walk found 22 of 279 cells with the word under the line more than a line away, the worst 4.27 lines. The rule now:
//
//   1. The word under the line stays under it, to within a line: a CHARACTER anchor (a text node and an offset, read by a caret hit-test at the
//      paragraph's middle, at the line) is put back at the same y after a re-flow, by the same one instant `scrollBy`. Where there is no text under
//      the line (the gap between two paragraphs, a formula, a figure) the paragraph's fraction / gap is kept as before; where the node has left the
//      page, the paragraph's fraction is.
//   4. The reader's own scroll during the settling re-anchors (it does not end the keeping), and the keeping never moves the page against the
//      direction of the reader's scroll.
//
// This file holds a page of TEXT (words that wrap, an unbroken run, an inline formula), as the browser lays it out and hit-tests it, and shows the
// rule on it: through the controller's `env` (the members `char` and `charBox`) and through the real `domEnv` over a stubbed `document`
// (`caretPositionFromPoint`, `caretRangeFromPoint`, a `Range`). P11-45's own tests (`keep-place.test.ts`, the shell's flow test) are unchanged.

// ── A page of text ──

interface Run {
  text: string;
  formula?: boolean;
}
interface SimParagraph {
  id: string;
  runs: Run[];
}
interface Token {
  run: number;
  start: number;
  len: number;
  line: number;
  x: number;
  w: number;
}
interface Mark {
  node: SimNode;
  offset: number;
  top: number;
  lineH: number;
}
interface SimNode {
  nodeType: 3;
  data: string;
  length: number;
  isConnected: boolean;
  paragraph: string;
  run: number;
  formula: boolean;
  parentElement: { closest(selector: string): unknown };
}

const LINE_H = 29;
const GLYPH_H = 20;
const CHAR_PX = 8.6;
const GAP = 16;
const HEAD = 900;
const FOOT = 400;
const VIEWPORT_H = 720;
const COLUMN_LEFT = 344;

/**
 * A seeded paragraph of about `chars` characters in words of uneven length, with `unbroken` long unbroken runs (40 to 70 characters, each on a line
 * of its own where it does not fit) and `formulas` inline formulas (a box of its own, not text) spread along it: lines of uneven fullness.
 */
function words(seed: number, chars: number, opts: { unbroken?: number; formulas?: number } = {}): Run[] {
  let s = seed * 9301 + 49297;
  const next = () => ((s = (s * 9301 + 49297) % 233280) / 233280);
  const runs: Run[] = [];
  let text = "";
  let produced = 0;
  const every = (n: number | undefined) => (n ? chars / (n + 1) : Number.POSITIVE_INFINITY);
  let nextRun = every(opts.unbroken);
  let nextFormula = every(opts.formulas);
  while (produced < chars) {
    if (produced >= nextRun) {
      const len = 40 + Math.floor(next() * 30);
      text += `${"u".repeat(len)} `;
      produced += len + 1;
      nextRun += every(opts.unbroken);
      continue;
    }
    if (produced >= nextFormula) {
      runs.push({ text });
      runs.push({ text: "x2+y2=z2+q+r+s", formula: true });
      text = " ";
      nextFormula += every(opts.formulas);
      continue;
    }
    const len = 1 + Math.floor(next() * 13);
    text += `${"w".repeat(len)} `;
    produced += len + 1;
  }
  runs.push({ text: text.trimEnd() });
  return runs;
}

const PARAS_ONCE: SimParagraph[] =
  Array.from({ length: 24 }, (_, n) => ({
    id: `paper-section-${Math.floor(n / 6) + 1}-p${n % 6}`,
    runs: words(n + 1, n % 3 === 0 ? 2900 : n % 3 === 1 ? 1700 : 2300, { unbroken: n % 2 === 0 ? 14 : 2, formulas: n % 4 === 1 ? 6 : 0 }),
  }));
/** The paper's paragraphs (built once: the pages only read them). */
const PARAS = (): SimParagraph[] => PARAS_ONCE;

type Layout = { boxes: Map<string, { top: number; height: number; tokens: Token[]; lines: number }>; total: number };
/** A page's layouts by (column, scale, head): the same paragraphs laid out the same way once, whichever page asks. */
const LAYOUTS = new WeakMap<SimParagraph[], Map<string, Layout>>();

function createTextPage(paragraphs: SimParagraph[], options: { column?: number } = {}) {
  let column = options.column ?? 552;
  let scale = 1;
  let scrollY = 0;
  let delivered = 0;
  let head = HEAD;
  const clock = { now: 0 };
  const scrollListeners = new Set<() => void>();
  const observers = new Set<{ run: () => void; targets: Set<unknown> }>();
  const calls: Array<{ kind: "scrollBy"; top: number; behavior: unknown }> = [];
  const log = { caret: [] as Array<[number, number]>, ranges: 0 };
  let caretMode: "position" | "range" | "none" = "position";

  const nodes = new Map<string, SimNode[]>();
  const connect = (p: SimParagraph) => {
    const list = p.runs.map(
      (run, i): SimNode => ({
        nodeType: 3,
        data: run.text,
        length: run.text.length,
        isConnected: true,
        paragraph: p.id,
        run: i,
        formula: !!run.formula,
        parentElement: { closest: (selector: string) => (run.formula && selector.includes(".katex") ? { katex: true } : null) },
      }),
    );
    nodes.set(p.id, list);
  };
  paragraphs.forEach(connect);

  let cache: Map<string, Layout> | undefined = LAYOUTS.get(paragraphs);
  if (!cache) LAYOUTS.set(paragraphs, (cache = new Map()));
  const layout = (): Layout => {
    const key = `${column}|${scale}|${head}`;
    const hit = cache!.get(key);
    if (hit) return hit;
    const charW = CHAR_PX * scale;
    const lineH = LINE_H * scale;
    const boxes: Layout["boxes"] = new Map();
    let y = head;
    for (const p of paragraphs) {
      const tokens: Token[] = [];
      let line = 0;
      let x = 0;
      p.runs.forEach((run, ri) => {
        const pieces = run.formula ? [{ start: 0, len: run.text.length, w: run.text.length * charW * 1.2 }] : [...run.text.matchAll(/\S+/g)].map((m) => ({ start: m.index ?? 0, len: m[0].length, w: m[0].length * charW }));
        for (const piece of pieces) {
          const need = (x > 0 ? charW : 0) + piece.w;
          if (x > 0 && x + need > column) {
            line++;
            x = 0;
          }
          const at = x > 0 ? x + charW : 0;
          tokens.push({ run: ri, start: piece.start, len: piece.len, line, x: at, w: piece.w });
          x = at + piece.w;
        }
      });
      const lines = line + 1;
      boxes.set(p.id, { top: y, height: lines * lineH, tokens, lines });
      y += lines * lineH + GAP;
    }
    const value: Layout = { boxes, total: y + FOOT };
    cache!.set(key, value);
    return value;
  };
  const maxScroll = () => Math.max(0, layout().total - VIEWPORT_H);
  const clamp = (y: number) => Math.min(Math.max(0, y), maxScroll());

  const rectOf = (id: string, run: number, offset: number) => {
    const box = layout().boxes.get(id)!;
    const charW = CHAR_PX * scale;
    const lineH = LINE_H * scale;
    const glyph = GLYPH_H * scale;
    const own = box.tokens.filter((t) => t.run === run);
    const inside = own.find((t) => offset >= t.start && offset < t.start + t.len);
    const before = [...own].reverse().find((t) => t.start + t.len <= offset);
    const t = inside ?? before ?? own[0];
    if (!t || offset >= p(id).runs[run].text.length) return { top: 0, bottom: 0, left: 0, right: 0, width: 0, height: 0 };
    const left = inside ? t.x + (offset - t.start) * charW : t.x + t.w;
    const top = box.top + t.line * lineH + (lineH - glyph) / 2 - scrollY;
    return { top, bottom: top + glyph, left: COLUMN_LEFT + left, right: COLUMN_LEFT + left + charW, width: charW, height: glyph };
  };
  const p = (id: string) => paragraphs.find((q) => q.id === id)!;

  const elements = new Map<string, { id: string; getBoundingClientRect(): { top: number; bottom: number; height: number; left: number; width: number }; contains(node: unknown): boolean }>();
  for (const para of paragraphs) {
    elements.set(para.id, {
      id: para.id,
      getBoundingClientRect() {
        const box = layout().boxes.get(para.id)!;
        return { top: box.top - scrollY, bottom: box.top - scrollY + box.height, height: box.height, left: COLUMN_LEFT, width: column };
      },
      contains: (node) => (node as SimNode | undefined)?.paragraph === para.id,
    });
  }

  /** What the browser's hit test returns for a point: the nearest line of the nearest paragraph, the nearest caret position in it. */
  const caretAt = (x: number, y: number): { node: SimNode; offset: number } | null => {
    log.caret.push([x, y]);
    const page = y + scrollY;
    let best: { id: string; d: number } | null = null;
    for (const [id, box] of layout().boxes) {
      const d = page < box.top ? box.top - page : page > box.top + box.height ? page - (box.top + box.height) : 0;
      if (!best || d < best.d) best = { id, d };
    }
    if (!best) return null;
    const box = layout().boxes.get(best.id)!;
    const lineIndex = Math.min(box.lines - 1, Math.max(0, Math.floor((page - box.top) / (LINE_H * scale))));
    const onLine = box.tokens.filter((t) => t.line === lineIndex);
    const rel = x - COLUMN_LEFT;
    let pick = onLine[0];
    for (const t of onLine) if (rel >= t.x) pick = t;
    const list = nodes.get(best.id)!;
    const offset = Math.max(0, Math.min(pick.len, Math.round((rel - pick.x) / (CHAR_PX * scale)))) + pick.start;
    return { node: list[pick.run], offset };
  };

  const columnElement = {
    getBoundingClientRect: () => ({ top: 0, left: COLUMN_LEFT, width: column, height: layout().total, bottom: layout().total }),
    ownerDocument: { querySelector: () => root },
  };
  const root = { id: "zoom-root" };

  const win = {
    get scrollY() {
      return scrollY;
    },
    get innerHeight() {
      return VIEWPORT_H;
    },
    scrollBy(arg: { top?: number; behavior?: unknown }) {
      calls.push({ kind: "scrollBy", top: arg.top ?? 0, behavior: arg.behavior });
      scrollY = clamp(scrollY + (arg.top ?? 0));
    },
    addEventListener(type: string, run: () => void) {
      if (type === "scroll") scrollListeners.add(run);
    },
    removeEventListener(type: string, run: () => void) {
      if (type === "scroll") scrollListeners.delete(run);
    },
    getComputedStyle: () => ({ getPropertyValue: (name: string) => (name === "--reading-scale" ? String(scale) : name === "--page-zoom" ? "1" : "") }),
  };
  const doc: Record<string, unknown> = {
    getElementById: (id: string) => elements.get(id) ?? null,
    querySelectorAll: () => [...elements.values()],
    querySelector: () => root,
    documentElement: {
      get clientHeight() {
        return VIEWPORT_H;
      },
      get scrollHeight() {
        return layout().total;
      },
    },
    createRange() {
      log.ranges++;
      let start: SimNode | null = null;
      let offset = 0;
      return {
        setStart(node: SimNode, o: number) {
          start = node;
          offset = o;
        },
        setEnd() {},
        getBoundingClientRect: () => (start && start.isConnected ? rectOf(start.paragraph, start.run, offset) : { top: 0, bottom: 0, left: 0, right: 0, width: 0, height: 0 }),
      };
    },
  };
  const applyCaretMode = () => {
    delete doc.caretPositionFromPoint;
    delete doc.caretRangeFromPoint;
    if (caretMode === "position") doc.caretPositionFromPoint = (x: number, y: number) => { const c = caretAt(x, y); return c ? { offsetNode: c.node, offset: c.offset } : null; };
    if (caretMode === "range") doc.caretRangeFromPoint = (x: number, y: number) => { const c = caretAt(x, y); return c ? { startContainer: c.node, startOffset: c.offset } : null; };
  };
  applyCaretMode();

  class FakeResizeObserver {
    private entry = { run: () => {}, targets: new Set<unknown>() };
    constructor(run: () => void) {
      this.entry.run = run;
      observers.add(this.entry);
    }
    observe(target: unknown) {
      this.entry.targets.add(target);
    }
    disconnect() {
      observers.delete(this.entry);
    }
  }

  const page = {
    win,
    doc,
    column: columnElement,
    ResizeObserver: FakeResizeObserver,
    clock,
    calls,
    log,
    paragraphs,
    get scrollY() {
      return scrollY;
    },
    get scrollHeight() {
      return layout().total;
    },
    get columnPx() {
      return column;
    },
    get lineH() {
      return LINE_H * scale;
    },
    scrollListeners: () => scrollListeners.size,
    /** The caret functions the page has: both, the standard one only, the old one only, or neither. */
    carets(mode: "position" | "range" | "none") {
      caretMode = mode;
      applyCaretMode();
    },
    scroll(y: number) {
      scrollY = clamp(y);
    },
    frame() {
      if (scrollY === delivered) return;
      delivered = scrollY;
      [...scrollListeners].forEach((run) => run());
    },
    notify() {
      [...observers].forEach((o) => o.run());
    },
    reflow(px: number) {
      column = px;
      scrollY = Math.min(scrollY, maxScroll());
      this.notify();
    },
    setScale(value: number) {
      scale = value;
      scrollY = Math.min(scrollY, maxScroll());
      this.notify();
    },
    growAbove(px: number) {
      head += px;
      scrollY = Math.min(scrollY, maxScroll());
      this.notify();
    },
    /** The paragraph's text is drawn again: new nodes, the old ones off the page (the paper re-rendered). */
    rerender(id: string) {
      nodes.get(id)!.forEach((n) => (n.isConnected = false));
      connect(p(id));
    },
    box: (id: string) => {
      const box = layout().boxes.get(id)!;
      return { top: box.top - scrollY, height: box.height };
    },
    top(line = PLACE_LINE_PX) {
      for (const para of paragraphs) {
        const b = layout().boxes.get(para.id)!;
        if (b.top + b.height - scrollY > line) return { id: para.id, top: b.top - scrollY, height: b.height };
      }
      return null;
    },
    /** The word under the line, found as the walk's probe finds it: a caret hit-test at the column's middle, at `y`. */
    mark(y = 62, fx = 0.5): Mark | null {
      const c = caretAt(COLUMN_LEFT + column * fx, y);
      if (!c) return null;
      const off = Math.min(c.offset, c.node.length - 1);
      const top = rectOf(c.node.paragraph, c.node.run, off).top;
      return { node: c.node, offset: off, top, lineH: LINE_H * scale };
    },
    /** How far, in lines, the marked word now stands from where it stood. */
    moved(m: Mark) {
      return (rectOf(m.node.paragraph, m.node.run, m.offset).top - m.top) / (LINE_H * scale);
    },
    /** The reader scrolls so that the line falls `fraction` of the way down paragraph `id`; the scroll event arrives. */
    readAt(id: string, fraction: number) {
      const b = this.box(id);
      this.scroll(scrollY + b.top + fraction * b.height - PLACE_LINE_PX);
      this.frame();
    },
    /** The globals `domEnv` reads, over this page. */
    stub() {
      vi.stubGlobal("window", win);
      vi.stubGlobal("document", doc);
      vi.stubGlobal("performance", { now: () => clock.now });
      vi.stubGlobal("ResizeObserver", FakeResizeObserver);
    },
  };
  return page;
}
type Page = ReturnType<typeof createTextPage>;

afterEach(() => vi.unstubAllGlobals());

/** The page's own env (the members `keep-place.ts` is told: the box of a paragraph; and, for a character anchor, `char` and `charBox`), built by hand. */
interface Anchor {
  node: unknown;
  offset: number;
  fraction: number;
}
interface CharRead {
  id: string;
  node: unknown;
  offset: number;
  top: number;
  height: number;
}
type Env = Base & { char?: (id: string) => CharRead | null; charBox?: (anchor: Anchor) => { top: number; height: number } | null };

function envOf(p: Page, withChar = true): Env {
  const rect = (n: SimNode, o: number) => {
    const r = (p.doc.createRange as () => { setStart(n: SimNode, o: number): void; getBoundingClientRect(): { top: number; height: number } })();
    r.setStart(n, o);
    return r.getBoundingClientRect();
  };
  const base: Env = {
    view: (): View => ({ scrollY: p.scrollY, viewportHeight: 720, scrollHeight: p.scrollHeight, top: p.top() }),
    paragraph: (id) => p.box(id),
    key: () => `${p.columnPx}|${p.win.getComputedStyle().getPropertyValue("--reading-scale")}`,
    scrollY: () => p.scrollY,
    now: () => p.clock.now,
    scrollBy: (dy) => p.win.scrollBy({ top: dy, behavior: "instant" }),
    onScroll: (run) => {
      p.win.addEventListener("scroll", run);
      return () => p.win.removeEventListener("scroll", run);
    },
    observe: (run) => {
      const o = new p.ResizeObserver(run);
      o.observe(p.column);
      return () => o.disconnect();
    },
  };
  if (!withChar) return base;
  return {
    ...base,
    char: (id) => {
      const c = (p.doc.caretPositionFromPoint as (x: number, y: number) => { offsetNode: SimNode; offset: number } | null)(COLUMN_LEFT + p.columnPx / 2, PLACE_LINE_PX);
      if (!c || c.offsetNode.paragraph !== id || c.offsetNode.formula) return null;
      const r = rect(c.offsetNode, Math.min(c.offset, c.offsetNode.length - 1));
      return { id, node: c.offsetNode, offset: Math.min(c.offset, c.offsetNode.length - 1), top: r.top, height: r.height };
    },
    charBox: (a) => {
      const n = a.node as SimNode;
      if (!n.isConnected) return null;
      const r = rect(n, a.offset);
      return r.height > 0 ? { top: r.top, height: r.height } : null;
    },
  };
}

/** The controller, over an env that may also hold the character members (`char`, `charBox`). */
const keep = (env: Env) => keepPlace(env);

const WIDTHS = [492, 612, 472, 632, 416, 646, 380];
const SCALES = [1.1, 1.32, 0.85, 1.6];
/** Every place of the matrix: each paragraph (not the last, at the foot), at three places in it, and the middle of the long ones at five. */
function places(p: Page): Array<[string, number]> {
  const out: Array<[string, number]> = [];
  for (const para of p.paragraphs.slice(0, 22)) for (const f of [0.1, 0.5, 0.9]) out.push([para.id, f]);
  for (const para of p.paragraphs.filter((q) => q.runs.reduce((a, r) => a + r.text.length, 0) > 2500).slice(0, 4)) for (const f of [0.3, 0.7]) out.push([para.id, f]);
  return out;
}

/** How far, in lines, the word under the line (as the walk finds it) goes in each place of the matrix, for one change. */
function drifts(withChar: boolean, change: (p: Page) => void) {
  const out: number[] = [];
  for (const [id, f] of places(createTextPage(PARAS()))) {
    const p = createTextPage(PARAS());
    p.readAt(id, f);
    const m = p.mark();
    if (!m) continue;
    const stop = keep(envOf(p, withChar));
    change(p);
    p.frame();
    out.push(p.moved(m));
    stop();
  }
  return out;
}
const worst = (xs: number[]) => xs.reduce((a, x) => Math.max(a, Math.abs(x)), 0);

// ── The defect ──

describe("the defect, in a page of uneven lines (a guard: the fraction alone keeps the paragraph, not the word)", () => {
  it("leaves the word under the line more than a line away in some re-flows — the walk's 22 of 279 cells", () => {
    const cells = WIDTHS.flatMap((w) => drifts(false, (p) => p.reflow(w)));
    expect(cells.length).toBeGreaterThan(100);
    expect(cells.filter((d) => Math.abs(d) > 1).length).toBeGreaterThan(0);
  });
});

// ── Rule 1: the word under the line stays under it ──

describe("a character anchor: the word under the line stays under it, to within a line", () => {
  it.each(WIDTHS.map((w) => [w]))("a change of column to %i px: every place, to within a line (the word the walk finds), and the anchor itself to the pixel", (w) => {
    const cells = drifts(true, (p) => p.reflow(w));
    expect(cells.length).toBeGreaterThan(30);
    expect(worst(cells)).toBeLessThanOrEqual(1);
  });

  it.each(SCALES.map((s) => [s]))("a text step to scale %f: every place, to within a line", (s) => {
    const cells = drifts(true, (p) => p.setScale(s));
    expect(worst(cells)).toBeLessThanOrEqual(1);
  });

  it("holds the anchor itself to the pixel: the character under the line at the masthead's foot is put back at the same y", () => {
    for (const w of [492, 416, 646]) {
      for (const [id, f] of [["paper-section-1-p0", 0.5], ["paper-section-2-p1", 0.37], ["paper-section-3-p0", 0.8]] as Array<[string, number]>) {
        const p = createTextPage(PARAS());
        p.readAt(id, f);
        const m = p.mark(PLACE_LINE_PX)!;
        keep(envOf(p));
        p.reflow(w);
        expect(Math.abs(p.moved(m) * p.lineH)).toBeLessThanOrEqual(1);
      }
    }
  });

  it("does what the fraction could not: in the cells the fraction leaves over a line, the word is within a line", () => {
    const bad: Array<[string, number, number]> = [];
    for (const w of WIDTHS) {
      for (const [id, f] of places(createTextPage(PARAS()))) {
        const p = createTextPage(PARAS());
        p.readAt(id, f);
        const m = p.mark()!;
        const stop = keep(envOf(p, false));
        p.reflow(w);
        if (Math.abs(p.moved(m)) > 1) bad.push([id, f, w]);
        stop();
      }
    }
    expect(bad.length).toBeGreaterThan(0);
    for (const [id, f, w] of bad) {
      const p = createTextPage(PARAS());
      p.readAt(id, f);
      const m = p.mark()!;
      keep(envOf(p));
      p.reflow(w);
      expect(Math.abs(p.moved(m))).toBeLessThanOrEqual(1);
    }
  });

  it("makes the correction by one instant scrollBy, in the frame of the re-flow and before the scroll event", () => {
    const p = createTextPage(PARAS());
    p.readAt("paper-section-2-p0", 0.5);
    const m = p.mark(PLACE_LINE_PX)!;
    keep(envOf(p));
    p.reflow(492);
    expect(p.calls.length).toBe(1);
    expect(p.calls[0].behavior).toBe("instant");
    expect(Math.abs(p.moved(m) * p.lineH)).toBeLessThanOrEqual(1);
  });

  it("holds through a drag of 60 frames: one scrollBy a frame at most, the word never a pixel from where it began, and it ends where it began", () => {
    const p = createTextPage(PARAS());
    p.readAt("paper-section-3-p0", 0.5);
    const m = p.mark(PLACE_LINE_PX)!;
    keep(envOf(p));
    let farthest = 0;
    let step = 0;
    let last = 0;
    for (let frame = 1; frame <= 60; frame++) {
      const before = p.calls.length;
      p.reflow(552 - frame * 2.3);
      expect(p.calls.length - before).toBeLessThanOrEqual(1);
      const d = p.moved(m) * p.lineH;
      farthest = Math.max(farthest, Math.abs(d));
      step = Math.max(step, Math.abs(d - last));
      last = d;
      p.frame();
    }
    expect(farthest).toBeLessThan(1.5);
    expect(step).toBeLessThan(2);
    for (let frame = 59; frame >= 0; frame--) {
      p.reflow(552 - frame * 2.3);
      p.frame();
    }
    expect(Math.abs(p.moved(m) * p.lineH)).toBeLessThanOrEqual(1);
  });

  it("holds the word through the page's settling: a height that goes on changing for 300 ms is put right, frame by frame", () => {
    const p = createTextPage(PARAS());
    p.readAt("paper-section-2-p1", 0.5);
    const m = p.mark(PLACE_LINE_PX)!;
    keep(envOf(p));
    p.setScale(1.1);
    p.frame();
    for (let frame = 0; frame < 6; frame++) {
      p.clock.now += 50;
      p.growAbove(9);
      p.frame();
      expect(Math.abs(p.moved(m) * p.lineH)).toBeLessThan(1);
    }
  });

  it("reads the place at the reader's own scrolls only: not at its own correction's scroll event", () => {
    const p = createTextPage(PARAS());
    p.readAt("paper-section-2-p0", 0.5);
    const env = envOf(p);
    const reads = vi.fn();
    keep({ ...env, char: (id) => (reads(), env.char!(id)) });
    const start = reads.mock.calls.length;
    p.reflow(520);
    p.frame(); // the correction's scroll event
    expect(reads.mock.calls.length).toBe(start);
    p.scroll(p.scrollY + 400);
    p.frame();
    expect(reads.mock.calls.length).toBe(start + 1);
  });

  it("reads no character at scroll 0 or at the foot, and scrolls nothing there", () => {
    const p = createTextPage(PARAS());
    const env = envOf(p);
    const reads = vi.fn();
    keep({ ...env, char: (id) => (reads(), env.char!(id)) });
    p.reflow(492);
    p.frame();
    expect(p.calls).toEqual([]);
    p.scroll(1e9);
    p.frame();
    p.reflow(612);
    p.frame();
    expect(p.calls).toEqual([]);
    expect(reads).not.toHaveBeenCalled();
  });
});

describe("where there is no text under the line, or the node has left the page: the fraction / the gap, as it was", () => {
  it("keeps a paragraph's gap, and asks for no character, where the paragraph starts below the line", () => {
    const p = createTextPage(PARAS());
    const id = "paper-section-1-p3";
    p.scroll(p.scrollY + p.box(id).top - (PLACE_LINE_PX + 10));
    p.frame();
    expect(p.top()!.id).toBe(id);
    const gap = p.top()!.top - PLACE_LINE_PX;
    const env = envOf(p);
    const asked = vi.fn();
    keep({ ...env, char: (i) => (asked(), env.char!(i)), charBox: (a) => (asked(), env.charBox!(a)) });
    p.reflow(492);
    p.frame();
    expect(p.top()!.id).toBe(id);
    expect(p.top()!.top - PLACE_LINE_PX).toBeCloseTo(gap, 6);
    expect(asked).not.toHaveBeenCalled();
  });

  it("keeps the paragraph's fraction where the character read is not under the line (the hit test snapped elsewhere)", () => {
    const p = createTextPage(PARAS());
    p.readAt("paper-section-2-p2", 0.5);
    const before = p.top()!;
    const f = (PLACE_LINE_PX - before.top) / before.height;
    const env = envOf(p);
    // A character 40 px below the line: not under it.
    keep({ ...env, char: (id) => { const c = env.char!(id); return c ? { ...c, top: c.top + 40 } : c; } });
    p.reflow(492);
    p.frame();
    const after = p.top()!;
    expect(after.id).toBe(before.id);
    expect((PLACE_LINE_PX - after.top) / after.height).toBeCloseTo(f, 2);
  });

  it("keeps the paragraph's fraction where the character read is in another paragraph than the one at the top", () => {
    const p = createTextPage(PARAS());
    p.readAt("paper-section-2-p2", 0.5);
    const before = p.top()!;
    const f = (PLACE_LINE_PX - before.top) / before.height;
    const env = envOf(p);
    keep({ ...env, char: (id) => { const c = env.char!(id); return c ? { ...c, id: "paper-section-9-p9" } : c; } });
    p.reflow(492);
    p.frame();
    expect((PLACE_LINE_PX - p.top()!.top) / p.top()!.height).toBeCloseTo(f, 2);
  });

  it("keeps the paragraph's fraction where the node has left the page (the paper re-rendered): no failure, the paragraph kept", () => {
    const p = createTextPage(PARAS());
    p.readAt("paper-section-2-p2", 0.5);
    const before = p.top()!;
    const f = (PLACE_LINE_PX - before.top) / before.height;
    keep(envOf(p));
    p.rerender(before.id);
    p.reflow(492);
    p.frame();
    const after = p.top()!;
    expect(after.id).toBe(before.id);
    expect((PLACE_LINE_PX - after.top) / after.height).toBeCloseTo(f, 2);
    expect(p.calls.length).toBe(1);
  });

  it("an env with no character members is the P11-45 controller, to the pixel", () => {
    const p = createTextPage(PARAS());
    p.readAt("paper-section-2-p2", 0.5);
    const before = p.top()!;
    const f = (PLACE_LINE_PX - before.top) / before.height;
    keep(envOf(p, false));
    p.reflow(416);
    p.frame();
    expect((PLACE_LINE_PX - p.top()!.top) / p.top()!.height).toBeCloseTo(f, 2);
  });
});

// ── The real reads of the page (`domEnv`) ──

describe("domEnv — the caret at the line, as the browser has it", () => {
  const open = (carets: "position" | "range" | "none" = "position") => {
    const p = createTextPage(PARAS());
    p.carets(carets);
    p.stub();
    p.readAt("paper-section-1-p0", 0.5);
    return p;
  };

  it("keeps the word under the line through a re-flow, with the standard caret function", () => {
    const p = open();
    const m = p.mark(PLACE_LINE_PX)!;
    keepPlace(domEnv(p.column as unknown as Element));
    p.reflow(416);
    expect(Math.abs(p.moved(m) * p.lineH)).toBeLessThanOrEqual(1);
  });

  it("keeps it with the older function where that is what the browser has (caretRangeFromPoint)", () => {
    const p = open("range");
    const m = p.mark(PLACE_LINE_PX)!;
    keepPlace(domEnv(p.column as unknown as Element));
    p.reflow(416);
    expect(Math.abs(p.moved(m) * p.lineH)).toBeLessThanOrEqual(1);
  });

  it("keeps the paragraph's fraction where the browser has neither: nothing fails, the paragraph is kept", () => {
    const p = open("none");
    const before = p.top()!;
    const f = (PLACE_LINE_PX - before.top) / before.height;
    keepPlace(domEnv(p.column as unknown as Element));
    p.reflow(416);
    const after = p.top()!;
    expect(after.id).toBe(before.id);
    expect((PLACE_LINE_PX - after.top) / after.height).toBeCloseTo(f, 2);
  });

  it("reads the caret at the middle of the paragraph's own box, at the line under the masthead", () => {
    const p = open();
    p.log.caret.length = 0;
    keepPlace(domEnv(p.column as unknown as Element));
    expect(p.log.caret[0]).toEqual([COLUMN_LEFT + 552 / 2, PLACE_LINE_PX]);
  });

  it("reads it at the middle once, not at three places: a hit on text needs no second try", () => {
    const p = open();
    p.log.caret.length = 0;
    keepPlace(domEnv(p.column as unknown as Element));
    expect(p.log.caret.length).toBe(1);
  });

  it("tries a place nearer an edge of the paragraph when the middle is a formula, and keeps the word there", () => {
    // The first line: 13 characters of text, a formula about 160 px wide (it covers the middle and the 30 % place), then text.
    const first = { id: "paper-section-0-p0", runs: [{ text: "aaaa bbbb ccc" }, { text: "x2+y2=z2+q+r+s+t", formula: true }, ...words(3, 900)] };
    const p = createTextPage([first, ...PARAS()]);
    p.stub();
    p.readAt(first.id, 0.02);
    expect(p.mark(PLACE_LINE_PX, 0.5)).not.toBeNull();
    expect(p.mark(PLACE_LINE_PX, 0.5)!.node.formula).toBe(true);
    expect(p.mark(PLACE_LINE_PX, 0.7)!.node.formula).toBe(false);
    const m = p.mark(PLACE_LINE_PX, 0.7)!;
    p.log.caret.length = 0;
    keepPlace(domEnv(p.column as unknown as Element));
    const xs = p.log.caret.map(([x]) => (x - COLUMN_LEFT) / 552);
    expect(xs[0]).toBeCloseTo(0.5, 6);
    expect(xs.length).toBeGreaterThanOrEqual(2);
    for (const [, y] of p.log.caret) expect(y).toBe(PLACE_LINE_PX);
    p.reflow(416);
    expect(Math.abs(p.moved(m) * p.lineH)).toBeLessThanOrEqual(1);
  });

  it("keeps the paragraph's fraction where every place it tries is a formula: no character, no failure", () => {
    const only = { id: "paper-section-0-p0", runs: Array.from({ length: 30 }, () => ({ text: "x2+y2=z2+q+r+s+t+u", formula: true })) };
    const p = createTextPage([only, ...PARAS()]);
    p.stub();
    p.readAt(only.id, 0.5);
    const before = p.top()!;
    const f = (PLACE_LINE_PX - before.top) / before.height;
    keepPlace(domEnv(p.column as unknown as Element));
    p.reflow(416);
    const after = p.top()!;
    expect(after.id).toBe(before.id);
    expect((PLACE_LINE_PX - after.top) / after.height).toBeCloseTo(f, 2);
  });

  it("asks for a character only for the paragraph at the top, and puts it back by the one box of its own range (a shared Range, not one a frame)", () => {
    const p = open();
    keepPlace(domEnv(p.column as unknown as Element));
    const start = p.log.ranges;
    for (let w = 540; w > 440; w -= 10) {
      p.reflow(w);
      p.frame();
    }
    expect(p.log.ranges - start).toBeLessThanOrEqual(1);
  });

  it("is told nothing at scroll 0: no caret read, no scroll", () => {
    const p = createTextPage(PARAS());
    p.stub();
    p.log.caret.length = 0;
    keepPlace(domEnv(p.column as unknown as Element));
    p.reflow(416);
    p.frame();
    expect(p.log.caret).toEqual([]);
    expect(p.calls).toEqual([]);
  });
});

// ── Rule 4: the reader's scroll during the settling ──

describe("the reader's scroll during the settling re-anchors; it does not end the keeping (ruling §1h.159, rule 4)", () => {
  /** A text step has been taken (the settle is on) and the reader scrolls on by `dy` in the frame after it. */
  const settling = (dy: number) => {
    const p = createTextPage(PARAS());
    p.readAt("paper-section-2-p1", 0.5);
    keep(envOf(p));
    p.setScale(1.1);
    p.frame();
    p.clock.now += 30;
    p.scroll(p.scrollY + dy);
    p.frame();
    return p;
  };

  it("keeps correcting the heights that go on changing after the reader's scroll: the word at the reader's new place stays under the line (the reader going down, the heights above growing)", () => {
    const p = settling(+600);
    const m = p.mark(PLACE_LINE_PX)!;
    const made = p.calls.length;
    for (let frame = 0; frame < 6; frame++) {
      p.clock.now += 30;
      p.growAbove(20);
      p.frame();
      expect(Math.abs(p.moved(m) * p.lineH)).toBeLessThan(1);
    }
    expect(p.calls.length).toBeGreaterThan(made);
  });

  it("reads the anchor again at the reader's new place: the correction is of the new place, not the old one (the reader is not taken back)", () => {
    const p = settling(+600);
    const at = p.scrollY;
    p.clock.now += 30;
    p.growAbove(20);
    p.frame();
    // Only the growth is put right: the page has moved on by the 20 px, not back by the 600 the reader scrolled.
    expect(p.scrollY).toBeCloseTo(at + 20, 0);
  });

  it("never moves the page against the reader's direction: going down, a height that shrinks above is not put back by scrolling up", () => {
    const p = settling(+600);
    const made = p.calls.length;
    for (let frame = 0; frame < 5; frame++) {
      p.clock.now += 30;
      p.growAbove(-20);
      p.frame();
    }
    expect(p.calls.slice(made).filter((c) => c.top < 0)).toEqual([]);
  });

  it("never moves the page against the reader's direction: going up, a height that grows above is not put back by scrolling down", () => {
    const p = settling(-600);
    const made = p.calls.length;
    for (let frame = 0; frame < 5; frame++) {
      p.clock.now += 30;
      p.growAbove(20);
      p.frame();
    }
    expect(p.calls.slice(made).filter((c) => c.top > 0)).toEqual([]);
  });

  it("takes the place as it stands where it has let a change go, so the next change is put right from there, with no jump back later", () => {
    const p = settling(+600);
    p.clock.now += 30;
    p.growAbove(-60); // shrinks above: let go, the place is read again
    p.frame();
    const m = p.mark(PLACE_LINE_PX)!;
    const made = p.calls.length;
    p.clock.now += 30;
    p.growAbove(25); // grows above, with the reader's direction: put right, by 25 and not by 85
    p.frame();
    expect(p.calls.length).toBe(made + 1);
    expect(p.calls[made].top).toBeCloseTo(25, 0);
    expect(Math.abs(p.moved(m) * p.lineH)).toBeLessThan(1);
  });

  it("makes a new re-flow's own correction in full, either way: the direction of an earlier scroll does not stop the keeping of the next change", () => {
    for (const dy of [+600, -600]) {
      for (const [id, f] of [["paper-section-1-p0", 0.5], ["paper-section-3-p0", 0.5], ["paper-section-2-p1", 0.5]] as Array<[string, number]>) {
        const p = createTextPage(PARAS());
        p.readAt(id, f);
        keep(envOf(p));
        p.setScale(1.1);
        p.frame();
        p.clock.now += 30;
        p.scroll(p.scrollY + dy);
        p.frame();
        const m = p.mark(PLACE_LINE_PX)!;
        p.clock.now += 30;
        p.reflow(380); // a new change of column: the word must be kept, whichever way its correction goes
        p.frame();
        expect(Math.abs(p.moved(m) * p.lineH)).toBeLessThanOrEqual(1);
      }
    }
  });

  it("lets the browser have the heights once the settling is over: no correction after SETTLE_MS, whatever the reader did in it", () => {
    const p = settling(+600);
    p.clock.now += SETTLE_MS + 10;
    const made = p.calls.length;
    p.growAbove(300);
    p.frame();
    expect(p.calls.length).toBe(made);
  });

  it("is not a correction of its own at the reader's scroll: the reader's scroll is read, nothing is scrolled for it", () => {
    const p = createTextPage(PARAS());
    p.readAt("paper-section-2-p1", 0.5);
    keep(envOf(p));
    p.setScale(1.1);
    p.frame();
    const made = p.calls.length;
    p.clock.now += 30;
    p.scroll(p.scrollY + 300);
    p.frame();
    expect(p.calls.length).toBe(made);
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// P11-61 (round 5, Theme A walk E-N1; ruling §1h.171): the question bar always shows its whole question.
// `fitHeight` ran only on a change of the text and on a window resize. A text step (Larger / Smaller text: the bar is
// `text-body`, which the steps scale since 6-09 / P11-48, over a 0.3 s transition of the font size, the column's width and
// its track) and a separator drag (the column's width) re-wrap a typed or submitted question of two lines or more while
// the bar kept the height it was fitted to: 77–140 px of it cut at the bar's foot at step 1.6, 23 px after an 80-px drag.
//
// The rule: whenever the textarea's content width changes, or the reading scale changes, a non-empty bar refits to its
// content; an empty bar stays one row (P11-55) and a keystroke grows it as before.
//
// There is no DOM here, so a browser's layout cannot be measured; what is pinned is what the field asks of the browser.
// The element is a fake with the bits `fitHeight` reads and writes, handed to the field's own `useRef`; the browser's
// `ResizeObserver`, `MutationObserver` and `requestAnimationFrame` are fakes that the test fires by hand.
const injected: { el: unknown } = { el: null };
vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  const { hookRuntime } = await import("@/test-support/hook-runtime");
  const useRef = (initial: unknown) => {
    const ref = hookRuntime.hooks.useRef(initial) as { current: unknown };
    // The field's one ref starts as `null`: it is the textarea, which a real render attaches before the effects run.
    if (initial === null && ref.current === null && injected.el) ref.current = injected.el;
    return ref;
  };
  return { ...actual, ...hookRuntime.hooks, useRef };
});

import type { ReactElement, ReactNode } from "react";
import { hookRuntime } from "@/test-support/hook-runtime";
import { useReadingQuestionsStore } from "@/store/reading-questions";
import { QuestionField } from "./question-field";

/** The text steps' transition (`.zoom-transition`, `globals.css`): 0.3 s. The bar follows it for a little longer than that. */
const FOLLOW_MS = 400;

const PAPER = "openalex:W6101";
const AT = "2026-10-21T00:00:00.000Z";

/** A textarea as `fitHeight` sees one: `scrollHeight` follows `content()`, `offsetHeight - clientHeight` is the 0 px of border. */
function fakeBar(opts: { value: string; content: () => number; scale?: () => string }) {
  const heights: string[] = [];
  const style = { height: "" };
  const el = {
    value: opts.value,
    style: new Proxy(style, {
      set(target, key, value) {
        if (key === "height") heights.push(String(value));
        (target as Record<string | symbol, unknown>)[key] = value;
        return true;
      },
    }),
    get scrollHeight() {
      return opts.content();
    },
    get offsetHeight() {
      return parseFloat(style.height) || 48;
    },
    get clientHeight() {
      return parseFloat(style.height) || 48;
    },
    closest: (selector: string) => (selector === ".reading-scaled" && opts.scale ? scaled : null),
  };
  const scaled = { style: { getPropertyValue: (name: string) => (name === "--reading-scale" ? (opts.scale ? opts.scale() : "") : "") } };
  return { el, heights, raw: style };
}

class FakeResizeObserver {
  static all: FakeResizeObserver[] = [];
  observed: unknown[] = [];
  disconnected = false;
  constructor(private cb: (entries: { contentRect: { width: number } }[]) => void) {
    FakeResizeObserver.all.push(this);
  }
  observe(target: unknown) {
    this.observed.push(target);
  }
  unobserve() {}
  disconnect() {
    this.disconnected = true;
  }
  fire(width: number) {
    this.cb([{ contentRect: { width } }]);
  }
}

class FakeMutationObserver {
  static all: FakeMutationObserver[] = [];
  observed: { target: unknown; options: Record<string, unknown> }[] = [];
  disconnected = false;
  constructor(private cb: () => void) {
    FakeMutationObserver.all.push(this);
  }
  observe(target: unknown, options: Record<string, unknown>) {
    this.observed.push({ target, options });
  }
  disconnect() {
    this.disconnected = true;
  }
  fire() {
    this.cb();
  }
}

/** The browser's frames, by hand: `flush()` runs what was asked for since the last one. */
const frames = { next: 1, queue: new Map<number, () => void>(), now: 0 };
function flush(advance = 16) {
  frames.now += advance;
  const run = [...frames.queue.values()];
  frames.queue.clear();
  run.forEach((fn) => fn());
}

beforeEach(() => {
  FakeResizeObserver.all = [];
  FakeMutationObserver.all = [];
  frames.queue.clear();
  frames.now = 1000;
  injected.el = null;
  vi.stubGlobal("window", { addEventListener: () => {}, removeEventListener: () => {} });
  vi.stubGlobal("ResizeObserver", FakeResizeObserver);
  vi.stubGlobal("MutationObserver", FakeMutationObserver);
  vi.stubGlobal("requestAnimationFrame", (fn: () => void) => {
    const id = frames.next++;
    frames.queue.set(id, fn);
    return id;
  });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => {
    frames.queue.delete(id);
  });
  vi.spyOn(performance, "now").mockImplementation(() => frames.now);
  useReadingQuestionsStore.setState({ byPaper: {}, lastPaperId: null });
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  injected.el = null;
});

type Props = Record<string, unknown> & { children?: ReactNode };
function elements(node: ReactNode): ReactElement<Props>[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!node || typeof node !== "object" || !("props" in node)) return [];
  const element = node as ReactElement<Props>;
  return [element, ...elements(element.props.children)];
}

/** The field, mounted with `bar` as its textarea. */
async function mountWith(bar: ReturnType<typeof fakeBar>) {
  injected.el = bar.el;
  return hookRuntime.mount(() => QuestionField({ paperId: PAPER, examples: [] }));
}

describe("a change of the bar's width refits a question that is in it (the separator, the window, a pane)", () => {
  it("watches the textarea's width, and refits to its content on the next frame after it changes", async () => {
    let content = 60;
    const bar = fakeBar({ value: "a question that wraps", content: () => content });
    useReadingQuestionsStore.getState().set(PAPER, ["a question that wraps"], false, AT);
    const mounted = await mountWith(bar);
    const ro = FakeResizeObserver.all[0];
    expect(ro?.observed).toEqual([bar.el]);
    flush();
    bar.heights.length = 0;

    ro.fire(445); // the observer's first report is the size it starts from
    flush();
    expect(bar.heights).toEqual([]);

    content = 124; // a drag narrowed the column: the same words now take four lines
    ro.fire(381);
    expect(bar.heights).toEqual([]); // not inside the observer's own callback (that would be a loop error)
    flush();
    expect(bar.heights).toEqual(["auto", "124px"]);
    expect(bar.raw.height).toBe("124px");
    mounted.unmount();
  });

  it("a change of the bar's height alone is not a change of width: nothing is refitted (the refit's own height change does not loop)", async () => {
    const bar = fakeBar({ value: "a question that wraps", content: () => 60 });
    const mounted = await mountWith(bar);
    const ro = FakeResizeObserver.all[0];
    ro.fire(445);
    flush();
    bar.heights.length = 0;

    ro.fire(445);
    ro.fire(445);
    flush();
    expect(bar.heights).toEqual([]);
    expect(frames.queue.size).toBe(0);
    mounted.unmount();
  });

  it("asks for one frame however many widths a drag reports in it", async () => {
    const bar = fakeBar({ value: "a question that wraps", content: () => 60 });
    const mounted = await mountWith(bar);
    const ro = FakeResizeObserver.all[0];
    ro.fire(445);
    flush();
    bar.heights.length = 0;

    [440, 430, 420, 410].forEach((w) => ro.fire(w));
    expect(frames.queue.size).toBe(1);
    flush();
    expect(bar.heights).toEqual(["auto", "60px"]);
    mounted.unmount();
  });

  it("an empty bar stays one row: its height is cleared, never measured (P11-55's rule, byte for byte)", async () => {
    const bar = fakeBar({ value: "", content: () => 88 });
    bar.raw.height = "";
    const mounted = await mountWith(bar);
    const ro = FakeResizeObserver.all[0];
    ro?.fire(445);
    flush();
    ro?.fire(309);
    flush();
    expect(bar.raw.height).toBe("");
    expect(bar.heights.every((h) => h === "")).toBe(true);
    mounted.unmount();
  });
});

describe("a change of the reading scale refits the question, through the text steps' 0.3 s transition", () => {
  it("watches the style of the scaled wrapper the bar is in", async () => {
    const bar = fakeBar({ value: "a question that wraps", content: () => 60, scale: () => "1" });
    const mounted = await mountWith(bar);
    const mo = FakeMutationObserver.all[0];
    expect(mo?.observed).toHaveLength(1);
    expect(mo.observed[0].options).toMatchObject({ attributes: true, attributeFilter: ["style"] });
    mounted.unmount();
  });

  it("refits on the spot, then on every frame of the transition, then once more at its end", async () => {
    let scale = "1";
    let content = 60;
    const bar = fakeBar({ value: "a question that wraps", content: () => content, scale: () => scale });
    const mounted = await mountWith(bar);
    const mo = FakeMutationObserver.all[0];
    flush();
    bar.heights.length = 0;

    scale = "1.6";
    content = 196;
    mo.fire();
    expect(bar.raw.height).toBe("196px"); // on the spot, before the frame
    expect(frames.queue.size).toBe(1);

    // the font grows over FOLLOW_MS: the bar is refitted on every frame of it
    let refits = 0;
    for (let at = 16; at < FOLLOW_MS; at += 16) {
      content = 60 + Math.round((136 * at) / FOLLOW_MS);
      bar.heights.length = 0;
      flush(16);
      refits += bar.heights.length > 0 ? 1 : 0;
      expect(bar.raw.height).toBe(`${content}px`);
    }
    expect(refits).toBeGreaterThanOrEqual(Math.floor(FOLLOW_MS / 16) - 1);

    // ... and at the end of it, whatever it settled on
    content = 196;
    flush(16);
    expect(bar.raw.height).toBe("196px");
    bar.heights.length = 0;
    flush(16);
    expect(bar.heights).toEqual([]); // the frames stop: nothing is asked for any more
    expect(frames.queue.size).toBe(0);
    mounted.unmount();
  });

  it("a style change that leaves the scale as it was (the page's other variables) refits nothing", async () => {
    const bar = fakeBar({ value: "a question that wraps", content: () => 60, scale: () => "1.2" });
    const mounted = await mountWith(bar);
    const mo = FakeMutationObserver.all[0];
    flush();
    bar.heights.length = 0;

    mo.fire();
    mo.fire();
    expect(bar.heights).toEqual([]);
    expect(frames.queue.size).toBe(0);
    mounted.unmount();
  });

  it("an empty bar stays one row through a step", async () => {
    let scale = "1";
    const bar = fakeBar({ value: "", content: () => 88, scale: () => scale });
    const mounted = await mountWith(bar);
    const mo = FakeMutationObserver.all[0];
    scale = "1.6";
    mo?.fire();
    for (let i = 0; i < 30; i++) flush(16);
    expect(bar.raw.height).toBe("");
    mounted.unmount();
  });
});

describe("nothing else changes", () => {
  it("a bar that is mounted with a question is fitted to it on the spot, by the text effect, as before", async () => {
    useReadingQuestionsStore.getState().set(PAPER, ["a question that wraps"], false, AT);
    const bar = fakeBar({ value: "a question that wraps", content: () => 72 });
    const mounted = await mountWith(bar);
    expect(bar.heights).toEqual(["auto", "72px"]);
    const line = elements(mounted.value).find((el) => "data-ask-line" in el.props)!;
    expect(line.props.rows).toBe(1);
    mounted.unmount();
  });

  it("takes everything down with it: observers disconnected, the frame in flight cancelled", async () => {
    const bar = fakeBar({ value: "a question that wraps", content: () => 60, scale: () => "1" });
    const mounted = await mountWith(bar);
    const ro = FakeResizeObserver.all[0];
    const mo = FakeMutationObserver.all[0];
    ro.fire(445);
    ro.fire(300);
    expect(frames.queue.size).toBeGreaterThan(0);
    mounted.unmount();
    expect(ro.disconnected).toBe(true);
    expect(mo.disconnected).toBe(true);
    expect(frames.queue.size).toBe(0);
  });

  it("does not throw where the browser has no ResizeObserver or MutationObserver, or the bar has no scaled wrapper above it", async () => {
    const bar = fakeBar({ value: "a question", content: () => 60 });
    vi.stubGlobal("ResizeObserver", undefined);
    vi.stubGlobal("MutationObserver", undefined);
    await expect(mountWith(bar).then((m) => m.unmount())).resolves.not.toThrow();
    vi.stubGlobal("ResizeObserver", FakeResizeObserver);
    vi.stubGlobal("MutationObserver", FakeMutationObserver);
    await expect(mountWith(fakeBar({ value: "a question", content: () => 60 })).then((m) => m.unmount())).resolves.not.toThrow();
    // the bar is not there at all (the tests' own tree)
    injected.el = null;
    await expect(hookRuntime.mount(() => QuestionField({ paperId: PAPER, examples: [] })).then((m) => m.unmount())).resolves.not.toThrow();
  });
});

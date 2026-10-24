import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// P11-07 (owner item 8; B P11-04 §5): the colour strip goes on Escape, on a press anywhere but on it, and when the next selection is
// made — and never on a timer. `watchStripClose` is the rule; `useStripClose` is the hook's own effect, run on the minimal hook
// runtime (this project's Vitest has no DOM, and `react-dom/server` never runs effects).
vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  const { hookRuntime } = await import("@/test-support/hook-runtime");
  return { ...actual, ...hookRuntime.hooks };
});

import { hookRuntime } from "@/test-support/hook-runtime";
import { useStripClose, watchStripClose } from "./highlight-strip";

type Listener = (event?: unknown) => void;
type ListenOptions = boolean | { capture?: boolean };

/** A DOM target's listeners as the DOM keeps them: one per (type, function, capture phase), removed only by naming the same three. */
function registry() {
  const entries: Array<{ type: string; listener: Listener; capture: boolean }> = [];
  const captureOf = (options?: ListenOptions) => (typeof options === "object" ? Boolean(options.capture) : Boolean(options));
  const find = (type: string, listener: Listener, capture: boolean) => entries.findIndex((e) => e.type === type && e.listener === listener && e.capture === capture);
  return {
    add(type: string, listener: Listener, options?: ListenOptions) {
      const capture = captureOf(options);
      if (find(type, listener, capture) < 0) entries.push({ type, listener, capture });
    },
    remove(type: string, listener: Listener, options?: ListenOptions) {
      const at = find(type, listener, captureOf(options));
      if (at >= 0) entries.splice(at, 1);
    },
    of: (type: string) => entries.filter((e) => e.type === type),
    all: () => [...entries],
  };
}

let listeners: ReturnType<typeof registry>;
const fakeDocument = () => ({
  addEventListener: (type: string, listener: Listener, options?: ListenOptions) => listeners.add(type, listener, options),
  removeEventListener: (type: string, listener: Listener, options?: ListenOptions) => listeners.remove(type, listener, options),
});
const fire = (type: string, event?: unknown) => listeners.of(type).forEach(({ listener }) => listener(event));

/** `mount` settles with real timers; the test's fake ones are put back after. */
async function mount<T>(hook: () => T) {
  vi.useRealTimers();
  const mounted = await hookRuntime.mount(hook);
  vi.useFakeTimers();
  return mounted;
}

const STRIP = { id: "strip" };
const ELSEWHERE = { id: "paper" };

beforeEach(() => {
  listeners = registry();
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("watchStripClose", () => {
  function watch(selected = false) {
    const hide = vi.fn();
    const stop = watchStripClose(fakeDocument() as unknown as Document, {
      inside: (target) => (target as unknown) === STRIP,
      hide,
      selected: () => selected,
    });
    return { hide, stop };
  }

  it("hides on Escape and on no other key", () => {
    const { hide } = watch();
    for (const key of ["Enter", "Tab", "a", " ", "ArrowRight"]) fire("keydown", { key });
    expect(hide).not.toHaveBeenCalled();
    fire("keydown", { key: "Escape" });
    expect(hide).toHaveBeenCalledTimes(1);
  });

  it("hides on a press anywhere but on the strip, and stays for a press on it", () => {
    const { hide } = watch();
    fire("pointerdown", { target: STRIP });
    expect(hide).not.toHaveBeenCalled();
    fire("pointerdown", { target: ELSEWHERE });
    expect(hide).toHaveBeenCalledTimes(1);
    fire("pointerdown", { target: null });
    expect(hide).toHaveBeenCalledTimes(2);
  });

  it("hears a press in the capture phase, so it comes before the click that may raise another strip from a mark", () => {
    watch();
    expect(listeners.of("pointerdown").map((e) => e.capture)).toEqual([true]);
  });

  it("hides when the next selection is made — a selectionchange that leaves words selected — and not for one that clears it", () => {
    const cleared = watch(false);
    fire("selectionchange");
    expect(cleared.hide).not.toHaveBeenCalled();
    cleared.stop();
    const made = watch(true);
    fire("selectionchange");
    expect(made.hide).toHaveBeenCalledTimes(1);
  });

  it("listens for those three and no more, and removes every listener it added", () => {
    const { stop } = watch();
    expect(listeners.all().map((e) => e.type).sort()).toEqual(["keydown", "pointerdown", "selectionchange"]);
    stop();
    expect(listeners.all()).toEqual([]);
  });

  it("never hides on a timer: nothing happens in ten minutes", () => {
    const { hide } = watch();
    vi.advanceTimersByTime(10 * 60 * 1000);
    expect(hide).not.toHaveBeenCalled();
  });
});

describe("useStripClose — the hook's own effect", () => {
  let current: { isCollapsed: boolean; toString: () => string } | null;

  beforeEach(() => {
    current = null;
    vi.stubGlobal("document", fakeDocument());
    vi.stubGlobal("window", { getSelection: () => current });
  });

  const stripEl = { contains: (node: unknown) => node === STRIP };

  it("listens while the strip stands, and the strip's own element decides what is 'on it'", async () => {
    const hide = vi.fn();
    const mounted = await mount(() => useStripClose({ current: stripEl }, hide));
    expect(listeners.all()).toHaveLength(3);
    fire("pointerdown", { target: STRIP });
    expect(hide).not.toHaveBeenCalled();
    fire("pointerdown", { target: ELSEWHERE });
    expect(hide).toHaveBeenCalledTimes(1);
    mounted.unmount();
    expect(listeners.all()).toEqual([]);
  });

  it("treats every press as elsewhere before the strip's element exists", async () => {
    const hide = vi.fn();
    const mounted = await mount(() => useStripClose({ current: null }, hide));
    fire("pointerdown", { target: STRIP });
    expect(hide).toHaveBeenCalledTimes(1);
    mounted.unmount();
  });

  it("hides on Escape", async () => {
    const hide = vi.fn();
    const mounted = await mount(() => useStripClose({ current: stripEl }, hide));
    fire("keydown", { key: "Escape" });
    expect(hide).toHaveBeenCalledTimes(1);
    mounted.unmount();
  });

  it("reads the page's selection: words selected close the strip; a cleared one, a caret, or white space do not", async () => {
    const hide = vi.fn();
    const mounted = await mount(() => useStripClose({ current: stripEl }, hide));
    current = null;
    fire("selectionchange");
    current = { isCollapsed: true, toString: () => "" };
    fire("selectionchange");
    current = { isCollapsed: false, toString: () => "  \n " };
    fire("selectionchange");
    expect(hide).not.toHaveBeenCalled();
    current = { isCollapsed: false, toString: () => "the tide pools" };
    fire("selectionchange");
    expect(hide).toHaveBeenCalledTimes(1);
    mounted.unmount();
  });

  it("never closes on a timer", async () => {
    const hide = vi.fn();
    const mounted = await mount(() => useStripClose({ current: stripEl }, hide));
    vi.advanceTimersByTime(60 * 60 * 1000);
    expect(hide).not.toHaveBeenCalled();
    mounted.unmount();
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// P11-17c rule 1: the front card's Escape (`front-escape.ts`). The pure parts are the stack's front and the decision whether a key is a card's
// to take; the hook is the listener on the document, in the bubble phase, for as long as the card is enabled. The hook runs on the staged hook
// runtime (no DOM in this suite): `document` is a recorder, the stack is the real store. The four cards together, as the page mounts them,
// are `front-card.escape.flow.test.tsx`. Invented ids.
vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  const { stagedRuntime } = await import("@/test-support/staged-runtime");
  return { ...actual, ...stagedRuntime.hooks };
});

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { stagedRuntime } from "@/test-support/staged-runtime";
import { useWindows, type FloatingWindow } from "@/lib/reader/windows";
import { frontWindowId, isFrontCard, takeFrontEscape, useFrontEscape, type FrontCard } from "./front-escape";

const win = (id: string, kind: FloatingWindow["kind"], order: number): FloatingWindow => ({ id, kind, title: id, order });
const key = (over: Record<string, unknown> = {}) => ({ key: "Escape", defaultPrevented: false, preventDefault: vi.fn(), stopPropagation: vi.fn(), ...over });

describe("frontWindowId and isFrontCard — the card raised last", () => {
  it("is the window with the highest order, whatever the list's order", () => {
    expect(frontWindowId([win("a", "sticky", 3), win("b", "notes", 5), win("c", "figure", 4)])).toBe("b");
    expect(frontWindowId([win("b", "notes", 5), win("a", "sticky", 3)])).toBe("b");
  });

  it("is null for an empty stack, and nothing is in front of it", () => {
    expect(frontWindowId([])).toBeNull();
    expect(isFrontCard([], "a")).toBe(false);
  });

  it("is a lone card's too", () => {
    expect(isFrontCard([win("a", "explain", 1)], "a")).toBe(true);
  });

  it("is one card only, and a card that is not in the stack is none", () => {
    const stack = [win("a", "sticky", 1), win("b", "figure", 2)];
    expect(isFrontCard(stack, "b")).toBe(true);
    expect(isFrontCard(stack, "a")).toBe(false);
    expect(isFrontCard(stack, "zzz")).toBe(false);
  });
});

describe("takeFrontEscape — when the key is the card's", () => {
  const doc = { querySelector: () => null };
  beforeEach(() => useWindows.setState({ windows: [win("a", "sticky", 1), win("b", "notes", 2)], clock: 2, origin: null }));
  afterEach(() => useWindows.setState({ windows: [], clock: 0, origin: null }));

  it("takes it for the card in front: prevented, stopped, closed once with the card's id", () => {
    const event = key();
    const take = vi.fn();
    expect(takeFrontEscape(event, doc, "b", take)).toBe(true);
    expect(event.preventDefault).toHaveBeenCalledTimes(1);
    expect(event.stopPropagation).toHaveBeenCalledTimes(1);
    expect(take).toHaveBeenCalledExactlyOnceWith("b");
  });

  it("leaves it to the card in front when the card is behind: nothing prevented, stopped or closed", () => {
    const event = key();
    const take = vi.fn();
    expect(takeFrontEscape(event, doc, "a", take)).toBe(false);
    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(event.stopPropagation).not.toHaveBeenCalled();
    expect(take).not.toHaveBeenCalled();
  });

  it("answers for a kind: whichever window of it is in front, and none when another kind is", () => {
    const take = vi.fn();
    expect(takeFrontEscape(key(), doc, { kind: "notes" }, take)).toBe(true);
    expect(take).toHaveBeenLastCalledWith("b");
    expect(takeFrontEscape(key(), doc, { kind: "sticky" }, take)).toBe(false);
    useWindows.setState({ windows: [win("a", "sticky", 1), win("s2", "sticky", 3), win("b", "notes", 2)], clock: 3, origin: null });
    expect(takeFrontEscape(key(), doc, { kind: "sticky" }, take)).toBe(true);
    expect(take).toHaveBeenLastCalledWith("s2");
  });

  it("leaves every other key, a key something handled already, and a modal dialog over the page", () => {
    const take = vi.fn();
    expect(takeFrontEscape(key({ key: "Enter" }), doc, "b", take)).toBe(false);
    expect(takeFrontEscape(key({ defaultPrevented: true }), doc, "b", take)).toBe(false);
    expect(takeFrontEscape(key(), { querySelector: (selector: string) => (selector === '[aria-modal="true"]' ? {} : null) }, "b", take)).toBe(false);
    expect(take).not.toHaveBeenCalled();
  });

  it("does not need a document that can query (a page stub): no modal is then known", () => {
    expect(takeFrontEscape(key(), {} as never, "b", vi.fn())).toBe(true);
  });

  it("takes nothing with an empty stack: the key is the page's", () => {
    useWindows.setState({ windows: [], clock: 0, origin: null });
    const event = key();
    expect(takeFrontEscape(event, doc, "b", vi.fn())).toBe(false);
    expect(takeFrontEscape(event, doc, { kind: "sticky" }, vi.fn())).toBe(false);
    expect(event.preventDefault).not.toHaveBeenCalled();
  });
});

describe("useFrontEscape — the listener", () => {
  let listeners: Set<(event: unknown) => void>;
  let added: number;
  const fire = (event: unknown) => [...listeners].forEach((listener) => listener(event));

  beforeEach(() => {
    listeners = new Set();
    added = 0;
    vi.stubGlobal("document", {
      addEventListener: (type: string, fn: (event: unknown) => void) => {
        if (type === "keydown") {
          listeners.add(fn);
          added += 1;
        }
      },
      removeEventListener: (type: string, fn: (event: unknown) => void) => void (type === "keydown" && listeners.delete(fn)),
      querySelector: () => null,
    });
    useWindows.setState({ windows: [win("a", "sticky", 1), win("b", "notes", 2)], clock: 2, origin: null });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    useWindows.setState({ windows: [], clock: 0, origin: null });
  });

  function mount(card: FrontCard, enabled: () => boolean, take: (id: string) => void) {
    const mounted = stagedRuntime.mount(() => useFrontEscape(card, enabled(), take));
    stagedRuntime.flush();
    return mounted;
  }

  it("stands on the document in the bubble phase while enabled, once, and goes with the card", () => {
    const mounted = mount("b", () => true, vi.fn());
    expect(listeners.size).toBe(1);
    mounted.unmount();
    expect(listeners.size).toBe(0);
  });

  it("registers nothing while the card is not enabled", () => {
    const mounted = mount("b", () => false, vi.fn());
    expect(listeners.size).toBe(0);
    mounted.unmount();
  });

  it("asks who is in front when the key comes: a card brought forward answers at once, with no new registration", () => {
    const take = vi.fn();
    const mounted = mount("a", () => true, take);
    const behind = key();
    fire(behind);
    expect(take).not.toHaveBeenCalled();
    expect(behind.preventDefault).not.toHaveBeenCalled();
    useWindows.getState().raise("a");
    const front = key();
    fire(front);
    expect(take).toHaveBeenCalledExactlyOnceWith("a");
    expect(front.stopPropagation).toHaveBeenCalledTimes(1);
    expect(added).toBe(1);
    mounted.unmount();
  });

  it("is the source's: a bubble-phase document listener, never a capture one", () => {
    const source = readFileSync(resolve(process.cwd(), "src/components/reader/front-escape.ts"), "utf8");
    expect(source).toContain('document.addEventListener("keydown", onKeyDown);');
    expect(source).toContain('document.removeEventListener("keydown", onKeyDown);');
    expect(source).not.toMatch(/"keydown", onKeyDown, true/);
  });
});

// ── P11-40 (round 2, Theme B (b); ruling §1h.138 (c)): Escape does one thing at a time, nearest first ──────────────────────────────────────
// A selection standing with its buttons is put away first (the selection ends and the buttons go, nothing else); only then does Escape close the front card
// (`takeFrontEscape`, above), and only with neither does it leave the paper (the keyboard layer's "back"). The selection's step is `takeSelectionEscape`; the
// listener that carries it is `useSelectionEscape`, on the document in the CAPTURE phase — the cards' listeners stand in the bubble phase, and a capture listener
// is before every one of them, whatever order they were registered in. The three together, with the real cards, are `selection-escape.flow.test.tsx`.
// These are reached through a typed handle, so the file compiles on the base, where the two exports are not there yet.
type StandingSelection = { standing: () => boolean; end: () => void };
const selectionEscape = (await import("./front-escape")) as unknown as {
  takeSelectionEscape: (event: unknown, doc: unknown, selection: StandingSelection) => boolean;
  useSelectionEscape: (selection: StandingSelection) => void;
};
const { takeSelectionEscape, useSelectionEscape } = selectionEscape;

describe("takeSelectionEscape — the selection first", () => {
  const doc = { querySelector: () => null, activeElement: null };
  const standingSelection = () => ({ standing: vi.fn(() => true), end: vi.fn() });
  const press = (over: Record<string, unknown> = {}) => key({ target: { tagName: "BODY" }, ...over });

  it("takes the key while a selection stands: prevented, stopped, and the selection ended once", () => {
    const selection = standingSelection();
    const event = press();
    expect(takeSelectionEscape(event, doc, selection)).toBe(true);
    expect(event.preventDefault).toHaveBeenCalledTimes(1);
    expect(event.stopPropagation).toHaveBeenCalledTimes(1);
    expect(selection.end).toHaveBeenCalledTimes(1);
  });

  it("leaves the key to the cards and to the page's back when no selection stands: nothing prevented, stopped or ended", () => {
    const selection = { standing: vi.fn(() => false), end: vi.fn() };
    const event = press();
    expect(takeSelectionEscape(event, doc, selection)).toBe(false);
    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(event.stopPropagation).not.toHaveBeenCalled();
    expect(selection.end).not.toHaveBeenCalled();
  });

  it("asks whether a selection stands when the key comes, once per key", () => {
    let standing = false;
    const selection = { standing: vi.fn(() => standing), end: vi.fn(() => void (standing = false)) };
    expect(takeSelectionEscape(press(), doc, selection)).toBe(false);
    standing = true;
    expect(takeSelectionEscape(press(), doc, selection)).toBe(true);
    expect(takeSelectionEscape(press(), doc, selection)).toBe(false);
    expect(selection.end).toHaveBeenCalledTimes(1);
  });

  it("leaves every other key (Backspace is still the page's back), a key something handled already, and a modal dialog over the page", () => {
    const selection = standingSelection();
    expect(takeSelectionEscape(press({ key: "Backspace" }), doc, selection)).toBe(false);
    expect(takeSelectionEscape(press({ key: "Enter" }), doc, selection)).toBe(false);
    expect(takeSelectionEscape(press({ defaultPrevented: true }), doc, selection)).toBe(false);
    const modal = { querySelector: (selector: string) => (selector === '[aria-modal="true"]' ? {} : null), activeElement: null };
    expect(takeSelectionEscape(press(), modal, selection)).toBe(false);
    expect(selection.end).not.toHaveBeenCalled();
  });

  it("leaves an Escape typed into a field to the field: an input, a textarea, a select, an editable block — as the key's target or as the focus", () => {
    const fields = [{ tagName: "INPUT" }, { tagName: "TEXTAREA" }, { tagName: "SELECT" }, { tagName: "DIV", isContentEditable: true }];
    for (const field of fields) {
      const selection = standingSelection();
      const typed = press({ target: field });
      expect(takeSelectionEscape(typed, doc, selection), `${field.tagName} as the target`).toBe(false);
      expect(typed.preventDefault).not.toHaveBeenCalled();
      const focused = press({ target: { tagName: "BODY" } });
      expect(takeSelectionEscape(focused, { ...doc, activeElement: field }, selection), `${field.tagName} as the focus`).toBe(false);
      expect(selection.end).not.toHaveBeenCalled();
    }
  });

  it("takes it from the paper, a button, the body or the document itself — none is a field", () => {
    for (const target of [{ tagName: "ARTICLE", isContentEditable: false }, { tagName: "BUTTON" }, { tagName: "BODY" }, {}, null, undefined]) {
      const selection = standingSelection();
      expect(takeSelectionEscape(press({ target }), doc, selection), JSON.stringify(target ?? null)).toBe(true);
      expect(selection.end).toHaveBeenCalledTimes(1);
    }
  });

  it("does not need a document that can query (a page stub): no modal is then known", () => {
    expect(takeSelectionEscape(press(), {} as never, standingSelection())).toBe(true);
  });
});

describe("useSelectionEscape — the listener", () => {
  interface Added {
    fn: (event: unknown) => void;
    capture: boolean;
  }
  let listeners: Added[];
  let added: number;
  const isCapture = (options: unknown) => options === true || (typeof options === "object" && options !== null && (options as { capture?: boolean }).capture === true);
  const fire = (event: unknown) => listeners.forEach((one) => one.fn(event));

  beforeEach(() => {
    listeners = [];
    added = 0;
    vi.stubGlobal("document", {
      addEventListener: (type: string, fn: (event: unknown) => void, options?: unknown) => {
        if (type !== "keydown") return;
        listeners.push({ fn, capture: isCapture(options) });
        added += 1;
      },
      removeEventListener: (type: string, fn: (event: unknown) => void, options?: unknown) => {
        if (type === "keydown") listeners = listeners.filter((one) => !(one.fn === fn && one.capture === isCapture(options)));
      },
      querySelector: () => null,
      activeElement: null,
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  function mount(selection: () => StandingSelection) {
    const mounted = stagedRuntime.mount(() => useSelectionEscape(selection()));
    stagedRuntime.flush();
    return mounted;
  }
  const press = () => key({ target: { tagName: "BODY" } });

  it("stands on the document in the capture phase — before every card's bubble listener — once, and goes with the page", () => {
    const mounted = mount(() => ({ standing: () => true, end: vi.fn() }));
    expect(listeners).toHaveLength(1);
    expect(listeners[0].capture).toBe(true);
    mounted.unmount();
    expect(listeners).toHaveLength(0);
  });

  it("puts the selection away at the key and takes it", () => {
    const end = vi.fn();
    const mounted = mount(() => ({ standing: () => true, end }));
    const event = press();
    fire(event);
    expect(end).toHaveBeenCalledTimes(1);
    expect(event.preventDefault).toHaveBeenCalledTimes(1);
    expect(event.stopPropagation).toHaveBeenCalledTimes(1);
    mounted.unmount();
  });

  it("answers for the page's selection as it is at the key, with no new registration: the closures of the latest render", () => {
    let selecting = false;
    const ended: string[] = [];
    let name = "first";
    const mounted = mount(() => {
      const mine = name;
      return { standing: () => selecting, end: () => void ended.push(mine) };
    });
    const before = press();
    fire(before);
    expect(before.preventDefault).not.toHaveBeenCalled();
    selecting = true;
    name = "second";
    stagedRuntime.rerender();
    stagedRuntime.flush();
    fire(press());
    expect(ended).toEqual(["second"]);
    expect(added).toBe(1);
    mounted.unmount();
  });

  it("is the source's: a capture-phase document listener of its own, and the cards' stays a bubble-phase one", () => {
    const source = readFileSync(resolve(process.cwd(), "src/components/reader/front-escape.ts"), "utf8");
    expect(source).toContain('document.addEventListener("keydown", onSelectionKey, { capture: true });');
    expect(source).toContain('document.removeEventListener("keydown", onSelectionKey, { capture: true });');
    expect(source).toContain('document.addEventListener("keydown", onKeyDown);');
  });
});

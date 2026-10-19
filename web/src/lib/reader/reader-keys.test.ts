import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useEffect, useState } from "react";

// P1-03: the keyboard layer itself is driven below on the minimal hook
// runtime (no DOM here) to show `q` typed into the question field is typing,
// not the shortcut. The table tests are pure and unaffected.
vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  const { hookRuntime } = await import("@/test-support/hook-runtime");
  return { ...actual, ...hookRuntime.hooks };
});
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), back: vi.fn(), replace: vi.fn() }) }));
// zustand's hooks call React itself (it is not transformed, so the mock
// above does not reach it); the layer reads three fields of the feed store.
vi.mock("@/store/feed", async (importOriginal) => {
  const state = { loadFeed: () => undefined, undoDismiss: () => undefined, pendingDismissal: null, papers: [] };
  const useFeedStore = Object.assign((select: (s: typeof state) => unknown) => select(state), { getState: () => state });
  return { ...(await importOriginal<typeof import("@/store/feed")>()), useFeedStore };
});

import { hookRuntime } from "@/test-support/hook-runtime";
import { KeyboardLayer } from "@/components/keyboard";
import {
  PAPER_KEYS,
  keyCap,
  paperKeysFor,
  readerActions,
  readerHelpItems,
  registerReaderActions,
  resolvePaperKey,
  selectionActions,
} from "./reader-keys";

describe("resolvePaperKey", () => {
  it("maps every key in the table to its action", () => {
    for (const entry of PAPER_KEYS) {
      for (const key of entry.keys) {
        expect(resolvePaperKey(key)).toBe(entry.action);
      }
    }
  });

  it("gives next and previous their three spellings each", () => {
    expect(resolvePaperKey("j")).toBe("next");
    expect(resolvePaperKey("]")).toBe("next");
    expect(resolvePaperKey("ArrowRight")).toBe("next");
    expect(resolvePaperKey("k")).toBe("prev");
    expect(resolvePaperKey("[")).toBe("prev");
    expect(resolvePaperKey("ArrowLeft")).toBe("prev");
  });

  it("keeps the briefing's other keys out of the table", () => {
    // `/`, `?`, `g` and `r` stay global; `ArrowDown`/`ArrowUp` belong to the
    // card ring, which the reading page has none of.
    for (const key of ["/", "?", "g", "r", "\\", "ArrowDown", "ArrowUp", "a"]) {
      expect(resolvePaperKey(key)).toBeNull();
    }
  });

  it("is case-sensitive, so a shifted letter is not a shortcut", () => {
    expect(resolvePaperKey("J")).toBeNull();
    expect(resolvePaperKey("S")).toBeNull();
  });

  it("names no key twice", () => {
    const all = PAPER_KEYS.flatMap((entry) => [...entry.keys]);
    expect(new Set(all).size).toBe(all.length);
  });
});

// P4-01 (rulings §1h.12 (h)): `u` first takes back a plain rewrite the reader opened (the latest
// undoable act), and only when none shows does what it did before — undo a dismiss, else mark
// unread / read. It is still ONE row: the help sheet and the foot legend read this table, so the
// label says both and nothing else moves.
describe("the u row (P4-01)", () => {
  const row = PAPER_KEYS.filter((entry) => entry.keys.includes("u"));

  it("is one row, still the undoOrToggleRead action, and says the plain rewrite comes first", () => {
    expect(row).toHaveLength(1);
    expect(row[0].action).toBe("undoOrToggleRead");
    expect(row[0].label).toBe("Undo a plain rewrite or a dismiss, else mark unread / read");
    expect(row[0].short).toBe("undo");
    expect(resolvePaperKey("u")).toBe("undoOrToggleRead");
  });

  it("is the sheet's row and the legend's, from the same table", () => {
    expect(readerHelpItems().find((item) => item.keys === "u")?.label).toBe("Undo a plain rewrite or a dismiss, else mark unread / read");
    expect(paperKeysFor({ upload: true }).find((entry) => entry.keys.includes("u"))?.label).toBe(row[0].label);
    expect(paperKeysFor({ upload: false }).find((entry) => entry.keys.includes("u"))?.label).toBe(row[0].label);
  });

  it("is sentence case, like every other label", () => {
    expect(row[0].label).not.toMatch(/^[A-Z ]+$/);
    expect(row[0].label).not.toMatch(/\bskip\b|don.t read/i);
  });
});

describe("readerHelpItems", () => {
  it("is generated from the table, one row per action", () => {
    const items = readerHelpItems();
    expect(items).toHaveLength(PAPER_KEYS.length);
    expect(items.map((i) => i.label)).toEqual(PAPER_KEYS.map((e) => e.label));
  });

  it("shows the first key of each row on a keycap", () => {
    const items = readerHelpItems();
    expect(items.find((i) => i.label === "Next paper")?.keys).toBe("j");
    expect(items.find((i) => i.label === "Back to the briefing")?.keys).toBe("Esc");
  });

  it("uses no ALL CAPS label", () => {
    for (const item of readerHelpItems()) {
      expect(item.label).not.toMatch(/^[A-Z ]+$/);
    }
  });
});

describe("keyCap", () => {
  it("names the arrow and control keys the way the sheet does", () => {
    expect(keyCap("ArrowRight")).toBe("→");
    expect(keyCap("ArrowLeft")).toBe("←");
    expect(keyCap("Escape")).toBe("Esc");
    expect(keyCap("Backspace")).toBe("⌫");
    expect(keyCap("j")).toBe("j");
    expect(keyCap("Enter")).toBe("Enter");
  });
});

describe("registerReaderActions", () => {
  afterEach(() => {
    // Every test leaves the registry as it found it.
    registerReaderActions({})();
  });

  it("starts empty, so every key is inert before the page mounts", () => {
    expect(readerActions()).toBeNull();
  });

  it("exposes what the page registered and clears it on unregister", () => {
    const next = vi.fn();
    const unregister = registerReaderActions({ next });
    expect(readerActions()?.next).toBe(next);
    readerActions()?.next?.();
    expect(next).toHaveBeenCalledTimes(1);
    unregister();
    expect(readerActions()).toBeNull();
  });

  it("leaves a partial registration partial", () => {
    registerReaderActions({ save: vi.fn() });
    expect(readerActions()?.next).toBeUndefined();
    expect(readerActions()?.save).toBeDefined();
  });

  it("does not let a stale unregister clear a newer registration", () => {
    const first = registerReaderActions({ next: vi.fn() });
    const second = { prev: vi.fn() };
    registerReaderActions(second);
    first();
    expect(readerActions()).toBe(second);
  });
});

// P1-03 (§1f.10): `q` asks a question about the paper on screen — the page
// registers `ask` to focus the first empty question line.
describe("the ask key (P1-03)", () => {
  it("maps q to ask, and the help sheet and legend list it", () => {
    expect(resolvePaperKey("q")).toBe("ask");
    expect(PAPER_KEYS.find((entry) => entry.action === "ask")).toEqual({
      keys: ["q"],
      action: "ask",
      label: "Ask a question about this paper",
      short: "ask",
    });
    expect(readerHelpItems()).toContainEqual({ keys: "q", label: "Ask a question about this paper" });
    expect(resolvePaperKey("Q")).toBeNull();
  });
});

// P3-02b (§1h.3): `e` opens the "Explain this?" box on the selected passage —
// the page registers `explain` and does what the button's click does.
describe("the explain key (P3-02b)", () => {
  it("maps e to explain, once, before the back entry, with the help sheet and the legend reading it from the table", () => {
    expect(resolvePaperKey("e")).toBe("explain");
    expect(PAPER_KEYS.find((entry) => entry.action === "explain")).toEqual({
      keys: ["e"],
      action: "explain",
      label: "Explain the selected passage",
      short: "explain",
    });
    expect(PAPER_KEYS.filter((entry) => entry.keys.includes("e"))).toHaveLength(1);
    const actions = PAPER_KEYS.map((entry) => entry.action);
    expect(actions.indexOf("explain")).toBe(actions.indexOf("back") - 1);
    expect(readerHelpItems()).toContainEqual({ keys: "e", label: "Explain the selected passage" });
    expect(resolvePaperKey("E")).toBeNull();
  });

  it("keeps it on every page: an upload's table drops skip and open and nothing else", () => {
    expect(paperKeysFor({ upload: true }).map((entry) => entry.action)).toContain("explain");
    expect(paperKeysFor({ upload: false }).map((entry) => entry.action)).toContain("explain");
    expect(paperKeysFor({ upload: false })).toEqual(PAPER_KEYS);
  });
});

describe("the keyboard layer and the question field (P1-03)", () => {
  class FakeElement {
    constructor(readonly tagName: string) {}
    isContentEditable = false;
    blur() {}
  }
  let keydown: ((event: unknown) => void) | null = null;

  beforeEach(() => {
    keydown = null;
    vi.stubGlobal("HTMLElement", FakeElement);
    vi.stubGlobal("HTMLInputElement", class extends FakeElement {});
    vi.stubGlobal("window", {
      location: { pathname: "/papers/openalex:W1" },
      addEventListener: (type: string, listener: (event: unknown) => void) => {
        if (type === "keydown") keydown = listener;
      },
      removeEventListener: () => {},
      getSelection: () => ({ isCollapsed: true }),
      matchMedia: () => ({ matches: false }),
    });
    vi.stubGlobal("document", { activeElement: null, getElementById: () => null, querySelectorAll: () => [] });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    registerReaderActions({})();
  });

  function press(key: string, target: unknown) {
    const event = { key, target, metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, preventDefault: vi.fn() };
    keydown?.(event);
    return event;
  }

  it("leaves a q typed into an input alone, and runs ask for a q pressed anywhere else", async () => {
    const ask = vi.fn();
    registerReaderActions({ ask });
    const mounted = await hookRuntime.mount(() => KeyboardLayer());

    const typed = press("q", new FakeElement("INPUT"));
    expect(ask).not.toHaveBeenCalled();
    expect(typed.preventDefault).not.toHaveBeenCalled();

    const pressed = press("q", new FakeElement("DIV"));
    expect(ask).toHaveBeenCalledTimes(1);
    expect(pressed.preventDefault).toHaveBeenCalled();
    mounted.unmount();
  });

  // P3-02b: typed into the box's textarea, `e` is a letter — the layer never
  // intercepts a key typed into a text field. Pressed anywhere else it runs the
  // page's `explain`.
  it("leaves an e typed into a textarea or an input alone, and runs explain for an e pressed anywhere else", async () => {
    const explain = vi.fn();
    registerReaderActions({ explain });
    const mounted = await hookRuntime.mount(() => KeyboardLayer());

    for (const tag of ["TEXTAREA", "INPUT"]) {
      const typed = press("e", new FakeElement(tag));
      expect(typed.preventDefault).not.toHaveBeenCalled();
    }
    expect(explain).not.toHaveBeenCalled();

    const pressed = press("e", new FakeElement("DIV"));
    expect(explain).toHaveBeenCalledTimes(1);
    expect(pressed.preventDefault).toHaveBeenCalled();
    mounted.unmount();
  });

  it("leaves e inert on a page that registered no explain", async () => {
    registerReaderActions({ next: vi.fn() });
    const mounted = await hookRuntime.mount(() => KeyboardLayer());

    expect(press("e", new FakeElement("DIV")).preventDefault).not.toHaveBeenCalled();
    mounted.unmount();
  });

  // P7-12 (R4): an uploaded PDF's page registers no `open`. `o` and Enter resolve to `open`,
  // find no handler, and are left alone — the event is not prevented, so a focused button or
  // link still takes its own Enter — and nothing opens the file route.
  it("leaves o and Enter unhandled on a page that registered no open, and runs open where one is registered", async () => {
    const next = vi.fn();
    registerReaderActions({ next });
    const mounted = await hookRuntime.mount(() => KeyboardLayer());

    for (const key of ["o", "Enter"]) {
      const inert = press(key, new FakeElement("DIV"));
      expect(inert.preventDefault).not.toHaveBeenCalled();
    }
    expect(next).not.toHaveBeenCalled();

    const open = vi.fn();
    registerReaderActions({ next, open });
    const handled = press("o", new FakeElement("DIV"));
    expect(open).toHaveBeenCalledTimes(1);
    expect(handled.preventDefault).toHaveBeenCalled();
    mounted.unmount();
  });

  // P1-08 (§1f.19): an uploaded PDF's page registers no `skip`. The layer
  // resolves `x` to `skip`, finds no handler, and leaves the key alone —
  // nothing runs, the event is not prevented, and no global key answers
  // to `x` on a paper page.
  it("leaves x unhandled on a page that registered no skip, and runs skip where one is registered", async () => {
    const next = vi.fn();
    registerReaderActions({ next });
    const mounted = await hookRuntime.mount(() => KeyboardLayer());

    const inert = press("x", new FakeElement("DIV"));
    expect(inert.preventDefault).not.toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();

    const skip = vi.fn();
    registerReaderActions({ next, skip });
    const handled = press("x", new FakeElement("DIV"));
    expect(skip).toHaveBeenCalledTimes(1);
    expect(handled.preventDefault).toHaveBeenCalled();
    mounted.unmount();
  });
});

// P1-08 (§1a.6, §1f.19): on a standalone uploaded PDF's page there is no
// "Not interested, then next" — the one table loses that row there.
// P7-12 (R4): nor an "Open the PDF" command, so no `o` / Enter row either.
describe("paperKeysFor (P1-08, P7-12)", () => {
  it("drops skip and open for an upload, and is the whole table otherwise", () => {
    const upload = paperKeysFor({ upload: true });
    expect(upload.map((entry) => entry.action)).not.toContain("skip");
    expect(upload.some((entry) => entry.keys.includes("x"))).toBe(false);
    expect(upload.map((entry) => entry.action)).not.toContain("open");
    expect(upload.some((entry) => entry.keys.includes("o") || entry.keys.includes("Enter"))).toBe(false);
    expect(upload).toEqual(PAPER_KEYS.filter((entry) => entry.action !== "skip" && entry.action !== "open"));
    expect(paperKeysFor({ upload: false })).toEqual(PAPER_KEYS);
    expect(paperKeysFor({ upload: false }).map((entry) => entry.action)).toContain("open");
  });

  it("leaves the help sheet as it was: it describes the reader's keys in general", () => {
    expect(readerHelpItems().map((item) => item.label)).toContain("Not interested, then next");
  });
});


// ── P11-13 (rule 3; owner items 5 and 8; B P11-03 §2.4; ruling §1h.113 (b) O-4) ──────────────────────────────────────────────
// `n` takes notes and `h` highlights, each on the selection the page holds, exactly as `e` explains it, and each inert with
// nothing selected. Two actions, two rows in the one table the help sheet and the foot legend read.
describe("the note and highlight keys (P11-13)", () => {
  it("maps n to note and h to highlight, once each, with their own label and legend word", () => {
    expect(resolvePaperKey("n")).toBe("note");
    expect(resolvePaperKey("h")).toBe("highlight");
    expect(PAPER_KEYS.find((entry) => entry.action === "note")).toEqual({
      keys: ["n"],
      action: "note",
      label: "Take notes on the selected passage",
      short: "notes",
    });
    expect(PAPER_KEYS.find((entry) => entry.action === "highlight")).toEqual({
      keys: ["h"],
      action: "highlight",
      label: "Highlight the selected passage",
      short: "highlight",
    });
    expect(PAPER_KEYS.filter((entry) => entry.keys.includes("n"))).toHaveLength(1);
    expect(PAPER_KEYS.filter((entry) => entry.keys.includes("h"))).toHaveLength(1);
    expect(resolvePaperKey("N")).toBeNull();
    expect(resolvePaperKey("H")).toBeNull();
  });

  it("is on the help sheet and in every page's legend table, upload or not", () => {
    expect(readerHelpItems()).toContainEqual({ keys: "n", label: "Take notes on the selected passage" });
    expect(readerHelpItems()).toContainEqual({ keys: "h", label: "Highlight the selected passage" });
    for (const upload of [true, false]) {
      const actions = paperKeysFor({ upload }).map((entry) => entry.action);
      expect(actions).toContain("note");
      expect(actions).toContain("highlight");
    }
  });

  it("leaves Escape as it was: with nothing else to close it is the page's back", () => {
    expect(resolvePaperKey("Escape")).toBe("back");
    expect(resolvePaperKey("Backspace")).toBe("back");
  });
});

describe("selectionActions — the keys that act on the selection the page holds (P11-13)", () => {
  type Target = { passage: string };

  it("runs the handler on the selection the page holds at the moment of the press, not the one it held when it registered", () => {
    let held: Target | null = { passage: "first" };
    const note = vi.fn();
    const keys = selectionActions(() => held, { note });
    keys.note?.();
    held = { passage: "second" };
    keys.note?.();
    expect(note.mock.calls).toEqual([[{ passage: "first" }], [{ passage: "second" }]]);
  });

  it("is inert with nothing selected: the handler is not called", () => {
    const note = vi.fn();
    const highlight = vi.fn();
    const keys = selectionActions<Target>(() => null, { note, highlight });
    keys.note?.();
    keys.highlight?.();
    expect(note).not.toHaveBeenCalled();
    expect(highlight).not.toHaveBeenCalled();
  });

  it("registers only the actions the page has a handler for: no highlight handler, no `highlight` key (the page does not wire one yet)", () => {
    const note = vi.fn();
    expect(Object.keys(selectionActions<Target>(() => ({ passage: "x" }), { note }))).toEqual(["note"]);
    expect(Object.keys(selectionActions<Target>(() => ({ passage: "x" }), {}))).toEqual([]);
    expect(Object.keys(selectionActions<Target>(() => ({ passage: "x" }), { note, highlight: vi.fn() })).sort()).toEqual(["highlight", "note"]);
  });

  it("does not put anything under the explain key: `e` stays the explain box's own", () => {
    const keys = selectionActions<Target>(() => ({ passage: "x" }), { note: vi.fn(), highlight: vi.fn() }) as Record<string, unknown>;
    expect(keys.explain).toBeUndefined();
  });
});

describe("the keyboard layer and the selection's keys (P11-13)", () => {
  class FakeElement {
    constructor(readonly tagName: string) {}
    isContentEditable = false;
    blur() {}
  }
  let keydown: ((event: unknown) => void) | null = null;

  beforeEach(() => {
    keydown = null;
    vi.stubGlobal("HTMLElement", FakeElement);
    vi.stubGlobal("HTMLInputElement", class extends FakeElement {});
    vi.stubGlobal("window", {
      location: { pathname: "/papers/openalex:W1" },
      addEventListener: (type: string, listener: (event: unknown) => void) => {
        if (type === "keydown") keydown = listener;
      },
      removeEventListener: () => {},
      getSelection: () => ({ isCollapsed: true }),
      matchMedia: () => ({ matches: false }),
      setTimeout: (fn: () => void, ms: number) => setTimeout(fn, ms),
      clearTimeout: (id: number) => clearTimeout(id),
    });
    vi.stubGlobal("document", { activeElement: null, getElementById: () => null, querySelectorAll: () => [] });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    registerReaderActions({})();
  });

  function press(key: string, target: unknown) {
    const event = { key, target, metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, preventDefault: vi.fn() };
    keydown?.(event);
    return event;
  }

  it("leaves an n or an h typed into a field alone, and runs the page's note and highlight for one pressed anywhere else", async () => {
    const note = vi.fn();
    const highlight = vi.fn();
    registerReaderActions({ note, highlight });
    const mounted = await hookRuntime.mount(() => KeyboardLayer());

    for (const tag of ["TEXTAREA", "INPUT"]) {
      for (const key of ["n", "h"]) expect(press(key, new FakeElement(tag)).preventDefault).not.toHaveBeenCalled();
    }
    expect(note).not.toHaveBeenCalled();
    expect(highlight).not.toHaveBeenCalled();

    expect(press("n", new FakeElement("DIV")).preventDefault).toHaveBeenCalled();
    expect(press("h", new FakeElement("DIV")).preventDefault).toHaveBeenCalled();
    expect(note).toHaveBeenCalledTimes(1);
    expect(highlight).toHaveBeenCalledTimes(1);
    mounted.unmount();
  });

  it("leaves n and h inert on a page that registered neither (the highlight is not wired yet)", async () => {
    registerReaderActions({ next: vi.fn() });
    const mounted = await hookRuntime.mount(() => KeyboardLayer());

    expect(press("n", new FakeElement("DIV")).preventDefault).not.toHaveBeenCalled();
    expect(press("h", new FakeElement("DIV")).preventDefault).not.toHaveBeenCalled();
    mounted.unmount();
  });

  it("acts on the selection and on nothing else: with the page's selection actions and no selection, the press does nothing", async () => {
    type Target = { passage: string };
    const note = vi.fn();
    let held: Target | null = null;
    registerReaderActions(selectionActions<Target>(() => held, { note }));
    const mounted = await hookRuntime.mount(() => KeyboardLayer());

    press("n", new FakeElement("DIV"));
    expect(note).not.toHaveBeenCalled();
    held = { passage: "the words" };
    press("n", new FakeElement("DIV"));
    expect(note).toHaveBeenCalledWith({ passage: "the words" });
    mounted.unmount();
  });

  // The `g` chord reads its second key before the paper's table does, so `g` then `h` still goes to the briefing.
  it("leaves the g chord's h to the chord: g then h highlights nothing", async () => {
    const highlight = vi.fn();
    registerReaderActions({ highlight });
    let second: ReturnType<typeof press> | null = null;
    const mounted = await hookRuntime.mount(() => {
      KeyboardLayer();
      const [step, setStep] = useState(0);
      useEffect(() => {
        if (step === 1) press("g", new FakeElement("DIV"));
        if (step === 2) second = press("h", new FakeElement("DIV"));
        if (step < 3) setStep(step + 1);
      }, [step]);
      return null;
    });
    expect(second).not.toBeNull();
    expect(highlight).not.toHaveBeenCalled();
    expect(second!.preventDefault).toHaveBeenCalled();
    // …and a bare h, a moment later, is the highlight.
    press("h", new FakeElement("DIV"));
    expect(highlight).toHaveBeenCalledTimes(1);
    mounted.unmount();
  });
});

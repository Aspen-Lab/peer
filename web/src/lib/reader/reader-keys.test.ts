import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
  readerActions,
  readerHelpItems,
  registerReaderActions,
  resolvePaperKey,
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
});


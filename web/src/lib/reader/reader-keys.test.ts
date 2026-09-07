import { afterEach, describe, expect, it, vi } from "vitest";
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

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { StateStorage } from "zustand/middleware";
import { READER_PANES_STORAGE_KEY, sanitizePanes } from "@/store/reader-panes";

// P11-10 rule 1 (B P11-01 §4 C1; ruling §1h.113): the reader's choice of panes, kept per browser — the left pane pinned or the
// rail, and the two widths. A missing or corrupt blob reads as the defaults; stored widths are clamped on read. Everything is invented.

/** A browser's localStorage with one item in it, and what `setItem` last wrote. */
function browser(initial: string | null) {
  let stored = initial;
  const writes: string[] = [];
  const storage: StateStorage = {
    getItem: () => stored,
    setItem: (_name, value) => {
      stored = value;
      writes.push(value);
    },
    removeItem: () => {
      stored = null;
    },
  };
  return { storage, writes, read: () => stored };
}

/** A fresh store over that browser's storage (the middleware reads `window.localStorage` when the store is made). */
async function storeIn(initial: string | null) {
  const b = browser(initial);
  vi.stubGlobal("window", { localStorage: b.storage });
  vi.resetModules();
  const { useReaderPanesStore } = await import("@/store/reader-panes");
  return { store: useReaderPanesStore, ...b };
}

const blob = (state: unknown, version = 1) => JSON.stringify({ state, version });

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("the store's name and pattern", () => {
  it("is peer-reader-panes, version 1, skipHydration, and loaded by the hydrator after mount", () => {
    const source = readFileSync(resolve(process.cwd(), "src/store/reader-panes.ts"), "utf8");
    expect(READER_PANES_STORAGE_KEY).toBe("peer-reader-panes");
    expect(source).toContain("name: READER_PANES_STORAGE_KEY,\n      version: 1,");
    expect(source).toMatch(/skipHydration:\s*true/);

    const hydrator = readFileSync(resolve(process.cwd(), "src/components/store-hydrator.tsx"), "utf8");
    expect(hydrator).toContain('import { useReaderPanesStore } from "@/store/reader-panes";');
    expect(hydrator).toContain("useReaderPanesStore.persist.rehydrate();");
  });
});

describe("a fresh reader", () => {
  it("has made no choice: no pin, no widths — the defaults are the window's to compute (fitPanes)", async () => {
    const { store } = await storeIn(null);
    const state = store.getState();
    expect([state.leftPinned, state.leftWidth, state.marginWidth]).toEqual([undefined, undefined, undefined]);
  });

  it("does not read the browser's storage until the hydrator asks (skipHydration)", async () => {
    const { store } = await storeIn(blob({ leftPinned: false, leftWidth: 400, marginWidth: 500 }));
    expect(store.getState().leftWidth).toBeUndefined();
    await store.persist.rehydrate();
    expect(store.getState().leftWidth).toBe(400);
  });
});

describe("the actions", () => {
  it("keep the pin and the two widths, and write them to the browser as the data only", async () => {
    const { store, read } = await storeIn(null);
    store.getState().setLeftPinned(false);
    store.getState().setLeftWidth(400);
    store.getState().setMarginWidth(450);

    expect([store.getState().leftPinned, store.getState().leftWidth, store.getState().marginWidth]).toEqual([false, 400, 450]);
    expect(JSON.parse(read() ?? "null")).toEqual({ state: { leftPinned: false, leftWidth: 400, marginWidth: 450 }, version: 1 });
  });

  it("clamp a width to its pane's range, in whole px", async () => {
    const { store } = await storeIn(null);
    store.getState().setLeftWidth(10);
    store.getState().setMarginWidth(9000);
    expect([store.getState().leftWidth, store.getState().marginWidth]).toEqual([240, 560]);
    store.getState().setLeftWidth(301.4);
    expect(store.getState().leftWidth).toBe(301);
  });

  it("ignore what is not a number (or a boolean for the pin): the choice stays as it was", async () => {
    const { store } = await storeIn(null);
    store.getState().setLeftWidth(400);
    store.getState().setLeftPinned(true);
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, "400", null, undefined, {}]) {
      store.getState().setLeftWidth(bad as never);
      store.getState().setMarginWidth(bad as never);
      store.getState().setLeftPinned(bad as never);
    }
    expect([store.getState().leftWidth, store.getState().marginWidth, store.getState().leftPinned]).toEqual([400, undefined, true]);
  });

  it("reset forgets every choice", async () => {
    const { store, read } = await storeIn(null);
    store.getState().setLeftPinned(true);
    store.getState().setLeftWidth(400);
    store.getState().setMarginWidth(450);
    store.getState().reset();

    expect([store.getState().leftPinned, store.getState().leftWidth, store.getState().marginWidth]).toEqual([undefined, undefined, undefined]);
    expect(JSON.parse(read() ?? "null").state).toEqual({});
  });
});

describe("reading the browser's blob", () => {
  it("restores what was kept", async () => {
    const { store } = await storeIn(blob({ leftPinned: true, leftWidth: 400, marginWidth: 450 }));
    await store.persist.rehydrate();
    const state = store.getState();
    expect([state.leftPinned, state.leftWidth, state.marginWidth]).toEqual([true, 400, 450]);
    expect(typeof state.setLeftWidth).toBe("function");
  });

  it("reads a corrupt blob as the defaults: unparseable text, not an object, the wrong version", async () => {
    for (const text of ["{not json", "null", "42", '"text"', "[]", blob([1, 2]), blob("text"), blob(null), blob({ leftWidth: 400 }, 2), ""]) {
      const { store } = await storeIn(text);
      await store.persist.rehydrate();
      const state = store.getState();
      expect([text, state.leftPinned, state.leftWidth, state.marginWidth]).toEqual([text, undefined, undefined, undefined]);
      expect(typeof state.setMarginWidth).toBe("function");
    }
  });

  it("drops a field that is not what it should be and keeps the others", async () => {
    const { store } = await storeIn(blob({ leftPinned: "yes", leftWidth: "wide", marginWidth: 450, extra: 1 }));
    await store.persist.rehydrate();
    const state = store.getState();
    expect([state.leftPinned, state.leftWidth, state.marginWidth]).toEqual([undefined, undefined, 450]);
    expect(state).not.toHaveProperty("extra");
  });

  it("clamps widths on read, and reads non-finite numbers (null in JSON) as no choice", async () => {
    const { store } = await storeIn(blob({ leftPinned: false, leftWidth: 9999, marginWidth: 3 }));
    await store.persist.rehydrate();
    expect([store.getState().leftWidth, store.getState().marginWidth, store.getState().leftPinned]).toEqual([480, 280, false]);

    const { store: nulls } = await storeIn(blob({ leftWidth: null, marginWidth: null }));
    await nulls.persist.rehydrate();
    expect([nulls.getState().leftWidth, nulls.getState().marginWidth]).toEqual([undefined, undefined]);
  });

  it("does not write while reading (a read is not a choice)", async () => {
    const { store, writes } = await storeIn(blob({ leftWidth: 9999 }));
    await store.persist.rehydrate();
    expect(store.getState().leftWidth).toBe(480);
    expect(writes).toEqual([]);
  });
});

describe("sanitizePanes", () => {
  it("keeps a boolean pin and clamps finite widths; everything else is dropped", () => {
    expect(sanitizePanes({ leftPinned: false, leftWidth: 100, marginWidth: 1000 })).toEqual({ leftPinned: false, leftWidth: 240, marginWidth: 560 });
    expect(sanitizePanes({ leftPinned: 1, leftWidth: Number.NaN, marginWidth: Number.POSITIVE_INFINITY })).toEqual({});
    for (const bad of [null, undefined, 3, "x", [], true]) expect(sanitizePanes(bad)).toEqual({});
  });
});

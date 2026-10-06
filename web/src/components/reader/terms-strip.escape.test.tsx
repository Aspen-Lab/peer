import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// P3-01 (ruling §1h.1): a term's highlight is cleared by the next click or by
// Escape. Escape belongs to the reader's own keys on this page ("Back to the
// briefing"), so while a term is marked the strip takes it first — a capture
// listener on the document that stops the key reaching the page's layer — and
// lets it through again the moment the mark is gone. No DOM in this project's
// Vitest: the hook runs on the minimal hook runtime against a stub document.
vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  const { hookRuntime } = await import("@/test-support/hook-runtime");
  return { ...actual, ...hookRuntime.hooks };
});

import { hookRuntime } from "@/test-support/hook-runtime";
import { useEscapeToClear } from "./terms-strip";

type Listener = { type: string; fn: (event: unknown) => void; capture: unknown };
let listeners: Listener[] = [];

beforeEach(() => {
  listeners = [];
  vi.stubGlobal("document", {
    addEventListener: (type: string, fn: Listener["fn"], capture: unknown) => listeners.push({ type, fn, capture }),
    removeEventListener: (type: string, fn: Listener["fn"], capture: unknown) => {
      listeners = listeners.filter((l) => !(l.type === type && l.fn === fn && l.capture === capture));
    },
  });
});
afterEach(() => vi.unstubAllGlobals());

const key = (name: string) => ({ key: name, preventDefault: vi.fn(), stopPropagation: vi.fn() });

describe("useEscapeToClear", () => {
  it("registers nothing while no term is marked", async () => {
    await hookRuntime.mount(() => useEscapeToClear(false, vi.fn()));

    expect(listeners).toHaveLength(0);
  });

  it("while a term is marked, takes Escape before the page's keys, clears the mark and keeps the key from leaving the page", async () => {
    const clear = vi.fn();
    await hookRuntime.mount(() => useEscapeToClear(true, clear));

    expect(listeners).toHaveLength(1);
    expect(listeners[0]).toMatchObject({ type: "keydown", capture: true });
    const escape = key("Escape");
    listeners[0].fn(escape);

    expect(clear).toHaveBeenCalledTimes(1);
    expect(escape.preventDefault).toHaveBeenCalledTimes(1);
    expect(escape.stopPropagation).toHaveBeenCalledTimes(1);
  });

  it("lets every other key through untouched", async () => {
    const clear = vi.fn();
    await hookRuntime.mount(() => useEscapeToClear(true, clear));
    const other = key("j");
    listeners[0].fn(other);

    expect(clear).not.toHaveBeenCalled();
    expect(other.preventDefault).not.toHaveBeenCalled();
    expect(other.stopPropagation).not.toHaveBeenCalled();
  });

  it("removes its listener when the strip goes away, so Escape leaves the page again", async () => {
    const mounted = await hookRuntime.mount(() => useEscapeToClear(true, vi.fn()));
    expect(listeners).toHaveLength(1);

    mounted.unmount();

    expect(listeners).toHaveLength(0);
  });
});

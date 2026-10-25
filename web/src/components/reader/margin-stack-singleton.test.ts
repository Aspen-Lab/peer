import { afterEach, expect, it, vi } from "vitest";
import type { RefObject } from "react";

const effects = vi.hoisted(() => [] as (() => void | (() => void))[]);
const fixture = vi.hoisted(() => ({ target: null as unknown }));
vi.mock("react", async (original) => ({ ...await original<typeof import("react")>(),
  useEffect: () => {},
  useLayoutEffect: (effect: () => void | (() => void)) => { effects.push(effect); },
  useState: (initial: unknown) => [((typeof initial === "function" ? initial() : initial) ?? fixture.target), () => {}],
}));
import { useMarginStack } from "./margin-stack-scroll";
import { useWindows } from "@/lib/reader/windows";

afterEach(() => { effects.length = 0; fixture.target = null; vi.unstubAllGlobals(); useWindows.setState({ windows: [], clock: 0, origin: null }); });

it("P12-21 bounds an oversized singleton in the existing shared track without calling it a split", () => {
  const spacer = { style: { height: "" } };
  const target = { style: { cssText: "" }, dataset: {} as Record<string, string>, querySelector: () => spacer };
  fixture.target = target;
  const result = useMarginStack("one", { current: null }, { left: 20, width: 350 }, true, {
    windows: [{ id: "one", kind: "sticky", title: "Note", order: 1, minimum: 189 }],
    rect: { top: 300, bottom: 400, left: 20, width: 350 }, bottom: 400,
  });
  effects.forEach((effect) => effect());
  expect(result.split).toBe(false); expect(result.scroll).toBe(true);
  expect(result.rows[0]).toMatchObject({ top: 300, height: 189 });
  expect(target.style.cssText).toContain("top:300px;height:100px");
  expect(target.style.cssText).toContain("overflow-y:auto");
  expect(spacer.style.height).toBe("189px"); expect(target.dataset.split).toBe("false");
});

it("P12-21 leaves a fitting singleton host transparent", () => {
  const spacer = { style: { height: "" } };
  const target = { style: { cssText: "" }, dataset: {}, querySelector: () => spacer };
  fixture.target = target;
  const result = useMarginStack("one", { current: null }, null, true, {
    windows: [{ id: "one", kind: "sticky", title: "Note", order: 1, minimum: 189 }],
    rect: { top: 48, bottom: 440, left: 1080, width: 360 }, bottom: 440,
  });
  effects.forEach((effect) => effect());
  expect(result.split).toBe(false); expect(result.scroll).toBe(false);
  expect(target.style.cssText).toBe("display:contents"); expect(spacer.style.height).toBe("0");
});

it("P12-21 measures/observes a singleton, follows wraps and replaced editing surfaces, and disconnects on removal", () => {
  let toolbarHeight = 76;
  let inactiveHeading = false;
  let currentText = { parentElement: null as unknown };
  const toolbar = { getBoundingClientRect: () => ({ height: toolbarHeight }) };
  const body = { parentElement: null as unknown, querySelector: () => currentText, querySelectorAll: () => [toolbar] };
  currentText.parentElement = body;
  const header = { getBoundingClientRect: () => ({ height: 45 }) };
  const card = { dataset: { marginCard: "sticky" }, firstElementChild: header, children: [header, body],
    querySelector: (selector: string) => selector === "[data-margin-fixed]" ? null : selector === "[data-margin-body]" ? body : null,
    querySelectorAll: (selector: string) => inactiveHeading && !selector.includes("[data-row] .cursor-text") ? [toolbar] : [currentText, toolbar],
  };
  body.parentElement = card;
  vi.stubGlobal("getComputedStyle", (node: unknown) => node === toolbar ? { marginTop: "0", marginBottom: "0" } : node === body ? { paddingTop: "13", paddingBottom: "24" } : { lineHeight: "26.4", fontSize: "16" });
  let resized = () => {}; let mutated = () => {};
  const observed: unknown[] = []; const disconnect = vi.fn(); const stopMutation = vi.fn();
  vi.stubGlobal("ResizeObserver", class { constructor(callback: () => void) { resized = callback; } observe(node: unknown) { observed.push(node); } disconnect = disconnect; });
  vi.stubGlobal("MutationObserver", class { constructor(callback: () => void) { mutated = callback; } observe = vi.fn(); disconnect = stopMutation; });
  useWindows.getState().open({ id: "one", kind: "sticky", title: "Note" });
  useMarginStack("one", { current: card } as unknown as RefObject<HTMLElement>, null, true,
    { windows: useWindows.getState().windows, rect: { top: 48, bottom: 440, left: 1080, width: 360 }, bottom: 440 });
  const cleanups = effects.map((effect) => effect()).filter((cleanup): cleanup is () => void => typeof cleanup === "function");
  expect(useWindows.getState().windows[0].minimum).toBe(187);
  expect(observed).toContain(toolbar); expect(observed).toContain(currentText);
  toolbarHeight = 112; resized(); expect(useWindows.getState().windows[0].minimum).toBe(223);
  inactiveHeading = true; currentText = { parentElement: body }; mutated(); expect(observed).toContain(currentText);
  toolbarHeight = 40; resized(); expect(useWindows.getState().windows[0].minimum).toBe(151);
  useWindows.getState().close("one"); cleanups.forEach((cleanup) => cleanup());
  expect(disconnect).toHaveBeenCalled(); expect(stopMutation).toHaveBeenCalledOnce();
  resized(); expect(useWindows.getState().windows).toEqual([]);
});


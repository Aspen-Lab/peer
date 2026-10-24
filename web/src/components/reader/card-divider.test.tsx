import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("react", async (original) => ({ ...await original<typeof import("react")>(), ...(await import("@/test-support/staged-runtime")).stagedRuntime.hooks }));
import type { ReactElement } from "react";
import { stagedRuntime } from "@/test-support/staged-runtime";
import { useWindows } from "@/lib/reader/windows";
import { CardDivider, cardDividerStep, type CardDividerProps } from "./card-divider";

const props: CardDividerProps = { above: "a", below: "b", top: 257, value: 257, pairHeight: 514, min: 80, max: 434 };
type Handlers = Record<string, (event: Record<string, unknown>) => void>;
function mount(overrides: Partial<CardDividerProps> = {}) { return stagedRuntime.mount(() => CardDivider({ ...props, ...overrides })); }
function handlers(run: ReturnType<typeof mount>) { return (run.value as ReactElement<Handlers>).props; }
const firstShare = () => useWindows.getState().windows[0].share;
beforeEach(() => {
  useWindows.setState({ windows: [], clock: 0, origin: null });
  useWindows.getState().open({ id: "a", kind: "sticky", title: "a" });
  useWindows.getState().open({ id: "b", kind: "explain", title: "b" });
});
afterEach(() => useWindows.setState({ windows: [], clock: 0, origin: null }));

describe("horizontal divider, actual store and event handlers", () => {
  for (const [min, max, equal] of [[97, 374, 257], [300, 374, 300], [97, 200, 200]] as const) {
    it(`Enter equalizes the actual pair with asymmetric bounds ${min}..${max}`, () => {
      useWindows.getState().open({ id: "c", kind: "sticky", title: "unaffected" });
      const original = useWindows.getState().windows.map((w) => w.share!);
      const total = original[0] + original[1];
      const run = mount({ value: min, min, max }); const preventDefault = vi.fn();
      stagedRuntime.event(() => handlers(run).onKeyDown({ key: "Enter", shiftKey: false, preventDefault }));
      const keyboard = useWindows.getState().windows.map((w) => w.share!);
      expect(keyboard[0]).toBeCloseTo(total * equal / 514);
      expect(keyboard[0] + keyboard[1]).toBeCloseTo(total);
      expect(keyboard[2]).toBe(original[2]);
      expect(preventDefault).toHaveBeenCalledOnce();
      stagedRuntime.event(() => handlers(run).onDoubleClick({}));
      expect(useWindows.getState().windows.map((w) => w.share!)).toEqual(keyboard);
      run.unmount();
    });
  }
  for (const [key, shift, result] of [["ArrowUp", false, 241], ["ArrowDown", false, 273], ["ArrowDown", true, 321], ["Home", false, 80], ["End", false, 434], ["Enter", false, 257]] as const) {
    it(`${key}${shift ? " Shift" : ""} changes only the bounded neighboring pair`, () => {
      const run = mount(); const preventDefault = vi.fn();
      stagedRuntime.event(() => handlers(run).onKeyDown({ key, shiftKey: shift, preventDefault }));
      expect(firstShare()).toBeCloseTo(result / 514);
      expect(useWindows.getState().windows[1].share).toBeCloseTo(1 - result / 514);
      expect(preventDefault).toHaveBeenCalledOnce(); run.unmount();
    });
  }
  it("leaves browser/system shortcuts and unrelated keys alone", () => {
    const run = mount(); const preventDefault = vi.fn();
    for (const event of [{ key: "ArrowDown", ctrlKey: true }, { key: "ArrowDown", altKey: true }, { key: "ArrowDown", metaKey: true }, { key: "Escape" }]) stagedRuntime.event(() => handlers(run).onKeyDown({ ...event, preventDefault }));
    expect(firstShare()).toBe(0.5); expect(preventDefault).not.toHaveBeenCalled(); run.unmount();
  });
  it("captures primary drag, ignores jitter/other pointer, bounds it, and restores a cancelled drag", () => {
    const run = mount(); const target = { focus: vi.fn(), setPointerCapture: vi.fn(), hasPointerCapture: () => true, releasePointerCapture: vi.fn() };
    const event = { pointerId: 7, button: 0, isPrimary: true, clientY: 257, currentTarget: target, preventDefault: vi.fn() };
    stagedRuntime.event(() => handlers(run).onPointerDown(event));
    expect(target.setPointerCapture).toHaveBeenCalledWith(7);
    stagedRuntime.event(() => handlers(run).onPointerMove({ ...event, clientY: 259 })); expect(firstShare()).toBe(0.5);
    stagedRuntime.event(() => handlers(run).onPointerMove({ ...event, pointerId: 8, clientY: 350 })); expect(firstShare()).toBe(0.5);
    stagedRuntime.event(() => handlers(run).onPointerMove({ ...event, clientY: 900 })); expect(firstShare()).toBeCloseTo(434 / 514);
    stagedRuntime.event(() => handlers(run).onPointerCancel({ ...event, type: "pointercancel" })); expect(firstShare()).toBe(0.5);
    expect(target.releasePointerCapture).toHaveBeenCalledWith(7);
    stagedRuntime.event(() => handlers(run).onPointerMove({ ...event, clientY: 300 })); expect(firstShare()).toBe(0.5); run.unmount();
  });
  it("commits release, rejects nonprimary starts, and loses no stale drag after unmount", () => {
    const run = mount(); const target = { focus: vi.fn(), setPointerCapture: vi.fn(), hasPointerCapture: () => false, releasePointerCapture: vi.fn() };
    const event = { pointerId: 2, button: 0, isPrimary: true, clientY: 257, currentTarget: target, preventDefault: vi.fn() };
    stagedRuntime.event(() => handlers(run).onPointerDown({ ...event, isPrimary: false })); expect(target.setPointerCapture).not.toHaveBeenCalled();
    stagedRuntime.event(() => handlers(run).onPointerDown(event));
    stagedRuntime.event(() => handlers(run).onPointerMove({ ...event, clientY: 287 }));
    stagedRuntime.event(() => handlers(run).onPointerUp({ ...event, type: "pointerup" })); expect(firstShare()).toBeCloseTo(287 / 514);
    const stale = handlers(run).onPointerMove; run.unmount(); stale({ ...event, clientY: 500 }); expect(firstShare()).toBeCloseTo(287 / 514);
  });
  it("announces horizontal semantics, adjacent controls and actual pixel limits", () => {
    const run = mount(); const p = (run.value as ReactElement<Record<string, unknown>>).props;
    expect(p).toMatchObject({ role: "separator", "aria-orientation": "horizontal", "aria-controls": "a b", "aria-valuemin": 80, "aria-valuemax": 434, "aria-valuenow": 257, tabIndex: 0 });
    expect(p.style).toMatchObject({ cursor: "row-resize", touchAction: "none", height: 12 }); run.unmount();
  });
  it("clamps keyboard bounds and leaves non-resize keys to their owner", () => {
    expect(cardDividerStep(81, "ArrowUp", true, 80, 434)).toBe(80);
    expect(cardDividerStep(433, "ArrowDown", true, 80, 434)).toBe(434);
    expect(cardDividerStep(257, "Escape", false, 80, 434)).toBeNull();
  });
});

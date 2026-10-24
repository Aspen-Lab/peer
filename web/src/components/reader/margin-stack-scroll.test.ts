import { afterEach, describe, expect, it, vi } from "vitest";
import { measuredCardMinimum } from "./margin-stack-scroll";
import { useWindows } from "@/lib/reader/windows";

// Direct geometry probes, not a claim about a rendered page. Browser matrix
// measurements separately check the same function with actual component boxes.
function card(kind: string, headerHeight: number, line: number, compact = false) {
  const header = { getBoundingClientRect: () => ({ height: headerHeight }) };
  const styles = new Map<object, object>();
  const body = { parentElement: null as unknown, querySelector: () => text };
  const text = { parentElement: body };
  const caption = {};
  const root = {
    dataset: { marginCard: kind, marginCompact: compact ? "true" : undefined },
    firstElementChild: header,
    querySelector: (selector: string) => selector === "[data-margin-fixed]" ? compact ? header : null : selector === "[data-margin-body]" ? body : selector === "[data-figure-zoom-row]" ? { getBoundingClientRect: () => ({ height: 36 }) } : selector === "[data-figure-caption]" ? caption : null,
  };
  body.parentElement = root;
  styles.set(text, { lineHeight: String(line), fontSize: "14", paddingTop: "0", paddingBottom: "0" });
  styles.set(body, { paddingTop: "12", paddingBottom: "12" });
  styles.set(caption, { lineHeight: String(line), paddingTop: "8", paddingBottom: "8" });
  vi.stubGlobal("getComputedStyle", (node: object) => styles.get(node));
  return root as unknown as HTMLElement;
}
afterEach(() => { vi.unstubAllGlobals(); useWindows.setState({ windows: [], clock: 0, origin: null }); });

describe("actual minimum furniture and stable store registration", () => {
  it("counts a custom48px sticky header, its content row, padding and border", () => {
    expect(measuredCardMinimum(card("sticky", 48, 22.4))).toBe(97);
    expect(measuredCardMinimum(card("sticky", 48, 35.96))).toBe(110);
  });
  it("counts the compact fixed Explain label plus an entire row at maximum type", () => {
    expect(measuredCardMinimum(card("explain", 40, 35.96, true))).toBe(94);
  });
  it("includes figure zoom, a caption row and an actual picture row", () => {
    expect(measuredCardMinimum(card("figure", 48, 22.4))).toBe(149);
  });
  it("writes only changed finite minima so ResizeObserver cannot make an update loop", () => {
    const state = useWindows.getState(); state.open({ id: "s", kind: "sticky", title: "s" });
    state.setMinimum("s", 97); expect(useWindows.getState().windows[0].minimum).toBe(97);
    const before = useWindows.getState().windows;
    for (const value of [97, 97.1, Number.NaN, Number.POSITIVE_INFINITY, 20]) state.setMinimum("s", value);
    state.setMinimum("missing", 100);
    expect(useWindows.getState().windows).toBe(before);
    state.setMinimum("s", 110); expect(useWindows.getState().windows[0].minimum).toBe(110);
  });
});

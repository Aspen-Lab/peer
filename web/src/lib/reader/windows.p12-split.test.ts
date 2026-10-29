import { afterEach, describe, expect, it } from "vitest";
import { splitHeights, stackLayout, useWindows, type FloatingWindow, type WindowKind } from "./windows";

// P12-04/ruling188: these exercise real page-session transitions, separately from DOM proof.
type SharedWindow = FloatingWindow & { share?: number };
type SplitStore = ReturnType<typeof useWindows.getState> & {
  resizePair: (above: string, below: string, aboveShare: number) => void;
};
const state = () => useWindows.getState() as SplitStore;
const shares = () => state().windows.map((w) => (w as SharedWindow).share);
const open = (id: string, kind: WindowKind = "sticky") => state().open({ id, kind, title: id, anchorTop: 300 });
afterEach(() => useWindows.setState({ windows: [], clock: 0, origin: null }));

describe("P12-04 session composition and adjacent shares", () => {
  it("uses the largest measured minimum for equal overcapacity shares rather than hiding bodies", () => {
    const windows = ["notes", "explain", "sticky", "figure", "highlight"].map((kind, i) => ({ id: kind, kind: kind as WindowKind, title: kind, order: i, share: 0.2, minimum: i === 3 ? 140 : 94 }));
    const heights = splitHeights(windows, 392);
    expect(heights).toEqual([140, 140, 140, 140, 140]);
    const rows = stackLayout(windows, { top: 48, minTop: 48, bottom: 440 });
    expect(rows.at(-1)!.top + rows.at(-1)!.height).toBe(48 + 700 + 48);
    expect(rows.every((r) => r.front)).toBe(true);
  });
  it("constrains a retained ratio to a measured minimum while still using every available pixel", () => {
    const windows = [{ id: "a", kind: "sticky" as const, title: "a", order: 1, share: 0.1, minimum: 120 }, { id: "b", kind: "notes" as const, title: "b", order: 2, share: 0.9, minimum: 80 }];
    expect(splitHeights(windows, 526)).toEqual([120, 394]);
    expect(windows.map((w) => w.share)).toEqual([0.1, 0.9]);
  });
  it("starts every new composition equally and never reorders a panel on activation", () => {
    open("a"); open("b", "explain"); open("c", "figure");
    expect(shares()).toEqual([1 / 3, 1 / 3, 1 / 3]);
    state().raise("a");
    const rows = stackLayout(state().windows, { top: 300, minTop: 48, bottom: 574 });
    expect(rows.map((row) => row.id)).toEqual(["a", "b", "c"]);
    expect(rows[0].top).toBe(48);
    expect(rows.every((row) => row.front)).toBe(true);
    expect(Math.max(...rows.map((r) => r.height)) - Math.min(...rows.map((r) => r.height))).toBeLessThanOrEqual(2);
  });

  it("resizes only an adjacent pair, keeps its total, and rejects a stale boundary", () => {
    open("a"); open("b"); open("c");
    state().resizePair("a", "b", 0.4);
    expect(shares()).toEqual([0.4, 2 / 3 - 0.4, 1 / 3]);
    const before = state().windows;
    state().resizePair("a", "c", 0.1);
    expect(state().windows).toBe(before);
  });

  it("distributes the released share equally and preserves survivor differences", () => {
    open("a"); open("b"); open("c");
    state().resizePair("a", "b", 0.4);
    state().close("c");
    expect(shares()[0]).toBeCloseTo(0.4 + 1 / 6);
    expect(shares()[1]).toBeCloseTo(2 / 3 - 0.4 + 1 / 6);
    expect((shares()[0] ?? 0) - (shares()[1] ?? 0)).toBeCloseTo(0.4 - (2 / 3 - 0.4));
    open("c");
    expect(shares()).toEqual([1 / 3, 1 / 3, 1 / 3]);
  });

  it("retains chosen ratios across viewport frames without storing a viewport", () => {
    open("a"); open("b"); state().resizePair("a", "b", 0.6);
    for (const bottom of [574, 680, 860, 1040, 574]) {
      const rows = stackLayout(state().windows, { top: 300, minTop: 48, bottom });
      expect(rows[0].height / (rows[0].height + rows[1].height)).toBeCloseTo(0.6);
      expect(rows[1].top + rows[1].height).toBeCloseTo(bottom);
    }
    expect(shares()).toEqual([0.6, 0.4]);
  });

  it("includes every card kind as a full panel and handles repeated composition cycles", () => {
    for (let n = 0; n < 30; n++) {
      for (const kind of ["notes", "explain", "sticky", "figure", "highlight"] as WindowKind[]) open(kind, kind);
      const rows = stackLayout(state().windows, { top: 300, minTop: 48, bottom: 1040 });
      expect(rows).toHaveLength(5);
      expect(rows.every((row) => row.front && row.height > 40)).toBe(true);
      for (const id of ["sticky", "notes", "figure", "highlight", "explain"]) state().close(id);
      expect(state().windows).toEqual([]);
      expect(state().origin).toBeNull();
    }
  });
});

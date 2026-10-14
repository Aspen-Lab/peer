import { beforeEach, describe, expect, it } from "vitest";
import { DOCK_TOP_PX } from "@/components/reader/explain-dock";
import { WINDOW_HEADER_PX, columnTop, stackLayout, useWindows } from "./windows";

// P10-09a (review 7.1a; ruling §1h.78): the windows at the right stand like cascaded cards — only the headers of
// the ones behind show (each later window offset by a header's height), the raised one in front and full; a header
// click raises it. `useWindows` holds `{ id, kind, title, order }`; `stackLayout` places them.

const sticky = (n: number) => ({ id: `s${n}`, kind: "sticky" as const, title: `Note ${n}` });

describe("useWindows", () => {
  beforeEach(() => useWindows.setState({ windows: [], clock: 0 }));

  it("opens windows in order, and opening one that is open raises it instead of making a second", () => {
    const { open } = useWindows.getState();
    open(sticky(1));
    open(sticky(2));
    open(sticky(1));
    const { windows } = useWindows.getState();
    expect(windows.map((w) => w.id).sort()).toEqual(["s1", "s2"]);
    const order = (id: string) => windows.find((w) => w.id === id)!.order;
    expect(order("s1")).toBeGreaterThan(order("s2"));
  });

  it("raises one above the rest and closes one without touching the others", () => {
    const { open, raise, close } = useWindows.getState();
    open(sticky(1));
    open(sticky(2));
    open(sticky(3));
    raise("s1");
    const top = [...useWindows.getState().windows].sort((a, b) => b.order - a.order)[0];
    expect(top.id).toBe("s1");
    close("s2");
    expect(useWindows.getState().windows.map((w) => w.id).sort()).toEqual(["s1", "s3"]);
    close("missing");
    expect(useWindows.getState().windows).toHaveLength(2);
  });

  it("keeps the kinds the next round joins to the stack", () => {
    const { open } = useWindows.getState();
    open({ id: "n", kind: "notes", title: "Your notes" });
    open({ id: "e", kind: "explain", title: "Explain" });
    expect(useWindows.getState().windows.map((w) => w.kind)).toEqual(["notes", "explain"]);
  });
});

describe("stackLayout", () => {
  const w = (id: string, order: number) => ({ id, kind: "sticky" as const, title: id, order });
  const frame = { top: 100, bottom: 900, frontHeight: 260 };

  it("offsets each later window by a header's height; the last raised is in front and full", () => {
    expect(WINDOW_HEADER_PX).toBe(40);
    const rows = stackLayout([w("a", 1), w("b", 2), w("c", 3)], frame);
    expect(rows.map((r) => [r.id, r.top])).toEqual([["a", 100], ["b", 140], ["c", 180]]);
    expect(rows.map((r) => r.front)).toEqual([false, false, true]);
    expect(rows.map((r) => r.height)).toEqual([40, 40, 260]);
    expect(rows[0].z).toBeLessThan(rows[1].z);
    expect(rows[1].z).toBeLessThan(rows[2].z);
  });

  it("brings the raised one to the front: a header click reorders the stack", () => {
    useWindows.setState({ windows: [], clock: 0 });
    const { open, raise } = useWindows.getState();
    open(sticky(1));
    open(sticky(2));
    open(sticky(3));
    raise("s1");
    const rows = stackLayout(useWindows.getState().windows, frame);
    expect(rows.map((r) => r.id)).toEqual(["s2", "s3", "s1"]);
    expect(rows[2]).toMatchObject({ id: "s1", front: true, top: 180 });
  });

  it("gives one window the whole front, and fits the front above the bottom", () => {
    expect(stackLayout([w("a", 1)], frame)[0]).toMatchObject({ top: 100, height: 260, front: true });
    const short = stackLayout([w("a", 1), w("b", 2)], { top: 100, bottom: 250, frontHeight: 260 });
    expect(short[1].top + short[1].height).toBeLessThanOrEqual(250);
    expect(short[1].height).toBeGreaterThanOrEqual(WINDOW_HEADER_PX);
    expect(stackLayout([], frame)).toEqual([]);
  });
});

describe("columnTop — under the explain window", () => {
  it("is the dock's top when no explain window stands", () => {
    expect(columnTop(null)).toBe(DOCK_TOP_PX);
  });

  it("is just under the explain window's bottom when one stands", () => {
    expect(columnTop({ bottom: 300 })).toBe(308);
  });

  it("is the dock's top plus 400 when the window stands but cannot be measured", () => {
    expect(columnTop({ bottom: 0 })).toBe(DOCK_TOP_PX + 400);
    expect(columnTop({ bottom: Number.NaN })).toBe(DOCK_TOP_PX + 400);
  });
});

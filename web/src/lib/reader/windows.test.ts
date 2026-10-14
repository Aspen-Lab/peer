import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DOCK_BOTTOM_PX, DOCK_STACK_FLOOR_PX, DOCK_THREAD_FLOOR_PX, DOCK_TOP_PX, DOCK_VAR, DOCK_WIDTH_VAR, columnBottomPx, dockInStack, legendHeightPx, reserveDock } from "@/components/reader/explain-dock";
import { block } from "@/lib/notes/blocks";
import { MIN_FRONT_PX, NOTES_MIN_FRONT_PX, NOTES_WINDOW_ID, WINDOW_HEADER_PX, bindWindowsReserve, columnTop, holdInPlace, stackLayout, stackRoom, stackRows, useWindows, type FloatingWindow } from "./windows";

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

  it("lifts the column, never above minTop, when the explain window stands so low the front would be squeezed", () => {
    const rows = stackLayout([w("a", 1), w("b", 2), w("c", 3)], { top: 800, bottom: 960, frontHeight: 260, minTop: 48 });
    expect(rows[0].top).toBeLessThan(800);
    expect(rows[2].height).toBeGreaterThanOrEqual(160);
    expect(rows[2].top + rows[2].height).toBeLessThanOrEqual(960);
    const high = stackLayout([w("a", 1), w("b", 2)], { top: 100, bottom: 250, frontHeight: 260, minTop: 90 });
    expect(high[0].top).toBeGreaterThanOrEqual(90);
    // Room enough, or no minTop: the column stays where it was asked.
    expect(stackLayout([w("a", 1), w("b", 2)], { top: 100, bottom: 900, frontHeight: 260, minTop: 48 })[0].top).toBe(100);
  });

  it("moves the column above the explain window when there is room there and none under it", () => {
    const rows = stackLayout([w("a", 1), w("b", 2), w("c", 3)], { top: 800, bottom: 960, frontHeight: 260, minTop: 48, ceiling: 700 });
    expect(rows[0].top).toBe(48);
    expect(rows[2].top + rows[2].height).toBeLessThanOrEqual(700);
    expect(rows[2].height).toBeGreaterThanOrEqual(160);
    // No room above either: lifted under the ceiling's reach as far as the screen allows, not above minTop.
    const tight = stackLayout([w("a", 1), w("b", 2), w("c", 3)], { top: 300, bottom: 360, frontHeight: 260, minTop: 48, ceiling: 200 });
    expect(tight[0].top).toBeGreaterThanOrEqual(48);
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

// P10-09c (review 7.1a, rubric B9): the notes window stands in the same stack as the sticky notes. The layout takes every
// kind in one cascade: 40 px apart, the last raised in front and whole, the others only their headers; the notes window
// takes what the screen leaves when it is in front (it scrolls inside itself) and is lifted, not squeezed, below 240 px.
describe("stackLayout — the notes window and the stickies in one cascade (P10-09c)", () => {
  const sticky = (id: string, order: number) => ({ id, kind: "sticky" as const, title: id, order });
  const notes = (order: number) => ({ id: NOTES_WINDOW_ID, kind: "notes" as const, title: "Your notes", order });
  const frame = { top: 100, bottom: 900, frontHeight: 260 };

  it("opening the notes window while three stickies stand makes four cards, 40 px apart, the notes window in front", () => {
    const rows = stackLayout([sticky("a", 1), sticky("b", 2), sticky("c", 3), notes(4)], frame);
    expect(rows.map((r) => [r.id, r.top])).toEqual([["a", 100], ["b", 140], ["c", 180], [NOTES_WINDOW_ID, 220]]);
    expect(rows.map((r) => r.front)).toEqual([false, false, false, true]);
    expect(rows.map((r) => r.height).slice(0, 3)).toEqual([40, 40, 40]);
    // In front the notes window takes what the screen leaves, not a sticky's 260.
    expect(rows[3].height).toBe(900 - 220);
    expect(new Set(rows.map((r) => r.z)).size).toBe(4);
  });

  it("raising a sticky brings it in front of the notes window, and raising the notes window brings it back", () => {
    useWindows.setState({ windows: [], clock: 0 });
    const { open, raise } = useWindows.getState();
    open({ id: "a", kind: "sticky", title: "Note 1" });
    open({ id: "b", kind: "sticky", title: "Note 2" });
    open({ id: NOTES_WINDOW_ID, kind: "notes", title: "Your notes" });
    expect(stackLayout(useWindows.getState().windows, frame).map((r) => r.id)).toEqual(["a", "b", NOTES_WINDOW_ID]);
    raise("a");
    const rows = stackLayout(useWindows.getState().windows, frame);
    expect(rows.map((r) => r.id)).toEqual(["b", NOTES_WINDOW_ID, "a"]);
    expect(rows[2]).toMatchObject({ id: "a", front: true, top: 180, height: 260 });
    expect(rows[1]).toMatchObject({ id: NOTES_WINDOW_ID, front: false, height: 40 });
    raise(NOTES_WINDOW_ID);
    expect(stackLayout(useWindows.getState().windows, frame).map((r) => r.id)).toEqual(["b", "a", NOTES_WINDOW_ID]);
  });

  // The four cases the notes window's own box (`notesWindowBox`, P10-09b) used to answer, re-aimed to the stack (§1c).
  it("the notes window alone stands at the dock's top and takes the height down to the legend", () => {
    const rows = stackLayout([notes(1)], { top: columnTop(null), bottom: 1000 - 32 - 8, frontHeight: 260, minTop: DOCK_TOP_PX });
    expect(rows[0].top).toBe(DOCK_TOP_PX);
    expect(rows[0].height).toBe(1000 - DOCK_TOP_PX - 32 - 8);
  });

  it("the notes window stands under the explain window with a gap, and takes what is left above the legend", () => {
    const rows = stackLayout([notes(1)], { top: columnTop({ bottom: 500 }), bottom: 960, frontHeight: 260, minTop: DOCK_TOP_PX });
    expect(rows[0].top).toBe(500 + 8);
    expect(rows[0].height).toBe(960 - 508);
  });

  it("the notes window is lifted, never shrunk below a height you can write in, when the explain window is low", () => {
    expect(NOTES_MIN_FRONT_PX).toBe(240);
    const rows = stackLayout([notes(1)], { top: columnTop({ bottom: 960 }), bottom: 960, frontHeight: 260, minTop: DOCK_TOP_PX });
    expect(rows[0].height).toBe(NOTES_MIN_FRONT_PX);
    expect(rows[0].top).toBe(960 - NOTES_MIN_FRONT_PX);
  });

  it("the notes window never stands above the masthead", () => {
    const rows = stackLayout([notes(1)], { top: DOCK_TOP_PX, bottom: 300 - 40, frontHeight: 260, minTop: DOCK_TOP_PX });
    expect(rows[0].top).toBeGreaterThanOrEqual(DOCK_TOP_PX);
  });
});

describe("stackRows — which windows stand in the column (P10-09c)", () => {
  const frame = { top: 100, bottom: 900, frontHeight: 260 };
  const heads = [1, 2].map((n) => block("h3", `Note ${n}`, { anchor: { paperId: "p", paragraphId: `paper-section-0-p${n}`, quote: "q", n } }));
  const sticky = (id: string, order: number) => ({ id, kind: "sticky" as const, title: id, order });

  it("holds the notes window and every sticky whose heading is in the note, and nothing else", () => {
    const windows = [
      sticky(heads[0].id, 1),
      sticky("gone", 2),
      { id: NOTES_WINDOW_ID, kind: "notes" as const, title: "Your notes", order: 3 },
      { id: "e", kind: "explain" as const, title: "Explain", order: 4 },
      sticky(heads[1].id, 5),
    ];
    const rows = stackRows(windows, heads, frame);
    expect(rows.map((r) => r.id)).toEqual([heads[0].id, NOTES_WINDOW_ID, heads[1].id]);
    expect(rows.map((r) => r.top)).toEqual([100, 140, 180]);
  });

  it("is the same cascade whoever asks: the stickies' view and the notes window's view agree", () => {
    const windows = [sticky(heads[0].id, 1), { id: NOTES_WINDOW_ID, kind: "notes" as const, title: "Your notes", order: 2 }];
    expect(stackRows(windows, heads, frame)).toEqual(stackRows([...windows].reverse(), heads, frame));
  });
});

// ── One reserved column for every window at the right (P10-09d, X-B1; ruling §1h.87 (c)) ────────────────────────────
//
// The explain window reserves the dock's column (`--explain-dock`) and the text reflows beside it; the stickies and the notes
// window stood over the text (A P10-10: about 150 px of every line beside a sticky unreadable at 1440). Now the stack takes the
// same, counted reserve when its first window registers and gives it back when its last leaves, from 1024 px only.

/** A root that records its properties, and a window whose width and resizes the test drives. */
function fakeEnv(width = 1440) {
  const props = new Map<string, string>();
  const style = {
    setProperty: (name: string, value: string) => void props.set(name, value),
    removeProperty: (name: string) => (props.delete(name), ""),
  };
  const listeners = new Set<() => void>();
  const env = {
    root: { style },
    width: () => env.w,
    w: width,
    onResize: (cb: () => void) => {
      listeners.add(cb);
      return () => void listeners.delete(cb);
    },
  };
  const resize = (next: number) => {
    env.w = next;
    for (const cb of [...listeners]) cb();
  };
  return { env, props, resize, reserved: () => props.has(DOCK_VAR) && props.has(DOCK_WIDTH_VAR) };
}

describe("every floating window reserves the column (P10-09d, rule 1)", () => {
  let unbind: (() => void) | undefined;
  beforeEach(() => useWindows.setState({ windows: [], clock: 0 }));
  afterEach(() => {
    unbind?.();
    unbind = undefined;
    useWindows.setState({ windows: [], clock: 0 });
  });

  it("the first window of any kind sets the page's reserve (376 px, the dock's 360 beside it) and the last to leave takes it off", () => {
    const f = fakeEnv();
    unbind = bindWindowsReserve(f.env);
    expect(f.reserved()).toBe(false);
    useWindows.getState().open(sticky(1));
    expect(f.props.get(DOCK_VAR)).toBe("376px");
    expect(f.props.get(DOCK_WIDTH_VAR)).toBe("360px");
    useWindows.getState().open(sticky(2));
    useWindows.getState().open({ id: NOTES_WINDOW_ID, kind: "notes", title: "Your notes" });
    useWindows.getState().close("s1");
    useWindows.getState().close(NOTES_WINDOW_ID);
    expect(f.reserved()).toBe(true);
    useWindows.getState().close("s2");
    expect(f.reserved()).toBe(false);
  });

  it("the notes window alone reserves it, as a sticky does", () => {
    const f = fakeEnv();
    unbind = bindWindowsReserve(f.env);
    useWindows.getState().open({ id: NOTES_WINDOW_ID, kind: "notes", title: "Your notes" });
    expect(f.reserved()).toBe(true);
    useWindows.getState().close(NOTES_WINDOW_ID);
    expect(f.reserved()).toBe(false);
  });

  it("is one reserve shared with the explain window, in every order: the last of them to go takes it off", () => {
    const f = fakeEnv();
    unbind = bindWindowsReserve(f.env);
    // open explain, open sticky, close explain: still reserved; close the sticky: released
    const explain = reserveDock(f.env.root);
    useWindows.getState().open(sticky(1));
    explain();
    expect(f.reserved()).toBe(true);
    useWindows.getState().close("s1");
    expect(f.reserved()).toBe(false);
    // open sticky, open explain, close sticky: still reserved; close explain: released
    useWindows.getState().open(sticky(2));
    const again = reserveDock(f.env.root);
    useWindows.getState().close("s2");
    expect(f.reserved()).toBe(true);
    again();
    expect(f.reserved()).toBe(false);
  });

  it("opening a window the explain window's reserve already covers changes nothing on the page", () => {
    const f = fakeEnv();
    unbind = bindWindowsReserve(f.env);
    const explain = reserveDock(f.env.root);
    const before = [...f.props];
    useWindows.getState().open(sticky(1));
    expect([...f.props]).toEqual(before);
    explain();
    useWindows.getState().close("s1");
  });

  it("reserves nothing under 1024 px, and follows the window across it", () => {
    const f = fakeEnv(900);
    unbind = bindWindowsReserve(f.env);
    useWindows.getState().open(sticky(1));
    expect(f.reserved()).toBe(false);
    f.resize(1023);
    expect(f.reserved()).toBe(false);
    f.resize(1024);
    expect(f.reserved()).toBe(true);
    f.resize(800);
    expect(f.reserved()).toBe(false);
    f.resize(1440);
    useWindows.getState().close("s1");
    expect(f.reserved()).toBe(false);
  });

  it("an open window on a wide screen that is then narrowed does not unbalance the explain window's own take", () => {
    const f = fakeEnv(1440);
    unbind = bindWindowsReserve(f.env);
    const explain = reserveDock(f.env.root);
    useWindows.getState().open(sticky(1));
    f.resize(800);
    expect(f.reserved()).toBe(true);
    explain();
    expect(f.reserved()).toBe(false);
    f.resize(1440);
    expect(f.reserved()).toBe(true);
    useWindows.getState().close("s1");
    expect(f.reserved()).toBe(false);
  });

  it("unbinding gives the reserve back", () => {
    const f = fakeEnv();
    const off = bindWindowsReserve(f.env);
    useWindows.getState().open(sticky(1));
    expect(f.reserved()).toBe(true);
    off();
    expect(f.reserved()).toBe(false);
  });

  it("raising or retitling a window keeps one take, not two", () => {
    const f = fakeEnv();
    unbind = bindWindowsReserve(f.env);
    useWindows.getState().open(sticky(1));
    useWindows.getState().open(sticky(1));
    useWindows.getState().raise("s1");
    useWindows.getState().close("s1");
    expect(f.reserved()).toBe(false);
  });
});

describe("holdInPlace — the reader's words stay where the eyes are (P10-09d, rule 2; P7-15's measure-before / measure-after)", () => {
  it("measures, changes the layout, measures again and scrolls by the difference", () => {
    let top = 300;
    const scroll = vi.fn();
    holdInPlace({ measure: () => top, change: () => void (top = 520), scroll });
    expect(scroll).toHaveBeenCalledExactlyOnceWith(220);
  });

  it("does not scroll for a move under a pixel, nor where there is nothing to measure", () => {
    const scroll = vi.fn();
    let top = 300;
    holdInPlace({ measure: () => top, change: () => void (top = 300.4), scroll });
    const change = vi.fn();
    holdInPlace({ measure: () => undefined, change, scroll });
    expect(change).toHaveBeenCalledTimes(1);
    expect(scroll).not.toHaveBeenCalled();
  });
});

// P10-18 (A P10-14 §4 X-B1, B9; ruling §1h.93 (a)): the explain window stands at z 70 over the stack (z 60+), and used to stand over
// the stickies' headers, their X and the notes window's Export once it, three stickies and the notes window were more than the
// screen. Now it gives the stack room: it shrinks (its body scrolls inside), so every other window's header is reachable.
describe("every window's header is reachable under the explain window (P10-18, X-B1, B9)", () => {
  const sticky = (n: number, order: number) => ({ id: `s${n}`, kind: "sticky" as const, title: `Note ${n}`, order });
  const notes = (order: number) => ({ id: NOTES_WINDOW_ID, kind: "notes" as const, title: "Your notes", order });

  // The six orders of opening the dump measured (A P10-14, `stack-orders`): the explain window is always in front of the stack
  // (z 70), so what an order changes is which window of the column is the front — a sticky or the notes window — and how many.
  const orders: Array<[string, FloatingWindow[]]> = [
    ["explain, then 3 stickies", [sticky(1, 1), sticky(2, 2), sticky(3, 3)]],
    ["3 stickies, then explain", [sticky(1, 1), sticky(2, 2), sticky(3, 3)]],
    ["explain, then 3 stickies, then the notes window", [sticky(1, 1), sticky(2, 2), sticky(3, 3), notes(4)]],
    ["3 stickies, then explain, then the notes window", [sticky(1, 1), sticky(2, 2), sticky(3, 3), notes(4)]],
    ["3 stickies, then the notes window, then explain", [sticky(1, 1), sticky(2, 2), sticky(3, 3), notes(4)]],
    ["the notes window first, then 3 stickies, explain last", [notes(1), sticky(1, 2), sticky(2, 3), sticky(3, 4)]],
  ];

  /** The page as the column and the explain window read it: the explain window's box from the dock's placement (the
   *  window's natural height `natural`, as a thread of several answers makes it), the column's frame from that box. */
  function stand(width: number, height: number, windows: Parameters<typeof stackRoom>[0], paragraphTop: number, natural = 449) {
    const legend = DOCK_BOTTOM_PX;
    const plainTop = Math.min(Math.max(paragraphTop, DOCK_TOP_PX), height - legend - Math.max(natural, DOCK_THREAD_FLOOR_PX));
    const placed = dockInStack({ top: plainTop, paragraphTop, height, legend, room: stackRoom(windows) });
    const box = { top: placed.top, bottom: placed.top + Math.min(natural, placed.maxHeight) };
    const frame = { top: columnTop({ bottom: box.bottom }), bottom: columnBottomPx(height, legend), ceiling: Math.floor(box.top), frontHeight: 260, minTop: DOCK_TOP_PX };
    return { width, box, frame, rows: stackLayout(windows, frame) };
  }

  for (const [width, height] of [[1280, 720], [1440, 1000]] as const) {
    for (const [name, windows] of orders) {
      it(`${width} × ${height}, ${name}: no header stands under the explain window, and every one is on the screen`, () => {
        for (const paragraphTop of [48, 243, 296, 450, 700, 900]) {
          const { box, frame, rows } = stand(width, height, windows, paragraphTop);
          expect(rows).toHaveLength(windows.length);
          for (const row of rows) {
            const header = { top: row.top, bottom: row.top + WINDOW_HEADER_PX };
            const clear = header.bottom <= box.top || header.top >= box.bottom;
            expect(clear, `${name}, paragraph at ${paragraphTop}: header ${header.top}-${header.bottom} against the explain window ${box.top}-${box.bottom}`).toBe(true);
            expect(header.top).toBeGreaterThanOrEqual(DOCK_TOP_PX);
            expect(header.bottom).toBeLessThanOrEqual(frame.bottom + 8);
          }
          // The headers do not stand on each other either: 40 px apart, so each one's X is its own.
          const tops = rows.map((r) => r.top);
          for (let i = 1; i < tops.length; i += 1) expect(tops[i] - tops[i - 1]).toBeGreaterThanOrEqual(WINDOW_HEADER_PX);
          // The explain window keeps what it needs to be used: its header, its follow-up field and Send (rule 2).
          expect(box.bottom - box.top).toBeGreaterThanOrEqual(250);
          expect(box.bottom).toBeLessThanOrEqual(height - DOCK_BOTTOM_PX);
        }
      });
    }
  }

  it("the explain window gives way only as much as the stack needs: the front keeps its usable height beside it", () => {
    const four = [sticky(1, 1), sticky(2, 2), sticky(3, 3), notes(4)];
    const { rows } = stand(1280, 720, four, 243);
    expect(rows[3].height).toBeGreaterThanOrEqual(NOTES_MIN_FRONT_PX);
    const three = [sticky(1, 1), sticky(2, 2), sticky(3, 3)];
    expect(stand(1440, 1000, three, 296).rows[2].height).toBeGreaterThanOrEqual(MIN_FRONT_PX);
  });

  it("stackRoom is what the explain window must leave: a gap, a header per window behind, and the front's least height", () => {
    expect(stackRoom([])).toBe(0);
    expect(stackRoom([sticky(1, 1)])).toBe(8 + MIN_FRONT_PX);
    expect(stackRoom([sticky(1, 1), sticky(2, 2), sticky(3, 3)])).toBe(8 + 2 * WINDOW_HEADER_PX + MIN_FRONT_PX);
    expect(stackRoom([sticky(1, 1), sticky(2, 2), sticky(3, 3), notes(4)])).toBe(8 + 3 * WINDOW_HEADER_PX + NOTES_MIN_FRONT_PX);
    // The notes window behind a sticky: the sticky is the front.
    expect(stackRoom([notes(1), sticky(1, 2)])).toBe(8 + WINDOW_HEADER_PX + MIN_FRONT_PX);
    // An explain window in the store is not part of the column.
    expect(stackRoom([{ id: "e", kind: "explain", title: "Explain", order: 1 }])).toBe(0);
  });

  it("with the explain window standing and the column unable to rise above it, the column never lifts under it: the front gives way, not the headers", () => {
    const rows = stackLayout([sticky(1, 1), sticky(2, 2), sticky(3, 3)], { top: 640, bottom: 680, frontHeight: 260, minTop: DOCK_TOP_PX, ceiling: 200 });
    expect(rows[0].top).toBe(640);
    expect(rows.every((r) => r.top >= 640)).toBe(true);
    expect(rows[2].height).toBeGreaterThanOrEqual(WINDOW_HEADER_PX);
  });
});

// P10-31 (BACKLOG-86, 42): the stack on screens under 560 px high, and in Fit. Measured in the stubbed server (port 4045, an invented PDF,
// the explain window with two follow-up replies, then stickies and the notes window in five orders): at 1280 × 520 the explain window
// 48-298 (its floor, scrolling inside), the column 306-480 (the screen's 520 less the 40 px foot); at 1024 × 480 the same, the column
// ending at 440; every header's X and the notes window's header answered `elementFromPoint`. The arithmetic below is the page's own
// (the dock's placement, the column's frame, the stack's layout) at those sizes; the numbers are the measured boxes.
describe("the stack on short screens (P10-31, BACKLOG-86)", () => {
  const stk = (n: number, order: number) => ({ id: `s${n}`, kind: "sticky" as const, title: `Note ${n}`, order });
  const nts = (order: number) => ({ id: NOTES_WINDOW_ID, kind: "notes" as const, title: "Your notes", order });

  function stand(height: number, windows: Parameters<typeof stackRoom>[0], paragraphTop: number, legend = DOCK_BOTTOM_PX, natural = 449) {
    const plainTop = Math.min(Math.max(paragraphTop, DOCK_TOP_PX), height - legend - Math.max(natural, DOCK_THREAD_FLOOR_PX));
    const placed = dockInStack({ top: plainTop, paragraphTop, height, legend, room: stackRoom(windows) });
    const box = { top: placed.top, bottom: placed.top + Math.min(natural, placed.maxHeight) };
    const frame = { top: columnTop({ bottom: box.bottom }), bottom: columnBottomPx(height, legend), ceiling: Math.floor(box.top), frontHeight: 260, minTop: DOCK_TOP_PX };
    return { box, frame, rows: stackLayout(windows, frame) };
  }
  const cases: Array<[string, FloatingWindow[]]> = [
    ["two stickies", [stk(1, 1), stk(2, 2)]],
    ["the notes window and a sticky", [nts(1), stk(1, 2)]],
    ["the notes window and two stickies", [nts(1), stk(1, 2), stk(2, 3)]],
  ];

  for (const [height, expected] of [[520, { explainBottom: 298, columnBottom: 480 }], [480, { explainBottom: 298, columnBottom: 440 }]] as const) {
    for (const [name, windows] of cases) {
      it(`${height} px high, ${name}: every header is on the screen and clear of the explain window, which keeps its floor`, () => {
        for (const paragraphTop of [48, 300, 450, 700]) {
          const { box, frame, rows } = stand(height, windows, paragraphTop);
          // The explain window keeps what it needs (its header, follow-up field and Send) and stands at the masthead's foot.
          expect(box.top).toBe(DOCK_TOP_PX);
          expect(box.bottom - box.top).toBe(DOCK_STACK_FLOOR_PX);
          expect(box.bottom).toBe(expected.explainBottom);
          expect(frame.bottom).toBe(expected.columnBottom);
          expect(rows).toHaveLength(windows.length);
          for (const row of rows) {
            const header = { top: row.top, bottom: row.top + WINDOW_HEADER_PX };
            expect(header.top, `a header stands under the explain window: ${header.top}-${header.bottom} against ${box.top}-${box.bottom}`).toBeGreaterThanOrEqual(box.bottom);
            expect(header.bottom).toBeLessThanOrEqual(frame.bottom);
            expect(row.top + row.height, "the window's foot is on the screen, above the foot legend").toBeLessThanOrEqual(frame.bottom);
          }
          // The column collapses toward its headers rather than leaving the screen: the front is at least a header, the others exactly one.
          const front = rows[rows.length - 1];
          expect(front.height).toBeGreaterThanOrEqual(WINDOW_HEADER_PX);
          for (const row of rows.slice(0, -1)) expect(row.height).toBe(WINDOW_HEADER_PX);
        }
      });
    }
  }

  it("what the explain window must leave is what the measured stack took: 208 px for two stickies, 328 for the notes window and two stickies", () => {
    expect(stackRoom([stk(1, 1), stk(2, 2)])).toBe(8 + WINDOW_HEADER_PX + MIN_FRONT_PX);
    expect(stackRoom([stk(1, 1), stk(2, 2)])).toBe(208);
    expect(stackRoom([nts(1), stk(1, 2)])).toBe(208);
    expect(stackRoom([nts(1), stk(1, 2), stk(2, 3)])).toBe(8 + 2 * WINDOW_HEADER_PX + MIN_FRONT_PX);
    expect(stackRoom([stk(1, 1), nts(2)])).toBe(8 + WINDOW_HEADER_PX + NOTES_MIN_FRONT_PX);
  });

  it("a screen that cannot give the whole room gives what is above the floor: the explain window holds 250 px, the column's front gives way", () => {
    // 480 px high: the column's foot is 440; 48 + 250 + 8 leaves 134 below the explain window, the room asked is 208 — short by 74.
    const { box, frame } = stand(480, [stk(1, 1), stk(2, 2)], 48);
    expect(frame.bottom - (box.bottom + 8)).toBe(134);
    expect(stackRoom([stk(1, 1), stk(2, 2)]) - 134).toBe(74);
    expect(box.bottom - box.top).toBe(DOCK_STACK_FLOOR_PX);
  });

  it("with the explain window and four windows on a screen under 560 px high, no header is lower than the screen", () => {
    // At 480 the fourth header's foot (466) passes the column's foot (440) by 14 px, into the legend's strip, and stays 14 px above the
    // screen's end (BACKLOG-86's remainder: a header over the legend's strip, never one off-screen).
    const four = [stk(1, 1), stk(2, 2), stk(3, 3), nts(4)];
    for (const height of [520, 480]) {
      const { rows } = stand(height, four, 48);
      expect(rows[rows.length - 1].top + WINDOW_HEADER_PX, `${height} px`).toBeLessThanOrEqual(height);
    }
  });
});

// P10-31 (BACKLOG-42, measured CLOSED by P9-20): in Fit mode the page's zoom scales the foot legend, and the explain window and the column
// stand on its top, not on a flat 28 px. Measured in the stubbed server, the window grown to its cap by four follow-ups: the legend's box
// 968-1000 / 1041.4-1080 / 1388.5-1440 at 1440 × 1000 / 1920 × 1080 / 2560 × 1440 (zoom 1.1418 / 1.3784 / 1.8378), the window's bottom on
// exactly the legend's top — an overlap of 0 px at all three (A P8-05 had 4 / 11 / 23).
describe("Fit mode: the windows stand on the legend's own top (P10-31, BACKLOG-42)", () => {
  const stk = (n: number, order: number) => ({ id: `s${n}`, kind: "sticky" as const, title: `Note ${n}`, order });
  const fits: Array<[number, number, number, number]> = [[1440, 1000, 1.1417910447761195, 968], [1920, 1080, 1.3783783783783783, 1041.4], [2560, 1440, 1.837837837837838, 1388.5]];

  for (const [width, height, zoom, legendTop] of fits) {
    it(`${width} × ${height} at zoom ${zoom.toFixed(3)}: the explain window ends on the legend's top (${legendTop}), the column above its box`, () => {
      const legend = legendHeightPx(zoom);
      expect(height - legend).toBeCloseTo(legendTop, 0);
      // Alone, grown to its cap: its bottom is the legend's top, overlap 0 where a flat 28 left 4 / 10.6 / 23.5.
      const alone = dockInStack({ top: 48, paragraphTop: 48, height, legend, room: 0 });
      expect(alone.top + alone.maxHeight).toBeCloseTo(legendTop, 0);
      expect(alone.top + alone.maxHeight).toBeLessThanOrEqual(height - legend + 1e-9);
      expect(alone.top + alone.maxHeight).toBeLessThan(height - DOCK_BOTTOM_PX + 1e-9);
      // With three stickies beside it the column's foot is above the legend too, and so is the explain window's.
      const windows = [stk(1, 1), stk(2, 2), stk(3, 3)];
      const placed = dockInStack({ top: 48, paragraphTop: 48, height, legend, room: stackRoom(windows) });
      expect(placed.top + placed.maxHeight).toBeLessThanOrEqual(height - legend);
      const frame = { top: columnTop({ bottom: placed.top + placed.maxHeight }), bottom: columnBottomPx(height, legend), minTop: DOCK_TOP_PX, frontHeight: 260 };
      expect(frame.bottom).toBeLessThanOrEqual(height - legend);
      for (const row of stackLayout(windows, frame)) expect(row.top + row.height).toBeLessThanOrEqual(height - legend);
    });
  }

  it("the flat 28 px would have overlapped: the legend is taller than its reserve by the Fit scale (the bug BACKLOG-42 named)", () => {
    for (const [, , zoom] of fits) expect(legendHeightPx(zoom)).toBeGreaterThan(DOCK_BOTTOM_PX);
    expect(legendHeightPx(1)).toBe(DOCK_BOTTOM_PX);
    expect(legendHeightPx(Number.NaN)).toBe(DOCK_BOTTOM_PX);
  });
});

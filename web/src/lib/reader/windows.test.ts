import { beforeEach, describe, expect, it } from "vitest";
import { DOCK_BOTTOM_PX, DOCK_STACK_FLOOR_PX, DOCK_TOP_PX, columnBottomPx, legendHeightPx } from "@/components/reader/explain-dock";
import { block } from "@/lib/notes/blocks";
import { EXPLAIN_WINDOW_ID, LEAST_FRONT_PX, MIN_FRONT_PX, NOTES_MIN_FRONT_PX, NOTES_WINDOW_ID, WINDOW_HEADER_PX, stackFrameIn, stackLayout, stackRows, useWindows, type FloatingWindow } from "./windows";

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

  // P11-14 (rule 4; retired, §1c): "moves the column above the explain window when there is room there and none under it" — the column
  // stepped round the explain window's box (`ceiling`): above it where it fitted, lifted under it where it did not. The explain card is a
  // card of the stack now and nothing stands over the others, so there is no ceiling; what the case protected — the front keeps a usable
  // height and the headers stay on the screen — is asserted with the explain card among the windows ("every card's header is reachable…").

  it("gives one window the whole front, and fits the front above the bottom", () => {
    expect(stackLayout([w("a", 1)], frame)[0]).toMatchObject({ top: 100, height: 260, front: true });
    const short = stackLayout([w("a", 1), w("b", 2)], { top: 100, bottom: 250, frontHeight: 260 });
    expect(short[1].top + short[1].height).toBeLessThanOrEqual(250);
    expect(short[1].height).toBeGreaterThanOrEqual(WINDOW_HEADER_PX);
    expect(stackLayout([], frame)).toEqual([]);
  });
});

// P11-14 (rule 4; retired, §1c): "columnTop — under the explain window" — three cases of where the column started: the dock's top with no
// explain window, just under its bottom (+ 8) when one stood, the dock's top + 400 when it stood but could not be measured. The column
// does not read the explain window's box any more (it is a card of the stack, and the cascade starts at its origin — R-open, `stackFrameIn`),
// so `columnTop` is deleted with these three cases.

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
    const rows = stackLayout([notes(1)], { top: DOCK_TOP_PX, bottom: 1000 - 32 - 8, frontHeight: 260, minTop: DOCK_TOP_PX });
    expect(rows[0].top).toBe(DOCK_TOP_PX);
    expect(rows[0].height).toBe(1000 - DOCK_TOP_PX - 32 - 8);
  });

  // P11-14 (re-aimed, §1c): was "stands under the explain window with a gap" (`columnTop({ bottom: 500 })` = 508). The explain window is no longer
  // above the column; the same layout is asked of a cascade that starts low (508, the origin R-open gave it).
  it("the notes window stands where the cascade starts, and takes what is left above the legend", () => {
    const rows = stackLayout([notes(1)], { top: 508, bottom: 960, frontHeight: 260, minTop: DOCK_TOP_PX });
    expect(rows[0].top).toBe(508);
    expect(rows[0].height).toBe(960 - 508);
  });

  it("the notes window is lifted, never shrunk below a height you can write in, when the cascade starts low (re-aimed, P11-14: was \"when the explain window is low\")", () => {
    expect(NOTES_MIN_FRONT_PX).toBe(240);
    const rows = stackLayout([notes(1)], { top: 968, bottom: 960, frontHeight: 260, minTop: DOCK_TOP_PX });
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

  // P11-14 (re-aimed, §1c; rule 4): was "holds the notes window and every sticky whose heading is in the note, and nothing else" with an explain
  // window in the list that the rows left out. The explain card is a card of the stack now (see "stackRows — the explain card is one of the
  // stack"); what is asserted here is unchanged: a sticky whose heading is gone takes no slot.
  it("holds the notes window and every sticky whose heading is in the note, and no slot for one whose heading is gone", () => {
    const windows = [
      sticky(heads[0].id, 1),
      sticky("gone", 2),
      { id: NOTES_WINDOW_ID, kind: "notes" as const, title: "Your notes", order: 3 },
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

// ── Retired with the reserve (P11-14, rule 3; B P11-01 §3.1, §4 C4) ───────────────────────────────────────────────────────────────
//
// Two groups of cases lived here — "every floating window reserves the column (P10-09d, rule 1)", eight cases of `bindWindowsReserve`
// (the first window of any kind sets the page's 376 px reserve and the last to leave takes it off; one reserve shared with the explain
// window in every order; nothing under 1024 px; a count that survives a resize; unbinding gives it back), and "holdInPlace — the reader's
// words stay where the eyes are (P10-09d, rule 2)", two cases of the measure-before / measure-after scroll. The margin is a track of the
// reader's shell, so no card reserves anything and nothing reflows when one opens: the functions are deleted, and with them these ten
// cases. What they protected — the words do not move when a card opens — is pinned on the new mechanism: `explain-dock.retired.test.ts`
// (no reserve, no custom property, no padding on <main>, no scroll compensation in the box or the stack), `explain-box.stack.flow.test.tsx`
// (opening the explain card writes nothing on the root and scrolls nothing) and `sticky-note.test.tsx` ("a sticky reserves nothing and
// moves nothing").

// P10-18 (A P10-14 §4 X-B1, B9; ruling §1h.93 (a)): the explain window stood at z 70 over the stack (z 60+), and used to stand over the
// stickies' headers, their X and the notes window's Export once it, three stickies and the notes window were more than the screen; it
// gave the stack room (it shrank, `dockInStack`, `stackRoom`) so every other window's header was reachable.
//
// P11-14 (rule 4; O-8, BACKLOG-66; re-aimed, §1c): the explain card is a card of the stack. The cases below keep P10-18's, P10-31's
// scenarios — the six orders in which the dump measured the windows were opened, the short screens, Fit — and their claim: every header
// stands inside the band and is reachable, 40 px apart, and the front keeps a usable height. They are asked of the one stack layout
// with the explain card among the windows, where they were asked of the dock's shrinking beside it. Retired with the functions they
// tested: `stackRoom is what the explain window must leave…` (one case), `dockInStack` (7 cases in explain-dock.test.ts) and the
// `ceiling` branch of `stackLayout`.
describe("every card's header is reachable with the explain card in the stack (P10-18, X-B1, B9; re-aimed, P11-14: was \"…under the explain window\")", () => {
  const sticky = (n: number, order: number) => ({ id: `s${n}`, kind: "sticky" as const, title: `Note ${n}`, order });
  const notes = (order: number) => ({ id: NOTES_WINDOW_ID, kind: "notes" as const, title: "Your notes", order });
  const explain = (order: number) => ({ id: EXPLAIN_WINDOW_ID, kind: "explain" as const, title: "Explain this", order });

  // The six orders of opening the dump measured (A P10-14, `stack-orders`), now with the explain card where it was opened: first, in the
  // middle, last, and before or after the notes window — so the front is a sticky, the notes window or the explain card.
  const orders: Array<[string, FloatingWindow[]]> = [
    ["explain, then 3 stickies", [explain(1), sticky(1, 2), sticky(2, 3), sticky(3, 4)]],
    ["3 stickies, then explain", [sticky(1, 1), sticky(2, 2), sticky(3, 3), explain(4)]],
    ["explain, then 3 stickies, then the notes window", [explain(1), sticky(1, 2), sticky(2, 3), sticky(3, 4), notes(5)]],
    ["3 stickies, then explain, then the notes window", [sticky(1, 1), sticky(2, 2), sticky(3, 3), explain(4), notes(5)]],
    ["3 stickies, then the notes window, then explain", [sticky(1, 1), sticky(2, 2), sticky(3, 3), notes(4), explain(5)]],
    ["the notes window first, then 3 stickies, explain last", [notes(1), sticky(1, 2), sticky(2, 3), sticky(3, 4), explain(5)]],
  ];

  for (const [width, height] of [[1280, 720], [1440, 1000]] as const) {
    for (const [name, windows] of orders) {
      it(`${width} × ${height}, ${name}: every header is on the screen, inside the band, and the front keeps a usable height`, () => {
        for (const origin of [48, 243, 296, 450, 700, 900]) {
          const frame = stackFrameIn({ top: DOCK_TOP_PX, bottom: columnBottomPx(height, DOCK_BOTTOM_PX) }, origin);
          const rows = stackLayout(windows, frame);
          expect(rows).toHaveLength(windows.length);
          for (const row of rows) {
            const header = { top: row.top, bottom: row.top + WINDOW_HEADER_PX };
            expect(header.top, `${name}, origin ${origin}`).toBeGreaterThanOrEqual(DOCK_TOP_PX);
            expect(header.bottom, `${name}, origin ${origin}`).toBeLessThanOrEqual(frame.bottom);
          }
          // The headers do not stand on each other either: 40 px apart, so each one's X is its own.
          const tops = rows.map((r) => r.top);
          for (let i = 1; i < tops.length; i += 1) expect(tops[i] - tops[i - 1]).toBe(WINDOW_HEADER_PX);
          // The front keeps what it needs: the notes window 240, a sticky 160, the explain card 250 (its header, its follow-up field and Send).
          const front = rows[rows.length - 1];
          const frontKind = windows[windows.length - 1].kind;
          expect(front.height, `${name}, origin ${origin}`).toBeGreaterThanOrEqual(LEAST_FRONT_PX[frontKind]);
          expect(front.top + front.height, `${name}, origin ${origin}`).toBeLessThanOrEqual(frame.bottom);
        }
      });
    }
  }

  it("the front gives way only as much as the screen needs: the explain card keeps 250, the notes window 240, beside four headers", () => {
    const four = [sticky(1, 1), sticky(2, 2), sticky(3, 3), explain(4)];
    expect(stackLayout(four, stackFrameIn({ top: DOCK_TOP_PX, bottom: columnBottomPx(720, DOCK_BOTTOM_PX) }, 243))[3].height).toBeGreaterThanOrEqual(DOCK_STACK_FLOOR_PX);
    const withNotes = [sticky(1, 1), sticky(2, 2), sticky(3, 3), notes(4)];
    expect(stackLayout(withNotes, stackFrameIn({ top: DOCK_TOP_PX, bottom: columnBottomPx(720, DOCK_BOTTOM_PX) }, 243))[3].height).toBeGreaterThanOrEqual(NOTES_MIN_FRONT_PX);
    expect(stackLayout([sticky(1, 1), sticky(2, 2), sticky(3, 3)], stackFrameIn({ top: DOCK_TOP_PX, bottom: columnBottomPx(1000, DOCK_BOTTOM_PX) }, 296))[2].height).toBeGreaterThanOrEqual(MIN_FRONT_PX);
  });

  it("the explain card alone stands level with its origin and takes the room beneath it, as the dock did (P8-02, P9-17)", () => {
    const band = { top: DOCK_TOP_PX, bottom: columnBottomPx(900, DOCK_BOTTOM_PX) };
    expect(stackLayout([explain(1)], stackFrameIn(band, 300))[0]).toMatchObject({ top: 300, height: band.bottom - 300, front: true });
    // Held in the band: never above the masthead's foot.
    expect(stackLayout([explain(1)], stackFrameIn(band, 10))[0].top).toBe(DOCK_TOP_PX);
  });
});

// P10-31 (BACKLOG-86, 42): the stack on screens under 560 px high, and in Fit. Measured in the stubbed server (port 4045, an invented PDF,
// the explain window with two follow-up replies, then stickies and the notes window in five orders): at 1280 × 520 the explain window
// 48-298 (its floor, scrolling inside), the column 306-480 (the screen's 520 less the 40 px foot); at 1024 × 480 the same, the column
// ending at 440; every header's X and the notes window's header answered `elementFromPoint`.
// P11-14 (rule 4; re-aimed, §1c): the explain card is a card of the stack, so these screens are asked of the one layout: every header is
// on the screen — a header over the legend's strip at the lowest, never one off-screen — and each card's foot is above the foot legend.
describe("the stack on short screens, with the explain card in it (P10-31, BACKLOG-86; re-aimed, P11-14)", () => {
  const stk = (n: number, order: number) => ({ id: `s${n}`, kind: "sticky" as const, title: `Note ${n}`, order });
  const nts = (order: number) => ({ id: NOTES_WINDOW_ID, kind: "notes" as const, title: "Your notes", order });
  const exp = (order: number) => ({ id: EXPLAIN_WINDOW_ID, kind: "explain" as const, title: "Explain this", order });

  const cases: Array<[string, FloatingWindow[]]> = [
    ["the explain card and two stickies", [exp(1), stk(1, 2), stk(2, 3)]],
    ["two stickies and the explain card", [stk(1, 1), stk(2, 2), exp(3)]],
    ["the notes window, a sticky and the explain card", [nts(1), stk(1, 2), exp(3)]],
    ["the explain card, the notes window and two stickies", [exp(1), nts(2), stk(1, 3), stk(2, 4)]],
  ];

  for (const [height, columnBottom] of [[520, 480], [480, 440]] as const) {
    for (const [name, windows] of cases) {
      it(`${height} px high, ${name}: every header is on the screen, and every card's foot is above the foot legend`, () => {
        for (const origin of [48, 300, 450, 700]) {
          const frame = stackFrameIn({ top: DOCK_TOP_PX, bottom: columnBottomPx(height, DOCK_BOTTOM_PX) }, origin);
          expect(frame.bottom).toBe(columnBottom);
          const rows = stackLayout(windows, frame);
          expect(rows).toHaveLength(windows.length);
          for (const row of rows) {
            expect(row.top, `${name}, origin ${origin}`).toBeGreaterThanOrEqual(DOCK_TOP_PX);
            expect(row.top + WINDOW_HEADER_PX, `a header is off the screen: ${row.top}`).toBeLessThanOrEqual(height);
            expect(row.top + row.height, "the card's foot is on the screen, above the foot legend").toBeLessThanOrEqual(height - DOCK_BOTTOM_PX);
          }
          // The column collapses toward its headers rather than leaving the screen: the front is at least a header, the others exactly one.
          const front = rows[rows.length - 1];
          expect(front.height).toBeGreaterThanOrEqual(WINDOW_HEADER_PX);
          for (const row of rows.slice(0, -1)) expect(row.height).toBe(WINDOW_HEADER_PX);
        }
      });
    }
  }

  it("with the explain card and four more windows on a screen under 560 px high, no header is lower than the screen", () => {
    // At 480 the fifth header's foot passes the column's foot (440) by up to 26 px, into the legend's strip, and stays above the screen's end
    // (BACKLOG-86's remainder: a header over the legend's strip, never one off-screen).
    const five = [exp(1), stk(1, 2), stk(2, 3), stk(3, 4), nts(5)];
    for (const height of [520, 480]) {
      const rows = stackLayout(five, stackFrameIn({ top: DOCK_TOP_PX, bottom: columnBottomPx(height, DOCK_BOTTOM_PX) }, 48));
      expect(rows[rows.length - 1].top + WINDOW_HEADER_PX, `${height} px`).toBeLessThanOrEqual(height);
    }
  });
});

// P10-31 (BACKLOG-42, measured CLOSED by P9-20): in Fit mode the page's zoom scales the foot legend, and the explain window and the column
// stand on its top, not on a flat 28 px. Measured in the stubbed server, the window grown to its cap by four follow-ups: the legend's box
// 968-1000 / 1041.4-1080 / 1388.5-1440 at 1440 × 1000 / 1920 × 1080 / 2560 × 1440 (zoom 1.1418 / 1.3784 / 1.8378), the window's bottom on
// exactly the legend's top — an overlap of 0 px at all three (A P8-05 had 4 / 11 / 23).
// P11-14 (rule 4; re-aimed, §1c): the cards stand in the band that ends at `columnBottomPx` — the legend's top at the page's zoom less a
// margin — so in Fit every card, the explain card among them, ends above the legend's own top: an overlap of 0 px, with a margin to spare.
describe("Fit mode: the cards stand above the legend's own top (P10-31, BACKLOG-42; re-aimed, P11-14)", () => {
  const stk = (n: number, order: number) => ({ id: `s${n}`, kind: "sticky" as const, title: `Note ${n}`, order });
  const exp = (order: number) => ({ id: EXPLAIN_WINDOW_ID, kind: "explain" as const, title: "Explain this", order });
  const fits: Array<[number, number, number, number]> = [[1440, 1000, 1.1417910447761195, 968], [1920, 1080, 1.3783783783783783, 1041.4], [2560, 1440, 1.837837837837838, 1388.5]];

  for (const [width, height, zoom, legendTop] of fits) {
    it(`${width} × ${height} at zoom ${zoom.toFixed(3)}: the explain card ends above the legend's top (${legendTop}), alone and beside three stickies`, () => {
      const legend = legendHeightPx(zoom);
      expect(height - legend).toBeCloseTo(legendTop, 0);
      const band = { top: DOCK_TOP_PX, bottom: columnBottomPx(height, legend) };
      expect(band.bottom).toBeLessThanOrEqual(height - legend);
      // Alone, grown to the cap: its bottom is the band's foot, which is above the legend's top (a flat 28 left 4 / 10.6 / 23.5 px of overlap).
      const alone = stackLayout([exp(1)], stackFrameIn(band, 48))[0];
      expect(alone.top + alone.height).toBe(band.bottom);
      expect(alone.top + alone.height).toBeLessThanOrEqual(height - legend);
      // With three stickies the column's foot is above the legend too, and so is every card's.
      for (const windows of [[exp(1), stk(1, 2), stk(2, 3), stk(3, 4)], [stk(1, 1), stk(2, 2), stk(3, 3), exp(4)]]) {
        for (const row of stackLayout(windows, stackFrameIn(band, 48))) expect(row.top + row.height).toBeLessThanOrEqual(height - legend);
      }
    });
  }

  it("the flat 28 px would have overlapped: the legend is taller than its reserve by the Fit scale (the bug BACKLOG-42 named)", () => {
    for (const [, , zoom] of fits) expect(legendHeightPx(zoom)).toBeGreaterThan(DOCK_BOTTOM_PX);
    expect(legendHeightPx(1)).toBe(DOCK_BOTTOM_PX);
    expect(legendHeightPx(Number.NaN)).toBe(DOCK_BOTTOM_PX);
  });
});

// ── One card stack in the margin (P11-14, rule 2; B P11-03 §3.2, §3.3; ruling §1h.113) ──────────────────────────────────────────
//
// `WindowKind` gains `figure` and `highlight` and `explain` is used; the stack takes a front height per kind (a sticky 260, a highlight
// 140, the explain card its content, the notes window and a figure all the room), a header press raises, the X closes, opening raises;
// and the cascade starts where the first card opened — level with its selection (R-open, O-6) — and stays there while it stands.

describe("stackLayout — one front height per kind (P11-14, rule 2)", () => {
  const card = (id: string, kind: FloatingWindow["kind"], order: number): FloatingWindow => ({ id, kind, title: id, order });
  const band = { top: 100, bottom: 900 };

  it("a sticky in front is 260 and a highlight 140, with no height asked for", () => {
    expect(stackLayout([card("s", "sticky", 1)], band)[0]).toMatchObject({ top: 100, height: 260, front: true });
    expect(stackLayout([card("h", "highlight", 1)], band)[0]).toMatchObject({ top: 100, height: 140, front: true });
  });

  it("the notes window and a figure in front take all the room the band leaves", () => {
    expect(stackLayout([card("n", "notes", 1)], band)[0]).toMatchObject({ height: 800, front: true });
    expect(stackLayout([card("f", "figure", 1)], band)[0]).toMatchObject({ height: 800, front: true });
    const under = stackLayout([card("a", "sticky", 1), card("f", "figure", 2)], band);
    expect(under.map((r) => [r.id, r.top, r.height])).toEqual([["a", 100, 40], ["f", 140, 760]]);
  });

  it("the explain card in front is its content, at most the room, and the whole room until its content is known", () => {
    expect(stackLayout([card("e", "explain", 1)], { ...band, frontHeights: { explain: 380 } })[0]).toMatchObject({ height: 380 });
    expect(stackLayout([card("e", "explain", 1)], { ...band, frontHeights: { explain: 5000 } })[0]).toMatchObject({ height: 800 });
    expect(stackLayout([card("e", "explain", 1)], band)[0]).toMatchObject({ height: 800 });
  });

  it("a frame's height for a kind wins over the default, and the legacy frontHeight is the sticky's", () => {
    expect(stackLayout([card("s", "sticky", 1)], { ...band, frontHeights: { sticky: 300 } })[0].height).toBe(300);
    expect(stackLayout([card("s", "sticky", 1)], { ...band, frontHeight: 200 })[0].height).toBe(200);
  });

  it("every kind behind another is a header, in one cascade 40 px apart, and a header press (raise) brings it forward", () => {
    useWindows.setState({ windows: [], clock: 0, origin: null });
    const { open, raise } = useWindows.getState();
    open({ id: "a", kind: "sticky", title: "Note 1" });
    open({ id: "f", kind: "figure", title: "Figure 1" });
    open({ id: EXPLAIN_WINDOW_ID, kind: "explain", title: "Explain this" });
    let rows = stackLayout(useWindows.getState().windows, band);
    expect(rows.map((r) => [r.id, r.top, r.height, r.front])).toEqual([["a", 100, 40, false], ["f", 140, 40, false], [EXPLAIN_WINDOW_ID, 180, 720, true]]);
    raise("a");
    rows = stackLayout(useWindows.getState().windows, band);
    expect(rows.map((r) => r.id)).toEqual(["f", EXPLAIN_WINDOW_ID, "a"]);
    expect(rows[2]).toMatchObject({ id: "a", front: true, top: 180, height: 260 });
  });

  it("lifts the column to keep the front its least height — the explain card 250, the figure 240 — never above the band's top", () => {
    const rows = stackLayout([card("a", "sticky", 1), card("b", "sticky", 2), card("e", "explain", 3)], { top: 700, bottom: 900, minTop: 48, frontHeights: { explain: 400 } });
    expect(rows.map((r) => r.top)).toEqual([570, 610, 650]);
    expect(rows[2].height).toBe(250);
    const figure = stackLayout([card("a", "sticky", 1), card("f", "figure", 2)], { top: 800, bottom: 900, minTop: 48 });
    expect(figure[0].top).toBe(900 - 40 - 240);
    expect(figure[1].height).toBe(240);
  });
});

describe("stackRows — the figure and the highlight stand in the stack too (P11-14, rule 2)", () => {
  const frame = { top: 100, bottom: 900 };
  it("holds a figure card and a highlight card whatever the paper's note holds", () => {
    const windows: FloatingWindow[] = [
      { id: "f", kind: "figure", title: "Figure 1", order: 1 },
      { id: "h", kind: "highlight", title: "Highlight", order: 2 },
      { id: NOTES_WINDOW_ID, kind: "notes", title: "Your notes", order: 3 },
    ];
    expect(stackRows(windows, [], frame).map((r) => r.id)).toEqual(["f", "h", NOTES_WINDOW_ID]);
  });
});

describe("useWindows — where the cascade starts (R-open, O-6; P11-14 rule 2)", () => {
  beforeEach(() => useWindows.setState({ windows: [], clock: 0, origin: null }));

  it("the first card of an empty margin opens at the anchor it was given; a later card joins where the oldest stands", () => {
    const { open } = useWindows.getState();
    expect(useWindows.getState().origin).toBeNull();
    open({ ...sticky(1), anchorTop: 333 });
    expect(useWindows.getState().origin).toBe(333);
    open({ ...sticky(2), anchorTop: 640 });
    expect(useWindows.getState().origin).toBe(333);
  });

  it("a card opened with no anchor starts the cascade at the top of the margin, and opening a card that is open moves nothing", () => {
    const { open } = useWindows.getState();
    open({ id: NOTES_WINDOW_ID, kind: "notes", title: "Your notes" });
    expect(useWindows.getState().origin).toBeNull();
    open({ id: NOTES_WINDOW_ID, kind: "notes", title: "Your notes", anchorTop: 500 });
    expect(useWindows.getState().origin).toBeNull();
  });

  it("closing the last card forgets where the cascade started; closing one of two keeps it", () => {
    const { open, close } = useWindows.getState();
    open({ ...sticky(1), anchorTop: 333 });
    open(sticky(2));
    close("s1");
    expect(useWindows.getState().origin).toBe(333);
    close("s2");
    expect(useWindows.getState().origin).toBeNull();
    open({ ...sticky(3), anchorTop: 410 });
    expect(useWindows.getState().origin).toBe(410);
  });

  it("an explain card that stands alone follows its selection; once a second card joins the origin is frozen", () => {
    const { open, follow } = useWindows.getState();
    open({ id: EXPLAIN_WINDOW_ID, kind: "explain", title: "Explain this" });
    follow(250);
    expect(useWindows.getState().origin).toBe(250);
    follow(310);
    expect(useWindows.getState().origin).toBe(310);
    open(sticky(1));
    follow(500);
    expect(useWindows.getState().origin).toBe(310);
  });

  it("only an explain card may follow: a lone sticky stays where it opened, and nothing follows with no card", () => {
    const { open, follow } = useWindows.getState();
    follow(120);
    expect(useWindows.getState().origin).toBeNull();
    open({ ...sticky(1), anchorTop: 333 });
    follow(120);
    expect(useWindows.getState().origin).toBe(333);
  });
});

describe("stackFrameIn — the band the cascade stands in (P11-14, rule 2)", () => {
  const band = { top: 48, bottom: 860 };
  it("starts at the margin's top with no origin, and at the origin where there is one", () => {
    expect(stackFrameIn(band, null)).toEqual({ top: 48, bottom: 860, minTop: 48 });
    expect(stackFrameIn(band, 333)).toEqual({ top: 333, bottom: 860, minTop: 48 });
  });

  it("holds the origin inside the band: never above the masthead's foot, never below the legend's strip", () => {
    expect(stackFrameIn(band, 10).top).toBe(48);
    expect(stackFrameIn(band, 5000).top).toBe(860);
  });
});

describe("stackRows — the explain card is one of the stack (P11-14, rule 4; O-8, BACKLOG-66)", () => {
  const frame = { top: 100, bottom: 900 };
  const heads = [1, 2].map((n) => block("h3", `Note ${n}`, { anchor: { paperId: "p", paragraphId: `paper-section-0-p${n}`, quote: "q", n } }));
  const sticky = (id: string, order: number) => ({ id, kind: "sticky" as const, title: id, order });

  it("holds the explain card with the stickies and the notes window in one cascade, 40 px apart, and no card stands under it", () => {
    const windows = [
      sticky(heads[0].id, 1),
      { id: EXPLAIN_WINDOW_ID, kind: "explain" as const, title: "Explain this", order: 2 },
      { id: NOTES_WINDOW_ID, kind: "notes" as const, title: "Your notes", order: 3 },
      sticky(heads[1].id, 4),
    ];
    const rows = stackRows(windows, heads, frame);
    expect(rows.map((r) => r.id)).toEqual([heads[0].id, EXPLAIN_WINDOW_ID, NOTES_WINDOW_ID, heads[1].id]);
    expect(rows.map((r) => r.top)).toEqual([100, 140, 180, 220]);
    expect(rows.map((r) => r.front)).toEqual([false, false, false, true]);
  });

  it("every card's header is reachable whatever the order the four were opened in: 40 px apart, inside the band, the front above the foot", () => {
    const heads2 = [block("h3", "Note 1", { anchor: { paperId: "p", paragraphId: "paper-section-0-p1", quote: "q", n: 1 } })];
    const idOf = { sticky: heads2[0].id, explain: EXPLAIN_WINDOW_ID, notes: NOTES_WINDOW_ID, figure: "figure:1" } as const;
    type Kind = keyof typeof idOf;
    const permutations = (items: readonly Kind[]): Kind[][] =>
      items.length <= 1 ? [[...items]] : items.flatMap((item, i) => permutations([...items.slice(0, i), ...items.slice(i + 1)]).map((rest) => [item, ...rest]));
    for (const height of [480, 720, 1000]) {
      const bottom = height - 40;
      for (const order of permutations(["sticky", "explain", "notes", "figure"])) {
        const windows = order.map((kind, i) => ({ id: idOf[kind], kind, title: kind, order: i + 1 }));
        const rows = stackRows(windows, heads2, { top: 300, bottom, minTop: DOCK_TOP_PX, frontHeights: { explain: 420 } });
        const label = `${height} px, ${order.join(" > ")}`;
        expect(rows, label).toHaveLength(4);
        rows.forEach((row, i) => {
          expect(row.top, label).toBeGreaterThanOrEqual(DOCK_TOP_PX);
          if (i > 0) expect(row.top - rows[i - 1].top, label).toBe(WINDOW_HEADER_PX);
        });
        const front = rows[3];
        expect(front.top + front.height, label).toBeLessThanOrEqual(bottom);
        expect(front.height, label).toBeGreaterThanOrEqual(WINDOW_HEADER_PX);
      }
    }
  });
});

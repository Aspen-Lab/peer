import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { placeCard } from "./explain-box";
import * as dock from "./explain-dock";
import { DOCK_BOTTOM_PX, DOCK_MIN_VIEWPORT_PX, DOCK_MIN_VISIBLE_PX, DOCK_THREAD_FLOOR_PX, DOCK_TOP_PX, DOCK_WIDTH_PX, MASTHEAD_MIN_VIEWPORT_PX, PAGE_ZOOM_ROOT, PAGE_ZOOM_VAR, legendHeightPx } from "./explain-dock";

// P7-15 (the owner's R7): the dock's rectangle is built from three numbers that the shell owns —
// the masthead's height above it, the foot legend's below it, and the width of the card it
// replaces. They are copied here from where they are drawn; these pins hold each copy against its
// source, so a taller masthead or legend cannot leave the dock under it or over it.

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");
const REM_PX = 16;
const SPACING_UNIT_PX = 4;

describe("the dock's rectangle against the shell that frames it", () => {
  it("its top is the sticky masthead's height: `h-12` on the masthead's own bar", () => {
    const masthead = read("src/components/shell/masthead.tsx");
    const bar = /className="[^"]*\bsticky top-0\b[^"]*\bh-(\d+)\b[^"]*"/.exec(masthead);

    expect(bar).not.toBeNull();
    expect(Number(bar![1]) * SPACING_UNIT_PX).toBe(DOCK_TOP_PX);
  });

  it("the masthead shows from Tailwind's `md` (48rem): `hidden md:grid` on the same bar — the gutter button keeps below it only from there (P9-17)", () => {
    const masthead = read("src/components/shell/masthead.tsx");
    const bar = /className="([^"]*\bsticky top-0\b[^"]*)"/.exec(masthead);

    expect(bar).not.toBeNull();
    expect(bar![1].split(/\s+/)).toEqual(expect.arrayContaining(["hidden", "md:grid"]));
    expect(MASTHEAD_MIN_VIEWPORT_PX).toBe(48 * REM_PX);
  });

  it("its bottom stands above the foot legend: `--legend-h` is 1.75rem and the legend is that tall", () => {
    const css = read("src/app/globals.css");
    const legend = read("src/components/reader/key-legend.tsx");
    const declared = /--legend-h:\s*([\d.]+)rem;/.exec(css);

    expect(declared).not.toBeNull();
    expect(Number(declared![1]) * REM_PX).toBe(DOCK_BOTTOM_PX);
    expect(legend).toContain("h-[var(--legend-h)]");
  });

  // Re-aimed, P9-41 (§1h.66; was: "the page's bottom furniture swaps at `md`: the phone's thumb bar (`md:hidden`, 56 px) under 768 px, the
  // foot legend (`hidden md:flex`) from it — the floating control stands above whichever shows (P9-20, X13)", which also held a copy of the
  // bar's 56 px against the bar): under 768 px the control no longer stands above the bar, it is a cell in it, so this file keeps no copy of
  // the bar's height (`THUMB_BAR_PX` is the bar's own, which `page.tsx` reads from it). The swap itself still decides where the control is —
  // the bar's cell under 768 px, the pill above the legend from it — so it is pinned against both components, and against the cell.
  it("the page's bottom furniture swaps at `md`: the phone's thumb bar (`md:hidden`) under 768 px holds the control as a cell, the foot legend (`hidden md:flex`) from it has the pill above it (re-aimed, P9-41)", () => {
    const bar = read("src/components/shell/thumb-bar.tsx");
    const legend = read("src/components/reader/key-legend.tsx");
    const nav = /<nav[^>]*className="([^"]*\bfixed\b[^"]*)"/.exec(bar);
    const strip = /className="([^"]*\bfixed\b[^"]*\bbottom-0\b[^"]*)"/.exec(legend);

    // The bar is there under `md`, fixed to the window's foot; the legend from `md`, fixed to the same edge.
    expect(nav).not.toBeNull();
    expect(nav![1].split(/\s+/)).toEqual(expect.arrayContaining(["md:hidden", "fixed", "bottom-0"]));
    expect(strip).not.toBeNull();
    expect(strip![1].split(/\s+/)).toEqual(expect.arrayContaining(["hidden", "md:flex", "fixed", "bottom-0"]));
    // `md` is 48rem: the masthead's own breakpoint, the one the control's place swaps at.
    expect(MASTHEAD_MIN_VIEWPORT_PX).toBe(48 * REM_PX);
    // The cell is the bar's: it is drawn in the bar's file, under the bar's `md:hidden`, as a `min-h-11` (44 px) target that calls the
    // page's `explain` action; and the box keeps no copy of the bar's height any more — there is nothing above the bar to clear.
    expect(bar).toContain("data-explain-ask");
    expect(bar).toContain("readerActions()?.explain?.()");
    expect(bar).toMatch(/className="[^"]*\bmin-h-11\b[^"]*"[^>]*>\s*\{EXPLAIN\.ask\}/);
    expect(dock).not.toHaveProperty("THUMB_BAR_PX");
  });

  // P9-20 (BACKLOG-42): the legend is scaled by Fit's zoom and the box is not. The reserve is the legend's height on screen, so the
  // two facts it rests on are pinned where they are drawn: the legend stands inside the zoom root, the box outside it, and the
  // root carries the number the box reads.
  it("the legend is inside the page container that Fit zooms and carries `--page-zoom`; the explain box is outside it — so the window's reserve is `legendHeightPx(zoom)`, not a flat 28 (P9-20)", () => {
    const page = read("src/app/papers/[id]/page.tsx");
    const root = page.indexOf('data-zoom-root=""');
    const legend = page.indexOf("<KeyLegend");
    const closes = page.indexOf("</PageContainer>", legend);
    const box = page.indexOf("<ExplainBox");

    expect(PAGE_ZOOM_ROOT).toBe("[data-zoom-root]");
    expect(PAGE_ZOOM_VAR).toBe("--page-zoom");
    expect(page).toContain('"--page-zoom": pageZoom');
    expect(page).toContain("zoom: pageZoom");
    expect(root).toBeGreaterThan(0);
    // The legend: after the zoom root opens, before its container closes. The box: after it has closed.
    expect(legend).toBeGreaterThan(root);
    expect(closes).toBeGreaterThan(legend);
    expect(box).toBeGreaterThan(closes);
    expect(legendHeightPx(1)).toBe(DOCK_BOTTOM_PX);
    expect(legendHeightPx(2)).toBe(2 * DOCK_BOTTOM_PX);
  });

  it("is as wide as P3-02's card, which it replaces from 1024 px (Tailwind's `lg`)", () => {
    expect(placeCard({ left: 300, top: 400, right: 420, bottom: 420 }, { width: 1000, height: 900 }).width).toBe(DOCK_WIDTH_PX);
    expect(DOCK_WIDTH_PX).toBe(360);
    expect(DOCK_MIN_VIEWPORT_PX).toBe(64 * REM_PX);
  });

  it("an empty window never stands so low that less than 160 px of it shows above the legend (P8-02; re-aimed, P9-17: the floor of the window with nothing in it)", () => {
    // The window is level with its paragraph (`placePanel`), and the paragraph may be anywhere on the page:
    // its top is held between the masthead's foot and this much above the legend. The empty window is about 125 px
    // tall, so this default floor leaves it all of its height; a window that holds a passage has its own (below).
    expect(DOCK_MIN_VISIBLE_PX).toBe(160);
    expect(DOCK_TOP_PX + DOCK_MIN_VISIBLE_PX + DOCK_BOTTOM_PX).toBe(236);
  });

  it("a window that holds a passage never stands so low that its header, its controls and two lines of the answer do not show: 360 px (P9-17, ruling §1h.56)", () => {
    // A P9-R2 F1, measured: the sticky header is 140 px (a two-line quote and the "Explain this?" control), the
    // sticky controls row 101 px; at the old 160 px floor they overlapped by 38 to 83 px and the answer showed
    // nowhere. The second line of the answer ends 330 px below the window's top, 344 with the control at the 44 px touch
    // size (P9-17's browser check; the 300 px first guessed leaves none of it in view). The floor is a property of what the
    // window holds, not one number for every state.
    expect(DOCK_THREAD_FLOOR_PX).toBe(360);
    expect(DOCK_THREAD_FLOOR_PX).toBeGreaterThan(DOCK_MIN_VISIBLE_PX);
    expect(DOCK_TOP_PX + DOCK_THREAD_FLOOR_PX + DOCK_BOTTOM_PX).toBe(436);
  });
});

// ── Retired with the reserve (P11-14, rule 3; B P11-01 §3.1) ────────────────────────────────────────────────────────────────────────
//
// "The page makes room (P7-15, R7 / Q4)" stood here: "what the page keeps clear while the dock is open" — six cases of `reserveDock` (376 px
// = the dock and a 16 px gap, named `--explain-dock` and `--explain-dock-width`; written on the document's root and taken off by what it
// returns; counted for the first taker to write and the last release to take off; a release given twice counts once; a count for each
// root; nothing, and no failure, where there is no root) — and "the page's width is kept at <main>, in CSS" — three cases (<main> carries
// `peer-main-content`, which pads its right side by the reserved width; the custom property the rule reads is the one the dock writes
// and the notes tab reads). The margin is a track of the reader's shell now: nothing is reserved, so the functions, the constants and
// the CSS rule are deleted with these nine cases. Their absence is pinned in `explain-dock.retired.test.ts`.

// ── No window before the reader asks (P10-08, review 8.5) ───────────────────────────────────────────

describe("no empty window stands (P10-08; replaces P8-06's rule for it, whose pins are deleted with the feature)", () => {
  it("the rule that let an empty window stand from the mount is gone from the dock's module", () => {
    const rule = ["empty", "DockStands"].join("");
    expect((dock as Record<string, unknown>)[rule]).toBeUndefined();
    expect(read("src/components/reader/explain-dock.ts")).not.toContain(rule);
  });

  // P11-14 (re-aimed, §1c): was "the page's width is kept clear only by `reserveDock`, which the box calls when a passage opens the dock"
  // (`box.match(/reserveDock\(/g)).toHaveLength(1)`). Nothing is reserved now; the dock's mode is still decided in that one place.
  it("the dock stands from a window of 1024 px while a passage is open, decided in one place, and the box reserves nothing", () => {
    const box = read("src/components/reader/explain-box.tsx");

    expect(box).toContain("const docked = open !== null && viewport.width >= DOCK_MIN_VIEWPORT_PX;");
    expect(box.match(/const docked =/g)).toHaveLength(1);
    expect(box).not.toContain("reserveDock");
  });
});

// ── The height effect's guard (P10-08, review 1.1; B P10-01; ruling §1h.80 (a)) ─────────────────────────────────────

describe("settleHeight — the after-every-commit height write cannot run away", () => {
  const fresh = () => dock.newHeightGuard();

  it("writes the first reading, and a reading within 2 px of the held height is the same height (it was 1)", () => {
    expect(dock.settleHeight(fresh(), null, 480, "k")).toBe(480);
    expect(dock.settleHeight(fresh(), 480, 481.9, "k")).toBeNull();
    expect(dock.settleHeight(fresh(), 480, 482, "k")).toBe(482);
    expect(dock.HEIGHT_TOLERANCE_PX).toBe(2);
  });

  it("an A, B, A pattern settles on the larger height and writes no more", () => {
    const guard = fresh();
    let held: number | null = null;
    const writes: number[] = [];
    for (const reading of [480, 500, 480, 500, 480, 500]) {
      const write = dock.settleHeight(guard, held, reading, "k");
      if (write !== null) {
        writes.push(write);
        held = write;
      }
    }
    expect(writes).toEqual([480, 500]);
    expect(held).toBe(500);
  });

  it("an A, B, A pattern settles on the larger of the two when the smaller is held last", () => {
    const guard = fresh();
    expect(dock.settleHeight(guard, null, 500, "k")).toBe(500);
    expect(dock.settleHeight(guard, 500, 480, "k")).toBe(480);
    // 500 again: the held 480 is the smaller, so the box settles on 500.
    expect(dock.settleHeight(guard, 480, 500, "k")).toBe(500);
    expect(dock.settleHeight(guard, 500, 480, "k")).toBeNull();
  });

  it("more than eight writes with nothing changed by the reader settle on the largest height seen; the ninth reading writes it, the rest nothing", () => {
    const guard = fresh();
    let held: number | null = null;
    let writes = 0;
    for (let reading = 400; reading < 400 + 10 * 30; reading += 10) {
      const write = dock.settleHeight(guard, held, reading, "k");
      if (write !== null) {
        writes += 1;
        held = write;
      }
    }
    expect(writes).toBe(dock.HEIGHT_BURST_MAX + 1);
    expect(held).toBe(400 + 10 * dock.HEIGHT_BURST_MAX);
  });

  it("a change by the reader (a new key) or a reset (the next frame) is a fresh budget", () => {
    const guard = fresh();
    for (const reading of [480, 500, 480]) dock.settleHeight(guard, null, reading, "k");
    expect(guard.locked).toBe(true);
    expect(dock.settleHeight(guard, 500, 700, "k")).toBeNull();
    expect(dock.settleHeight(guard, 500, 700, "after a reply")).toBe(700);
    dock.resetHeightGuard(guard);
    expect(guard).toMatchObject({ writes: 0, trail: [], locked: false });
  });
});

// P10-18 (A P10-14 §4 X-B1; ruling §1h.93 (a)): the explain window gives the stack room.
describe("dockInStack — the explain window leaves the stack its room (P10-18)", () => {
  const legend = DOCK_BOTTOM_PX;
  const room = (behind: number, front = 160) => 8 + behind * 40 + front;

  it("is the plain placement when no window stands (room 0): its top, and down to the legend", () => {
    expect(dock.dockInStack({ top: 300, paragraphTop: 300, height: 1000, legend, room: 0 })).toEqual({ top: 300, maxHeight: 1000 - 300 - legend });
    expect(dock.dockInStack({ top: 48, paragraphTop: 10, height: 720, legend, room: 0 })).toEqual({ top: 48, maxHeight: 720 - 48 - legend });
  });

  it("the column's bottom is the screen less the foot legend and a margin, at least 40 px (windows.ts reads it the same)", () => {
    expect(dock.columnBottomPx(720, 28)).toBe(720 - 40);
    expect(dock.columnBottomPx(1000, 28 * 1.142)).toBe(1000 - 40);
    expect(dock.columnBottomPx(2000, 28 * 1.838)).toBe(2000 - (Math.ceil(28 * 1.838) + 8));
  });

  it("where the column can stand above the explain window it does: the explain window keeps its place, no higher than the column needs", () => {
    // 1440 × 1000, one sticky (room 168): the paragraph is low, the column fits above (48 + 168 = 216 <= 300).
    expect(dock.dockInStack({ top: 300, paragraphTop: 300, height: 1000, legend, room: room(0) })).toEqual({ top: 300, maxHeight: 1000 - 300 - legend });
    // The window was lifted high by a tall thread: it is brought down just enough to leave the column its place above.
    expect(dock.dockInStack({ top: 100, paragraphTop: 300, height: 1000, legend, room: room(0) })).toEqual({ top: 48 + room(0), maxHeight: 1000 - 48 - room(0) - legend });
  });

  it("where the column cannot stand above it, the explain window shrinks to leave the column its room below, level with the paragraph still", () => {
    // 1440 × 1000, three stickies (room 248), the paragraph at 250 (the column needs 48 + 248 = 296 above): the explain window ends 960 - 2 - 248 = 710 at the lowest.
    const at = dock.dockInStack({ top: 250, paragraphTop: 250, height: 1000, legend, room: room(2) });
    expect(at.top).toBe(250);
    expect(at.top + at.maxHeight).toBe(1000 - 40 - 2 - room(2));
    // 1280 × 720, three stickies and the notes window (room 368): it shrinks to its floor, from the masthead's foot.
    const tight = dock.dockInStack({ top: 243, paragraphTop: 243, height: 720, legend, room: room(3, 240) });
    expect(tight.maxHeight).toBeGreaterThanOrEqual(dock.DOCK_STACK_FLOOR_PX);
    expect(tight.top + tight.maxHeight).toBeLessThanOrEqual(720 - 40 - 2 - room(3, 240) + 1);
    expect(tight.top).toBeGreaterThanOrEqual(DOCK_TOP_PX);
  });

  it("never smaller than its floor, which holds its header, its follow-up field and Send; never lower than the legend", () => {
    expect(dock.DOCK_STACK_FLOOR_PX).toBeGreaterThanOrEqual(241);
    const short = dock.dockInStack({ top: 48, paragraphTop: 48, height: 560, legend, room: room(3, 240) });
    expect(short.top).toBe(DOCK_TOP_PX);
    expect(short.maxHeight).toBe(dock.DOCK_STACK_FLOOR_PX);
  });

  it("does not depend on the window's own measured height: shrinking it cannot unshrink it", () => {
    const a = dock.dockInStack({ top: 243, paragraphTop: 243, height: 720, legend, room: room(3, 240) });
    const b = dock.dockInStack({ top: 332, paragraphTop: 243, height: 720, legend, room: room(3, 240) });
    expect(a).toEqual(b);
  });
});

describe("the box asks the stack for its room (P10-18)", () => {
  it("explain-box.tsx places the dock through dockInStack with the stack's room, once", () => {
    const box = read("src/components/reader/explain-box.tsx");
    expect(box.match(/dockInStack\(/g)).toHaveLength(1);
    expect(box).toMatch(/dockInStack\(\{[^}]*room: stackRoomPx/);
    expect(box).toMatch(/stackRoom\(useWindows\.getState\(\)\.windows\)/);
  });
});

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { DOCK_MIN_VIEWPORT_PX, DOCK_WIDTH_PX } from "./explain-dock";
import {
  CENTRE_MIN_PX,
  DIVIDER_PX,
  KEY_STEP_PX,
  KEY_STEP_SHIFT_PX,
  LEFT_DEFAULT_PX,
  LEFT_DEFAULT_WIDE_PX,
  LEFT_MAX_PX,
  LEFT_MIN_PX,
  LEFT_WIDE_VIEWPORT_PX,
  MARGIN_DEFAULT_PX,
  MARGIN_MAX_PX,
  MARGIN_MIN_PX,
  RAIL_PX,
  SHELL_MIN_VIEWPORT_PX,
  clampPane,
  defaultPanePx,
  fitPanes,
  paneRange,
  stepPane,
} from "./pane-layout";

// P11-10 rule 1 (B P11-01 §2.2, §2.6; ruling §1h.113): the panes' numbers and the pure arithmetic that fits them to a window. Every
// number is written once here, on purpose — changing a pane's width means changing this test knowingly, with the constant.

describe("the numbers of B §2.2", () => {
  it("holds the shell's threshold, the three panes' bounds, the rail and the divider", () => {
    expect(SHELL_MIN_VIEWPORT_PX).toBe(1024);
    expect([LEFT_MIN_PX, LEFT_DEFAULT_PX, LEFT_DEFAULT_WIDE_PX, LEFT_MAX_PX]).toEqual([240, 320, 360, 480]);
    expect(LEFT_WIDE_VIEWPORT_PX).toBe(1536);
    expect(CENTRE_MIN_PX).toBe(440);
    expect([MARGIN_MIN_PX, MARGIN_DEFAULT_PX, MARGIN_MAX_PX]).toEqual([280, 360, 560]);
    expect(RAIL_PX).toBe(48);
    expect(DIVIDER_PX).toBe(12);
    expect([KEY_STEP_PX, KEY_STEP_SHIFT_PX]).toEqual([16, 64]);
  });

  it("the shell exists exactly where the explain dock did: SHELL_MIN_VIEWPORT_PX === DOCK_MIN_VIEWPORT_PX", () => {
    // The margin is the dock's successor (B §2.2, §3.1; "Dock mode <=> shell active <=> window >= 1024"): two constants for one
    // threshold would let the dock stand where there is no margin, or the margin where the card and the sheet still do.
    expect(SHELL_MIN_VIEWPORT_PX).toBe(DOCK_MIN_VIEWPORT_PX);
  });

  it("the margin's default is the dock's width, so the cards keep the size they were designed at", () => {
    expect(MARGIN_DEFAULT_PX).toBe(DOCK_WIDTH_PX);
  });

  // Re-aimed (P11-20 rule 3, §1c): was "all three panes pinned at the defaults need 1144 px; the narrowest panes need less than the shell's minimum".
  // The 1144 lines went with `PINNED_DEFAULTS_MIN_VIEWPORT_PX` (retired, `pane-layout.retired.test.ts`); the narrowest panes' lines stay.
  it("the narrowest panes need less than the shell's minimum", () => {
    expect(LEFT_MIN_PX + MARGIN_MIN_PX + CENTRE_MIN_PX + 2 * DIVIDER_PX).toBe(984);
    expect(984).toBeLessThanOrEqual(SHELL_MIN_VIEWPORT_PX);
    expect(RAIL_PX + MARGIN_MIN_PX + CENTRE_MIN_PX + 2 * DIVIDER_PX).toBe(792);
  });

  it("the margin is not collapsible: no collapsed flag or width exists for it, and it never takes less than 280 (ruling §1h.113: D7)", () => {
    const source = readFileSync(resolve(process.cwd(), "src/components/reader/pane-layout.ts"), "utf8");
    expect(source).not.toMatch(/margin(Collapsed|Hidden|Closed)|collapseMargin|MARGIN_COLLAPSED/i);
    expect(fitPanes({ viewport: SHELL_MIN_VIEWPORT_PX, margin: 0 }).margin).toBe(MARGIN_MIN_PX);
    expect(paneRange("margin").min).toBe(MARGIN_MIN_PX);
  });
});

describe("defaultPanePx", () => {
  it("is 320 for the left pane, 360 from 1536 css px, and 360 for the margin", () => {
    expect(defaultPanePx("left", 1024)).toBe(320);
    expect(defaultPanePx("left", 1535)).toBe(320);
    expect(defaultPanePx("left", 1536)).toBe(360);
    expect(defaultPanePx("left", 2560)).toBe(360);
    expect(defaultPanePx("left")).toBe(320);
    expect(defaultPanePx("margin", 1024)).toBe(360);
    expect(defaultPanePx("margin", 2560)).toBe(360);
  });
});

describe("paneRange and clampPane", () => {
  it("clamps each pane to its own bounds, in whole px", () => {
    expect(clampPane("left", 100)).toBe(240);
    expect(clampPane("left", 900)).toBe(480);
    expect(clampPane("left", 300.6)).toBe(301);
    expect(clampPane("margin", 100)).toBe(280);
    expect(clampPane("margin", 900)).toBe(560);
    expect(clampPane("margin", 400)).toBe(400);
  });

  it("takes something that is not a number for the pane's default", () => {
    expect(clampPane("left", Number.NaN)).toBe(320);
    expect(clampPane("left", Number.POSITIVE_INFINITY)).toBe(320);
    expect(clampPane("margin", Number.NaN)).toBe(360);
    expect(clampPane("left", undefined as unknown as number)).toBe(320);
    expect(clampPane("left", Number.NaN, { viewport: 1920, other: 360 })).toBe(360);
  });

  it("keeps the centre at its minimum: a pane is no wider than the window leaves, the other pane and the dividers counted", () => {
    // 1024 - 280 (the margin) - 24 (two dividers) - 440 = 280 for the left pane.
    expect(paneRange("left", { viewport: 1024, other: 280 })).toEqual({ min: 240, max: 280 });
    expect(clampPane("left", 480, { viewport: 1024, other: 280 })).toBe(280);
    // The same window with the rail beside the margin: 1024 - 48 - 24 - 440 = 512, so the margin's own 560 is cut to 512.
    expect(paneRange("margin", { viewport: 1024, other: RAIL_PX })).toEqual({ min: 280, max: 512 });
    // A roomy window leaves the pane's own bounds.
    expect(paneRange("left", { viewport: 1920, other: 360 })).toEqual({ min: 240, max: 480 });
  });

  it("never inverts the range: where the room is less than the pane's minimum, the minimum stands", () => {
    expect(paneRange("left", { viewport: 800, other: 360 })).toEqual({ min: 240, max: 240 });
    expect(clampPane("left", 480, { viewport: 800, other: 360 })).toBe(240);
  });

  it("ignores a room it cannot read", () => {
    expect(paneRange("left", { viewport: Number.NaN, other: 360 })).toEqual({ min: 240, max: 480 });
    expect(paneRange("margin", { viewport: 1024, other: Number.NaN })).toEqual({ min: 280, max: 560 });
  });
});

describe("stepPane", () => {
  it("moves the left pane's boundary the way the arrow points: right widens it, 16 px, 64 with Shift", () => {
    expect(stepPane("left", 320, "ArrowRight", false)).toBe(336);
    expect(stepPane("left", 320, "ArrowLeft", false)).toBe(304);
    expect(stepPane("left", 320, "ArrowRight", true)).toBe(384);
    expect(stepPane("left", 320, "ArrowLeft", true)).toBe(256);
  });

  it("moves the margin's boundary the same way, so right narrows the margin and left widens it", () => {
    expect(stepPane("margin", 360, "ArrowRight", false)).toBe(344);
    expect(stepPane("margin", 360, "ArrowLeft", false)).toBe(376);
    expect(stepPane("margin", 360, "ArrowRight", true)).toBe(296);
    expect(stepPane("margin", 360, "ArrowLeft", true)).toBe(424);
  });

  it("clamps at the pane's bounds", () => {
    expect(stepPane("left", 476, "ArrowRight", false)).toBe(480);
    expect(stepPane("left", 250, "ArrowLeft", true)).toBe(240);
    expect(stepPane("margin", 285, "ArrowRight", false)).toBe(280);
    expect(stepPane("margin", 550, "ArrowLeft", true)).toBe(560);
  });

  it("clamps at the room the window leaves the centre", () => {
    expect(stepPane("left", 270, "ArrowRight", true, { viewport: 1024, other: 280 })).toBe(280);
    expect(stepPane("margin", 500, "ArrowLeft", true, { viewport: 1024, other: RAIL_PX })).toBe(512);
  });

  it("Home is the pane's least width, End its greatest, Enter its default", () => {
    expect(stepPane("left", 400, "Home", false)).toBe(240);
    expect(stepPane("left", 300, "End", false)).toBe(480);
    expect(stepPane("left", 400, "Enter", false)).toBe(320);
    expect(stepPane("left", 400, "Enter", false, { viewport: 1920, other: 360 })).toBe(360);
    expect(stepPane("margin", 400, "Home", false)).toBe(280);
    expect(stepPane("margin", 300, "End", false)).toBe(560);
    expect(stepPane("margin", 300, "Enter", false)).toBe(360);
    expect(stepPane("left", 400, "End", false, { viewport: 1024, other: 280 })).toBe(280);
  });

  it("takes no other key", () => {
    for (const key of ["ArrowUp", "ArrowDown", "Tab", " ", "Escape", "a", "PageUp"]) {
      expect(stepPane("left", 320, key, false)).toBeNull();
      expect(stepPane("margin", 360, key, true)).toBeNull();
    }
  });
});

describe("fitPanes — what gives way when the window is too narrow for the remembered widths", () => {
  it("1440, first visit: the defaults, the left pane pinned, the centre the rest", () => {
    expect(fitPanes({ viewport: 1440 })).toEqual({
      left: 320,
      leftTrack: 320,
      margin: 360,
      centre: 1440 - 320 - 360 - 24,
      pinned: true,
      forced: false,
    });
  });

  it("1920 and 2560: the left pane's default is 360 from 1536", () => {
    expect(fitPanes({ viewport: 1920 }).left).toBe(360);
    expect(fitPanes({ viewport: 2560 }).left).toBe(360);
    expect(fitPanes({ viewport: 1535 }).left).toBe(320);
  });

  it("keeps the remembered widths where they fit", () => {
    const fit = fitPanes({ viewport: 1920, left: 400, margin: 500, leftPinned: true });
    expect([fit.left, fit.margin, fit.pinned, fit.centre]).toEqual([400, 500, true, 1920 - 400 - 500 - 24]);
  });

  // Re-aimed (ruling §1h.115 item 4, amending D6): was "a first visit narrower than 1144 starts with the left pane as the rail; from 1144
  // it starts pinned". The owner's laptop at 125 % is 1093 css px, where the rail hid the map on arrival; the panes fit there, pinned.
  it("a first visit is pinned at every width from 1024: 280 · 440 · 280 at 1024, 320 · 440 · 309 at 1093, the defaults from 1144", () => {
    const at1024 = fitPanes({ viewport: 1024 });
    expect([at1024.left, at1024.centre, at1024.margin, at1024.pinned, at1024.forced, at1024.leftTrack]).toEqual([280, 440, 280, true, false, 280]);
    const at1093 = fitPanes({ viewport: 1093 });
    expect([at1093.left, at1093.centre, at1093.margin, at1093.pinned, at1093.forced, at1093.leftTrack]).toEqual([320, 440, 309, true, false, 320]);
    const at1143 = fitPanes({ viewport: 1143 });
    expect([at1143.left, at1143.centre, at1143.margin, at1143.pinned]).toEqual([320, 440, 359, true]);
    expect(fitPanes({ viewport: 1144 })).toMatchObject({ left: 320, centre: 440, margin: 360, pinned: true, forced: false });
    for (let viewport = SHELL_MIN_VIEWPORT_PX; viewport <= 2600; viewport += 1) {
      const fit = fitPanes({ viewport });
      expect(fit.pinned).toBe(true);
      expect(fit.forced).toBe(false);
      expect(fit.leftTrack).toBe(fit.left);
    }
  });

  it("a first visit is the same as a reader who pinned the pane, at every width from 1024 (no choice yet means pinned)", () => {
    for (let viewport = SHELL_MIN_VIEWPORT_PX; viewport <= 2600; viewport += 7) {
      expect(fitPanes({ viewport })).toEqual(fitPanes({ viewport, leftPinned: true }));
    }
  });

  it("a reader's remembered fold still wins at the narrow widths a first visit is pinned at", () => {
    for (const viewport of [1024, 1093, 1143]) {
      const fit = fitPanes({ viewport, leftPinned: false });
      expect([fit.pinned, fit.forced, fit.leftTrack]).toEqual([false, false, 48]);
      expect(fit.centre).toBe(viewport - 48 - fit.margin - 24);
    }
  });

  it("the reader's choice beats the first-visit rule either way", () => {
    expect(fitPanes({ viewport: 1600, leftPinned: false }).pinned).toBe(false);
    expect(fitPanes({ viewport: 1600, leftPinned: false }).leftTrack).toBe(48);
    expect(fitPanes({ viewport: 1100, leftPinned: true }).pinned).toBe(true);
  });

  it("a reader who pinned the left pane keeps it pinned below 1144 by shrinking: the margin first, then the left pane", () => {
    // 1093: 320 + 360 + 440 + 24 = 1144, 51 over; the margin gives 51 (360 -> 309), the left pane keeps its 320.
    const a = fitPanes({ viewport: 1093, leftPinned: true });
    expect([a.left, a.margin, a.pinned, a.centre]).toEqual([320, 309, true, 440]);
    // 1024: 120 over; the margin gives 80 (to 280), the left pane the other 40 (to 280).
    const b = fitPanes({ viewport: 1024, leftPinned: true });
    expect([b.left, b.margin, b.pinned, b.forced, b.centre]).toEqual([280, 280, true, false, 440]);
  });

  it("gives the remembered widths back when the window grows again (nothing is overwritten)", () => {
    const remembered = { left: 400, margin: 450, leftPinned: true };
    const squeezed = fitPanes({ viewport: 1024, ...remembered });
    const roomy = fitPanes({ viewport: 1600, ...remembered });
    // 400 + 450 + 440 + 24 = 1314, 290 over 1024: the margin gives 170 (to 280), the left pane the other 120 (to 280).
    expect([squeezed.left, squeezed.margin]).toEqual([280, 280]);
    expect([roomy.left, roomy.margin]).toEqual([400, 450]);
  });

  it("clamps absurd remembered widths to the pane's own range first", () => {
    const fit = fitPanes({ viewport: 2560, left: 10, margin: 5000, leftPinned: true });
    expect([fit.left, fit.margin]).toEqual([240, 560]);
    const nan = fitPanes({ viewport: 2560, left: Number.NaN, margin: Number.NaN });
    expect([nan.left, nan.margin]).toEqual([360, 360]);
  });

  it("below the shell the rail is forced when even the narrowest panes pinned do not fit", () => {
    // 984 is the least a pinned left pane needs; 900 is under it, so the pinned choice is kept but the pane is the rail.
    const fit = fitPanes({ viewport: 900, leftPinned: true });
    expect([fit.pinned, fit.forced, fit.leftTrack, fit.left]).toEqual([false, true, 48, 320]);
    expect(fit.margin).toBe(360);
    expect(fit.centre).toBe(900 - 48 - 360 - 24);
  });

  it("never leaves the centre under its minimum at any window from 1024 up, whatever was remembered", () => {
    const widths = [undefined, 0, 240, 320, 360, 480, 9999];
    const margins = [undefined, 0, 280, 360, 560, 9999];
    const pins = [undefined, true, false];
    for (let viewport = SHELL_MIN_VIEWPORT_PX; viewport <= 2600; viewport += 17) {
      for (const left of widths) {
        for (const margin of margins) {
          for (const leftPinned of pins) {
            const fit = fitPanes({ viewport, left, margin, leftPinned });
            expect(fit.centre).toBeGreaterThanOrEqual(CENTRE_MIN_PX);
            expect(fit.left).toBeGreaterThanOrEqual(LEFT_MIN_PX);
            expect(fit.left).toBeLessThanOrEqual(LEFT_MAX_PX);
            expect(fit.margin).toBeGreaterThanOrEqual(MARGIN_MIN_PX);
            expect(fit.margin).toBeLessThanOrEqual(MARGIN_MAX_PX);
            expect(fit.leftTrack + fit.margin + fit.centre + 2 * DIVIDER_PX).toBe(viewport);
            expect(fit.forced).toBe(false);
          }
        }
      }
    }
  });

  // Re-aimed (ruling §1h.115 item 4): the shell's minimum is now pinned on a first visit, so the centre there is its 440 (it was the
  // rail's 1024 - 48 - 360 - 24).
  it("a window that is not a number is read as the shell's minimum", () => {
    expect(fitPanes({ viewport: Number.NaN })).toEqual(fitPanes({ viewport: SHELL_MIN_VIEWPORT_PX }));
    expect(fitPanes({ viewport: Number.NaN }).centre).toBe(CENTRE_MIN_PX);
  });
});

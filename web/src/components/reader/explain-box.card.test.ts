import { describe, expect, it } from "vitest";

// P9-50 (A P9-W3's N7 and §3 c; C P9-17 §8 item 3; the owner's rule, §1a.18 (c) / ruling §1h.57: "始终让窗口存在于屏幕里" — the window always stays
// inside the screen, and when the selected paragraph is at the bottom its bottom sits on the screen's bottom): the card, the explain
// window between 640 and 1023 px (`placeCard`, under or above the selection, P3-02), knew neither the masthead nor the foot legend.
//
//   - At 768 × 1000 a thread grown by replies stood at top 12 px, 924.7 px tall: the masthead's mark, "←" and WRITE (z 50 under the
//     card's 70) were under it. The dock never goes above `DOCK_TOP_PX`; the card now doesn't either, from 768 px, where the masthead
//     (`hidden md:grid h-12`) shows. Under 768 px there is none, and the head stays the card's 12-px margin.
//   - Placed under the selection its bottom stood 12 px above the screen's last pixel — 16 px INTO the 28-px foot legend (measured at
//     768 × 1000: bottom 988 on a legend whose top is 972). It now stands on the legend's top, as the dock's does
//     (`legendOf`, which follows Fit's zoom), and, where there is no legend (under 768 px, the thumb bar), on the screen's bottom.
//
// Pure functions, no DOM: the pixels are measured in a browser (checkpoint P9-50).

import { placeCard, placePanel } from "./explain-box";
import { DOCK_BOTTOM_PX, DOCK_TOP_PX, MASTHEAD_MIN_VIEWPORT_PX, legendHeightPx } from "./explain-dock";

type Placed = { top?: number; bottom?: number; maxHeight: number };
/** The card's top edge when it is as tall as the room it is given (a long thread): the tallest it can stand. */
const topEdge = (place: Placed, height: number) => place.top ?? height - (place.bottom ?? 0) - place.maxHeight;
/** The card's lowest bottom edge: its top and the whole room, or the offset it is anchored by. */
const bottomEdge = (place: Placed, height: number) => (place.top !== undefined ? place.top + place.maxHeight : height - (place.bottom ?? 0));

/** A one-line selection whose top is at `top`. */
const line = (top: number, left = 40) => ({ left, top, right: left + 360, bottom: top + 20 });

describe("the card (640 to 1023 px) never climbs over the masthead (P9-50 rule 1; A P9-W3's N7)", () => {
  it("a thread as tall as the room above a low selection tops out at the masthead's foot (48), not at 12: A's 768 × 1000 case", () => {
    // A's measurement: the selection's first line at 944.7 (60 px above the bottom edge); the card flips above it, 8 px clear of the words.
    const place = placeCard(line(944.7), { width: 768, height: 1000 });

    expect(place.top).toBeUndefined();
    expect(topEdge(place, 1000)).toBeCloseTo(DOCK_TOP_PX, 6);
    expect(place.bottom).toBeCloseTo(1000 - 944.7 + 8, 6);
  });

  it("at 900 × 900 and at 1023 × 768 too: the same head", () => {
    for (const [width, height, top] of [[900, 900, 840], [1023, 768, 700], [800, 1000, 960]] as const) {
      expect(topEdge(placeCard(line(top), { width, height }), height), `${width} x ${height}`).toBeCloseTo(DOCK_TOP_PX, 6);
    }
  });

  it("is the dock's head: `DOCK_TOP_PX`, the masthead's own height, which is there from `MASTHEAD_MIN_VIEWPORT_PX` (768 px)", () => {
    expect(DOCK_TOP_PX).toBe(48);
    expect(MASTHEAD_MIN_VIEWPORT_PX).toBe(768);
  });

  it("holds at every selection height, window height and width from 768 to 1023: the top edge is never above 48", () => {
    for (const width of [768, 800, 900, 1023]) {
      for (const height of [600, 700, 768, 900, 1000]) {
        for (let top = -20; top <= height; top += 23) {
          const place = placeCard(line(top), { width, height });
          expect(topEdge(place, height), `${width} x ${height}, selection at ${top}`).toBeGreaterThanOrEqual(DOCK_TOP_PX - 1e-6);
        }
      }
    }
  });

  it("a selection scrolled up under the masthead: the card under it begins at the masthead's foot, not behind it", () => {
    const place = placeCard({ left: 40, top: 10, right: 400, bottom: 30 }, { width: 900, height: 900 });

    expect(place.top).toBe(DOCK_TOP_PX);
    expect(place.bottom).toBeUndefined();
  });

  it("under 768 px there is no masthead: the head is the card's own 12-px margin, as before (640, 700, 767)", () => {
    for (const width of [640, 700, 767]) {
      const place = placeCard(line(840), { width, height: 900 });
      expect(topEdge(place, 900), `${width} px`).toBeCloseTo(12, 6);
    }
  });
});

describe("the card's bottom stands where the dock's does: on the foot legend's top (P9-50 rule 2; A P9-W3 §3 c)", () => {
  it("placed under the selection it ends on the legend's top (972 at 1000 px), not 12 px above the screen's last pixel (988), 16 px into the legend", () => {
    for (const [width, height] of [[768, 1000], [900, 900], [1023, 768]] as const) {
      const place = placeCard(line(300), { width, height });

      expect(place.top, `${width} x ${height}`).toBe(328);
      expect(bottomEdge(place, height), `${width} x ${height}`).toBe(height - DOCK_BOTTOM_PX);
    }
  });

  it("follows Fit's zoom as the dock does: the legend is 28 × zoom tall on screen, and the card ends on its top", () => {
    const legend = legendHeightPx(1.142);
    const place = placeCard(line(300), { width: 900, height: 1000, legend });

    expect(legend).toBeGreaterThan(DOCK_BOTTOM_PX);
    expect(bottomEdge(place, 1000)).toBeCloseTo(1000 - legend, 6);
    // …and a selection low enough to flip the card above it is held off the same strip.
    const above = placeCard(line(990), { width: 900, height: 1000, legend });
    expect(bottomEdge(above, 1000)).toBeCloseTo(1000 - legend, 6);
  });

  it("with no legend — under 768 px, where the thumb bar stands in its place — the bottom is the screen's bottom (the sheet's, from 640 to 767)", () => {
    for (const width of [640, 700, 767]) {
      const place = placeCard(line(300), { width, height: 900 });
      expect(bottomEdge(place, 900), `${width} px`).toBe(900);
    }
  });

  it("a selection lower than the legend's top: the card above it stops on the legend, not below it", () => {
    // The selection's first line 15 px above the screen's last pixel, under the legend's top (972): the card cannot end 8 px above it (977).
    const place = placeCard(line(985), { width: 768, height: 1000 });

    expect(place.top).toBeUndefined();
    expect(place.bottom).toBe(DOCK_BOTTOM_PX);
    expect(bottomEdge(place, 1000)).toBe(1000 - DOCK_BOTTOM_PX);
    expect(topEdge(place, 1000)).toBeGreaterThanOrEqual(DOCK_TOP_PX);
  });

  it("holds at every selection height, window height and width of the card range: the bottom edge is never below the legend's top (the screen's bottom under 768 px)", () => {
    for (const width of [640, 700, 767, 768, 800, 900, 1023]) {
      const floor = width >= MASTHEAD_MIN_VIEWPORT_PX ? DOCK_BOTTOM_PX : 0;
      for (const height of [600, 700, 768, 900, 1000]) {
        for (let top = -20; top <= height + 20; top += 23) {
          const place = placeCard(line(top), { width, height });
          expect(bottomEdge(place, height), `${width} x ${height}, selection at ${top}`).toBeLessThanOrEqual(height - floor + 1e-6);
        }
      }
    }
  });
});

describe("everything else as it was (P9-50 rule 3)", () => {
  it("above a low selection the card's bottom edge is 8 px clear of the selected words: P3-02's 'never covers the words it explains' (A's 936.7)", () => {
    const place = placeCard(line(944.7), { width: 768, height: 1000 });

    expect(bottomEdge(place, 1000)).toBeCloseTo(944.7 - 8, 6);
  });

  it("when the whole card fits below the selection it stands there: 8 px under its last line, 360 wide, at the selection's left", () => {
    for (const width of [768, 900, 1023]) {
      const place = placeCard(line(300, 200), { width, height: 900 });

      expect(place, `${width} px`).toMatchObject({ left: 200, width: 360, top: 328 });
    }
    expect(placeCard(line(300, 800), { width: 900, height: 900 })).toMatchObject({ left: 900 - 360 - 12, width: 360 });
  });

  it("the card range's place is placeCard's, the sheet below 640 and the dock from 1024 are untouched", () => {
    const bounds = line(300);
    expect(placePanel(bounds, { width: 768, height: 1000 }, 300)).toEqual({ kind: "card", ...placeCard(bounds, { width: 768, height: 1000 }) });
    expect(placePanel(bounds, { width: 390, height: 844 }, 300)).toEqual({ kind: "sheet", left: 0, width: 390, bottom: 0, maxHeight: Math.floor(844 * 0.6) });
    // The dock: level with the paragraph's first line (300), held between the masthead's foot and the room its height needs above the legend.
    expect(placePanel(bounds, { width: 1440, height: 1000 }, 300, 360)).toEqual({ kind: "dock", right: 0, width: 360, top: 300, maxHeight: 1000 - 300 - 28 });
    expect(placePanel(bounds, { width: 1440, height: 1000 }, 900, 360)).toEqual({ kind: "dock", right: 0, width: 360, top: 1000 - 28 - 360, maxHeight: 360 });
    expect(placePanel(bounds, { width: 1440, height: 1000 }, 10, 360)).toEqual({ kind: "dock", right: 0, width: 360, top: 48, maxHeight: 1000 - 48 - 28 });
  });
});

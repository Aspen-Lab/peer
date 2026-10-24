import { describe, expect, it } from "vitest";
import * as lightbox from "./figure-lightbox";
import {
  clampFigurePan,
  clampFigureSize,
  clampZoom,
  DETAIL_ZOOM,
  FIGURE_ZOOM_STEPS,
  FIT_VIEW,
  nextZoom,
  SUMMARY_ZOOM_STEPS,
  visibleView,
  wheelFactor,
  zoomAbout,
  zoomView,
} from "./figure-zoom";

// P11-11 (B P11-05 §2.2; ruling §1h.113 (c) D7): the zoom core the Summary's lightbox and the margin's figure card share.
// These are the numbers only — no React, no DOM. The pointer, the wheel and the keys that drive them are use-figure-zoom.test.tsx;
// the clamps' own cases stay in figure-lightbox.test.ts, unchanged, through the lightbox's re-export (pinned here).

describe("the steps", () => {
  it("the card runs from fit to 6x in six steps; the Summary keeps its two states, fit and 2x", () => {
    expect(FIGURE_ZOOM_STEPS).toEqual([1, 1.5, 2, 3, 4, 6]);
    expect(DETAIL_ZOOM).toBe(2);
    expect(SUMMARY_ZOOM_STEPS).toEqual([1, 2]);
  });
});

describe("the clamps moved here and are still the lightbox's exports", () => {
  it("figure-lightbox re-exports the very functions (its importers and figure-lightbox.test.ts do not change)", () => {
    expect(lightbox.clampFigureSize).toBe(clampFigureSize);
    expect(lightbox.clampFigurePan).toBe(clampFigurePan);
    expect(lightbox.DETAIL_ZOOM).toBe(DETAIL_ZOOM);
  });

  it("clampFigureSize fills 96 % of the limiting side; clampFigurePan keeps each edge reachable", () => {
    expect(clampFigureSize({ width: 300, height: 200 }, { width: 400, height: 300 })).toEqual({ width: 384, height: 256 });
    expect(clampFigurePan({ x: 2000, y: -2000 }, { width: 1600, height: 1200 }, { width: 800, height: 600 })).toEqual({ x: 400, y: -300 });
  });
});

describe("clampZoom", () => {
  it("holds a zoom between fit and the last step — at both ends", () => {
    expect(clampZoom(0.2, FIGURE_ZOOM_STEPS)).toBe(1);
    expect(clampZoom(1, FIGURE_ZOOM_STEPS)).toBe(1);
    expect(clampZoom(2.7, FIGURE_ZOOM_STEPS)).toBe(2.7);
    expect(clampZoom(6, FIGURE_ZOOM_STEPS)).toBe(6);
    expect(clampZoom(9, FIGURE_ZOOM_STEPS)).toBe(6);
  });

  it("uses the steps it is given: the Summary stops at 2x", () => {
    expect(clampZoom(6, SUMMARY_ZOOM_STEPS)).toBe(2);
    expect(clampZoom(1.4, SUMMARY_ZOOM_STEPS)).toBe(1.4);
  });

  it("a zoom that is not a number is fit", () => {
    expect(clampZoom(Number.NaN, FIGURE_ZOOM_STEPS)).toBe(1);
    expect(clampZoom(Number.POSITIVE_INFINITY, FIGURE_ZOOM_STEPS)).toBe(1);
  });
});

describe("nextZoom", () => {
  it("steps up through the card's six steps and stops at 6x", () => {
    const up: number[] = [];
    for (let zoom = 1; up.length < 7; ) {
      zoom = nextZoom(zoom, FIGURE_ZOOM_STEPS, 1);
      up.push(zoom);
    }
    expect(up).toEqual([1.5, 2, 3, 4, 6, 6, 6]);
  });

  it("steps down and stops at fit", () => {
    const down: number[] = [];
    for (let zoom = 6; down.length < 7; ) {
      zoom = nextZoom(zoom, FIGURE_ZOOM_STEPS, -1);
      down.push(zoom);
    }
    expect(down).toEqual([4, 3, 2, 1.5, 1, 1, 1]);
  });

  it("from between steps (the wheel leaves it there) goes to the nearest step in the direction asked", () => {
    expect(nextZoom(1.2, FIGURE_ZOOM_STEPS, 1)).toBe(1.5);
    expect(nextZoom(1.2, FIGURE_ZOOM_STEPS, -1)).toBe(1);
    expect(nextZoom(5.9, FIGURE_ZOOM_STEPS, 1)).toBe(6);
    expect(nextZoom(5.9, FIGURE_ZOOM_STEPS, -1)).toBe(4);
  });

  it("a zoom a float's width off a step is that step", () => {
    expect(nextZoom(1.5 + 1e-9, FIGURE_ZOOM_STEPS, 1)).toBe(2);
    expect(nextZoom(3 - 1e-9, FIGURE_ZOOM_STEPS, -1)).toBe(2);
  });

  it("a zoom outside the range is held to it first", () => {
    expect(nextZoom(0.3, FIGURE_ZOOM_STEPS, 1)).toBe(1.5);
    expect(nextZoom(9, FIGURE_ZOOM_STEPS, -1)).toBe(4);
  });

  it("the Summary's two states: up from fit is 2x, down from 2x is fit, and nowhere else to go", () => {
    expect(nextZoom(1, SUMMARY_ZOOM_STEPS, 1)).toBe(2);
    expect(nextZoom(2, SUMMARY_ZOOM_STEPS, 1)).toBe(2);
    expect(nextZoom(2, SUMMARY_ZOOM_STEPS, -1)).toBe(1);
    expect(nextZoom(1, SUMMARY_ZOOM_STEPS, -1)).toBe(1);
  });
});

describe("zoomAbout — zoom at the pointer", () => {
  it("keeps the picture point under the anchor where it was (anchor measured from the viewport's centre)", () => {
    const pan = { x: 10, y: -20 };
    const anchor = { x: 100, y: 50 };
    const next = zoomAbout(pan, 2, 3, anchor);
    // The point under the anchor, from the picture's centre in unscaled pixels: (anchor - pan) / zoom.
    const before = { x: (anchor.x - pan.x) / 2, y: (anchor.y - pan.y) / 2 };
    const after = { x: (anchor.x - next.x) / 3, y: (anchor.y - next.y) / 3 };
    expect(after.x).toBeCloseTo(before.x, 9);
    expect(after.y).toBeCloseTo(before.y, 9);
    expect(next).toEqual({ x: 100 - (100 - 10) * 1.5, y: 50 - (50 + 20) * 1.5 });
  });

  it("about the viewport's centre it scales the pan; with the anchor on the picture's own centre it does not move it", () => {
    expect(zoomAbout({ x: 40, y: -20 }, 2, 4, { x: 0, y: 0 })).toEqual({ x: 80, y: -40 });
    expect(zoomAbout({ x: 40, y: -20 }, 4, 1, { x: 0, y: 0 })).toEqual({ x: 10, y: -5 });
    expect(zoomAbout({ x: 40, y: -20 }, 2, 5, { x: 40, y: -20 })).toEqual({ x: 40, y: -20 });
  });

  it("zooming to the zoom it has is no move; a zoom that is not positive is left alone", () => {
    expect(zoomAbout({ x: 7, y: 9 }, 3, 3, { x: 123, y: -45 })).toEqual({ x: 7, y: 9 });
    expect(zoomAbout({ x: 7, y: 9 }, 0, 3, { x: 123, y: -45 })).toEqual({ x: 7, y: 9 });
  });
});

describe("wheelFactor", () => {
  it("scrolling up zooms in, scrolling down zooms out, no scroll leaves the zoom alone", () => {
    expect(wheelFactor({ deltaY: -100 })).toBeGreaterThan(1);
    expect(wheelFactor({ deltaY: 100 })).toBeLessThan(1);
    expect(wheelFactor({ deltaY: 0 })).toBe(1);
  });

  it("is exp(-deltaY * 0.0015): a 100-px notch is about 16 % in and 14 % out", () => {
    expect(wheelFactor({ deltaY: -100 })).toBeCloseTo(Math.exp(0.15), 12);
    expect(wheelFactor({ deltaY: 100 })).toBeCloseTo(Math.exp(-0.15), 12);
  });

  it("is symmetric: a notch and its reverse cancel", () => {
    expect(wheelFactor({ deltaY: 37 }) * wheelFactor({ deltaY: -37 })).toBeCloseTo(1, 12);
  });

  it("reads deltaMode: pixels by default, a line as 40 px, a page as 800 px", () => {
    expect(wheelFactor({ deltaY: 100, deltaMode: 0 })).toBe(wheelFactor({ deltaY: 100 }));
    expect(wheelFactor({ deltaY: 3, deltaMode: 1 })).toBeCloseTo(wheelFactor({ deltaY: 120 }), 12);
    expect(wheelFactor({ deltaY: 1, deltaMode: 2 })).toBeCloseTo(wheelFactor({ deltaY: 800 }), 12);
  });

  it("an unknown deltaMode is read as pixels", () => {
    expect(wheelFactor({ deltaY: 50, deltaMode: 7 })).toBe(wheelFactor({ deltaY: 50 }));
  });
});

// A 600 x 400 picture in a 400 x 300 box: fitted to 384 x 256.
const fit = { width: 384, height: 256 };
const box = { width: 400, height: 300 };
/** A pan clamped to nothing can come out as -0, which `toEqual` tells from 0. */
const at = (point: { x: number; y: number }) => ({ x: point.x + 0, y: point.y + 0 });

describe("zoomView and visibleView — the pan is clamped at every size change", () => {
  it("fit is centred and holds nothing", () => {
    expect(FIT_VIEW).toEqual({ zoom: 1, pan: { x: 0, y: 0 } });
    expect(at(visibleView(FIT_VIEW, fit, box).pan)).toEqual({ x: 0, y: 0 });
  });

  it("zooming in about a corner point keeps that point still, and the pan stays inside the zoomed picture", () => {
    // 2x: 768 x 512 in 400 x 300 → the pan may reach ±184 across, ±106 down.
    const anchor = { x: 150, y: 100 };
    const next = zoomView(FIT_VIEW, 2, anchor, fit, box);
    expect(next.zoom).toBe(2);
    // pan' = anchor - (anchor - 0) * 2 = -anchor, inside the limits.
    expect(at(next.pan)).toEqual({ x: -150, y: -100 });
  });

  it("clamps the pan the zoom asks for to the picture's edges", () => {
    const next = zoomView(FIT_VIEW, 2, { x: 390, y: 290 }, fit, box);
    expect(at(next.pan)).toEqual({ x: -184, y: -106 });
  });

  it("holds the zoom inside the steps — at both ends", () => {
    expect(zoomView(FIT_VIEW, 40, { x: 0, y: 0 }, fit, box).zoom).toBe(6);
    expect(zoomView({ zoom: 3, pan: { x: 0, y: 0 } }, 0.1, { x: 0, y: 0 }, fit, box).zoom).toBe(1);
    expect(zoomView(FIT_VIEW, 40, { x: 0, y: 0 }, fit, box, SUMMARY_ZOOM_STEPS).zoom).toBe(2);
  });

  it("zooming out to fit comes back centred, wherever the pan was", () => {
    const zoomed = { zoom: 3, pan: { x: -300, y: 120 } };
    expect(at(zoomView(zoomed, 1, { x: 90, y: -40 }, fit, box).pan)).toEqual({ x: 0, y: 0 });
  });

  it("zooming out a step keeps the point under the anchor while the picture still overflows", () => {
    const view = { zoom: 4, pan: { x: -300, y: 100 } };
    const anchor = { x: 60, y: -20 };
    const next = zoomView(view, 3, anchor, fit, box);
    const seen = visibleView(view, fit, box);
    const before = { x: (anchor.x - seen.pan.x) / 4, y: (anchor.y - seen.pan.y) / 4 };
    const after = { x: (anchor.x - next.pan.x) / 3, y: (anchor.y - next.pan.y) / 3 };
    expect(after.x).toBeCloseTo(before.x, 9);
    expect(after.y).toBeCloseTo(before.y, 9);
  });

  it("a view asked for is drawn held to the size now: a smaller box re-clamps it, a larger one frees it again, and the asked-for view is never rewritten", () => {
    const asked = { zoom: 2, pan: { x: 180, y: -100 } };
    expect(at(visibleView(asked, fit, box).pan)).toEqual({ x: 180, y: -100 });
    // A 700 x 400 box: the zoomed picture (768 x 512) overflows it by 68 across and 112 down → the pan may reach ±34 and ±56.
    expect(at(visibleView(asked, fit, { width: 700, height: 400 }).pan)).toEqual({ x: 34, y: -56 });
    // …and a box larger than the zoomed picture holds it centred.
    expect(at(visibleView(asked, fit, { width: 900, height: 600 }).pan)).toEqual({ x: 0, y: 0 });
    // What was asked for is not rewritten: the original box draws it as it was.
    expect(asked).toEqual({ zoom: 2, pan: { x: 180, y: -100 } });
    expect(at(visibleView(asked, fit, box).pan)).toEqual({ x: 180, y: -100 });
  });

  it("a zoom outside the steps is drawn inside them", () => {
    expect(visibleView({ zoom: 12, pan: { x: 0, y: 0 } }, fit, box).zoom).toBe(6);
    expect(visibleView({ zoom: 12, pan: { x: 0, y: 0 } }, fit, box, SUMMARY_ZOOM_STEPS).zoom).toBe(2);
  });
});

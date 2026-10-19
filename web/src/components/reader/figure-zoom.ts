// The zoom core, shared by the Summary's lightbox and the margin's figure card (P11-11; B P11-05 §2.2, ruling §1h.113 (c) D7).
//
// A plain module: no React, no DOM. It holds the numbers of "a figure fitted into a box, zoomed about a point and panned
// inside the box" — the steps, the next step, the pan that keeps the point under the pointer still, the wheel's rate, and the
// two clamps that were the lightbox's own (`clampFigureSize`, `clampFigurePan`; `figure-lightbox.tsx` re-exports them, so
// its importers do not change). The pointer, the wheel and the keys that drive these numbers are `use-figure-zoom.ts`.
//
// Geometry used throughout: the picture is centred in its box, drawn at the size `clampFigureSize` gives and then
// `translate(pan) scale(zoom)` about its own centre. A point is "measured from the viewport's centre" when (0, 0) is the
// centre of the box the picture is centred in.

export type Size = { width: number; height: number };
export type Point = { x: number; y: number };

/** The Summary's click zooms from fit to this and back. */
export const DETAIL_ZOOM = 2;

/** The margin card's steps for minus / plus and the keys: fit (1x) to 6x of fit (ruling §1h.113 (c) D7). */
export const FIGURE_ZOOM_STEPS: readonly number[] = [1, 1.5, 2, 3, 4, 6];

/** The Summary keeps its two states: fit, and 2x. */
export const SUMMARY_ZOOM_STEPS: readonly number[] = [1, DETAIL_ZOOM];

/** The wheel's rate: a 100-px notch is about 14 % out or 16 % in. */
const WHEEL_ZOOM_RATE = 0.0015;
/** What one unit of `deltaMode` 0 / 1 / 2 (pixels, lines, pages) is worth in pixels. */
const WHEEL_UNIT_PX = [1, 40, 800] as const;
/** Two zooms closer than this are the same step (a wheel's float against a step's literal). */
const SAME_ZOOM = 1e-6;

/** Fit the entire figure into the available space, preserving its aspect ratio. */
export function clampFigureSize(natural: Size, viewport: Size): Size {
  if (natural.width <= 0 || natural.height <= 0 || viewport.width <= 0 || viewport.height <= 0) {
    return { width: 0, height: 0 };
  }
  const scale = Math.min(viewport.width * 0.96 / natural.width, viewport.height * 0.96 / natural.height);
  return { width: natural.width * scale, height: natural.height * scale };
}

/** Keep every edge reachable without letting the zoomed figure get dragged away. */
export function clampFigurePan(pan: Point, image: Size, viewport: Size): Point {
  const limitX = Math.max(0, (image.width - viewport.width) / 2);
  const limitY = Math.max(0, (image.height - viewport.height) / 2);
  return {
    x: Math.max(-limitX, Math.min(limitX, pan.x)),
    y: Math.max(-limitY, Math.min(limitY, pan.y)),
  };
}

/** The zoom held inside the steps: never below the first (fit), never above the last. */
export function clampZoom(zoom: number, steps: readonly number[] = FIGURE_ZOOM_STEPS): number {
  const lowest = steps[0];
  const highest = steps[steps.length - 1];
  if (!Number.isFinite(zoom)) return lowest;
  return Math.min(highest, Math.max(lowest, zoom));
}

/**
 * The step above (`direction` 1) or below (-1) the zoom — the nearest one, whatever the zoom is (a wheel leaves it between
 * steps). At either end it is the end itself. `steps` runs from fit upward.
 */
export function nextZoom(zoom: number, steps: readonly number[], direction: 1 | -1): number {
  const current = clampZoom(zoom, steps);
  if (direction > 0) {
    for (const step of steps) if (step > current + SAME_ZOOM) return step;
    return steps[steps.length - 1];
  }
  for (let index = steps.length - 1; index >= 0; index--) if (steps[index] < current - SAME_ZOOM) return steps[index];
  return steps[0];
}

/**
 * The pan after zooming from `zoom` to `next` with `anchor` held still: the picture point under the anchor is
 * (anchor - pan) / zoom from the picture's centre, and it must be under the anchor again, so the new pan is
 * anchor - (anchor - pan) * next / zoom. Not clamped — the caller clamps to the size the new zoom gives.
 */
export function zoomAbout(pan: Point, zoom: number, next: number, anchor: Point): Point {
  if (!(zoom > 0)) return pan;
  const ratio = next / zoom;
  return { x: anchor.x - (anchor.x - pan.x) * ratio, y: anchor.y - (anchor.y - pan.y) * ratio };
}

/** The factor one wheel event multiplies the zoom by: scrolling up (a negative `deltaY`) zooms in; pixels, lines and pages alike. */
export function wheelFactor(event: { deltaY: number; deltaMode?: number }): number {
  const unit = WHEEL_UNIT_PX[event.deltaMode ?? 0] ?? 1;
  return Math.exp(-event.deltaY * unit * WHEEL_ZOOM_RATE);
}

/** What the reader asked for: a zoom and a pan. What is drawn is `visibleView` of it, for the size now. */
export interface FigureView {
  zoom: number;
  pan: Point;
}

/** Fit, centred. */
export const FIT_VIEW: FigureView = { zoom: 1, pan: { x: 0, y: 0 } };

/** The figure's fitted size at a zoom. */
export function scaleSize(size: Size, zoom: number): Size {
  return { width: size.width * zoom, height: size.height * zoom };
}

/**
 * The view as drawn: the zoom inside the steps and the pan held to the size the figure and its box have NOW. A pan is
 * re-clamped at every size change this way (a divider dragged, a window resized, a caption that wraps another line) —
 * the view that was asked for is not rewritten, so it comes back if the box grows back.
 */
export function visibleView(view: FigureView, fit: Size, viewport: Size, steps: readonly number[] = FIGURE_ZOOM_STEPS): FigureView {
  const zoom = clampZoom(view.zoom, steps);
  return { zoom, pan: clampFigurePan(view.pan, scaleSize(fit, zoom), viewport) };
}

/**
 * The view after zooming to `target` (held inside the steps) with `anchor` — measured from the viewport's centre — held
 * still, the pan clamped to the size the new zoom gives. Zooming out to fit comes back centred.
 */
export function zoomView(
  view: FigureView,
  target: number,
  anchor: Point,
  fit: Size,
  viewport: Size,
  steps: readonly number[] = FIGURE_ZOOM_STEPS,
): FigureView {
  const seen = visibleView(view, fit, viewport, steps);
  const zoom = clampZoom(target, steps);
  return { zoom, pan: clampFigurePan(zoomAbout(seen.pan, seen.zoom, zoom, anchor), scaleSize(fit, zoom), viewport) };
}

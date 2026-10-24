"use client";

// P11-11 (B P11-05 §2.2; ruling §1h.113 (c) D1, D7): the pointer, the wheel and the keys of a zoomable figure, shared by
// the Summary's lightbox (two steps, no wheel, no keys: it is as it was) and the margin's figure card (fit to 6x, the wheel
// zooms at the pointer, the keys work while the focus is on the picture).
//
//   - the click toggles fit <-> 2x (`toggle`; the Summary's own click);
//   - a drag pans a zoomed picture: under 4 px it is still a click, and the click that ends a real drag is swallowed;
//   - the wheel (an option) zooms about the pointer. React registers `wheel` as a passive listener at the root
//     (react-dom 19), so a React `onWheel` cannot `preventDefault`: the wheel — and the keys — are NATIVE listeners on
//     the surface, attached through `surfaceRef`, the wheel with `{ passive: false }` so the page neither scrolls nor
//     page-zooms (Ctrl/Cmd + wheel, a trackpad pinch) under the pointer;
//   - the keys `+ = - 0` and the four arrows act only while the focus is on the surface and are consumed there; a key
//     with Ctrl / Cmd (the reading scale's `+` `-`, the browser's own zoom) or Alt (history) is never consumed, and every
//     other key passes.
//
// The math is `figure-zoom.ts`. The view the reader asked for (a zoom and a pan) is held here; what is drawn is that view
// held to the size the figure and its box have now (`visibleView`), so a pan is re-clamped at every size change.

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type PointerEvent } from "react";
import {
  clampFigurePan,
  clampFigureSize,
  clampZoom,
  DETAIL_ZOOM,
  FIGURE_ZOOM_STEPS,
  FIT_VIEW,
  nextZoom,
  scaleSize,
  visibleView,
  wheelFactor,
  zoomView,
  type FigureView,
  type Point,
  type Size,
} from "./figure-zoom";

/** A move shorter than this is still a click. */
export const DRAG_THRESHOLD_PX = 4;
/** One arrow key's pan, in pixels. */
export const PAN_STEP_PX = 48;

const NO_SIZE: Size = { width: 0, height: 0 };
/** The viewport's centre: where minus, plus and the keys zoom about. */
const CENTRE: Point = { x: 0, y: 0 };
/** Two zooms closer than this are the same. */
const SAME_ZOOM = 1e-6;

export interface FigureZoomOptions {
  /** The picture's own size; null until it is known (the fitted size is then 0 x 0). */
  natural: Size | null;
  /** The box the picture is fitted into and panned inside, centred, net of any padding or clearance. */
  viewport: Size;
  /** The zoom steps, from fit (1) upward. Default `FIGURE_ZOOM_STEPS`; the Summary passes `[1, DETAIL_ZOOM]`. */
  steps?: readonly number[];
  /** The wheel zooms about the pointer. Default false. */
  wheel?: boolean;
  /** `+ = - 0` and the arrows while the focus is on the surface. Default true. */
  keys?: boolean;
}

/** The handlers to spread on the pointer surface — a `<button>`, so Enter and Space click it. */
export interface FigureSurface {
  onClick: () => void;
  onPointerDown: (event: PointerEvent<HTMLElement>) => void;
  onPointerMove: (event: PointerEvent<HTMLElement>) => void;
  onPointerUp: (event: PointerEvent<HTMLElement>) => void;
  onPointerCancel: (event: PointerEvent<HTMLElement>) => void;
  onLostPointerCapture: (event: PointerEvent<HTMLElement>) => void;
}

export interface FigureZoom {
  /** The picture's fitted size, before the zoom. */
  size: Size;
  /** The zoom as drawn: 1 is fit. */
  scale: number;
  /** The pan as drawn, held to the picture's size now. */
  offset: Point;
  /** Zoomed past fit. */
  zoomed: boolean;
  /** A drag is in progress. */
  dragging: boolean;
  canZoomIn: boolean;
  canZoomOut: boolean;
  /** The next step up / down, about the viewport's centre. */
  zoomIn: () => void;
  zoomOut: () => void;
  /** Fit, centred. */
  reset: () => void;
  /** The Summary's click: fit <-> 2x, the pan reset. */
  toggle: () => void;
  surface: FigureSurface;
  /** Give it to the surface's `ref`: the wheel and the keys are attached to that element when they are on. */
  surfaceRef: (element: HTMLElement | null) => void;
  /** `{ width, height, transform }` of the surface — the lightbox's own, as it was. */
  style: CSSProperties;
}

interface Drag {
  pointerId: number;
  start: Point;
  origin: Point;
  moved: boolean;
}

export function useFigureZoom({ natural, viewport, steps = FIGURE_ZOOM_STEPS, wheel = false, keys = true }: FigureZoomOptions): FigureZoom {
  const [view, setView] = useState<FigureView>(FIT_VIEW);
  const [dragging, setDragging] = useState(false);
  const [surface, setSurface] = useState<HTMLElement | null>(null);
  const drag = useRef<Drag | null>(null);
  const suppressClick = useRef(false);

  const fit = natural ? clampFigureSize(natural, viewport) : NO_SIZE;
  const seen = visibleView(view, fit, viewport, steps);
  const zoom = seen.zoom;
  const offset = seen.pan;

  // The latest view, ahead of the render while events are in flight (several wheel events can land in one frame), and the
  // geometry the last commit drew: the handlers below read these, never the render's closure, so they can stand still.
  const latest = useRef<FigureView>(FIT_VIEW);
  const world = useRef({ fit, viewport, steps, shown: offset });
  useLayoutEffect(() => {
    world.current = { fit, viewport, steps, shown: offset };
  });
  const apply = useCallback((next: FigureView) => {
    latest.current = next;
    setView(next);
  }, []);
  const look = useCallback((): FigureView => {
    const now = world.current;
    return visibleView(latest.current, now.fit, now.viewport, now.steps);
  }, []);

  const zoomBy = useCallback((direction: 1 | -1, anchor: Point = CENTRE) => {
    const now = world.current;
    const here = look();
    const target = nextZoom(here.zoom, now.steps, direction);
    if (Math.abs(target - here.zoom) < SAME_ZOOM) return;
    apply(zoomView(here, target, anchor, now.fit, now.viewport, now.steps));
  }, [apply, look]);
  const zoomIn = useCallback(() => zoomBy(1), [zoomBy]);
  const zoomOut = useCallback(() => zoomBy(-1), [zoomBy]);
  const reset = useCallback(() => apply(FIT_VIEW), [apply]);
  const toggle = useCallback(() => {
    const now = world.current;
    apply(look().zoom > 1 ? FIT_VIEW : { zoom: clampZoom(DETAIL_ZOOM, now.steps), pan: { x: 0, y: 0 } });
  }, [apply, look]);

  const onClick = useCallback(() => {
    if (suppressClick.current) {
      suppressClick.current = false;
      return;
    }
    toggle();
  }, [toggle]);

  const onPointerDown = useCallback((event: PointerEvent<HTMLElement>) => {
    suppressClick.current = false;
    const here = look();
    if (here.zoom <= 1 || event.button !== 0 || !event.isPrimary) return;
    event.preventDefault();
    event.currentTarget.focus({ preventScroll: true });
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { pointerId: event.pointerId, start: { x: event.clientX, y: event.clientY }, origin: here.pan, moved: false };
    setDragging(true);
  }, [look]);

  const onPointerMove = useCallback((event: PointerEvent<HTMLElement>) => {
    const active = drag.current;
    if (!active || active.pointerId !== event.pointerId) return;
    const dx = event.clientX - active.start.x;
    const dy = event.clientY - active.start.y;
    if (!active.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return;
    active.moved = true;
    const now = world.current;
    const here = look();
    apply({
      zoom: here.zoom,
      pan: clampFigurePan({ x: active.origin.x + dx, y: active.origin.y + dy }, scaleSize(now.fit, here.zoom), now.viewport),
    });
  }, [apply, look]);

  const endDrag = useCallback((event: PointerEvent<HTMLElement>) => {
    const active = drag.current;
    if (!active || active.pointerId !== event.pointerId) return;
    suppressClick.current = active.moved || event.type !== "pointerup";
    drag.current = null;
    setDragging(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }, []);

  // The wheel and the keys: native listeners on the surface, for as long as the surface and the option stand.
  useEffect(() => {
    if (!surface) return;
    const onWheel = (event: WheelEvent) => {
      // Always: the wheel over the picture is the picture's, at either end of the range too (no page scroll, no page zoom).
      event.preventDefault();
      const now = world.current;
      const here = look();
      const target = clampZoom(here.zoom * wheelFactor(event), now.steps);
      if (Math.abs(target - here.zoom) < SAME_ZOOM) return;
      // The surface's own rect is the drawn picture: its centre is the viewport's centre plus the pan that was drawn.
      const box = surface.getBoundingClientRect();
      const anchor = {
        x: event.clientX - (box.left + box.width / 2) + now.shown.x,
        y: event.clientY - (box.top + box.height / 2) + now.shown.y,
      };
      apply(zoomView(here, target, anchor, now.fit, now.viewport, now.steps));
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      const now = world.current;
      const here = look();
      const pan = (dx: number, dy: number) =>
        apply({ zoom: here.zoom, pan: clampFigurePan({ x: here.pan.x + dx, y: here.pan.y + dy }, scaleSize(now.fit, here.zoom), now.viewport) });
      // An arrow moves the view the way it would scroll: Right shows more to the right, so the picture moves left.
      switch (event.key) {
        case "+":
        case "=": zoomBy(1); break;
        case "-": zoomBy(-1); break;
        case "0": apply(FIT_VIEW); break;
        case "ArrowLeft": pan(PAN_STEP_PX, 0); break;
        case "ArrowRight": pan(-PAN_STEP_PX, 0); break;
        case "ArrowUp": pan(0, PAN_STEP_PX); break;
        case "ArrowDown": pan(0, -PAN_STEP_PX); break;
        default: return;
      }
      event.preventDefault();
      event.stopPropagation();
    };
    if (wheel) surface.addEventListener("wheel", onWheel, { passive: false });
    if (keys) surface.addEventListener("keydown", onKeyDown);
    return () => {
      if (wheel) surface.removeEventListener("wheel", onWheel);
      if (keys) surface.removeEventListener("keydown", onKeyDown);
    };
  }, [surface, wheel, keys, apply, look, zoomBy]);

  const last = steps[steps.length - 1];
  return {
    size: fit,
    scale: zoom,
    offset,
    zoomed: zoom > 1,
    dragging,
    canZoomIn: zoom < last - SAME_ZOOM,
    canZoomOut: zoom > steps[0] + SAME_ZOOM,
    zoomIn,
    zoomOut,
    reset,
    toggle,
    surface: { onClick, onPointerDown, onPointerMove, onPointerUp: endDrag, onPointerCancel: endDrag, onLostPointerCapture: endDrag },
    surfaceRef: setSurface,
    style: { width: fit.width, height: fit.height, transform: `translate(${offset.x}px, ${offset.y}px) scale(${zoom})` },
  };
}

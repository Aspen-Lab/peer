"use client";

// P11-15 rule 1 (owner item 1; B P11-05 §2.1, §2.3, §3; ruling §1h.113 (c) D1-D4, D7, D8, D10): the figure card — a Paper-digestion figure
// opened in the margin, one card of the stack beside the sticky notes, the notes window and the explain card.
//
// A card of `kind: "figure"` that fills the room the stack gives it (the whole margin when it is the only card):
//   - the header, 40 px: the label ("Figure 3") and the caption's head, and the X at the top right — a 40 px accent square, as the explain
//     card's is (D8). A press on the header brings the card forward; the X closes it and brings nothing forward;
//   - the zoom row (36 px; only while in front): minus, the readout, plus and Fit — the shared zoom core's steps, fit to 6x (D7);
//   - the picture on the plate mat: the zoom core's surface (a click toggles fit and 2x, a drag pans, the wheel zooms about the pointer
//     — D1 — and `+ = - 0` and the arrows work while the focus is on it);
//   - the caption, whole (D3), in the reading face; it scrolls inside, at most 30 % of the card's height.
// Behind another card only the header shows. The card is non-modal (`role="region"`, no `aria-modal`, Tab is not trapped): the page behind
// stays usable, and Explain's and the keyboard layer's Escape are not shut out (B P11-05 §2.3).
//
// `FigureCardView` has no state and no hook (the card's frame is a prop), so it is tested as markup and as an element tree; `FigureCard`
// owns the zoom (`useFigureZoom`), which therefore stays mounted while the card is behind — a header press brings it back as it was left.
// The host (`figure-host.tsx`) gives it the stack's row and the margin's rect, and a different figure remounts it, which resets the zoom.

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type Ref, type SyntheticEvent } from "react";
import { cn } from "@/lib/cn";
import { quoteHead } from "@/lib/notes/blocks";
import type { FigureRef } from "@/lib/reader/figure-viewer";
import type { Size } from "./figure-zoom";
import { MarginCardShell, type MarginFrame } from "./margin-card";
import { useFigureZoom, type FigureZoom } from "./use-figure-zoom";

/** The figure card's id in the stack (there is one: a second figure replaces the first, D2). */
export const FIGURE_WINDOW_ID = "figure";

/** The zoom row's height. */
export const FIGURE_ZOOM_ROW_PX = 36;

/** The caption takes at most this share of the card's height (D3) and scrolls inside. */
export const FIGURE_CAPTION_SHARE = 0.3;

/** The mat's padding around the picture: the picture is fitted into, and panned inside, the box less this on every side. */
export const FIGURE_MAT_PAD_PX = 8;

/** The caption's tallest, in pixels, for a card `height` tall. */
export function captionMaxHeight(height: number): number {
  return Math.max(0, Math.floor(height * FIGURE_CAPTION_SHARE));
}

/** The box the picture is fitted into, from the mat's own measured box: net of its padding. */
export function figureViewport(box: Size | null): Size {
  if (!box) return { width: 0, height: 0 };
  return {
    width: Math.max(0, box.width - 2 * FIGURE_MAT_PAD_PX),
    height: Math.max(0, box.height - 2 * FIGURE_MAT_PAD_PX),
  };
}

/** What the view needs of the zoom core. */
export type FigureCardZoom = Pick<
  FigureZoom,
  "scale" | "zoomed" | "dragging" | "canZoomIn" | "canZoomOut" | "zoomIn" | "zoomOut" | "reset" | "surface" | "style"
>;

export interface FigureCardViewProps {
  /** "Figure 3" */
  label: string;
  caption: string;
  src: string;
  /** In front and whole; else only its header shows. */
  front: boolean;
  /** The stack's row for this card (`stackLayout`): its top across the screen, its height, its z. */
  top: number;
  height: number;
  z: number;
  /** The margin's left and width; null where there is none. */
  frame: MarginFrame | null;
  zoom: FigureCardZoom;
  /** The mat's box, measured by the card; the surface, which takes the focus when a figure is pressed. */
  boxRef?: Ref<HTMLDivElement>;
  surfaceRef?: Ref<HTMLButtonElement>;
  /** The picture arrived: its own size is read from it when the figure's record did not say. */
  onPictureLoad?: (event: SyntheticEvent<HTMLImageElement>) => void;
  onClose: () => void;
  onRaise: () => void;
}

const stepButton =
  "inline-flex h-7 min-w-7 items-center justify-center rounded-full border border-border-strong bg-surface px-3 font-mono text-caption leading-none text-heading transition-colors hover:bg-surface-hover aria-disabled:cursor-default aria-disabled:opacity-40 aria-disabled:hover:bg-surface";

/** The 40 px header: a button over the label and the caption's head (a press brings the card forward) and the X, a 40 px accent square. */
function FigureCardHeader({ label, caption, onClose, onRaise }: Pick<FigureCardViewProps, "label" | "caption" | "onClose" | "onRaise">) {
  const head = caption.trim() === "" ? "" : quoteHead(caption.replace(/\s+/g, " ").trim());
  return (
    <div className="flex h-10 shrink-0 items-stretch">
      <button
        type="button"
        data-margin-header=""
        data-figure-header=""
        onClick={onRaise}
        className="flex min-w-0 flex-1 items-center gap-2 px-3 text-left transition-colors hover:bg-surface-hover"
      >
        <span className="eyebrow shrink-0 text-heading">{label}</span>
        {head && <span className="min-w-0 truncate font-reading text-body-sm italic text-text-muted">{head}</span>}
      </button>
      <button
        type="button"
        aria-label={`Close ${label}`}
        data-figure-close=""
        onClick={(event) => {
          event.stopPropagation();
          onClose();
        }}
        className="grid h-10 w-10 shrink-0 place-items-center bg-accent text-bg transition-colors hover:bg-accent/90"
      >
        <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
          <path d="M6 6l12 12M18 6L6 18" />
        </svg>
      </button>
    </div>
  );
}

export function FigureCardView({ label, caption, src, front, top, height, z, frame, zoom, boxRef, surfaceRef, onPictureLoad, onClose, onRaise }: FigureCardViewProps) {
  const percent = Math.round(zoom.scale * 100);
  return (
    <MarginCardShell
      id={FIGURE_WINDOW_ID}
      kind="figure"
      role="region"
      aria-label={label}
      front={front}
      top={top}
      height={height}
      z={z}
      frame={frame}
      header={<FigureCardHeader label={label} caption={caption} onClose={onClose} onRaise={onRaise} />}
    >
      <div data-figure-zoom-row="" className="flex shrink-0 items-center gap-2 border-t border-border-strong px-2" style={{ height: FIGURE_ZOOM_ROW_PX }}>
        <button
          type="button"
          aria-label="Zoom out"
          aria-disabled={!zoom.canZoomOut}
          onClick={zoom.zoomOut}
          className={stepButton}
        >
          {"−"}
        </button>
        <span data-figure-readout="" className="min-w-[3.25rem] text-center font-mono text-caption tabular-nums text-text-muted">
          {percent} %
        </span>
        <button
          type="button"
          aria-label="Zoom in"
          aria-disabled={!zoom.canZoomIn}
          onClick={zoom.zoomIn}
          className={stepButton}
        >
          +
        </button>
        <button
          type="button"
          title="Fit the figure to the card"
          aria-disabled={!zoom.zoomed}
          onClick={zoom.reset}
          className={cn(stepButton, "ml-1")}
        >
          Fit
        </button>
      </div>
      <div
        ref={boxRef}
        data-figure-box=""
        className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden border-y border-border-strong bg-[var(--plate-mat)]"
        style={{ padding: FIGURE_MAT_PAD_PX }}
      >
        <button
          ref={surfaceRef}
          type="button"
          aria-label={zoom.zoomed ? "Fit figure to the card" : "Zoom in on figure"}
          aria-pressed={zoom.zoomed}
          title={zoom.zoomed ? "Drag to pan; click to fit" : "Click to zoom in; scroll to zoom"}
          {...zoom.surface}
          className={cn(
            "relative block shrink-0 touch-none select-none",
            zoom.zoomed ? (zoom.dragging ? "cursor-grabbing" : "cursor-grab") : "cursor-zoom-in",
          )}
          style={zoom.style}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={src}
            alt=""
            referrerPolicy="no-referrer"
            draggable={false}
            onLoad={onPictureLoad}
            className="pointer-events-none block h-full w-full max-w-none object-contain"
          />
        </button>
      </div>
      {caption.trim() !== "" && (
        <div
          data-figure-caption=""
          role="group"
          aria-label={`${label} caption`}
          tabIndex={0}
          className="shrink-0 overflow-y-auto overscroll-contain px-3 py-2 font-reading text-body-sm leading-[1.6] text-text [overflow-wrap:anywhere]"
          style={{ maxHeight: captionMaxHeight(height) }}
        >
          {caption}
        </div>
      )}
    </MarginCardShell>
  );
}

export interface FigureCardProps {
  /** The open figure. A new ref on every press: the card comes forward (the host does) and, when it is in front, takes the focus. */
  figure: FigureRef;
  frame: MarginFrame | null;
  front: boolean;
  top: number;
  height: number;
  z: number;
  onClose: () => void;
  onRaise: () => void;
}

/**
 * The card with its zoom. The hook is here, not in the body that only stands while the card is in front, so a card sent behind and
 * brought forward again is as it was left. The mat's box is measured here (a divider drag, the window, the caption's height all resize
 * it); the last size is kept while the box is not on the page, so the first frame after a raise has its picture.
 */
export function FigureCard({ figure, frame, front, top, height, z, onClose, onRaise }: FigureCardProps) {
  const [boxEl, setBoxEl] = useState<HTMLDivElement | null>(null);
  const [box, setBox] = useState<Size | null>(null);
  // The picture's own size, read from it when it arrived and the figure's record had none.
  const [loaded, setLoaded] = useState<Size | null>(null);
  const surfaceEl = useRef<HTMLElement | null>(null);
  const zoom = useFigureZoom({ natural: figure.natural ?? loaded, viewport: figureViewport(box), wheel: true });

  useLayoutEffect(() => {
    if (!boxEl) return;
    const read = () => {
      const next = { width: boxEl.clientWidth, height: boxEl.clientHeight };
      setBox((now) => (now && now.width === next.width && now.height === next.height ? now : next));
    };
    read();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(read);
    observer.observe(boxEl);
    return () => observer.disconnect();
  }, [boxEl]);

  const giveSurface = zoom.surfaceRef;
  const surfaceRef = useCallback(
    (node: HTMLButtonElement | null) => {
      surfaceEl.current = node;
      giveSurface(node);
    },
    [giveSurface],
  );

  // A press on the figure in the body asks for the focus: the picture takes it, so `+ - 0`, the arrows and Escape work at once. When the
  // card is still behind it waits for the front. A header press brings the card forward and moves no focus.
  const focused = useRef<FigureRef | null>(null);
  useEffect(() => {
    if (!front || focused.current === figure) return;
    focused.current = figure;
    surfaceEl.current?.focus({ preventScroll: true });
  }, [figure, front]);

  return (
    <FigureCardView
      label={figure.label}
      caption={figure.caption}
      src={figure.src}
      front={front}
      top={top}
      height={height}
      z={z}
      frame={frame}
      zoom={zoom}
      boxRef={setBoxEl}
      surfaceRef={surfaceRef}
      onPictureLoad={(event: SyntheticEvent<HTMLImageElement>) => {
        const img = event.currentTarget;
        if (img.naturalWidth > 0 && img.naturalHeight > 0) setLoaded({ width: img.naturalWidth, height: img.naturalHeight });
      }}
      onClose={onClose}
      onRaise={onRaise}
    />
  );
}

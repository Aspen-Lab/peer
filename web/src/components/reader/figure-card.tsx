"use client";

// P11-15 rule 1 (owner item 1; B P11-05 §2.1, §2.3, §3; ruling §1h.113 (c) D1-D4, D7, D8, D10): the figure card — a Paper-digestion figure
// opened in the margin, one card of the stack beside the sticky notes, the notes window and the explain card.
//
// A card of `kind: "figure"` that fills the room the stack gives it (the whole margin when it is the only card):
//   - the header, 40 px: the label ("Figure 3") and the caption's head, and the X at the top right — a 40 px accent square, as the explain
//     card's is (D8). A press on the header brings the card forward; the X closes it and brings nothing forward;
//   - the zoom row (36 px; only while in front): minus, the readout, plus and Fit — the shared zoom core's steps, fit to 6x (D7);
//   - the picture on the plate mat, which has no padding (P11-17c rule 3: the picture is fitted into the card's whole width): the zoom
//     core's surface (a click toggles fit and 2x, a drag pans, the wheel zooms about the pointer — D1 — and `+ = - 0` and the arrows work
//     while the focus is on it);
//   - the caption, whole (D3), in the reading face; it scrolls inside, at most 30 % of the card's height — 20 % while another card stands with it
//     (P11-26 rule 2: the picture box is then at least half the band, `lib/reader/windows.ts`).
// P11-26 rule 3 (§1h.123; round 1's readers): the card never shows an empty box. For 0.2 to 1.9 s after it opened or was raised the picture
// area was a blank grey box: the card asked for its image again even when the body's `<img>` had loaded it — the figure route answers a
// private upload `no-store`, so a second `<img>` of the same address (a clone of the loaded element too) is a second request and a second render
// of the page on the server — and a card sent behind and raised again mounted a new `<img>` and asked once more. The card now draws the picture
// the body (or the card itself, earlier) already loaded, into a canvas: no request, no blank frame on open, on raise or on re-open. While a
// picture that is not loaded arrives it shows the figure's own label and a quiet "Loading the figure…", never an empty box.
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
import { FIGURE_STACKED_CAPTION_SHARE, FIGURE_ZOOM_ROW_PX } from "@/lib/reader/windows";
import type { Size } from "./figure-zoom";
import { MarginCardShell, type MarginFrame } from "./margin-card";
import { useMarginStack } from "./margin-stack-scroll";
import { CardDivider } from "./card-divider";
import { CARD_CONTENT_MIN_PX } from "@/lib/reader/windows";
import { useFigureZoom, type FigureZoom } from "./use-figure-zoom";

/** The figure card's id in the stack (there is one: a second figure replaces the first, D2). */
export const FIGURE_WINDOW_ID = "figure";

/** The zoom row's height (the stack's own number: it counts the card's furniture to keep the picture box at half the band). */
export { FIGURE_ZOOM_ROW_PX };

/** The caption takes at most this share of the card's height (D3) and scrolls inside. In front of other cards, a fifth (P11-26 rule 2). */
export const FIGURE_CAPTION_SHARE = 0.3;

/** The caption's tallest, in pixels, for a card `height` tall: three tenths alone, a fifth while it is stacked in front of other cards. */
export function captionMaxHeight(height: number, stacked = false): number {
  return Math.max(0, Math.floor(height * (stacked ? FIGURE_STACKED_CAPTION_SHARE : FIGURE_CAPTION_SHARE)));
}

/**
 * The box the picture is fitted into: the mat's own measured box, whole. P11-17c rule 3 (the owner: the figure "enlarged into the whole right
 * margin"; C P11-15 "For the manager" 5): the 8-px padding that was taken off every side is gone, so at Fit the picture is the zoom core's fit
 * (0.96, `clampFigureSize`) of the card's whole inner width — 382 px in a 400-px margin, 398 inside the card's border — not 366.7.
 */
export function figureViewport(box: Size | null): Size {
  if (!box) return { width: 0, height: 0 };
  return { width: Math.max(0, box.width), height: Math.max(0, box.height) };
}

// ── The picture that is already loaded (P11-26 rule 3; §1h.123) ───────────────────────────────────────

/** A picture the browser holds, loaded: what the card draws into its canvas. */
export type LoadedPicture = HTMLImageElement;

/** The pictures kept for the card to draw again, by address, newest last: the last few figures the reader looked at, in this tab only. */
const KEPT_PICTURES = 6;
const kept = new Map<string, LoadedPicture>();

const isLoaded = (picture: Pick<LoadedPicture, "naturalWidth" | "naturalHeight"> & { complete?: boolean }) =>
  picture.complete !== false && picture.naturalWidth > 0 && picture.naturalHeight > 0;

/** Keep a loaded picture for the next time the card needs the address. */
export function keepPicture(src: string, picture: LoadedPicture): void {
  kept.delete(src);
  kept.set(src, picture);
  while (kept.size > KEPT_PICTURES) kept.delete(kept.keys().next().value as string);
}

/** Forget every kept picture (a test's, between cases; the page never needs it: the pictures live as long as the tab). */
export function forgetPictures(): void {
  kept.clear();
}

/** The picture kept for this address, or null. */
export function keptPicture(src: string): LoadedPicture | null {
  const picture = kept.get(src) ?? null;
  if (picture) keepPicture(src, picture);
  return picture;
}

/**
 * The body's own `<img>` of this address, when it has loaded: not another figure's, not one that is still on its way (it is asked for in the
 * card's own `<img>`, under the loading line), not one standing in a margin card. Null where there is no document.
 */
export function bodyPicture(src: string): LoadedPicture | null {
  if (typeof document === "undefined" || !document.images) return null;
  for (const image of Array.from(document.images)) {
    if (image.getAttribute("src") === src && isLoaded(image) && !image.closest("[data-margin-card]")) return image;
  }
  return null;
}

/** The loaded picture to draw for an address: the one kept, else the body's. */
export function loadedPictureFor(src: string): LoadedPicture | null {
  return keptPicture(src) ?? bodyPicture(src);
}

/** Draw a loaded picture into the card's canvas at its own size: the canvas is the picture's pixels, the surface's style sizes it. */
export function drawPicture(canvas: Pick<HTMLCanvasElement, "width" | "height" | "getContext">, picture: CanvasImageSource & { naturalWidth: number; naturalHeight: number }): void {
  const { naturalWidth: width, naturalHeight: height } = picture;
  if (canvas.width !== width) canvas.width = width;
  if (canvas.height !== height) canvas.height = height;
  canvas.getContext("2d")?.drawImage(picture, 0, 0, width, height);
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
  /** Another card stands with this one (P11-26 rule 2): the caption then takes at most a fifth of the card, not three tenths. */
  stacked?: boolean;
  /** The margin's left and width; null where there is none. */
  frame: MarginFrame | null;
  elementRef?: Ref<HTMLElement>;
  split?: boolean;
  zoom: FigureCardZoom;
  /** The mat's box, measured by the card; the surface, which takes the focus when a figure is pressed. */
  boxRef?: Ref<HTMLDivElement>;
  surfaceRef?: Ref<HTMLButtonElement>;
  /** P11-26 rule 3: the picture the browser already holds, loaded. Drawn into a canvas (`pictureRef` draws it), with no request; without one the
   *  card asks for the picture in an `<img>` and says "Loading the figure…" under its label until it is there. */
  picture?: LoadedPicture | null;
  pictureRef?: Ref<HTMLCanvasElement>;
  /** The picture could not be loaded: the line says so instead of "Loading the figure…". */
  failed?: boolean;
  /** The picture arrived: its own size is read from it when the figure's record did not say. */
  onPictureLoad?: (event: SyntheticEvent<HTMLImageElement>) => void;
  onPictureError?: () => void;
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

export function FigureCardView({ label, caption, src, front, top, height, z, stacked, frame, zoom, boxRef, surfaceRef, picture, pictureRef, failed, onPictureLoad, onPictureError, onClose, onRaise, elementRef, split }: FigureCardViewProps) {
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
      elementRef={elementRef}
      split={split}
      className={split ? "!absolute !left-0 !right-auto !w-full" : undefined}
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
          {picture ? (
            <canvas ref={pictureRef} aria-hidden="true" data-figure-canvas="" className="pointer-events-none block h-full w-full max-w-none object-contain" />
          ) : (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={src}
              alt=""
              referrerPolicy="no-referrer"
              draggable={false}
              onLoad={onPictureLoad}
              onError={onPictureError}
              className="pointer-events-none block h-full w-full max-w-none object-contain"
            />
          )}
        </button>
        {!picture && (
          <div
            data-figure-loading=""
            role="status"
            className="annotation pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-1 px-4 text-center text-text-faint"
          >
            <span className="eyebrow text-heading">{label}</span>
            <span>{failed ? "The figure could not be loaded." : "Loading the figure…"}</span>
          </div>
        )}
      </div>
      {caption.trim() !== "" && (
        <div
          data-figure-caption=""
          role="group"
          aria-label={`${label} caption`}
          tabIndex={0}
          className="shrink-0 overflow-y-auto overscroll-contain px-3 py-2 font-reading text-body-sm leading-[1.6] text-text [overflow-wrap:anywhere]"
          style={{ maxHeight: captionMaxHeight(height, stacked) }}
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
  /** Another card stands with this one (the host says so): see `FigureCardViewProps.stacked`. */
  stacked?: boolean;
  onClose: () => void;
  onRaise: () => void;
}

/**
 * The card with its zoom. The hook is here, not in the body that only stands while the card is in front, so a card sent behind and
 * brought forward again is as it was left. The mat's box is measured here (a divider drag, the window, the caption's height all resize
 * it); the last size is kept while the box is not on the page, so the first frame after a raise has its picture.
 */
export function FigureCard({ figure, frame, front, top, height, z, stacked, onClose, onRaise }: FigureCardProps) {
  const cardElement = useRef<HTMLElement | null>(null);
  const marginStack = useMarginStack(FIGURE_WINDOW_ID, cardElement, frame);
  const [boxEl, setBoxEl] = useState<HTMLDivElement | null>(null);
  const [box, setBox] = useState<Size | null>(null);
  // P11-26 rule 3: the loaded picture the card draws — the body's, or the one the card itself loaded before (kept by address) — and whether the
  // card's own request failed. Held here, in the wrapper that stays mounted, so a raise draws it at once.
  const [picture, setPicture] = useState<LoadedPicture | undefined>(() => loadedPictureFor(figure.src) ?? undefined);
  const [failed, setFailed] = useState(false);
  // The picture's own size, read from it when it arrived and the figure's record had none (a picture already loaded has it at once).
  const [loaded, setLoaded] = useState<Size | null>(() => (picture ? { width: picture.naturalWidth, height: picture.naturalHeight } : null));
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

  // The canvas is drawn once per picture and once more for each time it comes back (a raise mounts a new canvas): this ref is stable.
  const pictureRef = useCallback(
    (node: HTMLCanvasElement | null) => {
      if (node && picture) drawPicture(node, picture);
    },
    [picture],
  );

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

  const index = marginStack.rows.findIndex((r) => r.id === FIGURE_WINDOW_ID);
  const row = marginStack.rows[index];
  const next = marginStack.rows[index + 1];
  const mine = marginStack.windows[index];
  const other = marginStack.windows[index + 1];
  return marginStack.portal(<>
    <FigureCardView
      label={figure.label}
      caption={figure.caption}
      src={figure.src}
      front={front}
      top={marginStack.split && row ? row.top - marginStack.bandTop : top}
      height={marginStack.split && row ? row.height : height}
      z={z}
      stacked={stacked}
      frame={frame}
      elementRef={cardElement}
      split={marginStack.split}
      zoom={zoom}
      boxRef={setBoxEl}
      surfaceRef={surfaceRef}
      picture={picture}
      pictureRef={pictureRef}
      failed={failed}
      onPictureLoad={(event: SyntheticEvent<HTMLImageElement>) => {
        const img = event.currentTarget;
        if (img.naturalWidth > 0 && img.naturalHeight > 0) {
          setLoaded({ width: img.naturalWidth, height: img.naturalHeight });
          keepPicture(figure.src, img);
          setPicture(img);
        }
      }}
      onPictureError={() => setFailed(true)}
      onClose={onClose}
      onRaise={onRaise}
    />
    {marginStack.split && row && next && mine && other && <CardDivider above={FIGURE_WINDOW_ID} below={next.id} top={row.top + row.height - marginStack.bandTop} value={row.height} pairHeight={row.height + next.height} min={mine.minimum ?? CARD_CONTENT_MIN_PX} max={row.height + next.height - (other.minimum ?? CARD_CONTENT_MIN_PX)} />}
  </>);
}

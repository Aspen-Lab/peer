"use client";

import { useCallback, useEffect, useId, useRef, useState, type Ref, type SyntheticEvent } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/cn";
import { clampFigurePan, clampFigureSize, DETAIL_ZOOM, SUMMARY_ZOOM_STEPS, type Size } from "./figure-zoom";
import { useFigureZoom } from "./use-figure-zoom";

// The math moved to figure-zoom.ts (P11-11, shared with the margin's figure card); the clamps stay this module's exports.
export { clampFigurePan, clampFigureSize, DETAIL_ZOOM };

function setRef(ref: Ref<HTMLImageElement> | undefined, node: HTMLImageElement | null) {
  if (typeof ref === "function") ref(node);
  else if (ref) ref.current = node;
}

export function FigureViewer({ src, alt, caption, natural, onClose }: {
  src: string;
  alt: string;
  caption?: string | null;
  natural: Size;
  onClose: () => void;
}) {
  const captionId = useId();
  const overlayRef = useRef<HTMLDivElement>(null);
  const captionRef = useRef<HTMLElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const [frame, setFrame] = useState<(Size & { captionHeight: number }) | null>(null);

  // Equal clearance above and below keeps the image at the viewport's exact
  // center, clear of the caption and close control, even when the caption wraps.
  useEffect(() => {
    const overlay = overlayRef.current;
    if (!overlay) return;
    const observer = new ResizeObserver(() => {
      setFrame({
        width: overlay.clientWidth,
        height: overlay.clientHeight,
        captionHeight: captionRef.current?.getBoundingClientRect().height ?? 0,
      });
    });
    observer.observe(overlay);
    if (captionRef.current) observer.observe(captionRef.current);
    return () => observer.disconnect();
  }, [caption]);

  useEffect(() => {
    const previousFocus = document.activeElement;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeRef.current?.focus({ preventScroll: true });

    // Capture before the reader's shortcuts, including Escape-to-leave-report.
    const onKeyDown = (event: KeyboardEvent) => {
      event.stopPropagation();
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      } else if (event.key === "Tab") {
        const targets = Array.from(overlayRef.current?.querySelectorAll<HTMLElement>(
          'button:not([tabindex="-1"]), [tabindex="0"]',
        ) ?? []);
        if (!targets.length) return;
        event.preventDefault();
        const index = targets.indexOf(document.activeElement as HTMLElement);
        const next = (index + (event.shiftKey ? -1 : 1) + targets.length) % targets.length;
        targets[next].focus({ preventScroll: true });
      }
    };
    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("keydown", onKeyDown, true);
      document.body.style.overflow = previousOverflow;
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) {
        previousFocus.focus({ preventScroll: true });
      }
    };
  }, [onClose]);

  const clearance = Math.max(56, (frame?.captionHeight ?? 0) + 32);
  const viewport = {
    width: Math.max(0, (frame?.width ?? 0) - 32),
    height: Math.max(0, (frame?.height ?? 0) - clearance * 2),
  };
  // The Summary's settings of the shared zoom core: two states (fit, 2x), no wheel, no keys (the capture handler above keeps every key).
  const zoom = useFigureZoom({ natural, viewport, steps: SUMMARY_ZOOM_STEPS, wheel: false, keys: false });

  return (
    <div
      ref={overlayRef}
      role="dialog"
      aria-modal="true"
      aria-label="Figure viewer"
      aria-describedby={caption ? captionId : undefined}
      className="fixed inset-0 z-[80] isolate overflow-hidden"
      onClick={(event) => event.stopPropagation()}
    >
      <div className="absolute inset-0 bg-black/65" onClick={onClose} aria-hidden="true" />
      <figure className="pointer-events-none absolute inset-0 m-0">
        <div
          className="pointer-events-auto absolute left-4 right-4 flex items-center justify-center overflow-hidden"
          style={{ top: clearance, bottom: clearance }}
          onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}
        >
          {frame && (
            <button
              type="button"
              aria-label={zoom.zoomed ? "Fit figure to screen" : "Zoom in on figure"}
              aria-pressed={zoom.zoomed}
              title={zoom.zoomed ? "Drag to pan; click to fit to screen" : "Click to zoom in"}
              {...zoom.surface}
              className={cn(
                "relative block shrink-0 touch-none select-none focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-white",
                zoom.zoomed ? (zoom.dragging ? "cursor-grabbing" : "cursor-grab") : "cursor-zoom-in",
              )}
              style={zoom.style}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={src} alt={alt} referrerPolicy="no-referrer" draggable={false} className="pointer-events-none block h-full w-full max-w-none object-contain" />
            </button>
          )}
        </div>
        {caption && (
          <figcaption
            ref={captionRef}
            id={captionId}
            tabIndex={0}
            className="pointer-events-auto absolute bottom-4 left-1/2 z-10 max-h-[24dvh] w-max max-w-[calc(100%-2rem)] -translate-x-1/2 overflow-y-auto overscroll-contain rounded-2xl border border-white/60 bg-white/85 px-5 py-3 font-sans text-[13px] leading-[1.5] text-black shadow-xl backdrop-blur-md [overflow-wrap:anywhere] sm:max-w-[min(56rem,calc(100%-2rem))]"
          >
            {caption}
          </figcaption>
        )}
      </figure>
      <button
        ref={closeRef}
        type="button"
        aria-label="Close figure"
        onClick={onClose}
        className="absolute right-4 top-4 z-20 flex h-10 w-10 cursor-pointer items-center justify-center rounded-full border border-white/60 bg-white/90 text-black shadow-lg hover:bg-white focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-white"
      >
        <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <path d="m6 6 12 12M18 6 6 18" />
        </svg>
      </button>
    </div>
  );
}

export function FigureLightbox({
  src, alt, caption, className, wrapperClassName, imgRef, onLoad, onError,
}: {
  src: string;
  alt: string;
  caption?: string | null;
  className?: string;
  wrapperClassName?: string;
  imgRef?: Ref<HTMLImageElement>;
  onLoad?: (event: SyntheticEvent<HTMLImageElement>) => void;
  onError?: () => void;
}) {
  const [natural, setNatural] = useState<Size | null>(null);
  const thumbRef = useRef<HTMLImageElement | null>(null);
  const close = useCallback(() => setNatural(null), []);

  const open = () => {
    const img = thumbRef.current;
    if (!img || img.naturalWidth === 0 || img.naturalHeight === 0) return;
    setNatural({ width: img.naturalWidth, height: img.naturalHeight });
  };

  return (
    <>
      <button type="button" aria-label="Enlarge figure" onClick={open} className={cn("cursor-zoom-in block", wrapperClassName)}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          ref={(node) => { thumbRef.current = node; setRef(imgRef, node); }}
          src={src}
          alt={alt}
          loading="lazy"
          decoding="async"
          referrerPolicy="no-referrer"
          onLoad={onLoad}
          onError={onError}
          className={className}
        />
      </button>
      {/* Animated/overflow-hidden report ancestors must not contain the overlay. */}
      {natural && createPortal(
        <FigureViewer src={src} alt={alt} caption={caption} natural={natural} onClose={close} />,
        document.body,
      )}
    </>
  );
}

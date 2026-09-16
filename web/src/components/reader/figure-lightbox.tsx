"use client";

// S12: click any report figure (the hero on PaperPlate, opt-in — see Ruling
// 15 — or a section figure on MattedFigure) and it fills the screen; click
// it again, click the backdrop, or Esc to close. One component, used by
// both callers, so the open/close/keyboard/focus mechanism exists once.

import { useEffect, useRef, useState, type Ref, type SyntheticEvent } from "react";
import { cn } from "@/lib/cn";

const MAX_UPSCALE = 2; // never enlarge past 2x the thumbnail's own natural size
const VIEWPORT_FRACTION = 0.96; // 96vw / 96vh

/**
 * Exported for the test: whichever is smaller of the 2x-natural ceiling and
 * the viewport's own 96vw/96vh ceiling, aspect preserved — so a thumbnail
 * never blows up into a blur, and a large figure never overflows the
 * screen. Zero natural size (a broken image) returns a zero size; the
 * caller never opens the overlay for one (see `open` below).
 */
export function clampFigureSize(
  natural: { width: number; height: number },
  viewport: { width: number; height: number },
): { width: number; height: number } {
  if (natural.width <= 0 || natural.height <= 0) return { width: 0, height: 0 };
  const maxWidth = Math.min(natural.width * MAX_UPSCALE, viewport.width * VIEWPORT_FRACTION);
  const maxHeight = Math.min(natural.height * MAX_UPSCALE, viewport.height * VIEWPORT_FRACTION);
  const scale = Math.min(maxWidth / natural.width, maxHeight / natural.height);
  return { width: natural.width * scale, height: natural.height * scale };
}

function setRef(ref: Ref<HTMLImageElement> | undefined, node: HTMLImageElement | null) {
  if (typeof ref === "function") ref(node);
  else if (ref) (ref as { current: HTMLImageElement | null }).current = node;
}

export function FigureLightbox({
  src,
  alt,
  caption,
  className,
  wrapperClassName,
  imgRef,
  onLoad,
  onError,
}: {
  src: string;
  alt: string;
  caption?: string | null;
  /** The thumbnail `<img>`'s own existing sizing classes, unchanged. */
  className?: string;
  /** Lets a caller's own frame (e.g. PaperPlate's absolute/h-full/w-full) reach the trigger. */
  wrapperClassName?: string;
  /** A caller's own ref to the thumbnail image (e.g. PaperPlate's cached-image opacity check). */
  imgRef?: Ref<HTMLImageElement>;
  onLoad?: (event: SyntheticEvent<HTMLImageElement>) => void;
  onError?: () => void;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);
  const thumbRef = useRef<HTMLImageElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const overlayRef = useRef<HTMLDivElement | null>(null);

  const open = () => {
    const img = thumbRef.current;
    // 6-08j: a broken image (naturalWidth 0 is the standard browser signal
    // for a failed load) never opens — nothing to enlarge.
    if (!img || img.naturalWidth === 0) return;
    setSize(
      clampFigureSize(
        { width: img.naturalWidth, height: img.naturalHeight },
        { width: window.innerWidth, height: window.innerHeight },
      ),
    );
    setIsOpen(true);
  };
  const close = () => setIsOpen(false);

  // 6-08h: a capture-phase listener runs before keyboard.tsx's own
  // bubble-phase `window` listener (capture completes before bubble
  // starts), so every key — Esc included — stops here and never reaches
  // the reader's shortcuts while the overlay is open. A DOM-listener
  // effect, not a setState effect: no lint risk.
  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      event.stopPropagation();
      if (event.key === "Escape") {
        event.preventDefault();
        close();
      }
    };
    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, [isOpen]);

  // 6-08i: lock body scroll and move focus in, then back to the trigger on
  // close/unmount. Two more DOM-effects, neither a setState effect.
  useEffect(() => {
    if (!isOpen) return;
    // Captured now: by the time cleanup runs, `triggerRef.current` may have
    // changed (React re-renders while the overlay is open), so the node to
    // restore focus to is read once, up front, not off the ref at cleanup
    // time.
    const trigger = triggerRef.current;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    overlayRef.current?.focus();
    return () => {
      document.body.style.overflow = previousOverflow;
      trigger?.focus();
    };
  }, [isOpen]);

  return (
    <>
      <button
        type="button"
        ref={triggerRef}
        aria-label="Enlarge figure"
        onClick={open}
        className={cn("cursor-zoom-in block", wrapperClassName)}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          ref={(node) => {
            thumbRef.current = node;
            setRef(imgRef, node);
          }}
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
      {isOpen && size && (
        <div
          ref={overlayRef}
          role="dialog"
          aria-modal="true"
          aria-label={caption ?? alt}
          tabIndex={-1}
          className="fixed inset-0 z-[80] flex flex-col items-center justify-center gap-3 p-4 animate-lightbox-in"
        >
          <button
            type="button"
            aria-label="Close figure"
            className="absolute inset-0 bg-black/90"
            onClick={close}
          />
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={src}
            alt={alt}
            onClick={close}
            className="relative cursor-zoom-out object-contain"
            style={{ maxWidth: "96vw", maxHeight: "96vh", width: size.width, height: size.height }}
          />
          {caption && (
            <figcaption className="relative font-mono text-meta text-text-muted">
              {caption}
            </figcaption>
          )}
        </div>
      )}
    </>
  );
}

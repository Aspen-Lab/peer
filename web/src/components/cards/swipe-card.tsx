"use client";

// Swipe a card to act on it — the touchscreen half of "don't depend on
// buttons". Right saves, left dismisses; the reveal layer under the card
// shows which as the finger moves.
//
// Touch and pen pointers only. A mouse has hover and the keyboard layer, and
// a mouse-drag on a link fights text selection. `touch-action: pan-y` leaves
// vertical scrolling to the browser; we only take a drag once it has locked
// to the horizontal axis. A completed drag swallows the click that follows
// it, so a swipe never also opens the paper.

import { useCallback, useRef, useState, type MouseEvent, type PointerEvent, type ReactNode } from "react";
import { lockAxis, progress, resist, shouldCommit, type Axis, type SwipeDirection } from "@/lib/interaction/swipe";

interface SwipeableCardProps {
  children: ReactNode;
  onSwipeRight: () => void;
  onSwipeLeft: () => void;
  rightLabel: string;
  leftLabel: string;
  /** Right reveal reflects the current state — "Save" or "Unsave". */
  rightActive?: boolean;
  className?: string;
}

const SNAP_MS = 220;
const FLY_MS = 180;

export function SwipeableCard({
  children,
  onSwipeRight,
  onSwipeLeft,
  rightLabel,
  leftLabel,
  rightActive = false,
  className = "",
}: SwipeableCardProps) {
  const [dx, setDx] = useState(0);
  const [settling, setSettling] = useState(false);
  const [flying, setFlying] = useState<SwipeDirection | null>(null);
  const start = useRef<{ x: number; y: number; t: number } | null>(null);
  const axis = useRef<Axis | null>(null);
  const last = useRef<{ x: number; t: number } | null>(null);
  const dragged = useRef(false);

  const reset = useCallback(() => {
    start.current = null;
    axis.current = null;
    last.current = null;
  }, []);

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.pointerType === "mouse") return;
    if (flying) return;
    start.current = { x: e.clientX, y: e.clientY, t: e.timeStamp };
    last.current = { x: e.clientX, t: e.timeStamp };
    axis.current = null;
    dragged.current = false;
    setSettling(false);
  };

  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (!start.current) return;
    const rawDx = e.clientX - start.current.x;
    const rawDy = e.clientY - start.current.y;
    if (axis.current === null) {
      axis.current = lockAxis(rawDx, rawDy);
      if (axis.current === "x") {
        // Capture keeps the drag alive if the finger leaves the card. A
        // pointer that is not active (synthetic events, some pen drivers)
        // makes this throw NotFoundError; the drag still works without it.
        try {
          e.currentTarget.setPointerCapture(e.pointerId);
        } catch {
          /* no capture — fine */
        }
        dragged.current = true;
      }
    }
    if (axis.current !== "x") return;
    last.current = { x: e.clientX, t: e.timeStamp };
    setDx(resist(rawDx));
  };

  const finish = (e: PointerEvent<HTMLDivElement>) => {
    if (!start.current) return;
    const wasX = axis.current === "x";
    const rawDx = e.clientX - start.current.x;
    let vx = 0;
    if (last.current && e.timeStamp > last.current.t) {
      vx = (e.clientX - last.current.x) / (e.timeStamp - last.current.t);
    }
    reset();
    if (!wasX) return;

    const dir = shouldCommit(rawDx, vx);
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (dir === "left") {
      // Fly out, then let the store remove the card.
      if (reduce) {
        setDx(0);
        onSwipeLeft();
      } else {
        setFlying("left");
        setDx(-e.currentTarget.clientWidth);
        window.setTimeout(() => {
          onSwipeLeft();
          setFlying(null);
          setDx(0);
        }, FLY_MS);
      }
      return;
    }
    if (dir === "right") {
      onSwipeRight();
    }
    setSettling(true);
    setDx(0);
  };

  const onClickCapture = (e: MouseEvent<HTMLDivElement>) => {
    if (dragged.current) {
      e.preventDefault();
      e.stopPropagation();
      dragged.current = false;
    }
  };

  const p = progress(dx);
  const towardRight = dx > 0;
  const transition = flying
    ? `transform ${FLY_MS}ms ease-in`
    : settling
      ? `transform ${SNAP_MS}ms var(--ease-snap)`
      : "none";

  return (
    <div
      className={`relative overflow-hidden rounded-2xl ${className}`}
      style={{ touchAction: "pan-y" }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={finish}
      onPointerCancel={finish}
      onClickCapture={onClickCapture}
    >
      {/* Reveal — right: save; left: not interested. Fades in with progress. */}
      <div
        aria-hidden
        className={`absolute inset-0 flex items-center px-6 ${
          towardRight ? "justify-start bg-accent text-bg" : "justify-end bg-red text-bg"
        }`}
        style={{ opacity: dx === 0 ? 0 : 0.25 + 0.75 * p }}
      >
        <span className="flex items-center gap-2 text-body-sm font-semibold">
          {towardRight ? (
            <>
              <svg width="16" height="16" viewBox="0 0 24 24" fill={rightActive ? "none" : "currentColor"} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
              </svg>
              {rightLabel}
            </>
          ) : (
            <>
              {leftLabel}
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden>
                <path d="M18 6 6 18M6 6l12 12" />
              </svg>
            </>
          )}
        </span>
      </div>

      <div
        className="relative"
        style={{ transform: `translateX(${dx}px)`, transition }}
        onTransitionEnd={() => setSettling(false)}
      >
        {children}
      </div>
    </div>
  );
}

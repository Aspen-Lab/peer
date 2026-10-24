"use client";

import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { CARD_DIVIDER_PX, useWindows } from "@/lib/reader/windows";

export interface CardDividerProps {
  above: string;
  below: string;
  top: number;
  value: number;
  pairHeight: number;
  min: number;
  max: number;
}

export function cardDividerStep(value: number, key: string, shift: boolean, min: number, max: number): number | null {
  const step = shift ? 64 : 16;
  const next = key === "ArrowUp" ? value - step : key === "ArrowDown" ? value + step : key === "Home" ? min : key === "End" ? max : key === "Enter" ? (min + max) / 2 : null;
  return next === null ? null : Math.min(max, Math.max(min, next));
}

export function CardDivider({ above, below, top, value, pairHeight, min, max }: CardDividerProps) {
  const drag = useRef<{ pointer: number; start: number; origin: number; latest: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  const commit = (height: number) => {
    const state = useWindows.getState();
    const first = state.windows.find((w) => w.id === above);
    const second = state.windows.find((w) => w.id === below);
    if (!first || !second || pairHeight <= 0) return;
    const total = (first.share ?? 1 / state.windows.length) + (second.share ?? 1 / state.windows.length);
    state.resizePair(above, below, total * Math.min(max, Math.max(min, height)) / pairHeight);
  };
  useEffect(() => () => { drag.current = null; }, []);
  const start = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || !event.isPrimary) return;
    event.preventDefault();
    event.currentTarget.focus({ preventScroll: true });
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { pointer: event.pointerId, start: event.clientY, origin: value, latest: value };
  };
  const move = (event: PointerEvent<HTMLDivElement>) => {
    const active = drag.current;
    if (!active || active.pointer !== event.pointerId) return;
    const travel = event.clientY - active.start;
    if (!dragging && Math.abs(travel) < 4) return;
    setDragging(true);
    active.latest = Math.min(max, Math.max(min, active.origin + travel));
    commit(active.latest);
  };
  const end = (event: PointerEvent<HTMLDivElement>) => {
    const active = drag.current;
    if (!active || active.pointer !== event.pointerId) return;
    drag.current = null;
    setDragging(false);
    if (event.type !== "pointerup") commit(active.origin);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };
  const key = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    const next = cardDividerStep(value, event.key, event.shiftKey, min, max);
    if (next === null) return;
    event.preventDefault();
    commit(next);
  };
  return <div
    role="separator" aria-orientation="horizontal" aria-label="Resize neighboring cards"
    aria-controls={`${above} ${below}`} aria-valuenow={Math.round(value)} aria-valuemin={Math.ceil(min)} aria-valuemax={Math.floor(max)}
    tabIndex={0} data-card-divider="" data-dragging={dragging || undefined}
    onPointerDown={start} onPointerMove={move} onPointerUp={end} onPointerCancel={end} onLostPointerCapture={end}
    onKeyDown={key} onDoubleClick={() => commit(pairHeight / 2)}
    style={{ position: "absolute", left: 0, right: 0, top, height: CARD_DIVIDER_PX, zIndex: 69, cursor: "row-resize", touchAction: "none", background: "var(--surface)" }}
    className="group flex items-center justify-center outline-none hover:bg-surface-hover focus-visible:bg-surface-hover focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-heading data-[dragging=true]:bg-surface-hover"
  ><span aria-hidden="true" className="h-0.5 w-full bg-heading group-hover:bg-accent group-focus-visible:bg-accent" /><span aria-hidden="true" className="absolute h-1.5 w-8 border-y-2 border-heading bg-surface" /></div>;
}

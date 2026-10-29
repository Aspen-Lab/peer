"use client";

import { useEffect, useRef, useState, useSyncExternalStore, type CSSProperties, type PointerEvent, type ReactNode } from "react";
import { useKeepPlace } from "@/lib/reader/keep-place";
import { useKeepSelection } from "@/lib/reader/keep-selection";
import { registerMargin } from "@/lib/reader/margin";
import { useReaderPanesStore } from "@/store/reader-panes";
import { PaneDivider } from "./pane-divider";
import { fitPanes } from "./pane-layout";

// The reader uses a resizable left sidebar and one reading column. The invisible,
// fixed anchor is measured only to position tools as overlays when requested;
// it never reserves a third column. The left sidebar can still be pinned,
// collapsed or peeked without remounting the reading content.

/** The left pane's id: what the rail's button and the divider control. */
export const LEFT_PANE_ID = "reader-left-pane";
export const CENTRE_ID = "reader-centre";
export const MARGIN_ID = "reader-margin";

/** How long the pointer rests on the rail before the pane peeks, and how long it stays after the pointer leaves. */
export const PEEK_OPEN_MS = 150;
export const PEEK_CLOSE_MS = 250;

/** The window's width on a server render: the design's anchor (1x Fit at 1440). Never seen by a reader — the reader mounts client-side. */
const SERVER_VIEWPORT_PX = 1440;

export type ReaderShellLeft = { fixed: ReactNode; scroll: ReactNode } | { whole: ReactNode };

export interface ReaderShellProps {
  left: ReaderShellLeft;
  centre: ReactNode;
  /** What stands in the left pane's header row after the pin and collapse button — the reading controls (P11-16 follow-up, ruling §1h.115
   *  item 2). The row wraps if the pane is too narrow for both, and the button keeps the left edge. Absent: the button alone, at the right. */
  header?: ReactNode;
}

export type LeftState = "pinned" | "rail" | "peek";

function subscribeResize(onChange: () => void) {
  window.addEventListener("resize", onChange);
  return () => window.removeEventListener("resize", onChange);
}

interface Timers {
  open: ReturnType<typeof setTimeout> | null;
  close: ReturnType<typeof setTimeout> | null;
}

function clearTimer(timers: Timers, which: keyof Timers) {
  if (timers[which] !== null) clearTimeout(timers[which]);
  timers[which] = null;
}

/** The sidebar glyph: a frame with the left pane drawn in. */
function SidebarGlyph() {
  return (
    <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" strokeWidth="1.25">
      <rect x="1.75" y="2.75" width="12.5" height="10.5" />
      <path d="M6 2.75v10.5" />
    </svg>
  );
}

export function ReaderShell({ left, centre, header }: ReaderShellProps) {
  const grid = useRef<HTMLDivElement | null>(null);
  const cell = useRef<HTMLDivElement | null>(null);
  const pane = useRef<HTMLDivElement | null>(null);
  const rail = useRef<HTMLButtonElement | null>(null);
  const pinButton = useRef<HTMLButtonElement | null>(null);
  const margin = useRef<HTMLElement | null>(null);

  const viewport = useSyncExternalStore(subscribeResize, () => window.innerWidth, () => SERVER_VIEWPORT_PX);
  // The reader's saved choice. The server snapshot is the store's INITIAL state, never the live one: the stores load after mount
  // (`skipHydration`, <StoreHydrator/>), and a hydrating render that already saw the loaded widths would not match the markup.
  const saved = useSyncExternalStore(useReaderPanesStore.subscribe, useReaderPanesStore.getState, useReaderPanesStore.getInitialState);
  const fit = fitPanes({ viewport, left: saved.leftWidth, leftPinned: saved.leftPinned, hasMargin: false });

  const [peeking, setPeeking] = useState(false);
  // A pane that is pinned does not peek: forgotten at once, so that folding it again does not open it.
  if (fit.pinned && peeking) setPeeking(false);
  const state: LeftState = fit.pinned ? "pinned" : peeking ? "peek" : "rail";

  const timers = useRef<Timers>({ open: null, close: null });
  const within = useRef({ pointer: false, focus: false });
  const lastPointer = useRef("mouse");
  const focusTo = useRef<"rail" | "pane" | null>(null);

  // Measure the non-layout anchor so tools can be placed over the reading view when requested.
  useEffect(() => {
    const el = margin.current;
    return el ? registerMargin(el) : undefined;
  }, []);

  // The reader's place survives a re-flow (P11-45, ruling §1h.146): the paragraph at the top stays at the top when the centre column changes width
  // (a divider dragged, a collapse or a pin, Fit, the window) — `lib/reader/keep-place.ts`.
  useKeepPlace(grid);

  // A drag-select that began in the paper's text ends at the column's edge wherever it is released - over the margin, a card, the left pane, a separator, beyond the
  // window (P11-45b) - `lib/reader/keep-selection.ts`.
  useKeepSelection(grid);

  // A timer that is waiting when the shell goes must not fire into it.
  useEffect(() => {
    const waiting = timers.current;
    return () => {
      clearTimer(waiting, "open");
      clearTimer(waiting, "close");
    };
  }, []);

  // While it peeks: Escape closes it, and takes the focus back to the rail if it was in the pane; so does a press anywhere outside it —
  // a touch screen has no pointer to leave it with.
  useEffect(() => {
    if (!peeking) return;
    const close = () => {
      clearTimer(timers.current, "open");
      clearTimer(timers.current, "close");
      setPeeking(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      // A key something else has handled already (a control's own Escape, a modal) is theirs, as `explain-box.tsx`'s Escape leaves it.
      if (event.key !== "Escape" || event.defaultPrevented) return;
      close();
      if (pane.current?.contains(document.activeElement)) rail.current?.focus();
      // The page's own Escape is "back to the briefing" (`keyboard.tsx`, a window listener, on a paper page). This one closes a peek, and
      // goes no further — as the explain card's does: with the key prevented and stopped here the reader stays on the paper.
      event.preventDefault();
      event.stopPropagation();
    };
    const onPointerDown = (event: Event) => {
      const target = event.target as Node | null;
      if (target && cell.current?.contains(target)) return;
      close();
    };
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("pointerdown", onPointerDown, true);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("pointerdown", onPointerDown, true);
    };
  }, [peeking]);

  // The focus follows a press that moves the button it was on out of sight: to the rail when the pane folds, to the pane's own
  // button when it is pinned from the rail.
  useEffect(() => {
    if (focusTo.current === "rail" && state === "rail") rail.current?.focus();
    if (focusTo.current === "pane" && state === "pinned") pinButton.current?.focus();
    if (focusTo.current !== null && state !== "peek") focusTo.current = null;
  }, [state]);

  const scheduleClose = () => {
    clearTimer(timers.current, "close");
    timers.current.close = setTimeout(() => {
      timers.current.close = null;
      if (!within.current.pointer && !within.current.focus) setPeeking(false);
    }, PEEK_CLOSE_MS);
  };

  const pin = () => {
    clearTimer(timers.current, "open");
    clearTimer(timers.current, "close");
    focusTo.current = "pane";
    setPeeking(false);
    useReaderPanesStore.getState().setLeftPinned(true);
  };

  const collapse = () => {
    clearTimer(timers.current, "open");
    clearTimer(timers.current, "close");
    focusTo.current = "rail";
    setPeeking(false);
    useReaderPanesStore.getState().setLeftPinned(false);
  };

  const onCellEnter = (event: PointerEvent<HTMLDivElement>) => {
    if (event.pointerType !== "mouse") return;
    within.current.pointer = true;
    clearTimer(timers.current, "close");
    if (state === "rail" && timers.current.open === null) {
      timers.current.open = setTimeout(() => {
        timers.current.open = null;
        setPeeking(true);
      }, PEEK_OPEN_MS);
    }
  };

  const onCellLeave = (event: PointerEvent<HTMLDivElement>) => {
    if (event.pointerType !== "mouse") return;
    within.current.pointer = false;
    clearTimer(timers.current, "open");
    if (state === "peek") scheduleClose();
  };

  const onRailClick = () => {
    // A touch screen has no hover to rest on: the press peeks (and a second press puts it away); the pane's own button pins.
    if (lastPointer.current === "touch") {
      setPeeking((open) => !open);
      return;
    }
    pin();
  };

  const style = { "--left-pane-w": `${fit.left}px`, "--margin-w": `${fit.margin}px` } as CSSProperties;

  return (
    <div ref={grid} className="reader-shell" data-reader-shell="" data-left-state={state} style={style}>
      <div ref={cell} className="reader-left-cell" data-reader-left-cell="" onPointerEnter={onCellEnter} onPointerLeave={onCellLeave}>
        <button
          ref={rail}
          type="button"
          hidden={fit.pinned}
          className="reader-rail-button"
          data-reader-rail=""
          aria-label="Show sidebar"
          aria-expanded={state === "peek"}
          aria-controls={LEFT_PANE_ID}
          title="Show sidebar"
          onPointerDown={(event) => {
            lastPointer.current = event.pointerType;
          }}
          onClick={onRailClick}
        >
          <SidebarGlyph />
        </button>
        <div
          ref={pane}
          id={LEFT_PANE_ID}
          className="reader-left"
          data-reader-left=""
          data-state={state}
          data-mode={"whole" in left ? "whole" : "split"}
          inert={state === "rail"}
          onFocus={() => {
            within.current.focus = true;
            clearTimer(timers.current, "close");
          }}
          onBlur={(event) => {
            const next = event.relatedTarget as Node | null;
            if (next && pane.current?.contains(next)) return;
            within.current.focus = false;
            if (state === "peek") scheduleClose();
          }}
        >
          <div className={header ? "reader-left-header flex-wrap items-center gap-x-2 px-1.5" : "reader-left-header"} data-reader-left-header="">
            <button
              ref={pinButton}
              type="button"
              className={header ? "reader-pin-button mr-auto" : "reader-pin-button"}
              aria-label={fit.pinned ? "Collapse sidebar" : "Pin sidebar"}
              aria-expanded={fit.pinned}
              aria-controls={LEFT_PANE_ID}
              title={fit.pinned ? "Collapse sidebar" : "Pin sidebar"}
              onClick={fit.pinned ? collapse : pin}
            >
              <SidebarGlyph />
            </button>
            {header}
          </div>
          {"whole" in left ? (
            left.whole
          ) : (
            <>
              <div className="reader-left-fixed" data-reader-left-fixed="">
                {left.fixed}
              </div>
              <div className="reader-left-scroll" data-reader-left-scroll="">
                {left.scroll}
              </div>
            </>
          )}
        </div>
      </div>
      {fit.pinned ? (
        <PaneDivider
          pane="left"
          value={fit.left}
          room={{ viewport, other: 0 }}
          target={grid}
          variable="--left-pane-w"
          label="Resize left panel"
          controls={LEFT_PANE_ID}
          onCommit={(width) => useReaderPanesStore.getState().setLeftWidth(width)}
        />
      ) : (
        <div className="reader-divider-rest" aria-hidden="true" />
      )}
      <div className="reader-centre" id={CENTRE_ID} data-reader-centre="">
        <div className="reader-centre-inner" data-reader-centre-inner="">
          {centre}
        </div>
      </div>
      <aside ref={margin} id={MARGIN_ID} className="reader-margin" data-reader-margin="" aria-hidden="true" />
    </div>
  );
}

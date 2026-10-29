"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type KeyboardEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { IconBook, IconArrowRight } from "@/components/icons";
import { useReaderPanesStore } from "@/store/reader-panes";
import "./book-reader.css";

const GAP = 64;
function subscribeToolbar() { return () => {}; }
function getToolbar() { return document.getElementById("reader-book-toolbar-slot"); }
function pageGap(el: HTMLElement) {
  const columns = el.querySelector<HTMLElement>("#paper-body > section");
  const gap = columns ? parseFloat(getComputedStyle(columns).columnGap) : NaN;
  return Number.isFinite(gap) ? gap : GAP;
}

/** Two facing pages are one horizontal step, including the gap after the right page. */
export function bookPageMetrics(width: number, scrollWidth: number, scrollLeft: number, gap = GAP) {
  if (width <= 0) return { page: 1, pages: 1 };
  const step = width + gap;
  const pages = Math.max(1, Math.ceil((scrollWidth + gap - 1) / step));
  return { page: Math.min(pages, Math.max(1, Math.round(scrollLeft / step) + 1)), pages };
}

export function BookReader({ children, available, showingPaper = true, onEnter }: { children: ReactNode; available: boolean; showingPaper?: boolean; onEnter?: () => void }) {
  const [active, setActive] = useState(false);
  const [position, setPosition] = useState({ page: 1, pages: 1 });
  const bookRef = useRef<HTMLDivElement>(null);
  const pagesRef = useRef<HTMLDivElement>(null);
  const scrollRequested = useRef(false);
  const leftPinned = useReaderPanesStore((state) => state.leftPinned);
  const wasPinned = useRef(leftPinned);
  const toolbarTarget = useSyncExternalStore(subscribeToolbar, getToolbar, () => null);
  const canBook = available;
  const enabled = (active || leftPinned === false) && canBook && showingPaper;

  useEffect(() => {
    const collapsed = wasPinned.current !== false && leftPinned === false;
    wasPinned.current = leftPinned;
    if (!collapsed || !available) return;
    scrollRequested.current = true;
    onEnter?.();
  }, [leftPinned, available, onEnter]);

  const update = useCallback(() => {
    const el = pagesRef.current;
    if (el) setPosition(bookPageMetrics(el.clientWidth, el.scrollWidth, el.scrollLeft, pageGap(el)));
  }, []);

  useEffect(() => {
    const el = pagesRef.current;
    if (!enabled || !el) return;
    const observer = new ResizeObserver(update);
    observer.observe(el);
    const content = el.firstElementChild;
    if (content) observer.observe(content);
    const frame = requestAnimationFrame(() => {
      update();
      if (scrollRequested.current) {
        scrollRequested.current = false;
        bookRef.current?.scrollIntoView({ block: "start", behavior: "auto" });
      }
    });
    el.addEventListener("load", update, true);
    void document.fonts.ready.then(update);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      el.removeEventListener("load", update, true);
    };
  }, [enabled, update]);

  const toggle = () => {
    if (!enabled) {
      useReaderPanesStore.getState().setLeftPinned(false);
      onEnter?.();
      setActive(true);
    } else {
      setActive(false);
      useReaderPanesStore.getState().setLeftPinned(true);
    }
  };
  const turn = (direction: number) => {
    const el = pagesRef.current;
    if (!el) return;
    const gap = pageGap(el);
    const { page, pages } = bookPageMetrics(el.clientWidth, el.scrollWidth, el.scrollLeft, gap);
    const next = Math.max(1, Math.min(pages, page + direction));
    el.scrollTo({ left: (next - 1) * (el.clientWidth + gap), behavior: "instant" });
    update();
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.target !== event.currentTarget || !enabled) return;
    if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      event.preventDefault();
      turn(event.key === "ArrowLeft" ? -1 : 1);
    }
  };

  const modeButton = <button type="button" className="reader-book-mode" aria-pressed={enabled} onClick={toggle}>
    <IconBook size={16} /> {enabled ? "Single column" : "Book view"}
  </button>;
  const toolbar = canBook && <div className={`reader-book-toolbar${enabled ? " reader-book-local-toolbar" : ""}`}>
        {modeButton}
        {enabled && <div className="reader-book-navigation" aria-label="Book pages">
          <button type="button" aria-label="Previous pages" disabled={position.page <= 1} onClick={() => turn(-1)}><span aria-hidden="true">←</span></button>
          <span aria-live="polite">{position.page} / {position.pages}</span>
          <button type="button" aria-label="Next pages" disabled={position.page >= position.pages} onClick={() => turn(1)}><IconArrowRight size={16} /></button>
        </div>}
      </div>;
  return (
    <div ref={bookRef} className="reader-book" data-active={enabled}>
      {enabled ? toolbar : toolbarTarget ? createPortal(toolbar, toolbarTarget) : toolbar}
      <div ref={pagesRef} className="reader-book-pages" onScroll={enabled ? update : undefined}
        onKeyDown={onKeyDown} tabIndex={enabled ? 0 : undefined}
        role={enabled ? "region" : undefined} aria-label={enabled ? "Paper pages. Use left and right arrow keys to turn pages." : undefined}>
        {children}
      </div>
    </div>
  );
}

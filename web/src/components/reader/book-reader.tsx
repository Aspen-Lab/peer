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

/** The first pixel of a spread and the last pixel of its full viewport. */
export function bookSpreadOffset(width: number, gap: number, page: number) {
  return Math.max(0, page - 1) * (width + gap);
}

const WHEEL_GESTURE_PAUSE_MS = 300;

/** One uninterrupted wheel gesture turns exactly one spread. */
export class BookWheelGesture {
  private amount = 0;
  private direction = 0;
  private lastInput = -Infinity;
  private turned = false;

  reset() { this.amount = 0; this.direction = 0; this.lastInput = -Infinity; this.turned = false; }

  /** The tail of the same gesture must not scroll the document at an edge. */
  holdAtBoundary(delta: number, now: number): boolean {
    const hold = this.turned && delta !== 0 && now - this.lastInput <= WHEEL_GESTURE_PAUSE_MS;
    if (hold) this.lastInput = now;
    else this.reset();
    return hold;
  }

  feed(delta: number, now: number): -1 | 0 | 1 {
    const direction = Math.sign(delta);
    if (!direction) return 0;
    if (now - this.lastInput > WHEEL_GESTURE_PAUSE_MS) this.reset();
    this.lastInput = now;
    // Trackpads can briefly reverse during the momentum tail. A change in
    // direction is still part of the same gesture once a page has turned.
    if (this.turned) return 0;
    if (direction !== this.direction) this.amount = 0;
    this.direction = direction;
    this.amount += Math.abs(delta);
    if (this.amount < 45) return 0;
    this.amount = 0;
    this.turned = true;
    return direction as -1 | 1;
  }
}

/** Convert mouse-wheel lines and page-sized deltas to pixels like trackpads. */
export function bookWheelDelta(event: Pick<WheelEvent, "deltaX" | "deltaY" | "deltaMode">, pageHeight: number): number {
  const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
  return delta * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? pageHeight : 1);
}

/** Do not capture the wheel while the reading area is still entering view. */
export function bookWheelReady(rect: { top: number; bottom: number; height: number }, viewportHeight: number): boolean {
  if (rect.height <= 0 || viewportHeight <= 0) return false;
  const visible = Math.max(0, Math.min(rect.bottom, viewportHeight) - Math.max(rect.top, 0));
  return visible >= Math.min(rect.height * 0.75, viewportHeight * 0.7);
}

/** A gesture that began outside the book continues to scroll the document. */
export class BookWheelEntry {
  private lastIgnored = -Infinity;
  isNew(now: number): boolean { return now - this.lastIgnored > 180; }
  allows(ready: boolean, now: number): boolean {
    if (!ready || now - this.lastIgnored <= 180) { this.lastIgnored = now; return false; }
    return true;
  }
}

/** A widget owns only the axis it can actually scroll. */
export function widgetCanScroll(axis: "x" | "y", style: { overflowX: string; overflowY: string }, box: { scrollWidth: number; clientWidth: number; scrollHeight: number; clientHeight: number }): boolean {
  return axis === "x"
    ? /(auto|scroll)/.test(style.overflowX) && box.scrollWidth > box.clientWidth + 1
    : /(auto|scroll)/.test(style.overflowY) && box.scrollHeight > box.clientHeight + 1;
}

function widgetOwnsWheel(target: EventTarget | null, pages: HTMLElement, axis: "x" | "y"): boolean {
  if (!(target instanceof Element)) return false;
  for (let el: Element | null = target; el && el !== pages; el = el.parentElement) {
    // Figure zoom and editable controls have their own wheel interaction.
    if (el.matches("[data-figure-box], textarea, select, [contenteditable='true']")) return true;
    if (widgetCanScroll(axis, getComputedStyle(el), el as HTMLElement)) return true;
  }
  return false;
}

export function BookReader({ children, available, showingPaper = true, onEnter }: { children: ReactNode; available: boolean; showingPaper?: boolean; onEnter?: () => void }) {
  const [active, setActive] = useState(false);
  const [immersive, setImmersive] = useState(false);
  const [position, setPosition] = useState({ page: 1, pages: 1 });
  const [geometry, setGeometry] = useState({ width: 0, gap: GAP, pages: 1 });
  const bookRef = useRef<HTMLDivElement>(null);
  const pagesRef = useRef<HTMLDivElement>(null);
  const sheetRef = useRef<HTMLDivElement>(null);
  const turnAnimation = useRef<Animation | null>(null);
  const pendingPage = useRef<number | null>(null);
  const scrollRequested = useRef(false);
  const restoreAnchor = useRef<{ node: HTMLElement; fraction: number } | null>(null);
  const snapTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
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
    if (!el) return;
    const columns = el.querySelector<HTMLElement>("#paper-body > section");
    if (!columns) return;
    const width = el.clientWidth;
    const gap = pageGap(el);
    // Measure the column content, not the invisible end spacer or snap points.
    const metrics = bookPageMetrics(width, columns.scrollWidth, el.scrollLeft, gap);
    setPosition(metrics);
    setGeometry((old) => old.width === width && old.gap === gap && old.pages === metrics.pages
      ? old : { width, gap, pages: metrics.pages });
  }, []);

  useEffect(() => {
    const el = pagesRef.current;
    if (!enabled || !el) return;
    const sheet = sheetRef.current;
    const observer = new ResizeObserver(update);
    observer.observe(el);
    const content = el.firstElementChild;
    if (content) observer.observe(content);
    // The column container's dimensions are fixed; observe its text and
    // visuals as well so font-size changes update the actual page count.
    const observed = new WeakSet<Element>();
    const observeBlocks = () => {
      content?.querySelectorAll("#paper-body p, #paper-body h3, #paper-body figure, #paper-body .reader-equation").forEach((block) => {
        if (!observed.has(block)) { observed.add(block); observer.observe(block); }
      });
    };
    observeBlocks();
    // Columns keep the same outer size even when their text reflows, so a
    // ResizeObserver alone misses changes to reading size and content.
    let reflowTimer: ReturnType<typeof setTimeout> | undefined;
    const mutations = new MutationObserver(() => {
      // React may update the parent scale and its children in the same commit.
      // Measure after both have settled, including in a background tab.
      observeBlocks();
      clearTimeout(reflowTimer);
      reflowTimer = setTimeout(update, 150);
    });
    const scale = el.closest(".reading-scaled");
    if (scale) mutations.observe(scale, { attributes: true, attributeFilter: ["style"] });
    if (content) mutations.observe(content, { childList: true, characterData: true, subtree: true });
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
      mutations.disconnect();
      clearTimeout(reflowTimer);
      if (snapTimer.current) clearTimeout(snapTimer.current);
      turnAnimation.current?.cancel();
      turnAnimation.current = null;
      pendingPage.current = null;
      if (sheet) { sheet.style.visibility = "hidden"; sheet.replaceChildren(); }
      el.removeEventListener("load", update, true);
    };
  }, [enabled, update]);

  // Preserve the first visible paragraph as the spread reflows on entry and exit.
  const setImmersiveView = useCallback((next: boolean) => {
    const el = pagesRef.current;
    if (el) {
      const viewport = el.getBoundingClientRect();
      restoreAnchor.current = null;
      for (const node of el.querySelectorAll<HTMLElement>("#paper-body p, #paper-body h3")) {
        const fragments = [...node.getClientRects()];
        const visible = fragments.findIndex((rect) => rect.right > viewport.left && rect.left < viewport.right && rect.bottom > viewport.top && rect.top < viewport.bottom);
        if (visible >= 0) {
          restoreAnchor.current = { node, fraction: visible / fragments.length };
          break;
        }
      }
    }
    setImmersive(next);
  }, []);

  useEffect(() => {
    const el = pagesRef.current;
    if (!enabled || !el) return;
    const frame = requestAnimationFrame(() => {
      const anchor = restoreAnchor.current;
      restoreAnchor.current = null;
      if (anchor?.node.isConnected) {
        const fragments = anchor.node.getClientRects();
        const rect = fragments[Math.min(fragments.length - 1, Math.floor(anchor.fraction * fragments.length))];
        if (rect) {
          const viewport = el.getBoundingClientRect();
          const step = el.clientWidth + pageGap(el);
          const offset = el.scrollLeft + rect.left - viewport.left;
          el.scrollTo({ left: Math.max(0, Math.floor((offset + 1) / step) * step), behavior: "instant" });
        }
      }
      update();
    });
    return () => cancelAnimationFrame(frame);
  }, [enabled, immersive, update]);

  useEffect(() => {
    if (!immersive) return;
    const onEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented || document.querySelector('[role="dialog"][aria-modal="true"]')) return;
      event.preventDefault();
      setImmersiveView(false);
    };
    document.addEventListener("keydown", onEscape);
    return () => document.removeEventListener("keydown", onEscape);
  }, [immersive, setImmersiveView]);

  const toggle = () => {
    if (!enabled) {
      useReaderPanesStore.getState().setLeftPinned(false);
      onEnter?.();
      setActive(true);
    } else {
      setImmersive(false);
      setActive(false);
      useReaderPanesStore.getState().setLeftPinned(true);
    }
  };
  const turn = useCallback((direction: number) => {
    const el = pagesRef.current;
    if (!el) return;
    const gap = pageGap(el);
    const columns = el.querySelector<HTMLElement>("#paper-body > section");

    // Finish an interrupted turn first so fast, repeated inputs never lose a page.
    turnAnimation.current?.cancel();
    turnAnimation.current = null;
    if (pendingPage.current !== null) {
      el.scrollTo({ left: bookSpreadOffset(el.clientWidth, gap, pendingPage.current), behavior: "instant" });
      pendingPage.current = null;
    }
    const { page, pages } = bookPageMetrics(el.clientWidth, columns?.scrollWidth ?? el.clientWidth, el.scrollLeft, gap);
    const next = Math.max(1, Math.min(pages, page + direction));
    const sheet = sheetRef.current;
    if (next === page) {
      if (sheet) { sheet.style.visibility = "hidden"; sheet.replaceChildren(); }
      update();
      return;
    }
    const commit = () => {
      el.scrollTo({ left: bookSpreadOffset(el.clientWidth, pageGap(el), next), behavior: "instant" });
      pendingPage.current = null;
      update();
    };
    if (!sheet || typeof sheet.animate !== "function" || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      if (sheet) { sheet.style.visibility = "hidden"; sheet.replaceChildren(); }
      commit();
      return;
    }

    pendingPage.current = next;
    const forward = direction > 0;
    // The turning leaf carries a non-interactive snapshot of the actual page.
    // Remove ids so anchors, notes and figure controls still address the live paper.
    const snapshot = (right: boolean) => {
      const copy = el.cloneNode(true) as HTMLElement;
      copy.className = "reader-book-snapshot";
      copy.setAttribute("aria-hidden", "true");
      copy.setAttribute("inert", "");
      copy.querySelectorAll<HTMLElement>("[id]").forEach((node) => {
        if (node.id === "paper-body") node.dataset.bookSnapshotBody = "";
        if (node.id.startsWith("paper-section-")) node.dataset.bookSnapshotSection = "";
        node.removeAttribute("id");
      });
      copy.style.width = `${el.clientWidth}px`;
      copy.style.height = `${el.clientHeight}px`;
      copy.style.left = right ? `${-el.clientWidth / 2}px` : "0";
      sheet.replaceChildren(copy);
      copy.scrollLeft = el.scrollLeft;
      sheet.style.top = `${el.offsetTop}px`;
      sheet.style.height = `${el.clientHeight}px`;
      sheet.style.width = `${el.clientWidth / 2}px`;
      sheet.style.left = `${el.offsetLeft + (right ? el.clientWidth / 2 : 0)}px`;
    };
    snapshot(forward);
    sheet.style.visibility = "visible";
    sheet.style.transformOrigin = forward ? "left center" : "right center";
    const outgoing = sheet.animate(
      [{ transform: "rotateY(0deg)" }, { transform: `rotateY(${forward ? -90 : 90}deg)` }],
      { duration: 230, easing: "cubic-bezier(.45,0,.7,.35)", fill: "forwards" },
    );
    turnAnimation.current = outgoing;
    outgoing.onfinish = () => {
      commit();
      snapshot(!forward);
      sheet.style.transformOrigin = forward ? "right center" : "left center";
      const incoming = sheet.animate(
        [{ transform: `rotateY(${forward ? 90 : -90}deg)` }, { transform: "rotateY(0deg)" }],
        { duration: 270, easing: "cubic-bezier(.2,.65,.25,1)", fill: "forwards" },
      );
      outgoing.cancel();
      turnAnimation.current = incoming;
      incoming.onfinish = () => {
        sheet.style.visibility = "hidden";
        sheet.replaceChildren();
        incoming.cancel();
        turnAnimation.current = null;
      };
    };
  }, [update]);

  useEffect(() => {
    const el = pagesRef.current;
    if (!enabled || !el) return;
    const gesture = new BookWheelGesture();
    const entry = new BookWheelEntry();
    const onWheel = (event: WheelEvent) => {
      if (event.defaultPrevented || event.ctrlKey || event.metaKey) return;
      const axis = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? "x" : "y";
      if (widgetOwnsWheel(event.target, el, axis)) return;
      const delta = bookWheelDelta(event, el.clientHeight);
      if (!delta) return;
      const columns = el.querySelector<HTMLElement>("#paper-body > section");
      if (!columns) return;
      const { page, pages } = bookPageMetrics(el.clientWidth, columns.scrollWidth, el.scrollLeft, pageGap(el));
      const now = performance.now();
      // At either end the document can continue scrolling normally.
      if ((delta < 0 && page <= 1) || (delta > 0 && page >= pages)) {
        if (gesture.holdAtBoundary(delta, now)) event.preventDefault();
        return;
      }
      const ready = bookWheelReady(el.getBoundingClientRect(), window.innerHeight);
      const newEntry = !ready && entry.isNew(now);
      if (!entry.allows(ready, now)) {
        // Settle the reader into view on the first gesture. Otherwise a large
        // wheel delta can scroll straight past it before the next event.
        event.preventDefault();
        gesture.reset();
        if (newEntry) bookRef.current?.scrollIntoView({ block: "start", behavior: "auto" });
        return;
      }
      event.preventDefault();
      const direction = gesture.feed(delta, now);
      // Finish the current 3D turn before accepting another gesture.
      if (direction && !turnAnimation.current) turn(direction);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [enabled, turn]);
  // Focus and browser find can scroll to an arbitrary pixel, bypassing CSS
  // snap. Settle back on a complete spread after any horizontal movement.
  const onScroll = () => {
    update();
    if (snapTimer.current) clearTimeout(snapTimer.current);
    snapTimer.current = setTimeout(() => {
      const el = pagesRef.current;
      const columns = el?.querySelector<HTMLElement>("#paper-body > section");
      if (!el || !columns) return;
      const gap = pageGap(el);
      const { page } = bookPageMetrics(el.clientWidth, columns.scrollWidth, el.scrollLeft, gap);
      const target = bookSpreadOffset(el.clientWidth, gap, page);
      if (Math.abs(el.scrollLeft - target) > 1) el.scrollTo({ left: target, behavior: "instant" });
    }, 140);
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
        <div className="reader-book-mode-group">{modeButton}
        {enabled && <button type="button" className="reader-book-mode reader-book-immersive-toggle" aria-pressed={immersive} onClick={() => setImmersiveView(!immersive)}>
          <span aria-hidden="true">{immersive ? "↙" : "⤢"}</span> {immersive ? "Exit immersive" : "Immersive"}
        </button>}</div>
        {enabled && <div className="reader-book-navigation" aria-label="Book pages">
          <span className="reader-book-wheel-hint" aria-hidden="true">Scroll to turn</span>
          <button type="button" aria-label="Previous pages" disabled={position.page <= 1} onClick={() => turn(-1)}><span aria-hidden="true">←</span></button>
          <span aria-live="polite">{position.page} / {position.pages}</span>
          <button type="button" aria-label="Next pages" disabled={position.page >= position.pages} onClick={() => turn(1)}><IconArrowRight size={16} /></button>
        </div>}
      </div>;
  return (
    <div ref={bookRef} className="reader-book" data-active={enabled} data-immersive={enabled && immersive}>
      {enabled ? toolbar : toolbarTarget ? createPortal(toolbar, toolbarTarget) : toolbar}
      <div className="reader-book-stage">
      <div ref={pagesRef} className="reader-book-pages" onScroll={enabled ? onScroll : undefined}
        onKeyDown={onKeyDown} tabIndex={enabled ? 0 : undefined}
        role={enabled ? "region" : undefined} aria-label={enabled ? "Paper pages. Scroll or use left and right arrow keys to turn pages." : undefined}>
        {children}
        {enabled && geometry.width > 0 && <div className="reader-book-guides" aria-hidden="true">
          {Array.from({ length: geometry.pages }, (_, i) => (
            <span key={i} className="reader-book-snap" style={{ left: bookSpreadOffset(geometry.width, geometry.gap, i + 1) }} />
          ))}
          <span className="reader-book-end" style={{ left: bookSpreadOffset(geometry.width, geometry.gap, geometry.pages) + geometry.width - 1 }} />
        </div>}
      </div>
      {enabled && <div ref={sheetRef} className="reader-book-turn-sheet" aria-hidden="true" />}
      </div>
    </div>
  );
}

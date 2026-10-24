"use client";

import { useEffect, useLayoutEffect, useState, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";
import { CARD_DIVIDER_PX, stackLayout, useWindows } from "@/lib/reader/windows";
import { readPageZoom, useMarginStore } from "@/lib/reader/margin";
import type { FloatingWindow } from "@/lib/reader/windows";
import type { MarginRect } from "@/lib/reader/margin";
import { columnBottomPx, DOCK_TOP_PX, legendHeightPx } from "./explain-dock";
import type { MarginFrame } from "./margin-card";

// One DOM track, shared by every card of this page. Its target never changes as
// cards open/close: moving a portal would remount editors and lose unsaved input.
let host: HTMLDivElement | null = null;
let users = 0;

export function measuredCardMinimum(element: HTMLElement): number {
  const header = (element.querySelector("[data-margin-fixed]") ?? element.firstElementChild)?.getBoundingClientRect().height ?? 40;
  const body = element.querySelector<HTMLElement>("[data-margin-body]") ?? element;
  const text = body.querySelector<HTMLElement>(".reading-prose, .font-reading, [contenteditable], textarea") ?? body;
  const style = getComputedStyle(text);
  const line = parseFloat(style.lineHeight) || (parseFloat(style.fontSize) || 16) * 1.6;
  if (element.dataset.marginCompact) return Math.ceil(header + line + 16 + 2);
  let padding = 0;
  for (let node: HTMLElement | null = text; node && node !== element; node = node.parentElement) {
    const css = getComputedStyle(node);
    padding += (parseFloat(css.paddingTop) || 0) + (parseFloat(css.paddingBottom) || 0)
      + (parseFloat(css.marginTop) || 0) + (parseFloat(css.marginBottom) || 0)
      + (parseFloat(css.borderTopWidth) || 0) + (parseFloat(css.borderBottomWidth) || 0);
    if (node === body) break;
  }
  if (element.dataset.marginCard === "figure") {
    const zoom = element.querySelector("[data-figure-zoom-row]")?.getBoundingClientRect().height ?? 36;
    const caption = element.querySelector<HTMLElement>("[data-figure-caption]");
    const captionStyle = caption ? getComputedStyle(caption) : null;
    const captionRow = captionStyle ? (parseFloat(captionStyle.lineHeight) || 24) + (parseFloat(captionStyle.paddingTop) || 0) + (parseFloat(captionStyle.paddingBottom) || 0) : 0;
    return Math.ceil(header + zoom + captionRow + 24 + 2);
  }
  let furniture = 0;
  for (const toolbar of body.querySelectorAll<HTMLElement>('[role="toolbar"]')) {
    const css = getComputedStyle(toolbar);
    furniture += toolbar.getBoundingClientRect().height + (parseFloat(css.marginTop) || 0) + (parseFloat(css.marginBottom) || 0);
  }
  return Math.ceil(header + line + padding + furniture + 2);
}

export function useMarginStack(id: string, element: RefObject<HTMLElement | null>, frame: MarginFrame | null, enabled = true, external?: { windows: readonly FloatingWindow[]; rect: MarginRect | null; bottom: number }) {
  const read = () => ({ windows: useWindows.getState().windows, rect: useMarginStore.getState().rect, bottom: typeof window === "undefined" ? 1000 : columnBottomPx(window.innerHeight, legendHeightPx(readPageZoom())) });
  const [view, setView] = useState(read);
  const managed = external !== undefined;
  useEffect(() => {
    if (!enabled || managed) return;
    const update = () => setView((old) => {
      const next = read();
      return old.windows === next.windows && old.rect === next.rect && old.bottom === next.bottom ? old : next;
    });
    update();
    const stopWindows = useWindows.subscribe(update);
    const stopMargin = useMarginStore.subscribe(update);
    if (typeof window !== "undefined") window.addEventListener("resize", update);
    return () => { stopWindows(); stopMargin(); if (typeof window !== "undefined") window.removeEventListener("resize", update); };
  }, [enabled, managed]);
  const current = external ?? view;
  const windows = current.windows;
  const column = { minTop: current.rect?.top ?? DOCK_TOP_PX, bottom: current.rect?.bottom ?? current.bottom, top: current.rect?.top ?? DOCK_TOP_PX };
  const [target, setTarget] = useState<HTMLDivElement | null>(() => host);
  const split = windows.length > 1;
  const rows = stackLayout(windows, column);
  const total = rows.length ? rows[rows.length - 1].top + rows[rows.length - 1].height - column.minTop : 0;

  useLayoutEffect(() => {
    if (!enabled) return;
    if (typeof document === "undefined" || typeof document.createElement !== "function") return;
    if (!host) {
      host = document.createElement("div");
      host.dataset.marginStackScroll = "";
      document.body.append(host);
    }
    users++;
    setTarget(host);
    return () => { if (--users === 0) { host?.remove(); host = null; } };
  }, [enabled]);

  useLayoutEffect(() => {
    if (!target) return;
    target.style.cssText = split
      ? `position:fixed;top:${column.minTop}px;height:${Math.max(0, column.bottom - column.minTop)}px;left:${frame?.left ?? Math.max(0, window.innerWidth - 360)}px;width:${frame?.width ?? Math.min(360, window.innerWidth)}px;overflow-y:auto;overflow-x:hidden;overscroll-behavior:contain;z-index:60;isolation:isolate;`
      : "display:contents";
    target.dataset.split = String(split);
    let spacer = target.querySelector<HTMLElement>("[data-margin-stack-room]");
    if (!spacer) { spacer = document.createElement("div"); spacer.dataset.marginStackRoom = ""; spacer.style.pointerEvents = "none"; target.prepend(spacer); }
    spacer.style.height = split ? `${total}px` : "0";
  }, [target, split, column.minTop, column.bottom, frame?.left, frame?.width, total]);

  useLayoutEffect(() => {
    const card = element.current;
    if (!card || !split || typeof getComputedStyle !== "function") return;
    const measure = () => useWindows.getState().setMinimum(id, measuredCardMinimum(card));
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    const observe = () => {
      observer.disconnect();
      observer.observe(card);
      for (const child of card.children) observer.observe(child);
      for (const child of card.querySelectorAll('.reading-prose, .font-reading, [contenteditable], textarea, [role="toolbar"]')) observer.observe(child);
      measure();
    };
    observe();
    // Editing replaces the reading surface; keep measuring its new row and
    // the toolbar when its buttons wrap at a new width or reading scale.
    const mutations = typeof MutationObserver === "undefined" ? null : new MutationObserver(observe);
    mutations?.observe(card, { childList: true, subtree: true });
    return () => { observer.disconnect(); mutations?.disconnect(); };
  }, [id, split, target, element]);

  const active = windows.find((w) => w.id === id)?.order;
  const latest = Math.max(0, ...windows.map((w) => w.order));
  useLayoutEffect(() => {
    if (!target || !split || active !== latest || !element.current) return;
    const row = rows.find((r) => r.id === id);
    if (!row) return;
    const top = row.top - column.minTop;
    if (top < target.scrollTop) target.scrollTop = top;
    else if (top + row.height > target.scrollTop + target.clientHeight) target.scrollTop = top + row.height - target.clientHeight;
    // An activation reveals once; divider movement must not fight the reader's scrolling.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target, split, id, active, latest]);

  return {
    split,
    bandTop: column.minTop,
    rows,
    windows,
    ready: target !== null,
    // Do not mount an editor/figure inline and then remount it in the portal:
    // its first focus and its unsaved internal state must have one stable owner.
    portal: (children: ReactNode) => enabled && target ? createPortal(children, target) : enabled && typeof document !== "undefined" && typeof document.createElement === "function" ? null : children,
    gap: CARD_DIVIDER_PX,
  };
}

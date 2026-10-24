"use client";

import { useLayoutEffect, useRef, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { bottomMarginRectOf, readPageZoom, registerMargin, useMarginRect } from "@/lib/reader/margin";
import { useWindows } from "@/lib/reader/windows";

function subscribe(onChange: () => void) {
  window.addEventListener("resize", onChange);
  return () => window.removeEventListener("resize", onChange);
}

/** The narrow reader's complementary margin. The registered band exists even
 * when empty, so a first action can open straight into the shared card host.
 * Its empty placeholder has no furniture and never takes pointer events. */
export function ResponsiveMargin({ side }: { side: boolean }) {
  const element = useRef<HTMLElement | null>(null);
  const viewport = useSyncExternalStore(subscribe, () => `${window.innerWidth},${window.innerHeight}`, () => "0,0");
  const [width, height] = viewport.split(",").map(Number);
  const rect = bottomMarginRectOf(width, height, readPageZoom());
  const windows = useWindows((s) => s.windows);
  const registered = useMarginRect();
  const active = !side && windows.length > 0;
  useLayoutEffect(() => {
    if (side || !element.current) return;
    return registerMargin(element.current, {
      viewportHeight: () => window.innerHeight,
      zoom: () => readPageZoom(),
      presentation: "bottom",
      observe: (elements, callback) => {
        if (typeof ResizeObserver === "undefined") return () => {};
        const observer = new ResizeObserver(callback);
        elements.forEach((el) => observer.observe(el));
        return () => observer.disconnect();
      },
      onResize: (callback) => { window.addEventListener("resize", callback); return () => window.removeEventListener("resize", callback); },
    });
  }, [side, width, height]);

  // This space makes the paper's final lines scroll above an open dock. It is
  // absent when empty and does not change horizontal measure or reading size.
  const room = active && registered?.presentation === "bottom" ? registered.bottom - registered.top + 16 : 0;
  return <>
    <div data-reader-bottom-room="" aria-hidden="true" style={{ height: room }} />
    {typeof document !== "undefined" && createPortal(
      <aside ref={element} data-reader-bottom-margin="" aria-hidden="true" style={{ position: "fixed", pointerEvents: "none", left: rect.left, width: rect.width, top: rect.top, height: rect.bottom - rect.top }} />,
      document.body,
    )}
  </>;
}

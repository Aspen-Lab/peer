"use client";

// A short confirmation — "Copied · 1,240 words", "DOI copied" — in the same
// pill as the undo toast, gone after a moment. It carries no control, so it
// stays out of the way of the UndoToast when both are up.

import { useEffect, useState } from "react";

const SHOW_MS = 1800;

export interface ToastMessage {
  text: string;
  /** A fresh key re-shows the same text. */
  key: number;
}

export function useReaderToast(): [ToastMessage | null, (text: string) => void] {
  const [toast, setToast] = useState<ToastMessage | null>(null);
  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), SHOW_MS);
    return () => window.clearTimeout(timer);
  }, [toast]);
  return [toast, (text) => setToast({ text, key: Date.now() })];
}

export function ReaderToast({ toast }: { toast: ToastMessage | null }) {
  // The live region is always in the DOM, empty at rest: a region inserted
  // together with its text is not reliably announced, and the copy has no
  // other confirmation for a screen-reader user.
  return (
    <div
      className="fixed right-0 bottom-20 flex justify-center pointer-events-none z-[69] px-4"
      style={{ left: "var(--sidebar-offset, 0px)" }}
      role="status"
      aria-live="polite"
    >
      {toast && (
        <div
          key={toast.key}
          className="rounded-full bg-heading text-bg shadow-card-hover px-5 py-2.5 text-body-sm animate-fade-in-up"
          style={{ "--i": 0 } as React.CSSProperties}
        >
          {toast.text}
        </div>
      )}
    </div>
  );
}

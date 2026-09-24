"use client";

// 9-31 (A9-09, Ruling 8): the "confirm" band's own dialog — a partial title
// overlap (0.35-0.6) is neither auto-bound nor refused outright; the reader
// gets a one-line comparison and an explicit yes/no before anything binds.
// Same shape as `UploadConsentDialog` (native <dialog>, no new deps).

import { useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";

export function UploadMatchConfirmDialog({ targetTitle, extractedTitle, onConfirm, onCancel }: {
  targetTitle: string; extractedTitle: string; onConfirm: () => void; onCancel: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { dialog.current?.showModal(); }, []);
  return (
    <dialog ref={dialog} onCancel={onCancel} aria-labelledby="upload-match-confirm-title"
      className="fixed inset-0 m-auto w-[min(92vw,480px)] rounded-xl border border-border bg-surface p-6 text-text shadow-card backdrop:bg-black/40">
      <h2 id="upload-match-confirm-title" className="font-display text-body-lg text-heading">Is this the right paper?</h2>
      <p className="mt-3 break-words font-sans text-body-sm text-text-muted">
        Attach to &ldquo;{targetTitle}&rdquo;? The PDF&rsquo;s own title reads &ldquo;{extractedTitle}&rdquo;.
      </p>
      <div className="mt-5 flex justify-end gap-2">
        <Button onClick={onCancel}>Cancel</Button>
        <Button tone="primary" onClick={onConfirm}>This is the right paper</Button>
      </div>
    </dialog>
  );
}

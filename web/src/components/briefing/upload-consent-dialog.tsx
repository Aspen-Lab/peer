"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";

export function UploadConsentDialog({ file, onAccept, onCancel }: {
  file: File; onAccept: () => void; onCancel: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [accepted, setAccepted] = useState(false);
  useEffect(() => { dialog.current?.showModal(); }, []);
  return (
    <dialog ref={dialog} onCancel={onCancel} aria-labelledby="private-pdf-title"
      className="fixed inset-0 m-auto w-[min(92vw,480px)] rounded-xl border border-border bg-surface p-6 text-text shadow-card backdrop:bg-black/40">
      <h2 id="private-pdf-title" className="font-display text-body-lg text-heading">Upload a private PDF</h2>
      <p className="mt-3 break-words font-sans text-body-sm">{file.name}</p>
      <p className="mt-3 font-sans text-body-sm text-text-muted">
        Your PDF stays private to your account (or this browser in local development) for 30 days.
        Peer uses its keywords to learn your interests. You can delete the PDF and its learned signals.
        Reports may send article text and figures to your configured AI provider under that provider’s terms.
      </p>
      <label className="mt-4 flex items-start gap-3 font-sans text-body-sm">
        <input type="checkbox" checked={accepted} onChange={(e) => setAccepted(e.target.checked)} className="mt-1" />
        <span>I am authorized to upload, store and process this article in Peer, including with my AI provider.
          Having subscription access alone may not grant these permissions.</span>
      </label>
      <p className="mt-3 font-sans text-caption text-text-muted">Only upload authorized copies. Peer does not bypass paywalls or share your PDF with other readers.</p>
      <div className="mt-5 flex justify-end gap-2">
        <Button onClick={onCancel}>Cancel</Button>
        <Button tone="primary" disabled={!accepted} onClick={onAccept}>Upload PDF</Button>
      </div>
    </dialog>
  );
}

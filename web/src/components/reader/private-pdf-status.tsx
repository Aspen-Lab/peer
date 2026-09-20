"use client";

import { useState } from "react";
import type { Paper } from "@/types";
import { useProfileStore } from "@/store/profile";

export function PrivatePdfStatus({ upload, onDeleted }: { upload: Paper; onDeleted: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const forget = useProfileStore((s) => s.forgetUploadPreference);
  const documentKey = upload.uploadDocumentKey;
  return <div className="mt-3 font-sans text-caption text-text-muted">
    <p>Private PDF · retained for 30 days after upload · keywords inform your recommendations.</p>
    <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1">
      {/* 9-24 (A9-12): a ledger-only undo, separate from deleting the file —
       * "this doesn't represent me" without giving up the private PDF. */}
      {documentKey && (
        <button type="button" className="underline underline-offset-4 hover:text-heading"
          onClick={() => forget(documentKey)}>
          Forget what Peer learned from this
        </button>
      )}
      <button type="button" disabled={busy} className="underline underline-offset-4 hover:text-red"
        onClick={async () => {
          setBusy(true); setError(null);
          try {
            const res = await fetch(`/api/papers/upload/${encodeURIComponent(upload.id.slice(7))}`, { method: "DELETE" });
            if (!res.ok) throw new Error("The PDF could not be deleted. Try again.");
            // 9-22 (A9-02): only retract the shared ledger evidence when the
            // server confirms no other live copy of this document justifies
            // it — deleting one of two same-DOI copies must not erase the
            // still-valid evidence for the one that remains.
            const data: { retractEvidence?: boolean } = await res.json().catch(() => ({}));
            if (documentKey && data.retractEvidence) forget(documentKey);
            onDeleted();
          } catch (err) { setError(err instanceof Error ? err.message : "Delete failed."); }
          finally { setBusy(false); }
        }}>{busy ? "Deleting…" : "Delete PDF"}</button>
    </div>
    {error && <p role="alert">{error}</p>}
  </div>;
}

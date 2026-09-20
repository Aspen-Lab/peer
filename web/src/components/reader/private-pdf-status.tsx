"use client";

import { useState } from "react";
import type { Paper } from "@/types";
import { useProfileStore } from "@/store/profile";

export function PrivatePdfStatus({ upload, onDeleted }: { upload: Paper; onDeleted: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const forget = useProfileStore((s) => s.forgetUploadPreference);
  return <div className="mt-3 font-sans text-caption text-text-muted">
    <p>Private PDF · retained for 30 days after upload · keywords inform your recommendations.</p>
    <button type="button" disabled={busy} className="mt-1 underline underline-offset-4 hover:text-red"
      onClick={async () => {
        setBusy(true); setError(null);
        try {
          const res = await fetch(`/api/papers/upload/${encodeURIComponent(upload.id.slice(7))}`, { method: "DELETE" });
          if (!res.ok) throw new Error("The PDF could not be deleted. Try again.");
          if (upload.uploadDocumentKey) forget(upload.uploadDocumentKey);
          onDeleted();
        } catch (err) { setError(err instanceof Error ? err.message : "Delete failed."); }
        finally { setBusy(false); }
      }}>{busy ? "Deleting…" : "Delete PDF and its learned signals"}</button>
    {error && <p role="alert">{error}</p>}
  </div>;
}

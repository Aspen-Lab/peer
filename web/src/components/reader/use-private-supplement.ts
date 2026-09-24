"use client";

import { useEffect, useMemo, useState } from "react";
import type { Paper } from "@/types";
import { useProfileStore } from "@/store/profile";

export function usePrivateSupplement(original: Paper) {
  const standalone = original.id.startsWith("upload:");
  const [state, setState] = useState<{ id: string; upload: Paper | null } | null>(null);
  const recordUploadPreference = useProfileStore((s) => s.recordUploadPreference);
  // 9-23 (A9-07): a standalone `upload:` paper never goes through the fetch
  // effect below (it already IS its own upload record) — merge here so a
  // cold load / reload / another device recovers the learning signal too,
  // the same idempotent-per-documentKey path the uploads list uses.
  useEffect(() => {
    if (!standalone) return;
    recordUploadPreference(original);
  }, [standalone, original, recordUploadPreference]);
  useEffect(() => {
    if (standalone) return;
    const controller = new AbortController();
    fetch(`/api/papers/upload?paperId=${encodeURIComponent(original.id)}`, { cache: "no-store", signal: controller.signal })
      .then(async (res) => { if (!res.ok) throw new Error("Supplement lookup failed"); return res.json(); })
      .then((data: { paper: Paper | null }) => { if (!controller.signal.aborted) setState({ id: original.id, upload: data.paper }); })
      .catch(() => { if (!controller.signal.aborted) setState({ id: original.id, upload: null }); });
    return () => controller.abort();
  }, [original.id, standalone]);
  const upload = standalone ? original : state?.id === original.id ? state.upload : null;
  const paper = useMemo(() => upload && !standalone ? {
    ...original, fullTextUploadId: upload.id, uploadDocumentKey: upload.uploadDocumentKey,
    pageCount: upload.pageCount,
    // 9-15 (A9-10): carried onto the merged paper so the report/reading
    // cache keys (use-model-report.ts, use-reading.ts) and any per-figure
    // request (paper-figure.tsx) can tell a delete-then-re-upload of the
    // same-hash asset apart from the attachment they were built against.
    revision: upload.revision,
  } : original, [original, upload, standalone]);
  return {
    paper, upload, ready: standalone || state?.id === original.id,
    setUpload: (next: Paper | null) => setState({ id: original.id, upload: next }),
  };
}

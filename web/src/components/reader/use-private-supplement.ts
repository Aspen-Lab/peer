"use client";

import { useEffect, useMemo, useState } from "react";
import type { Paper } from "@/types";

export function usePrivateSupplement(original: Paper) {
  const standalone = original.id.startsWith("upload:");
  const [state, setState] = useState<{ id: string; upload: Paper | null } | null>(null);
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
  } : original, [original, upload, standalone]);
  return {
    paper, upload, ready: standalone || state?.id === original.id,
    setUpload: (next: Paper | null) => setState({ id: original.id, upload: next }),
  };
}

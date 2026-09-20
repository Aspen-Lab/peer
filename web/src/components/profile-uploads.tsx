"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { Paper } from "@/types";
import { PrivatePdfStatus } from "@/components/reader/private-pdf-status";
import { useAuthUser } from "@/components/account/use-auth-user";

export function ProfileUploads() {
  const auth = useAuthUser();
  const accountScope = auth.kind === "signed-in" ? auth.user.id : auth.kind;
  return <UploadList key={accountScope} />;
}

function UploadList() {
  const [uploads, setUploads] = useState<Array<{ paper: Paper; expiresAt: string }>>([]);
  const [error, setError] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/papers/upload", { cache: "no-store", signal: controller.signal })
      .then(async (res) => { if (!res.ok) throw new Error("lookup"); return res.json(); })
      .then((data) => { if (!controller.signal.aborted) setUploads(data.uploads ?? []); })
      .catch(() => { if (!controller.signal.aborted) setError(true); });
    return () => controller.abort();
  }, []);
  if (!uploads.length && !error) return null;
  return <section className="mt-8 border-t border-border pt-6">
    <h2 className="font-display text-body-lg text-heading">Your private PDFs</h2>
    {error && <p role="alert" className="mt-2 text-body-sm text-text-muted">PDF list unavailable. Reload to try again.</p>}
    <ul className="mt-3 space-y-5">
      {uploads.map(({ paper, expiresAt }) => <li key={paper.id}>
        <Link href={`/papers/${encodeURIComponent(paper.id)}`} className="font-sans text-body-sm underline underline-offset-4">{paper.title}</Link>
        <p className="mt-1 font-mono text-caption text-text-faint">Access expires {new Date(expiresAt).toLocaleDateString()}</p>
        <PrivatePdfStatus upload={paper} onDeleted={() => setUploads((items) => items.filter((item) => item.paper.id !== paper.id))} />
      </li>)}
    </ul>
  </section>;
}

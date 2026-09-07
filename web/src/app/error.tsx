"use client";

import { useEffect } from "react";
import Link from "next/link";

export default function ErrorBoundary({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="mx-auto max-w-[720px] px-6 py-24 font-sans">
      <p className="text-caption font-semibold uppercase tracking-[0.16em] text-text-faint">
        Error
      </p>
      <h1 className="mt-3 text-display-xs font-semibold tracking-[-0.01em] text-heading">
        This view hit a snag.
      </h1>
      <p className="mt-2 text-body leading-[1.6] text-text-muted">
        Your feed and saved items are safe. Try again, or head back to the
        briefing.
      </p>
      <div className="mt-7 flex items-center gap-3">
        <button
          onClick={reset}
          className="inline-flex h-10 items-center rounded-full bg-accent px-5 text-body font-medium text-bg transition-opacity hover:opacity-90"
        >
          Try again
        </button>
        <Link
          href="/"
          className="inline-flex h-10 items-center rounded-full bg-surface px-5 text-body font-medium text-text shadow-card transition-colors hover:bg-surface-hover"
        >
          Back to feed
        </Link>
      </div>
      {error?.digest ? (
        <p className="mt-8 font-mono text-meta text-text-faint">
          ref {error.digest}
        </p>
      ) : null}
    </div>
  );
}

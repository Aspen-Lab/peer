"use client";

// P10-30 rule 3 (BACKLOG-74): the reader's own error boundary. A throw inside the reader page used to reach only the
// root `app/error.tsx`, whose whole-view "This view hit a snag" and "Back to the briefing" talk about another page.
// Here the message stays in the reader: what happened to this paper's page, that the reader's things are safe, a Try
// again that re-renders the page (`reset()`), and the way back to Saved. The root boundary is unchanged and still
// catches everything outside this route.

import { useEffect } from "react";
import Link from "next/link";
import { EmptyState } from "@/components/ui/empty-state";
import { PageContainer } from "@/components/ui/page-container";
import { buttonVariants } from "@/components/ui/button";

export default function ReaderErrorBoundary({
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
    <PageContainer>
      <EmptyState
        label="Reading"
        title="This paper's page hit a snag."
        line="Your notes and saved papers are safe. Try again, or go back to your library."
        actions={
          <>
            <button
              type="button"
              onClick={reset}
              className={buttonVariants({ tone: "primary", size: "lg" })}
            >
              Try again
            </button>
            <Link href="/saved" className={buttonVariants({ tone: "ghost", size: "lg" })}>
              Back to Saved
            </Link>
          </>
        }
      />
      {error?.digest ? (
        <p className="mt-8 annotation text-meta text-text-faint">ref {error.digest}</p>
      ) : null}
    </PageContainer>
  );
}

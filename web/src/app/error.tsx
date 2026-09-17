"use client";

import { useEffect } from "react";
import Link from "next/link";
import { EmptyState } from "@/components/ui/empty-state";
import { PageContainer } from "@/components/ui/page-container";
import { buttonVariants } from "@/components/ui/button";

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
    <PageContainer>
      <EmptyState
        label="Error"
        title="This view hit a snag."
        line="Your feed and saved items are safe. Try again, or head back to the briefing."
        actions={
          <>
            <button
              type="button"
              onClick={reset}
              className={buttonVariants({ tone: "primary", size: "lg" })}
            >
              Try again
            </button>
            <Link href="/" className={buttonVariants({ tone: "ghost", size: "lg" })}>
              Back to the briefing
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

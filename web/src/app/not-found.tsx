import Link from "next/link";
import { EmptyState } from "@/components/ui/empty-state";
import { PageContainer } from "@/components/ui/page-container";
import { buttonVariants } from "@/components/ui/button";

export default function NotFound() {
  return (
    <PageContainer>
      <EmptyState
        label="404"
        title="Page not found."
        line="The link may be stale, or this item is no longer in your feed."
        actions={
          <Link href="/" className={buttonVariants({ tone: "primary", size: "lg" })}>
            Back to the briefing
          </Link>
        }
      />
    </PageContainer>
  );
}

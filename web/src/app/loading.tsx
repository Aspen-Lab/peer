import { PageContainer } from "@/components/ui/page-container";
import { LoadingSkeleton } from "@/components/ui";

export default function Loading() {
  return (
    <PageContainer width="board">
      <LoadingSkeleton />
    </PageContainer>
  );
}

import { PageContainer } from "@/components/ui/page-container";
import { LoadingMat } from "@/components/reader/loading-mat";

export default function Loading() {
  return (
    <PageContainer width="detail" className="px-5 sm:px-6 py-8 sm:py-12">
      <LoadingMat />
    </PageContainer>
  );
}

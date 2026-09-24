import { PageContainer } from "@/components/ui/page-container";
import { LoadingMat } from "@/components/reader/loading-mat";
import { PAGE_CLASS, SPREAD_GRID } from "@/components/reader/spread";

// The same container and grid as the page, so from xl the mat stands in the
// panel column at the plate's width and the plate replaces it in place.
//
// S20: never sets `--reading-scale` (a Server Component cannot call
// `useReadingScale()`), so `SPREAD_GRID`/the `spread` variant's `calc()`s
// fall back to their `1` default here — the same book-layout width as
// before this item, on purpose, not an oversight.
export default function Loading() {
  return (
    <PageContainer width="spread" rhythm="reader" className={PAGE_CLASS}>
      <div className={SPREAD_GRID}>
        <div>
          <LoadingMat />
        </div>
      </div>
    </PageContainer>
  );
}

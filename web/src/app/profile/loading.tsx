import { PageContainer } from "@/components/ui/page-container";
export default function Loading() {
  return (
    <PageContainer width="contentResponsive" aria-busy="true" aria-label="Loading profile">
      <div className="h-3 w-24 rounded-md skeleton" />
      <div className="mt-6 h-7 w-[40%] rounded-md skeleton" />
      <div className="mt-10 rounded-2xl bg-surface shadow-card p-6">
        <div className="h-3 w-32 rounded-md skeleton" />
        <div className="mt-4 space-y-2.5">
          <div className="h-3 w-full rounded-md skeleton" />
          <div className="h-3 w-[80%] rounded-md skeleton" />
        </div>
      </div>
    </PageContainer>
  );
}

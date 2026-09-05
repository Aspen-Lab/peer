"use client";

// Saved papers.
//
// This page used to be three peer sections — Papers, Events, Jobs — behind a
// kind switcher and a To-do / Done rail. The rail was for job applications and
// event registrations; its own comment admitted papers "have no completion
// action" and were pinned to To-do forever. Events and jobs are no longer
// product surfaces, so what remains is what this page was for: a shelf.

import type { Paper } from "@/types";
import { useFeedStore } from "@/store/feed";
import { PaperCard } from "@/components/cards/paper-card";
import { EmptyState } from "@/components/ui";
import { PageContainer } from "@/components/ui/page-container";

export function SavedPageView({ savedPapers }: { savedPapers: Paper[] }) {
  return (
    <PageContainer width="wideResponsive" className="px-6 py-16 lg:py-20">
      <header className="mb-8">
        <h1 className="text-[34px] font-semibold leading-[1.1] tracking-[-0.02em] text-heading lg:text-[38px]">
          Saved
        </h1>
        <p className="mt-3 text-lead leading-relaxed text-text-muted">
          {savedPapers.length === 0
            ? "Your reading shelf."
            : `${savedPapers.length} paper${savedPapers.length === 1 ? "" : "s"} on your shelf.`}
        </p>
      </header>

      {savedPapers.length === 0 ? (
        <EmptyState
          title="Nothing saved yet."
          description="Tap the bookmark on any paper in your briefing and it will land here."
        />
      ) : (
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
          {savedPapers.map((paper) => (
            <PaperCard key={paper.id} paper={paper} />
          ))}
        </div>
      )}
    </PageContainer>
  );
}

export default function SavedPage() {
  const savedPapers = useFeedStore((state) => state.savedPapers);
  return <SavedPageView savedPapers={savedPapers} />;
}

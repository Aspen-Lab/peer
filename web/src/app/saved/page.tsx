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
import { EmptyState } from "@/components/ui/empty-state";
import { PageContainer } from "@/components/ui/page-container";

export function SavedPageView({ savedPapers }: { savedPapers: Paper[] }) {
  return (
    <PageContainer>
      <header className="mb-8">
        <h1 className="display-line text-display leading-[1.1] text-heading lg:text-display-lg">
          Saved
        </h1>
        {/* A count is a machine fact, not a lede — it was set at 16.5px on a
            measure written for prose, holding one number. */}
        {savedPapers.length > 0 && (
          <p className="annotation text-meta text-text-faint mt-3">
            {savedPapers.length} paper{savedPapers.length === 1 ? "" : "s"}
          </p>
        )}
      </header>

      {savedPapers.length === 0 ? (
        <EmptyState
          title="Nothing saved yet."
          line="Tap the bookmark on any paper in your briefing and it will land here."
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

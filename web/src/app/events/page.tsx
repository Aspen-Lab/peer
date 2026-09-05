"use client";

// Events, demoted off the daily surface.
//
// Conferences and CFPs matter a few times a year. They used to sit on the home
// page as a tab with the same visual weight as the daily paper feed, their
// cards mixed into the same grid, and their pipeline ran on every home-page
// tick. They live here now, and they only fetch when someone opens this page.

import { useCallback, useEffect, useMemo, useState } from "react";
import type { OpportunityFacetSelection } from "@/types";
import { useFeedStore } from "@/store/feed";
import { useProfileStore } from "@/store/profile";
import { EventCard } from "@/components/cards/event-card";
import { EmptyState, LoadingSkeleton } from "@/components/ui";
import { OpportunityFacetPanel } from "@/components/opportunities/opportunity-facet-panel";
import { OpportunityShowMore } from "@/components/opportunities/opportunity-show-more";
import { filterOpportunitiesByFacets } from "@/lib/opportunities/facets";
import {
  nextOpportunityPageSize,
  OPPORTUNITY_PAGE_SIZE,
  paginateOpportunities,
} from "@/lib/opportunities/pagination";

export default function EventsPage() {
  const eventPool = useFeedStore((s) => s.eventPool);
  const eventFacetCounts = useFeedStore((s) => s.eventFacetCounts);
  const eventsLoading = useFeedStore((s) => s.eventsLoading);
  const loadFeed = useFeedStore((s) => s.loadFeed);
  const recordOpportunityFacetPreference = useProfileStore(
    (s) => s.recordOpportunityFacetPreference,
  );

  const [facets, setFacets] = useState<OpportunityFacetSelection>({});
  const [visibleCount, setVisibleCount] = useState(OPPORTUNITY_PAGE_SIZE);

  // Fetch on open, not on every home-page tick.
  useEffect(() => {
    if (eventPool.length > 0 || eventsLoading) return;
    void loadFeed({ lanes: ["events"] });
  }, [eventPool.length, eventsLoading, loadFeed]);

  // Selecting a facet also records it as a standing preference, one value at a
  // time — same contract the home page used before this route existed.
  const handleFacetChange = useCallback(
    (next: OpportunityFacetSelection) => {
      const groups = ["location", "month", "format"] as const;
      for (const group of groups) {
        const previous = new Set(
          (facets[group] ?? []).map((value) =>
            value.trim().toLocaleLowerCase(),
          ),
        );
        for (const value of next[group] ?? []) {
          if (previous.has(value.trim().toLocaleLowerCase())) continue;
          recordOpportunityFacetPreference("event", group, value);
        }
      }
      setFacets(next);
      setVisibleCount(OPPORTUNITY_PAGE_SIZE);
    },
    [facets, recordOpportunityFacetPreference],
  );

  const filtered = useMemo(
    () => filterOpportunitiesByFacets("events", eventPool, facets),
    [eventPool, facets],
  );
  const page = useMemo(
    () =>
      paginateOpportunities(
        filtered,
        visibleCount,
        (event) => event.relevanceScore ?? 0,
      ),
    [filtered, visibleCount],
  );

  return (
    <article className="mx-auto max-w-[1280px] px-6 py-16 lg:py-20">
      <div className="mx-auto max-w-[820px]">
        <header className="mb-6">
          <h1 className="text-title font-medium text-heading tabular-nums">
            {eventPool.length} event{eventPool.length === 1 ? "" : "s"} in
            today&apos;s pool
          </h1>
          <p className="mt-1 text-meta text-text-faint">
            Conferences, workshops and submission deadlines. Refreshed when you
            open this page.
          </p>
        </header>

        {eventPool.length > 0 && (
          <OpportunityFacetPanel
            counts={eventFacetCounts}
            selection={facets}
            onChange={handleFacetChange}
            scopeLabel="Today’s event pool"
          />
        )}
      </div>

      {eventsLoading && eventPool.length === 0 && (
        <div className="mx-auto max-w-[820px]">
          <LoadingSkeleton />
        </div>
      )}

      {!eventsLoading && eventPool.length === 0 && (
        <div className="mx-auto max-w-[820px]">
          <EmptyState
            title="No events in today’s pool."
            description="Peer looks for conferences and CFPs that match your topics. Add or widen your event topics in your profile to see more."
          />
        </div>
      )}

      {page.items.length > 0 && (
        <div className="mt-6 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {page.items.map((event) => (
            <EventCard key={event.id} event={event} />
          ))}
          {page.remaining > 0 && (
            <OpportunityShowMore
              remaining={page.remaining}
              onClick={() =>
                setVisibleCount((current) =>
                  nextOpportunityPageSize(current, filtered.length),
                )
              }
            />
          )}
        </div>
      )}
    </article>
  );
}

"use client";

// Jobs, demoted off the daily surface.
//
// A job is found maybe once a year. This lane had seven source adapters, a
// 200-item pool and a full faceted-search console — all rendered on the daily
// reading page beside a paper feed capped at ten. It lives here now, and only
// fetches when someone opens this page.

import { useCallback, useEffect, useMemo, useState } from "react";
import { useFeedStore } from "@/store/feed";
import { useProfileStore } from "@/store/profile";
import { JobCard } from "@/components/cards/job-card";
import { EmptyState, LoadingSkeleton } from "@/components/ui";
import { JobFacetPanel } from "@/components/opportunities/opportunity-facet-panel";
import { OpportunityShowMore } from "@/components/opportunities/opportunity-show-more";
import {
  countJobFacets,
  DEFAULT_JOB_FACET_SELECTION,
  filterJobsByFacets,
  type JobFacetSelection,
} from "@/lib/opportunities/facets";
import {
  nextOpportunityPageSize,
  OPPORTUNITY_PAGE_SIZE,
  paginateOpportunities,
} from "@/lib/opportunities/pagination";

export default function JobsPage() {
  const jobPool = useFeedStore((s) => s.jobPool);
  const jobsLoading = useFeedStore((s) => s.jobsLoading);
  const loadFeed = useFeedStore((s) => s.loadFeed);
  const profile = useProfileStore((s) => s.profile);
  const updateLocations = useProfileStore((s) => s.updateLocations);

  const [facets, setFacets] = useState<JobFacetSelection>(() => ({
    ...DEFAULT_JOB_FACET_SELECTION,
    locations: [],
    roleKinds: [],
    visaStates: [],
  }));
  const [visibleCount, setVisibleCount] = useState(OPPORTUNITY_PAGE_SIZE);

  useEffect(() => {
    if (jobPool.length > 0 || jobsLoading) return;
    void loadFeed({ lanes: ["jobs"] });
  }, [jobPool.length, jobsLoading, loadFeed]);

  const authorisedCountries = profile.authorisedCountries ?? [];

  const handleLocationAdded = useCallback(
    (location: string) => {
      const key = location.trim().toLocaleLowerCase();
      if (
        profile.locationPreferences.some(
          (candidate) => candidate.trim().toLocaleLowerCase() === key,
        )
      ) {
        return;
      }
      updateLocations([...profile.locationPreferences, location]);
    },
    [profile.locationPreferences, updateLocations],
  );

  const counts = useMemo(() => countJobFacets(jobPool), [jobPool]);
  const filtered = useMemo(
    () => filterJobsByFacets(jobPool, facets),
    [jobPool, facets],
  );
  const page = useMemo(
    () => paginateOpportunities(filtered, visibleCount),
    [filtered, visibleCount],
  );

  return (
    <article className="mx-auto max-w-[1280px] px-6 py-16 lg:py-20">
      <div className="mx-auto max-w-[820px]">
        <header className="mb-6">
          <h1 className="text-title font-medium text-heading tabular-nums">
            {`${jobPool.length} job${jobPool.length === 1 ? "" : "s"} in today’s pool`}
          </h1>
          <p className="mt-1 text-meta text-text-faint">
            Roles matching your topics and work rights. Refreshed when you open
            this page.
          </p>
        </header>

        {jobPool.length > 0 && (
          <JobFacetPanel
            counts={counts}
            selection={facets}
            onChange={(next) => {
              setFacets(next);
              setVisibleCount(OPPORTUNITY_PAGE_SIZE);
            }}
            onLocationAdded={handleLocationAdded}
            usesAuthorisationDefault={authorisedCountries.length > 0}
          />
        )}
      </div>

      {jobsLoading && jobPool.length === 0 && (
        <div className="mx-auto max-w-[820px]">
          <LoadingSkeleton />
        </div>
      )}

      {!jobsLoading && jobPool.length === 0 && (
        <div className="mx-auto max-w-[820px]">
          <EmptyState
            title="No jobs in today’s pool."
            description="Peer matches roles against your topics and work rights. Widen your job topics in your profile to see more."
          />
        </div>
      )}

      {page.items.length > 0 && (
        <div className="mt-6 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {page.items.map((job) => (
            <JobCard key={job.id} job={job} />
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

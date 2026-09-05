"use client";

// Manual paper search.
//
// This used to live at the top of the daily feed as the single loudest element
// on the page — and typing two characters into it deleted the briefing
// (`!hasSearchQuery && ...` gated the whole feed off). A passive push surface
// and an active hunting surface were fighting over one route. They are two
// routes now.

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { apiFetch } from "@/lib/api";
import { SearchResultCard } from "@/components/cards/search-result-card";
import { EmptyState, LoadingSkeleton, SectionHeading } from "@/components/ui";
import { FilterBar } from "@/components/search/filter-bar";
import {
  DEFAULT_FILTERS,
  filtersFromUrlParams,
  filtersToApiQuery,
  filtersToUrlParams,
  type Filters,
} from "@/lib/search/filters";

interface SearchResult {
  id: string;
  [key: string]: unknown;
}

export default function SearchPageWrapper() {
  return (
    <Suspense fallback={null}>
      <SearchPage />
    </Suspense>
  );
}

function SearchPage() {
  const searchParamsObj = useSearchParams();
  const incomingQuery = searchParamsObj?.get("q") ?? "";

  const [query, setQuery] = useState(incomingQuery);
  const [filters, setFilters] = useState<Filters>(() =>
    filtersFromUrlParams(searchParamsObj),
  );
  const [results, setResults] = useState<SearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);

  const debounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  // Monotonic token: a slow older response must never overwrite a newer one.
  const seqRef = useRef(0);

  const normalizedQuery = query.trim();
  const isActive = normalizedQuery.length >= 2;

  // Hydrate from ?q= on navigation (e.g. clicking an author or venue).
  useEffect(() => {
    if (incomingQuery && incomingQuery !== query) setQuery(incomingQuery);
  }, [incomingQuery]); // eslint-disable-line react-hooks/exhaustive-deps

  const runSearch = useCallback(async (q: string, f: Filters) => {
    if (q.length < 2) {
      seqRef.current++;
      setResults([]);
      return;
    }
    const requestId = ++seqRef.current;
    setIsSearching(true);
    setResults([]);
    try {
      const apiParams = filtersToApiQuery(f);
      apiParams.set("q", q);
      apiParams.set("per_page", "12");
      const data = await apiFetch<{ results?: unknown[] }>(
        `/api/papers/search?${apiParams.toString()}`,
      );
      if (requestId !== seqRef.current) return;
      setResults((data.results as SearchResult[]) || []);
    } catch {
      if (requestId === seqRef.current) setResults([]);
    } finally {
      if (requestId === seqRef.current) {
        setIsSearching(false);
        setHasSearched(true);
      }
    }
  }, []);

  // Explicit submit bypasses the 400ms debounce.
  const submit = useCallback(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (isActive) void runSearch(normalizedQuery, filters);
  }, [filters, isActive, normalizedQuery, runSearch]);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (isActive) {
      debounceRef.current = setTimeout(
        () => runSearch(normalizedQuery, filters),
        400,
      );
    } else {
      seqRef.current++;
      setResults([]);
      setIsSearching(false);
      setHasSearched(false);
    }
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [filters, isActive, normalizedQuery, runSearch]);

  // Keep the URL shareable without polluting history.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const url = new URL(window.location.href);
    const next = filtersToUrlParams(filters);
    if (query) next.set("q", query);
    const reserved = new Set([
      "q", "year", "from", "to", "sort", "oa", "cites", "src", "venue",
    ]);
    url.searchParams.forEach((_, key) => {
      if (reserved.has(key)) url.searchParams.delete(key);
    });
    next.forEach((v, k) => url.searchParams.set(k, v));
    const target =
      url.pathname +
      (url.searchParams.toString() ? `?${url.searchParams}` : "") +
      url.hash;
    if (
      target !==
      window.location.pathname + window.location.search + window.location.hash
    ) {
      window.history.replaceState(null, "", target);
    }
  }, [query, filters]);

  return (
    <article className="mx-auto max-w-[1280px] px-6 py-16 lg:py-20">
      <div className="mx-auto max-w-[820px]">
        <header className="mb-5">
          <h1 className="text-title font-medium text-heading">Search papers</h1>
          <p className="mt-1 text-meta text-text-faint">
            Across OpenAlex — 250M+ academic works. Your daily briefing is
            untouched by anything you do here.
          </p>
        </header>

        <div className="rounded-3xl glass shadow-card focus-within:shadow-card-hover transition-[box-shadow] duration-200">
          <div className="relative">
            <svg
              className="absolute left-4 top-1/2 -translate-y-1/2 text-text-faint pointer-events-none"
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden
            >
              <circle cx="11" cy="11" r="7" />
              <path d="M20 20l-3.5-3.5" />
            </svg>
            <input
              id="peer-search"
              type="search"
              value={query}
              autoFocus
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  submit();
                }
              }}
              placeholder="Title, author, venue, concept…"
              aria-label="Search papers"
              className="w-full bg-transparent pl-11 pr-11 py-4 text-body-lg text-text placeholder:text-text-faint outline-none"
            />
            {query.length > 0 && (
              <button
                type="button"
                onClick={() => setQuery("")}
                aria-label="Clear search"
                className="absolute right-4 top-1/2 -translate-y-1/2 inline-flex h-6 w-6 items-center justify-center rounded-full text-text-faint hover:bg-bg-secondary hover:text-text transition-colors"
              >
                <svg
                  width="11"
                  height="11"
                  viewBox="0 0 12 12"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  aria-hidden
                >
                  <path d="M3 3l6 6M9 3l-6 6" />
                </svg>
              </button>
            )}
          </div>
        </div>

        {isActive && (
          <FilterBar
            filters={filters}
            onChange={(patch) =>
              setFilters((prev) => ({ ...prev, ...patch }))
            }
            onReset={() => setFilters(DEFAULT_FILTERS)}
          />
        )}

        {isActive && (
          <p className="text-meta text-text-faint mt-4">
            {isSearching
              ? "searching…"
              : results.length > 0
                ? `${results.length} ${results.length === 1 ? "result" : "results"} for “${normalizedQuery}”`
                : hasSearched
                  ? `no results for “${normalizedQuery}”`
                  : ""}
          </p>
        )}
      </div>

      {isSearching && results.length === 0 && (
        <div className="mx-auto max-w-[820px] mt-4">
          <LoadingSkeleton />
        </div>
      )}

      {results.length > 0 && (
        <div className="mt-6">
          <div className="mx-auto max-w-[820px]">
            <SectionHeading count={results.length}>Papers</SectionHeading>
          </div>
          <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {results.map((result) => (
              <SearchResultCard key={result.id} result={result as never} />
            ))}
          </div>
        </div>
      )}

      {isActive && hasSearched && !isSearching && results.length === 0 && (
        <div className="mx-auto max-w-[820px] mt-6">
          <EmptyState
            title="Nothing turned up."
            description="Try different keywords, or widen the year range and open-access filter."
          />
        </div>
      )}
    </article>
  );
}

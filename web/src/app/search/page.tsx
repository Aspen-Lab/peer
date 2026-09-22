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
import { LoadingSkeleton } from "@/components/ui";
import { PageContainer } from "@/components/ui/page-container";
import { EmptyState } from "@/components/ui/empty-state";
import { COMMAND } from "@/components/ui/command";
import { FilterBar } from "@/components/search/filter-bar";
import { SearchStarts } from "@/components/search/search-starts";
import { readRecent, withRecent, writeRecent } from "@/lib/search/starts";
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
  /** The search itself failed — OpenAlex did not answer. Not the same thing
   *  as a search that answered with nothing, and never shown as one. */
  const [failed, setFailed] = useState(false);

  const debounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  // Monotonic token: a slow older response must never overwrite a newer one.
  const seqRef = useRef(0);
  const inputRef = useRef<HTMLInputElement>(null);

  // The box takes focus on arrival — where there is a pointer. On a phone
  // the arrival is a thumb-bar tap, and focusing would raise the keyboard
  // over the page before the reader has chosen to type; there the box waits
  // to be tapped. Done here rather than with `autoFocus` so the check can
  // read the medium; and on the next frame, because after a client
  // navigation — the global `/`, the masthead's link — Next's layout router
  // focuses the new segment after the commit.
  useEffect(() => {
    if (window.matchMedia("(hover: none)").matches) return;
    const frame = window.requestAnimationFrame(() => inputRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, []);

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
    setFailed(false);
    try {
      const apiParams = filtersToApiQuery(f);
      apiParams.set("q", q);
      apiParams.set("per_page", "12");
      const data = await apiFetch<{ results?: unknown[] }>(
        `/api/papers/search?${apiParams.toString()}`,
      );
      if (requestId !== seqRef.current) return;
      const found = (data.results as SearchResult[]) || [];
      setResults(found);
      // A search that found something is worth offering again. One that
      // found nothing is not remembered — a typo is not a start.
      if (found.length > 0) {
        writeRecent(window.localStorage, withRecent(readRecent(window.localStorage), q));
      }
    } catch {
      if (requestId === seqRef.current) {
        setResults([]);
        setFailed(true);
      }
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
      setFailed(false);
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
    <PageContainer width="shelf">
      <div>
        <header className="mb-6">
          <p className="eyebrow text-text-faint">Search</p>
          {/* Not "the whole record" — OpenAlex is 250M works, and a display
              line that overstates is worse than one that labels. */}
          <h1 className="display-line text-display lg:text-display-lg text-heading leading-[1.05] mt-3">
            Every paper, not just today&rsquo;s.
          </h1>
          <p className="mt-3 text-body-lg text-text-muted measure-ui leading-[1.55]">
            Across OpenAlex — 250M+ academic works. Your daily briefing is
            untouched by anything you do here.
          </p>
        </header>

        {/* The one object the reader came here for, so it is the largest
            thing on the page: the width of the page, display-size type, and
            an accent rule under it while it has focus. It was a body-size
            box at 820px under a headline twice its height — the page read as
            a manifesto with a form field, not as a place to type.

            A field, not floating chrome. `glass` is documented in globals.css
            as "floating chrome only … never on reading surfaces", and this
            page was blurring its own background behind the one object the
            reader came here to type into. */}
        <div className="cropmarks relative bg-surface grain shadow-well transition-[box-shadow] focus-within:shadow-[inset_0_-2px_0_0_var(--color-accent),var(--shadow-well)]">
          <div className="relative">
            <svg
              className="absolute left-5 top-1/2 -translate-y-1/2 text-text-faint pointer-events-none sm:left-6"
              width="20"
              height="20"
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
              ref={inputRef}
              id="peer-search"
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  submit();
                }
              }}
              placeholder="Title, author, venue, concept…"
              aria-label="Search papers"
              className="w-full bg-transparent py-5 pl-13 pr-14 text-title-lg text-text outline-none placeholder:text-text-faint sm:py-6 sm:pl-15 sm:text-display-xs"
            />
            {/* The key that brings the pointer here from anywhere; shown only
                while there is nothing typed, where the clear button will sit. */}
            {query.length === 0 && (
              <span
                aria-hidden
                className="pointer-events-none absolute right-5 top-1/2 hidden -translate-y-1/2 items-center gap-2 sm:inline-flex"
              >
                <kbd className="inline-flex h-6 min-w-6 items-center justify-center px-1.5 font-mono text-caption text-text-faint shadow-[inset_0_0_0_1px_var(--color-border-strong)]">
                  /
                </kbd>
                <span className="annotation text-text-faint">to search from anywhere</span>
              </span>
            )}
            {query.length > 0 && (
              <span
                aria-hidden
                className="pointer-events-none absolute right-14 top-1/2 hidden -translate-y-1/2 items-center gap-2 sm:inline-flex"
              >
                <kbd className="inline-flex h-6 items-center justify-center px-1.5 font-mono text-caption text-text-faint shadow-[inset_0_0_0_1px_var(--color-border-strong)]">
                  ↵
                </kbd>
                <span className="annotation text-text-faint">search now</span>
              </span>
            )}
            {query.length > 0 && (
              <button
                type="button"
                onClick={() => setQuery("")}
                aria-label="Clear search"
                className="absolute right-5 top-1/2 -translate-y-1/2 inline-flex h-7 w-7 items-center justify-center rounded-full text-text-faint hover:bg-bg-secondary hover:text-text transition-colors"
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

        {!isActive && (
          <SearchStarts
            onPick={(q) => {
              setQuery(q);
              inputRef.current?.focus();
            }}
          />
        )}

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
              : failed
                ? "search did not answer"
                : results.length > 0
                  ? `${results.length} ${results.length === 1 ? "result" : "results"} for “${normalizedQuery}”`
                  : hasSearched
                    ? `no results for “${normalizedQuery}”`
                    : ""}
          </p>
        )}
      </div>

      {isSearching && results.length === 0 && (
        <div className="mt-4">
          <LoadingSkeleton count={4} label={null} />
        </div>
      )}

      {results.length > 0 && (
        <div className="mt-6">
          <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4 gap-4">
            {results.map((result) => (
              <SearchResultCard key={result.id} result={result as never} />
            ))}
          </div>
        </div>
      )}

      {isActive && hasSearched && !isSearching && results.length === 0 && !failed && (
        <div className="mt-6 max-w-[820px]">
          <EmptyState
            title="Nothing turned up."
            line="Try different keywords, or widen the year range and open-access filter."
          />
        </div>
      )}

      {/* The index did not answer. Said as that, with the way to ask again —
          this used to read "Nothing turned up", which blames the query for
          the server's afternoon. */}
      {isActive && failed && !isSearching && (
        <div className="mt-6 max-w-[820px]">
          <EmptyState
            title="Search didn't answer."
            line="OpenAlex did not respond. It usually does on the second try."
          />
          <button type="button" className={`${COMMAND} mt-4`} onClick={submit}>
            Try again
          </button>
        </div>
      )}
    </PageContainer>
  );
}

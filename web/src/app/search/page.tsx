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
import Link from "next/link";
import { apiFetch, ApiError } from "@/lib/api";
import { useProfileStore } from "@/store/profile";
import { parseJevApiKey } from "@/lib/decisions/jev-key";
import { SearchResultCard } from "@/components/cards/search-result-card";
import { LoadingSkeleton } from "@/components/ui";
import { PageContainer } from "@/components/ui/page-container";
import { EmptyState } from "@/components/ui/empty-state";
import "./search-design.css";
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
  // A search that never completed is not a search with no results. OpenAlex
  // rate-limits the shared pool (429 → our 502), and that used to render as
  // "no results for …" — the reader would rephrase a query that was fine.
  const [failed, setFailed] = useState(false);
  const jevKey = useProfileStore((s) => s.profile.jevApiKey);
  const [jevStatus, setJevStatus] = useState<"running" | "applied" | "partial" | "unavailable" | "rejected" | "sign-in" | null>(null);

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

  const runSearch = useCallback(async (q: string, f: Filters, key?: string) => {
    if (q.length < 2) {
      seqRef.current++;
      setResults([]);
      return;
    }
    const requestId = ++seqRef.current;
    setIsSearching(true);
    setResults([]);
    setFailed(false);
    setJevStatus(null);
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
      if (key && f.sort === "relevance" && found.length > 0) {
        setIsSearching(false);
        setHasSearched(true);
        setJevStatus("running");
        try {
          const ranked = await apiFetch<{ results: SearchResult[]; jev: { status: "applied" | "partial" | "unavailable" | "rejected" } | null }>("/api/papers/search/jev", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ query: q, filters: filtersToApiQuery(f).toString(), jevApiKey: key }),
          });
          if (requestId !== seqRef.current) return;
          if ((ranked.jev?.status === "applied" || ranked.jev?.status === "partial") && Array.isArray(ranked.results)) {
            setResults(ranked.results);
          }
          setJevStatus(ranked.jev?.status ?? "unavailable");
        } catch (error) {
          if (requestId !== seqRef.current) return;
          setJevStatus(error instanceof ApiError && (error.status === 401 || error.status === 403) ? "sign-in" : "unavailable");
        }
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
    if (isActive && jevStatus !== "running") void runSearch(normalizedQuery, filters, filters.sort === "relevance" ? parseJevApiKey(jevKey) : undefined);
  }, [filters, isActive, normalizedQuery, runSearch, jevKey, jevStatus]);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    setJevStatus(null);
    if (isActive) {
      // Invalidate the previous request as soon as the query or filters change.
      seqRef.current++;
      setResults([]);
      setHasSearched(false);
      setFailed(false);
      setIsSearching(true);
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
    <PageContainer width="shelf" className="search-page">
      <header className="search-heading">
        <div>
          <h1>Search papers</h1>
          <p>Find research by title, topic, author, or journal.</p>
        </div>
        <span className="search-source">{parseJevApiKey(jevKey) ? "OpenAlex · Jev available" : <>OpenAlex · <Link href="/profile#profile-jev-key">Add a Jev key</Link></>}</span>
      </header>

      <form className="search-field" role="search" onSubmit={(event) => { event.preventDefault(); submit(); }}>
        <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="m16.2 16.2 4 4" /></svg>
        <input
          ref={inputRef}
          id="peer-search"
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search papers, topics, or authors"
          aria-label="Search papers"
        />
        {query && <button type="button" className="search-clear" onClick={() => { setQuery(""); inputRef.current?.focus(); }} aria-label="Clear search">×</button>}
        <button className="search-submit" type="submit" disabled={!isActive || jevStatus === "running"}>{parseJevApiKey(jevKey) && filters.sort === "relevance" ? "Search with Jev" : "Search"}</button>
      </form>

      {!isActive && <SearchStarts onPick={(q) => { setQuery(q); inputRef.current?.focus(); }} />}

      {isActive && <div className="search-results-area">
        <FilterBar filters={filters} onChange={(patch) => setFilters((prev) => ({ ...prev, ...patch }))} onReset={() => setFilters(DEFAULT_FILTERS)} />
        <div className="search-results-heading" role="status" aria-live="polite">
          {isSearching ? "Searching…" : results.length > 0 ? `Showing ${results.length} ${results.length === 1 ? "result" : "results"}` : ""}
        </div>
        {parseJevApiKey(jevKey) && filters.sort !== "relevance" && <p className="search-jev-status">Jev ranking is available with relevance sorting.</p>}
        {jevStatus && <p className="search-jev-status" role="status">{({
          running: "Jev is ranking these results…",
          applied: "Ranked with Jev for your search.",
          partial: "Jev ranked the results using the papers it could assess.",
          unavailable: "Jev couldn’t rank these results. Showing OpenAlex order.",
          rejected: "Jev rejected the key. Showing OpenAlex order.",
          "sign-in": "Sign in to use Jev. Showing OpenAlex order.",
        })[jevStatus]}</p>}
        {isSearching && results.length === 0 && <LoadingSkeleton count={4} label={null} />}
        {results.length > 0 && <div className="search-result-list">
          {results.map((result) => <SearchResultCard key={result.id} result={result as never} />)}
        </div>}
        {hasSearched && !isSearching && results.length === 0 && <div className="search-empty">
          {failed ? <EmptyState title="Search is unavailable" line="The paper index didn’t respond. Please try again." actions={<button type="button" className="search-retry" onClick={submit}>Try again</button>} /> : <EmptyState title="No papers found" line="Try different keywords or broaden your filters." />}
        </div>}
      </div>}
    </PageContainer>
  );
}

"use client";

import { useEffect, useRef, useState } from "react";
import type { Filters, SourceType } from "@/lib/search/filters";

const SOURCE_OPTIONS: { value: SourceType; label: string }[] = [
  { value: "arxiv", label: "arXiv / repositories" },
  { value: "journal", label: "Journals" },
  { value: "conference", label: "Conferences" },
];

interface MoreFiltersPanelProps {
  open: boolean;
  filters: Filters;
  onChange: (patch: Partial<Filters>) => void;
}

export function MoreFiltersPanel({
  open,
  filters,
  onChange,
}: MoreFiltersPanelProps) {
  const [venueDraft, setVenueDraft] = useState(filters.venue);
  const [prevExternalVenue, setPrevExternalVenue] = useState(filters.venue);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Re-sync local draft when an external change (e.g. Reset) updates filters.venue.
  if (filters.venue !== prevExternalVenue) {
    setPrevExternalVenue(filters.venue);
    setVenueDraft(filters.venue);
  }

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (venueDraft === filters.venue) return;
    debounceRef.current = setTimeout(() => {
      onChange({ venue: venueDraft });
    }, 300);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [venueDraft, filters.venue, onChange]);

  const toggleSource = (s: SourceType) => {
    const next = filters.sources.includes(s)
      ? filters.sources.filter((x) => x !== s)
      : [...filters.sources, s];
    onChange({ sources: next });
  };

  return (
    <div
      className={[
        "grid transition-[grid-template-rows] duration-[var(--dur-base)] ease-out",
        open ? "grid-rows-[1fr] mt-3" : "grid-rows-[0fr]",
      ].join(" ")}
      aria-hidden={!open}
    >
      <div className="overflow-hidden">
        <div
          className="bg-surface shadow-card rounded-xl p-4 flex flex-col gap-4"
        >
          <div className="flex flex-col gap-2">
            <label className="eyebrow text-text-faint">
              Source type
            </label>
            <div className="flex flex-wrap gap-2">
              {SOURCE_OPTIONS.map(({ value, label }) => {
                const active = filters.sources.includes(value);
                return (
                  <button
                    key={value}
                    type="button"
                    role="checkbox"
                    aria-checked={active}
                    onClick={() => toggleSource(value)}
                    className={[
                      "h-8 px-3.5 rounded-full text-body-sm font-medium transition-colors",
                      active
                        ? "bg-[color:var(--color-accent-dim)] text-[color:var(--color-accent)]"
                        : "bg-[color:var(--color-bg-secondary)] text-text hover:bg-surface-hover",
                    ].join(" ")}
                    tabIndex={open ? 0 : -1}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <label
              htmlFor="peer-filter-venue"
              className="eyebrow text-text-faint"
            >
              Venue contains
            </label>
            <input
              id="peer-filter-venue"
              type="text"
              value={venueDraft}
              onChange={(e) => setVenueDraft(e.target.value)}
              placeholder="Filter by venue name"
              maxLength={80}
              tabIndex={open ? 0 : -1}
              className="w-full bg-[color:var(--color-bg-secondary)] rounded-lg py-2 px-3 text-body-sm text-text placeholder:text-text-faint/70 focus:outline-none focus:ring-2 focus:ring-accent/20"
            />
          </div>
        </div>
      </div>
    </div>
  );
}

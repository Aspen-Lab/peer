"use client";

import { useState } from "react";
import {
  DEFAULT_FILTERS,
  isDefaultFilters,
  type Filters,
  type MinCites,
  type SortKey,
  type YearPreset,
} from "@/lib/search/filters";
import { FilterChip, RadioList } from "./filter-chip";
import { MoreFiltersPanel } from "./more-filters-panel";

interface FilterBarProps {
  filters: Filters;
  onChange: (patch: Partial<Filters>) => void;
  onReset: () => void;
}

const YEAR_PRESETS: { value: YearPreset; label: string }[] = [
  { value: "any", label: "Anytime" },
  { value: "1y", label: "Last year" },
  { value: "5y", label: "Last 5 years" },
  { value: "custom", label: "Custom range…" },
];

const SORT_OPTIONS: { value: SortKey; label: string }[] = [
  { value: "relevance", label: "Relevance" },
  { value: "cited", label: "Most cited" },
  { value: "newest", label: "Newest" },
];

const CITES_OPTIONS: { value: MinCites; label: string }[] = [
  { value: 0, label: "Any" },
  { value: 10, label: "More than 10" },
  { value: 50, label: "More than 50" },
  { value: 100, label: "More than 100" },
];

export function FilterBar({ filters, onChange, onReset }: FilterBarProps) {
  const [moreOpen, setMoreOpen] = useState(
    filters.sources.length > 0 || filters.venue.trim().length > 0,
  );

  const yearActive = filters.year.preset !== "any";
  const yearDisplay = yearLabel(filters);

  const sortActive = filters.sort !== "relevance";
  const sortDisplay = sortActive
    ? SORT_OPTIONS.find((o) => o.value === filters.sort)?.label
    : "Sort";

  const citesActive = filters.minCites > 0;
  const citesDisplay = citesActive ? `>${filters.minCites} cites` : "Citations";

  const moreActive = filters.sources.length > 0 || filters.venue.trim() !== "";
  const moreDisplayParts: string[] = [];
  if (filters.sources.length) moreDisplayParts.push(`${filters.sources.length} source`);
  if (filters.venue.trim()) moreDisplayParts.push(`@${filters.venue.trim()}`);
  const moreDisplay = moreActive
    ? moreDisplayParts.join(" · ")
    : "More filters";

  const showReset = !isDefaultFilters(filters);

  return (
    <div
      className="mt-4"
    >
      <div className="flex items-center flex-wrap gap-2">
        <FilterChip
          label="Year"
          displayValue={yearActive ? yearDisplay : "Year"}
          active={yearActive}
          onClear={() => onChange({ year: { preset: "any" } })}
        >
          {(close) => (
            <YearPanel
              filters={filters}
              onChange={onChange}
              close={close}
            />
          )}
        </FilterChip>

        <FilterChip
          label="Sort"
          displayValue={sortDisplay}
          active={sortActive}
          onClear={() => onChange({ sort: "relevance" })}
        >
          {(close) => (
            <RadioList
              name="sort"
              value={filters.sort}
              options={SORT_OPTIONS}
              onChange={(v) => {
                onChange({ sort: v });
                close();
              }}
            />
          )}
        </FilterChip>

        <FilterChip
          label="Open access"
          displayValue={filters.oa ? "Open access ✓" : "Open access"}
          active={filters.oa}
          onClick={() => onChange({ oa: !filters.oa })}
          ariaLabel={filters.oa ? "Disable open access filter" : "Enable open access filter"}
        />

        <FilterChip
          label="Citations"
          displayValue={citesDisplay}
          active={citesActive}
          onClear={() => onChange({ minCites: 0 })}
        >
          {(close) => (
            <RadioList
              name="cites"
              value={filters.minCites}
              options={CITES_OPTIONS}
              onChange={(v) => {
                onChange({ minCites: v });
                close();
              }}
            />
          )}
        </FilterChip>

        <button
          type="button"
          onClick={() => setMoreOpen((v) => !v)}
          aria-expanded={moreOpen}
          className={[
            "group inline-flex items-center h-10 rounded-full px-4 gap-1.5",
            "text-body-sm font-medium tracking-[-0.005em]",
            "transition-all ease-out active:scale-[0.97]",
            moreActive
              ? "bg-[color:var(--color-accent-dim)] text-[color:var(--color-accent)] shadow-card hover:shadow-card-hover"
              : "bg-surface text-text shadow-card hover:shadow-card-hover hover:-translate-y-[0.5px] hover:text-heading",
          ].join(" ")}
        >
          <span>{moreDisplay}</span>
          <span
            aria-hidden
            className={[
              "inline-block text-micro transition-transform ",
              moreOpen ? "rotate-180" : "",
              moreActive ? "opacity-70" : "opacity-50",
            ].join(" ")}
          >
            ▾
          </span>
        </button>

        {showReset && (
          <button
            type="button"
            onClick={() => {
              onReset();
              setMoreOpen(false);
            }}
            className="ml-1 text-meta text-text-faint hover:text-[color:var(--color-accent)] transition-colors"
          >
            Reset
          </button>
        )}
      </div>

      <MoreFiltersPanel
        open={moreOpen}
        filters={filters}
        onChange={onChange}
      />
    </div>
  );
}

function yearLabel(filters: Filters): string {
  const { preset, from, to } = filters.year;
  switch (preset) {
    case "any":
      return "Year";
    case "1y":
      return "Last year";
    case "5y":
      return "Last 5y";
    case "custom":
      if (from && to) return `${from}–${to}`;
      if (from) return `From ${from}`;
      if (to) return `Until ${to}`;
      return "Custom";
  }
}

interface YearPanelProps {
  filters: Filters;
  onChange: (patch: Partial<Filters>) => void;
  close: () => void;
}

function YearPanel({ filters, onChange, close }: YearPanelProps) {
  const [from, setFrom] = useState<string>(
    filters.year.from ? String(filters.year.from) : "",
  );
  const [to, setTo] = useState<string>(
    filters.year.to ? String(filters.year.to) : "",
  );
  const isCustom = filters.year.preset === "custom";

  const applyCustom = () => {
    const fromN = parseInt(from, 10);
    const toN = parseInt(to, 10);
    const fromOk = Number.isFinite(fromN) && fromN >= 1900 && fromN <= 2100;
    const toOk = Number.isFinite(toN) && toN >= 1900 && toN <= 2100;
    if (!fromOk && !toOk) return;
    onChange({
      year: {
        preset: "custom",
        from: fromOk ? fromN : undefined,
        to: toOk ? toN : undefined,
      },
    });
    close();
  };

  return (
    <div className="flex flex-col gap-3">
      <RadioList
        name="year"
        value={filters.year.preset}
        options={YEAR_PRESETS}
        onChange={(v) => {
          if (v === "custom") {
            onChange({ year: { preset: "custom", from: filters.year.from, to: filters.year.to } });
          } else {
            onChange({ year: { preset: v } });
            close();
          }
        }}
      />
      {isCustom && (
        <div className="flex items-center gap-2 pt-1 border-t border-[color:var(--color-border)]">
          <label className="sr-only" htmlFor="peer-year-from">
            From year
          </label>
          <input
            id="peer-year-from"
            type="number"
            min={1900}
            max={2100}
            placeholder="From"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            className="w-20 bg-[color:var(--color-bg-secondary)] rounded-md py-1.5 px-2 text-body-sm focus:outline-none focus:ring-2 focus:ring-accent/20"
          />
          <span className="text-text-faint">–</span>
          <label className="sr-only" htmlFor="peer-year-to">
            To year
          </label>
          <input
            id="peer-year-to"
            type="number"
            min={1900}
            max={2100}
            placeholder="To"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            className="w-20 bg-[color:var(--color-bg-secondary)] rounded-md py-1.5 px-2 text-body-sm focus:outline-none focus:ring-2 focus:ring-accent/20"
          />
          <button
            type="button"
            onClick={applyCustom}
            className="ml-auto h-7 px-3 rounded-full bg-[color:var(--color-accent)] text-white text-meta font-medium hover:opacity-90"
          >
            Apply
          </button>
        </div>
      )}
    </div>
  );
}

export { DEFAULT_FILTERS };

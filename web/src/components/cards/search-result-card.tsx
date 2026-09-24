"use client";

import Link from "next/link";
import { formatCount, formatDate } from "@/lib/format";
import { cardShell } from "@/components/ui/card-shell";
import { cn } from "@/lib/cn";

interface SearchResult {
  id: string;
  title: string;
  authors: string[];
  abstract: string;
  venue: string;
  sourceType: "journal" | "conference" | "arxiv" | "repository" | null;
  isOpenAccess: boolean;
  publishedDate: string | null;
  citationCount: number;
  doi: string | null;
  url: string;
  source: string;
}

function truncateVenue(v: string, max = 40) {
  if (!v) return "";
  return v.length > max ? v.slice(0, max - 1).trimEnd() + "…" : v;
}

// ── Icons ───────────────────────────────────────────────────

const iconProps = {
  width: 11,
  height: 11,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2.2,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true,
};

const metaIconProps = { ...iconProps, width: 12, height: 12 };

function BookIcon() {
  return (
    <svg {...metaIconProps}>
      <path d="M4 4h12a3 3 0 0 1 3 3v13H7a3 3 0 0 1-3-3V4z" />
      <path d="M4 17a3 3 0 0 1 3-3h12" />
    </svg>
  );
}

function CalendarIcon() {
  return (
    <svg {...metaIconProps}>
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path d="M16 3v4M8 3v4M3 11h18" />
    </svg>
  );
}

function CitationIcon() {
  return (
    <svg {...metaIconProps}>
      <path d="M7 7h4v4H7zm0 6c0 2.5 2 4 4 4M13 7h4v4h-4zm0 6c0 2.5 2 4 4 4" />
    </svg>
  );
}

function LockOpenIcon() {
  return (
    <svg {...iconProps}>
      <rect x="4" y="11" width="16" height="10" rx="2" />
      <path d="M8 11V7a4 4 0 0 1 8 0" />
    </svg>
  );
}

function FileIcon() {
  return (
    <svg {...iconProps}>
      <path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" />
      <path d="M14 3v6h6" />
    </svg>
  );
}

function MicIcon() {
  return (
    <svg {...iconProps}>
      <rect x="9" y="3" width="6" height="12" rx="3" />
      <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
    </svg>
  );
}

function JournalIcon() {
  return (
    <svg {...iconProps}>
      <path d="M5 4h14v16H5z" />
      <path d="M9 8h6M9 12h6M9 16h4" />
    </svg>
  );
}

// ── Source-type badge ───────────────────────────────────────

interface SourceBadgeMeta {
  label: string;
  Icon: () => React.JSX.Element;
  className: string;
}

function sourceBadge(
  type: SearchResult["sourceType"],
): SourceBadgeMeta | null {
  switch (type) {
    case "arxiv":
      return {
        label: "arXiv",
        Icon: FileIcon,
        className: "text-accent bg-accent-dim",
      };
    case "journal":
      return {
        label: "Journal",
        Icon: JournalIcon,
        className: "text-link bg-link-dim",
      };
    case "conference":
      return {
        label: "Conference",
        Icon: MicIcon,
        className: "text-tag bg-tag-dim",
      };
    case "repository":
      return {
        label: "Repository",
        Icon: FileIcon,
        className: "text-text-muted bg-[color:var(--color-bg-secondary)]",
      };
    default:
      return null;
  }
}

// ── Card ────────────────────────────────────────────────────

export function SearchResultCard({ result }: { result: SearchResult }) {
  const badge = sourceBadge(result.sourceType);

  return (
    <Link
      href={`/papers/${encodeURIComponent(result.id)}`}
      className={cn(cardShell({ padding: "md" }), "flex flex-col")}
    >
      {/* Top: type + OA badges */}
      {(badge || result.isOpenAccess) && (
        <div className="flex items-center flex-wrap gap-1.5 mb-3">
          {badge && (
            <span
              className={[
                "eyebrow inline-flex items-center gap-1 px-1.5 py-[3px] rounded",
                badge.className,
              ].join(" ")}
            >
              <badge.Icon />
              {badge.label}
            </span>
          )}
          {result.isOpenAccess && (
            <span className="eyebrow inline-flex items-center gap-1 px-1.5 py-[3px] rounded text-peach bg-peach-dim">
              <LockOpenIcon />
              Open access
            </span>
          )}
        </div>
      )}

      {/* Title */}
      <h3 className="text-lead font-semibold text-heading leading-[1.3] tracking-[-0.005em] line-clamp-3 group-hover:text-[color:var(--color-accent)] transition-colors">
        {result.title}
      </h3>

      {/* Authors */}
      {result.authors.length > 0 && (
        <p className="text-meta text-text-muted mt-2 line-clamp-1">
          {result.authors.slice(0, 3).join(", ")}
          {result.authors.length > 3 && ` +${result.authors.length - 3}`}
        </p>
      )}

      {/* Meta row: venue + date */}
      {(result.venue || result.publishedDate) && (
        <div className="flex items-center flex-wrap gap-x-3 gap-y-1 mt-2.5 text-caption text-text-faint">
          {result.venue && (
            <span className="inline-flex items-center gap-1 min-w-0">
              <BookIcon />
              <span className="truncate max-w-[180px]">
                {truncateVenue(result.venue)}
              </span>
            </span>
          )}
          {result.publishedDate && (
            <span className="inline-flex items-center gap-1 tabular-nums">
              <CalendarIcon />
              {formatDate(result.publishedDate, "monthYear")}
            </span>
          )}
        </div>
      )}

      {/* Abstract */}
      {result.abstract && (
        <p
          className="text-body-sm text-text-muted mt-3 leading-[1.55] line-clamp-3 font-reading"
        >
          {result.abstract}
        </p>
      )}

      <span className="flex-1" aria-hidden />

      {/* Footer metric */}
      {result.citationCount > 0 && (
        <div className="mt-4 pt-3 border-t border-[color:var(--color-border)] flex items-center justify-end">
          <span className="inline-flex items-center gap-1 text-caption text-text-faint tabular-nums">
            <CitationIcon />
            <span className="font-medium text-text-muted">
              {formatCount(result.citationCount)}
            </span>
            <span>{result.citationCount === 1 ? "citation" : "citations"}</span>
          </span>
        </div>
      )}
    </Link>
  );
}

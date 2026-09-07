"use client";

// Title and meta: where and when, the title, who — and, for a paper from
// today's briefing, the one line saying why it is here. The authors line is a
// real button: on a phone it is the tap target for the full list.

import { useState } from "react";
import type { Paper } from "@/types";
import { formatDayAge } from "@/lib/format";
import { shortVenue } from "@/components/cards/paper-plate";
import { AUTHORS } from "./copy";

const COLLAPSED_AUTHORS = 2;
/** Past this the display size stays at 28px on every breakpoint. */
const LONG_TITLE_CHARS = 120;

/**
 * "John M. Jumper" → "J. M. Jumper". A formatting of the record, not a
 * claim about it: a name with no space, or one already written surname-first,
 * is left as it is.
 */
export function initialName(name: string): string {
  const trimmed = name.trim();
  if (trimmed.includes(",")) return trimmed;
  const parts = trimmed.split(/\s+/);
  if (parts.length < 2) return trimmed;
  const surname = parts[parts.length - 1];
  const initials = parts
    .slice(0, -1)
    .map((part) => (/^[A-Za-z]\.$/.test(part) ? part : `${part.charAt(0)}.`))
    .join(" ");
  return `${initials} ${surname}`;
}

function AuthorLine({ authors }: { authors: string[] }) {
  const [expanded, setExpanded] = useState(false);
  const hidden = authors.length - COLLAPSED_AUTHORS;
  const className = "font-sans text-body-sm text-text-muted mt-3";

  if (hidden <= 0) {
    return <p className={className}>{authors.map(initialName).join(", ")}</p>;
  }
  const collapsed = `${authors.slice(0, COLLAPSED_AUTHORS).map(initialName).join(", ")} +${hidden}`;
  // The names stay the accessible name — an `aria-label` would replace them,
  // and a screen reader would never hear an author. The action is a hidden
  // suffix: "A. Jumper, B. Evans +9, Show 9 more".
  return (
    <button
      type="button"
      onClick={() => setExpanded((v) => !v)}
      aria-expanded={expanded}
      className={`${className} block w-full text-left hover:text-heading transition-colors duration-150 ease-snap`}
    >
      {expanded ? authors.join(", ") : collapsed}
      <span className="sr-only">, {expanded ? AUTHORS.showFewer : AUTHORS.showMore(hidden)}</span>
    </button>
  );
}

export function TitleBlock({
  paper,
  recommendation,
  now,
}: {
  paper: Paper;
  /** `relevanceReason`, only for a paper from today's briefing. */
  recommendation: string | null;
  now: number;
}) {
  const meta = [shortVenue(paper.venue), formatDayAge(paper.publishedDate, now)].filter(
    Boolean,
  ) as string[];
  const long = paper.title.length > LONG_TITLE_CHARS;

  return (
    <header>
      {meta.length > 0 && (
        <p className="font-mono text-meta text-text-muted mt-6">{meta.join(" · ")}</p>
      )}
      <h1
        className={`font-display font-medium text-heading tracking-[-0.01em] leading-[1.15] text-display-sm measure-title mt-2${long ? "" : " sm:text-display"}`}
      >
        {paper.title}
      </h1>
      {paper.authors.length > 0 && <AuthorLine authors={paper.authors} />}
      {recommendation && (
        <p className="font-sans text-body-sm text-text-muted mt-1">{recommendation}</p>
      )}
    </header>
  );
}

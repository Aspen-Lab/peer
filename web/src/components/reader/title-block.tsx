"use client";

// Title and meta: where and when, the title, who — and, for a paper from
// today's briefing, the one line saying why it is here. The authors line is a
// real button: on a phone it is the tap target for the full list.

import { useState } from "react";
import type { Paper } from "@/types";
import { formatDayAge } from "@/lib/format";
import { shortVenue } from "@/components/cards/paper-plate";
import { AUTHORS } from "./copy";

/** Names shown before the byline asks to be opened. */
const COLLAPSED_AUTHORS = 3;
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

/**
 * The byline.
 *
 * It used to read "A. Kalisz, J. Simons +5": two names cut to initials, and a
 * bare "+5" that looked like a typo rather than a control. Initials are what
 * you set when the column is 40mm wide and paper costs money — on screen they
 * cost the one thing a byline is for, which is recognising the people. So:
 * the names as they are written, three of them before it asks to be opened,
 * a control that says what it does, and — where the record knows it — where
 * the first author works, which is the line that turns a list of names into a
 * byline.
 *
 * Serif, like the title above it: these are the paper's own words. The mono on
 * this page is Peer talking.
 */
function AuthorLine({ authors, affiliation }: { authors: string[]; affiliation?: string }) {
  const [expanded, setExpanded] = useState(false);
  const hidden = authors.length - COLLAPSED_AUTHORS;
  const className = "font-reading text-body-lg leading-[1.45] text-text mt-3";

  const names =
    hidden <= 0 || expanded ? authors.join(", ") : authors.slice(0, COLLAPSED_AUTHORS).join(", ");

  return (
    <div className="mt-3">
      <p className={`${className} mt-0 measure-lede`}>
        {names}
        {hidden > 0 && (
          <>
            {expanded ? " " : ", "}
            {/* The names stay the accessible name — an `aria-label` on the
                button would replace them and a screen reader would never hear
                an author. */}
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              aria-expanded={expanded}
              className="font-mono text-caption text-text-faint hover:text-heading underline decoration-border-strong underline-offset-4 transition-colors duration-150 ease-snap [@media(hover:none)]:py-3"
            >
              {expanded ? AUTHORS.showFewer : AUTHORS.showMore(hidden)}
            </button>
          </>
        )}
      </p>
      {affiliation && (
        <p className="font-mono text-caption text-text-faint mt-1.5">{affiliation}</p>
      )}
    </div>
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
      {paper.authors.length > 0 && (
        <AuthorLine authors={paper.authors} affiliation={paper.leadAffiliation} />
      )}
      {recommendation && (
        <p className="font-sans text-body-sm text-text-muted mt-1">{recommendation}</p>
      )}
    </header>
  );
}

"use client";

// Title and meta: where and when, the title, who — and, for a paper from
// today's briefing, the one line saying why it is here. The authors line is a
// real button: on a phone it is the tap target for the full list.
//
// P11-16 (B P11-01 §2.3; ruling §1h.113 (a)): from 1024 css px the title stands in the left pane's fixed zone, which never scrolls, and the owner's
// six-line title would take the room the map needs. The page tells the block it is in the pane (`pane`): the title is clamped to four lines, the
// whole of it in `title=` and in the markup, and it is set at the pane's size at every width (the one column's `sm:` step up is for a column).
//
// P11-20 follow-up (ruling §1h.119, item 2a): in the panes the fixed zone holds only what must stay in view while reading — the title (this block),
// the commands, the strip, the report's progress. The paper's bibliographic lines (the venue and its age, the byline with its "and N more", the
// affiliation, and the line saying why a briefing paper is here) are `Bibliography`, the head of the pane's details in the scroll zone, whole at every
// height. In one column the block is what it was, byte for byte.

import { useState, type ReactNode } from "react";
import type { Paper } from "@/types";
import { formatDayAge } from "@/lib/format";
import { shortVenue } from "@/components/cards/paper-plate";
import { AUTHORS } from "./copy";
import { InstitutionPill } from "@/components/institution-pill";

/** Names shown before the byline asks to be opened. */
const COLLAPSED_AUTHORS = 3;
/** Past this the display size stays at 26px on every breakpoint. From xl the
 *  title is in the spread's narrow panel, and every title is set at 26px. */
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
function AuthorLine({ authors, affiliation, institutionId }: { authors: string[]; affiliation?: string; institutionId?: string }) {
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
              className="annotation text-text-faint hover:text-heading underline decoration-border-strong underline-offset-4 transition-colors [@media(hover:none)]:py-3"
            >
              {expanded ? AUTHORS.showFewer : AUTHORS.showMore(hidden)}
            </button>
          </>
        )}
      </p>
      {affiliation && (
        <div className="mt-2"><InstitutionPill name={affiliation} id={institutionId} /></div>
      )}
    </div>
  );
}

/** "Nature Communications · 3d ago": where and when, or null when the record has neither. */
function metaLine(paper: Pick<Paper, "venue" | "publishedDate">, now: number): string | null {
  const meta = [shortVenue(paper.venue), formatDayAge(paper.publishedDate, now)].filter(Boolean) as string[];
  return meta.length > 0 ? meta.join(" · ") : null;
}

/** `relevanceReason`, only for a paper from today's briefing: the one line saying why it is here. */
function Recommendation({ text }: { text: string }) {
  return <p className="font-sans text-body-sm text-text-muted mt-1">{text}</p>;
}

/**
 * P11-20 follow-up (item 2a): what the left pane's fixed zone no longer holds — the venue line, the byline (with its control for the rest) and the
 * affiliation, and the recommendation — as the head of the pane's details, whole at every window height. Nothing for a paper that has none of
 * them (an upload). The one column keeps them in `TitleBlock`.
 */
export function Bibliography({
  paper,
  recommendation = null,
  now,
  access,
}: {
  paper: Pick<Paper, "venue" | "publishedDate" | "authors" | "leadAffiliation" | "leadInstitutionId">;
  recommendation?: string | null;
  now: number;
  access?: ReactNode;
}) {
  const line = metaLine(paper, now);
  if (!line && paper.authors.length === 0 && !paper.leadAffiliation && !recommendation && !access) return null;
  return (
    <div data-pane-bibliography="" className="mt-6">
      <table aria-label="Paper details" className="reader-sidebar-facts"><tbody>
        {line && <tr><th scope="row">Published</th><td>{line}</td></tr>}
        {paper.authors.length > 0 && <tr><th scope="row">Authors</th><td><AuthorLine authors={paper.authors} /></td></tr>}
        {paper.leadAffiliation && <tr><th scope="row">Affiliation</th><td><InstitutionPill name={paper.leadAffiliation} id={paper.leadInstitutionId} /></td></tr>}
        {recommendation && <tr><th scope="row">Relevance</th><td>{recommendation}</td></tr>}
        {access && <tr><th scope="row">Access</th><td>{access}</td></tr>}
      </tbody></table>
    </div>
  );
}

export function TitleBlock({
  paper,
  recommendation,
  now,
  pane = false,
}: {
  paper: Paper;
  /** `relevanceReason`, only for a paper from today's briefing. */
  recommendation: string | null;
  now: number;
  /** The title stands in the three-pane page's left pane (P11-16): four lines at most, the pane's size — and nothing else: the venue, the byline, the
   *  affiliation and the recommendation are `Bibliography`, in the pane's details (P11-20, item 2a). */
  pane?: boolean;
}) {
  const long = paper.title.length > LONG_TITLE_CHARS;

  if (pane) {
    return (
      <header>
        <h1
          className="paper-line text-heading text-display-sm measure-title mt-2 line-clamp-4"
          title={paper.title}
          // The short-window rule of the pane's fixed zone reads this (`globals.css`, P11-17c rule 2): three lines, not four, under 700 css px high.
          data-pane-title=""
        >
          {paper.title}
        </h1>
      </header>
    );
  }

  const line = metaLine(paper, now);
  return (
    <header>
      {line && <p className="annotation text-meta text-text-muted mt-6">{line}</p>}
      <h1
        className={`paper-line text-heading text-display-sm measure-title mt-2${long ? "" : " sm:text-display xl:text-display-sm"}`}
      >
        {paper.title}
      </h1>
      {paper.authors.length > 0 && (
        <AuthorLine authors={paper.authors} affiliation={paper.leadAffiliation} institutionId={paper.leadInstitutionId} />
      )}
      {recommendation && <Recommendation text={recommendation} />}
    </header>
  );
}

"use client";

// The record — the facts about the paper that are true with no key and no
// model, in one place.
//
// They were on the page already, or nearly: the date only as "3w ago", the
// venue only shortened in the meta line, and the paper's other doors — the
// PDF, the authors' code, Scholar — nowhere at all, because the decision
// block opens exactly one of them. A repository nobody can see is the worst
// of those omissions: it is the part of a paper a reader can actually run.
//
// Each row is a fact with its mark. Sentence case, no badges; the icon is
// drawn at the line's own size so it reads as punctuation, not as an object.

import type { Paper } from "@/types";
import { formatDate } from "@/lib/format";
import { shortVenue } from "@/components/cards/paper-plate";
import {
  IconArrowUpRight,
  IconBuilding,
  IconCalendar,
  IconCode,
  IconLink,
  type IconProps,
} from "@/components/icons";
import { RECORD } from "./copy";

type Door = { href: string; label: string; Icon: (p: IconProps) => React.ReactElement };

/** The doors this paper has, minus the one the decision block already opens. */
export function doors(paper: Paper, primaryUrl: string | null): Door[] {
  const seen = new Set<string>(primaryUrl ? [primaryUrl] : []);
  const all: Door[] = [
    paper.linkArxiv && { href: paper.linkArxiv, label: RECORD.arxiv, Icon: IconArrowUpRight },
    paper.linkPaper && { href: paper.linkPaper, label: RECORD.publisher, Icon: IconArrowUpRight },
    paper.linkCode && { href: paper.linkCode, label: RECORD.code, Icon: IconCode },
    paper.linkScholar && { href: paper.linkScholar, label: RECORD.scholar, Icon: IconLink },
  ].filter(Boolean) as Door[];
  return all.filter((door) => {
    if (seen.has(door.href)) return false;
    seen.add(door.href);
    return true;
  });
}

function Row({
  Icon,
  children,
}: {
  Icon: (p: IconProps) => React.ReactElement;
  children: React.ReactNode;
}) {
  return (
    <li className="flex items-baseline gap-2.5">
      <span className="shrink-0 translate-y-px text-text-faint">
        <Icon size={13} />
      </span>
      <span className="min-w-0">{children}</span>
    </li>
  );
}

export function RecordBlock({
  paper,
  primaryUrl,
}: {
  paper: Paper;
  /** The URL the decision block's own button opens, so it is not listed twice. */
  primaryUrl: string | null;
}) {
  const published = formatDate(paper.publishedDate, "medium");
  const venue = shortVenue(paper.venue);
  const links = doors(paper, primaryUrl);
  if (!published && !venue && links.length === 0) return null;

  return (
    <section className="mt-14 border-t border-border pt-6">
      <h2 className="font-display font-medium text-heading text-display-xs leading-[1.25] mb-4">
        {RECORD.heading}
      </h2>
      <ul className="font-sans text-body-sm text-text-muted space-y-2.5 measure-ui">
        {published && (
          <Row Icon={IconCalendar}>
            {RECORD.published} <span className="text-text">{published}</span>
          </Row>
        )}
        {venue && (
          <Row Icon={IconBuilding}>
            <span className="text-text">{venue}</span>
          </Row>
        )}
        {links.length > 0 && (
          <Row Icon={IconLink}>
            <span className="flex flex-wrap gap-x-4 gap-y-1.5">
              {links.map((door) => (
                <a
                  key={door.href}
                  href={door.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-text hover:text-heading underline decoration-border-strong underline-offset-4 transition-colors duration-150 ease-snap [@media(hover:none)]:py-2"
                >
                  {door.label}
                  <door.Icon size={12} />
                </a>
              ))}
            </span>
          </Row>
        )}
      </ul>
    </section>
  );
}

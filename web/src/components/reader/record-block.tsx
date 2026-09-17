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
// Each row is a key and a value. The keys used to be pictures — a calendar, a
// building, a link — and the venue had no key at all, so a 13px building glyph
// was the only thing saying what the string was. `decision-block.tsx` settled
// this one file over: the picture said nothing the word did not. The door
// icons inside the links row stay; those mark where a link goes, which is the
// documented exception.

import type { Paper } from "@/types";
import { formatDate } from "@/lib/format";
import { shortVenue } from "@/components/cards/paper-plate";
import {
  IconArrowUpRight,
  IconCode,
  IconLink,
  type IconProps,
} from "@/components/icons";
import { Band } from "@/components/ui/band";
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

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <li className="grid grid-cols-[5.5rem_minmax(0,1fr)] gap-4">
      <span className="text-text-faint">{label}</span>
      <span className="min-w-0 text-text">{children}</span>
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
    <Band label={RECORD.heading}>
      <ul className="annotation text-text-muted space-y-2.5 measure-ui mt-4">
        {published && (
          <Row label={RECORD.published}>{published}</Row>
        )}
        {venue && (
          <Row label={RECORD.venue}>{venue}</Row>
        )}
        {links.length > 0 && (
          <Row label={RECORD.links}>
            <span className="flex flex-wrap gap-x-4 gap-y-1.5">
              {links.map((door) => (
                <a
                  key={door.href}
                  href={door.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-text hover:text-heading underline decoration-border-strong underline-offset-4 transition-colors [@media(hover:none)]:py-2"
                >
                  {door.label}
                  <door.Icon size={12} />
                </a>
              ))}
            </span>
          </Row>
        )}
      </ul>
    </Band>
  );
}

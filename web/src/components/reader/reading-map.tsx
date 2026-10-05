"use client";

// The reading map (P1-04, ruling §1f.12; blueprint §3.2 ② 图): before
// reading, the paper's shape — its sections in order, what each is for, the
// page it starts on, how long it takes, and, under each, how its paragraphs
// open. Every line is a way into the paper below: a row goes to its section,
// a paragraph line to its paragraph.
//
// The map lists; it never hides or reorders the paper. Its own rows fold
// (the paragraph lines open on request), and on a phone the table folds to
// its summary line — a CSS breakpoint (`sm`, 40rem), no viewport hook, so a
// server render and the first client render agree.

import { useState } from "react";
import type { ReadingMap, ReadingRole } from "@/lib/papers/reading-map";
import { MAP } from "./copy";
import { MathText } from "./math";
import { paragraphAnchor, sectionAnchor } from "./paper-body";

/** How deep the paper says this heading is ("3.2.1" is two levels in) —
 *  the same rule as the contents rail (`paper-contents.tsx`). */
function depthOf(heading: string): number {
  const number = /^(\d+(?:\.\d+)*)\b/.exec(heading.trim());
  return number ? number[1].split(".").length - 1 : 0;
}

function roleLabel(role: ReadingRole): string | null {
  return role === "body" ? null : MAP.roles[role];
}

export function ReadingMapView({
  map,
  openRows = [],
  phoneOpen = false,
}: {
  map: ReadingMap;
  /** Rows whose paragraph lines start open (tests; the page opens none). */
  openRows?: readonly number[];
  /** Whether the table starts shown on a phone (tests; the page: no). */
  phoneOpen?: boolean;
}) {
  const [open, setOpen] = useState<ReadonlySet<number>>(() => new Set(openRows));
  const [shownOnPhone, setShownOnPhone] = useState(phoneOpen);
  if (map.sections.length === 0) return null;

  const toggle = (k: number) =>
    setOpen((current) => {
      const next = new Set(current);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });

  return (
    <section aria-label={MAP.heading} className="mt-6">
      <p className="eyebrow inline-flex items-center gap-2 text-text-faint">
        <span aria-hidden className="block h-[6px] w-[6px] shrink-0 bg-current" />
        {MAP.heading}
      </p>
      <p className="annotation mt-2 flex items-baseline gap-3 text-text-faint">
        <span>{MAP.summary(map.sections.length, map.totalMinutes)}</span>
        <button
          type="button"
          aria-expanded={shownOnPhone}
          onClick={() => setShownOnPhone((shown) => !shown)}
          className="underline-offset-2 transition-colors hover:text-heading hover:underline sm:hidden"
        >
          {shownOnPhone ? MAP.hide : MAP.show}
        </button>
      </p>
      <div className={shownOnPhone ? undefined : "hidden sm:block"}>
        <ol className="mt-2 space-y-1">
          {map.sections.map((row, k) => {
            const lines = row.paragraphs.filter((line) => line.opening !== null);
            const expanded = open.has(k);
            const role = roleLabel(row.role);
            return (
              <li key={row.id} style={{ paddingLeft: `${depthOf(row.heading) * 0.75}rem` }}>
                <div className="flex items-baseline gap-2">
                  {lines.length > 0 ? (
                    <button
                      type="button"
                      aria-expanded={expanded}
                      aria-label={expanded ? MAP.closeLines(row.heading) : MAP.openLines(row.heading)}
                      onClick={() => toggle(k)}
                      className="annotation w-3 shrink-0 text-text-faint transition-colors hover:text-heading"
                    >
                      {expanded ? "−" : "+"}
                    </button>
                  ) : (
                    <span aria-hidden className="w-3 shrink-0" />
                  )}
                  <a
                    href={`#${sectionAnchor(k)}`}
                    className="min-w-0 flex-1 font-reading text-body-sm leading-[1.45] text-text-muted transition-colors hover:text-heading"
                  >
                    <MathText text={row.heading} />
                  </a>
                  {role && <span className="annotation shrink-0 text-text-faint">{role}</span>}
                  {typeof row.page === "number" && (
                    <span className="annotation shrink-0 text-text-faint">{MAP.page(row.page)}</span>
                  )}
                  {row.minutes > 0 && (
                    <span className="annotation shrink-0 text-text-faint">{MAP.minutes(row.minutes)}</span>
                  )}
                </div>
                {expanded && (
                  <ol className="mt-1 mb-2 space-y-1 pl-5">
                    {lines.map((line) => (
                      <li key={line.index}>
                        <a
                          href={`#${paragraphAnchor(k, line.index)}`}
                          className="font-reading text-body-sm leading-[1.45] text-text-faint transition-colors hover:text-heading"
                        >
                          <MathText text={line.opening ?? ""} />
                        </a>
                      </li>
                    ))}
                  </ol>
                )}
              </li>
            );
          })}
        </ol>
      </div>
    </section>
  );
}

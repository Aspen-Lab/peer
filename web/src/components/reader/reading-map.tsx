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
//
// P1-05 (§1f.13): with the reader's questions routed, a row is tinted by how
// its section answers them, titled with the questions ("Q1, Q3"), and states
// the facts beside it — the tier and the terms it mentions, how often; open,
// it shows the sentence that says most, in the paper's own words. A paragraph
// line a question mentions is tinted too. A section no question mentions
// says "not mentioned", which is a fact about the section, not a verdict.
//
// P3-03 (§1h.6; §1a.8): where Peer has written a gist for a paragraph (the
// model's pass, grounded in the paragraph or dropped), it follows the opening on
// the same line — in the label face, labelled `PEERS_READING` (§1f.17) — and wraps
// under the opening when the line is too long. The opening is the paper's words
// and is never replaced, shortened or restyled; a line with no gist is exactly
// what it was, and a gist never makes a row foldable.

import { useState } from "react";
import type { PaperReading } from "@/lib/papers/reading";
import {
  gistRoute,
  routeByQuestions,
  type ReadingMap,
  type ReadingRole,
  type RouteResult,
} from "@/lib/papers/reading-map";
import type { ParagraphGuide } from "@/lib/papers/paragraph-guide";
import { MAP, PEERS_READING, ROUTE } from "./copy";
import { MathText } from "./math";
import {
  ROUTE_TINT,
  markedClass,
  paragraphAnchor,
  routeAsksQuestions,
  sectionAnchor,
  sectionMark,
  type DrawRoute,
} from "./paper-body";

/**
 * The route the page draws (§1f.13): the stored questions through the
 * reading this page holds — or the gist's order when the gist is chosen and
 * no question is typed — or none (no map, or nothing asked). Computed here,
 * in the browser; nothing is sent anywhere.
 */
export function readingRoute(
  reading: Pick<PaperReading, "map" | "body"> | null | undefined,
  asked: { items: readonly string[]; gist: boolean } | undefined,
): RouteResult | undefined {
  const map = reading?.map;
  if (!map || !asked || (asked.items.length === 0 && !asked.gist)) return undefined;
  return asked.gist && asked.items.length === 0 ? gistRoute(map) : routeByQuestions(map, reading.body ?? [], asked.items);
}

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
  route,
  openRows = [],
  phoneOpen = false,
  gists,
}: {
  map: ReadingMap;
  /** The reader's questions routed through the paper (`readingRoute`), with
   *  the report's Tier 2 marks merged over them once there is one. */
  route?: DrawRoute;
  /** Rows whose paragraph lines start open (tests; the page opens none). */
  openRows?: readonly number[];
  /** Whether the table starts shown on a phone (tests; the page: no). */
  phoneOpen?: boolean;
  /** Peer's gist for a paragraph, `gists[sectionId][paragraphIndex]` (P3-03, from
   *  `useParagraphGuide`); absent until there is a guide, and for a paper with none. */
  gists?: ParagraphGuide["gists"];
}) {
  const [open, setOpen] = useState<ReadonlySet<number>>(() => new Set(openRows));
  const [shownOnPhone, setShownOnPhone] = useState(phoneOpen);
  if (map.sections.length === 0) return null;
  // Questions that point somewhere: an unmarked row then says so.
  const asked = routeAsksQuestions(route);

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
            const mark = sectionMark(route, row.id);
            // P2-04b (§1g.15): a background mark Tier 0 found nothing in has no
            // counts to state, so it says what the mark is for, not the bare tier.
            const fact = mark
              ? mark.hits.length > 0
                ? `${ROUTE.tiers[mark.tier]} · ${ROUTE.mentions(mark.hits)}`
                : mark.tier === "background"
                  ? ROUTE.backgroundWhy
                  : ROUTE.tiers[mark.tier]
              : asked
                ? ROUTE.tiers.none
                : null;
            const foldable = lines.length > 0 || Boolean(mark?.evidence);
            return (
              <li key={row.id} style={{ paddingLeft: `${depthOf(row.heading) * 0.75}rem` }}>
                <div
                  data-route={mark?.tier}
                  title={mark?.title}
                  className={markedClass("flex items-baseline gap-2", mark, "-mx-1 px-1")}
                >
                  {foldable ? (
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
                {/* Peer's words: the tier and the counts behind it. */}
                {fact && <p className="annotation pl-5 text-text-faint">{fact}</p>}
                {/* The paper's words: the sentence that says most. */}
                {expanded && mark?.evidence && (
                  <p className="mt-1 pl-5 font-reading italic text-body-sm leading-[1.45] text-text-muted">
                    <MathText text={mark.evidence} />
                  </p>
                )}
                {expanded && lines.length > 0 && (
                  <ol className="mt-1 mb-2 space-y-1 pl-5">
                    {lines.map((line) => {
                      const tier = mark?.paragraphs.get(line.index);
                      const gist = gists?.[row.id]?.[line.index];
                      return (
                        <li key={line.index}>
                          <a
                            href={`#${paragraphAnchor(k, line.index)}`}
                            data-route={tier}
                            // P1-07 (§1f.18 b): on a tint the faint ink is
                            // 2.69:1; the muted ink is ≥ 4.5:1 on every tint.
                            className={[
                              "font-reading text-body-sm leading-[1.45] transition-colors hover:text-heading",
                              ...(tier ? ["text-text-muted", ROUTE_TINT[tier], "box-decoration-clone"] : ["text-text-faint"]),
                            ].join(" ")}
                          >
                            <MathText text={line.opening ?? ""} />
                          </a>
                          {/* Peer's words, after the paper's: the label face and the
                              mark beside it; the opening above is untouched. The
                              spaces are the gist's own (in its face): unlike a margin
                              they do not indent the gist when it wraps to a new line,
                              and they leave the mark a place to break, so it moves
                              under the gist whole rather than breaking inside. */}
                          {typeof gist === "string" && gist !== "" && (
                            <span role="note" aria-label={MAP.gist} className="annotation text-text-muted">
                              {" "}
                              {gist}{" "}
                              <span className="whitespace-nowrap text-text-faint">{PEERS_READING}</span>
                            </span>
                          )}
                        </li>
                      );
                    })}
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

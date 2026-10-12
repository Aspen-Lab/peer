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
//
// P3-05 (§1h.8 (5), O12): the mark `PEERS_READING` is a legend, not a suffix. It was
// printed after every gist — twelve times in one rail — and is now one label-face line
// directly under the map's heading, there only when a gist renders in the map (an open
// row that has one). Each gist keeps its role and accessible name and its label face,
// which already tell Peer's line from the paper's (§1f.17).
//
// P9-51 (F08, N5; the map was described to the owner as giving each section's heading, page, word
// count, minutes and role): a row says its words — `setup · p.2 · 1,234 words · 6 min` — the count its
// minutes come from, the one the summary line adds up. Its meta is one list of parts, each a span with
// the separator it owns (P9-22's rule: a wrap never leaves a line ending on "·"), joined by one plain
// space; the meta may wrap under the heading rather than squeeze it.

import { Fragment, useState } from "react";
import type { PaperReading } from "@/lib/papers/reading";
import {
  gistRoute,
  routeByQuestionsCached,
  type ReadingMap,
  type ReadingMapSection,
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
  // P7-13 (R11b): each question's route is kept, so a keystroke in one of five recomputes one.
  return asked.gist && asked.items.length === 0 ? gistRoute(map) : routeByQuestionsCached(map, reading.body ?? [], asked.items);
}

/** How deep the paper says this heading is ("3.2.1" is two levels in). */
function depthOf(heading: string): number {
  const number = /^(\d+(?:\.\d+)*)\b/.exec(heading.trim());
  return number ? number[1].split(".").length - 1 : 0;
}

function roleLabel(role: ReadingRole): string | null {
  return role === "body" ? null : MAP.roles[role];
}

/**
 * P9-51 (F08): the parts of a row's meta, in order — the role (when Peer could place the heading), the
 * page (a PDF's), the words, the minutes (none for a section with no words, as before). One list, so the
 * separators and the spaces are the same on every row.
 */
function metaParts(row: ReadingMapSection, role: string | null) {
  return [
    ...(role ? [{ name: "role", text: role }] : []),
    ...(typeof row.page === "number" ? [{ name: "page", text: MAP.page(row.page) }] : []),
    { name: "words", text: MAP.words(row.words) },
    ...(row.minutes > 0 ? [{ name: "minutes", text: MAP.minutes(row.minutes) }] : []),
  ];
}

export function ReadingMapView({
  map,
  route,
  openRows = [],
  phoneOpen = false,
  gists,
  source,
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
  /** P7-14 (R5): where the text was read from ("PDF", "arXiv HTML"), for the summary line —
   *  the map is the paper's one contents list, so it says so once. Absent: the line has no
   *  "Read from …" part. */
  source?: string;
}) {
  const [open, setOpen] = useState<ReadonlySet<number>>(() => new Set(openRows));
  const [shownOnPhone, setShownOnPhone] = useState(phoneOpen);
  if (map.sections.length === 0) return null;
  // Questions that point somewhere: an unmarked row then says so.
  const asked = routeAsksQuestions(route);
  // P7-14 (R5): the words the rows add up to — the count the rail and the line under "The paper"
  // used to state (§1f.3: a row's words are the body's own count, so the two agree).
  const totalWords = map.sections.reduce((sum, row) => sum + row.words, 0);

  // A gist renders for a paragraph line of an open row that has one; the legend
  // under the heading is there when at least one does (the lines below use the same test).
  const gistOf = (sectionId: string, index: number): string | undefined => {
    const gist = gists?.[sectionId]?.[index];
    return typeof gist === "string" && gist !== "" ? gist : undefined;
  };
  const gistShown = map.sections.some(
    (row, k) => open.has(k) && row.paragraphs.some((line) => line.opening !== null && gistOf(row.id, line.index) !== undefined),
  );

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
      {/* Peer's words, once: what the gists below are. Folds with the table on a phone,
          where the gists are folded too. */}
      {gistShown && (
        <p className={["annotation mt-1 text-text-faint", shownOnPhone ? "" : "hidden sm:block"].join(" ").trim()}>{PEERS_READING}</p>
      )}
      <p className="annotation mt-2 flex items-baseline gap-3 text-text-faint">
        <span>{MAP.summary(map.sections.length, map.totalMinutes, totalWords, source)}</span>
        <button
          type="button"
          aria-expanded={shownOnPhone}
          onClick={() => setShownOnPhone((shown) => !shown)}
          // P9-05 (X14): at 390 px the summary sentence and this button share one flex line, and the
          // button wrapped to "hide / map". It is a single unbreakable, unshrinkable label; the
          // summary span beside it is what wraps.
          className="shrink-0 whitespace-nowrap underline-offset-2 transition-colors hover:text-heading hover:underline sm:hidden"
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
                  className={markedClass("flex flex-wrap items-baseline gap-x-2", mark, "-mx-1 px-1")}
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
                    className="min-w-0 flex-[1_1_8rem] font-reading text-body-sm leading-[1.45] text-text-muted transition-colors hover:text-heading"
                  >
                    <MathText text={row.heading} />
                  </a>
                  {/* P9-51 (F08): role · page · words · minutes. Each part keeps itself whole and owns the
                      separator that introduces it; the one plain space between two parts is the only place
                      the line may break, so no line ends on "·". The group drops under the heading, right
                      aligned as it was beside it, when the heading would be left too little room. */}
                  <span className="annotation ml-auto min-w-0 max-w-full text-right text-text-faint">
                    {metaParts(row, role).map((part, index) => (
                      <Fragment key={part.name}>
                        {index > 0 ? " " : null}
                        <span data-meta-part={part.name} className="whitespace-nowrap">
                          {index > 0 ? `· ${part.text}` : part.text}
                        </span>
                      </Fragment>
                    ))}
                  </span>
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
                      const gist = gistOf(row.id, line.index);
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
                          {/* Peer's words, after the paper's, in the label face; the
                              opening above is untouched. The mark is the map's legend
                              (above), not repeated here. The space is the gist's own (in
                              its face): unlike a margin it does not indent the gist when
                              it wraps to a new line. */}
                          {gist !== undefined && (
                            <span role="note" aria-label={MAP.gist} className="annotation text-text-muted">
                              {" "}
                              {gist}
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

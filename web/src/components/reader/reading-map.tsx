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
// space; the meta may wrap under the heading rather than squeeze it. And where there is no hover the
// map's toggles — "show map" / "hide map" and each row's fold — are 44 px tall (the P9-23 rule).
//
// P10-04 (review 3.3; A10): the paper's own hierarchy. A row has its `level` (1 for "2.", 2 for "2.1", 3 for
// "2.1.1") and is indented one step per level, in the one list (an inline padding, not a nested table, so the
// keyboard walks the rows in order). A row with no paragraphs of its own that has rows under it is a group
// row ("4. EXPERIMENTAL SECTION · method · p.15 · 1,562 words · 9 min"): its heading, role and page as any
// row's, the sum of its children's words and minutes, no fold, no "not mentioned" (it has no text to
// mention anything in). The summary line counts it as a section and adds the words over the rows that have
// them, so the group's sum is not counted twice. With the map under the tab strip (review 3.1) its links
// follow the page's `reveal`, so a row clicked under "Summary" brings the body in first.
//
// P10-07b (review 3.3, second half; A15; B P10-05 §3): a paper with no headings of its own is divided by the
// model into parts (`partitionedMap`), and the parts are rows here, in the trunk row's place: the part's name
// for a heading, "Peer's reading" in the meta where a headed row reads its role (the part is not a heading the
// paper wrote), the legend line under the heading while one is on screen, the paper's own paragraph lines
// under it. A group row's link goes to its first paragraph, and the lines' links to the trunk's real
// paragraph anchors — the body is untouched, so its anchors are where they were (a row after the trunk is
// the body's section `sectionIndex`, not the map's row number). Gists are looked up under the trunk's id.
// The rows that are open are kept by id, not by position, so a partition arriving after the first paint
// (one row becomes several and everything after it moves) keeps what was open, and gives the parts the
// trunk's openness. The summary line counts the rows it draws (P10-21): the parts of a partition are sections of
// Peer's reading, so "4 sections" stands over four "Peer's reading" rows.
// And a map of one row (no key, or the guide not yet answered) starts open, so a headless paper's map is its
// paragraphs under their one row, not a closed line.

import { Fragment, useMemo, useState } from "react";
import type { PaperReading } from "@/lib/papers/reading";
import {
  gistRoute,
  groupTotals,
  routeByQuestionsCached,
  type ReadingMap,
  type ReadingMapSection,
  type ReadingRole,
  type RouteResult,
} from "@/lib/papers/reading-map";
import type { ParagraphGuide } from "@/lib/papers/paragraph-guide";
import { partOf } from "@/lib/papers/reading-partition";
import { MAP, PEERS_READING, ROUTE } from "./copy";
import { followSectionLink } from "./evidence-quote";
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

/** P10-04: a row's level — the map's own (`level`), or, for a map built before levels, read off the heading. */
function levelOfRow(row: ReadingMapSection): 1 | 2 | 3 {
  return row.level ?? (Math.min(depthOf(row.heading) + 1, 3) as 1 | 2 | 3);
}

/**
 * P10-12 (A15): a gist that only says the line again — the paragraph's own first words, whatever the case or
 * punctuation — adds nothing under it, and read as the line drawn twice (once in the serif, once in the label face).
 * It is not drawn; a gist that says something else is.
 */
function repeatsLine(gist: string, opening: string): boolean {
  const words = (text: string): string => text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
  const said = words(gist);
  const line = words(opening);
  return said !== "" && (line === said || line.startsWith(`${said} `));
}

/**
 * P10-07b: the rows that are open after the map changed (a partition arrived, or went), kept by id. A row of the
 * new map stays open when it was; a group row is open when the trunk it divides was, so the parts of an open row
 * are open; an id the new map no longer has (the trunk's, once it is divided) is let go.
 */
export function carryOpenRows(open: ReadonlySet<string>, map: ReadingMap): Set<string> {
  const next = new Set<string>();
  for (const row of map.sections) {
    const part = partOf(row);
    if (open.has(row.id) || (part !== undefined && open.has(part.sectionId))) next.add(row.id);
  }
  return next;
}

/** P10-07b: each row's place among the body's sections — the `k` of `paper-section-k`. The map's own rows are the
 *  body's sections in order; the parts of a divided trunk are all the trunk's. */
function sectionIndexesOf(map: ReadingMap): number[] {
  let at = -1;
  return map.sections.map((row) => {
    const part = partOf(row);
    at = part ? part.sectionIndex : at + 1;
    return at;
  });
}

/** P10-04: one indent step per level under the first, in rem. */
const INDENT_STEP_REM = 0.75;

function roleLabel(role: ReadingRole): string | null {
  return role === "body" ? null : MAP.roles[role];
}

/** P9-51: the floor a toggle has where there is no hover (P9-23's rule: 44 px tall; with a mouse nothing moves). */
const TOUCH_TALL = "[@media(hover:none)]:min-h-11";
/** P9-51: where there is no hover the row's toggle is the row's tallest item; it is centred against the heading
 *  and the meta beside it, so a row whose meta dropped under the heading is as tall as the floor, not more. */
const TOUCH_CENTER = "[@media(hover:none)]:items-center";

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
  openRows,
  phoneOpen = false,
  gists,
  source,
  reveal,
}: {
  map: ReadingMap;
  /** The reader's questions routed through the paper (`readingRoute`), with
   *  the report's Tier 2 marks merged over them once there is one. */
  route?: DrawRoute;
  /** Rows whose paragraph lines start open, by position (tests; the page opens none of several rows). Absent: a map
   *  of one row starts open, a map of several closed. */
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
  /** P10-04 (review 3.1): the page's way to bring the body in before a jump into it (`useReaderTab`'s
   *  `reveal`). The map stands under both tabs, the body under one; without this a link is the
   *  browser's own anchor, as it was. */
  reveal?: (run: () => void) => void;
}) {
  // P10-07b: the open rows are kept by id (a partition replaces one row by several and moves the rest).
  const [open, setOpen] = useState<ReadonlySet<string>>(
    () => new Set((openRows ?? (map.sections.length === 1 ? [0] : [])).flatMap((k) => (map.sections[k] ? [map.sections[k].id] : []))),
  );
  const [seenMap, setSeenMap] = useState(map);
  if (seenMap !== map) {
    // The map changed under the open set (the partition arrived): carry what was open over, in this render.
    setSeenMap(map);
    setOpen(carryOpenRows(open, map));
  }
  const [shownOnPhone, setShownOnPhone] = useState(phoneOpen);
  // P10-04: what each group row stands for, by its id.
  const groups = useMemo(() => groupTotals(map), [map]);
  const sectionIndexes = useMemo(() => sectionIndexesOf(map), [map]);
  if (map.sections.length === 0) return null;
  // Questions that point somewhere: an unmarked row then says so.
  const asked = routeAsksQuestions(route);
  // P7-14 (R5): the words the rows add up to — the count the rail and the line under "The paper"
  // used to state (§1f.3: a row's words are the body's own count, so the two agree).
  const totalWords = map.sections.reduce((sum, row) => sum + row.words, 0);

  // A gist renders for a paragraph line of an open row that has one; the legend
  // under the heading is there when at least one does (the lines below use the same test).
  // P10-12: not one that only repeats the line it follows (`repeatsLine`).
  const gistOf = (sectionId: string, index: number, opening: string): string | undefined => {
    const gist = gists?.[sectionId]?.[index];
    return typeof gist === "string" && gist !== "" && !repeatsLine(gist, opening) ? gist : undefined;
  };
  // P10-07b: a part's gists are the trunk's (the guide knows the section, not the part).
  const gistKeyOf = (row: ReadingMapSection): string => partOf(row)?.sectionId ?? row.id;
  const gistShown = map.sections.some(
    (row) => open.has(row.id) && row.paragraphs.some((line) => line.opening !== null && gistOf(gistKeyOf(row), line.index, line.opening) !== undefined),
  );
  // P10-07b: the legend is also there while a part of Peer's reading is on screen.
  const partShown = map.sections.some((row) => partOf(row) !== undefined);
  // P10-21 (A P10-14 §8 item 7; round 2's reader 3): the summary counts the rows below it — the partition's groups
  // count as sections (it said "1 section" over four "Peer's reading" rows; P10-07b counted the trunk once).
  const rowCount = map.sections.length;

  const toggle = (id: string) =>
    setOpen((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <section aria-label={MAP.heading} className="mt-6 xl:min-h-0 xl:overflow-y-auto xl:-mx-1.5 xl:px-1.5">
      <p className="eyebrow inline-flex items-center gap-2 text-text-faint">
        <span aria-hidden className="block h-[6px] w-[6px] shrink-0 bg-current" />
        {MAP.heading}
      </p>
      {/* Peer's words, once: what the gists below are. Folds with the table on a phone,
          where the gists are folded too. */}
      {(gistShown || partShown) && (
        <p className={["annotation mt-1 text-text-faint", shownOnPhone ? "" : "hidden sm:block"].join(" ").trim()}>{PEERS_READING}</p>
      )}
      <p className="annotation mt-2 flex items-baseline gap-3 text-text-faint">
        <span>{MAP.summary(rowCount, map.totalMinutes, totalWords, source)}</span>
        <button
          type="button"
          aria-expanded={shownOnPhone}
          onClick={() => setShownOnPhone((shown) => !shown)}
          // P9-05 (X14): at 390 px the summary sentence and this button share one flex line, and the
          // button wrapped to "hide / map". It is a single unbreakable, unshrinkable label; the
          // summary span beside it is what wraps.
          className={`shrink-0 whitespace-nowrap underline-offset-2 transition-colors hover:text-heading hover:underline sm:hidden ${TOUCH_TALL}`}
        >
          {shownOnPhone ? MAP.hide : MAP.show}
        </button>
      </p>
      <div className={shownOnPhone ? undefined : "hidden sm:block"}>
        <ol className="mt-2 space-y-1">
          {map.sections.map((row, k) => {
            const lines = row.paragraphs.filter((line) => line.opening !== null);
            const expanded = open.has(row.id);
            // P10-07b: a part of Peer's reading says so where a headed row says its role; its link, and its
            // lines', are the trunk's real anchors in the body.
            const part = partOf(row);
            const at = sectionIndexes[k];
            const role = part ? MAP.parts.tag : roleLabel(row.role);
            const rowAnchor = part ? paragraphAnchor(at, part.from) : sectionAnchor(at);
            // P10-04: a group row says its children's words and minutes, and has nothing of its own to fold.
            const group = groups.get(row.id);
            const shown = group ? { ...row, ...group } : row;
            const level = levelOfRow(row);
            const mark = sectionMark(route, row.id);
            // P2-04b (§1g.15): a background mark Tier 0 found nothing in has no
            // counts to state, so it says what the mark is for, not the bare tier.
            const fact = group
              ? null
              : mark
              ? mark.hits.length > 0
                ? // P10-06: "strongest · mentions …", "relevant · mentions …", and for the faintest just "mentions …".
                  mark.tier === "faint"
                  ? ROUTE.mentions(mark.hits)
                  : `${ROUTE.tiers[mark.tier]} · ${ROUTE.mentions(mark.hits)}`
                : mark.tier === "background"
                  ? ROUTE.backgroundWhy
                  : ROUTE.tiers[mark.tier]
              : asked
                ? ROUTE.tiers.none
                : null;
            const foldable = !group && (lines.length > 0 || Boolean(mark?.evidence));
            return (
              <li key={row.id} data-level={level} {...(group ? { "data-group": "" } : {})} style={{ paddingLeft: `${(level - 1) * INDENT_STEP_REM}rem` }}>
                <div
                  data-route={mark?.tier}
                  title={mark?.title}
                  className={markedClass(`flex items-baseline gap-2 ${TOUCH_CENTER}`, mark, "-mx-1 px-1")}
                >
                  {foldable ? (
                    <button
                      type="button"
                      aria-expanded={expanded}
                      aria-label={expanded ? MAP.closeLines(row.heading) : MAP.openLines(row.heading)}
                      onClick={() => toggle(row.id)}
                      className={`annotation w-3 shrink-0 text-text-faint transition-colors hover:text-heading ${TOUCH_TALL}`}
                    >
                      {expanded ? "−" : "+"}
                    </button>
                  ) : (
                    <span aria-hidden className="w-3 shrink-0" />
                  )}
                  {/* The heading and its meta are one group: it is what wraps (the meta drops under the
                      heading when the heading would be left too little room), beside the fold toggle. */}
                  <div className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-2">
                    <a
                      href={`#${rowAnchor}`}
                      onClick={(event) => followSectionLink(event, rowAnchor, reveal)}
                      className="min-w-0 flex-[1_1_14rem] font-reading text-body-sm leading-[1.45] text-text-muted transition-colors hover:text-heading"
                    >
                      <MathText text={row.heading} />
                    </a>
                    {/* P9-51 (F08): role · page · words · minutes. Each part keeps itself whole and owns the
                        separator that introduces it; the one plain space between two parts is the only place
                        the line may break, so no line ends on "·". The group drops under the heading, right
                        aligned as it was beside it, when the heading would be left too little room. */}
                    <span className="annotation ml-auto min-w-0 max-w-full text-right text-text-faint">
                      {metaParts(shown, role).map((part, index) => (
                        <Fragment key={part.name}>
                          {index > 0 ? " " : null}
                          <span data-meta-part={part.name} className="whitespace-nowrap">
                            {index > 0 ? `· ${part.text}` : part.text}
                          </span>
                        </Fragment>
                      ))}
                    </span>
                  </div>
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
                      const gist = gistOf(gistKeyOf(row), line.index, line.opening ?? "");
                      return (
                        <li key={line.index}>
                          <a
                            href={`#${paragraphAnchor(at, line.index)}`}
                            onClick={(event) => followSectionLink(event, paragraphAnchor(at, line.index), reveal)}
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

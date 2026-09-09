"use client";

// The day, at a glance — one mark per paper, in the order the page lists
// them, as tall as it matches you.
//
// The brief's summary was one sentence: "Ten papers on diffusion models and
// protein structure prediction — ten unread." True, and it cannot say the
// thing that decides how long you spend here. A real day looks like this:
//
//     0.89  0.89  0.68  0.67  0.66  0.65  0.64  0.64  0.58  0.53
//
// Two papers that genuinely match, a flat middle of six that only roughly
// do, and a tail. That shape is where you stop reading, and it is invisible
// in a list where every row is the same height.
//
// Peer's own number, the one that already put the papers in this order, so
// the strip explains the order rather than adding a second opinion to it.
//
// Not a topic chart: the concepts the sources hand over are arXiv filing
// codes ("cs.LG") and OpenAlex categories that land off-domain often enough
// to matter, and a chart of those would be confident nonsense. This is built
// only from numbers Peer computed itself.
//
// Bars are zero-based against the day's best. A bar chart that starts
// anywhere else is the oldest lie in the genre.

import type { Paper } from "@/types";
import { formatDayAge } from "@/lib/format";
import { DAY_STRIP } from "@/lib/briefing/copy";

/** Below this there is no shape to see, only ceremony. */
const MIN_PAPERS = 4;
/**
 * A chart, not a band. Stretched across the board's full width the bars were
 * 124px wide and 34px tall, and ten of them in the accent read as a solid
 * orange rule under the deck — decoration, which is the one thing this
 * interface does not do. At 12px on a 52px baseline the same ten numbers are
 * a shape you can read in one look, and it sits beside the sentence instead
 * of underlining it.
 */
const BAR_W = 12;
const BAR_GAP = 3;
const HEIGHT = 52;
/** A bar this short still has to be visible as "there is a paper here". */
const MIN_BAR = 4;

export function DayStrip({
  papers,
  readIds,
  now,
}: {
  papers: Paper[];
  /** Read papers are spent: the hue is for what is still waiting. */
  readIds: Record<string, true>;
  now: number;
}) {
  const scored = papers.filter((p) => typeof p.relevanceScore === "number");
  if (papers.length < MIN_PAPERS || scored.length < papers.length) return null;

  const best = Math.max(...scored.map((p) => p.relevanceScore ?? 0));
  if (best <= 0) return null;

  const anyRead = papers.some((p) => readIds[p.id]);

  return (
    <figure className="mt-6">
      <div className="flex items-end" style={{ height: HEIGHT, gap: BAR_GAP }}>
        {papers.map((paper) => {
          const score = paper.relevanceScore ?? 0;
          const read = Boolean(readIds[paper.id]);
          return (
            <a
              key={paper.id}
              href={`#paper-${paper.id}`}
              // The whole column is the target, so a 6px bar is still
              // clickable; only the bar is painted.
              // The column is the hit target, wider than the bar it paints.
              className="group relative flex h-full items-end"
              style={{ width: BAR_W }}
              title={`${paper.title} — ${formatDayAge(paper.publishedDate, now)}`}
            >
              <span
                aria-hidden
                // Neutral, not the accent: in this palette the hue is a
                // signal, and how well a paper matches is data. Read papers
                // drop to the hairline tone — spent, still counted.
                className={`block w-full transition-colors duration-150 ease-snap ${
                  read
                    ? "bg-border-strong group-hover:bg-text-faint"
                    : "bg-text-muted group-hover:bg-heading"
                }`}
                style={{ height: `${Math.max(MIN_BAR, Math.round((score / best) * HEIGHT))}px` }}
              />
              <span className="sr-only">{paper.title}</span>
            </a>
          );
        })}
      </div>
      <figcaption className="font-mono text-caption text-text-faint mt-2">
        {DAY_STRIP.caption}
        {anyRead && <span className="ml-2">{DAY_STRIP.readKey}</span>}
      </figcaption>
    </figure>
  );
}

"use client";

// The paper's contents, in the panel beside it.
//
// The panel holds the plate, the title and the decision, and under them — on
// a paper Peer has read in full — it held nothing: a column of air beside a
// column of text. This is what belongs there. It says what Peer reached (the
// sections, in the paper's own order, and where they came from), and every
// line of it is a place to jump to, which is what a contents page is for.
//
// Only on the spread. Below it the page is one column and the same list is
// printed at the head of the paper's own block, where it reads as a contents
// strip rather than a rail.

import type { PaperReading } from "@/lib/papers/reading";
import { BODY } from "./copy";
import { sectionAnchor } from "./paper-body";

function countWords(reading: PaperReading): number {
  let words = 0;
  for (const section of reading.body ?? []) {
    for (const paragraph of section.paragraphs) words += paragraph.split(/\s+/).length;
  }
  return words;
}

/** How deep the paper says this heading is: "3.2.1" is two levels in,
 *  "Discussion" is at the top. */
function depthOf(heading: string): number {
  const number = /^(\d+(?:\.\d+)*)\b/.exec(heading.trim());
  return number ? number[1].split(".").length - 1 : 0;
}

export function PaperContents({ reading }: { reading: PaperReading }) {
  const body = reading.body ?? [];
  if (body.length === 0) return null;

  return (
    <nav aria-label={BODY.heading} className="mt-8 hidden xl:block">
      <p className="eyebrow inline-flex items-center gap-2 text-text-faint">
        <span aria-hidden className="block h-[6px] w-[6px] shrink-0 bg-current" />
        {BODY.heading}
      </p>
      <p className="annotation mt-2 text-text-faint">
        {BODY.provenance(reading.provenance.sourceLabel, body.length, countWords(reading))}
      </p>
      {/* A rail, not a page: at thirty sections it scrolls rather than
          pushing the decision off the panel. */}
      <ol className="mt-3 max-h-[min(26rem,calc(100vh-24rem))] space-y-1 overflow-auto pr-1">
        {body.map((section, i) => (
          <li
            key={`${section.canonical}:${section.heading}`}
            // The paper numbers its own sections; the depth of that number is
            // the indent. No counter of Peer's own beside it — "4 · 3.1
            // Encoder" reads as two conflicting numberings.
            style={{ paddingLeft: `${depthOf(section.heading) * 0.75}rem` }}
          >
            <a
              href={`#${sectionAnchor(i)}`}
              className="font-reading text-body-sm leading-[1.45] text-text-muted transition-colors hover:text-heading"
            >
              {section.heading}
            </a>
          </li>
        ))}
      </ol>
    </nav>
  );
}

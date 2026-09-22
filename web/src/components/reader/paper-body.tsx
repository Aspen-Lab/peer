"use client";

// The paper itself.
//
// Until now the reading page showed one figure, the abstract, and eight
// sentences quoted out of the full text — and then sent the reader to the
// publisher to actually read the thing. The extractor had the whole document
// the entire time: `getFullText` returns every section, and `buildReading`
// took its eight sentences and dropped the rest. This renders what was being
// thrown away.
//
// It sits last, under everything Peer has to say about the paper, because the
// order of this page is decide-then-read: the claim, the abstract, the
// blocks, and then — if you are still here — the paper. The contents strip is
// the section list, which is also the honest statement of how much of the
// paper Peer reached.
//
// The paper's own words, so: the reading serif, at the long measure. The headings
// are the paper's too, so they are serif as well — the mono on this page is
// Peer's voice, and none of this is Peer's.

import type { PaperReading, ReadingSection } from "@/lib/papers/reading";
import { Band } from "@/components/ui/band";
import { BODY } from "./copy";

function countWords(body: ReadingSection[]): number {
  let words = 0;
  for (const section of body) {
    for (const paragraph of section.paragraphs) {
      words += paragraph.split(/\s+/).length;
    }
  }
  return words;
}

/** Each section is a destination: the contents rail beside the page jumps
 *  here, and `scroll-mt` keeps the heading clear of the sticky masthead. */
export function sectionAnchor(index: number): string {
  return `paper-section-${index}`;
}

function Section({ section, index }: { section: ReadingSection; index: number }) {
  return (
    <section id={sectionAnchor(index)} className="mt-8 scroll-mt-20 first:mt-6">
      <h3 className="font-reading font-medium text-heading text-title leading-[1.3] mb-2">
        {section.heading}
      </h3>
      <div className="font-reading text-title leading-[1.65] text-text-muted measure-paper space-y-4">
        {section.paragraphs.map((paragraph, i) => (
          <p key={i}>{paragraph}</p>
        ))}
      </div>
    </section>
  );
}

/** The anchor the decision block's "read it here" scrolls to. */
export const PAPER_BODY_ID = "paper-body";

export function PaperBody({ reading }: { reading: PaperReading }) {
  // `?? []`: the version gate above should mean this is always an array, and
  // a missing optional block is still not worth taking the page down for.
  const body = reading.body ?? [];
  if (body.length === 0) return null;

  const words = countWords(body);

  return (
    // `scroll-mt`: the masthead is sticky, and a heading scrolled to the
    // very top of the window lands under it.
    <div id={PAPER_BODY_ID} className="scroll-mt-20">
    <Band label={BODY.heading}>
      {/* The contents: the sections Peer reached, in the paper's own order.
          It doubles as the statement of what it did not reach — a paper whose
          extractor found four headings says so here and nowhere else. */}
      <p className="annotation text-text-faint mt-4 measure-mono xl:hidden">
        {body.map((section) => section.heading).join(" · ")}
      </p>
      <p className="annotation text-text-faint mt-1.5">
        {BODY.provenance(reading.provenance.sourceLabel, body.length, words)}
      </p>

      {body.map((section, i) => (
        <Section key={`${section.canonical}:${section.heading}`} section={section} index={i} />
      ))}
    </Band>
    </div>
  );
}

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
// The paper's own words, so: the reading serif, at the measure. The headings
// are the paper's too, so they are serif as well — the mono on this page is
// Peer's voice, and none of this is Peer's.

import { useState } from "react";
import type { PaperReading, ReadingSection } from "@/lib/papers/reading";
import { Band } from "@/components/ui/band";
import { IconArrowRight } from "@/components/icons";
import { BODY } from "./copy";

/** Below this a paper is short enough that hiding it would be the ceremony. */
const ALWAYS_OPEN_WORDS = 900;

function countWords(body: ReadingSection[]): number {
  let words = 0;
  for (const section of body) {
    for (const paragraph of section.paragraphs) {
      words += paragraph.split(/\s+/).length;
    }
  }
  return words;
}

function Section({ section }: { section: ReadingSection }) {
  return (
    <section className="mt-8 first:mt-6">
      <h3 className="font-reading font-medium text-heading text-title leading-[1.3] mb-2">
        {section.heading}
      </h3>
      <div className="font-reading text-lead leading-[1.6] text-text-muted measure space-y-3">
        {section.paragraphs.map((paragraph, i) => (
          <p key={i}>{paragraph}</p>
        ))}
      </div>
    </section>
  );
}

export function PaperBody({ reading }: { reading: PaperReading }) {
  // `?? []`: the version gate above should mean this is always an array, and
  // a missing optional block is still not worth taking the page down for.
  const body = reading.body ?? [];
  const [open, setOpen] = useState(false);
  if (body.length === 0) return null;

  const words = countWords(body);
  const shown = words <= ALWAYS_OPEN_WORDS || open;

  return (
    <Band label={BODY.heading} className="mt-14">
      {/* The contents: the sections Peer reached, in the paper's own order.
          It doubles as the statement of what it did not reach — a paper whose
          extractor found four headings says so here and nowhere else. */}
      <p className="font-mono text-caption text-text-faint mt-4 measure-ui">
        {body.map((section) => section.heading).join(" · ")}
      </p>
      <p className="font-mono text-caption text-text-faint mt-1.5">
        {BODY.provenance(reading.provenance.sourceLabel, body.length, words)}
      </p>

      {shown ? (
        body.map((section) => <Section key={`${section.canonical}:${section.heading}`} section={section} />)
      ) : (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="group inline-flex items-center gap-1.5 font-mono text-body-sm text-text-muted mt-5 hover:text-heading transition-colors duration-150 ease-snap [@media(hover:none)]:min-h-11"
        >
          {BODY.open}
          <span className="transition-transform duration-150 ease-snap group-hover:translate-x-0.5 motion-reduce:transition-none">
            <IconArrowRight size={13} />
          </span>
        </button>
      )}
    </Band>
  );
}

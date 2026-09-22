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

import { useState } from "react";
import type { PaperReading, ReadingFigure, ReadingSection } from "@/lib/papers/reading";
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

/**
 * The paper's figure, where the paper put it.
 *
 * The picture on the plate's mat, the caption under it in the record's mono
 * — the paper's picture, Peer's filing of it. A picture that does not arrive
 * (a PDF figure drawn as vector art has no raster to serve; a publisher's
 * host may refuse the request) leaves the caption standing on its own, with
 * the page it is on where the source was a PDF, so the reader knows what
 * they are not seeing and where it is.
 */
function Figure({ figure }: { figure: ReadingFigure }) {
  const [failed, setFailed] = useState(false);
  const showImage = Boolean(figure.imageUrl) && !failed;
  return (
    <figure className="my-6">
      {showImage && (
        <div className="bg-[var(--plate-mat)] p-3 sm:p-4">
          {/* A plain img: the picture lives on the source's host (or on our
              own figure route), and `next/image` would need every host
              listed in advance. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={figure.imageUrl}
            alt={figure.caption}
            loading="lazy"
            decoding="async"
            referrerPolicy="no-referrer"
            onError={() => setFailed(true)}
            className="mx-auto block h-auto max-h-[32rem] w-auto max-w-full object-contain"
          />
        </div>
      )}
      <figcaption className="annotation mt-2 leading-[1.6] text-text-faint measure-mono">
        <span className="text-text-muted">{figure.label}</span>
        {figure.caption ? ` \u00b7 ${figure.caption}` : ""}
        {!showImage && typeof figure.page === "number" ? ` \u00b7 p.${figure.page} of the PDF` : ""}
      </figcaption>
    </figure>
  );
}

function Section({ section, index }: { section: ReadingSection; index: number }) {
  const figures = section.figures ?? [];
  const before = figures.filter((f) => f.after < 0);
  return (
    <section id={sectionAnchor(index)} className="mt-8 scroll-mt-20 first:mt-6">
      <h3 className="font-reading font-medium text-heading text-title leading-[1.3] mb-2">
        {section.heading}
      </h3>
      <div className="font-reading text-title leading-[1.65] text-text-muted measure-paper space-y-4">
        {before.map((f) => (
          <Figure key={`${f.label}:${f.ordinal}`} figure={f} />
        ))}
        {section.paragraphs.map((paragraph, i) => (
          <div key={i} className="space-y-4">
            <p>{paragraph}</p>
            {figures
              .filter((f) => f.after === i)
              .map((f) => (
                <Figure key={`${f.label}:${f.ordinal}`} figure={f} />
              ))}
          </div>
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

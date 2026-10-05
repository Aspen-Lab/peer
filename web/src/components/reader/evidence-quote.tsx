"use client";

// The receipt under a model claim: the paper's sentence, verbatim, with
// where it came from. Italic and a step smaller than the claim, indented,
// no rule, no box, no quote glyph — the attribution is the mark.
//
// P1-04 (§1f.12): "§Heading" is a link to that section of the paper on this
// page — the first body section with the same heading — and plain text when
// none has it (the abstract, a heading the body does not carry, or a page
// that renders no body). The page provides the body's headings through
// `SectionLinks`, so the lists that render quotes need no new prop.

import { createContext, useContext, type ReactNode } from "react";
import { attribution } from "./copy";
import { sectionAnchor } from "./paper-body";

const SectionHeadings = createContext<readonly string[] | null>(null);

export function SectionLinks({ headings, children }: { headings: readonly string[]; children?: ReactNode }) {
  return <SectionHeadings.Provider value={headings}>{children}</SectionHeadings.Provider>;
}

/** The anchor of the first body section headed `where`, or null. */
export function sectionHref(where: string, headings: readonly string[]): string | null {
  const wanted = where.trim();
  if (!wanted || wanted === "abstract") return null;
  const index = headings.findIndex((heading) => heading.trim() === wanted);
  return index >= 0 ? `#${sectionAnchor(index)}` : null;
}

export function EvidenceQuote({ text, where }: { text: string; where: string }) {
  const headings = useContext(SectionHeadings);
  const href = headings ? sectionHref(where, headings) : null;
  return (
    <p className="font-reading italic text-body leading-[1.55] text-text-muted pl-5 mt-1.5 reading-justify">
      {text}
      <span className="font-mono not-italic text-meta text-text-faint ml-2">
        — {href ? (
          <a href={href} className="underline-offset-2 transition-colors hover:text-heading hover:underline">
            {attribution(where)}
          </a>
        ) : (
          attribution(where)
        )}
      </span>
    </p>
  );
}

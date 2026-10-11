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

import { createContext, useContext, useMemo, type ReactNode } from "react";
import { MAP, attribution } from "./copy";
import { sectionAnchor } from "./paper-body";

interface SectionLinkContext {
  headings: readonly string[];
  reveal?: (run: () => void) => void;
}

const SectionHeadings = createContext<SectionLinkContext | null>(null);

/**
 * `reveal` (P7-14, R10): on a full-text paper the body is under "Paper digestion" and not mounted
 * under "Summary", where most of these links are; the page hands in its way to switch tabs and
 * run a jump once the body is on the page (`useReaderTab`'s `reveal`). Without it a link is the
 * browser's own anchor, as it was.
 */
export function SectionLinks({
  headings,
  reveal,
  children,
}: {
  headings: readonly string[];
  reveal?: (run: () => void) => void;
  children?: ReactNode;
}) {
  const value = useMemo(() => ({ headings, reveal }), [headings, reveal]);
  return <SectionHeadings.Provider value={value}>{children}</SectionHeadings.Provider>;
}

/**
 * The click on a "§Heading" link. With the section on the page it is left to the browser's anchor
 * jump. With it not on the page — the body is under the other tab — the dead anchor is stopped, and
 * the page's `reveal` brings the body in and then scrolls to the section.
 */
export function followSectionLink(
  event: { preventDefault: () => void },
  id: string,
  reveal: ((run: () => void) => void) | undefined,
  find: (id: string) => { scrollIntoView: (options?: ScrollIntoViewOptions) => void } | null = (target) =>
    document.getElementById(target),
): void {
  if (!reveal || find(id)) return;
  event.preventDefault();
  reveal(() => find(id)?.scrollIntoView({ behavior: "smooth", block: "start" }));
}

/** The anchor of the first body section headed `where`, or null. */
export function sectionHref(where: string, headings: readonly string[]): string | null {
  const wanted = where.trim();
  if (!wanted || wanted === "abstract") return null;
  const index = headings.findIndex((heading) => heading.trim() === wanted);
  return index >= 0 ? `#${sectionAnchor(index)}` : null;
}

/** An attribution's text, as a link to the section headed `where` when the
 *  page's body has one (P1-04), else as it was. P1-05 (the §1f.13
 *  amendment): the Tier 0 quotes and the skim's quoted evidence use it too. */
export function SectionAttribution({ where, children }: { where: string; children: ReactNode }) {
  const links = useContext(SectionHeadings);
  const href = links ? sectionHref(where, links.headings) : null;
  if (!links || !href) return <>{children}</>;
  return (
    <a
      href={href}
      onClick={(event) => followSectionLink(event, href.slice(1), links.reveal)}
      className="underline-offset-2 transition-colors hover:text-heading hover:underline"
    >
      {children}
    </a>
  );
}

/** `page` (P2-04b, §1g.15): where the sentence sits in a PDF, when it is known,
 *  as " · p.N" inside the attribution after the section link. `where` stays
 *  the bare heading, so `sectionHref` keeps matching it. Callers without a
 *  page are unchanged. */
export function EvidenceQuote({ text, where, page }: { text: string; where: string; page?: number }) {
  return (
    <p className="font-reading italic text-body leading-[1.55] text-text-muted pl-5 mt-1.5 reading-justify">
      {text}
      <span className="font-mono not-italic text-meta text-text-faint ml-2">
        — <SectionAttribution where={where}>{attribution(where)}</SectionAttribution>
        {typeof page === "number" && ` · ${MAP.page(page)}`}
      </span>
    </p>
  );
}

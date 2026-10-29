"use client";

// The paper's words: the abstract as written, in its two paragraphs, with
// the claim and the numbers set in ink. Nothing here is Peer's — the marks
// choose emphasis, they add no word. With a model, Peer's skim sits above
// as a deck and the ink moves to the sentences that are its evidence, so the
// abstract is never repeated under a claim.

import type { ReactNode, Ref } from "react";
import type { Claim, PaperReportBasis } from "@/lib/papers/report";
import type { PaperReading } from "@/lib/papers/reading";
import { pickClaimMark } from "@/lib/papers/skim";
import { ScrambleText } from "@/components/scramble-text";
import { BlockMarks } from "@/components/notes/block-marks";
import { AbstractToggle } from "./abstract-toggle";
import { SECTION_GAP } from "@/components/ui/band";
import { SectionAttribution } from "./evidence-quote";
import { LeadClaim } from "./lead-claim";
import { ABSTRACT_FOOTER, TLDR_LINE, attribution, skimFooter } from "./copy";

const FOOTER_CLASS = "annotation text-text-faint mt-2";

/** The room kept above a block the notes' blue square scrolls to: the masthead is 48 px and sticky, and a body paragraph keeps 80 (`scroll-mt-20`). No layout. */
const SCROLL_GAP = "scroll-mt-20";

/**
 * P11-17b (rule 3; C P11-14's defect (c), second half): the Summary's blocks have stable, unique ids. A note taken on a Summary selection is
 * anchored by the id the selection reports for its block (`block.id || container.id || kind`, `paper-body.tsx`), and the notes' blue square scrolls
 * to the element with that id and flashes it. The page's Summary containers (`data-explain-source="summary"`) have no id of their own and no box
 * (`contents`), so each block carries its own. Constants, never positions: the Summary is regenerated, and an id built from a count would name another
 * block next time. They all begin with `summary-` (`SUMMARY_ID_PREFIX` in `note-tags.tsx`), which is how the square knows to bring the Summary tab back.
 * The first four are this file's own blocks; the rest are the report's, which the page wraps (`SummaryBlock`).
 */
export const SUMMARY_ID = {
  skim: "summary-skim",
  claim: "summary-claim",
  abstract: "summary-abstract",
  tldr: "summary-tldr",
  newHere: "summary-new-here",
  proposal: "summary-proposal",
  method: "summary-method",
  results: "summary-results",
  forYou: "summary-for-you",
  glance: "summary-glance",
  related: "summary-related",
  caveats: "summary-caveats",
  nextStep: "summary-next-step",
  record: "summary-record",
  library: "summary-library",
} as const;

/**
 * A block of the Summary under its id: a plain element around what the block draws, and nothing at all around nothing (a block the page does not
 * draw leaves no empty element). A block's own margins collapse through it, so the page lays out as it did — with one exception the caller owns: the
 * centre column drops the top gap of the first block it opens with (`reader-layout.tsx`: `[&>:first-child>:first-child>:first-child]:mt-0`), which is
 * the block's own element, and with this around it is this element. A block that can open the column (the lead claim, the abstract's toggle: a paper
 * with no body) therefore hands its top gap to this element (`className`), so the column's rule drops it as it did.
 * P11-28 (ruling §1h.123 (c)): the block draws the marks of the highlights anchored to it (`BlockMarks`, which renders nothing: the markup is what it was).
 */
export function SummaryBlock({ id, className, children }: { id: string; className?: string; children?: ReactNode }) {
  return children ? (
    <div id={id} className={className ? `${className} ${SCROLL_GAP}` : SCROLL_GAP}>
      {children}
      <BlockMarks id={id} />
    </div>
  ) : null;
}

function Paragraph({
  sentences,
  from,
  inked,
}: {
  sentences: string[];
  from: number;
  inked: Set<number>;
}) {
  return (
    <p>
      {sentences.map((sentence, offset) => {
        const index = from + offset;
        const space = offset > 0 ? " " : "";
        return inked.has(index) ? (
          <span key={index}>
            {space}
            <mark className="bg-transparent text-heading font-medium">{sentence}</mark>
          </span>
        ) : (
          <span key={index}>
            {space}
            {sentence}
          </span>
        );
      })}
    </p>
  );
}

/**
 * Peer's skim above the abstract. A skim sentence whose evidence is an
 * abstract sentence is answered by the ink below; one whose evidence is a
 * section sentence names the section.
 */
function Deck({
  skim,
  basis,
  quoted,
  scramble,
}: {
  skim: Claim[];
  basis: PaperReportBasis;
  /** Skim claims whose evidence is not in the abstract. */
  quoted: Claim[];
  /** S5: true while this report is scrambling into place. */
  scramble?: boolean;
}) {
  const skimLine = skim.map((claim) => claim.text).join(" ");
  return (
    <div
      id={SUMMARY_ID.skim}
      className={`${SCROLL_GAP} animate-fade-in-up`}
      style={{ "--i": 0 } as React.CSSProperties}
    >
      {scramble ? (
        <ScrambleText
          text={skimLine}
          className="font-reading text-title-lg leading-[1.45] text-heading measure-paper mt-12 sm:mt-16 block"
        />
      ) : (
        <p className="font-reading text-title-lg leading-[1.45] text-heading measure-paper mt-12 sm:mt-16">
          {skimLine}
        </p>
      )}
      {quoted.map((claim, i) => (
        // Keyed by position: two skim lines may cite the same sentence.
        <p
          key={`${i}:${claim.evidence}`}
          className="font-reading italic text-body leading-[1.55] text-text-muted pl-5 mt-1.5 reading-justify"
        >
          {claim.evidence}
          <span className="font-mono not-italic text-meta text-text-faint ml-2">
            {/* P1-05 (§1f.13 amendment): "§Heading" goes to that section. */}
            — <SectionAttribution where={claim.evidenceWhere ?? "abstract"}>
              {attribution(claim.evidenceWhere ?? "abstract")}
            </SectionAttribution>
          </span>
        </p>
      ))}
      <p className={FOOTER_CLASS}>{skimFooter(basis)}</p>
      <BlockMarks id={SUMMARY_ID.skim} />
    </div>
  );
}

export function PaperWords({
  endRef,
  reading,
  marks,
  skim,
  basis,
  quotedSkim,
  scramble,
}: {
  /** The words' last line — the footer under the abstract (or the TL;DR).
   *  On the spread the decided-read observer watches this, not the
   *  decision, which is on screen at open there. */
  endRef?: Ref<HTMLParagraphElement>;
  reading: PaperReading;
  /** Sentence indices set in ink — the reading's own, or the model's evidence. */
  marks: number[];
  skim: Claim[];
  basis: PaperReportBasis | null;
  quotedSkim: Claim[];
  /** S5: true while the report the skim deck came from is scrambling into place. */
  scramble?: boolean;
}) {
  const { sentences, introCount } = reading.abstract;
  // With a model, the deck above is the claim and the ink below is its
  // evidence. With no model there was no deck at all, and the column opened
  // on eleven lines of one size — so Tier 0 lifts the paper's own claim into
  // the deck's place. Either way exactly one thing on the page is loud, and
  // the sentence that is loud is not also inked underneath it.
  const lead = skim.length > 0 ? null : pickClaimMark(sentences);
  const inked = new Set(marks.filter((index) => index !== lead));
  const split = Math.min(Math.max(introCount, 0), sentences.length);

  if (sentences.length === 0) {
    const tldr = reading.provenance.tldr;
    if (!tldr) return null;
    return (
      <div id={SUMMARY_ID.tldr} className={SCROLL_GAP}>
        <p className="font-reading text-lead leading-[1.6] text-text-muted measure-paper mt-10 reading-justify">
          {tldr}
        </p>
        <p ref={endRef} className={FOOTER_CLASS}>
          {TLDR_LINE}
        </p>
        <BlockMarks id={SUMMARY_ID.tldr} />
      </div>
    );
  }

  return (
    <>
      {skim.length > 0 && basis && (
        <Deck skim={skim} basis={basis} quoted={quotedSkim} scramble={scramble} />
      )}
      {lead !== null && (
        // The band's own gap above it (`SECTION_GAP`) moves to the element around it: the column's first-block rule reaches that element.
        <SummaryBlock id={SUMMARY_ID.claim} className={`${SECTION_GAP} [&>section]:mt-0`}>
          <LeadClaim sentence={sentences[lead]} />
        </SummaryBlock>
      )}
      <SummaryBlock id={SUMMARY_ID.abstract} className="mt-12">
        <AbstractToggle defaultOpen={lead === null && skim.length === 0}>
          <div className="reader-abstract-prose font-reading text-lead leading-[1.6] text-text-muted measure-paper mt-4 space-y-4 reading-justify">
            {split > 0 && <Paragraph sentences={sentences.slice(0, split)} from={0} inked={inked} />}
            {split < sentences.length && (
              <Paragraph sentences={sentences.slice(split)} from={split} inked={inked} />
            )}
          </div>
          <p ref={endRef} className={FOOTER_CLASS}>
            {ABSTRACT_FOOTER}
          </p>
        </AbstractToggle>
      </SummaryBlock>
    </>
  );
}

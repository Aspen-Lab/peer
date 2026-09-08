"use client";

// The paper's words: the abstract as written, in its two paragraphs, with
// the claim and the numbers set in ink. Nothing here is Peer's — the marks
// choose emphasis, they add no word. With a model, Peer's skim sits above
// as a deck and the ink moves to the sentences that are its evidence, so the
// abstract is never repeated under a claim.

import type { Ref } from "react";
import type { Claim, PaperReportBasis } from "@/lib/papers/report";
import type { PaperReading } from "@/lib/papers/reading";
import { pickClaimMark } from "@/lib/papers/skim";
import { Band } from "@/components/ui/band";
import { LeadClaim } from "./lead-claim";
import { ABSTRACT_FOOTER, ABSTRACT_LABEL, TLDR_LINE, attribution, skimFooter } from "./copy";

const FOOTER_CLASS = "font-mono text-caption text-text-faint mt-2";

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
}: {
  skim: Claim[];
  basis: PaperReportBasis;
  /** Skim claims whose evidence is not in the abstract. */
  quoted: Claim[];
}) {
  return (
    <div
      className="animate-fade-in-up"
      style={{ "--i": 0 } as React.CSSProperties}
    >
      <p className="font-reading text-title-lg leading-[1.45] text-heading measure mt-10">
        {skim.map((claim) => claim.text).join(" ")}
      </p>
      {quoted.map((claim, i) => (
        // Keyed by position: two skim lines may cite the same sentence.
        <p
          key={`${i}:${claim.evidence}`}
          className="font-reading italic text-body leading-[1.55] text-text-muted pl-5 mt-1.5"
        >
          {claim.evidence}
          <span className="font-mono not-italic text-meta text-text-faint ml-2">
            — {attribution(claim.evidenceWhere ?? "abstract")}
          </span>
        </p>
      ))}
      <p className={FOOTER_CLASS}>{skimFooter(basis)}</p>
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
      <div>
        <p className="font-reading text-lead leading-[1.6] text-text-muted measure mt-10">
          {tldr}
        </p>
        <p ref={endRef} className={FOOTER_CLASS}>
          {TLDR_LINE}
        </p>
      </div>
    );
  }

  return (
    <>
      {skim.length > 0 && basis && <Deck skim={skim} basis={basis} quoted={quotedSkim} />}
      {lead !== null && (
        <LeadClaim sentence={sentences[lead]} />
      )}
      <Band label={ABSTRACT_LABEL} className="mt-12">
        <div className="font-reading text-lead leading-[1.6] text-text-muted measure mt-4 space-y-4">
          {split > 0 && <Paragraph sentences={sentences.slice(0, split)} from={0} inked={inked} />}
          {split < sentences.length && (
            <Paragraph sentences={sentences.slice(split)} from={split} inked={inked} />
          )}
        </div>
        <p ref={endRef} className={FOOTER_CLASS}>
          {ABSTRACT_FOOTER}
        </p>
      </Band>
    </>
  );
}

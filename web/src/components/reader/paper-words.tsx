"use client";

// The paper's words: the abstract as written, in its two paragraphs, with
// the claim and the numbers set in ink. Nothing here is Peer's — the marks
// choose emphasis, they add no word. With a model, Peer's skim sits above
// as a deck and the ink moves to the sentences that are its evidence, so the
// abstract is never repeated under a claim.

import type { Claim, PaperReportBasis } from "@/lib/papers/report";
import type { PaperReading } from "@/lib/papers/reading";
import { ABSTRACT_FOOTER, TLDR_LINE, attribution, skimFooter } from "./copy";

const FOOTER_CLASS = "font-sans text-meta text-text-faint mt-2";

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
      <p className="font-reading text-[18px] leading-[1.5] text-heading max-w-[62ch] mt-10">
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
  reading,
  marks,
  skim,
  basis,
  quotedSkim,
}: {
  reading: PaperReading;
  /** Sentence indices set in ink — the reading's own, or the model's evidence. */
  marks: number[];
  skim: Claim[];
  basis: PaperReportBasis | null;
  quotedSkim: Claim[];
}) {
  const { sentences, introCount } = reading.abstract;
  const inked = new Set(marks);
  const split = Math.min(Math.max(introCount, 0), sentences.length);

  if (sentences.length === 0) {
    const tldr = reading.provenance.tldr;
    if (!tldr) return null;
    return (
      <div>
        <p className="font-reading text-lead leading-[1.6] text-text-muted max-w-[66ch] mt-10">
          {tldr}
        </p>
        <p className={FOOTER_CLASS}>{TLDR_LINE}</p>
      </div>
    );
  }

  return (
    <>
      {skim.length > 0 && basis && <Deck skim={skim} basis={basis} quoted={quotedSkim} />}
      <div className="font-reading text-lead leading-[1.6] text-text-muted max-w-[66ch] mt-10 space-y-4">
        {split > 0 && <Paragraph sentences={sentences.slice(0, split)} from={0} inked={inked} />}
        {split < sentences.length && (
          <Paragraph sentences={sentences.slice(split)} from={split} inked={inked} />
        )}
      </div>
      <p className={FOOTER_CLASS}>{ABSTRACT_FOOTER}</p>
    </>
  );
}

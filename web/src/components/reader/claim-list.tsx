"use client";

// Model claims with their receipts. Every claim here survived
// `verifyReportEvidence`, so each carries one verbatim sentence: when that
// sentence is one of the abstract's, it is set in ink up in the paper's words
// (`placeEvidence`) and nothing is repeated here; when it is a section
// sentence, it is quoted under the claim with its heading. A key result's
// bound figure sits under its result on the mat.

import type { Claim, PaperReportKeyResult } from "@/lib/papers/report";
import { placeEvidence } from "@/lib/papers/evidence";
import { BlockHeading, type BlockName } from "./block-heading";
import { EvidenceQuote } from "./evidence-quote";
import { MattedFigure } from "./matted-figure";
import { projectAnchor } from "./copy";

const CLAIM_CLASS = "font-reading text-lead leading-[1.6] text-text";

function Receipt({
  claim,
  abstractSentences,
}: {
  claim: Pick<Claim, "evidence" | "evidenceWhere">;
  abstractSentences: string[];
}) {
  // An abstract sentence is answered by the ink above, not repeated.
  if (placeEvidence(claim.evidence, abstractSentences).kind === "mark") return null;
  return <EvidenceQuote text={claim.evidence} where={claim.evidenceWhere ?? "abstract"} />;
}

export function ClaimList({
  block,
  claims,
  abstractSentences,
  stagger,
  anchor,
}: {
  block: BlockName;
  claims: Claim[];
  abstractSentences: string[];
  stagger: number;
  /** The relation block's `basedOn`, shown faint above the claims. */
  anchor?: string;
}) {
  if (claims.length === 0) return null;
  return (
    <section
      className="animate-fade-in-up"
      style={{ "--i": stagger } as React.CSSProperties}
    >
      <BlockHeading block={block} />
      {anchor && (
        <p className="font-sans text-meta text-text-faint mb-3">{projectAnchor(anchor)}</p>
      )}
      {/* The abstract's measure, so the column has one right edge. */}
      <div className="space-y-4 measure">
        {claims.map((claim, i) => (
          // Keyed by position: a model can write the same sentence twice.
          <div key={`${i}:${claim.text}`}>
            <p className={CLAIM_CLASS}>{claim.text}</p>
            <Receipt claim={claim} abstractSentences={abstractSentences} />
          </div>
        ))}
      </div>
    </section>
  );
}

export function KeyResultList({
  results,
  abstractSentences,
  stagger,
  /** Image URLs already on the page (the plate's bound figure), not repeated. */
  shownFigures,
}: {
  results: PaperReportKeyResult[];
  abstractSentences: string[];
  stagger: number;
  shownFigures: Set<string>;
}) {
  if (results.length === 0) return null;
  const seen = new Set(shownFigures);
  return (
    <section
      className="animate-fade-in-up"
      style={{ "--i": stagger } as React.CSSProperties}
    >
      <BlockHeading block="findings" />
      <div className="space-y-4 measure">
        {results.map((result, i) => {
          const figure =
            result.figureImageUrl && !seen.has(result.figureImageUrl)
              ? result.figureImageUrl
              : null;
          if (figure) seen.add(figure);
          return (
            <div key={`${i}:${result.title}`}>
              <p className={CLAIM_CLASS}>
                <b className="font-medium text-heading">{result.title}.</b> {result.detail}
              </p>
              <Receipt claim={result} abstractSentences={abstractSentences} />
              {figure && <MattedFigure src={figure} caption={result.figureCaption} />}
            </div>
          );
        })}
      </div>
    </section>
  );
}

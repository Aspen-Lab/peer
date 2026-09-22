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

// The family, the size and the leading now come from the `reading-prose`
// wrapper. Not cosmetic: `measure-paper` is 34em and em is the element's OWN
// font-size, so on a bare <div> that em was body's 17px — 476px against the
// abstract's 462px, fourteen pixels of disagreement down a scroll, on a page
// whose comments twice promise one right edge.
const CLAIM_CLASS = "text-text";

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
  anchor,
}: {
  block: BlockName;
  claims: Claim[];
  abstractSentences: string[];
  /** The relation block's `basedOn`, shown faint above the claims. */
  anchor?: string;
}) {
  if (claims.length === 0) return null;
  return (
    // The host is the section, not the band inside it: this block's content
    // is a SIBLING of its heading, so the outer section owns the group.
    //
    // This REPLACES `animate-fade-in-up` rather than joining it — an element
    // must never carry both; the reveal wins on specificity and the class
    // would silently do nothing. The mount fade fired when the model's report
    // landed, ~900px below the fold while the reader is still on the
    // abstract, so by the time anyone got here it was long over. The observer
    // fires immediately for a block already in view, so it covers the arrival
    // case too — one trigger, not two. `--i` went with it: 0/40/80/120ms
    // across blocks separated by a 64px gap never rendered a visible frame.
    <section data-reveal>
      <BlockHeading block={block} className="rv" />
      {anchor && (
        <p className="rv rv-late font-sans text-meta text-text-faint mb-3">{projectAnchor(anchor)}</p>
      )}
      {/* The abstract's measure, so the column has one right edge. Five
          claims are ONE `.rv`: prose does not stagger against itself. */}
      <div className="rv rv-late reading-prose space-y-4 measure-paper">
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
  /** Image URLs already on the page (the plate's bound figure), not repeated. */
  shownFigures,
}: {
  results: PaperReportKeyResult[];
  abstractSentences: string[];
  shownFigures: Set<string>;
}) {
  if (results.length === 0) return null;
  const seen = new Set(shownFigures);
  return (
    <section data-reveal>
      <BlockHeading block="findings" className="rv" />
      <div className="rv rv-late reading-prose space-y-4 measure-paper">
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

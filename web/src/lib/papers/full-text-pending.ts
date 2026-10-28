// P12-58 (rule 2): "the full text has not settled yet" is a value of the reading's provenance,
// distinct from "none".
//
// `provenance.fullText` says what Peer read the reading from. "none" is a settled fact: the
// attempt finished and there is no text to show for the paper (a paper with no open full text, a
// source that gave nothing). It used to be the value of the other case too, when the reading route
// had waited its eight seconds, answered with the abstract alone and left the extraction running:
// the page could not tell the two apart, so it said what it says of a settled "none" ("No abstract
// is published where Peer can read it") and never asked again — for a PDF the reader had uploaded
// a moment before (A P12-44, D1).
//
// "pending" is that other case. It means: the attempt is still running (or failed in a way that
// is a fact about the moment, not about the paper), the reading is the abstract alone, and a later
// ask may well find the sections. It is never kept — not by the browser's cache (`use-reading.ts`
// keeps nothing for it), not by a shared one (the route answers it `no-store`, and a private
// reading is always `private, no-store`) — and it is never what a settled attempt produces:
// `buildReading` does not make it; the route does, from `markFullTextPending`, when its wait
// ended before the attempt did.
//
// The union in `reading.ts` (`ReadingProvenance["fullText"]`) does not list this value yet: that
// file is outside this change. The two functions below are the only places that spell the value
// and that cross the gap in the type, so adding `| "pending"` there lets the casts go and
// nothing else change. Every other reader of `provenance.fullText` compares for the values it
// knows ("pdf", "html", "paywalled", ...) and treats any other as the abstract alone, which is
// what a pending reading is.

import type { PaperReading } from "./reading";

/** The provenance value for a full text that has not settled. */
export const FULL_TEXT_PENDING = "pending";

/** `reading` (built from the abstract alone) with its provenance saying the full text is pending. */
export function markFullTextPending(reading: PaperReading): PaperReading {
  return {
    ...reading,
    provenance: { ...reading.provenance, fullText: FULL_TEXT_PENDING as unknown as PaperReading["provenance"]["fullText"] },
  };
}

/** Whether `reading` is the abstract-only answer of a full text that has not settled. */
export function isFullTextPending(reading: Pick<PaperReading, "provenance"> | null | undefined): boolean {
  return (reading?.provenance?.fullText as string | undefined) === FULL_TEXT_PENDING;
}

// Evidence verification — the check that keeps a model report honest.
//
// Every claim in a `PaperReport` carries one `evidence` sentence the model
// says it copied character-for-character from the text it was given. Models
// paraphrase, tidy punctuation, drop a citation bracket or swap a ligature,
// so the test is a forgiving substring match over a normalised corpus. A
// claim whose sentence is not found is dropped — never flagged, never shown
// with a warning — and the drop is counted so the page can say how many.
//
// Pure: no I/O, importable on the client (`placeEvidence` runs there to turn
// an abstract quote into an ink mark instead of a repeated line).

import { cleanDisplayText } from "@/lib/text/clean";
import type { ExtractedDocument } from "./html-text";
import type { Claim, PaperReport, PaperReportKeyResult } from "./report";

/**
 * Shortest quote worth trusting. Below this a match says nothing — "we show
 * that" is in every abstract. Do not lower it; see the spec's risk list.
 */
const MIN_QUOTE_CHARS = 40;
/** Partial-match window: the quote's head and tail must both be present. */
const PREFIX_CHARS = 80;
const SUFFIX_CHARS = 40;

/**
 * Inline citation markers: `[12]`, `[3-5]`, `[1, 2]`, `[3–5]`. Runs after the
 * dash fold so every dash shape inside the bracket is a plain hyphen.
 */
const CITATION_BRACKETS = /\s*\[\d+(?:\s*[-,]\s*\d+)*\]/g;

/**
 * Normalise for matching only — never for display. `cleanDisplayText` first,
 * so a quote that went through the sanitizer and a raw section text land in
 * the same alphabet (it already folds entities, mojibake, `×`, `±`, sub- and
 * superscripts). Then NFKC (ligatures `ﬁ` → `fi`), curly → straight quotes,
 * every dash → `-`, soft hyphens gone, citation brackets gone, lowercase,
 * whitespace collapsed.
 */
export function normalizeForMatch(s: string): string {
  return cleanDisplayText(s)
    .normalize("NFKC")
    .replace(/[‘’‚‛]/g, "'")
    .replace(/[“”„‟]/g, '"')
    .replace(/[‐‑‒–—―−]/g, "-")
    .replace(/\u00AD/g, "")
    .replace(CITATION_BRACKETS, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/** Match already-normalised strings; the exported check normalises first. */
function supportedIn(quote: string, corpus: string): boolean {
  if (quote.length < MIN_QUOTE_CHARS) return false;
  if (corpus.includes(quote)) return true;
  // A model that drops a mid-sentence citation, a math token or an inline
  // reference still copied the sentence; ask for its head and its tail.
  if (quote.length <= PREFIX_CHARS) return false;
  return (
    corpus.includes(quote.slice(0, PREFIX_CHARS)) &&
    corpus.includes(quote.slice(-SUFFIX_CHARS))
  );
}

/**
 * True when `quote` (≥ 40 chars after normalisation) appears in `corpus`
 * whole, or — for a quote longer than 80 chars — when its first 80 and last
 * 40 characters both appear.
 */
export function evidenceSupported(quote: string, corpus: string): boolean {
  return supportedIn(normalizeForMatch(quote), normalizeForMatch(corpus));
}

interface CorpusEntry {
  where: string;
  text: string;
}

/**
 * The abstract first (so an abstract sentence that also opens the HTML body
 * is attributed `"abstract"`), then every section under its own heading,
 * numbering kept, exactly as the page will print it.
 */
function buildCorpus(corpus: { abstract: string; doc?: ExtractedDocument }): CorpusEntry[] {
  const entries: CorpusEntry[] = [];
  const abstract = normalizeForMatch(corpus.abstract);
  if (abstract) entries.push({ where: "abstract", text: abstract });
  for (const section of corpus.doc?.sections ?? []) {
    const text = normalizeForMatch(section.text);
    if (!text) continue;
    entries.push({ where: section.heading.trim() || section.canonical, text });
  }
  return entries;
}

function locate(evidence: string, entries: CorpusEntry[]): string | null {
  const quote = normalizeForMatch(evidence);
  for (const entry of entries) {
    if (supportedIn(quote, entry.text)) return entry.where;
  }
  return null;
}

/**
 * Drop — never flag — every skim sentence, method, key result, limitation,
 * relation item or next step whose evidence is not in the corpus; set
 * `evidenceWhere` on the survivors; count the drops into
 * `provenance.droppedClaims`. Tier 1 passes the abstract alone; Tier 2 passes
 * the extracted document as well.
 */
export function verifyReportEvidence(
  report: PaperReport,
  corpus: { abstract: string; doc?: ExtractedDocument },
): { report: PaperReport; dropped: number } {
  const entries = buildCorpus(corpus);
  let dropped = 0;

  const keepClaim = <T extends Claim | PaperReportKeyResult>(item: T): T | null => {
    const where = locate(item.evidence, entries);
    if (!where) {
      dropped += 1;
      return null;
    }
    return { ...item, evidenceWhere: where };
  };
  const keepAll = <T extends Claim | PaperReportKeyResult>(items: T[]): T[] =>
    items.map(keepClaim).filter((item): item is T => item !== null);

  const verified: PaperReport = {
    ...report,
    skim: keepAll(report.skim),
    whatItProposes: {
      ...report.whatItProposes,
      methods: keepAll(report.whatItProposes.methods),
    },
    resultsAndSignificance: {
      ...report.resultsAndSignificance,
      keyResults: keepAll(report.resultsAndSignificance.keyResults),
    },
  };

  if (report.limitations) verified.limitations = keepAll(report.limitations);

  if (report.relationToYourWork) {
    const items = keepAll(report.relationToYourWork.items);
    // A relation block that lost every item is absent, not an empty heading.
    if (items.length > 0) {
      verified.relationToYourWork = { ...report.relationToYourWork, items };
    } else {
      delete verified.relationToYourWork;
    }
  }

  if (report.nextStep) {
    const kept = keepClaim(report.nextStep);
    if (kept) verified.nextStep = kept;
    else delete verified.nextStep;
  }

  verified.provenance = { ...report.provenance, droppedClaims: dropped };
  return { report: verified, dropped };
}

/**
 * Client side: an evidence sentence that is one of the abstract's sentences
 * becomes an ink mark on that sentence; anything else is printed as a quote.
 * A sentence counts when it contains the evidence or the evidence contains
 * it (a model may quote a fragment, or run two sentences together).
 */
export function placeEvidence(
  evidence: string,
  abstractSentences: string[],
): { kind: "mark"; index: number } | { kind: "quote" } {
  const quote = normalizeForMatch(evidence);
  if (quote.length < MIN_QUOTE_CHARS) return { kind: "quote" };
  for (let index = 0; index < abstractSentences.length; index += 1) {
    const sentence = normalizeForMatch(abstractSentences[index]);
    if (sentence.length < MIN_QUOTE_CHARS) continue;
    if (sentence.includes(quote) || quote.includes(sentence)) {
      return { kind: "mark", index };
    }
  }
  return { kind: "quote" };
}

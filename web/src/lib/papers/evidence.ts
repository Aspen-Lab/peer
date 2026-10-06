// Evidence verification — the check that keeps a model report honest.
//
// Every claim in a `PaperReport` carries one `evidence` sentence the model
// says it copied character-for-character from the text it was given. Models
// paraphrase, tidy punctuation, drop a citation bracket or swap a ligature,
// so the test is a substring match over a normalised corpus: the WHOLE
// normalised quote must sit in one section, nothing less (P2-08b, §1g.16 —
// a rule that compared only a long quote's head and tail let a reversed
// clause through as the paper's own words). The normalisation is the only
// leniency: case, whitespace, ligatures, quotes, dashes, hyphen breaks, and
// bracketed citations (`[12]`, `(Smith et al., 2020)`) are folded on both
// sides. A claim whose sentence is not found is dropped — never flagged,
// never shown with a warning — and the drop is counted so the page can say
// how many.
//
// Pure: no I/O, importable on the client (`placeEvidence` runs there to turn
// an abstract quote into an ink mark instead of a repeated line).

import { cleanDisplayText } from "@/lib/text/clean";
import type { ExtractedDocument } from "./html-text";
import type { Claim, PaperReport, PaperReportKeyResult, PaperTerm, QuestionAnswers } from "./report";

/**
 * Shortest quote worth trusting. Below this a match says nothing — "we show
 * that" is in every abstract. Do not lower it; see the spec's risk list.
 */
const MIN_QUOTE_CHARS = 40;

/**
 * Inline citation markers: `[12]`, `[3-5]`, `[1, 2]`, `[3–5]`. Runs after the
 * dash fold so every dash shape inside the bracket is a plain hyphen.
 */
const CITATION_BRACKETS = /\s*\[\d+(?:\s*[-,]\s*\d+)*\]/g;

/**
 * Bracketed author-year citations (P2-08b, §1g.16): `(Smith et al., 2020)`,
 * `(Smith and Jones, 2019; Lee, 2021a)`, `(Smith & Lee 2020)`, `(Müller, 2018)`.
 * The one other leniency, beside `[12]`, the whole-quote rule keeps: an
 * extractor that strips them and a model that keeps them (or the reverse)
 * still agree once both sides fold them. An author's name starts with a
 * capital, so `(2020)`, `(Figure 3a)`, `(n = 12)`, `(see Smith, 2020)`,
 * `(Smith, 2020, p. 5)` and a narrative "Smith et al. (2020)" are left alone.
 * Runs on the same side of the lower-casing as the bracket fold and is linear.
 */
const AUTHOR = "[A-Z][\\p{L}'-]*(?:\\s+et\\s+al\\.?|\\s+(?:and|&)\\s+[A-Z][\\p{L}'-]*)?";
const AUTHOR_YEAR = `${AUTHOR},?\\s+(?:19|20)\\d\\d[a-z]?`;
const AUTHOR_YEAR_CITATIONS = new RegExp(`\\s*\\(${AUTHOR_YEAR}(?:\\s*;\\s*${AUTHOR_YEAR})*\\)`, "gu");

/**
 * `/` (ASCII slash) and `⁄` (U+2044, FRACTION SLASH). PyMuPDF's PDF text
 * extraction reorders a stacked inline fraction like "L/d" into
 * letters-then-fraction-slash ("Ld" + U+2044) when lifting text from the
 * PDF's glyph layout, as its own free-floating token — "Ld ⁄ = 0.67" where
 * the clean text reads "L/d = 0.67". A real extraction artifact, not a
 * paraphrase.
 *
 * The slash and any whitespace immediately *after* it are dropped — not
 * whitespace before it — so the artifact's own two added spaces (one on
 * each side of the stray "⁄" token) collapse to the single natural space
 * the clean text already has before whatever follows, while "L/d" (no
 * space on either side) is untouched by that extra step and simply loses
 * its slash. Both then normalise to "ld = 0.67" (applied to both the quote
 * and the corpus, per this function's own symmetric-folding design). A
 * cheap, auditable text-cleanup step, not a paraphrase-acceptance one:
 * `evidenceSupported` still requires the folded strings to match exactly.
 */
const FRACTION_SLASHES = /[/⁄]\s*/g;

/**
 * A word that wraps across a PDF line break re-joins with a hyphen AND an
 * inserted space ("high- energy") where the clean text has neither reason
 * for one ("high-energy") — PyMuPDF's own extraction artifact, the same
 * family as the fraction-slash case above (1-17). Folding any hyphen sitting
 * directly between two letters — whether or not whitespace follows — makes
 * both forms converge to the same normalized string.
 *
 * This is broader than the fraction-slash fold: it folds *every* inter-
 * letter hyphen for matching purposes, including a normal compound word
 * like "state-of-the-art", not only line-wrap artifacts — there is no cheap
 * way to tell the two apart from the text alone, since the only structural
 * difference (a space after the hyphen in the artifact, none in a clean
 * compound) has to be erased on both sides to converge them. It still
 * cannot turn a paraphrase into a match: two *different* hyphenated words
 * fold to two different strings; only the *same* word's clean and
 * line-wrapped spellings converge. Scoped to letters only (not digits) so a
 * numeric range ("43-45 K") or a negative number is never joined. (2-02)
 */
const HYPHENATED_WORD_BREAK = /([A-Za-z])-\s*([A-Za-z])/g;

/**
 * U+200B (zero-width space), U+200C (zero-width non-joiner), U+200D
 * (zero-width joiner), U+FEFF (zero-width no-break space / BOM). ar5iv's
 * MathML-to-text rendering emits one of these where a genuine word-boundary
 * space belongs (e.g. splitting a formula token from the prose around it) —
 * the model's own copied quote has an ordinary space there instead. Folded
 * to a literal **space**, not deleted: unlike the fraction-slash artifact
 * above (a spurious extra token, correctly dropped), this character is
 * doing the job of a word-boundary space in the source, so deleting it
 * outright would erase a boundary the model's quote still has — an ar5iv
 * MathML render of "4​e - 4" must fold to "4 e - 4", not "4e - 4".
 * Placed before the `\s+` collapse below so the fold's own new space is
 * normalised the same way as every other space. (U+FEFF alone is already
 * matched by JS's `\s` in that collapse — ECMAScript's `WhiteSpace`
 * production includes it — but it's named explicitly here too so the whole
 * invisible-character story lives in one visible place rather than being
 * split across an explicit fold and a regex quirk nobody would think to
 * look for.) (4-02)
 */
const ZERO_WIDTH_CHARS = /[​‌‍﻿]/g;

/**
 * Normalise for matching only — never for display. `cleanDisplayText` first,
 * so a quote that went through the sanitizer and a raw section text land in
 * the same alphabet (it already folds entities, mojibake, `×`, `±`, sub- and
 * superscripts). Then NFKC (ligatures `ﬁ` → `fi`), curly → straight quotes,
 * every dash → `-`, soft hyphens and zero-width characters gone (the latter
 * folded to a space, not deleted — 4-02), citation brackets and bracketed
 * author-year citations gone (P2-08b), both slash
 * characters gone (1-17), a hyphenated line-break re-joined (2-02),
 * lowercase, whitespace collapsed.
 */
export function normalizeForMatch(s: string): string {
  return cleanDisplayText(s)
    .normalize("NFKC")
    .replace(/[‘’‚‛]/g, "'")
    .replace(/[“”„‟]/g, '"')
    .replace(/[‐‑‒–—―−]/g, "-")
    .replace(/\u00AD/g, "")
    .replace(ZERO_WIDTH_CHARS, " ")
    .replace(CITATION_BRACKETS, "")
    .replace(AUTHOR_YEAR_CITATIONS, "")
    .replace(FRACTION_SLASHES, "")
    .replace(HYPHENATED_WORD_BREAK, "$1$2")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Match already-normalised strings; the exported check normalises first. The
 * whole quote or nothing (P2-08b, §1g.16): no head, no tail, no window — a
 * quote that is only partly in the section is not the paper's sentence.
 */
function supportedIn(quote: string, corpus: string): boolean {
  return quote.length >= MIN_QUOTE_CHARS && corpus.includes(quote);
}

/**
 * True when `quote` (≥ 40 chars after normalisation) appears in `corpus`
 * whole, once both are normalised.
 */
export function evidenceSupported(quote: string, corpus: string): boolean {
  return supportedIn(normalizeForMatch(quote), normalizeForMatch(corpus));
}

interface CorpusEntry {
  where: string;
  text: string;
  /** P2-02: a section's id (`s<index>` when it has none) and page; absent
   *  for the abstract and the figure captions. */
  sectionId?: string;
  page?: number;
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
  (corpus.doc?.sections ?? []).forEach((section, index) => {
    const text = normalizeForMatch(section.text);
    if (!text) return;
    entries.push({
      where: section.heading.trim() || section.canonical,
      text,
      sectionId: section.id ?? `s${index}`,
      ...(typeof section.page === "number" ? { page: section.page } : {}),
    });
  });
  // 1-17: figure captions are supplied text too — `buildPass2Prompt` hands
  // the model `figureCaptions` alongside `body`, and the evidence rule says
  // "one sentence copied character-for-character from the supplied text (or
  // the abstract)" — a caption qualifies, but was never in the matchable
  // corpus, so a genuine verbatim caption quote was dropped as unverifiable.
  for (const cap of corpus.doc?.figureCaptions ?? []) {
    const text = normalizeForMatch(cap.caption);
    if (!text) continue;
    entries.push({ where: cap.label.trim() || "figure", text });
  }
  return entries;
}

function locate(evidence: string, entries: CorpusEntry[]): string | null {
  return locateEntry(evidence, entries)?.where ?? null;
}

/**
 * The corpus entry that holds `evidence`: the section named `preferId` first
 * when it holds it (P2-02 — the model's own `sectionId`, kept when right),
 * then in corpus order — the abstract, the sections, the captions — as
 * `locate` always has.
 */
function locateEntry(evidence: string, entries: CorpusEntry[], preferId?: string): CorpusEntry | null {
  const quote = normalizeForMatch(evidence);
  if (preferId) {
    const preferred = entries.find((entry) => entry.sectionId === preferId);
    if (preferred && supportedIn(quote, preferred.text)) return preferred;
  }
  for (const entry of entries) {
    if (supportedIn(quote, entry.text)) return entry;
  }
  return null;
}

/** Where a verified quote sits: its heading, and — in a section — the
 *  section's id and page. Any id the model gave is replaced by this. */
function placed(entry: CorpusEntry): { evidenceWhere: string; sectionId?: string; page?: number } {
  return {
    evidenceWhere: entry.where,
    ...(entry.sectionId ? { sectionId: entry.sectionId } : {}),
    ...(typeof entry.page === "number" ? { page: entry.page } : {}),
  };
}

/** A document section, normalised once for matching, under its id. */
export interface SectionCorpusEntry {
  id: string;
  text: string;
}

/**
 * P2-01 (§1g.1): every section of the document, normalised for matching, by
 * id — the section's own, or the one `withSectionIds` would give it
 * (`s<index>`). The question pass's sentences are checked against this.
 */
export function sectionCorpus(doc: ExtractedDocument): SectionCorpusEntry[] {
  return doc.sections.map((section, index) => ({
    id: section.id ?? `s${index}`,
    text: normalizeForMatch(section.text),
  }));
}

/**
 * The id of the section that holds `quote` verbatim (the same forgiving match
 * as `evidenceSupported`), trying `preferId` first — the section the model
 * named — so a correct id costs one comparison and a wrong one is corrected.
 * Null when no section holds it: the sentence is not the paper's.
 */
export function locateSection(
  quote: string,
  entries: readonly SectionCorpusEntry[],
  preferId?: string,
): string | null {
  const normalized = normalizeForMatch(quote);
  const preferred = preferId ? entries.find((entry) => entry.id === preferId) : undefined;
  if (preferred && supportedIn(normalized, preferred.text)) return preferred.id;
  for (const entry of entries) {
    if (entry !== preferred && supportedIn(normalized, entry.text)) return entry.id;
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

  // P2-02 (§1g.3): the answers to the reader's questions, held to the same
  // standard — and the sections they point at, to the document.
  if (report.forYourQuestions) {
    const bodyIds = new Set(
      (corpus.doc?.sections ?? [])
        .map((section, index) => (section.canonical === "abstract" ? null : section.id ?? `s${index}`))
        .filter((id): id is string => id !== null),
    );
    const keepAnswer = (answer: Claim): Claim | null => {
      const entry = locateEntry(answer.evidence, entries, answer.sectionId);
      if (!entry) {
        dropped += 1;
        return null;
      }
      return { text: answer.text, evidence: answer.evidence, ...placed(entry) };
    };
    verified.forYourQuestions = report.forYourQuestions.map((entry): QuestionAnswers => {
      // "Not addressed" is one sentence on the page: it carries no answers.
      const answers =
        entry.verdict === "not_addressed"
          ? []
          : entry.answers.map(keepAnswer).filter((answer): answer is Claim => answer !== null);
      const readNext = entry.readNext.filter((item) => {
        if (bodyIds.has(item.sectionId)) return true;
        dropped += 1;
        return false;
      });
      // §1g.21 (2): an entry the model called answered or partly, whose answers
      // verification dropped every one of, is "unverified" — "not addressed"
      // would be a false statement about the paper, which may well address the
      // question in words Peer could not verify. An entry that arrived with no
      // answer at all offered nothing to verify: it stays "not_addressed", as
      // does one the model itself called so. Only this verifier sets the value.
      const verdict: QuestionAnswers["verdict"] =
        entry.verdict === "not_addressed"
          ? "not_addressed"
          : answers.length > 0
            ? entry.verdict
            : entry.answers.length > 0
              ? "unverified"
              : "not_addressed";
      return { ...entry, verdict, answers, readNext };
    });
  }

  if (report.terms) {
    const terms = report.terms
      .map((term): PaperTerm | null => {
        if (term.evidence === undefined) return term;
        const entry = locateEntry(term.evidence, entries, term.sectionId);
        if (!entry) {
          dropped += 1;
          return null;
        }
        return { term: term.term, definition: term.definition, evidence: term.evidence, ...placed(entry) };
      })
      .filter((term): term is PaperTerm => term !== null);
    if (terms.length > 0) verified.terms = terms;
    else delete verified.terms;
  }

  // §1g.12: added to the count the sanitizer hands over (entries that
  // answered no question), never replacing it.
  verified.provenance = { ...report.provenance, droppedClaims: report.provenance.droppedClaims + dropped };
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

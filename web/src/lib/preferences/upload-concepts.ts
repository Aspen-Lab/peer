import type { PreferenceConcept } from "@/types";
import type { ExtractedDocument } from "@/lib/papers/html-text";
import { normalizePreferenceLabel, preferenceKey } from "./ledger";
import { ABBREVIATION_GROUPS, canonicalize, isGenericTerm } from "@/lib/scoring/term-expand";

// 9-21 (A9-04/A9-11): the local extraction algorithm's own version. Bumped
// whenever the candidate-filtering or facet rules change meaningfully, so a
// concept already stored in a user's ledger/meta can be told apart from one
// a future rewrite of this module would produce.
export const UPLOAD_CONCEPT_EXTRACTION_VERSION = 1;

// A conservative, local phrase extractor. No document text is sent to a model
// for preference learning. References, author blocks and boilerplate are out.
const STOP = new Set(("a an the and or of for to in on at by from with without into as is are was were be been being " +
  "this that these those it its their our we they you can may could should will would not no than then " +
  "using used use based via between during through over under more most also such which where when how " +
  "study studies paper article work research results result show shows shown found demonstrate demonstrated " +
  "measure measures measured improve improves improved support supports supported enable enables achieve achieves " +
  "propose proposed present presents presented new novel high low large small significant significantly " +
  "however therefore respectively compared comparison introduction abstract conclusion conclusions " +
  "figure figures table supplementary copyright reserved rights publisher doi http https www et al").split(/\s+/));

// 9-21 (A9-04): single-word candidates this module will keep. Long forms in
// `ABBREVIATION_GROUPS` are all multi-word once canonicalized (hyphens become
// spaces — "li-ion" -> "li ion"), so this only ever picks up the short forms
// ("lco", "nmc", "xrd", "dft", "operando", …) — real domain vocabulary this
// codebase already recognizes, never an ordinary prose noun like "nodes".
const KNOWN_SINGLE_TOKEN_TERMS = new Set(
  ABBREVIATION_GROUPS.flatMap((group) => group.map((form) => canonicalize(form)))
    .filter((form) => form && !form.includes(" ")),
);

const NUMBER_WORDS = new Set([
  "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten",
  "first", "second", "third", "fourth", "fifth", "sixth", "seventh", "eighth", "ninth", "tenth",
]);

// Unit abbreviations that only ever show up glued to a number in scientific
// prose ("500 nm", "20 wt%") — never a research concept on their own. Most
// two-letter forms are already excluded by the token-length-3 floor below;
// listed anyway for the 3+ letter ones and for defensiveness.
const UNIT_WORDS = new Set([
  "nm", "mm", "cm", "km", "mg", "kg", "ml", "hz", "khz", "mhz", "ghz",
  "wh", "kwh", "mah", "ah", "ppm", "psi", "pa", "kpa", "mpa", "gpa",
  "mv", "kv", "ma", "min", "hr", "wt",
]);

function isDigitOrUnitToken(token: string): boolean {
  if (/^\d+$/.test(token)) return true;
  if (UNIT_WORDS.has(token)) return true;
  // A number immediately followed by a short unit suffix, glued into one
  // token by the tokenizer ("500nm", "20wt").
  return /^\d+[a-z]{1,4}$/.test(token);
}

function isAcceptableSingleToken(token: string): boolean {
  if (isGenericTerm(token)) return false;
  if (NUMBER_WORDS.has(token)) return false;
  if (isDigitOrUnitToken(token)) return false;
  return KNOWN_SINGLE_TOKEN_TERMS.has(token);
}

/** 9-21: candidate-level gate, applied after the n-gram builder's own
 * per-token stop/length filter (which already keeps a STOP word out of any
 * candidate). Rejects a bare number word or digit/unit token anywhere in the
 * phrase, a single token that isn't a known domain term, and a multi-token
 * phrase made entirely of generic words ("materials data"). */
function isAcceptableCandidate(label: string): boolean {
  const tokens = label.split(" ");
  if (tokens.some((token) => NUMBER_WORDS.has(token) || isDigitOrUnitToken(token))) return false;
  if (tokens.length === 1) return isAcceptableSingleToken(tokens[0]);
  return !tokens.every((token) => STOP.has(token) || isGenericTerm(token));
}

// 9-21: rule-based facet classification (handoff §4.1's method/material/topic
// split) — a short, closed cue list, never a model call or taxonomy lookup.
const METHOD_CUES = new Set([
  "spectroscopy", "diffraction", "microscopy", "simulation", "deposition",
  "synthesis", "model", "algorithm", "benchmark", "dataset", "chromatography",
  "voltammetry", "calorimetry", "titration", "regression", "embedding",
  "embeddings", "network", "imaging", "transform",
]);
const MATERIAL_CUES = new Set([
  "alloy", "oxide", "perovskite", "electrolyte", "composite", "polymer",
  "ceramic", "catalyst", "cathode", "anode", "nanoparticle", "nanoparticles",
]);
// "-ide"/"-ate"/"-ite" suffix cue, guarded by a length floor so short,
// unrelated words ("site", "quite") don't false-positive into "material".
const MATERIAL_SUFFIX_RE = /(?:ide|ate|ite)$/;
const MIN_SUFFIX_CUE_LENGTH = 6;
// A chemical-formula-shaped token ("nmc811", "lifepo4") — letters then a
// digit, glued into one word by the tokenizer.
const CHEMICAL_FORMULA_RE = /^[a-z]{1,4}\d[a-z\d]*$/;

function classifyFacet(label: string): NonNullable<PreferenceConcept["facet"]> {
  const tokens = label.split(" ");
  if (tokens.some((token) => METHOD_CUES.has(token))) return "method";
  if (tokens.some((token) =>
    MATERIAL_CUES.has(token) ||
    CHEMICAL_FORMULA_RE.test(token) ||
    (token.length >= MIN_SUFFIX_CUE_LENGTH && MATERIAL_SUFFIX_RE.test(token)),
  )) return "material";
  return "topic";
}

export function extractUploadConcepts(doc: ExtractedDocument): PreferenceConcept[] {
  const sections = [
    { canonical: "title", text: doc.title ?? "", weight: 4 },
    ...doc.sections.filter((s) => !/reference|bibliograph|acknowledg|funding|author/i.test(s.canonical + " " + s.heading))
      .map((s) => ({ ...s, weight: s.canonical === "abstract" ? 3 : /method|result|conclusion/.test(s.canonical) ? 2 : 1 })),
  ];
  const candidates = new Map<string, { count: number; score: number; section: string; title: boolean }>();
  for (const section of sections) {
    const tokens = section.text.slice(0, 14000).toLowerCase().match(/[\p{L}\p{N}][\p{L}\p{N}-]*|[.,;:!?\n]/gu) ?? [];
    for (let start = 0; start < tokens.length; start++) {
      for (let length = 1; length <= 3 && start + length <= tokens.length; length++) {
        const parts = tokens.slice(start, start + length);
        if (parts.some((t) => STOP.has(t) || !/\p{L}/u.test(t) || t.length < 3)) break;
        const label = normalizePreferenceLabel(parts.join(" "));
        const old = candidates.get(label);
        candidates.set(label, { count: (old?.count ?? 0) + 1,
          score: (old?.score ?? 0) + section.weight * (length === 1 ? 0.45 : length),
          section: old?.section ?? section.canonical, title: !!old?.title || section.canonical === "title" });
      }
    }
  }
  const ranked = [...candidates].filter(([label, c]) => label.length <= 70 && (c.title || c.count >= 2))
    .filter(([label]) => isAcceptableCandidate(label))
    .sort((a, b) => b[1].score - a[1].score || a[0].localeCompare(b[0]));
  const out: PreferenceConcept[] = [];
  for (const [label, c] of ranked) {
    if (out.some((p) => p.label.includes(label) || label.includes(p.label))) continue;
    out.push({ key: preferenceKey(label), label, source: "uploaded_article", section: c.section,
      facet: classifyFacet(label), extractionVersion: UPLOAD_CONCEPT_EXTRACTION_VERSION,
      confidence: Math.min(0.95, (c.title ? 0.65 : 0.45) + Math.min(c.count, 5) * 0.06) });
    if (out.length === 12) break;
  }
  return out;
}

// 9-31 (A9-09, Ruling 8 made concrete): three-band paper-attachment
// matching, replacing the old binary `matchesUploadedPaper`. A verified DOI
// (present and equal on both sides) always wins, positive or negative — a
// mismatched DOI is an explicit, stronger signal than any amount of title
// overlap and must never be second-guessed by a coincidentally similar
// title. Absent a DOI on either side, normalized-title token overlap alone
// decides which of the other three bands applies.
export type PaperMatchBand = "doi" | "strong" | "confirm" | "reject";
export interface PaperMatchResult {
  band: PaperMatchBand;
  /** Jaccard-shaped overlap fraction of normalized title tokens — always
   * computed, even on a "doi" band, so a caller can log/display it. */
  overlap: number;
}

/** ≥ this fraction (and ≥ 2 overlapping words — the old function's own
 * floor, preserved) auto-binds with a one-line confirmation. */
export const MATCH_STRONG_THRESHOLD = 0.6;
/** ≥ this fraction (below `MATCH_STRONG_THRESHOLD`) asks the user to
 * explicitly confirm before binding; below it, the attach is refused. */
export const MATCH_CONFIRM_THRESHOLD = 0.35;

export function matchUploadedPaper(target: { title: string; doi?: string }, title: string, doi?: string): PaperMatchResult {
  const normalizeDoi = (value: string) => value.toLowerCase().replace(/^https?:\/\/(?:dx\.)?doi.org\//, "").trim();
  const tokens = (value: string) => new Set(normalizePreferenceLabel(value).split(" ").filter((t) => t.length > 2 && !STOP.has(t)));
  const expected = tokens(target.title);
  const actual = tokens(title);
  const overlapCount = [...expected].filter((word) => actual.has(word)).length;
  const overlap = overlapCount / Math.max(1, Math.min(expected.size, actual.size));

  if (target.doi && doi) {
    return { band: normalizeDoi(target.doi) === normalizeDoi(doi) ? "doi" : "reject", overlap };
  }
  if (overlapCount >= 2 && overlap >= MATCH_STRONG_THRESHOLD) return { band: "strong", overlap };
  if (overlap >= MATCH_CONFIRM_THRESHOLD) return { band: "confirm", overlap };
  return { band: "reject", overlap };
}

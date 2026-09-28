import type { RawItem } from "@/lib/sources/types";
import {
  ABBREVIATION_GROUPS,
  canonicalize,
  expandTerm,
  isGenericTerm,
  termMatches,
  termOccurrences,
  termSpecificity,
} from "./term-expand";
import { tokenize } from "./tokenize";
import { resolveSenseEvidence, type SelectedSenseConcept } from "@/lib/feed/senses";
import referenceIdfTable from "./reference-idf.json";

export interface KeywordResult {
  score: number;
  matched: string[];
  senseEvidence: ReturnType<typeof resolveSenseEvidence>[];
  /**
   * SENSE-CONTEXT (§1ap AMENDMENT 2(ii)) — true when this item has at least
   * one Required-tag match (`matched.length > 0`) AND every one of those
   * matches failed its context check (none passed, none bypassed, none
   * exempt-long-tag, none a senses.ts sense match). combine.ts uses this to
   * apply an ADDITIONAL penalty to the item's final blended score, so a
   * high unstripped-topicality/recency/source score can no longer rescue
   * an item with zero genuine context-agreeing evidence. False whenever
   * `opts.senseContext` is absent (every other caller unaffected) or the
   * item has no Required-tag match at all (a pure T4-only admission always
   * has a context-passing basis — T4 has no demote path, only gate).
   */
  fullyDemoted: boolean;
}

type KeywordScope = "all" | "titleAndSummary";
type GateMetadata = RawItem["metadata"] & { gateText?: string };

function itemText(item: RawItem, scope: KeywordScope): string {
  const gateText = (item.metadata as GateMetadata).gateText ?? "";
  return canonicalize(
    [
      item.title,
      scope === "titleAndSummary" ? gateText : item.abstract ?? "",
      (item.tags ?? []).join(" "),
    ].join(" "),
  );
}

/**
 * How much a match is worth, by where the paper put the term.
 *
 * A paper that names a topic in its title is about it. A paper that names it
 * once, halfway through an abstract, is usually citing it as context — two of
 * today's candidates matched "protein structure prediction" on exactly this
 * sentence shape: "generative modeling, which has transformed prediction in
 * fields as diverse as weather forecasting and protein structure prediction,
 * holds the potential to forecast earthquake aftershocks". Both were ranked
 * as squarely on topic as the day's actual protein papers, because a match
 * was a match wherever it fell.
 *
 * A passing mention still counts — it is evidence, and the gate above stays
 * open — but it is not the same evidence as a title.
 */
function groundingWeight(item: RawItem, canonicalTopic: string): number {
  if (termMatches(canonicalize(item.title), canonicalTopic)) return 1;
  const tags = canonicalize((item.tags ?? []).join(" "));
  if (tags && termMatches(tags, canonicalTopic)) return 0.85;
  const body = canonicalize(item.abstract ?? "");
  const mentions = body ? termOccurrences(body, canonicalTopic) : 0;
  if (mentions >= 3) return 0.9;
  if (mentions === 2) return 0.7;
  return 0.4;
}

// ── REQUIRED-GATE (ABC-JEV-INTEGRATION.md §1ao/§1an) ────────────────────
//
// Required used to mean "the tag's exact phrase must appear, contiguous, in
// order" (T1 below — `termMatches`, unchanged). The user ruled that out: a
// paper qualifies if it is ABOUT a Required tag, even in different words. T2
// and T3 approximate that at Tier 0 (no model key) for two common, cheap,
// per-document cases; T4 (the general similarity fallback) lives in
// `combine.ts`, where the pool-wide TF-IDF index already exists.
//
// Ranking multipliers, named and grep-able per §1ao.3 — provisional, not
// re-tuned by measurement (the guide flagged this; B measured admission
// counts, not ranking quality).
export const REQUIRED_TAG_T2_GROUNDING = 0.85;
export const REQUIRED_TAG_T3_GROUNDING = 0.6;

/**
 * T2 — pairs a paper declares about ITSELF, e.g. "lithium cobalt oxide
 * (LCO)" or "(LIXS) laser-induced XUV spectroscopy". Regex ported verbatim
 * from the investigation's real-data-validated extractor
 * (docs/jev-abc/REQUIRED-GATE-B-20260928T160542Z.md §2.4's LCO/LIXS
 * fixture — confirmed it does NOT false-positive on an unrelated pair in
 * the same text, see required-gate.test.ts). Scans the item's OWN raw
 * (non-canonicalized) title+abstract, never a global vocabulary table, so
 * capitalization/parens survive for the abbreviation shape to match.
 */
function selfDeclaredAbbreviationPairs(
  rawText: string,
): { longForm: string; abbr: string }[] {
  if (!rawText) return [];
  const pairs: { longForm: string; abbr: string }[] = [];
  const longFirst = /\b((?:[A-Za-z][\w-]*\s+){1,5}[A-Za-z][\w-]*)\s*\(([A-Z][A-Za-z0-9]{1,7})\)/g;
  const abbrFirst = /\b([A-Z][A-Za-z0-9]{1,7})\s*\(((?:[A-Za-z][\w-]*\s+){1,5}[A-Za-z][\w-]*)\)/g;
  let match: RegExpExecArray | null;
  while ((match = longFirst.exec(rawText))) pairs.push({ longForm: match[1], abbr: match[2] });
  while ((match = abbrFirst.exec(rawText))) pairs.push({ longForm: match[2], abbr: match[1] });
  return pairs;
}

/**
 * T2 admission: does any self-declared pair in the item's own text resolve
 * to this Required tag, either side, via the SAME termMatches/expandTerm T1
 * uses (so an already-known abbreviation — e.g. the existing
 * `["lco","lithium cobalt oxide"]` group — still benefits from plural
 * handling etc.)?
 *
 * Exported for DIRECT testing (required-gate.test.ts), not just used
 * through `scoreKeyword`. Reason, recorded honestly rather than left
 * implicit: `itemText()` above already folds title + abstract/summary +
 * tags into ONE haystack for T1, so whenever this function's own check
 * would succeed against a self-declared pair drawn from that same
 * title/abstract text, T1's whole-haystack search over that same text
 * already succeeds too — T2 can extend admission beyond T1 only through a
 * DIFFERENT scope than combine.ts uses today (see the exported test's
 * `scope: "titleAndSummary"` isolation). Confirmed empirically, not just
 * argued: every constructed probe that made T2 fire also made T1 fire, and
 * B's own real-data measurement independently found the same thing (T2adds
 * = 0 in all four profiles, docs/jev-abc/REQUIRED-GATE-B-20260928T160542Z.md
 * §2.4). T2 is still implemented exactly as ruled (§1ao) — it is correct,
 * harmless, and becomes load-bearing the moment `itemText`'s haystack
 * composition ever changes — this comment exists so that fact is found by
 * reading the code, not re-discovered by a future investigator.
 */
export function matchesSelfDeclaredAbbreviation(item: RawItem, canonicalTopic: string): boolean {
  const rawText = [item.title, item.abstract ?? ""].join(" ");
  for (const { longForm, abbr } of selfDeclaredAbbreviationPairs(rawText)) {
    const canonicalAbbr = canonicalize(abbr);
    const canonicalLong = canonicalize(longForm);
    if (canonicalAbbr === canonicalTopic || canonicalLong === canonicalTopic) return true;
    if (termMatches(canonicalLong, canonicalTopic) || termMatches(canonicalAbbr, canonicalTopic)) return true;
  }
  return false;
}

/**
 * T3 admission: does any of the item's own source-provided subject tags
 * (rich OpenAlex concepts/topics/keywords; sparse-to-absent from arXiv/
 * PubMed's adapters today — see REQUIRED-GATE-B-20260928T160542Z.md §2.2,
 * not changed by this task) match this Required tag via the SAME
 * termMatches/expandTerm T1 uses?
 *
 * Exported for DIRECT testing, for a STRONGER reason than T2's: `itemText()`
 * folds `item.tags` into T1's haystack in EVERY scope, including
 * `"titleAndSummary"` — so unlike T2, there is no scope choice under which
 * this function can ever admit something T1 would not already admit for
 * the SAME item. This was already true of `itemText`/T1 before this task;
 * T3 does not change it, only makes the existing tag-matching explicit and
 * independently re-triggerable (e.g. if `itemText` ever stops folding tags
 * in). Confirmed empirically (see matchesSelfDeclaredAbbreviation's doc
 * comment) and by B's measurement (T3adds = 0 in all four profiles).
 */
export function matchesSourceTag(item: RawItem, canonicalTopic: string): boolean {
  for (const tag of item.tags ?? []) {
    if (termMatches(canonicalize(tag), canonicalTopic)) return true;
  }
  return false;
}

// ── SENSE-CONTEXT (ABC-JEV-INTEGRATION.md §1ap + AMENDMENTs) ─────────────
//
// A short or ambiguous Required tag (e.g. "electrolyte", "solid state",
// "LCO") can literal-match (T1/T2/T3 above) a paper from a completely
// different domain that merely happens to use the same word — a clinical
// "electrolyte imbalance" paper, a condensed-matter-physics "valence-bond
// solid state" paper, a petroleum "light cycle oil (LCO)" paper (real, live
// evidence: REQUIRED-GATE-A's F2 finding). This section adds a context
// check for exactly that shape of tag: does the REST of the paper (with
// the tag's own words removed from both sides) agree with the reader's
// declared WORK — methods, venues, and project/challenge seed texts
// (`workText`, AMENDMENT 2(i); deliberately NOT the reader's other
// Required topics, which are not evidence about each other's meaning, and
// NOT `pText`, which includes them)? A tag that fails this check is
// DEMOTED, not dropped (§1ap.3) — it stays in `matched` so the card can
// still explain itself, but contributes at a much lower grounding. T4
// (combine.ts, similarity-only) has no textual evidence to soften, so it
// is GATED instead (§1ap.4) — no demote path. Disjoint from senses.ts by
// construction: this code only runs over `literalMustTopics`, which
// already has any bare sense-selected tag ("conflict"/"sem") stripped out
// by combine.ts before this file ever sees it.
//
// AMENDMENT 4 (round 2, 2026-09-28): the context signal below is POOL-
// INDEPENDENT — round 1's cosine used a TF-IDF index built from the day's
// candidate pool (`buildIndex(items)`), so the SAME real paper's verdict
// depended on how many OTHER items happened to be fetched alongside it
// that day (measured: flips 15/172 real item×tag checks between pool
// sizes 7 and 150, docs/jev-abc/SENSE-CONTEXT-B2-20260928T202118Z.md §2.4).
// The replacement combines two independently pool-invariant measures —
// neither reads the surrounding pool at all, by construction, only the one
// item and the reader's own context text:
//   (1) a cosine against a FIXED, shipped reference-IDF table
//       (`reference-idf.json`, built offline by
//       `web/scripts/build-reference-idf.mjs` from a broad, multi-field
//       OpenAlex sample — see that script's header), and
//   (2) a raw token-overlap coefficient (no corpus statistic at all).
// Each alone misses a different real residual; combined, both were
// measured to reject every real negative on 3 real tags while costing
// materially less genuine-paper retention than either alone (grid search
// on the production table, docs/jev-abc/SENSE-CONTEXT-C2-20260928T205712Z.md
// task 3). `SENSE_CONTEXT_FIXED_FLOOR`/`SENSE_CONTEXT_OVERLAP_FLOOR`/
// `SENSE_CONTEXT_FIXED_RESCUE` are that measured, pre-set point — not
// independently retunable without re-running the same grid.
export const SENSE_CONTEXT_DEMOTED_GROUNDING = 0.25;
/** Fixed-reference-table cosine floor (Option 1). */
export const SENSE_CONTEXT_FIXED_FLOOR = 0.015;
/** Raw token-overlap-coefficient floor (Option 2). */
export const SENSE_CONTEXT_OVERLAP_FLOOR = 0.1;
/**
 * A fixed-table cosine at or above this (higher) value passes on its own,
 * without needing the overlap floor too — a paper the reference table
 * itself is confident about does not also need to share enough RAW
 * vocabulary with the reader's context; this is what rescues genuine
 * matches the overlap floor alone would otherwise cost (measured: LCO
 * positive retention 66%→91% versus the plain AND of both floors, same
 * 100% real-negative rejection either way).
 */
export const SENSE_CONTEXT_FIXED_RESCUE = 0.1;

const REFERENCE_IDF_TABLE: Record<string, number> = referenceIdfTable;
/**
 * A token the shipped table never saw is treated as AT LEAST as
 * specific/rare as the rarest token the table does track (its own maximum
 * weight) — computed from the table itself, not stored separately, so it
 * can never drift out of sync with the table it describes.
 */
const REFERENCE_IDF_MAX_WEIGHT = Math.max(...Object.values(REFERENCE_IDF_TABLE));
function referenceIdfWeight(token: string): number {
  return REFERENCE_IDF_TABLE[token] ?? REFERENCE_IDF_MAX_WEIGHT;
}

/**
 * Option C (§1ap.1, measured docs/jev-abc/SENSE-CONTEXT-B-20260928T173815Z.md
 * §2): a Required tag is "short/ambiguous" when its own canonical form is
 * two words or fewer, or every one of its tokens is already in the
 * existing generic-term vocabulary (via the already-exported
 * `isGenericTerm` — no new vocabulary added here). A long, specific tag's
 * own specificity is already the evidence a match is on-topic —
 * re-demanding independent context agreement after removing that evidence
 * measurably hurts more than it protects (guide §2.1: 0-1 of 4 genuine
 * positives would survive the check for a 4-word tag). Exported for direct
 * testing and for combine.ts's T4 loop to reuse.
 */
export function isShortOrAmbiguous(tag: string): boolean {
  const tokens = canonicalize(tag).split(" ").filter(Boolean);
  if (tokens.length === 0) return false;
  if (tokens.length <= 2) return true;
  return tokens.every((token) => isGenericTerm(token));
}

/**
 * Every token, from every canonical/inflected/abbreviation variant of a
 * tag, that must be removed from both sides of the context comparison
 * below — otherwise a wrong-domain paper that merely repeats the tag's own
 * ambiguous word gets partial credit for "agreeing" with a context that
 * (via the reader's own topics) also repeats that same word. Measured
 * load-bearing, not cosmetic (guide §3.5: stripping catches materially
 * more real wrong-domain negatives than leaving the tag's own words in).
 */
function senseContextStripSet(tag: string): Set<string> {
  const stripSet = new Set<string>();
  for (const variant of expandTerm(tag)) {
    for (const token of tokenize(variant)) stripSet.add(token);
  }
  return stripSet;
}

/**
 * `tfidf.ts`'s own cosine helper is private, so this small duplicate is the
 * intended integration point rather than a new export from that file. No
 * longer reads a pool-built `TfidfIndex` (AMENDMENT 4) — both vectors it
 * compares now come from the fixed reference table below.
 */
function cosine(a: Map<string, number>, b: Map<string, number>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (const value of a.values()) normA += value * value;
  for (const value of b.values()) normB += value * value;
  const [smaller, larger] = a.size < b.size ? [a, b] : [b, a];
  for (const [token, value] of smaller) {
    const other = larger.get(token);
    if (other !== undefined) dot += value * other;
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

/** `term_frequency * referenceIdfWeight` vector for a token list — the fixed-table
 * analogue of `tfidf.ts`'s private `toTfidf`, kept local for the same reason `cosine`
 * above is: `tfidf.ts` builds its vectors from a pool-wide IDF, this builds them from
 * the shipped, pool-independent one. */
function toReferenceVector(tokens: string[]): Map<string, number> {
  const vector = new Map<string, number>();
  if (tokens.length === 0) return vector;
  const counts = new Map<string, number>();
  for (const token of tokens) counts.set(token, (counts.get(token) ?? 0) + 1);
  for (const [token, count] of counts) vector.set(token, (count / tokens.length) * referenceIdfWeight(token));
  return vector;
}

/** Raw token-SET overlap coefficient (`|A∩B| / min(|A|,|B|)`) — no corpus statistic,
 * so corpus/pool choice cannot move it by construction (Option 2). */
function overlapCoefficient(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  const [smaller, larger] = a.size < b.size ? [a, b] : [b, a];
  let intersection = 0;
  for (const token of smaller) if (larger.has(token)) intersection++;
  return intersection / smaller.size;
}

/** The item's own text, in the same shape `tfidf.ts`'s private `itemDocText` builds
 * it (title + abstract + tags, NOT canonicalized — `tokenize()` lowercases and
 * filters on its own) — the reference table's weights were computed from documents
 * tokenized this same way (`build-reference-idf.mjs`), so agreement requires
 * matching this shape exactly, not this file's own canonicalized `itemText`. */
function senseContextItemText(item: RawItem): string {
  return [item.title, item.abstract ?? "", (item.tags ?? []).join(" ")].join(" ");
}

export interface SenseContextGateResult {
  /**
   * No declared context survives stripping (e.g. a reader with only this
   * one Required tag and nothing else declared) — explicit bypass, today's
   * behaviour exactly, never a naive `0 >= floor` rejection (§1ap.2; a
   * cosine against a genuinely empty query is indistinguishable by value
   * alone from a populated context that shares no vocabulary, but the two
   * must be treated oppositely).
   */
  bypass: boolean;
  /** Meaningless when `bypass` is true. */
  pass: boolean;
  /** Cosine against the fixed reference table (Option 1). Meaningless when `bypass`. */
  fixedSim: number;
  /** Raw token-overlap coefficient (Option 2). Meaningless when `bypass`. */
  overlapSim: number;
}

/**
 * The stripped-context check itself (§1ap.2, replaced per AMENDMENT 4): does the
 * paper's own text, with the tag's own tokens removed, agree with the reader's
 * declared work (also stripped)? Pool-independent — every input is either the one
 * item, the reader's own context text, or the fixed shipped table; nothing here
 * reads the surrounding candidate pool. `pass` requires (fixedSim clears its floor
 * AND overlapSim clears its floor) OR fixedSim alone clears the higher rescue floor
 * — the measured point, `docs/jev-abc/SENSE-CONTEXT-C2-20260928T205712Z.md` task 3.
 * Exported for direct testing and for combine.ts's T4 loop to share the exact same
 * logic rather than duplicating it.
 */
export function senseContextGate(item: RawItem, tag: string, contextText: string): SenseContextGateResult {
  const stripSet = senseContextStripSet(tag);
  const contextTokens = tokenize(contextText).filter((token) => !stripSet.has(token));
  if (contextTokens.length === 0) return { bypass: true, pass: true, fixedSim: 0, overlapSim: 0 };
  const itemTokens = tokenize(senseContextItemText(item)).filter((token) => !stripSet.has(token));

  const fixedSim = cosine(toReferenceVector(itemTokens), toReferenceVector(contextTokens));

  // Overlap axis additionally drops GENERIC_TERMS (a closed list over an open class
  // of "uninformative but common" words — a known, accepted limitation, not a bug;
  // docs/jev-abc/SENSE-CONTEXT-B2-20260928T202118Z.md §2.2/POLICY 4) so neither pool
  // size nor corpus choice can move this axis either.
  const itemTokensForOverlap = new Set(itemTokens.filter((token) => !isGenericTerm(token)));
  const contextTokensForOverlap = new Set(contextTokens.filter((token) => !isGenericTerm(token)));
  const overlapSim = overlapCoefficient(itemTokensForOverlap, contextTokensForOverlap);

  const pass =
    (fixedSim >= SENSE_CONTEXT_FIXED_FLOOR && overlapSim >= SENSE_CONTEXT_OVERLAP_FLOOR) ||
    fixedSim >= SENSE_CONTEXT_FIXED_RESCUE;
  return { bypass: false, pass, fixedSim, overlapSim };
}

// ── SENSE-CONTEXT rule (c) — self-declared different expansion ──────────
//
// (ABC-JEV-INTEGRATION.md §1ap AMENDMENT 4 ruling 4, narrowed after the manager's own
// execution check found the original design's false-positive path: taking the WHOLE
// captured long-form span from `selfDeclaredAbbreviationPairs` above and asking only
// "does it contain a known expansion?" would have called a genuine
// "high-voltage LiCoO2 (LCO)" battery paper the wrong sense, because the extractor's
// long-form window can include up to 5 unrelated preceding words with no check that
// they actually spell the abbreviation. The narrowed rule fires ONLY when, inside a
// self-declared pair's long-form window, there is a RUN of CONSECUTIVE WORDS (hyphens
// already split into separate words by this point, since every window here is
// canonicalized before splitting) whose INITIALS spell the abbreviation, and that run
// is not itself one of the tag's own known expansions. A window containing a known
// expansion ANYWHERE agrees and never fires, checked first (this already implies the
// matched-run check for any run inside such a window, kept anyway as a direct,
// cheap safety net). A run shorter than the abbreviation's own letter count cannot
// exist, so a single word or a bare chemical formula (e.g. "LiCoO2") can never
// satisfy this — not a special case, a consequence of the run-length requirement.
// Measured on ALL of B's saved real LCO positives/negatives
// (docs/jev-abc/SENSE-CONTEXT-C2-20260928T205712Z.md task 2): 15/17 real negatives
// caught, 0/35 real positives flagged, including the manager's own counterexample and
// the 3 ruling-specified protective strings. Only ever applies to a tag WITH a
// catalogued `ABBREVIATION_GROUPS` entry (~11 tags today); for every other tag this
// returns `{applies:false, differs:false}` immediately and is inert.
function hasKnownAbbreviationExpansion(canonicalTag: string): boolean {
  return ABBREVIATION_GROUPS.some((group) => group.map(canonicalize).includes(canonicalTag));
}

/** A run of `abbrLetters.length` consecutive words whose initials spell
 * `abbrLetters`, or null if none exists — the core of the narrowed rule (c). */
function findInitialsRun(words: string[], abbrLetters: string[]): string | null {
  const n = abbrLetters.length;
  if (n < 2 || words.length < n) return null; // a single word can never spell a >=2-letter abbreviation
  for (let start = 0; start + n <= words.length; start++) {
    let matchesRun = true;
    for (let i = 0; i < n; i++) {
      if (words[start + i]?.[0] !== abbrLetters[i]) {
        matchesRun = false;
        break;
      }
    }
    if (matchesRun) return words.slice(start, start + n).join(" ");
  }
  return null;
}

export interface SelfDeclaredDifferentSenseResult {
  /** True when the item self-declares ANY abbreviation pair for this tag (whether or
   * not it disagrees) — diagnostic only, `differs` is what callers act on. */
  applies: boolean;
  /** True when the item's own self-declared long form for this tag's abbreviation
   * does NOT match any of the tag's known expansions — a hard non-match. */
  differs: boolean;
  declaredLongForm?: string;
}

/**
 * Rule (c) itself. Reuses the already-private `selfDeclaredAbbreviationPairs` above
 * (the same T2 extractor, unchanged this round — the comma-parenthetical form,
 * `"(light cycle oil, LCO)"`, is deliberately NOT added to it; that is its own,
 * separately-measured follow-up, T2-COMMA-PAREN).
 */
export function selfDeclaresDifferentSense(item: RawItem, tag: string): SelfDeclaredDifferentSenseResult {
  const canonicalTag = canonicalize(tag);
  if (!hasKnownAbbreviationExpansion(canonicalTag)) return { applies: false, differs: false };
  const knownExpansions = expandTerm(tag).filter((variant) => variant.includes(" ")); // multi-word long forms only
  const rawText = [item.title, item.abstract ?? ""].join(" ");
  let declaredAny = false;
  for (const { longForm, abbr } of selfDeclaredAbbreviationPairs(rawText)) {
    const canonicalAbbr = canonicalize(abbr);
    const canonicalLong = canonicalize(longForm);
    const abbrIsTag = canonicalAbbr === canonicalTag || termMatches(canonicalAbbr, canonicalTag);
    if (!abbrIsTag) continue;
    declaredAny = true;
    const windowAgrees = knownExpansions.some((variant) => termMatches(canonicalLong, variant));
    if (windowAgrees) continue; // agrees with a known expansion -- never fires
    const abbrLetters = canonicalAbbr.replace(/\s+/g, "").split("");
    const words = canonicalLong.split(" ").filter(Boolean);
    const run = findInitialsRun(words, abbrLetters);
    if (run && !knownExpansions.includes(run)) {
      return { applies: true, differs: true, declaredLongForm: canonicalLong };
    }
    // Self-declared a pair for this tag, but no initials-spelling run found (e.g. a
    // bare chemical formula) -- not a declared DIFFERENT expansion.
  }
  return { applies: declaredAny, differs: false };
}

export function scoreKeyword(
  item: RawItem,
  topics: string[],
  opts: {
    scope?: KeywordScope;
    grounded?: boolean;
    selectedSenseConcepts?: SelectedSenseConcept[];
    /**
     * REQUIRED-GATE (§1ao) — when true, a topic that misses T1
     * (`termMatches`) is also tried against T2 (self-declared abbreviation)
     * and T3 (source subject tags) before counting as a miss. Defaults to
     * false/undefined so every OTHER caller of this shared function stays
     * byte-for-byte unaffected: `web/src/lib/events/scoring.ts` and
     * `web/src/lib/jobs/scoring.ts` call `scoreKeyword` 4 times each and
     * feed `passesRequiredGate` (`@/lib/opportunities/shared.ts`), which
     * §1ao.6 rules unchanged — turning T2/T3 on unconditionally here would
     * have silently changed events/jobs qualification too, since they share
     * this exact function. Only `combine.ts`'s REQUIRED-topics call passes
     * this true (not its softTopics call — softTopics is a ranking bonus,
     * not the qualification screen).
     */
    extendedRequiredMatch?: boolean;
    /**
     * SENSE-CONTEXT (§1ap) — when present: (a) rule (c)
     * (`selfDeclaresDifferentSense`) runs first and, if the item
     * self-declares a DIFFERENT expansion of an abbreviation tag, that
     * topic contributes nothing (a hard non-match, not a demotion — see
     * rule (c)'s own doc comment); (b) otherwise a T1/T2/T3 hit on a
     * short/ambiguous Required tag (`isShortOrAmbiguous`) must also show
     * context agreement (`senseContextGate`) with this contextText or its
     * grounding is demoted to `SENSE_CONTEXT_DEMOTED_GROUNDING` — the topic
     * still counts (stays in `matched`, still contributes to `raw`).
     * Defaults to undefined so every other caller (softTopics, events/jobs)
     * is byte-for-byte unaffected, the same scoping `extendedRequiredMatch`
     * already uses. Only combine.ts's REQUIRED-topics call passes this.
     */
    senseContext?: { contextText: string };
  } = {},
): KeywordResult {
  if (topics.length === 0 && (opts.selectedSenseConcepts?.length ?? 0) === 0) return { score: 0, matched: [], senseEvidence: [], fullyDemoted: false };
  const haystack = itemText(item, opts.scope ?? "all");
  const matched: string[] = [];
  const seen = new Set<string>();
  let raw = 0;
  // SENSE-CONTEXT (§1ap AMENDMENT 2(ii)) — tracks whether EVERY Required-tag
  // match this item earned was demoted, so combine.ts can apply an
  // additional penalty to the final blended score (not just the keyword
  // component) when there is no context-passing evidence at all.
  let hasMatch = false;
  let allMatchesDemoted = true;
  for (const topic of topics) {
    const canonicalTopic = canonicalize(topic);
    if (!canonicalTopic || seen.has(canonicalTopic)) continue;
    seen.add(canonicalTopic);
    let grounding: number | undefined;
    if (termMatches(haystack, canonicalTopic)) {
      grounding = opts.grounded ? groundingWeight(item, canonicalTopic) : 1;
    } else if (opts.extendedRequiredMatch && matchesSelfDeclaredAbbreviation(item, canonicalTopic)) {
      grounding = REQUIRED_TAG_T2_GROUNDING;
    } else if (opts.extendedRequiredMatch && matchesSourceTag(item, canonicalTopic)) {
      grounding = REQUIRED_TAG_T3_GROUNDING;
    }
    if (grounding === undefined) continue;
    // SENSE-CONTEXT rule (c) (§1ap AMENDMENT 4 ruling 4) — runs FIRST, ahead
    // of the statistical context gate below: an explicit self-declared
    // disagreement is stronger evidence than a proxy, so it is a hard
    // non-match (this topic contributes nothing for this item), not a
    // demotion. Scoped behind `opts.senseContext`, same as the gate below,
    // so every other caller stays byte-for-byte unaffected.
    if (opts.senseContext && selfDeclaresDifferentSense(item, topic).differs) continue;
    // SENSE-CONTEXT (§1ap.3) — DEMOTE, not drop: a short/ambiguous tag's
    // literal hit that fails the context gate keeps its `matched` entry
    // (the tag genuinely IS present) but contributes at the much lower
    // demoted grounding instead of T1/T2/T3's own.
    let demoted = false;
    if (opts.senseContext && isShortOrAmbiguous(topic)) {
      const gate = senseContextGate(item, topic, opts.senseContext.contextText);
      if (!gate.bypass && !gate.pass) { demoted = true; grounding = SENSE_CONTEXT_DEMOTED_GROUNDING; }
    }
    matched.push(topic);
    raw += termSpecificity(canonicalTopic) * grounding;
    hasMatch = true;
    if (!demoted) allMatchesDemoted = false;
  }
  const senseEvidence = (opts.selectedSenseConcepts ?? []).map((selected) =>
    resolveSenseEvidence(selected, haystack),
  );
  for (const evidence of senseEvidence) {
    const selected = opts.selectedSenseConcepts?.find((concept) => concept.senseId === evidence.senseId);
    const canCount = evidence.kind === "exactAlias" ||
      (evidence.kind === "closeAlias" && selected?.matchRequirement === "exact-or-close");
    if (canCount && evidence.alias && !seen.has(evidence.alias)) {
      seen.add(evidence.alias);
      matched.push(evidence.alias);
      raw += evidence.kind === "exactAlias" ? 1 : 0.65;
      // A senses.ts sense match is disjoint from SENSE-CONTEXT entirely
      // (§1.3 of the SENSE-CONTEXT guide) and never demoted — it always
      // counts as context-passing evidence.
      hasMatch = true;
      allMatchesDemoted = false;
    }
  }
  return {
    score: Math.min(1, raw / 1.5),
    matched,
    senseEvidence,
    fullyDemoted: hasMatch && allMatchesDemoted,
  };
}

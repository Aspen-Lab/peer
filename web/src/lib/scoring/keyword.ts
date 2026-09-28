import type { RawItem } from "@/lib/sources/types";
import {
  canonicalize,
  termMatches,
  termOccurrences,
  termSpecificity,
} from "./term-expand";
import { resolveSenseEvidence, type SelectedSenseConcept } from "@/lib/feed/senses";

export interface KeywordResult {
  score: number;
  matched: string[];
  senseEvidence: ReturnType<typeof resolveSenseEvidence>[];
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
  } = {},
): KeywordResult {
  if (topics.length === 0 && (opts.selectedSenseConcepts?.length ?? 0) === 0) return { score: 0, matched: [], senseEvidence: [] };
  const haystack = itemText(item, opts.scope ?? "all");
  const matched: string[] = [];
  const seen = new Set<string>();
  let raw = 0;
  for (const topic of topics) {
    const canonicalTopic = canonicalize(topic);
    if (!canonicalTopic || seen.has(canonicalTopic)) continue;
    seen.add(canonicalTopic);
    if (termMatches(haystack, canonicalTopic)) {
      matched.push(topic);
      const grounding = opts.grounded ? groundingWeight(item, canonicalTopic) : 1;
      raw += termSpecificity(canonicalTopic) * grounding;
      continue;
    }
    if (!opts.extendedRequiredMatch) continue;
    if (matchesSelfDeclaredAbbreviation(item, canonicalTopic)) {
      matched.push(topic);
      raw += termSpecificity(canonicalTopic) * REQUIRED_TAG_T2_GROUNDING;
      continue;
    }
    if (matchesSourceTag(item, canonicalTopic)) {
      matched.push(topic);
      raw += termSpecificity(canonicalTopic) * REQUIRED_TAG_T3_GROUNDING;
    }
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
    }
  }
  return {
    score: Math.min(1, raw / 1.5),
    matched,
    senseEvidence,
  };
}

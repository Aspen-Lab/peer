/**
 * Bidirectional materials/electrochemistry vocabulary. Values are
 * canonicalized before indexing, so punctuation variants such as `li-ion`
 * collapse to the same surface form as `li ion`.
 *
 * Two-letter acronyms are deliberately absent and are dropped at index time by
 * MIN_ABBREVIATION_LENGTH. They collide with ordinary prose far too often to
 * be usable as match terms: `SE` is Software Engineering / Southeast /
 * Standard Error, and `CV` appears in essentially every job posting
 * ("send your CV"), which would have made `cyclic voltammetry` match the whole
 * job board. Their long forms still expand normally — only the acronym alias
 * is withheld. Do not add a two-letter alias here; it will be ignored.
 */
export const ABBREVIATION_GROUPS = [
  ["li ion", "lithium ion", "lithium-ion"],
  ["lco", "lithium cobalt oxide", "licoo2"],
  ["nmc", "nickel manganese cobalt oxide"],
  ["lfp", "lithium iron phosphate", "lifepo4"],
  ["ssb", "solid state battery", "all solid state battery"],
  ["eis", "electrochemical impedance spectroscopy"],
  ["xrd", "x ray diffraction"],
  ["tem", "transmission electron microscopy"],
  ["xps", "x ray photoelectron spectroscopy"],
  ["dft", "density functional theory"],
  ["in situ", "in-situ", "operando"],
] as const;

/**
 * Shortest single-word acronym allowed as a match alias. Enforced structurally
 * so a future edit to ABBREVIATION_GROUPS cannot reintroduce a two-letter
 * alias by accident.
 */
export const MIN_ABBREVIATION_LENGTH = 3;

export const GENERIC_TERMS = new Set([
  "materials",
  "energy",
  "transport",
  "modelling",
  "simulation",
  "interface",
  "design",
  "analysis",
  "systems",
  "data",
  "characterization",
]);

/** Canonical form shared by both user terms and item text. */
export function canonicalize(text: string): string {
  return text
    .normalize("NFKC")
    .toLocaleLowerCase()
    .replace(/[/_\p{Pd}\u2212]+/gu, " ")
    .replace(/[^\p{L}\p{N}\p{M}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const ABBREVIATION_INDEX = new Map<string, readonly string[]>();
const KNOWN_SHORT_FORMS = new Set<string>();

for (const rawGroup of ABBREVIATION_GROUPS) {
  const group = Array.from(new Set(rawGroup.map(canonicalize).filter(Boolean)))
    // Drop aliases too short to be unambiguous (see MIN_ABBREVIATION_LENGTH).
    .filter(
      (form) => form.includes(" ") || form.length >= MIN_ABBREVIATION_LENGTH,
    );
  for (const form of group) {
    ABBREVIATION_INDEX.set(form, group);
    if (!form.includes(" ") && form.length <= 4) KNOWN_SHORT_FORMS.add(form);
  }
}

const IRREGULAR_INFLECTIONS = new Map<string, string[]>([
  ["battery", ["batteries"]],
  ["batteries", ["battery"]],
  ["matrix", ["matrices"]],
  ["matrices", ["matrix"]],
  ["analysis", ["analyses"]],
  ["analyses", ["analysis"]],
]);

/**
 * Small, closed list of words a length/suffix-shaped rule alone would fold
 * incorrectly. Not exhaustive by design (TOKENIZE-PLURALS,
 * ABC-JEV-INTEGRATION.md §1bd, docs/jev-abc/TOKENIZE-PLURALS-B-20260929T141359Z.md
 * §2.4) — found and hand-verified against real data (the shipped
 * reference-idf.json's 17,489 keys); more may exist.
 */
const SINGULARIZE_PROTECTED_WORDS = new Set(["species", "sems"]);

/**
 * An "-s" ending that is part of the word's own spelling, not a plural
 * marker: "-ics" ("physics", "kinetics", "ceramics", "electronics",
 * "optics", "mathematics") and "-sis/-xis/-itis/-osis/-opsis" ("analysis" —
 * already irregular-mapped above too, "arthritis", "osmosis", "synopsis").
 * Folding these with the generic "-s" rule below would strip a meaningful
 * part of the word instead of a plural marker.
 */
const SINGULARIZE_PROTECTED_SUFFIX = /(?:ics|sis|xis|itis|osis|opsis)$/u;

/**
 * Best-effort singular of a single word; identity when already singular.
 *
 * Exported for TOKENIZE-PLURALS (§1be point 5b) — reused, not copied, as the
 * fold applied to document text ONLY at the Required-gate T4 comparison
 * (`tokenize.ts`'s `tokenizeFolded`, via `combine.ts`'s second, parallel
 * folded index). The short-tag SENSE-CONTEXT context check stays on the
 * plain, unfolded `tokenize()` — §1be split that comparison out into its
 * own item (SENSE-CONTEXT-EVIDENCE) after folding exposed a pre-existing
 * path defect there (the overlap axis counting non-topical shared words as
 * evidence), unrelated to this function. Until now `singularize` was a
 * private helper behind `isGenericTerm` only; reusing it for arbitrary
 * document text (a much larger, noisier vocabulary than a reader's own
 * Required tags) is what the guide's real-data validation hardened against:
 * a protected-word list, a protected-suffix guard, and a stricter length
 * guard on the plain "-s" strip (>4, not >3, so a 4-letter token like
 * "sems" is protected structurally too).
 *
 * Two rules changed again after shipping, both found by the manager
 * executing this function against every key of the shipped
 * reference-idf.json (§1be AMENDMENT g/h), not by inspection:
 *
 * 1. The old single `(?:ch|sh|x|z)es$` → strip-2 rule was already split
 *    once (a true double-consonant "-zzes" plural, "buzz"+"es"="buzzes",
 *    still strips 2; a silent-e "-zes" verb, "analyze"+"s"="analyzes",
 *    "optimizes", "synthesizes", "utilizes", "recognizes",
 *    "characterizes", now strips only 1 — the un-split rule turned
 *    "analyzes" into the broken fragment "analyz"). The FIRST fix then
 *    widened the `(?:ch|sh|x)es$` group to also swallow every bare
 *    "-ses" word, on the theory that "glasses"/"classes" needed it — but a
 *    census of the shipped reference table found 68 real "-ses" keys, and
 *    stripping 2 is wrong for 46 of them (a plain, silent-e "-s" plural
 *    like "phase"+"s"="phases" only ever needs 1 stripped) and creates 5
 *    outright FALSE MERGES with other real, unrelated keys ("doses" landing
 *    on "dos", the density-of-states abbreviation; "bases" on "bas";
 *    "courses" on "cours"; "rises" on "ris"; "loses" on "los"). Stripping 2
 *    is only ever correct for a TRUE double-consonant "-sses" ("glasses"→
 *    "glass", "classes"→"class", "processes"→"process") — the same shape
 *    as the "-zzes" case above, not the "-zes" one. Every other "-ses" word
 *    now falls through to the plain "-s" rule below (1 stripped): "phases"→
 *    "phase", "doses"→"dose" (never the false "dos"), "bases"→"base",
 *    "cases"→"case". A small, named, ACCEPTED cost of that fallthrough:
 *    "gases"→"gase", "biases"→"biase", "lenses"→"lense" (the plain rule
 *    does not know these 3 need "-es" not "-s") stay UNMERGED — an
 *    under-fold, not a false merge, and exactly today's shipped behaviour
 *    for them either way (both the old, pre-item code and the plain "-s"
 *    rule already mishandle the unrelated "focus"/"virus" the same way).
 *    A fourth, previously undocumented accepted under-fold, owed by
 *    TOKENIZE-PLURALS-A's own review (LOW finding 1) and closed here
 *    (SENSE-CONTEXT-EVIDENCE, §1bg point 8): "ions"→"ions" (unchanged) —
 *    the plain "-s" rule's `length > 4` guard excludes this 4-letter
 *    plural, so `ion`/`ions` (both real, separate reference-table keys)
 *    never merge. Safe for the same reason as gases/biases/lenses (nothing
 *    false-merges), just a small, named T4/context-check recall gap for a
 *    tag whose only mismatch with a candidate paper is this word's
 *    grammatical number.
 * 2. The irregular map's own "pick the shorter form" test
 *    (`form.length < word.length`) can never select a same-length pair —
 *    which is exactly the "analysis"/"analyses" entry (7 → 8 hides the
 *    fact that IRREGULAR_INFLECTIONS also holds the ROUND TRIP entry
 *    `analyses → analysis`, same length, "es" for "is"), so
 *    `singularize("analyses")` fell through to the general rules and
 *    landed on "analys" (old rule) / "analyse" (rule 1's fix alone) —
 *    neither is "analysis". Fixed by also accepting a same-length
 *    irregular target ending in "sis": today that is only ever
 *    "analyses"→"analysis"; `hypotheses`/`syntheses`/etc. are not in the
 *    map at all and stay the deferred "-sis" follow-up (§1bd point 2) —
 *    unaffected by this fix, which only ever fires on an EXISTING map
 *    entry.
 *
 * Does not touch `inflectedForms` below (the opposite, singular-to-plural
 * direction `expandTerm`/T1 use) — a different code path that does not
 * call this function, so T1/T2/T3 admission is unaffected by construction.
 */
export function singularize(word: string): string {
  const irregular = IRREGULAR_INFLECTIONS.get(word);
  if (irregular) {
    const shorter = irregular.find((form) => form.length < word.length);
    if (shorter) return shorter;
    // §1be AMENDMENT h — "analysis"/"analyses" round-trip at the SAME
    // length, so the general "strictly shorter" test above never fires for
    // it; explicitly accept a same-length irregular target ending in "sis"
    // (only "analysis" today — nothing else in the map is this shape).
    const sameLengthSis = irregular.find(
      (form) => form.length === word.length && /sis$/u.test(form),
    );
    if (sameLengthSis) return sameLengthSis;
  }
  if (SINGULARIZE_PROTECTED_WORDS.has(word)) return word;
  if (SINGULARIZE_PROTECTED_SUFFIX.test(word)) return word;
  if (/ies$/u.test(word) && word.length > 4) return `${word.slice(0, -3)}y`;
  if (/zzes$/u.test(word)) return word.slice(0, -2);
  if (/zes$/u.test(word)) return word.slice(0, -1);
  // §1be AMENDMENT g — strip 2 only for a TRUE double-consonant "-sses"
  // (same shape as "-zzes" above); a bare single-s "-ses" word falls
  // through to the plain "-s" rule below instead (see the doc comment).
  if (/(?:(?:ch|sh|x)es|sses)$/u.test(word)) return word.slice(0, -2);
  if (/s$/u.test(word) && !/ss$/u.test(word) && word.length > 4) {
    return word.slice(0, -1);
  }
  return word;
}

function inflectedForms(phrase: string): string[] {
  const words = phrase.split(" ").filter(Boolean);
  if (words.length === 0) return [];
  const last = words.at(-1)!;
  if (words.length === 1 && KNOWN_SHORT_FORMS.has(last)) return [];

  let variants = IRREGULAR_INFLECTIONS.get(last) ?? [];
  if (variants.length === 0) {
    if (/[^aeiou]y$/u.test(last)) {
      variants = [`${last.slice(0, -1)}ies`];
    } else if (/ies$/u.test(last) && last.length > 3) {
      variants = [`${last.slice(0, -3)}y`];
    } else if (/s$/u.test(last) && last.length > 3) {
      variants = [last.slice(0, -1)];
    } else if (/(?:ch|sh|x|z)$/u.test(last)) {
      variants = [`${last}es`];
    } else {
      variants = [`${last}s`];
    }
  }

  const prefix = words.slice(0, -1);
  return variants.map((variant) => [...prefix, variant].join(" "));
}

/** Canonical, morphological, and abbreviation-equivalent forms for a term. */
export function expandTerm(term: string): string[] {
  const canonical = canonicalize(term);
  if (!canonical) return [];

  const expanded = new Set<string>();
  const queue = [canonical];
  while (queue.length > 0) {
    const current = queue.shift()!;
    if (!current || expanded.has(current)) continue;
    expanded.add(current);

    for (const inflected of inflectedForms(current)) {
      if (!expanded.has(inflected)) queue.push(inflected);
    }
    for (const equivalent of ABBREVIATION_INDEX.get(current) ?? []) {
      if (!expanded.has(equivalent)) queue.push(equivalent);
    }
  }
  return Array.from(expanded);
}

const WORD_CHAR = "\\p{L}\\p{N}\\p{M}";

/**
 * Whole-word match of ONE already-canonical variant (no expansion) against a
 * canonicalized haystack. Extracted from `termMatches` below (SENSE-CONTEXT-EVIDENCE,
 * ABC-JEV-INTEGRATION.md §1bg point 3) so a caller that needs to test a SINGLE
 * member of a term's expansion — not "does the haystack agree with the term at
 * all" — has a primitive that will not silently re-expand that member back out
 * to the whole group. Calling `expandTerm` on a single already-known variant is
 * NOT equivalent to testing that variant alone: `expandTerm` returns the same
 * whole-group closure no matter which member it starts from (see keyword.ts's
 * `matchesFullNameOrFormula`, which exists because of exactly this trap).
 * `termMatches` itself is unchanged behaviourally — it is now a thin loop over
 * this helper instead of inlining the same regex construction.
 */
export function termVariantMatches(canonicalHaystack: string, variant: string): boolean {
  const escaped = variant.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`(?<![${WORD_CHAR}])${escaped}(?![${WORD_CHAR}])`, "u");
  return re.test(canonicalHaystack);
}

/**
 * Whole-word match against a canonicalized haystack. Call `canonicalize`
 * before invoking directly; scoreKeyword does this once per item.
 *
 * Deliberately context-free. An earlier version kept a denylist of preceding
 * words ("marketing materials", "course materials") to suppress generic-word
 * false positives, but that only covered the two phrases it named — "training
 * materials" and every other variant still matched. Generic terms are handled
 * structurally instead: they are scoped to title+summary, weighted down by
 * `termSpecificity`, and — see `isGenericTerm` — cannot satisfy a relevance
 * gate on their own.
 */
export function termMatches(canonicalHaystack: string, term: string): boolean {
  return expandTerm(term).some((variant) => termVariantMatches(canonicalHaystack, variant));
}

/**
 * True when a term is too common to prove topical relevance by itself
 * ("materials", "energy", "data"). Such a term still contributes to ranking,
 * but a gate must not open on a generic match alone.
 */
/**
 * How many times a term occurs in an already-canonicalised haystack, counting
 * every variant `termMatches` would accept. `termMatches` answers whether a
 * paper says the word at all; this answers how much it has to say about it.
 */
export function termOccurrences(canonicalHaystack: string, term: string): number {
  let count = 0;
  for (const variant of expandTerm(term)) {
    const escaped = variant.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp(
      `(?<![${WORD_CHAR}])${escaped}(?![${WORD_CHAR}])`,
      "gu",
    );
    count += (canonicalHaystack.match(re) ?? []).length;
  }
  return count;
}

export function isGenericTerm(term: string): boolean {
  const canonical = canonicalize(term);
  if (!canonical) return true;
  if (canonical.includes(" ")) return false;
  return GENERIC_TERMS.has(canonical) || GENERIC_TERMS.has(singularize(canonical));
}

/** Specificity weight used by the saturating keyword score. */
export function termSpecificity(term: string): number {
  const canonical = canonicalize(term);
  if (!canonical) return 0;
  if (isGenericTerm(canonical)) return 0.3;
  if (canonical.includes(" ")) return 1;
  if (KNOWN_SHORT_FORMS.has(canonical) || canonical.length >= 8) return 0.7;
  return 0.5;
}

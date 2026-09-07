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
  ["lco", "lithium cobalt oxide"],
  ["nmc", "nickel manganese cobalt oxide"],
  ["lfp", "lithium iron phosphate"],
  ["ssb", "solid state battery", "all solid state battery"],
  ["eis", "electrochemical impedance spectroscopy"],
  ["xrd", "x ray diffraction"],
  ["sem", "scanning electron microscopy"],
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

/** Best-effort singular of a single word; identity when already singular. */
function singularize(word: string): string {
  const irregular = IRREGULAR_INFLECTIONS.get(word);
  if (irregular) {
    const shorter = irregular.find((form) => form.length < word.length);
    if (shorter) return shorter;
  }
  if (/ies$/u.test(word) && word.length > 4) return `${word.slice(0, -3)}y`;
  if (/(?:ch|sh|x|z)es$/u.test(word)) return word.slice(0, -2);
  if (/s$/u.test(word) && !/ss$/u.test(word) && word.length > 3) {
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
  for (const variant of expandTerm(term)) {
    const escaped = variant.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp(
      `(?<![${WORD_CHAR}])${escaped}(?![${WORD_CHAR}])`,
      "u",
    );
    if (re.test(canonicalHaystack)) return true;
  }
  return false;
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

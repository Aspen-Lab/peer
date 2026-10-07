import type { FeedRequest } from "./types";
import { textValue } from "./intent";
import { exactCanonicalSenseQueries } from "./senses";
import { uploadInterestTerms } from "@/lib/preferences/ledger";

export type FeedFocus = "tight" | "balanced" | "exploratory";
export type FeedFreshness = "today" | "week" | "month";
export type FeedSourceMix = "balanced" | "preprints" | "published" | "code" | "web";
export type FeedImportance = "new" | "highlyCited" | "rising";
export type FeedMethodMode = "mustMatch" | "relatedOk" | "any";
export type FeedDiscoveryMode = "core" | "adjacent" | "surprise";

export interface FeedControls {
  focus?: FeedFocus;
  freshness?: FeedFreshness;
  paperCount?: 5 | 10;
  sourceMix?: FeedSourceMix;
  importance?: FeedImportance;
  methodMode?: FeedMethodMode;
  discoveryMode?: FeedDiscoveryMode;
  avoidReviews?: boolean;
  avoidOldPapers?: boolean;
  avoidBroadSurveys?: boolean;
}

export interface SearchBrief {
  coreTopics: string[];
  /** Ordered, labeled intent fields; never reconstructed from positional seeds. */
  project: string;
  challenge: string;
  currentProjectSummary: string;
  activeQuestions: string[];
  mustInclude: string[];
  niceToHave: string[];
  avoid: string[];
  methods: string[];
  materialsOrDatasets: string[];
  timeWindow: FeedFreshness;
  generatedQueries: string[];
  sourceMix: {
    preprints: number;
    published: number;
    code: number;
    web: number;
  };
  controls: Required<FeedControls>;
}

const DEFAULT_CONTROLS: Required<FeedControls> = {
  focus: "balanced",
  freshness: "week",
  paperCount: 10,
  sourceMix: "balanced",
  importance: "new",
  methodMode: "relatedOk",
  discoveryMode: "core",
  avoidReviews: true,
  avoidOldPapers: false,
  avoidBroadSurveys: true,
};

const SOURCE_MIX_WEIGHTS: Record<FeedSourceMix, SearchBrief["sourceMix"]> = {
  balanced: { preprints: 1, published: 1, code: 0.6, web: 0.4 },
  preprints: { preprints: 1.3, published: 0.7, code: 0.5, web: 0.2 },
  published: { preprints: 0.6, published: 1.4, code: 0.4, web: 0.2 },
  code: { preprints: 0.8, published: 0.8, code: 1.4, web: 0.5 },
  web: { preprints: 0.7, published: 0.7, code: 0.7, web: 1.4 },
};

const STOPWORDS = new Set([
  "about",
  "after",
  "against",
  "also",
  "and",
  "are",
  "between",
  "from",
  "into",
  "that",
  "the",
  "their",
  "this",
  "through",
  "using",
  "with",
  "without",
]);

function cleanList(values: (string | undefined)[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of values) {
    const value = (raw ?? "").trim().replace(/\s+/g, " ");
    if (!value) continue;
    const key = value.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(value);
  }
  return out;
}

// NON-ASCII-TEXT (ABC-JEV-INTEGRATION.md §1bo.8, AMENDMENT): the four
// scripts this module treats as "not sendable to an English-language
// source" — Chinese (Han), Japanese (Hiragana, Katakana) and Korean
// (Hangul). Round 1 checked Han only; the manager's round-2 check found a
// Japanese project text leaking Hiragana function words ("における",
// "しています") as bogus keyword queries, because every Unicode script's
// letters are `\p{L}`, so without ITS OWN script check a kana or Hangul run
// passes straight through every "keep letters" step untouched. A single
// shared fragment so every CJK check below (the keyword-branch strip, the
// chunk delimiter, the CJK-only / any-CJK text checks) is built from the
// SAME source and cannot silently drift out of sync with each other.
const CJK_SCRIPT_CLASS =
  "\\p{Script=Han}\\p{Script=Hiragana}\\p{Script=Katakana}\\p{Script=Hangul}";

// CJK Symbols and Punctuation (U+3000-303F, covers the ideographic
// iteration mark 々 used mid-word in real Chinese/Japanese text, e.g.
// 人々) plus the fullwidth punctuation sub-ranges of Halfwidth and
// Fullwidth Forms (U+FF00-FFEF) — deliberately EXCLUDING that block's
// fullwidth digit (FF10-FF19) and fullwidth Latin letter (FF21-FF3A,
// FF41-FF5A) sub-ranges, so a rare fullwidth Latin word is never shredded
// by the delimiter below — plus U+30FB-30FC, the katakana middle dot and
// prolonged-sound mark. Found by execution: Unicode classifies both as
// Script=Common (shared punctuation), not Script=Katakana, even though the
// prolonged-sound mark alone appears in most katakana loanwords ("バッテ
// リー" battery, "コンピューター" computer) — without this range a
// perfectly ordinary katakana word would fracture into pieces around it.
// Never touches plain ASCII punctuation (the existing `. , ; : \n` /
// " - " delimiters are unrelated and unchanged).
const CJK_PUNCTUATION_RANGES =
  "\\u3000-\\u303F\\u30FB-\\u30FC\\uFF01-\\uFF0F\\uFF1A-\\uFF20\\uFF3B-\\uFF40\\uFF5B-\\uFF65\\uFFE0-\\uFFEE";

const CJK_CHARACTER = new RegExp(`[${CJK_SCRIPT_CLASS}]`, "u");

// NON-ASCII-TEXT (§1bo.8(b)): a maximal run of CJK-script characters and/or
// CJK/fullwidth punctuation — the chosen mechanism is "a CJK run acts as a
// chunk delimiter before the phrase split" (phrasesFromText below), so this
// pattern is designed to feed straight into that split via a "\n"
// substitution, reusing the EXISTING chunk pipeline rather than adding a
// parallel one.
const CJK_DELIMITER_RUN = new RegExp(`[${CJK_SCRIPT_CLASS}${CJK_PUNCTUATION_RANGES}]+`, "gu");

const CJK_SCRIPT_STRIP = new RegExp(`[${CJK_SCRIPT_CLASS}]`, "gu");

// NON-ASCII-TEXT (§1bo point 2, round 1): true when a piece of text carries
// at least one CJK character and no Latin letter or digit — i.e. it is
// Chinese/Japanese/Korean text with no Latin-script term or chemical
// formula mixed in. Used as a DEFENSIVE second layer on phrasesFromText's
// `longPhrases` (§1bo.8): with the CJK_DELIMITER_RUN split in place below,
// a chunk that survives the split can no longer contain a CJK character at
// all, which makes this filter provably redundant for any case the
// delimiter itself handles correctly — kept anyway as a cheap backstop
// against a gap in CJK_PUNCTUATION_RANGES' hand-picked ranges, the same
// "defence in depth" this campaign already used for DATASET-RECORDS'
// adapter-level type filters (ABC-JEV-INTEGRATION.md §1bl).
function isCjkOnlyText(text: string): boolean {
  return CJK_CHARACTER.test(text) && !/[\p{Script=Latin}\p{N}]/u.test(text);
}

// NON-ASCII-TEXT (§1bo.8(a)/(b)): true when a piece of text contains ANY
// CJK character at all, not just when it is CJK-only. literalQueryIfShort
// (below) returns the ENTIRE original string verbatim, so the invariant
// "no query built from free text contains a CJK character" means even ONE
// embedded CJK character disqualifies the whole string from that path — a
// mixed text still reaches the queries, just through phrasesFromText's
// Latin phrases/keywords/formulas, never through a literal copy of itself.
function containsCjkCharacter(text: string): boolean {
  return CJK_CHARACTER.test(text);
}

// QUERY-GENERIC-WORDS (ABC-JEV-INTEGRATION.md §1bs.1,
// docs/jev-abc/QUERY-GENERIC-WORDS-B-20260930T090811Z.md §5(b)/Q1 note 1):
// a bare 4-digit year ("2024") or a joined number+unit token ("500Wh/kg",
// "3.7V", "45mA") reaches the keyword tier with ~0 selectivity as a search
// query — the guide's own set-diff measured this narrow filter clean (0
// domain words, 0 generic words lost) over a 62-text corpus, unlike any
// percentile cut of the reference-idf table (which lost real domain words,
// e.g. "gene"/"protein", starting at its gentlest tested cut). A token
// STARTS with an optional sign and one or more digits, optionally with a
// decimal fraction — this is what separates a UNIT/YEAR/DECIMAL token
// (always digit-FIRST) from a domain formula or designation that merely
// CONTAINS a digit ("LiCoO2", "NMC811", "GPT-4", "316L", "1T-MoS2" all
// start with a letter and never match this).
const LEADING_NUMBER = /^([+-]?\d+(?:\.\d+)?)(.*)$/;

// Closed list of measurement-unit suffixes (§1bs.1's own example list),
// lowercased for comparison since this filter runs after the keyword
// step's own `.toLowerCase()` below. A deliberately FINITE, curated set —
// units are a finite vocabulary, the same reasoning DEDUP-ANGEW's DOI
// alias and LCO-FORMULA's formula list already used for their own closed
// lists elsewhere in this codebase — never inferred or open-ended,  and
// never extended without a real example the way those two were. Bare "l"
// and "m" are deliberately NOT members (so "316L" — a stainless-steel
// designation — and a bare "...M" designation both survive); only the
// specific compound spellings below (mL, µL, mM, µM, ...) are members, and
// "mm"/"µm" cover BOTH of the case-variant unit pairs the ruling's own list
// names (millimeter/millimolar and micrometer/micromolar) once lowercased
// — a deliberate, harmless collapse: either original unit is real
// measurement noise this filter should remove either way. A Celsius
// temperature reaches this step as e.g. "40c" (no degree sign): "°" is not
// `\p{L}`/`\p{N}` and is already blanked to whitespace by this function's
// keyword branch below before this filter ever runs (splitting "40°C" into
// two SEPARATE too-short tokens that never reach here at all), so "c"
// stands in for "°C" only for the case where the source text had no degree
// sign to begin with (e.g. "-40C", typed plainly) — the shape the guide's
// own corpus produced. "k" likewise stands in for the bare Kelvin unit
// "K" — a short, occasionally ambiguous letter (a shorthand for "1000"
// elsewhere, e.g. "500k") that is an accepted cost of following the
// ruling's own example list verbatim, the same spirit as the "1000" noise
// §1bs.1 already accepts for a bare non-year integer.
const CLOSED_MEASUREMENT_UNITS = new Set([
  "v", "mv", "a", "ma", "mah", "ah", "wh", "kwh", "wh/kg", "w", "kw",
  "hz", "k", "c", "nm", "µm", "mm", "cm", "g", "mg", "kg", "ml", "µl",
  "mm", "µm", "%", "h", "min", "s", "ms", "ppm", "ev", "gpa", "mpa",
  "s/cm", "b",
]);

// A standalone 4-digit year, 1900-2099 — the range a project/challenge
// text's own calendar years realistically fall in.
const STANDALONE_YEAR = /^(?:19|20)\d{2}$/;

// True for a token this filter removes: (i) a standalone year, (ii) a
// number whose unit suffix is in the closed list above, (iii) a decimal
// number with no letters at all. Every other token — including a bare
// non-year integer ("18650", "1000") — returns false and stays; that
// residual noise is an ACCEPTED COST per §1bs.1, harmless at the bottom of
// the query budget (QUERY-BUDGET, §1az, already keeps every bare
// single-word entry, numeric or not, behind every phrase and tag).
function isGenericNumericToken(token: string): boolean {
  if (STANDALONE_YEAR.test(token)) return true;
  const match = token.match(LEADING_NUMBER);
  if (!match) return false;
  const [, numberPart, suffix] = match;
  if (!suffix) {
    // A pure number with no suffix at all: only a DECIMAL (contains ".")
    // is removed by rule (iii); a bare integer ("18650", "1000") stays.
    return numberPart.includes(".");
  }
  return CLOSED_MEASUREMENT_UNITS.has(suffix);
}

// QUERY-GENERIC-WORDS part 3 (ABC-JEV-INTEGRATION.md §1bu.8, the §1bs.8
// findings 1-2 from the fresh A's VERIFIED review, docs/jev-abc/
// QUERY-DISLIKE-A-20260930T111400Z.md): two gaps against §1bs's own intent,
// found after that item shipped, both closed here by ONE shared check
// reused at both call sites below (finding 2 is literally "apply the same
// filter" to a second place, so this is deliberately not two separate
// functions that could drift apart):
//
// Finding 1 — a year/unit/decimal token followed by a SENTENCE-FINAL period
// ("2024.", "99.9.", "4.2v.") kept the period and escaped
// `isGenericNumericToken` above: `STANDALONE_YEAR` and `LEADING_NUMBER`'s
// own suffix check are both anchored at the token's own end, and a bare "."
// is neither a digit nor a member of `CLOSED_MEASUREMENT_UNITS`. Stripped
// ONLY for this filter's own test, never from the token/chunk a caller
// keeps: an ordinary word that happens to end a sentence ("team.") is a
// completely different case (not a year/unit/decimal to begin with) and is
// untouched either way — this function only ever decides removal, never
// reshapes what survives.
//
// Finding 2 — a number+unit token that is its OWN comma/dash/etc.-delimited
// clause ("…, 500Wh/kg, …") reached `phrasesFromText`'s `longPhrases`
// (chunk/phrase) branch whole, because that branch's only filters were a
// word-count cap and the CJK backstop — it never ran the year/unit/decimal
// check `keywords` (below) already had. A chunk that is a SINGLE token (no
// internal whitespace) now gets that SAME check; a genuine multi-word
// PHRASE that merely CONTAINS such a token ("99.9 percent efficiency") is
// untouched — only a chunk that collapses to exactly one generic token is
// removed.
function isGenericNumericFragment(raw: string): boolean {
  return isGenericNumericToken(raw.toLowerCase().replace(/\.+$/, ""));
}

export function phrasesFromText(text: string | undefined, max = 8): string[] {
  if (!text) return [];
  const chunks = text
    // NON-ASCII-TEXT (§1bo.8(b)): a CJK run (any of the four scripts, or
    // CJK/fullwidth punctuation) becomes a hard chunk boundary BEFORE the
    // existing ASCII-delimiter split below ever runs — fed in as "\n", one
    // of that split's own existing delimiters, so this reuses the SAME
    // pipeline rather than adding a parallel one. Round 1 left a MIXED
    // chunk (Chinese prose with an embedded Latin phrase or formula)
    // untouched, reasoning only the Latin/formula terms needed to survive;
    // §1bo.8 overrides that for a Chinese materials researcher, mixed text
    // is the ordinary case, so this now isolates "solid-state electrolyte"
    // (a two-word Latin PHRASE between two CJK runs, with or without a
    // space next to them) and "LiCoO2" (a formula glued directly onto
    // surrounding Chinese with NO space at all) as their OWN chunks,
    // instead of leaving them trapped inside one CJK-plus-Latin blob the
    // old ASCII-only delimiter regex could not see into. Inert on
    // CJK-free text: the pattern requires at least one CJK-range codepoint
    // to match anything, so pure-ASCII input is untouched by this step.
    .replace(CJK_DELIMITER_RUN, "\n")
    // QUERY-QUALITY (ABC-JEV-INTEGRATION.md §1ay): also split on commas so a
    // real, comma-joined research sentence ("X, focused on Y and Z...")
    // yields actual 2-6 word phrases instead of starving this branch and
    // falling back to single generic words. Measured before this change: 0
    // of 3 fixtures produced a single multi-word phrase — every sentence ran
    // past the word cap below without a comma to break on (see
    // docs/jev-abc/QUERY-QUALITY-B-20260929T084721Z.md §2a).
    // QUERY-GENERIC-WORDS (§1bs.2): a period between two digits never
    // splits a chunk, so a decimal number or a version string stays whole
    // ("3.7V", "99.9%", "GPT-3.5") instead of being corrupted into two
    // fragments mid-number (docs/jev-abc/QUERY-GENERIC-WORDS-B-
    // 20260930T090811Z.md Q1 note 3); every other period (preceded or
    // followed by a non-digit — an ordinary sentence-ending period, in
    // particular) still splits exactly as before.
    // QUERY-GENERIC-WORDS (§1bs.3 / §1bo.9(a)): the em dash (U+2014), en
    // dash (U+2013) and ellipsis (U+2026) act as delimiters like a comma or
    // colon, so "——solid-state electrolyte" yields "solid-state
    // electrolyte" and an English phrase splits at an em dash too.
    .split(/[,;:\n\u2013\u2014\u2026]|(?<!\d)\.|\.(?!\d)|(?:\s+-\s+)/)
    .map((part) => part.trim())
    .filter((part) => part.length >= 4);

  const longPhrases = chunks
    .filter((part) => part.split(/\s+/).length <= 10)
    // NON-ASCII-TEXT (§1bo point 2 / §1bo.8): defensive backstop — see
    // isCjkOnlyText's own comment for why the delimiter step above already
    // makes this filter provably redundant in the common case.
    .filter((part) => !isCjkOnlyText(part))
    // QUERY-GENERIC-WORDS (§1bu.8 finding 2): a chunk that is a single token
    // (no internal whitespace) gets the same year/unit/decimal filter the
    // keyword tier below already applies — see isGenericNumericFragment's
    // own doc comment. A multi-word chunk (a genuine phrase) is untouched.
    .filter((part) => {
      const words = part.split(/\s+/).filter(Boolean);
      return words.length !== 1 || !isGenericNumericFragment(words[0]);
    })
    .slice(0, Math.ceil(max / 2));

  const keywords = Array.from(
    new Set(
      text
        .toLowerCase()
        // NON-ASCII-TEXT (§1bo point 2, round 1; broadened to 4 scripts in
        // §1bo.8): strip every CJK character before the keep-list below,
        // rather than deleting it as part of the SAME class the old
        // ASCII-only regex used — that corrupted, rather than cleanly
        // dropped, an adjacent accented Latin letter ("Müller"->"ller",
        // "électrolytes"->"lectrolytes", proven by execution in
        // docs/jev-abc/NON-ASCII-TEXT-B-20260930T071406Z.md Task 2 T4). A
        // Latin-script term or chemical formula embedded in CJK prose
        // ("LiCoO2", "NMC811") has no CJK characters of its own, so it is
        // untouched here and still survives below. Unlike the chunk
        // pipeline above, this branch does NOT go through
        // CJK_DELIMITER_RUN at all, so it needs this strip regardless —
        // this is what fixes a Japanese project text's kana ("における",
        // "しています") no longer surviving as bogus keyword tokens.
        .replace(CJK_SCRIPT_STRIP, " ")
        // NON-ASCII-TEXT (§1bo point 1): keep Unicode letters/digits
        // (`\p{L}\p{N}`), not the old ASCII-only `[a-z0-9]`, so an accented
        // Latin word stays whole instead of losing its accented letter and
        // surviving only as a corrupted fragment. Same small in-token
        // punctuation allowance as before (+, -, /, .).
        .replace(/[^\p{L}\p{N}+\-/.\s]/gu, " ")
        .split(/\s+/)
        .filter(
          (token) =>
            token.length >= 4 &&
            !STOPWORDS.has(token) &&
            // QUERY-GENERIC-WORDS (§1bs.1, and §1bu.8 finding 1 for a
            // sentence-final period glued to the token): a standalone
            // year, a number+unit token, or a bare decimal — see
            // isGenericNumericFragment's own doc comment above.
            !isGenericNumericFragment(token),
        ),
    ),
  ).slice(0, max);

  return cleanList([...longPhrases, ...keywords]).slice(0, max);
}

// QUERY-QUALITY (ABC-JEV-INTEGRATION.md §1ay): a reader's project/challenge
// text can be a whole multi-sentence paragraph. Sending that entire paragraph
// to a source adapter as one literal query wastes a query slot on every
// source that keeps only its first 2-3 queries (MAX_QUERIES, web/src/lib/
// sources/*.ts) — measured live at 117,064 in-window OpenAlex candidates
// with a 0/25 sampled qualify rate for the reader's own Required tag, versus
// 40-100% for a real short phrase (docs/jev-abc/QUERY-QUALITY-B-20260929T084721Z.md
// §2b). Only text that is already short enough to BE a phrase is worth
// sending verbatim; anything longer relies entirely on its own derived
// phrases (phrasesFromText) instead.
const MAX_LITERAL_QUERY_WORDS = 6;

// NON-ASCII-TEXT (§1bo point 1): written Chinese has no spaces between
// words, so `.split(/\s+/)` sees an entire unspaced CJK paragraph as the
// ONE "word" it has whitespace to split on, and MAX_LITERAL_QUERY_WORDS'
// guard below never fires — proven by execution: a 40+ character Chinese
// paragraph passed a <=6-word check as "1 word"
// (docs/jev-abc/NON-ASCII-TEXT-B-20260930T071406Z.md Task 2 T2). Each CJK
// character now counts as its own word toward the same cap, so a long
// Chinese paragraph can never qualify as "short" by hiding behind a lack of
// ASCII whitespace; a non-CJK run is still counted the old way.
function literalQueryWordCount(text: string): number {
  const cjkCharCount = (text.match(/\p{Script=Han}/gu) ?? []).length;
  const nonCjkWordCount = text
    .replace(/\p{Script=Han}/gu, " ")
    .split(/\s+/)
    .filter(Boolean).length;
  return cjkCharCount + nonCjkWordCount;
}

function literalQueryIfShort(text: string | undefined): string | undefined {
  const trimmed = (text ?? "").trim();
  if (!trimmed) return undefined;
  // NON-ASCII-TEXT (§1bo.8(a)/(b)): widened from round 1's "CJK-ONLY text
  // never becomes a literal query" to "text containing ANY CJK character
  // never becomes a literal query" — this function returns the whole
  // original string verbatim, so even one embedded CJK character would put
  // a CJK character into a query, which the invariant forbids outright. A
  // mixed text still reaches the queries, just through phrasesFromText's
  // Latin phrases/keywords/formulas below, never through a literal copy of
  // itself. (By construction, `trimmed` is now guaranteed CJK-free by the
  // time the word-count guard below runs, so its own CJK-character
  // counting is inert here — kept unchanged as the smaller, lower-risk
  // diff over deleting and re-proving an equivalent plain word count.)
  if (containsCjkCharacter(trimmed)) return undefined;
  return literalQueryWordCount(trimmed) <= MAX_LITERAL_QUERY_WORDS ? trimmed : undefined;
}

function projectQueries(req: FeedRequest, controls: Required<FeedControls>): string[] {
  const topics = req.topics ?? [];
  const methods = req.methods ?? [];
  const seedTexts = req.seedTexts ?? [];
  const project = textValue(req.intent?.project ?? { presence: "omitted" }) ?? req.project;
  const challenge = textValue(req.intent?.challenge ?? { presence: "omitted" }) ?? req.challenge;
  const projectTerms = cleanList([
    literalQueryIfShort(project),
    ...phrasesFromText(project, 5),
    literalQueryIfShort(challenge),
    ...phrasesFromText(challenge, 5),
    ...seedTexts.flatMap((seed) => phrasesFromText(seed, 5)),
  ]);

  // ABBREV-RECALL (ABC-JEV-INTEGRATION.md §1av) put the reader's own Required
  // tags ahead of project/challenge phrases so a tag (e.g. "LCO") that the
  // free-text project never happens to restate still earns a query slot
  // ahead of every source adapter's own MAX_QUERIES truncation (2-3, see
  // web/src/lib/sources/*.ts). QUERY-BUDGET (ABC-JEV-INTEGRATION.md §1az,
  // docs/jev-abc/QUERY-BUDGET-B-20260929T094059Z.md) goes further: it found
  // that even with tags ahead of phrases, (a) 2+ selected senses could still
  // push a Required tag out of a 2-slot source (measured: 2 senses + 2 tags
  // sent dblp/pubmed 0 of 2 tags), and (b) a bare generic single word (e.g.
  // "research") was filling a slot ahead of a genuine project phrase or a
  // tag-anchored combination, at ~0% measured qualify rate versus 12-44% for
  // a real phrase. The fix is a strict tier order — every tier fully spent
  // before the next is considered — built from the exact same query strings
  // as before (nothing invented, nothing dropped, no stop-list):
  //
  //   Tier 0  Required tags, then exact-sense queries. Tags lead every
  //           sense, so any source's cap, however small, is filled by tags
  //           first — min(tagCount, cap) tags survive every source, every
  //           time, even when senses exist (ruling 1, "R2").
  //   Tier 1  bare project phrases (projectTerms' own multi-word entries,
  //           original relative order).
  //   Tier 1b one `${tag} ${strongest phrase}` combination per tag, using
  //           projectTerms[0] — kept BEHIND the bare phrase (Tier 1), not
  //           ahead of it: a live measurement on 2 fixtures found this can
  //           either sharpen a source's results (nearly 4x the bare
  //           phrase's own qualify rate) or collapse them to almost nothing,
  //           and the collapse is the costlier failure to risk by default
  //           (ruling 2; follow-up QUERY-COMBO-MEASURE may revisit this with
  //           more evidence).
  //   Tier 2  bare single-word projectTerms entries (today's fallback,
  //           unchanged content — this is where "research" lives; it only
  //           moves later, out of every source's cap window whenever a
  //           phrase or a tag exists to fill it instead).
  //   Tier 3  the remaining combinations: topic+method (unchanged), then the
  //           topic+projectTerm combos beyond the one Tier 1b already spent.
  //
  // Focus modes (below) are untouched: tight focus reconstructs its own list
  // independently of this internal order, and exploratory's extra per-topic
  // queries are appended after every tier either way.
  const exactSenseQueries = exactCanonicalSenseQueries(req.intent?.selectedSenseConcepts ?? []);
  const isMultiWord = (term: string) => term.trim().split(/\s+/).length > 1;
  const phraseTerms = projectTerms.filter(isMultiWord);
  const wordTerms = projectTerms.filter((term) => !isMultiWord(term));
  const strongestPhrase = projectTerms[0];
  const baseQueries = [
    ...topics,
    ...exactSenseQueries,
    ...phraseTerms,
    ...(strongestPhrase ? topics.map((topic) => `${topic} ${strongestPhrase}`) : []),
    ...wordTerms,
    ...topics.flatMap((topic) => methods.slice(0, 3).map((method) => `${topic} ${method}`)),
    ...topics.flatMap((topic) => projectTerms.slice(1, 3).map((term) => `${topic} ${term}`)),
  ];

  const focusQueries =
    controls.focus === "tight"
      ? topics.length === 0
        ? baseQueries
        : [
            ...exactSenseQueries,
            ...baseQueries.filter((q) => topics.some((topic) => q.toLowerCase().includes(topic.toLowerCase()))),
          ]
      : controls.focus === "exploratory"
        ? [...baseQueries, ...topics.map((topic) => `${topic} applications`), ...topics.map((topic) => `${topic} limitations`)]
        : baseQueries;

  return cleanList(focusQueries).slice(0, controls.focus === "exploratory" ? 15 : 10);
}

export function compileSearchBrief(req: FeedRequest): SearchBrief {
  const controls: Required<FeedControls> = {
    ...DEFAULT_CONTROLS,
    ...(req.controls ?? {}),
  };

  const project = textValue(req.intent?.project ?? { presence: "omitted" }) ?? req.project ?? "";
  const challenge = textValue(req.intent?.challenge ?? { presence: "omitted" }) ?? req.challenge ?? "";
  const activeQuestions = cleanList([
    ...phrasesFromText(challenge, 8),
    ...phrasesFromText(req.seedTexts?.join(". "), 8),
  ]);
  const methods = cleanList(req.methods ?? []);
  const coreTopics = cleanList(req.topics ?? []);
  const avoid = cleanList([
    ...(req.negativeTopics ?? []),
    ...(controls.avoidReviews ? ["review", "survey", "overview"] : []),
    ...(controls.avoidBroadSurveys ? ["broad survey", "tutorial"] : []),
    ...(controls.avoidOldPapers ? ["older paper"] : []),
  ]);

  const learned = uploadInterestTerms(req.preferenceLedger);
  const generatedQueries = cleanList([
    ...projectQueries(req, controls).slice(0, learned.length ? 7 : 15),
    ...learned.map((term) => coreTopics[0] ? `${coreTopics[0]} ${term}` : term),
  ]);

  return {
    coreTopics,
    project,
    challenge,
    currentProjectSummary: project || req.seedTexts?.join(" ") || "",
    activeQuestions,
    mustInclude: controls.focus === "tight" ? coreTopics.slice(0, 4) : [],
    niceToHave: cleanList([...methods, ...activeQuestions]).slice(0, 12),
    avoid,
    methods,
    materialsOrDatasets: activeQuestions.filter((q) => /data|dataset|material|cathode|anode|electrolyte|benchmark/i.test(q)),
    timeWindow: controls.freshness,
    generatedQueries,
    sourceMix: SOURCE_MIX_WEIGHTS[controls.sourceMix],
    controls,
  };
}

export function briefToSeedTexts(req: FeedRequest, brief: SearchBrief): string[] {
  return cleanList([
    ...(req.seedTexts ?? []),
    brief.currentProjectSummary,
    ...brief.activeQuestions,
    ...brief.generatedQueries,
  ]);
}

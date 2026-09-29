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

function phrasesFromText(text: string | undefined, max = 8): string[] {
  if (!text) return [];
  const chunks = text
    // QUERY-QUALITY (ABC-JEV-INTEGRATION.md §1ay): also split on commas so a
    // real, comma-joined research sentence ("X, focused on Y and Z...")
    // yields actual 2-6 word phrases instead of starving this branch and
    // falling back to single generic words. Measured before this change: 0
    // of 3 fixtures produced a single multi-word phrase — every sentence ran
    // past the word cap below without a comma to break on (see
    // docs/jev-abc/QUERY-QUALITY-B-20260929T084721Z.md §2a).
    .split(/[.,;:\n]|(?:\s+-\s+)/)
    .map((part) => part.trim())
    .filter((part) => part.length >= 4);

  const longPhrases = chunks
    .filter((part) => part.split(/\s+/).length <= 10)
    .slice(0, Math.ceil(max / 2));

  const keywords = Array.from(
    new Set(
      text
        .toLowerCase()
        .replace(/[^a-z0-9+\-/.\s]/g, " ")
        .split(/\s+/)
        .filter((token) => token.length >= 4 && !STOPWORDS.has(token)),
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

function literalQueryIfShort(text: string | undefined): string | undefined {
  const trimmed = (text ?? "").trim();
  if (!trimmed) return undefined;
  return trimmed.split(/\s+/).length <= MAX_LITERAL_QUERY_WORDS ? trimmed : undefined;
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

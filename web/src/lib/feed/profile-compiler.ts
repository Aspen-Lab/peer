import type { FeedRequest } from "./types";
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
    .split(/[.;:\n]|(?:\s+-\s+)/)
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

function projectQueries(req: FeedRequest, controls: Required<FeedControls>): string[] {
  const topics = req.topics ?? [];
  const methods = req.methods ?? [];
  const seedTexts = req.seedTexts ?? [];
  const projectTerms = seedTexts.flatMap((seed) => phrasesFromText(seed, 5));

  const baseQueries = [
    ...topics,
    ...projectTerms,
    ...topics.flatMap((topic) => methods.slice(0, 3).map((method) => `${topic} ${method}`)),
    ...topics.flatMap((topic) => projectTerms.slice(0, 3).map((term) => `${topic} ${term}`)),
  ];

  const focusQueries =
    controls.focus === "tight"
      ? baseQueries.filter((q) => topics.some((topic) => q.toLowerCase().includes(topic.toLowerCase())))
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

  const activeQuestions = phrasesFromText(req.seedTexts?.join(". "), 8);
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
    currentProjectSummary: req.seedTexts?.join(" ") ?? "",
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

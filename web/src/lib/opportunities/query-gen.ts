// Profile-driven search-query generation for the jobs & events web-discovery
// adapters. Tier 0 builds template queries from the profile; when an LLM
// provider is available (Tier 2 / BYOK) it rewrites them into sharper,
// persona-aware queries. Always degrades to the templates — never throws.

import { resolveProvider } from "@/lib/llm/providers/registry";
import type { ProviderOverrideConfig } from "@/lib/llm/providers/types";
import { truncateText } from "@/lib/opportunities/shared";
import {
  EVENT_QUERY_BUDGET,
  JOB_INTERNSHIP_QUERY_BUDGET,
  JOB_QUERY_BUDGET,
} from "@/lib/opportunities/query-budget";
import type { CareerStage, IndustryAcademiaPreference } from "@/types";

export interface QueryGenProfile {
  topics: string[];
  softTopics?: string[];
  careerStage?: CareerStage;
  industryVsAcademia?: IndustryAcademiaPreference;
  locationPreferences?: string[];
  currentProject?: string;
}

// Best-effort in-process cache of LLM-generated queries. The two query-gen
// calls fire on every feed build; the profile inputs rarely change between
// loads, so caching avoids re-billing the model for identical output. Keyed by
// kind + current year + exactly the profile fields the prompt reads, so it
// invalidates automatically when any of them (or the year) changes.
const QUERY_CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6h
const queryCache = new Map<string, { queries: string[]; ts: number }>();

function summerCycleYear(nowMs: number): number {
  const now = new Date(nowMs);
  return now.getFullYear() + (now.getMonth() >= 6 ? 1 : 0);
}

function queryCacheKey(
  kind: string,
  profile: QueryGenProfile,
  nowMs: number,
): string {
  return JSON.stringify({
    kind,
    year: new Date(nowMs).getFullYear(),
    summerCycle: kind === "jobs" ? summerCycleYear(nowMs) : undefined,
    topics: profile.topics,
    softTopics: profile.softTopics ?? [],
    stage: profile.careerStage ?? "",
    dir: profile.industryVsAcademia ?? "",
    loc: profile.locationPreferences ?? [],
    proj: (profile.currentProject ?? "").slice(0, 500),
  });
}

function queryTerm(text: string): string {
  return text.trim().replace(/\s+/g, " ");
}

function canonicalQueryTerm(text: string): string {
  return queryTerm(text)
    .toLocaleLowerCase()
    .replace(/[-_/–—]+/g, " ")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function specificTopicsFirst(topics: string[]): string[] {
  return Array.from(new Set(topics.map(queryTerm).filter(Boolean))).sort(
    (a, b) => {
      const aWords = canonicalQueryTerm(a).split(" ").filter(Boolean).length;
      const bWords = canonicalQueryTerm(b).split(" ").filter(Boolean).length;
      const aMultiword = aWords > 1 ? 1 : 0;
      const bMultiword = bWords > 1 ? 1 : 0;
      return (
        bMultiword - aMultiword ||
        canonicalQueryTerm(b).length - canonicalQueryTerm(a).length ||
        a.localeCompare(b)
      );
    },
  );
}

function appendUnique(queries: string[], query: string): void {
  const normalized = queryTerm(query);
  if (
    normalized &&
    !queries.some(
      (existing) =>
        existing.toLocaleLowerCase() === normalized.toLocaleLowerCase(),
    )
  ) {
    queries.push(normalized);
  }
}

function eventPairQueries(
  topics: string[],
  softTopics: string[],
  year: number,
): string[] {
  if (topics.length === 0) return [];
  const candidates = specificTopicsFirst(softTopics).map((softTopic) => {
    const softCanonical = canonicalQueryTerm(softTopic);
    const relatedTopic = topics.find((topic) => {
      const topicCanonical = canonicalQueryTerm(topic);
      return (
        topicCanonical.length > 0 &&
        new RegExp(
          `(?:^|\\s)${topicCanonical.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:$|\\s)`,
          "u",
        ).test(softCanonical)
      );
    });
    return {
      query: `${relatedTopic ?? topics[0] ?? ""} ${softTopic} summit ${year}`,
      related: Boolean(relatedTopic),
      specificity: softCanonical.split(" ").filter(Boolean).length,
      length: softCanonical.length,
    };
  });

  return candidates
    .sort(
      (a, b) =>
        Number(b.related) - Number(a.related) ||
        b.specificity - a.specificity ||
        b.length - a.length ||
        a.query.localeCompare(b.query),
    )
    .slice(0, 3)
    .map((candidate) => queryTerm(candidate.query));
}

export function stageRoleTerms(stage: CareerStage | undefined): string[] {
  switch (stage) {
    case "PhD Year 1":
    case "PhD Year 2":
    case "PhD Year 3":
      return ["research intern", "PhD internship"];
    case "PhD Year 4":
    case "PhD Year 5":
    case "PhD Year 6":
      return ["research scientist", "research intern", "postdoc"];
    case "Postdoc":
      return ["postdoc", "research fellow", "research scientist"];
    case "Research Scientist":
      return ["research scientist", "senior research scientist"];
    default:
      return ["research scientist", "postdoc"];
  }
}

const INTERNSHIP_TERMS = [
  "research intern",
  "PhD intern",
  "co-op",
  "summer placement",
  "student researcher",
] as const;

function isPhdStage(stage: CareerStage | undefined): boolean {
  return /^PhD Year [1-6]$/.test(stage ?? "");
}

function isInternshipQuery(query: string): boolean {
  return /\b(?:intern(?:ship)?s?|co[\s-]?op|summer placement|student researcher)\b/i.test(
    query,
  );
}

function internshipQueries(
  profile: QueryGenProfile,
  nowMs: number,
): string[] {
  if (!isPhdStage(profile.careerStage)) return [];
  const topics = specificTopicsFirst(profile.topics);
  const cycleYear = summerCycleYear(nowMs);
  return INTERNSHIP_TERMS.slice(0, JOB_INTERNSHIP_QUERY_BUDGET).map(
    (term, index) => {
      const topic = topics[index % topics.length];
      return queryTerm(
        `${topic ? `${topic} ` : ""}${term} Summer ${cycleYear}`,
      );
    },
  );
}

function withInternshipLane(
  generalQueries: string[],
  profile: QueryGenProfile,
  nowMs: number,
): string[] {
  const lane = internshipQueries(profile, nowMs);
  const eligible = lane.length > 0;
  const generalBudget = JOB_QUERY_BUDGET - lane.length;
  const result: string[] = [];

  for (const query of generalQueries) {
    if (!eligible && isInternshipQuery(query)) continue;
    appendUnique(result, query);
    if (result.length >= generalBudget) break;
  }
  for (const query of lane) appendUnique(result, query);

  return result.slice(0, JOB_QUERY_BUDGET);
}

export function templateJobQueries(
  profile: QueryGenProfile,
  nowMs = Date.now(),
): string[] {
  const topics = specificTopicsFirst(profile.topics);
  const roles = stageRoleTerms(profile.careerStage);
  const generalQueries: string[] = [];
  // Iterate roles first so every declared topic reaches web search before a
  // second role for the first topic consumes the query budget.
  for (const role of roles) {
    for (const topic of topics) {
      appendUnique(generalQueries, `${topic} ${role}`);
    }
  }
  return withInternshipLane(generalQueries, profile, nowMs);
}

export function templateEventQueries(profile: QueryGenProfile): string[] {
  const year = new Date().getFullYear();
  const topics = specificTopicsFirst(profile.topics);
  const queries: string[] = [];

  // Give every required topic one broad query before spending more of the
  // budget on variants. This prevents a short acronym at the start of the
  // stored profile from crowding stronger terms out of web discovery.
  for (const topic of topics) {
    appendUnique(queries, `${topic} conference ${year}`);
    if (queries.length >= EVENT_QUERY_BUDGET) return queries;
  }

  // Related required/explore pairs are the most useful industry-discovery
  // queries. Place them before the adapter's first-eight cutoff.
  for (const pairQuery of eventPairQueries(
    topics,
    profile.softTopics ?? [],
    year,
  )) {
    appendUnique(queries, pairQuery);
    if (queries.length >= EVENT_QUERY_BUDGET) return queries;
  }

  const recruitingVariants = [
    (topic: string) => `${topic} career fair ${year}`,
    (topic: string) => `${topic} job fair recruiting expo ${year}`,
    (topic: string) => `${topic} hackathon ${year}`,
  ];
  for (let index = 0; index < recruitingVariants.length; index += 1) {
    const topic = topics[index % topics.length];
    if (!topic) break;
    appendUnique(queries, recruitingVariants[index](topic));
    if (queries.length >= EVENT_QUERY_BUDGET) return queries;
  }

  const variants = [
    (topic: string) => `${topic} summit ${year}`,
    (topic: string) => `${topic} symposium ${year} call for papers`,
    (topic: string) => `${topic} expo forum congress ${year}`,
  ];
  for (let round = 0; round < variants.length; round += 1) {
    for (let topicIndex = 0; topicIndex < topics.length; topicIndex += 1) {
      const topic = topics[topicIndex];
      const variant = variants[(round + topicIndex) % variants.length];
      appendUnique(queries, variant(topic));
      if (queries.length >= EVENT_QUERY_BUDGET) return queries;
    }
  }

  return queries.slice(0, EVENT_QUERY_BUDGET);
}

function parseQueryArray(raw: string, limit: number): string[] {
  const unfenced = raw.replace(/```(?:json)?/gi, "").trim();
  const start = unfenced.indexOf("[");
  const end = unfenced.lastIndexOf("]");
  if (start === -1 || end === -1 || end <= start) return [];
  try {
    const parsed = JSON.parse(unfenced.slice(start, end + 1));
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((q): q is string => typeof q === "string")
      .map((q) => q.trim())
      .filter((q) => q.length > 3 && q.length < 120)
      .slice(0, limit);
  } catch {
    return [];
  }
}

/**
 * LLM-refined queries for a surface. `kind` shapes the prompt; the result is
 * a plain string[] of web-search queries. Returns the template queries when
 * no provider resolves, the provider lacks generateJsonText, or output is
 * unparseable.
 */
/**
 * ABC-freemium 3-02 · Ruling 9 point 5 — see the matching note in
 * `feed/tier2-rerank.ts`. Same shape, same reason: this runs inside a pool build
 * with no entitled request in scope, and its guard is a numeric tier ceiling
 * rather than the chokepoint. `generateSearchQueries` is reached only when
 * `(req.aiTier ?? 0) >= 2` (`jobs/pipeline.ts:137`, `events/pipeline.ts:161`),
 * where the default is a literal 0.
 */
const QUERY_GEN_JUSTIFICATION = {
  kind: "entitlement-proved-by-tier-ceiling",
  where: "jobs|events/pipeline.ts — (req.aiTier ?? 0) >= 2, default 0",
} as const;

export async function generateSearchQueries(
  kind: "jobs" | "events",
  profile: QueryGenProfile,
  llmOverride?: ProviderOverrideConfig,
): Promise<string[]> {
  const nowMs = Date.now();
  const queryBudget =
    kind === "events" ? EVENT_QUERY_BUDGET : JOB_QUERY_BUDGET;
  const fallback =
    kind === "jobs"
      ? templateJobQueries(profile, nowMs)
      : templateEventQueries(profile);

  let provider;
  try {
    provider = resolveProvider(llmOverride, QUERY_GEN_JUSTIFICATION);
  } catch {
    return fallback;
  }
  if (!provider?.generateJsonText) return fallback;

  const cacheKey = queryCacheKey(kind, profile, nowMs);
  const cached = queryCache.get(cacheKey);
  if (cached && nowMs - cached.ts < QUERY_CACHE_TTL_MS) {
    return cached.queries.slice(0, queryBudget);
  }

  const exploreTopics = profile.softTopics ?? [];
  const persona = [
    `Research topics: ${profile.topics.join(", ") || "unknown"}`,
    exploreTopics.length > 0
      ? `Explore topics: ${exploreTopics.join(", ")}`
      : "",
    profile.careerStage ? `Career stage: ${profile.careerStage}` : "",
    profile.industryVsAcademia
      ? `Career direction: ${profile.industryVsAcademia}`
      : "",
    (profile.locationPreferences ?? []).length > 0
      ? `Preferred locations: ${profile.locationPreferences!.join(", ")}`
      : "",
    // Cap the project blurb so a long paste can't bloat the prompt; query
    // quality is driven by topics + role terms, not the full description.
    profile.currentProject
      ? `Current project: ${truncateText(profile.currentProject, 500)}`
      : "",
  ]
    .filter(Boolean)
    .join("\n");

  const target =
    kind === "jobs"
      ? "job openings this researcher would apply to (matching their seniority and academia/industry direction)"
      : "industry summits, expos, career fairs, job fairs, recruiting events, hackathons, forums, congresses, academic conferences, workshops, summer schools, and seminars this researcher would want to attend (any discipline, not just computer science)";

  try {
    const raw = await provider.generateJsonText({
      systemPrompt:
        "You write web search queries. Reply with ONLY a JSON array of query strings, no prose.",
      userPrompt: `Researcher profile:\n${persona}\n\nWrite ${queryBudget} diverse, specific web search queries to find ${target}. Include the current year where useful. JSON array only.`,
      maxTokens: 300,
      tier: "small",
    });
    const queries = parseQueryArray(raw, queryBudget);
    const generated = queries.length > 0 ? queries : fallback;
    const result =
      kind === "jobs"
        ? withInternshipLane(generated, profile, nowMs)
        : generated;
    queryCache.set(cacheKey, { queries: result, ts: nowMs });
    return result;
  } catch {
    return fallback;
  }
}

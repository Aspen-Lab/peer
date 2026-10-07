import type {
  CareerStage,
  IndustryAcademiaPreference,
  Job,
  OpportunityFacetCounts,
  OpportunityFacetSelection,
  OpportunityPlace,
  PreferenceConcept,
  PreferenceLedger,
} from "@/types";
import type { SearchConnectors } from "@/lib/feed/types";
import type { ProviderOverrideConfig } from "@/lib/llm/providers/types";
import type { SalaryPeriod } from "@/lib/opportunities/salary";

export type JobSourceId =
  | "remotive"
  | "arbeitnow"
  | "himalayas"
  | "adzuna"
  | "usajobs"
  | "jsearch"
  | "jobweb";

/** Normalized shape every job source adapter emits. */
export interface RawJobItem {
  /** `${source}:${stableId}` */
  id: string;
  source: JobSourceId;
  title: string;
  company?: string;
  location: string;
  place?: OpportunityPlace;
  isRemote: boolean;
  /** Plain text (HTML stripped), truncated. */
  description: string;
  /** Furniture-stripped fetched page text, used only for report summaries. */
  pageText?: string;
  /** A fetched page was read but did not prove ownership of this posting. */
  fetchedPostingScope?: "owned" | "unproven";
  /**
   * A23-04 / Ruling 62c. The fetched page's own declaration of what KIND of
   * thing it is. Recorded here the way `fetchedPostingScope` is, because the
   * page is only available during enrichment and the check that reads it runs
   * afterwards. Absent means "not fetched, or not an article" — both of which
   * fall to ADMISSION.
   */
  fetchedPageKind?: "article";
  url: string;
  postedAt?: string;
  employmentType?: string;
  salaryText?: string;
  salaryMin?: number;
  salaryMax?: number;
  salaryCurrency?: string;
  salaryPeriod?: SalaryPeriod;
  salaryIsEstimated?: boolean;
  applicationDeadline?: Job["applicationDeadline"];
  startDate?: Job["startDate"];
  /** B3-06. Same convention as the other `Job["..."]`-typed fields above. */
  startDateFlexible?: Job["startDateFlexible"];
  contractLength?: Job["contractLength"];
  applicationMaterials?: Job["applicationMaterials"];
  /** V26-J06 / Ruling 74. Populated only upstream during enrichment. */
  eligibility?: Job["eligibility"];
  /** V26-J06 / Ruling 74. The unit NAME only — never a headcount. */
  team?: Job["team"];
  /**
   * B4-11. Populated only upstream during enrichment, when the posting's own
   * fetched-page text explicitly says "hybrid" or "on-site"/"in-person" — no
   * source adapter sets this at ingestion. `scoredJobToJob()` prefers it over
   * its own cheap `location`-string check, which stays exactly as it was for
   * every job this field is absent for.
   */
  workMode?: Job["workMode"];
  roleKind?: Job["roleKind"];
  visa?: Job["visa"];
  tags: string[];
  preferenceSignals?: PreferenceConcept[];
}

/**
 * Per-request, bring-your-own data-source keys. Every adapter reads these
 * first and falls back to the matching env var, so a user can supply keys from
 * the browser without anything being stored server-side.
 */
export interface JobApiCredentials {
  adzunaAppId?: string;
  adzunaAppKey?: string;
  usajobsApiKey?: string;
  usajobsUserAgent?: string;
  jsearchApiKey?: string;
}

export interface JobsQuery {
  topics: string[];
  /** Search strings for API-backed sources, built from profile + stage. */
  queries: string[];
  locations: string[];
  careerStage?: CareerStage;
  industryPreference?: IndustryAcademiaPreference;
  limit: number;
  /** The reader's own Tavily key, when they sent one; with none, web search is dark. */
  webSearch?: {
    tavilyApiKey?: string;
  };
  apiKeys?: JobApiCredentials;
}

export interface JobSourceAdapter {
  id: JobSourceId;
  /** False when the reader's own credentials are missing from the request — the adapter is skipped. */
  enabled(query: JobsQuery): boolean;
  fetch(query: JobsQuery): Promise<RawJobItem[]>;
}

export interface JobsFeedRequest {
  topics: string[];
  softTopics?: string[];
  methods?: string[];
  seedTexts?: string[];
  preferenceLedger?: PreferenceLedger;
  careerStage?: CareerStage;
  industryVsAcademia?: IndustryAcademiaPreference;
  locationPreferences?: string[];
  authorisedCountries?: string[];
  currentProject?: string;
  topN?: number;
  perSourceLimit?: number;
  excludeIds?: string[];
  facets?: OpportunityFacetSelection;
  aiTier?: 0 | 1 | 2;
  searchConnectors?: SearchConnectors;
  apiKeys?: JobApiCredentials;
  llmOverride?: ProviderOverrideConfig;
}

export interface JobsFeedMeta {
  fetched: Partial<Record<JobSourceId, number>>;
  errors: Partial<Record<JobSourceId, string>>;
  beforeDedup: number;
  afterDedup: number;
  beforeScoreFloor: number;
  afterScoreFloor: number;
  returned: number;
  latencyMs: number;
  generatedAt: string;
}

export interface JobsFeedResponse {
  items: Job[];
  /** Complete scored pool for client-side facets and progressive reveal. */
  pool: Job[];
  facetCounts: OpportunityFacetCounts;
  meta: JobsFeedMeta;
}

/** Internal: a raw job with its Tier-0 score attached. */
export interface ScoredJobItem extends RawJobItem {
  score: number;
  matchedKeywords: string[];
  matchReason: string;
  facetPreferenceReason?: string;
}

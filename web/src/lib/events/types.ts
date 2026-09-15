import type {
  CareerStage,
  Event,
  EventType,
  IndustryAcademiaPreference,
  OpportunityFacetCounts,
  OpportunityFacetSelection,
  OpportunityPlace,
  PreferenceConcept,
  PreferenceLedger,
} from "@/types";
import type { SearchConnectors } from "@/lib/feed/types";
import type { ProviderOverrideConfig } from "@/lib/llm/providers/types";
import type { WebSearchProvider } from "@/lib/sources/types";

export type EventSourceId =
  | "ccfddl"
  | "confstech"
  | "researchseminars"
  | "eventweb";

/** Normalized shape every event source adapter emits. */
export interface RawEventItem {
  /** `${source}:${stableId}` */
  id: string;
  source: EventSourceId;
  name: string;
  type: EventType;
  /** ISO date of the event start; empty string when unknown. */
  startDate: string;
  endDate?: string;
  location: string;
  place?: OpportunityPlace;
  isOnline: boolean;
  /** Submission (CFP) deadline, ISO. */
  deadline?: string;
  registrationDeadline?: Event["registrationDeadline"];
  fees?: Event["fees"];
  activities?: Event["activities"];
  organisations?: Event["organisations"];
  people?: Event["people"];
  travelGrant?: Event["travelGrant"];
  invitationLetter?: Event["invitationLetter"];
  /** B4-10. The SCALE tile's field — genuinely never populated before. */
  expectedSize?: Event["expectedSize"];
  description: string;
  /** Kept separate from discovery text: only this value may reach a report. */
  reportSummary?: Event["reportSummary"];
  url: string;
  registrationUrl?: string;
  /** Venue prestige, e.g. "CCF A" / "CORE A*". */
  rank?: string;
  tags: string[];
  preferenceSignals?: PreferenceConcept[];
}

export interface EventsQuery {
  topics: string[];
  queries: string[];
  limit: number;
  webSearch?: {
    // RULING 75 — this surface never read a provider preference before; the
    // ruling's "all three surfaces uniform" requires it to start.
    provider?: WebSearchProvider;
    tavilyApiKey?: string;
    // ABC-freemium 1-05 · R-KEY-3 — see the identical block in `jobs/types.ts`.
    // **Absent means `false`.**
    systemSearchAllowed?: boolean;
    // ABC-freemium 1-05 · R-METER-2 — attribution for a system search.
    userId?: string | null;
  };
}

export interface EventSourceAdapter {
  id: EventSourceId;
  /** False when required env keys are missing — the adapter is skipped. */
  enabled(query: EventsQuery): boolean;
  fetch(query: EventsQuery): Promise<RawEventItem[]>;
}

export interface EventsFeedRequest {
  topics: string[];
  softTopics?: string[];
  methods?: string[];
  seedTexts?: string[];
  preferenceLedger?: PreferenceLedger;
  careerStage?: CareerStage;
  industryVsAcademia?: IndustryAcademiaPreference;
  locationPreferences?: string[];
  currentProject?: string;
  topN?: number;
  perSourceLimit?: number;
  excludeIds?: string[];
  facets?: OpportunityFacetSelection;
  aiTier?: 0 | 1 | 2;
  searchConnectors?: SearchConnectors;
  llmOverride?: ProviderOverrideConfig;
  /**
   * ABC-freemium 1-05 · R-KEY-3 — set by the route from
   * `entitlement.systemSearchAllowed`, never parsed from a request body.
   * **Absent means `false`.**
   */
  systemSearchAllowed?: boolean;
  /** ABC-freemium 1-05 · R-METER-2 — attribution for a system search. */
  userId?: string | null;
  /**
   * ABC-freemium 1-18 · R-POOL-2 — "refresh now". Set by the route from
   * `entitlement.poolRefreshAllowed`; a body that asks for it without the
   * entitlement gets nothing, because the route never forwards it.
   */
  poolRefresh?: boolean;
}

export interface EventsFeedMeta {
  fetched: Partial<Record<EventSourceId, number>>;
  errors: Partial<Record<EventSourceId, string>>;
  beforeDedup: number;
  afterDedup: number;
  beforeScoreFloor: number;
  afterScoreFloor: number;
  returned: number;
  latencyMs: number;
  generatedAt: string;
}

export interface EventsFeedResponse {
  items: Event[];
  /** Complete scored pool for client-side facets and progressive reveal. */
  pool: Event[];
  facetCounts: OpportunityFacetCounts;
  meta: EventsFeedMeta;
}

/** Internal: a raw event with its Tier-0 score attached. */
export interface ScoredEventItem extends RawEventItem {
  score: number;
  matchedKeywords: string[];
  relevanceReason: string;
  facetPreferenceReason?: string;
}

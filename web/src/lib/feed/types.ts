import type { SourceId } from "@/lib/sources/types";
import type {
  ScoringProfile,
  ScoreWeights,
  ScoredItem,
} from "@/lib/scoring/types";
import type { FeedControls, SearchBrief } from "./profile-compiler";
import type { ProviderOverrideConfig } from "@/lib/llm/providers/types";

export interface TavilySearchConnector {
  enabled?: boolean;
  apiKey?: string;
}

/**
 * RULING 75 — the Vertex Gemini search provider. It carries **no key**: the
 * credential is the server's own Vertex project, exactly as the LLM path
 * already uses it. `enabled` is an OPT-OUT — absent means "use it when Vertex
 * credentials are present and Tavily is not enabled", which is the ruling's
 * resolution order stated as a default.
 */
export interface GeminiSearchConnector {
  enabled?: boolean;
}

export interface SearchConnectors {
  tavily?: TavilySearchConnector;
  gemini?: GeminiSearchConnector;
}

export interface FeedRequest extends ScoringProfile {
  sources?: SourceId[];
  perSourceLimit?: number;
  topN?: number;
  weights?: ScoreWeights;
  controls?: FeedControls;
  aiTier?: 0 | 1 | 2;
  searchConnectors?: SearchConnectors;
  llmOverride?: ProviderOverrideConfig;
  /**
   * Advisor / PI affiliation discovery. When present, the pipeline pulls the
   * citation neighborhood of the advisor's seed works (recent papers citing
   * them) into the candidate pool as fresh external discovery.
   */
  affiliation?: { authorId: string; seedWorkIds?: string[] };
  /**
   * Paper IDs the caller has already shown to this user recently. The
   * pipeline filters these out AFTER scoring/reranking so a user opening
   * Peer twice in a day (or two days in a row) doesn't see the same
   * papers repeated. The live feed populates this from a localStorage-backed
   * "recently shown" map; the cron digest populates it from
   * briefing_deliveries.
   */
  excludeIds?: string[];
}

export interface FeedMeta {
  fetched: Partial<Record<SourceId, number>>;
  errors: Partial<Record<SourceId, string>>;
  beforeDedup: number;
  afterDedup: number;
  returned: number;
  latencyMs: number;
  generatedAt: string;
  searchBrief?: SearchBrief;
  aiTierUsed?: 0 | 1 | 2;
  llmProviderUsed?: ProviderOverrideConfig["provider"] | "default" | null;
}

export interface FeedResponse {
  items: ScoredItem[];
  meta: FeedMeta;
}

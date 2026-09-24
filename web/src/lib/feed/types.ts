import type { SourceId } from "@/lib/sources/types";
import type {
  ScoringProfile,
  ScoreWeights,
  ScoredItem,
} from "@/lib/scoring/types";
import type { FeedControls, SearchBrief } from "./profile-compiler";
import type { ProviderOverrideConfig } from "@/lib/llm/providers/types";
import type { TrustedPaperCacheScope } from "@/lib/opportunities/private-paper-cache";
import type { CompanySpendCapability } from "@/lib/security/company-spend";
import type { NormalizedFeedIntent } from "./intent";

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
  /** Versioned user-declared retrieval meaning; trusted metadata is excluded. */
  intent?: NormalizedFeedIntent;
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
  /** User-declared context; used only in the server-derived private identity. */
  project?: string;
  challenge?: string;
  /** Server-minted only; route bodies and query strings never populate this. */
  paperCacheScope?: TrustedPaperCacheScope;
  /** Server-only lease; never parsed from HTTP requests. */
  companySpendCapability?: CompanySpendCapability;
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
  /**
   * P4-S3 — ABC-JEV-INTEGRATION.md §1p.C.5/F. Set only on the signed-in,
   * `PEER_DASHBOARD_LEDGER=on` path (web/src/app/api/feed/route.ts's
   * `runLedgerAwareFeed`): the id of the owner's frozen batch for today's
   * local date. Absent on every other response (flag off, signed-out, or a
   * response built before P4-S3), so this is purely additive — an inline
   * literal union is used here rather than importing
   * `DashboardBatchStatus` from `@/lib/dashboard/delivery-ledger`, to avoid
   * a new cross-module type dependency from this file.
   */
  batchId?: string;
  batchStatus?: "prepared" | "served" | "acknowledged";
  /**
   * True only when a served/acknowledged batch's stored item payloads were
   * missing (a pre-P4-S3 "legacy" row with no `served_items` column value)
   * and had to be reconstructed from today's pool by canonical identity —
   * see route.ts's `resolveServedItems`. Never true for a batch this slice
   * itself minted, since every new batch always stores its served items.
   */
  batchReconstructed?: boolean;
  /**
   * P2-S6 — F-A-P2-05, ABC-JEV-INTEGRATION.md §1p.B(1) and the P2-S6 RULING
   * (§4). Present only when `PEER_RANK_FUSION=on` AND this response actually
   * ran a fresh pool build this call — reciprocal rank fusion is a
   * build-time-only computation, the same scoping `fetched`/`beforeDedup`/
   * `afterDedup` above already use (a same-day cache hit has no fresh RRF
   * computation to report, so this key is simply absent there too, exactly
   * like those three). Keyed by the returned item's own `id`; each entry is
   * the fused score plus every channel that voted for it and its
   * within-channel rank, exactly as `@/lib/scoring/rrf`'s `fuseRankings`
   * computed it. Absent entirely when the flag is off — never a
   * same-shaped object with fabricated/zero values.
   */
  rrf?: Record<string, { fusedScore: number; channels: { channel: string; rank: number }[] }>;
}

export interface FeedResponse {
  items: ScoredItem[];
  meta: FeedMeta;
}

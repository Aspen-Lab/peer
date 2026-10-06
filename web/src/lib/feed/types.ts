import type { SourceId } from "@/lib/sources/types";
import type {
  ScoringProfile,
  ScoreWeights,
  ScoredItem,
} from "@/lib/scoring/types";
import type { FeedControls, SearchBrief } from "./profile-compiler";
import type { ProviderOverrideConfig } from "@/lib/llm/providers/types";
import type { TrustedPaperCacheScope } from "@/lib/opportunities/private-paper-cache";
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
  /**
   * DISLIKE-CHANNEL (ABC-JEV-INTEGRATION.md §1br): declared HERE, not
   * inherited from `ScoringProfile` any more — this field used to reach
   * `ScoringProfile.negativeTopics`/`legacyNegativeTopics` too (both since
   * deleted as dead code; see combine.ts), but it was, and still is,
   * genuinely read by a separate, live mechanism:
   * `profile-compiler.ts`'s `compileSearchBrief` folds it into
   * `SearchBrief.avoid` (system + reader-declared terms `rerank.ts` demotes
   * on, never a hard drop). Request shapes stay accepted — an older
   * client/job/digest sending this field must not fail validation.
   */
  negativeTopics?: string[];
  /** Server-minted only; route bodies and query strings never populate this. */
  paperCacheScope?: TrustedPaperCacheScope;
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
  /**
   * EMPTY-STATE-REASON — ABC-JEV-INTEGRATION.md §1bb. Why `items` is empty,
   * computed once at the tail of `runFeedPipeline` from facts the read-time
   * chain already has (never a guess) — see that function's own doc comment
   * next to `computeEmptyReasonCode`. Present only when `returned.length ===
   * 0` and the waterfall resolved; structurally absent otherwise (same
   * conditional-spread convention `rrf`/`finalPool` already use), including
   * on every frozen-batch REPLAY (route.ts's `frozenFeedResponse`) — this is
   * a per-reader, per-read computation, never stored in the shared day-pool
   * or on the `DashboardBatch` row (§1bb.3: "live requests only now").
   */
  emptyReasonCode?: FeedEmptyReasonCode;
  /**
   * Jev on the reader's own key. Present ONLY when the reader sent a Jev key with
   * this request (and structurally absent otherwise, the same conditional-spread
   * convention `rrf` and `emptyReasonCode` use), so a reader without a key sees
   * no field and no hint. It is what Jev did when today's pool was built:
   * `applied` (every paper answered, Jev's order used), `partial` (enough
   * answered, 60 % or more, Jev's order used), `unavailable` (too few answered,
   * the briefing was screened without Jev) or `rejected` (Jev refused the key,
   * so it was screened without Jev). `screened` is how many of the `of` shortlisted
   * papers Jev answered, cache hits included. Counts only: never the key, never a
   * paper's text. Read from the cached pool, so a same-day cache hit reports it
   * too; a replay of an already-frozen dashboard batch carries none, and the
   * client keeps the last report it saw.
   */
  jevScreening?: {
    status: "applied" | "partial" | "unavailable" | "rejected";
    screened: number;
    of: number;
  };
}

/**
 * EMPTY-STATE-REASON — ABC-JEV-INTEGRATION.md §1bb. The closed, fixed set of
 * reasons a paper feed request can come back with nothing — named once here
 * so both the server (`FeedMeta.emptyReasonCode` above) and the client
 * (`empty-reason.ts`'s `EmptyReason`) declare the four strings a single time.
 */
export type FeedEmptyReasonCode =
  | "sources-unreachable"
  | "no-results"
  | "no-required-match"
  | "already-delivered";

/**
 * Runtime-checkable twin of `FeedEmptyReasonCode`, for the client: an HTTP
 * JSON response is `unknown` at runtime no matter what the type annotation
 * says, so a value this exact build doesn't recognize (an older client
 * talking to a newer server that has since added a 5th code, or any other
 * malformed value) must be detected, not just trusted — see
 * `empty-reason.ts`'s use of this array.
 */
export const FEED_EMPTY_REASON_CODES: readonly FeedEmptyReasonCode[] = [
  "sources-unreachable",
  "no-results",
  "no-required-match",
  "already-delivered",
];

export interface FeedResponse {
  items: ScoredItem[];
  meta: FeedMeta;
}

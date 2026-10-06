import { NextRequest, NextResponse, after } from "next/server";
import { runFeedPipeline, type FeedPipelineOptions } from "@/lib/feed/pipeline";
import type { FeedRequest, FeedResponse, FeedEmptyReasonCode, SearchConnectors } from "@/lib/feed/types";
import type { ProviderOverrideConfig } from "@/lib/llm/providers/types";
import type { SourceId } from "@/lib/sources/types";
import type { ScoredItem } from "@/lib/scoring/types";
import { cleanPreferenceLedger } from "@/lib/preferences/ledger";
import { resolveProvider } from "@/lib/llm/providers/registry";
import { aiTierCeiling, requireAiRequest } from "@/lib/security/ai-request";
import {
  createTrustedPaperCacheScope,
  type TrustedPaperCacheScope,
} from "@/lib/opportunities/private-paper-cache";
import { localCalendarDate } from "@/lib/opportunities/pool-cache";
import { createClient } from "@/lib/supabase/server";
import {
  requireCompanySpendCapability,
  type CompanySpendCapability,
} from "@/lib/security/company-spend";
import { normalizeFeedIntent, serializeFeedIntent, textValue, type NormalizedFeedIntent } from "@/lib/feed/intent";
import type { SelectedSenseConcept } from "@/lib/feed/senses";
import { identityForRawItem } from "@/lib/feed/paper-identity";
import {
  SupabaseDashboardDeliveryLedger,
  type DashboardBatch,
  type DashboardBatchStatus,
  type PaperIdentity,
} from "@/lib/dashboard/delivery-ledger";
import { dashboardLedgerEnabled } from "@/lib/dashboard/ledger-flag";
import {
  SupabaseRolloverCandidateStore,
  type RolloverCandidate,
} from "@/lib/dashboard/rollover-store";
import {
  resolvePositiveSeeds,
  resolveNegativeSeedPaperIds,
  SupabasePositiveSeedFeedbackRepository,
  anyPositiveSeedChannelEnabled,
  channelS2RecommendationsEnabled,
  type ResolvedPositiveSeed,
} from "@/lib/preferences/positive-seeds";
import {
  jevShadowEnabled,
  readJevCaps,
  readJevShadowConfig,
  resolveJevTransport,
  type JevTransport,
} from "@/lib/decisions/flag";
import { runJevShadow, type ShadowCandidate } from "@/lib/decisions/shadow";
import { PrivateDecisionCache } from "@/lib/decisions/private-decision-cache";
import { getCounterStore } from "@/lib/usage/counters";

const CACHE_HEADERS = {
  "Cache-Control": "private, no-store",
};

/**
 * §1p.F: "a truthful, non-cached 'new papers are temporarily unavailable'
 * result... instead of silently skipping exclusion." Manager's concrete
 * choice: 503, the same `private, no-store` header every other response on
 * this route already carries, and a machine-readable `ledger_unavailable`
 * code distinct from every other `error` string this route returns — a 200
 * with an empty `items` array would be indistinguishable from "no new papers
 * today," which is a different, true statement this response must not make.
 */
function ledgerUnavailableResponse(): NextResponse {
  return NextResponse.json(
    { error: "ledger_unavailable" },
    { status: 503, headers: CACHE_HEADERS },
  );
}

// P4-S3 (Round 3) — only ever used by `resolveServedItems`'s legacy-row
// reconstruction fallback below, to give the ranked-candidate match pass a
// generous ceiling to search (the day's whole ranked pool, not a display
// count). Deliberately a local constant rather than an import from
// `pipeline.ts` — this slice's pipeline.ts change is the identity-helper
// switch only (ABC-JEV-INTEGRATION.md §1p.G(4)), nothing else.
const RECONSTRUCTION_TOP_N = 200;

/**
 * Builds the frozen-batch-shaped FeedResponse. Deliberately does NOT carry
 * over fetched/errors/searchBrief/aiTierUsed diagnostics from any particular
 * pipeline run: on a race between two devices, `batch` may hold the OTHER
 * request's winning selection (§1p.C.5 — "serve the winner's stored items,
 * not your own selection"), so attaching THIS request's own pipeline
 * diagnostics to a possibly-different winner's items would misdescribe what
 * was actually served. `items.length` stands in for
 * beforeDedup/afterDedup/returned — this is a replay of an already-decided
 * batch, not necessarily a fresh build on this exact request.
 *
 * EMPTY-STATE-REASON — ABC-JEV-INTEGRATION.md §1bb ("live requests only
 * now"; guide §3 option (a)). `emptyReasonCode` is optional and, for the
 * exact same "possibly-different winner" reason as every other diagnostic
 * this function already omits, must only ever be passed by a caller that
 * just froze ITS OWN fresh pipeline result (the mint path, and only when
 * this call actually won the mint race) — never by a replay of an
 * already-existing batch, which has no fresh pipeline run of its own to
 * draw from. There is deliberately no `DashboardBatch` column for this: a
 * second-and-later same-day load of the same batch always omits it, even
 * though the original mint's own pipeline call did compute one — that is
 * the accepted cost of "live-only" (no schema change, no migration).
 */
function frozenFeedResponse(
  batch: DashboardBatch,
  status: DashboardBatchStatus,
  items: ScoredItem[],
  reconstructed: boolean,
  startedAt: number,
  emptyReasonCode?: FeedEmptyReasonCode,
): FeedResponse {
  return {
    items,
    meta: {
      fetched: {},
      errors: {},
      beforeDedup: items.length,
      afterDedup: items.length,
      returned: items.length,
      latencyMs: Date.now() - startedAt,
      generatedAt: batch.createdAt,
      batchId: batch.id,
      batchStatus: status,
      ...(reconstructed ? { batchReconstructed: true as const } : {}),
      ...(emptyReasonCode ? { emptyReasonCode } : {}),
    },
  };
}

/**
 * `batch.servedItems` is the normal path — DESIGN §5 of
 * docs/jev-abc/P4-B-20260924T0338Z.md: "store the served item payloads in
 * the batch so the frozen batch never depends on the day's pool cache."
 * Every batch THIS slice mints always stores them (see `runLedgerAwareFeed`
 * below), so the fallback here only fires for a batch that predates this
 * column. It re-derives today's ranked pool with `excludeIds` deliberately
 * omitted and WITHOUT `ledgerExclusions` — this is a REPLAY of papers
 * already decided for this exact batch, not a re-decision of membership (an
 * acknowledged batch's own papers are, by definition, already IN the ledger
 * exclusion set, so applying it here would wrongly filter out the very
 * papers being reconstructed) — and matches each stored identity back to a
 * candidate by canonical key, in the batch's own frozen order. An identity
 * with no match today (e.g. a source stopped carrying it) is simply
 * omitted — never padded.
 */
async function resolveServedItems(
  batch: DashboardBatch,
  pipelineReq: FeedRequest,
  now: Date,
): Promise<{ items: ScoredItem[]; reconstructed: boolean }> {
  if (batch.servedItems) {
    return { items: batch.servedItems as ScoredItem[], reconstructed: false };
  }
  const pool = await runFeedPipeline(
    { ...pipelineReq, excludeIds: undefined, topN: RECONSTRUCTION_TOP_N },
    { now },
  );
  const byKey = new Map(pool.items.map((item) => [identityForRawItem(item).key, item] as const));
  const items: ScoredItem[] = [];
  for (const identity of batch.papers) {
    const match = byKey.get(identity.key);
    if (match) items.push(match);
  }
  return { items, reconstructed: true };
}

/**
 * P4-S6-FIX (F-A-P4S6-01, docs/jev-abc/P4-S6-A-20260924T093528Z.md finding
 * 2; ABC-JEV-INTEGRATION.md §1g "...may compete tomorrow, subject to
 * current eligibility" and the §4 "Round 3 -- P4-S6 fresh A" ruling). A
 * rollover candidate's `admissionChannels` tag (e.g. "citation") records
 * how combine.ts's literal keyword gate was bypassed on the day the tag was
 * set -- under THAT day's request signal (affiliation, profile-level
 * admission channels). Once the user's declared intent (topics/project/
 * challenge/methods/exclusions/senses -- see feed/intent.ts) has actually
 * changed, that bypass must not keep applying silently: the candidate has
 * to re-earn its place through TODAY's own literal gate, exactly like a
 * candidate that never had a tag. Checked here, at READ time, before the
 * candidate is merged into the pipeline's candidate set -- pipeline.ts is
 * never touched: `rolloverCandidates` is just another RawItem[] by the
 * time it reaches runFeedPipeline, so stripping the tag on the object
 * handed in is sufficient (combine.ts's literal-gate line reads
 * `item.admissionChannels` off exactly this object; its own final
 * `{...item, score, ...}` spread carries whatever is left through
 * unchanged).
 *
 * A row with no stored `intentVersion` (a legacy row written before this
 * fix landed, or one upserted from a request with no structured intent at
 * all -- route.ts's GET path never builds one) is treated the same as a
 * mismatch: there is nothing on file to prove it still matches today, so
 * it must re-qualify too. `todayIntentVersion === undefined` is therefore
 * NEVER treated as matching a row whose own `intentVersion` is also
 * undefined -- two unknowns are not proof of a match. Only the tag is
 * removed -- the candidate itself, and every other field, is untouched, so
 * it still competes on literal overlap exactly like any other candidate.
 * Never boosts, never pads.
 */
function reconcileRolloverCandidateIntent(
  row: RolloverCandidate,
  todayIntentVersion: string | undefined,
): ScoredItem {
  const payload = row.payload as ScoredItem;
  const sameIntent = todayIntentVersion !== undefined && row.intentVersion === todayIntentVersion;
  if (sameIntent || payload.admissionChannels === undefined) return payload;
  const stripped: ScoredItem = { ...payload };
  delete stripped.admissionChannels;
  return stripped;
}

/**
 * The P4-S3 owner-scoped orchestration (ABC-JEV-INTEGRATION.md §1p.C.5,
 * §1p.F, DESIGN §5 of docs/jev-abc/P4-B-20260924T0338Z.md). Shared by POST
 * and GET — both key a batch on `pipelineReq.paperCacheScope.ownerId` + the
 * local calendar date, exactly like the pool cache does (`localCalendarDate`
 * is the SAME function `pipeline.ts` itself uses for the pool cache key, and
 * `now` is the SAME `Date` instance passed into `runFeedPipeline` below, so
 * the two can never disagree about "today" within one request).
 *
 *   - Flag off, or no signed-in owner: zero ledger construction, zero
 *     Supabase round-trip (§1p.C.9) — byte-identical to pre-P4-S3 behaviour.
 *   - A batch already exists for today: replayed from its stored items (or
 *     reconstructed, see `resolveServedItems`) — NO pipeline call, regardless
 *     of what this request's body asks for (§1p.C.5/C.8: same papers, same
 *     order, even after feedback, refresh or an intent change that day). A
 *     `prepared` batch (another request minted it but hasn't returned yet)
 *     is transitioned to `served` here rather than treated as absent.
 *   - No batch yet: exclusions are read (fail-closed — `unavailable` stops
 *     here, before any selection), the pipeline runs once, and the result is
 *     frozen via `prepareBatch`+`markServed`. The response always reflects
 *     whatever `prepareBatch` returns, not this call's own `result.items`
 *     directly — the two are usually the same, but on a race the OTHER
 *     request may have already won, and `prepareBatch`'s own contract is to
 *     hand back the winner (§1p.C.5: "new-batch allocation... first prepare
 *     wins").
 */
async function runLedgerAwareFeed(
  pipelineReq: FeedRequest,
  now: Date,
  // P2-S4b — server-resolved positive seeds (see resolvePositiveSeedsForRequest's
  // own doc comment), threaded into BOTH runFeedPipeline call sites below so
  // the feature works identically whether or not PEER_DASHBOARD_LEDGER is on
  // (an independent flag from the three positive-seed channel flags).
  positiveSeeds: readonly ResolvedPositiveSeed[],
  // P2-S4b-FIX (Round 3) — server-resolved negative seeds (see
  // resolveNegativeSeedPaperIdsForRequest's own doc comment), threaded the
  // same way and for the same reason as positiveSeeds above.
  negativeSeedPaperIds: readonly string[],
  // P3-S5 (Round 3) — the Jev shadow hook (see FeedPipelineOptions.
  // onFreshShortlist's own doc comment in pipeline.ts). Server-minted only,
  // exactly like ledgerExclusions/positiveSeeds above: only POST ever
  // builds one, and only when every P3-S5 gate condition holds (see the
  // call site in POST below). GET never passes this argument at all, so it
  // is `undefined` here and both runFeedPipeline calls below see output
  // byte-identical to before this parameter existed.
  onFreshShortlist?: FeedPipelineOptions["onFreshShortlist"],
): Promise<{ response: FeedResponse } | { unavailable: true }> {
  const startedAt = Date.now();
  const paperCacheScope = pipelineReq.paperCacheScope;

  if (!paperCacheScope || !dashboardLedgerEnabled()) {
    const response = await runFeedPipeline(pipelineReq, {
      ledgerExclusions: undefined,
      now,
      onFreshShortlist,
      positiveSeeds,
      negativeSeedPaperIds,
    });
    return { response };
  }

  const ledger = new SupabaseDashboardDeliveryLedger();
  const ownerId = paperCacheScope.ownerId;
  const localDate = localCalendarDate(now);

  // P4-S3-FIX (Round 3, F-A-P4S3-03, docs/jev-abc/P4-S3-A-20260924T0550Z.md):
  // `getBatch` fails OPEN to `null` on a configured-client read error
  // (delivery-ledger.ts's own documented read contract) -- indistinguishable
  // here from "no batch exists yet." That is safe, not truthful: if a batch
  // already exists and only this one read failed, the code below falls
  // through to a fresh pipeline run and a `prepareBatch` call, but
  // `prepareBatch`'s own idempotent contract (the migration's
  // `unique (owner_id, local_date)` constraint plus its insert-conflict-then-
  // getBatch-retry fallback, unit-tested in delivery-ledger.supabase.test.ts)
  // returns the PRE-EXISTING batch rather than a duplicate on a collision --
  // and the response below is always built from whatever `prepareBatch`
  // returns (`minted`), never from this call's own raw `result.items`
  // directly, so this composite path structurally cannot leak a fresh
  // selection in place of the true existing batch. Named, accepted cost: one
  // wasted pipeline run. See route.test.ts's dedicated composite-path test.
  const existing = await ledger.getBatch(ownerId, localDate);
  if (existing) {
    if (existing.status === "prepared") {
      // P4-S3-FIX (F-A-P4S3-01): `markServed` throws on a configured-client
      // write failure (delivery-ledger.ts's documented write contract).
      // Left uncaught, that would propagate through POST/GET as a generic
      // 500 instead of the truthful 503 every other ledger-unavailable path
      // on this route already returns.
      try {
        await ledger.markServed(ownerId, existing.id);
      } catch {
        return { unavailable: true };
      }
    }
    const status: DashboardBatchStatus = existing.status === "prepared" ? "served" : existing.status;
    const { items, reconstructed } = await resolveServedItems(existing, pipelineReq, now);
    return { response: frozenFeedResponse(existing, status, items, reconstructed, startedAt) };
  }

  const exclusionRead = await ledger.readExclusions(ownerId);
  if (exclusionRead.status === "unavailable") return { unavailable: true };

  // P4-S6 (Round 3) -- ABC-JEV-INTEGRATION.md §1g/§1p.C.4, DESIGN §6 of
  // docs/jev-abc/P4-B-20260924T0338Z.md. Read yesterday's never-presented
  // remainder BEFORE the pipeline runs so it can compete in the same
  // selection pass as freshly-fetched candidates (web/src/lib/feed/pipeline.ts's
  // `rolloverCandidates` option). `list` is contractually never-throwing
  // (rollover-store.ts's own fail-soft-in-both-directions contract), but the
  // `.catch` here is cheap, safe, extra insurance -- unlike a similar guard
  // on `ledger.readExclusions` above, which would be actively WRONG (that
  // read must fail closed), double-guarding a rollover read is always safe:
  // losing it only means fewer candidates compete today, never a delivered
  // paper returning (see rollover-store.ts's top-of-file comment).
  const rolloverStore = new SupabaseRolloverCandidateStore();
  const rolloverRows = await rolloverStore.list(ownerId, now).catch(() => []);
  // P4-S6-FIX (F-A-P4S6-01) -- today's own canonical intent snapshot, the
  // same stable fingerprint decision-cache.ts/private-paper-cache.ts
  // already use as intent identity (deliberately NOT `intent.version`,
  // which is a constant format tag). `pipelineReq.intent` is absent on the
  // GET path (no structured intent card at all), so `todayIntentVersion`
  // is `undefined` there -- see reconcileRolloverCandidateIntent's own doc
  // comment for why that always means "re-qualify," never "match."
  const todayIntentVersion = pipelineReq.intent ? serializeFeedIntent(pipelineReq.intent) : undefined;
  const rolloverCandidates = rolloverRows.map((row) =>
    reconcileRolloverCandidateIntent(row, todayIntentVersion),
  );

  const result = await runFeedPipeline(pipelineReq, {
    ledgerExclusions: exclusionRead.keys,
    rolloverCandidates,
    includeFinalPool: true,
    now,
    positiveSeeds,
    negativeSeedPaperIds,
    onFreshShortlist,
  });

  const papers: PaperIdentity[] = result.items.map((item) => {
    const identity = identityForRawItem(item);
    return { key: identity.key, aliases: identity.aliases };
  });
  // P4-S3-FIX (F-A-P4S3-01): same reasoning as above, for the mint path -- a
  // `prepareBatch` or `markServed` failure here happens AFTER a successful
  // pipeline selection but BEFORE it is durably recorded as served, so those
  // items must never reach the response. Report `unavailable`, exactly like
  // a read failure, instead of leaking an uncaught exception.
  let minted: DashboardBatch;
  try {
    minted = await ledger.prepareBatch(
      ownerId,
      localDate,
      papers,
      pipelineReq.intent?.version,
      result.items,
    );
    if (minted.status === "prepared") {
      await ledger.markServed(ownerId, minted.id);
    }
  } catch {
    return { unavailable: true };
  }

  // P4-S6 -- only the request whose OWN selection actually got frozen (won
  // the mint race) may store a rollover remainder from it. `prepareBatch`'s
  // own documented contract discards a losing call's `papers`/`servedItems`
  // and returns the winner's stored batch unchanged (P4-S3) -- so a losing
  // call's `minted.papers` will differ from the `papers` array THIS call
  // itself just submitted. Storing a remainder computed from a discarded
  // selection would silently corrupt rollover storage with candidates from
  // a selection nobody is actually being served. A losing call simply skips
  // this; the actual winner's own execution performs it correctly.
  const wonMintRace =
    minted.papers.length === papers.length &&
    minted.papers.every((p, i) => p.key === papers[i].key);
  if (wonMintRace) {
    const presentedIds = new Set(result.items.map((item) => item.id));
    // `finalPool` is only present because `includeFinalPool: true` was
    // passed above -- defensively defaults to [] rather than assuming it.
    const remainder = (result.finalPool ?? []).filter((item) => !presentedIds.has(item.id));
    if (remainder.length > 0) {
      await rolloverStore
        .upsert(
          ownerId,
          localDate,
          remainder.map((item) => {
            const identity = identityForRawItem(item);
            // P4-S6-FIX (F-A-P4S6-01) -- stamp today's own canonical intent
            // snapshot on every candidate written, whether brand new or an
            // existing key being refreshed. A later day whose own snapshot
            // still matches this one keeps the candidate's admissionChannels
            // tag; any other later day strips it (reconcileRolloverCandidateIntent above).
            return {
              key: identity.key,
              aliases: identity.aliases,
              payload: item,
              intentVersion: todayIntentVersion,
            };
          }),
        )
        .catch(() => {});
    }
  }

  const finalStatus: DashboardBatchStatus = minted.status === "prepared" ? "served" : minted.status;
  const { items, reconstructed } = await resolveServedItems(minted, pipelineReq, now);
  // EMPTY-STATE-REASON — only THIS call's own fresh `result` may donate its
  // `emptyReasonCode` to the response, and only when it actually won the
  // mint race (`wonMintRace`, computed above): a losing call's `result` was
  // computed against candidates/exclusions that are not necessarily what the
  // WINNER's frozen `items` above actually reflect, exactly like this
  // function already refuses to attach a losing call's fetched/errors/etc.
  return {
    response: frozenFeedResponse(
      minted,
      finalStatus,
      items,
      reconstructed,
      startedAt,
      wonMintRace ? result.meta.emptyReasonCode : undefined,
    ),
  };
}

/**
 * P2-S4b (Round 3) — F-A-P2-04 (4c/4d), ABC-JEV-INTEGRATION.md §1p.B(5).
 * Resolves a signed-in owner's positive seeds ONLY when at least one
 * positive-seed channel flag is on — skips the Supabase round-trip
 * entirely otherwise (the common, fully-off-by-default case). Anonymous
 * requests (`paperCacheScope` absent) never reach the resolver at all:
 * "Anonymous users: no seeds, no calls" (design brief). Fail-soft: a
 * resolver failure, or the repository constructor throwing on a bad/
 * unconfigured environment, both degrade to no seeds rather than failing
 * the feed request — `resolvePositiveSeeds` already catches internally,
 * this wraps again purely as cheap extra insurance around the
 * constructor call itself, the same "double-guarding is always safe"
 * discipline `runLedgerAwareFeed`'s own rollover read already uses.
 */
async function resolvePositiveSeedsForRequest(
  paperCacheScope: TrustedPaperCacheScope | undefined,
): Promise<ResolvedPositiveSeed[]> {
  if (!paperCacheScope || !anyPositiveSeedChannelEnabled()) return [];
  try {
    return await resolvePositiveSeeds(new SupabasePositiveSeedFeedbackRepository(), paperCacheScope.ownerId);
  } catch {
    return [];
  }
}

/**
 * P2-S4b-FIX (Round 3) — ABC-JEV-INTEGRATION.md §1p.B(5): "'Not interested'
 * supplies negative seeds." Same shape/contract as
 * `resolvePositiveSeedsForRequest` immediately above (anonymous gets
 * nothing, fail-soft, server-minted only), EXCEPT the gate: this checks
 * `channelS2RecommendationsEnabled()` specifically, NOT the broader
 * `anyPositiveSeedChannelEnabled()`. Negative seeds have exactly one
 * consumer today — the S2 Recommendations leg of
 * `fetchPositiveSeedCandidates` (`negativePaperIds`) — so resolving them
 * whenever only the OpenAlex-similarity or citation-neighbour flag is on
 * would be a Supabase round-trip for data nobody would ever use; the
 * narrower gate keeps this consistent with `resolvePositiveSeedsForRequest`'s
 * own "skip the round-trip entirely when it can't matter" reasoning.
 */
async function resolveNegativeSeedPaperIdsForRequest(
  paperCacheScope: TrustedPaperCacheScope | undefined,
): Promise<string[]> {
  if (!paperCacheScope || !channelS2RecommendationsEnabled()) return [];
  try {
    return await resolveNegativeSeedPaperIds(new SupabasePositiveSeedFeedbackRepository(), paperCacheScope.ownerId);
  } catch {
    return [];
  }
}

/**
 * P3-S5 (Round 3) — ABC-JEV-INTEGRATION.md §4 "P3-S5 DESIGN RULING"
 * (2026-09-24T11:29:31Z). The Jev shadow runs AFTER the response is sent,
 * never inside the request: up to 50 separate Jev calls at bounded
 * concurrency could add minutes to the first feed load of the day, and
 * shadow mode must never cause a user-visible regression. `runOnFreshShortlist`
 * (below, POST only) computes whether every gate condition holds and, if so,
 * builds ONE of these hooks and passes it to `runFeedPipeline` via
 * `runLedgerAwareFeed`. `pipeline.ts` invokes it synchronously with a copy of
 * the top-50 Tier-1 shortlist ONLY on a fresh pool build — see
 * `FeedPipelineOptions.onFreshShortlist`'s own doc comment.
 */
interface JevShadowHookInput {
  ownerId: string;
  entitled: boolean;
  intent: NormalizedFeedIntent;
  senseConcepts: readonly SelectedSenseConcept[];
  /**
   * JEV-DIRECT (§1aa) — resolved ONCE by the gate below via
   * `resolveJevTransport()` and threaded through unchanged; `runJevShadow`
   * never re-reads `process.env` for this (see `shadow.ts`'s own doc
   * comment and this item's checkpoint, design decision 2).
   */
  transport: JevTransport;
  perUserCap: number;
  globalCap: number;
  /** Broker-only. Present (from `readJevShadowConfig()`) only when `transport` is `"broker"`; absent and unused for `"direct"`. */
  brokerUrl?: string;
  brokerSecret?: string;
}

/**
 * Never throws, no matter what `runJevShadow` does — the final safety net
 * so a truly unanticipated failure can never surface as an unhandled
 * rejection inside `after()`. `runJevShadow` itself is already documented
 * never-throwing; this wrapper is belt-and-suspenders, matching this
 * codebase's established style for every other Jev-adjacent call boundary.
 */
async function runJevShadowSafely(
  input: JevShadowHookInput,
  shortlist: ReadonlyArray<ShadowCandidate>,
): Promise<void> {
  try {
    await runJevShadow({
      ownerId: input.ownerId,
      entitled: input.entitled,
      intent: input.intent,
      senseConcepts: input.senseConcepts,
      candidates: shortlist,
      cache: new PrivateDecisionCache(input.ownerId),
      transport: input.transport,
      brokerUrl: input.brokerUrl,
      brokerSecret: input.brokerSecret,
      perUserCap: input.perUserCap,
      globalCap: input.globalCap,
      store: getCounterStore(),
    });
  } catch {
    // See this function's own doc comment.
  }
}

/**
 * Builds the `onFreshShortlist` hook `pipeline.ts` will call synchronously
 * on a fresh build. `after()` throws when called outside a real request
 * scope (verified directly from Next's own source —
 * `web/node_modules/next/dist/server/after/after.js`: `workAsyncStorage.getStore()`
 * is `undefined` for e.g. a unit test that invokes a route handler
 * directly) — that is caught here and skipped silently, never run inline,
 * per the DESIGN RULING.
 */
function buildJevShadowHook(
  input: JevShadowHookInput,
): NonNullable<FeedPipelineOptions["onFreshShortlist"]> {
  return (shortlist) => {
    try {
      after(() => runJevShadowSafely(input, shortlist));
    } catch {
      // `after` was called outside a request scope -- skip the shadow
      // silently, never run it inline (P3-S5 DESIGN RULING).
    }
  };
}

function hasSupabaseAuthConfig(): boolean {
  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
      (process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY),
  );
}

async function privatePaperScope(
  input: Omit<Parameters<typeof createTrustedPaperCacheScope>[0], "ownerId">,
): Promise<TrustedPaperCacheScope | undefined> {
  // An absent/invalid session is intentionally not an error for the public
  // academic Tier-0 path. It simply means this request stays ephemeral.
  if (!hasSupabaseAuthConfig()) return undefined;
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    return user ? createTrustedPaperCacheScope({ ...input, ownerId: user.id }) : undefined;
  } catch {
    return undefined;
  }
}

function cleanStringArray(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  return input
    .map((t) => (typeof t === "string" ? t.trim() : ""))
    .filter((t) => t.length > 0);
}

function parseSources(input: unknown): SourceId[] | undefined {
  if (!Array.isArray(input)) return undefined;
  const valid: SourceId[] = [
    "openalex",
    "semantic_scholar",
    "arxiv",
    "dblp",
    "pubmed",
    "web",
    "hn",
  ];
  const out = input.filter((s): s is SourceId =>
    valid.includes(s as SourceId),
  );
  return out.length > 0 ? out : undefined;
}

async function companySpendForSources(
  sources: SourceId[] | undefined,
): Promise<CompanySpendCapability | NextResponse | undefined> {
  return sources?.includes("web") ? requireCompanySpendCapability() : undefined;
}

function parseAiTier(input: unknown): 0 | 1 | 2 | undefined {
  const n = typeof input === "number" ? input : Number(input);
  if (!Number.isFinite(n)) return undefined;
  if (n >= 2) return 2;
  if (n <= 0) return 0;
  return 1;
}

function cleanOptionalString(input: unknown): string | undefined {
  return typeof input === "string" && input.trim().length > 0
    ? input.trim()
    : undefined;
}

function parseSearchConnectors(input: unknown): SearchConnectors | undefined {
  if (!input || typeof input !== "object") return undefined;
  const maybeObject = input as Record<string, unknown>;
  const tavilyRaw =
    maybeObject.tavily && typeof maybeObject.tavily === "object"
      ? (maybeObject.tavily as Record<string, unknown>)
      : null;
  if (!tavilyRaw) return undefined;

  const enabled =
    typeof tavilyRaw.enabled === "boolean" ? tavilyRaw.enabled : undefined;
  const apiKey = cleanOptionalString(tavilyRaw.apiKey);
  const tavily =
    enabled === undefined && apiKey === undefined
      ? undefined
      : { enabled, apiKey };

  // RULING 75 — the gemini connector carries no key (the credential is the
  // server's own Vertex project) and only ever expresses an OPT-OUT. An absent
  // connector means "use it when Vertex is present and Tavily is not enabled".
  const gemini = parseGeminiConnector(maybeObject.gemini);

  if (!tavily && !gemini) return undefined;
  return { ...(tavily ? { tavily } : {}), ...(gemini ? { gemini } : {}) };
}

function parseGeminiConnector(
  input: unknown,
): { enabled: boolean } | undefined {
  if (!input || typeof input !== "object") return undefined;
  const enabled = (input as Record<string, unknown>).enabled;
  return typeof enabled === "boolean" ? { enabled } : undefined;
}

function parseLlmOverride(input: unknown): ProviderOverrideConfig | undefined {
  if (!input || typeof input !== "object") return undefined;
  const value = input as Record<string, unknown>;
  const provider = cleanOptionalString(value.provider);
  const apiKey = cleanOptionalString(value.apiKey);
  const model = cleanOptionalString(value.model);

  if (!provider || !apiKey) return undefined;
  if (!["openai", "gemini", "anthropic", "qwen", "deepseek"].includes(provider)) return undefined;

  return {
    provider: provider as ProviderOverrideConfig["provider"],
    apiKey,
    model,
  };
}

function parseAffiliation(
  input: unknown,
): { authorId: string; seedWorkIds?: string[] } | undefined {
  if (!input || typeof input !== "object") return undefined;
  const value = input as Record<string, unknown>;
  const authorId = typeof value.authorId === "string" ? value.authorId.trim() : "";
  if (!/^A\d+/.test(authorId)) return undefined;
  const seedWorkIds = Array.isArray(value.seedWorkIds)
    ? value.seedWorkIds.filter((x): x is string => typeof x === "string")
    : undefined;
  return { authorId, seedWorkIds };
}

function parseExcludeIds(input: unknown): string[] | undefined {
  if (!Array.isArray(input)) return undefined;
  const out = input
    .map((v) => (typeof v === "string" ? v.trim() : ""))
    .filter((v) => v.length > 0);
  // Cap to a reasonable size so a runaway client can't ship a huge payload.
  // 800 covers ~14 days of daily 10-paper digests with a wide margin.
  return out.length > 0 ? out.slice(0, 800) : undefined;
}

export async function POST(req: NextRequest) {
  let body: Partial<FeedRequest>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const normalized = normalizeFeedIntent(body);
  if (!normalized.ok) {
    return NextResponse.json(
      { error: "intent_required", focus: "Research focus" },
      { status: 400 },
    );
  }

  const intent = normalized.intent;
  const topics = intent.requiredConcepts;

  const softTopics = intent.preferredConcepts;
  const methods = intent.methods;
  const venues = cleanStringArray(body.venues);
  const seedTexts = cleanStringArray(body.seedTexts);
  const negativeTopics = intent.exclusions.map((exclusion) => exclusion.value);
  const preferenceLedger = cleanPreferenceLedger(body.preferenceLedger);
  const requestedAiTier = parseAiTier(body.aiTier) ?? 0;
  const llmOverride = parseLlmOverride(body.llmOverride);
  const gate = await requireAiRequest("paper-feed", 60, {
    allowAnonymous: true,
  });
  if (gate instanceof NextResponse) return gate;
  // A signed-out caller is capped at tier 0 whatever the body asks for, so the
  // provider is only ever resolved for a caller the gate let through as a
  // reader; a model then runs only if their own key resolves.
  const cappedTier = aiTierCeiling(requestedAiTier, gate);
  const aiProvider = cappedTier >= 2 ? resolveProvider(llmOverride) : null;
  const aiTier = cappedTier >= 2 && !aiProvider ? 0 : cappedTier;

  const project = textValue(intent.project);
  const challenge = textValue(intent.challenge);
  const sources = parseSources(body.sources);
  const companySpendCapability = await companySpendForSources(sources);
  if (companySpendCapability instanceof NextResponse) return companySpendCapability;

  const paperCacheScope = await privatePaperScope({
    project,
    challenge,
    topics,
    softTopics,
    methods,
    seedTexts,
    exclusions: negativeTopics,
    controls: body.controls,
    intent,
    aiTier,
  });

  // P3-S5 (Round 3) — ABC-JEV-INTEGRATION.md §4 "P3-S5 DESIGN RULING"
  // (2026-09-24T11:29:31Z). Every one of these seven conditions must hold
  // before this request schedules even one Jev shadow call; the hook stays
  // `undefined` otherwise and runFeedPipeline behaves byte-identically to
  // before onFreshShortlist existed (pipeline.shadow.test.ts proves that;
  // route.test.ts's "Jev shadow wiring" block proves this gate itself). The
  // `if` (not a boolean stored then reused) is deliberate: it is what lets
  // TypeScript actually narrow `paperCacheScope`/`gate.user` at the point
  // `.ownerId`/`.id` are read below, rather than merely asserting it.
  //
  // JEV-DIRECT (§1aa): the one changed condition is `jevBrokerEnabled()` ->
  // `resolveJevTransport() !== "disabled"` — the switch that picks between
  // the direct and broker transports (or neither). Unlike the old
  // `jevBrokerEnabled()` condition, building the hook no longer also
  // requires `readJevShadowConfig().status === "configured"`: that check
  // only means something for the broker transport (it only reports
  // "configured" once the broker URL+secret are both set) and would
  // wrongly block a direct-only deployment, which never sets those two.
  // Caps (`readJevCaps()`) are read regardless of transport — see
  // `flag.ts`'s own doc comment on why `readJevShadowConfig()`'s caps
  // are NOT reused here.
  let onFreshShortlist: FeedPipelineOptions["onFreshShortlist"];
  // Whether this reader may be shadowed at all is a sign-in test now, not a plan
  // test: there are no plans. (The shadow still needs a user id of its own, below.)
  const shadowEntitled = gate.user !== null;
  const jevTransport = resolveJevTransport();
  if (
    jevShadowEnabled() &&
    jevTransport !== "disabled" &&
    paperCacheScope !== undefined &&
    gate.user?.id !== undefined &&
    gate.user.id === paperCacheScope.ownerId &&
    shadowEntitled &&
    aiTier >= 2 &&
    Boolean(intent)
  ) {
    const caps = readJevCaps();
    const shadowConfig = readJevShadowConfig();
    onFreshShortlist = buildJevShadowHook({
      ownerId: paperCacheScope.ownerId,
      entitled: shadowEntitled,
      intent,
      senseConcepts: intent.selectedSenseConcepts,
      transport: jevTransport,
      perUserCap: caps.perUserDailyCap,
      globalCap: caps.globalDailyCap,
      brokerUrl: shadowConfig.status === "configured" ? shadowConfig.brokerUrl : undefined,
      brokerSecret: shadowConfig.status === "configured" ? shadowConfig.brokerSecret : undefined,
    });
  }

  const now = new Date();
  const positiveSeeds = await resolvePositiveSeedsForRequest(paperCacheScope);
  const negativeSeedPaperIds = await resolveNegativeSeedPaperIdsForRequest(paperCacheScope);
  const outcome = await runLedgerAwareFeed(
    {
      topics,
      softTopics: softTopics.length > 0 ? softTopics : undefined,
      methods: methods.length > 0 ? methods : undefined,
      venues: venues.length > 0 ? venues : undefined,
      seedTexts: seedTexts.length > 0 ? seedTexts : undefined,
      preferenceLedger:
        Object.keys(preferenceLedger).length > 0 ? preferenceLedger : undefined,
      negativeTopics: negativeTopics.length > 0 ? negativeTopics : undefined,
      sources,
      perSourceLimit: body.perSourceLimit,
      topN: body.topN,
      weights: body.weights,
      sourceWeights: body.sourceWeights,
      controls: body.controls,
      aiTier,
      searchConnectors: parseSearchConnectors(body.searchConnectors),
      llmOverride,
      affiliation: parseAffiliation(body.affiliation),
      excludeIds: parseExcludeIds(body.excludeIds),
      project,
      challenge,
      intent,
      paperCacheScope,
      companySpendCapability,
    },
    now,
    positiveSeeds,
    negativeSeedPaperIds,
    onFreshShortlist,
  );
  if ("unavailable" in outcome) return ledgerUnavailableResponse();

  return NextResponse.json(outcome.response, { headers: CACHE_HEADERS });
}

export async function GET(req: NextRequest) {
  const topics = (req.nextUrl.searchParams.get("topics") || "")
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);

  if (topics.length === 0) {
    return NextResponse.json(
      { error: "topics query param required (comma-separated)" },
      { status: 400 },
    );
  }

  const methods = (req.nextUrl.searchParams.get("methods") || "")
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);

  const sources = parseSources(
    (req.nextUrl.searchParams.get("sources") || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  );

  const topN = parseInt(req.nextUrl.searchParams.get("topN") || "30", 10);
  const companySpendCapability = await companySpendForSources(sources);
  if (companySpendCapability instanceof NextResponse) return companySpendCapability;

  const paperCacheScope = await privatePaperScope({
    topics,
    methods,
    aiTier: 0,
  });

  const now = new Date();
  const positiveSeeds = await resolvePositiveSeedsForRequest(paperCacheScope);
  const negativeSeedPaperIds = await resolveNegativeSeedPaperIdsForRequest(paperCacheScope);
  const outcome = await runLedgerAwareFeed(
    {
      topics,
      methods: methods.length > 0 ? methods : undefined,
      sources,
      topN: Number.isFinite(topN) ? topN : 30,
      paperCacheScope,
      companySpendCapability,
    },
    now,
    positiveSeeds,
    negativeSeedPaperIds,
  );
  if ("unavailable" in outcome) return ledgerUnavailableResponse();

  return NextResponse.json(outcome.response, { headers: CACHE_HEADERS });
}

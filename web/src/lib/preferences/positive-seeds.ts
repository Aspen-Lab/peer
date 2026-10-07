// P2-S4b (Round 3) — F-A-P2-04 (4c), ABC-JEV-INTEGRATION.md §1p.B(5),
// docs/jev-abc/P2-B-20260924T0345Z.md F-A-P2-04 point 3 (4c).
// P2-S4b-FIX (Round 3) — docs/jev-abc/P2-S4b-A-20260924T103042Z.md +
// ABC-JEV-INTEGRATION.md §4 manager ruling (2026-09-24T10:41:33Z): "liked"
// now counts as explicit positive feedback, and "Not interested" is now
// resolved here too, as NEGATIVE seeds — both were previously deferred.
// P2-S4b-FIX2 (Round 3) — F-A-P2S4bFIX-01, ABC-JEV-INTEGRATION.md §4
// manager ruling (2026-09-24T11:37:37Z): `feedback_events` is insert-only
// (see api/feedback/route.ts — its POST handler only ever `.insert()`s),
// so the SAME stored `item_id` can carry both a qualifying positive row
// and a qualifying "notInterested" row. Ruling: the most recent EXPLICIT
// event on a paper decides its seed role — positive only if the latest is
// saved/moreLikeThis/liked, negative only if the latest is notInterested.
// The full stored `feedback` value set is exactly
// `liked | saved | notInterested | moreLikeThis` (cross-confirmed against
// `api/feedback/route.ts`'s `Feedback` TS union AND
// `web/supabase/schema.sql`'s CHECK constraint on the column — both
// enumerate the identical 4 values) — no undo-type value (e.g.
// "unsave"/"unlike") exists today, so the ruling's conditional "remove
// from both sets" branch has no live case; see ALL_FEEDBACK_VALUES below.
//
// Resolves a SIGNED-IN owner's recent EXPLICIT feedback into typed seed
// identities the new retrieval channels (S2 recommendations, OpenAlex
// seed-similarity, citation neighbours) can use.
//   - POSITIVE (`resolvePositiveSeeds`): the owner's most recent
//     `POSITIVE_SEED_LIMIT` (10) PAPERS whose LATEST explicit event is
//     Save, "More like this", or "liked" (§1p.B(5) named Save/"More like
//     this" as EXAMPLES of explicit feedback, not an exhaustive list that
//     excludes "liked" — the manager ruled "liked" counts too).
//   - NEGATIVE (`resolveNegativeSeedPaperIds`): the owner's most recent
//     `NEGATIVE_SEED_LIMIT` (10) PAPERS whose LATEST explicit event is
//     "Not interested" (§1p.B(5): "'Not interested' supplies negative
//     seeds"). Resolved into BARE Semantic Scholar paper ids only, not a
//     full seed identity — the S2 Recommendations adapter's
//     `negativePaperIds` is the only consumer today (OpenAlex
//     seed-similarity/citation-neighbours have no negative-example
//     concept in this codebase), so a row with no resolvable S2 id
//     contributes nothing.
//
// P2-S4b-FIX2 latest-event-wins mechanics: both resolvers read a BOUNDED
// WINDOW of the owner's most recent feedback events across ALL 4 values
// (via the repository's single `recentFeedback` — replaces the old
// polarity-filtered `recentPositiveFeedback`/`recentNegativeFeedback`
// pair, since each resolver now needs to see the OTHER polarity's rows
// too, to know whether one of its own candidates was superseded — see
// RESOLUTION_WINDOW_MULTIPLIER below for the exact bound and why it
// practically can't starve the 10 most recent seeds), collapse that
// window to one (the most recent) row per stored `item_id` via
// `latestEventPerPaper`, THEN classify each survivor by its own
// `feedback` value and slice to the resolver's own limit. "Same paper" is
// scoped to the raw stored `item_id` (not cross-source canonical
// identity/title matching) — a disclosed, minimal-scope reading that
// directly fixes the finding's own concrete example (one card's Save
// clicked, later the same card's Not-interested clicked) and matches
// this module's pre-existing same-item_id dedup behavior; extending
// "same paper" to cross-source canonical matching was judged out of this
// fix's scope (see the P2-S4b-FIX2 checkpoint's DESIGN CHOICES).
//
// Never a live call: every function here only reads already-stored
// `feedback_events` rows (via the repository interface below) and does
// pure, synchronous parsing. No network fetch happens in this file.
//
// PRIVACY (§1c: "personal candidate membership... personal reading
// signals" must never enter shared data or logs): nothing here ever
// logs an owner id, item id, or title — see the "never logs" tests in
// positive-seeds.test.ts. Both resolvers are fail-soft end to end — a
// repository read that throws degrades to "no seeds" rather than
// failing the caller's feed request.
//
// FLAG-GETTER PLACEMENT (see this slice's checkpoint DESIGN CHOICES):
// the three positive-seed channel flags live here, not in
// `feed/pipeline.ts` (where the P2-S4a channel flags live), because
// `web/src/app/api/feed/route.test.ts` already fully replaces the
// `@/lib/feed/pipeline` module with `vi.mock("@/lib/feed/pipeline", () =>
// ({ runFeedPipeline: mocks.runFeedPipeline }))` — importing a flag
// function from there into `route.ts` would resolve to `undefined` in
// every existing test in that file. `pipeline.ts` itself also imports
// these same getters, so there is exactly one source of truth.

import { createAdminClient } from "@/lib/supabase/admin";
import {
  canonicalPaperKey,
  type CanonicalIdentity,
} from "@/lib/utils/canonical-identity";

/** Most recent N explicit positive-feedback events considered as seeds (§1p.B(5)). */
export const POSITIVE_SEED_LIMIT = 10;

/**
 * P2-S4b-FIX (Round 3): the three feedback values that count as an explicit
 * positive signal. §1p.B(5) named Save/"More like this" as examples; the
 * manager ruled 2026-09-24T10:41:33Z that "liked" is explicit positive
 * feedback too (docs/jev-abc/P2-S4b-A-20260924T103042Z.md PER-CHECK
 * VERDICT 5, ABC-JEV-INTEGRATION.md §4). Previously `["saved", "moreLikeThis"]`.
 */
const POSITIVE_FEEDBACK_VALUES = ["saved", "moreLikeThis", "liked"] as const;
type PositiveFeedbackValue = (typeof POSITIVE_FEEDBACK_VALUES)[number];

/** P2-S4b-FIX (Round 3) — most recent N "Not interested" events considered as negative seeds (§1p.B(5)); same bound as positive, for the same reason. */
export const NEGATIVE_SEED_LIMIT = 10;

/** The one feedback value §1p.B(5) names as a negative-seed signal. */
const NEGATIVE_FEEDBACK_VALUES = ["notInterested"] as const;
type NegativeFeedbackValue = (typeof NEGATIVE_FEEDBACK_VALUES)[number];

/**
 * P2-S4b-FIX2 (Round 3) — the full stored `feedback_events.feedback`
 * value set (`web/supabase/schema.sql`'s CHECK constraint; mirrors the
 * `Feedback` union in `api/feedback/route.ts`). Queried explicitly for
 * `recentFeedback` below (rather than omitting the `.in()` filter) so a
 * future 5th value this module doesn't yet know how to classify is
 * silently EXCLUDED from latest-event resolution, not misclassified,
 * until this module is deliberately updated.
 */
const ALL_FEEDBACK_VALUES = [...POSITIVE_FEEDBACK_VALUES, ...NEGATIVE_FEEDBACK_VALUES] as const;

/**
 * P2-S4b-FIX2 (Round 3) — how many of the owner's most recent feedback
 * events (ANY of the 4 values) `recentFeedback` reads, per unit of the
 * resolver's own requested `limit`: window = limit * this multiplier
 * (200 raw rows for the default limit of 10). Needed because a paper
 * whose true latest event IS this resolver's polarity can still have
 * older, now-superseded rows of EITHER polarity ahead of it in a naively
 * polarity-filtered query, and because unrelated papers' events share the
 * same combined stream.
 *
 * Bound rationale (disclosed, not a mathematical guarantee): a legitimate
 * top-`limit` paper is missed only if at least `window - limit` OTHER raw
 * events — from other papers' history, or from repeated toggling on a
 * small number of papers — rank more recent than it. Ordinary
 * explicit-feedback usage (a signed-in owner occasionally clicking
 * Save/"Not interested" on papers) never approaches that volume. A finite
 * window can never be airtight against UNLIMITED repeated toggling on one
 * paper (each toggle is one more raw row, and raw rows — not distinct
 * papers — are what bound this query, since the simple `eq/in/order/
 * limit` query shape here has no server-side "distinct paper" grouping
 * to lean on instead). This is the same class of accepted, disclosed
 * bounded-window trade-off as this codebase's other bounded reads (e.g.
 * the P4-S5b-FIX3 ruling's 800-id device-local exclusion cap). See the
 * P2-S4b-FIX2 checkpoint's EVIDENCE for the full reasoning.
 */
const RESOLUTION_WINDOW_MULTIPLIER = 20;

/**
 * P2-S4b-FIX2 (Round 3) — exported so tests (and any future caller) can
 * type an unclassified, freshly-read feedback row. Shape common to every
 * stored feedback row this module resolves, positive or negative alike.
 */
export interface StoredFeedbackRow {
  /** `"source:nativeId"`, exactly as stored — the same id form every RawItem carries. */
  itemId: string;
  feedback: string;
  /** Opaque JSONB, whatever the feedback route stored (see route.ts's additive `resolvedIds` capture). */
  payload: unknown;
  createdAt: string;
  /**
   * P2-S4b-FIX2 (Round 3) — `feedback_events.id`, a Postgres `bigserial`
   * primary key (web/supabase/schema.sql), strictly increasing in
   * insertion order. The sole reliable tie-break when two rows share an
   * identical `createdAt` timestamp. Always present on a real stored row.
   */
  id: number;
}

/**
 * One row already known to carry a POSITIVE feedback value — narrows
 * `StoredFeedbackRow` for callers that have already classified a row
 * (tests, mainly). P2-S4b-FIX2: no longer returned directly by the
 * repository — `recentFeedback` returns the unclassified
 * `StoredFeedbackRow` shape; classification happens AFTER
 * latest-event-wins resolution (`resolvePositiveSeeds` below).
 */
export interface PositiveSeedFeedbackRow extends StoredFeedbackRow {
  feedback: PositiveFeedbackValue;
}

/** Same, for a row already known to carry the NEGATIVE feedback value. */
export interface NegativeSeedFeedbackRow extends StoredFeedbackRow {
  feedback: NegativeFeedbackValue;
}

export interface PositiveSeedFeedbackRepository {
  /**
   * P2-S4b-FIX2 (Round 3) — the owner's most recent PAPER-kind feedback
   * rows across ALL 4 stored feedback values (`ALL_FEEDBACK_VALUES`),
   * most-recent-first, tie-broken by insertion id descending (see
   * `StoredFeedbackRow.id`'s doc comment), already bounded to
   * `windowSize`. Replaces the old polarity-specific
   * `recentPositiveFeedback`/`recentNegativeFeedback` pair: both
   * resolvers now need to see EVERY value to correctly apply the
   * latest-event-wins rule (a positive row can be superseded by a LATER
   * negative row on the same paper, and vice versa), not just their own
   * polarity. Never throws by contract — an implementation that CAN fail
   * (e.g. Supabase) must catch internally and resolve `[]`; both
   * resolvers also wrap every call defensively for an implementation
   * that doesn't hold that contract.
   */
  recentFeedback(ownerId: string, windowSize: number): Promise<StoredFeedbackRow[]>;
}

/** A resolved seed, typed for whichever channels can use it. Every field beyond `identity` is optional — a seed may only be usable by SOME channels. */
export interface ResolvedPositiveSeed {
  /** Canonical identity (key + aliases) — used for self-exclusion (never return a seed as its own recommendation). */
  identity: CanonicalIdentity;
  /** Bare OpenAlex work id (e.g. "W123"), when resolvable — feeds the citation-neighbour channel. */
  openalexWorkId?: string;
  /** Semantic Scholar paper id, when resolvable — feeds the S2-recommendations channel. */
  s2PaperId?: string;
  /** The saved paper's own title, when the client happened to send one (today: always, for a paper save) — feeds the OpenAlex seed-similarity channel's query text. */
  title?: string;
}

// ── In-memory reference implementation (tests, and the Supabase impl's own unconfigured fallback) ──

/**
 * P2-S4b-FIX (Round 3) — widened from `extends PositiveSeedFeedbackRow` to
 * `extends StoredFeedbackRow`: this store now holds BOTH positive and
 * negative feedback values (`record()` accepts any feedback string), so
 * `feedback` can no longer be typed to the positive-only union here.
 * P2-S4b-FIX2: `StoredFeedbackRow.id` doubles as this store's own
 * insertion-order counter (assigned by `record()` below) AND the DTO
 * field `recentFeedback` returns — no separate internal id concept needed.
 */
interface MemoryFeedbackRow extends StoredFeedbackRow {
  itemKind: "paper" | "event" | "job";
}

/**
 * Non-durable, process-memory-only reference implementation — mirrors
 * `MemoryRolloverCandidateStore`'s own export-not-per-test-file convention
 * (dashboard/rollover-store.ts) so it can double as the Supabase impl's
 * unconfigured-degrade fallback as well as a plain test double.
 */
export class MemoryPositiveSeedFeedbackRepository implements PositiveSeedFeedbackRepository {
  private readonly byOwner = new Map<string, MemoryFeedbackRow[]>();
  /**
   * P2-S4b-FIX2 (Round 3) — per-instance auto-increment, standing in for
   * the real table's `bigserial id`; the sole reliable tie-break when two
   * recorded rows share an identical `createdAt`.
   */
  private nextId = 1;

  /** Records one feedback row for a test (or the unconfigured-fallback path — never called there in practice, since nothing ever writes to it). */
  record(
    ownerId: string,
    row: {
      itemId: string;
      itemKind: "paper" | "event" | "job";
      feedback: string;
      payload?: unknown;
      createdAt?: string;
    },
  ): void {
    const rows = this.byOwner.get(ownerId) ?? [];
    rows.push({
      itemId: row.itemId,
      itemKind: row.itemKind,
      feedback: row.feedback,
      payload: row.payload ?? null,
      createdAt: row.createdAt ?? new Date().toISOString(),
      id: this.nextId++,
    });
    this.byOwner.set(ownerId, rows);
  }

  /**
   * P2-S4b-FIX2 (Round 3) — replaces `recentPositiveFeedback`/
   * `recentNegativeFeedback`: one query across ALL_FEEDBACK_VALUES
   * (rather than one polarity), sorted `createdAt` desc then `id` desc
   * (reliable tie-break), bounded to `windowSize`.
   */
  async recentFeedback(ownerId: string, windowSize: number): Promise<StoredFeedbackRow[]> {
    const rows = this.byOwner.get(ownerId) ?? [];
    return rows
      .filter(
        (r) =>
          r.itemKind === "paper" &&
          (ALL_FEEDBACK_VALUES as readonly string[]).includes(r.feedback),
      )
      .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt) || b.id - a.id)
      .slice(0, windowSize)
      .map((r) => ({
        itemId: r.itemId,
        feedback: r.feedback,
        payload: r.payload,
        createdAt: r.createdAt,
        id: r.id,
      }));
  }
}

// ── Supabase implementation ──

interface FeedbackEventRow {
  /** P2-S4b-FIX2 (Round 3) — the bigserial primary key; see StoredFeedbackRow.id's doc comment. */
  id: number;
  item_id: string;
  feedback: string;
  payload: unknown;
  created_at: string;
}

/**
 * Hand-rolled, narrow shape for exactly the calls this module makes — same
 * discipline as `dashboard/rollover-store.ts`'s `SelectQuery`/
 * `SupabaseRolloverClient` (nothing here is checked against supabase-js's
 * real, larger generic types, and none of this is exercised against a live
 * database — DB/RLS proof BLOCKED, §1o.5).
 */
interface SelectQuery extends PromiseLike<{ data: FeedbackEventRow[] | null; error: unknown }> {
  eq(column: string, value: string): SelectQuery;
  in(column: string, values: readonly string[]): SelectQuery;
  order(column: string, opts: { ascending: boolean }): SelectQuery;
  limit(n: number): SelectQuery;
}

interface FeedbackEventsTable {
  select(columns: string): SelectQuery;
}

interface SupabaseFeedbackClient {
  from(table: "feedback_events"): FeedbackEventsTable;
}

function configuredFeedbackClient(): SupabaseFeedbackClient | null {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return null;
  }
  try {
    return createAdminClient() as unknown as SupabaseFeedbackClient;
  } catch {
    return null;
  }
}

/**
 * Server-only adapter reading `feedback_events` directly (service-role
 * client, bypassing RLS — this module explicitly scopes every query to the
 * given `ownerId` itself rather than relying on session RLS, the same
 * discipline `dashboard/rollover-store.ts` and `dashboard/delivery-ledger.ts`
 * already use). Fail-soft: a configured-client query error, an unconfigured
 * environment, or a thrown exception all degrade to `[]` — "no seeds" is
 * always a safe, quiet degrade (never a broken feed request), unlike the
 * P4 delivery ledger's exclusion read, which must fail CLOSED for a
 * different, safety-critical reason.
 */
export class SupabasePositiveSeedFeedbackRepository implements PositiveSeedFeedbackRepository {
  private readonly client: SupabaseFeedbackClient | null;
  private readonly fallback = new MemoryPositiveSeedFeedbackRepository();

  constructor(client: SupabaseFeedbackClient | null = configuredFeedbackClient()) {
    this.client = client;
  }

  /**
   * P2-S4b-FIX2 (Round 3) — replaces `recentPositiveFeedback`/
   * `recentNegativeFeedback`. Queries ALL_FEEDBACK_VALUES (not one
   * polarity), ordered `created_at` desc then `id` desc (the reliable
   * tie-break — two `.order()` calls, PostgREST's own supported way to
   * express a secondary sort key), bounded to `windowSize`.
   */
  async recentFeedback(ownerId: string, windowSize: number): Promise<StoredFeedbackRow[]> {
    if (!this.client) return this.fallback.recentFeedback(ownerId, windowSize);
    try {
      const { data, error } = await this.client
        .from("feedback_events")
        .select("id, item_id, feedback, payload, created_at")
        .eq("user_id", ownerId)
        .eq("item_kind", "paper")
        .in("feedback", ALL_FEEDBACK_VALUES)
        .order("created_at", { ascending: false })
        .order("id", { ascending: false })
        .limit(windowSize);
      if (error || !data) return [];
      return data.map((r) => ({
        itemId: r.item_id,
        feedback: r.feedback,
        payload: r.payload,
        createdAt: r.created_at,
        id: r.id,
      }));
    } catch {
      // A read outage degrades to "no seeds", never a broken feed request —
      // the same reasoning rollover-store.ts's `list()` already documents.
      return [];
    }
  }
}

// ── Row -> seed parsing ──

interface ParsedItemId {
  source?: string;
  nativeId?: string;
}

/** Splits `"source:nativeId"` — the same id form every RawItem/feedback_events.item_id already carries. Never throws. */
export function parseItemId(itemId: string): ParsedItemId {
  const idx = itemId.indexOf(":");
  if (idx < 0) return {};
  const source = itemId.slice(0, idx);
  const nativeId = itemId.slice(idx + 1).trim();
  return source && nativeId ? { source, nativeId } : {};
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringField(obj: Record<string, unknown> | undefined, key: string): string | undefined {
  const v = obj?.[key];
  return typeof v === "string" && v.trim() ? v : undefined;
}

/**
 * Builds one resolved seed from a stored feedback row. Never throws — a
 * malformed/missing payload degrades to whatever identity IS derivable
 * (native item id alone, at minimum) rather than dropping the row.
 * Returns undefined only when the item id itself can't be parsed at all
 * (defensive — every row this codebase writes has a well-formed id).
 *
 * P2-S4b-FIX (Round 3): parameter widened from `PositiveSeedFeedbackRow` to
 * `StoredFeedbackRow` — this function never reads `.feedback`, only
 * `.itemId`/`.payload`, so it applies identically to a positive OR a
 * negative row; `resolveNegativeSeedPaperIds` below reuses it rather than
 * duplicating the same id/title-resolution logic.
 */
export function seedFromRow(row: StoredFeedbackRow): ResolvedPositiveSeed | undefined {
  const { source, nativeId } = parseItemId(row.itemId);
  if (!source || !nativeId) return undefined;

  const payload = isRecord(row.payload) ? row.payload : undefined;
  const resolvedIds = isRecord(payload?.resolvedIds) ? (payload!.resolvedIds as Record<string, unknown>) : undefined;
  const title = stringField(payload, "title");

  const openalexWorkId = source === "openalex" ? nativeId : stringField(resolvedIds, "openalexId");
  const s2PaperId = source === "semantic_scholar" ? nativeId : stringField(resolvedIds, "s2Id");
  const arxivId = source === "arxiv" ? nativeId : stringField(resolvedIds, "arxivId");
  const pmid = source === "pubmed" ? nativeId : stringField(resolvedIds, "pmid");

  const identity = canonicalPaperKey({
    source,
    id: row.itemId,
    title,
    externalIds: { openalexId: openalexWorkId, s2Id: s2PaperId, arxivId, pmid },
  });

  return { identity, openalexWorkId, s2PaperId, title };
}

/**
 * P2-S4b-FIX2 (Round 3) — collapses an already most-recent-first-ordered
 * list of feedback rows to one row per stored `itemId`: the FIRST
 * occurrence in iteration order, which — given the ordering contract
 * `recentFeedback` documents (`createdAt` desc, `id` desc tie-break) — IS
 * that item's most recent explicit event. Pure, synchronous, never
 * throws. Relative order of the surviving rows is preserved (still
 * most-recent-first overall). Exported: it's the crux of this fix's
 * correctness, so it gets direct unit tests in addition to the indirect
 * coverage through both resolvers below.
 */
export function latestEventPerPaper(rows: readonly StoredFeedbackRow[]): StoredFeedbackRow[] {
  const seen = new Set<string>();
  const latest: StoredFeedbackRow[] = [];
  for (const row of rows) {
    if (seen.has(row.itemId)) continue;
    seen.add(row.itemId);
    latest.push(row);
  }
  return latest;
}

/**
 * Resolves a signed-in owner's positive seeds, most-recent-first,
 * de-duplicated by canonical identity (repeated feedback on the same paper
 * — e.g. Save then "More like this" — collapses to one seed). Fail-soft
 * end to end: an empty/unknown owner id, or a repository that throws,
 * both resolve `[]` rather than rejecting.
 *
 * P2-S4b-FIX2 (Round 3): reads a bounded window across ALL feedback
 * values (not just positive ones) and applies `latestEventPerPaper`
 * before classifying, so a paper whose latest explicit event is actually
 * "Not interested" is correctly excluded here even though it has an
 * OLDER qualifying positive row too — see this file's header comment and
 * RESOLUTION_WINDOW_MULTIPLIER for the full ruling/bound rationale.
 */
export async function resolvePositiveSeeds(
  repo: PositiveSeedFeedbackRepository,
  ownerId: string,
  limit: number = POSITIVE_SEED_LIMIT,
): Promise<ResolvedPositiveSeed[]> {
  if (!ownerId) return [];
  const windowSize = limit * RESOLUTION_WINDOW_MULTIPLIER;
  let rows: StoredFeedbackRow[];
  try {
    rows = await repo.recentFeedback(ownerId, windowSize);
  } catch {
    return [];
  }

  const latest = latestEventPerPaper(rows.slice(0, windowSize));

  const seeds: ResolvedPositiveSeed[] = [];
  const seenKeys = new Set<string>();
  for (const row of latest) {
    if (!(POSITIVE_FEEDBACK_VALUES as readonly string[]).includes(row.feedback)) continue;
    const seed = seedFromRow(row);
    if (!seed || seenKeys.has(seed.identity.key)) continue;
    seenKeys.add(seed.identity.key);
    seeds.push(seed);
    if (seeds.length >= limit) break;
  }
  return seeds;
}

/**
 * P2-S4b-FIX (Round 3) — §1p.B(5): "'Not interested' supplies negative
 * seeds." Resolves a signed-in owner's most recent "Not interested" rows
 * into BARE Semantic Scholar paper ids for the S2 Recommendations
 * adapter's `negativePaperIds` — its only consumer today. A row with no
 * resolvable S2 id (native S2 save, or a cross-referenced
 * `payload.resolvedIds.s2Id`) contributes nothing, same "degrade rather
 * than guess" discipline `seedFromRow` already applies. De-duplicated,
 * most-recent-first. Fail-soft end to end, identical contract to
 * `resolvePositiveSeeds`.
 *
 * P2-S4b-FIX2 (Round 3): same latest-event-wins mechanics as
 * `resolvePositiveSeeds` above (bounded ALL-values window, then
 * `latestEventPerPaper`, then classify) — a paper whose latest explicit
 * event is actually positive is correctly excluded here even though it
 * has an OLDER qualifying "Not interested" row too.
 */
export async function resolveNegativeSeedPaperIds(
  repo: PositiveSeedFeedbackRepository,
  ownerId: string,
  limit: number = NEGATIVE_SEED_LIMIT,
): Promise<string[]> {
  if (!ownerId) return [];
  const windowSize = limit * RESOLUTION_WINDOW_MULTIPLIER;
  let rows: StoredFeedbackRow[];
  try {
    rows = await repo.recentFeedback(ownerId, windowSize);
  } catch {
    return [];
  }

  const latest = latestEventPerPaper(rows.slice(0, windowSize));

  const ids: string[] = [];
  const seen = new Set<string>();
  for (const row of latest) {
    if (!(NEGATIVE_FEEDBACK_VALUES as readonly string[]).includes(row.feedback)) continue;
    const s2PaperId = seedFromRow(row)?.s2PaperId;
    if (!s2PaperId || seen.has(s2PaperId)) continue;
    seen.add(s2PaperId);
    ids.push(s2PaperId);
    if (ids.length >= limit) break;
  }
  return ids;
}

// ── Channel flags — server-only, literal "on", default off (§1o.5, §1p.B(5)) ──
//
// Never settable from a request body: these read ONLY `process.env`, the
// same "server-minted only" idiom `pipeline.ts`'s P2-S4a flags and
// `FeedRequest`'s `paperCacheScope` already use.
// Sending seed ids to S2 discloses the owner's interests — per §1p.B(5)
// this channel stays flag-off and live use needs explicit user
// authorization regardless of how complete the adapter code is.

function flagOn(name: string): boolean {
  return process.env[name]?.trim().toLowerCase() === "on";
}

export function channelS2RecommendationsEnabled(): boolean {
  return flagOn("PEER_CHANNEL_S2_RECOMMENDATIONS");
}

export function channelOpenAlexSeedSimilarityEnabled(): boolean {
  return flagOn("PEER_CHANNEL_OPENALEX_SEED_SIMILARITY");
}

export function channelPositiveSeedCitationsEnabled(): boolean {
  return flagOn("PEER_CHANNEL_POSITIVE_SEED_CITATIONS");
}

/** True when ANY of the three positive-seed channels is enabled — route.ts uses this to decide whether resolving seeds is worth a Supabase round-trip at all. */
export function anyPositiveSeedChannelEnabled(): boolean {
  return (
    channelS2RecommendationsEnabled() ||
    channelOpenAlexSeedSimilarityEnabled() ||
    channelPositiveSeedCitationsEnabled()
  );
}

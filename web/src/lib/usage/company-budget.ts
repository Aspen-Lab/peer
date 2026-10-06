/**
 * The shared daily dollar cap on Peer's company-funded AI calls.
 *
 * SPEND-CAP (ABC-JEV-INTEGRATION.md §1t point 4; design guide
 * docs/jev-abc/SPEND-CAP-B-20260925T042147Z.md; manager rulings §1v R1-R11).
 *
 * ── WHAT THIS IS, IN ONE PARAGRAPH ───────────────────────────────────────────
 *
 * Every company-funded model call (the system Gemini key, never a reader's
 * own BYOK key) is hooked at `llm/providers/metered.ts`'s `meterCall` —
 * RESERVE an estimated worst-case cost before the call, PROCEED, then SETTLE
 * to the actual cost once the provider reports real token counts. Two rolling
 * daily counters (one per signed-in user, one across everyone) live in the
 * EXISTING `usage_counters` table/RPC under a new, disjoint key prefix
 * (`company_spend:`) — no new table, no new RPC. Two NEW, dashboard-editable
 * config tables (`company_spend_caps`, `company_model_prices`) hold the two
 * adjustable dollar ceilings and the per-model prices; see the migration.
 *
 * ── R9 — THE MASTER SWITCH ───────────────────────────────────────────────────
 *
 * `companySpendCapEnabled()` gates the WHOLE mechanism. Default OFF means
 * exactly today's behaviour: no config read, no counter call, not even a
 * cache check — `meterCall` skips this module entirely. This matters because
 * the mechanism fails CLOSED: deploying the code before the migration is
 * applied (or before either config table has rows) would otherwise stop every
 * company-funded call the moment it shipped.
 *
 * ── R1 — DEFAULTS ─────────────────────────────────────────────────────────────
 *
 * $5.00/day global, $0.50/day per signed-in user — conservative code-level
 * fallbacks used ONLY when a cap row is genuinely absent (never on a read
 * failure — see `readCompanyBudgetConfig`'s three-outcome table below). The
 * migration seeds no rows on purpose. B's guide proposed $30/$1.50 with worked
 * arithmetic; that arithmetic is kept as the scaling reference in the design
 * doc, not as the shipped default.
 *
 * **The price table has NO code-level default.** A cap row can fall back to
 * a safe number when absent; a price row cannot, because guessing a price
 * risks silently under-charging a real bill. A model with no price row is
 * simply unestimable, and every call that would need it fails closed with
 * `price_unreadable`. Concretely: turning the flag on before ANY price rows
 * are entered makes Peer's AI refuse every company-funded call it would
 * otherwise make, visible as `kind: "breaker"` `usage_events` rows — this is
 * by design (R9), not a bug, and is spelled out in the readiness doc.
 *
 * ── R2 — THE ONE NO-OWNER CALL SITE ──────────────────────────────────────────
 *
 * `feed/tier2-rerank.ts`'s rerank call (and any other call made with no reader
 * attached) always has `userId === null` at this layer. Manager ruling: count it against the
 * GLOBAL cap only, never a per-user key — accepted as a scoped gap (sub-cent
 * worst case, already bounded by the feed route's own hourly count limit).
 * `reserveCompanySpend` below enforces this structurally: the per-user branch
 * is simply never entered when `userId` is `null`.
 *
 * ── UNESTIMABLE CALL SHAPES (escape clause, recorded as POLICY) ──────────────
 *
 * `estimateCompanySpend` fails closed with `unestimable_call` for two shapes
 * this design cannot honestly price, both flagged rather than guessed at:
 *
 *  1. `testConnection` — no call site anywhere in production today (grepped;
 *     only test files call it), but `meterProvider` wraps it unconditionally
 *     like every other method (R11), and its own implementation
 *     (`gemini.ts`) sends NO `maxTokens`, so its output cap is structurally
 *     unbounded — the exact same shape B's guide already flagged for
 *     `decisions/gemini-fallback.ts`. If a future caller ever wires this up
 *     in a non-BYOK context, it will fail closed until someone gives it a
 *     bounded `maxTokens` first.
 *  2. A `generateJsonText`/`generateVisionJsonText` call reached with NO
 *     `maxTokens` at all. Every one of today's 9 real call sites passes one;
 *     this guards the 10th call site someone adds later and forgets to.
 */
import { createAdminClient } from "@/lib/supabase/admin";
import {
  breakerTripped,
  endOfUtcDay,
  getCounterStore,
  type CounterStore,
} from "./counters";
import {
  GEMINI_API_MODEL_CHAIN,
  chainForTier,
  outputCap,
  type ModelTarget,
} from "@/lib/llm/providers/gemini";
import type { ModelTier } from "@/lib/llm/providers/types";
import { CJK_CHARS_PER_TOKEN, LATIN_CHARS_PER_TOKEN, isCjkHeavy } from "@/lib/decisions/jev-contract";

// ── The master switch (R9) ───────────────────────────────────────────────────

/**
 * Literal `"on"` only, trimmed + lower-cased — the same convention every
 * other flag in this repo uses (`decisions/flag.ts`, `dashboard/ledger-flag.ts`,
 * `feed/pipeline.ts`). Anything else (unset, `"true"`, `"1"`, a typo) keeps
 * today's exact behaviour: no config read, no counter call.
 */
export function companySpendCapEnabled(): boolean {
  return process.env.PEER_COMPANY_SPEND_CAP?.trim().toLowerCase() === "on";
}

// ── R1 defaults ───────────────────────────────────────────────────────────────

export const DEFAULT_GLOBAL_DAILY_USD = 5.0;
export const DEFAULT_PER_USER_DAILY_USD = 0.5;

/** R8 — a conservative flat per-image token estimate; settlement refunds to actual usage. */
export const DEFAULT_VISION_TOKENS_PER_IMAGE = 1500;

/**
 * The literal `gemini.ts:314`/`gemini.ts` (API-key provider) hardcode for
 * `generateDigest`'s `maxTokens` — never passed by the caller, so the
 * estimator cannot read it off `args`. `company-budget.test.ts` asserts this
 * constant and the two literal `1500`s inside `gemini.ts` never drift apart,
 * the same idiom `spend-scans.test.ts` uses for exactly this risk.
 */
export const DIGEST_MAX_OUTPUT_TOKENS = 1500;

// ── Key layout (mirrors `security/jev-broker-auth.ts`'s `jevPerUserDayKey`/`jevGlobalDayKey` exactly) ──

function utcDaySegment(now: Date): string {
  return now.toISOString().slice(0, 10);
}

/** `company_spend:<userId>:<UTC-day>` — disjoint from every existing prefix (`rate:`, `deep:`, `forced_rebuilds_today:`, `jev:`, `jev-gemini:`). */
export function companySpendPerUserDayKey(userId: string, now: Date): string {
  return `company_spend:${userId}:${utcDaySegment(now)}`;
}

/** `company_spend:all:<UTC-day>` — the ceiling across every caller, for one UTC day. */
export function companySpendGlobalDayKey(now: Date): string {
  return `company_spend:all:${utcDaySegment(now)}`;
}

// ── Refusal reasons (§2.7's failure table + the escape-clause addition) ─────

export type CompanySpendCapRefusalReason =
  | "cap_config_unreadable"
  | "price_unreadable"
  | "per_user_cap_exceeded"
  | "global_cap_exceeded"
  | "counter_unreadable"
  | "unrecognized_provider"
  /**
   * Escape-clause addition, not in B's original table: a call shape with no
   * honest cost ceiling (see the module header's "UNESTIMABLE CALL SHAPES").
   * Distinct from `price_unreadable`, which means "the model's price is
   * missing" — this means "nothing could price THIS call even with every
   * price known", so conflating the two would misreport which knob to fix.
   */
  | "unestimable_call";

export class CompanySpendCapRefusedError extends Error {
  readonly reason: CompanySpendCapRefusalReason;
  constructor(reason: CompanySpendCapRefusalReason) {
    super(`Company-funded AI spend refused: ${reason}`);
    this.name = "CompanySpendCapRefusedError";
    this.reason = reason;
  }
}

// ── Config shape + the ≤60s cache (§2.2) ─────────────────────────────────────

export interface CompanySpendCapsConfig {
  globalDailyMicroUsd: number;
  perUserDailyMicroUsd: number;
}

export interface CompanyModelPrice {
  inputPerM: number;
  outputPerM: number;
  /** `null` = this model has no vision price configured (may still be a valid non-vision model). */
  visionTokensPerImage: number | null;
}

export interface CompanyBudgetConfig {
  caps: CompanySpendCapsConfig;
  prices: Map<string, CompanyModelPrice>;
}

interface RawCapsRow {
  cap_key?: unknown;
  amount_usd?: unknown;
}

interface RawPriceRow {
  model_id?: unknown;
  input_usd_per_million_tokens?: unknown;
  output_usd_per_million_tokens?: unknown;
  vision_tokens_per_image?: unknown;
}

interface CompanyBudgetSelect<Row> {
  select(columns: string): Promise<{ data: Row[] | null; error: unknown }>;
}

/**
 * The narrow injected-client convention this codebase already uses
 * (`entitlement/resolve.ts`'s `EntitlementSupabaseClient`,
 * `usage/counters.ts`'s `CounterSupabaseClient`): `undefined` = build the
 * real admin client, an explicit `null` = force "unreachable" for a test.
 */
export interface CompanyBudgetSupabaseClient {
  from(table: "company_spend_caps"): CompanyBudgetSelect<RawCapsRow>;
  from(table: "company_model_prices"): CompanyBudgetSelect<RawPriceRow>;
}

function configuredAdminClient(): CompanyBudgetSupabaseClient | null {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return null;
  }
  try {
    return createAdminClient() as unknown as CompanyBudgetSupabaseClient;
  } catch {
    return null;
  }
}

const CONFIG_CACHE_TTL_MS = 60_000;

interface CachedConfig {
  config: CompanyBudgetConfig;
  fetchedAtMs: number;
}

let cache: CachedConfig | null = null;

/** Tests only. */
export function resetCompanyBudgetConfigCacheForTests(): void {
  cache = null;
}

/**
 * Finite AND in `[min, max]`. Rejects `NaN` explicitly (`Number.isFinite`
 * already does — `numeric`'s `NaN` compares `>=` true against 0 at the SQL
 * layer, which is exactly why the migration's own `CHECK` bounds the top end
 * too; this is the app-side half of that same defence, per §2.1's note) and
 * anything absurdly out of range (§3 RED test 4c).
 */
function safeFiniteInRange(value: unknown, min: number, max: number): number | null {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) && n >= min && n <= max ? n : null;
}

/** `vision_tokens_per_image` is a nullable `integer` — no NaN is representable at the DB layer, but the JS-side value is still defensively checked. */
function safeVisionTokens(value: unknown): number | null | undefined {
  if (value === null || value === undefined) return null;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) && n >= 0 ? n : undefined; // undefined = invalid, not absent
}

const CAP_MIN_USD = 0;
const CAP_MAX_USD = 100_000;
const PRICE_MIN_USD_PER_M = 0;
const PRICE_MAX_USD_PER_M = 10_000;

function usdToMicro(usd: number): number {
  return Math.round(usd * 1_000_000);
}

/**
 * One cap field, resolved against the three-outcome table (§2.2):
 *  - row absent -> the documented default (the ONLY case a default applies)
 *  - row present, valid -> the stored value
 *  - row present, invalid (non-finite / out of range) -> `null`, which the
 *    caller must treat exactly like a read failure, never like "absent".
 */
function resolveCapField(rows: RawCapsRow[], key: string, fallbackUsd: number): number | null {
  const row = rows.find((r) => r.cap_key === key);
  if (!row) return usdToMicro(fallbackUsd);
  const usd = safeFiniteInRange(row.amount_usd, CAP_MIN_USD, CAP_MAX_USD);
  return usd === null ? null : usdToMicro(usd);
}

export type CompanyBudgetReadResult = { ok: true; config: CompanyBudgetConfig } | { ok: false };

/**
 * Read (or return the cached) config. `now` is the caller's clock, per this
 * codebase's `CounterStore` convention. An explicit `client: null` forces the
 * "Supabase unreachable" branch for a test; `undefined` builds the real one.
 */
export async function readCompanyBudgetConfig(
  now: Date,
  client?: CompanyBudgetSupabaseClient | null,
): Promise<CompanyBudgetReadResult> {
  const nowMs = now.getTime();
  if (cache && nowMs - cache.fetchedAtMs < CONFIG_CACHE_TTL_MS) {
    return { ok: true, config: cache.config };
  }

  const resolved = client === undefined ? configuredAdminClient() : client;
  if (!resolved) return { ok: false };

  try {
    const [capsResult, pricesResult] = await Promise.all([
      resolved.from("company_spend_caps").select("cap_key, amount_usd"),
      resolved
        .from("company_model_prices")
        .select("model_id, input_usd_per_million_tokens, output_usd_per_million_tokens, vision_tokens_per_image"),
    ]);
    if (capsResult.error || pricesResult.error) return { ok: false };

    const capsRows = capsResult.data ?? [];
    const globalDailyMicroUsd = resolveCapField(capsRows, "global_daily_usd", DEFAULT_GLOBAL_DAILY_USD);
    const perUserDailyMicroUsd = resolveCapField(capsRows, "per_user_daily_usd", DEFAULT_PER_USER_DAILY_USD);
    if (globalDailyMicroUsd === null || perUserDailyMicroUsd === null) return { ok: false };

    const prices = new Map<string, CompanyModelPrice>();
    for (const row of pricesResult.data ?? []) {
      const modelId = typeof row.model_id === "string" ? row.model_id : null;
      if (!modelId) return { ok: false }; // a garbage row is unreadable config, not an absent one
      const inputPerM = safeFiniteInRange(row.input_usd_per_million_tokens, PRICE_MIN_USD_PER_M, PRICE_MAX_USD_PER_M);
      const outputPerM = safeFiniteInRange(row.output_usd_per_million_tokens, PRICE_MIN_USD_PER_M, PRICE_MAX_USD_PER_M);
      const visionTokensPerImage = safeVisionTokens(row.vision_tokens_per_image);
      if (inputPerM === null || outputPerM === null || visionTokensPerImage === undefined) return { ok: false };
      prices.set(modelId, { inputPerM, outputPerM, visionTokensPerImage });
    }

    const config: CompanyBudgetConfig = {
      caps: { globalDailyMicroUsd, perUserDailyMicroUsd },
      prices,
    };
    cache = { config, fetchedAtMs: nowMs };
    return { ok: true, config };
  } catch {
    return { ok: false };
  }
}

// ── The estimator (§2.4) ─────────────────────────────────────────────────────

export type CompanyBudgetMethod = "digest" | "json" | "vision" | "test-connection";

export type CompanyBudgetCallShape =
  | { method: "digest"; papers: unknown; contextHint?: unknown }
  | { method: "json"; systemPrompt: string; userPrompt: string; maxTokens?: number; tier?: ModelTier }
  | {
      method: "vision";
      systemPrompt: string;
      userPrompt: string;
      maxTokens?: number;
      tier?: ModelTier;
      imageCount: number;
    }
  | { method: "test-connection" };

function charsPerTokenFor(text: string): number {
  return isCjkHeavy(text) ? CJK_CHARS_PER_TOKEN : LATIN_CHARS_PER_TOKEN;
}

function estimateInputTokens(text: string): number {
  if (!text) return 0;
  return Math.ceil(text.length / charsPerTokenFor(text));
}

/** Shared by both estimate (worst-case tokens) and settlement (actual tokens) — one formula, never two. */
export function microUsdForTokens(price: CompanyModelPrice, inputTokens: number, outputTokens: number): number {
  return Math.ceil(Math.max(0, inputTokens) * price.inputPerM + Math.max(0, outputTokens) * price.outputPerM);
}

export type EstimateCompanySpendResult = { ok: true; microUsd: number } | { ok: false; reason: CompanySpendCapRefusalReason };

/**
 * Worst case = sum over every candidate model in the resolved chain of
 * (inputTokens x price.inputPerM + outputCeiling x price.outputPerM) — the
 * cost if every chain attempt actually happened, per §2.4.
 *
 * **Documented, tested assumption** (§2.4): the resolved company-funded
 * provider is always `"gemini"` — the system Gemini default was the only
 * company-funded provider there ever was. An unrecognized `providerId` fails
 * closed rather than silently pricing it at $0.
 */
export function estimateCompanySpend(
  shape: CompanyBudgetCallShape,
  providerId: string,
  prices: ReadonlyMap<string, CompanyModelPrice>,
): EstimateCompanySpendResult {
  if (providerId !== "gemini") return { ok: false, reason: "unrecognized_provider" };

  if (shape.method === "test-connection") {
    // Escape clause — see the module header's "UNESTIMABLE CALL SHAPES" #1.
    return { ok: false, reason: "unestimable_call" };
  }

  const tier = shape.method === "digest" ? undefined : shape.tier;
  const filtered = chainForTier(GEMINI_API_MODEL_CHAIN as ModelTarget[], tier);
  const candidates = filtered.length > 0 ? filtered : GEMINI_API_MODEL_CHAIN;

  const inputText =
    shape.method === "digest"
      ? JSON.stringify({ papers: shape.papers, contextHint: shape.contextHint })
      : `${shape.systemPrompt}${shape.userPrompt}`;
  const baseInputTokens = estimateInputTokens(inputText);

  const outputTokensRequested = shape.method === "digest" ? DIGEST_MAX_OUTPUT_TOKENS : shape.maxTokens;
  if (outputTokensRequested == null) {
    // Escape clause — see the module header's "UNESTIMABLE CALL SHAPES" #2.
    return { ok: false, reason: "unestimable_call" };
  }

  let totalMicroUsd = 0;
  for (const target of candidates) {
    const price = prices.get(target.id);
    if (!price) return { ok: false, reason: "price_unreadable" };

    let inputTokens = baseInputTokens;
    if (shape.method === "vision") {
      if (price.visionTokensPerImage == null) return { ok: false, reason: "price_unreadable" };
      inputTokens += shape.imageCount * price.visionTokensPerImage;
    }

    const outputCeiling = outputCap(target.id, outputTokensRequested) ?? outputTokensRequested;
    totalMicroUsd += microUsdForTokens(price, inputTokens, outputCeiling);
  }

  return { ok: true, microUsd: totalMicroUsd };
}

// ── Reservation (§2.3) ───────────────────────────────────────────────────────

export interface CompanySpendSettlementState {
  actualMicroUsdSum: number;
  attemptsSeen: number;
  /** AND-reduced across every attempt seen; starts `true`. */
  allReported: boolean;
}

export interface CompanySpendReservation {
  reservedMicroUsd: number;
  /** `null` for a userId-less call (R2) — this reservation touched the global key only. */
  perUserKey: string | null;
  globalKey: string;
  settlement: CompanySpendSettlementState;
}

function freshSettlement(): CompanySpendSettlementState {
  return { actualMicroUsdSum: 0, attemptsSeen: 0, allReported: true };
}

export type ReserveCompanySpendResult =
  | { ok: true; reservation: CompanySpendReservation }
  | { ok: false; reason: CompanySpendCapRefusalReason };

/**
 * The atomic reserve step, given an ALREADY-RESOLVED micro-USD amount and
 * caps. Mirrors `security/jev-broker-auth.ts`'s `reserveJevCall` exactly:
 * per-user key first, in isolation; the global key is only ever touched once
 * the per-user reservation is known to be within cap (RESERVATION ORDER,
 * P3-S4-FIX's bug class). R2: when `userId` is `null`, the per-user branch is
 * never entered at all — structurally, not just behaviourally, global-only.
 *
 * **Over-reservation is not rolled back on a refusal** — same accepted,
 * safe-direction design as `reserveJevCall`: the increment already landed by
 * the time the cap check runs, and rolling it back would need a second write
 * a concurrent reader could race. `settleCompanySpend` below is the only
 * "release" mechanism, and it only ever runs for a call that was ALLOWED to
 * proceed.
 */
export async function reserveCompanySpend(
  userId: string | null,
  microUsd: number,
  caps: CompanySpendCapsConfig,
  now: Date,
  store: CounterStore = getCounterStore(),
): Promise<ReserveCompanySpendResult> {
  const windowEndsAt = endOfUtcDay(now);
  const globalKey = companySpendGlobalDayKey(now);

  if (userId) {
    const perUserKey = companySpendPerUserDayKey(userId, now);
    const perUserReading = await store.increment(perUserKey, windowEndsAt, microUsd, now);
    if (breakerTripped(perUserReading, caps.perUserDailyMicroUsd)) {
      return { ok: false, reason: perUserReading.ok ? "per_user_cap_exceeded" : "counter_unreadable" };
    }

    const globalReading = await store.increment(globalKey, windowEndsAt, microUsd, now);
    if (breakerTripped(globalReading, caps.globalDailyMicroUsd)) {
      return { ok: false, reason: globalReading.ok ? "global_cap_exceeded" : "counter_unreadable" };
    }

    return {
      ok: true,
      reservation: { reservedMicroUsd: microUsd, perUserKey, globalKey, settlement: freshSettlement() },
    };
  }

  // R2 — no owner at this layer: global cap only, no per-user key touched.
  const globalReading = await store.increment(globalKey, windowEndsAt, microUsd, now);
  if (breakerTripped(globalReading, caps.globalDailyMicroUsd)) {
    return { ok: false, reason: globalReading.ok ? "global_cap_exceeded" : "counter_unreadable" };
  }

  return {
    ok: true,
    reservation: { reservedMicroUsd: microUsd, perUserKey: null, globalKey, settlement: freshSettlement() },
  };
}

/**
 * The full orchestration `metered.ts`'s `meterCall` calls: read config,
 * estimate, reserve. Kept separate from `reserveCompanySpend` above so that
 * function's own concurrency/ordering behaviour can be tested directly
 * against a plain `CounterStore`, without a config round trip in the way —
 * mirrors `reserveJevCall`'s own test suite.
 */
export async function reserveCompanySpendForCall(
  shape: CompanyBudgetCallShape,
  providerId: string,
  userId: string | null,
  now: Date,
  deps: { client?: CompanyBudgetSupabaseClient | null; store?: CounterStore } = {},
): Promise<ReserveCompanySpendResult> {
  const configResult = await readCompanyBudgetConfig(now, deps.client);
  if (!configResult.ok) return { ok: false, reason: "cap_config_unreadable" };

  const estimate = estimateCompanySpend(shape, providerId, configResult.config.prices);
  if (!estimate.ok) return estimate;

  return reserveCompanySpend(userId, estimate.microUsd, configResult.config.caps, now, deps.store ?? getCounterStore());
}

// ── Settlement (§2.3, as amended by R10) ─────────────────────────────────────

/**
 * R10 (manager reading, confirmed by execution — see `company-budget.test.ts`
 * and the SPEND-CAP checkpoint's R10 finding): `gemini.ts`'s `logGemini` (->
 * `logLlmUsage`) fires ONCE PER CHAIN ATTEMPT, not once per
 * `generateJsonText`/`generateDigest`/`generateVisionJsonText` call. Settling
 * inside `logLlmUsage` itself, as B's original design proposed, would refund
 * one reservation several times whenever a chain retries. So settlement is
 * split in two:
 *
 *  1. Each attempt calls THIS function (from `usage-log.ts`, the only place
 *     that has both the real token counts and — via the same
 *     `AsyncLocalStorage` scope `meterCall` already threads — the
 *     reservation) to ACCUMULATE its actual cost onto the reservation's own
 *     mutable `settlement` state. No counter write happens here.
 *  2. `meterCall`'s `finally` calls `settleCompanySpend` exactly ONCE, after
 *     every attempt for this one call has finished, to fire the (possibly
 *     zero) refund.
 *
 * An attempt whose usage is missing or non-finite (the provider threw before
 * `usageMetadata` existed) latches `allReported` to `false` for the WHOLE
 * reservation — permanently, not just for that attempt — because a partially
 * unknown chain cannot be honestly settled to less than what was reserved.
 */
export function recordCompanySpendAttempt(
  reservation: CompanySpendReservation,
  usage: { model: string; inputTokens?: number; outputTokens?: number; thinkingTokens?: number },
  prices: ReadonlyMap<string, CompanyModelPrice> | null,
): void {
  reservation.settlement.attemptsSeen += 1;

  const price = prices?.get(usage.model);
  const inputOk = Number.isFinite(usage.inputTokens);
  const outputOk = Number.isFinite(usage.outputTokens);
  if (!price || !inputOk || !outputOk) {
    reservation.settlement.allReported = false;
    return;
  }

  const thinking = Number.isFinite(usage.thinkingTokens) ? (usage.thinkingTokens as number) : 0;
  reservation.settlement.actualMicroUsdSum += microUsdForTokens(
    price,
    usage.inputTokens as number,
    (usage.outputTokens as number) + thinking,
  );
}

/**
 * Reads the config cache synchronously — safe because `reserveCompanySpend`
 * already populated it moments earlier in the same request, well within the
 * 60s TTL. If the cache has genuinely gone cold by settlement time (a
 * pathologically long-running request), there is nothing honest to price
 * against, so the caller should treat this exactly like a missing price: no
 * accumulation, `allReported` stays whatever it already was — never a crash.
 */
export function cachedCompanyBudgetPrices(now: Date): ReadonlyMap<string, CompanyModelPrice> | null {
  if (cache && now.getTime() - cache.fetchedAtMs < CONFIG_CACHE_TTL_MS) return cache.config.prices;
  return null;
}

/**
 * The ONE settlement call per `meterCall` invocation (R10), fired from
 * `finally` and NEVER awaited by it — fire-and-forget, same as every other
 * counter write on this path, so a slow settlement never adds latency to the
 * request that already has its answer.
 *
 * "Settle" and "release an unused reservation" are the same operation here:
 * a refusal never reaches this function at all (no reservation exists to
 * settle), and an allowed call that used less than its worst-case reservation
 * gets the unused portion refunded — there is no separate release path.
 */
export async function settleCompanySpend(
  reservation: CompanySpendReservation,
  now: Date,
  store: CounterStore = getCounterStore(),
): Promise<void> {
  const { settlement } = reservation;
  if (settlement.attemptsSeen === 0 || !settlement.allReported) return; // unknown usage -> keep the full reservation

  const refund = Math.max(0, reservation.reservedMicroUsd - settlement.actualMicroUsdSum);
  if (refund <= 0) return;

  const windowEndsAt = endOfUtcDay(now);
  const writes: Promise<unknown>[] = [store.increment(reservation.globalKey, windowEndsAt, -refund, now)];
  if (reservation.perUserKey) {
    writes.push(store.increment(reservation.perUserKey, windowEndsAt, -refund, now));
  }
  await Promise.all(writes);
}

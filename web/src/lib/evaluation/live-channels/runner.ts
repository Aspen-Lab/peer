// LIVE-EVAL-4 (ABC-JEV-INTEGRATION.md §1u/§1w, guide Finding C2/C4/C5) — the
// orchestrator: calls all seven channel entry points per input, through the
// shared call budget, maps results into `channel-comparison.ts`'s shape, and
// writes raw output + the blinded label sheet under output/live-eval/.
//
// No dedicated offline test file (per the guide's own "Ordered C steps" #11)
// — its correctness is exercised by the one authorized smoke run, on top of
// the already-tested building blocks it composes (call-budget.ts,
// topic-resolution.ts, seed-resolution.ts, inputs.ts, blinded-sheet.ts).
//
// Caches to bypass: NONE used here — every one of the seven adapters is
// called directly, never through `feed/pipeline.ts`'s Supabase-backed
// `resolveChannelCandidates` (guide Finding C2: that cache needs a signed-in
// scope a standalone script has no business constructing).

import fs from "node:fs";
import path from "node:path";
import { semanticScholar } from "@/lib/sources/semantic-scholar";
import { openalex } from "@/lib/sources/openalex";
import { fetchOpenAlexSemantic } from "@/lib/sources/openalex-semantic";
import { fetchOpenAlexTopicField } from "@/lib/sources/openalex-topic";
import { fetchSemanticScholarRecommendations } from "@/lib/sources/semantic-scholar-recommendations";
import { fetchCitationNeighborhood } from "@/lib/affiliation/openalex";
import type { RawItem } from "@/lib/sources/types";
import {
  compareChannels,
  type ChannelRun,
  type ChannelComparisonItem,
  type ChannelComparisonResult,
  type ChannelComparisonRole,
  type WorkEntry,
} from "@/lib/scoring/channel-comparison";
import { publishedYearOf } from "@/lib/feed/paper-identity";
import {
  canonicalPaperKey,
  idFormKeys,
  titleFormOf,
} from "@/lib/utils/canonical-identity";
import {
  CallBudget,
  trackedCall,
  type CallProvider,
  type StopReason,
  type S2BlockReason,
  type SleepFn,
  type ClockFn,
} from "./call-budget";
import { resolveTopicId } from "./topic-resolution";
import {
  resolveOpenAlexSeed,
  resolveS2Seed,
  combineSeedLookups,
  type ResolvedSeed,
  type DroppedSeed,
  type OpenAlexSeedLookup,
  type S2SeedLookup,
  type SeedLookupOutcome,
} from "./seed-resolution";
import {
  loadLiveChannelsInputs,
  type LiveChannelsInput,
  type DroppedSeedDoi,
  type ResolvedInputsSource,
} from "./inputs";
import { credentialPresence, type CredentialPresence } from "./live-channels-gate";
import { buildBlindedSheet, type WorkDetails, type BlindedSheetResult } from "./blinded-sheet";

const TOPIC_FIELD_LIMIT = 15;
const SEED_SIMILARITY_LIMIT = 10; // matches pipeline.ts:1347's production similarity-leg limit
const MAX_SEEDS_FOR_OPENALEX_SIMILARITY = 5; // matches pipeline.ts:1345's production cap
/** Fixed and documented so the same run's sample is reproducible; not a secret. */
const BLINDED_SHEET_SAMPLE_SEED = 20260925;

function openAlexAuthHeaders(): Record<string, string> | undefined {
  const key = process.env.OPENALEX_API_KEY?.trim();
  return key ? { Authorization: `Bearer ${key}` } : undefined;
}

function openAlexMailto(): string {
  return process.env.OPENALEX_EMAIL ?? "peer@example.com";
}

function toComparisonItems(items: RawItem[]): ChannelComparisonItem[] {
  return items.map((item, idx) => ({
    id: item.id,
    source: item.source,
    doi: item.metadata?.doi,
    title: item.title,
    year: publishedYearOf(item.publishedAt),
    authors: item.authors,
    externalIds: item.metadata?.externalIds,
    rank: idx + 1,
  }));
}

/** Indexes every RawItem this input's channels returned under every id-form/title key `compareChannels` itself would match it on, so a `WorkEntry`'s representative key always has a details entry for the blinded sheet. */
function collectWorkDetails(items: RawItem[], into: Map<string, WorkDetails>): void {
  for (const item of items) {
    const identity = canonicalPaperKey({
      source: item.source,
      id: item.id,
      doi: item.metadata?.doi,
      title: item.title,
      externalIds: item.metadata?.externalIds,
    });
    const keys = new Set<string>(idFormKeys(identity));
    const titleForm = titleFormOf(identity);
    if (titleForm) keys.add(titleForm);
    if (keys.size === 0) keys.add(identity.key);

    const details: WorkDetails = {
      title: item.title,
      year: publishedYearOf(item.publishedAt),
      venue: item.venue,
      doi: item.metadata?.doi,
    };
    for (const k of keys) if (!into.has(k)) into.set(k, details);
  }
}

interface FanOutOutcome {
  items: RawItem[];
  status: "ok" | "failed" | "not_run";
  requestCount?: number;
  latencyMs?: number;
  errorMessage?: string;
  notRunReason?: string;
}

/**
 * Runs a list of independent live calls that all feed ONE channel (e.g. one
 * per topic string for a keyword channel, one per seed title for the
 * similarity leg), unions their items (deduped by RawItem.id), and rolls up
 * status per Finding C4 item 2: "ok" if at least one call succeeded (a
 * partial fan-out failure never takes the channel down), "failed" only if
 * every attempted call failed, "not_run" if zero calls were even planned or
 * every planned call was blocked by the budget/stop rule before running.
 */
async function fanOutCalls(
  budget: CallBudget,
  provider: CallProvider,
  calls: Array<() => Promise<RawItem[]>>,
  emptyReason: string,
): Promise<FanOutOutcome> {
  if (calls.length === 0) {
    return { items: [], status: "not_run", notRunReason: emptyReason };
  }

  const seen = new Map<string, RawItem>();
  let requestCount = 0;
  let latencyMs = 0;
  let anyOk = false;
  let lastError: Error | undefined;
  let firstNotRunReason: string | undefined;

  for (const call of calls) {
    const outcome = await trackedCall(budget, provider, call);
    if (outcome.status === "ok") {
      anyOk = true;
      requestCount += 1;
      latencyMs += outcome.latencyMs;
      for (const item of outcome.value) if (!seen.has(item.id)) seen.set(item.id, item);
    } else if (outcome.status === "failed") {
      requestCount += 1;
      latencyMs += outcome.latencyMs;
      lastError = outcome.error;
    } else if (!firstNotRunReason) {
      firstNotRunReason = outcome.reason;
    }
  }

  if (anyOk) {
    return { items: Array.from(seen.values()), status: "ok", requestCount, latencyMs };
  }
  if (requestCount > 0) {
    return { items: [], status: "failed", requestCount, latencyMs, errorMessage: lastError?.message };
  }
  return { items: [], status: "not_run", notRunReason: firstNotRunReason ?? emptyReason };
}

interface TopicRoleOutcome extends FanOutOutcome {
  topicId?: string;
}

/** Two-phase topic role: resolve an id (cached across runs, one paid search call the first time) then fetch that topic's field. */
async function runTopicRole(
  budget: CallBudget,
  topics: string[],
  cachedTopicId: string | undefined,
): Promise<TopicRoleOutcome> {
  const primaryTopic = topics[0]?.trim();
  if (!primaryTopic) {
    return { items: [], status: "not_run", notRunReason: "no topic id resolved: no topics for this input" };
  }

  let topicId = cachedTopicId;
  let resolveRequestCount = 0;
  let resolveLatencyMs = 0;

  if (!topicId) {
    const outcome = await trackedCall(budget, "openalex", () =>
      resolveTopicId(primaryTopic, { authHeaders: openAlexAuthHeaders(), mailto: openAlexMailto() }),
    );
    if (outcome.status === "not_run") {
      return { items: [], status: "not_run", notRunReason: outcome.reason };
    }
    resolveRequestCount = 1;
    resolveLatencyMs = outcome.latencyMs;
    if (outcome.status === "failed") {
      return {
        items: [],
        status: "failed",
        requestCount: resolveRequestCount,
        latencyMs: resolveLatencyMs,
        errorMessage: outcome.error.message,
      };
    }
    topicId = outcome.value.topicId;
    if (!topicId) {
      return {
        items: [],
        status: "not_run",
        notRunReason: "no topic id resolved: zero results",
        requestCount: resolveRequestCount,
        latencyMs: resolveLatencyMs,
      };
    }
  }

  const fetchOutcome = await fanOutCalls(
    budget,
    "openalex",
    [() => fetchOpenAlexTopicField([topicId as string], { limit: TOPIC_FIELD_LIMIT })],
    "no topic id resolved",
  );

  const combinedRequestCount = resolveRequestCount + (fetchOutcome.requestCount ?? 0);
  const combinedLatencyMs = resolveLatencyMs + (fetchOutcome.latencyMs ?? 0);
  const anyCallMadeThisRun = combinedRequestCount > 0;

  return {
    items: fetchOutcome.items,
    status: fetchOutcome.status,
    requestCount: anyCallMadeThisRun ? combinedRequestCount : undefined,
    latencyMs: anyCallMadeThisRun ? combinedLatencyMs : undefined,
    errorMessage: fetchOutcome.errorMessage,
    notRunReason: fetchOutcome.notRunReason,
    topicId,
  };
}

interface SeedResolutionOutcome {
  resolved: ResolvedSeed[];
  dropped: DroppedSeed[];
}

/** Both lookups per seed DOI, cached across runs by DOI. See seed-resolution.ts's file header for why both must succeed. */
async function resolveSeedsForInput(
  budget: CallBudget,
  seedDois: string[],
  cache: Map<string, ResolvedSeed>,
): Promise<SeedResolutionOutcome> {
  const resolved: ResolvedSeed[] = [];
  const dropped: DroppedSeed[] = [];
  const authHeaders = openAlexAuthHeaders();
  const mailto = openAlexMailto();

  for (const doi of seedDois) {
    const cached = cache.get(doi);
    if (cached) {
      resolved.push(cached);
      continue;
    }

    const oaOutcome = await trackedCall(budget, "openalex", () =>
      resolveOpenAlexSeed(doi, { authHeaders, mailto }),
    );
    const s2Outcome = await trackedCall(budget, "semantic_scholar", () => resolveS2Seed(doi));

    const oaResult: SeedLookupOutcome<OpenAlexSeedLookup> =
      oaOutcome.status === "ok"
        ? { ok: true, value: oaOutcome.value }
        : { ok: false, reason: oaOutcome.status === "failed" ? oaOutcome.error.message : oaOutcome.reason };
    const s2Result: SeedLookupOutcome<S2SeedLookup> =
      s2Outcome.status === "ok"
        ? { ok: true, value: s2Outcome.value }
        : { ok: false, reason: s2Outcome.status === "failed" ? s2Outcome.error.message : s2Outcome.reason };

    const combined = combineSeedLookups(doi, oaResult, s2Result);
    if (combined.seed) {
      resolved.push(combined.seed);
      cache.set(doi, combined.seed);
    } else if (combined.dropped) {
      dropped.push(combined.dropped);
    }
  }

  return { resolved, dropped };
}

export interface ChannelCallSummary {
  channel: string;
  role: ChannelComparisonRole;
  provider: CallProvider;
  status: "ok" | "failed" | "not_run";
  resultCount?: number;
  latencyMs?: number;
  requestCount: number;
  errorMessage?: string;
  notRunReason?: string;
}

function toChannelRun(
  channel: string,
  role: ChannelComparisonRole,
  provider: CallProvider,
  outcome: FanOutOutcome,
): ChannelRun {
  return {
    channel,
    role,
    provider,
    items: outcome.status === "ok" ? toComparisonItems(outcome.items) : [],
    latencyMs: outcome.latencyMs,
    requestCount: outcome.requestCount,
    status: outcome.status,
  };
}

function toCallSummary(
  channel: string,
  role: ChannelComparisonRole,
  provider: CallProvider,
  outcome: FanOutOutcome,
): ChannelCallSummary {
  return {
    channel,
    role,
    provider,
    status: outcome.status,
    resultCount: outcome.status === "ok" ? outcome.items.length : undefined,
    latencyMs: outcome.latencyMs,
    requestCount: outcome.requestCount ?? 0,
    errorMessage: outcome.errorMessage,
    notRunReason: outcome.notRunReason,
  };
}

export interface InputRunResult {
  inputId: string;
  topicId?: string;
  resolvedSeeds: ResolvedSeed[];
  droppedSeeds: DroppedSeed[];
  channelCalls: ChannelCallSummary[];
  comparison: ChannelComparisonResult;
}

interface InputCacheEntry {
  topicId?: string;
  seeds: Map<string, ResolvedSeed>;
}
type ResolvedCache = Map<string, InputCacheEntry>;

async function runOneInput(
  input: LiveChannelsInput,
  budget: CallBudget,
  cache: ResolvedCache,
): Promise<{ result: InputRunResult; workDetails: Map<string, WorkDetails> }> {
  const inputCache = cache.get(input.id) ?? { topicId: undefined, seeds: new Map<string, ResolvedSeed>() };
  cache.set(input.id, inputCache);

  const topicOutcome = await runTopicRole(budget, input.topics, inputCache.topicId);
  if (topicOutcome.topicId) inputCache.topicId = topicOutcome.topicId;

  const seedResolution = await resolveSeedsForInput(budget, input.seedDois, inputCache.seeds);
  const noSeedsReason =
    input.seedDois.length === 0 ? "no seed papers for this input" : "no seeds resolved";

  const s2KeywordOutcome = await fanOutCalls(
    budget,
    "semantic_scholar",
    input.topics.map((topic) => () => semanticScholar.fetch({ topics: [topic] })),
    "no topics for this input",
  );
  const oaKeywordOutcome = await fanOutCalls(
    budget,
    "openalex",
    input.topics.map((topic) => () => openalex.fetch({ topics: [topic] })),
    "no topics for this input",
  );

  const semanticQueryText = input.topics.join(". ").trim();
  const semanticOutcome = await fanOutCalls(
    budget,
    "openalex",
    semanticQueryText ? [() => fetchOpenAlexSemantic(semanticQueryText)] : [],
    "no topics for this input",
  );

  const s2SeedOutcome = await fanOutCalls(
    budget,
    "semantic_scholar",
    seedResolution.resolved.length > 0
      ? [() => fetchSemanticScholarRecommendations(seedResolution.resolved.map((s) => s.s2PaperId))]
      : [],
    noSeedsReason,
  );

  const similaritySeeds = seedResolution.resolved.slice(0, MAX_SEEDS_FOR_OPENALEX_SIMILARITY);
  const oaSeedSimilarityOutcome = await fanOutCalls(
    budget,
    "openalex",
    similaritySeeds.map(
      (seed) => () => fetchOpenAlexSemantic(seed.title, { limit: SEED_SIMILARITY_LIMIT }),
    ),
    noSeedsReason,
  );

  const oaCitationsOutcome = await fanOutCalls(
    budget,
    "openalex",
    seedResolution.resolved.length > 0
      ? [() => fetchCitationNeighborhood(seedResolution.resolved.map((s) => s.openAlexWorkId))]
      : [],
    noSeedsReason,
  );

  const channels: Array<{
    channel: string;
    role: ChannelComparisonRole;
    provider: CallProvider;
    outcome: FanOutOutcome;
  }> = [
    { channel: "s2-keyword", role: "keyword", provider: "semantic_scholar", outcome: s2KeywordOutcome },
    { channel: "openalex-keyword", role: "keyword", provider: "openalex", outcome: oaKeywordOutcome },
    { channel: "openalex-semantic", role: "semantic", provider: "openalex", outcome: semanticOutcome },
    { channel: "openalex-topic", role: "topic", provider: "openalex", outcome: topicOutcome },
    { channel: "s2-seed", role: "seed", provider: "semantic_scholar", outcome: s2SeedOutcome },
    {
      channel: "openalex-seed-similarity",
      role: "seed",
      provider: "openalex",
      outcome: oaSeedSimilarityOutcome,
    },
    { channel: "openalex-citations", role: "citation", provider: "openalex", outcome: oaCitationsOutcome },
  ];

  const runs: ChannelRun[] = channels.map((c) => toChannelRun(c.channel, c.role, c.provider, c.outcome));
  const comparison = compareChannels(runs);

  const workDetails = new Map<string, WorkDetails>();
  for (const c of channels) {
    if (c.outcome.status === "ok") collectWorkDetails(c.outcome.items, workDetails);
  }

  return {
    result: {
      inputId: input.id,
      topicId: topicOutcome.topicId,
      resolvedSeeds: seedResolution.resolved,
      droppedSeeds: seedResolution.dropped,
      channelCalls: channels.map((c) => toCallSummary(c.channel, c.role, c.provider, c.outcome)),
      comparison,
    },
    workDetails,
  };
}

// ─────────────────────────── resolved-id cache ───────────────────────────

interface ResolvedCacheFile {
  version: 1;
  inputs: Record<string, { topicId?: string; seeds: ResolvedSeed[] }>;
}

function resolvedCachePath(cwd: string): string {
  return path.join(cwd, "output", "live-eval", "resolved-cache.json");
}

function loadResolvedCache(cwd: string): ResolvedCache {
  const cache: ResolvedCache = new Map();
  try {
    const raw = JSON.parse(fs.readFileSync(resolvedCachePath(cwd), "utf8")) as ResolvedCacheFile;
    for (const [inputId, entry] of Object.entries(raw.inputs ?? {})) {
      const seeds = new Map<string, ResolvedSeed>();
      for (const seed of entry.seeds ?? []) seeds.set(seed.doi, seed);
      cache.set(inputId, { topicId: entry.topicId, seeds });
    }
  } catch {
    // No cache yet, or unreadable/corrupt — start fresh. Never throws; a
    // cache is an optimization, never a dependency the runner needs to work.
  }
  return cache;
}

function saveResolvedCache(cwd: string, cache: ResolvedCache): void {
  const dir = path.join(cwd, "output", "live-eval");
  fs.mkdirSync(dir, { recursive: true });
  const file: ResolvedCacheFile = { version: 1, inputs: {} };
  for (const [inputId, entry] of cache) {
    file.inputs[inputId] = { topicId: entry.topicId, seeds: Array.from(entry.seeds.values()) };
  }
  fs.writeFileSync(resolvedCachePath(cwd), JSON.stringify(file, null, 2), "utf8");
}

// ────────────────────────────── raw output ──────────────────────────────

function formatTimestamp(d: Date): string {
  return d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

function writeRawOutput(outputDir: string, runs: InputRunResult[]): void {
  fs.mkdirSync(outputDir, { recursive: true });
  for (const r of runs) {
    fs.writeFileSync(
      path.join(outputDir, `${r.inputId}.json`),
      JSON.stringify(r, null, 2),
      "utf8",
    );
  }
}

/**
 * The run-level summary (ceiling/callsMade/stopped/credentialPresence/
 * timestamps/inputs source) — everything in `RunLiveChannelsEvalResult`
 * except the per-input `runs` array (each already written to its own file
 * by `writeRawOutput`). Written so a reviewer opening the output directory
 * later has "actual usage" (§1u.1) and credential presence (§1u.2) on disk,
 * not only in whatever this process happened to return to its caller.
 */
function writeSummary(
  outputDir: string,
  summary: Omit<RunLiveChannelsEvalResult, "runs">,
): void {
  fs.writeFileSync(
    path.join(outputDir, "summary.json"),
    JSON.stringify(summary, null, 2),
    "utf8",
  );
}

function writeBlindedSheet(outputDir: string, sheet: BlindedSheetResult): void {
  fs.writeFileSync(
    path.join(outputDir, "blinded-sheet.json"),
    JSON.stringify({ rows: sheet.rows }, null, 2),
    "utf8",
  );
  // NOT shown to a labeler — kept separate on disk too, mirroring the
  // in-memory separation (`buildBlindedSheet`'s own doc comment).
  fs.writeFileSync(
    path.join(outputDir, "blinded-sheet-key.json"),
    JSON.stringify({ keyByItemId: sheet.keyByItemId }, null, 2),
    "utf8",
  );
}

// ──────────────────────────── top-level entry ────────────────────────────

export interface RunLiveChannelsEvalOptions {
  /** Restrict the run to one input id (the smoke run's own pinning mechanism lives in live-channels.test.ts, not here). Omit for every input in the resolved input file. */
  onlyInputId?: string;
  /** ABC-JEV-INTEGRATION.md §1w P1: 150. */
  ceiling?: number;
  env?: Record<string, string | undefined>;
  cwd?: string;
  /** LIVE-EVAL-4-FIX: forwarded to `CallBudget` (the S2 pacing floor + 429 cool-off waits). Omit for the real run — defaults to a real `setTimeout`-based sleep. */
  sleep?: SleepFn;
  /** LIVE-EVAL-4-FIX: forwarded to `CallBudget` (measures the gap between S2 calls). Omit for the real run — defaults to `Date.now`. */
  now?: ClockFn;
}

export interface RunLiveChannelsEvalResult {
  startedAt: string;
  finishedAt: string;
  ceiling: number;
  callsMade: number;
  /** Whole-run stop (OpenAlex 429 only — see call-budget.ts's file header). */
  stopped?: StopReason;
  /** LIVE-EVAL-4-FIX (§1w AMENDMENT): set when a post-cool-off S2 retry also 429s during this run. The run is NOT stopped when this is set — OpenAlex channels kept running; see each input's own `channelCalls` for exactly which S2 calls were skipped (`status: "not_run"`, `notRunReason: "s2_rate_limited"`) vs. the one that actually failed twice (`status: "failed"`). */
  s2RateLimited?: S2BlockReason;
  credentialPresence: CredentialPresence;
  inputsSource: ResolvedInputsSource;
  droppedSeedDoisFromInputFile: DroppedSeedDoi[];
  runs: InputRunResult[];
  outputDir: string;
}

/**
 * Runs the live comparison for the resolved input set (or just `onlyInputId`
 * when given), sequentially — never all inputs concurrently (guide Finding
 * C4's wall-time recommendation: keeps peak request rate low, makes a 429
 * easy to attribute to one specific call). Writes raw per-input results and
 * the blinded label sheet under `output/live-eval/<UTC-timestamp>/`
 * (never committed — root .gitignore now covers `/output/`), and persists
 * resolved topic/seed ids to `output/live-eval/resolved-cache.json` so a
 * repeat run does not re-spend the one paid (search-class) resolution call.
 */
export async function runLiveChannelsEval(
  opts: RunLiveChannelsEvalOptions = {},
): Promise<RunLiveChannelsEvalResult> {
  const ceiling = opts.ceiling ?? 150;
  const cwd = opts.cwd ?? process.cwd();
  const env = opts.env ?? process.env;
  const startedAt = new Date();

  const loaded = loadLiveChannelsInputs(env, cwd);
  const targetInputs = opts.onlyInputId
    ? loaded.inputs.filter((i) => i.id === opts.onlyInputId)
    : loaded.inputs;

  const budget = new CallBudget({ ceiling, sleep: opts.sleep, now: opts.now });
  const cache = loadResolvedCache(cwd);

  const runs: InputRunResult[] = [];
  const allWorks: WorkEntry[] = [];
  const allDetails = new Map<string, WorkDetails>();

  for (const input of targetInputs) {
    const { result, workDetails } = await runOneInput(input, budget, cache);
    runs.push(result);
    if (result.comparison.availability === "ok") {
      for (const w of result.comparison.works) allWorks.push(w);
    }
    for (const [k, v] of workDetails) if (!allDetails.has(k)) allDetails.set(k, v);
  }

  saveResolvedCache(cwd, cache);

  const finishedAt = new Date();
  const outputDir = path.join(cwd, "output", "live-eval", formatTimestamp(startedAt));
  writeRawOutput(outputDir, runs);
  const sheet = buildBlindedSheet(allWorks, allDetails, { seed: BLINDED_SHEET_SAMPLE_SEED });
  writeBlindedSheet(outputDir, sheet);

  const result: RunLiveChannelsEvalResult = {
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    ceiling,
    callsMade: budget.callsMade,
    stopped: budget.stopped ?? undefined,
    s2RateLimited: budget.s2Blocked ?? undefined,
    credentialPresence: credentialPresence(),
    inputsSource: loaded.source,
    droppedSeedDoisFromInputFile: loaded.droppedSeedDois,
    runs,
    outputDir,
  };
  writeSummary(outputDir, result);
  return result;
}

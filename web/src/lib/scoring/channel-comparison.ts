import {
  canonicalPaperKey,
  idFormKeys,
  titleFormOf,
  type CanonicalIdentity,
  type CanonicalPaperExternalIds,
  type WorkMatchInput,
} from "@/lib/utils/canonical-identity";
import { clusterCanonicalWorks } from "@/lib/feed/paper-identity";

// P2-S5 (Round 3) — F-A-P2-04f / acceptance 4f, per
// ABC-JEV-INTEGRATION.md §1c/§1f/§3e and docs/jev-abc/P2-B-20260924T0345Z.md.
//
// A pure, offline harness that compares ranked candidate lists from several
// retrieval channels (e.g. "S2 keyword search" vs "OpenAlex keyword search"
// vs "OpenAlex semantic search") and reports overlap/union/exclusive-work
// counts, a seed-vs-keyword-style role breakdown, and — only when an
// independently labelled relevance set is supplied — the same counts
// restricted to labelled-relevant works. It takes per-channel run results as
// plain data; it never calls a provider itself and never generates its own
// "ground truth" (§3e: "do not generate ground truth with the same model
// being evaluated" — relevance labels must come from a held-out human-labelled
// set, passed in by the caller, never invented here).
//
// Papers are matched ACROSS channels by canonical identity (reusing P2-S1's
// `web/src/lib/utils/canonical-identity.ts`), never by raw per-source `id` —
// the same paper returned by two channels under two different native ids
// (e.g. an S2 id and an OpenAlex W-id) must count as one work, not two, or
// every overlap/union number here would be silently wrong. Clustering itself
// delegates to `feed/paper-identity.ts`'s shared `clusterCanonicalWorks`
// (F-M-P2S5-01, per ABC-JEV-INTEGRATION.md §1p.G) — the SAME corrected,
// conflict-aware function `feed/dedup.ts` uses, not a private copy: strong
// links on any shared real id-form key (DOI/S2/OpenAlex/arXiv/PMID) union
// transitively first; a title+year(±1)+first-author-surname weak link is
// then evaluated only BETWEEN the resulting pass-1 clusters, and a
// weak-linked component of clusters collapses into one work only if no two
// clusters anywhere in it conflict (share an id-form TYPE with differing
// values). This module used to carry its own, older two-pass union-find that
// unioned matching PAIRS of items directly, which let an ID-less "bridge"
// record transitively merge two otherwise-conflicting, ID-bearing works
// through two separate pairwise unions, even though comparing those two
// works directly correctly refused to merge them — see
// `channel-comparison.test.ts`'s "bridge conflict" fixture for the exact
// reproduction this now fixes.
//
// Never-fabricate rules this module enforces structurally, not just by
// convention:
//   - A channel whose `status` is "failed" or "not_run" NEVER contributes a
//     numeric 0 to any count. Its `perChannel` entry reads the literal
//     string "channel not run" instead, so a reader can never mistake "this
//     channel didn't run" for "this channel ran and found nothing" — the
//     exact confusion F-A-P2-02 found in the live pipeline's own cache.
//   - Latency/request counts are ECHOED verbatim from each channel's input
///    (or the literal string "no data" when absent) — never estimated,
//     averaged or backfilled.
//   - With zero channel inputs, or when no channel's status is "ok", the
//     whole result is `{ availability: "no_data", reason }` — never a
//     same-shaped "ok" result with every count at 0, which could be misread
//     as "compared and found nothing in common."
//   - Relevant-only counts appear only under `relevance`, and only take the
//     shape of real counts when the caller actually supplied
//     `relevanceLabels`; otherwise `relevance` is the literal string
//     "unlabeled" — never a same-shaped object with fabricated/zeroed counts.
//
// Unwired by design: this module has no caller anywhere outside its own test
// file. Feeding it real S2/OpenAlex channel output requires the live network
// access acceptance 4/18 leaves BLOCKED pending explicit user authorization
// (§1o.5) — offline fixtures are all this slice tests today.

/** How a channel's candidates were retrieved, for the seed-vs-keyword-style role breakdown. */
export type ChannelComparisonRole = "keyword" | "seed" | "semantic" | "citation" | "topic";

/** Mirrors the honesty distinction F-A-P2-02 forced into the live pipeline: "ok" (ran, `items` is the truth, even if empty) vs "failed"/"not_run" (no usable data — never treated as a zero). */
export type ChannelRunStatus = "ok" | "failed" | "not_run";

/**
 * One candidate from one channel. Either supply the raw identity fields
 * (`doi`/`externalIds`/`title`/`source`/`id`) and let this module resolve
 * them through `canonicalPaperKey`, or pass an already-resolved `identity`
 * directly (e.g. if the caller already computed it upstream). `year` and
 * `authors` apply either way — they only feed the title+year+author fallback
 * match tier, which sits outside `CanonicalIdentity` itself.
 */
export interface ChannelComparisonItem {
  id?: string;
  source?: string;
  doi?: string;
  title?: string;
  year?: number;
  authors?: string[];
  externalIds?: CanonicalPaperExternalIds;
  /** Precomputed canonical identity; takes precedence over doi/source/id/title when present. */
  identity?: CanonicalIdentity;
  rank: number;
}

export interface ChannelRun {
  /** Channel name, e.g. "s2-keyword", "openalex-keyword", "openalex-semantic". Free text — this module never hardcodes provider names. */
  channel: string;
  role?: ChannelComparisonRole;
  provider?: string;
  items: ChannelComparisonItem[];
  latencyMs?: number;
  requestCount?: number;
  status: ChannelRunStatus;
}

/**
 * Independent relevance labels for a held-out, human-labelled set — never
 * generated by the model/pipeline being evaluated (§3e). Keyed by a
 * canonical identity string: a work is looked up by every id-form key and
 * title alias its member items carry, so a label recorded under any one of a
 * work's aliases (e.g. its DOI form) is found regardless of which channel's
 * copy of the record is being scored.
 */
export type RelevanceLabelMap = Record<string, boolean>;

export interface CompareChannelsOptions {
  relevanceLabels?: RelevanceLabelMap;
}

export interface WorkContribution {
  channel: string;
  rank: number;
}

/** One canonical work found by one or more channels. */
export interface WorkEntry {
  /** Deterministic representative key: the lexicographically smallest id-form/title key across every member's identity — stable regardless of input order. */
  key: string;
  /** Channels that returned this work, sorted, deduped. */
  channels: string[];
  /** Every contributing (channel, rank) pair, sorted by channel then rank. */
  contributions: WorkContribution[];
}

export interface ChannelUniqueCount {
  channel: string;
  role?: ChannelComparisonRole;
  provider?: string;
  status: ChannelRunStatus;
  /** The literal string "channel not run" for a failed/not_run channel — never a bare 0. */
  uniqueWorkCount: number | "channel not run";
  latencyMs: number | "no data";
  requestCount: number | "no data";
}

/**
 * Overlap between two named groups (channels, or — inside `roleBreakdown` —
 * roles; the field names stay `channelA`/`channelB` in both contexts so the
 * shape is shared, see `RoleComparisonBreakdown`'s own doc).
 */
export interface PairwiseOverlapEntry {
  channelA: string;
  channelB: string;
  overlapCount: number;
  aOnlyCount: number;
  bOnlyCount: number;
  unionCount: number;
}

/** Works found by exactly this one channel (or role) among every channel (or role) compared — the generalized "S2-only" / "OpenAlex-only" count. */
export interface ExclusiveEntry {
  channel: string;
  exclusiveCount: number;
}

export interface UnionSummary {
  totalUniqueWorkCount: number;
  /** How many works would be missing if only that one channel had run — i.e. union size minus that channel's own unique-work count. */
  gainOverChannel: Record<string, number>;
}

export interface RoleGroupEntry {
  role: ChannelComparisonRole;
  channels: string[];
  uniqueWorkCount: number;
}

/**
 * The same overlap/exclusive shapes as the top-level result, computed over
 * ROLE groups instead of individual channels (e.g. every "seed" channel's
 * candidates pooled together vs every "keyword" channel's). `pairwiseOverlap`
 * and `exclusive` reuse `PairwiseOverlapEntry`/`ExclusiveEntry` verbatim —
 * their `channelA`/`channelB`/`channel` fields hold a role name here, not a
 * channel name.
 */
export interface RoleComparisonBreakdown {
  roles: RoleGroupEntry[];
  pairwiseOverlap: PairwiseOverlapEntry[];
  exclusive: ExclusiveEntry[];
}

/** The same set of counts as the top-level result, restricted to works an independent label marked relevant. Only ever built when the caller supplied `relevanceLabels`. */
export interface RelevanceBreakdown {
  /** Works that matched at least one label (true or false) under any of their id-form/title keys. */
  labeledWorkCount: number;
  /** Works with no matching label at all — never silently folded into "not relevant." */
  unlabeledWorkCount: number;
  perChannel: ChannelUniqueCount[];
  pairwiseOverlap: PairwiseOverlapEntry[];
  exclusive: ExclusiveEntry[];
  union: UnionSummary;
  roleBreakdown?: RoleComparisonBreakdown;
}

export interface ChannelComparisonResultOk {
  availability: "ok";
  perChannel: ChannelUniqueCount[];
  skippedChannels: { channel: string; status: "failed" | "not_run" }[];
  pairwiseOverlap: PairwiseOverlapEntry[];
  exclusive: ExclusiveEntry[];
  union: UnionSummary;
  works: WorkEntry[];
  /** Present only when at least one input channel carried a `role`. */
  roleBreakdown?: RoleComparisonBreakdown;
  /** The literal string "unlabeled" unless the caller supplied `relevanceLabels`. */
  relevance: RelevanceBreakdown | "unlabeled";
}

/** Zero usable channel inputs: either the input array was empty, or every channel's status was "failed"/"not_run". Never a same-shaped "ok" result with every count at 0. */
export interface ChannelComparisonResultNoData {
  availability: "no_data";
  reason: string;
}

export type ChannelComparisonResult = ChannelComparisonResultOk | ChannelComparisonResultNoData;

const NO_CHANNEL_INPUT_REASON = "no data: zero channel inputs provided";
const NO_USABLE_CHANNEL_REASON = "no data: every channel's status was failed or not_run";

/**
 * Best-effort surname of the first listed author, for the title+year+author
 * match fallback only — mirrors `feed/dedup.ts`'s own helper of the same
 * name so the two modules treat "First Last" / "Last, First" identically;
 * duplicated rather than imported because `dedup.ts` is outside this slice's
 * allowed-file list and the function is tiny/pure.
 */
function firstAuthorSurnameOf(authors: string[] | undefined): string | undefined {
  const first = authors?.[0]?.trim();
  if (!first) return undefined;
  if (first.includes(",")) {
    const surname = first.split(",")[0]?.trim();
    return surname || undefined;
  }
  const parts = first.split(/\s+/).filter(Boolean);
  return parts.length > 0 ? parts[parts.length - 1] : undefined;
}

function resolveIdentity(item: ChannelComparisonItem): CanonicalIdentity {
  if (item.identity) return item.identity;
  return canonicalPaperKey({
    source: item.source,
    id: item.id,
    doi: item.doi,
    title: item.title,
    externalIds: item.externalIds,
  });
}

/**
 * Every id-form key plus a title form this identity carries — used both for
 * grouping-by-shared-key (pass 1 below) and for relevance-label lookup.
 * Falls back to the identity's own (always-unique) key when neither exists,
 * so an unkeyable item still has something to be looked up/grouped by.
 */
function lookupKeysOf(identity: CanonicalIdentity): string[] {
  const set = new Set<string>(idFormKeys(identity));
  const t = titleFormOf(identity);
  if (t) set.add(t);
  if (set.size === 0) set.add(identity.key);
  return Array.from(set);
}

interface ResolvedItem {
  channel: string;
  rank: number;
  identity: CanonicalIdentity;
  matchInput: WorkMatchInput;
  lookupKeys: string[];
}

interface WorkGroup {
  representativeKey: string;
  members: ResolvedItem[];
}

/**
 * Groups resolved items into canonical works using the SHARED, corrected
 * clustering function (F-M-P2S5-01, per ABC-JEV-INTEGRATION.md §1p.G):
 * `clusterCanonicalWorks` unions strong (shared id-form key) links
 * transitively first, then evaluates weak (title+year±1+first-author) links
 * BETWEEN the resulting pass-1 clusters — collapsing a weak-linked component
 * into one work only when no two clusters anywhere in it conflict (share an
 * id-form TYPE with differing values). This replaces a private copy of the
 * OLD, buggy per-item union-find this file used to carry: that version could
 * let an ID-less "bridge" record (matching two otherwise-conflicting,
 * ID-bearing items by title+year+author alone) transitively merge them into
 * one work via two separate pairwise unions, even though comparing the two
 * conflicting items directly would correctly refuse to merge them. Using the
 * same function `feed/dedup.ts` uses keeps this harness's cross-channel
 * matching and the live pipeline's own dedupe from ever silently drifting
 * apart. Order-independent: the partition never depends on the order
 * `resolved` was built in (`clusterCanonicalWorks`'s own guarantee).
 */
function groupIntoWorks(resolved: ResolvedItem[]): WorkGroup[] {
  if (resolved.length === 0) return [];

  const finalGroups = clusterCanonicalWorks(resolved.map((r) => r.matchInput));

  return finalGroups.map((idxs) => {
    const members = idxs.map((i) => resolved[i]);
    const allKeys = new Set<string>();
    for (const m of members) for (const k of m.lookupKeys) allKeys.add(k);
    const representativeKey = Array.from(allKeys).sort()[0] ?? members[0].identity.key;
    return { representativeKey, members };
  });
}

interface ChannelMetrics {
  perChannel: ChannelUniqueCount[];
  pairwiseOverlap: PairwiseOverlapEntry[];
  exclusive: ExclusiveEntry[];
  union: UnionSummary;
}

/**
 * Shared core for both the top-level (all works) metrics and the
 * relevance-restricted metrics — same math, different `groupFilter`, so the
 * two can never silently drift apart from each other.
 */
function buildChannelMetrics(
  allRuns: ChannelRun[],
  okRuns: ChannelRun[],
  groups: WorkGroup[],
  groupFilter: (groupIndex: number) => boolean,
): ChannelMetrics {
  const channelNames = Array.from(new Set(okRuns.map((r) => r.channel))).sort();
  const setByChannel = new Map<string, Set<number>>();
  for (const name of channelNames) setByChannel.set(name, new Set());
  groups.forEach((g, gi) => {
    if (!groupFilter(gi)) return;
    for (const m of g.members) {
      setByChannel.get(m.channel)?.add(gi);
    }
  });

  const perChannel: ChannelUniqueCount[] = allRuns
    .map((run) => ({
      channel: run.channel,
      role: run.role,
      provider: run.provider,
      status: run.status,
      uniqueWorkCount:
        run.status === "ok" ? (setByChannel.get(run.channel)?.size ?? 0) : ("channel not run" as const),
      latencyMs: run.latencyMs ?? ("no data" as const),
      requestCount: run.requestCount ?? ("no data" as const),
    }))
    .sort((a, b) => a.channel.localeCompare(b.channel));

  const pairwiseOverlap: PairwiseOverlapEntry[] = [];
  for (let i = 0; i < channelNames.length; i++) {
    for (let j = i + 1; j < channelNames.length; j++) {
      const a = setByChannel.get(channelNames[i]) ?? new Set<number>();
      const b = setByChannel.get(channelNames[j]) ?? new Set<number>();
      let overlap = 0;
      for (const x of a) if (b.has(x)) overlap++;
      pairwiseOverlap.push({
        channelA: channelNames[i],
        channelB: channelNames[j],
        overlapCount: overlap,
        aOnlyCount: a.size - overlap,
        bOnlyCount: b.size - overlap,
        unionCount: a.size + b.size - overlap,
      });
    }
  }

  const exclusive: ExclusiveEntry[] = channelNames.map((name) => {
    const mine = setByChannel.get(name) ?? new Set<number>();
    let exclusiveCount = 0;
    for (const idx of mine) {
      let inOther = false;
      for (const other of channelNames) {
        if (other === name) continue;
        if ((setByChannel.get(other) ?? new Set()).has(idx)) {
          inOther = true;
          break;
        }
      }
      if (!inOther) exclusiveCount++;
    }
    return { channel: name, exclusiveCount };
  });

  const unionSet = new Set<number>();
  for (const name of channelNames) for (const idx of setByChannel.get(name) ?? new Set<number>()) unionSet.add(idx);
  const gainOverChannel: Record<string, number> = {};
  for (const name of channelNames) {
    gainOverChannel[name] = unionSet.size - (setByChannel.get(name)?.size ?? 0);
  }

  return { perChannel, pairwiseOverlap, exclusive, union: { totalUniqueWorkCount: unionSet.size, gainOverChannel } };
}

/** Same math as `buildChannelMetrics`, grouped by `role` instead of `channel`. Returns undefined when no input channel carried a role at all — an absent feature, not a misleadingly empty one. */
function buildRoleBreakdown(
  okRuns: ChannelRun[],
  groups: WorkGroup[],
  groupFilter: (groupIndex: number) => boolean,
): RoleComparisonBreakdown | undefined {
  const roleNames = Array.from(
    new Set(okRuns.map((r) => r.role).filter((r): r is ChannelComparisonRole => Boolean(r))),
  ).sort();
  if (roleNames.length === 0) return undefined;

  const channelToRole = new Map<string, ChannelComparisonRole>();
  for (const r of okRuns) if (r.role) channelToRole.set(r.channel, r.role);

  const setByRole = new Map<string, Set<number>>();
  for (const role of roleNames) setByRole.set(role, new Set());
  groups.forEach((g, gi) => {
    if (!groupFilter(gi)) return;
    const rolesTouched = new Set<string>();
    for (const m of g.members) {
      const role = channelToRole.get(m.channel);
      if (role) rolesTouched.add(role);
    }
    for (const role of rolesTouched) setByRole.get(role)?.add(gi);
  });

  const roles: RoleGroupEntry[] = roleNames.map((role) => ({
    role: role as ChannelComparisonRole,
    channels: okRuns
      .filter((r) => r.role === role)
      .map((r) => r.channel)
      .sort(),
    uniqueWorkCount: setByRole.get(role)?.size ?? 0,
  }));

  const pairwiseOverlap: PairwiseOverlapEntry[] = [];
  for (let i = 0; i < roleNames.length; i++) {
    for (let j = i + 1; j < roleNames.length; j++) {
      const a = setByRole.get(roleNames[i]) ?? new Set<number>();
      const b = setByRole.get(roleNames[j]) ?? new Set<number>();
      let overlap = 0;
      for (const x of a) if (b.has(x)) overlap++;
      pairwiseOverlap.push({
        channelA: roleNames[i],
        channelB: roleNames[j],
        overlapCount: overlap,
        aOnlyCount: a.size - overlap,
        bOnlyCount: b.size - overlap,
        unionCount: a.size + b.size - overlap,
      });
    }
  }

  const exclusive: ExclusiveEntry[] = roleNames.map((role) => {
    const mine = setByRole.get(role) ?? new Set<number>();
    let exclusiveCount = 0;
    for (const idx of mine) {
      let inOther = false;
      for (const other of roleNames) {
        if (other === role) continue;
        if ((setByRole.get(other) ?? new Set()).has(idx)) {
          inOther = true;
          break;
        }
      }
      if (!inOther) exclusiveCount++;
    }
    return { channel: role, exclusiveCount };
  });

  return { roles, pairwiseOverlap, exclusive };
}

/**
 * Compare several channels' ranked candidate lists. See the file header for
 * the full contract; in short: matches works by canonical identity (never
 * raw `id`), reports honest "channel not run" / "no data" sentinels instead
 * of fabricated zeros, and only computes relevance-restricted counts when
 * `options.relevanceLabels` is actually supplied.
 */
export function compareChannels(runs: ChannelRun[], options: CompareChannelsOptions = {}): ChannelComparisonResult {
  if (runs.length === 0) {
    return { availability: "no_data", reason: NO_CHANNEL_INPUT_REASON };
  }

  const okRuns = runs.filter((r) => r.status === "ok");
  if (okRuns.length === 0) {
    return { availability: "no_data", reason: NO_USABLE_CHANNEL_REASON };
  }

  const resolved: ResolvedItem[] = [];
  for (const run of okRuns) {
    for (const item of run.items) {
      const identity = resolveIdentity(item);
      resolved.push({
        channel: run.channel,
        rank: item.rank,
        identity,
        matchInput: {
          identity,
          publishedYear: item.year,
          firstAuthorSurname: firstAuthorSurnameOf(item.authors),
        },
        lookupKeys: lookupKeysOf(identity),
      });
    }
  }

  const groups = groupIntoWorks(resolved);
  const includeAll = () => true;

  const main = buildChannelMetrics(runs, okRuns, groups, includeAll);
  const roleBreakdown = buildRoleBreakdown(okRuns, groups, includeAll);

  const works: WorkEntry[] = groups
    .map((g) => ({
      key: g.representativeKey,
      channels: Array.from(new Set(g.members.map((m) => m.channel))).sort(),
      contributions: g.members
        .map((m) => ({ channel: m.channel, rank: m.rank }))
        .sort((x, y) => x.channel.localeCompare(y.channel) || x.rank - y.rank),
    }))
    .sort((a, b) => a.key.localeCompare(b.key));

  let relevance: RelevanceBreakdown | "unlabeled";
  if (options.relevanceLabels === undefined) {
    relevance = "unlabeled";
  } else {
    const labels = options.relevanceLabels;
    const relevantGroupIdxs = new Set<number>();
    let labeledWorkCount = 0;
    let unlabeledWorkCount = 0;
    groups.forEach((g, gi) => {
      let sawTrue = false;
      let sawFalse = false;
      for (const m of g.members) {
        for (const k of m.lookupKeys) {
          if (Object.prototype.hasOwnProperty.call(labels, k)) {
            if (labels[k]) sawTrue = true;
            else sawFalse = true;
          }
        }
      }
      if (sawTrue) {
        relevantGroupIdxs.add(gi);
        labeledWorkCount++;
      } else if (sawFalse) {
        labeledWorkCount++;
      } else {
        unlabeledWorkCount++;
      }
    });

    const relevantFilter = (gi: number) => relevantGroupIdxs.has(gi);
    const relevantMetrics = buildChannelMetrics(runs, okRuns, groups, relevantFilter);
    const relevantRoleBreakdown = buildRoleBreakdown(okRuns, groups, relevantFilter);

    relevance = {
      labeledWorkCount,
      unlabeledWorkCount,
      perChannel: relevantMetrics.perChannel,
      pairwiseOverlap: relevantMetrics.pairwiseOverlap,
      exclusive: relevantMetrics.exclusive,
      union: relevantMetrics.union,
      roleBreakdown: relevantRoleBreakdown,
    };
  }

  return {
    availability: "ok",
    perChannel: main.perChannel,
    skippedChannels: runs
      .filter((r) => r.status !== "ok")
      .map((r) => ({ channel: r.channel, status: r.status as "failed" | "not_run" }))
      .sort((a, b) => a.channel.localeCompare(b.channel)),
    pairwiseOverlap: main.pairwiseOverlap,
    exclusive: main.exclusive,
    union: main.union,
    works,
    roleBreakdown,
    relevance,
  };
}

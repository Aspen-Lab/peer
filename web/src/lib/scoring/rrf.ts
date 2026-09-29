// P2-S6 (Round 3) — F-A-P2-05, ABC-JEV-INTEGRATION.md §1p.B(1) and the
// P2-S6 RULING (§4 Round 3 "P2-S6 RULING — what PEER_RANK_FUSION=on
// changes"). Pure reciprocal-rank-fusion module: fold each retrieval
// channel's own rank list to one best-rank-per-canonical-work list (stage
// 1), then fuse every channel's folded list into one ranked, deterministic,
// provenance-carrying order (stage 2). No network call, no model call, no
// throw on malformed input — matches every other pure module in this phase
// (canonical-identity.ts, paper-identity.ts, channel-comparison.ts).
//
// Candidates are matched into "the same canonical work" using the SAME
// shared clustering `feed/dedup.ts` and `scoring/channel-comparison.ts`
// already use (`clusterCanonicalWorks` in `feed/paper-identity.ts`), not a
// private key-equality check — so a paper two channels found under
// different id-form types (e.g. one channel only saw its arXiv id, another
// only its PMID) still fuses into one work here exactly as it would dedupe
// into one survivor later, instead of silently splitting its votes across
// two "different" canonical keys. See rrf.test.ts's "identity matching"
// group for the reproduction this avoids.
//
// A CHANNEL, for this module, is whatever the caller says it is — one
// retrieval path (see pipeline.ts's own channel map in the P2-S6 checkpoint
// for what that means in production: one academic source's keyword search,
// OpenAlex semantic search, the citation neighbourhood, the topic/field
// filter). If a path ran several queries, the caller supplies them as
// separate entries in that channel's own `queries` array; stage 1 folds
// them into one vote per channel automatically — ten synonym queries on one
// channel never out-vote a single-query channel (rrf.test.ts's own
// dedicated test).

import {
  canonicalPaperKey,
  idFormKeys,
  titleFormOf,
  type CanonicalIdentity,
  type CanonicalPaperExternalIds,
  type WorkMatchInput,
} from "@/lib/utils/canonical-identity";
import { clusterCanonicalWorks } from "@/lib/feed/paper-identity";

/**
 * One candidate as RRF needs to see it: either the raw identity fields (the
 * same shape `scoring/channel-comparison.ts`'s `ChannelComparisonItem`
 * already established for this phase) or a precomputed `identity`, which
 * takes precedence. `year`/`authors` feed the weak-link
 * (title+year+first-author) tier of `clusterCanonicalWorks` only; omit them
 * and a candidate simply never weak-links — a safe degradation, never a
 * guess.
 */
export interface RRFCandidate {
  id?: string;
  source?: string;
  doi?: string;
  title?: string;
  year?: number;
  authors?: string[];
  externalIds?: CanonicalPaperExternalIds;
  /** Precomputed canonical identity; takes precedence over doi/source/id/title when present. */
  identity?: CanonicalIdentity;
}

export interface RRFChannelInput {
  /** Channel name, e.g. "openalex", "semantic_scholar", "citation", "semantic", "topic-field". Free text — this module never hardcodes provider names. */
  channel: string;
  /**
   * One array per query executed on this channel, each ALREADY in that
   * query's own best-to-worst rank order (index 0 = rank 1 — ranks are
   * 1-based throughout this module). The common case is one query: pass a
   * single-element array (this is what every build-time channel in
   * `pipeline.ts` does today, since every source adapter already folds its
   * own internal multi-query fan-out into one list before returning). Several
   * separate query arrays on the same channel (e.g. ten keyword synonyms
   * against one source, if a future caller ever needs to pass them
   * unfolded) fold into ONE per-channel vote inside stage 1 — they never
   * multiply that channel's influence.
   */
  queries: RRFCandidate[][];
  /**
   * At most this many of this channel's OWN best-ranked canonical works
   * (after stage-1 folding, tie-broken by work key) are eligible to cast
   * this channel's vote; a work ranked beyond the cap simply gets no vote
   * FROM THIS CHANNEL (it may still be ranked via another channel's vote).
   * `undefined` or `<=0` — the neutral default — means no cap: every folded
   * work from this channel votes.
   */
  cap?: number;
}

export interface RRFOptions {
  /** RRF's k constant. Default 60 (docs/JEV-RETRIEVAL-PLAN.zh-CN.md §3c: "initial k=60, tunable"). Rank is 1-based. */
  k?: number;
  /**
   * Reserved exploration slots per channel. Neutral default 0 (no effect on
   * ordering — pure fused-score order). When N>0, each channel (processed
   * in the order given in `channels`) has its N WORST-still-voting folded
   * works (worst rank first, i.e. the channel's weakest genuinely-admitted
   * candidates) relocated to the FRONT of the returned order, ahead of the
   * pure fused-score ranking — guaranteeing they survive any downstream
   * top-K cut instead of being silently crowded out by another channel's
   * strongest candidates (docs/JEV-RETRIEVAL-PLAN.zh-CN.md §3: "保留探索名额",
   * reserve exploration capacity). A work already reserved by an earlier
   * channel in the same call is never reserved twice.
   */
  explorationSlots?: number;
}

export interface RRFChannelContribution {
  channel: string;
  /** This work's best (lowest) rank within this channel, 1-based, after stage-1 folding — only present for a channel that actually contributed a vote (survived that channel's own cap). */
  rank: number;
}

export interface RRFResult {
  /** Deterministic representative identity key for this canonical work: the lexicographically smallest id-form/title key among its members — stable regardless of input order, and this module's sort tie-break. */
  key: string;
  fusedScore: number;
  /** Every channel that actually voted for this work — fused score + [{channel, rank}] — sorted by channel name then rank. */
  channels: RRFChannelContribution[];
}

const DEFAULT_K = 60;

function resolveIdentity(candidate: RRFCandidate): CanonicalIdentity {
  if (candidate.identity) return candidate.identity;
  return canonicalPaperKey({
    source: candidate.source,
    id: candidate.id,
    doi: candidate.doi,
    title: candidate.title,
    externalIds: candidate.externalIds,
  });
}

/**
 * Every id-form key plus a title form this identity carries, falling back
 * to the identity's own (always-unique) key when neither exists — mirrors
 * `scoring/channel-comparison.ts`'s `lookupKeysOf` exactly, so the two
 * modules pick the same representative key for the same input.
 */
function lookupKeysOf(identity: CanonicalIdentity): string[] {
  const set = new Set<string>(idFormKeys(identity));
  const t = titleFormOf(identity);
  if (t) set.add(t);
  if (set.size === 0) set.add(identity.key);
  return Array.from(set);
}

interface ResolvedCandidate {
  channel: string;
  /** 1-based rank within its own query array. */
  rank: number;
  matchInput: WorkMatchInput;
  lookupKeys: string[];
}

interface WorkGroup {
  key: string;
  /** channel -> best (lowest) within-channel rank across every member from that channel, pre-cap. */
  bestRankByChannel: Map<string, number>;
}

interface FusedWork {
  key: string;
  fusedScore: number;
  channels: RRFChannelContribution[];
}

/**
 * Fold + fuse. See the file header for the two-stage algorithm. Never
 * throws: a candidate with no resolvable identity at all still gets
 * `canonicalPaperKey`'s own guaranteed-unique `item:` fallback key (the same
 * defensive contract `canonical-identity.ts` documents), so it simply fuses
 * as its own singleton work rather than crashing or vanishing.
 */
export function fuseRankings(
  channels: ReadonlyArray<RRFChannelInput>,
  options: RRFOptions = {},
): RRFResult[] {
  const k = options.k ?? DEFAULT_K;
  const explorationSlots = options.explorationSlots ?? 0;

  // Flatten every channel's every query into one resolved-candidate list,
  // carrying its own channel name and 1-based within-query rank.
  const resolved: ResolvedCandidate[] = [];
  for (const channelInput of channels) {
    for (const query of channelInput.queries) {
      query.forEach((candidate, idx) => {
        const identity = resolveIdentity(candidate);
        resolved.push({
          channel: channelInput.channel,
          rank: idx + 1,
          matchInput: {
            identity,
            publishedYear: candidate.year,
            firstAuthorSurname: candidate.authors?.[0]?.trim() || undefined,
          },
          lookupKeys: lookupKeysOf(identity),
        });
      });
    }
  }

  if (resolved.length === 0) return [];

  // Group into canonical works with the SAME shared, order-independent
  // clustering `feed/dedup.ts` and `channel-comparison.ts` use — see file
  // header. DEDUP-FIX3 (ABC-JEV-INTEGRATION.md §4 Round 3 "structural
  // pairwise rule ruled", 2026-09-24T22:06:02Z): a weak-linked component of
  // pass-1 clusters collapses into one work only if every pair of records
  // drawn from different clusters in it directly satisfies the
  // title+year+author weak-link test below; ids play no part in that
  // decision. Pass-1 strong links (shared real id-form key) are unchanged.
  const groups = clusterCanonicalWorks(resolved.map((r) => r.matchInput));

  const workGroups: WorkGroup[] = groups.map((idxs) => {
    const members = idxs.map((i) => resolved[i]);
    const allKeys = new Set<string>();
    for (const m of members) for (const key of m.lookupKeys) allKeys.add(key);
    const key = Array.from(allKeys).sort()[0] ?? members[0].lookupKeys[0];

    const bestRankByChannel = new Map<string, number>();
    for (const m of members) {
      const current = bestRankByChannel.get(m.channel);
      if (current === undefined || m.rank < current) {
        bestRankByChannel.set(m.channel, m.rank);
      }
    }
    return { key, bestRankByChannel };
  });

  // Per-channel cap: only that channel's best-`cap` works (by folded rank,
  // tie-broken by work key) keep their vote from that channel. A channel
  // absent from this map (no cap set, or cap <= 0) never restricts anyone.
  const votingWorkKeysByChannel = new Map<string, Set<string>>();
  for (const c of channels) {
    if (c.cap === undefined || c.cap <= 0) continue;
    const entries = workGroups
      .filter((g) => g.bestRankByChannel.has(c.channel))
      .map((g) => ({ key: g.key, rank: g.bestRankByChannel.get(c.channel)! }))
      .sort((a, b) => a.rank - b.rank || a.key.localeCompare(b.key))
      .slice(0, c.cap);
    votingWorkKeysByChannel.set(c.channel, new Set(entries.map((e) => e.key)));
  }
  function channelMayVote(workKey: string, channelName: string): boolean {
    const allowed = votingWorkKeysByChannel.get(channelName);
    return allowed === undefined || allowed.has(workKey);
  }

  // Stage 2 — fuse, keeping only channels that actually vote for this work
  // (survived that channel's own cap, if any).
  const fused: FusedWork[] = [];
  for (const group of workGroups) {
    const contributions: RRFChannelContribution[] = [];
    let score = 0;
    for (const [channelName, rank] of group.bestRankByChannel) {
      if (!channelMayVote(group.key, channelName)) continue;
      score += 1 / (k + rank);
      contributions.push({ channel: channelName, rank });
    }
    if (contributions.length === 0) continue; // capped out of every channel it was found in
    contributions.sort((a, b) => a.channel.localeCompare(b.channel) || a.rank - b.rank);
    fused.push({ key: group.key, fusedScore: score, channels: contributions });
  }

  // Base order: fused score desc, deterministic tie-break by key asc — this
  // is what makes the same input, given in any order, always come out the
  // same way (rrf.test.ts's "determinism" case).
  fused.sort((a, b) => b.fusedScore - a.fusedScore || a.key.localeCompare(b.key));

  if (explorationSlots <= 0) {
    return fused;
  }

  // Exploration slots: per channel (processed in `channels`' own input
  // order), its N worst-still-voting works (worst rank first) move to the
  // front of the returned order, ahead of the pure fused-score ranking. A
  // work already reserved by an earlier channel in this same call is never
  // reserved twice.
  const reserved: FusedWork[] = [];
  const reservedKeys = new Set<string>();
  for (const channelInput of channels) {
    const votedByThisChannel = fused
      .map((f) => ({
        f,
        rank: f.channels.find((c) => c.channel === channelInput.channel)?.rank,
      }))
      .filter((x): x is { f: FusedWork; rank: number } => x.rank !== undefined)
      .sort((a, b) => b.rank - a.rank || a.f.key.localeCompare(b.f.key)); // worst rank first

    let taken = 0;
    for (const { f } of votedByThisChannel) {
      if (taken >= explorationSlots) break;
      if (reservedKeys.has(f.key)) continue;
      reserved.push(f);
      reservedKeys.add(f.key);
      taken++;
    }
  }

  const rest = fused.filter((f) => !reservedKeys.has(f.key));
  return [...reserved, ...rest];
}

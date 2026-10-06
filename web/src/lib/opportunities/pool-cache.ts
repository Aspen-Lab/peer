import { createHash } from "node:crypto";
import type {
  CareerStage,
  OpportunityFacetCounts,
} from "@/types";
import type { ScoredEventItem } from "@/lib/events/types";
import type { ScoredJobItem } from "@/lib/jobs/types";
import type { ScoredItem } from "@/lib/scoring/types";
import type { SourceId } from "@/lib/sources/types";
import { localCalendarDate, localIsoWeek } from "@/lib/local-calendar-date";
import { canonicalize } from "@/lib/scoring/term-expand";

export type OpportunitySurface = "papers" | "events" | "jobs";
export type { OpportunityFacetCounts, OpportunityFormat } from "@/types";
export { localCalendarDate, localIsoWeek } from "@/lib/local-calendar-date";

interface CachedPoolBase {
  generatedAt: string;
  localDate: string;
}

interface CachedOpportunityPoolBase extends CachedPoolBase {
  facetCounts: OpportunityFacetCounts;
}

/**
 * The paper surface's daily pool — the twin of `CachedEventPool` /
 * `CachedJobPool`, and it replaced a far thinner record that held ONLY the
 * web-search discovery side-channel's query boosts. That record cached the
 * cheap half of a paper build and left the expensive half — every academic
 * source fetch and, at Tier 2, an LLM rerank — to re-run on every request, so
 * a page reload rebuilt the feed and re-spent the tokens. The side-channel
 * itself is gone; see `buildPaperPool` for why nothing was lost with it.
 *
 * Two fields have no counterpart on the other two surfaces:
 *
 * - `items` are scored WITHOUT the preference ledger, exactly as the jobs pool
 *   is, so one day's pool can be re-ranked locally when likes/dismissals move.
 * - `aiOrder` / `aiReasons` carry Tier 2's output forward. Re-scoring on a hit
 *   would otherwise discard the one part of the build that costs money, which
 *   would defeat the point of caching at all.
 */
export type SourceHealthStatus = "ok" | "empty" | "failed";

/**
 * P2-S2 (Round 3) — F-A-P2-02, ABC-JEV-INTEGRATION.md §1p.B(2). Per-source
 * health for ONE local day's papers pool, plus enough bookkeeping to bound a
 * later read's retry of a failed source: at most once per 30 minutes and at
 * most 3 times per local day (`@/lib/feed/pipeline.ts`'s
 * `isEligibleForRetry`). `lastAttemptAt` covers the ORIGINAL build too (not
 * only a retry), so eligibility reads from one timestamp rather than two.
 * `retryCount` starts at 0 on the build itself, which is not a retry.
 */
export interface SourceStatusEntry {
  status: SourceHealthStatus;
  lastAttemptAt: string;
  retryCount: number;
  /**
   * Only set when `status` is "failed" — the underlying fetch error's own
   * message, so a cache-hit response can report the SAME honest detail a
   * fresh build response would, not just the bare word "failed".
   */
  lastErrorMessage?: string;
  /**
   * DBLP-BOTWALL (ABC-JEV-INTEGRATION.md §1ba, ruling 2). Only meaningful
   * when `status` is "failed": true when that failure was classified as an
   * anti-automation challenge page rather than an ordinary outage (today,
   * only `sources/dblp.ts`'s `DblpBotCheckError`, via `feed/pipeline.ts`'s
   * `isEligibleForRetry`). Such a failure is not retried for the rest of the
   * local day regardless of `retryCount`/the 30-minute window — the source
   * is explicitly asking automated clients to stop, so spending more of the
   * day's retry budget on it just repeats the same wasted, unwanted request.
   * It still self-heals the next local day for free: a new local day is a
   * new pool cache key and therefore a fresh `sourceStatus` (see
   * `SOURCE_RETRY_INTERVAL_MS`'s own doc comment in `feed/pipeline.ts`), so
   * this field needs no reset logic of its own. Absent (or false) on every
   * ordinary failure and on every pool built before this field existed —
   * both read as "not blocked" — so this is purely additive: no migration
   * and no `PAPER_CACHE_KEY_VERSION` bump, matching this same doc comment's
   * own reasoning for `lastErrorMessage`/`sourceStatus` above.
   */
  retryBlockedToday?: boolean;
}

export interface CachedPaperPool extends CachedPoolBase {
  surface: "papers";
  items: ScoredItem[];
  /** Tier-2 ranking order, best-first. Empty when Tier 2 did not run. */
  aiOrder: string[];
  /** Tier-2 written reasons, by paper id. Empty when Tier 2 did not run. */
  aiReasons: Record<string, string>;
  /**
   * P2-S2 (Round 3) — F-A-P2-02, ABC-JEV-INTEGRATION.md §1p.B(2)/§3c.
   * Absent on any pool built before this slice, and absent per-source for
   * any source a build never attempted: both are treated as unknown/assume
   * ok by every reader, so this field is purely additive — no migration and
   * no `PAPER_CACHE_KEY_VERSION` bump (see `feed/pipeline.ts`'s
   * `buildPaperPool`/`retryFailedSources` and this slice's checkpoint
   * DESIGN CHOICES for why a version bump was deliberately not taken: the
   * durable store's own key-prefix gate, `private-paper-cache.ts`'s
   * `"peer-pool-v6-papers-"` check, is out of this slice's allowed files).
   */
  sourceStatus?: Partial<Record<SourceId, SourceStatusEntry>>;
  /**
   * P2-S6-FIX (Round 3) — F-A-P2S6-02, ABC-JEV-INTEGRATION.md §4 "P2-S6
   * RULING" + docs/jev-abc/P2-S6-A-20260924T145415Z.md NEW FINDING #2.
   * Reciprocal-rank-fusion provenance for a pool built with
   * `PEER_RANK_FUSION=on` — same per-item shape as `FeedMeta.rrf`
   * (`feed/types.ts`), inlined here rather than imported from there (or from
   * `scoring/rrf.ts`) to avoid a new cross-module type dependency for a
   * shared, purely additive field shape, matching the same choice
   * `FeedMeta.rrf`'s own doc comment already made for the same reason.
   * Absent on any pool built before this field existed, on any pool built
   * with the flag off, and on any pool whose build had no fresh RRF
   * computation to report — every reader treats a missing key as "no
   * provenance," never as a same-shaped object with fabricated/zero values,
   * so this field is purely additive: no migration and no
   * `PAPER_CACHE_KEY_VERSION` bump (same reasoning `sourceStatus`'s own doc
   * comment above already gives for itself). Before this field existed,
   * `feed/pipeline.ts` computed this same data at build time but had
   * nowhere on the CACHED pool to put it, so a same-day cache-hit read had
   * no path to it at all — see `feed/pipeline.ts`'s `getOrBuildCachedPool`
   * call site (the `build()` callback now spreads `built.rrf` in here) and
   * its final `meta` assembly (now reads `pool.rrf` instead of gating
   * strictly on build-only `diagnostics`).
   */
  rrf?: Record<string, { fusedScore: number; channels: { channel: string; rank: number }[] }>;
  /**
   * What Jev did when this pool was built, present ONLY for a pool built with a
   * reader's own Jev key (such a pool has its own key, `PoolCacheKeyInput.
   * jevScreening`). Counts and one status word, nothing else: never the key, never
   * a paper's text. The read path reports it as `FeedMeta.jevScreening` on every
   * same-day read, so a cache hit can say what the build did. Same shape as
   * `decisions/apply.ts`'s `JevScreeningMeta`, inlined here (not imported) for the
   * reason `rrf` above gives: no new cross-module type dependency for a small
   * additive field. Absent on every pool built without a Jev key and on every
   * pool built before this field existed, both read as "no Jev", so it is purely
   * additive: no migration and no `PAPER_CACHE_KEY_VERSION` bump.
   */
  jev?: { status: "applied" | "partial" | "unavailable" | "rejected"; screened: number; of: number };
}

export interface CachedEventPool extends CachedOpportunityPoolBase {
  surface: "events";
  items: ScoredEventItem[];
}

export interface CachedJobPool extends CachedOpportunityPoolBase {
  surface: "jobs";
  items: ScoredJobItem[];
}

/**
 * Enriched daily candidates with a neutral baseline score. Request-time
 * preference scoring may reorder them locally without rebuilding this pool.
 */
export type CachedPool =
  | CachedPaperPool
  | CachedEventPool
  | CachedJobPool;

export interface PoolCache {
  get(key: string): Promise<CachedPool | null>;
  set(key: string, pool: CachedPool): Promise<void>;
}

export interface DailyPoolLoad<TPool extends CachedPool> {
  pool: TPool;
  /** True for a persisted hit or an in-process request coalesced onto a build. */
  cacheHit: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isCachedPool(value: unknown): value is CachedPool {
  if (!isRecord(value)) return false;
  if (typeof value.generatedAt !== "string") return false;
  if (typeof value.localDate !== "string") return false;

  if (value.surface === "papers") {
    return (
      Array.isArray(value.items) &&
      Array.isArray(value.aiOrder) &&
      value.aiOrder.every((id) => typeof id === "string") &&
      isRecord(value.aiReasons)
    );
  }

  if (value.surface !== "events" && value.surface !== "jobs") return false;
  if (!Array.isArray(value.items)) return false;
  return isRecord(value.facetCounts);
}

export function isCachedPaperPool(pool: CachedPool): pool is CachedPaperPool {
  return pool.surface === "papers";
}

export function isCachedEventPool(pool: CachedPool): pool is CachedEventPool {
  return pool.surface === "events";
}

export function isCachedJobPool(pool: CachedPool): pool is CachedJobPool {
  return pool.surface === "jobs";
}

export interface PoolCacheKeyInput {
  uploadInterests?: string[];
  surface: OpportunitySurface;
  requiredTopics: string[];
  exploreTopics?: string[];
  careerStage?: CareerStage;
  locationPreferences?: string[];
  /**
   * Papers only. A Tier-2 pool carries an LLM ranking a Tier-0 pool does not,
   * so the tier changes the payload rather than just the view of it. Left
   * undefined by every other caller, which `JSON.stringify` omits — so the
   * events and jobs keys keep the shape they had before this field existed.
   */
  aiTier?: 0 | 1 | 2;
  /** A server-derived private paper intent identity; never supplied by HTTP. */
  paperScopeIdentity?: string;
  /** Owner is a separate private boundary, not merely part of a hash. */
  paperOwnerId?: string;
  /**
   * Papers only. True when the reader brought their own Jev key and this pool is
   * built with Jev's order in it, so it must not be the pool a reader without
   * the key shares (a key added at noon would otherwise keep serving the keyless
   * pool until tomorrow). Hashed ONLY when true, so every key that existed before
   * this field is byte-identical (`pool-cache.test.ts` pins three of them). It
   * is a boolean on purpose: no key value, hash of one or any other trace of the
   * reader's Jev key may reach a cache key.
   */
  jevScreening?: true;
  now?: Date;
}

// Bump whenever the durable pool payload semantics change. v3 makes cached
// scores preference-neutral so one daily pool can be safely re-ranked locally.
// v4 turns the papers entry from a discovery-only record into a full daily
// pool, so a v3 papers entry can no longer satisfy a v4 read. v5 drops the
// deleted discovery side-channel's `queryBoosts`/`resultCount` from it. v6
// moves the jobs and events period from a day to an ISO week (R-POOL-1); the
// bump is **not optional**, because a v5 daily key and a v6 weekly key would
// otherwise collide in the shared `opportunity_pools` table.
const CACHE_KEY_VERSION = 6;
// Papers stay on their own version number, bumped independently for P0-01
// (owner/intent scoping joined the hashed signature — an old v5 papers-cache
// row must never be read back as if it already had that scope). v7 —
// ABC-JEV-INTEGRATION.md §1ao.9/REQUIRED-GATE
// (docs/jev-abc/REQUIRED-GATE-B-20260928T160542Z.md): the Required-topic
// gate changed from a literal whole-phrase match to a T1-T4 qualification
// union, so a v6 pool scored under the old literal-only rule must never be
// served as if it reflects the new one. v8 — ABC-JEV-INTEGRATION.md
// §1ap/SENSE-CONTEXT (docs/jev-abc/SENSE-CONTEXT-B-20260928T173815Z.md): a
// short/ambiguous Required tag's T1-T3 literal hits can now be DEMOTED and
// T4's (similarity-only) admission of such a tag now additionally requires
// a context-agreement gate, so a v7 pool that admitted a wrong-domain paper
// at full grounding, or through T4 alone, must never be served as if it
// already reflects the gate. v9 — ABC-JEV-INTEGRATION.md §1ap AMENDMENT 4
// (docs/jev-abc/SENSE-CONTEXT-C2-20260928T205712Z.md): the context-agreement
// gate itself changed from a pool-relative measure (whose verdict on the
// SAME paper could depend on how many other items were fetched that day) to
// a pool-independent one built on a fixed shipped table, and a paper that
// self-declares a conflicting abbreviation expansion is now a hard
// non-match — a v8 pool scored under the old pool-relative gate (or without
// the self-declared-expansion rule) must never be served as if it reflects
// either change. v10 — ABC-JEV-INTEGRATION.md §1au/LCO-FORMULA
// (docs/jev-abc/LCO-FORMULA-B-20260928T234855Z.md): `ABBREVIATION_GROUPS`
// gained a bare chemical-formula alias for LCO ("licoo2") and LFP
// ("lifepo4"), so a paper that only ever spells the formula (never the
// abbreviation or the spelled-out name) now qualifies those Required tags
// through T1 — a v9 pool built under the old, formula-blind vocabulary must
// never be served as if it already reflects the wider match. v11 —
// ABC-JEV-INTEGRATION.md §1av/ABBREV-RECALL
// (docs/jev-abc/ABBREV-RECALL-B-20260929T004152Z.md): `profile-compiler.ts`'s
// projectQueries now puts a reader's Required tags ahead of their project/
// challenge phrases, so a tag that free text never restates (e.g. "LCO")
// survives every source adapter's own MAX_QUERIES truncation instead of
// being silently crowded out — a v10 pool built under the old, tag-last
// ordering may be missing candidates the corrected retrieval would have
// fetched and must never be served as if it already reflects the fix. v12 —
// ABC-JEV-INTEGRATION.md §1at/SCORE-ZERO
// (docs/jev-abc/SCORE-ZERO-B-20260928T234238Z.md): `negativePenalty` no
// longer receives the system's default avoid-review words (only the
// reader's own declared dislikes), and `rerank.ts`'s review/avoid demotion
// no longer floors a shown item at exactly 0 — both change a paper's
// `score`/`scoreBreakdown`/order without changing pool membership, so a v11
// pool scored under the old double-penalty/hard-floor must never be served
// as if it already reflects the fix. v13 — ABC-JEV-INTEGRATION.md
// §1aw/DEDUP-ANGEW (docs/jev-abc/DEDUP-ANGEW-B-20260929T064532Z.md):
// `canonical-identity.ts`'s `canonicalPaperKey` now gives a
// 10.1002/ange.<N> DOI (Angewandte Chemie's German-language edition) an
// extra alias toward its 10.1002/anie.<N> sibling (the International
// Edition), so the two editions of the same article — previously shown as
// two separate cards whenever the anie copy was already strong-linked to an
// unrelated record — now merge into one via dedupe's existing pass-1 rule.
// This changes pool MEMBERSHIP (a v12 pool built under the old, alias-blind
// identity may still carry both editions as separate items), so a v12 pool
// must never be served as if it already reflects the merge. v14 —
// ABC-JEV-INTEGRATION.md §1ax/SENSE-CONTEXT-R3
// (docs/jev-abc/SENSE-CONTEXT-R3-B-20260929T075345Z.md): `keyword.ts`'s
// `senseContextStripSet` now also strips each Required tag's hyphen-joined
// spelling (e.g. "solid-state" for the tag "solid state"), closing a leak
// where that ordinary orthographic form of the tag's own name survived
// tokenization as one token and counted as unrelated "agreeing" vocabulary.
// This changes which short/ambiguous-tag matches pass the context gate —
// a paper's `score`/`scoreBreakdown`/grounding can change without its
// pool MEMBERSHIP changing (same shape as v12/SCORE-ZERO above), so a v13
// pool scored under the old, hyphen-blind strip set must never be served
// as if it already reflects the fix. v15 — ABC-JEV-INTEGRATION.md
// §1ay/QUERY-QUALITY (docs/jev-abc/QUERY-QUALITY-B-20260929T084721Z.md):
// `profile-compiler.ts`'s `projectQueries` no longer sends a reader's whole
// multi-sentence project/challenge text as one literal query (only text
// already short enough to BE a phrase, <=6 words, is still sent verbatim —
// its derived phrases are sent either way), and `phrasesFromText` now also
// splits on commas so real 2-6 word phrases survive instead of the branch
// starving and falling back to single generic words. This changes pool
// MEMBERSHIP (a v14 pool built under the old raw-paragraph-plus-single-word
// queries may be missing candidates the corrected phrase queries would have
// fetched), so a v14 pool must never be served as if it already reflects
// the fix. v16 — ABC-JEV-INTEGRATION.md §1az/QUERY-BUDGET
// (docs/jev-abc/QUERY-BUDGET-B-20260929T094059Z.md): `profile-compiler.ts`'s
// `projectQueries` now orders queries into tiers (Required tags, then exact-
// sense queries, then bare project phrases, then tag+phrase combinations,
// then bare single words, then the rest) instead of one flat concatenation,
// and `dblp.ts`/`pubmed.ts` now raise their own query cap when a reader
// declares more than 2 Required tags. Both change which queries survive each
// source adapter's own truncation, which changes pool MEMBERSHIP (a v15 pool
// built under the old ordering/fixed caps may be missing candidates the
// reordered/wider retrieval would have fetched), so a v15 pool must never be
// served as if it already reflects the fix. v17 — ABC-JEV-INTEGRATION.md
// §1be point 5/TOKENIZE-PLURALS (docs/jev-abc/TOKENIZE-PLURALS-B-20260929T141359Z.md;
// split from the original guide's wider recommendation after folding
// exposed a pre-existing path defect in the context check, moved to the new
// item SENSE-CONTEXT-EVIDENCE): combine.ts's T4 (Required-gate similarity)
// comparison now folds plurals (e.g. a paper that only ever says
// "electrolytes" now agrees with the Required tag "electrolyte") before
// comparing; `tokenize()` itself, the pool-wide topicality index,
// keyword.ts's SENSE-CONTEXT short-tag context check, rerank.ts, and the
// reference table are unchanged. This changes pool MEMBERSHIP (T4 can newly
// admit a plural-only paraphrase), so a v16 pool built under the old,
// plural-blind T4 comparison must never be served as if it already reflects
// the fix. v18 — ABC-JEV-INTEGRATION.md §1bg/SENSE-CONTEXT-EVIDENCE
// (docs/jev-abc/SENSE-CONTEXT-EVIDENCE-B-20260929T163908Z.md): keyword.ts's
// SENSE-CONTEXT short-tag context check (`senseContextGate`/
// `senseContextStripSet`) now folds plurals too (the fold v17's own comment
// said stayed out, moved here after its own defect was fixed) AND drops,
// from its overlap axis only, every token whose shipped-reference-table
// weight sits below the table's own Pth-percentile weight (P = 10 as
// shipped, narrowed from an original P = 25 by §1bg point 12 after a real-
// paper regression — see keyword.ts's own
// `SENSE_CONTEXT_OVERLAP_DOCFREQ_CUT_PERCENTILE` doc comment for the full
// history and today's pinned value rather than restating the number here);
// separately, a literal Required-tag match that came through the tag's own full spelled-
// out name or chemical formula (not its bare abbreviation) now skips the
// context check entirely. Together these change which short/ambiguous-tag
// matches pass the context gate — full-strength vs. demoted, and (for the
// formerly-gated T4-only path) admitted vs. not — so a v17 pool scored
// under the old, unfolded/uncut/no-skip-rule context check must never be
// served as if it already reflects any of the three changes. v19 —
// ABC-JEV-INTEGRATION.md §1bl/DATASET-RECORDS
// (docs/jev-abc/DATASET-RECORDS-B-20260930T030544Z.md): every OpenAlex
// adapter now fetches OpenAlex's own `type` (metadata.workType prefers it,
// falling back to the legacy, in-practice-dead `type_crossref`), and each
// adapter drops a small, named set of clearly non-paper OpenAlex types (e.g.
// "dataset") right after fetching, before scoring/dedupe ever sees them;
// separately, canonical-identity.ts's `canonicalPaperKey` gives a Figshare
// ".vN" versioned DOI an extra alias toward its own base (unversioned)
// sibling, so the two versions merge via dedupe's existing pass-1 rule. Both
// changes alter pool MEMBERSHIP (excluded records are gone; a version pair
// that used to survive as two cards now merges into one) and, for a
// dataset-shaped repository record, could also change scoring/review
// classification (workType is no longer a dead field), so a v18 pool built
// under the old, type-blind fetch/mapping must never be served as if it
// already reflects any of these changes. v20 — ABC-JEV-INTEGRATION.md
// §1bo/NON-ASCII-TEXT (docs/jev-abc/NON-ASCII-TEXT-B-20260930T071406Z.md,
// AMENDMENT §1bo.8): profile-compiler.ts's free-text query derivation
// (phrasesFromText, literalQueryIfShort) now keeps Unicode letters/digits
// instead of an ASCII-only character class (an accented Latin word like
// "électrolytes" no longer corrupts into a wrong fragment) and never
// derives a query containing a CJK character (Han, Hiragana, Katakana or
// Hangul) — a pure-CJK Project/Challenge field yields no query at all
// instead of leaking its whole untouched paragraph as one giant literal/
// phrase query, AND (§1bo.8) a MIXED CJK-plus-Latin field (the ordinary
// case for a non-English materials researcher) no longer leaks its raw
// blob either: a CJK run now acts as a chunk delimiter, so an embedded
// Latin phrase ("solid-state electrolyte") or a formula glued directly
// onto surrounding CJK text with no space at all ("LiCoO2") survives as
// its own query while the CJK parts of the same field contribute nothing;
// separately, term-expand.ts's termVariantMatches (and, for ranking,
// termOccurrences) now matches a CJK-only Required-tag variant — of ANY of
// the four scripts, not Chinese alone — by plain substring containment
// instead of the whitespace-anchored word-boundary regex, which never
// matched continuous, unspaced CJK prose. Together these change pool
// MEMBERSHIP (different/fewer/better-targeted queries reach each source)
// and T1 gate outcomes for a CJK Required tag (newly admits a paper it used
// to miss, in any of the four scripts), so a v19 pool built under the old
// ASCII-only/whitespace-boundary/Han-only behaviour must never be served as
// if it already reflects any of this. (§1bo.8 landed before v20 ever
// shipped — round 1's v19->v20 bump and this refinement are ONE cache
// generation, not two.) v21 — ABC-JEV-INTEGRATION.md §1bs/QUERY-GENERIC-WORDS
// (docs/jev-abc/QUERY-GENERIC-WORDS-B-20260930T090811Z.md): profile-compiler.ts's
// `phrasesFromText` keyword step no longer emits a standalone 4-digit year
// (1900-2099), a number+unit token whose unit is in a closed, curated list
// (e.g. "3.7V", "45mA", "500Wh/kg" — bare "L"/"M" stay off the list, so a
// designation like "316L" is unaffected), or a bare decimal with no letters
// ("99.9") — every other token, including a non-year bare integer
// ("18650"), is unchanged. Separately, its chunk splitter no longer splits a
// chunk at a period between two digits (so "3.7V"/"99.9%"/"GPT-3.5" survive
// as one chunk instead of two corrupted fragments), and the em dash
// (U+2014), en dash (U+2013) and ellipsis (U+2026) now act as chunk
// delimiters alongside the existing comma/semicolon/colon/newline (folding
// in §1bo.9(a)). Both the query path (`projectQueries`) and the seed-text
// path (`activeQuestions`/`briefToSeedTexts`) read this one shared function,
// so this changes pool MEMBERSHIP for any reader whose Project/Challenge
// text (or an uploaded seed text) contains a year, a joined unit+number
// token, a bare decimal, or one of the three new dash/ellipsis delimiters —
// a v20 pool built under the old, number/unit-blind keyword step and the
// old decimal-splitting chunker must never be served as if it already
// reflects any of these changes. v22 — ABC-JEV-INTEGRATION.md
// §1bu/NMC-HYPONYM (docs/jev-abc/NMC-HYPONYM-B-20260930T111311Z.md), two
// unrelated fixes landed together in one C round: (a) "ncm" joins
// `ABBREVIATION_GROUPS`' existing "nmc" entry as a pure synonym, and
// keyword.ts gains a one-way family->member glued-digit admission (a
// Required tag "NMC"/"NCM" now also qualifies a paper that only ever writes
// a glued stoichiometry like "NMC811"/"NCM622" — never the reverse — with
// its own SENSE-CONTEXT skip, the same precedent `matchesFullNameOrFormula`
// already has) plus a digit-preserving member<->member synonym inside
// `expandTerm` (a reader's own "NMC811" tag also matches "NCM811", never a
// different stoichiometry or the bare family form); this changes pool
// MEMBERSHIP for any reader with an "NMC"/"NCM"-family or specific-member
// Required tag. AMENDMENT (§1bu.9, after review): the same
// `matchesFullNameOrFormula` change also reaches this file's own pre-existing
// formula tags "licoo2"/"lifepo4" — a bare-acronym-only ("LCO"/"LFP") match
// against those tags now runs the SENSE-CONTEXT check instead of always
// skipping it, RANKING only (pool membership unchanged, since the bare
// acronym already admits via T1 through the same group closure either way).
// (b) §1bu.8 (folded in from the §1bs.8 findings):
// profile-compiler.ts's shared year/unit/decimal filter now also strips a
// trailing sentence-final period before testing a token ("2024.", "99.9.",
// "4.2v." are now removed, not just their bare forms) and applies the SAME
// filter to a phrase/chunk that collapses to a single token ("…, 500Wh/kg,
// …" is now removed via that branch too) — this changes pool MEMBERSHIP for
// any reader whose Project/Challenge/seed text has a year/unit/decimal
// immediately followed by a sentence-ending period, or as its own
// comma/dash/etc.-delimited single-word clause. Neither v21 pool build
// reflects either fix, so it must never be served as if it does. v23 —
// ABC-JEV-INTEGRATION.md §1bv/T2-EXTRACTOR (docs/jev-abc/
// T2-EXTRACTOR-B-20260930T151003Z.md): `selfDeclaredAbbreviationPairs`
// (keyword.ts) now also reads a comma-form self-declared pair packed
// together on the SAME side of one parenthetical — "(light cycle oil,
// LCO)" and "(LCO, light cycle oil)", both orderings, searched inside each
// already-matched "(...)" span rather than anchored to its boundary. This
// only ever feeds rule (c) (`selfDeclaresDifferentSense`): a paper that
// declares a DIFFERENT sense in exactly that comma style is now a hard
// non-match for that Required tag, at every admitting tier (T1-T3 in
// keyword.ts, T4 in combine.ts), where before it was invisible to rule (c)
// and — for a reader who has declared no other project/work text — admitted
// at full strength with no protection at all. Admission-layer membership
// for a GENUINE comma-form paper is unaffected (measured at zero benefit,
// 700 real items, guide §Q2: canonicalize() already turns the comma into
// whitespace before T1 ever runs, so a genuine paper was always admitted via
// the bare token regardless of T2). A v22 (or older) pool build never ran
// the comma-form check, so it must never be served as if it does. These
// bumps share their numbers with `CACHE_KEY_VERSION` above by coincidence,
// not by a shared cause — see `derivePoolCacheKey` below for how each is
// selected.
const PAPER_CACHE_KEY_VERSION = 23;
/**
 * SINGLE SOURCE OF TRUTH for the literal key prefix a durable papers-pool
 * store may accept, derived from `PAPER_CACHE_KEY_VERSION` rather than
 * hand-copied — `private-paper-cache.ts` imports this instead of keeping its
 * own hard-coded prefix string, which is exactly what let that file's guard
 * fall out of sync with this constant when v6 first shipped (REQUIRED-GATE
 * phase 1 finding, ABC-JEV-INTEGRATION.md §1ao addendum, 2026-09-28).
 */
export const PAPER_POOL_KEY_PREFIX = `peer-pool-v${PAPER_CACHE_KEY_VERSION}-papers-`;

function normalizeSet(values: string[] | undefined): string[] {
  return Array.from(
    new Set(
      (values ?? [])
        .map(canonicalize)
        .filter(Boolean),
    ),
  ).sort((left, right) => (left < right ? -1 : left > right ? 1 : 0));
}

export function derivePoolCacheKey(input: PoolCacheKeyInput): string {
  // ABC-freemium 1-17 · R-POOL-1 · D3 — **jobs and events rebuild weekly;
  // papers stay daily.** The function already knows the surface, so the fork
  // lives here and no caller changes.
  //
  // The period appears TWICE below — inside the hashed signature and again as a
  // plaintext segment of the returned key. A fix that changed only the
  // signature would leave a daily string in the key and rebuild daily anyway,
  // so both read the same `period`.
  //
  // A mid-week topic change is still a cache miss on the user's own key, because
  // `requiredTopics`/`exploreTopics` remain in the signature. D3 says that in as
  // many words ("that is their quota to spend") — intended, not a regression.
  const period =
    input.surface === "papers"
      ? localCalendarDate(input.now)
      : localIsoWeek(input.now);
  const version = input.surface === "papers" ? PAPER_CACHE_KEY_VERSION : CACHE_KEY_VERSION;
  const signature = JSON.stringify({
    version,
    surface: input.surface,
    requiredTopics: normalizeSet(input.requiredTopics),
    exploreTopics: normalizeSet(input.exploreTopics),
    careerStage: input.careerStage?.trim() ?? "",
    locationPreferences: normalizeSet(input.locationPreferences),
    aiTier: input.aiTier,
    paperScopeIdentity: input.surface === "papers" ? input.paperScopeIdentity : undefined,
    paperOwnerId: input.surface === "papers" ? input.paperOwnerId : undefined,
    uploadInterests: input.uploadInterests?.length ? normalizeSet(input.uploadInterests) : undefined,
    // Only when true: `JSON.stringify` omits `undefined`, so the key of every
    // reader without a Jev key keeps the exact shape it had before this field.
    jevScreening: input.surface === "papers" && input.jevScreening === true ? true : undefined,
    date: period,
  });
  const digest = createHash("sha256").update(signature).digest("hex").slice(0, 32);
  return `peer-pool-v${version}-${input.surface}-${period}-${digest}`;
}

// P4-S8a (Round 3) — F-B-P4S8-01, ABC-JEV-INTEGRATION.md §4 Round 3
// "usage-limit interruption recovered; P2-S4b-FIX2 C done; P4-S8 B complete
// + rulings" (Policy E3), docs/jev-abc/P4-S8-B-20260924T115008Z.md DESIGN
// B1 option (b). Used to be a `WeakMap<PoolCache, Map<string,
// Promise<CachedPool>>>` keyed by the CALLER's `cache` object, so two
// distinct `PoolCache` instances working the exact same key never
// coalesced. That was invisible for the anonymous/events/jobs surfaces —
// they all share one process-wide cache singleton
// (`ephemeralPaperPoolCache` / `getDefaultOpportunityPoolCache()`), so
// there was only ever one object to key on — but silently broken for
// signed-in papers: `feed/pipeline.ts`'s `runFeedPipeline` builds a
// brand-new `PrivatePaperPoolCache` on every request that omits
// `options.cache`, so two truly concurrent requests for the same owner
// (two tabs, a double click) each ran their own build, no matter how many
// landed in the same process at once.
//
// Now a single process-wide `Map<string, Promise<CachedPool>>`, keyed by
// the pool key STRING alone. Safe because `derivePoolCacheKey` (above)
// already folds everything that must isolate one flight from another into
// that string — surface, topics, date, and for papers `paperOwnerId` +
// `paperScopeIdentity` — so two owners, two surfaces, or two days can never
// produce the same key and therefore can never share a flight; keying
// single-flight by cache-OBJECT identity on top of that was redundant from
// the start. This only fixes SAME-PROCESS concurrency (two tabs landing on
// the same warm instance); it cannot and does not fix cross-INSTANCE
// concurrency on separate serverless instances, which have no memory to
// share a `Map` through at all — that residual gap is recorded in this
// slice's own checkpoint, not silently assumed away.
const inFlightByKey = new Map<string, Promise<CachedPool>>();

/**
 * Read-through daily-pool cache with per-process single-flight protection.
 * Cache failures degrade to a fresh build; they never block Tier 0.
 *
 * Leader/follower contract (unchanged by the P4-S8a key-string fix above —
 * this is the same shape the old same-object case already had, now simply
 * reachable across different `PoolCache` objects sharing one key too): the
 * first caller for a given key runs `build()` and is reported
 * `cacheHit: false`; every other caller for that same key while it is in
 * flight awaits the SAME pending promise and is reported `cacheHit: true`
 * with the identical resolved pool — never an independent second build. If
 * the leader's build (or the read-through around it) rejects, every
 * follower sharing that promise rejects with the same error rather than
 * retrying on its own. Either way the map entry for a key is deleted once
 * its flight settles, so the next call for that key — a genuine retry after
 * a failure, or a later, unrelated request — always starts a fresh flight
 * rather than replaying a stale settled one.
 *
 * @param shouldPersist P2-S2 (Round 3) — ABC-JEV-INTEGRATION.md §1p.B(2):
 * "a pool where every source failed is not cached as a valid day." Checked
 * against the freshly built pool, before it would otherwise be written.
 * Optional and defaulting to "always persist" (today's exact behavior) so
 * every existing caller — `events/pipeline.ts`, `jobs/pipeline.ts`, and any
 * papers caller that omits it — is unaffected; only `feed/pipeline.ts`
 * passes one, to skip persisting a build where every attempted source
 * failed. The fresh pool is still RETURNED to this caller either way —
 * only persistence is gated, never the response.
 */
export async function getOrBuildCachedPool<TPool extends CachedPool>(
  cache: PoolCache,
  key: string,
  accepts: (pool: CachedPool) => pool is TPool,
  build: () => Promise<TPool>,
  shouldPersist?: (pool: TPool) => boolean,
  /**
   * ABC-freemium 1-18 · R-POOL-2 — **"refresh now": skip the READ, keep the
   * WRITE and the single-flight, under the SAME key.**
   *
   * R-POOL-2 offers "key nonce or bypass" and both obvious readings are
   * defective. A **nonce in the key** stores the rebuilt pool where nobody else
   * will ever look, so the user pays for a rebuild and the next ordinary page
   * load still serves the stale pool. A **bypass around this function** skips
   * the single-flight map below, so two clicks fire two full builds — two
   * Tavily fan-outs, on the operator's key.
   *
   * This third shape gives the user a genuinely fresh pool, gives everyone else
   * that pool on their next load, and still builds **once** for a double click.
   */
  forceRebuild = false,
): Promise<DailyPoolLoad<TPool>> {
  const existing = inFlightByKey.get(key);
  if (existing) {
    const pool = await existing;
    if (accepts(pool)) return { pool, cacheHit: true };
  }

  let builtFresh = false;
  const pending = (async (): Promise<TPool> => {
    // The read is the only thing a forced rebuild skips. The write below, and
    // the single-flight map above, both still apply.
    if (!forceRebuild) {
      try {
        const cached = await cache.get(key);
        if (cached && accepts(cached)) return cached;
      } catch {
        // A cache outage is a miss, not a feed outage.
      }
    }

    builtFresh = true;
    const pool = await build();
    if (!shouldPersist || shouldPersist(pool)) {
      try {
        await cache.set(key, pool);
      } catch {
        // Returning a fresh pool is more important than persisting it.
      }
    }
    return pool;
  })();
  inFlightByKey.set(key, pending);

  try {
    return { pool: await pending, cacheHit: !builtFresh };
  } finally {
    if (inFlightByKey.get(key) === pending) inFlightByKey.delete(key);
  }
}

/**
 * P2-S2-FIX (Round 3) — F-A-P2S2-01, ABC-JEV-INTEGRATION.md §1p.B(2). The
 * SAME per-process coalescing shape `getOrBuildCachedPool` uses for a pool
 * BUILD (above), factored out so another read-time step can share it
 * instead of inventing a second limiter. `feed/pipeline.ts`'s degraded-pool
 * retry is the first caller: concurrent requests for the same (namespaced)
 * key coalesce onto ONE in-flight `run()` instead of each doing their own
 * work.
 *
 * Reuses `inFlightByKey` itself (not a second map) so callers that want
 * isolation from `getOrBuildCachedPool`'s own build-path entries — an
 * ordinary pool key — must pass a namespaced `key` (e.g. a `"retry:"`
 * prefix); this helper does not namespace on their behalf, exactly as
 * `getOrBuildCachedPool` does not either.
 *
 * P4-S8a (Round 3) — F-B-P4S8-01, Policy E3: isolation between different
 * `PoolCache` OBJECTS is no longer automatic (the shared map is keyed by
 * the string alone, matching `getOrBuildCachedPool`'s own fix above) — two
 * cache instances retrying the SAME namespaced key now coalesce onto one
 * in-process `run()` too. That's intentional here, not a regression: the
 * caller (`retryFailedSources`) still has its OWN, separate cross-instance
 * guard for this exact scenario — an atomic counter-store claim
 * (`claimSourceRetry`) that already had to exist because a single-flight
 * map, keyed either way, only ever protects ONE process's memory and was
 * never a substitute for a durable claim across real separate instances.
 * `feed/pool-degraded.test.ts`'s "second server instance" cases simulate
 * that split with two distinct cache objects and prove the FETCH count
 * stays bounded either way — this change only removes a redundant extra
 * claim attempt when both simulated "instances" happen to share one actual
 * process (as they do in-test), it does not change what gets fetched.
 * `cache` itself stays a required parameter — still the correct shape for
 * a `PoolCache`-scoped helper, and every caller's own `run()` closure
 * already captures whichever `cache` it needs for its actual I/O — even
 * though this function's own body no longer reads it for keying.
 */
export async function withCacheSingleFlight<T extends CachedPool>(
  cache: PoolCache,
  key: string,
  run: () => Promise<T>,
): Promise<T> {
  const existing = inFlightByKey.get(key);
  if (existing) return existing as Promise<T>;

  const pending = run();
  inFlightByKey.set(key, pending);
  try {
    return await pending;
  } finally {
    if (inFlightByKey.get(key) === pending) inFlightByKey.delete(key);
  }
}

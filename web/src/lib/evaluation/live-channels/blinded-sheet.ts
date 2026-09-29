// LIVE-EVAL-4 (ABC-JEV-INTEGRATION.md §1u.4/§1u.5, §1w P5, guide Finding C5)
// — the blinded label sheet: lets the user judge relevance without knowing
// which channel(s) found a given paper, plus label ingestion and the
// metrics wiring for the judged sample.
//
// Never shows an abstract, a channel name, or a provider name (§1u.4/§1u.5).
// `WorkEntry` (channel-comparison.ts) carries only `key`/`channels`/
// `contributions` — no title/year/venue/doi — so this module takes a
// caller-supplied `details` lookup (built by the runner from the original
// RawItems, keyed by the SAME id-form/title keys `compareChannels` itself
// matches works on) rather than re-deriving paper metadata itself.
//
// nDCG is deliberately never computed here (§1w P5): only `precisionAtK` and
// `recallInJudgedSet` are imported from metrics.ts, never `ndcgAtK` — a
// structural guarantee, not just an unused-in-practice one.

import type { WorkEntry, RelevanceLabelMap } from "@/lib/scoring/channel-comparison";
import {
  mulberry32,
  precisionAtK,
  recallInJudgedSet,
  type PrecisionAtKResult,
  type RecallResult,
} from "@/lib/evaluation/metrics";
import { normalizeDoi } from "@/lib/utils/canonical-identity";

export interface WorkDetails {
  title?: string;
  year?: number;
  venue?: string;
  doi?: string;
}

export interface SheetRow {
  itemId: string;
  title?: string;
  year?: number;
  venue?: string;
  doiUrl?: string;
}

export interface BlindedSheetResult {
  rows: SheetRow[];
  /** item id -> canonical WorkEntry.key. NOT part of the sheet shown to a labeler — a separate structure so the sheet itself carries no provenance. */
  keyByItemId: Record<string, string>;
}

export interface BuildBlindedSheetOptions {
  seed: number;
  /** Guide's "~30-40 items total"; default 40. */
  sampleSize?: number;
}

/**
 * LIVE-EVAL-4-FIX (ABC-JEV-INTEGRATION.md §1w AMENDMENT): OpenAlex's own
 * `doi` field is already a full `https://doi.org/...` URL, while S2's is a
 * bare DOI (`utils/openalex.ts`'s `openAlexWorkToRawItem` vs.
 * `sources/semantic-scholar.ts`'s `paperToRawItem` — both pass their
 * provider's raw `doi` value straight into `metadata.doi` unchanged). This
 * row builder used to assume the S2 shape unconditionally, so every
 * OpenAlex-sourced work's link in the live run came out double-prefixed
 * (`https://doi.org/https://doi.org/10...`, confirmed broken by the live run
 * — `docs/jev-abc/LIVE-EVAL-4-A-20260925T052639Z.md`). `normalizeDoi`
 * (reused from `canonical-identity.ts`, not reimplemented — the same helper
 * `inputs.ts` in this directory already uses for seed DOI validation) strips
 * any of the `https://doi.org/`, `http://doi.org/`, `https://dx.doi.org/`,
 * `http://dx.doi.org/` prefixes case-insensitively, so every link this
 * builds is exactly `https://doi.org/<bare doi>` regardless of which
 * provider's raw `doi` field it came from. Returns undefined for both "no
 * DOI" and "not DOI-shaped" — never a broken link.
 */
function buildDoiUrl(doi: string | undefined): string | undefined {
  const bare = normalizeDoi(doi);
  return bare ? `https://doi.org/${bare}` : undefined;
}

function shuffle<T>(items: readonly T[], rng: () => number): T[] {
  const arr = [...items];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/**
 * Builds the blinded sample + sheet. Stratifies by each work's channel-set
 * signature (the sorted, joined `channels` array — e.g. one bucket for
 * "exclusive to s2-keyword", another for "found by both openalex-keyword and
 * openalex-semantic") so no single prolific channel dominates the sheet, then
 * samples round-robin across buckets (every bucket contributes once before
 * any bucket contributes a second item) up to `sampleSize`. A final shuffle
 * of the SAMPLE ORDER itself (not just within-bucket) removes any residual
 * signal a reader could infer from row position. Both shuffles are driven by
 * the SAME seeded, deterministic `mulberry32` generator `metrics.ts` already
 * uses (reused, not reimplemented) — the same `(works, details, seed)` input
 * always produces byte-identical output; a different seed (given more than
 * one item) produces a different order.
 */
export function buildBlindedSheet(
  works: readonly WorkEntry[],
  details: ReadonlyMap<string, WorkDetails>,
  options: BuildBlindedSheetOptions,
): BlindedSheetResult {
  const sampleSize = options.sampleSize ?? 40;
  const rng = mulberry32(options.seed);

  const buckets = new Map<string, WorkEntry[]>();
  for (const w of works) {
    const signature = [...w.channels].sort().join("|");
    const bucket = buckets.get(signature);
    if (bucket) bucket.push(w);
    else buckets.set(signature, [w]);
  }
  const shuffledBuckets = Array.from(buckets.keys())
    .sort()
    .map((k) => shuffle(buckets.get(k) as WorkEntry[], rng));

  const sampled: WorkEntry[] = [];
  let round = 0;
  while (sampled.length < sampleSize) {
    let addedThisRound = false;
    for (const bucket of shuffledBuckets) {
      if (round < bucket.length) {
        sampled.push(bucket[round]);
        addedThisRound = true;
        if (sampled.length >= sampleSize) break;
      }
    }
    if (!addedThisRound) break;
    round += 1;
  }

  const finalOrder = shuffle(sampled, rng);

  const rows: SheetRow[] = [];
  const keyByItemId: Record<string, string> = {};
  finalOrder.forEach((w, i) => {
    const itemId = `item-${String(i + 1).padStart(2, "0")}`;
    const d = details.get(w.key) ?? {};
    rows.push({
      itemId,
      title: d.title,
      year: d.year,
      venue: d.venue,
      doiUrl: buildDoiUrl(d.doi),
    });
    keyByItemId[itemId] = w.key;
  });

  return { rows, keyByItemId };
}

// ─────────────────────────── label ingestion ───────────────────────────

export type LabelValue = "relevant" | "not_relevant" | "unsure" | undefined;

export type FilledLabelSheet = Readonly<Record<string, LabelValue>>;

export interface IngestedLabels {
  /** For `compareChannels({ relevanceLabels })`. */
  relevanceLabelMap: RelevanceLabelMap;
  /** For `metrics.ts`'s `precisionAtK`/`recallInJudgedSet` — NOT the same shape as `relevanceLabelMap`, built from the same underlying answer rather than asking the labeler twice. */
  gradedLabels: Map<string, 0 | 1>;
  /** Item ids with no usable answer (blank, missing, or "unsure") — never silently folded into "not relevant." */
  unlabeledItemIds: string[];
}

/**
 * `keyByItemId` is the mapping the labeler never sees (kept separate from
 * the sheet itself — see `buildBlindedSheet`). `filled` is the labeler's
 * answers keyed by the same opaque item id. A blank/missing/"unsure" answer
 * surfaces only in `unlabeledItemIds`, in both downstream shapes — never as
 * a fabricated "not relevant."
 */
export function ingestLabels(
  keyByItemId: Readonly<Record<string, string>>,
  filled: FilledLabelSheet,
): IngestedLabels {
  const relevanceLabelMap: RelevanceLabelMap = {};
  const gradedLabels = new Map<string, 0 | 1>();
  const unlabeledItemIds: string[] = [];

  for (const [itemId, key] of Object.entries(keyByItemId)) {
    const value = filled[itemId];
    if (value === "relevant") {
      relevanceLabelMap[key] = true;
      gradedLabels.set(key, 1);
    } else if (value === "not_relevant") {
      relevanceLabelMap[key] = false;
      gradedLabels.set(key, 0);
    } else {
      unlabeledItemIds.push(itemId);
    }
  }

  return { relevanceLabelMap, gradedLabels, unlabeledItemIds };
}

// ─────────────────────────── metrics wiring ───────────────────────────

export interface ChannelMetricRow {
  channel: string;
  precision: PrecisionAtKResult;
  recall: RecallResult;
}

/**
 * Wires the ingested labels into precision@10 + recall-in-judged-set PER
 * CHANNEL (ABC-JEV-INTEGRATION.md §1w P5 — nDCG is explicitly skipped; see
 * file header). `rankedKeysByChannel` holds each channel's own ranked list
 * of CANONICAL work keys (not raw per-source item ids) — the same identity
 * `compareChannels` itself matches works on, so a label recorded under a
 * work's representative key lines up with every channel's ranking of that
 * same work.
 */
export function computeChannelMetrics(
  rankedKeysByChannel: ReadonlyMap<string, readonly string[]>,
  gradedLabels: ReadonlyMap<string, 0 | 1>,
  k = 10,
): ChannelMetricRow[] {
  return Array.from(rankedKeysByChannel.entries())
    .map(([channel, rankedIds]) => ({
      channel,
      precision: precisionAtK(rankedIds, gradedLabels, k),
      recall: recallInJudgedSet(rankedIds, gradedLabels),
    }))
    .sort((a, b) => a.channel.localeCompare(b.channel));
}

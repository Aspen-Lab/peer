import { cleanPreferenceLedger } from "./ledger";
import type { PreferenceLedger, PreferenceLedgerEntry } from "@/types";

// P2-S4c-1 (Round 3) — F-A-P2-04 (4e), ABC-JEV-INTEGRATION.md §1p.B(5) and
// the §4 "P2-S4c B complete" ruling (docs/jev-abc/P2-S4c-B-20260924T113605Z.md
// Section B / C GUIDE). The inert build-time OpenAlex topic/field channel
// (`web/src/lib/feed/pipeline.ts`'s `buildPaperPool` used to hardcode
// `topicIds: string[] = []`) gets its ids HERE, at READ TIME, from the
// signed-in owner's own preference ledger — mirroring exactly how P2-S4b
// resolved positive seeds, never baked into the shared per-day pool. Every
// like/save on an OpenAlex-sourced paper already records `openalex_topic:
// <id>` entries into `preferenceLedger` (see `utils/openalex.ts`'s
// `openAlexWorkToRawItem` and `store/profile.ts`'s `recordPaperPreference`)
// — this module is a pure, synchronous re-read of that existing signal, not
// a new data source.
//
// THE ONE GENUINELY NEW PIECE OF LOGIC: the ledger stores an OpenAlex topic
// id LOWERCASED (`preferences/ledger.ts`'s `preferenceKey`/`bareOpenAlexId`
// lowercase the whole tail — e.g. `openalex_topic:t20001`), while
// `sources/openalex-topic.ts`'s `fetchOpenAlexTopicField` filters
// case-SENSITIVELY on an uppercase-`T`-only id (`/^T\d+$/`). A naive prefix
// strip would leave the channel silently inert a second time. This module
// re-cases the tail back to the adapter's expected uppercase form — and
// ONLY here (`sources/openalex-topic.ts` itself stays untouched, per the
// manager's ruling 5).

/**
 * Matches the adapter's own bounded-exploration cap
 * (`sources/openalex-topic.ts`'s `MAX_TOPIC_IDS_PER_CALL`, not exported and
 * not this slice's file to edit) so nothing this resolver supplies is
 * silently truncated a second time downstream.
 */
export const MAX_POSITIVE_OPENALEX_TOPIC_IDS = 5;

/** A ledger key's tail, once the leading `"openalex_topic:"` namespace (if present) is stripped. */
function bareTail(key: string): string {
  const idx = key.indexOf(":");
  return idx < 0 ? key : key.slice(idx + 1);
}

/**
 * The adapter needs `T<digits>` exactly. Anything else is skipped rather
 * than guessed at — repeating this exact slice's original casing bug one
 * layer deeper (e.g. by accepting and mis-forwarding a non-topic OpenAlex
 * id shape) would be worse than simply not exploring that entry.
 */
const TOPIC_TAIL_PATTERN = /^t(\d+)$/i;

function toUppercaseTopicId(entryKey: string): string | undefined {
  const match = TOPIC_TAIL_PATTERN.exec(bareTail(entryKey).trim());
  return match ? `T${match[1]}` : undefined;
}

function netPositive(entry: PreferenceLedgerEntry): number {
  return entry.positive - entry.negative;
}

function lastPositiveAtMs(entry: PreferenceLedgerEntry): number {
  const parsed = entry.lastPositiveAt ? Date.parse(entry.lastPositiveAt) : NaN;
  return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * The signed-in owner's top positive `openalex_topic` ledger ids, re-cased
 * to the uppercase `T<digits>` form `fetchOpenAlexTopicField` requires.
 *
 * - Only `source === "openalex_topic"` entries are considered — every other
 *   concept source (keywords, OpenAlex "Concepts", uploads, job/event tags)
 *   is ignored.
 * - Only genuinely POSITIVE entries (`positive - negative > 0`) qualify —
 *   same standing this campaign already gave the other seed channels
 *   (§1p.B(5)); a net-negative or net-zero entry is excluded, not inverted.
 * - Deterministic order: net-positive descending, tie-broken by
 *   `lastPositiveAt` descending (most recent first), tie-broken by the raw
 *   ledger key ascending so a full tie still produces a reproducible order
 *   regardless of object-enumeration order.
 * - Bounded to `limit` (default `MAX_POSITIVE_OPENALEX_TOPIC_IDS`).
 * - A malformed tail (not `t<digits>` once the namespace is stripped) is
 *   skipped defensively rather than forwarded broken.
 *
 * Pure and synchronous: no I/O, no network, safe to call for every request
 * regardless of sign-in status (the caller decides whether to actually USE
 * the result — see `pipeline.ts`'s read-time gating, signed-in owners only
 * per the manager's ruling).
 */
export function topPositiveOpenAlexTopicIds(
  ledger: PreferenceLedger | null | undefined,
  limit: number = MAX_POSITIVE_OPENALEX_TOPIC_IDS,
): string[] {
  const cleaned = cleanPreferenceLedger(ledger);
  const candidates = Object.values(cleaned)
    .filter((entry) => entry.source === "openalex_topic" && netPositive(entry) > 0)
    .sort((a, b) => {
      const netDiff = netPositive(b) - netPositive(a);
      if (netDiff !== 0) return netDiff;
      const atDiff = lastPositiveAtMs(b) - lastPositiveAtMs(a);
      if (atDiff !== 0) return atDiff;
      return a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
    });

  const ids: string[] = [];
  const seen = new Set<string>();
  for (const entry of candidates) {
    const id = toUppercaseTopicId(entry.key);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
    if (ids.length >= limit) break;
  }
  return ids;
}

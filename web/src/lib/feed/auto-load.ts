// The home page's automatic papers load — when it fires, and when it must not.
//
// P8-01 (BACKLOG-29 = 22, the owner's "好的"; ABC-DEEP-REPORT-READING-HELPER.md
// §1h.41 (a)). The page used to decide this inline, in an effect: load whenever
// the active topics key (`autoLoadKey`) differs from the key the shown papers
// were built from (`topicsKey`) and nothing is loading. `topicsKey` is written
// only by a SUCCESSFUL papers response, so a failure (a 503, a 404, a dead
// connection) left the two different, the loading flag cleared in the load's
// own `finally`, and the effect fired again at once — about 85 requests a
// second per tab for as long as the page stayed open.
//
// The decision is one pure function so it can be tested without a DOM, and the
// effect that applies it is a small hook so a test can mount it. The fix is
// "remember the key that was tried" (the owner's 记录已经试过): the store keeps
// `feedFailedKey`, the key a failed papers load tried, and a key that failed is
// not loaded again by this effect. There is no automatic retry; the recovery is
// the page's own error state ("Try again") or a change the reader makes, both of
// which call `loadFeed` directly and are not governed by this predicate.

import { useEffect } from "react";

export interface AutoLoadState {
  /** The key the page wants loaded: the active, day-locked papers topics. */
  autoLoadKey: string;
  /** The key the papers now shown were built from (set by a success only). */
  topicsKey: string | null;
  /** The key a failed papers load tried, or null (cleared by a success). */
  failedKey: string | null;
  /** A load is in flight. */
  loading: boolean;
}

/**
 * Should the home page start a papers load by itself?
 *
 * Yes for a key nothing has been built from and nothing has tried; no while a
 * load runs, for a key the shown papers already match, and for a key a load
 * has already tried and failed. A different key (the reader changed their
 * topics) starts fresh.
 */
export function shouldAutoLoad({
  autoLoadKey,
  topicsKey,
  failedKey,
  loading,
}: AutoLoadState): boolean {
  if (!autoLoadKey || loading) return false;
  // Reload when the loaded feed's active day-locked Papers topics differ.
  // Pending edits intentionally do not change this key until promotion on the
  // next local day.
  if (topicsKey === autoLoadKey) return false;
  // P8-01 — a papers load already tried this key and failed: do not ask again
  // by itself. The error state's "Try again" is the reader's retry.
  if (failedKey === autoLoadKey) return false;
  return true;
}

/**
 * Run `load` whenever {@link shouldAutoLoad} says so. `ready` is the page's
 * own gate (the auth outcome is known, or its bounded wait ran out); nothing
 * loads before it. `load` should be stable between renders (a `useCallback`):
 * a new one re-evaluates the decision, exactly as the inline effect's
 * `loadFeed` dependency did.
 */
export function useFeedAutoLoad({
  ready,
  autoLoadKey,
  topicsKey,
  failedKey,
  loading,
  load,
}: AutoLoadState & { ready: boolean; load: () => void }): void {
  useEffect(() => {
    if (!ready) return;
    if (!shouldAutoLoad({ autoLoadKey, topicsKey, failedKey, loading })) return;
    load();
  }, [ready, autoLoadKey, topicsKey, failedKey, loading, load]);
}

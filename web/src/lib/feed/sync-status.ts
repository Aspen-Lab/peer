"use client";

// FEED-SYNC-FLAG (ABC-JEV-INTEGRATION.md §5, following POLISH-1-SYNC-A's
// MEDIUM finding, docs/jev-abc/POLISH-1-SYNC-A-20260928T163023Z.md) — the
// "this device has a feed cloud write that has not reached the account yet"
// signal. Read by the P6 sign-out warning
// (web/src/components/account/account-section.tsx) and by
// web/src/app/profile/page.tsx — both read ONLY `useFeedSyncStatus().
// pushFailed` (a boolean) via a selector; that read shape is unchanged by
// round 2 below and needs no edit to either file.
//
// Originally declared directly inside web/src/components/feed-sync.tsx,
// where only the one-time sign-in migration batch ever set/cleared it.
// Moved to this tiny standalone module so web/src/store/feed.ts's
// steady-state cloud writes (save/unsave/mark read/mark unread/feedback,
// while already signed in) can set and clear the SAME flag too, without a
// circular import: feed-sync.tsx already imports `useFeedStore` FROM
// store/feed.ts, so store/feed.ts importing the flag back FROM
// feed-sync.tsx would be a real cycle. This module imports from neither, so
// both can depend on it with no cycle either way.
//
// feed-sync.tsx re-exports `useFeedSyncStatus` from here, so every existing
// `import { useFeedSyncStatus } from "@/components/feed-sync"` (account-
// section.tsx, app/profile/page.tsx) keeps working unchanged.
//
// ROUND 2 (ABC-JEV-INTEGRATION.md §1aq, ruling on a FAILED_REVIEW —
// docs/jev-abc/FEED-SYNC-FLAG-A-20260928T180309Z.md) — round 1 made this a
// single shared boolean, cleared by ANY of the 5 cloud* helpers' success.
// Reviewer A reproduced, BY EXECUTION (a temporary test file against the
// real, unmodified store, deleted after use — no product code was edited to
// get the result), two ways that erased a genuine, still-unsynced failure:
//   S1 — item X's cloudSave fails (flag correctly true); a completely
//        unrelated item Y's markRead later succeeds; the ONE shared boolean
//        goes back to false, even though X is still unsynced.
//   S2 — a SINGLE savePaper(X) call fires its own cloudSave (fails) AND,
//        via submitFeedback, its own cloudFeedback (succeeds, concurrently)
//        — the same one boolean again ends false, even though X's OWN save
//        never reached the account.
// Fixed by tracking a SET of pending DIMENSION keys instead of one boolean:
// "is any write outstanding", not "did the last write succeed". A failed
// write adds its own key (see store/feed.ts's `pendingSavedKey`/
// `pendingReadKey`/`pendingFeedbackKey`); a later successful write on the
// SAME dimension of the SAME item removes ONLY that key — never any other
// helper's. `pushFailed` is derived: true whenever the set is non-empty.
import { create } from "zustand";

export interface FeedSyncStatusState {
  /** Dimension keys (e.g. "saved:paper:abc123") with an unsynced write
   *  outstanding right now — see store/feed.ts's key builders for the exact
   *  format. A plain object used as a set (present + `true` = a member),
   *  the same "record as set" idiom this codebase already uses for
   *  `readItems` on FeedState. */
  pendingKeys: Record<string, true>;
  /** Derived from `pendingKeys` (`Object.keys(pendingKeys).length > 0`).
   *  Kept as its own field because this is the ONLY thing the two existing
   *  consumers read, via `useFeedSyncStatus((s) => s.pushFailed)` — this
   *  round never touches either of those files. */
  pushFailed: boolean;
}

export const useFeedSyncStatus = create<FeedSyncStatusState>(() => ({
  pendingKeys: {},
  pushFailed: false,
}));

function applyPendingKeys(next: Record<string, true>) {
  useFeedSyncStatus.setState({
    pendingKeys: next,
    pushFailed: Object.keys(next).length > 0,
  });
}

/** A dimension's write just failed. Adds its key; a no-op if it was already
 *  pending (e.g. a second failed attempt on the same still-unsynced item). */
export function markFeedPendingKey(key: string): void {
  const current = useFeedSyncStatus.getState().pendingKeys;
  if (current[key]) return;
  applyPendingKeys({ ...current, [key]: true });
}

/** That SAME dimension's later write succeeded. Removes ONLY this key —
 *  never any other helper's or any other item's — which is the whole fix
 *  for S1/S2 above. A no-op if it was not pending. */
export function clearFeedPendingKey(key: string): void {
  const current = useFeedSyncStatus.getState().pendingKeys;
  if (!(key in current)) return;
  const next = { ...current };
  delete next[key];
  applyPendingKeys(next);
}

/** Replace the whole in-memory set in one step. Two callers, both in
 *  store/feed.ts: (a) a fully successful sign-in/reload migration batch,
 *  which really did just push everything this device knows this owner
 *  saved/read, may clear everything at once; (b) seeding this in-memory
 *  store from this device's own persisted, per-owner pending record right
 *  after a reload, before anything else runs (see FeedState's
 *  `pendingPushByOwner` — this in-memory store itself is NOT persisted and
 *  starts empty on every page load). */
export function replaceFeedPendingKeys(next: Record<string, true>): void {
  applyPendingKeys(next);
}

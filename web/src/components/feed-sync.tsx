"use client";

// Bridges the local zustand feed store to Supabase (saved_items + read_items).
//
//   signed-out  — localStorage only, kept across reloads
//   signed-in   — on login: merge local-only saves/reads up → pull server → hydrate store
//                 on sign-out: resetLocal so next user starts clean
//
// Which of those a page load is, is decided in lib/feed/session-step.ts — read
// its header. The short version: "no user found at mount" used to be treated
// as "signed out just now", so every signed-out reader's saves were wiped on
// every reload.
//
// Mount once, near the root, alongside <ProfileSync />.

import { useEffect, useRef } from "react";
import { isAuthSessionMissingError } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase/client";
import { sessionStep } from "@/lib/feed/session-step";
import { useFeedStore } from "@/store/feed";
import type { Paper, Event, Job } from "@/types";
import { apiFetch } from "@/lib/api";
import {
  useFeedSyncStatus,
  replaceFeedPendingKeys,
} from "@/lib/feed/sync-status";

// Re-exported so every existing `import { useFeedSyncStatus } from
// "@/components/feed-sync"` (account-section.tsx, app/profile/page.tsx)
// keeps working unchanged — see lib/feed/sync-status.ts for why the flag
// itself now lives there (FEED-SYNC-FLAG, ABC-JEV-INTEGRATION.md §5).
export { useFeedSyncStatus };

/**
 * SIGNIN-MERGE (ABC-JEV-INTEGRATION.md §1af/§1aj, ruling P3) — "a failed push
 * is retried on the next change and shown to the user once in plain words."
 * `console.warn` alone (the old behaviour, on every push helper below) never
 * reached the user. `web/src/app/profile/page.tsx` shows a small, calm line
 * while `pushFailed` is true. Unlike profile's steady-state push (a single
 * diffed PUT with a natural "next change" to retry on), this migration push
 * is a one-time, per-item batch run once at sign-in for whatever was saved
 * locally before the account existed — there is no equivalent per-item retry
 * queue built here (recorded, not hidden, in the SIGNIN-MERGE checkpoint):
 * the item stays saved on THIS device either way (a failed push never
 * deletes anything locally), only the account's copy of it lags.
 *
 * FEED-SYNC-FLAG (ABC-JEV-INTEGRATION.md §5, following POLISH-1-SYNC-A's
 * MEDIUM finding) — this migration batch used to be the ONLY place that ever
 * set/cleared this flag, so an ordinary mid-session save/unsave/mark-read/
 * mark-unread/feedback push that failed (web/src/store/feed.ts's cloud*
 * helpers) stayed invisible to the P6 warning below. The set/clear helpers
 * now live in lib/feed/sync-status.ts precisely so store/feed.ts can
 * set/clear the SAME flag too, without importing it from this file (which
 * would be circular — this file already imports `useFeedStore` FROM
 * store/feed.ts).
 *
 * FEED-SYNC-FLAG round 2 (ABC-JEV-INTEGRATION.md §1aq) — round 1 (previous
 * paragraph) made the flag one shared boolean; reviewer A proved by
 * execution that an unrelated success could erase a genuine failure (see
 * docs/jev-abc/FEED-SYNC-FLAG-A-20260928T180309Z.md's S1/S2). Now a set of
 * per-dimension pending keys (store/feed.ts's `pendingSavedKey`/
 * `pendingReadKey`/`pendingFeedbackKey`). This migration batch's OWN
 * success/failure is applied through ONE store action,
 * `useFeedStore.getState().applyMigrationPushResult`, which also mirrors
 * the result into `pendingPushByOwner` (persisted, per owner) — see that
 * field's doc comment on FeedState for why: unlike a profile PUT, this
 * batch's own retry (the next reload) does not cover every failure mode
 * (an unsave/mark-unread already-removed locally, or any feedback failure,
 * are never retried by anything), so the in-memory flag alone would not
 * survive a reload for those cases. `replaceFeedPendingKeys` (imported
 * above) is used once per `onSession` call, to SEED that in-memory flag
 * from this device's own persisted record for whichever owner is now
 * current — see the call below, right after the reset-handling block.
 *
 * §1aq CORRECTION — `applyMigrationPushResult` originally cleared an
 * owner's WHOLE pending record on a fully successful batch ("it pushed
 * everything"). The RELOAD HONESTY finding above shows that premise was
 * wrong: the batch below only re-POSTs items CURRENTLY in
 * `local.savedPapers`/`savedEvents`/`savedJobs`/`readItems` — never a
 * delete, never feedback — so `applyMigrationPushResult` now takes exactly
 * those four arrays/keys (`pushed`, below) and clears ONLY the matching
 * keys; a pending unsave/mark-unread or any feedback key survives a
 * successful batch, same as it always survived a failed one.
 */

interface SavedApiRow {
  itemId: string;
  itemKind: "paper" | "event" | "job";
  payload: unknown;
  savedAt: string;
}

interface ReadApiRow {
  itemId: string;
  readAt: string;
}

async function fetchSaved(): Promise<SavedApiRow[] | null> {
  try {
    const data = await apiFetch<{ items: SavedApiRow[] }>("/api/saved", {
      cache: "no-store",
    });
    return data.items ?? [];
  } catch (err) {
    console.warn("[FeedSync] GET /api/saved failed", err);
    return null;
  }
}

async function fetchRead(): Promise<ReadApiRow[] | null> {
  try {
    const data = await apiFetch<{ items: ReadApiRow[] }>("/api/read", {
      cache: "no-store",
    });
    return data.items ?? [];
  } catch (err) {
    console.warn("[FeedSync] GET /api/read failed", err);
    return null;
  }
}

async function pushSaved(
  itemId: string,
  itemKind: "paper" | "event" | "job",
  payload: unknown,
): Promise<boolean> {
  try {
    await apiFetch("/api/saved", {
      method: "POST",
      body: JSON.stringify({ itemId, itemKind, payload }),
    });
    return true;
  } catch (err) {
    console.warn("[FeedSync] push saved failed", err);
    return false;
  }
}

async function pushRead(itemId: string): Promise<boolean> {
  try {
    await apiFetch("/api/read", {
      method: "POST",
      body: JSON.stringify({ itemId }),
    });
    return true;
  } catch (err) {
    console.warn("[FeedSync] push read failed", err);
    return false;
  }
}

export function FeedSync() {
  const didInitialSyncRef = useRef(false);

  useEffect(() => {
    if (!supabase) return;

    /** The store is restored from localStorage after mount. The decision
     *  below reads whose data this is, so it must never be made from the
     *  pre-restore default. */
    const restored = () =>
      new Promise<void>((resolve) => {
        if (useFeedStore.persist.hasHydrated()) return resolve();
        const unsub = useFeedStore.persist.onFinishHydration(() => {
          unsub();
          resolve();
        });
      });

    const onSession = async (userId: string | null | undefined, signedOut = false) => {
      await restored();
      const store = useFeedStore.getState();
      const step = sessionStep({ userId, syncedUserId: store.syncedUserId, signedOut });
      console.info("[FeedSync] auth:", step);
      if (step === "keep") return;
      if (step === "reset" || step === "reset-then-sync") {
        didInitialSyncRef.current = false;
        store.resetLocal();
        if (step === "reset") return;
      }
      // FEED-SYNC-FLAG round 2 (§1aq point 2, "reload honesty") — reached
      // whenever `userId` is real (sessionStep never returns "sync"/
      // "reset-then-sync" otherwise), which includes a PLAIN RELOAD of an
      // already-signed-in session, not only first sign-in (sessionStep
      // returns "sync" whenever `syncedUserId === userId`, and
      // `didInitialSyncRef` is a per-mount ref — see the doc comment above
      // this function). The in-memory pending-push flag
      // (lib/feed/sync-status.ts) is NOT itself persisted and starts empty
      // on every fresh page load, so it must be seeded here, from this
      // device's own persisted, per-owner record, BEFORE anything below
      // reads it — reads a FRESH `useFeedStore.getState()`, not the `store`
      // const captured above, since `resetLocal()` may just have run.
      if (userId) {
        replaceFeedPendingKeys(
          useFeedStore.getState().pendingPushByOwner[userId] ?? {},
        );
      }
      if (!userId || didInitialSyncRef.current) return;
      didInitialSyncRef.current = true;

      // 1. Push any local-only signals up first. The cloud is source of
      //    truth from this point — but we don't want to drop anything the
      //    user saved while signed out.
      const local = useFeedStore.getState();
      const localPushes: Promise<boolean>[] = [];
      for (const p of local.savedPapers) localPushes.push(pushSaved(p.id, "paper", p));
      for (const e of local.savedEvents) localPushes.push(pushSaved(e.id, "event", e));
      for (const j of local.savedJobs) localPushes.push(pushSaved(j.id, "job", j));
      for (const id of Object.keys(local.readItems)) localPushes.push(pushRead(id));
      const pushResults = await Promise.allSettled(localPushes);
      // SIGNIN-MERGE (§1aj P3) — this batch's result WAS never inspected
      // before (the guide's §1's own finding); now a single failure anywhere
      // in it surfaces once, in plain words, instead of only a console.warn.
      // Nothing here is destructive either way: a failed push leaves the
      // item exactly as saved on this device (see pushSaved/pushRead —
      // neither ever removes anything locally).
      if (pushResults.length > 0) {
        const anyFailed = pushResults.some(
          (result) => result.status === "rejected" || (result.status === "fulfilled" && result.value === false),
        );
        // §1aq CORRECTION — pass exactly what this batch attempted to push
        // (the same four sources `localPushes` above was built from), so a
        // full success clears only the matching keys, never a pending
        // unsave/mark-unread or any feedback key (see the doc comment above).
        useFeedStore.getState().applyMigrationPushResult(
          userId,
          {
            savedPapers: local.savedPapers,
            savedEvents: local.savedEvents,
            savedJobs: local.savedJobs,
            readIds: Object.keys(local.readItems),
          },
          !anyFailed,
        );
      }

      // 2. Now pull the merged server state and hydrate.
      const [savedRows, readRows] = await Promise.all([fetchSaved(), fetchRead()]);

      // SIGNIN-MERGE (§1aj P2/P3) — `null` (the pull FAILED) and `[]` (the
      // pull succeeded and the account genuinely holds zero rows) must reach
      // `hydrateFromRemote` as different values. `undefined` is what its
      // union helpers (store/feed.ts's `unionById`/`unionReadItems`) treat as
      // "nothing to merge from — leave local exactly as it is"; a concrete
      // (possibly empty) array is a real answer to union against. Coalescing
      // both cases to `[]` here, before hydrateFromRemote ever saw the
      // difference, is exactly what let a failed pull silently wipe local
      // saves the instant sign-in completed (§1.2/§1.3 of the SIGNIN-MERGE
      // guide) — `hydrateFromRemote` already had a `?? local` fallback for
      // this, but it could only ever engage on a literal `undefined`, which
      // never reached it from here.
      let savedPapers: Paper[] | undefined;
      let savedEvents: Event[] | undefined;
      let savedJobs: Job[] | undefined;
      if (savedRows !== null) {
        savedPapers = [];
        savedEvents = [];
        savedJobs = [];
        for (const row of savedRows) {
          if (row.itemKind === "paper") savedPapers.push(row.payload as Paper);
          else if (row.itemKind === "event") savedEvents.push(row.payload as Event);
          else if (row.itemKind === "job") savedJobs.push(row.payload as Job);
        }
      }
      const readItems: Record<string, true> | undefined =
        readRows === null
          ? undefined
          : Object.fromEntries(readRows.map((row) => [row.itemId, true as const]));

      useFeedStore.getState().hydrateFromRemote({
        savedPapers,
        savedEvents,
        savedJobs,
        readItems,
      });
      // From here the data in this browser is this account's copy: it goes
      // when this session ends, and it is never pushed into another account.
      useFeedStore.getState().setSyncedUserId(userId);
    };

    supabase.auth.getUser().then(({ data, error }) => {
      if (data.user) return onSession(data.user.id);
      // Only a DEFINITELY absent session counts as signed out. A network
      // failure or a server error is "could not tell" — and a reader's data is
      // never wiped because the network was down when the page loaded.
      return onSession(isAuthSessionMissingError(error) ? null : undefined);
    });

    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "SIGNED_OUT") onSession(null, true);
      else if (session?.user) onSession(session.user.id);
    });

    return () => sub.subscription.unsubscribe();
  }, []);

  return null;
}

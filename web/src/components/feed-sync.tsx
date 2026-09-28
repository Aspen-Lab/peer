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
import { create } from "zustand";
import { isAuthSessionMissingError } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase/client";
import { sessionStep } from "@/lib/feed/session-step";
import { useFeedStore } from "@/store/feed";
import type { Paper, Event, Job } from "@/types";
import { apiFetch } from "@/lib/api";

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
 */
export const useFeedSyncStatus = create<{ pushFailed: boolean }>(() => ({
  pushFailed: false,
}));
function markFeedPushFailed() {
  useFeedSyncStatus.setState({ pushFailed: true });
}
function clearFeedPushFailed() {
  useFeedSyncStatus.setState({ pushFailed: false });
}

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
        if (anyFailed) markFeedPushFailed();
        else clearFeedPushFailed();
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

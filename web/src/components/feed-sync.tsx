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
) {
  try {
    await apiFetch("/api/saved", {
      method: "POST",
      body: JSON.stringify({ itemId, itemKind, payload }),
    });
  } catch (err) {
    console.warn("[FeedSync] push saved failed", err);
  }
}

async function pushRead(itemId: string) {
  try {
    await apiFetch("/api/read", {
      method: "POST",
      body: JSON.stringify({ itemId }),
    });
  } catch (err) {
    console.warn("[FeedSync] push read failed", err);
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
      const localPushes: Promise<void>[] = [];
      for (const p of local.savedPapers) localPushes.push(pushSaved(p.id, "paper", p));
      for (const e of local.savedEvents) localPushes.push(pushSaved(e.id, "event", e));
      for (const j of local.savedJobs) localPushes.push(pushSaved(j.id, "job", j));
      for (const id of Object.keys(local.readItems)) localPushes.push(pushRead(id));
      await Promise.allSettled(localPushes);

      // 2. Now pull the merged server state and hydrate.
      const [savedRows, readRows] = await Promise.all([fetchSaved(), fetchRead()]);

      const savedPapers: Paper[] = [];
      const savedEvents: Event[] = [];
      const savedJobs: Job[] = [];
      for (const row of savedRows ?? []) {
        if (row.itemKind === "paper") savedPapers.push(row.payload as Paper);
        else if (row.itemKind === "event") savedEvents.push(row.payload as Event);
        else if (row.itemKind === "job") savedJobs.push(row.payload as Job);
      }
      const readItems: Record<string, true> = {};
      for (const r of readRows ?? []) readItems[r.itemId] = true;

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

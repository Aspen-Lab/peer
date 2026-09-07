"use client";

// Bridges the local zustand profile store to the Supabase `profiles` table.
//
//   signed-out  — localStorage only (unchanged)
//   signed-in   — on login: pull server → if server empty, push local up
//                 on update: debounced PUT of the CHANGED FIELDS ONLY
//
// Ordering guarantees (the old version got these wrong):
//   • didInitialPull flips only AFTER the pull + hydrate settle, so edits
//     made while the GET is in flight are not silently reverted.
//   • Pushes send a diff against the last-acknowledged server state — the
//     PUT handler honors partial updates, so two devices editing different
//     fields no longer clobber each other whole-object.
//   • Hydrating from remote primes the diff baseline, so the pull itself
//     never echoes a redundant PUT back at the server.
//
// Mount once, near the root; the account controls live on /profile.

import { useEffect, useRef } from "react";
import { create } from "zustand";
import { apiFetch } from "@/lib/api";
import { supabase } from "@/lib/supabase/client";
import { useProfileStore } from "@/store/profile";
import type { UserProfile } from "@/types";

// Signals that the INITIAL remote pull has settled — success, failure, or
// nothing-to-pull (signed out / no Supabase configured). FirstRunGate and the
// onboarding wizard wait on this before making profile-based decisions, so a
// returning user's synced topics land before any redirect or resume-position
// choice. Never flips back to false: later auth changes re-sync data but the
// first-load decision window is over.
export const useSyncGate = create<{ settled: boolean }>(() => ({
  settled: false,
}));
const markSyncSettled = () => useSyncGate.setState({ settled: true });

const DEBOUNCE_MS = 700;

function hasAnySignal(p: UserProfile): boolean {
  return (
    p.researchTopics.length > 0 ||
    p.preferredMethods.length > 0 ||
    p.locationPreferences.length > 0
  );
}

async function fetchRemote(): Promise<Partial<UserProfile> | null> {
  try {
    const data = await apiFetch<{ profile: Partial<UserProfile> | null }>(
      "/api/profile",
      { cache: "no-store" },
    );
    return data.profile;
  } catch (err) {
    console.warn("[ProfileSync] GET failed", err);
    return null;
  }
}

/** Local keys (BYOK API keys, Tavily) never leave the device. */
function remoteProfilePayload(profile: UserProfile): Partial<UserProfile> {
  const {
    tavilyEnabled,
    tavilyApiKey,
    feedAiProvider,
    feedAiApiKey,
    ...rest
  } = profile;
  void tavilyEnabled;
  void tavilyApiKey;
  void feedAiProvider;
  void feedAiApiKey;
  return rest;
}

/** Fields in `next` whose serialized value differs from the baseline. */
function diffPayload(
  next: Partial<UserProfile>,
  baseline: Partial<UserProfile> | null,
): Partial<UserProfile> {
  if (!baseline) return next;
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(next) as (keyof UserProfile)[]) {
    const a = next[key];
    const b = baseline[key];
    if (JSON.stringify(a ?? null) !== JSON.stringify(b ?? null)) {
      out[key as string] = a;
    }
  }
  return out as Partial<UserProfile>;
}

async function pushRemote(patch: Partial<UserProfile>): Promise<boolean> {
  try {
    await apiFetch("/api/profile", {
      method: "PUT",
      body: JSON.stringify(patch),
      cache: "no-store",
    });
    return true;
  } catch (err) {
    console.warn("[ProfileSync] PUT failed", err);
    return false;
  }
}

export function ProfileSync() {
  const profile = useProfileStore((s) => s.profile);
  const hydrateFromRemote = useProfileStore((s) => s.hydrateFromRemote);
  const isSignedInRef = useRef(false);
  const didInitialPullRef = useRef(false);
  const pullInFlightRef = useRef(false);
  // Last payload the server is known to have — the diff baseline.
  const lastPushedRef = useRef<Partial<UserProfile> | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );

  // 1. React to auth changes — pull on sign-in, reset state on sign-out.
  useEffect(() => {
    if (!supabase) {
      // No auth configured — local-only deployment, nothing will ever pull.
      markSyncSettled();
      return;
    }

    const onSession = async (signedIn: boolean) => {
      isSignedInRef.current = signedIn;
      if (!signedIn) {
        didInitialPullRef.current = false;
        lastPushedRef.current = null;
        // Signed out: there is no remote profile to wait for.
        markSyncSettled();
        return;
      }
      if (didInitialPullRef.current || pullInFlightRef.current) return;
      pullInFlightRef.current = true;

      try {
        const remote = await fetchRemote();
        const local = useProfileStore.getState().profile;

        if (!remote || !hasAnySignal({ ...local, ...remote } as UserProfile)) {
          // Server empty? Push local up so the first device keeps its signals.
          if (hasAnySignal(local)) {
            const payload = remoteProfilePayload(local);
            if (await pushRemote(payload)) lastPushedRef.current = payload;
          }
        } else {
          // Server has data — hydrate local with it (server wins on the
          // fields it defines), then prime the baseline from the MERGED
          // result so the hydrate itself doesn't echo a PUT.
          hydrateFromRemote(remote);
          lastPushedRef.current = remoteProfilePayload(
            useProfileStore.getState().profile,
          );
        }
        didInitialPullRef.current = true;
      } finally {
        pullInFlightRef.current = false;
        // Every exit path settles the gate — success, empty-server push, or
        // a thrown fetch.
        markSyncSettled();
      }
    };

    supabase.auth
      .getUser()
      .then(({ data }) => onSession(!!data.user))
      .catch(() => markSyncSettled());

    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "SIGNED_OUT") onSession(false);
      else if (session?.user) onSession(true);
    });

    return () => sub.subscription.unsubscribe();
  }, [hydrateFromRemote]);

  // 2. Push local changes to server, debounced and diffed. Only when signed
  //    in and after the initial pull has settled.
  useEffect(() => {
    if (!isSignedInRef.current || !didInitialPullRef.current) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      const payload = remoteProfilePayload(profile);
      const patch = diffPayload(payload, lastPushedRef.current);
      if (Object.keys(patch).length === 0) return;
      if (await pushRemote(patch)) {
        lastPushedRef.current = { ...lastPushedRef.current, ...patch };
      }
    }, DEBOUNCE_MS);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [profile]);

  return null;
}

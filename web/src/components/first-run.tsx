"use client";

// First-run onboarding plumbing.
//
// **It no longer redirects.** A first visitor used to be sent to /welcome and
// saw a seven-step form before a single paper. The first visit is now the
// briefing itself, with a sample feed and a setup strip above it
// (`components/briefing/starter-strip.tsx`); /welcome is still there and is
// still linked, for a reader who wants the long form.
//
// What is left here is the backfill: a synced profile that already has topics
// is proof of prior onboarding, so the local flag is written to match.
//
// Onboarding state is local (see UserProfile.onboardedAt), so this works for
// signed-out visitors too and resets cleanly when localStorage is cleared.

import { useEffect, useState, useSyncExternalStore } from "react";
import { usePathname } from "next/navigation";
import { useProfileStore } from "@/store/profile";
import { useSyncGate } from "@/components/profile-sync";

// True once the profile store has rehydrated from localStorage. The store uses
// `skipHydration` and is rehydrated after mount by <StoreHydrator/>, so before
// that finishes `onboardedAt` reads as its default (null) even for a returning
// user. useSyncExternalStore gives a prerender-safe read: the server snapshot
// is always false, and the client re-reads when hydration finishes.
export function useProfileHydrated(): boolean {
  return useSyncExternalStore(
    (onChange) => useProfileStore.persist.onFinishHydration(onChange),
    () => useProfileStore.persist.hasHydrated(),
    () => false,
  );
}

// True once the profile is trustworthy for first-load decisions: local
// persistence has hydrated AND ProfileSync's initial remote pull has settled
// (with a 4s dead-network fallback so a broken connection can only delay,
// never brick, the first-run flow). A returning user's synced topics land
// before this flips, so redirect and wizard-resume decisions never run on the
// stale pre-sync default profile.
export function useProfileSettled(): boolean {
  const hydrated = useProfileHydrated();
  const syncSettled = useSyncGate((s) => s.settled);
  const [timedOut, setTimedOut] = useState(false);

  useEffect(() => {
    if (!hydrated || syncSettled || timedOut) return;
    const timer = setTimeout(() => setTimedOut(true), 4000);
    return () => clearTimeout(timer);
  }, [hydrated, syncSettled, timedOut]);

  return hydrated && (syncSettled || timedOut);
}

export function FirstRunGate() {
  const pathname = usePathname();
  const onboardedAt = useProfileStore((s) => s.profile.onboardedAt);
  const topicsCount = useProfileStore((s) => s.profile.researchTopics.length);
  const completeOnboarding = useProfileStore((s) => s.completeOnboarding);
  const settled = useProfileSettled();

  // A profile with research topics is proof of prior onboarding, whatever the
  // local-only onboardedAt flag says — it covers the signed-in returning user
  // on a fresh browser, where ProfileSync pulls the synced profile but the
  // localStorage flag was lost. Backfill the flag from that evidence so the
  // rest of the app sees a consistent value (skipped while ON /welcome, where
  // a mid-wizard user may have only just added their first topic).

  useEffect(() => {
    if (!settled) return;
    if (pathname === "/welcome") return;
    if (!onboardedAt && topicsCount > 0) completeOnboarding();
  }, [settled, pathname, onboardedAt, topicsCount, completeOnboarding]);

  return null;
}

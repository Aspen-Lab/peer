"use client";

// First-run onboarding plumbing.
//
// **A profile that has never been set up opens on /welcome, once.** (P7-16,
// the owner's R12.) The first visit used to be the briefing alone, with a
// sample feed and a setup strip above it (see `starter-strip.tsx` in
// components/briefing) and no way into the walkthrough except a faint link in
// that strip. A reader who ran Peer from GitHub never met the wizard and never
// found where to put a key. So the gate sends a profile with nothing in it —
// no onboarding stamp, no topic, project, challenge or key (see
// lib/profile/first-visit.ts) — to /welcome, after the profile store has
// hydrated and the first sync has settled, and records that it did
// (`welcomeSkipped`), so it never happens a second time. The wizard's "Skip
// setup" and its last step set the same flag; the strip's "Set up Peer" and
// "Add a key" buttons stay as the way back.
//
// Beside that, the backfill: a synced profile that already has topics is proof
// of prior onboarding, so the local flag is written to match.
//
// Onboarding state is local (see UserProfile.onboardedAt and welcomeSkipped),
// so this works for signed-out visitors too and resets cleanly when
// localStorage is cleared.

import { useEffect, useState, useSyncExternalStore } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useProfileStore } from "@/store/profile";
import { useSyncGate } from "@/components/profile-sync";
import { walkthroughAction } from "@/lib/profile/first-visit";
// P4-S5b-FIX3 — the literal 4000 below is now sourced from here so it can't
// silently drift from page.tsx's own auth-outcome fallback, which waits on
// the same underlying ProfileSync state. The value and this hook's own
// behaviour are unchanged by the extraction.
import { AUTH_SETTLE_TIMEOUT_MS } from "@/lib/auth-settle-timeout";

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
    const timer = setTimeout(() => setTimedOut(true), AUTH_SETTLE_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [hydrated, syncSettled, timedOut]);

  return hydrated && (syncSettled || timedOut);
}

export function FirstRunGate() {
  const router = useRouter();
  const pathname = usePathname();
  const profile = useProfileStore((s) => s.profile);
  const completeOnboarding = useProfileStore((s) => s.completeOnboarding);
  const skipWelcome = useProfileStore((s) => s.skipWelcome);
  const settled = useProfileSettled();
  const onboardedAt = profile.onboardedAt;
  const topicsCount = profile.researchTopics.length;

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

  // The first visit. Only once the profile is trustworthy — after local
  // hydration AND the initial remote pull — because on the pre-sync default
  // profile a returning reader looks exactly like a new one, and would be
  // bounced into the wizard on a fresh-browser load. Nothing renders
  // differently before that: this component renders nothing at all.
  const action = settled ? walkthroughAction(pathname, profile) : null;

  useEffect(() => {
    if (!action) return;
    // Recorded first and in the same breath, so that however the reader leaves
    // the wizard — Skip, Enter Peer, the masthead, the back button — the
    // walkthrough has been offered exactly once.
    skipWelcome();
    if (action === "redirect") router.replace("/welcome");
  }, [action, router, skipWelcome]);

  return null;
}

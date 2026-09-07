"use client";

// First-run onboarding plumbing: FirstRunGate redirects a user who has never
// completed the welcome wizard to /welcome (once the persisted profile has
// hydrated, to avoid a false redirect).
//
// Onboarding state is local (see UserProfile.onboardedAt), so this works for
// signed-out visitors too and resets cleanly when localStorage is cleared.

import { useEffect, useState, useSyncExternalStore } from "react";
import { usePathname, useRouter } from "next/navigation";
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
  const router = useRouter();
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
  const onboarded = Boolean(onboardedAt) || topicsCount > 0;

  useEffect(() => {
    if (!settled) return;
    if (pathname === "/welcome") return;
    if (!onboardedAt && topicsCount > 0) completeOnboarding();
  }, [settled, pathname, onboardedAt, topicsCount, completeOnboarding]);

  useEffect(() => {
    // Redirect only once the profile is trustworthy — after local hydration
    // AND the initial remote pull. Deciding on the pre-sync default profile
    // bounced returning users into the wizard on their first fresh-browser
    // load.
    if (!settled) return;
    if (!pathname) return;
    // /persona is reachable straight from the wizard's final step — taking
    // the quiz must not require marking onboarding complete first.
    if (
      pathname === "/welcome" ||
      pathname === "/persona" ||
      pathname.startsWith("/auth")
    ) {
      return;
    }
    if (onboarded) return;
    router.replace("/welcome");
  }, [settled, pathname, onboarded, router]);

  return null;
}

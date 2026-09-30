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
import {
  ANONYMOUS_CLIENT_ENTITLEMENT,
  type ClientEntitlement,
} from "@/lib/entitlement/allowance";
import { supabase } from "@/lib/supabase/client";
import { useProfileStore } from "@/store/profile";
import type { UserProfile } from "@/types";
import { profileFeedIntentCard } from "@/lib/feed/intent";
import {
  mergeProfileAtSignIn,
  dirtySingleValueFields,
  listUnionChanged,
  preferenceLedgerChanged,
  singleValueSnapshot,
  SINGLE_VALUE_FIELDS,
  LIST_FIELDS,
  type SingleValueField,
} from "@/lib/profile/merge";

// Signals that the INITIAL remote pull has settled — success, failure, or
// nothing-to-pull (signed out / no Supabase configured). FirstRunGate and the
// onboarding wizard wait on this before making profile-based decisions, so a
// returning user's synced topics land before any redirect or resume-position
// choice. Never flips back to false: later auth changes re-sync data but the
// first-load decision window is over.
//
// P4-S5b-FIX3 (Round 3) — ABC-JEV-INTEGRATION.md §4 "P4-S5b-FIX3 ruled and
// assigned": `settled` above answers "has the PROFILE PULL finished" — a
// real, possibly slow or failing network round trip (`apiFetch` in
// web/src/lib/api.ts has no timeout anywhere). A consumer that only needs to
// know WHICH ACCOUNT this device is currently acting as (feed.ts's
// resolveOwnerKeyForLoad, picking a device-local delivery-history namespace)
// does not need to wait for that — the AUTH CHECK itself
// (`getUser()`/`onAuthStateChange`) resolves first and already answers that
// question. `authUserId` is published the moment the auth check confirms a
// real user, BEFORE the profile pull below even starts, and cleared back to
// `null` on a confirmed sign-out. `authOutcome` distinguishes "genuinely
// don't know yet" (`"unknown"`, the initial value — e.g. `getUser()` still
// in flight, or it REJECTED: a rejected check is unknown, not signed-out)
// from the two ways ownership becomes certain without a signed-in user
// (`"signed-out"`, `"unconfigured"` — no Supabase configured at all) and
// from `"signed-in"` (`authUserId` is set). Like `settled`, this never
// reverts to `"unknown"` once resolved — a later sign-out moves it to
// `"signed-out"`, not back to `"unknown"`.
export type AuthOutcome = "unknown" | "signed-in" | "signed-out" | "unconfigured";

export const useSyncGate = create<{
  settled: boolean;
  authUserId: string | null;
  authOutcome: AuthOutcome;
}>(() => ({
  settled: false,
  authUserId: null,
  authOutcome: "unknown",
}));
const markSyncSettled = () => useSyncGate.setState({ settled: true });

const DEBOUNCE_MS = 700;

function hasAnySignal(p: UserProfile): boolean {
  return (
    p.researchTopics.length > 0 ||
    p.preferredMethods.length > 0 ||
    p.locationPreferences.length > 0 ||
    p.currentProject !== undefined ||
    p.currentChallenges !== undefined ||
    p.feedIntent !== undefined
  );
}

/**
 * ABC-freemium 1-14 · R-ENT-3 — the single fetch site, so the single place the
 * entitlement enters the browser.
 *
 * **6-04 · Ruling 16 points 2-3 — a failed fetch is NOT an answer.** This used
 * to say a failed or signed-out fetch "leaves the store on its frozen anonymous
 * default, which is the honest value". Half of that was true and the half that
 * was not shipped a defect: the store held that default from the very first
 * render, so a **paid** reader looked free until the round trip finished and
 * could be upsold while the server was still granting what they paid for.
 *
 * The two cases are now separated, and only the caller can tell them apart:
 *  - **no session** — a fact, established below, and worth recording: the
 *    caller sets `ANONYMOUS_CLIENT_ENTITLEMENT` explicitly.
 *  - **the fetch failed, or auth could not be read** — not a fact. The store
 *    stays `null` and every upsell surface stays silent, which is the same
 *    direction every breaker in this build fails.
 */
async function fetchRemote(): Promise<{
  profile: Partial<UserProfile> | null;
  entitlement: ClientEntitlement | null;
}> {
  try {
    const data = await apiFetch<{
      profile: Partial<UserProfile> | null;
      entitlement?: ClientEntitlement;
    }>("/api/profile", { cache: "no-store" });
    return { profile: data.profile, entitlement: data.entitlement ?? null };
  } catch (err) {
    console.warn("[ProfileSync] GET failed", err);
    return { profile: null, entitlement: null };
  }
}

/**
 * Local keys (BYOK API keys, Tavily, and — SIGNIN-MERGE §1aj — the
 * events/jobs-era Adzuna/USAJobs credentials) never leave the device.
 *
 * The Adzuna/USAJobs fields were a real gap until this fix: no screen calls
 * `updateAdzunaKeys`/`updateUsajobsKeys` any more (that UI was removed with
 * events/jobs), so in practice they never held a value — but a restored
 * backup file (see the profile page's "Restore from a backup file" control)
 * CAN carry a real one, and without this exclusion it would ride along in
 * the very next debounced PUT body. `profilePatchToRow` has no column for
 * any of the four, so it could not reach the database either way, but it
 * would still leave the browser in plaintext over the wire and land in a
 * request body / server log — exactly what "never uploaded" means to
 * prevent. Proven by web/src/components/profile-sync.test.ts.
 */
export function remoteProfilePayload(profile: UserProfile): Partial<UserProfile> {
  const {
    tavilyEnabled,
    tavilyApiKey,
    adzunaAppId,
    adzunaAppKey,
    usajobsApiKey,
    usajobsUserAgent,
    feedAiProvider,
    feedAiApiKey,
    ...rest
  } = profile;
  void tavilyEnabled;
  void tavilyApiKey;
  void adzunaAppId;
  void adzunaAppKey;
  void usajobsApiKey;
  void usajobsUserAgent;
  void feedAiProvider;
  void feedAiApiKey;
  const feedIntent = profileFeedIntentCard(profile);
  return feedIntent ? { ...rest, feedIntent } : rest;
}

/**
 * SIGNIN-MERGE (§1aj, P3) — "a failed push is retried on the next change and
 * shown to the user once in plain words." `console.warn` alone (the old
 * behaviour) never reached the user at all. `web/src/app/profile/page.tsx`
 * renders a small, calm, honest line while `pushFailed` is true; it clears
 * itself the moment a push next succeeds — this is deliberately a status,
 * not a one-shot toast, since the underlying condition (the account isn't
 * caught up yet) is genuinely ongoing until it resolves.
 */
export const useProfileSyncStatus = create<{ pushFailed: boolean }>(() => ({
  pushFailed: false,
}));
function markProfilePushFailed() {
  useProfileSyncStatus.setState({ pushFailed: true });
}
function clearProfilePushFailed() {
  useProfileSyncStatus.setState({ pushFailed: false });
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

/**
 * PROFILE-SYNC (§1bk ruling 2, widened by §1bk.8 AMENDMENT) — what the
 * reconcile push (right after the sign-in merge) actually sends:
 *  - the dirty `SINGLE_VALUE_FIELDS` — originally §1aj's 14, now also the
 *    §1bk.8 AMENDMENT's 11 feed knobs (feedFocus, feedFreshness, paperCount,
 *    feedSourceMix, feedImportance, feedMethodMode, feedDiscoveryMode, the
 *    three feedAvoid* switches) and digestEnabled — every one of them a
 *    scalar with a real server column that an unconditional push could
 *    overwrite, enumerated by actually running `remoteProfilePayload` on a
 *    fully populated profile rather than assumed (checkpoint §11.1);
 *  - any `LIST_FIELDS` entry whose union genuinely added something new;
 *  - `preferenceLedger`, only when it genuinely differs from remote's own
 *    (checkpoint §11.3 — the merge itself can never shrink it, so this is a
 *    resend-avoidance filter, not a safety one).
 * `feedIntent` is deliberately left exactly as `remoteProfilePayload`
 * computes it (conditionally included when non-null) — it is 100% derived
 * from fields already covered above (project/challenge from the
 * single-value fields, requiredConcepts/preferredConcepts/exclusions from
 * the union-safe list fields), so its safety is inherited, not independent;
 * adding a second "did feedIntent itself change" filter would compare a
 * value that only ever changes when its own already-safe inputs do —
 * redundant, and one more place to get a comparison wrong (checkpoint
 * §11.3). Every field with NO server column at all (activeSearchInputs,
 * selectedSenseConcepts, the advisor* local-only fields, onboardedAt,
 * deepReportEnabled) is also left unconditional — pushing them changes
 * nothing on the account, since the server-side `profilePatchToRow` never
 * writes them to any column (checkpoint §11.1's classification table).
 */
export function reconcilePushPayload(
  merged: UserProfile,
  remote: Partial<UserProfile> | null,
  dirty: ReadonlySet<SingleValueField>,
): Partial<UserProfile> {
  const payload = remoteProfilePayload(merged) as Record<string, unknown>;
  for (const key of SINGLE_VALUE_FIELDS) {
    if (!dirty.has(key)) delete payload[key];
  }
  for (const key of LIST_FIELDS) {
    if (!listUnionChanged(remote?.[key], merged[key])) delete payload[key];
  }
  if (!preferenceLedgerChanged(remote?.preferenceLedger, merged.preferenceLedger)) {
    delete payload.preferenceLedger;
  }
  return payload as Partial<UserProfile>;
}

export interface ReconcilePlan {
  /** Apply to the local store exactly as `mergeProfileAtSignIn`'s patch. */
  patch: Partial<UserProfile>;
  /** Send to `PUT /api/profile` — empty means nothing needs sending. */
  pushPayload: Partial<UserProfile>;
  /** `local` with `patch` applied. The caller uses this to build the new
   *  `lastSynced`/`lastPushedRef` baseline once (if `pushPayload` is
   *  non-empty) the push is confirmed. */
  merged: UserProfile;
}

/**
 * PROFILE-SYNC (§1bk) — the entire sign-in reconcile decision, pure and
 * headless — `onSession` below becomes a thin wrapper that applies `patch`,
 * awaits `pushRemote(pushPayload)` when non-empty, and advances
 * `lastSynced`/`lastPushedRef` on success. Lives here (not in
 * lib/profile/merge.ts) because it needs `remoteProfilePayload`'s
 * credential redaction + feedIntent computation. `dirtySingleValueFields`
 * is computed here (once) from `local`/`lastSynced` regardless of whether
 * `remote` is null — it does not depend on `remote` — and reused for both
 * the merge decision (inside `mergeProfileAtSignIn`, which recomputes it
 * identically: pure and deterministic, so this is zero-drift-risk, not
 * duplicated bookkeeping) and this payload filter.
 */
export function planReconcile(
  local: UserProfile,
  remote: Partial<UserProfile> | null,
  lastSynced: Partial<UserProfile> | null,
): ReconcilePlan {
  const dirty = dirtySingleValueFields(local, lastSynced);
  const { patch } = mergeProfileAtSignIn(local, remote, lastSynced);
  const merged: UserProfile = { ...local, ...patch };
  const pushPayload = reconcilePushPayload(merged, remote, dirty);
  return { patch, pushPayload, merged };
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
  const setEntitlement = useProfileStore((s) => s.setEntitlement);
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
      // ABC-freemium 6-04 — and that IS the answer, not a missing one: nobody
      // can sign in here, so the reader is anonymous as a matter of fact and
      // the store may say so. Leaving it `null` would silence the sign-in
      // sentence forever in exactly the runtime that always needs it.
      setEntitlement(ANONYMOUS_CLIENT_ENTITLEMENT);
      // P4-S5b-FIX3 — distinct from "signed-out" in name only; both read as
      // ANONYMOUS_OWNER_KEY in feed.ts's resolveOwnerKeyForLoad (the ruling:
      // "anonymous ONLY when signed-out is confirmed or auth is not
      // configured").
      useSyncGate.setState({ authUserId: null, authOutcome: "unconfigured" });
      markSyncSettled();
      return;
    }

    const onSession = async (userId: string | null) => {
      const signedIn = userId !== null;
      isSignedInRef.current = signedIn;
      if (!signedIn) {
        didInitialPullRef.current = false;
        lastPushedRef.current = null;
        // Signed out: there is no remote profile to wait for.
        // ABC-freemium 6-04 — "signed out" is a fact we have just established,
        // so record it. This is the `known + anonymous` state of Ruling 16
        // point 3, and it is what earns the reader an honest sentence about
        // signing in rather than the silence of an unknown plan. It also runs
        // on `SIGNED_OUT`, so logging out downgrades the client immediately
        // instead of leaving a stale `paid` on screen.
        setEntitlement(ANONYMOUS_CLIENT_ENTITLEMENT);
        // P4-S5b-FIX3 — a CONFIRMED sign-out (never a rejected/unresolved
        // auth check — see the `.catch()` below, which deliberately leaves
        // this untouched). Clears any previously-published id.
        useSyncGate.setState({ authUserId: null, authOutcome: "signed-out" });
        markSyncSettled();
        return;
      }
      // P4-S5b-FIX3 — publish the confirmed id THE MOMENT the auth check
      // itself resolves, before the profile pull below even starts (and
      // before the didInitialPullRef early-return just below, so a second
      // onSession call for an already-pulled user still keeps this
      // current). A consumer that only needs to know which account this
      // device is acting as (feed.ts's resolveOwnerKeyForLoad) no longer
      // has to wait for a full /api/profile round trip that might be slow
      // or fail outright — see markSyncSettled in the `finally` below: a
      // FAILED pull still settles, with `entitlement` staying null, which
      // used to be indistinguishable from confirmed signed-out.
      useSyncGate.setState({ authUserId: userId, authOutcome: "signed-in" });
      if (didInitialPullRef.current || pullInFlightRef.current) return;
      pullInFlightRef.current = true;

      try {
        const { profile: remote, entitlement } = await fetchRemote();
        // ABC-freemium 1-14 — hold it next to the profile. Set before the
        // branch below so it lands even when the server has no profile row yet.
        // 6-04 — no `else`: when the fetch failed we have learned nothing, and
        // writing the anonymous default here would be inventing an answer for a
        // signed-in reader whose plan we simply could not read.
        if (entitlement) setEntitlement(entitlement);
        const local = useProfileStore.getState().profile;
        const lastSynced = useProfileStore.getState().lastSynced;

        // SIGNIN-MERGE (§1af/§1ah/§1aj) + PROFILE-SYNC (§1bk) — a real
        // per-field merge (P1) that also knows which of THIS device's
        // single-value fields are a genuine pending edit ("dirty" — differ
        // from what it last confirmed with the account, or from
        // defaultProfile when it has never confirmed anything yet) versus a
        // stale or untouched copy — see lib/profile/merge.ts for the full
        // rules and why the old boundary (and, later, the bare "local wins
        // once" single-value rule) was unsafe. `planReconcile` computes the
        // entire decision in one pure call (unit-tested headlessly, same
        // convention as `mergeProfileAtSignIn` itself): which fields this
        // device's own edit wins outright, and exactly what — if anything —
        // needs to reach the account for them. `patch` only ever contains
        // fields this merge has an opinion on; setState below installs them
        // exactly as given, including an explicit `feedIntent: undefined`
        // when present (a real assignment, unlike the old
        // `hydrateFromRemote`'s "install only if defined" pattern, which
        // cannot express a clear).
        const { patch, pushPayload, merged } = planReconcile(local, remote, lastSynced);
        if (Object.keys(patch).length > 0) {
          useProfileStore.setState((s) => ({ profile: { ...s.profile, ...patch } }));
        }

        // Reconcile the account to whatever this merge just decided. A push
        // can only ever ADD to the account, never discard anything (P3), so
        // attempting one whenever there is a real account row to reconcile
        // against is safe — this is what closes §0/§1ah's "nothing the user
        // sets ever reaches the account" for good, not just for the very
        // first sign-in. When there is no account row at all yet (brand new
        // — or the pull itself failed, §1's `remote === null`), only
        // attempt when local actually has something worth carrying up.
        const shouldAttemptSync = remote ? true : hasAnySignal(local);
        if (shouldAttemptSync) {
          if (Object.keys(pushPayload).length === 0) {
            // PROFILE-SYNC (§1bk ruling 3) — "a pull that needed no push":
            // every dirty field already agreed with the account and no list
            // union added anything new, so there is nothing to send. Still
            // a successful, confirmed sync — record it.
            useProfileStore.getState().setLastSynced(singleValueSnapshot(merged));
            lastPushedRef.current = remoteProfilePayload(merged);
            clearProfilePushFailed();
          } else if (await pushRemote(pushPayload)) {
            useProfileStore.getState().setLastSynced(singleValueSnapshot(merged));
            lastPushedRef.current = remoteProfilePayload(merged);
            clearProfilePushFailed();
          } else {
            // P3 — leaving lastSynced/lastPushedRef unset means the dirty
            // fields stay dirty and the next local edit's diff still
            // includes them: the retry P3 requires, with no extra
            // bookkeeping needed here.
            markProfilePushFailed();
          }
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
      .then(({ data }) => onSession(data.user ? data.user.id : null))
      // P4-S5b-FIX3 — a REJECTED getUser() leaves `authOutcome` at its
      // "unknown" default (never set to "signed-out": we genuinely don't
      // know). `settled` still becomes `true` here, unchanged from before
      // this fix — feed.ts's resolveOwnerKeyForLoad no longer trusts
      // `settled` alone for its anonymous fallback, precisely because of
      // this case.
      .catch(() => markSyncSettled());

    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "SIGNED_OUT") onSession(null);
      else if (session?.user) onSession(session.user.id);
    });

    return () => sub.subscription.unsubscribe();
  }, [setEntitlement]);

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
        // PROFILE-SYNC (§1bk ruling 3) — "after every successful push...
        // lastSynced becomes the resulting snapshot." Uses the `profile`
        // this effect closed over (the same snapshot `payload` was built
        // from), restricted to the 14 single-value fields, so a reload
        // correctly remembers this push even though the reconcile-cycle
        // update in onSession only fires once, at sign-in.
        useProfileStore.getState().setLastSynced(singleValueSnapshot(profile));
        clearProfilePushFailed();
      } else {
        // P3 — visible, not console-only; see useProfileSyncStatus above.
        // lastPushedRef (and lastSynced) deliberately left unadvanced, so
        // the next edit's diff still includes this one and the retry
        // happens naturally.
        markProfilePushFailed();
      }
    }, DEBOUNCE_MS);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [profile]);

  return null;
}

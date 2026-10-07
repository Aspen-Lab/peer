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
import { defaultProfile, type UserProfile } from "@/types";
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
 * The sign-in reconcile's own GET of the account's profile. A failed fetch
 * reads as `null`, the same as "the account has no row yet", which is safe
 * here: `mergeProfileAtSignIn` treats a null remote as "nothing to merge from,
 * local stays exactly as it is" either way.
 */
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

/**
 * LIST-REMOVAL-SYNC (§1bq.3) — `pullMergeAndPush`'s own GET, deliberately
 * separate from `fetchRemote` above. `fetchRemote` collapses "the fetch
 * failed" and "the account genuinely has no row yet" into the same
 * `{ profile: null }` shape — safe for the sign-in reconcile, because
 * `mergeProfileAtSignIn` treats a null remote as "nothing to merge from,
 * local stays exactly as it is" either way (§1af P3). It is NOT safe here: a
 * genuinely failed pull must never let a list push go out merged against
 * nothing, or it could silently drop whatever the account actually holds.
 * `ok: false` means the fetch itself failed; `ok: true, profile: null` is
 * the honest "no account row yet" case, which IS safe to merge against
 * (mergeProfileAtSignIn's own null-remote branch already handles it).
 */
async function fetchRemoteForSync(): Promise<
  { ok: true; profile: Partial<UserProfile> | null } | { ok: false }
> {
  try {
    const data = await apiFetch<{ profile: Partial<UserProfile> | null }>(
      "/api/profile",
      { cache: "no-store" },
    );
    return { ok: true, profile: data.profile };
  } catch (err) {
    console.warn("[ProfileSync] GET (pull-before-push) failed", err);
    return { ok: false };
  }
}

/**
 * Local keys (the model key, the Jev key, Tavily, and — SIGNIN-MERGE §1aj —
 * the events/jobs-era Adzuna/USAJobs credentials) never leave the device.
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
    jevApiKey,
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
  // The reader's Jev key never leaves the browser except in the paper request
  // body that asks Jev to screen their papers.
  void jevApiKey;
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
 *  - any `LIST_FIELDS` entry whose merge genuinely changed — LIST-REMOVAL-SYNC
 *    (§1bq) POLICY 3: this used to say "union genuinely added something
 *    new," accurate when the only merge shape was a plain union; the
 *    three-way merge can now also genuinely DROP an item (a removal that
 *    should stick), which `listUnionChanged` already reports correctly
 *    (position/length inequality — a shrink included — confirmed unchanged
 *    by this item, see its own doc comment in lib/profile/merge.ts);
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

/**
 * ACCOUNT-SWITCH (ABC-JEV-INTEGRATION.md §1bt point 1) — true when this
 * device's recorded owner is a REAL, DIFFERENT account than the one that
 * just confirmed sign-in. `null` ("no owner yet" — a fresh device, or a
 * pre-§1bt blob) is never a switch: that is exactly §1bk's existing
 * bootstrap case, which must keep merging normally. Pure, so the decision
 * itself is testable without a DOM (this file's own "no
 * @testing-library/react" constraint — see this file's test header).
 */
export function isAccountSwitch(
  syncedAccountId: string | null,
  userId: string,
): boolean {
  return syncedAccountId !== null && syncedAccountId !== userId;
}

/**
 * ACCOUNT-SWITCH (§1bt point 1) — the sign-in reconcile decision WITH the
 * owner-key gate composed in, pure, for direct testing without mounting a
 * real store. Production (`onSession` below) reaches the identical outcome
 * a different way: on a genuine switch it calls the REAL `logOut()` action
 * first — a store side effect (profile/lastSynced/syncedAccountId all
 * reset together, `logOut`'s own contract) — so by the
 * time it reads `local`/`lastSynced` back from the store they are ALREADY
 * `defaultProfile`/`null`. Calling `planReconcile(local, remote,
 * lastSynced)` at that point is algebraically identical to this function's
 * switch branch (`planReconcile(defaultProfile, remote, null)`) — the same
 * "clean profile, B starts like a fresh device" outcome Q2 scenario (d)
 * already proves is safe. This function exists so that equivalence, and
 * the decision itself, is provable head-on rather than only by reading the
 * two code paths side by side.
 */
export function planReconcileForSignIn(
  syncedAccountId: string | null,
  userId: string,
  local: UserProfile,
  remote: Partial<UserProfile> | null,
  lastSynced: Partial<UserProfile> | null,
): ReconcilePlan {
  if (isAccountSwitch(syncedAccountId, userId)) {
    return planReconcile(defaultProfile, remote, null);
  }
  return planReconcile(local, remote, lastSynced);
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

/** The `lastSynced`/`lastPushedRef` pair a sync attempt leaves behind. */
export interface SyncBaselines {
  lastSynced: Partial<UserProfile> | null;
  lastPushed: Partial<UserProfile> | null;
}

/**
 * PROFILE-SYNC-RETRY-TEST (§1bk.9a) — the one decision both push sites make
 * after attempting to reconcile with the account: "after this attempt, what
 * are the new sync baselines?" This is SIGNIN-MERGE's P3 guard (§1aj — "a
 * failed push is retried on the next change") pulled out of the `onSession`
 * and debounced-push closures into its own pure, directly-testable function.
 * Neither closure can be mounted by this repo's test harness (no
 * `@testing-library/react`-style effect runner — see this file's test
 * header), which is exactly why the FAILURE side had no test at all before
 * this item (PROFILE-SYNC review, docs/jev-abc/PROFILE-SYNC-A-20260930T023227Z.md,
 * finding (a)): the guard was correct but unreachable by anything that
 * exists in this suite.
 *
 *  - `succeeded` true (a push landed, or there was nothing to push — the
 *    "nothing to push" branch in `onSession` is ALSO a confirmed sync) →
 *    both baselines advance to `profile`'s own current state, i.e. "the
 *    pushed state": `lastSynced` becomes the single-value snapshot
 *    (`singleValueSnapshot`) and `lastPushed` becomes the full remote-shaped
 *    payload (`remoteProfilePayload`, so credential redaction applies here
 *    too).
 *  - `succeeded` false → `previous` comes back UNCHANGED (the same object,
 *    not a copy) — every field that was dirty stays dirty, so the next
 *    local edit's diff, or the next sign-in reconcile, includes it again.
 *    That is the whole of P3's retry promise; there is nothing else to do
 *    on this path. The failure notice (`markProfilePushFailed`) stays a
 *    separate call at each call site, unchanged by this function.
 *
 * The `succeeded: true` overload gives both call sites (which only ever
 * call this after they already know the attempt succeeded) a non-nullable
 * return, matching `setLastSynced`'s own non-nullable parameter — no cast
 * needed.
 */
export function nextSyncBaselines(
  succeeded: true,
  profile: UserProfile,
  previous: SyncBaselines,
): { lastSynced: Partial<UserProfile>; lastPushed: Partial<UserProfile> };
export function nextSyncBaselines(
  succeeded: boolean,
  profile: UserProfile,
  previous: SyncBaselines,
): SyncBaselines;
export function nextSyncBaselines(
  succeeded: boolean,
  profile: UserProfile,
  previous: SyncBaselines,
): SyncBaselines {
  if (!succeeded) return previous;
  return {
    lastSynced: singleValueSnapshot(profile),
    lastPushed: remoteProfilePayload(profile),
  };
}

/**
 * LIST-REMOVAL-SYNC (§1bq.3) — the lost-update mitigation's own dependency
 * seam. Every side effect `pullMergeAndPush` needs is injected, so the
 * whole pull → merge → apply → push sequence is directly testable with
 * fakes (this repo has no `@testing-library/react`-style harness — see this
 * file's own header note) — the same technique `nextSyncBaselines` already
 * uses for the narrower "what are the new baselines" decision.
 */
export interface PullBeforePushDeps {
  /** GET /api/profile, fresh. See `fetchRemoteForSync`'s own header note on
   *  why a genuine fetch failure (`ok: false`) must never be confused with
   *  a genuinely row-less account (`ok: true, profile: null` — safe to
   *  merge against). */
  getRemote: () => Promise<
    { ok: true; profile: Partial<UserProfile> | null } | { ok: false }
  >;
  /** The local profile and its sync baselines, read at the moment they're
   *  actually needed — never a value captured before the GET above, so an
   *  edit typed while the GET was in flight is never missed or overwritten. */
  readLocal: () => { profile: UserProfile; lastSynced: Partial<UserProfile> | null };
  /** Install a merge patch on the local store — same "apply exactly as
   *  given, including an explicit feedIntent: undefined" contract as
   *  `ProfileMergeOutcome.patch` (lib/profile/merge.ts). */
  applyPatch: (patch: Partial<UserProfile>) => void;
  /** PUT /api/profile; resolves true on success. */
  push: (payload: Partial<UserProfile>) => Promise<boolean>;
  /** Persist the new sync baselines after a confirmed success (a real push,
   *  or a pull that needed no push — §1bk ruling 3, same as `onSession`). */
  setBaselines: (baselines: { lastSynced: Partial<UserProfile>; lastPushed: Partial<UserProfile> }) => void;
  /** The visible push-failed status (P3) — set whenever this attempt cannot
   *  safely complete (the pull failed, or the push itself failed). */
  markPushFailed: () => void;
  /** Cleared once a push (or a no-push-needed pull) actually lands. */
  clearPushFailed: () => void;
  /** This device's diff baseline for the NEXT push — same role as
   *  `lastPushedRef.current`. */
  getLastPushed: () => Partial<UserProfile> | null;
}

export type PullMergeAndPushOutcome =
  | { status: "pulled-and-pushed" }
  | { status: "synced-no-push-needed" }
  | { status: "pull-failed" }
  | { status: "push-failed" };

/**
 * LIST-REMOVAL-SYNC (§1bq.3) — called instead of a bare push any time the
 * steady-state debounced push's pending patch carries a `LIST_FIELDS`
 * change (wired in `ProfileSync` below). Pulls the account fresh, re-runs
 * the SAME merge the page-load reconcile uses (`planReconcile` — one merge
 * path, two call sites) against local state read AFTER the pull resolves
 * (`readLocal`, never a value captured before the `await` above — so a
 * concurrent edit typed during the pull is captured, not clobbered),
 * applies the result to the local store in the same synchronous step the
 * merge itself runs in (no `await` between `readLocal` and `applyPatch`),
 * and pushes the merged profile through `planReconcile`'s own
 * `pushPayload` — built from `remoteProfilePayload`, so `feedIntent` is
 * always recomputed fresh from the merged inputs, never a bare list key
 * (docs/jev-abc/LIST-REMOVAL-SYNC-B-20260930T082019Z.md Q3's own second
 * finding: a bare list-key push silently reintroduces the §1bp.2 staleness
 * bug through this second push site). A failed pull never pushes blind: it
 * marks the existing push-failed status and stops, so the very next local
 * change retries the whole sequence — the same P3 retry guarantee every
 * other push path in this file already gives. `lastSynced`/the push
 * baseline advance only once a push has actually landed, OR once a pull
 * needed no push at all (§1bk ruling 3 — a confirmed sync either way).
 *
 * Scope: only a push that carries a list change calls this — see
 * `ProfileSync`'s own `carriesListChange` note for why an ordinary
 * scalar-only push does not pull first.
 */
export async function pullMergeAndPush(deps: PullBeforePushDeps): Promise<PullMergeAndPushOutcome> {
  const pulled = await deps.getRemote();
  if (!pulled.ok) {
    deps.markPushFailed();
    return { status: "pull-failed" };
  }
  // No `await` between here and `applyPatch` — see this function's own
  // header note.
  const { profile: local, lastSynced } = deps.readLocal();
  const { patch, pushPayload, merged } = planReconcile(local, pulled.profile, lastSynced);
  if (Object.keys(patch).length > 0) {
    deps.applyPatch(patch);
  }
  const nothingToPush = Object.keys(pushPayload).length === 0;
  const pushed = nothingToPush || (await deps.push(pushPayload));
  if (!pushed) {
    deps.markPushFailed();
    return { status: "push-failed" };
  }
  const baselines = nextSyncBaselines(true, merged, {
    lastSynced,
    lastPushed: deps.getLastPushed(),
  });
  deps.setBaselines(baselines);
  deps.clearPushFailed();
  return nothingToPush ? { status: "synced-no-push-needed" } : { status: "pulled-and-pushed" };
}

/**
 * LIST-REMOVAL-SYNC (§1bq.3) — the steady-state debounced push's own
 * dependency wiring for `pullMergeAndPush`, factored out to a NAMED
 * top-level function rather than an inline object literal inside the
 * debounced-push closure. This is a wiring constraint, not a style choice:
 * profile-sync.test.tsx's pre-existing "closures actually use
 * nextSyncBaselines" source-text check requires that closure's own source
 * to contain exactly ONE literal `setLastSynced(` call (the ordinary,
 * non-list push path's). Building this function's `setBaselines` callback
 * inline inside that closure would add a second literal `setLastSynced(`
 * occurrence to the SAME marked region and redden that pre-existing test;
 * defining it here instead keeps the closure's own source at exactly the
 * one call the existing test expects.
 */
function listPullDeps(lastPushedRef: { current: Partial<UserProfile> | null }): PullBeforePushDeps {
  return {
    getRemote: fetchRemoteForSync,
    readLocal: () => ({
      profile: useProfileStore.getState().profile,
      lastSynced: useProfileStore.getState().lastSynced,
    }),
    applyPatch: (patch) =>
      useProfileStore.setState((s) => ({ profile: { ...s.profile, ...patch } })),
    push: pushRemote,
    setBaselines: (baselines) => {
      lastPushedRef.current = baselines.lastPushed;
      useProfileStore.getState().setLastSynced(baselines.lastSynced);
    },
    markPushFailed: markProfilePushFailed,
    clearPushFailed: clearProfilePushFailed,
    getLastPushed: () => lastPushedRef.current,
  };
}

/**
 * ACCOUNT-SWITCH (§1bt point 4; the guide's Q4) — the mutable flags
 * `runSyncSerialized` reads and writes across calls, shaped like a React
 * ref (`{ current }`) so a component can pass its own `useRef` directly
 * and a test can pass a plain `{ current: false }` object with no DOM
 * involved. `current` holds the in-progress sequence's own promise, so a
 * caller that COALESCES into an already-running sequence (rather than
 * starting one) can still await genuine completion — see
 * `runSyncSerialized`'s own doc comment for why this matters.
 */
export interface SyncSerializationFlags {
  inFlight: { current: boolean };
  queued: { current: boolean };
  current: { current: Promise<void> | null };
}

/**
 * ACCOUNT-SWITCH (§1bt point 4; the guide's Q4) — serializes
 * `pullMergeAndPush`: an in-flight guard plus ONE coalesced follow-up, so
 * two sync sequences never run concurrently. Closes §1bq.6(b) MEDIUM: a
 * successful `pullMergeAndPush` always installs a new `profile` object
 * (`applyPatch`), which re-arms `ProfileSync`'s own debounced-push effect
 * (it depends on `[profile]` by reference) — without this guard, that
 * self-rearm starts a second, fully independent, OVERLAPPING
 * `pullMergeAndPush` call whenever a round trip exceeds the 700ms
 * debounce, roughly doubling exposure to the already-accepted "third push
 * lands in the gap" window (§1bq.3). With the guard: the common (fast)
 * case is unchanged (the self-rearm's call arrives after the first has
 * already finished, so it just runs once more and — per
 * `pullMergeAndPush`'s own contract, it re-reads live state — usually
 * finds nothing left to push); the slow case now QUEUES instead of
 * overlapping, and the queued run's own fresh pull/merge/push closes the
 * gap the same way a second unguarded call would have, just never at the
 * same time as the first.
 *
 * Deliberately returns a promise that resolves once the WHOLE serialized
 * sequence this call is part of has actually settled — including a
 * coalesced follow-up — even when this particular call only coalesced
 * into an already-running one rather than starting it. `ProfileSync`'s own
 * fire-and-forget caller does not need that (a `useEffect` cannot `await`
 * across renders anyway), but the flush path (§1bt point 3) does: it must
 * know the account is genuinely caught up before it lets sign-out proceed,
 * not merely that an attempt was kicked off. One function serves both
 * callers correctly rather than two subtly different ones.
 */
export function runSyncSerialized(
  deps: PullBeforePushDeps,
  flags: SyncSerializationFlags,
): Promise<void> {
  if (flags.inFlight.current) {
    flags.queued.current = true; // coalesce: at most ONE extra run, however
    return flags.current.current ?? Promise.resolve(); // many callers arrive while busy
  }
  flags.inFlight.current = true;
  const run = (async () => {
    try {
      do {
        flags.queued.current = false;
        await pullMergeAndPush(deps); // unchanged — re-reads live state via
        // its own readLocal()/getRemote(), so a queued run genuinely
        // re-checks rather than replaying a stale decision.
      } while (flags.queued.current);
    } finally {
      flags.inFlight.current = false;
      flags.current.current = null;
    }
  })();
  flags.current.current = run;
  return run;
}

// ACCOUNT-SWITCH (§1bt.8 AMENDMENT (b)) — must match
// web/src/app/auth/signout/route.ts's SIGNED_OUT_COOKIE_NAME exactly; see
// that file's own comment on why this is one literal per file rather than
// a shared import.
export const SIGN_OUT_COOKIE_NAME = "peer_signed_out";

/**
 * ACCOUNT-SWITCH (§1bt.8 AMENDMENT (b)) — true only when the sign-out
 * route's own short-lived, first-party cookie is present in
 * `document.cookie`. REPLACES the §1bt.7 AMENDMENT's URL parameter
 * (`hasSignedOutMarker`/`?signed-out=1`, now removed): a URL can be
 * forged, shared, or bookmarked — a link alone could trigger the same
 * clear a real sign-out does (the fresh review's MEDIUM finding, CHECK 4).
 * A cookie can only be created by a same-origin Set-Cookie response header
 * (route.ts actually running), never by a URL a browser merely navigates
 * to. Exact match on `"1"`, not mere presence, so a future unrelated
 * cookie sharing a prefix cannot be misread.
 */
export function hasSignOutCookie(cookieString: string): boolean {
  return cookieString
    .split(";")
    .map((part) => part.trim())
    .some((part) => part === `${SIGN_OUT_COOKIE_NAME}=1`);
}

/** Sets `document.cookie` so the browser deletes the cookie (matching
 *  path, so it actually removes it rather than creating an unrelated
 *  expired one) — called once the cookie has been READ, so it can never
 *  be read a second time by a later, unrelated page load this session. */
export function deleteSignOutCookie(): void {
  document.cookie = `${SIGN_OUT_COOKIE_NAME}=; Path=/; Max-Age=0; SameSite=Lax`;
}

/**
 * ACCOUNT-SWITCH (§1bt.8 AMENDMENT (b)) — whether a CONFIRMED sign-out
 * should clear local profile state. ALL THREE must hold: the cookie is
 * present (this load followed a real `POST /auth/signout`, not a forged
 * link); `authOutcome` is the CONFIRMED `"signed-out"` value — never
 * `"unknown"` (an unresolved or rejected auth check) or `"unconfigured"`
 * or `"signed-in"`; and this device actually has an owner recorded (a
 * guest whose `syncedAccountId` is already `null` has nothing to clear
 * either way — checked explicitly, the same reasoning §1bt.7's own
 * `shouldClearOnThisLoad` used, rather than relying on `logOut()` being a
 * harmless no-op). Pure, so every combination is testable without a DOM.
 */
export function shouldClearOnConfirmedSignOut(
  cookiePresent: boolean,
  authOutcome: AuthOutcome,
  syncedAccountId: string | null,
): boolean {
  return cookiePresent && authOutcome === "signed-out" && syncedAccountId !== null;
}

export interface ProcessConfirmedSignOutCookieDeps {
  cookiePresent: boolean;
  authOutcome: AuthOutcome;
  syncedAccountId: string | null;
  logOut: () => void;
  deleteCookie: () => void;
}

/**
 * ACCOUNT-SWITCH (§1bt.8 AMENDMENT (b)) — the whole "a confirmed sign-out
 * just happened, should it clear local state" sequence, pure/DI-only (same
 * shape as `PullBeforePushDeps`/`FlushBeforeSignOutDeps`) so it is
 * directly testable with fakes, no DOM required. No cookie → does
 * nothing at all (not even a delete — nothing was read). A cookie IS
 * present → decide via `shouldClearOnConfirmedSignOut`, clear if
 * warranted, THEN always consume (delete) the cookie regardless of that
 * decision — a guest's browser must not keep carrying a stale cookie into
 * a LATER sign-in this same session.
 */
export function processConfirmedSignOutCookie(deps: ProcessConfirmedSignOutCookieDeps): void {
  if (!deps.cookiePresent) return;
  if (shouldClearOnConfirmedSignOut(deps.cookiePresent, deps.authOutcome, deps.syncedAccountId)) {
    deps.logOut();
  }
  deps.deleteCookie();
}

/**
 * ACCOUNT-SWITCH (§1bt point 3) — what `account-section.tsx`'s sign-out
 * form needs from this file, as a small function with every side effect
 * injected — the same DI shape as `PullBeforePushDeps` — so it is testable
 * without a DOM. "Anything unsynced" is `pendingPatch()` non-empty (this
 * IS the widened signal POLICY 2 asked for: it is non-empty for BOTH named
 * triggers — an already-failed push left its field(s) dirty against the
 * last-confirmed baseline, since `nextSyncBaselines` never advances that
 * baseline on failure §1bk.9a, and a live edit still inside the debounce
 * has, by definition, already changed the diff away from it — one check
 * instead of two flags to keep in sync) OR `pushFailed` (kept as its own
 * input too, belt-and-suspenders, for the theoretical edge where a
 * profile reverted back to matching the stale baseline after a failure —
 * see the checkpoint for why this is intentionally conservative).
 */
export interface FlushBeforeSignOutDeps {
  /** The existing push-failed status. */
  pushFailed: boolean;
  /** What a push attempted right now would need to send — the same diff
   *  the debounced effect itself computes. */
  pendingPatch: () => Partial<UserProfile>;
  /** Cancel the live 700ms debounce timer, if one is armed, so it can
   *  never race this flush's own immediate attempt. */
  cancelDebounce: () => void;
  /** Attempt the push this instant, through whichever path is required
   *  (list vs scalar — the same functions the debounced effect itself
   *  calls). Resolves once settled; this function races it against the
   *  time bound, it does not invent its own retry. */
  attemptPush: () => Promise<void>;
  /** Re-read after `attemptPush` settles or times out: true when
   *  something is still dirty against the last-confirmed baseline — i.e.
   *  the account is NOT genuinely caught up. */
  stillDirty: () => boolean;
}

/**
 * ACCOUNT-SWITCH (§1bt point 3) — "flush first, warn only on failure."
 * Nothing unsynced → resolves `true` immediately (sign out proceeds with
 * no delay at all — `cancelDebounce`/`attemptPush` are never called).
 * Otherwise: cancel the debounce (so it can never fire a second, racing
 * attempt), make one bounded attempt, and report whether the account is
 * caught up afterward. A timeout is not a special case here — it simply
 * means `stillDirty()` is still checked after the SAME bound either way,
 * so a slow-but-eventually-successful push and a genuinely hung one are
 * told apart by the one signal that actually matters (did it land),
 * without this function needing its own notion of "did I time out".
 */
export async function flushBeforeSignOut(
  deps: FlushBeforeSignOutDeps,
  timeoutMs: number,
): Promise<boolean> {
  if (!deps.pushFailed && Object.keys(deps.pendingPatch()).length === 0) {
    return true;
  }
  deps.cancelDebounce();
  await raceWithTimeout(deps.attemptPush(), timeoutMs);
  return !deps.stillDirty();
}

function raceWithTimeout(promise: Promise<void>, ms: number): Promise<void> {
  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      resolve();
    };
    const timer = setTimeout(finish, ms);
    promise.then(() => {
      clearTimeout(timer);
      finish();
    }, () => {
      // attemptPush's own real implementation never rejects (every push
      // helper in this file returns a boolean, never throws) — this catch
      // exists only so a fake in a test, or a future change, cannot make
      // this function itself hang or throw past its time bound.
      clearTimeout(timer);
      finish();
    });
  });
}

/**
 * ACCOUNT-SWITCH (§1bt point 3) — the bridge `account-section.tsx` actually
 * calls. `flushBeforeSignOut` above stays pure/DI-only and testable with
 * fakes; this function supplies its REAL dependencies against whichever
 * `ProfileSync` is currently mounted (exactly one, app-wide — see this
 * file's header). If none is mounted yet (a render before the first
 * effect has run) there is nothing to flush and nothing would be lost by
 * proceeding, so this resolves `true` — sign-out must never hang on a
 * component that was never there to answer.
 */
export function requestProfileFlush(): Promise<boolean> {
  return activeFlush ? activeFlush() : Promise.resolve(true);
}

let activeFlush: (() => Promise<boolean>) | null = null;

export function ProfileSync() {
  const profile = useProfileStore((s) => s.profile);
  const isSignedInRef = useRef(false);
  const didInitialPullRef = useRef(false);
  const pullInFlightRef = useRef(false);
  // Last payload the server is known to have — the diff baseline.
  const lastPushedRef = useRef<Partial<UserProfile> | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  // ACCOUNT-SWITCH (§1bt point 4) — runSyncSerialized's own flags. Exactly
  // one ProfileSync is ever mounted (this file's own header note), so a
  // useRef here is the same singleton scope module-level state would give,
  // without widening every existing ref in this component to module scope.
  const syncInFlightRef = useRef(false);
  const syncQueuedRef = useRef(false);
  const syncCurrentRef = useRef<Promise<void> | null>(null);

  // 1. React to auth changes — pull on sign-in, reset state on sign-out.
  useEffect(() => {
    if (!supabase) {
      // No auth configured — local-only deployment, nothing will ever pull.
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
        // P4-S5b-FIX3 — a CONFIRMED sign-out (never a rejected/unresolved
        // auth check — see the `.catch()` below, which deliberately leaves
        // this untouched). Clears any previously-published id.
        useSyncGate.setState({ authUserId: null, authOutcome: "signed-out" });
        // ACCOUNT-SWITCH (§1bt.8 AMENDMENT (b)) — checked exactly here:
        // the one moment `authOutcome` becomes the CONFIRMED "signed-out"
        // value (never reached for an unresolved or rejected auth check —
        // see the `.catch()` below, same as the comment just above). A
        // forged/shared/bookmarked link cannot fake the cookie this reads
        // (only a same-origin Set-Cookie response from route.ts can set
        // it) — this is the whole fix for the fresh review's MEDIUM
        // finding; the old URL-parameter marker is gone, not merely
        // bypassed.
        if (typeof document !== "undefined") {
          processConfirmedSignOutCookie({
            cookiePresent: hasSignOutCookie(document.cookie),
            authOutcome: "signed-out",
            syncedAccountId: useProfileStore.getState().syncedAccountId,
            logOut: () => useProfileStore.getState().logOut(),
            deleteCookie: deleteSignOutCookie,
          });
        }
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
      // FAILED pull still settles, and the owner id above is already set.
      useSyncGate.setState({ authUserId: userId, authOutcome: "signed-in" });

      // ACCOUNT-SWITCH (§1bt point 1) — before today's existing
      // pull/merge/push logic runs at all, check whose data this device is
      // currently holding. A DIFFERENT real owner than last confirmed here
      // means a different person has signed in on this browser: wipe this
      // device's local profile/lastSynced FIRST (the already-shipped
      // logOut(), unchanged), so the merge below reconciles B's account
      // against a clean profile instead of A's leftovers — never against
      // A's local data, synced or not (closes the HIGH privacy leak: A's
      // unsynced topic/project/ledger entries, and even a fully-synced
      // ledger entry, must never reach B). The SAME owner, or no owner
      // recorded yet (a fresh device — §1bk's own bootstrap case), changes
      // nothing here; today's code runs exactly as it did before this item.
      if (isAccountSwitch(useProfileStore.getState().syncedAccountId, userId)) {
        useProfileStore.getState().logOut();
        // Defensive: didInitialPullRef only ever reaches this closure
        // already `true` if an EARLIER signed-in session on this same
        // mount already completed a pull — which the existing signed-out
        // branch above already resets to `false`, so a genuine switch
        // without an intervening sign-out is not a shape this codebase's
        // own auth events produce today. Resetting it here anyway costs
        // nothing on the ordinary path (it is already false) and
        // guarantees the "clean profile" reconcile below actually runs
        // even if that assumption ever stops holding.
        didInitialPullRef.current = false;
      }
      // Eager, unconditional publish — mirrors authUserId just above.
      // Records the CURRENT sign-in as this device's owner regardless of
      // whether it matched, switched, or was previously unset, so the
      // NEXT sign-in (same or different) always has a real value to
      // compare against.
      useProfileStore.getState().setSyncedAccountId(userId);

      if (didInitialPullRef.current || pullInFlightRef.current) return;
      pullInFlightRef.current = true;

      try {
        const remote = await fetchRemote();
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
          // PROFILE-SYNC (§1bk ruling 3) — "a pull that needed no push" is
          // still a confirmed sync (every dirty field already agreed with
          // the account and no list union added anything new), so it
          // advances the baselines exactly like a real push's success.
          // `nextSyncBaselines` (§1bk.9a) makes that one decision either
          // way, so it is not duplicated inline here.
          const pushed =
            Object.keys(pushPayload).length === 0 || (await pushRemote(pushPayload));
          if (pushed) {
            const baselines = nextSyncBaselines(true, merged, {
              lastSynced,
              lastPushed: lastPushedRef.current,
            });
            useProfileStore.getState().setLastSynced(baselines.lastSynced);
            lastPushedRef.current = baselines.lastPushed;
            clearProfilePushFailed();
          } else {
            // P3 — `nextSyncBaselines` is deliberately not called on this
            // path: lastSynced/lastPushedRef stay exactly as they are, so
            // the dirty fields stay dirty and the next local edit's diff
            // still includes them — the retry P3 requires, with no extra
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
  }, []);

  // 2. Push local changes to server, debounced and diffed. Only when signed
  //    in and after the initial pull has settled.
  useEffect(() => {
    if (!isSignedInRef.current || !didInitialPullRef.current) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      const payload = remoteProfilePayload(profile);
      const patch = diffPayload(payload, lastPushedRef.current);
      if (Object.keys(patch).length === 0) return;

      // LIST-REMOVAL-SYNC (§1bq.3) — only a push that carries a LIST_FIELDS
      // change pulls first: scalars are last-write-wins by design (§1bk)
      // and never merge, so pulling before an ordinary scalar-only push
      // would add a network round trip with no safety benefit. A list
      // field MERGES (three-way), so pushing this device's possibly-stale
      // copy blind can silently erase a concurrent addition from another
      // device — the lost-update race `pullMergeAndPush` exists to close.
      const carriesListChange = LIST_FIELDS.some((key) =>
        Object.prototype.hasOwnProperty.call(patch, key),
      );
      if (carriesListChange) {
        // ACCOUNT-SWITCH (§1bt point 4) — serialized: never two sync
        // sequences at once (§1bq.6(b) MEDIUM — see runSyncSerialized's
        // own doc comment for the exact race this closes).
        await runSyncSerialized(listPullDeps(lastPushedRef), {
          inFlight: syncInFlightRef,
          queued: syncQueuedRef,
          current: syncCurrentRef,
        });
        return;
      }

      if (await pushRemote(patch)) {
        // PROFILE-SYNC (§1bk ruling 3) — "after every successful push...
        // lastSynced becomes the resulting snapshot." Uses the `profile`
        // this effect closed over (the same snapshot `payload` was built
        // from), so a reload correctly remembers this push even though the
        // reconcile-cycle update in onSession only fires once, at sign-in.
        // `nextSyncBaselines` (§1bk.9a) makes the same advance-on-success
        // decision as the sign-in reconcile above, so it lives in one
        // place, not two.
        const baselines = nextSyncBaselines(true, profile, {
          lastSynced: useProfileStore.getState().lastSynced,
          lastPushed: lastPushedRef.current,
        });
        lastPushedRef.current = baselines.lastPushed;
        useProfileStore.getState().setLastSynced(baselines.lastSynced);
        clearProfilePushFailed();
      } else {
        // P3 — visible, not console-only; see useProfileSyncStatus above.
        // `nextSyncBaselines` is deliberately not called here: lastPushedRef
        // (and lastSynced) stay exactly as they are, so the next edit's
        // diff still includes this one and the retry happens naturally.
        markProfilePushFailed();
      }
    }, DEBOUNCE_MS);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [profile]);

  // 3. ACCOUNT-SWITCH (§1bt point 3) — register this mount's own flush
  // implementation for account-section.tsx's sign-out form to call through
  // requestProfileFlush(). Registered once (this component mounts exactly
  // once, app-wide — see this file's header); the function itself always
  // reads live state (useProfileStore.getState(), the refs above) at CALL
  // time, so it needs no re-registration when profile/props change.
  useEffect(() => {
    async function requestFlush(): Promise<boolean> {
      return flushBeforeSignOut(
        {
          pushFailed: useProfileSyncStatus.getState().pushFailed,
          pendingPatch: () =>
            diffPayload(remoteProfilePayload(useProfileStore.getState().profile), lastPushedRef.current),
          cancelDebounce: () => {
            if (debounceRef.current) {
              clearTimeout(debounceRef.current);
              debounceRef.current = undefined;
            }
          },
          attemptPush: async () => {
            const payload = remoteProfilePayload(useProfileStore.getState().profile);
            const patch = diffPayload(payload, lastPushedRef.current);
            const carriesListChange = LIST_FIELDS.some((key) =>
              Object.prototype.hasOwnProperty.call(patch, key),
            );
            if (carriesListChange) {
              // Same serialized path the debounced effect itself uses —
              // never races a concurrent pullMergeAndPush (§1bt point 4).
              await runSyncSerialized(listPullDeps(lastPushedRef), {
                inFlight: syncInFlightRef,
                queued: syncQueuedRef,
                current: syncCurrentRef,
              });
              return;
            }
            if (Object.keys(patch).length === 0) return; // nothing left to push
            if (await pushRemote(patch)) {
              const baselines = nextSyncBaselines(true, useProfileStore.getState().profile, {
                lastSynced: useProfileStore.getState().lastSynced,
                lastPushed: lastPushedRef.current,
              });
              lastPushedRef.current = baselines.lastPushed;
              useProfileStore.getState().setLastSynced(baselines.lastSynced);
              clearProfilePushFailed();
            } else {
              markProfilePushFailed();
            }
          },
          stillDirty: () =>
            Object.keys(
              diffPayload(remoteProfilePayload(useProfileStore.getState().profile), lastPushedRef.current),
            ).length > 0,
        },
        2000,
      );
    }
    activeFlush = requestFlush;
    return () => {
      if (activeFlush === requestFlush) activeFlush = null;
    };
  }, []);

  return null;
}

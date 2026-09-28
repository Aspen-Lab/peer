// SIGNIN-MERGE (ABC-JEV-INTEGRATION.md §1af/§1ah/§1aj) — the sign-in profile
// merge policy (ruling P1), extracted as pure functions so the actual merge
// DECISION is unit-tested directly and headlessly (this repo has no
// @testing-library/react and no test simulates a live React effect — see
// web/src/lib/dashboard/use-batch-acknowledgement.ts's own header note on the
// same convention). `web/src/components/profile-sync.tsx` calls
// `mergeProfileAtSignIn` once, at sign-in, and is a thin wrapper around it.
//
// The bug this replaces (§1af finding, §1ah root cause): the old boundary was
// `hasAnySignal({ ...local, ...remote })` — since `profileRowToProfile`
// always returns all six checked keys as OWN properties (even `undefined`
// ones), the spread always let remote's values for those keys win the
// check, so "does local have signal remote lacks" could never be answered
// truthfully. Once the check picked the "hydrate from remote" branch,
// `hydrateFromRemote` is a per-field "install if defined" — not a merge — so
// local values were overwritten by whatever the server had, even an older or
// emptier value, the moment the check happened to pick that branch for an
// unrelated field. This module replaces the boundary with a real per-field
// merge that runs every time there is a remote row to merge with.
//
// §1aj rulings applied here:
//   - list fields: union, deduped, account's own order first, then local's
//     additions.
//   - preferenceLedger: per-key union; on a shared key, keep whichever
//     entry's timestamp is genuinely more recent, else local.
//   - single-value fields: non-empty beats empty; on a genuine conflict
//     (both sides non-empty and different) at this first post-sign-in
//     merge, local wins once — the person is actively using this browser.
//     Ordinary last-write-wins sync resumes after this one reconciliation.
//   - never overwrite a non-empty local value with an empty remote one.
//   - feedIntent is recomputed from the merged flat fields rather than
//     merged as a nested structure (avoids a stale cross-reference between,
//     e.g., a freshly-merged researchTopics and an un-merged old
//     feedIntent.requiredConcepts) — see the note on `patch.feedIntent`
//     below.
//
// Scope note (recorded, not hidden): the ruling's own single-value-field
// enumeration is "currentProject, currentChallenges, displayName,
// careerStage, industryVsAcademia, school, phdYear, advisorName,
// colorTheme, digestHourLocal/Timezone/Channel/Frequency/Email" — the paper
// feed-tuning knobs (feedFocus, feedFreshness, paperCount, feedSourceMix,
// feedImportance, feedMethodMode, feedDiscoveryMode, feedAvoidReviews/
// OldPapers/BroadSurveys, deepReportEnabled) are not in that list and are
// left to their existing behaviour (untouched by this module — the
// pre-existing `hydrateFromRemote` "install if defined" wins for those, same
// as before this fix). Credentials (tavily*/adzuna*/usajobs*/feedAi*) are
// never read from `remote` at all — the server never returns them (see
// route.ts's `profileRowToProfile`) — so they are structurally excluded
// here, matching the binding "never part of any merge direction".

import type { PreferenceLedger, PreferenceLedgerEntry, UserProfile } from "@/types";
import { cleanPreferenceLedger } from "@/lib/preferences/ledger";

/** §1aj — union, deduped, account order first then local additions. */
const LIST_FIELDS = [
  "researchTopics",
  "softTopics",
  "preferredMethods",
  "locationPreferences",
  "authorisedCountries",
  "dislikedTopics",
  "preferredJournals",
] as const;

/** §1aj — non-empty beats empty; local wins once on a genuine conflict. */
const SINGLE_VALUE_FIELDS = [
  "currentProject",
  "currentChallenges",
  "displayName",
  "careerStage",
  "industryVsAcademia",
  "school",
  "phdYear",
  "advisorName",
  "colorTheme",
  "digestHourLocal",
  "digestTimezone",
  "digestChannel",
  "digestFrequency",
  "digestEmail",
] as const;

type ListField = (typeof LIST_FIELDS)[number];
type SingleValueField = (typeof SINGLE_VALUE_FIELDS)[number];

/** The flat fields `profileFeedIntentCard` (lib/feed/intent.ts) recomputes
 *  `feedIntent` from when `feedIntent` itself is undefined. Merging any of
 *  these means the old `feedIntent` (either side's) is no longer trustworthy
 *  and must be recomputed, never carried over as-is. */
const INTENT_LIST_FIELDS = new Set<ListField>([
  "researchTopics",
  "softTopics",
  "dislikedTopics",
  "preferredMethods",
]);
const INTENT_SINGLE_FIELDS = new Set<SingleValueField>([
  "currentProject",
  "currentChallenges",
]);

export interface ProfileMergeOutcome {
  /**
   * Fields to install on the local profile, exactly as given — including an
   * explicit `feedIntent: undefined` when present, which callers must apply
   * as a real assignment (e.g. `{ ...profile, ...patch }`), not the
   * `if (value !== undefined) install` pattern `hydrateFromRemote` uses
   * elsewhere, or the clear would be silently skipped.
   */
  patch: Partial<UserProfile>;
}

function isEmptyValue(value: unknown): boolean {
  if (value === undefined || value === null) return true;
  if (typeof value === "string") return value.trim() === "";
  return false;
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string")
    : [];
}

/** Union, deduped case-insensitively, account's own order first, then local's
 *  additions — mirrors the dedupe convention already used for
 *  `authorisedCountries` in `migrateProfileStore` (store/profile.ts). */
function unionStrings(remoteList: unknown, localList: unknown): string[] {
  const remote = asStringArray(remoteList);
  const local = asStringArray(localList);
  const seen = new Set(remote.map((entry) => entry.trim().toLocaleLowerCase()));
  const additions: string[] = [];
  for (const entry of local) {
    const key = entry.trim().toLocaleLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    additions.push(entry);
  }
  return [...remote, ...additions];
}

function mergeSingleValue(
  remoteValue: unknown,
  localValue: unknown,
): unknown {
  // Never overwrite a non-empty local value with an empty remote one — this
  // covers both "remote omitted the field" and "remote explicitly holds an
  // empty string", the same way for both.
  if (isEmptyValue(remoteValue)) return localValue;
  if (isEmptyValue(localValue)) return remoteValue;
  if (remoteValue === localValue) return remoteValue;
  // Both sides hold a real, different value: a genuine conflict. Local wins
  // ONCE, on this first post-sign-in reconciliation — the person is actively
  // using this browser right now. Ordinary last-write-wins debounced sync
  // resumes for every edit after this.
  return localValue;
}

function ledgerEntryTimestamp(entry: PreferenceLedgerEntry): number | null {
  const stamps = [entry.lastSeenAt, entry.lastPositiveAt, entry.lastNegativeAt, entry.lastFacetAt]
    .filter((value): value is string => typeof value === "string")
    .map((value) => Date.parse(value))
    .filter((time) => Number.isFinite(time));
  return stamps.length > 0 ? Math.max(...stamps) : null;
}

/** On overlap, keep the entry with the more recent timestamp IF the two are
 *  genuinely comparable; otherwise (a tie, or either side missing a usable
 *  timestamp) keep local — the same "local is the safe default" direction
 *  every other rule in this module takes. */
function mergeLedgerEntry(
  remoteEntry: PreferenceLedgerEntry,
  localEntry: PreferenceLedgerEntry,
): PreferenceLedgerEntry {
  const remoteAt = ledgerEntryTimestamp(remoteEntry);
  const localAt = ledgerEntryTimestamp(localEntry);
  if (remoteAt !== null && localAt !== null && remoteAt > localAt) return remoteEntry;
  return localEntry;
}

/** Per-key union of the preference ledger — never a wholesale replace. */
export function mergePreferenceLedger(
  remote: PreferenceLedger | null | undefined,
  local: PreferenceLedger | null | undefined,
): PreferenceLedger {
  const remoteClean = cleanPreferenceLedger(remote);
  const localClean = cleanPreferenceLedger(local);
  const merged: PreferenceLedger = { ...remoteClean };
  for (const [key, localEntry] of Object.entries(localClean)) {
    const remoteEntry = merged[key];
    merged[key] = remoteEntry ? mergeLedgerEntry(remoteEntry, localEntry) : localEntry;
  }
  return merged;
}

/**
 * The sign-in reconciliation merge (P1). Called once, at sign-in, with the
 * local (pre-sign-in, possibly-just-restored-from-localStorage) profile and
 * whatever `GET /api/profile` returned (`null` when the pull failed OR the
 * account genuinely has no row yet — both cases are handled identically and
 * safely below: local is never destroyed either way, see the early return).
 */
export function mergeProfileAtSignIn(
  local: UserProfile,
  remote: Partial<UserProfile> | null,
): ProfileMergeOutcome {
  if (!remote) {
    // P3 — a failed or empty pull may never shrink local data. There is
    // nothing to merge FROM; local stays exactly as it is and the caller is
    // free to push it up (safe either way: pushing can only ADD to the
    // account, never destroy anything locally).
    return { patch: {} };
  }

  const patch: Partial<UserProfile> = {};
  let touchedIntentInputs = false;

  for (const key of LIST_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(remote, key)) continue;
    (patch as Record<string, unknown>)[key] = unionStrings(remote[key], local[key]);
    if (INTENT_LIST_FIELDS.has(key)) touchedIntentInputs = true;
  }

  for (const key of SINGLE_VALUE_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(remote, key)) continue;
    (patch as Record<string, unknown>)[key] = mergeSingleValue(remote[key], local[key]);
    if (INTENT_SINGLE_FIELDS.has(key)) touchedIntentInputs = true;
  }

  if (Object.prototype.hasOwnProperty.call(remote, "preferenceLedger")) {
    patch.preferenceLedger = mergePreferenceLedger(remote.preferenceLedger, local.preferenceLedger);
  }

  if (touchedIntentInputs) {
    // §4a — recompute from the merged flat fields rather than merge the
    // nested structure; see this file's header note.
    patch.feedIntent = undefined;
  }

  return { patch };
}

// ── P4 — "Restore from a backup file" (§1af/§4b/§1aj) ─────────────────────
//
// A DIFFERENT merge direction from P1 above, by explicit ruling: "backup
// wins single values, union lists" — restoring a file is a deliberate,
// one-time user action naming exactly what they want back, so (unlike P1's
// sign-in reconciliation) there is no "local wins once" conflict rule for
// scalars here. Lists still union, for the same "never silently discard"
// reason as every other rule in this module — a backup taken weeks ago
// must not erase a topic the reader has added since.

/** The six fields §1aj names as "credential-like" — never restored, never
 *  imported, never pushed, under any circumstance. Checked again by test
 *  against the full merge output, not just at this one call site. */
const CREDENTIAL_LIKE_FIELDS = [
  "tavilyApiKey",
  "adzunaAppId",
  "adzunaAppKey",
  "usajobsApiKey",
  "usajobsUserAgent",
  "feedAiApiKey",
] as const;

/** The explicit strip step the guide requires between parsing a backup file
 *  and installing anything from it — `defaultProfile` (and therefore
 *  `parseExportedProfile`'s own allow-list) still carries these six fields
 *  from the removed events/jobs era, so a raw restore would let them back
 *  in unless this runs first. */
export function stripCredentialFields(
  document: Partial<UserProfile>,
): Partial<UserProfile> {
  const clean: Record<string, unknown> = { ...document };
  for (const field of CREDENTIAL_LIKE_FIELDS) delete clean[field];
  return clean as Partial<UserProfile>;
}

export interface BackupRestoreOutcome {
  /** Fields to install on the local profile — same "install exactly as
   *  given, including an explicit feedIntent: undefined" contract as
   *  `ProfileMergeOutcome.patch` above. */
  patch: Partial<UserProfile>;
  /** How many distinct fields the backup actually contributed — the ONLY
   *  thing the restore control's "what was restored" line may show (a
   *  count, never field names, values, or file contents — §1af binding). */
  restoredFieldCount: number;
}

/**
 * Merges a parsed, already-format-validated backup document (the output of
 * `parseExportedProfile`, store/profile.ts) into the current local profile.
 * Never called with a raw/un-parsed file, and never a substitute for
 * stripping credentials at the call site too — this function strips them
 * again itself, so it is safe even if a future caller forgets.
 */
export function mergeProfileFromBackup(
  local: UserProfile,
  backup: Partial<UserProfile>,
): BackupRestoreOutcome {
  const safeBackup = stripCredentialFields(backup);
  const localRecord = local as unknown as Record<string, unknown>;
  const patch: Partial<UserProfile> = {};
  let restoredFieldCount = 0;
  let touchedIntentInputs = false;

  for (const [key, value] of Object.entries(safeBackup)) {
    if (value === undefined) continue;
    if (key === "feedIntent") {
      // Recomputed fresh below, same reasoning as P1's §4a note — never
      // carried over as a potentially stale nested structure from a backup
      // that may be weeks old.
      continue;
    }
    if ((LIST_FIELDS as readonly string[]).includes(key)) {
      (patch as Record<string, unknown>)[key] = unionStrings(value, localRecord[key]);
    } else if (key === "preferenceLedger") {
      patch.preferenceLedger = mergePreferenceLedger(
        value as PreferenceLedger,
        local.preferenceLedger,
      );
    } else {
      // Backup wins outright for every other (scalar, or legacy/local-only
      // array) field it names — §1aj P4.
      (patch as Record<string, unknown>)[key] = value;
    }
    if (
      (INTENT_LIST_FIELDS as Set<string>).has(key) ||
      (INTENT_SINGLE_FIELDS as Set<string>).has(key)
    ) {
      touchedIntentInputs = true;
    }
    restoredFieldCount += 1;
  }

  if (touchedIntentInputs) patch.feedIntent = undefined;

  return { patch, restoredFieldCount };
}

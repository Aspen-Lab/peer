"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";
import type {
  Paper,
  Event,
  Job,
  ItemFeedback,
  OpportunityFacetCounts,
  UserProfile,
} from "@/types";
// Mock fixtures kept for use in unit tests / Storybook only — never wired
// into the live feed. Pre-2026-04-28 the store used `mockPapers` as a
// fallback when the real API returned 0 results, which silently surfaced
// battery-research demo data as the user's feed. Removed.
import { apiFetch, ApiError } from "@/lib/api";
import { useProfileStore } from "@/store/profile";
// P4-S5b-FIX2/FIX3 (Round 3) — read-only use of profile-sync.tsx's exported
// auth signals (see resolveOwnerKeyForLoad below): `settled` (FIX2,
// unchanged here) plus `authUserId`/`authOutcome` (FIX3 — published as soon
// as the auth check itself resolves, before the profile pull starts). This
// file only reads them; profile-sync.tsx is edited by the FIX3 slice
// directly (a separate file in the same change), not through this import.
import { useSyncGate } from "@/components/profile-sync";
import { scoredItemToPaper } from "@/lib/feed/mapper";
import { feedsUseAi, hasUserLlmOverride } from "@/lib/feed/ai-tier";
import { aiAvailability } from "@/lib/feed/ai-tier";
import { entitlementGrants, type ClientEntitlement } from "@/lib/entitlement/allowance";
import type { FeedResponse, FeedMeta } from "@/lib/feed/types";
import { localCalendarDate } from "@/lib/local-calendar-date";
import {
  browserFeedIntentCard,
  serializeFeedIntent,
} from "@/lib/feed/intent";
import type { EventsFeedResponse } from "@/lib/events/types";
import type { JobsFeedResponse } from "@/lib/jobs/types";
import {
  DEFAULT_OPPORTUNITY_TOP_N,
  emptyOpportunityFacetCounts,
} from "@/lib/opportunities/facets";
import {
  feedbackSnapshotForEvent,
  feedbackSnapshotForJob,
  feedbackSnapshotForPaper,
} from "@/lib/preferences/ledger";

// ── Cloud-sync helpers (fire-and-forget) ────────────────────────
// All writes are optimistic: local state already changed before we call
// these. Failures are logged but never block the UI.

type ItemKind = "paper" | "event" | "job";
type CompletionKey = "appliedAt" | "registeredAt" | "submittedAt";

const COMPLETION_KEYS: CompletionKey[] = [
  "appliedAt",
  "registeredAt",
  "submittedAt",
];

function payloadTimestamp(
  payload: unknown,
  key: CompletionKey,
): string | undefined {
  if (!payload || typeof payload !== "object") return undefined;
  const value = (payload as Record<string, unknown>)[key];
  if (typeof value !== "string" || !value.trim()) return undefined;
  return Number.isFinite(Date.parse(value)) ? value : undefined;
}

function withCompletionPayload<T extends object>(
  item: T,
  completion: Partial<Record<CompletionKey, string | undefined>>,
): T {
  const payload = { ...item } as T & Partial<Record<CompletionKey, string>>;
  for (const key of COMPLETION_KEYS) {
    if (!(key in completion)) continue;
    const value = completion[key];
    if (value) payload[key] = value;
    else delete payload[key];
  }
  return payload;
}

function completionMap<TItem extends { id: string }>(
  items: TItem[],
  key: CompletionKey,
): Record<string, string> {
  const entries: Record<string, string> = {};
  for (const item of items) {
    const timestamp = payloadTimestamp(item, key);
    if (timestamp) entries[item.id] = timestamp;
  }
  return entries;
}

async function cloudSave(itemId: string, itemKind: ItemKind, payload: unknown) {
  try {
    await apiFetch("/api/saved", {
      method: "POST",
      body: JSON.stringify({ itemId, itemKind, payload }),
    });
  } catch (err) {
    console.warn("[feed] cloudSave failed", err);
  }
}

async function cloudUnsave(itemId: string) {
  try {
    await apiFetch(`/api/saved?itemId=${encodeURIComponent(itemId)}`, {
      method: "DELETE",
    });
  } catch (err) {
    console.warn("[feed] cloudUnsave failed", err);
  }
}

async function cloudMarkRead(itemId: string) {
  try {
    await apiFetch("/api/read", {
      method: "POST",
      body: JSON.stringify({ itemId }),
    });
  } catch (err) {
    console.warn("[feed] cloudMarkRead failed", err);
  }
}

async function cloudMarkUnread(itemId: string) {
  try {
    await apiFetch(`/api/read?itemId=${encodeURIComponent(itemId)}`, {
      method: "DELETE",
    });
  } catch (err) {
    console.warn("[feed] cloudMarkUnread failed", err);
  }
}

async function cloudFeedback(
  itemId: string,
  itemKind: ItemKind,
  feedback: ItemFeedback,
  payload?: unknown,
) {
  try {
    await apiFetch("/api/feedback", {
      method: "POST",
      body: JSON.stringify({ itemId, itemKind, feedback, payload }),
    });
  } catch (err) {
    console.warn("[feed] cloudFeedback failed", err);
  }
}

// Recently-shown tracking.
//
// Rule: a paper that's already been surfaced in this user's feed shouldn't
// re-appear in subsequent loads for a while. We persist a {id -> timestamp}
// map in localStorage (via zustand persist), expire entries after 14 days,
// and pass the active IDs as `excludeIds` to the API. The pipeline filters
// those out AFTER scoring so we always return a full topN of fresh items.
//
// 14 days keeps the next two weeks of daily digests free of repeats while
// still allowing genuinely relevant older papers to surface eventually if
// the user's interests shift.
const RECENTLY_SHOWN_TTL_MS = 14 * 24 * 60 * 60 * 1000;
const RECENTLY_SHOWN_CAP = 1000;

function pruneRecentlyShown(
  map: Record<string, number>,
): Record<string, number> {
  const cutoff = Date.now() - RECENTLY_SHOWN_TTL_MS;
  const entries = Object.entries(map).filter(([, ts]) => ts >= cutoff);
  if (entries.length <= RECENTLY_SHOWN_CAP) return Object.fromEntries(entries);
  // Trim oldest first when we're over cap.
  entries.sort((a, b) => b[1] - a[1]);
  return Object.fromEntries(entries.slice(0, RECENTLY_SHOWN_CAP));
}

function dismissedOpportunityIds(
  feedbackById: Record<string, ItemFeedback>,
): Set<string> {
  return new Set(
    Object.entries(feedbackById)
      .filter(([, feedback]) => feedback === "notInterested")
      .map(([id]) => id),
  );
}

function activeRecentlyShownIds(map: Record<string, number>): string[] {
  const cutoff = Date.now() - RECENTLY_SHOWN_TTL_MS;
  return Object.entries(map)
    .filter(([, ts]) => ts >= cutoff)
    .map(([id]) => id);
}

// Device-local "delivered" memory (P4-S5b — ABC-JEV-INTEGRATION.md §1p.C.1,
// manager refinement 2026-09-24; namespaced per owner by P4-S5b-FIX Round 3,
// closing docs/jev-abc/P4-S5b-A-20260924T095305Z.md finding (b) — see
// deliveredLocalByOwner's own doc comment on FeedState below). For a
// batchless response (renderedBatchId null: signed out, or signed in with
// PEER_DASHBOARD_LEDGER off) there is no server ledger, so this is the whole
// delivery memory that exists — weaker than the signed-in permanent ledger
// (single device, cleared with browser storage, no cross-device sync, and
// identity is just the item id the client already has, so a cross-source
// duplicate of an already-delivered paper can slip through under a
// different id — an accepted, honestly-described limitation, not something
// this slice can fix without server changes). Unlike RECENTLY_SHOWN_* above,
// it has NO time-based expiry: a paper delivered a year ago must stay
// excluded exactly as much as one delivered yesterday. The only bound is
// size — and, as of P4-S5b-FIX, that bound applies PER OWNER.
const DELIVERED_LOCAL_CAP = 5000;
// Matches the server's own request cap (web/src/app/api/feed/route.ts's
// parseExcludeIds) so nothing the client prioritizes gets reordered by a
// server-side slice — the server just takes the first 800 ids it is given.
const DELIVERED_EXCLUDE_SEND_CAP = 800;
// P4-S5b-FIX (Round 3) — ABC-JEV-INTEGRATION.md §1c, closing finding (b):
// how many distinct owner namespaces this device keeps at once. Unbounded
// namespaces would let a public/shared machine accumulate one map per
// visitor forever; 5 (the manager's own example figure, "the 5 most
// recently active") comfortably covers one person's own multi-account use
// (e.g. a personal + a lab account) while still bounding a genuinely shared
// device. The LEAST recently active namespace is evicted first — its
// history is lost, not merged or guessed at, when a 6th owner becomes
// active (see touchDeliveredLocalOwner below).
const MAX_DELIVERED_LOCAL_OWNERS = 5;
// The namespace used for every signed-out visit AND for any pre-P4-S5b-FIX
// history this device cannot reliably attribute to one real account (see
// `migrate` below) — never a real signed-in user's own bucket.
const ANONYMOUS_OWNER_KEY = "anonymous";

function pruneDeliveredLocal(
  map: Record<string, string>,
): Record<string, string> {
  const entries = Object.entries(map);
  if (entries.length <= DELIVERED_LOCAL_CAP) return map;
  // No TTL to fall back on — the cap alone decides what survives. Newest
  // local-date first; entries beyond the cap (the oldest) are dropped. This
  // is the honest bound on "no TTL": permanent, but not unbounded.
  entries.sort((a, b) => (a[1] < b[1] ? 1 : a[1] > b[1] ? -1 : 0));
  return Object.fromEntries(entries.slice(0, DELIVERED_LOCAL_CAP));
}

// Ids delivered strictly BEFORE `today` — today's own renders are never
// excluded from today's own reloads (this slice's manager refinement: same-
// day stability, no rotation), ordered most-recent-first so a size-capped
// send keeps the freshest exclusions first.
function deliveredBeforeLocalDate(
  map: Record<string, string>,
  today: string,
): string[] {
  return Object.entries(map)
    .filter(([, date]) => date < today)
    .sort((a, b) => (a[1] < b[1] ? 1 : a[1] > b[1] ? -1 : 0))
    .map(([id]) => id);
}

// P4-S5b-FIX (Round 3) — ABC-JEV-INTEGRATION.md §1c, closing
// docs/jev-abc/P4-S5b-A-20260924T095305Z.md finding (b): "deliveredLocal is
// one unnamespaced, account-agnostic map that survives sign-out, so a
// shared device leaks and misapplies delivery history across accounts."
//
// The owner id this device is CURRENTLY acting as, for the sole purpose of
// picking which deliveredLocalByOwner namespace to read/write. Sourced from
// the SAME already-resolved `entitlement.userId` every other company-
// funded/AI-tier gate in this file already reads synchronously via
// `useProfileStore.getState().entitlement` (see loadFeed's fetchRealFeed
// call, unchanged) — not a new dependency, not edited here. That field is
// populated by ProfileSync (web/src/components/profile-sync.tsx, NOT part
// of this fix) from `GET /api/profile` on sign-in, and reset synchronously
// to the frozen anonymous default on sign-out. Both "signed out" and "not
// resolved yet" (a real, already-accepted staleness window shared with
// every other entitlement read in this file — see loadFeed's own doc
// comment above) read as ANONYMOUS_OWNER_KEY: the safe direction, since it
// can only land a read/write in the anonymous bucket, never cross into a
// different real signed-in owner's namespace.
function currentOwnerKey(): string {
  return useProfileStore.getState().entitlement?.userId ?? ANONYMOUS_OWNER_KEY;
}

// P4-S5b-FIX2 (Round 3) — ABC-JEV-INTEGRATION.md §1g/§1c, closing the
// auth-loading-window re-delivery risk found by
// docs/jev-abc/P4-S5b-FIX-A-20260924T103406Z.md NEW FINDINGS #1:
// `currentOwnerKey()` above cannot distinguish "signed in, but `entitlement`
// has not resolved yet" from "confirmed signed out" — both read as
// ANONYMOUS_OWNER_KEY, because `entitlement` is `null` in both cases until
// ProfileSync's async chain (a real network round trip on sign-in) settles.
//
// P4-S5b-FIX3 (Round 3) — ABC-JEV-INTEGRATION.md §4 "P4-S5b-FIX3 ruled and
// assigned", closing two findings from fresh A's review of FIX2
// (docs/jev-abc/P4-S5b-FIX2-A-20260924T111516Z.md): (NEW FINDING #1) FIX2
// gated page.tsx's auto-load on `settled` alone — i.e. the PROFILE PULL
// finishing — which has no timeout anywhere (web/src/lib/api.ts's apiFetch),
// so a hanging pull could block the feed from ever auto-loading. (NEW
// FINDING #2) a FAILED (not merely pending) profile pull also settles
// `true` with `entitlement` staying `null` forever that session, which
// FIX2's settled-only check could not tell apart from confirmed
// signed-out, so a real signed-in user's own delivered-before-today history
// silently stopped being excluded. Both close by using a signal that
// resolves EARLIER and MORE PRECISELY than `settled`: profile-sync.tsx's
// `authUserId`/`authOutcome`, published the moment the auth check itself
// (`getUser()`/`onAuthStateChange`) resolves — before the profile pull (the
// thing `settled` waits for) even starts.
//
// Priority, matching the binding ruling exactly: (1) a real, already-
// resolved `entitlement.userId` (via `currentOwnerKey()` above) — the
// richest source once the profile pull itself has succeeded, never a guess.
// (2) failing that, the confirmed auth user id (`authUserId`) — correct
// even while the pull is still pending, hanging, or has failed outright
// (NEW FINDING #2, above). (3) `ANONYMOUS_OWNER_KEY` ONLY once the auth
// check itself has confirmed either a real sign-out or that Supabase auth
// is not configured at all (`authOutcome === "signed-out" | "unconfigured"`).
// (4) otherwise `null` ("this load does not know its owner yet") — covers
// the auth check still being in flight AND a REJECTED `getUser()` (unknown,
// never signed-out, per the ruling). `loadFeed` below treats `null` as: arm
// nothing, touch no namespace, and read the UNION of every owner namespace
// this device already has (see `unionDeliveredLocal`) rather than nothing
// at all — the safe direction either way (ABC-JEV-INTEGRATION.md §1p.A: "a
// false exclusion loses one candidate, a false re-delivery breaks the
// user's hard rule"). The page's own auto-load effect (web/src/app/page.tsx)
// waits for the auth outcome to be known, with a bounded fallback, before
// calling `loadFeed` at all — so a `null` here should only occur during
// that bounded fallback window, or for an explicit/early call.
function resolveOwnerKeyForLoad(): string | null {
  const ownerKey = currentOwnerKey();
  if (ownerKey !== ANONYMOUS_OWNER_KEY) return ownerKey;
  const auth = useSyncGate.getState();
  if (auth.authUserId) return auth.authUserId;
  return auth.authOutcome === "signed-out" || auth.authOutcome === "unconfigured"
    ? ANONYMOUS_OWNER_KEY
    : null;
}

// P4-S5b-FIX3 (Round 3) — ABC-JEV-INTEGRATION.md §4 "P4-S5b-FIX3 ruled and
// assigned", item (4): when `resolveOwnerKeyForLoad` returns `null` (this
// load's real owner is not yet known), reading NOTHING would silently widen
// what can be re-shown beyond what FIX/FIX2 already guaranteed for every
// other case. Instead, fold every owner namespace this DEVICE already has
// into one map, so the load can still exclude everything any account that
// has ever used this device has already seen — deliberately broader than
// any single owner's own history. Accepted cost (named in the ruling): on a
// shared device, in this rare unknown-owner window, one account's seen
// papers can be withheld from a DIFFERENT account for that one load; never
// the reverse — nothing is ever under-excluded relative to the normal
// per-owner path. Never called with a resolved owner key; never writes
// anything (a read-only fold of already-persisted data, no `set()` call).
//
// Deterministic: owners are folded in `order` (deliveredLocalOwnerOrder —
// the store's own canonical most-recently-active-first list, not
// `Object.keys(byOwner)`, whose iteration order is incidental). When the
// SAME paper id appears under more than one owner (a genuinely shared
// device), the MORE RECENT of the two delivery dates wins, so the merged
// entry sorts where it truly belongs once `deliveredBeforeLocalDate` (below,
// reused unchanged) orders the result most-recent-first for the existing
// 800-id send cap; ties (the exact same date from two owners) keep whichever
// owner's entry was folded in first, i.e. the more-recently-active owner —
// still fully deterministic, just not independently meaningful since the
// date is already identical either way.
function unionDeliveredLocal(
  order: string[],
  byOwner: Record<string, Record<string, string>>,
): Record<string, string> {
  const merged: Record<string, string> = {};
  for (const ownerKey of order) {
    const ownerMap = byOwner[ownerKey];
    if (!ownerMap) continue;
    for (const [id, date] of Object.entries(ownerMap)) {
      const existing = merged[id];
      if (!existing || date > existing) merged[id] = date;
    }
  }
  return merged;
}

// P4-S5b-FIX (Round 3) — the one place that moves an owner to the front of
// the MRU order and enforces MAX_DELIVERED_LOCAL_OWNERS. Bounds the STORED
// data (byOwner), not just the order list — an evicted owner's namespace is
// dropped outright, not merely unreferenced, so it cannot silently persist
// forever. Guarantees `byOwner[ownerKey]` exists on return (an empty map for
// a brand-new owner) so every caller can read it unconditionally.
function touchDeliveredLocalOwner(
  order: string[],
  byOwner: Record<string, Record<string, string>>,
  ownerKey: string,
): { order: string[]; byOwner: Record<string, Record<string, string>> } {
  const nextOrder = [
    ownerKey,
    ...order.filter((key) => key !== ownerKey),
  ].slice(0, MAX_DELIVERED_LOCAL_OWNERS);
  const kept = new Set(nextOrder);
  const nextByOwner: Record<string, Record<string, string>> = {};
  for (const key of Object.keys(byOwner)) {
    if (kept.has(key)) nextByOwner[key] = byOwner[key];
  }
  if (!nextByOwner[ownerKey]) nextByOwner[ownerKey] = {};
  return { order: nextOrder, byOwner: nextByOwner };
}

const SEED_REFRESH_MS = 30 * 24 * 60 * 60 * 1000; // monthly

// Ensure advisor discovery seeds are present and fresh (recomputed at most
// monthly). Returns the seeds to use for this request; persists fresh ones to
// the profile store so the next load reuses them.
async function ensureAdvisorSeeds(
  profile: UserProfile,
): Promise<{ seedTexts: string[]; seedWorkIds: string[] }> {
  const authorId = profile.advisorAuthorId;
  if (!authorId) return { seedTexts: [], seedWorkIds: [] };

  const cachedTexts = profile.advisorSeedTexts ?? [];
  const cachedIds = profile.advisorSeedWorkIds ?? [];
  const refreshedAt = profile.advisorSeedsRefreshedAt
    ? new Date(profile.advisorSeedsRefreshedAt).getTime()
    : 0;
  const fresh = cachedTexts.length > 0 && Date.now() - refreshedAt < SEED_REFRESH_MS;
  if (fresh) return { seedTexts: cachedTexts, seedWorkIds: cachedIds };

  try {
    const params = new URLSearchParams({ authorId });
    const projectText = [profile.currentProject, profile.currentChallenges]
      .filter(Boolean)
      .join("\n");
    if (projectText) params.set("project", projectText);
    const data = await apiFetch<{ workIds?: string[]; texts?: string[] }>(
      `/api/affiliation/seeds?${params}`,
      { cache: "no-store" },
    );
    if (data.texts && data.texts.length > 0) {
      useProfileStore.getState().setAdvisorSeeds({
        workIds: data.workIds ?? [],
        texts: data.texts,
      });
      return { seedTexts: data.texts, seedWorkIds: data.workIds ?? [] };
    }
  } catch {
    // Network/API hiccup — fall back to whatever's cached (possibly empty).
  }
  return { seedTexts: cachedTexts, seedWorkIds: cachedIds };
}

function activeSurfaceTopics(
  profile: UserProfile,
  surface: "papers" | "events" | "jobs",
) {
  const activeTopics = profile.activeSearchInputs?.[surface];
  return {
    topics: (activeTopics?.required ?? []).filter(Boolean),
    softTopics: (activeTopics?.explore ?? []).filter(Boolean),
  };
}

function activePaperIntent(profile: UserProfile) {
  const { topics, softTopics } = activeSurfaceTopics(profile, "papers");
  return browserFeedIntentCard({
    project: profile.currentProject,
    challenge: profile.currentChallenges,
    topics,
    softTopics,
    methods: profile.preferredMethods,
    negativeTopics: profile.dislikedTopics,
    selectedSenseConcepts: profile.selectedSenseConcepts,
  });
}

export function activePaperTopicsKey(profile: UserProfile): string {
  const intent = activePaperIntent(profile);
  return intent ? serializeFeedIntent(intent) : "";
}

export function paperFeedRequestBody(
  profile: UserProfile,
  advisorSeeds: { seedTexts: string[]; seedWorkIds: string[] },
  aiPaperSearchEnabled = false,
  excludeIds: string[] = [],
  entitlement: ClientEntitlement | null = null,
): Record<string, unknown> {
  const { topics, softTopics } = activeSurfaceTopics(profile, "papers");
  const seedTexts = [
    profile.currentProject,
    profile.currentChallenges,
    ...advisorSeeds.seedTexts,
  ].filter((s): s is string => Boolean(s && s.trim().length > 0));
  const negativeTopics = (profile.dislikedTopics ?? []).filter(
    (s) => s.trim().length > 0,
  );
  const preferenceLedger = profile.preferenceLedger ?? {};
  const project = profile.currentProject?.trim() || undefined;
  const challenge = profile.currentChallenges?.trim() || undefined;
  const intent = activePaperIntent(profile);
  const feedAiApiKey = profile.feedAiApiKey?.trim();
  const aiMode = aiAvailability(profile, entitlementGrants(entitlement));
  const paperAiAvailable = aiPaperSearchEnabled && aiMode !== "none";
  const useOwnKey = aiPaperSearchEnabled && aiMode === "byok";

  return {
    topics,
    softTopics: softTopics.length > 0 ? softTopics : undefined,
    project,
    challenge,
    intent,
    methods: profile.preferredMethods,
    // Preferred journals double as a primary source filter (venue search)
    // and earn a relevance boost in the pipeline (see applyJournalBoost).
    venues:
      (profile.preferredJournals ?? []).length > 0
        ? profile.preferredJournals
        : undefined,
    seedTexts: seedTexts.length > 0 ? seedTexts : undefined,
    preferenceLedger:
      Object.keys(preferenceLedger).length > 0 ? preferenceLedger : undefined,
    negativeTopics: negativeTopics.length > 0 ? negativeTopics : undefined,
    // Advisor citation-neighborhood discovery (new external work building on
    // the advisor's seeds). Only sent once an advisor has been confirmed.
    affiliation:
      profile.advisorAuthorId && advisorSeeds.seedWorkIds.length > 0
        ? {
            authorId: profile.advisorAuthorId,
            seedWorkIds: advisorSeeds.seedWorkIds,
          }
        : undefined,
    topN: profile.paperCount,
    aiTier: paperAiAvailable ? 2 : 0,
    // NO `searchConnectors`. The Tavily toggle stays in the profile because
    // events and jobs still need it — their listings only exist on the open
    // web — but the paper surface has nothing left to spend it on, so it does
    // not ask for the key. `opportunityRequestBody` is where it is still sent.
    llmOverride: useOwnKey
      ? {
          provider: profile.feedAiProvider,
          apiKey: feedAiApiKey,
        }
      : undefined,
    controls: {
      focus: profile.feedFocus,
      freshness: profile.feedFreshness,
      paperCount: profile.paperCount,
      sourceMix: profile.feedSourceMix,
      importance: profile.feedImportance,
      methodMode: profile.feedMethodMode,
      discoveryMode: profile.feedDiscoveryMode,
      avoidReviews: profile.feedAvoidReviews,
      avoidOldPapers: profile.feedAvoidOldPapers,
      avoidBroadSurveys: profile.feedAvoidBroadSurveys,
    },
    excludeIds: excludeIds.length > 0 ? excludeIds : undefined,
  };
}

/**
 * P4-S5a — `papers` plus whatever batch identity the response carried.
 * `batchId`/`batchStatus` are undefined for every response that predates
 * P4-S3, is flag-off, or is signed-out — the caller treats "undefined" as
 * "no batch to track", never as an error.
 */
interface RealFeedResult {
  papers: Paper[];
  batchId?: string;
  batchStatus?: FeedMeta["batchStatus"];
}

async function fetchRealFeed(
  profile: UserProfile,
  aiPaperSearchEnabled = false,
  excludeIds: string[] = [],
  entitlement: ClientEntitlement | null = null,
): Promise<RealFeedResult> {
  if (!activePaperIntent(profile)) return { papers: [] };

  // Advisor / PI discovery seeds (recomputed monthly). Their text biases TF-IDF
  // scoring; their work IDs anchor the citation-neighborhood pull in the pipeline.
  const advisorSeeds = await ensureAdvisorSeeds(profile);
  try {
    const data = await apiFetch<FeedResponse>("/api/feed", {
      method: "POST",
      body: JSON.stringify(
        paperFeedRequestBody(
          profile,
          advisorSeeds,
          aiPaperSearchEnabled,
          excludeIds,
          entitlement,
        ),
      ),
    });
    return {
      papers: data.items.map(scoredItemToPaper),
      batchId: data.meta?.batchId,
      batchStatus: data.meta?.batchStatus,
    };
  } catch (err) {
    console.error("[feed] fetch failed:", err);
    // Rethrow so the papers lane can record it. Returning [] here made a
    // dead connection indistinguishable from "nothing new today".
    throw err;
  }
}

// Shared request-shaping for the jobs/events feeds: both routes take the
// same profile projection.
export function opportunityRequestBody(
  profile: UserProfile,
  surface: "events" | "jobs",
  excludeIds: string[],
  entitlement: ClientEntitlement | null = null,
): Record<string, unknown> {
  const { topics, softTopics } = activeSurfaceTopics(profile, surface);
  const activeInputs = profile.activeSearchInputs;
  const preferenceLedger = profile.preferenceLedger ?? {};
  const tavilyApiKey = profile.tavilyApiKey?.trim();
  const feedAiApiKey = profile.feedAiApiKey?.trim();
  // RULING 68a: these two reads were inline here and duplicated, in different
  // words, at the dashboard chip — which is how the chip came to claim a tier
  // it does not govern. Same expressions, one home. `hasUserLlmOverride` is
  // still needed separately below because it alone may send an override.
  const userLlmOverride = hasUserLlmOverride(profile);
  return {
    topics,
    softTopics: softTopics.length > 0 ? softTopics : undefined,
    methods: profile.preferredMethods,
    seedTexts: [profile.currentProject, profile.currentChallenges].filter(
      (s): s is string => Boolean(s && s.trim().length > 0),
    ),
    preferenceLedger:
      Object.keys(preferenceLedger).length > 0 ? preferenceLedger : undefined,
    careerStage: activeInputs?.careerStage,
    industryVsAcademia: profile.industryVsAcademia,
    locationPreferences: activeInputs?.locationPreferences ?? [],
    ...(surface === "jobs"
      ? { authorisedCountries: profile.authorisedCountries }
      : {}),
    currentProject: profile.currentProject,
    topN: DEFAULT_OPPORTUNITY_TOP_N,
    aiTier: feedsUseAi(profile, entitlementGrants(entitlement)) ? 2 : 0,
    searchConnectors: profile.tavilyEnabled
      ? { tavily: { enabled: true, apiKey: tavilyApiKey || undefined } }
      : undefined,
    // Bring-your-own job-source keys (ignored by the events route). Adzuna and
    // USAJobs unlock industry + US-federal research postings.
    apiKeys: {
      adzunaAppId: profile.adzunaAppId?.trim() || undefined,
      adzunaAppKey: profile.adzunaAppKey?.trim() || undefined,
      usajobsApiKey: profile.usajobsApiKey?.trim() || undefined,
      usajobsUserAgent: profile.usajobsUserAgent?.trim() || undefined,
    },
    // Unchanged: only the BYOK path may send an override. The local-developer
    // path deliberately sends none and lets the server resolve its own
    // provider, which is what keeps the key server-side.
    llmOverride: userLlmOverride
      ? { provider: profile.feedAiProvider, apiKey: feedAiApiKey }
      : undefined,
    excludeIds: excludeIds.length > 0 ? excludeIds : undefined,
  };
}

async function fetchRealEvents(
  profile: UserProfile,
  excludeIds: string[] = [],
  entitlement: ClientEntitlement | null = null,
): Promise<OpportunityClientPool<Event>> {
  if (activeSurfaceTopics(profile, "events").topics.length === 0) {
    return emptyOpportunityClientPool<Event>();
  }
  try {
    const res = await fetch("/api/events/feed", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(
        opportunityRequestBody(profile, "events", excludeIds, entitlement),
      ),
    });
    if (!res.ok) {
      console.error("[feed] /api/events/feed returned", res.status);
      return emptyOpportunityClientPool<Event>();
    }
    const data = (await res.json()) as EventsFeedResponse;
    return {
      items: data.items ?? [],
      pool: data.pool ?? data.items ?? [],
      facetCounts: data.facetCounts ?? emptyOpportunityFacetCounts(),
    };
  } catch (err) {
    console.error("[feed] events fetch failed:", err);
    return emptyOpportunityClientPool<Event>();
  }
}

async function fetchRealJobs(
  profile: UserProfile,
  excludeIds: string[] = [],
  entitlement: ClientEntitlement | null = null,
): Promise<OpportunityClientPool<Job>> {
  if (activeSurfaceTopics(profile, "jobs").topics.length === 0) {
    return emptyOpportunityClientPool<Job>();
  }
  try {
    const res = await fetch("/api/jobs/feed", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(opportunityRequestBody(profile, "jobs", excludeIds, entitlement)),
    });
    if (!res.ok) {
      console.error("[feed] /api/jobs/feed returned", res.status);
      return emptyOpportunityClientPool<Job>();
    }
    const data = (await res.json()) as JobsFeedResponse;
    return {
      items: data.items ?? [],
      pool: data.pool ?? data.items ?? [],
      facetCounts: data.facetCounts ?? emptyOpportunityFacetCounts(),
    };
  } catch (err) {
    console.error("[feed] jobs fetch failed:", err);
    return emptyOpportunityClientPool<Job>();
  }
}

interface OpportunityClientPool<TItem> {
  items: TItem[];
  pool: TItem[];
  facetCounts: OpportunityFacetCounts;
}

function emptyOpportunityClientPool<TItem>(): OpportunityClientPool<TItem> {
  return {
    items: [],
    pool: [],
    facetCounts: emptyOpportunityFacetCounts(),
  };
}

type DismissalKind = "paper" | "event" | "job";

interface PendingDismissal {
  id: string;
  kind: DismissalKind;
  item: Paper | Event | Job;
  previousFeedback?: ItemFeedback;
  wasInDisplay: boolean;
  wasInPool: boolean;
  wasSaved: boolean;
  expiresAt: number;
}

function restoreByScore<TItem extends { id: string; relevanceScore?: number }>(
  items: TItem[],
  item: TItem,
  shouldRestore: boolean,
): TItem[] {
  if (!shouldRestore || items.some((candidate) => candidate.id === item.id)) {
    return items;
  }
  return [item, ...items].sort(
    (left, right) =>
      (right.relevanceScore ?? 0) - (left.relevanceScore ?? 0),
  );
}

function syncSavedState<
  TItem extends { id: string; isSaved?: boolean; feedback?: ItemFeedback },
>(
  items: TItem[],
  savedIds: Set<string>,
  feedbackById: Record<string, ItemFeedback>,
): TItem[] {
  return items.map((item) => {
    const isSaved = savedIds.has(item.id);
    const currentFeedback = feedbackById[item.id] ?? item.feedback;
    return {
      ...item,
      isSaved,
      feedback: isSaved
        ? currentFeedback ?? ("saved" as ItemFeedback)
        : currentFeedback === "saved"
          ? undefined
          : currentFeedback,
    };
  });
}

export type FeedLane = "papers" | "events" | "jobs";

export interface FeedLoadOptions {
  /**
   * Advance novelty only for an explicit refresh/load-more action. A plain
   * page open reads a feed without mutating the recently-shown clock.
   */
  advanceHistory?: boolean;
  /**
   * Which pipelines to run. The daily surface asks for `["papers"]` only:
   * events and jobs are once-a-year needs and used to run on every home-page
   * tick, taxing the latency of the one lane that is checked every morning.
   * Omitted means all three, so existing callers keep their behaviour.
   */
  lanes?: FeedLane[];
}

interface FeedState {
  papers: Paper[];
  events: Event[];
  jobs: Job[];
  /** Full daily pools power facets without expanding the default feed slice. */
  eventPool: Event[];
  jobPool: Job[];
  eventFacetCounts: OpportunityFacetCounts;
  jobFacetCounts: OpportunityFacetCounts;
  savedPapers: Paper[];
  savedEvents: Event[];
  savedJobs: Job[];
  isLoading: boolean;
  /** Per-lane flags let papers render (and the digest start) without waiting
   * for the slower standing-opportunity lanes. */
  papersLoading: boolean;
  eventsLoading: boolean;
  jobsLoading: boolean;
  lastRefresh: string | null;
  /**
   * Why the last paper load produced nothing, when it failed rather than
   * came back empty. A network failure and a genuinely empty result used to
   * be the same `[]` — the UI then told a user with a dead connection to
   * "set up your profile", under a header reading "synced just now".
   * Transient: not persisted.
   */
  feedError: string | null;
  /** The required-topics signature the current `papers` were built from. When
   *  it diverges from the profile's topics, the feed page reloads automatically. */
  feedTopicsKey: string | null;
  aiPaperSearchEnabled: boolean;
  readItems: Record<string, true>;
  /**
   * When each paper was first marked read, as an ISO date (UTC day).
   *
   * `readItems` is a boolean set, so a reader who is not signed in has no
   * reading history at all — the calendar on the profile is drawn from
   * `/api/read`, which answers 401 without a session. Peer is a self-hosted,
   * local-first product; its own chart should not need an account. The date
   * only, not the instant: the chart buckets by day, and a day is all this
   * needs to remember.
   */
  readAt: Record<string, string>;
  appliedAt: Record<string, string>;
  registeredAt: Record<string, string>;
  submittedAt: Record<string, string>;
  paperSummaries: Record<string, string>;
  /** id -> ms timestamp. Drives the "don't repeat papers" exclude list. */
  recentlyShownIds: Record<string, number>;
  pendingDismissal: PendingDismissal | null;
  /** id -> feedback. Tracks save/like/dismiss state for any paper the user
   * has interacted with, even ones not in the current feed (e.g. searched). */
  paperFeedback: Record<string, ItemFeedback>;
  /** id -> feedback for events the user has interacted with. */
  eventFeedback: Record<string, ItemFeedback>;
  /** id -> feedback for jobs the user has interacted with. */
  jobFeedback: Record<string, ItemFeedback>;
  /**
   * P4-S5a — the current response's batch identity (ABC-JEV-INTEGRATION.md
   * §1p.C.5). Transient: re-derived on every load, never persisted — a
   * reload re-fetches and gets the same server-frozen batch back anyway.
   * Null whenever the response carried no batch (flag off, signed out, or a
   * response built before P4-S3).
   */
  batchId: string | null;
  batchStatus: FeedMeta["batchStatus"] | null;
  /**
   * P4-S5a-FIX (Round 3) — ABC-JEV-INTEGRATION.md §1p.C.5/C.7, closing
   * F-A-P4S5-01 (docs/jev-abc/P4-S5a-S3FIX-A-20260924T062754Z.md): the batch
   * identity of whatever is ACTUALLY in `papers` right now. Set in the same
   * `set()` call as `papers` itself, every time (see `papersLane` below),
   * including `null` for a batchless response (flag off, signed out, or a
   * response built before P4-S3) — never left stale. This is a NEW,
   * narrowly-purposed field, not a rename of `batchId` above: `batchId`
   * keeps its existing "last response's batch metadata" role unchanged;
   * `renderedBatchId` exists solely so `acknowledgePendingBatch` can refuse
   * to send an acknowledgment for a batch whose cards are not what's
   * currently rendered — the false-delivery risk this fix closes. UNLIKE
   * `batchId`/`batchStatus`, this IS persisted (see `partialize`): it must
   * already be correct as soon as the persisted `papers` rehydrate, before
   * the next `loadFeed`'s fetch resolves, or a legitimate retry right after
   * a reload would be needlessly delayed until that fetch completes.
   */
  renderedBatchId: string | null;
  /**
   * P4-S5a — a served/prepared batch this device has told the server it
   * rendered but has not yet had that confirmed (a 200 from
   * `POST /api/feed/ack`). Persisted (see `partialize` below) so a lost or
   * offline acknowledgment survives a reload and is retried before the next
   * feed load (ABC-JEV-INTEGRATION.md §1p.C.7: "a pending acknowledgment is
   * persisted locally and retried before the next load").
   */
  pendingBatchAck: { batchId: string; localDate: string } | null;
  /**
   * P4-S5b — ABC-JEV-INTEGRATION.md §1p.C.1 (signed-out users) plus this
   * slice's manager refinement (2026-09-24: also signed-in users while
   * `PEER_DASHBOARD_LEDGER` is off — both share the same "batchless
   * response" signal `renderedBatchId === null` already carries). The
   * device-local delivered memory itself: paper id -> the local calendar
   * date (`localCalendarDate()`, YYYY-MM-DD) it was FIRST recorded
   * delivered. No TTL, capped (per owner) at `DELIVERED_LOCAL_CAP`.
   * Persisted (see `partialize`) — that is the entire point, unlike the
   * session-scoped `recentlyShownIds` above. Weaker than the signed-in
   * permanent server ledger: single device, cleared with browser storage,
   * no cross-device sync, and identity is just the item id the client
   * already has (a cross-source duplicate of an already-delivered paper can
   * slip through under a different id) — an accepted, honestly-described
   * limitation.
   *
   * P4-S5b-FIX (Round 3) — ABC-JEV-INTEGRATION.md §1c, closing
   * docs/jev-abc/P4-S5b-A-20260924T095305Z.md finding (b): this USED TO be
   * one flat, unnamespaced `Record<string, string>` (`deliveredLocal`) that
   * survived sign-out, so a shared device leaked and misapplied one
   * account's delivery history onto the next. Namespaced by owner id
   * (`currentOwnerKey()`: the signed-in user's id, or `ANONYMOUS_OWNER_KEY`
   * when signed out) so each account gets its own memory, read/written only
   * through its own key. Bounded to `MAX_DELIVERED_LOCAL_OWNERS` distinct
   * namespaces (see `deliveredLocalOwnerOrder` below and
   * `touchDeliveredLocalOwner`) — a genuinely shared/public device cannot
   * accumulate namespaces forever. `resetLocal` (sign-out) deliberately does
   * NOT clear this map itself, only the transient `pendingLocalDelivery`
   * below — signing out never deletes ANY owner's memory, including the one
   * that just signed out; it just stops being the one read/written until
   * that owner (or another) becomes current again.
   */
  deliveredLocalByOwner: Record<string, Record<string, string>>;
  /**
   * P4-S5b-FIX (Round 3) — most-recently-active owner keys first, bounding
   * how many `deliveredLocalByOwner` namespaces this device keeps at once
   * (see `MAX_DELIVERED_LOCAL_OWNERS`/`touchDeliveredLocalOwner`). "Active"
   * means touched by a `loadFeed` read or a `recordPendingLocalDelivery`
   * write — both call `touchDeliveredLocalOwner`, which moves that owner to
   * the front and evicts whichever namespace falls out of the bound.
   * Persisted alongside `deliveredLocalByOwner` (see `partialize`) — the
   * order itself is part of what decides which namespace survives the next
   * eviction, so it must not reset to an arbitrary order on reload.
   */
  deliveredLocalOwnerOrder: string[];
  /**
   * P4-S5b — the ids from the most recent successful BATCHLESS render,
   * armed in the SAME `set()` call as `papers`/`renderedBatchId` itself
   * (`papersLane` below), awaiting the same render + visibility
   * confirmation `pendingBatchAck` uses (ABC-JEV-INTEGRATION.md §1p.C.7)
   * before they are folded into `deliveredLocalByOwner` by
   * `recordPendingLocalDelivery`. `null` whenever the last render had
   * nothing pending (a batched response, or a batchless one with zero
   * papers). Transient: NOT persisted — unlike `pendingBatchAck` there is
   * no network call to lose, so a reload simply re-arms this from whatever
   * the next load renders instead of retrying a stale value.
   *
   * P4-S5b-FIX (Round 3) — now carries `ownerKey` alongside the ids,
   * captured AT ARM TIME (inside `papersLane`'s single `set()` call) from
   * the SAME `currentOwnerKey()` value `loadFeed` used to build that load's
   * own `excludeIds` — a DESIGN CHOICE beyond finding (b)'s literal text
   * (see the checkpoint's DESIGN CHOICES section): these papers were
   * fetched respecting THAT owner's exclusion history, so that owner is who
   * the eventual delivery record belongs to. Re-resolving "whoever is
   * current" only later, when `recordPendingLocalDelivery` actually fires
   * from the hook (after mount + visibility, asynchronously), would let a
   * sign-out/sign-in race in that narrow window attribute one owner's
   * rendered papers into a DIFFERENT owner's namespace — a narrower replay
   * of the exact cross-account leak this fix exists to close.
   */
  pendingLocalDelivery: { ownerKey: string; ids: string[] } | null;

  loadFeed: (options?: FeedLoadOptions) => Promise<void>;
  /**
   * P4-S5a — POSTs `/api/feed/ack` for the current `pendingBatchAck`, if
   * any. The ONE place that ever performs that POST; both `loadFeed` (a
   * reconcile step before every new load) and `useBatchAcknowledgement` (a
   * component effect after mount, ABC-JEV-INTEGRATION.md §1p.C.7) call this
   * same action rather than each doing their own fetch. A no-op, no-fetch
   * call when nothing is pending. Concurrent calls dedupe to one in-flight
   * request (see the module-level `pendingAckInFlight` guard) so the mount
   * trigger and a reconcile racing each other never double-POST.
   *
   * P4-S5a-FIX (Round 3) — F-A-P4S5-01: also a no-op, no-fetch call
   * whenever `pendingBatchAck.batchId !== renderedBatchId` — i.e. whenever
   * the batch waiting on an acknowledgment is not the one whose cards are
   * actually in `papers` right now. Checking this HERE, in the one place
   * that ever performs the POST, is what makes "acknowledge only after the
   * batch's own cards rendered" (§1p.C.7) hold for BOTH callers above at
   * once, rather than only for whichever one remembers to check first.
   */
  acknowledgePendingBatch: () => Promise<void>;
  /**
   * P4-S5b — the ONE place that ever writes into `deliveredLocalByOwner`,
   * mirroring `acknowledgePendingBatch` being the one place that ever POSTs
   * `/api/feed/ack`. A synchronous, no-network no-op when
   * `pendingLocalDelivery` is null/empty; otherwise stamps every pending id
   * with today's local date INTO `pendingLocalDelivery.ownerKey`'s own
   * namespace only (P4-S5b-FIX, Round 3 — never the caller's current owner,
   * see that field's own doc comment for why), prunes that namespace to
   * `DELIVERED_LOCAL_CAP`, and clears `pendingLocalDelivery` — called by
   * `useBatchAcknowledgement` only once its render + visibility predicate
   * (`shouldRecordDeliveredLocal`) is true, never from inside a `set`
   * updater.
   */
  recordPendingLocalDelivery: () => void;
  setAiPaperSearchEnabled: (enabled: boolean) => Promise<void>;
  setPaperSummaries: (
    bullets: { paperId: string; text: string }[],
  ) => void;
  savePaper: (paper: Paper) => void;
  notInterestedPaper: (paper: Paper) => void;
  moreLikePaper: (paper: Paper) => void;
  saveEvent: (event: Event) => void;
  notInterestedEvent: (event: Event) => void;
  moreLikeEvent: (event: Event) => void;
  saveJob: (job: Job) => void;
  notInterestedJob: (job: Job) => void;
  moreLikeJob: (job: Job) => void;
  unsavePaper: (id: string) => void;
  unsaveEvent: (id: string) => void;
  unsaveJob: (id: string) => void;
  submitFeedback: (
    itemId: string,
    type: string,
    feedback: ItemFeedback,
    payload?: unknown,
  ) => void;
  markRead: (id: string) => void;
  markUnread: (id: string) => void;
  setJobApplied: (job: Job, applied: boolean, at?: string) => void;
  setEventRegistered: (
    event: Event,
    registered: boolean,
    at?: string,
  ) => void;
  setEventSubmitted: (event: Event, submitted: boolean, at?: string) => void;
  undoDismiss: () => void;
  commitDismiss: () => void;
  /**
   * Replace saved lists and readItems with a server snapshot. Called by
   * FeedSync on login. Local-only changes that haven't been flushed yet
   * are merged in (see FeedSync for the merge pass).
   */
  hydrateFromRemote: (remote: {
    savedPapers?: Paper[];
    savedEvents?: Event[];
    savedJobs?: Job[];
    readItems?: Record<string, true>;
  }) => void;
  /** Reset local state — called on sign-out so the next user starts clean. */
  resetLocal: () => void;
}

// Monotonic token so overlapping loadFeed calls (refresh + topics auto-load +
// AI-toggle) can't interleave: only the newest request commits its result.
let feedLoadSeq = 0;

// P4-S5a — module-level in-flight guard for acknowledgePendingBatch, the
// same "one shared token, not per-call state" idiom as feedLoadSeq above.
// Both the mount-effect trigger (useBatchAcknowledgement) and loadFeed's own
// reconcile-before-load step call the SAME store action; without this, a
// coincident race between the two could fire two overlapping POSTs for the
// same batch. Always reset to null once the in-flight call settles, success
// or failure, so the next genuinely new call starts fresh.
let pendingAckInFlight: Promise<void> | null = null;

export const useFeedStore = create<FeedState>()(
  persist(
    (set, get) => ({
      papers: [],
      events: [],
      jobs: [],
      eventPool: [],
      jobPool: [],
      eventFacetCounts: emptyOpportunityFacetCounts(),
      jobFacetCounts: emptyOpportunityFacetCounts(),
      savedPapers: [],
      savedEvents: [],
      savedJobs: [],
      isLoading: false,
      papersLoading: false,
      eventsLoading: false,
      jobsLoading: false,
      lastRefresh: null,
      feedTopicsKey: null,
      aiPaperSearchEnabled: false,
      readItems: {},
      readAt: {},
      appliedAt: {},
      registeredAt: {},
      submittedAt: {},
      paperSummaries: {},
      recentlyShownIds: {},
      pendingDismissal: null,
      feedError: null,
      paperFeedback: {},
      eventFeedback: {},
      jobFeedback: {},
      batchId: null,
      batchStatus: null,
      renderedBatchId: null,
      pendingBatchAck: null,
      deliveredLocalByOwner: {},
      deliveredLocalOwnerOrder: [],
      pendingLocalDelivery: null,

      acknowledgePendingBatch: async () => {
        if (pendingAckInFlight) return pendingAckInFlight;
        const pending = get().pendingBatchAck;
        if (!pending) return;
        // P4-S5a-FIX (Round 3) — F-A-P4S5-01. Refuse to send an
        // acknowledgment for a batch that is not the one currently in
        // `papers`. A pending ack for a batch that isn't rendered right now
        // is left exactly as it is — not cleared — so it can still be sent
        // later if that batch's cards are ever rendered again
        // (ABC-JEV-INTEGRATION.md §1p.C.5/C.7).
        if (pending.batchId !== get().renderedBatchId) return;

        const run = async () => {
          try {
            await apiFetch<{ ok: boolean; alreadyAcknowledged: boolean }>(
              "/api/feed/ack",
              {
                method: "POST",
                body: JSON.stringify({ batchId: pending.batchId }),
              },
            );
            // 200, either fresh or already-acknowledged-elsewhere: nothing
            // left for this device to retry.
            if (get().pendingBatchAck?.batchId === pending.batchId) {
              set({ pendingBatchAck: null });
            }
          } catch (err) {
            if (err instanceof ApiError) {
              if (err.status === 401 || err.status === 503) {
                // 401: retry once signed in. 503 (ledger_unavailable): retry
                // once the server can read the ledger again. Either way,
                // keep pending — nothing to clear.
                return;
              }
              // 400 (malformed) or 404 (not_enabled / batch_not_found):
              // retrying this exact call can never succeed differently.
              console.warn(
                "[feed] batch ack could not be completed, clearing pending",
                err.status,
                pending.batchId,
              );
              if (get().pendingBatchAck?.batchId === pending.batchId) {
                set({ pendingBatchAck: null });
              }
              return;
            }
            // Network error or anything else unexpected: keep pending,
            // retried on the next load or the next visibilitychange to
            // visible (ABC-JEV-INTEGRATION.md §1p.C.7).
            console.warn("[feed] batch ack failed, will retry", err);
          }
        };

        pendingAckInFlight = run().finally(() => {
          pendingAckInFlight = null;
        });
        return pendingAckInFlight;
      },

      // P4-S5b — ABC-JEV-INTEGRATION.md §1p.C.1/C.7. Synchronous and
      // network-free (there is nothing to await), unlike
      // `acknowledgePendingBatch` above — this only ever touches local
      // state. A no-op when nothing is armed, so calling it speculatively
      // (the hook's own re-fire triggers) is always safe.
      //
      // P4-S5b-FIX (Round 3) — writes ONLY into `pending.ownerKey`'s own
      // namespace (the owner captured at arm time — see
      // `pendingLocalDelivery`'s doc comment on FeedState), never whichever
      // owner happens to be current right now. Also touches (MRU-bumps,
      // evicts beyond the bound) that namespace, so a delivery WRITE counts
      // as "active" the same way a `loadFeed` READ does.
      recordPendingLocalDelivery: () => {
        const pending = get().pendingLocalDelivery;
        if (!pending || pending.ids.length === 0) return;
        const today = localCalendarDate();
        set((state) => {
          const { order, byOwner } = touchDeliveredLocalOwner(
            state.deliveredLocalOwnerOrder,
            state.deliveredLocalByOwner,
            pending.ownerKey,
          );
          const nextOwnerMap = { ...byOwner[pending.ownerKey] };
          for (const id of pending.ids) {
            nextOwnerMap[id] = today;
          }
          return {
            deliveredLocalOwnerOrder: order,
            deliveredLocalByOwner: {
              ...byOwner,
              [pending.ownerKey]: pruneDeliveredLocal(nextOwnerMap),
            },
            pendingLocalDelivery: null,
          };
        });
      },

      loadFeed: async (options) => {
        // P4-S5a — reconcile any outstanding acknowledgment before asking
        // for anything new (ABC-JEV-INTEGRATION.md §1p.C.7). A plain async
        // call, not a `set` updater; a no-op, no-fetch call when nothing is
        // pending, so this is invisible to every load that never had one.
        await get().acknowledgePendingBatch();

        const requestId = ++feedLoadSeq;
        const advanceHistory = options?.advanceHistory === true;
        // Papers only by default. Events and jobs are no longer product surfaces;
        // their lanes stay callable for now but nothing asks for them.
        const lanes = options?.lanes ?? ["papers"];
        const wantsPapers = lanes.includes("papers");
        const wantsEvents = lanes.includes("events");
        const wantsJobs = lanes.includes("jobs");
        // P4-S5b-FIX (Round 3) — ABC-JEV-INTEGRATION.md §1c, closing finding
        // (b). Resolve and "touch" (MRU-bump, evict beyond
        // MAX_DELIVERED_LOCAL_OWNERS) the CURRENT owner's deliveredLocal
        // namespace up front, in the SAME set() call as the loading flags,
        // so every load — not just one that ends up excluding something —
        // keeps the namespace bound and MRU order correct. `ownerKey` is
        // also closed over below by `papersLane`, so the ids it arms into
        // `pendingLocalDelivery` are captured against the SAME owner this
        // load's own exclusions were computed for.
        //
        // P4-S5b-FIX2 (Round 3) — ABC-JEV-INTEGRATION.md §1g/§1c, closing
        // the auth-loading-window re-delivery risk (see
        // resolveOwnerKeyForLoad's own doc comment above): `ownerKey` is now
        // `string | null` — `null` means this load genuinely does not know
        // its owner yet. Every use of `ownerKey` below is guarded: `null`
        // skips the touch entirely (the "anonymous" namespace is never
        // created, evicted, or reordered on a guess), reads an empty
        // exclusion set (see `ownerDeliveredLocal` below), and arms nothing
        // in `papersLane` — this load sends NO device-local delivered ids
        // rather than risk the wrong owner's.
        //
        // P4-S5b-FIX3 (Round 3) — the "reads an empty exclusion set / sends
        // NO device-local ids" half of the paragraph above is superseded:
        // `null` now reads the UNION of every owner namespace this device
        // has (see `unionDeliveredLocal` and `ownerDeliveredLocal` below),
        // which is strictly MORE exclusion, never less, than the behavior it
        // replaces. The touch/arm halves are unchanged: still skipped/
        // nothing on `null`.
        const ownerKey = resolveOwnerKeyForLoad();
        const { order: touchedOwnerOrder, byOwner: touchedByOwner } =
          ownerKey
            ? touchDeliveredLocalOwner(
                get().deliveredLocalOwnerOrder,
                get().deliveredLocalByOwner,
                ownerKey,
              )
            : {
                order: get().deliveredLocalOwnerOrder,
                byOwner: get().deliveredLocalByOwner,
              };
        set({
          isLoading: true,
          papersLoading: wantsPapers,
          eventsLoading: wantsEvents,
          jobsLoading: wantsJobs,
          ...(wantsPapers ? { feedError: null } : {}),
          deliveredLocalOwnerOrder: touchedOwnerOrder,
          deliveredLocalByOwner: touchedByOwner,
        });
        const {
          papers: displayedPapers,
          savedPapers,
          recentlyShownIds,
          paperFeedback,
          eventFeedback,
          jobFeedback,
        } = get();
        // P4-S5b-FIX2 (Round 3) — `null` (owner not yet known) used to read
        // as no device-local exclusions at all.
        // P4-S5b-FIX3 (Round 3) — now reads the UNION of every owner
        // namespace this device has (see `unionDeliveredLocal` above)
        // instead — never a guess at any SINGLE namespace's content, but no
        // longer nothing either (ABC-JEV-INTEGRATION.md §4 "P4-S5b-FIX3
        // ruled and assigned", item (4)).
        const ownerDeliveredLocal = ownerKey
          ? touchedByOwner[ownerKey] ?? {}
          : unionDeliveredLocal(touchedOwnerOrder, touchedByOwner);
        const savedIds = new Set(savedPapers.map((p) => p.id));
        const aiPaperSearchEnabled = get().aiPaperSearchEnabled;
        const profile = useProfileStore.getState().profile;
        // Signature of the required topics this load is built from — must match
        // the feed page's auto-load key so the page knows the feed is current.
        const topicsKey = activePaperTopicsKey(profile);

        // Papers are a STANDING daily pool now, the same as events and jobs.
        // The server builds one pool per local day and a plain load re-reads
        // it, so opening the app a second time shows the SAME reading list
        // instead of paying for another search — which is the whole point of
        // the daily pool. Passing the recently-shown set on every load would
        // undo that from the client side: the pool would be stable and the
        // client would filter it away.
        //
        // A deliberate refresh / load-more is the one path that still asks for
        // something new, so it alone carries the consume-once exclusions.
        // P4-S5b-FIX (Round 3) — ABC-JEV-INTEGRATION.md §1g, closing
        // docs/jev-abc/P4-S5b-A-20260924T095305Z.md finding (a): an explicit
        // "not interested" is NOT allowed back by saving the paper —
        // dismissedPaperIds is no longer filtered by savedIds at all (was:
        // filtered when unioned with the other two sources below). §1g's
        // "no delivered item re-enters future batches" and "saved history
        // preserved" are two SEPARATE clauses, not one excusing the other.
        const dismissedPaperIds = Array.from(
          dismissedOpportunityIds(paperFeedback),
        );
        // P4-S5b — ABC-JEV-INTEGRATION.md §1p.C.1 + this slice's manager
        // refinement (2026-09-24): papers this DEVICE recorded delivered
        // BEFORE today are excluded starting from that next local day, on
        // EVERY load — unlike recentlyShownIds below, this is NOT gated
        // behind advanceHistory, because 16a/16b ("batch excluded from
        // tomorrow") must hold on a plain next-day visit, not only after an
        // explicit refresh. Today's own renders are deliberately left out
        // of this set (see deliveredBeforeLocalDate), so a same-day reload
        // never rotates the cards.
        // P4-S5b-FIX (Round 3) — finding (a): this source is likewise no
        // longer filtered by savedIds. A permanent delivery record and the
        // server ledger's own exclusion (delivery-ledger.ts, which has no
        // saved-id exception at all) must agree: saving a paper AFTER it
        // was delivered does not undo the delivery.
        const deliveredBeforeTodayIds = deliveredBeforeLocalDate(
          ownerDeliveredLocal,
          localCalendarDate(),
        );
        // Saved papers are still allowed back through THIS source
        // specifically — the one the pre-existing "Saved papers are allowed
        // back either way" comment always meant (the session-scoped
        // recently-shown/refresh-guard signal, not an explicit negative or
        // a permanent delivery record).
        const recentlyShownAndDisplayed = advanceHistory
          ? [
              ...activeRecentlyShownIds(recentlyShownIds),
              ...displayedPapers.map((paper) => paper.id),
            ].filter((id) => !savedIds.has(id))
          : [];
        // Priority for when the union exceeds the 800-id send cap:
        // dismissed (explicit negative signal) survives truncation first,
        // then delivered-before-today (most recent first — already ordered
        // that way by deliveredBeforeLocalDate), then the existing same-
        // session recently-shown guard last.
        const paperExcludeIds = Array.from(
          new Set([
            ...dismissedPaperIds,
            ...deliveredBeforeTodayIds,
            ...recentlyShownAndDisplayed,
          ]),
        ).slice(0, DELIVERED_EXCLUDE_SEND_CAP);

        // Events and jobs are STANDING opportunities, not consume-once items: a
        // conference is relevant every day until its deadline passes, so it
        // should keep surfacing rather than being suppressed after one view.
        // Exclude only the ones the user explicitly dismissed so dismissals
        // stick without starving either small opportunity pool.
        const dismissedEventIds = Array.from(
          dismissedOpportunityIds(eventFeedback),
        );
        const dismissedJobIds = Array.from(
          dismissedOpportunityIds(jobFeedback),
        );

        // Start all three pipelines together, but let each lane publish as
        // soon as it settles. allSettled below coordinates only the shared
        // refresh lifecycle; it is not a render barrier. Each helper degrades
        // to an empty pool on failure so one surface never blanks the others.
        const papersLane = (async () => {
          if (!wantsPapers) return;
          try {
            const realFeed = await fetchRealFeed(
              profile,
              aiPaperSearchEnabled,
              paperExcludeIds,
              useProfileStore.getState().entitlement,
            );
            // A newer load started while this lane was in flight — drop it.
            if (requestId !== feedLoadSeq) return;
            set((state) => {
              const currentSavedIds = new Set(
                state.savedPapers.map((paper) => paper.id),
              );
              const papers = realFeed.papers.map((paper) =>
                currentSavedIds.has(paper.id)
                  ? {
                      ...paper,
                      isSaved: true,
                      feedback:
                        state.paperFeedback[paper.id] ??
                        ("saved" as ItemFeedback),
                    }
                  : {
                      ...paper,
                      feedback:
                        state.paperFeedback[paper.id] ?? paper.feedback,
                    },
              );

              // P4-S5a-FIX (Round 3) — F-A-P4S5-01. Computed once so
              // `batchId` and `renderedBatchId` below can never drift apart:
              // both describe the SAME response, set in this SAME `set()`
              // call as `papers` itself. `renderedBatchId` is the one
              // `acknowledgePendingBatch` trusts.
              const renderedBatchId = realFeed.batchId ?? null;
              const paperUpdate: Partial<FeedState> = {
                papers,
                papersLoading: false,
                feedTopicsKey: topicsKey,
                batchId: renderedBatchId,
                batchStatus: realFeed.batchStatus ?? null,
                renderedBatchId,
                // P4-S5b — armed in this SAME set() call, the same
                // atomicity guarantee `renderedBatchId` itself relies on
                // (see that field's own comment above). A batched response
                // (renderedBatchId non-null) owns delivery server-side and
                // arms nothing here; a batchless response with something to
                // show arms exactly those ids, awaiting the render +
                // visibility confirmation `recordPendingLocalDelivery`
                // needs (ABC-JEV-INTEGRATION.md §1p.C.7) before they become
                // part of `deliveredLocalByOwner`. Always set explicitly
                // (never left stale) so an earlier batchless load's
                // un-recorded pending set can't be mistakenly credited to
                // whatever is now actually rendered.
                // P4-S5b-FIX (Round 3) — `ownerKey` is the SAME value this
                // load computed for its own `excludeIds` above (closed over
                // from loadFeed's outer scope, not re-resolved here), so the
                // eventual delivery record is attributed to the owner these
                // papers were actually fetched for — see
                // `pendingLocalDelivery`'s doc comment on FeedState.
                //
                // P4-S5b-FIX2 (Round 3) — `ownerKey` may now be `null` (this
                // load's owner was never confirmed — see
                // resolveOwnerKeyForLoad). Arm nothing in that case: better
                // to lose one batchless render's delivery record than to
                // guess it into the wrong (or a shared-anonymous) namespace.
                pendingLocalDelivery:
                  renderedBatchId === null && papers.length > 0 && ownerKey
                    ? { ownerKey, ids: papers.map((paper) => paper.id) }
                    : null,
              };
              // P4-S5a — ABC-JEV-INTEGRATION.md §1p.C.5/C.7. A served or
              // still-prepared batch owes the server an acknowledgment once
              // its cards render; capture that here so the POST itself can
              // fire from a real component effect after mount, never from
              // this `set` updater. A response with no batch at all leaves
              // any existing pendingBatchAck untouched (it may belong to an
              // earlier, unrelated batch still awaiting its own retry) —
              // only THIS batch being reported already-acknowledged clears a
              // pending entry that matches it. Once left untouched here, it
              // stays SAFE (never falsely sent) purely because
              // `acknowledgePendingBatch` now separately checks it against
              // `renderedBatchId`, which this same update just set to
              // `null` above — not because this branch changed at all.
              //
              // P4-S5a-FIX (Round 3) — F-A-P4S5-02 (LOW, availability-only,
              // not a false-delivery risk): the branch below unconditionally
              // OVERWRITES `pendingBatchAck` with the new batch whenever one
              // is served/prepared, even if an older, different batch's ack
              // was still genuinely outstanding (e.g. failing across a day
              // boundary) — that older record is silently dropped and this
              // device never retries it again. DECISION (smaller-safe-change
              // branch of this slice's brief): accept this gap rather than
              // widen `pendingBatchAck` into a bounded list. Server-side
              // "served-but-unacknowledged" temporary exclusion (§1p.C.5)
              // already prevents the only consequence that would matter —
              // the dropped batch's papers cannot be re-delivered as if new,
              // this only costs a permanent (ledger) delivery in favor of an
              // already-accepted temporary (served-unacked) one. A bounded
              // list was considered and rejected: it would not even fully
              // close the gap (a twice-superseded batch would still drop its
              // oldest entry) while adding list-management complexity to a
              // fix slice scoped to the HIGH-severity false-delivery defect.
              // Proven safe (not just documented) by
              // feed.test.ts's dedicated F-A-P4S5-02 test: the dropped batch
              // still cannot be falsely acked, because `renderedBatchId` no
              // longer matches it either. Re-listed in §1p.E, not blocking.
              if (
                realFeed.batchId &&
                (realFeed.batchStatus === "served" ||
                  realFeed.batchStatus === "prepared")
              ) {
                paperUpdate.pendingBatchAck = {
                  batchId: realFeed.batchId,
                  localDate: localCalendarDate(),
                };
              } else if (
                realFeed.batchId &&
                state.pendingBatchAck?.batchId === realFeed.batchId
              ) {
                paperUpdate.pendingBatchAck = null;
              }
              if (advanceHistory) {
                // Record shown PAPERS so the next load skips them, but only
                // for deliberate refresh/load-more actions. Opening today's
                // feed must not extend timestamps or change the next cached
                // briefing's exclusion set. Events/jobs are deliberately NOT
                // recorded — they're standing opportunities that should keep
                // appearing until their deadline passes or the user acts.
                const now = Date.now();
                const nextShown: Record<string, number> = {
                  ...state.recentlyShownIds,
                };
                for (const paper of [...state.papers, ...papers]) {
                  nextShown[paper.id] = now;
                }
                paperUpdate.recentlyShownIds = pruneRecentlyShown(nextShown);
              }
              return paperUpdate;
            });
          } catch (err) {
            if (requestId === feedLoadSeq) {
              set({
                feedError: err instanceof Error ? err.message : String(err),
              });
            }
          } finally {
            // Never let a stale lane clear a newer load's progress flag.
            if (requestId === feedLoadSeq && get().papersLoading) {
              set({ papersLoading: false });
            }
          }
        })();

        const eventsLane = (async () => {
          if (!wantsEvents) return;
          try {
            const realEvents = await fetchRealEvents(profile, dismissedEventIds, useProfileStore.getState().entitlement);
            if (requestId !== feedLoadSeq) return;
            set((state) => {
              const currentSavedIds = new Set(
                state.savedEvents.map((event) => event.id),
              );
              // Re-read dismissals from the latest state, not the snapshot the
              // request was built from: the user may have dismissed something
              // while this lane was in flight, and a stale response must not
              // resurrect it.
              const currentDismissedIds = dismissedOpportunityIds(
                state.eventFeedback,
              );
              const decorate = (event: Event): Event => ({
                ...event,
                isSaved: currentSavedIds.has(event.id),
                feedback:
                  state.eventFeedback[event.id] ??
                  (currentSavedIds.has(event.id)
                    ? ("saved" as ItemFeedback)
                    : undefined),
              });
              const keep = (event: Event) => !currentDismissedIds.has(event.id);
              return {
                events: realEvents.items.filter(keep).map(decorate),
                eventPool: realEvents.pool.filter(keep).map(decorate),
                eventFacetCounts: realEvents.facetCounts,
                eventsLoading: false,
              };
            });
          } finally {
            if (requestId === feedLoadSeq && get().eventsLoading) {
              set({ eventsLoading: false });
            }
          }
        })();

        const jobsLane = (async () => {
          if (!wantsJobs) return;
          try {
            const realJobs = await fetchRealJobs(profile, dismissedJobIds, useProfileStore.getState().entitlement);
            if (requestId !== feedLoadSeq) return;
            set((state) => {
              const currentSavedIds = new Set(
                state.savedJobs.map((job) => job.id),
              );
              const currentDismissedIds = dismissedOpportunityIds(
                state.jobFeedback,
              );
              const decorate = (job: Job): Job => ({
                ...job,
                isSaved: currentSavedIds.has(job.id),
                feedback:
                  state.jobFeedback[job.id] ??
                  (currentSavedIds.has(job.id)
                    ? ("saved" as ItemFeedback)
                    : undefined),
              });
              const keep = (job: Job) => !currentDismissedIds.has(job.id);
              return {
                jobs: realJobs.items.filter(keep).map(decorate),
                jobPool: realJobs.pool.filter(keep).map(decorate),
                jobFacetCounts: realJobs.facetCounts,
                jobsLoading: false,
              };
            });
          } finally {
            if (requestId === feedLoadSeq && get().jobsLoading) {
              set({ jobsLoading: false });
            }
          }
        })();

        await Promise.allSettled([papersLane, eventsLane, jobsLane]);
        if (requestId !== feedLoadSeq) return;
        set({
          isLoading: false,
          papersLoading: false,
          eventsLoading: false,
          jobsLoading: false,
          // A failed paper load is not a sync; keep the previous stamp so the
          // header cannot read "synced just now" over an error.
          lastRefresh: get().feedError ? get().lastRefresh : new Date().toISOString(),
        });
      },

      setAiPaperSearchEnabled: async (enabled) => {
        set({ aiPaperSearchEnabled: enabled });
        await get().loadFeed({ advanceHistory: true });
      },

      setPaperSummaries: (bullets) => {
        set((state) => ({
          paperSummaries: {
            ...state.paperSummaries,
            ...Object.fromEntries(
              bullets.map(({ paperId, text }) => [paperId, text]),
            ),
          },
        }));
      },

      savePaper: (paper) => {
        const alreadySaved = get().savedPapers.some((p) => p.id === paper.id);
        const previousFeedback = get().paperFeedback[paper.id] ?? paper.feedback;
        const savedFeedback =
          previousFeedback === "moreLikeThis" || previousFeedback === "liked"
            ? previousFeedback
            : ("saved" as ItemFeedback);
        const saved = { ...paper, isSaved: true, feedback: savedFeedback };
        set((s) => ({
          papers: s.papers.map((p) =>
            p.id === paper.id ? saved : p
          ),
          savedPapers: s.savedPapers.some((p) => p.id === paper.id)
            ? s.savedPapers.map((p) => (p.id === paper.id ? saved : p))
            : [saved, ...s.savedPapers],
          paperFeedback: { ...s.paperFeedback, [paper.id]: savedFeedback },
        }));
        if (!alreadySaved) {
          useProfileStore.getState().recordPaperPreference(saved, "positive");
        }
        cloudSave(paper.id, "paper", saved);
        get().submitFeedback(
          paper.id,
          "paper",
          "saved",
          feedbackSnapshotForPaper(saved),
        );
      },

      notInterestedPaper: (paper) => {
        // Commit any previous pending dismissal before starting a new one.
        const prev = get().pendingDismissal;
        if (prev) get().commitDismiss();
        const previousFeedback = get().paperFeedback[paper.id] ?? paper.feedback;

        set((s) => ({
          papers: s.papers.filter((p) => p.id !== paper.id),
          savedPapers: s.savedPapers.filter((p) => p.id !== paper.id),
          paperFeedback: { ...s.paperFeedback, [paper.id]: "notInterested" },
          pendingDismissal: {
            id: paper.id,
            kind: "paper",
            item: paper,
            previousFeedback,
            wasInDisplay: s.papers.some((item) => item.id === paper.id),
            wasInPool: false,
            wasSaved: s.savedPapers.some((item) => item.id === paper.id),
            expiresAt: Date.now() + 4000,
          },
        }));
      },

      moreLikePaper: (paper) => {
        const previous = get().paperFeedback[paper.id] ?? paper.feedback;
        const alreadyLiked = previous === "moreLikeThis" || previous === "liked";
        set((s) => ({
          papers: s.papers.map((p) =>
            p.id === paper.id ? { ...p, feedback: "moreLikeThis" as ItemFeedback } : p
          ),
          savedPapers: s.savedPapers.map((p) =>
            p.id === paper.id
              ? { ...p, feedback: "moreLikeThis" as ItemFeedback }
              : p,
          ),
          paperFeedback: { ...s.paperFeedback, [paper.id]: "moreLikeThis" },
        }));
        if (!alreadyLiked) {
          useProfileStore.getState().recordPaperPreference(paper, "positive");
        }
        get().submitFeedback(
          paper.id,
          "paper",
          "moreLikeThis",
          feedbackSnapshotForPaper(paper),
        );
      },

      saveEvent: (event) => {
        const alreadySaved = get().savedEvents.some((e) => e.id === event.id);
        const previousFeedback = get().eventFeedback[event.id] ?? event.feedback;
        const savedFeedback =
          previousFeedback === "moreLikeThis" || previousFeedback === "liked"
            ? previousFeedback
            : ("saved" as ItemFeedback);
        const saved = withCompletionPayload(
          { ...event, isSaved: true, feedback: savedFeedback },
          {
            registeredAt: get().registeredAt[event.id],
            submittedAt: get().submittedAt[event.id],
          },
        );
        set((s) => ({
          events: s.events.map((e) => (e.id === event.id ? saved : e)),
          eventPool: s.eventPool.map((e) =>
            e.id === event.id ? saved : e,
          ),
          savedEvents: alreadySaved
            ? s.savedEvents.map((e) => (e.id === event.id ? saved : e))
            : [saved, ...s.savedEvents],
          eventFeedback: { ...s.eventFeedback, [event.id]: savedFeedback },
        }));
        if (!alreadySaved) {
          useProfileStore.getState().recordEventPreference(saved, "positive");
        }
        cloudSave(event.id, "event", saved);
        get().submitFeedback(
          event.id,
          "event",
          "saved",
          feedbackSnapshotForEvent(saved),
        );
      },

      notInterestedEvent: (event) => {
        const prev = get().pendingDismissal;
        if (prev) get().commitDismiss();
        const previousFeedback = get().eventFeedback[event.id] ?? event.feedback;

        set((s) => ({
          events: s.events.filter((e) => e.id !== event.id),
          eventPool: s.eventPool.filter((e) => e.id !== event.id),
          savedEvents: s.savedEvents.filter((e) => e.id !== event.id),
          eventFeedback: { ...s.eventFeedback, [event.id]: "notInterested" },
          pendingDismissal: {
            id: event.id,
            kind: "event",
            item: withCompletionPayload(event, {
              registeredAt: s.registeredAt[event.id],
              submittedAt: s.submittedAt[event.id],
            }),
            previousFeedback,
            wasInDisplay: s.events.some((item) => item.id === event.id),
            wasInPool: s.eventPool.some((item) => item.id === event.id),
            wasSaved: s.savedEvents.some((item) => item.id === event.id),
            expiresAt: Date.now() + 4000,
          },
        }));
      },

      moreLikeEvent: (event) => {
        const previous = get().eventFeedback[event.id] ?? event.feedback;
        const alreadyLiked = previous === "moreLikeThis" || previous === "liked";
        set((s) => ({
          events: s.events.map((e) =>
            e.id === event.id
              ? { ...e, feedback: "moreLikeThis" as ItemFeedback }
              : e,
          ),
          savedEvents: s.savedEvents.map((e) =>
            e.id === event.id
              ? { ...e, feedback: "moreLikeThis" as ItemFeedback }
              : e,
          ),
          eventPool: s.eventPool.map((e) =>
            e.id === event.id
              ? { ...e, feedback: "moreLikeThis" as ItemFeedback }
              : e,
          ),
          eventFeedback: { ...s.eventFeedback, [event.id]: "moreLikeThis" },
        }));
        if (!alreadyLiked) {
          useProfileStore.getState().recordEventPreference(event, "positive");
        }
        get().submitFeedback(
          event.id,
          "event",
          "moreLikeThis",
          feedbackSnapshotForEvent(event),
        );
      },

      saveJob: (job) => {
        const alreadySaved = get().savedJobs.some((j) => j.id === job.id);
        const previousFeedback = get().jobFeedback[job.id] ?? job.feedback;
        const savedFeedback =
          previousFeedback === "moreLikeThis" || previousFeedback === "liked"
            ? previousFeedback
            : ("saved" as ItemFeedback);
        const saved = withCompletionPayload(
          { ...job, isSaved: true, feedback: savedFeedback },
          { appliedAt: get().appliedAt[job.id] },
        );
        set((s) => ({
          jobs: s.jobs.map((j) => (j.id === job.id ? saved : j)),
          jobPool: s.jobPool.map((j) => (j.id === job.id ? saved : j)),
          savedJobs: alreadySaved
            ? s.savedJobs.map((j) => (j.id === job.id ? saved : j))
            : [saved, ...s.savedJobs],
          jobFeedback: { ...s.jobFeedback, [job.id]: savedFeedback },
        }));
        if (!alreadySaved) {
          useProfileStore.getState().recordJobPreference(saved, "positive");
        }
        cloudSave(job.id, "job", saved);
        get().submitFeedback(job.id, "job", "saved", feedbackSnapshotForJob(saved));
      },

      notInterestedJob: (job) => {
        const prev = get().pendingDismissal;
        if (prev) get().commitDismiss();
        const previousFeedback = get().jobFeedback[job.id] ?? job.feedback;

        set((s) => ({
          jobs: s.jobs.filter((j) => j.id !== job.id),
          jobPool: s.jobPool.filter((j) => j.id !== job.id),
          savedJobs: s.savedJobs.filter((j) => j.id !== job.id),
          jobFeedback: { ...s.jobFeedback, [job.id]: "notInterested" },
          pendingDismissal: {
            id: job.id,
            kind: "job",
            item: withCompletionPayload(job, {
              appliedAt: s.appliedAt[job.id],
            }),
            previousFeedback,
            wasInDisplay: s.jobs.some((item) => item.id === job.id),
            wasInPool: s.jobPool.some((item) => item.id === job.id),
            wasSaved: s.savedJobs.some((item) => item.id === job.id),
            expiresAt: Date.now() + 4000,
          },
        }));
      },

      moreLikeJob: (job) => {
        const previous = get().jobFeedback[job.id] ?? job.feedback;
        const alreadyLiked = previous === "moreLikeThis" || previous === "liked";
        set((s) => ({
          jobs: s.jobs.map((j) =>
            j.id === job.id
              ? { ...j, feedback: "moreLikeThis" as ItemFeedback }
              : j,
          ),
          jobPool: s.jobPool.map((j) =>
            j.id === job.id
              ? { ...j, feedback: "moreLikeThis" as ItemFeedback }
              : j,
          ),
          savedJobs: s.savedJobs.map((j) =>
            j.id === job.id
              ? { ...j, feedback: "moreLikeThis" as ItemFeedback }
              : j,
          ),
          jobFeedback: { ...s.jobFeedback, [job.id]: "moreLikeThis" },
        }));
        if (!alreadyLiked) {
          useProfileStore.getState().recordJobPreference(job, "positive");
        }
        get().submitFeedback(
          job.id,
          "job",
          "moreLikeThis",
          feedbackSnapshotForJob(job),
        );
      },

      unsavePaper: (id) => {
        set((s) => {
          const nextFeedback = { ...s.paperFeedback };
          const currentFeedback = nextFeedback[id];
          if (currentFeedback === "saved") delete nextFeedback[id];
          return {
            papers: s.papers.map((p) =>
              p.id === id
                ? {
                    ...p,
                    isSaved: false,
                    feedback:
                      currentFeedback === "saved" ? undefined : currentFeedback,
                  }
                : p
            ),
            savedPapers: s.savedPapers.filter((p) => p.id !== id),
            paperFeedback: nextFeedback,
          };
        });
        cloudUnsave(id);
      },

      unsaveEvent: (id) => {
        set((s) => {
          const nextFeedback = { ...s.eventFeedback };
          const nextRegisteredAt = { ...s.registeredAt };
          const nextSubmittedAt = { ...s.submittedAt };
          const currentFeedback = nextFeedback[id];
          if (currentFeedback === "saved") delete nextFeedback[id];
          delete nextRegisteredAt[id];
          delete nextSubmittedAt[id];
          return {
            events: s.events.map((e) =>
              e.id === id
                ? {
                    ...e,
                    isSaved: false,
                    feedback:
                      currentFeedback === "saved" ? undefined : currentFeedback,
                  }
                : e,
            ),
            eventPool: s.eventPool.map((e) =>
              e.id === id
                ? {
                    ...e,
                    isSaved: false,
                    feedback:
                      currentFeedback === "saved"
                        ? undefined
                        : currentFeedback,
                  }
                : e,
            ),
            savedEvents: s.savedEvents.filter((e) => e.id !== id),
            eventFeedback: nextFeedback,
            registeredAt: nextRegisteredAt,
            submittedAt: nextSubmittedAt,
          };
        });
        cloudUnsave(id);
      },

      unsaveJob: (id) => {
        set((s) => {
          const nextFeedback = { ...s.jobFeedback };
          const nextAppliedAt = { ...s.appliedAt };
          const currentFeedback = nextFeedback[id];
          if (currentFeedback === "saved") delete nextFeedback[id];
          delete nextAppliedAt[id];
          return {
            jobs: s.jobs.map((j) =>
              j.id === id
                ? {
                    ...j,
                    isSaved: false,
                    feedback:
                      currentFeedback === "saved" ? undefined : currentFeedback,
                  }
                : j,
            ),
            jobPool: s.jobPool.map((j) =>
              j.id === id
                ? {
                    ...j,
                    isSaved: false,
                    feedback:
                      currentFeedback === "saved"
                        ? undefined
                        : currentFeedback,
                  }
                : j,
            ),
            savedJobs: s.savedJobs.filter((j) => j.id !== id),
            jobFeedback: nextFeedback,
            appliedAt: nextAppliedAt,
          };
        });
        cloudUnsave(id);
      },

      submitFeedback: (itemId, type, feedback, payload) => {
        console.log(`[Peer] Feedback: ${type} ${itemId} → ${feedback}`);
        const kind =
          type === "paper" || type === "event" || type === "job"
            ? (type as ItemKind)
            : null;
        if (kind) cloudFeedback(itemId, kind, feedback, payload);
      },

      markRead: (id) => {
        set((s) =>
          s.readItems[id]
            ? s
            : {
                readItems: { ...s.readItems, [id]: true },
                // The first read is the one the chart plots; re-opening a
                // paper a week later does not move the day it was read.
                readAt: { ...s.readAt, [id]: new Date().toISOString().slice(0, 10) },
              },
        );
        cloudMarkRead(id);
      },

      markUnread: (id) => {
        set((s) => {
          if (!s.readItems[id]) return s;
          const next = { ...s.readItems };
          delete next[id];
          const nextAt = { ...s.readAt };
          delete nextAt[id];
          return { readItems: next, readAt: nextAt };
        });
        cloudMarkUnread(id);
      },

      setJobApplied: (job, applied, at) => {
        const timestamp = applied
          ? get().appliedAt[job.id] ?? at ?? new Date().toISOString()
          : undefined;
        set((s) => {
          const nextAppliedAt = { ...s.appliedAt };
          if (timestamp) nextAppliedAt[job.id] = timestamp;
          else delete nextAppliedAt[job.id];
          return {
            appliedAt: nextAppliedAt,
            savedJobs: s.savedJobs.map((savedJob) =>
              savedJob.id === job.id
                ? withCompletionPayload(savedJob, { appliedAt: timestamp })
                : savedJob,
            ),
          };
        });

        const saved = get().savedJobs.find(({ id }) => id === job.id);
        if (saved) cloudSave(job.id, "job", saved);
        else if (applied) get().saveJob(job);
      },

      setEventRegistered: (event, registered, at) => {
        const timestamp = registered
          ? get().registeredAt[event.id] ?? at ?? new Date().toISOString()
          : undefined;
        set((s) => {
          const nextRegisteredAt = { ...s.registeredAt };
          if (timestamp) nextRegisteredAt[event.id] = timestamp;
          else delete nextRegisteredAt[event.id];
          return {
            registeredAt: nextRegisteredAt,
            savedEvents: s.savedEvents.map((savedEvent) =>
              savedEvent.id === event.id
                ? withCompletionPayload(savedEvent, {
                    registeredAt: timestamp,
                  })
                : savedEvent,
            ),
          };
        });

        const saved = get().savedEvents.find(({ id }) => id === event.id);
        if (saved) cloudSave(event.id, "event", saved);
        else if (registered) get().saveEvent(event);
      },

      setEventSubmitted: (event, submitted, at) => {
        const timestamp = submitted
          ? get().submittedAt[event.id] ?? at ?? new Date().toISOString()
          : undefined;
        set((s) => {
          const nextSubmittedAt = { ...s.submittedAt };
          if (timestamp) nextSubmittedAt[event.id] = timestamp;
          else delete nextSubmittedAt[event.id];
          return {
            submittedAt: nextSubmittedAt,
            savedEvents: s.savedEvents.map((savedEvent) =>
              savedEvent.id === event.id
                ? withCompletionPayload(savedEvent, {
                    submittedAt: timestamp,
                  })
                : savedEvent,
            ),
          };
        });

        const saved = get().savedEvents.find(({ id }) => id === event.id);
        if (saved) cloudSave(event.id, "event", saved);
        else if (submitted) get().saveEvent(event);
      },

      undoDismiss: () => {
        const pending = get().pendingDismissal;
        if (!pending) return;
        set((s) => {
          if (pending.kind === "paper") {
            const paper = pending.item as Paper;
            const nextFeedback = { ...s.paperFeedback };
            if (pending.previousFeedback) {
              nextFeedback[pending.id] = pending.previousFeedback;
            } else {
              delete nextFeedback[pending.id];
            }
            return {
              papers: restoreByScore(
                s.papers,
                paper,
                pending.wasInDisplay,
              ),
              savedPapers: restoreByScore(
                s.savedPapers,
                paper,
                pending.wasSaved,
              ),
              paperFeedback: nextFeedback,
              pendingDismissal: null,
            };
          }
          if (pending.kind === "event") {
            const event = pending.item as Event;
            const nextEventFeedback = { ...s.eventFeedback };
            if (pending.previousFeedback) {
              nextEventFeedback[pending.id] = pending.previousFeedback;
            } else {
              delete nextEventFeedback[pending.id];
            }
            return {
              events: restoreByScore(
                s.events,
                event,
                pending.wasInDisplay,
              ),
              eventPool: restoreByScore(
                s.eventPool,
                event,
                pending.wasInPool,
              ),
              savedEvents: restoreByScore(
                s.savedEvents,
                event,
                pending.wasSaved,
              ),
              eventFeedback: nextEventFeedback,
              pendingDismissal: null,
            };
          }
          const job = pending.item as Job;
          const nextJobFeedback = { ...s.jobFeedback };
          if (pending.previousFeedback) {
            nextJobFeedback[pending.id] = pending.previousFeedback;
          } else {
            delete nextJobFeedback[pending.id];
          }
          return {
            jobs: restoreByScore(
              s.jobs,
              job,
              pending.wasInDisplay,
            ),
            jobPool: restoreByScore(
              s.jobPool,
              job,
              pending.wasInPool,
            ),
            savedJobs: restoreByScore(
              s.savedJobs,
              job,
              pending.wasSaved,
            ),
            jobFeedback: nextJobFeedback,
            pendingDismissal: null,
          };
        });
      },

      commitDismiss: () => {
        const pending = get().pendingDismissal;
        if (!pending) return;
        if (pending.kind === "paper") {
          const paper = pending.item as Paper;
          useProfileStore.getState().recordPaperPreference(paper, "negative");
          get().submitFeedback(
            pending.id,
            pending.kind,
            "notInterested",
            feedbackSnapshotForPaper(paper),
          );
        } else if (pending.kind === "event") {
          const event = pending.item as Event;
          useProfileStore.getState().recordEventPreference(event, "negative");
          get().submitFeedback(
            pending.id,
            pending.kind,
            "notInterested",
            feedbackSnapshotForEvent(event),
          );
        } else {
          const job = pending.item as Job;
          useProfileStore.getState().recordJobPreference(job, "negative");
          get().submitFeedback(
            pending.id,
            pending.kind,
            "notInterested",
            feedbackSnapshotForJob(job),
          );
        }
        if (pending.wasSaved) cloudUnsave(pending.id);
        set((s) => {
          if (pending.kind === "event") {
            const nextRegisteredAt = { ...s.registeredAt };
            const nextSubmittedAt = { ...s.submittedAt };
            delete nextRegisteredAt[pending.id];
            delete nextSubmittedAt[pending.id];
            return {
              registeredAt: nextRegisteredAt,
              submittedAt: nextSubmittedAt,
              pendingDismissal: null,
            };
          }
          if (pending.kind === "job") {
            const nextAppliedAt = { ...s.appliedAt };
            delete nextAppliedAt[pending.id];
            return {
              appliedAt: nextAppliedAt,
              pendingDismissal: null,
            };
          }
          return { pendingDismissal: null };
        });
      },

      hydrateFromRemote: (remote) => {
        set((s) => {
          const nextSavedPapers = remote.savedPapers ?? s.savedPapers;
          const nextSavedEvents = remote.savedEvents ?? s.savedEvents;
          const nextSavedJobs = remote.savedJobs ?? s.savedJobs;
          const savedPaperIds = new Set(
            nextSavedPapers.map((paper) => paper.id),
          );
          const savedEventIds = new Set(
            nextSavedEvents.map((event) => event.id),
          );
          const savedJobIds = new Set(nextSavedJobs.map((job) => job.id));
          const nextPaperFeedback = { ...s.paperFeedback };
          const nextEventFeedback = { ...s.eventFeedback };
          const nextJobFeedback = { ...s.jobFeedback };

          for (const [id, feedback] of Object.entries(nextPaperFeedback)) {
            if (feedback === "saved" && !savedPaperIds.has(id)) {
              delete nextPaperFeedback[id];
            }
          }
          for (const [id, feedback] of Object.entries(nextEventFeedback)) {
            if (feedback === "saved" && !savedEventIds.has(id)) {
              delete nextEventFeedback[id];
            }
          }
          for (const [id, feedback] of Object.entries(nextJobFeedback)) {
            if (feedback === "saved" && !savedJobIds.has(id)) {
              delete nextJobFeedback[id];
            }
          }

          return {
            papers: syncSavedState(
              s.papers,
              savedPaperIds,
              nextPaperFeedback,
            ),
            events: syncSavedState(
              s.events,
              savedEventIds,
              nextEventFeedback,
            ),
            eventPool: syncSavedState(
              s.eventPool,
              savedEventIds,
              nextEventFeedback,
            ),
            jobs: syncSavedState(s.jobs, savedJobIds, nextJobFeedback),
            jobPool: syncSavedState(
              s.jobPool,
              savedJobIds,
              nextJobFeedback,
            ),
            savedPapers: syncSavedState(
              nextSavedPapers,
              savedPaperIds,
              nextPaperFeedback,
            ),
            savedEvents: syncSavedState(
              nextSavedEvents,
              savedEventIds,
              nextEventFeedback,
            ),
            savedJobs: syncSavedState(
              nextSavedJobs,
              savedJobIds,
              nextJobFeedback,
            ),
            paperFeedback: nextPaperFeedback,
            eventFeedback: nextEventFeedback,
            jobFeedback: nextJobFeedback,
            readItems: remote.readItems ?? s.readItems,
            appliedAt:
              remote.savedJobs === undefined
                ? s.appliedAt
                : completionMap(nextSavedJobs, "appliedAt"),
            registeredAt:
              remote.savedEvents === undefined
                ? s.registeredAt
                : completionMap(nextSavedEvents, "registeredAt"),
            submittedAt:
              remote.savedEvents === undefined
                ? s.submittedAt
                : completionMap(nextSavedEvents, "submittedAt"),
          };
        });
      },

      resetLocal: () => {
        feedLoadSeq += 1;
        set({
          papers: [],
          events: [],
          jobs: [],
          eventPool: [],
          jobPool: [],
          eventFacetCounts: emptyOpportunityFacetCounts(),
          jobFacetCounts: emptyOpportunityFacetCounts(),
          isLoading: false,
          lastRefresh: null,
          feedTopicsKey: null,
          savedPapers: [],
          savedEvents: [],
          savedJobs: [],
          readItems: {},
          appliedAt: {},
          registeredAt: {},
          submittedAt: {},
          paperSummaries: {},
          recentlyShownIds: {},
          pendingDismissal: null,
          paperFeedback: {},
          eventFeedback: {},
          jobFeedback: {},
          aiPaperSearchEnabled: false,
          batchId: null,
          batchStatus: null,
          // P4-S5a-FIX (Round 3) — F-A-P4S5-01: `papers` above is wholesale
          // reset too, so whatever batch it used to represent is gone.
          renderedBatchId: null,
          pendingBatchAck: null,
          // P4-S5b — same reasoning as renderedBatchId just above: whatever
          // batchless render this pointed at is gone now that `papers` is
          // wiped. `deliveredLocalByOwner`/`deliveredLocalOwnerOrder`
          // themselves are deliberately NOT reset here — this memory is
          // device-scoped, not session-scoped (ABC-JEV-INTEGRATION.md
          // §1p.C.1 / docs/jev-abc/P4-B-20260924T0338Z.md §3: "single
          // device, cleared by clearing browser storage"), so it should
          // outlive a sign-out on the same device rather than reset with
          // the session the way recentlyShownIds above does.
          //
          // P4-S5b-FIX (Round 3) — this is now SAFE for the reason finding
          // (b) required in the first place: the memory is namespaced per
          // owner, so "not resetting it" no longer means "the next
          // account inherits this one's history." Signing out just stops
          // this being the CURRENT namespace (loadFeed will resolve
          // ANONYMOUS_OWNER_KEY or a different signed-in id next); it does
          // not delete this owner's own namespace, so signing back in on
          // the same device restores it untouched.
          pendingLocalDelivery: null,
        });
      },
    }),
    {
      name: "peer-feed",
      // P4-S5b bumped 1 -> 2 (seeding deliveredLocal for already-shipped
      // blobs); P4-S5b-FIX (Round 3) bumps 2 -> 3 — closing
      // docs/jev-abc/P4-S5b-A-20260924T095305Z.md finding (b): see the
      // `migrate` function below for why a version bump (not just renaming
      // a partialize key) is required to actually run the move from the
      // flat, unnamespaced v2 `deliveredLocal` map to the namespaced v3
      // `deliveredLocalByOwner` shape for already-shipped blobs.
      version: 3,
      // skipHydration: rehydrated after mount via <StoreHydrator/> so the
      // first client render matches SSR defaults (empty feed / no saves) and
      // doesn't mismatch the server markup. See store/ui.ts for rationale.
      skipHydration: true,
      partialize: (state) => ({
        // 5-04: today's briefing list, so a hard refresh / fresh tab / deep
        // link finds a paper the reader only saw in today's feed (not yet
        // saved) without a network round trip — see page.tsx's `storePaper`
        // lookup, which already prefers this array over fetching by id, and
        // only fails to find one today because it was never persisted.
        // Bounded: the day's list, ~50 records, a snapshot that can go
        // stale until the next feed fetch overwrites it (accepted cost;
        // save/feedback fields are re-applied live on top regardless).
        papers: state.papers,
        savedPapers: state.savedPapers,
        savedEvents: state.savedEvents,
        savedJobs: state.savedJobs,
        readItems: state.readItems,
        readAt: state.readAt,
        appliedAt: state.appliedAt,
        registeredAt: state.registeredAt,
        submittedAt: state.submittedAt,
        paperSummaries: state.paperSummaries,
        aiPaperSearchEnabled: state.aiPaperSearchEnabled,
        recentlyShownIds: state.recentlyShownIds,
        paperFeedback: state.paperFeedback,
        eventFeedback: state.eventFeedback,
        jobFeedback: state.jobFeedback,
        // P4-S5a — the outstanding-acknowledgment record, NOT batchId/
        // batchStatus themselves (those are transient and re-derived from
        // the next load's response; persisting them would let a stale
        // pre-reload status be shown before that load even happens).
        pendingBatchAck: state.pendingBatchAck,
        // P4-S5a-FIX (Round 3) — F-A-P4S5-01. UNLIKE batchId/batchStatus
        // above, renderedBatchId IS persisted, deliberately: it needs to be
        // correct as soon as the persisted `papers` above rehydrate, still
        // before the next loadFeed's fetch resolves, so a genuinely
        // outstanding pendingBatchAck for those exact papers can be retried
        // right away instead of waiting for a fresh load to complete.
        renderedBatchId: state.renderedBatchId,
        // P4-S5b — the whole point: this device-local memory must survive a
        // reload (ABC-JEV-INTEGRATION.md §1p.C.1). UNLIKE renderedBatchId
        // just above, `pendingLocalDelivery` is deliberately NOT persisted
        // here — see that field's own doc comment on FeedState for why.
        // P4-S5b-FIX (Round 3) — persists BOTH namespaced fields together;
        // `deliveredLocalOwnerOrder` must travel with `deliveredLocalByOwner`
        // or the MRU/eviction bound would silently reset to an arbitrary
        // order (effectively Object.keys order) on every reload.
        deliveredLocalByOwner: state.deliveredLocalByOwner,
        deliveredLocalOwnerOrder: state.deliveredLocalOwnerOrder,
      }),
      migrate: (persistedState, version) => {
        const persisted = persistedState as Partial<FeedState> & {
          oppFeedback?: Record<string, ItemFeedback>;
        };

        // Pre-existing (version 0 -> 1): a legacy build stored one shared
        // oppFeedback map across events/jobs; split it into the two typed
        // maps introduced at version 1. Unchanged by P4-S5b below.
        let current: Partial<FeedState> & {
          oppFeedback?: Record<string, ItemFeedback>;
        } = persisted;
        if (version < 1 && persisted.oppFeedback) {
          const { oppFeedback, ...rest } = persisted;
          current = {
            ...rest,
            // Older builds shared one source-namespaced map. Copying it into
            // both typed maps preserves every dismissal without guessing an
            // adapter's id prefix; ids cannot collide across opportunity kinds.
            eventFeedback: { ...oppFeedback, ...rest.eventFeedback },
            jobFeedback: { ...oppFeedback, ...rest.jobFeedback },
          };
        }

        // P4-S5b-FIX (Round 3) — ABC-JEV-INTEGRATION.md §1c/§1p.C.1, closing
        // docs/jev-abc/P4-S5b-A-20260924T095305Z.md finding (b). Bumping
        // `version` to 3 (see just below) is what makes this step actually
        // run for every already-shipped (version 1 OR version 2) blob:
        // zustand only calls `migrate` when the persisted version differs
        // from the configured one (docs/jev-abc/P4-S5a-FIX-A-20260924T092049Z.md's
        // F-A-NEW-01 finding on `renderedBatchId` skipped a version bump and
        // so never got a migration opportunity at all — this does not
        // repeat that).
        //
        // Two distinct prior shapes land here, and BOTH go EXCLUSIVELY into
        // `deliveredLocalByOwner[ANONYMOUS_OWNER_KEY]` — never a real
        // signed-in user's own namespace:
        //   - a genuine version-2 blob (P4-S5b's own shipped shape) has a
        //     flat top-level `deliveredLocal: Record<string,string>` — its
        //     entries are copied across as-is (real evidence, not guessed).
        //   - a version-0/1 blob has no `deliveredLocal` at all — seeded
        //     from `recentlyShownIds`, the ONLY real evidence this device
        //     has of papers already shown before P4-S5b existed (unchanged
        //     method from the old version 1 -> 2 step this replaces).
        // Neither shape carries any reliable OWNER attribution: this
        // device's storage never recorded which account was signed in when
        // an entry was written, so guessing a real user id would risk
        // exactly the cross-account misattribution this fix exists to
        // close — the same "cannot promise to reconstruct never-recorded
        // history" principle §1g already applies to dates applies here to
        // identity. A returning signed-in user's true pre-fix device
        // history is honestly NOT recovered by this migration — a real,
        // named limitation, not a silent drop.
        if (version < 3 && !current.deliveredLocalByOwner) {
          const legacy = current as Partial<FeedState> & {
            deliveredLocal?: Record<string, string>;
          };
          let anonymousSeed: Record<string, string>;
          if (legacy.deliveredLocal) {
            anonymousSeed = { ...legacy.deliveredLocal };
          } else {
            const recentlyShown = current.recentlyShownIds ?? {};
            anonymousSeed = {};
            for (const [id, ts] of Object.entries(recentlyShown)) {
              anonymousSeed[id] = localCalendarDate(new Date(ts));
            }
          }
          const { deliveredLocal: _legacyDeliveredLocal, ...rest } = legacy;
          void _legacyDeliveredLocal;
          current = {
            ...rest,
            deliveredLocalByOwner: {
              [ANONYMOUS_OWNER_KEY]: pruneDeliveredLocal(anonymousSeed),
            },
            deliveredLocalOwnerOrder: [ANONYMOUS_OWNER_KEY],
          };
        }

        return current as FeedState;
      },
    }
  )
);

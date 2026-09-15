// GET  /api/profile — returns the signed-in user's profile row (or null)
// PUT  /api/profile — upserts the signed-in user's profile
//
// RLS enforces user_id ownership, but we still derive user_id from the session
// server-side so clients can't claim someone else's row via request body.

import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { resolveEntitlement } from "@/lib/entitlement/resolve";
import {
  toClientEntitlement,
  type ClientEntitlement,
} from "@/lib/entitlement/allowance";
import {
  deepReportMonthKey,
  deepReportTrialKey,
  getCounterStore,
} from "@/lib/usage/counters";
import type { UserProfile } from "@/types";
import { cleanPreferenceLedger } from "@/lib/preferences/ledger";

// ── DB ↔ client type mapping ────────────────────────────────────

interface ProfileRow {
  user_id: string;
  display_name: string | null;
  research_topics: string[];
  preferred_methods: string[];
  location_preferences: string[];
  authorised_countries?: string[];
  career_stage: string | null;
  industry_vs_academia: string | null;
  phd_year: number | null;
  school: string | null;
  current_project: string | null;
  current_challenges: string | null;
  disliked_topics: string[];
  preference_ledger?: unknown;
  feed_focus: UserProfile["feedFocus"];
  feed_freshness: UserProfile["feedFreshness"];
  paper_count: UserProfile["paperCount"];
  feed_source_mix: UserProfile["feedSourceMix"];
  feed_importance: UserProfile["feedImportance"];
  feed_method_mode: UserProfile["feedMethodMode"];
  feed_discovery_mode: UserProfile["feedDiscoveryMode"];
  feed_avoid_reviews: boolean;
  feed_avoid_old_papers: boolean;
  feed_avoid_broad_surveys: boolean;
  lab: string | null;
  digest_enabled: boolean;
  digest_hour_local: number;
  digest_timezone: string;
  digest_channel: UserProfile["digestChannel"];
  digest_frequency: UserProfile["digestFrequency"];
  digest_email: string | null;
  color_theme: UserProfile["colorTheme"];
  updated_at: string;
}

export function profileRowToProfile(row: ProfileRow): Partial<UserProfile> {
  return {
    displayName: row.display_name ?? undefined,
    researchTopics: row.research_topics,
    preferredMethods: row.preferred_methods,
    locationPreferences: row.location_preferences,
    authorisedCountries: row.authorised_countries ?? [],
    careerStage: (row.career_stage ?? undefined) as UserProfile["careerStage"] | undefined,
    industryVsAcademia: (row.industry_vs_academia ?? undefined) as
      | UserProfile["industryVsAcademia"]
      | undefined,
    phdYear: row.phd_year ?? undefined,
    school: row.school ?? undefined,
    currentProject: row.current_project ?? undefined,
    currentChallenges: row.current_challenges ?? undefined,
    dislikedTopics: row.disliked_topics ?? [],
    preferenceLedger: cleanPreferenceLedger(
      row.preference_ledger as UserProfile["preferenceLedger"],
    ),
    feedFocus: row.feed_focus,
    feedFreshness: row.feed_freshness,
    paperCount: row.paper_count,
    feedSourceMix: row.feed_source_mix,
    feedImportance: row.feed_importance,
    feedMethodMode: row.feed_method_mode,
    feedDiscoveryMode: row.feed_discovery_mode,
    feedAvoidReviews: row.feed_avoid_reviews,
    feedAvoidOldPapers: row.feed_avoid_old_papers,
    feedAvoidBroadSurveys: row.feed_avoid_broad_surveys,
    advisorName: row.lab ?? undefined,
    digestEnabled: row.digest_enabled,
    digestHourLocal: row.digest_hour_local,
    digestTimezone: row.digest_timezone,
    digestChannel: row.digest_channel,
    digestEmail: row.digest_email ?? undefined,
    digestFrequency: row.digest_frequency,
    colorTheme: row.color_theme,
  };
}

export function profilePatchToRow(p: Partial<UserProfile>, userId: string) {
  // Only include columns the caller meant to set. `undefined` means "leave
  // existing value alone" — important so sending a display-name update
  // doesn't wipe digest prefs (and vice versa).
  const row: Record<string, unknown> = { user_id: userId };
  if (p.displayName !== undefined) row.display_name = p.displayName;
  if (p.researchTopics !== undefined) row.research_topics = p.researchTopics;
  if (p.preferredMethods !== undefined) row.preferred_methods = p.preferredMethods;
  if (p.locationPreferences !== undefined) row.location_preferences = p.locationPreferences;
  if (p.authorisedCountries !== undefined) row.authorised_countries = p.authorisedCountries;
  if (p.careerStage !== undefined) row.career_stage = p.careerStage;
  if (p.industryVsAcademia !== undefined) row.industry_vs_academia = p.industryVsAcademia;
  if (p.phdYear !== undefined) row.phd_year = p.phdYear;
  if (p.school !== undefined) row.school = p.school;
  if (p.currentProject !== undefined) row.current_project = p.currentProject;
  if (p.currentChallenges !== undefined) row.current_challenges = p.currentChallenges;
  if (p.dislikedTopics !== undefined) row.disliked_topics = p.dislikedTopics;
  if (p.preferenceLedger !== undefined) {
    row.preference_ledger = cleanPreferenceLedger(p.preferenceLedger);
  }
  if (p.feedFocus !== undefined) row.feed_focus = p.feedFocus;
  if (p.feedFreshness !== undefined) row.feed_freshness = p.feedFreshness;
  if (p.paperCount !== undefined) row.paper_count = p.paperCount;
  if (p.feedSourceMix !== undefined) row.feed_source_mix = p.feedSourceMix;
  if (p.feedImportance !== undefined) row.feed_importance = p.feedImportance;
  if (p.feedMethodMode !== undefined) row.feed_method_mode = p.feedMethodMode;
  if (p.feedDiscoveryMode !== undefined) row.feed_discovery_mode = p.feedDiscoveryMode;
  if (p.feedAvoidReviews !== undefined) row.feed_avoid_reviews = p.feedAvoidReviews;
  if (p.feedAvoidOldPapers !== undefined) row.feed_avoid_old_papers = p.feedAvoidOldPapers;
  if (p.feedAvoidBroadSurveys !== undefined) row.feed_avoid_broad_surveys = p.feedAvoidBroadSurveys;
  // advisorName persists in the legacy `lab` column (no DB migration needed).
  if (p.advisorName !== undefined) row.lab = p.advisorName;
  if (p.digestEnabled !== undefined) row.digest_enabled = p.digestEnabled;
  if (p.digestHourLocal !== undefined) row.digest_hour_local = p.digestHourLocal;
  if (p.digestTimezone !== undefined) row.digest_timezone = p.digestTimezone;
  if (p.digestChannel !== undefined) row.digest_channel = p.digestChannel;
  if (p.digestEmail !== undefined) row.digest_email = p.digestEmail;
  if (p.digestFrequency !== undefined) row.digest_frequency = p.digestFrequency;
  if (p.colorTheme !== undefined) row.color_theme = p.colorTheme;
  return row;
}

// ── Handlers ────────────────────────────────────────────────────

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ profile: null }, { status: 401 });
  }

  const { data, error } = await supabase
    .from("profiles")
    .select("*")
    .eq("user_id", user.id)
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // ABC-freemium 1-14 · R-ENT-3 — the entitlement is delivered here, computed
  // by the server. **Never derived on the client from the raw row**: D5 makes
  // the server the authority and expiry is computed at read time.
  //
  // A signed-out caller already gets `401 { profile: null }` above, and the
  // client's default is the frozen anonymous entitlement — the same object
  // shape — so no consumer needs a null branch.
  //
  // **`plan` is deliberately NOT added to `profileRowToProfile`.** It reaches
  // the browser as part of the entitlement and nowhere else, and 1-13's column
  // grants mean a browser could not write it back even if it tried. See the
  // matching note on `profilePatchToRow`.
  return NextResponse.json({
    profile: data ? profileRowToProfile(data as ProfileRow) : null,
    entitlement: await clientEntitlement(user.id),
  });
}

/**
 * The entitlement in the shape the browser gets (ABC-freemium 2-03).
 *
 * **This is the only place the subtraction happens.** `resolveEntitlement`
 * gives the plan's budget and deliberately never reads the counter store — it
 * runs on every AI request, and a counter read inside it would put a database
 * round trip on every feed load to compute a number only this screen wants. So
 * the extra read lands here, on the profile fetch, and nowhere else.
 *
 * **It reads, it never increments.** A profile fetch that consumed a deep
 * report would be the worst bug in this file; there is a test asserting the
 * counter does not move across repeated GETs.
 *
 * `deepReportsBudget` is dropped on the way out by `ClientEntitlement`, so
 * `Infinity` cannot reach the payload by construction.
 */
async function clientEntitlement(userId: string): Promise<ClientEntitlement> {
  const now = new Date();
  const entitlement = await resolveEntitlement(userId);

  // Paid needs no reading at all — D4 makes it unlimited whatever the counter
  // says, and `deepReportAllowance` short-circuits before it looks. Skipping
  // the round trip keeps the paid profile fetch exactly as fast as it was.
  const used =
    entitlement.effectivePlan === "paid"
      ? { value: 0, ok: true }
      : await getCounterStore().read(
          // The key depends on the plan and must not be guessed: a trial's
          // twenty are counted on a key with NO period segment, so reading the
          // monthly key for a trial user would always answer zero.
          entitlement.effectivePlan === "trial"
            ? deepReportTrialKey(userId)
            : deepReportMonthKey(userId, now),
          now,
        );

  return toClientEntitlement(entitlement, used);
}

export async function PUT(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }

  const body = (await request.json()) as Partial<UserProfile>;
  const row = profilePatchToRow(body, user.id);

  let { data, error } = await supabase
    .from("profiles")
    .upsert(row, { onConflict: "user_id" })
    .select()
    .single();

  // Graceful fallback: if the optional digest_email column hasn't been added to
  // the DB yet (migration not run), drop it and retry so the rest of the profile
  // still syncs. The email simply won't persist server-side until migrated.
  if (error && "digest_email" in row && /digest_email/.test(error.message)) {
    delete row.digest_email;
    ({ data, error } = await supabase
      .from("profiles")
      .upsert(row, { onConflict: "user_id" })
      .select()
      .single());
  }

  if (error && "preference_ledger" in row && /preference_ledger/.test(error.message)) {
    delete row.preference_ledger;
    ({ data, error } = await supabase
      .from("profiles")
      .upsert(row, { onConflict: "user_id" })
      .select()
      .single());
  }

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ profile: profileRowToProfile(data as ProfileRow) });
}

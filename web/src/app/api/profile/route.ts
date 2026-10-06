// GET  /api/profile — returns the signed-in user's profile row (or null)
// PUT  /api/profile — upserts the signed-in user's profile
//
// RLS enforces user_id ownership, but we still derive user_id from the session
// server-side so clients can't claim someone else's row via request body.

import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import type { UserProfile } from "@/types";
import { cleanPreferenceLedger } from "@/lib/preferences/ledger";
import { normalizePersistedFeedIntent, textValue } from "@/lib/feed/intent";
import { normalizeEmailAddress } from "@/lib/email/confirm-token";

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
  feed_intent?: unknown;
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
  const storedIntent = row.feed_intent === undefined || row.feed_intent === null
    ? undefined
    : normalizePersistedFeedIntent(row.feed_intent);
  if (storedIntent && !storedIntent.ok) throw new Error("invalid_feed_intent");
  const intent = storedIntent?.ok ? storedIntent.intent : undefined;
  return {
    displayName: row.display_name ?? undefined,
    locationPreferences: row.location_preferences,
    authorisedCountries: row.authorised_countries ?? [],
    careerStage: (row.career_stage ?? undefined) as UserProfile["careerStage"] | undefined,
    industryVsAcademia: (row.industry_vs_academia ?? undefined) as
      | UserProfile["industryVsAcademia"]
      | undefined,
    phdYear: row.phd_year ?? undefined,
    school: row.school ?? undefined,
    currentProject: intent ? (intent.project.presence === "explicit-empty" ? "" : textValue(intent.project)) : row.current_project ?? undefined,
    currentChallenges: intent ? (intent.challenge.presence === "explicit-empty" ? "" : textValue(intent.challenge)) : row.current_challenges ?? undefined,
    researchTopics: intent ? intent.requiredConcepts : row.research_topics,
    preferredMethods: intent ? intent.methods : row.preferred_methods,
    dislikedTopics: intent ? intent.exclusions.map((entry) => entry.value) : row.disliked_topics ?? [],
    softTopics: intent?.preferredConcepts,
    selectedSenseConcepts: intent?.selectedSenseConcepts,
    feedIntent: intent,
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
  if (p.feedIntent !== undefined) row.feed_intent = p.feedIntent;
  return row;
}

function isMissingFeedIntentColumn(error: { message?: string; code?: string } | null): boolean {
  if (!error) return false;
  return error.code === "42703"
    ? /feed_intent/i.test(error.message ?? "")
    : /profiles/i.test(error.message ?? "") && /feed_intent/i.test(error.message ?? "");
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

  // Wrapped in try/catch because `profileRowToProfile` (P1 §1l) can throw
  // `invalid_feed_intent` when the stored `feed_intent` column is malformed —
  // theirs' version of this route never had that failure mode.
  try {
    return NextResponse.json({
      profile: data ? profileRowToProfile(data as ProfileRow) : null,
    });
  } catch (error) {
    if (error instanceof Error && error.message === "invalid_feed_intent") {
      return NextResponse.json({ error: "invalid_feed_intent" }, { status: 500 });
    }
    throw error;
  }
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
  if (Object.prototype.hasOwnProperty.call(body, "feedIntent")) {
    const parsed = normalizePersistedFeedIntent(body.feedIntent);
    if (!parsed.ok) return NextResponse.json({ error: "invalid_feed_intent" }, { status: 400 });
    body.feedIntent = parsed.intent;
  }

  // POLISH-1-SYNC (ABC-JEV-INTEGRATION.md §1al (b)) — fields this PUT
  // could not honour are DROPPED, never allowed to fail the whole save.
  // Reported back so the client can tell the reader their edit to THIS
  // field specifically didn't take, instead of silently vanishing or
  // (the old behaviour, see below) taking every other edited field down
  // with it.
  const ignored: string[] = [];

  // EMAIL-SETTINGS · F4/§2.3 (guide docs/jev-abc/EMAIL-SETTINGS-B-20260926T142832Z.md) —
  // a client may only ever PUT a digestEmail equal to the account email or
  // the value already stored for this user. A genuinely NEW address only
  // ever becomes one of those two allowed values through
  // GET /api/profile/confirm-email's own write, never through this route.
  // Only reads the existing row when the patch actually touches this field
  // (no added cost to any other field's update). Clearing the field to ""
  // is always allowed unconditionally — there is nothing to confirm when
  // REMOVING a destination, only when adding/changing one.
  //
  // POLISH-1-SYNC (§1al (b)) — a candidate this guard doesn't trust used to
  // 400 the ENTIRE save (every other edited field lost alongside it: the
  // same "one bad optional field blocks everything" defect SIGNIN-MERGE's
  // §1aj fix already closed below for a missing feed_intent/
  // preference_ledger COLUMN). A rejected digestEmail isn't a missing
  // column, so it never hit those retries. Now: drop just this field —
  // never WRITE it, the security property this guard exists for is
  // unchanged, only the failure mode is — let the rest of the patch
  // through, and report the drop in `ignored`. A failed guard READ (the
  // SELECT below erroring) is treated the same way: an error is not
  // evidence the candidate is safe, so it drops the field too instead of
  // failing the whole save with a 500.
  if (Object.prototype.hasOwnProperty.call(body, "digestEmail") && body.digestEmail !== undefined) {
    const candidate = normalizeEmailAddress(body.digestEmail);
    let allowed = candidate === "";
    if (!allowed) {
      const accountEmail = user.email ? normalizeEmailAddress(user.email) : null;
      allowed = accountEmail !== null && candidate === accountEmail;
      if (!allowed) {
        const { data: existingRow, error: existingError } = await supabase
          .from("profiles")
          .select("digest_email")
          .eq("user_id", user.id)
          .maybeSingle();
        if (existingError) {
          allowed = false;
        } else {
          const storedEmail = existingRow?.digest_email
            ? normalizeEmailAddress(existingRow.digest_email)
            : null;
          allowed = storedEmail !== null && candidate === storedEmail;
        }
      }
    }
    if (allowed) {
      // Always store the normalized form — whichever path wrote
      // digest_email (this echo-write, or confirm-email's own write), the
      // stored value is always trim+lowercase.
      body.digestEmail = candidate;
    } else {
      delete body.digestEmail;
      ignored.push("digestEmail");
    }
  }

  const row = profilePatchToRow(body, user.id);

  let { data, error } = await supabase
    .from("profiles")
    .upsert(row, { onConflict: "user_id" })
    .select()
    .single();

  // SIGNIN-MERGE (§1aj) — mirror the digest_email/preference_ledger branches
  // right below: an optional column that hasn't been migrated in yet must
  // never fail the WHOLE upsert. Before this fix, ANY PUT carrying feedIntent
  // (i.e. almost every real save — remoteProfilePayload attaches it whenever
  // the profile has any real content) 409'd atomically while the column was
  // missing, and NONE of the legacy flat columns (research_topics,
  // current_project, digest_*, …) reached the account either — an upsert
  // that errors writes nothing. feedIntent fidelity is still lost until the
  // migration lands, but every other field now saves regardless.
  if (error && "feed_intent" in row && isMissingFeedIntentColumn(error)) {
    delete row.feed_intent;
    ({ data, error } = await supabase
      .from("profiles")
      .upsert(row, { onConflict: "user_id" })
      .select()
      .single());
  }

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

  try {
    return NextResponse.json({
      profile: profileRowToProfile(data as ProfileRow),
      ignored,
    });
  } catch (caught) {
    if (caught instanceof Error && caught.message === "invalid_feed_intent") {
      return NextResponse.json({ error: "invalid_feed_intent" }, { status: 500 });
    }
    throw caught;
  }
}

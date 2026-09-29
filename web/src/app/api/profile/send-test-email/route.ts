// POST /api/profile/send-test-email
//
// EMAIL-SETTINGS — lets a signed-in reader try the daily paper-brief email
// before committing to it. ABC-JEV-INTEGRATION.md §1y point 2.iv, §1z.
// Guide docs/jev-abc/EMAIL-SETTINGS-B-20260926T142832Z.md §2.1.
//
// Always targets the reader's OWN destination address (digest_email,
// falling back to their account email when unset) — never an arbitrary
// address; there is no request body at all. Runs the feed pipeline at
// aiTier 0 (D9), mirroring api/test-digest's own budget precedent — this
// route never reaches resolveProvider, same as that one. Ignores
// digest_enabled/frequency/hour, like the existing manual test-digest route:
// this is an on-demand try-it action, not the scheduled send. Does NOT
// insert into briefing_deliveries (mirrors test-digest).
//
// Rate-limited 3/day per user, FAILING CLOSED (§1z P1): if the counter store
// cannot be reached, the button refuses rather than risking an unbounded
// spend — the opposite direction of this codebase's ordinary UX rate limits
// (see counters.ts's own header on the two failure rules).
//
// Order of checks (cheapest / least user-penalizing first, per guide §2.1;
// reordered by ABC-JEV-INTEGRATION.md §1al POLISH-1-EMAIL (e), 2026-09-28 —
// the profile-shape checks now run BEFORE the counter is touched, so a
// reader who fails one of them for free never burns one of today's 3 tries):
// signed in? -> Resend configured at all? -> resolve destination address ->
// research focus present? -> increment-then-compare the daily counter ->
// run the pipeline -> send.
//
// Deliberately duplicates two small profile-shape helpers
// (seedTextsFromProfile / feedControlsFromProfile) and the profile select
// strings instead of importing them from api/test-digest/route.ts. That
// file also needs an extra column (digest_email) this route reads but
// test-digest does not, and the guide's own file list (§2.5) marks
// test-digest/route.ts "Untouched, verified safe" with no exception (unlike
// digest-template.ts, which got one) — so this keeps that file at zero
// edits rather than exporting two previously-private functions. See the C
// checkpoint's "Deviations" section. `testDigestFeedRequestFromProfile` IS
// reused as-is: it was already exported.

import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { runFeedPipeline } from "@/lib/feed/pipeline";
import type { FeedControls } from "@/lib/feed/profile-compiler";
import { sendDigestEmail } from "@/lib/email/send-digest";
import {
  classifySendFailure,
  describeSendFailureForLog,
} from "@/lib/email/send-failure";
import { cleanPreferenceLedger } from "@/lib/preferences/ledger";
import type { PreferenceLedger } from "@/types";
import { testDigestFeedRequestFromProfile } from "@/app/api/test-digest/route";
import {
  breakerTripped,
  endOfUtcDay,
  getCounterStore,
  testEmailDayKey,
} from "@/lib/usage/counters";
import { normalizeEmailAddress } from "@/lib/email/confirm-token";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const TEST_EMAILS_PER_DAY = 3;

function originUrlFor(req: NextRequest): string {
  const explicit = process.env.NEXT_PUBLIC_SITE_URL;
  if (explicit) return explicit.replace(/\/$/, "");
  const proto = req.headers.get("x-forwarded-proto") ?? "https";
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  if (host) return `${proto}://${host}`;
  return "https://hermes-flax-six.vercel.app";
}

interface SendTestEmailProfileRow {
  display_name: string | null;
  research_topics: string[] | null;
  preferred_methods: string[] | null;
  current_project: string | null;
  current_challenges: string | null;
  disliked_topics: string[] | null;
  feed_intent?: unknown;
  preference_ledger?: PreferenceLedger | null;
  feed_focus: FeedControls["focus"] | null;
  feed_freshness: FeedControls["freshness"] | null;
  paper_count: FeedControls["paperCount"] | null;
  feed_source_mix: FeedControls["sourceMix"] | null;
  feed_importance: FeedControls["importance"] | null;
  feed_method_mode: FeedControls["methodMode"] | null;
  feed_discovery_mode: FeedControls["discoveryMode"] | null;
  feed_avoid_reviews: boolean | null;
  feed_avoid_old_papers: boolean | null;
  feed_avoid_broad_surveys: boolean | null;
  digest_email: string | null;
}

const modernSelect =
  "display_name, research_topics, preferred_methods, current_project, current_challenges, disliked_topics, feed_intent, preference_ledger, feed_focus, feed_freshness, paper_count, feed_source_mix, feed_importance, feed_method_mode, feed_discovery_mode, feed_avoid_reviews, feed_avoid_old_papers, feed_avoid_broad_surveys, digest_email";
const legacySelect =
  "display_name, research_topics, preferred_methods, current_project, current_challenges, disliked_topics, preference_ledger, feed_focus, feed_freshness, paper_count, feed_source_mix, feed_importance, feed_method_mode, feed_discovery_mode, feed_avoid_reviews, feed_avoid_old_papers, feed_avoid_broad_surveys, digest_email";

// Local, private copy — `profile/route.ts` already keeps its own separate
// copy of this exact check rather than sharing one; same precedent here.
function isMissingFeedIntentColumn(error: { message?: string; code?: string } | null): boolean {
  if (!error) return false;
  return error.code === "42703"
    ? /feed_intent/i.test(error.message ?? "")
    : /profiles/i.test(error.message ?? "") && /feed_intent/i.test(error.message ?? "");
}

function seedTextsFromProfile(profile: SendTestEmailProfileRow | null): string[] {
  return [profile?.current_project, profile?.current_challenges]
    .map((text) => text?.trim())
    .filter((text): text is string => Boolean(text));
}

function feedControlsFromProfile(profile: SendTestEmailProfileRow | null): FeedControls {
  return {
    focus: profile?.feed_focus ?? undefined,
    freshness: profile?.feed_freshness ?? undefined,
    paperCount: profile?.paper_count ?? undefined,
    sourceMix: profile?.feed_source_mix ?? undefined,
    importance: profile?.feed_importance ?? undefined,
    methodMode: profile?.feed_method_mode ?? undefined,
    discoveryMode: profile?.feed_discovery_mode ?? undefined,
    avoidReviews: profile?.feed_avoid_reviews ?? undefined,
    avoidOldPapers: profile?.feed_avoid_old_papers ?? undefined,
    avoidBroadSurveys: profile?.feed_avoid_broad_surveys ?? undefined,
  };
}

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }

  if (!process.env.RESEND_API_KEY) {
    // A config problem, not the user's fault — do not spend one of the
    // day's 3 attempts on it.
    return NextResponse.json(
      { sent: false, reason: "unavailable", error: "Email sending isn't configured yet." },
      { status: 200 },
    );
  }

  const selectProfile = (columns: string) =>
    supabase.from("profiles").select(columns).eq("user_id", user.id).maybeSingle();
  let profileResult = await selectProfile(modernSelect);
  if (profileResult.error && isMissingFeedIntentColumn(profileResult.error)) {
    profileResult = await selectProfile(legacySelect);
  }
  const { data: profile, error: profErr } = profileResult;
  if (profErr) {
    return NextResponse.json({ error: profErr.message }, { status: 500 });
  }
  const typedProfile = profile as SendTestEmailProfileRow | null;

  const destination = typedProfile?.digest_email?.trim() || user.email || "";
  if (!destination) {
    return NextResponse.json(
      { sent: false, reason: "no_address", error: "Add an email above first." },
      { status: 400 },
    );
  }

  // §1al POLISH-1-EMAIL (e) — this cheap, profile-shape check now runs
  // BEFORE the daily counter is touched: a reader with no research focus
  // yet must not burn one of today's 3 tries on a failure that cost
  // nothing to detect. The counter itself stays fail-closed, unchanged.
  const normalizedFeed = testDigestFeedRequestFromProfile(typedProfile);
  if (!normalizedFeed.ok) {
    return NextResponse.json(
      { sent: false, reason: "intent_required", error: "Add a research focus first." },
      { status: 400 },
    );
  }

  const now = new Date();
  const reading = await getCounterStore().increment(
    testEmailDayKey(user.id, now),
    endOfUtcDay(now),
    1,
    now,
  );
  if (breakerTripped(reading, TEST_EMAILS_PER_DAY)) {
    return NextResponse.json(
      {
        sent: false,
        reason: "rate_limited",
        error: "You've used today's 3 test sends. Try again tomorrow.",
      },
      { status: 429 },
    );
  }

  const feed = await runFeedPipeline({
    ...normalizedFeed.request,
    aiTier: 0,
    seedTexts: seedTextsFromProfile(typedProfile),
    preferenceLedger: cleanPreferenceLedger(typedProfile?.preference_ledger),
    topN: typedProfile?.paper_count ?? 10,
    controls: feedControlsFromProfile(typedProfile),
  });

  const firstName = typedProfile?.display_name?.trim().split(/\s+/)[0] || undefined;
  const normalizedDestination = normalizeEmailAddress(destination);
  const result = await sendDigestEmail({
    to: normalizedDestination,
    firstName,
    items: feed.items,
    originUrl: originUrlFor(req),
  });

  if (!result.sent) {
    // §1al POLISH-1-EMAIL (g) — never the provider's raw text, in the
    // response or the log; the page owns every sentence, keyed by `reason`
    // alone. No counter refund (the daily send was already spent above).
    console.error(
      `[profile/send-test-email] send failed: ${describeSendFailureForLog(result)}`,
    );
    return NextResponse.json(
      { sent: false, reason: classifySendFailure(result) },
      { status: 502 },
    );
  }

  return NextResponse.json({ sent: true, to: normalizedDestination });
}

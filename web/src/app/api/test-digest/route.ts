// POST /api/test-digest
//
// Manual smoke-test for digest email wiring. Runs the feed pipeline for
// the signed-in user's topics and emails the result to their auth email.
// Unlike the cron dispatcher, this ignores digest_enabled, frequency,
// and time-of-day — it fires immediately.
//
// Does NOT insert into briefing_deliveries (this is for testing, not a
// real delivery).

import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { canUseLocalServerProvider } from "@/lib/llm/providers/registry";
import { runFeedPipeline } from "@/lib/feed/pipeline";
import type { FeedControls } from "@/lib/feed/profile-compiler";
import { sendDigestEmail } from "@/lib/email/send-digest";
import { cleanPreferenceLedger } from "@/lib/preferences/ledger";
import type { PreferenceLedger } from "@/types";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function originUrlFor(req: NextRequest): string {
  const explicit = process.env.NEXT_PUBLIC_SITE_URL;
  if (explicit) return explicit.replace(/\/$/, "");
  const proto = req.headers.get("x-forwarded-proto") ?? "https";
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  if (host) return `${proto}://${host}`;
  return "https://hermes-flax-six.vercel.app";
}

interface TestProfileRow {
  display_name: string | null;
  research_topics: string[] | null;
  preferred_methods: string[] | null;
  current_project: string | null;
  current_challenges: string | null;
  disliked_topics: string[] | null;
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
}

function seedTextsFromProfile(profile: TestProfileRow | null): string[] {
  return [profile?.current_project, profile?.current_challenges]
    .map((text) => text?.trim())
    .filter((text): text is string => Boolean(text));
}

function feedControlsFromProfile(profile: TestProfileRow | null): FeedControls {
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
  // Development only. This runs the full feed pipeline and sends an email,
  // bypassing digest_enabled, frequency and time-of-day — so on a deployed
  // instance any signed-in visitor could spend the operator's model and email
  // budget at will. Its sibling diagnostic api/digest/test was already gated
  // this way; this one was not.
  if (!canUseLocalServerProvider()) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }
  if (!user.email) {
    return NextResponse.json({ error: "auth user has no email" }, { status: 400 });
  }

  const { data: profile, error: profErr } = await supabase
    .from("profiles")
    .select(
      "display_name, research_topics, preferred_methods, current_project, current_challenges, disliked_topics, preference_ledger, feed_focus, feed_freshness, paper_count, feed_source_mix, feed_importance, feed_method_mode, feed_discovery_mode, feed_avoid_reviews, feed_avoid_old_papers, feed_avoid_broad_surveys",
    )
    .eq("user_id", user.id)
    .maybeSingle();

  if (profErr) {
    return NextResponse.json({ error: profErr.message }, { status: 500 });
  }
  const typedProfile = profile as TestProfileRow | null;
  const topics = typedProfile?.research_topics ?? [];
  if (topics.length === 0) {
    return NextResponse.json(
      { error: "no research topics set on profile — add some first" },
      { status: 400 },
    );
  }

  const feed = await runFeedPipeline({
    topics,
    methods: typedProfile?.preferred_methods?.length
      ? typedProfile.preferred_methods
      : undefined,
    seedTexts: seedTextsFromProfile(typedProfile),
    preferenceLedger: cleanPreferenceLedger(typedProfile?.preference_ledger),
    negativeTopics: typedProfile?.disliked_topics ?? undefined,
    topN: typedProfile?.paper_count ?? 10,
    controls: feedControlsFromProfile(typedProfile),
  });

  const firstName =
    typedProfile?.display_name?.trim().split(/\s+/)[0] || undefined;

  const result = await sendDigestEmail({
    to: user.email,
    firstName,
    items: feed.items,
    originUrl: originUrlFor(req),
  });

  return NextResponse.json({
    to: user.email,
    items_count: feed.items.length,
    ...result,
  });
}

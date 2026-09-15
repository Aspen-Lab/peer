// GET /api/jobs/dispatch-digests
//
// Cron-triggered hourly. For each enabled user whose local hour matches
// the current hour in their timezone (and whose frequency rule admits
// today), runs the feed pipeline and writes a `briefing_deliveries` row.
//
// Triggered by Vercel Cron per vercel.json. Every invocation must carry the
// shared CRON_SECRET. Merely claiming to be a cron request is not trusted.

import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { runFeedPipeline } from "@/lib/feed/pipeline";
import type { FeedControls } from "@/lib/feed/profile-compiler";
import { sendDigestEmail } from "@/lib/email/send-digest";
import { cleanPreferenceLedger } from "@/lib/preferences/ledger";
import type { PreferenceLedger } from "@/types";

function originUrlFor(req: NextRequest): string {
  // Prefer explicit override; fall back to the request origin (Vercel sets
  // x-forwarded-host). Strip trailing slash.
  const explicit = process.env.NEXT_PUBLIC_SITE_URL;
  if (explicit) return explicit.replace(/\/$/, "");
  const proto = req.headers.get("x-forwarded-proto") ?? "https";
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  if (host) return `${proto}://${host}`;
  return "https://hermes-flax-six.vercel.app";
}

export const dynamic = "force-dynamic";
export const maxDuration = 300; // 5 minutes — digest runs may hit multiple source APIs

interface ProfileRow {
  user_id: string;
  display_name: string | null;
  research_topics: string[];
  preferred_methods: string[];
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
  digest_enabled: boolean;
  digest_hour_local: number;
  digest_timezone: string;
  digest_channel: "inapp" | "email" | "both";
  digest_frequency: "daily" | "weekdays" | "weekly" | "off";
  digest_email: string | null;
}

// Returns the hour (0–23) of the given instant in the given IANA timezone.
function hourInTimezone(instant: Date, tz: string): number {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hour: "numeric",
      hour12: false,
    }).formatToParts(instant);
    const hourPart = parts.find((p) => p.type === "hour")?.value ?? "0";
    // "24" can appear for midnight depending on runtime — normalize.
    const h = parseInt(hourPart, 10) % 24;
    return Number.isFinite(h) ? h : -1;
  } catch {
    return -1;
  }
}

// Returns 0 (Sun) – 6 (Sat) for the given instant in the given timezone.
function weekdayInTimezone(instant: Date, tz: string): number {
  try {
    const name = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      weekday: "short",
    }).format(instant);
    return ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(name);
  } catch {
    return -1;
  }
}

function frequencyAdmitsToday(
  frequency: ProfileRow["digest_frequency"],
  weekday: number,
): boolean {
  if (frequency === "off") return false;
  if (frequency === "daily") return true;
  if (frequency === "weekdays") return weekday >= 1 && weekday <= 5;
  if (frequency === "weekly") return weekday === 1; // Monday digest
  return false;
}

function seedTextsFromRow(row: ProfileRow): string[] {
  return [row.current_project, row.current_challenges]
    .map((text) => text?.trim())
    .filter((text): text is string => Boolean(text));
}

function feedControlsFromRow(row: ProfileRow): FeedControls {
  return {
    focus: row.feed_focus ?? undefined,
    freshness: row.feed_freshness ?? undefined,
    paperCount: row.paper_count ?? undefined,
    sourceMix: row.feed_source_mix ?? undefined,
    importance: row.feed_importance ?? undefined,
    methodMode: row.feed_method_mode ?? undefined,
    discoveryMode: row.feed_discovery_mode ?? undefined,
    avoidReviews: row.feed_avoid_reviews ?? undefined,
    avoidOldPapers: row.feed_avoid_old_papers ?? undefined,
    avoidBroadSurveys: row.feed_avoid_broad_surveys ?? undefined,
  };
}

export async function GET(req: NextRequest) {
  // Auth: require the shared secret for both Vercel and manual invocations.
  const secret = process.env.CRON_SECRET;
  const authHeader = req.headers.get("authorization") ?? "";
  const hasSecret = Boolean(secret && authHeader === `Bearer ${secret}`);
  if (!hasSecret) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();
  const now = new Date();

  // Only fetch profiles that might fire today — rough pre-filter on
  // digest_enabled + frequency != off. Hour/timezone check happens per row.
  const { data, error } = await admin
    .from("profiles")
    .select(
      "user_id, display_name, research_topics, preferred_methods, current_project, current_challenges, disliked_topics, preference_ledger, feed_focus, feed_freshness, paper_count, feed_source_mix, feed_importance, feed_method_mode, feed_discovery_mode, feed_avoid_reviews, feed_avoid_old_papers, feed_avoid_broad_surveys, digest_enabled, digest_hour_local, digest_timezone, digest_channel, digest_frequency, digest_email",
    )
    .eq("digest_enabled", true)
    .neq("digest_frequency", "off");

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const rows = (data ?? []) as ProfileRow[];
  const dispatched: string[] = [];
  const skipped: { user_id: string; reason: string }[] = [];
  const failed: { user_id: string; error: string }[] = [];
  const emailsSent: { user_id: string; messageId?: string }[] = [];
  const emailsFailed: { user_id: string; error: string }[] = [];
  const originUrl = originUrlFor(req);

  for (const row of rows) {
    const hour = hourInTimezone(now, row.digest_timezone);
    if (hour !== row.digest_hour_local) {
      skipped.push({ user_id: row.user_id, reason: `hour ${hour} != ${row.digest_hour_local}` });
      continue;
    }
    const weekday = weekdayInTimezone(now, row.digest_timezone);
    if (!frequencyAdmitsToday(row.digest_frequency, weekday)) {
      skipped.push({ user_id: row.user_id, reason: `frequency ${row.digest_frequency} skips today` });
      continue;
    }
    if (!row.research_topics || row.research_topics.length === 0) {
      skipped.push({ user_id: row.user_id, reason: "no topics" });
      continue;
    }

    try {
      // De-dup guard: don't double-send within 6h of the last delivery.
      const sixHoursAgo = new Date(now.getTime() - 6 * 60 * 60 * 1000).toISOString();
      const { data: recent } = await admin
        .from("briefing_deliveries")
        .select("id")
        .eq("user_id", row.user_id)
        .gte("delivered_at", sixHoursAgo)
        .limit(1);
      if (recent && recent.length > 0) {
        skipped.push({ user_id: row.user_id, reason: "recent delivery" });
        continue;
      }

      // Collect paper IDs delivered to this user in the past 30 days so we
      // can exclude them from today's recommendations.
      const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();
      const { data: pastDeliveries } = await admin
        .from("briefing_deliveries")
        .select("item_ids")
        .eq("user_id", row.user_id)
        .gte("delivered_at", thirtyDaysAgo);
      const seenIds = new Set<string>(
        (pastDeliveries ?? []).flatMap((d) => (d.item_ids as string[] | null) ?? []),
      );

      const targetCount = row.paper_count ?? 10;
      // Push the dedup down into the pipeline: it now filters seen IDs after
      // ranking but BEFORE topN slicing, so we get a full set of fresh items
      // without over-fetching 3x. The post-filter below is kept as a defensive
      // belt-and-suspenders in case the pipeline returns extra items.
      const feed = await runFeedPipeline({
        topics: row.research_topics,
        methods: row.preferred_methods.length > 0 ? row.preferred_methods : undefined,
        seedTexts: seedTextsFromRow(row),
        preferenceLedger: cleanPreferenceLedger(row.preference_ledger),
        negativeTopics: row.disliked_topics ?? undefined,
        topN: targetCount,
        controls: feedControlsFromRow(row),
        excludeIds: Array.from(seenIds),
        // ABC-freemium 1-08 · R-SEC-4 · **D9.** The old reason here was that a
        // scheduled job cannot reach a browser user's private BYOK key. That
        // stopped being the reason the moment a system key existed: this cron
        // could now afford a model. D9 says it must not. Users who never open
        // the app must cost nothing, so the nightly digest stays deterministic
        // even though a system key is available. Revisit after launch.
        //
        // The same paragraph covers the other half, and the two facts belong
        // together: this call passes **no `systemSearchAllowed`**, so it takes
        // the `false` default in `lib/search/system-key.ts` and spends no system
        // Tavily key on behalf of every enrolled user either. A future reader
        // removing one of these should see the other.
        aiTier: 0,
      });

      const freshItems = feed.items.filter((i) => !seenIds.has(i.id)).slice(0, targetCount);
      const itemIds = freshItems.map((i) => i.id);
      const { error: insertErr } = await admin
        .from("briefing_deliveries")
        .insert({
          user_id: row.user_id,
          channel: row.digest_channel,
          item_ids: itemIds,
          payload: { items: freshItems },
        });

      if (insertErr) {
        failed.push({ user_id: row.user_id, error: insertErr.message });
        continue;
      }

      dispatched.push(row.user_id);

      // Email delivery — fire only when user picked email or both.
      // Never block the cron loop on mail failures; they're reported out
      // alongside the per-user result.
      if (row.digest_channel === "email" || row.digest_channel === "both") {
        // Prefer the user's custom digest address; fall back to their OAuth email.
        const customEmail = row.digest_email?.trim();
        let to = customEmail || null;
        if (!to) {
          const { data: userData } = await admin.auth.admin.getUserById(row.user_id);
          to = userData?.user?.email ?? null;
        }
        if (!to) {
          emailsFailed.push({ user_id: row.user_id, error: "no email on auth user" });
        } else {
          const firstName = row.display_name?.trim().split(/\s+/)[0] || undefined;
          const result = await sendDigestEmail({
            to,
            firstName,
            items: freshItems,
            originUrl,
          });
          if (result.sent) {
            emailsSent.push({ user_id: row.user_id, messageId: result.messageId });
          } else {
            emailsFailed.push({ user_id: row.user_id, error: result.error ?? "unknown" });
          }
        }
      }
    } catch (err) {
      failed.push({
        user_id: row.user_id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return NextResponse.json({
    ran_at: now.toISOString(),
    dispatched_count: dispatched.length,
    dispatched,
    skipped_count: skipped.length,
    failed_count: failed.length,
    failed,
    emails_sent_count: emailsSent.length,
    emails_sent: emailsSent,
    emails_failed_count: emailsFailed.length,
    emails_failed: emailsFailed,
  });
}

// GET /api/jobs/dispatch-digests
//
// Cron-triggered hourly. For each enabled user whose local hour matches
// the current hour in their timezone (and whose frequency rule admits
// today), runs the feed pipeline and writes a `briefing_deliveries` row.
//
// Triggered by Vercel Cron per vercel.json. Every invocation must carry the
// shared CRON_SECRET. Merely claiming to be a cron request is not trusted.

import { createHash } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { runFeedPipeline } from "@/lib/feed/pipeline";
import type { FeedControls } from "@/lib/feed/profile-compiler";
import { sendDigestEmail } from "@/lib/email/send-digest";
import {
  renderDigestHtml,
  renderDigestPlaintext,
  renderDigestSubject,
} from "@/lib/email/digest-template";
import { cleanPreferenceLedger } from "@/lib/preferences/ledger";
import type { PreferenceLedger } from "@/types";
import type { FeedRequest } from "@/lib/feed/types";
import type { ScoredItem } from "@/lib/scoring/types";
import { normalizeFeedIntent, textValue } from "@/lib/feed/intent";
import { dateInTimezone, hourInTimezone, weekdayInTimezone } from "@/lib/dashboard/timezone";
import { handleConflictingEmailClaim, persistDigestEmailAttempt } from "@/lib/email/digest-retry";
import {
  classifySendFailure,
  describeSendFailureForLog,
  redactEmailAddresses,
} from "@/lib/email/send-failure";

// EMAIL-TOKEN-PRIVACY (ABC-JEV-INTEGRATION.md §1as, folding in B's adjacent
// findings P15/P16/P18): this route's JSON response is what
// .github/workflows/digest-cron.yml prints into its (now-public repo) GitHub
// Actions run log every hour. The response must therefore carry ONLY counts
// and a fixed, closed vocabulary of reason codes — never a raw provider
// error message (which, per EMAIL-SETTINGS-B F7, can itself name an email
// address in Resend's sandbox-sender case) and never a per-reader user_id
// list (skipped/failed/dispatched/emails_sent/emails_failed were all
// previously arrays of `{user_id, ...}`). Per-reader detail — which user,
// which exact reason — still goes to the server's own (private) log via
// `logJobIssue` below, redacted with the same POLISH-1 helpers
// confirm-email/route.ts and send-test-email/route.ts already use. Mirrors
// the tally shape `runDrainPhase` in prepare-dashboards/route.ts already
// uses for `outcomes` (Record<code, count>) — same convention, applied here
// too. Exported (like `digestFeedRequestFromProfile`/`digestIdempotencyKey`/
// `isDigestDedupeEnabled` above them) so prepare-dashboards/route.ts's own
// email-retry phase — which reuses `handleConflictingEmailClaim` from
// digest-retry.ts and faces the exact same response-shaping requirement —
// applies the identical fixed-code vocabulary instead of a second,
// drift-prone copy.
export function bumpReason(tally: Record<string, number>, code: string): void {
  tally[code] = (tally[code] ?? 0) + 1;
}

/** One private (server-log-only) line per per-reader issue. Never reaches
 * the HTTP response. `detail` is redacted defensively even for non-email
 * errors (a DB/RPC error message is not expected to contain an address, but
 * redaction is cheap and this costs nothing to apply uniformly). */
export function logJobIssue(route: string, userId: string, code: string, detail: string): void {
  console.warn(`[${route}] user ${userId} ${code}: ${redactEmailAddresses(detail)}`);
}

/** Fixed-code classification for a digest-retry.ts `ConflictOutcome` whose
 * `kind` is "skip" — its `reason` field is always one of a small closed set
 * of strings this module itself produces (never attacker- or
 * provider-controlled), listed exhaustively below; the default case only
 * guards against this file and digest-retry.ts drifting apart, and is never
 * expected to fire. */
export function conflictSkipReasonCode(reason: string): string {
  switch (reason) {
    case "digest already claimed for this local date":
      return "already_claimed";
    case "digest already sent for this local date":
      return "already_sent";
    case "digest email attempt expired unsent (>23h, not retried)":
      return "retry_expired";
    case "digest email retry already in progress (concurrent idempotent request)":
      return "retry_in_progress";
    default:
      return "retry_skipped_other";
  }
}

// P4-S7-IDEM (Round 3) -- ABC-JEV-INTEGRATION.md §4 "P4-S7-IDEM B complete"
// ruling; design doc docs/jev-abc/P4-S7-IDEM-B-20260924T113658Z.md. Renders
// the digest content directly in THIS file (not through a new export added
// to send-digest.ts) specifically so this route can persist the exact
// rendered bytes to `briefing_deliveries.payload.email` BEFORE calling
// `sendDigestEmail` -- required so a claim-succeeded-but-send-failed row
// (including a THROWN send error, not just a resolved failure) still has a
// replayable body for a later run. `digest-template.ts` is read-only and
// unedited by this item; this is a second, ordinary caller of its existing,
// unchanged exports (send-digest.ts's own default-render path, used
// whenever no `render` override is passed in, remains the first).
type AdminClient = ReturnType<typeof createAdminClient>;

/** SHA-256 hex digest -- deterministic, collision-resistant, carries no raw
 * personal data (see idempotency.test.ts's dedicated `digestIdempotencyKey`
 * suite). Reused unchanged on every retry for a given (user_id, local_date)
 * so Resend's own idempotency arbitration (24h window, VERIFIED in the B
 * guide above) is what actually prevents a double send -- this key is an
 * input to that mechanism, not itself the safety net. */
export function digestIdempotencyKey(userId: string, localDate: string): string {
  const material = `peer-digest-email:v1:${userId}:${localDate}`;
  return createHash("sha256").update(material).digest("hex");
}

// TRIGGER-A (ABC-JEV-INTEGRATION.md §1x) -- `handleConflictingEmailClaim`,
// `persistDigestEmailAttempt`, `ExistingBriefingRow`,
// `IDEMPOTENCY_REPLAY_WINDOW_MS` moved to web/src/lib/email/digest-retry.ts
// (byte-identical bodies -- see that module's header) so the new
// GET /api/jobs/prepare-dashboards route's email-retry phase can reuse this
// exact decision ladder instead of a second copy. This route now imports
// `handleConflictingEmailClaim` back; every other symbol below is unchanged.
// route.test.ts / idempotency.test.ts import only `GET`/`digestIdempotencyKey`
// from this file (never these moved symbols directly), so this extraction
// needed no test-file edit and both suites pass unchanged.

// P4-S7-IDEM first-attempt path (claim just succeeded, this is the FIRST
// time this (user_id, local_date) email is being attempted). Renders once,
// persists the pending record BEFORE sending (best-effort -- see
// persistDigestEmailAttempt), sends with the key, and on a CONFIRMED
// success replaces the pending record with a bare `{sent,sentAt}` (no body
// kept, per the §4 ruling). On any failure the pending record is left
// exactly as the pre-send write left it, so a later conflicting claim can
// replay it (handleConflictingEmailClaim above).
async function sendFirstDigestAttemptWithIdempotency(params: {
  admin: AdminClient;
  deliveryId: number;
  currentPayload: { items?: unknown[] };
  to: string;
  firstName?: string;
  items: ScoredItem[];
  originUrl: string;
  idempotencyKey: string;
}) {
  const { admin, deliveryId, currentPayload, to, firstName, items, originUrl, idempotencyKey } = params;

  const render = {
    subject: renderDigestSubject(items),
    html: renderDigestHtml({ firstName, items, originUrl }),
    text: renderDigestPlaintext({ firstName, items, originUrl }),
  };
  const attemptedAt = new Date().toISOString();

  await persistDigestEmailAttempt(admin, deliveryId, currentPayload, {
    idempotencyKey,
    to,
    subject: render.subject,
    html: render.html,
    text: render.text,
    attemptedAt,
  });

  const result = await sendDigestEmail({ to, firstName, items, originUrl, idempotencyKey, render });

  if (result.sent) {
    await persistDigestEmailAttempt(admin, deliveryId, currentPayload, {
      sent: true,
      sentAt: new Date().toISOString(),
    });
  }
  return result;
}

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

// TRIGGER-A -- `export` added (purely additive, zero behaviour change) so
// web/src/app/api/jobs/prepare-dashboards/route.ts can reuse this exact
// shape/logic instead of a second copy — same treatment
// `digestFeedRequestFromProfile` itself already got "for reuse".
export interface ProfileRow {
  user_id: string;
  display_name: string | null;
  research_topics: string[];
  preferred_methods: string[];
  current_project: string | null;
  current_challenges: string | null;
  disliked_topics: string[] | null;
  /** Unapplied P1 column; helpers accept it for offline transport parity only. */
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
  digest_enabled: boolean;
  digest_hour_local: number;
  digest_timezone: string;
  digest_channel: "inapp" | "email" | "both";
  digest_frequency: "daily" | "weekdays" | "weekly" | "off";
  digest_email: string | null;
}

// hourInTimezone/weekdayInTimezone/dateInTimezone moved to
// web/src/lib/dashboard/timezone.ts in P4-S8b (Round 3) — see that module's
// header. Extraction is behaviour-preserving (byte-identical bodies); this
// route now imports them instead of declaring them locally. Second caller:
// web/src/lib/dashboard/prepare-due.ts reuses the same functions for the
// prepare-job queue's due-time math, per DESIGN B4's "reuse, don't
// re-derive a third time" instruction.

// P4-S7 (Round 3) — F-A-P4-07/F-A-P4-04, ABC-JEV-INTEGRATION.md §1p.C.10. The
// migration this flag guards (web/supabase/migrations/
// 20260924000300_briefing_deliveries_dedupe.sql) adds a nullable
// `local_date` column to the EXISTING, already-applied `briefing_deliveries`
// table. Code must not write that column before the migration is separately
// authorized and applied, so every dedupe-guard path below sits behind this
// one server-only flag: the value is trimmed and lower-cased before the
// check, so "on", "On", "ON", and " on " all enable it, but anything that
// isn't the word "on" (absent, "true", "1", misspelled) keeps today's
// plain-insert behaviour byte-for-byte. Mirrors the sibling P4
// dashboard-ledger flag's exact trim-and-lower-case/anything-else
// convention (web/src/app/api/feed/route.ts) — see that file for the
// precedent; this route never reads or imports that flag or module (§1p.C.2:
// email and dashboard delivery state stay fully independent).
export function isDigestDedupeEnabled(): boolean {
  return process.env.PEER_DIGEST_DEDUPE?.trim().toLowerCase() === "on";
}

export function frequencyAdmitsToday(
  frequency: ProfileRow["digest_frequency"],
  weekday: number,
): boolean {
  if (frequency === "off") return false;
  if (frequency === "daily") return true;
  if (frequency === "weekdays") return weekday >= 1 && weekday <= 5;
  if (frequency === "weekly") return weekday === 1; // Monday digest
  return false;
}

export function seedTextsFromRow(row: ProfileRow): string[] {
  return [row.current_project, row.current_challenges]
    .map((text) => text?.trim())
    .filter((text): text is string => Boolean(text));
}

export function feedControlsFromRow(row: ProfileRow): FeedControls {
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

/** Shared retrieval-only conversion; owner/schedule/delivery stay in the caller. */
export function digestFeedRequestFromProfile(
  row: Pick<ProfileRow, "research_topics" | "preferred_methods" | "current_project" | "current_challenges" | "disliked_topics" | "feed_intent">,
): { ok: true; request: Pick<FeedRequest, "topics" | "softTopics" | "methods" | "negativeTopics" | "project" | "challenge" | "intent"> } | { ok: false; reason: "intent_required" } {
  const legacy = {
    project: row.current_project,
    challenge: row.current_challenges,
    topics: row.research_topics,
    methods: row.preferred_methods,
    exclusions: row.disliked_topics,
  };
  const normalized = normalizeFeedIntent(row.feed_intent ? { intent: row.feed_intent } : legacy);
  if (!normalized.ok) return normalized;
  const { intent } = normalized;
  return {
    ok: true,
    request: {
      topics: intent.requiredConcepts,
      softTopics: intent.preferredConcepts.length ? intent.preferredConcepts : undefined,
      methods: intent.methods.length ? intent.methods : undefined,
      negativeTopics: intent.exclusions.length ? intent.exclusions.map((entry) => entry.value) : undefined,
      project: textValue(intent.project),
      challenge: textValue(intent.challenge),
      intent,
    },
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
  let dispatchedCount = 0;
  let emailsSentCount = 0;
  const skippedReasons: Record<string, number> = {};
  const failedReasons: Record<string, number> = {};
  const emailsFailedReasons: Record<string, number> = {};
  const originUrl = originUrlFor(req);

  for (const row of rows) {
    const hour = hourInTimezone(now, row.digest_timezone);
    if (hour !== row.digest_hour_local) {
      bumpReason(skippedReasons, "hour_mismatch");
      continue;
    }
    const weekday = weekdayInTimezone(now, row.digest_timezone);
    if (!frequencyAdmitsToday(row.digest_frequency, weekday)) {
      bumpReason(skippedReasons, "frequency_skip");
      continue;
    }
    const normalizedFeed = digestFeedRequestFromProfile(row);
    if (!normalizedFeed.ok) {
      bumpReason(skippedReasons, "intent_required");
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
        bumpReason(skippedReasons, "recent_delivery");
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
        ...normalizedFeed.request,
        seedTexts: seedTextsFromRow(row),
        preferenceLedger: cleanPreferenceLedger(row.preference_ledger),
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
      const isEmailChannel = row.digest_channel === "email" || row.digest_channel === "both";

      // P4-S7-IDEM: set only on the flag-on path, used later by the shared
      // email block below to decide whether to attach a Resend idempotency
      // key and pre/post-send bookkeeping. Both stay `undefined` on the
      // flag-off path, which keeps that path byte-identical to before this
      // item (see the "flag off" test in idempotency.test.ts).
      let claimedRowId: number | undefined;
      let idempotencyKeyForEmail: string | undefined;

      if (isDigestDedupeEnabled()) {
        // F-A-P4-07: claim today's row through the atomic RPC (see the
        // migration) instead of a plain insert, so two overlapping
        // invocations for the same user/local-date can never both "win".
        // Zero rows back means someone else already claimed today — that's
        // a successful de-dup, not a failure, so it goes to `skipped`,
        // never `failed`. The 6h/30-day briefing_deliveries reads above are
        // unchanged and stay the cheap pre-check; this is the authoritative
        // guard.
        const localDate = dateInTimezone(now, row.digest_timezone);
        if (!localDate) {
          bumpReason(failedReasons, "local_date_unavailable");
          continue;
        }
        // P4-S7-IDEM: pure function of (user_id, local_date) -- computed
        // whether this claim wins or conflicts, since the conflict branch
        // needs the identical key to look up/replay an earlier attempt.
        if (isEmailChannel) {
          idempotencyKeyForEmail = digestIdempotencyKey(row.user_id, localDate);
        }
        const { data: claimed, error: claimErr } = await admin.rpc(
          "claim_briefing_delivery",
          {
            p_user_id: row.user_id,
            p_local_date: localDate,
            p_channel: row.digest_channel,
            p_item_ids: itemIds,
            p_payload: { items: freshItems },
          },
        );
        if (claimErr) {
          bumpReason(failedReasons, "claim_error");
          logJobIssue("jobs/dispatch-digests", row.user_id, "claim_error", claimErr.message);
          continue;
        }
        if (!claimed || claimed.length === 0) {
          if (!isEmailChannel) {
            // Unchanged: an in-app-only row has no email leg to retry.
            bumpReason(skippedReasons, "already_claimed");
            continue;
          }
          // P4-S7-IDEM: this user/day was already claimed by an earlier
          // invocation. Distinguish "already sent" (still skip) from
          // "claimed but never successfully emailed" (F-A-P4S7-01 -- now
          // safely retryable) instead of unconditionally skipping.
          const outcome = await handleConflictingEmailClaim({
            admin,
            userId: row.user_id,
            localDate,
            idempotencyKey: idempotencyKeyForEmail!,
            now,
          });
          if (outcome.kind === "sent") {
            emailsSentCount += 1;
          } else if (outcome.kind === "failed") {
            // EMAIL-TOKEN-PRIVACY: `outcome.error` may carry Resend's own
            // raw message (can name an address in the sandbox-sender case,
            // same as the direct send path below) -- classified to a fixed
            // code for the response, raw text only to the private log.
            const code = classifySendFailure({ error: outcome.error });
            bumpReason(emailsFailedReasons, code);
            logJobIssue("jobs/dispatch-digests", row.user_id, code, outcome.error);
          } else {
            bumpReason(skippedReasons, conflictSkipReasonCode(outcome.reason));
          }
          continue;
        }
        claimedRowId = claimed[0]?.id as number | undefined;
      } else {
        // Flag off (default): byte-for-byte the original insert. Must NOT
        // write `local_date` — the column doesn't exist in production until
        // the migration above is separately authorized and applied.
        const { error: insertErr } = await admin
          .from("briefing_deliveries")
          .insert({
            user_id: row.user_id,
            channel: row.digest_channel,
            item_ids: itemIds,
            payload: { items: freshItems },
          });

        if (insertErr) {
          bumpReason(failedReasons, "insert_error");
          logJobIssue("jobs/dispatch-digests", row.user_id, "insert_error", insertErr.message);
          continue;
        }
      }

      dispatchedCount += 1;

      // Email delivery — fire only when user picked email or both.
      // Never block the cron loop on mail failures; they're reported out
      // alongside the per-user result.
      if (isEmailChannel) {
        // Prefer the user's custom digest address; fall back to their OAuth email.
        const customEmail = row.digest_email?.trim();
        let to = customEmail || null;
        if (!to) {
          const { data: userData } = await admin.auth.admin.getUserById(row.user_id);
          to = userData?.user?.email ?? null;
        }
        if (!to) {
          bumpReason(emailsFailedReasons, "no_email");
        } else {
          const firstName = row.display_name?.trim().split(/\s+/)[0] || undefined;
          const result =
            claimedRowId !== undefined && idempotencyKeyForEmail
              ? await sendFirstDigestAttemptWithIdempotency({
                  admin,
                  deliveryId: claimedRowId,
                  currentPayload: { items: freshItems },
                  to,
                  firstName,
                  items: freshItems,
                  originUrl,
                  idempotencyKey: idempotencyKeyForEmail,
                })
              : await sendDigestEmail({ to, firstName, items: freshItems, originUrl });
          if (result.sent) {
            emailsSentCount += 1;
          } else {
            // EMAIL-TOKEN-PRIVACY (§1as, folding in B's P15/P16): Resend's
            // raw error text can name an address (EMAIL-SETTINGS-B F7's
            // sandbox-sender case) -- classified to a fixed code for the
            // response, same as confirm-email/route.ts and
            // send-test-email/route.ts already do; raw text only to the
            // private server log.
            const code = classifySendFailure(result);
            bumpReason(emailsFailedReasons, code);
            logJobIssue("jobs/dispatch-digests", row.user_id, code, describeSendFailureForLog(result));
          }
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      bumpReason(failedReasons, "pipeline_error");
      logJobIssue("jobs/dispatch-digests", row.user_id, "pipeline_error", message);
    }
  }

  return NextResponse.json({
    ran_at: now.toISOString(),
    // EMAIL-TOKEN-PRIVACY (ABC-JEV-INTEGRATION.md §1as): counts and fixed
    // reason-code tallies only -- no per-reader user_id list and no raw
    // provider/DB error text (this response is what the public-repo GitHub
    // Actions log prints every hour). Per-reader detail is in the server's
    // own private log (see `logJobIssue` above).
    dispatched_count: dispatchedCount,
    skipped_count: Object.values(skippedReasons).reduce((a, b) => a + b, 0),
    skipped_reasons: skippedReasons,
    failed_count: Object.values(failedReasons).reduce((a, b) => a + b, 0),
    failed_reasons: failedReasons,
    emails_sent_count: emailsSentCount,
    emails_failed_count: Object.values(emailsFailedReasons).reduce((a, b) => a + b, 0),
    emails_failed_reasons: emailsFailedReasons,
  });
}

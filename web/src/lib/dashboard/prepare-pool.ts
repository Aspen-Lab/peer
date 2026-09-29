// TRIGGER-A (ABC-JEV-INTEGRATION.md §1x; guide docs/jev-abc/
// TRIGGER-A-B-20260925T044825Z.md §3 Step 2) — the real `buildPool`
// implementation prepare-worker.ts's `PrepareWorkerDeps.buildPool` has never
// had (see that module's own header: "no implementation of it exists
// anywhere in the repo... the single largest gap between 'built' and
// 'callable'").
//
// Deliberately an INDEPENDENT small reimplementation of
// web/src/app/api/feed/route.ts's `runLedgerAwareFeed` "no batch yet" steps
// (exclusions read, runFeedPipeline call, PaperIdentity mapping) rather than
// extracting a shared helper out of that file — the guide's own §3 Step 2
// explicitly allows either, "C picks based on how live route.ts is at
// pickup time." feed/route.ts is a large, heavily-tested file (P4-S3/P4-S6/
// P4-S6-FIX/P4-S9 all touched it) that is outside this item's assigned
// scope; zero changes to it is the lower-risk path. The ~15 duplicated
// lines below are simple and stable (read exclusions, run the pipeline, map
// identities) — see the C checkpoint for this decision recorded plainly.
//
// P6 (ABC-JEV-INTEGRATION.md §1x) — explicit EMPTY seed arrays
// (positiveSeeds/negativeSeedPaperIds below), a named accepted cost: a
// prepare-ahead-minted batch never reflects seed-channel feedback a
// same-moment visit-minted batch would. Threshold named by the ruling:
// before any positive/negative-seed channel flag is switched on in
// production together with PEER_DASHBOARD_PREPARE, B designs parity.
//
// P7 (ABC-JEV-INTEGRATION.md §1x) — no rollover-remainder write here (unlike
// runLedgerAwareFeed's mint path): `PrepareWorkerDeps` exposes no rollover
// store, and widening it is exactly the "changes an already-VERIFIED
// contract beyond the additive changes the guide names" case the escape
// clause describes. Named accepted cost: a prepare-ahead-minted batch
// contributes nothing to tomorrow's rollover pool; visit-minted batches are
// unaffected.
//
// P7b (ABC-JEV-INTEGRATION.md §1x, added after finding F-TRIGGERA-A-01) —
// the runFeedPipeline call below also never passes `rolloverCandidates` (the
// READ side, distinct from P7's WRITE side above), so a prepare-ahead-minted
// batch's candidate pool can never include a paper that rolled over unshown
// from a prior day, while a same-moment visit mint could; narrower only,
// never wider, never re-delivers anything already shown — adding it later is
// a conscious decision, not an oversight (see the dedicated protective test
// in prepare-pool.test.ts).
//
// P8 (ABC-JEV-INTEGRATION.md §1x) — aiTier 0 always, borrowing
// dispatch-digests/route.ts's own "D9" rationale verbatim: a user who has
// not visited yet must cost nothing beyond deterministic source fetches.
//
// Deliberately does NOT build a `paperCacheScope` (unlike a real visit's
// `runLedgerAwareFeed`, which threads one through from an authenticated
// session): dispatch-digests/route.ts's own existing `runFeedPipeline` call
// -- the precedent this whole slice is told to mirror for cost/aiTier
// reasons -- never builds one either. `job.ownerId`/`job.localDate` (not
// anything derived from a paperCacheScope) are what key the ledger write,
// via prepare-worker.ts's own `deps.ledger.prepareBatch` call, so this
// costs nothing for correctness -- only a possible private-pool-cache reuse
// opportunity, deliberately deferred rather than risked this slice.
import { runFeedPipeline } from "@/lib/feed/pipeline";
import { identityForRawItem } from "@/lib/feed/paper-identity";
import { createAdminClient } from "@/lib/supabase/admin";
import { cleanPreferenceLedger } from "@/lib/preferences/ledger";
import {
  digestFeedRequestFromProfile,
  feedControlsFromRow,
  seedTextsFromRow,
  type ProfileRow,
} from "@/app/api/jobs/dispatch-digests/route";
import { SupabaseDashboardDeliveryLedger, type DashboardDeliveryLedger, type PaperIdentity } from "./delivery-ledger";
import type { DashboardPrepareJob } from "./prepare-job-repository";
import type { PrepareBuildOutcome } from "./prepare-worker";

type AdminClient = ReturnType<typeof createAdminClient>;

// Same columns dispatch-digests/route.ts's own GET handler selects (kept as
// one literal list here rather than importing the string, since that one
// isn't exported -- ProfileRow's shape IS shared, imported below, so a
// column added to one without the other still fails to compile via the
// `as ProfileRow` cast's own field access, not silently). Exported so
// web/src/app/api/jobs/prepare-dashboards/route.ts's own two profile
// queries (due-selection, fresh-intent re-read) reuse this single copy
// rather than a third one.
export const PROFILE_COLUMNS =
  "user_id, display_name, research_topics, preferred_methods, current_project, current_challenges, disliked_topics, preference_ledger, feed_focus, feed_freshness, paper_count, feed_source_mix, feed_importance, feed_method_mode, feed_discovery_mode, feed_avoid_reviews, feed_avoid_old_papers, feed_avoid_broad_surveys, digest_enabled, digest_hour_local, digest_timezone, digest_channel, digest_frequency, digest_email";

export interface PrepareAheadBuildPoolDeps {
  admin?: AdminClient;
  ledger?: Pick<DashboardDeliveryLedger, "readExclusions">;
  now?: () => Date;
}

/**
 * Builds `PrepareWorkerDeps.buildPool` — the one dependency
 * prepare-worker.ts leaves fully injected and opaque (see that module's
 * header). Reads the owner's profile fresh (same columns
 * dispatch-digests/route.ts's own GET handler selects), reads their ledger
 * exclusions (fail-closed, same as a real visit), and runs the SAME feed
 * pipeline a real visit or the digest cron would, at aiTier 0 with empty
 * seed arrays (P6/P8). Every failure mode returns a typed `{ok:false}`
 * rather than throwing — prepare-worker.ts's own `runPrepareJob` treats
 * that as a retryable job failure (backoff via prepare-due.ts), never an
 * unhandled rejection.
 */
export function createPrepareAheadBuildPool(
  deps: PrepareAheadBuildPoolDeps = {},
): (job: DashboardPrepareJob) => Promise<PrepareBuildOutcome> {
  const admin = deps.admin ?? createAdminClient();
  const ledger = deps.ledger ?? new SupabaseDashboardDeliveryLedger();
  const now = deps.now ?? (() => new Date());

  return async (job: DashboardPrepareJob): Promise<PrepareBuildOutcome> => {
    let row: ProfileRow | null;
    try {
      const { data, error } = await admin
        .from("profiles")
        .select(PROFILE_COLUMNS)
        .eq("user_id", job.ownerId)
        .maybeSingle();
      if (error) return { ok: false, error: `profile_read_failed: ${error.message}` };
      row = (data as ProfileRow | null) ?? null;
    } catch (err) {
      return { ok: false, error: `profile_read_threw: ${err instanceof Error ? err.message : String(err)}` };
    }
    if (!row) return { ok: false, error: "profile_not_found" };

    const normalized = digestFeedRequestFromProfile(row);
    if (!normalized.ok) return { ok: false, error: normalized.reason };

    const exclusionRead = await ledger.readExclusions(job.ownerId);
    if (exclusionRead.status === "unavailable") {
      return { ok: false, error: "ledger_unavailable" };
    }

    try {
      const result = await runFeedPipeline(
        {
          ...normalized.request,
          seedTexts: seedTextsFromRow(row),
          preferenceLedger: cleanPreferenceLedger(row.preference_ledger),
          topN: row.paper_count ?? 10,
          controls: feedControlsFromRow(row),
          // P8 -- borrows dispatch-digests/route.ts's own "D9" rationale.
          aiTier: 0,
        },
        {
          ledgerExclusions: exclusionRead.keys,
          now: now(),
          // P6 -- explicit, deliberate empty arrays, not an omission.
          positiveSeeds: [],
          negativeSeedPaperIds: [],
        },
      );
      const papers: PaperIdentity[] = result.items.map((item) => {
        const identity = identityForRawItem(item);
        return { key: identity.key, aliases: identity.aliases };
      });
      return { ok: true, papers, servedItems: result.items };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  };
}

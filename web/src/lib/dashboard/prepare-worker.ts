// Prepare-job worker (P4-S8b, Round 3) — offline slice, acceptance 13/14.
// ABC-JEV-INTEGRATION.md §3c "Queue" / §1p.C; docs/jev-abc/
// P4-S8-B-20260924T115008Z.md DESIGN B4.
//
// THIS MODULE IS ENTIRELY INERT IN PRODUCTION. Nothing in this campaign
// imports `runPrepareJob` from any route, page, or scheduled job — who or
// what calls it (an admin action, an authenticated internal endpoint, a
// Vercel Cron entry once separately authorized, ...) is USER decision #3
// (POLICY E4/E5 in the B guide above). A grep proving nothing reachable
// imports this file is part of this slice's own gate — see the C
// checkpoint. Building the worker function now, correctly, and leaving it
// unwired is the deliberate shape of this slice: the schema and pure logic
// are ready the moment a trigger is authorized, without front-running that
// decision.
//
// **What this proves OFFLINE (this file + its test):**
//  - The job state machine transitions correctly for every outcome (already
//    prepared, freshly prepared, stale-intent discard, build failure with
//    retry, build failure exhausting attempts).
//  - Fencing: a job whose captured `intentVersion` no longer matches a
//    freshly re-read current value NEVER writes a batch (DESIGN B4's
//    "worker must recheck current intent before publication" — the exact
//    words are §3c's "Snapshot identity: Worker must recheck current
//    intent before publication").
//  - It never marks a batch `served`/`acknowledged` — only ever
//    `prepared`, via `DashboardDeliveryLedger.prepareBatch` — structurally
//    guaranteed by `PrepareWorkerDeps.ledger`'s type (a `Pick` that omits
//    `markServed`/`acknowledgeBatch` entirely, so this file cannot call
//    them even by mistake) and independently checked at runtime by
//    prepare-worker.test.ts's spy-based assertion.
//  - It never throws — every dependency call is wrapped so an unexpected
//    error still returns a typed `failed` outcome and releases the job
//    back to the repository as a retryable (or, once attempts are
//    exhausted, dead) attempt, exactly like a real crash would (the lease
//    simply expires and a later claim reclaims it).
//
// **What stays BLOCKED (needs a real Postgres and/or a real running
// scheduler — §1k):** the claim UPDATE...RETURNING's atomicity under
// genuinely concurrent connections, FOR UPDATE SKIP LOCKED row-lock
// fairness under load, real crash recovery (an actually-killed process),
// real 429/outage/timeout behaviour against the live academic source APIs,
// and — independent of this file entirely — who/what triggers the worker
// on a schedule. Every dependency in `PrepareWorkerDeps` below is injected
// specifically so this file's own tests can prove its LOGIC without any of
// those, per this slice's "no network, no DB" hard limit.
//
// **429/outage handling (POLICY E6, read before touching this file
// again):** web/src/lib/sources/_fetch.ts's `sourceFetch` already retries
// once on a 429, honoring `Retry-After` (capped), at the level of each
// individual HTTP call a source adapter makes. This worker's own
// `attempts`/backoff (via prepare-due.ts) operates one level up — a whole
// JOB (build the whole pool, which may call many sources) either succeeds
// or fails as a unit. A real `buildPool` implementation (not written in
// this slice — nothing wires one in) must call the existing pipeline/
// source adapters as-is and must NOT add a second per-HTTP-call retry loop
// around them; this worker's job-level backoff is not a replacement for,
// or a duplicate of, `sourceFetch`'s existing retry — it is the layer
// above it, for when a whole build attempt fails even after that.
import type { DashboardDeliveryLedger, PaperIdentity } from "./delivery-ledger";
import { nextAttemptAt as computeNextAttemptAt } from "./prepare-due";
import type { DashboardPrepareJob, DashboardPrepareJobRepository } from "./prepare-job-repository";

/** What a real (not-yet-written) pool builder would hand back — opaque item payload, same "never assume a feed-specific shape" discipline delivery-ledger.ts's own `servedItems` already documents. */
export type PrepareBuildOutcome =
  | { ok: true; papers: readonly PaperIdentity[]; servedItems?: readonly unknown[] }
  | { ok: false; error: string };

export interface PrepareWorkerDeps {
  /** The worker's own clock — every timestamp this module writes comes from here, never a bare `new Date()`, so tests can pin it. */
  now: () => Date;
  jobs: DashboardPrepareJobRepository;
  /**
   * Deliberately narrowed to the two methods this worker is allowed to
   * call — see the module header. A caller may pass the FULL
   * `DashboardDeliveryLedger` (it structurally satisfies this `Pick`); the
   * type system still only offers `getBatch`/`prepareBatch` to the code in
   * this file.
   */
  ledger: Pick<DashboardDeliveryLedger, "getBatch" | "prepareBatch">;
  /**
   * Builds the pool for this job — fully injected and opaque to this
   * worker (which academic sources it calls, how it resolves the owner's
   * profile, etc. is entirely the real implementation's problem, not
   * built or assumed here). Must build FOR `job.intentVersion`/
   * `job.ownerId`/`job.localDate` — the worker only ever fences the
   * RESULT against a fresh intent read, it never inspects what this
   * function actually did internally.
   */
  buildPool: (job: DashboardPrepareJob) => Promise<PrepareBuildOutcome>;
  /**
   * Returns the OWNER's current `serializeFeedIntent()` fingerprint (the
   * exact string `web/src/lib/feed/intent.ts`'s `serializeFeedIntent`
   * would produce right now), or `undefined` if it cannot be read. Called
   * exactly ONCE per `runPrepareJob` invocation, immediately before the
   * worker would write a batch — never before `buildPool` — per DESIGN
   * B4's "taken immediately before the worker would write" instruction.
   */
  readCurrentIntentVersion: (ownerId: string) => Promise<string | undefined>;
  /** This worker instance's own lease-owner id — must match the id the job was actually claimed under. */
  leaseOwner: string;
}

export type PrepareJobOutcome =
  | { kind: "already-prepared"; batchId: string; completionError?: string }
  | { kind: "prepared"; batchId: string }
  | { kind: "stale-intent" }
  | { kind: "not-leased-by-this-worker" }
  | { kind: "failed"; reason: string; dead: boolean };

/**
 * Runs ONE already-claimed job to completion. The caller is responsible for
 * claiming (`deps.jobs.claim(...)`) and passing the result here — this
 * function does not claim for itself, so a caller can log/inspect the claim
 * before processing it.
 *
 * Never throws (see the module header). Never writes a `served`/
 * `acknowledged` batch — only ever `prepared`, and only via
 * `deps.ledger.prepareBatch`.
 */
export async function runPrepareJob(
  job: DashboardPrepareJob,
  deps: PrepareWorkerDeps,
): Promise<PrepareJobOutcome> {
  if (job.status !== "leased" || job.leaseOwner !== deps.leaseOwner) {
    // Defensive: a caller must only ever pass a job it just successfully
    // claimed under its own leaseOwner. No repository call is made here —
    // there is no lease to safely act under.
    return { kind: "not-leased-by-this-worker" };
  }

  const now = deps.now();

  try {
    // Efficiency short-circuit, not a correctness requirement: if a batch
    // already exists for this owner+date (any status), there is nothing
    // left for this job to do — dashboard_batches' own
    // unique(owner_id, local_date) plus prepareBatch's idempotent
    // insert-conflict fallback (P4-S3, VERIFIED_OFFLINE_BOUNDED) is the
    // structural backstop that makes this safe even if this check were
    // ever wrong or racy; this is purely "don't pay for a pipeline build
    // whose result could never be written anyway."
    const existingBatch = await deps.ledger.getBatch(job.ownerId, job.localDate);
    if (existingBatch) {
      // F-A-P4S8b-01: completing the job here is bookkeeping only — the
      // outcome is already-prepared regardless, since the batch itself
      // (read just above) is the actual source of truth. If this call
      // throws (e.g. a transient Supabase error), it must be caught HERE,
      // not by the outer catch below: letting it fall through there would
      // relabel an accurate "already-prepared" outcome as a false "failed"
      // (the batch is fine; nothing about the feed content failed). Caught
      // locally instead, so the outcome always stays accurate, with the
      // bookkeeping failure surfaced separately via `completionError` for
      // anyone who wants to know the job record itself didn't get marked
      // done (it will simply be retried, harmlessly, next attempt).
      try {
        await deps.jobs.complete(job.id, deps.leaseOwner, undefined, now);
      } catch (err) {
        const completionError = err instanceof Error ? err.message : String(err);
        return { kind: "already-prepared", batchId: existingBatch.id, completionError };
      }
      return { kind: "already-prepared", batchId: existingBatch.id };
    }

    const built = await deps.buildPool(job);
    if (!built.ok) {
      return await failJob(job, deps, built.error, now);
    }

    // FENCING — the single required check (DESIGN B4), taken here: AFTER
    // the build, immediately BEFORE the write. A job whose captured
    // intentVersion no longer matches a freshly recomputed current value
    // never writes — the user's intent changed after this job was queued
    // (or, per this exact ordering, even while it was being built).
    const currentVersion = await deps.readCurrentIntentVersion(job.ownerId);
    if (currentVersion === undefined) {
      // Cannot verify -> must not publish. Treated as a retryable failure,
      // not a silent discard, since an unreadable intent is very likely
      // transient (the same store outage shape counters.ts/delivery-ledger.ts
      // already document elsewhere), not a real intent change.
      return await failJob(job, deps, "intent_unreadable", now);
    }
    if (currentVersion !== job.intentVersion) {
      await deps.jobs.complete(job.id, deps.leaseOwner, "intent_changed", now);
      return { kind: "stale-intent" };
    }

    const batch = await deps.ledger.prepareBatch(
      job.ownerId,
      job.localDate,
      built.papers,
      job.intentVersion,
      built.servedItems,
    );
    // Regression guard, not a defensive workaround: a FRESH prepareBatch
    // call (this worker only ever reaches here after confirming no batch
    // existed yet) always returns status 'prepared' per delivery-ledger.ts's
    // own contract. If this ever fires, something upstream is badly wrong
    // and publishing must stop, not proceed as if it were fine.
    if (batch.status !== "prepared") {
      throw new Error(
        `P4-S8b invariant violated: prepareBatch returned status "${batch.status}", expected "prepared" for a fresh worker-written batch`,
      );
    }

    await deps.jobs.complete(job.id, deps.leaseOwner, undefined, now);
    return { kind: "prepared", batchId: batch.id };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return await failJob(job, deps, message, now);
  }
}

/**
 * Shared terminal-failure path. Computes the next backoff instant from
 * prepare-due.ts's pure schedule and hands it to the repository's `fail`,
 * which itself decides pending-with-backoff versus dead (attempts already
 * incremented at claim time). Never throws — a failure of `fail` itself
 * (e.g. a transient Supabase RPC error) still returns a typed outcome; the
 * job's lease simply expires and a later claim reclaims it, the same
 * recovery path a genuine process crash takes.
 */
async function failJob(
  job: DashboardPrepareJob,
  deps: PrepareWorkerDeps,
  reason: string,
  now: Date,
): Promise<PrepareJobOutcome> {
  try {
    const nextAt = computeNextAttemptAt(job.attempts, now);
    const result = await deps.jobs.fail(job.id, deps.leaseOwner, reason, nextAt, now);
    return { kind: "failed", reason, dead: result?.status === "dead" };
  } catch {
    return { kind: "failed", reason, dead: false };
  }
}

/**
 * Convenience loop: claim and run up to `maxJobs` due jobs in sequence.
 * Not required by any acceptance criterion on its own (the acceptance-level
 * proof is `runPrepareJob` itself) — provided because a real trigger
 * (whatever USER decision #3 picks) will want to drain more than one job
 * per invocation, and this is the obvious, small, offline-testable shape
 * for that without inventing a second entry point later. Stops as soon as
 * `claim` returns null (queue empty for now).
 */
export async function drainPrepareQueue(
  deps: PrepareWorkerDeps,
  options: { leaseDurationMs: number; maxJobs?: number },
): Promise<PrepareJobOutcome[]> {
  const outcomes: PrepareJobOutcome[] = [];
  const limit = options.maxJobs ?? 10;
  for (let i = 0; i < limit; i++) {
    const now = deps.now();
    const job = await deps.jobs.claim({ leaseOwner: deps.leaseOwner, leaseDurationMs: options.leaseDurationMs }, now);
    if (!job) break;
    outcomes.push(await runPrepareJob(job, deps));
  }
  return outcomes;
}

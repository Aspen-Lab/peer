// P4-S8b (Round 3) — ABC-JEV-INTEGRATION.md §4 "P4-S8b C assigned";
// docs/jev-abc/P4-S8-B-20260924T115008Z.md DESIGN B4 ("Due-time
// computation... '30-60 min ahead of reading time' becomes: compute the
// target instant for digest_hour_local in digest_timezone (existing math),
// subtract a configurable lead, and that's the job's next_attempt_at/due
// time") and POLICY E7 (the retry-count ceiling has no sourced number in
// the state file — flagged, not silently treated as researched).
//
// Pure functions only. No clock reads, no I/O, no randomness — every
// function here takes `now`/inputs explicitly and returns the same output
// for the same input every time, so this module is fully offline-testable
// (the offline-provable half of acceptance 14; the live scheduling half
// stays BLOCKED per §1k/§1p.C.3 — see prepare-worker.ts's header).
import { utcInstantForLocalWallClock } from "./timezone";

/**
 * PROPOSED, not sourced. §3c's "Queue" paragraph says "30-60 min ahead of
 * reading time" but never picks a single number; this is the midpoint,
 * labelled here (not silently assumed) so a later round can retune it
 * without hunting for a magic number. A caller may override per call.
 */
export const DEFAULT_PREPARE_LEAD_MINUTES = 45;

/**
 * Computes the instant a prepare job for `localDate`/`hourLocal`/`timezone`
 * should become due — i.e. the earliest a worker should be allowed to claim
 * it — so a worker has `leadMinutes` of head start before the owner's
 * configured reading time. Returns null when the underlying wall-clock
 * conversion can't be resolved (malformed date, unresolvable timezone,
 * out-of-range hour) — a caller must treat null as "cannot schedule this
 * job," never as "due immediately."
 *
 * Reuses timezone.ts's utcInstantForLocalWallClock (itself hand-verified
 * against P4-S7-T's DST fixtures, see that module's header and
 * prepare-due.test.ts's own round-trip assertions below) rather than a
 * second date computation, so the "ready ahead of reading time" guarantee
 * and dispatch-digests' existing exact-hour gate can never silently
 * disagree about what a given (hour, timezone) pair means in UTC.
 */
export function computePrepareDueAt(params: {
  localDate: string;
  hourLocal: number;
  timezone: string;
  leadMinutes?: number;
}): Date | null {
  const target = utcInstantForLocalWallClock(params.localDate, params.hourLocal, params.timezone);
  if (!target) return null;
  const leadMinutes = params.leadMinutes ?? DEFAULT_PREPARE_LEAD_MINUTES;
  return new Date(target.getTime() - leadMinutes * 60_000);
}

/**
 * PROPOSED backoff constants (POLICY E7 — max_attempts itself is proposed,
 * not sourced; these two follow the same "label, don't hide" rule). Modeled
 * on pipeline.ts's claimSourceRetry (30-minute self-heal window) but a
 * prepare job is a much larger unit of work than one source fetch, so the
 * base/ceiling are wider.
 */
export const DEFAULT_BACKOFF_BASE_MS = 60_000; // 1 minute
export const DEFAULT_BACKOFF_MAX_MS = 30 * 60_000; // 30 minutes

/**
 * Deterministic exponential backoff, `attempts` counted the same way the
 * job repository counts them (1 = the first failed attempt). No jitter —
 * randomness would make this function impure and untestable by simple
 * equality; a real caller wanting jitter can add it on top of this pure
 * value without this module needing to own a RNG. `attempts <= 0` is
 * treated as 1 (defensive; a caller should never construct this, but a
 * pure function should not throw on it either).
 */
export function nextAttemptDelayMs(
  attempts: number,
  base = DEFAULT_BACKOFF_BASE_MS,
  max = DEFAULT_BACKOFF_MAX_MS,
): number {
  const n = Number.isFinite(attempts) && attempts > 1 ? Math.floor(attempts) : 1;
  const delay = base * Math.pow(2, n - 1);
  return Math.min(delay, max);
}

/** `now` + `nextAttemptDelayMs(attempts)` — the job row's next `next_attempt_at` after a failure. */
export function nextAttemptAt(
  attempts: number,
  now: Date,
  base = DEFAULT_BACKOFF_BASE_MS,
  max = DEFAULT_BACKOFF_MAX_MS,
): Date {
  return new Date(now.getTime() + nextAttemptDelayMs(attempts, base, max));
}

// TRIGGER-A (ABC-JEV-INTEGRATION.md §1x; guide docs/jev-abc/
// TRIGGER-A-B-20260925T044825Z.md §2.4/§3 Step 3) — pure due-selection logic
// for the prepare-ahead worker's enqueue phase. No I/O, no clock reads
// beyond the `now` a caller passes in — fully offline-testable, mirroring
// prepare-due.ts's own "pure functions only" discipline.
//
// P11 (ABC-JEV-INTEGRATION.md §1x, manager addition) — BATCH DATE ALIGNMENT,
// the reason this module exists as a separate file from prepare-due.ts
// rather than folding straight into the new route:
//
// A real visit keys today's batch with `localCalendarDate(now)`
// (web/src/lib/local-calendar-date.ts, imported by
// web/src/app/api/feed/route.ts's `runLedgerAwareFeed` at its own `now` —
// i.e. the SERVER's own runtime calendar day, UTC on Vercel, with NO
// reference anywhere to the owner's `digest_timezone`). A prepared batch
// only helps that visit if it sits under the SAME local_date key the visit
// will look up — so the job's `localDate` (which
// web/src/lib/dashboard/prepare-worker.ts passes straight through,
// unmodified, to `ledger.getBatch`/`ledger.prepareBatch` — `localDate` is
// opaque to every one of those layers, see delivery-ledger.ts's own header)
// MUST be `localCalendarDate(checkinInstant)` — the SAME function a real
// visit uses, fed the expected check-in instant instead of the request
// instant — and NOT `dateInTimezone(now, digest_timezone)` (the owner's own
// timezone's calendar date), which is what the B guide's own §2.4 draft
// design used for both purposes. The two can disagree: e.g.
// digest_timezone="Asia/Tokyo" (UTC+9, no DST), digest_hour_local=8, a run
// at now=2026-09-25T00:30:00Z — dateInTimezone(now, tz) is already
// "2026-09-25" in Tokyo, but the check-in instant itself (08:00 JST on the
// 25th) is 2026-09-24T23:00:00Z, whose SERVER-calendar date is
// "2026-09-24". A batch stored under "2026-09-25" would never be found by a
// visit at the expected check-in. See due-owners.test.ts's dedicated
// non-UTC-timezone test for the executable proof, and the C checkpoint
// (docs/jev-abc/TRIGGER-A-C-*.md) for the escape-clause check confirming
// this fix touches no already-VERIFIED contract (`localDate` is opaque to
// prepare-due.ts/prepare-worker.ts/prepare-job-repository.ts/
// delivery-ledger.ts — none of them assert any particular derivation of it;
// the fix is confined to this new module).
//
// `dateInTimezone(now, tz)` is still used below, but ONLY to pick WHICH
// calendar day's target hour to compute (today in the owner's own
// timezone) — never as the value written anywhere as a storage key.
import { dateInTimezone, utcInstantForLocalWallClock } from "./timezone";
import { localCalendarDate } from "@/lib/local-calendar-date";

/**
 * P1 (ABC-JEV-INTEGRATION.md §1x, BINDING, overriding prepare-due.ts's own
 * PROPOSED 45-minute default for THIS caller only — prepare-due.ts itself is
 * untouched, see the C checkpoint's escape-clause note): "lead time = 90
 * min. With the :05 hourly grid the realized lead falls in (lead-60, lead],
 * so 45 can go negative; 90 guarantees >=30 min before GitHub's own schedule
 * delay." Passed explicitly to computePrepareDueAt's own `leadMinutes`
 * parameter — never a second due-time formula.
 */
export const PREPARE_LEAD_MINUTES = 90;

/**
 * PROPOSED, not sourced (same "label, don't hide" convention as
 * prepare-due.ts's own DEFAULT_PREPARE_LEAD_MINUTES) — not overridden by any
 * §1x ruling. B's guide §2.4: "a generous LOOKAHEAD (recommend 3 hours)...
 * a wide, repeated enqueue window is self-healing against a missed or
 * delayed run; a narrow one is not."
 */
export const PREPARE_LOOKAHEAD_MS = 3 * 60 * 60 * 1000;

export interface DueSelectionInput {
  readonly digestHourLocal: number;
  readonly digestTimezone: string;
}

export type DueCheck =
  | {
      readonly due: true;
      /** The instant a worker becomes allowed to claim this job (checkin instant minus lead). */
      readonly dueAt: Date;
      /** P11 fix — the SAME key a visit at `checkinInstant` would look up. Write this, never `dateInTimezone`'s value, as the job/batch local_date. */
      readonly batchLocalDate: string;
      /** The owner's expected check-in instant (digest_hour_local in digest_timezone), before the lead is subtracted. */
      readonly checkinInstant: Date;
    }
  | {
      readonly due: false;
      readonly reason: "timezone_unresolved" | "outside_window";
    };

/**
 * Pure predicate + key computation: is this owner due for a prepare-ahead
 * job right now, and if so, what due instant / batch local_date should the
 * job carry? Returns `outside_window` both when the check-in is still far
 * in the future (beyond `lookaheadMs`) and does NOT re-check a lower bound
 * once due — a `dueAt` already in the past is still reported `due: true`
 * (see this module's own due-owners.test.ts "no lower bound" case): the
 * enqueue call is a cheap idempotent upsert (prepare-job-repository.ts) and
 * a late-but-still-same-owner-day enqueue is strictly better than silently
 * giving up on that day's batch — self-limiting anyway, since
 * `dateInTimezone(now, tz)` naturally advances to the next calendar day
 * within at most ~24h.
 */
export function isOwnerDueForPrepare(
  row: DueSelectionInput,
  now: Date,
  opts: { leadMinutes?: number; lookaheadMs?: number } = {},
): DueCheck {
  const leadMinutes = opts.leadMinutes ?? PREPARE_LEAD_MINUTES;
  const lookaheadMs = opts.lookaheadMs ?? PREPARE_LOOKAHEAD_MS;

  // Picks WHICH day's target hour we mean (today, in the owner's own
  // timezone) — an input to the wall-clock conversion below, never a
  // storage key (see this module's header).
  const localDateInOwnerTz = dateInTimezone(now, row.digestTimezone);
  if (!localDateInOwnerTz) return { due: false, reason: "timezone_unresolved" };

  const checkinInstant = utcInstantForLocalWallClock(localDateInOwnerTz, row.digestHourLocal, row.digestTimezone);
  if (!checkinInstant) return { due: false, reason: "timezone_unresolved" };

  const dueAt = new Date(checkinInstant.getTime() - leadMinutes * 60_000);
  if (dueAt.getTime() >= now.getTime() + lookaheadMs) {
    return { due: false, reason: "outside_window" };
  }

  // P11 fix — see this module's header.
  const batchLocalDate = localCalendarDate(checkinInstant);

  return { due: true, dueAt, batchLocalDate, checkinInstant };
}

-- P4-S8b: durable prepare-job queue (offline slice; acceptance 13/14,
-- ABC-JEV-INTEGRATION.md §3c "Queue" paragraph / §1p.C). This migration is
-- authored only; it is not applied by this campaign, following the same
-- convention as every other 2026-09-2x migration in this directory. Who or
-- what triggers a worker to actually claim rows from this table is USER
-- decision #3 (docs/jev-abc/P4-S8-B-20260924T115008Z.md POLICY E4/E5,
-- ABC-JEV-INTEGRATION.md §1p.C.3) -- nothing in this campaign wires a route
-- or a vercel.json cron entry to it.
--
-- DB/RLS PROOF: BLOCKED. No isolated Supabase instance is available to this
-- agent (§1k). Everything below has been statically self-reviewed only
-- (column types, constraints, RLS policy shape, function control flow) --
-- never executed against a real Postgres instance. In particular, the
-- FOR UPDATE SKIP LOCKED claim below is the standard, widely-used idiom for
-- "many workers, no double-claim, no blocking" but its correctness under
-- genuinely concurrent connections can only be proven by a real Postgres --
-- see web/src/lib/dashboard/prepare-worker.ts's header for the full list of
-- what stays BLOCKED versus what this slice proves offline.
--
-- NO CLIENT ACCESS AT ALL -- not even an owner-read defense-in-depth policy
-- like dashboard_batches/dashboard_rollover_candidates grant (see
-- 20260924000000_dashboard_delivery_ledger.sql /
-- 20260924000500_dashboard_rollover.sql). This table carries no information
-- an owner needs to read directly -- it is a purely internal scheduling
-- artifact, read and written by a worker through the service role only.
-- This mirrors usage_counters' exact convention instead
-- (20260904000000_usage_counters.sql: "RLS enabled, revoke all from
-- anon/authenticated, zero policies").
--
-- AT MOST ONE ROW PER (owner_id, local_date) -- the unique constraint IS
-- the debounce mechanism §3c asks for ("changes debounced with one pending
-- newest-intent job"): enqueue_prepare_job upserts onto it rather than ever
-- inserting a second row for the same owner+date.
create table if not exists public.dashboard_prepare_jobs (
  id                uuid primary key default gen_random_uuid(),
  owner_id          uuid not null references auth.users(id) on delete cascade,
  -- Opaque "YYYY-MM-DD in the owner's resolved local day" string, same
  -- convention as dashboard_batches.local_date / dashboard_rollover_candidates.last_pool_date
  -- -- this migration never parses it.
  local_date        text not null,
  -- Fencing token: the FULL web/src/lib/feed/intent.ts serializeFeedIntent()
  -- JSON string (not a hash) captured at enqueue time -- DESIGN B4. The
  -- worker recomputes this fresh immediately before writing a batch and
  -- discards its own result on a mismatch rather than ever publish under a
  -- stale intent (web/src/lib/dashboard/prepare-worker.ts).
  intent_version    text not null,
  status            text not null default 'pending'
                       check (status in ('pending', 'leased', 'done', 'failed', 'dead')),
  -- Opaque worker-instance id; null when unleased. NOT a foreign key to
  -- anything -- this migration never validates who a worker is beyond the
  -- service-role credential every caller of these functions already holds.
  lease_owner       text,
  lease_expires_at  timestamptz,
  heartbeat_at      timestamptz,
  attempts          int not null default 0,
  -- PROPOSED, not sourced -- no ceiling for a whole-job retry count exists
  -- anywhere in ABC-JEV-INTEGRATION.md (docs/jev-abc/
  -- P4-S8-B-20260924T115008Z.md POLICY E7 names this explicitly). The
  -- closest analog, pipeline.ts's MAX_SOURCE_RETRIES_PER_DAY, is 3/day for
  -- a narrower, per-SOURCE self-heal on an already-built pool, not a
  -- whole-job (full pipeline run) attempt ceiling.
  max_attempts      int not null default 5,
  next_attempt_at   timestamptz not null default now(),
  last_error        text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint dashboard_prepare_jobs_attempts_non_negative check (attempts >= 0),
  constraint dashboard_prepare_jobs_max_attempts_positive check (max_attempts > 0),
  unique (owner_id, local_date)
);

alter table public.dashboard_prepare_jobs enable row level security;

-- No policies at all. Every access goes through the service role (bypasses
-- RLS by construction), via the functions below or a direct service-role
-- select from prepare-job-repository.ts's SupabaseDashboardPrepareJobRepository.
revoke all on table public.dashboard_prepare_jobs from anon, authenticated;

-- Partial index: only pending/leased rows are ever scanned by a claim
-- attempt (done/failed/dead rows are terminal until a fresh enqueue revives
-- them -- see enqueue_prepare_job below), so the index never carries dead
-- weight for completed history the way a full-table index would.
create index if not exists dashboard_prepare_jobs_claimable_idx
  on public.dashboard_prepare_jobs (status, next_attempt_at)
  where status in ('pending', 'leased');

-- ── enqueue: atomic debounced upsert ──────────────────────────────────────
-- One pending-or-leased job per (owner_id, local_date); a second enqueue
-- call for the same owner+date refreshes intent_version/next_attempt_at/
-- max_attempts to the caller's newest values and leaves status/attempts/
-- lease untouched when the existing row is still pending or leased (a
-- currently-leased job keeps running under whatever it already captured;
-- the NEXT time it is claimed -- if this attempt fails and retries -- it
-- picks up the refreshed row). A 'done'/'failed'/'dead' row is revived back
-- to 'pending' with attempts reset to 0 and last_error cleared: a fresh
-- enqueue for the SAME owner+date after an earlier one finished is a
-- deliberate new request (a new day's worth of work, or an explicitly
-- re-triggered one) that deserves a full fresh attempt budget, not a silent
-- resurrection of an exhausted one.
--
-- Not security definer: the only caller holds the service role key, which
-- already bypasses RLS, so there is nothing to elevate and nothing to
-- review (same reasoning as upsert_rollover_candidates).
create or replace function public.enqueue_prepare_job(
  p_owner_id uuid,
  p_local_date text,
  p_intent_version text,
  p_next_attempt_at timestamptz,
  p_max_attempts int default 5
) returns public.dashboard_prepare_jobs
language plpgsql
as $$
declare
  v_row public.dashboard_prepare_jobs;
begin
  insert into public.dashboard_prepare_jobs
    (owner_id, local_date, intent_version, status, attempts, max_attempts, next_attempt_at, last_error, updated_at)
  values
    (p_owner_id, p_local_date, p_intent_version, 'pending', 0, p_max_attempts, p_next_attempt_at, null, now())
  on conflict (owner_id, local_date) do update
    set intent_version  = excluded.intent_version,
        next_attempt_at = excluded.next_attempt_at,
        max_attempts    = excluded.max_attempts,
        status = case when public.dashboard_prepare_jobs.status in ('done', 'failed', 'dead')
                      then 'pending' else public.dashboard_prepare_jobs.status end,
        attempts = case when public.dashboard_prepare_jobs.status in ('done', 'failed', 'dead')
                        then 0 else public.dashboard_prepare_jobs.attempts end,
        last_error = case when public.dashboard_prepare_jobs.status in ('done', 'failed', 'dead')
                          then null else public.dashboard_prepare_jobs.last_error end,
        updated_at = now()
  returning * into v_row;
  return v_row;
end;
$$;

revoke all on function public.enqueue_prepare_job(uuid, text, text, timestamptz, int)
  from public, anon, authenticated;
grant execute on function public.enqueue_prepare_job(uuid, text, text, timestamptz, int)
  to service_role;

-- ── claim: atomic lease with crash-recovery reclaim ───────────────────────
-- Claims the EARLIEST-due row that is either pending-and-due or
-- leased-with-an-expired-lease. "OR (status = 'leased' AND lease_expires_at
-- < p_now)" is the crash-recovery path -- a worker that dies mid-job simply
-- lets its lease expire; the next claim attempt reclaims the row, no
-- separate "detect a dead worker" step needed. FOR UPDATE SKIP LOCKED on
-- the inner SELECT is what lets multiple concurrent callers each claim a
-- DIFFERENT row instead of blocking on (or double-claiming) each other --
-- see this file's header for why that specific guarantee stays BLOCKED
-- (needs a real Postgres to prove).
create or replace function public.claim_prepare_job(
  p_lease_owner text,
  p_lease_seconds int,
  p_now timestamptz default now()
) returns public.dashboard_prepare_jobs
language plpgsql
as $$
declare
  v_id uuid;
  v_row public.dashboard_prepare_jobs;
begin
  select id into v_id
  from public.dashboard_prepare_jobs
  where (status = 'pending' and next_attempt_at <= p_now)
     or (status = 'leased' and lease_expires_at < p_now)
  order by next_attempt_at asc
  for update skip locked
  limit 1;

  if v_id is null then
    return null;
  end if;

  update public.dashboard_prepare_jobs
  set status           = 'leased',
      lease_owner      = p_lease_owner,
      lease_expires_at = p_now + make_interval(secs => p_lease_seconds),
      heartbeat_at     = p_now,
      attempts         = attempts + 1,
      updated_at       = p_now
  where id = v_id
  returning * into v_row;

  return v_row;
end;
$$;

revoke all on function public.claim_prepare_job(text, int, timestamptz)
  from public, anon, authenticated;
grant execute on function public.claim_prepare_job(text, int, timestamptz)
  to service_role;

-- ── heartbeat: extend an already-held lease ───────────────────────────────
-- No-op (returns false) if `p_id` isn't currently leased BY `p_lease_owner`
-- -- a worker whose lease already expired and was reclaimed by someone else
-- must not be able to resurrect its stale hold by heartbeating it.
create or replace function public.heartbeat_prepare_job(
  p_id uuid,
  p_lease_owner text,
  p_lease_seconds int,
  p_now timestamptz default now()
) returns boolean
language plpgsql
as $$
declare
  v_updated int;
begin
  update public.dashboard_prepare_jobs
  set lease_expires_at = p_now + make_interval(secs => p_lease_seconds),
      heartbeat_at     = p_now,
      updated_at       = p_now
  where id = p_id and lease_owner = p_lease_owner and status = 'leased';
  get diagnostics v_updated = row_count;
  return v_updated > 0;
end;
$$;

revoke all on function public.heartbeat_prepare_job(uuid, text, int, timestamptz)
  from public, anon, authenticated;
grant execute on function public.heartbeat_prepare_job(uuid, text, int, timestamptz)
  to service_role;

-- ── complete: terminal success, OR a deliberate non-retryable stop ───────
-- `p_last_error` is NULL on a genuine publish, or a short reason string
-- (e.g. "intent_changed") when the worker deliberately discarded its own
-- result rather than publish under a stale intent (DESIGN B4's fencing
-- guarantee) -- either way the job is DONE, not retried. Fenced on
-- `lease_owner = p_lease_owner and status = 'leased'`, same as fail below:
-- a worker whose lease already expired and was reclaimed by another worker
-- cannot complete the job out from under the new holder (returns no row,
-- NULL, which the caller must treat as "my lease was already lost").
create or replace function public.complete_prepare_job(
  p_id uuid,
  p_lease_owner text,
  p_last_error text default null,
  p_now timestamptz default now()
) returns public.dashboard_prepare_jobs
language plpgsql
as $$
declare
  v_row public.dashboard_prepare_jobs;
begin
  update public.dashboard_prepare_jobs
  set status           = 'done',
      last_error       = p_last_error,
      lease_owner      = null,
      lease_expires_at = null,
      updated_at       = p_now
  where id = p_id and lease_owner = p_lease_owner and status = 'leased'
  returning * into v_row;
  return v_row;
end;
$$;

revoke all on function public.complete_prepare_job(uuid, text, text, timestamptz)
  from public, anon, authenticated;
grant execute on function public.complete_prepare_job(uuid, text, text, timestamptz)
  to service_role;

-- ── fail: a retryable (or, once max_attempts is spent, terminal 'dead')
-- attempt failure ──────────────────────────────────────────────────────────
-- `attempts` is NOT incremented here -- claim_prepare_job already
-- incremented it when this attempt was leased; this function only decides
-- where the row goes next. `p_next_attempt_at` (the backoff instant) is
-- computed CALLER-SIDE (web/src/lib/dashboard/prepare-due.ts's pure
-- nextAttemptAt/nextAttemptDelayMs) and passed in, so the backoff SCHEDULE
-- stays one pure, offline-testable function shared by both the Memory and
-- Supabase repository implementations rather than duplicated in SQL.
-- Fenced identically to complete_prepare_job above.
create or replace function public.fail_prepare_job(
  p_id uuid,
  p_lease_owner text,
  p_error text,
  p_next_attempt_at timestamptz,
  p_now timestamptz default now()
) returns public.dashboard_prepare_jobs
language plpgsql
as $$
declare
  v_row public.dashboard_prepare_jobs;
begin
  update public.dashboard_prepare_jobs
  set status = case when attempts >= max_attempts then 'dead' else 'pending' end,
      last_error = p_error,
      next_attempt_at = case when attempts >= max_attempts then next_attempt_at else p_next_attempt_at end,
      lease_owner = null,
      lease_expires_at = null,
      updated_at = p_now
  where id = p_id and lease_owner = p_lease_owner and status = 'leased'
  returning * into v_row;
  return v_row;
end;
$$;

revoke all on function public.fail_prepare_job(uuid, text, text, timestamptz, timestamptz)
  from public, anon, authenticated;
grant execute on function public.fail_prepare_job(uuid, text, text, timestamptz, timestamptz)
  to service_role;

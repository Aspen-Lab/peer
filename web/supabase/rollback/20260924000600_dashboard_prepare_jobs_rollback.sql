-- NOT A MIGRATION — NEVER APPLIED AUTOMATICALLY.
-- Nothing in this repository reads this file. No Supabase CLI migration
-- runner, script, or CI step ever executes it. A human may run it by hand
-- (psql / the Supabase SQL editor) ONLY after a separately approved
-- retention/backup plan exists for the data it destroys, per
-- ABC-JEV-INTEGRATION.md §3e ("Do not drop old tables until a separately
-- approved retention/migration plan; snapshots and stored reading history
-- preserved."). See web/supabase/rollback/README.md for the full policy.
--
-- Reverses: web/supabase/migrations/20260924000600_dashboard_prepare_jobs.sql
--
-- Destroys: every row in public.dashboard_prepare_jobs (the durable
-- prepare-job queue) and the five functions that operate on it
-- (enqueue_prepare_job, claim_prepare_job, heartbeat_prepare_job,
-- complete_prepare_job, fail_prepare_job). Regenerable and low-stakes: a
-- prepare job is a SCHEDULING ARTIFACT, not a record of anything that
-- happened — it only says "build this owner's feed ahead of their reading
-- time." Losing it costs nothing but a re-enqueue (the next signal that
-- would have created one — whatever that ends up being, since nothing
-- triggers this queue yet per USER decision #3 — simply creates a fresh
-- row). No user-facing data, no delivery history, no ledger state lives
-- here; dashboard_batches/dashboard_deliveries (the actual delivery record)
-- are untouched by this rollback.
--
-- Order constraint: functions, then the index (implicitly, via DROP TABLE),
-- then the table. No FK dependents anywhere in this schema reference
-- dashboard_prepare_jobs. The table's own FK to auth.users is not this
-- migration's to manage. No policies to drop explicitly (the forward
-- migration granted none beyond `revoke all` — RLS being enabled is a
-- property of the table itself, dropped automatically with it).

revoke execute on function public.fail_prepare_job(uuid, text, text, timestamptz, timestamptz)
  from service_role;
revoke execute on function public.complete_prepare_job(uuid, text, text, timestamptz)
  from service_role;
revoke execute on function public.heartbeat_prepare_job(uuid, text, int, timestamptz)
  from service_role;
revoke execute on function public.claim_prepare_job(text, int, timestamptz)
  from service_role;
revoke execute on function public.enqueue_prepare_job(uuid, text, text, timestamptz, int)
  from service_role;

drop function if exists public.fail_prepare_job(uuid, text, text, timestamptz, timestamptz);
drop function if exists public.complete_prepare_job(uuid, text, text, timestamptz);
drop function if exists public.heartbeat_prepare_job(uuid, text, int, timestamptz);
drop function if exists public.claim_prepare_job(text, int, timestamptz);
drop function if exists public.enqueue_prepare_job(uuid, text, text, timestamptz, int);

drop table if exists public.dashboard_prepare_jobs;

-- NOT A MIGRATION — NEVER APPLIED AUTOMATICALLY.
-- Nothing in this repository reads this file. No Supabase CLI migration
-- runner, script, or CI step ever executes it. A human may run it by hand
-- (psql / the Supabase SQL editor) ONLY after a separately approved
-- retention/backup plan exists for the data it destroys, per
-- ABC-JEV-INTEGRATION.md §3e ("Do not drop old tables until a separately
-- approved retention/migration plan; snapshots and stored reading history
-- preserved."). See web/supabase/rollback/README.md for the full policy.
--
-- Reverses: web/supabase/migrations/20260924000500_dashboard_rollover.sql
--
-- Destroys: every row in public.dashboard_rollover_candidates and the
-- public.upsert_rollover_candidates function. Regenerable — rollover
-- candidates are recomputed from each day's final pool by the normal
-- pipeline run; losing this table's rows only shrinks the candidate pool
-- for a few days after a rollback (fewer "held over never-shown" papers
-- available until the pool refills naturally through ordinary use), not a
-- permanent guarantee like the dashboard delivery ledger's. Lowest-stakes
-- of the six migrations in this folder, but still real, user-visible for a
-- few days — not zero-impact, so it still needs the same backup discipline
-- as every other file here.
--
-- Order constraint: function, then table — this table has no FK
-- dependents and deliberately no FK to dashboard_batches/dashboard_deliveries
-- (the forward migration's own header explains why: a no-visit day has no
-- dashboard_batches row at all, yet rollover candidates must still
-- survive). The policy is not dropped explicitly — PostgreSQL drops it
-- automatically as part of DROP TABLE.

revoke execute on function public.upsert_rollover_candidates(uuid, text, jsonb)
  from service_role;

drop function if exists public.upsert_rollover_candidates(uuid, text, jsonb);

drop table if exists public.dashboard_rollover_candidates;

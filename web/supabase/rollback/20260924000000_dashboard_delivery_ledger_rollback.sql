-- NOT A MIGRATION — NEVER APPLIED AUTOMATICALLY.
-- Nothing in this repository reads this file. No Supabase CLI migration
-- runner, script, or CI step ever executes it. A human may run it by hand
-- (psql / the Supabase SQL editor) ONLY after a separately approved
-- retention/backup plan exists for the data it destroys, per
-- ABC-JEV-INTEGRATION.md §3e ("Do not drop old tables until a separately
-- approved retention/migration plan; snapshots and stored reading history
-- preserved."). See web/supabase/rollback/README.md for the full policy.
--
-- Reverses: web/supabase/migrations/20260924000000_dashboard_delivery_ledger.sql
--
-- Destroys: every row in public.dashboard_batches and public.dashboard_deliveries,
-- plus the public.acknowledge_dashboard_batch function. THIS IS THE
-- HIGHEST-STAKES ROLLBACK IN THIS FOLDER. dashboard_deliveries has no TTL
-- or expiry column anywhere, BY DESIGN — it exists specifically to
-- implement the product's permanent promise that "an already-shown paper
-- never resurfaces" for a given owner. Dropping this table does not just
-- lose data the way a cache loss does: it silently UN-DOES that promise
-- RETROACTIVELY for every user who had delivery history recorded, because
-- there is no other record of what was already shown. A paper a user has
-- already seen could resurface after a re-apply with no memory that it was
-- ever shown before. This must NEVER be run without an exported backup of
-- both tables' full contents first.
--
-- Order constraint: function, then child table, then parent table —
-- reverse of the forward migration's own stated creation order
-- ("dashboard_batches is created FIRST because dashboard_deliveries.batch_id
-- references it"). dashboard_deliveries (the child, carrying the foreign
-- key) is dropped before dashboard_batches (the parent) so no foreign-key
-- constraint is ever violated mid-rollback. Policies and indexes on both
-- tables are not dropped explicitly — PostgreSQL drops them automatically
-- as part of each DROP TABLE.

revoke execute on function public.acknowledge_dashboard_batch(uuid, uuid)
  from service_role;

drop function if exists public.acknowledge_dashboard_batch(uuid, uuid);

drop table if exists public.dashboard_deliveries;

drop table if exists public.dashboard_batches;

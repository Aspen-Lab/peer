-- NOT A MIGRATION — NEVER APPLIED AUTOMATICALLY.
-- Nothing in this repository reads this file. No Supabase CLI migration
-- runner, script, or CI step ever executes it. A human may run it by hand
-- (psql / the Supabase SQL editor) ONLY after a separately approved
-- retention/backup plan exists for the data it destroys, per
-- ABC-JEV-INTEGRATION.md §3e ("Do not drop old tables until a separately
-- approved retention/migration plan; snapshots and stored reading history
-- preserved."). See web/supabase/rollback/README.md for the full policy.
--
-- Reverses: web/supabase/migrations/20260924000300_briefing_deliveries_dedupe.sql
--
-- CAUTION: unlike private_paper_pools/private_decisions/dashboard_rollover,
-- this migration ALTERs an EXISTING, ALREADY-APPLIED, ALREADY-LIVE
-- production table (public.briefing_deliveries — see
-- web/supabase/schema.sql:243-252). This rollback file does not touch any
-- row's pre-existing columns; it only removes what the forward migration
-- itself added.
--
-- Destroys: the public.briefing_deliveries.local_date column's stored
-- values (on any row written after the forward migration was applied — the
-- column is nullable, so pre-existing rows had no value here to begin
-- with), the partial unique index that made same-day claims race-safe, and
-- the public.claim_briefing_delivery function. Regenerable in the sense
-- that dropping it simply reverts scheduled-digest deduplication to the
-- pre-existing 6-hour-window check (PEER_DIGEST_DEDUPE off behavior) — it
-- does not delete or corrupt any other column or any row's send history.
-- Still touches a live production table, so it needs the same backup
-- discipline as every other file here, not less, just because the change
-- itself is additive.
--
-- Order constraint: function, then index, then column — reverse of the
-- forward migration's own order (column, then index, then function).

revoke execute on function public.claim_briefing_delivery(uuid, text, text, text[], jsonb)
  from service_role;

drop function if exists public.claim_briefing_delivery(uuid, text, text, text[], jsonb);

drop index if exists public.briefing_deliveries_user_local_date_idx;

alter table public.briefing_deliveries drop column if exists local_date;

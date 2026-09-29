-- P4-S7 (Round 3) -- F-A-P4-07 (scheduled-digest double-send race) and
-- F-A-P4-04 (digest ledger must stay independent of the dashboard ledger),
-- ABC-JEV-INTEGRATION.md §1p.C.10.
--
-- AUTHORED ONLY. NOT APPLIED by this campaign. Unlike
-- 20260924000000_dashboard_delivery_ledger.sql (brand-new tables), **this
-- migration ALTERs an EXISTING, already-APPLIED table**
-- (public.briefing_deliveries -- see web/supabase/schema.sql:243-252). It
-- needs review with that in mind before any future apply authorization: a
-- mistake here touches real production history, not an empty table.
--
-- DB/RLS PROOF: BLOCKED. No isolated Supabase/Postgres instance is available
-- to this agent (offline authoring only, no DB/network access permitted).
-- Everything below is statically self-reviewed only (column nullability,
-- partial-index predicate correctness, ON CONFLICT arbiter inference,
-- grant/revoke symmetry) -- never executed against a real Postgres instance.
-- The exact same limitation applies to every other migration authored in
-- this campaign (20260924000000_dashboard_delivery_ledger.sql's own header
-- says the same).
--
-- ── Why `local_date` is nullable, and why the unique index is PARTIAL ──
-- Every row written before this migration ships has no `local_date` (the
-- column did not exist yet). Postgres already treats NULL as distinct from
-- every other NULL under a plain unique index/constraint, so a full
-- (non-partial) unique index on (user_id, local_date) would technically
-- never be blocked by that old history either -- but a PARTIAL index
-- (`where local_date is not null`) is the more explicit, self-documenting
-- choice (it also never indexes the old rows at all, rather than relying on
-- a reader knowing NULL-distinctness semantics), and is what
-- ABC-JEV-INTEGRATION.md §1p.C.10 binds this migration to.
--
-- `channel` is deliberately NOT part of the unique key: dispatch-digests/
-- route.ts's loop processes exactly one `profiles` row per user per
-- invocation, and `digest_channel` is a single value on that one row --
-- there is structurally never more than one claim attempt per
-- (user_id, local_date) regardless of channel, so adding channel to the key
-- would be dead weight, not a real narrowing of what "duplicate" means.
alter table public.briefing_deliveries
  add column if not exists local_date text;

create unique index if not exists briefing_deliveries_user_local_date_idx
  on public.briefing_deliveries (user_id, local_date)
  where local_date is not null;

-- ── Why an RPC function, not a PostgREST/supabase-js `.upsert()` ──
-- The F-A-P4-07 guide entry (docs/jev-abc/P4-B-20260924T0338Z.md) describes
-- this fix in raw-SQL terms: "on conflict (user_id, local_date) do nothing
-- returning id". That is exactly what this function does. A tempting
-- alternative -- and the one the manager's own brief suggested as a starting
-- point -- is a bare supabase-js call from the route:
--   admin.from("briefing_deliveries")
--     .upsert(row, { onConflict: "user_id,local_date", ignoreDuplicates: true })
--     .select("id")
-- This was deliberately NOT used, for a VERIFIED (not guessed) reason:
-- Postgres only infers a PARTIAL unique index as an ON CONFLICT arbiter when
-- the ON CONFLICT clause itself repeats a matching WHERE predicate (e.g.
-- `ON CONFLICT (user_id, local_date) WHERE local_date IS NOT NULL DO
-- NOTHING`) -- without it, Postgres raises "there is no unique or exclusion
-- constraint matching the ON CONFLICT specification" for a partial index,
-- even though a human reading the schema would expect it to just work.
-- PostgREST's `on_conflict` query parameter -- what supabase-js's
-- `onConflict` option sends, verified directly in
-- web/node_modules/@supabase/postgrest-js/src/PostgrestQueryBuilder.ts
-- (`url.searchParams.set('on_conflict', onConflict)`) -- only carries a bare
-- comma-separated column list, with no way to attach that predicate. This
-- codebase has already hit and documented an analogous mistake once:
-- 20260904000000_usage_counters.sql's own header records that an earlier B
-- guide "recommended the upsert form believing it was reachable from
-- supabase-js. It is not," and moved to a plpgsql RPC function instead --
-- same fix shape, applied here. Because this exact risk cannot be settled
-- without a live Postgres+PostgREST instance (DB proof is BLOCKED, as
-- above), routing around it entirely via a hand-written ON CONFLICT clause
-- inside a function -- where the predicate CAN be written explicitly -- is
-- the safer offline-authored choice, not a stylistic preference.
--
-- Deliberately NOT `security definer`: the only caller
-- (web/src/app/api/jobs/dispatch-digests/route.ts) holds the service-role
-- key already, which already bypasses RLS -- there is nothing to elevate and
-- nothing to review. Mirrors increment_usage_counter's exact reasoning.
--
-- `returning briefing_deliveries.id` (table-qualified, not bare `id`) is
-- deliberate, not decorative: `returns table (id bigint)` makes plpgsql
-- declare an implicit OUT variable literally named `id` in this function's
-- own scope, so an UNQUALIFIED `returning id` would be ambiguous between
-- that variable and the table column (plpgsql's default
-- `variable_conflict = error` makes that a hard failure at call time, not a
-- silent bug). increment_usage_counter hits the same shape of collision and
-- resolves it the same way (its INSERT is aliased `as c` and returns
-- `c.value`, not bare `value`) -- same fix, applied here since this INSERT
-- has no alias to borrow.
create or replace function public.claim_briefing_delivery(
  p_user_id    uuid,
  p_local_date text,
  p_channel    text,
  p_item_ids   text[],
  p_payload    jsonb
) returns table (id bigint)
language plpgsql
as $$
begin
  if p_local_date is null then
    raise exception 'claim_briefing_delivery requires a non-null p_local_date';
  end if;

  return query
    insert into public.briefing_deliveries (user_id, local_date, channel, item_ids, payload)
    values (p_user_id, p_local_date, p_channel, p_item_ids, p_payload)
    on conflict (user_id, local_date) where local_date is not null do nothing
    returning briefing_deliveries.id;
end;
$$;

revoke all on function public.claim_briefing_delivery(uuid, text, text, text[], jsonb)
  from public, anon, authenticated;
grant execute on function public.claim_briefing_delivery(uuid, text, text, text[], jsonb)
  to service_role;

-- ── F-A-P4-04: this migration touches ONLY briefing_deliveries ──
-- No column, index, or function above references dashboard_deliveries or
-- dashboard_batches (web/supabase/migrations/
-- 20260924000000_dashboard_delivery_ledger.sql). ABC-JEV-INTEGRATION.md
-- §1p.C.2 binds email and dashboard delivery state to stay fully independent
-- "for now" -- this migration does not merge or cross-reference them,
-- matching dispatch-digests/route.ts's own independence (see that file's
-- dashboard-ledger protective test in route.test.ts, which statically scans
-- the route's source for any such reference).

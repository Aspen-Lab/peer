-- P4-S6: never-delivered-only rollover candidate storage (acceptance 16
-- rollover subcases, acceptance 17 "final pool up to 30", F-A-P4-08
-- remainder, ABC-JEV-INTEGRATION.md §1g/§1p.C.4). This migration is
-- authored only; it is not applied by this campaign, following the same
-- convention as 20260924000000_dashboard_delivery_ledger.sql and every
-- other 2026-09-2x migration in this directory.
--
-- DB/RLS PROOF: BLOCKED. No isolated Supabase instance is available to this
-- agent. Everything below has been statically self-reviewed only (column
-- types, constraints, RLS policy shape, grant/revoke symmetry, function
-- control flow) -- never executed against a real Postgres instance.
--
-- DEDICATED TABLE, not a jsonb column on dashboard_batches (binding ruling
-- ABC-JEV-INTEGRATION.md §1p.C.4, overriding the earlier B guide draft's
-- DESIGN §6 "rollover_candidates jsonb column on dashboard_batches"
-- proposal in docs/jev-abc/P4-B-20260924T0338Z.md): a day with no visit has
-- NO dashboard_batches row at all -- that table's rows are created only
-- when a batch is actually minted (web/src/app/api/feed/route.ts's
-- runLedgerAwareFeed) -- yet up to 30 never-delivered candidates from the
-- LAST computed final pool must still survive to compete on a later day the
-- owner does visit, and there may be several no-visit days in between with
-- nowhere on dashboard_batches to hang that state.
--
-- Retention (30 days from first_seen_at) is enforced entirely at READ time
-- (see web/src/lib/dashboard/rollover-store.ts's `list`) -- there is no
-- purge/delete job in this migration or anywhere else in this campaign (not
-- authorized). A row older than 30 days simply stops being returned by
-- `list`; it is never physically deleted by this migration or its function.
create table if not exists public.dashboard_rollover_candidates (
  owner_id       uuid not null references auth.users(id) on delete cascade,
  canonical_key  text not null,
  aliases        text[] not null default '{}',
  -- Opaque to this migration and to rollover-store.ts (same "never assume a
  -- feed-specific shape" discipline dashboard_batches.served_items already
  -- documents in 20260924000000_dashboard_delivery_ledger.sql): the minimal
  -- item payload the pipeline needs to re-score this candidate on a later
  -- day (the same cached-item shape the day's pool already carries,
  -- including admissionChannels/identity-relevant metadata). No personal
  -- intent/AI-reason text is required here -- this row is already
  -- owner-scoped by owner_id/RLS, so anything it carries is already
  -- private to this owner, same as every other row on this table.
  payload        jsonb not null,
  first_seen_at  timestamptz not null default now(),
  -- YYYY-MM-DD, the local date of the mint that most recently saw this
  -- candidate in its final pool. Opaque string, same convention as
  -- dashboard_batches.local_date -- this migration never parses it.
  last_pool_date text not null,
  -- P4-S6-FIX (F-A-P4S6-01, ABC-JEV-INTEGRATION.md §1g "...may compete
  -- tomorrow, subject to current eligibility" / round-3 ruling in §4):
  -- the canonical intent snapshot (web/src/lib/feed/intent.ts's
  -- serializeFeedIntent) in effect on the day this row's payload was last
  -- (re-)written. Nullable: absent on every row written before this
  -- column existed, and on a row upserted from a request that carried no
  -- structured intent at all (route.ts's GET path) -- both cases are
  -- treated identically by the reader (route.ts's
  -- reconcileRolloverCandidateIntent): a null/mismatched intent_version
  -- means the candidate's admissionChannels tag is stripped before it can
  -- compete again, so it must re-qualify through today's literal keyword
  -- gate. Opaque to this migration, same "never assume a feed-specific
  -- shape" discipline as `payload` above.
  intent_version text,
  constraint dashboard_rollover_candidates_payload_is_object
    check (jsonb_typeof(payload) = 'object'),
  primary key (owner_id, canonical_key)
);

alter table public.dashboard_rollover_candidates enable row level security;

-- Owner-only SELECT, no INSERT/UPDATE policy: writes are server-side/
-- service-role only, through upsert_rollover_candidates below -- mirrors
-- dashboard_batches/dashboard_deliveries' own convention exactly (see
-- 20260924000000_dashboard_delivery_ledger.sql). Defense in depth only
-- (the F-A-P4S1-03 precedent, ABC-JEV-INTEGRATION.md §4 "P4-S1 fresh A"):
-- no client code reads this table today -- web/src/lib/dashboard/rollover-store.ts
-- always reads through the service-role admin client, never the owner's
-- own session client.
create policy "owners read their dashboard rollover candidates"
  on public.dashboard_rollover_candidates for select using (auth.uid() = owner_id);

revoke all on table public.dashboard_rollover_candidates from anon, authenticated;
grant select on table public.dashboard_rollover_candidates to authenticated;

-- ── Atomic upsert, one round trip for a whole day's remainder ────────────
-- Same jsonb_array_elements idiom as acknowledge_dashboard_batch
-- (20260924000000_dashboard_delivery_ledger.sql): p_candidates is a jsonb
-- array of {key, aliases, payload} objects, so one call handles up to
-- FINAL_POOL_SIZE (30, web/src/lib/feed/pipeline.ts) rows.
--
-- first_seen_at is DELIBERATELY ABSENT from the "do update set" clause: on
-- a fresh insert it takes its column default (now()); on a conflict (a
-- candidate already stored from an earlier day) it is left untouched, so a
-- candidate's first_seen_at always reflects the FIRST day it was ever
-- stored, no matter how many later days re-upsert it -- this is the exact
-- "keeps first_seen, updates last_pool_date and payload" contract the
-- rollover design requires (web/src/lib/dashboard/rollover-store.ts's
-- RolloverCandidateStore.upsert doc comment). A generic client-side
-- .upsert() call was considered and rejected: this codebase consistently
-- uses a dedicated plpgsql function whenever a write needs precise,
-- partial-column-preserving semantics rather than relying on a library's
-- implicit merge behaviour (see increment_usage_counter,
-- acknowledge_dashboard_batch).
--
-- Not security definer: the only caller holds the service role key, which
-- already bypasses RLS, so there is nothing to elevate and nothing to
-- review.
create or replace function public.upsert_rollover_candidates(
  p_owner_id uuid,
  p_local_date text,
  p_candidates jsonb
) returns void
language plpgsql
as $$
begin
  insert into public.dashboard_rollover_candidates
    (owner_id, canonical_key, aliases, payload, first_seen_at, last_pool_date, intent_version)
  select
    p_owner_id,
    candidate ->> 'key',
    coalesce(
      (
        select array_agg(alias)
        from jsonb_array_elements_text(
          case when jsonb_typeof(candidate -> 'aliases') = 'array' then candidate -> 'aliases' else '[]'::jsonb end
        ) as alias
      ),
      '{}'
    ),
    coalesce(candidate -> 'payload', '{}'::jsonb),
    now(),
    p_local_date,
    -- P4-S6-FIX (F-A-P4S6-01): camelCase JSON key, matching how the JS
    -- caller (rollover-store.ts's upsert) already sends `key`/`aliases`/
    -- `payload` -- nullable column, so a missing key simply inserts NULL,
    -- no coalesce needed (unlike payload/aliases, which are NOT NULL).
    candidate ->> 'intentVersion'
  from jsonb_array_elements(coalesce(p_candidates, '[]'::jsonb)) as candidate
  where candidate ->> 'key' is not null
  on conflict (owner_id, canonical_key) do update
    -- first_seen_at stays deliberately absent here (see the comment above
    -- this function). intent_version IS refreshed on every conflict, same
    -- as payload/aliases/last_pool_date -- it must always reflect the most
    -- recent day this candidate was actually re-selected (P4-S6-FIX).
    set aliases        = excluded.aliases,
        payload         = excluded.payload,
        last_pool_date  = excluded.last_pool_date,
        intent_version  = excluded.intent_version;
end;
$$;

revoke all on function public.upsert_rollover_candidates(uuid, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.upsert_rollover_candidates(uuid, text, jsonb)
  to service_role;

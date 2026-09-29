-- P4-S1: owner-level, PERMANENT dashboard delivery ledger + per-day batch
-- tracking + atomic acknowledgment (acceptance 16, ABC-JEV-INTEGRATION.md
-- §1p.C). This migration is authored only; it is not applied by this
-- campaign, following the same convention as
-- 20260922000000_private_paper_pools.sql and 20260904000000_usage_counters.sql.
--
-- DB/RLS PROOF: BLOCKED. No isolated Supabase instance is available to this
-- agent (foundation slice P4-S1, no DB/network access permitted). Everything
-- below has been statically self-reviewed only (table/FK order, column
-- types, constraints, RLS policy shape, grant/revoke symmetry, function
-- control flow) -- never executed against a real Postgres instance.
--
-- Table creation order matters: dashboard_batches is created FIRST because
-- dashboard_deliveries.batch_id references it (FK order).
--
-- Batch status values are exactly 'prepared' | 'served' | 'acknowledged'
-- (binding ruling ABC-JEV-INTEGRATION.md §1p.C.5 -- NOT the earlier B guide
-- draft's 'presented_pending_ack'):
--   prepared     - selected, never sent to a client.
--   served       - returned to an authenticated client (possibly presented
--                  -- the server cannot observe that a card actually
--                  rendered in a browser, only that a response carrying it
--                  was sent).
--   acknowledged - the client confirmed the batch rendered. This is the
--                  ONLY transition that copies papers into
--                  dashboard_deliveries (see the function below).

-- ── dashboard_batches ────────────────────────────────────────────────────
-- One row per (owner, local date) -- the unit acknowledgment operates on.
-- `papers` freezes the ordered per-paper identity (canonical key + aliases)
-- selected at prepare time, as a jsonb array of {key, aliases} objects
-- rather than two parallel arrays: aliases is itself variable-length per
-- paper, so a parallel-array shape would need an array-of-arrays column and
-- index-alignment discipline between it and a separate keys array, for no
-- real benefit. A jsonb array keeps each paper's key and its aliases
-- atomically paired and round-trips directly to/from the application's
-- PaperIdentity[] shape (web/src/lib/dashboard/delivery-ledger.ts).
create table if not exists public.dashboard_batches (
  id              uuid primary key default gen_random_uuid(),
  owner_id        uuid not null references auth.users(id) on delete cascade,
  local_date      text not null,              -- YYYY-MM-DD, owner's resolved local day; opaque to this migration
  papers          jsonb not null default '[]',
  status          text not null default 'prepared'
                    check (status in ('prepared', 'served', 'acknowledged')),
  intent_version  text,                        -- from NormalizedFeedIntent, for future staleness checks
  created_at      timestamptz not null default now(),
  served_at       timestamptz,
  acknowledged_at timestamptz,
  -- P4-S3 addition -- the exact served item payloads (ScoredItem[], the same
  -- shape POST/GET /api/feed's own `items` response field carries), frozen
  -- at prepare/mint time so a same-day replay never depends on the day's
  -- pool cache (the pool cache key changes when intent changes mid-day, but
  -- this column does not). Nullable: a row written before this column
  -- existed has no stored items, and the application
  -- (web/src/app/api/feed/route.ts's resolveServedItems) falls back to
  -- reconstructing them from today's pool by canonical identity rather than
  -- treating a null here as an error.
  served_items    jsonb,
  constraint dashboard_batches_papers_is_array check (jsonb_typeof(papers) = 'array'),
  constraint dashboard_batches_served_items_is_array_or_null
    check (served_items is null or jsonb_typeof(served_items) = 'array'),
  unique (owner_id, local_date)
);

-- listServedUnacknowledged's query shape: owner_id + status = 'served'.
create index if not exists dashboard_batches_owner_status_idx
  on public.dashboard_batches (owner_id, status);

-- ── dashboard_deliveries ─────────────────────────────────────────────────
-- Owner-level, PERMANENT (no TTL/expiry column, ever -- ABC-JEV-INTEGRATION.md
-- §7.2: "正常账号使用期间不对推送记录设置每日/30 天失效"), keyed by canonical
-- paper identity, independent of project/source/device/daily cache.
-- primary key (owner_id, canonical_key) makes the acknowledgment function's
-- insert naturally idempotent via ON CONFLICT DO NOTHING below -- a
-- retried/duplicate ack call is safe to replay.
create table if not exists public.dashboard_deliveries (
  owner_id      uuid not null references auth.users(id) on delete cascade,
  canonical_key text not null,
  key_version   smallint not null default 1,   -- P4-S1 ships v1 of canonicalPaperKey only; see module comment
  aliases       text[] not null default '{}',
  batch_id      uuid not null references public.dashboard_batches(id) on delete cascade,
  delivered_at  timestamptz not null default now(),
  primary key (owner_id, canonical_key)
);

create index if not exists dashboard_deliveries_owner_idx
  on public.dashboard_deliveries (owner_id);

-- Alias lookups: "was this paper (under ANY of its known aliases) ever
-- delivered" (§1p.A's asymmetric-exclusion rule -- a candidate is excluded
-- if its own key OR any of its own aliases intersects this table's
-- keys-union-aliases) needs to be answerable without an N-row-per-candidate
-- scan.
create index if not exists dashboard_deliveries_aliases_idx
  on public.dashboard_deliveries using gin (aliases);

alter table public.dashboard_batches enable row level security;
alter table public.dashboard_deliveries enable row level security;

-- Owner-only SELECT, no INSERT/UPDATE policies on either table: both are
-- server-side/service-role writes only (mirrors briefing_deliveries'
-- "writes are done by ... service role" convention, schema.sql:262-263),
-- reached only through the ledger's prepareBatch/markServed (service-role
-- writes) and the acknowledge_dashboard_batch function below -- never a
-- direct PostgREST write from an authenticated client. This closes the
-- "unforgeable from body/query values" requirement for the ack surface.
create policy "owners read their dashboard batches"
  on public.dashboard_batches for select using (auth.uid() = owner_id);
create policy "owners read their dashboard deliveries"
  on public.dashboard_deliveries for select using (auth.uid() = owner_id);

-- Belt-and-suspenders, matching usage_counters.sql's explicit revoke: RLS
-- with no insert/update policy already blocks writes regardless of table
-- privilege, but an explicit revoke-then-grant-select-only removes any
-- doubt and matches "revoke all ... from anon, authenticated where
-- appropriate". anon never gets SELECT back -- there is no anonymous
-- owner_id for auth.uid() to match, so an anon grant would be dead
-- privilege at best.
revoke all on table public.dashboard_batches from anon, authenticated;
revoke all on table public.dashboard_deliveries from anon, authenticated;
grant select on table public.dashboard_batches to authenticated;
grant select on table public.dashboard_deliveries to authenticated;

-- ── Atomic, idempotent acknowledgment ────────────────────────────────────
-- Same shape as increment_usage_counter (20260904000000_usage_counters.sql):
-- one round trip, `for update` row lock so two concurrent acks (two devices
-- posting at once, or a retried request) collapse to one winner
-- deterministically instead of racing. Deliberately NOT security definer:
-- the only caller holds the service role key, which already bypasses RLS,
-- so there is nothing to elevate and nothing to review.
create or replace function public.acknowledge_dashboard_batch(
  p_owner_id uuid,
  p_batch_id uuid
) returns text  -- 'acknowledged' | 'already_acknowledged' | 'not_found' | 'owner_mismatch'
language plpgsql
as $$
declare
  v_status text;
  v_owner  uuid;
  v_papers jsonb;
begin
  select status, owner_id, papers into v_status, v_owner, v_papers
    from public.dashboard_batches
    where id = p_batch_id
    for update;

  if not found then
    return 'not_found';
  end if;
  if v_owner <> p_owner_id then
    -- Never reveal whether p_batch_id exists for a different owner beyond
    -- this generic status string (ABC-JEV-INTEGRATION.md §1p.C.5, B guide
    -- DESIGN §4).
    return 'owner_mismatch';
  end if;
  if v_status = 'acknowledged' then
    return 'already_acknowledged';
  end if;

  -- Acknowledging a 'prepared' OR 'served' batch both succeed (§1p.C.5):
  -- this function only inspects the batch's own stored state, never
  -- "today", so a cross-day late ack still succeeds and still correctly
  -- records that day's papers as delivered.
  -- The inner `case` guards against a per-paper `aliases` field that is
  -- anything other than a genuine JSON array (a JSON null, a missing key
  -- read back as SQL NULL, or a malformed scalar): jsonb_array_elements_text
  -- raises "cannot extract elements from a scalar" on a JSON null, which SQL
  -- NULL and an empty JSON array do not trigger, so this is not a redundant
  -- guard -- jsonb_typeof(x) = 'array' is false (not merely NULL-propagated)
  -- for every one of those cases and routes them to the empty-array literal
  -- instead.
  insert into public.dashboard_deliveries
    (owner_id, canonical_key, key_version, aliases, batch_id)
  select
    p_owner_id,
    paper ->> 'key',
    1,
    coalesce(
      (
        select array_agg(alias)
        from jsonb_array_elements_text(
          case when jsonb_typeof(paper -> 'aliases') = 'array' then paper -> 'aliases' else '[]'::jsonb end
        ) as alias
      ),
      '{}'
    ),
    p_batch_id
  from jsonb_array_elements(coalesce(v_papers, '[]'::jsonb)) as paper
  on conflict (owner_id, canonical_key) do nothing;

  update public.dashboard_batches
    set status = 'acknowledged', acknowledged_at = now()
    where id = p_batch_id;

  return 'acknowledged';
end;
$$;

revoke all on function public.acknowledge_dashboard_batch(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.acknowledge_dashboard_batch(uuid, uuid)
  to service_role;

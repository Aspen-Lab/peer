-- ABC-freemium 1-02 · R-METER-3.
--
-- Per-user counters that survive a cold start and are shared across instances.
-- They replace a module-scope `Map` in `web/src/lib/security/ai-request.ts`,
-- which lived in one Node process: a serverless instance that had just started
-- always saw zero, so the 60/h feed and 20/h report limits were per-instance
-- rather than per-user.
--
-- **The period lives in the key, not in a column.** A key is
-- `rate:<scope>:<user>:<YYYY-MM-DDTHH>`, `deep:<user>:<YYYY-MM>`,
-- `deep:<user>:<YYYY-MM-DD>`, `deep:<user>:trial` or
-- `forced_rebuilds_today:<user>:<YYYY-MM-DD>`, all in UTC (D4 says "the rest of
-- the UTC day"). The last one was `search:<user>:<YYYY-MM-DD>` until
-- ABC-freemium 5-02 (Ruling 13 point 1) renamed it: under D2a the operator funds
-- no search, and the only caller left is the forced pool rebuild. COMMENT ONLY —
-- no DDL changed, and this migration is still unapplied.
-- So a window rolls over because the key changes, and a tripped daily breaker
-- untrips at UTC midnight with no second source of truth to keep in step.
-- `window_ends_at` is stored for housekeeping only — nothing reads it to decide
-- anything.

create table if not exists public.usage_counters (
  key            text primary key,
  value          bigint not null default 0,
  window_ends_at timestamptz,
  updated_at     timestamptz not null default now()
);

-- Old rows are dead weight once their period has passed. There is no sweep in
-- this migration (the opportunity_pools table has none either); the index is
-- here so a future one is a cheap delete rather than a full scan.
create index if not exists usage_counters_window_ends_at_idx
  on public.usage_counters (window_ends_at);

alter table public.usage_counters enable row level security;

-- No anon/authenticated policies. Counters are written by the server-side
-- service role, which bypasses RLS. A browser that could write its own counter
-- could zero its own quota.
revoke all on table public.usage_counters from anon, authenticated;

-- ── The atomic increment ──────────────────────────────────────
--
-- **A select-then-update would be two round trips and would race exactly where
-- it matters** — two tabs both read 4 of 5 deep reports and both proceed. This
-- is one statement, so the post-increment value it returns is the caller's own
-- and no two callers can be handed the same number.
--
-- It is a function rather than a PostgREST upsert because PostgREST's
-- `resolution=merge-duplicates` can only write `set col = excluded.col`; there
-- is no way to express `value = usage_counters.value + excluded.value` through
-- it. (ABC-freemium 1-02 records this: B's guide recommended the upsert form
-- believing it was reachable from supabase-js. It is not.)
--
-- Deliberately **not** `security definer`: the only caller holds the service
-- role key, which already bypasses RLS, so there is nothing to elevate and
-- nothing to review.
create or replace function public.increment_usage_counter(
  p_key            text,
  p_window_ends_at timestamptz default null,
  p_by             bigint default 1
) returns bigint
language plpgsql
as $$
declare
  v_value bigint;
begin
  insert into public.usage_counters as c (key, value, window_ends_at, updated_at)
  values (p_key, p_by, p_window_ends_at, now())
  on conflict (key) do update
    set value          = c.value + excluded.value,
        window_ends_at = coalesce(excluded.window_ends_at, c.window_ends_at),
        updated_at     = now()
  returning c.value into v_value;
  return v_value;
end;
$$;

revoke all on function public.increment_usage_counter(text, timestamptz, bigint)
  from public, anon, authenticated;
grant execute on function public.increment_usage_counter(text, timestamptz, bigint)
  to service_role;

-- ABC-freemium 1-13 · R-ENT-1 · D5 · D7.
--
-- The plan a user is on, and the trial they get for opening the app. Before
-- this there was no server-side input of any kind that could make a request
-- behave as trial or paid, which is why two of the five personas could not be
-- constructed at all.
--
-- **Nothing in this loop can apply this file.** Until an admin runs it,
-- `resolveEntitlement` treats the missing column exactly like a missing row and
-- every signed-in user resolves `free`. That is by design and it is what lets
-- the rest of the round land while this waits.

-- ── The columns ───────────────────────────────────────────────
--
-- **The column default is 'free', NOT 'trial', and the difference matters.**
-- A column default governs the rows that already exist when this runs. Making
-- it 'trial' would silently convert every current user into a 14-day trial that
-- started at migration time — a decision D5 does not make. New users get their
-- trial from the trigger below, which is what D5 actually says.
alter table public.profiles
  add column if not exists plan text not null default 'free'
    check (plan in ('free', 'trial', 'paid')),
  add column if not exists trial_started_at timestamptz,
  add column if not exists trial_ends_at    timestamptz,
  add column if not exists plan_updated_at  timestamptz;

-- D7 — the documented hook, and nothing more. Payment integration is out of
-- scope (spec §3), and a stub route would be a payment surface that does not
-- work. A future Stripe webhook writes `plan`, `plan_updated_at` and, when a
-- trial converts, clears `trial_ends_at`; it authenticates as the service role,
-- which is the only identity these columns accept.
comment on column public.profiles.plan is
  'free | trial | paid. Set by hand (service role) today; the future Stripe webhook writes here. Never writable by anon or authenticated - see the column grants below.';

-- ── D5: a new user starts a 14-day trial ──────────────────────
--
-- The whole function is re-declared rather than patched: it is
-- `security definer set search_path = public`, and re-declaring is the only
-- safe way to edit that. The body is `schema.sql`'s plus the four plan columns.
-- The `on_auth_user_created` trigger needs no change.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (
    user_id, plan, trial_started_at, trial_ends_at, plan_updated_at
  )
  values (
    new.id, 'trial', now(), now() + interval '14 days', now()
  )
  on conflict (user_id) do nothing;
  return new;
end;
$$;

-- ── R-ENT-1's RLS half, and it is the one place a wrong migration
--    silently hands every user a free upgrade ────────────────────
--
-- The three existing policies let a user select, insert and update **their own
-- row** — and that update policy would let a browser write its own `plan`.
-- Postgres RLS has no column-level grant inside a policy, so the correct
-- instrument is a column privilege. The row policies are left exactly as they
-- are for every other column.
--
-- The service role bypasses RLS **and** column grants, which is what D7's
-- "a column an admin sets by hand (service role)" means.
--
-- The request path is guarded independently: `PUT /api/profile` maps a fixed
-- set of fields and none of these four is among them. `1-16` asserts that,
-- because the SQL itself cannot be exercised from this loop.
--
-- CORRECTED 2026-09-14, and this is what production ran (as the separate
-- migration `profile_plan_column_grants`). The original line here was
--   revoke update (plan, trial_started_at, trial_ends_at, plan_updated_at)
--     on public.profiles from anon, authenticated;
-- and on Supabase it does nothing: anon and authenticated hold table-level
-- UPDATE and INSERT by default, and a column revoke cannot remove a table
-- grant — so a signed-in user could still PATCH their own plan to 'paid'.
-- Verified before the change. The fix takes the table-level write privileges
-- away and gives authenticated back every column except the four plan columns.
-- INSERT is included because PUT /api/profile upserts.
--
-- Consequence: a future profiles column that a user may edit needs its own
--   grant update (col), insert (col) on public.profiles to authenticated;
revoke update, insert on public.profiles from anon, authenticated;

do $$
declare
  cols text;
begin
  select string_agg(quote_ident(column_name), ', ' order by ordinal_position)
    into cols
  from information_schema.columns
  where table_schema = 'public' and table_name = 'profiles'
    and column_name not in ('plan', 'trial_started_at', 'trial_ends_at', 'plan_updated_at');
  execute format('grant update (%s) on public.profiles to authenticated', cols);
  execute format('grant insert (%s) on public.profiles to authenticated', cols);
end $$;

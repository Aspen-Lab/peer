-- Peer has no paid tier, no plan and no trial any more. This migration takes
-- the plan out of the database and puts the signup trigger back the way it
-- was before the plan existed.
--
-- A FORWARD migration. The three 20260904 files stay exactly as they are (they
-- are applied history, and `upstream-migrations.test.ts` pins them byte for
-- byte); this one undoes their plan half. There is no rollback file, the same
-- as 20261001000000: the rollback glob (`2026092*`) does not cover this stem.
-- To bring the plan columns back you would have to write a new migration, and
-- the data in them cannot be brought back (see "What this destroys").
--
-- What this destroys
--   The four columns `profiles.plan`, `trial_started_at`, `trial_ends_at` and
--   `plan_updated_at`, with every value in them: 'free' or 'trial' for every
--   reader, and any 'paid' that was set by hand with the service role. No
--   reader typed any of it. Before applying, take the census:
--     select plan, count(*) from public.profiles group by 1;
--
-- What this does not touch
--   * `usage_counters` and `increment_usage_counter()` stay. They carry the
--     hourly rate limit on every AI route, the Resend caps, the source-retry
--     claims and the manual-refresh cooldown. Old `deep:*` rows in it are
--     harmless and are left alone.
--   * `usage_events` stays until the part of this work that removes the usage
--     ledger; export it first.
--   * Grants. 20260904000200 revoked table-level INSERT and UPDATE on
--     `profiles` from anon and authenticated and granted authenticated the
--     columns that then existed, except the four plan columns. That is least
--     privilege and later migrations (20260922010000 `feed_intent`) already
--     rely on it, so it is NOT widened here. Dropping a column drops the grants
--     on it. The standing rule stays: a future `profiles` column that a reader
--     may edit needs its own
--       grant update (col), insert (col) on public.profiles to authenticated;
--   * The `on_auth_user_created` trigger itself is unchanged; only the
--     function it calls is re-declared.
--
-- Safe in either order with the code: the current server treats an error on
-- the plan select exactly like a missing row, and the code in this change
-- never reads the plan. Idempotent: safe to run twice.

-- ── Signup: an empty profile row, nothing else ────────────────
--
-- The whole function is re-declared rather than patched: it is
-- `security definer set search_path = public`, and re-declaring is the only
-- safe way to edit that. The body is the one taken with pg_get_functiondef on
-- 2026-09-14 before any plan migration
-- (docs/handoff/supabase-backup-2026-09-14/handle_new_user.before.sql), and it
-- is `schema.sql`'s. CREATE OR REPLACE keeps the function's owner and grants.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (user_id)
  values (new.id)
  on conflict (user_id) do nothing;
  return new;
end;
$$;

-- ── The plan columns ──────────────────────────────────────────
--
-- Without CASCADE on purpose: if a view, policy or function somewhere still
-- depends on one of these columns, this fails loudly instead of dropping that
-- object with it.
alter table public.profiles
  drop column if exists plan,
  drop column if exists trial_started_at,
  drop column if exists trial_ends_at,
  drop column if exists plan_updated_at;

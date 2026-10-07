-- Peer pays for no model call and no web search any more, so there is no usage
-- ledger to keep and no company dollar budget to enforce. This migration drops
-- the tables that held them and clears the counter rows that metered the old
-- allowances.
--
-- A FORWARD migration, run by hand in the Supabase SQL editor like the others.
-- It follows 20261007000000_drop_plan_and_restore_signup.sql. The files that
-- created these tables (20260904000100_usage_events.sql and
-- 20260925000000_company_spend_budget.sql, with that one's rollback) stay as
-- history: production's state is unknown (the budget migration was authored
-- but possibly never applied), and every DROP below is `if exists`, so this runs
-- the same either way. There is no rollback file, the same as 20261001000000:
-- the rollback glob (`2026092*`) does not cover this stem, and a dropped ledger
-- cannot be brought back by a script.
--
-- EXPORT usage_events BEFORE YOU RUN THIS. It is the only thing here that holds
-- data worth keeping: one row per model call (user id, route, provider, model,
-- token counts, latency, ok, and whether it ran on the reader's own key). It
-- holds no prompt, no answer and no credential, but it is the owner's spend
-- audit trail and the rollback README forbids dropping a table without a
-- retention decision. Something like, from psql:
--     \copy (select * from public.usage_events) to 'usage_events.csv' csv header
-- or "Export to CSV" on the table in the dashboard.
--
-- What this destroys
--   * public.usage_events (and its two indexes): every row, as above.
--   * public.company_spend_caps and public.company_model_prices: operator-set
--     configuration only (two dollar ceilings, a per-model price table), never
--     reader data.
--   * Rows in public.usage_counters whose key starts with
--       deep:                    the deep-report allowance (monthly, daily, trial)
--       forced_rebuilds_today:   the forced pool rebuild breaker
--       company_spend:           the company dollar budget's reservations
--       jev:                     the Jev daily call caps (per reader and global)
--       jev-edge:                the same caps as counted inside the jev-broker
--                                edge function
--     Every one of those keys carries its period in the key (a UTC day, month or
--     "trial"), so nothing reads an old row to decide anything; deleting them is
--     housekeeping. The Jev caps are daily windows: if the Jev call counts are
--     rebuilt later, the worst effect of deleting today's rows is one day's
--     allowance starting from zero.
--
-- What this does not touch
--   * public.usage_counters and public.increment_usage_counter() stay. They
--     carry the hourly rate limit on every AI route, the Resend caps on the test
--     and confirm emails, the source-retry claims in the paper pipeline and the
--     manual-refresh cooldown. Only the five key families above are removed:
--     `rate:`, `test_email:`, `confirm_email:` and the rest are left alone.
--   * Grants. Dropping a table drops the grants on it; no grant is added.
--
-- Safe in either order with the code: the code in this change reads and writes
-- none of these tables, and the counter rows it still uses are different keys.
-- Idempotent: safe to run twice.

-- ── The ledger and the budget ─────────────────────────────────
--
-- Without CASCADE on purpose: if a view, policy or function somewhere still
-- depends on one of these tables, this fails loudly instead of dropping that
-- object with it. The two budget tables have no foreign keys; usage_events has
-- none either.
drop table if exists public.company_model_prices;
drop table if exists public.company_spend_caps;
drop table if exists public.usage_events;

-- ── The counter rows that metered the old allowances ──────────
delete from public.usage_counters
  where key like 'deep:%'
     or key like 'forced_rebuilds_today:%'
     or key like 'company_spend:%'
     or key like 'jev:%'
     or key like 'jev-edge:%';

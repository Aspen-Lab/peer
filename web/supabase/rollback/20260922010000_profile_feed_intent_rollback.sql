-- NOT A MIGRATION — NEVER APPLIED AUTOMATICALLY.
-- Nothing in this repository reads this file. No Supabase CLI migration
-- runner, script, or CI step ever executes it. A human may run it by hand
-- (psql / the Supabase SQL editor) ONLY after a separately approved
-- retention/backup plan exists for the data it destroys, per
-- ABC-JEV-INTEGRATION.md §3e ("Do not drop old tables until a separately
-- approved retention/migration plan; snapshots and stored reading history
-- preserved."). See web/supabase/rollback/README.md for the full policy.
--
-- Reverses: web/supabase/migrations/20260922010000_profile_feed_intent.sql
--
-- Destroys: every value stored in public.profiles.feed_intent. This is the
-- HIGHEST-CAUTION rollback in this folder together with the dashboard
-- delivery ledger's, for a different reason: this column holds the user's
-- OWN DECLARED research intent, typed by a person — not something the
-- system computed or cached. It is the single most user-facing
-- personalization input in this whole campaign. Dropping the column
-- destroys something a user wrote, permanently, for every profile that has
-- one set. This must NEVER be run without an exported backup of the
-- column's current contents first, regardless of how the general
-- three-tier caution ranking in the README reads for the other five files.
--
-- Order constraint: single ALTER on public.profiles, no dependent
-- table/index/function anywhere references this column (confirmed by
-- reading the forward migration in full — it adds only the column, a
-- comment, and two column-scoped grants). The two grants are revoked
-- before the column is dropped, though PostgreSQL would also drop
-- column-scoped grants automatically as part of DROP COLUMN; the explicit
-- revoke is kept here for the same clarity-over-terseness reason the
-- forward migration explains why it needed an explicit grant in the first
-- place (an earlier profile-plan migration revoked table-level writes).

revoke update (feed_intent) on public.profiles from authenticated;
revoke insert (feed_intent) on public.profiles from authenticated;

alter table public.profiles drop column if exists feed_intent;

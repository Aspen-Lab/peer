-- NOT A MIGRATION — NEVER APPLIED AUTOMATICALLY.
-- Nothing in this repository reads this file. No Supabase CLI migration
-- runner, script, or CI step ever executes it. A human may run it by hand
-- (psql / the Supabase SQL editor) ONLY after a separately approved
-- retention/backup plan exists for the data it destroys, per
-- ABC-JEV-INTEGRATION.md §3e ("Do not drop old tables until a separately
-- approved retention/migration plan; snapshots and stored reading history
-- preserved."). See web/supabase/rollback/README.md for the full policy.
--
-- Reverses: web/supabase/migrations/20260922000000_private_paper_pools.sql
--
-- Destroys: every row in public.private_paper_pools. As of this writing
-- that table holds ONLY per-owner, per-day paper-pool cache rows (key
-- prefix "peer-pool-v6-papers-", confirmed by a fresh grep of
-- web/src/lib/opportunities/private-paper-cache.ts). Regenerable — losing
-- these rows costs recomputation (the pool is rebuilt on the next request),
-- not correctness, and not a broken promise to the user.
--
-- KNOWN FORWARD-LOOKING CAUTION (open item, see README "Known open item"
-- section and docs/JEV-RELEASE-READINESS.md): a near-future slice, P2-S4d
-- (designed but NOT YET BUILT as of this writing — see
-- docs/jev-abc/P2-S4c-B-20260924T113605Z.md ADDENDUM — confirmed absent by
-- a fresh grep for "ChannelCandidateCache"/"peer-channels-v1-" under
-- web/src, zero hits), is planned to store a SECOND, differently-shaped
-- dataset in this SAME physical table: a per-owner daily cache of the
-- read-time recommendation channels, under a distinct key prefix
-- ("peer-channels-v1-"). Once that slice ships, running this rollback file
-- will ALSO destroy those rows — still regenerable/cache-like in kind (not
-- a new risk tier), but broader in scope than this header's first
-- paragraph describes today. Whoever reviews this file before running it
-- after P2-S4d has landed should re-read this header and confirm the
-- "regenerable, cache-like" classification still holds for both datasets
-- before proceeding. Neither dataset has a retention/expiry policy at all
-- today (P2-S4c-B ADDENDUM POLICY item 7) — that is a separate open user
-- decision, not something this file resolves.
--
-- Order constraint: single table, no dependents anywhere in this schema
-- (nothing in web/supabase/migrations/ declares a foreign key against
-- private_paper_pools). Policies are dropped explicitly before the table
-- for clarity, though PostgreSQL would also drop them automatically as
-- part of DROP TABLE.

drop policy if exists "owners update their private paper pools" on public.private_paper_pools;
drop policy if exists "owners write their private paper pools" on public.private_paper_pools;
drop policy if exists "owners read their private paper pools" on public.private_paper_pools;

drop table if exists public.private_paper_pools;

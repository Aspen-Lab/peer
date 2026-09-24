-- NOT A MIGRATION — NEVER APPLIED AUTOMATICALLY.
-- Nothing in this repository reads this file. No Supabase CLI migration
-- runner, script, or CI step ever executes it. A human may run it by hand
-- (psql / the Supabase SQL editor) ONLY after a separately approved
-- retention/backup plan exists for the data it destroys, per
-- ABC-JEV-INTEGRATION.md §3e ("Do not drop old tables until a separately
-- approved retention/migration plan; snapshots and stored reading history
-- preserved."). See web/supabase/rollback/README.md for the full policy.
--
-- Reverses: web/supabase/migrations/20260924000400_private_decisions.sql
--
-- Destroys: every row in public.private_decisions — the owner-scoped Jev
-- decision cache (7-component cache key: owner, project, intentHash,
-- paperContentHash, provider, modelVersion, rubricVersion). Regenerable —
-- losing these rows costs re-paying for the next Jev call that would
-- otherwise have been a cache hit, not correctness.
--
-- SPEND-SAFETY NOTE (not merely a generic caution — a concrete, bounded
-- cost consequence): running this rollback and later re-applying the
-- forward migration causes a BURST of cache misses on the very next read
-- for every owner who had cached decisions, because every one of those
-- reads must now call Jev again instead of hitting the cache. This is
-- bounded by the per-user/global daily reservation caps
-- (PEER_JEV_PER_USER_DAILY_CAP / PEER_JEV_GLOBAL_DAILY_CAP — see
-- docs/JEV-RELEASE-READINESS.md), not unbounded, but it is a real cost
-- event, not merely an inconvenience. Whoever reapplies the forward
-- migration after running this file should expect and budget for that
-- burst rather than be surprised by the next day's Jev bill.
--
-- Order constraint: single table, no dependents anywhere in this schema.
-- The policy is dropped explicitly before the table for clarity, though
-- PostgreSQL would also drop it automatically as part of DROP TABLE.

drop policy if exists "owners read their private decisions" on public.private_decisions;

drop table if exists public.private_decisions;

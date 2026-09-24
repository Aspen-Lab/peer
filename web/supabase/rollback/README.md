# Rollback SQL — authored only, never applied automatically

This folder is **new** for the P5 release-readiness slice. It is not a continuation of an
existing practice: no migration anywhere in this repository, before or during this
campaign, has ever had a paired "down" migration (confirmed by a full listing of
`web/supabase/migrations/` — 11 files, zero `*down*`/`*rollback*` names before this folder
existed). Every file in here is a brand-new, hand-authored convention for this campaign
only.

## What these files are NOT

- **Not migrations.** Nothing in `web/supabase/migrations/` reads this folder. A Supabase
  CLI migration runner (or any future one) has no reason to discover these files — they
  live in a sibling folder specifically so it never does.
- **Never applied automatically, by anything.** No `npm` script, no CI workflow, no
  Vercel Cron entry, no application code path ever opens, reads, or executes a file in
  this folder. The one automated check that DOES touch this folder is a test
  (`web/src/lib/release/rollback-parity.test.ts`) that only confirms these files *exist*
  and carry the required header — it never runs a single line of the SQL inside them.
- **Not a substitute for a backup/retention plan.** Every file below is authored so a
  human *could* run it by hand (`psql`, or the Supabase SQL editor) — but per
  `ABC-JEV-INTEGRATION.md` §3e's binding instruction ("Do not drop old tables until a
  separately approved retention/migration plan; snapshots and stored reading history
  preserved"), **no one should actually run any of these files until a separately
  approved retention/backup plan exists** for whatever it would destroy. Writing the SQL
  and authorizing its use are two different decisions; this folder only does the first.

## What these files ARE

One rollback file per forward migration in `web/supabase/migrations/2026092*.sql`,
named `<same timestamp+name>_rollback.sql`. Each file's header states, in this order:

1. **NOT A MIGRATION — NEVER APPLIED AUTOMATICALLY** (verbatim phrase, checked by the
   parity test).
2. The forward migration it reverses.
3. Exactly what data it destroys, or the word "none" if the migration only removed
   grants/policies/functions with no table drop.
4. Whether that destroyed data is **regenerable** (cache-like — losing it costs
   recomputation or re-spend, not correctness or a broken promise to the user) or
   **guarantee-bearing** (it either holds something the user typed, or it exists
   specifically to keep a promise the product makes — see the ranking below).
5. The order constraint: every statement inside the file is written in reverse
   dependency order from its forward migration (drop/revoke a function before dropping
   the table it reads or writes; drop a child table that holds a foreign key before the
   parent table it references — e.g. `dashboard_deliveries` before `dashboard_batches`).

## Would lose data — ranked, highest caution first

This ranking is about how bad it is if the data is gone, not how likely anyone is to run
the file (nobody should run any of them without a separately approved plan first).

1. **`20260924000000_dashboard_delivery_ledger_rollback.sql`** — breaks the product's
   "an already-shown paper never resurfaces" promise **retroactively** for every user.
   The `dashboard_deliveries` table has no expiry column anywhere, by design — that is
   the whole point of it. Dropping it does not just lose data, it silently un-does a
   guarantee the product already made to real users. Never run without an export first.
2. **`20260922010000_profile_feed_intent_rollback.sql`** — destroys **user-typed
   content**, not something the system computed. The `feed_intent` column holds the
   user's own declared research intent, the single most user-facing personalization
   input in this whole campaign. Never run without an export first.
3. **`20260924000300_briefing_deliveries_dedupe_rollback.sql`** — touches an
   **already-applied, already-live production table** (`briefing_deliveries` existed and
   held real rows before this campaign started). A mistake here touches real history, not
   an empty table, even though the column itself is additive/nullable.
4. **`20260922000000_private_paper_pools_rollback.sql`**, **`20260924000400_private_decisions_rollback.sql`**,
   **`20260924000500_dashboard_rollover_rollback.sql`**, **`20260924000600_dashboard_prepare_jobs_rollback.sql`**
   — all four are cache-or-queue-like and regenerable (losing them costs recomputation,
   or in the `private_decisions` case, re-paying for the next Jev call — see that file's
   own spend-safety note). Lower stakes than the three above, but still real user-visible
   impact for a while after a rollback, and still covered by the same "never without a
   backup" rule as a blanket policy, not because any one of them alone is catastrophic.
   The newest of the four (`dashboard_prepare_jobs`) is the lowest-stakes of all seven
   files — nothing calls this table's feature yet, so there is nothing live to interrupt.

## Known open item: `private_paper_pools` has no retention policy at all

Neither the rows that already exist (per-owner, per-day paper pools, key prefix
`peer-pool-v6-papers-`) nor the rows from a second cache in the SAME table (a per-owner
daily cache of the read-time recommendation channels, a different key prefix,
`peer-channels-v1-` — built by P2-S4d, now landed but not yet independently reviewed, see
`docs/jev-abc/P2-S4c-B-20260924T113605Z.md` ADDENDUM for its design) have an expiry or
cleanup job anywhere in this codebase. Rows simply accumulate forever. This is a real,
if slow, cost — and deciding a
retention period is itself a separately-approved-retention-plan decision under §3e, i.e.
a new user decision, not something this rollback file (or any code) may decide unilaterally.
See `docs/JEV-RELEASE-READINESS.md` for the full writeup; see
`20260922000000_private_paper_pools_rollback.sql`'s own header for how this affects that
one file specifically.

## The seven files

| Rollback file | Reverses | Destroys |
|---|---|---|
| `20260922000000_private_paper_pools_rollback.sql` | `private_paper_pools` table | Regenerable (day-pool cache; after P2-S4d, also a channel-candidate cache in the same table) |
| `20260922010000_profile_feed_intent_rollback.sql` | `profiles.feed_intent` column + grants | **User-typed**, not regenerable |
| `20260924000000_dashboard_delivery_ledger_rollback.sql` | `dashboard_batches` + `dashboard_deliveries` tables + `acknowledge_dashboard_batch` function | **Guarantee-bearing, permanent by design** |
| `20260924000300_briefing_deliveries_dedupe_rollback.sql` | `briefing_deliveries.local_date` column + index + `claim_briefing_delivery` function | Additive on an **already-live production table** |
| `20260924000400_private_decisions_rollback.sql` | `private_decisions` table | Regenerable (Jev decision cache; reapply causes a cache-miss cost burst, see file) |
| `20260924000500_dashboard_rollover_rollback.sql` | `dashboard_rollover_candidates` table + `upsert_rollover_candidates` function | Regenerable (rollover candidates recompute from the next pipeline run) |
| `20260924000600_dashboard_prepare_jobs_rollback.sql` | `dashboard_prepare_jobs` table + its 5 job-queue functions | Regenerable and lowest-stakes of the seven — a prepare job is only a scheduling note for work not yet done, never a record of anything that already happened; nothing triggers this queue yet |

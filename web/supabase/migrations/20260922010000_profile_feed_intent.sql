-- P1-01: versioned retrieval intent preserves omitted vs explicit-empty
-- independently from the legacy nullable text columns. Authored only; this
-- campaign must not apply it. Existing rows remain NULL and therefore import
-- as omitted with legacy-import provenance.
alter table public.profiles
  add column if not exists feed_intent jsonb null;

comment on column public.profiles.feed_intent is
  'Versioned user-declared feed intent; null means legacy omitted, never explicit-empty.';

-- The earlier profile-plan migration revokes table-level writes and dynamically
-- grants only columns present at that point. This later column therefore needs
-- an explicit authenticated grant while plan/trial remain server-owned.
grant update (feed_intent) on public.profiles to authenticated;
grant insert (feed_intent) on public.profiles to authenticated;

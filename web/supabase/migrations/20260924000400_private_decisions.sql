-- P3-S3: private, owner-scoped Jev decision cache. Mirrors
-- private_paper_pools's shape (owner_id + scope_key primary key, payload
-- jsonb). This migration is authored only; it is not applied by this
-- campaign.
--
-- Deliberately narrower RLS than private_paper_pools: owners may READ their
-- own decisions but never write them directly. Every write in this codebase
-- goes through the server-side admin client (service role, which bypasses
-- RLS by construction), so no authenticated-role insert/update policy is
-- granted here (ABC-JEV-INTEGRATION.md task instruction: "RLS owner-read,
-- service-role writes").
create table if not exists public.private_decisions (
  owner_id uuid not null references auth.users(id) on delete cascade,
  scope_key text not null,
  payload jsonb not null,
  created_at timestamptz not null default now(),
  primary key (owner_id, scope_key)
);

alter table public.private_decisions enable row level security;

create policy "owners read their private decisions"
  on public.private_decisions for select
  using (auth.uid() = owner_id);

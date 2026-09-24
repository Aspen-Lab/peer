-- P0-01: private paper-pool membership and Tier-2 reasons never share the
-- public opportunity_pools namespace. This migration is authored only; it is
-- not applied by this campaign.
create table if not exists public.private_paper_pools (
  owner_id uuid not null references auth.users(id) on delete cascade,
  scope_key text not null,
  payload jsonb not null,
  created_at timestamptz not null default now(),
  primary key (owner_id, scope_key)
);

alter table public.private_paper_pools enable row level security;

create policy "owners read their private paper pools"
  on public.private_paper_pools for select
  using (auth.uid() = owner_id);

create policy "owners write their private paper pools"
  on public.private_paper_pools for insert
  with check (auth.uid() = owner_id);

create policy "owners update their private paper pools"
  on public.private_paper_pools for update
  using (auth.uid() = owner_id)
  with check (auth.uid() = owner_id);

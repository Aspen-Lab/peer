-- ABC-freemium 1-03 · R-METER-1, R-METER-2.
--
-- One row per operator-funded call, so "what did this cost and who did it cost
-- it for" has an answer. Before this nothing was persisted: the LLM path wrote a
-- single console line and searches were not recorded at all.
--
-- **This table never holds a credential.** There is no column that could, and
-- none is to be added for debugging — a usage table is exactly where a leaked
-- key would survive longest.

create table if not exists public.usage_events (
  id              bigserial primary key,
  created_at      timestamptz not null default now(),
  -- Null for a library-level call inside a request the route already
  -- authenticated (feed reranking, opportunity query generation).
  user_id         uuid,
  -- 'llm'     — one model call (R-METER-1)
  -- 'search'  — one system-Tavily fan-out (R-METER-2)
  -- 'breaker' — a spend cap tripped (R-QUOTA-2); the audit trail, written
  --             alongside a counter that has already decided the outcome.
  kind            text not null check (kind in ('llm', 'search', 'breaker')),
  path            text,
  provider        text,
  model           text,
  input_tokens    integer,
  output_tokens   integer,
  thinking_tokens integer,
  latency_ms      integer,
  ok              boolean not null,
  -- True when the call ran on the user's own key and cost the operator nothing.
  -- **Nullable on purpose**: null means "not known" (a row written outside a
  -- resolved-provider scope). A wrong `false` would read as "the operator paid
  -- for this".
  byok            boolean,
  -- kind = 'search' only.
  surface         text,
  query_count     integer
);

create index if not exists usage_events_user_created_idx
  on public.usage_events (user_id, created_at desc);

create index if not exists usage_events_kind_created_idx
  on public.usage_events (kind, created_at desc);

alter table public.usage_events enable row level security;

-- No anon/authenticated policies. Rows are written by the server-side service
-- role, which bypasses RLS. A browser that could write here could forge its own
-- spend record; one that could read here would see other users' activity.
revoke all on table public.usage_events from anon, authenticated;

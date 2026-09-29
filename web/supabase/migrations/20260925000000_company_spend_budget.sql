-- Authored only; not applied by this campaign (never touch a real database —
-- SPEND-CAP's own hard rule). Adjustable knob for SPEND-CAP
-- (ABC-JEV-INTEGRATION.md §1t point 4, §1v rulings R1/R8/R9): two dollar
-- ceilings (one global, one per signed-in user) and per-model Gemini prices,
-- service-role read/write, no anon/authenticated policies — same RLS
-- convention as `usage_counters` (20260904000000_usage_counters.sql). See
-- docs/jev-abc/SPEND-CAP-B-20260925T042147Z.md for the full design and
-- ABC-JEV-INTEGRATION.md §1v for the binding rulings that adjust it
-- (R1: code-level defaults are $5.00/day global, $0.50/day per user, used
-- only when a row is absent — this migration seeds NO rows on purpose).

create table public.company_spend_caps (
  cap_key    text primary key,                  -- 'global_daily_usd' | 'per_user_daily_usd'
  amount_usd numeric(10,4) not null
    -- Upper bound is not decoration: Postgres's `numeric` NaN compares `>=`
    -- TRUE against every finite number (including 0), so a bare `>= 0` check
    -- does NOT reject 'NaN'::numeric. Bounding the top end closes it, because
    -- NaN also fails a `<=` comparison against any finite number. See the
    -- design doc §2.1's "NaN gotcha" note — the app-side reader additionally
    -- calls Number.isFinite() on every value as defense in depth.
    check (amount_usd >= 0 and amount_usd <= 100000),
  updated_at timestamptz not null default now()
);

create table public.company_model_prices (
  model_id                      text primary key,
  input_usd_per_million_tokens  numeric(10,4) not null
    check (input_usd_per_million_tokens >= 0 and input_usd_per_million_tokens <= 10000),
  output_usd_per_million_tokens numeric(10,4) not null
    check (output_usd_per_million_tokens >= 0 and output_usd_per_million_tokens <= 10000),
  -- Flat per-image token estimate for vision calls on this model, when it
  -- accepts images. NULL for a non-vision model. `integer`, not `numeric` —
  -- Postgres integers have no NaN value, so the NaN gotcha above does not
  -- apply here and no upper bound is needed for the same reason.
  vision_tokens_per_image       integer check (vision_tokens_per_image is null or vision_tokens_per_image >= 0),
  source_note                   text not null,   -- e.g. "PROPOSED, unsourced — verify" or "provider-models.ts comment, 2026-09-13"
  updated_at                    timestamptz not null default now()
);

alter table public.company_spend_caps   enable row level security;
alter table public.company_model_prices enable row level security;

-- No anon/authenticated policies — service-role only, same as usage_counters.
-- A browser that could write its own cap or price row could raise its own
-- budget or make the app under-price a call.
revoke all on table public.company_spend_caps   from anon, authenticated;
revoke all on table public.company_model_prices from anon, authenticated;

-- Seed rows are NOT inserted here (R1). Absence of a row is a normal,
-- documented-default state for company_spend_caps (the app falls back to
-- $5.00/day global, $0.50/day per user); company_model_prices has NO
-- code-level default — a model with no price row simply cannot be estimated,
-- and every call that would need it fails closed. See
-- docs/JEV-RELEASE-READINESS.md's SPEND-CAP knob row for how an operator
-- edits these two tables by hand in the Supabase dashboard, and for the
-- activation order (R9): apply this migration -> insert at least the price
-- rows (the caps are optional) -> set PEER_COMPANY_SPEND_CAP=on.

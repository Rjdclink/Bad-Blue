-- CryptoCrawler Overflow storefront foundation.
--
-- The application-facing database is Overflow. These objects fill historical
-- migration gaps before the canonical CryptoCrawler migrations are replayed on
-- that project. Financial authority remains singular: this migration creates
-- storage contracts only and does not copy data, start replication, or grant a
-- browser/client role access to private execution state.

create schema if not exists private;

create table if not exists private.cryptara_storefront_control (
  system_key text primary key,
  schema_version integer not null,
  cutover_state text not null
    check (cutover_state in ('schema_ready','copying','verified','active','degraded')),
  primary_data_copied_at timestamptz,
  activated_at timestamptz,
  last_error text,
  updated_at timestamptz not null default now()
);

insert into private.cryptara_storefront_control (system_key, schema_version, cutover_state)
values ('cryptocrawler', 1, 'schema_ready')
on conflict (system_key) do update
set schema_version = greatest(private.cryptara_storefront_control.schema_version, excluded.schema_version),
    updated_at = now();

-- Migration 018 historically altered this relation without creating its base.
-- Define the complete pre-018 contract so a fresh Overflow project is viable.
create table if not exists private.cryptocrawler_rainbow_profit_events (
  event_id text primary key,
  opportunity_id text,
  realized_profit_usd numeric not null check (realized_profit_usd > 0),
  payout_target_usd numeric,
  retained_target_usd numeric,
  payout_operating_cost_usd numeric not null default 0 check (payout_operating_cost_usd >= 0),
  status text not null default 'queued',
  destination_hash text not null,
  client_id text,
  asset text,
  chain text,
  payout_amount numeric,
  payout_fee numeric,
  withdrawal_id text,
  transaction_hash text,
  batch_id text,
  last_error text,
  confirmed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint cryptocrawler_rainbow_profit_events_status_check check (
    status in ('queued','converting','withdrawing','submitted','confirmed','retryable','manual_review','terminal_swept','failed')
  )
);

create index if not exists idx_cryptocrawler_rainbow_profit_status
  on private.cryptocrawler_rainbow_profit_events (status, created_at);
create index if not exists idx_cryptocrawler_rainbow_profit_batch
  on private.cryptocrawler_rainbow_profit_events (batch_id)
  where batch_id is not null;

-- Learning tables used by the Supabase client stores. They were referenced by
-- runtime code but had no migration-owned schema, which made fresh environments
-- silently lose learning persistence.
create table if not exists public.cryptocrawler_learned_parameters (
  id text primary key,
  name text not null unique,
  value double precision not null,
  previous_value double precision,
  confidence double precision not null default 0,
  sample_size integer not null default 0,
  last_updated timestamptz not null default now(),
  market_condition text,
  source text
);

create table if not exists public.cryptocrawler_strategy_performance (
  id text primary key,
  strategy_name text not null,
  market_condition text not null,
  win_rate double precision not null,
  sharpe_ratio double precision not null,
  profit_factor double precision not null,
  max_drawdown double precision not null,
  expected_profit double precision not null,
  sample_size integer not null,
  timestamp timestamptz not null,
  simulation_config jsonb
);

create index if not exists idx_cryptocrawler_strategy_performance_time
  on public.cryptocrawler_strategy_performance (strategy_name, timestamp desc);

create table if not exists public.cryptocrawler_failed_strategies (
  id text primary key,
  strategy_name text not null,
  parameters jsonb not null default '{}'::jsonb,
  failure_reason text,
  market_condition text not null,
  win_rate double precision,
  loss double precision,
  timestamp timestamptz not null,
  blacklisted boolean not null default false
);

create index if not exists idx_cryptocrawler_failed_strategies_blacklist
  on public.cryptocrawler_failed_strategies (blacklisted, strategy_name);

create table if not exists public.cryptocrawler_evolution_records (
  id text primary key,
  generation integer not null,
  parent_id text,
  fitness double precision not null,
  parameters jsonb not null,
  mutations jsonb not null,
  market_condition text,
  timestamp timestamptz not null,
  survived boolean not null default false
);

create table if not exists public.cryptocrawler_adaptive_thresholds (
  id text primary key,
  name text not null unique,
  ideal_value double precision not null,
  average_value double precision not null,
  poor_value double precision not null,
  auto_adjusted boolean not null default false,
  adjustment_factor double precision not null default 1,
  last_updated timestamptz not null default now()
);

create table if not exists public.cryptocrawler_optimal_params (
  market_condition text primary key,
  success_rate_multiplier double precision not null default 1,
  slippage_tolerance double precision not null default 0.005,
  position_multiplier double precision not null default 1,
  profit_threshold double precision not null default 0.01,
  volatility_damping double precision not null default 0.6,
  confidence_score double precision not null default 0,
  sample_count integer not null default 0,
  updated_at timestamptz not null default now()
);

create table if not exists public.cryptocrawler_realtime_metrics (
  id text primary key,
  total_simulations bigint not null default 0,
  successful_simulations bigint not null default 0,
  total_profit double precision not null default 0,
  average_win_rate double precision not null default 0,
  average_sharpe double precision not null default 0,
  last_update_time timestamptz not null default now()
);

create table if not exists public.cryptocrawler_learning_records (
  id text primary key,
  timestamp timestamptz not null,
  market_condition text not null,
  strategy_name text not null,
  strategy_base_success_rate double precision,
  strategy_profit_per_trade double precision,
  strategy_loss_per_trade double precision,
  strategy_trades_per_day double precision,
  strategy_slippage double precision,
  market_volatility double precision,
  market_liquidity double precision,
  market_competition double precision,
  market_congestion double precision,
  result_win_rate double precision,
  result_sharpe_ratio double precision,
  result_profit_factor double precision,
  result_max_drawdown double precision,
  result_expected_profit double precision,
  result_rating text,
  learned_success_multiplier double precision,
  learned_position_multiplier double precision,
  learned_volatility_damping double precision,
  learned_slippage_tolerance double precision,
  learned_profit_threshold double precision,
  learned_confidence_score double precision,
  learned_sample_count integer
);

create index if not exists idx_cryptocrawler_learning_records_time
  on public.cryptocrawler_learning_records (timestamp desc);

alter table private.cryptara_storefront_control enable row level security;
alter table private.cryptocrawler_rainbow_profit_events enable row level security;
alter table public.cryptocrawler_learned_parameters enable row level security;
alter table public.cryptocrawler_strategy_performance enable row level security;
alter table public.cryptocrawler_failed_strategies enable row level security;
alter table public.cryptocrawler_evolution_records enable row level security;
alter table public.cryptocrawler_adaptive_thresholds enable row level security;
alter table public.cryptocrawler_optimal_params enable row level security;
alter table public.cryptocrawler_realtime_metrics enable row level security;
alter table public.cryptocrawler_learning_records enable row level security;

revoke all on table private.cryptara_storefront_control from public, anon, authenticated;
revoke all on table private.cryptocrawler_rainbow_profit_events from public, anon, authenticated;
revoke all on table public.cryptocrawler_learned_parameters from public, anon, authenticated;
revoke all on table public.cryptocrawler_strategy_performance from public, anon, authenticated;
revoke all on table public.cryptocrawler_failed_strategies from public, anon, authenticated;
revoke all on table public.cryptocrawler_evolution_records from public, anon, authenticated;
revoke all on table public.cryptocrawler_adaptive_thresholds from public, anon, authenticated;
revoke all on table public.cryptocrawler_optimal_params from public, anon, authenticated;
revoke all on table public.cryptocrawler_realtime_metrics from public, anon, authenticated;
revoke all on table public.cryptocrawler_learning_records from public, anon, authenticated;

grant select, insert, update, delete on table private.cryptara_storefront_control to service_role;
grant select, insert, update, delete on table private.cryptocrawler_rainbow_profit_events to service_role;
grant select, insert, update, delete on table public.cryptocrawler_learned_parameters to service_role;
grant select, insert, update, delete on table public.cryptocrawler_strategy_performance to service_role;
grant select, insert, update, delete on table public.cryptocrawler_failed_strategies to service_role;
grant select, insert, update, delete on table public.cryptocrawler_evolution_records to service_role;
grant select, insert, update, delete on table public.cryptocrawler_adaptive_thresholds to service_role;
grant select, insert, update, delete on table public.cryptocrawler_optimal_params to service_role;
grant select, insert, update, delete on table public.cryptocrawler_realtime_metrics to service_role;
grant select, insert, update, delete on table public.cryptocrawler_learning_records to service_role;

comment on table private.cryptara_storefront_control is
  'Overflow storefront cutover state. Schema readiness does not itself authorize runtime traffic or claim that Primary data has been copied.';

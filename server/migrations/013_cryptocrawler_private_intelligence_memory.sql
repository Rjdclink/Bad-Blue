-- CryptoCrawler canonical private intelligence memory (S-60..S-64)
-- Server-only durable learning state. These tables are not execution authority.

create schema if not exists private;
create schema if not exists extensions;
create extension if not exists vector with schema extensions;

create table if not exists private.cryptara_trade_outcomes (
  event_id text primary key,
  opportunity_id text not null,
  observed_at timestamptz not null,
  settled_at timestamptz not null,
  topology text not null,
  symbol text not null,
  chain text not null,
  strategy text not null,
  success boolean not null,
  terminal boolean not null default true,
  settlement_confirmed boolean not null,
  realized_profit_usd double precision,
  realized_fee_usd double precision,
  realized_slippage_bps double precision,
  latency_ms double precision,
  model_version text not null,
  config_version text not null,
  provenance text[] not null default '{}',
  source_event_ids text[] not null default '{}',
  payload jsonb not null,
  created_at timestamptz not null default now(),
  constraint cryptara_trade_outcomes_terminal_truth check (terminal = true)
);
alter table private.cryptara_trade_outcomes add column if not exists terminal boolean not null default true;
alter table private.cryptara_trade_outcomes drop constraint if exists cryptara_trade_outcomes_terminal_truth;
alter table private.cryptara_trade_outcomes add constraint cryptara_trade_outcomes_terminal_truth check (terminal = true);
create index if not exists cryptara_trade_outcomes_segment_time_idx on private.cryptara_trade_outcomes (topology, symbol, chain, strategy, settled_at desc);
create index if not exists cryptara_trade_outcomes_time_brin on private.cryptara_trade_outcomes using brin (settled_at);

create table if not exists private.cryptara_decision_events (
  event_id text primary key,
  opportunity_id text,
  observed_at timestamptz not null,
  decision_kind text not null,
  decision text not null,
  model_version text not null,
  config_version text not null,
  provenance text[] not null default '{}',
  source_event_ids text[] not null default '{}',
  payload jsonb not null,
  created_at timestamptz not null default now()
);
create index if not exists cryptara_decision_events_time_idx on private.cryptara_decision_events (observed_at desc);

create table if not exists private.cryptara_market_regimes (
  event_id text primary key,
  observed_at timestamptz not null,
  regime_key text not null,
  topology text,
  symbol text,
  chain text,
  model_version text not null,
  config_version text not null,
  provenance text[] not null default '{}',
  source_event_ids text[] not null default '{}',
  payload jsonb not null,
  created_at timestamptz not null default now()
);
create index if not exists cryptara_market_regimes_key_time_idx on private.cryptara_market_regimes (regime_key, observed_at desc);

create table if not exists private.cryptara_metric_samples (
  event_id text primary key,
  observed_at timestamptz not null,
  metric_name text not null,
  metric_value double precision not null,
  provider text,
  strategy text,
  pair text,
  chain text,
  timing_bucket text,
  cost_bucket text,
  competition_bucket text,
  model_version text not null,
  config_version text not null,
  provenance text[] not null default '{}',
  source_event_ids text[] not null default '{}',
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists cryptara_metric_samples_dimension_time_idx on private.cryptara_metric_samples (metric_name, provider, strategy, pair, chain, observed_at desc);
create index if not exists cryptara_metric_samples_time_brin on private.cryptara_metric_samples using brin (observed_at);

create table if not exists private.cryptara_state_snapshots (
  snapshot_id text primary key,
  snapshot_kind text not null,
  observed_at timestamptz not null,
  schema_version text not null,
  model_version text not null,
  config_version text not null,
  provenance text[] not null default '{}',
  source_event_ids text[] not null default '{}',
  payload jsonb not null,
  created_at timestamptz not null default now()
);
create index if not exists cryptara_state_snapshots_kind_time_idx on private.cryptara_state_snapshots (snapshot_kind, observed_at desc);

create table if not exists private.cryptara_patterns (
  pattern_id text primary key,
  pattern_kind text not null,
  observed_at timestamptz not null,
  embedding extensions.vector(1536),
  embedding_model text,
  embedding_version text,
  normalization_method text,
  revoked_at timestamptz,
  tombstone_reason text,
  model_version text not null,
  config_version text not null,
  provenance text[] not null default '{}',
  source_event_ids text[] not null default '{}',
  payload jsonb not null,
  created_at timestamptz not null default now()
);
create index if not exists cryptara_patterns_kind_time_idx on private.cryptara_patterns (pattern_kind, observed_at desc);
create index if not exists cryptara_patterns_embedding_hnsw_idx on private.cryptara_patterns using hnsw (embedding vector_cosine_ops) where embedding is not null and revoked_at is null;

create table if not exists private.cryptara_model_registry (
  model_id text primary key,
  model_kind text not null,
  model_version text not null,
  status text not null,
  promoted_at timestamptz,
  retired_at timestamptz,
  provenance text[] not null default '{}',
  source_event_ids text[] not null default '{}',
  payload jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint cryptara_model_registry_status check (status in ('shadow','candidate','promoted','retired','rejected'))
);
create index if not exists cryptara_model_registry_kind_status_idx on private.cryptara_model_registry (model_kind, status, updated_at desc);

create table if not exists private.cryptara_model_metrics (
  event_id text primary key,
  model_id text not null,
  observed_at timestamptz not null,
  metric_name text not null,
  metric_value double precision not null,
  evaluation_scope text not null,
  model_version text not null,
  config_version text not null,
  provenance text[] not null default '{}',
  source_event_ids text[] not null default '{}',
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists cryptara_model_metrics_model_time_idx on private.cryptara_model_metrics (model_id, metric_name, observed_at desc);

create table if not exists private.cryptara_governance_events (
  event_id text primary key,
  observed_at timestamptz not null,
  event_kind text not null,
  stage integer,
  authority text not null,
  model_version text not null,
  config_version text not null,
  provenance text[] not null default '{}',
  source_event_ids text[] not null default '{}',
  payload jsonb not null,
  created_at timestamptz not null default now()
);
create index if not exists cryptara_governance_events_time_idx on private.cryptara_governance_events (observed_at desc);

create table if not exists private.cryptara_anomaly_events (
  event_id text primary key,
  observed_at timestamptz not null,
  anomaly_kind text not null,
  severity text not null,
  opportunity_id text,
  model_version text not null,
  config_version text not null,
  provenance text[] not null default '{}',
  source_event_ids text[] not null default '{}',
  payload jsonb not null,
  created_at timestamptz not null default now(),
  constraint cryptara_anomaly_events_severity check (severity in ('info','low','medium','high','critical'))
);
create index if not exists cryptara_anomaly_events_kind_time_idx on private.cryptara_anomaly_events (anomaly_kind, observed_at desc);

create table if not exists private.cryptara_simulation_results (
  event_id text primary key,
  observed_at timestamptz not null,
  scenario_key text not null,
  topology text not null,
  venue_pair text,
  symbol text,
  size_bucket text,
  data_epoch text not null,
  model_version text not null,
  calibration_version text not null,
  config_version text not null,
  expires_at timestamptz,
  provenance text[] not null default '{}',
  source_event_ids text[] not null default '{}',
  payload jsonb not null,
  created_at timestamptz not null default now()
);
create index if not exists cryptara_simulation_results_lookup_idx on private.cryptara_simulation_results (scenario_key, data_epoch, model_version, calibration_version, observed_at desc);

create table if not exists private.cryptara_scenario_catalog (
  scenario_key text primary key,
  topology text not null,
  venue_pair text,
  symbol text,
  size_bucket text,
  model_version text not null,
  config_version text not null,
  provenance text[] not null default '{}',
  payload jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists private.cryptara_rankings (
  event_id text primary key,
  observed_at timestamptz not null,
  ranking_kind text not null,
  subject_key text not null,
  rank_score double precision not null,
  model_version text not null,
  config_version text not null,
  provenance text[] not null default '{}',
  source_event_ids text[] not null default '{}',
  payload jsonb not null,
  created_at timestamptz not null default now(),
  constraint cryptara_rankings_kind check (ranking_kind in ('strategy','provider','pair','chain'))
);
create index if not exists cryptara_rankings_kind_time_idx on private.cryptara_rankings (ranking_kind, observed_at desc, rank_score desc);

create table if not exists private.cryptara_risk_snapshots (
  snapshot_id text primary key,
  observed_at timestamptz not null,
  topology text,
  opportunity_id text,
  model_version text not null,
  config_version text not null,
  provenance text[] not null default '{}',
  source_event_ids text[] not null default '{}',
  payload jsonb not null,
  created_at timestamptz not null default now()
);
create index if not exists cryptara_risk_snapshots_time_idx on private.cryptara_risk_snapshots (observed_at desc);

create table if not exists private.cryptara_worker_metrics (
  event_id text primary key,
  observed_at timestamptz not null,
  worker_id text not null,
  worker_kind text not null,
  metric_name text not null,
  metric_value double precision not null,
  model_version text not null,
  config_version text not null,
  provenance text[] not null default '{}',
  source_event_ids text[] not null default '{}',
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists cryptara_worker_metrics_worker_time_idx on private.cryptara_worker_metrics (worker_id, metric_name, observed_at desc);

create table if not exists private.quanti_task_runs (
  event_id text primary key,
  task_id text not null,
  observed_at timestamptz not null,
  task_kind text not null,
  status text not null,
  duration_ms double precision,
  worker_id text,
  model_version text not null,
  config_version text not null,
  provenance text[] not null default '{}',
  source_event_ids text[] not null default '{}',
  payload jsonb not null,
  created_at timestamptz not null default now()
);
create index if not exists quanti_task_runs_task_time_idx on private.quanti_task_runs (task_kind, observed_at desc);

create table if not exists private.quanti_worker_samples (
  event_id text primary key,
  observed_at timestamptz not null,
  worker_id text not null,
  worker_kind text not null,
  utilization double precision,
  queue_depth integer,
  latency_ms double precision,
  model_version text not null,
  config_version text not null,
  provenance text[] not null default '{}',
  source_event_ids text[] not null default '{}',
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists quanti_worker_samples_worker_time_idx on private.quanti_worker_samples (worker_id, observed_at desc);

create table if not exists private.quanti_resource_events (
  event_id text primary key,
  observed_at timestamptz not null,
  resource_kind text not null,
  action text not null,
  resource_key text,
  model_version text not null,
  config_version text not null,
  provenance text[] not null default '{}',
  source_event_ids text[] not null default '{}',
  payload jsonb not null,
  created_at timestamptz not null default now()
);
create index if not exists quanti_resource_events_time_idx on private.quanti_resource_events (observed_at desc);

create table if not exists private.quanti_scaling_events (
  event_id text primary key,
  observed_at timestamptz not null,
  action text not null,
  from_capacity double precision,
  to_capacity double precision,
  reason text not null,
  model_version text not null,
  config_version text not null,
  provenance text[] not null default '{}',
  source_event_ids text[] not null default '{}',
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists quanti_scaling_events_time_idx on private.quanti_scaling_events (observed_at desc);

create table if not exists private.quanti_distribution_events (
  event_id text primary key,
  observed_at timestamptz not null,
  task_id text,
  source_worker text,
  target_worker text,
  action text not null,
  model_version text not null,
  config_version text not null,
  provenance text[] not null default '{}',
  source_event_ids text[] not null default '{}',
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists quanti_distribution_events_time_idx on private.quanti_distribution_events (observed_at desc);

-- Supabase API roles must never receive the private intelligence surface. Use
-- guarded dynamic revokes so this migration remains portable to non-Supabase dev DBs.
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on schema private from anon';
    execute 'revoke all on all tables in schema private from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'revoke all on schema private from authenticated';
    execute 'revoke all on all tables in schema private from authenticated';
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'revoke all on schema private from service_role';
    execute 'revoke all on all tables in schema private from service_role';
  end if;
end $$;

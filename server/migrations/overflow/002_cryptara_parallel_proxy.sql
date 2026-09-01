-- Optional secondary-Supabase parallel proxy substrate.
--
-- This schema is intentionally read/analytics/background oriented. It is never an
-- authority for money, execution, governance, settlement, signer, nonce, or live
-- profitability truth. Runtime does not create these objects; provision this file
-- on the secondary project when that project is configured.
--
-- Design for Nano/free-tier I/O:
--   * snapshots are key-upserts for precomputed read models (no repeated joins)
--   * events are append-only with one tiny BRIN time index (no JSON GIN write tax)
--   * batch jobs use one partial queue index and SKIP LOCKED bounded claims
--   * payload size is enforced by runtime before insert

create schema if not exists private;

create table if not exists private.cryptara_parallel_snapshots (
  snapshot_key text primary key,
  workload text not null,
  topic text not null,
  payload jsonb not null,
  payload_bytes integer not null check (payload_bytes >= 0),
  observed_at timestamptz not null,
  expires_at timestamptz,
  updated_at timestamptz not null default now(),
  constraint cryptara_parallel_snapshot_workload check (
    workload in ('cache','analytics','telemetry','observability','background_learning')
  ),
  constraint cryptara_parallel_snapshot_expiry check (
    expires_at is null or expires_at > observed_at
  )
);

-- Snapshot cleanup is infrequent and bounded; index only rows that actually expire.
create index if not exists cryptara_parallel_snapshot_expiry_idx
  on private.cryptara_parallel_snapshots (expires_at)
  where expires_at is not null;

create table if not exists private.cryptara_parallel_events (
  event_key text primary key,
  workload text not null,
  topic text not null,
  payload jsonb not null,
  payload_bytes integer not null check (payload_bytes >= 0),
  observed_at timestamptz not null,
  expires_at timestamptz,
  inserted_at timestamptz not null default now(),
  constraint cryptara_parallel_event_workload check (
    workload in ('analytics','telemetry','observability','background_learning')
  ),
  constraint cryptara_parallel_event_expiry check (
    expires_at is null or expires_at > observed_at
  )
);

-- Append-only/time-correlated history benefits from a tiny BRIN index instead of
-- a large write-amplifying B-tree/GIN over every event or JSON key.
create index if not exists cryptara_parallel_events_observed_brin
  on private.cryptara_parallel_events using brin (observed_at)
  with (pages_per_range = 32);

create index if not exists cryptara_parallel_events_expiry_idx
  on private.cryptara_parallel_events (expires_at)
  where expires_at is not null;

create table if not exists private.cryptara_parallel_jobs (
  job_id text primary key,
  workload text not null,
  job_type text not null,
  status text not null default 'pending',
  priority smallint not null default 0,
  available_at timestamptz not null default now(),
  lease_owner text,
  lease_until timestamptz,
  request_payload jsonb not null,
  result_payload jsonb,
  attempt_count integer not null default 0 check (attempt_count >= 0),
  max_attempts integer not null default 3 check (max_attempts between 1 and 20),
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint cryptara_parallel_job_workload check (
    workload in ('analytics','background_learning')
  ),
  constraint cryptara_parallel_job_status check (
    status in ('pending','running','retryable','completed','failed')
  )
);

-- Only active work is indexed. Completed history creates no queue-index churn.
create index if not exists cryptara_parallel_jobs_ready_idx
  on private.cryptara_parallel_jobs (priority desc, available_at, created_at)
  where status in ('pending','retryable');

create or replace function private.cryptara_claim_parallel_jobs(
  p_owner text,
  p_limit integer default 4,
  p_lease_seconds integer default 90
)
returns setof private.cryptara_parallel_jobs
language plpgsql
security definer
set search_path = private, pg_temp
as $$
begin
  if p_owner is null or length(trim(p_owner)) = 0 then
    raise exception 'parallel proxy worker owner is required';
  end if;

  return query
  with candidates as (
    select job_id
      from private.cryptara_parallel_jobs
     where (
       status in ('pending','retryable')
       or (status = 'running' and lease_until is not null and lease_until <= now())
     )
       and available_at <= now()
       and attempt_count < max_attempts
     order by priority desc, available_at asc, created_at asc
     for update skip locked
     limit greatest(1, least(32, p_limit))
  )
  update private.cryptara_parallel_jobs jobs
     set status = 'running',
         lease_owner = p_owner,
         lease_until = now() + make_interval(secs => greatest(30, least(600, p_lease_seconds))),
         attempt_count = jobs.attempt_count + 1,
         updated_at = now()
    from candidates
   where jobs.job_id = candidates.job_id
  returning jobs.*;
end;
$$;

alter table private.cryptara_parallel_snapshots enable row level security;
alter table private.cryptara_parallel_events enable row level security;
alter table private.cryptara_parallel_jobs enable row level security;

revoke all on function private.cryptara_claim_parallel_jobs(text, integer, integer) from public;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on schema private from anon';
    execute 'revoke all on private.cryptara_parallel_snapshots from anon';
    execute 'revoke all on private.cryptara_parallel_events from anon';
    execute 'revoke all on private.cryptara_parallel_jobs from anon';
    execute 'revoke all on function private.cryptara_claim_parallel_jobs(text, integer, integer) from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'revoke all on schema private from authenticated';
    execute 'revoke all on private.cryptara_parallel_snapshots from authenticated';
    execute 'revoke all on private.cryptara_parallel_events from authenticated';
    execute 'revoke all on private.cryptara_parallel_jobs from authenticated';
    execute 'revoke all on function private.cryptara_claim_parallel_jobs(text, integer, integer) from authenticated';
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant usage on schema private to service_role';
    execute 'grant select, insert, update, delete on private.cryptara_parallel_snapshots to service_role';
    execute 'grant select, insert, update, delete on private.cryptara_parallel_events to service_role';
    execute 'grant select, insert, update, delete on private.cryptara_parallel_jobs to service_role';
    execute 'grant execute on function private.cryptara_claim_parallel_jobs(text, integer, integer) to service_role';
  end if;
end $$;

comment on table private.cryptara_parallel_snapshots is
  'Non-authoritative secondary read-model snapshots for cache/analytics/telemetry/observability/background learning.';
comment on table private.cryptara_parallel_events is
  'Non-authoritative append-only derived history for analytics/telemetry/observability/background learning.';
comment on table private.cryptara_parallel_jobs is
  'Non-authoritative auxiliary batch queue. Never execution, settlement, governance, or money authority.';

-- CryptoCrawler durable background outbox (S-93)
-- Restart-safe non-hot persistence only. This table is never execution,
-- settlement, governance, or market-data authority.

create schema if not exists private;

create table if not exists private.cryptara_outbox (
  outbox_id text primary key,
  source_event_id text not null,
  job_kind text not null,
  schema_version text not null,
  dedupe_key text not null unique,
  status text not null default 'pending',
  attempt_count integer not null default 0,
  visible_at timestamptz not null default now(),
  locked_at timestamptz,
  last_error text,
  payload jsonb not null,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  constraint cryptara_outbox_status check (status in ('pending','processing','retry','completed','failed')),
  constraint cryptara_outbox_attempt_count check (attempt_count >= 0)
);

create index if not exists cryptara_outbox_ready_idx
  on private.cryptara_outbox (status, visible_at, created_at)
  where status in ('pending','retry','processing');

create index if not exists cryptara_outbox_source_idx
  on private.cryptara_outbox (source_event_id, created_at desc);

-- Supabase API roles must never receive the private outbox surface. Guard role
-- checks so local/non-Supabase PostgreSQL migrations remain portable.
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on private.cryptara_outbox from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'revoke all on private.cryptara_outbox from authenticated';
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'revoke all on private.cryptara_outbox from service_role';
  end if;
end $$;

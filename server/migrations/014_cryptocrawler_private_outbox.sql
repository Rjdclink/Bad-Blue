-- CryptoCrawler durable background outbox (S-93)
-- Private, server-only restart-safe queue for non-hot-path learning/persistence work.
-- This table is never an execution, governance, settlement, or market-data authority.

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

-- Reconcile pre-existing installations idempotently.
alter table private.cryptara_outbox add column if not exists source_event_id text;
alter table private.cryptara_outbox add column if not exists job_kind text;
alter table private.cryptara_outbox add column if not exists schema_version text;
alter table private.cryptara_outbox add column if not exists dedupe_key text;
alter table private.cryptara_outbox add column if not exists status text not null default 'pending';
alter table private.cryptara_outbox add column if not exists attempt_count integer not null default 0;
alter table private.cryptara_outbox add column if not exists visible_at timestamptz not null default now();
alter table private.cryptara_outbox add column if not exists locked_at timestamptz;
alter table private.cryptara_outbox add column if not exists last_error text;
alter table private.cryptara_outbox add column if not exists payload jsonb;
alter table private.cryptara_outbox add column if not exists created_at timestamptz not null default now();
alter table private.cryptara_outbox add column if not exists completed_at timestamptz;

alter table private.cryptara_outbox drop constraint if exists cryptara_outbox_status;
alter table private.cryptara_outbox add constraint cryptara_outbox_status
  check (status in ('pending','processing','retry','completed','failed'));
alter table private.cryptara_outbox drop constraint if exists cryptara_outbox_attempt_count;
alter table private.cryptara_outbox add constraint cryptara_outbox_attempt_count check (attempt_count >= 0);

create unique index if not exists cryptara_outbox_dedupe_key_key
  on private.cryptara_outbox (dedupe_key);
create index if not exists cryptara_outbox_ready_idx
  on private.cryptara_outbox (status, visible_at, created_at)
  where status in ('pending','retry','processing');
create index if not exists cryptara_outbox_source_idx
  on private.cryptara_outbox (source_event_id, created_at desc);

-- Supabase API roles must not receive the private background queue. Guard role
-- checks so the migration remains portable to non-Supabase development Postgres.
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on schema private from anon';
    execute 'revoke all on private.cryptara_outbox from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'revoke all on schema private from authenticated';
    execute 'revoke all on private.cryptara_outbox from authenticated';
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'revoke all on schema private from service_role';
    execute 'revoke all on private.cryptara_outbox from service_role';
  end if;
end $$;

-- Optional secondary-Supabase cache for Cryptara's pressure/comp path.
-- This database is never an execution, governance, treasury, settlement, nonce,
-- signer, or profitability authority. Entries are bounded reusable information
-- only; execution_truth is forbidden by both runtime policy and this constraint.

create schema if not exists private;

create table if not exists private.cryptara_comp_cache (
  cache_key text primary key,
  information_class text not null,
  payload jsonb not null,
  payload_bytes integer not null check (payload_bytes >= 0),
  created_at timestamptz not null,
  expires_at timestamptz not null,
  updated_at timestamptz not null default now(),
  constraint cryptara_comp_cache_class check (
    information_class in ('connector_readiness','schema_authority','market_snapshot','resource_snapshot','background')
  ),
  constraint cryptara_comp_cache_positive_window check (expires_at > created_at)
);

create index if not exists cryptara_comp_cache_expiry_idx
  on private.cryptara_comp_cache (expires_at);

alter table private.cryptara_comp_cache enable row level security;

-- Direct server Postgres connections own this surface. API-facing roles must not.
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on schema private from anon';
    execute 'revoke all on private.cryptara_comp_cache from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'revoke all on schema private from authenticated';
    execute 'revoke all on private.cryptara_comp_cache from authenticated';
  end if;
end $$;

comment on table private.cryptara_comp_cache is
  'Optional secondary-Supabase cache used only by Cryptara comp-mode reusable information. Never execution truth or financial authority.';

CREATE SCHEMA IF NOT EXISTS private;

CREATE TABLE IF NOT EXISTS public.cryptocrawler_terminal_sweep_control (
  system_key text PRIMARY KEY,
  desired_state text NOT NULL DEFAULT 'RUNNING'
    CHECK (desired_state IN ('RUNNING','TERMINATE_AND_SWEEP','SWEEPING','SWEPT','MANUAL_REVIEW')),
  terminal_epoch uuid,
  intent_source text,
  destination_address text,
  retained_profit_usd numeric NOT NULL DEFAULT 0 CHECK (retained_profit_usd >= 0),
  swept_value_usd numeric NOT NULL DEFAULT 0 CHECK (swept_value_usd >= 0),
  last_observed_deployment_id text,
  last_observed_deployment_status text,
  active_successor_deployment_id text,
  last_seen_active_at timestamptz,
  terminal_detection_not_before timestamptz,
  sweep_requested_at timestamptz,
  sweep_started_at timestamptz,
  sweep_completed_at timestamptz,
  worker_lease_owner text,
  worker_lease_until timestamptz,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.cryptocrawler_terminal_sweep_legs (
  leg_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  terminal_epoch uuid NOT NULL,
  venue text NOT NULL,
  asset text NOT NULL,
  chain text,
  status text NOT NULL DEFAULT 'PREPARED'
    CHECK (status IN ('PREPARED','SUBMITTED','CONFIRMED','RETRYABLE','MANUAL_REVIEW')),
  client_id text NOT NULL,
  amount numeric,
  fee numeric,
  withdrawal_id text,
  transaction_hash text,
  destination_hash text NOT NULL,
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  last_error text,
  submitted_at timestamptz,
  confirmed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (terminal_epoch, venue, asset),
  UNIQUE (venue, client_id)
);

CREATE INDEX IF NOT EXISTS idx_terminal_sweep_legs_epoch_status
  ON public.cryptocrawler_terminal_sweep_legs(terminal_epoch, status);

ALTER TABLE public.cryptocrawler_terminal_sweep_control ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cryptocrawler_terminal_sweep_legs ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.cryptocrawler_terminal_sweep_control FROM anon, authenticated;
REVOKE ALL ON TABLE public.cryptocrawler_terminal_sweep_legs FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.cryptocrawler_terminal_sweep_control TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.cryptocrawler_terminal_sweep_legs TO service_role;

INSERT INTO public.cryptocrawler_terminal_sweep_control(system_key, desired_state)
VALUES ('cryptocrawler', 'RUNNING')
ON CONFLICT (system_key) DO NOTHING;

COMMENT ON TABLE public.cryptocrawler_terminal_sweep_control IS
  'Durable CryptoCrawler treasury lifecycle authority. RUNNING retains capital; only independently verified terminal intent may transition to sweep states.';
COMMENT ON TABLE public.cryptocrawler_terminal_sweep_legs IS
  'Idempotent terminal withdrawal legs. One venue/asset leg per terminal epoch with durable submission and settlement evidence.';

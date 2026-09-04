-- Restart-safe Across cross-chain execution lifecycle.
-- New submissions are persisted immediately after the origin deposit receipt succeeds.
-- Reservations remain authoritative until exact terminal fill/refund evidence is reconciled.

CREATE TABLE IF NOT EXISTS public.cryptocrawler_cross_chain_lifecycles (
  lifecycle_id uuid PRIMARY KEY,
  opportunity_id text NOT NULL,
  reservation_id uuid NOT NULL,
  provider text NOT NULL CHECK (provider = 'across'),
  deposit_txn_ref text NOT NULL UNIQUE,
  origin_chain text NOT NULL,
  destination_chain text NOT NULL,
  asset text NOT NULL,
  input_token_address text NOT NULL,
  output_token_address text NOT NULL,
  input_decimals smallint NOT NULL CHECK (input_decimals BETWEEN 0 AND 36),
  output_decimals smallint NOT NULL CHECK (output_decimals BETWEEN 0 AND 36),
  input_amount_base_units numeric(78,0) NOT NULL CHECK (input_amount_base_units > 0),
  quote jsonb NOT NULL,
  origin_native_fee_wei numeric(78,0) NOT NULL DEFAULT 0 CHECK (origin_native_fee_wei >= 0),
  status text NOT NULL CHECK (status IN (
    'SUBMITTED',
    'SETTLEMENT_UNKNOWN',
    'ACCOUNTING_PENDING',
    'RECOVERY_REQUIRED',
    'FILLED',
    'REFUNDED',
    'FAILED'
  )),
  settlement_evidence jsonb,
  terminal_amount_evidence jsonb,
  realized_net_profit_usd double precision,
  gas_usd double precision,
  asset_usd double precision,
  last_error text,
  reconcile_lease_owner text,
  reconcile_lease_expires_at timestamptz,
  submitted_at timestamptz NOT NULL DEFAULT now(),
  last_checked_at timestamptz,
  terminal_at timestamptz,
  feedback_applied_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (opportunity_id, reservation_id)
);

CREATE INDEX IF NOT EXISTS cryptocrawler_cross_chain_lifecycle_open_idx
  ON public.cryptocrawler_cross_chain_lifecycles(status, updated_at)
  WHERE status IN ('SUBMITTED','SETTLEMENT_UNKNOWN','ACCOUNTING_PENDING','RECOVERY_REQUIRED');

CREATE INDEX IF NOT EXISTS cryptocrawler_cross_chain_lifecycle_lease_idx
  ON public.cryptocrawler_cross_chain_lifecycles(reconcile_lease_expires_at)
  WHERE status IN ('SUBMITTED','SETTLEMENT_UNKNOWN','ACCOUNTING_PENDING','RECOVERY_REQUIRED');

CREATE INDEX IF NOT EXISTS cryptocrawler_cross_chain_lifecycle_feedback_idx
  ON public.cryptocrawler_cross_chain_lifecycles(feedback_applied_at, terminal_at)
  WHERE status IN ('FILLED','REFUNDED') AND feedback_applied_at IS NULL;

ALTER TABLE public.cryptocrawler_cross_chain_lifecycles ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.cryptocrawler_cross_chain_lifecycles FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.cryptocrawler_cross_chain_lifecycles TO service_role;

COMMENT ON TABLE public.cryptocrawler_cross_chain_lifecycles IS
  'Durable Across deposit lifecycle. A successful origin deposit is persisted before returning to the scheduler; unresolved/recovery states keep system-owned capital reserved until exact terminal reconciliation. Reconciliation leases prevent duplicate multi-worker processing and terminal feedback is retried until explicitly applied.';

-- Restart-safe Across cross-chain execution lifecycle.
-- The exact signed origin transaction is persisted before broadcast so a crash
-- can always reattach/rebroadcast the same nonce/hash without duplicate principal.
-- Reservations remain authoritative until exact terminal fill/refund/failure evidence is reconciled.

CREATE TABLE IF NOT EXISTS public.cryptocrawler_cross_chain_lifecycles (
  lifecycle_id uuid PRIMARY KEY,
  opportunity_id text NOT NULL,
  reservation_id uuid NOT NULL,
  provider text NOT NULL CHECK (provider = 'across'),
  deposit_txn_ref text NOT NULL UNIQUE,
  signed_origin_tx text,
  origin_fee_complete boolean NOT NULL DEFAULT false,
  broadcast_at timestamptz,
  origin_chain text NOT NULL,
  destination_chain text NOT NULL,
  asset text NOT NULL,
  input_token_address text NOT NULL,
  output_token_address text NOT NULL,
  input_decimals smallint NOT NULL CHECK (input_decimals BETWEEN 0 AND 36),
  output_decimals smallint NOT NULL CHECK (output_decimals BETWEEN 0 AND 36),
  input_amount_base_units numeric(78,0) NOT NULL CHECK (input_amount_base_units > 0),
  expected_profit_usd double precision NOT NULL,
  notional_usd double precision NOT NULL CHECK (notional_usd > 0),
  quote jsonb NOT NULL,
  -- PREPARED stores approval gas already known before the exact origin tx is broadcast.
  -- Once the origin receipt is observed this becomes approval + origin-deposit gas.
  origin_native_fee_wei numeric(78,0) NOT NULL DEFAULT 0 CHECK (origin_native_fee_wei >= 0),
  status text NOT NULL CHECK (status IN (
    'PREPARED',
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

-- Upgrade an already-existing pre-PREPARED lifecycle table safely. The boolean
-- existence probe makes the legacy backfill run only on the schema transition,
-- never against a live new-format PREPARED/SUBMITTED handoff on later reruns.
DO $$
DECLARE
  had_origin_fee_complete boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'cryptocrawler_cross_chain_lifecycles'
      AND column_name = 'origin_fee_complete'
  ) INTO had_origin_fee_complete;

  ALTER TABLE public.cryptocrawler_cross_chain_lifecycles
    ADD COLUMN IF NOT EXISTS signed_origin_tx text;
  ALTER TABLE public.cryptocrawler_cross_chain_lifecycles
    ADD COLUMN IF NOT EXISTS origin_fee_complete boolean NOT NULL DEFAULT false;
  ALTER TABLE public.cryptocrawler_cross_chain_lifecycles
    ADD COLUMN IF NOT EXISTS broadcast_at timestamptz;

  IF NOT had_origin_fee_complete THEN
    -- Every legacy row was created only after a successful origin receipt under
    -- the old executor. Mark it as already-broadcast so new PREPARED recovery can
    -- never reinterpret historical SUBMITTED/settlement rows as never broadcast.
    UPDATE public.cryptocrawler_cross_chain_lifecycles
    SET origin_fee_complete = true,
        broadcast_at = COALESCE(broadcast_at, submitted_at)
    WHERE signed_origin_tx IS NULL
      AND status IN ('SUBMITTED','SETTLEMENT_UNKNOWN','ACCOUNTING_PENDING','RECOVERY_REQUIRED','FILLED','REFUNDED','FAILED');
  END IF;
END
$$;

-- The original inline status check cannot admit PREPARED on an upgraded table.
-- Replace the deterministic auto-named column CHECK idempotently.
ALTER TABLE public.cryptocrawler_cross_chain_lifecycles
  DROP CONSTRAINT IF EXISTS cryptocrawler_cross_chain_lifecycles_status_check;
ALTER TABLE public.cryptocrawler_cross_chain_lifecycles
  ADD CONSTRAINT cryptocrawler_cross_chain_lifecycles_status_check
  CHECK (status IN (
    'PREPARED',
    'SUBMITTED',
    'SETTLEMENT_UNKNOWN',
    'ACCOUNTING_PENDING',
    'RECOVERY_REQUIRED',
    'FILLED',
    'REFUNDED',
    'FAILED'
  ));

-- A durable unresolved lifecycle is stronger capital authority than a wall-clock
-- reservation TTL. Pin that exact reservation at the database layer so even a
-- long process outage cannot make in-flight/ambiguous principal reusable. Existing
-- terminal settlement code deletes the reservation after fill/refund; the
-- prebroadcast recovery helper deletes it after a proven never-broadcast/revert.
CREATE OR REPLACE FUNCTION public.cryptocrawler_pin_cross_chain_reservation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.status IN ('PREPARED','SUBMITTED','SETTLEMENT_UNKNOWN','ACCOUNTING_PENDING','RECOVERY_REQUIRED') THEN
    UPDATE public.cryptocrawler_onchain_inventory_reservations
    SET expires_at = 'infinity'::timestamptz
    WHERE reservation_id = NEW.reservation_id;
  END IF;
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS cryptocrawler_cross_chain_pin_reservation
  ON public.cryptocrawler_cross_chain_lifecycles;
CREATE TRIGGER cryptocrawler_cross_chain_pin_reservation
AFTER INSERT OR UPDATE OF status, reservation_id
ON public.cryptocrawler_cross_chain_lifecycles
FOR EACH ROW
EXECUTE FUNCTION public.cryptocrawler_pin_cross_chain_reservation();

-- Backfill any unresolved lifecycle that existed before this trigger was added.
UPDATE public.cryptocrawler_onchain_inventory_reservations reservation
SET expires_at = 'infinity'::timestamptz
FROM public.cryptocrawler_cross_chain_lifecycles lifecycle
WHERE reservation.reservation_id = lifecycle.reservation_id
  AND lifecycle.status IN ('PREPARED','SUBMITTED','SETTLEMENT_UNKNOWN','ACCOUNTING_PENDING','RECOVERY_REQUIRED');

-- Recreate partial indexes so an upgraded installation receives PREPARED/FAILED
-- predicates rather than silently retaining the older index definitions.
DROP INDEX IF EXISTS public.cryptocrawler_cross_chain_lifecycle_open_idx;
CREATE INDEX cryptocrawler_cross_chain_lifecycle_open_idx
  ON public.cryptocrawler_cross_chain_lifecycles(status, updated_at)
  WHERE status IN ('PREPARED','SUBMITTED','SETTLEMENT_UNKNOWN','ACCOUNTING_PENDING','RECOVERY_REQUIRED');

DROP INDEX IF EXISTS public.cryptocrawler_cross_chain_lifecycle_lease_idx;
CREATE INDEX cryptocrawler_cross_chain_lifecycle_lease_idx
  ON public.cryptocrawler_cross_chain_lifecycles(reconcile_lease_expires_at)
  WHERE status IN ('PREPARED','SUBMITTED','SETTLEMENT_UNKNOWN','ACCOUNTING_PENDING','RECOVERY_REQUIRED');

DROP INDEX IF EXISTS public.cryptocrawler_cross_chain_lifecycle_feedback_idx;
CREATE INDEX cryptocrawler_cross_chain_lifecycle_feedback_idx
  ON public.cryptocrawler_cross_chain_lifecycles(feedback_applied_at, terminal_at)
  WHERE status IN ('FILLED','REFUNDED','FAILED') AND feedback_applied_at IS NULL;

ALTER TABLE public.cryptocrawler_cross_chain_lifecycles ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.cryptocrawler_cross_chain_lifecycles FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.cryptocrawler_cross_chain_lifecycles TO service_role;

COMMENT ON TABLE public.cryptocrawler_cross_chain_lifecycles IS
  'Durable Across lifecycle. Exact signed origin transaction identity is persisted before broadcast; unresolved states pin their exact system-owned capital reservation until terminal fill, exact refund, or proven origin failure is reconciled. Expected economics are snapshotted so terminal Cryptara/Nix feedback survives restarts.';

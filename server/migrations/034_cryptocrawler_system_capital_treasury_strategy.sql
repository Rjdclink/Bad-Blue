-- Provenance-backed retained-capital routing and normal-runtime system-capital
-- sweeps. Raw authenticated account balances remain reconciliation ceilings only;
-- every movable unit must first be reserved from ACTIVE system-owned lots.

ALTER TABLE public.cryptocrawler_cex_system_owned_lots
  DROP CONSTRAINT IF EXISTS cryptocrawler_cex_system_owned_lots_origin_kind_check;
ALTER TABLE public.cryptocrawler_cex_system_owned_lots
  ADD CONSTRAINT cryptocrawler_cex_system_owned_lots_origin_kind_check CHECK (origin_kind IN (
    'SYSTEM_DEPOSIT',
    'TRADE_FILL',
    'MAKER_REBATE',
    'FUNDING_PAYMENT',
    'FEE_REFUND',
    'OTHER_VERIFIED_SYSTEM_PROFIT',
    'CEX_TRANSFER'
  ));

ALTER TABLE public.cryptocrawler_retained_exchange_allocations
  ADD COLUMN IF NOT EXISTS source_asset text,
  ADD COLUMN IF NOT EXISTS source_unit_price_usd numeric,
  ADD COLUMN IF NOT EXISTS source_price_observed_at timestamptz,
  ADD COLUMN IF NOT EXISTS source_amount_decimal numeric,
  ADD COLUMN IF NOT EXISTS transfer_id uuid,
  ADD COLUMN IF NOT EXISTS transfer_reference text,
  ADD COLUMN IF NOT EXISTS transaction_hash text,
  ADD COLUMN IF NOT EXISTS settlement_evidence jsonb,
  ADD COLUMN IF NOT EXISTS attempt_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_attempt_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_error text;

ALTER TABLE public.cryptocrawler_retained_exchange_allocations
  DROP CONSTRAINT IF EXISTS cryptocrawler_retained_exchange_allocations_status_check;
ALTER TABLE public.cryptocrawler_retained_exchange_allocations
  ADD CONSTRAINT cryptocrawler_retained_exchange_allocations_status_check CHECK (
    status IN ('TARGET_SELECTED','IN_PLACE','TRANSFER_REQUIRED','PREPARED','SUBMITTED','SETTLING','PLACED','RETRYABLE','BLOCKED','MANUAL_REVIEW')
  );
ALTER TABLE public.cryptocrawler_retained_exchange_allocations
  DROP CONSTRAINT IF EXISTS cryptocrawler_retained_exchange_allocations_attempt_count_check;
ALTER TABLE public.cryptocrawler_retained_exchange_allocations
  ADD CONSTRAINT cryptocrawler_retained_exchange_allocations_attempt_count_check CHECK (attempt_count >= 0);

CREATE TABLE IF NOT EXISTS public.cryptocrawler_system_capital_transfers (
  transfer_id uuid PRIMARY KEY,
  transfer_kind text NOT NULL CHECK (transfer_kind IN ('RETAINED_ROUTE','PAYOUT_FUNDING','CAPITAL_SWEEP')),
  source_venue text NOT NULL CHECK (source_venue IN ('kraken','okx')),
  target_kind text NOT NULL CHECK (target_kind IN ('cex','wallet')),
  target_venue text CHECK (target_venue IS NULL OR target_venue IN ('kraken','okx')),
  asset text NOT NULL,
  requested_source_decimal numeric(78,36) NOT NULL CHECK (requested_source_decimal > 0),
  requested_destination_decimal numeric(78,36) NOT NULL CHECK (requested_destination_decimal > 0),
  delivered_destination_decimal numeric(78,36),
  source_fee_decimal numeric(78,36),
  status text NOT NULL DEFAULT 'PREPARED' CHECK (status IN ('PREPARED','SUBMITTED','SETTLING','CONFIRMED','RETRYABLE','MANUAL_REVIEW','RELEASED')),
  source_event_id text,
  payout_event_id text,
  sweep_batch_id uuid,
  source_reference text,
  destination_reference text,
  transaction_hash text,
  source_evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  destination_evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  submitted_at timestamptz,
  confirmed_at timestamptz,
  last_attempt_at timestamptz,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((target_kind='cex' AND target_venue IS NOT NULL AND target_venue<>source_venue) OR (target_kind='wallet' AND target_venue IS NULL))
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_cryptocrawler_retained_route_transfer
  ON public.cryptocrawler_system_capital_transfers(source_event_id)
  WHERE transfer_kind='RETAINED_ROUTE' AND source_event_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_cryptocrawler_payout_funding_transfer
  ON public.cryptocrawler_system_capital_transfers(payout_event_id)
  WHERE transfer_kind='PAYOUT_FUNDING' AND payout_event_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_cryptocrawler_system_capital_transfer_status
  ON public.cryptocrawler_system_capital_transfers(status, created_at);

CREATE TABLE IF NOT EXISTS public.cryptocrawler_system_capital_transfer_lots (
  transfer_id uuid NOT NULL REFERENCES public.cryptocrawler_system_capital_transfers(transfer_id) ON DELETE CASCADE,
  lot_id uuid NOT NULL REFERENCES public.cryptocrawler_cex_system_owned_lots(lot_id) ON DELETE RESTRICT,
  reserved_decimal numeric(78,36) NOT NULL CHECK (reserved_decimal > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (transfer_id, lot_id)
);

CREATE INDEX IF NOT EXISTS idx_cryptocrawler_system_capital_transfer_lot
  ON public.cryptocrawler_system_capital_transfer_lots(lot_id);

CREATE TABLE IF NOT EXISTS public.cryptocrawler_system_capital_sweep_batches (
  batch_id uuid PRIMARY KEY,
  venue text NOT NULL CHECK (venue IN ('kraken','okx')),
  threshold_usd numeric NOT NULL DEFAULT 4000 CHECK (threshold_usd = 4000),
  sweep_fraction numeric NOT NULL DEFAULT 0.80 CHECK (sweep_fraction = 0.80),
  measured_system_owned_value_usd numeric NOT NULL CHECK (measured_system_owned_value_usd > 4000),
  target_sweep_value_usd numeric NOT NULL CHECK (target_sweep_value_usd > 0),
  reserved_sweep_value_usd numeric NOT NULL DEFAULT 0 CHECK (reserved_sweep_value_usd >= 0),
  status text NOT NULL DEFAULT 'PREPARED' CHECK (status IN ('PREPARED','TRANSFERRING','WITHDRAWING','SUBMITTED','CONFIRMED','RETRYABLE','MANUAL_REVIEW')),
  destination_hash text NOT NULL,
  transaction_hash text,
  recipient_confirmation_source text,
  recipient_confirmed_at timestamptz,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (abs(target_sweep_value_usd - measured_system_owned_value_usd * 0.80) <= 0.0001)
);

CREATE INDEX IF NOT EXISTS idx_cryptocrawler_system_capital_sweep_status
  ON public.cryptocrawler_system_capital_sweep_batches(venue, status, created_at);

CREATE OR REPLACE FUNCTION public.cryptocrawler_reserve_system_capital_transfer(
  p_transfer_id uuid,
  p_source_venue text,
  p_asset text,
  p_amount numeric
)
RETURNS numeric
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  normalized_venue text := lower(trim(p_source_venue));
  normalized_asset text := upper(trim(p_asset));
  needed numeric := p_amount;
  available_for_lot numeric;
  already_reserved numeric;
  take_amount numeric;
  row_lot record;
BEGIN
  IF p_transfer_id IS NULL OR normalized_venue NOT IN ('kraken','okx') OR normalized_asset='' OR p_amount IS NULL OR p_amount <= 0 THEN
    RETURN 0;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.cryptocrawler_system_capital_transfers
    WHERE transfer_id=p_transfer_id
      AND source_venue=normalized_venue
      AND asset=normalized_asset
      AND status IN ('PREPARED','RETRYABLE')
  ) THEN
    RETURN 0;
  END IF;

  DELETE FROM public.cryptocrawler_system_capital_transfer_lots
  WHERE transfer_id=p_transfer_id;

  FOR row_lot IN
    SELECT lot_id, remaining_decimal
    FROM public.cryptocrawler_cex_system_owned_lots
    WHERE venue=normalized_venue
      AND asset=normalized_asset
      AND status='ACTIVE'
      AND remaining_decimal > 0
    ORDER BY created_at ASC, lot_id ASC
    FOR UPDATE
  LOOP
    SELECT COALESCE(SUM(tl.reserved_decimal),0)
      INTO already_reserved
    FROM public.cryptocrawler_system_capital_transfer_lots tl
    JOIN public.cryptocrawler_system_capital_transfers t ON t.transfer_id=tl.transfer_id
    WHERE tl.lot_id=row_lot.lot_id
      AND tl.transfer_id<>p_transfer_id
      AND t.status IN ('PREPARED','SUBMITTED','SETTLING','RETRYABLE','MANUAL_REVIEW');

    available_for_lot := greatest(0, row_lot.remaining_decimal - already_reserved);
    IF available_for_lot <= 0 THEN CONTINUE; END IF;
    take_amount := least(available_for_lot, needed);
    IF take_amount <= 0 THEN CONTINUE; END IF;

    INSERT INTO public.cryptocrawler_system_capital_transfer_lots
      (transfer_id, lot_id, reserved_decimal, created_at)
    VALUES (p_transfer_id, row_lot.lot_id, take_amount, now());

    needed := needed - take_amount;
    EXIT WHEN needed <= 0.000000000000000001;
  END LOOP;

  IF needed > 0.000000000000000001 THEN
    DELETE FROM public.cryptocrawler_system_capital_transfer_lots WHERE transfer_id=p_transfer_id;
    RETURN 0;
  END IF;

  UPDATE public.cryptocrawler_system_capital_transfers
  SET status='PREPARED', updated_at=now(), last_error=NULL
  WHERE transfer_id=p_transfer_id;
  RETURN p_amount;
END;
$$;

CREATE OR REPLACE FUNCTION public.cryptocrawler_release_system_capital_transfer(p_transfer_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  changed integer := 0;
BEGIN
  UPDATE public.cryptocrawler_system_capital_transfers
  SET status='RELEASED', updated_at=now()
  WHERE transfer_id=p_transfer_id AND status IN ('PREPARED','RETRYABLE');
  GET DIAGNOSTICS changed = ROW_COUNT;
  IF changed=1 THEN
    DELETE FROM public.cryptocrawler_system_capital_transfer_lots WHERE transfer_id=p_transfer_id;
  END IF;
  RETURN changed=1;
END;
$$;

CREATE OR REPLACE FUNCTION public.cryptocrawler_confirm_system_capital_transfer(
  p_transfer_id uuid,
  p_delivered_decimal numeric,
  p_source_fee_decimal numeric,
  p_settlement_reference text,
  p_transaction_hash text,
  p_evidence jsonb
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  transfer_row record;
  reserved_total numeric := 0;
  row_lot record;
  new_remaining numeric;
BEGIN
  SELECT * INTO transfer_row
  FROM public.cryptocrawler_system_capital_transfers
  WHERE transfer_id=p_transfer_id
  FOR UPDATE;

  IF transfer_row IS NULL THEN RETURN false; END IF;
  IF transfer_row.status='CONFIRMED' THEN RETURN true; END IF;
  IF transfer_row.status NOT IN ('SUBMITTED','SETTLING') THEN RETURN false; END IF;
  IF p_delivered_decimal IS NULL OR p_delivered_decimal <= 0 OR p_source_fee_decimal IS NULL OR p_source_fee_decimal < 0 THEN RETURN false; END IF;
  IF p_delivered_decimal > transfer_row.requested_source_decimal + 0.000000000000000001 THEN RETURN false; END IF;

  SELECT COALESCE(SUM(reserved_decimal),0) INTO reserved_total
  FROM public.cryptocrawler_system_capital_transfer_lots
  WHERE transfer_id=p_transfer_id;
  IF abs(reserved_total - transfer_row.requested_source_decimal) > 0.000000000000000001 THEN
    RAISE EXCEPTION 'system-capital transfer reservation no longer equals durable requested source debit';
  END IF;

  FOR row_lot IN
    SELECT tl.lot_id, tl.reserved_decimal, lot.remaining_decimal
    FROM public.cryptocrawler_system_capital_transfer_lots tl
    JOIN public.cryptocrawler_cex_system_owned_lots lot USING (lot_id)
    WHERE tl.transfer_id=p_transfer_id
    ORDER BY lot.created_at ASC, lot.lot_id ASC
    FOR UPDATE OF lot
  LOOP
    IF row_lot.remaining_decimal + 0.000000000000000001 < row_lot.reserved_decimal THEN
      RAISE EXCEPTION 'reserved system-capital lot was consumed while treasury transfer was in flight';
    END IF;
    new_remaining := row_lot.remaining_decimal - row_lot.reserved_decimal;
    UPDATE public.cryptocrawler_cex_system_owned_lots
    SET remaining_decimal=new_remaining,
        status=CASE WHEN new_remaining <= 0.000000000000000001 THEN 'CONSUMED' ELSE 'ACTIVE' END,
        updated_at=now()
    WHERE lot_id=row_lot.lot_id;
  END LOOP;

  IF transfer_row.target_kind='cex' THEN
    INSERT INTO public.cryptocrawler_cex_system_owned_lots (
      lot_id, idempotency_key, venue, asset, amount_decimal, remaining_decimal,
      status, origin_kind, origin_reference, opportunity_id, strategy,
      settlement_reference, settlement_evidence, authority_evidence,
      created_at, updated_at
    ) VALUES (
      gen_random_uuid(),
      'cex-transfer:' || p_transfer_id::text,
      transfer_row.target_venue,
      transfer_row.asset,
      p_delivered_decimal,
      p_delivered_decimal,
      'ACTIVE',
      'CEX_TRANSFER',
      p_transfer_id::text,
      transfer_row.source_event_id,
      transfer_row.transfer_kind,
      COALESCE(NULLIF(trim(p_settlement_reference),''), p_transfer_id::text),
      COALESCE(p_evidence,'{}'::jsonb),
      jsonb_build_object(
        'sourceVenue', transfer_row.source_venue,
        'targetVenue', transfer_row.target_venue,
        'sourceDebitDecimal', transfer_row.requested_source_decimal,
        'deliveredDecimal', p_delivered_decimal,
        'sourceFeeDecimal', p_source_fee_decimal,
        'provenanceAuthority', 'cryptocrawler_system_capital_transfer_lots'
      ),
      now(), now()
    ) ON CONFLICT (idempotency_key) DO NOTHING;
  END IF;

  UPDATE public.cryptocrawler_system_capital_transfers
  SET delivered_destination_decimal=p_delivered_decimal,
      source_fee_decimal=p_source_fee_decimal,
      status='CONFIRMED',
      destination_reference=COALESCE(NULLIF(trim(p_settlement_reference),''), destination_reference),
      transaction_hash=COALESCE(NULLIF(trim(p_transaction_hash),''), transaction_hash),
      destination_evidence=COALESCE(destination_evidence,'{}'::jsonb) || COALESCE(p_evidence,'{}'::jsonb),
      confirmed_at=COALESCE(confirmed_at,now()),
      updated_at=now(),
      last_error=NULL
  WHERE transfer_id=p_transfer_id;

  RETURN true;
END;
$$;

REVOKE ALL ON TABLE public.cryptocrawler_system_capital_transfers FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.cryptocrawler_system_capital_transfer_lots FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.cryptocrawler_system_capital_sweep_batches FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.cryptocrawler_system_capital_transfers TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.cryptocrawler_system_capital_transfer_lots TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.cryptocrawler_system_capital_sweep_batches TO service_role;
ALTER TABLE public.cryptocrawler_system_capital_transfers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cryptocrawler_system_capital_transfer_lots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cryptocrawler_system_capital_sweep_batches ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON FUNCTION public.cryptocrawler_reserve_system_capital_transfer(uuid,text,text,numeric) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.cryptocrawler_release_system_capital_transfer(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.cryptocrawler_confirm_system_capital_transfer(uuid,numeric,numeric,text,text,jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cryptocrawler_reserve_system_capital_transfer(uuid,text,text,numeric) TO service_role;
GRANT EXECUTE ON FUNCTION public.cryptocrawler_release_system_capital_transfer(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.cryptocrawler_confirm_system_capital_transfer(uuid,numeric,numeric,text,text,jsonb) TO service_role;

COMMENT ON TABLE public.cryptocrawler_system_capital_transfers IS
  'Single durable authority for retained CEX routing, Kraken-to-OKX payout funding, and >$4,000 normal-runtime system-capital sweeps. Transfer rows never authorize raw operator balances.';
COMMENT ON TABLE public.cryptocrawler_system_capital_transfer_lots IS
  'Exact ACTIVE system-owned lot units reserved against a treasury transfer. Live trading must subtract these reservations before admitting new exposure.';
COMMENT ON TABLE public.cryptocrawler_system_capital_sweep_batches IS
  'Normal-runtime 80% wallet sweep intent created only when freshly priced provenance-backed system-owned value on one exchange exceeds exactly $4,000.';
COMMENT ON TABLE public.cryptocrawler_profit_payout_jobs IS
  'Durable profitable-settlement obligations. New operator-strategy rows allocate exactly 90% to ETH/Ethereum wallet payout and 10% to retained market capital; historical rows remain immutable.';
COMMENT ON COLUMN public.cryptocrawler_profit_payout_jobs.retained_target_usd IS
  'Exactly 10% for new operator-strategy profit events. Retained spendability requires physical system-owned provenance and may be routed between Kraken/OKX only through confirmed treasury transfers.';

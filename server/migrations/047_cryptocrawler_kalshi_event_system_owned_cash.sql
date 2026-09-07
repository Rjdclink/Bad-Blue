-- Kalshi prediction-market cash authority.
--
-- Prediction-market cash and perpetuals margin are separate regulated accounts.
-- Authenticated prediction balance is physical-capacity evidence only. It never
-- creates CryptoCrawler ownership. Ownership exists only after a separately
-- verified system transfer or terminal system-generated event settlement.

CREATE TABLE IF NOT EXISTS public.cryptocrawler_kalshi_event_system_owned_cash_lots (
  lot_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  idempotency_key text NOT NULL UNIQUE,
  amount_usd numeric(78,36) NOT NULL CHECK (amount_usd > 0),
  remaining_usd numeric(78,36) NOT NULL CHECK (remaining_usd >= 0 AND remaining_usd <= amount_usd),
  status text NOT NULL CHECK (status IN ('ACTIVE','CONSUMED','QUARANTINED')),
  origin_kind text NOT NULL CHECK (origin_kind IN (
    'SYSTEM_TRANSFER',
    'REALIZED_EVENT',
    'MAKER_REBATE',
    'FEE_REFUND',
    'INCENTIVE_REWARD',
    'OTHER_VERIFIED_SYSTEM_PROFIT'
  )),
  origin_reference text NOT NULL,
  opportunity_id text,
  strategy text,
  settlement_reference text NOT NULL,
  settlement_evidence jsonb NOT NULL,
  authority_evidence jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.cryptocrawler_kalshi_event_cash_reservations (
  reservation_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lifecycle_id text NOT NULL,
  opportunity_id text NOT NULL,
  amount_usd numeric(78,36) NOT NULL CHECK (amount_usd > 0),
  status text NOT NULL CHECK (status IN ('HELD','RELEASED','QUARANTINED')),
  expires_at timestamptz NOT NULL,
  authority_evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (lifecycle_id, opportunity_id)
);

CREATE TABLE IF NOT EXISTS public.cryptocrawler_kalshi_event_cash_settlements (
  settlement_reference text PRIMARY KEY,
  lifecycle_id text NOT NULL,
  opportunity_id text NOT NULL,
  strategy text NOT NULL,
  status text NOT NULL CHECK (status IN ('APPLYING','APPLIED','QUARANTINED')),
  cash_delta_usd numeric(78,36) NOT NULL,
  realized_profit_usd numeric(78,36) NOT NULL,
  realized_fees_usd numeric(78,36) NOT NULL CHECK (realized_fees_usd >= 0),
  realized_incentive_usd numeric(78,36) NOT NULL DEFAULT 0,
  settlement_evidence jsonb NOT NULL,
  authority_evidence jsonb NOT NULL,
  consumed_lot_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_lot_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  applied_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_kalshi_event_cash_inventory
  ON public.cryptocrawler_kalshi_event_system_owned_cash_lots(status, updated_at)
  WHERE remaining_usd > 0;
CREATE INDEX IF NOT EXISTS idx_kalshi_event_cash_reservations_active
  ON public.cryptocrawler_kalshi_event_cash_reservations(status, expires_at);
CREATE INDEX IF NOT EXISTS idx_kalshi_event_cash_settlements_opportunity
  ON public.cryptocrawler_kalshi_event_cash_settlements(opportunity_id, applied_at);

ALTER TABLE public.cryptocrawler_kalshi_event_system_owned_cash_lots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cryptocrawler_kalshi_event_cash_reservations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cryptocrawler_kalshi_event_cash_settlements ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.cryptocrawler_kalshi_event_system_owned_cash_lots FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.cryptocrawler_kalshi_event_cash_reservations FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.cryptocrawler_kalshi_event_cash_settlements FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.cryptocrawler_kalshi_event_system_owned_cash_lots TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.cryptocrawler_kalshi_event_cash_reservations TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.cryptocrawler_kalshi_event_cash_settlements TO service_role;

CREATE OR REPLACE FUNCTION public.cryptocrawler_reserve_kalshi_event_system_cash(
  p_lifecycle_id text,
  p_opportunity_id text,
  p_amount_usd numeric,
  p_expires_at timestamptz,
  p_authority_evidence jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  owned_available numeric(78,36);
  existing_id uuid;
  result_id uuid;
BEGIN
  IF p_amount_usd IS NULL OR p_amount_usd <= 0 THEN
    RAISE EXCEPTION 'Kalshi event system cash reservation amount must be positive';
  END IF;
  IF p_expires_at IS NULL OR p_expires_at <= now() THEN
    RAISE EXCEPTION 'Kalshi event system cash reservation expiry must be future';
  END IF;

  SELECT reservation_id INTO existing_id
  FROM public.cryptocrawler_kalshi_event_cash_reservations
  WHERE lifecycle_id=p_lifecycle_id AND opportunity_id=p_opportunity_id
    AND status='HELD' AND expires_at > now()
  FOR UPDATE;
  IF existing_id IS NOT NULL THEN
    RETURN existing_id;
  END IF;

  PERFORM 1
  FROM public.cryptocrawler_kalshi_event_system_owned_cash_lots
  WHERE status='ACTIVE' AND remaining_usd > 0
  ORDER BY created_at, lot_id
  FOR UPDATE;

  SELECT
    COALESCE((SELECT SUM(remaining_usd)
              FROM public.cryptocrawler_kalshi_event_system_owned_cash_lots
              WHERE status='ACTIVE' AND remaining_usd > 0),0)
    - COALESCE((SELECT SUM(amount_usd)
                FROM public.cryptocrawler_kalshi_event_cash_reservations
                WHERE status='HELD' AND expires_at > now()),0)
  INTO owned_available;

  IF owned_available < p_amount_usd THEN
    RETURN NULL;
  END IF;

  INSERT INTO public.cryptocrawler_kalshi_event_cash_reservations
    (lifecycle_id, opportunity_id, amount_usd, status, expires_at, authority_evidence)
  VALUES
    (p_lifecycle_id, p_opportunity_id, p_amount_usd, 'HELD', p_expires_at,
     COALESCE(p_authority_evidence,'{}'::jsonb))
  ON CONFLICT (lifecycle_id, opportunity_id) DO UPDATE
  SET amount_usd=EXCLUDED.amount_usd,
      status='HELD',
      expires_at=EXCLUDED.expires_at,
      authority_evidence=EXCLUDED.authority_evidence,
      updated_at=now()
  WHERE public.cryptocrawler_kalshi_event_cash_reservations.status <> 'HELD'
     OR public.cryptocrawler_kalshi_event_cash_reservations.expires_at <= now()
  RETURNING reservation_id INTO result_id;
  RETURN result_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.cryptocrawler_release_kalshi_event_system_cash(p_reservation_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  changed integer;
BEGIN
  UPDATE public.cryptocrawler_kalshi_event_cash_reservations
  SET status='RELEASED', updated_at=now()
  WHERE reservation_id=p_reservation_id AND status='HELD';
  GET DIAGNOSTICS changed = ROW_COUNT;
  RETURN changed = 1;
END;
$$;

CREATE OR REPLACE FUNCTION public.cryptocrawler_renew_kalshi_event_system_cash(
  p_reservation_id uuid,
  p_expires_at timestamptz
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  changed integer;
BEGIN
  IF p_expires_at IS NULL OR p_expires_at <= now() THEN RETURN false; END IF;
  UPDATE public.cryptocrawler_kalshi_event_cash_reservations
  SET expires_at=GREATEST(expires_at,p_expires_at), updated_at=now()
  WHERE reservation_id=p_reservation_id AND status='HELD' AND expires_at > now();
  GET DIAGNOSTICS changed = ROW_COUNT;
  RETURN changed = 1;
END;
$$;

REVOKE ALL ON FUNCTION public.cryptocrawler_reserve_kalshi_event_system_cash(text,text,numeric,timestamptz,jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.cryptocrawler_release_kalshi_event_system_cash(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.cryptocrawler_renew_kalshi_event_system_cash(uuid,timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cryptocrawler_reserve_kalshi_event_system_cash(text,text,numeric,timestamptz,jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.cryptocrawler_release_kalshi_event_system_cash(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.cryptocrawler_renew_kalshi_event_system_cash(uuid,timestamptz) TO service_role;

COMMENT ON TABLE public.cryptocrawler_kalshi_event_system_owned_cash_lots IS
  'Exact system-owned Kalshi prediction-market cash. Authenticated account balance is capacity evidence only and never mints ownership.';
COMMENT ON TABLE public.cryptocrawler_kalshi_event_cash_reservations IS
  'Durable holds against proven system-owned Kalshi prediction-market cash. Prediction cash and perpetuals margin remain separate authorities.';
COMMENT ON TABLE public.cryptocrawler_kalshi_event_cash_settlements IS
  'Idempotent terminal Kalshi prediction-market settlement accounting. Only authenticated terminal evidence may alter system-owned event cash lots.';

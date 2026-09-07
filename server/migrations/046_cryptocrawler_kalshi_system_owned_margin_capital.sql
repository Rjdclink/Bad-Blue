-- Kalshi perpetual margin capital authority.
--
-- IMPORTANT OWNERSHIP RULE:
-- Authenticated Kalshi account balances are physical-capacity evidence only. They
-- never create CryptoCrawler ownership. A lot may exist only after a separately
-- proven system-origin transfer or terminal system-generated Kalshi settlement.
-- This keeps the zero-personal-capital contract fail-closed.

CREATE TABLE IF NOT EXISTS public.cryptocrawler_kalshi_system_owned_margin_lots (
  lot_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  idempotency_key text NOT NULL UNIQUE,
  amount_usd numeric(78,36) NOT NULL CHECK (amount_usd > 0),
  remaining_usd numeric(78,36) NOT NULL CHECK (remaining_usd >= 0 AND remaining_usd <= amount_usd),
  status text NOT NULL CHECK (status IN ('ACTIVE','CONSUMED','QUARANTINED')),
  origin_kind text NOT NULL CHECK (origin_kind IN (
    'SYSTEM_TRANSFER',
    'REALIZED_FUNDING',
    'REALIZED_EVENT_PROFIT',
    'MAKER_REBATE',
    'FEE_REFUND',
    'INTEREST_CREDIT',
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

CREATE TABLE IF NOT EXISTS public.cryptocrawler_kalshi_margin_reservations (
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

CREATE TABLE IF NOT EXISTS public.cryptocrawler_kalshi_margin_settlements (
  settlement_reference text PRIMARY KEY,
  lifecycle_id text NOT NULL,
  opportunity_id text NOT NULL,
  strategy text NOT NULL,
  status text NOT NULL CHECK (status IN ('APPLYING','APPLIED','QUARANTINED')),
  principal_delta_usd numeric(78,36) NOT NULL,
  realized_profit_usd numeric(78,36) NOT NULL,
  realized_fees_usd numeric(78,36) NOT NULL CHECK (realized_fees_usd >= 0),
  realized_funding_usd numeric(78,36) NOT NULL,
  settlement_evidence jsonb NOT NULL,
  authority_evidence jsonb NOT NULL,
  consumed_lot_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_lot_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  applied_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_kalshi_system_owned_margin_inventory
  ON public.cryptocrawler_kalshi_system_owned_margin_lots(status, updated_at)
  WHERE remaining_usd > 0;
CREATE INDEX IF NOT EXISTS idx_kalshi_margin_reservations_active
  ON public.cryptocrawler_kalshi_margin_reservations(status, expires_at);
CREATE INDEX IF NOT EXISTS idx_kalshi_margin_settlements_opportunity
  ON public.cryptocrawler_kalshi_margin_settlements(opportunity_id, applied_at);

ALTER TABLE public.cryptocrawler_kalshi_system_owned_margin_lots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cryptocrawler_kalshi_margin_reservations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cryptocrawler_kalshi_margin_settlements ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.cryptocrawler_kalshi_system_owned_margin_lots FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.cryptocrawler_kalshi_margin_reservations FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.cryptocrawler_kalshi_margin_settlements FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.cryptocrawler_kalshi_system_owned_margin_lots TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.cryptocrawler_kalshi_margin_reservations TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.cryptocrawler_kalshi_margin_settlements TO service_role;

-- Atomically reserve only already-proven system-owned margin capital. Account
-- balances are intentionally absent from this function; runtime separately caps
-- the requested reservation against fresh authenticated Kalshi available balance.
CREATE OR REPLACE FUNCTION public.cryptocrawler_reserve_kalshi_system_margin(
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
    RAISE EXCEPTION 'Kalshi system margin reservation amount must be positive';
  END IF;
  IF p_expires_at IS NULL OR p_expires_at <= now() THEN
    RAISE EXCEPTION 'Kalshi system margin reservation expiry must be future';
  END IF;

  SELECT reservation_id INTO existing_id
  FROM public.cryptocrawler_kalshi_margin_reservations
  WHERE lifecycle_id=p_lifecycle_id AND opportunity_id=p_opportunity_id
    AND status='HELD' AND expires_at > now()
  FOR UPDATE;
  IF existing_id IS NOT NULL THEN
    RETURN existing_id;
  END IF;

  -- Serialize reservations against ownership rows so concurrent strategies cannot
  -- over-commit the same system-generated dollars.
  PERFORM 1
  FROM public.cryptocrawler_kalshi_system_owned_margin_lots
  WHERE status='ACTIVE' AND remaining_usd > 0
  ORDER BY created_at, lot_id
  FOR UPDATE;

  SELECT
    COALESCE((SELECT SUM(remaining_usd)
              FROM public.cryptocrawler_kalshi_system_owned_margin_lots
              WHERE status='ACTIVE' AND remaining_usd > 0),0)
    - COALESCE((SELECT SUM(amount_usd)
                FROM public.cryptocrawler_kalshi_margin_reservations
                WHERE status='HELD' AND expires_at > now()),0)
  INTO owned_available;

  IF owned_available < p_amount_usd THEN
    RETURN NULL;
  END IF;

  -- One durable row per lifecycle/opportunity is deliberately reusable after
  -- release/expiry. This avoids a restart or prior expired hold permanently
  -- blocking the same durable lifecycle identity.
  INSERT INTO public.cryptocrawler_kalshi_margin_reservations
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
  WHERE public.cryptocrawler_kalshi_margin_reservations.status <> 'HELD'
     OR public.cryptocrawler_kalshi_margin_reservations.expires_at <= now()
  RETURNING reservation_id INTO result_id;
  RETURN result_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.cryptocrawler_release_kalshi_system_margin(p_reservation_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  changed integer;
BEGIN
  UPDATE public.cryptocrawler_kalshi_margin_reservations
  SET status='RELEASED', updated_at=now()
  WHERE reservation_id=p_reservation_id AND status='HELD';
  GET DIAGNOSTICS changed = ROW_COUNT;
  RETURN changed = 1;
END;
$$;

CREATE OR REPLACE FUNCTION public.cryptocrawler_renew_kalshi_system_margin(
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
  UPDATE public.cryptocrawler_kalshi_margin_reservations
  SET expires_at=GREATEST(expires_at,p_expires_at), updated_at=now()
  WHERE reservation_id=p_reservation_id AND status='HELD' AND expires_at > now();
  GET DIAGNOSTICS changed = ROW_COUNT;
  RETURN changed = 1;
END;
$$;

REVOKE ALL ON FUNCTION public.cryptocrawler_reserve_kalshi_system_margin(text,text,numeric,timestamptz,jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.cryptocrawler_release_kalshi_system_margin(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.cryptocrawler_renew_kalshi_system_margin(uuid,timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cryptocrawler_reserve_kalshi_system_margin(text,text,numeric,timestamptz,jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.cryptocrawler_release_kalshi_system_margin(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.cryptocrawler_renew_kalshi_system_margin(uuid,timestamptz) TO service_role;

COMMENT ON TABLE public.cryptocrawler_kalshi_system_owned_margin_lots IS
  'Exact system-owned Kalshi margin capital. Authenticated account balances are reconciliation/capacity evidence only and never mint ownership.';
COMMENT ON TABLE public.cryptocrawler_kalshi_margin_reservations IS
  'Durable holds against proven system-owned Kalshi margin capital. Reservations do not mint or transfer ownership.';
COMMENT ON TABLE public.cryptocrawler_kalshi_margin_settlements IS
  'Idempotent terminal Kalshi funding/event settlement accounting. Only authenticated terminal evidence may alter system-owned margin lots.';
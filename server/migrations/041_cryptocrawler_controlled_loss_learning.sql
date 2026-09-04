-- Controlled-loss learning authority.
-- Exactly one intentional negative-edge learning event may be completed per
-- operator trading day. It is unlocked only by a terminal positive profit event,
-- is scheduled after that first win at a durable randomized time, and may never
-- consume more than 5% of the gross positive profit already realized that day.
-- The normal 1-3 profit-seeking parent-trade quota is intentionally untouched.

ALTER TABLE public.cryptocrawler_operator_strategy_days
  ADD COLUMN IF NOT EXISTS controlled_loss_usd numeric NOT NULL DEFAULT 0;

ALTER TABLE public.cryptocrawler_operator_strategy_days
  DROP CONSTRAINT IF EXISTS cryptocrawler_operator_strategy_days_controlled_loss_check;
ALTER TABLE public.cryptocrawler_operator_strategy_days
  ADD CONSTRAINT cryptocrawler_operator_strategy_days_controlled_loss_check CHECK (
    controlled_loss_usd >= 0 AND
    controlled_loss_usd <= realized_profit_usd * 0.05 + 0.000000001
  );

CREATE TABLE IF NOT EXISTS public.cryptocrawler_controlled_loss_learning_events (
  event_id uuid PRIMARY KEY,
  local_date date NOT NULL UNIQUE REFERENCES public.cryptocrawler_operator_strategy_days(local_date) ON DELETE RESTRICT,
  unlock_profit_event_id text NOT NULL REFERENCES public.cryptocrawler_operator_profit_events(event_id) ON DELETE RESTRICT,
  unlocked_at timestamptz NOT NULL,
  scheduled_not_before timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'SCHEDULED' CHECK (status IN (
    'SCHEDULED','PREPARED','ENTRY_SUBMITTED','ENTRY_TERMINAL','EXIT_SUBMITTED',
    'RETRYABLE','TERMINAL_LOSS','TERMINAL_NONLOSS','BLOCKED','MANUAL_REVIEW','MISSED'
  )),
  gross_profit_usd_at_claim numeric,
  max_loss_usd numeric,
  expected_loss_usd numeric,
  venue text CHECK (venue IS NULL OR venue IN ('kraken','okx')),
  symbol text,
  base_asset text,
  quote_asset text,
  quote_asset_usd numeric,
  authenticated_taker_fee_bps numeric,
  source_quote_reserve decimal,
  requested_base_quantity decimal,
  entry_limit_price numeric,
  entry_client_order_id text,
  entry_order_id text,
  entry_inventory_reservation_id uuid,
  entry_applied boolean NOT NULL DEFAULT false,
  exit_limit_price numeric,
  exit_client_order_id text,
  exit_order_id text,
  exit_inventory_reservation_id uuid,
  exit_applied boolean NOT NULL DEFAULT false,
  realized_profit_usd numeric,
  terminal_price_observed_at timestamptz,
  settlement_evidence jsonb,
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  retry_not_before timestamptz,
  last_attempt_at timestamptz,
  last_error text,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (scheduled_not_before >= unlocked_at),
  CHECK (gross_profit_usd_at_claim IS NULL OR gross_profit_usd_at_claim > 0),
  CHECK (max_loss_usd IS NULL OR (
    gross_profit_usd_at_claim IS NOT NULL AND
    max_loss_usd > 0 AND
    max_loss_usd <= gross_profit_usd_at_claim * 0.05 + 0.000000001
  )),
  CHECK (expected_loss_usd IS NULL OR expected_loss_usd >= 0),
  CHECK (realized_profit_usd IS NULL OR max_loss_usd IS NULL OR realized_profit_usd >= -max_loss_usd - 0.000000001)
);

CREATE INDEX IF NOT EXISTS idx_cryptocrawler_controlled_loss_ready
  ON public.cryptocrawler_controlled_loss_learning_events(status, scheduled_not_before, retry_not_before);

CREATE OR REPLACE FUNCTION public.cryptocrawler_record_controlled_loss_terminal(
  p_event_id uuid,
  p_realized_profit_usd numeric,
  p_settlement_evidence jsonb
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  target public.cryptocrawler_controlled_loss_learning_events%ROWTYPE;
  current_gross numeric;
  realized_loss numeric;
  terminal_status text;
BEGIN
  SELECT * INTO target
  FROM public.cryptocrawler_controlled_loss_learning_events
  WHERE event_id=p_event_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'controlled-loss event % does not exist', p_event_id;
  END IF;

  IF target.status IN ('TERMINAL_LOSS','TERMINAL_NONLOSS') THEN
    RETURN target.status;
  END IF;

  IF target.max_loss_usd IS NULL OR target.max_loss_usd <= 0 THEN
    RAISE EXCEPTION 'controlled-loss event % has no durable loss budget', p_event_id;
  END IF;

  SELECT realized_profit_usd INTO current_gross
  FROM public.cryptocrawler_operator_strategy_days
  WHERE local_date=target.local_date
  FOR UPDATE;

  IF current_gross IS NULL OR current_gross <= 0 THEN
    RAISE EXCEPTION 'controlled-loss event % no longer has positive daily profit authority', p_event_id;
  END IF;

  IF target.max_loss_usd > current_gross * 0.05 + 0.000000001 THEN
    RAISE EXCEPTION 'controlled-loss budget exceeds 5 percent of current gross daily profit';
  END IF;

  realized_loss := CASE
    WHEN p_realized_profit_usd IS NOT NULL AND p_realized_profit_usd < 0 THEN abs(p_realized_profit_usd)
    ELSE 0
  END;

  IF realized_loss > target.max_loss_usd + 0.000000001 OR realized_loss > current_gross * 0.05 + 0.000000001 THEN
    RAISE EXCEPTION 'controlled-loss terminal result exceeds the durable 5 percent daily loss ceiling';
  END IF;

  terminal_status := CASE WHEN realized_loss > 0 THEN 'TERMINAL_LOSS' ELSE 'TERMINAL_NONLOSS' END;

  UPDATE public.cryptocrawler_controlled_loss_learning_events
  SET status=terminal_status,
      realized_profit_usd=p_realized_profit_usd,
      settlement_evidence=COALESCE(p_settlement_evidence, '{}'::jsonb),
      completed_at=now(),
      updated_at=now(),
      last_error=NULL
  WHERE event_id=p_event_id;

  IF realized_loss > 0 THEN
    UPDATE public.cryptocrawler_operator_strategy_days
    SET controlled_loss_usd=realized_loss,
        updated_at=now()
    WHERE local_date=target.local_date;
  END IF;

  RETURN terminal_status;
END;
$$;

-- Treasury and controlled-loss reservations are lifecycle reservations. Wall
-- clock expiry may never make in-flight money visible to another execution path.
CREATE OR REPLACE FUNCTION public.cryptocrawler_enforce_lifecycle_inventory_reservation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.reservation_id LIKE 'treasury:%'
     OR NEW.opportunity_id LIKE 'system-sweep:%'
     OR NEW.opportunity_id LIKE 'controlled-loss:%' THEN
    NEW.expires_at := 'infinity'::timestamptz;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON TABLE public.cryptocrawler_controlled_loss_learning_events FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.cryptocrawler_controlled_loss_learning_events TO service_role;
ALTER TABLE public.cryptocrawler_controlled_loss_learning_events ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON FUNCTION public.cryptocrawler_record_controlled_loss_terminal(uuid,numeric,jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cryptocrawler_record_controlled_loss_terminal(uuid,numeric,jsonb) TO service_role;

COMMENT ON TABLE public.cryptocrawler_controlled_loss_learning_events IS
  'One randomized post-first-win negative-edge learning event per operator trading day. Terminal loss is capped at <=5% of gross positive daily profit and feeds canonical Cryptara learning.';
COMMENT ON COLUMN public.cryptocrawler_operator_strategy_days.controlled_loss_usd IS
  'Terminal controlled-learning loss only. It is telemetry/learning data and does not reduce gross-positive profit-stop authority.';

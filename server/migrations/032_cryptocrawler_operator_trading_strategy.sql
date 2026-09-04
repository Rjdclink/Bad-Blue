-- Operator trading strategy authority.
-- This migration intentionally sits above canonical profitability/risk admission:
-- it controls WHEN and HOW MANY opportunities may be submitted, never whether a
-- current opportunity is economically profitable.

ALTER TABLE public.cryptocrawler_profit_payout_jobs
  DROP CONSTRAINT IF EXISTS cryptocrawler_profit_payout_jobs_fraction_check;
ALTER TABLE public.cryptocrawler_profit_payout_jobs
  ADD CONSTRAINT cryptocrawler_profit_payout_jobs_fraction_check CHECK (
    payout_fraction IS NULL OR (
      retained_fraction IS NOT NULL AND
      abs((payout_fraction + retained_fraction) - 1.0) <= 0.000000001 AND
      (
        -- Historical rows from migration 019 remain valid and immutable.
        (payout_fraction >= 0.55 AND payout_fraction <= 0.65) OR
        -- Current operator strategy is fixed at 90% wallet / 10% retained.
        abs(payout_fraction - 0.90) <= 0.000000001
      )
    )
  );

CREATE TABLE IF NOT EXISTS public.cryptocrawler_operator_strategy_control (
  system_key text PRIMARY KEY,
  timezone text NOT NULL DEFAULT 'America/Chicago',
  anchor_date date,
  strategy_version integer NOT NULL DEFAULT 1 CHECK (strategy_version = 1),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (system_key = 'cryptocrawler'),
  CHECK (timezone = 'America/Chicago')
);

INSERT INTO public.cryptocrawler_operator_strategy_control (system_key)
VALUES ('cryptocrawler')
ON CONFLICT (system_key) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.cryptocrawler_operator_strategy_cycles (
  cycle_start date PRIMARY KEY,
  cycle_end date NOT NULL,
  trade_day_offsets smallint[] NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (cycle_end = cycle_start + 29),
  CHECK (cardinality(trade_day_offsets) = 20)
);

CREATE TABLE IF NOT EXISTS public.cryptocrawler_operator_strategy_days (
  local_date date PRIMARY KEY,
  cycle_start date NOT NULL REFERENCES public.cryptocrawler_operator_strategy_cycles(cycle_start) ON DELETE CASCADE,
  day_offset smallint NOT NULL CHECK (day_offset BETWEEN 0 AND 29),
  is_trade_day boolean NOT NULL,
  max_trades smallint NOT NULL CHECK (max_trades BETWEEN 1 AND 3),
  profit_ceiling_usd numeric NOT NULL CHECK (profit_ceiling_usd BETWEEN 300 AND 3500),
  stop_profit_usd numeric NOT NULL,
  submitted_trades integer NOT NULL DEFAULT 0 CHECK (submitted_trades >= 0),
  realized_profit_usd numeric NOT NULL DEFAULT 0,
  learning_last_attempt_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (stop_profit_usd = profit_ceiling_usd - 50),
  CHECK (submitted_trades <= max_trades)
);

CREATE INDEX IF NOT EXISTS idx_cryptocrawler_operator_strategy_cycle
  ON public.cryptocrawler_operator_strategy_days(cycle_start, local_date);

CREATE TABLE IF NOT EXISTS public.cryptocrawler_operator_trade_reservations (
  reservation_id uuid PRIMARY KEY,
  opportunity_id text NOT NULL UNIQUE,
  strategy text NOT NULL,
  local_date date NOT NULL REFERENCES public.cryptocrawler_operator_strategy_days(local_date) ON DELETE RESTRICT,
  status text NOT NULL CHECK (status IN ('RESERVED','SUBMITTED','RELEASED','TERMINAL')),
  created_at timestamptz NOT NULL DEFAULT now(),
  submitted_at timestamptz,
  terminal_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_cryptocrawler_operator_trade_slots
  ON public.cryptocrawler_operator_trade_reservations(local_date, status);

CREATE TABLE IF NOT EXISTS public.cryptocrawler_operator_profit_events (
  event_id text PRIMARY KEY,
  opportunity_id text,
  local_date date NOT NULL REFERENCES public.cryptocrawler_operator_strategy_days(local_date) ON DELETE RESTRICT,
  realized_profit_usd numeric NOT NULL CHECK (realized_profit_usd > 0),
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Retained-capital strategy decision. This is allocation intent/accounting only;
-- it never turns an operator balance into system-owned capital and never grants
-- spend authority. Physical ownership remains the lot ledger's responsibility.
CREATE TABLE IF NOT EXISTS public.cryptocrawler_retained_exchange_allocations (
  event_id text PRIMARY KEY,
  retained_usd numeric NOT NULL CHECK (retained_usd >= 0),
  target_venue text NOT NULL CHECK (target_venue IN ('kraken','okx')),
  source_venue text,
  status text NOT NULL DEFAULT 'TARGET_SELECTED' CHECK (status IN ('TARGET_SELECTED','IN_PLACE','TRANSFER_REQUIRED','PLACED','BLOCKED')),
  placement_reference text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION public.cryptocrawler_operator_strategy_record_profit(
  p_event_id text,
  p_opportunity_id text,
  p_profit_usd numeric
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  target_date date;
  inserted_event text;
BEGIN
  IF p_event_id IS NULL OR length(trim(p_event_id)) = 0 OR p_profit_usd IS NULL OR p_profit_usd <= 0 THEN
    RETURN false;
  END IF;

  IF p_opportunity_id IS NOT NULL AND length(trim(p_opportunity_id)) > 0 THEN
    SELECT local_date INTO target_date
    FROM public.cryptocrawler_operator_trade_reservations
    WHERE opportunity_id=p_opportunity_id
      AND status IN ('SUBMITTED','TERMINAL')
    LIMIT 1;
  END IF;

  IF target_date IS NULL THEN
    target_date := (now() AT TIME ZONE 'America/Chicago')::date;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.cryptocrawler_operator_strategy_days WHERE local_date=target_date
  ) THEN
    RAISE EXCEPTION 'operator strategy day is missing for terminal profit date %', target_date;
  END IF;

  INSERT INTO public.cryptocrawler_operator_profit_events
    (event_id, opportunity_id, local_date, realized_profit_usd)
  VALUES (p_event_id, NULLIF(trim(p_opportunity_id), ''), target_date, p_profit_usd)
  ON CONFLICT (event_id) DO NOTHING
  RETURNING event_id INTO inserted_event;

  IF inserted_event IS NULL THEN
    RETURN false;
  END IF;

  UPDATE public.cryptocrawler_operator_strategy_days
  SET realized_profit_usd = realized_profit_usd + p_profit_usd,
      updated_at = now()
  WHERE local_date=target_date;

  RETURN true;
END;
$$;

REVOKE ALL ON TABLE public.cryptocrawler_operator_strategy_control FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.cryptocrawler_operator_strategy_cycles FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.cryptocrawler_operator_strategy_days FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.cryptocrawler_operator_trade_reservations FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.cryptocrawler_operator_profit_events FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.cryptocrawler_retained_exchange_allocations FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.cryptocrawler_operator_strategy_control TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.cryptocrawler_operator_strategy_cycles TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.cryptocrawler_operator_strategy_days TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.cryptocrawler_operator_trade_reservations TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.cryptocrawler_operator_profit_events TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.cryptocrawler_retained_exchange_allocations TO service_role;
REVOKE ALL ON FUNCTION public.cryptocrawler_operator_strategy_record_profit(text,text,numeric) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cryptocrawler_operator_strategy_record_profit(text,text,numeric) TO service_role;

ALTER TABLE public.cryptocrawler_operator_strategy_control ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cryptocrawler_operator_strategy_cycles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cryptocrawler_operator_strategy_days ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cryptocrawler_operator_trade_reservations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cryptocrawler_operator_profit_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cryptocrawler_retained_exchange_allocations ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.cryptocrawler_operator_strategy_cycles IS
  'Durable 30-day strategy windows. Exactly 20 randomized offsets are trading days; the other 10 remain execution-dark learning days.';
COMMENT ON TABLE public.cryptocrawler_operator_strategy_days IS
  'Persisted daily draw: 1-3 submitted opportunities and a $300-$3500 profit ceiling with an exact $50 early-stop cushion.';
COMMENT ON TABLE public.cryptocrawler_operator_trade_reservations IS
  'Atomic parent-opportunity slot reservations. A slot increments the daily submitted count only after concrete submission evidence.';
COMMENT ON TABLE public.cryptocrawler_retained_exchange_allocations IS
  'Persisted random retained-capital destination intent. It has no execution/spend authority and cannot substitute for settlement-derived system-owned lots.';
COMMENT ON COLUMN public.cryptocrawler_profit_payout_jobs.payout_fraction IS
  'Historical 0.55-0.65 rows remain valid. New terminal profitable settlements use fixed 0.90 wallet payout and 0.10 retained market capital.';

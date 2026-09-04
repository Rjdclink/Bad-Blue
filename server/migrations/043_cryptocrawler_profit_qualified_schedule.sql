-- Adaptive 30-day operator schedule.
-- The 30-day calendar window remains fixed and durable. Twenty randomized
-- baseline attempt dates are persisted at cycle creation, but only days whose
-- signed terminal-confirmed realized P&L remains positive count toward the
-- 20-day objective. Reserve/learning days may be promoted later when required
-- to keep the target reachable. Failure to reach 20 does not fail the system or
-- force a trade.

ALTER TABLE public.cryptocrawler_operator_strategy_cycles
  ADD COLUMN IF NOT EXISTS profit_day_target smallint NOT NULL DEFAULT 20;

ALTER TABLE public.cryptocrawler_operator_strategy_cycles
  DROP CONSTRAINT IF EXISTS cryptocrawler_operator_strategy_cycles_profit_day_target_check;
ALTER TABLE public.cryptocrawler_operator_strategy_cycles
  ADD CONSTRAINT cryptocrawler_operator_strategy_cycles_profit_day_target_check
  CHECK (profit_day_target = 20);

ALTER TABLE public.cryptocrawler_operator_strategy_days
  ADD COLUMN IF NOT EXISTS eligibility_decided boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS eligibility_source text,
  ADD COLUMN IF NOT EXISTS profit_qualified boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS profit_qualified_at timestamptz;

-- Historical rows contained profitable payout events only. Future terminal P&L
-- records may be signed so the day qualification can fall back to false if later
-- realized losses erase the day's net profit.
ALTER TABLE public.cryptocrawler_operator_profit_events
  DROP CONSTRAINT IF EXISTS cryptocrawler_operator_profit_events_realized_profit_usd_check;
ALTER TABLE public.cryptocrawler_operator_profit_events
  ADD CONSTRAINT cryptocrawler_operator_profit_events_realized_profit_usd_check
  CHECK (realized_profit_usd <> 0);

UPDATE public.cryptocrawler_operator_strategy_days
SET profit_qualified = realized_profit_usd > 0,
    profit_qualified_at = CASE
      WHEN realized_profit_usd > 0 THEN COALESCE(profit_qualified_at, updated_at, now())
      ELSE NULL
    END
WHERE profit_qualified IS DISTINCT FROM (realized_profit_usd > 0)
   OR (realized_profit_usd > 0 AND profit_qualified_at IS NULL);

-- Preserve already-observed calendar decisions when upgrading an active cycle.
-- Future dates remain dynamically decidable so reserve dates can be promoted.
UPDATE public.cryptocrawler_operator_strategy_days
SET eligibility_decided = true,
    eligibility_source = COALESCE(
      eligibility_source,
      CASE WHEN is_trade_day THEN 'legacy_randomized_attempt_preserved' ELSE 'legacy_learning_day_preserved' END
    ),
    updated_at = now()
WHERE local_date <= (now() AT TIME ZONE 'America/Chicago')::date
  AND eligibility_decided = false;

UPDATE public.cryptocrawler_operator_strategy_days
SET eligibility_source = COALESCE(eligibility_source, 'pending_dynamic_decision')
WHERE eligibility_decided = false;

CREATE OR REPLACE FUNCTION public.cryptocrawler_operator_strategy_record_terminal_pnl(
  p_event_id text,
  p_opportunity_id text,
  p_realized_pnl_usd numeric
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  target_date date;
  inserted_event text;
  next_realized numeric;
BEGIN
  IF p_event_id IS NULL OR length(trim(p_event_id)) = 0 OR p_realized_pnl_usd IS NULL OR p_realized_pnl_usd = 0 THEN
    RETURN false;
  END IF;

  IF p_opportunity_id IS NOT NULL AND length(trim(p_opportunity_id)) > 0 THEN
    SELECT local_date INTO target_date
    FROM public.cryptocrawler_operator_trade_reservations
    WHERE opportunity_id=p_opportunity_id
      AND status IN ('RESERVED','SUBMITTED','TERMINAL')
    LIMIT 1;
  END IF;

  IF target_date IS NULL THEN
    target_date := (now() AT TIME ZONE 'America/Chicago')::date;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.cryptocrawler_operator_strategy_days WHERE local_date=target_date
  ) THEN
    RAISE EXCEPTION 'operator strategy day is missing for terminal P&L date %', target_date;
  END IF;

  INSERT INTO public.cryptocrawler_operator_profit_events
    (event_id, opportunity_id, local_date, realized_profit_usd)
  VALUES (p_event_id, NULLIF(trim(p_opportunity_id), ''), target_date, p_realized_pnl_usd)
  ON CONFLICT (event_id) DO NOTHING
  RETURNING event_id INTO inserted_event;

  IF inserted_event IS NULL THEN
    RETURN false;
  END IF;

  SELECT realized_profit_usd + p_realized_pnl_usd
  INTO next_realized
  FROM public.cryptocrawler_operator_strategy_days
  WHERE local_date=target_date
  FOR UPDATE;

  UPDATE public.cryptocrawler_operator_strategy_days
  SET realized_profit_usd = next_realized,
      profit_qualified = next_realized > 0,
      profit_qualified_at = CASE
        WHEN next_realized > 0 THEN COALESCE(profit_qualified_at, now())
        ELSE NULL
      END,
      updated_at = now()
  WHERE local_date=target_date;

  RETURN true;
END;
$$;

-- Compatibility wrapper for the existing positive-profit treasury path. Because
-- both functions share the same event id table, whichever records first wins and
-- the other becomes an idempotent no-op; positive P&L can never be double-counted.
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
BEGIN
  IF p_profit_usd IS NULL OR p_profit_usd <= 0 THEN
    RETURN false;
  END IF;
  RETURN public.cryptocrawler_operator_strategy_record_terminal_pnl(
    p_event_id,
    p_opportunity_id,
    p_profit_usd
  );
END;
$$;

REVOKE ALL ON FUNCTION public.cryptocrawler_operator_strategy_record_terminal_pnl(text,text,numeric) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cryptocrawler_operator_strategy_record_terminal_pnl(text,text,numeric) TO service_role;
REVOKE ALL ON FUNCTION public.cryptocrawler_operator_strategy_record_profit(text,text,numeric) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cryptocrawler_operator_strategy_record_profit(text,text,numeric) TO service_role;

COMMENT ON COLUMN public.cryptocrawler_operator_strategy_cycles.trade_day_offsets IS
  'Twenty randomized baseline attempt-day offsets. They are preferred attempt dates, not automatically counted profit days; reserve dates may be promoted dynamically.';
COMMENT ON COLUMN public.cryptocrawler_operator_strategy_cycles.profit_day_target IS
  'Target number of terminal-confirmed net-profitable local days inside this fixed 30-calendar-day cycle. Missing the target never forces execution and never invalidates the cycle.';
COMMENT ON COLUMN public.cryptocrawler_operator_strategy_days.eligibility_decided IS
  'True once this local date has been durably classified as trading-eligible or learning-only for the current cycle state.';
COMMENT ON COLUMN public.cryptocrawler_operator_strategy_days.eligibility_source IS
  'Explains whether eligibility came from randomized baseline selection, adaptive reserve promotion, catch-up mode, target completion, or legacy preservation.';
COMMENT ON COLUMN public.cryptocrawler_operator_strategy_days.profit_qualified IS
  'True only while signed terminal-confirmed realized P&L for this local trading date remains above zero; only such days count toward the cycle target.';
COMMENT ON FUNCTION public.cryptocrawler_operator_strategy_record_terminal_pnl(text,text,numeric) IS
  'Idempotently records signed terminal realized P&L against the reservation local date and recomputes whether that day qualifies toward the 20-profit-day target.';
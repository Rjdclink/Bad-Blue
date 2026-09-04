-- Exactly one parent opportunity may be unresolved at a time. This prevents a
-- second trade from being submitted before the first trade's terminal realized
-- profit can update the day's $50-cushioned stop authority.
CREATE UNIQUE INDEX IF NOT EXISTS uq_cryptocrawler_operator_one_active_parent_per_day
  ON public.cryptocrawler_operator_trade_reservations(local_date)
  WHERE status IN ('RESERVED','SUBMITTED');

-- Terminal feedback may be persisted before the scheduler turns the reservation
-- from RESERVED into SUBMITTED. Bind that profit to the reservation's original
-- local trading date so a midnight crossover cannot move profit into another day.
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
      AND status IN ('RESERVED','SUBMITTED','TERMINAL')
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

REVOKE ALL ON FUNCTION public.cryptocrawler_operator_strategy_record_profit(text,text,numeric) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cryptocrawler_operator_strategy_record_profit(text,text,numeric) TO service_role;

COMMENT ON INDEX public.uq_cryptocrawler_operator_one_active_parent_per_day IS
  'Serializes parent trade submission across replicas so terminal realized profit is known before another daily slot may submit.';

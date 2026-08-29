CREATE OR REPLACE FUNCTION public.cryptocrawler_terminal_sweep_truth_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.desired_state = 'SWEEPING' AND OLD.desired_state = 'TERMINATE_AND_SWEEP' THEN
    IF NEW.terminal_epoch IS NULL
       OR NEW.terminal_detection_not_before IS NULL
       OR NEW.terminal_detection_not_before > now()
       OR (NEW.last_seen_active_at IS NOT NULL AND NEW.last_seen_active_at >= NEW.terminal_detection_not_before) THEN
      RAISE EXCEPTION 'terminal sweep cannot start while runtime activity or grace-window evidence remains';
    END IF;
  END IF;

  IF NEW.desired_state = 'SWEPT' AND OLD.desired_state <> 'SWEPT' THEN
    IF NEW.terminal_epoch IS NULL THEN
      RAISE EXCEPTION 'terminal sweep completion requires a terminal epoch';
    END IF;

    IF COALESCE(OLD.retained_profit_usd, 0) > 0
       AND NOT EXISTS (
         SELECT 1
         FROM public.cryptocrawler_terminal_sweep_legs leg
         WHERE leg.terminal_epoch = NEW.terminal_epoch
           AND leg.status = 'CONFIRMED'
           AND COALESCE(leg.amount, 0) > 0
       ) THEN
      NEW.desired_state := 'MANUAL_REVIEW';
      NEW.sweep_completed_at := NULL;
      NEW.last_error := 'Retained profit exists but no confirmed positive-value terminal withdrawal leg; refusing false SWEPT state';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.cryptocrawler_terminal_sweep_truth_guard() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cryptocrawler_terminal_sweep_truth_guard() TO service_role;

DROP TRIGGER IF EXISTS trg_cryptocrawler_terminal_sweep_truth_guard
  ON public.cryptocrawler_terminal_sweep_control;
CREATE TRIGGER trg_cryptocrawler_terminal_sweep_truth_guard
BEFORE UPDATE ON public.cryptocrawler_terminal_sweep_control
FOR EACH ROW
EXECUTE FUNCTION public.cryptocrawler_terminal_sweep_truth_guard();

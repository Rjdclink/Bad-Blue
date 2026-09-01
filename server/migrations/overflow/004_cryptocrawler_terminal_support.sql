-- Safe terminal treasury support for the CryptoCrawler Overflow runtime database.
-- This deliberately contains no pg_cron schedule and no pg_net side effect. The
-- transaction worker/scheduler cutover is a separate authority decision so schema
-- mirroring can never create two independent payout schedulers.

CREATE OR REPLACE FUNCTION public.cryptocrawler_terminal_sweep_secret(p_name text)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = vault, pg_temp
AS $$
  SELECT decrypted_secret
  FROM vault.decrypted_secrets
  WHERE name = p_name
  ORDER BY updated_at DESC
  LIMIT 1
$$;

REVOKE ALL ON FUNCTION public.cryptocrawler_terminal_sweep_secret(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cryptocrawler_terminal_sweep_secret(text) TO service_role;

CREATE OR REPLACE FUNCTION public.cryptocrawler_terminal_sweep_finalize_events(p_epoch uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private, pg_temp
AS $$
DECLARE
  changed integer := 0;
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.cryptocrawler_terminal_sweep_control
    WHERE system_key='cryptocrawler'
      AND terminal_epoch=p_epoch
      AND desired_state='SWEPT'
  ) THEN
    RAISE EXCEPTION 'terminal epoch is not authoritatively swept';
  END IF;

  UPDATE private.cryptocrawler_rainbow_profit_events
  SET status='confirmed',
      batch_id=COALESCE(batch_id, 'terminal:' || p_epoch::text),
      confirmed_at=COALESCE(confirmed_at, now()),
      updated_at=now(),
      last_error=NULL
  WHERE status='queued';
  GET DIAGNOSTICS changed = ROW_COUNT;
  RETURN changed;
END;
$$;

REVOKE ALL ON FUNCTION public.cryptocrawler_terminal_sweep_finalize_events(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cryptocrawler_terminal_sweep_finalize_events(uuid) TO service_role;

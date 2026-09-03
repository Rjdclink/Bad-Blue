-- Safe terminal treasury support for the CryptoCrawler Overflow runtime database.
-- This deliberately contains no pg_cron schedule and no pg_net side effect. The
-- transaction worker/scheduler cutover is a separate authority decision so schema
-- mirroring can never create two independent payout schedulers.
--
-- The payout-aware terminal finalizer is owned by
-- 018_cryptocrawler_profit_split_eth_payout.sql. Do not redefine it here: doing
-- so would overwrite the newer payout/job/retained-capital accounting semantics
-- after they have already been installed on Overflow.

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

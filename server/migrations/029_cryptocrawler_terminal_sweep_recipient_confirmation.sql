ALTER TABLE public.cryptocrawler_terminal_sweep_legs
  ADD COLUMN IF NOT EXISTS recipient_confirmed_destination_hash text,
  ADD COLUMN IF NOT EXISTS recipient_confirmed_amount_eth numeric,
  ADD COLUMN IF NOT EXISTS recipient_confirmed_transaction_hash text,
  ADD COLUMN IF NOT EXISTS recipient_confirmed_block_number text,
  ADD COLUMN IF NOT EXISTS recipient_confirmation_source text,
  ADD COLUMN IF NOT EXISTS recipient_confirmed_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_terminal_sweep_recipient_tx
  ON public.cryptocrawler_terminal_sweep_legs(recipient_confirmed_transaction_hash)
  WHERE recipient_confirmed_transaction_hash IS NOT NULL;

CREATE OR REPLACE FUNCTION public.cryptocrawler_terminal_sweep_leg_confirmation_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.status='CONFIRMED' AND OLD.status<>'CONFIRMED' THEN
    IF NEW.transaction_hash IS NULL OR length(trim(NEW.transaction_hash))=0 THEN
      RAISE EXCEPTION 'terminal sweep leg % cannot confirm without an on-chain transaction hash', NEW.leg_id;
    END IF;
    IF NEW.recipient_confirmed_at IS NULL
       OR NEW.recipient_confirmed_destination_hash IS NULL
       OR NEW.recipient_confirmed_amount_eth IS NULL
       OR NEW.recipient_confirmed_transaction_hash IS NULL
       OR NEW.recipient_confirmed_block_number IS NULL
       OR NEW.recipient_confirmation_source IS NULL THEN
      RAISE EXCEPTION 'terminal sweep leg % lacks recipient-bound finalized Ethereum confirmation', NEW.leg_id;
    END IF;
    IF lower(trim(NEW.recipient_confirmed_transaction_hash)) <> lower(trim(NEW.transaction_hash)) THEN
      RAISE EXCEPTION 'terminal sweep leg % confirmation transaction hash mismatch', NEW.leg_id;
    END IF;
    IF lower(trim(NEW.recipient_confirmed_destination_hash)) <> lower(trim(NEW.destination_hash)) THEN
      RAISE EXCEPTION 'terminal sweep leg % confirmation recipient mismatch', NEW.leg_id;
    END IF;
    IF NEW.amount IS NULL OR NEW.amount <= 0
       OR NEW.recipient_confirmed_amount_eth + 0.000000000001 < NEW.amount THEN
      RAISE EXCEPTION 'terminal sweep leg % confirmed recipient amount is below sweep amount', NEW.leg_id;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_cryptocrawler_terminal_sweep_leg_confirmation_guard
  ON public.cryptocrawler_terminal_sweep_legs;
CREATE TRIGGER trg_cryptocrawler_terminal_sweep_leg_confirmation_guard
BEFORE UPDATE OF status, transaction_hash
ON public.cryptocrawler_terminal_sweep_legs
FOR EACH ROW
EXECUTE FUNCTION public.cryptocrawler_terminal_sweep_leg_confirmation_guard();

REVOKE ALL ON FUNCTION public.cryptocrawler_terminal_sweep_leg_confirmation_guard() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cryptocrawler_terminal_sweep_leg_confirmation_guard() TO service_role;

COMMENT ON COLUMN public.cryptocrawler_terminal_sweep_legs.recipient_confirmed_destination_hash IS
  'SHA-256 prefix of the exact restart-drain recipient independently verified against OKX withdrawal history and a finalized Ethereum transaction.';
COMMENT ON COLUMN public.cryptocrawler_terminal_sweep_legs.recipient_confirmed_amount_eth IS
  'ETH amount independently verified at the intended recipient before the terminal sweep leg may become CONFIRMED.';
COMMENT ON COLUMN public.cryptocrawler_terminal_sweep_legs.recipient_confirmation_source IS
  'Proof source. Production confirmation requires OKX withdrawal-history recipient/amount agreement plus finalized Ethereum JSON-RPC transaction evidence.';
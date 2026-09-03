CREATE OR REPLACE FUNCTION public.cryptocrawler_profit_payout_confirmation_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.status='CONFIRMED' AND OLD.status<>'CONFIRMED' THEN
    IF NEW.transaction_hash IS NULL OR length(trim(NEW.transaction_hash))=0 THEN
      RAISE EXCEPTION 'payout batch % cannot confirm without an on-chain transaction hash', NEW.batch_id;
    END IF;
    IF NEW.recipient_confirmed_at IS NULL
       OR NEW.recipient_confirmed_destination_hash IS NULL
       OR NEW.recipient_confirmed_amount_eth IS NULL
       OR NEW.recipient_confirmed_transaction_hash IS NULL
       OR NEW.recipient_confirmed_block_number IS NULL
       OR NEW.recipient_confirmation_source IS NULL THEN
      RAISE EXCEPTION 'payout batch % lacks recipient-bound finalized Ethereum confirmation', NEW.batch_id;
    END IF;
    IF lower(trim(NEW.recipient_confirmed_transaction_hash)) <> lower(trim(NEW.transaction_hash)) THEN
      RAISE EXCEPTION 'payout batch % confirmation transaction hash mismatch', NEW.batch_id;
    END IF;
    IF lower(trim(NEW.recipient_confirmed_destination_hash)) <> lower(trim(NEW.destination_hash)) THEN
      RAISE EXCEPTION 'payout batch % confirmation recipient mismatch', NEW.batch_id;
    END IF;
    IF NEW.payout_amount_eth IS NULL OR NEW.payout_amount_eth <= 0
       OR NEW.recipient_confirmed_amount_eth + 0.000000000001 < NEW.payout_amount_eth THEN
      RAISE EXCEPTION 'payout batch % confirmed recipient amount is below payout target', NEW.batch_id;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_cryptocrawler_profit_payout_confirmation_guard
  ON public.cryptocrawler_profit_payout_batches;
CREATE TRIGGER trg_cryptocrawler_profit_payout_confirmation_guard
BEFORE UPDATE OF status, transaction_hash
ON public.cryptocrawler_profit_payout_batches
FOR EACH ROW
EXECUTE FUNCTION public.cryptocrawler_profit_payout_confirmation_guard();

REVOKE ALL ON FUNCTION public.cryptocrawler_profit_payout_confirmation_guard() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cryptocrawler_profit_payout_confirmation_guard() TO service_role;

COMMENT ON FUNCTION public.cryptocrawler_profit_payout_confirmation_guard() IS
  'Database truth guard: no payout batch may become CONFIRMED unless its transaction, intended recipient, amount, and finalized Ethereum receipt have already been independently proven.';
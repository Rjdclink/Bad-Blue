-- Recipient confirmation is asynchronous: OKX can report a completed withdrawal
-- before the independent finalized-Ethereum observer has persisted its proof.
-- Keep that state SUBMITTED instead of throwing a noisy guard error. Any hard
-- mismatch remains fail-closed, and only the canonical proof source can confirm.

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
      NEW.status := 'SUBMITTED';
      NEW.confirmed_at := NULL;
      NEW.last_error := 'Awaiting recipient-bound finalized Ethereum confirmation';
      RETURN NEW;
    END IF;

    IF NEW.recipient_confirmation_source <> 'okx_withdrawal_history+ethereum_finalized_rpc' THEN
      RAISE EXCEPTION 'terminal sweep leg % has non-authoritative recipient confirmation source', NEW.leg_id;
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
    IF NEW.recipient_confirmation_source <> 'okx_withdrawal_history+ethereum_finalized_rpc' THEN
      RAISE EXCEPTION 'payout batch % has non-authoritative recipient confirmation source', NEW.batch_id;
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

COMMENT ON FUNCTION public.cryptocrawler_terminal_sweep_leg_confirmation_guard() IS
  'Fail-closed recipient truth guard. A completed OKX terminal withdrawal remains SUBMITTED while finalized Ethereum recipient proof is pending; only canonical recipient proof can promote it to CONFIRMED.';
COMMENT ON FUNCTION public.cryptocrawler_profit_payout_confirmation_guard() IS
  'Database truth guard: no payout batch may become CONFIRMED unless its transaction, intended recipient, amount, and finalized Ethereum receipt have already been independently proven by the canonical observer.';

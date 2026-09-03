ALTER TABLE public.cryptocrawler_profit_payout_batches
  ADD COLUMN IF NOT EXISTS recipient_confirmed_destination_hash text,
  ADD COLUMN IF NOT EXISTS recipient_confirmed_amount_eth numeric,
  ADD COLUMN IF NOT EXISTS recipient_confirmed_transaction_hash text,
  ADD COLUMN IF NOT EXISTS recipient_confirmed_block_number text,
  ADD COLUMN IF NOT EXISTS recipient_confirmation_source text,
  ADD COLUMN IF NOT EXISTS recipient_confirmed_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_cryptocrawler_payout_recipient_tx
  ON public.cryptocrawler_profit_payout_batches(recipient_confirmed_transaction_hash)
  WHERE recipient_confirmed_transaction_hash IS NOT NULL;

-- A payout is not money-delivered merely because the venue reports a completed
-- withdrawal. Confirmation is permitted only after the worker has independently
-- bound the same transaction hash to the expected Ethereum recipient and amount
-- and has observed the transaction in an Ethereum finalized block.
CREATE OR REPLACE FUNCTION public.cryptocrawler_profit_payout_batch_confirm(
  p_batch_id text,
  p_withdrawal_id text,
  p_transaction_hash text
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private, pg_temp
AS $$
DECLARE
  batch_row public.cryptocrawler_profit_payout_batches%ROWTYPE;
  allocation_row record;
  job_row public.cryptocrawler_profit_payout_jobs%ROWTYPE;
  next_paid_usd numeric;
  next_paid_eth numeric;
  cost_share numeric;
  fee_share numeric;
  changed integer := 0;
BEGIN
  IF p_transaction_hash IS NULL OR length(trim(p_transaction_hash)) = 0 THEN
    RAISE EXCEPTION 'confirmed payout batch requires an on-chain transaction hash';
  END IF;

  SELECT * INTO batch_row
  FROM public.cryptocrawler_profit_payout_batches
  WHERE batch_id=p_batch_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'payout batch not found: %', p_batch_id;
  END IF;
  IF batch_row.status='CONFIRMED' THEN
    RETURN 0;
  END IF;
  IF batch_row.status <> 'SUBMITTED' THEN
    RAISE EXCEPTION 'payout batch % is not submitted', p_batch_id;
  END IF;

  IF batch_row.recipient_confirmed_at IS NULL
     OR batch_row.recipient_confirmed_destination_hash IS NULL
     OR batch_row.recipient_confirmed_amount_eth IS NULL
     OR batch_row.recipient_confirmed_transaction_hash IS NULL
     OR batch_row.recipient_confirmed_block_number IS NULL
     OR batch_row.recipient_confirmation_source IS NULL THEN
    RAISE EXCEPTION 'payout batch % lacks recipient-bound finalized Ethereum confirmation', p_batch_id;
  END IF;

  IF lower(trim(batch_row.recipient_confirmed_transaction_hash)) <> lower(trim(p_transaction_hash)) THEN
    RAISE EXCEPTION 'payout batch % confirmation transaction hash mismatch', p_batch_id;
  END IF;
  IF lower(trim(batch_row.recipient_confirmed_destination_hash)) <> lower(trim(batch_row.destination_hash)) THEN
    RAISE EXCEPTION 'payout batch % confirmation recipient mismatch', p_batch_id;
  END IF;
  IF batch_row.recipient_confirmed_amount_eth + 0.000000000001 < batch_row.payout_amount_eth THEN
    RAISE EXCEPTION 'payout batch % confirmed recipient amount is below payout target', p_batch_id;
  END IF;

  UPDATE public.cryptocrawler_profit_payout_batches
  SET status='CONFIRMED',
      withdrawal_id=COALESCE(NULLIF(p_withdrawal_id,''), withdrawal_id),
      transaction_hash=p_transaction_hash,
      confirmed_at=COALESCE(confirmed_at, recipient_confirmed_at, now()),
      last_error=NULL,
      updated_at=now()
  WHERE batch_id=p_batch_id;

  FOR allocation_row IN
    SELECT *
    FROM public.cryptocrawler_profit_payout_batch_allocations
    WHERE batch_id=p_batch_id
    ORDER BY event_id
  LOOP
    SELECT * INTO job_row
    FROM public.cryptocrawler_profit_payout_jobs
    WHERE event_id=allocation_row.event_id
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'payout job missing for batch allocation: %', allocation_row.event_id;
    END IF;

    next_paid_usd := least(job_row.payout_target_usd, job_row.payout_paid_usd + allocation_row.allocated_usd);
    next_paid_eth := job_row.payout_paid_eth + allocation_row.allocated_eth;
    cost_share := CASE
      WHEN batch_row.target_usd > 0 THEN batch_row.operating_cost_usd * allocation_row.allocated_usd / batch_row.target_usd
      ELSE 0
    END;
    fee_share := CASE
      WHEN batch_row.target_usd > 0 THEN batch_row.payout_fee_eth * allocation_row.allocated_usd / batch_row.target_usd
      ELSE 0
    END;

    UPDATE public.cryptocrawler_profit_payout_jobs
    SET payout_paid_usd=next_paid_usd,
        payout_paid_eth=next_paid_eth,
        payout_transactions=COALESCE(payout_transactions, '[]'::jsonb) || jsonb_build_array(jsonb_build_object(
          'batchId', p_batch_id,
          'allocatedUsd', allocation_row.allocated_usd,
          'allocatedEth', allocation_row.allocated_eth,
          'withdrawalId', COALESCE(NULLIF(p_withdrawal_id,''), batch_row.withdrawal_id),
          'transactionHash', p_transaction_hash,
          'destinationHash', batch_row.recipient_confirmed_destination_hash,
          'recipientConfirmedAmountEth', batch_row.recipient_confirmed_amount_eth,
          'confirmationSource', batch_row.recipient_confirmation_source,
          'confirmationBlockNumber', batch_row.recipient_confirmed_block_number,
          'recipientConfirmedAt', batch_row.recipient_confirmed_at,
          'confirmedAt', now()
        )),
        payout_fee_eth=COALESCE(payout_fee_eth,0) + fee_share,
        payout_operating_cost_usd=COALESCE(payout_operating_cost_usd,0) + cost_share,
        withdrawal_id=COALESCE(NULLIF(p_withdrawal_id,''), batch_row.withdrawal_id, withdrawal_id),
        transaction_hash=p_transaction_hash,
        status=CASE
          WHEN next_paid_usd + 0.000001 >= payout_target_usd THEN 'CONFIRMED'
          ELSE 'QUEUED'
        END,
        confirmed_at=CASE
          WHEN next_paid_usd + 0.000001 >= payout_target_usd THEN COALESCE(confirmed_at, batch_row.recipient_confirmed_at, now())
          ELSE confirmed_at
        END,
        last_error=NULL,
        updated_at=now()
    WHERE event_id=allocation_row.event_id;

    UPDATE public.cryptocrawler_payout_asset_reservations
    SET remaining_asset_amount=greatest(0, remaining_asset_amount - allocation_row.allocated_usd),
        status=CASE
          WHEN greatest(0, remaining_asset_amount - allocation_row.allocated_usd) <= 0.000001 THEN 'RELEASED'
          ELSE 'HELD'
        END,
        updated_at=now()
    WHERE event_id=allocation_row.event_id;

    changed := changed + 1;
  END LOOP;

  RETURN changed;
END;
$$;

REVOKE ALL ON FUNCTION public.cryptocrawler_profit_payout_batch_confirm(text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cryptocrawler_profit_payout_batch_confirm(text, text, text) TO service_role;

COMMENT ON COLUMN public.cryptocrawler_profit_payout_batches.recipient_confirmed_destination_hash IS
  'SHA-256 prefix of the exact payout recipient independently verified against the successful OKX withdrawal and finalized Ethereum transaction.';
COMMENT ON COLUMN public.cryptocrawler_profit_payout_batches.recipient_confirmed_amount_eth IS
  'ETH amount independently verified at the intended recipient before the payout may become CONFIRMED.';
COMMENT ON COLUMN public.cryptocrawler_profit_payout_batches.recipient_confirmation_source IS
  'Proof source. Current production authority requires OKX withdrawal-history recipient/amount agreement plus finalized Ethereum JSON-RPC transaction evidence.';
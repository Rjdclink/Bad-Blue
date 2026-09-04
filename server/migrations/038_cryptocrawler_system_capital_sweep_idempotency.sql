-- Cross-replica idempotency for normal-runtime threshold sweeps.
CREATE UNIQUE INDEX IF NOT EXISTS uq_cryptocrawler_one_active_sweep_conversion_per_batch
  ON public.cryptocrawler_system_capital_sweep_conversions(batch_id)
  WHERE status IN ('PREPARED','SUBMITTED','SETTLING','RETRYABLE');

CREATE UNIQUE INDEX IF NOT EXISTS uq_cryptocrawler_one_wallet_transfer_per_sweep_batch
  ON public.cryptocrawler_system_capital_transfers(sweep_batch_id)
  WHERE transfer_kind='CAPITAL_SWEEP'
    AND target_kind='wallet'
    AND sweep_batch_id IS NOT NULL;

COMMENT ON INDEX public.uq_cryptocrawler_one_active_sweep_conversion_per_batch IS
  'Exactly one crash-recoverable FOK treasury conversion may be unresolved for a threshold sweep across all replicas.';
COMMENT ON INDEX public.uq_cryptocrawler_one_wallet_transfer_per_sweep_batch IS
  'A threshold sweep may create exactly one final wallet withdrawal intent; retries reconcile that intent instead of creating another withdrawal.';

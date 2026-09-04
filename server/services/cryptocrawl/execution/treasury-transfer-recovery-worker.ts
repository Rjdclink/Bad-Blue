import logger from '../../../logger.js';
import { isDatabaseConfigured, pool } from '../runtime/cryptocrawl-runtime-database.js';

const INTERVAL_MS = Math.max(15_000, Math.min(120_000, Number(process.env.CRYPTOCRAWL_TREASURY_TRANSFER_RECOVERY_INTERVAL_MS || 30_000)));
const STALE_SECONDS = Math.max(60, Math.min(6 * 60 * 60, Number(process.env.CRYPTOCRAWL_TREASURY_TRANSFER_RECOVERY_STALE_SECONDS || 120)));

let timer: NodeJS.Timeout | null = null;
let inFlight: Promise<void> | null = null;

function liveExecutionPosture(): boolean {
  return process.env.NO_EXECUTION !== 'true'
    && process.env.CRYPTO_ARBITRAGE_LIVE_EXECUTION === 'true'
    && process.env.CRYPTO_ARBITRAGE_LIVE_CONFIRMATION === 'I_ACCEPT_LIVE_ORDER_RISK';
}

async function recoverOnce(): Promise<void> {
  if (!isDatabaseConfigured || !liveExecutionPosture()) return;

  const retained = await pool.query(
    `UPDATE public.cryptocrawler_retained_exchange_allocations
     SET status='RETRYABLE',
         last_error=COALESCE(last_error,'stale treasury transfer attempt recovered after restart; exchange recovery must run before any resubmission'),
         updated_at=now()
     WHERE status IN ('SUBMITTED','SETTLING')
       AND last_attempt_at IS NOT NULL
       AND last_attempt_at <= now() - make_interval(secs => $1)
     RETURNING event_id`,
    [STALE_SECONDS],
  );

  const payout = await pool.query(
    `UPDATE public.cryptocrawler_payout_funding_transfers
     SET status='RETRYABLE',
         last_error=COALESCE(last_error,'stale payout-funding attempt recovered after restart; Kraken withdrawal recovery must run before any resubmission'),
         updated_at=now()
     WHERE status IN ('SUBMITTED','SETTLING')
       AND last_attempt_at IS NOT NULL
       AND last_attempt_at <= now() - make_interval(secs => $1)
     RETURNING event_id`,
    [STALE_SECONDS],
  );

  if (retained.rowCount || payout.rowCount) {
    logger.warn('[TreasuryTransferRecovery] Stale transfer attempts returned to recovery queue', {
      component: 'TreasuryTransferRecoveryWorker',
      retainedRecovered: retained.rowCount || 0,
      payoutFundingRecovered: payout.rowCount || 0,
      staleSeconds: STALE_SECONDS,
      exchangeRecoveryBeforeResubmitRequired: true,
      duplicateSubmissionAuthorityGranted: false,
    });
  }
}

export async function runTreasuryTransferRecoveryOnce(): Promise<void> {
  if (inFlight) return inFlight;
  inFlight = recoverOnce().finally(() => { inFlight = null; });
  return inFlight;
}

export function ensureTreasuryTransferRecoveryWorker(): void {
  if (timer || process.env.NO_INTERVALS === 'true') return;
  timer = setInterval(() => void runTreasuryTransferRecoveryOnce().catch(error => {
    logger.warn('[TreasuryTransferRecovery] Recovery pass deferred', {
      component: 'TreasuryTransferRecoveryWorker',
      error: error instanceof Error ? error.message : String(error),
      moneyMovingAuthority: false,
    });
  }), INTERVAL_MS);
  timer.unref?.();
  void runTreasuryTransferRecoveryOnce().catch(() => undefined);
}

export function stopTreasuryTransferRecoveryWorker(): void {
  if (timer) clearInterval(timer);
  timer = null;
}

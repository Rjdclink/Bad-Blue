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

  // Retained routing has two durable state surfaces: the allocation row and the
  // provenance-backed transfer intent. Move both back to RETRYABLE together.
  // RETRYABLE remains an active reservation state, so a possibly-submitted
  // withdrawal never becomes spendable while the exchange recovery path runs.
  const retained = await pool.query(
    `WITH recovered_transfers AS (
       UPDATE public.cryptocrawler_system_capital_transfers t
       SET status='RETRYABLE',
           last_error=COALESCE(t.last_error,'stale retained transfer recovered after restart; exchange recovery must run before any resubmission'),
           updated_at=now()
       FROM public.cryptocrawler_retained_exchange_allocations r
       WHERE t.transfer_id=r.transfer_id
         AND t.transfer_kind='RETAINED_ROUTE'
         AND t.status IN ('SUBMITTED','SETTLING')
         AND r.status IN ('SUBMITTED','SETTLING')
         AND r.last_attempt_at IS NOT NULL
         AND r.last_attempt_at <= now() - make_interval(secs => $1)
       RETURNING t.transfer_id, t.source_event_id
     )
     UPDATE public.cryptocrawler_retained_exchange_allocations r
     SET status='RETRYABLE',
         last_error=COALESCE(r.last_error,'stale retained transfer attempt recovered after restart; exchange recovery must run before any resubmission'),
         updated_at=now()
     FROM recovered_transfers recovered
     WHERE r.event_id=recovered.source_event_id
     RETURNING r.event_id`,
    [STALE_SECONDS],
  );

  // Payout funding is also represented on two durable surfaces. Recover them as
  // one state transition. The system-capital reservation remains held because
  // RETRYABLE with submitted_at is recovery-only under migration 044.
  const payout = await pool.query(
    `WITH stale_funding AS (
       SELECT f.event_id, f.transfer_id
       FROM public.cryptocrawler_payout_funding_transfers f
       WHERE f.status IN ('SUBMITTED','SETTLING')
         AND f.last_attempt_at IS NOT NULL
         AND f.last_attempt_at <= now() - make_interval(secs => $1)
       FOR UPDATE
     ), recovered_system AS (
       UPDATE public.cryptocrawler_system_capital_transfers t
       SET status='RETRYABLE',
           last_error=COALESCE(t.last_error,'stale payout-funding transfer recovered after restart; provider reconciliation must run before any resubmission'),
           updated_at=now()
       FROM stale_funding s
       WHERE t.transfer_id=s.transfer_id
         AND t.transfer_kind='PAYOUT_FUNDING'
         AND t.status IN ('SUBMITTED','SETTLING')
       RETURNING t.transfer_id
     )
     UPDATE public.cryptocrawler_payout_funding_transfers f
     SET status='RETRYABLE',
         last_error=COALESCE(f.last_error,'stale payout-funding attempt recovered after restart; provider reconciliation must run before any resubmission'),
         updated_at=now()
     FROM stale_funding s
     WHERE f.event_id=s.event_id
       AND f.status IN ('SUBMITTED','SETTLING')
     RETURNING f.event_id`,
    [STALE_SECONDS],
  );

  if (retained.rowCount || payout.rowCount) {
    logger.warn('[TreasuryTransferRecovery] Stale transfer attempts returned to recovery queue', {
      component: 'TreasuryTransferRecoveryWorker',
      retainedRecovered: retained.rowCount || 0,
      payoutFundingRecovered: payout.rowCount || 0,
      staleSeconds: STALE_SECONDS,
      exchangeRecoveryBeforeResubmitRequired: true,
      retainedTransferReservationRemainsActive: true,
      payoutTransferReservationRemainsActive: true,
      pairedRecoveryStateAuthority: true,
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

import logger from '../../../logger.js';
import { isDatabaseConfigured, pool } from '../runtime/cryptocrawl-runtime-database.js';
import { replayControlledLossLearningFeedbackOnce } from './controlled-loss-feedback-recovery.js';
import { runControlledLossLearningOnce } from './controlled-loss-learning-worker.js';

const WORKER_INTERVAL_MS = Math.max(
  5_000,
  Math.min(60_000, Number(process.env.CRYPTOCRAWL_CONTROLLED_LOSS_INTERVAL_MS || 10_000)),
);

let timer: NodeJS.Timeout | null = null;
let inFlight: Promise<void> | null = null;

async function recoverDurableState(): Promise<void> {
  if (!isDatabaseConfigured) return;

  // A process can die after the deterministic exit order id was persisted but
  // before its exact settlement was applied to the system-owned lot ledger.
  // Route that state back through processExit: it recovers the existing order by
  // order/client id and may not resubmit a duplicate.
  const recovered = await pool.query(
    `UPDATE public.cryptocrawler_controlled_loss_learning_events
     SET status='ENTRY_TERMINAL', retry_not_before=NULL,
         last_error='Recovered unresolved exit submission; authenticated settlement must be applied before finalization',
         updated_at=now()
     WHERE status='EXIT_SUBMITTED'
       AND entry_applied=true
       AND exit_applied=false
     RETURNING event_id::text`,
  );

  // Nonterminal prior-day rows cannot legitimately execute on a later trading
  // day. Close them as missed rather than leaving stale execution intent alive.
  const missed = await pool.query(
    `UPDATE public.cryptocrawler_controlled_loss_learning_events
     SET status='MISSED', completed_at=now(),
         last_error='Trading day ended before a safely terminal controlled-loss round-trip could be completed',
         updated_at=now()
     WHERE local_date < (now() AT TIME ZONE 'America/Chicago')::date
       AND status NOT IN ('TERMINAL_LOSS','TERMINAL_NONLOSS','BLOCKED','MANUAL_REVIEW','MISSED')
     RETURNING event_id::text`,
  );

  if (recovered.rowCount || missed.rowCount) {
    logger.warn('[ControlledLossLearning] Durable recovery normalized incomplete learning state', {
      component: 'ControlledLossLearningRuntime',
      recoveredExitSubmissions: recovered.rowCount || 0,
      expiredTradingDayEvents: missed.rowCount || 0,
      duplicateSubmissionAuthorityGranted: false,
      terminalSettlementBypassGranted: false,
    });
  }
}

export async function runControlledLossLearningRuntimeOnce(): Promise<void> {
  if (inFlight) return inFlight;
  inFlight = (async () => {
    await recoverDurableState();
    // Catch a prior crash after terminal DB confirmation but before Cryptara
    // feedback completed. Canonical terminal-feedback identity deduplicates a
    // replay if the prior call actually succeeded.
    await replayControlledLossLearningFeedbackOnce();
    await runControlledLossLearningOnce();
    // Close the normal path immediately; newly terminal rows receive the durable
    // feedback marker without waiting for the next interval.
    await replayControlledLossLearningFeedbackOnce();
  })().finally(() => { inFlight = null; });
  return inFlight;
}

export function ensureControlledLossLearningWorker(): void {
  if (timer || process.env.NO_INTERVALS === 'true' || process.env.ALLOW_INTERVALS !== 'true') return;
  timer = setInterval(() => { void runControlledLossLearningRuntimeOnce(); }, WORKER_INTERVAL_MS);
  timer.unref?.();
  void runControlledLossLearningRuntimeOnce();
  logger.info('[ControlledLossLearning] Recovery-gated controlled-loss runtime online', {
    component: 'ControlledLossLearningRuntime',
    recoveryBeforeEveryPass: true,
    feedbackReplayBeforeAndAfterEveryPass: true,
    deterministicOrderRecovery: true,
    exactSettlementRequiredBeforeFinalization: true,
    terminalFeedbackIdempotent: true,
  });
}

export function stopControlledLossLearningWorker(): void {
  if (timer) clearInterval(timer);
  timer = null;
}

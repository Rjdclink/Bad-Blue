import logger from '../../../logger.js';
import type { CryptaraExecutionFeedback } from '../../cryptara/index.js';
import { ensureRainbowMakerFuelReserve, stopRainbowMakerFuelReserve } from '../compensation/rainbow-maker-fuel-reserve.js';
import { retainedProfitLedger } from '../compensation/retained-profit-ledger.js';
import { rainbowProfitObservability } from '../compensation/rainbow-profit-observability.js';
import { rainbowProfitSourceLedger } from '../compensation/rainbow-profit-source-ledger.js';
import { stageManager } from '../governance/stage-management.js';

let installed = false;
let listener: (() => void) | null = null;

function latestTerminalFeedback(): CryptaraExecutionFeedback | null {
  const evidence = stageManager.getState().cryptaraExecutionEvidence;
  const latest = evidence[evidence.length - 1];
  if (!latest?.settlement || latest.settlement.terminal !== true) return null;
  return latest as unknown as CryptaraExecutionFeedback;
}

async function capture(feedback: CryptaraExecutionFeedback): Promise<void> {
  try {
    await Promise.all([
      retainedProfitLedger.recordTerminalSettlement(feedback),
      rainbowProfitSourceLedger.recordTerminalSettlement(feedback),
    ]);
    void rainbowProfitObservability.refresh();
  } catch (error) {
    // Treasury persistence is downstream of settlement. A persistence failure
    // must never rewrite or invalidate a correctly settled trade.
    logger.warn('[Treasury] Realized-profit capture deferred', {
      component: 'RainbowProfitBridgeWiring',
      opportunityId: feedback.opportunityId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export function ensureRainbowProfitBridgeWiring(): void {
  if (installed) return;
  installed = true;

  // Retain realized profit inside trading inventory during normal operation.
  // The independent Supabase terminal sweeper is the only component allowed to
  // convert retained capital into an external wallet withdrawal.
  ensureRainbowMakerFuelReserve();
  rainbowProfitObservability.start();

  // Reconcile persisted terminal evidence after a restart. Both ledgers are
  // event-idempotent, so replay cannot create duplicate retained-profit credit.
  for (const evidence of stageManager.getState().cryptaraExecutionEvidence) {
    if (evidence.settlement?.terminal === true) {
      void capture(evidence as unknown as CryptaraExecutionFeedback);
    }
  }

  listener = () => {
    const feedback = latestTerminalFeedback();
    if (feedback) void capture(feedback);
  };
  stageManager.on('execution-evidence-recorded', listener);

  logger.info('[Treasury] Realized-profit retention wiring installed', {
    component: 'RainbowProfitBridgeWiring',
    sourceAuthority: 'terminal_confirmed_settlement_only',
    persistentIdempotency: true,
    sourceAwareLedger: 'venue_chain_symbol_asset_execution_source',
    normalRuntimePayouts: false,
    terminalSweepAuthority: 'independent_supabase_worker_only',
    payoutDestination: 'CRYPTO_PROFIT_WALLET_ADDRESS',
    tradingInventoryReservePreserved: true,
    restartBehavior: 'recover_and_continue_without_sweep',
  });
}

export function stopRainbowProfitBridgeWiring(): void {
  if (!installed) return;
  if (listener) stageManager.off('execution-evidence-recorded', listener);
  listener = null;
  installed = false;
  rainbowProfitObservability.stop();
  stopRainbowMakerFuelReserve();
}

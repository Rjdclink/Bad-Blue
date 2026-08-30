import logger from '../../../logger.js';
import type { CryptaraExecutionFeedback } from '../../cryptara/index.js';
import { ensureRainbowMakerFuelReserve, stopRainbowMakerFuelReserve } from '../compensation/rainbow-maker-fuel-reserve.js';
import { retainedProfitLedger } from '../compensation/retained-profit-ledger.js';
import { rainbowProfitBridge } from '../compensation/rainbow-profit-bridge.js';
import { rainbowProfitObservability } from '../compensation/rainbow-profit-observability.js';
import { rainbowProfitSourceLedger } from '../compensation/rainbow-profit-source-ledger.js';
import { stageManager } from '../governance/stage-management.js';
import { ensureTerminalTreasuryLifecycle, stopTerminalTreasuryLifecycle } from './terminal-treasury-lifecycle.js';

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
    // The allocation transaction is the payout source of truth. Source metadata
    // is secondary observability and must never prevent a durable payout job from
    // being woken after it was successfully created.
    const allocation = await retainedProfitLedger.recordTerminalSettlement(feedback);
    try {
      await rainbowProfitSourceLedger.recordTerminalSettlement(feedback);
    } catch (error) {
      logger.warn('[Treasury] Profit source metadata persistence deferred', {
        component: 'RainbowProfitBridgeWiring',
        opportunityId: feedback.opportunityId,
        error: error instanceof Error ? error.message : String(error),
      });
    }

    if (allocation?.recorded) {
      logger.info('[Treasury] Terminal profit split allocated', {
        component: 'RainbowProfitBridgeWiring',
        eventId: allocation.eventId,
        realizedProfitUsd: allocation.realizedProfitUsd,
        payoutTargetUsd: allocation.payoutTargetUsd,
        retainedTargetUsd: allocation.retainedTargetUsd,
        payoutFraction: 0.60,
        retainedFraction: 0.40,
        payoutAsset: 'ETH',
        payoutNetwork: 'ethereum',
        retainedCapitalInventoryReserved: false,
      });
      void rainbowProfitBridge.wake('terminal_profit_recorded');
    }
    void rainbowProfitObservability.refresh();
  } catch (error) {
    logger.warn('[Treasury] Realized-profit allocation deferred', {
      component: 'RainbowProfitBridgeWiring',
      opportunityId: feedback.opportunityId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export function ensureRainbowProfitBridgeWiring(): void {
  if (installed) return;
  installed = true;

  ensureRainbowMakerFuelReserve();
  rainbowProfitObservability.start();
  void ensureTerminalTreasuryLifecycle().catch(error => {
    logger.warn('[Treasury] Persistent lifecycle unavailable; treasury actions remain fail-closed', {
      component: 'RainbowProfitBridgeWiring',
      error: error instanceof Error ? error.message : String(error),
    });
  });

  // Replay remains safe because terminalFeedbackIdentity plus the database
  // primary key makes allocation exactly-once. A pre-existing job is not paid a
  // second time; the independent cron worker handles any durable backlog.
  for (const evidence of stageManager.getState().cryptaraExecutionEvidence) {
    if (evidence.settlement?.terminal === true) {
      void capture(evidence as unknown as CryptaraExecutionFeedback);
    }
  }
  void rainbowProfitBridge.wake('startup_reconcile');

  listener = () => {
    const feedback = latestTerminalFeedback();
    if (feedback) void capture(feedback);
  };
  stageManager.on('execution-evidence-recorded', listener);

  logger.info('[Treasury] Per-trade 60/40 Rainbow wiring installed', {
    component: 'RainbowProfitBridgeWiring',
    sourceAuthority: 'terminal_confirmed_settlement_only',
    persistentIdempotency: true,
    sourceAwareLedger: 'venue_chain_symbol_asset_execution_source',
    normalRuntimePayouts: true,
    allocationPolicy: '60_percent_eth_payout_40_percent_operating_capital',
    payoutAuthority: 'single_independent_supabase_worker',
    immediateWakePlusCronFallback: true,
    payoutDestination: 'CRYPTO_PROFIT_WALLET_ADDRESS',
    payoutAsset: 'ETH',
    payoutNetwork: 'ethereum_mainnet_only',
    retainedTradingCapitalSpendabilityAuthority: 'canonical_inventory_ledger',
    retainedCapitalInventoryReserved: false,
  });
}

export function stopRainbowProfitBridgeWiring(): void {
  if (!installed) return;
  if (listener) stageManager.off('execution-evidence-recorded', listener);
  listener = null;
  installed = false;
  stopTerminalTreasuryLifecycle();
  rainbowProfitObservability.stop();
  stopRainbowMakerFuelReserve();
}
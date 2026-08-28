import logger from '../../../logger.js';
import type { CryptaraExecutionFeedback } from '../../cryptara/index.js';
import { ensureRainbowMakerFuelReserve, stopRainbowMakerFuelReserve } from '../compensation/rainbow-maker-fuel-reserve.js';
import { rainbowProfitBridge } from '../compensation/rainbow-profit-bridge.js';
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
      rainbowProfitBridge.recordTerminalSettlement(feedback),
      rainbowProfitSourceLedger.recordTerminalSettlement(feedback),
    ]);
    void rainbowProfitObservability.refresh();
  } catch (error) {
    // Payout persistence/venue egress is downstream of settlement. A payout
    // failure must never rewrite or invalidate a correctly settled trade.
    logger.warn('[RainbowBridge] Realized-profit capture deferred', {
      component: 'RainbowProfitBridgeWiring',
      opportunityId: feedback.opportunityId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export function ensureRainbowProfitBridgeWiring(): void {
  if (installed) return;
  installed = true;

  // Maker fuel belongs to exchange inventory, not the external payout wallet.
  // Install its dynamic reserve before the payout loop begins so Rainbow only
  // sweeps capital above the currently proven maker-canary envelope.
  ensureRainbowMakerFuelReserve();
  rainbowProfitBridge.start();
  rainbowProfitObservability.start();

  // Reconcile persisted terminal evidence after a restart. Both ledgers are
  // event-idempotent, so replay cannot create duplicate payout authority.
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

  logger.info('[RainbowBridge] Realized-profit wiring installed', {
    component: 'RainbowProfitBridgeWiring',
    sourceAuthority: 'terminal_confirmed_settlement_only',
    persistentIdempotency: true,
    sourceAwareLedger: 'venue_chain_symbol_asset_execution_source',
    payoutDestination: 'CRYPTO_PROFIT_WALLET_ADDRESS',
    preferredAssets: 'USDT/USDC dynamic',
    routeSelection: 'lowest_fee_supported_evm_network',
    tradingInventoryReservePreserved: true,
    makerFuelReserve: 'dynamic_canary_proof_ladder_before_wallet_sweep',
    lifecycleObservability: 'queued_submitted_confirmed_fee_tx_proof',
  });
}

export function stopRainbowProfitBridgeWiring(): void {
  if (!installed) return;
  if (listener) stageManager.off('execution-evidence-recorded', listener);
  listener = null;
  installed = false;
  rainbowProfitObservability.stop();
  rainbowProfitBridge.stop();
  stopRainbowMakerFuelReserve();
}

import logger from '../../../logger.js';
import type { CryptaraExecutionFeedback } from '../../cryptara/index.js';
import { getCryptaraVenueSpecializationLearning } from '../../cryptara/venue-specialization-learning.js';
import { payoutRecipientConfirmationObserver } from '../compensation/payout-recipient-confirmation-observer.js';
import { ensureRainbowMakerFuelReserve, stopRainbowMakerFuelReserve } from '../compensation/rainbow-maker-fuel-reserve.js';
import { retainedProfitLedger } from '../compensation/retained-profit-ledger.js';
import { rainbowProfitBridge } from '../compensation/rainbow-profit-bridge.js';
import { rainbowProfitObservability } from '../compensation/rainbow-profit-observability.js';
import { rainbowProfitSourceLedger } from '../compensation/rainbow-profit-source-ledger.js';
import { stageManager } from '../governance/stage-management.js';
import { getRainbowCapitalDestinationAdvisory } from '../optimization/rainbow-capital-destination-advisory.js';
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
    // Venue specialization learns only from the same terminal-confirmed execution
    // truth used by treasury capture. It is advisory and cannot authorize a trade,
    // move capital, or modify canonical realized economics.
    getCryptaraVenueSpecializationLearning().recordTerminalExecution(feedback);

    const allocation = await retainedProfitLedger.recordTerminalSettlement(feedback);
    const capitalAdvisory = getRainbowCapitalDestinationAdvisory();
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
      logger.info('[Treasury] Terminal profit payout allocation persisted', {
        component: 'RainbowProfitBridgeWiring',
        eventId: allocation.eventId,
        payoutSequence: allocation.payoutSequence,
        realizedProfitUsd: allocation.realizedProfitUsd,
        payoutTargetUsd: allocation.payoutTargetUsd,
        retainedTargetUsd: allocation.retainedTargetUsd,
        payoutFraction: allocation.payoutFraction,
        retainedFraction: allocation.retainedFraction,
        scheduledNotBefore: new Date(allocation.scheduledNotBefore).toISOString(),
        payoutSourceVenue: allocation.payoutSourceVenue,
        payoutSourceAsset: allocation.payoutSourceAsset,
        payoutAsset: 'ETH',
        payoutNetwork: 'ethereum',
        retainedCapitalInventoryReserved: false,
        payoutCapitalProtectedFromNewTrades: Boolean(allocation.payoutSourceVenue && allocation.payoutSourceAsset),
        cexDemandCandidates: capitalAdvisory.cexDemand.map(item => item.venue),
        externalRetainedCapitalCandidates: capitalAdvisory.retainedCapitalCandidates.map(item => item.id),
        actionableExternalRetainedCapitalCandidates: capitalAdvisory.actionableExternalRetainedCapitalCandidates.map(item => item.id),
        externalCandidateCapitalMovementAuthority: false,
      });
    }
    if (allocation) void rainbowProfitBridge.wake('terminal_profit_recorded');
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
  payoutRecipientConfirmationObserver.start();
  void ensureTerminalTreasuryLifecycle().catch(error => {
    logger.warn('[Treasury] Persistent lifecycle unavailable; treasury actions remain fail-closed', {
      component: 'RainbowProfitBridgeWiring',
      error: error instanceof Error ? error.message : String(error),
    });
  });

  // Replay remains safe because terminalFeedbackIdentity plus the database
  // primary key makes allocation exactly-once. Venue learning is intentionally
  // allowed to rehydrate only from terminal truth and remains advisory.
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

  logger.info('[Treasury] Rainbow terminal-profit wiring installed', {
    component: 'RainbowProfitBridgeWiring',
    sourceAuthority: 'terminal_confirmed_settlement_only',
    persistentIdempotency: true,
    sourceAwareLedger: 'venue_chain_symbol_asset_execution_source',
    normalRuntimePayouts: true,
    allocationPolicy: 'fixed_90_percent_wallet_10_percent_retained_for_new_terminal_profit_events',
    payoutTiming: 'immediate_terminal_profit_job_subject_to_settlement_and_wallet_confirmation',
    payoutAuthority: 'single_independent_supabase_worker_okx_only_with_coinbase_and_kraken_payout_funding_lanes',
    recipientConfirmationAuthority: 'railway_read_only_okx_plus_finalized_ethereum_proof',
    recipientConfirmationMovesFunds: false,
    immediateWakePlusCronFallback: true,
    primaryPayoutDestination: 'WALLET_PRIVATE_KEY-derived public Ethereum address',
    fallbackPayoutDestination: 'Railway explicit Ethereum payout address after confirmed terminal primary failure only',
    ambiguousWithdrawalFailureActivatesFallback: false,
    payoutAsset: 'ETH',
    payoutNetwork: 'ethereum_mainnet_only',
    retainedTradingCapitalSpendabilityAuthority: 'canonical_inventory_ledger_system_owned_lots_only',
    retainedCapitalInventoryReserved: false,
    retainedCapitalRoutingTargets: ['coinbase', 'kraken', 'okx', 'external_capability_registry_advisory'],
    externalCapitalAdvisoryIncludes: ['morpho_midnight', 'compound', 'curve_llamalend_v2', 'jupiter_offerbook', 'auto_finance', 'ipor_fusion', 'yo_protocol', 'jupiter_lend_flashloan'],
    externalCapitalMovementRequiresProviderSpecificExecutionReadyProof: true,
    externalCapitalAdvisoryExecutionAuthority: false,
    externalCapitalAdvisoryCapitalMovementAuthority: false,
    venueSpecializationLearning: 'cryptara_terminal_truth_advisory_only',
    venueSpecializationExecutionAuthority: false,
    payoutCapitalProtectedFromNewTradeSpendability: true,
    activeTradePreemptionAllowed: false,
    ethConversionTiming: 'only_when_due_and_withdrawal_executable',
  });
}

export function stopRainbowProfitBridgeWiring(): void {
  if (!installed) return;
  if (listener) stageManager.off('execution-evidence-recorded', listener);
  listener = null;
  installed = false;
  stopTerminalTreasuryLifecycle();
  payoutRecipientConfirmationObserver.stop();
  rainbowProfitObservability.stop();
  stopRainbowMakerFuelReserve();
}

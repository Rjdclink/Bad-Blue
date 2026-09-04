import logger from '../../../logger.js';
import { installCanonicalWalletConfiguration } from '../core/wallet-identity.js';
import {
  ensureCexTreasuryTransferWorker,
  stopCexTreasuryTransferWorker,
} from '../execution/cex-treasury-transfer-worker.js';
import {
  ensureControlledLossLearningWorker,
  stopControlledLossLearningWorker,
} from '../execution/controlled-loss-learning-runtime.js';
import {
  ensureSystemCapitalSweepWorker,
  stopSystemCapitalSweepWorker,
} from '../execution/system-capital-sweep-worker.js';
import {
  ensureTreasuryTransferRecoveryWorker,
  runTreasuryTransferRecoveryOnce,
  stopTreasuryTransferRecoveryWorker,
} from '../execution/treasury-transfer-recovery-worker.js';
import { ensureStageOneBootstrapAuthority } from '../governance/stage-one-bootstrap-authority.js';
import {
  createCryptoCrawlerCoreLifecycle,
  type CryptoCrawlerCoreLifecycle,
} from './core-runtime-lifecycle.js';
import { ensureCryptocrawlOverflowRuntimeSchema } from './cryptocrawl-overflow-runtime-schema.js';
import {
  ensureSystemCapitalPlacementReconciliation,
  stopSystemCapitalPlacementReconciliation,
} from './system-capital-placement-wiring.js';
import { ensureZeroCapitalRealizedProfitWiring } from './zero-capital-realized-profit-wiring.js';

let lifecyclePromise: Promise<CryptoCrawlerCoreLifecycle> | null = null;
let coinbaseReadinessScheduled = false;
let rainbowProfitBridgeScheduled = false;
let walletConfigurationInstalled = false;
let started = false;

function ensureCanonicalWalletConfiguration(): void {
  if (walletConfigurationInstalled) return;
  const wallet = installCanonicalWalletConfiguration();
  walletConfigurationInstalled = true;
  logger.info('[CryptoCoreRuntime] Canonical wallet architecture installed', {
    component: 'CryptoCoreRuntime',
    executionWalletConfigured: Boolean(wallet.executionAddress),
    terminalPayoutConfigured: Boolean(wallet.terminalPayoutAddress),
    bridgeAliasInstalled: wallet.bridgeAliasInstalled,
    acrossAliasInstalled: wallet.acrossAliasInstalled,
    deprecatedVariablesPresent: wallet.deprecatedVariablesPresent,
    operationalProfitDestination: 'WALLET_PRIVATE_KEY-derived execution wallet',
    terminalPayoutDestination: 'CRYPTO_PROFIT_WALLET_ADDRESS',
  });
}

function scheduleCoinbaseReadinessProbe(): void {
  if (coinbaseReadinessScheduled) return;
  coinbaseReadinessScheduled = true;
  queueMicrotask(() => {
    void import('./coinbase-readiness-wiring.js')
      .then(module => module.ensureCoinbaseReadinessProbe())
      .catch(error => {
        logger.warn('[CryptoCoreRuntime] Coinbase readiness probe unavailable; Coinbase remains discovery-only', {
          component: 'CryptoCoreRuntime',
          error: error instanceof Error ? error.message : String(error),
        });
      })
      .finally(() => { coinbaseReadinessScheduled = false; });
  });
}

function scheduleRainbowProfitBridge(): void {
  if (rainbowProfitBridgeScheduled) return;
  rainbowProfitBridgeScheduled = true;
  queueMicrotask(() => {
    void import('./rainbow-profit-bridge-wiring.js')
      .then(module => module.ensureRainbowProfitBridgeWiring())
      .catch(error => {
        rainbowProfitBridgeScheduled = false;
        logger.warn('[CryptoCoreRuntime] Treasury retention wiring unavailable; realized profits remain at source', {
          component: 'CryptoCoreRuntime',
          error: error instanceof Error ? error.message : String(error),
        });
      });
  });
}

async function getLifecycle(): Promise<CryptoCrawlerCoreLifecycle> {
  if (!lifecyclePromise) {
    // Install the canonical Stage-1 live-pilot policy before any discovery or
    // scheduler module can start. The bootstrap authority mutates StageManager's
    // shared StageConfig object rather than bypassing governance callers.
    ensureStageOneBootstrapAuthority();
    ensureCanonicalWalletConfiguration();
    ensureZeroCapitalRealizedProfitWiring();
    lifecyclePromise = Promise.all([
      import('./positive-profit-capture-wiring.js'),
      import('./no-bps-maker-admission-wiring.js'),
      import('./hybrid-cex-execution-wiring.js'),
      import('./stage-proof-metrics-wiring.js'),
      import('../integration/authenticated-fee-tier-optimization-wiring.js'),
      import('../integration/cryptara-two-speed-revalidation-wiring.js'),
      import('./adaptive-profit-operations-wiring.js'),
      import('./expanded-market-universe-wiring.js'),
      import('./alchemy-filtered-mempool-wiring.js'),
      import('./low-latency-execution-wiring.js'),
      import('./market-focus-wiring.js'),
      import('../integration/inventory-constrained-cex-execution-wiring.js'),
    ]).then(([
      profitPolicy,
      noBpsMakerPolicy,
      hybridCexPolicy,
      stageProofPolicy,
      authenticatedFeePolicy,
      twoSpeedPolicy,
      adaptiveProfitPolicy,
      universePolicy,
      mempoolPolicy,
      executionPolicy,
      marketFocusPolicy,
      inventoryPolicy,
    ]) => {
      profitPolicy.ensurePositiveProfitCaptureWiring();
      noBpsMakerPolicy.ensureNoBpsMakerAdmissionWiring();
      hybridCexPolicy.ensureHybridCexExecutionWiring();
      stageProofPolicy.ensureStageProofMetricsWiring();
      authenticatedFeePolicy.ensureAuthenticatedFeeTierOptimizationWiring();
      twoSpeedPolicy.ensureCryptaraTwoSpeedRevalidationWiring();
      adaptiveProfitPolicy.ensureAdaptiveProfitOperationsWiring();
      universePolicy.ensureExpandedMarketUniverseWiring();
      mempoolPolicy.ensureAlchemyFilteredMempoolWiring();
      executionPolicy.ensureLowLatencyExecutionWiring();
      marketFocusPolicy.ensureMarketFocusWiring();
      inventoryPolicy.ensureInventoryConstrainedCexExecutionWiring();
      return Promise.all([
        import('../discovery/multi-topology-discovery-controller.js'),
        import('../execution/canonical-execution-scheduler.js'),
      ]);
    }).then(([discoveryModule, schedulerModule]) => createCryptoCrawlerCoreLifecycle({
      startDiscovery: () => discoveryModule.multiTopologyDiscoveryController.start(),
      stopDiscovery: () => discoveryModule.multiTopologyDiscoveryController.stop(),
      startScheduler: () => schedulerModule.canonicalExecutionScheduler.start(),
      stopScheduler: () => schedulerModule.canonicalExecutionScheduler.stop(),
    })).catch(error => {
      lifecyclePromise = null;
      throw error;
    });
  }
  return lifecyclePromise;
}

/**
 * Sole lifecycle authority for topology-independent discovery and execution.
 * MultiTopologyDiscoveryController launches CEX, DEX, cross-chain, mempool,
 * liquidations, maker shadow discovery, and funding-rate discovery concurrently.
 * Producer-specific provider/rate failures degrade only their own topology.
 */
export async function ensureCryptoCrawlerCoreRuntime(): Promise<void> {
  if (process.env.NODE_ENV === 'production') {
    await ensureCryptocrawlOverflowRuntimeSchema();
  }
  ensureStageOneBootstrapAuthority();
  ensureCanonicalWalletConfiguration();
  ensureZeroCapitalRealizedProfitWiring();
  const lifecycle = await getLifecycle();
  const changed = lifecycle.start();
  started = lifecycle.isStarted();
  scheduleCoinbaseReadinessProbe();
  scheduleRainbowProfitBridge();
  ensureSystemCapitalPlacementReconciliation();

  // Treasury and controlled-learning workers are subordinate to the same
  // migration-owned Overflow schema and governance posture. Controlled-loss
  // learning is a separate one-per-trading-day lane and never consumes the
  // ordinary 1-3 profit-seeking parent-trade quota.
  await runTreasuryTransferRecoveryOnce();
  ensureTreasuryTransferRecoveryWorker();
  ensureCexTreasuryTransferWorker();
  ensureSystemCapitalSweepWorker();
  ensureControlledLossLearningWorker();

  if (!changed) return;
  logger.info('[CryptoCoreRuntime] Canonical core runtime started', {
    component: 'CryptoCoreRuntime',
    discovery: 'unified_multi_topology_parallel_controller',
    executionScheduler: 'canonical_resource_leased_scheduler',
    fixedDiscoveryPriority: false,
    adaptiveDiscoveryAttention: 'terminal_realized_performance',
    twoSpeedOpportunityController: 'slow_global_scan_plus_fast_candidate_event_exact_symbol_revalidation',
    twoSpeedExecutionAuthority: false,
    optionalProviderFailureBlocksCore: false,
    positiveProfitCapturePolicy: 'strict_all_in_net_gt_zero',
    arbitraryBpsExecutionFloor: false,
    stageOneExecutionPolicy: 'constrained_live_positive_execution',
    stageProgressionRole: 'bounded_scaling_not_execution_veto',
    stageProgressionWake: 'eligible_candidate_event_driven',
    makerRecoveryEconomics: 'authenticated_fees_plus_fresh_books',
    hybridCexExecution: 'maker_terminal_fill_then_fresh_depth_aware_taker_hedge',
    authenticatedFeeObservation: 'canonical_cex_fee_resolver_only_with_batched_cached_rate_governed_telemetry',
    adaptiveProfitOperatingEnvelope: 'terminal_realized_daily_cap_plus_depth_slippage_safe_sizing',
    exchangeSurveillanceThresholdAssumed: false,
    stageProofMetrics: 'terminal_realized_sharpe_drawdown_plus_mc_outcome_validation',
    inventoryConstrainedCexReoptimization: true,
    inventoryRateProtection: 'five_second_fresh_cache_plus_inflight_dedupe_plus_backoff_then_fresh_requote',
    staleInventoryExecutionAuthority: false,
    expandedMarketUniverse: true,
    filteredMempoolPolicyInstalled: true,
    lowLatencyExecutionCorrectnessPolicyInstalled: true,
    marketFocusPolicyInstalled: true,
    zeroCapitalRealizedProfitPolicyInstalledBeforeLifecycle: true,
    systemCapitalPlacementReconciliation: 'core_owned_pending_hash_reconciliation_only',
    systemCapitalPlacementCreatesAllocations: false,
    coinbaseReadinessProbeScheduled: true,
    rainbowProfitBridgeScheduled: true,
    canonicalWalletArchitectureInstalled: true,
    retainedProfitTransferWorker: 'kraken_okx_settlement_recovery_provenance_only',
    payoutFundingTransferWorker: 'kraken_to_okx_terminal_profit_reservation_only',
    systemCapitalThresholdSweep: 'per_venue_gt_4000_then_exact_80_percent_to_eth_ethereum_wallet',
    treasuryCrashRecovery: 'recover_before_resubmit_no_duplicate_authority',
    controlledLossLearning: 'one_randomized_post_first_win_unlevered_spot_roundtrip_per_trade_day_max_loss_5_percent_gross_positive_profit',
    controlledLossNormalTradeQuotaConsumed: false,
    controlledLossTerminalLearningAuthority: 'cryptara_canonical_execution_feedback',
    fundingRateDiscovery: 'owned_by_unified_parallel_controller',
    authoritySchemaGate: 'overflow_migration_owned_runtime_start_required',
    primaryRuntimePrerequisite: false,
  });
}

export async function stopCryptoCrawlerCoreRuntime(): Promise<void> {
  stopControlledLossLearningWorker();
  stopSystemCapitalSweepWorker();
  stopCexTreasuryTransferWorker();
  stopTreasuryTransferRecoveryWorker();
  stopSystemCapitalPlacementReconciliation();
  if (!lifecyclePromise) {
    started = false;
    return;
  }
  const lifecycle = await lifecyclePromise;
  const changed = lifecycle.stop();
  started = lifecycle.isStarted();
  if (!changed) return;
  logger.info('[CryptoCoreRuntime] Canonical core runtime stopped', {
    component: 'CryptoCoreRuntime',
  });
}

export function getCryptoCrawlerCoreRuntimeStatus(): { started: boolean } {
  return { started };
}

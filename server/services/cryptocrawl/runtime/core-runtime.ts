import logger from '../../../logger.js';
import { installCanonicalWalletConfiguration } from '../core/wallet-identity.js';
import {
  createCryptoCrawlerCoreLifecycle,
  type CryptoCrawlerCoreLifecycle,
} from './core-runtime-lifecycle.js';

let lifecyclePromise: Promise<CryptoCrawlerCoreLifecycle> | null = null;
let zeroCapitalProfitWiringScheduled = false;
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

function scheduleZeroCapitalProfitWiring(): void {
  if (zeroCapitalProfitWiringScheduled) return;
  zeroCapitalProfitWiringScheduled = true;
  queueMicrotask(() => {
    void import('./zero-capital-realized-profit-wiring.js')
      .then(module => module.ensureZeroCapitalRealizedProfitWiring())
      .catch(error => {
        zeroCapitalProfitWiringScheduled = false;
        logger.error('[CryptoCoreRuntime] Zero-capital realized-profit wiring failed to install', {
          component: 'CryptoCoreRuntime',
          error: error instanceof Error ? error.message : String(error),
        });
      });
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
    ensureCanonicalWalletConfiguration();
    lifecyclePromise = Promise.all([
      import('./positive-profit-capture-wiring.js'),
      import('./no-bps-maker-admission-wiring.js'),
      import('./expanded-market-universe-wiring.js'),
      import('./alchemy-filtered-mempool-wiring.js'),
      import('./low-latency-execution-wiring.js'),
      import('./market-focus-wiring.js'),
      import('../integration/inventory-constrained-cex-execution-wiring.js'),
    ]).then(([
      profitPolicy,
      noBpsMakerPolicy,
      universePolicy,
      mempoolPolicy,
      executionPolicy,
      marketFocusPolicy,
      inventoryPolicy,
    ]) => {
      // Preserve authority order: canonical profitability/maker settlement wiring
      // installs first; the no-BPS evaluator then removes only the artificial
      // spread floor, and inventory re-optimization remains a final pre-execution
      // feasibility refinement rather than a discovery authority.
      profitPolicy.ensurePositiveProfitCaptureWiring();
      noBpsMakerPolicy.ensureNoBpsMakerAdmissionWiring();
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
  ensureCanonicalWalletConfiguration();
  const lifecycle = await getLifecycle();
  const changed = lifecycle.start();
  started = lifecycle.isStarted();
  scheduleZeroCapitalProfitWiring();
  scheduleCoinbaseReadinessProbe();
  scheduleRainbowProfitBridge();

  if (!changed) return;
  logger.info('[CryptoCoreRuntime] Canonical core runtime started', {
    component: 'CryptoCoreRuntime',
    discovery: 'unified_multi_topology_parallel_controller',
    executionScheduler: 'canonical_resource_leased_scheduler',
    fixedDiscoveryPriority: false,
    adaptiveDiscoveryAttention: 'terminal_realized_performance',
    optionalProviderFailureBlocksCore: false,
    positiveProfitCapturePolicy: 'strict_all_in_net_gt_zero',
    arbitraryBpsExecutionFloor: false,
    makerRecoveryEconomics: 'authenticated_fees_plus_fresh_books',
    inventoryConstrainedCexReoptimization: true,
    expandedMarketUniverse: true,
    filteredMempoolPolicyInstalled: true,
    lowLatencyExecutionCorrectnessPolicyInstalled: true,
    marketFocusPolicyInstalled: true,
    zeroCapitalRealizedProfitPolicyScheduled: true,
    coinbaseReadinessProbeScheduled: true,
    rainbowProfitBridgeScheduled: true,
    canonicalWalletArchitectureInstalled: true,
    fundingRateDiscovery: 'owned_by_unified_parallel_controller',
  });
}

export async function stopCryptoCrawlerCoreRuntime(): Promise<void> {
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

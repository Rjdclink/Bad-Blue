import logger from '../../../logger.js';
import { ensureFilteredAlchemyPendingStream } from '../capital-free/alchemy-filtered-pending-stream.js';
import { zeroCapitalEngine } from '../core/zero-capital-engine.js';
import { multiTopologyDiscoveryController } from '../discovery/multi-topology-discovery-controller.js';
import { ensureStageOneBootstrapAuthority } from '../governance/stage-one-bootstrap-authority.js';
import { ensureStageProfitCapRetirement } from '../governance/stage-profit-cap-retirement.js';
import { ensureCanonicalIntelligenceOutbox } from '../intelligence/canonical-intelligence-outbox.js';
import { canonicalIntelligenceRepository } from '../intelligence/canonical-intelligence-repository.js';
import { ensureDynamicScalePressureWiring } from '../scaling/dynamic-scale-pressure-wiring.js';
import { ensureAlchemyStandardRpcFirstWiring } from '../runtime/alchemy-standard-rpc-first-wiring.js';
import { ensureDynamicRpcProviderWiring } from '../runtime/dynamic-rpc-provider-wiring.js';
import { ensureAcrossBridgeObservability } from './across-bridge-observability.js';
import { ensureCryptaraCexEvidenceWiring } from './cryptara-cex-evidence-wiring.js';
import { ensureDynamicProfitabilityAdmissionWiring } from './dynamic-profitability-admission-wiring.js';
import { ensureFilteredMempoolObservability } from './filtered-mempool-observability.js';
import { ensureInventoryConstrainedCexExecutionWiring } from './inventory-constrained-cex-execution-wiring.js';
import { logZeroCapitalReadinessDiagnostics } from './zero-capital-readiness-diagnostics.js';
import { ensureLearningLifecycleWiring } from './learning-lifecycle-wiring.js';
import { ensureMonteCarloCalibrationWiring } from './monte-carlo-calibration-wiring.js';
import { ensureOrderBookEvolutionWiring } from './order-book-evolution-wiring.js';
import { ensureOracleEvidenceWiring } from './oracle-evidence-wiring.js';
import { logLegacyIntelligenceQuarantine } from './legacy-intelligence-quarantine.js';
import { ensurePredictionMarketDiscoveryWiring } from './prediction-market-discovery-wiring.js';
import { ensureCryptoRuntimeObservability } from './runtime-observability.js';
import { ensureZeroCapitalResourceWiring } from './zero-capital-resource-wiring.js';
import { ensureZeroCapitalSizeRefinementWiring } from './zero-capital-size-refinement-wiring.js';
import { ensureZeroCapitalFlashProviderWiring } from './zero-capital-flash-provider-wiring.js';
import { ensureZeroCapitalAtomicStackWiring } from './zero-capital-atomic-stack-wiring.js';
import { ensureProviderSpecificZeroCapitalExecutionWiring } from './provider-specific-zero-capital-execution-wiring.js';
import { ensureZeroXBudgetObservability } from './zerox-budget-observability.js';

let installed = false;
let zeroCapitalStartPromise: Promise<void> | null = null;
let zeroCapitalRetryTimer: NodeJS.Timeout | null = null;
let zeroCapitalStartAttempts = 0;

function zeroCapitalRetryDelayMs(): number {
  const configured = Number(process.env.ZERO_CAPITAL_RUNTIME_START_RETRY_MS || 15_000);
  return Number.isFinite(configured) ? Math.max(2_500, Math.min(120_000, Math.trunc(configured))) : 15_000;
}

function paidAlchemyPendingEvidenceExplicitlyEnabled(): boolean {
  return process.env.ALCHEMY_FILTERED_PENDING_ENABLED?.trim().toLowerCase() === 'true';
}

function startCanonicalZeroCapitalRuntime(): void {
  if (zeroCapitalStartPromise || zeroCapitalEngine.getState().isRunning) return;
  if (zeroCapitalRetryTimer) {
    clearTimeout(zeroCapitalRetryTimer);
    zeroCapitalRetryTimer = null;
  }
  zeroCapitalStartAttempts += 1;
  zeroCapitalStartPromise = zeroCapitalEngine.start()
    .then(() => {
      zeroCapitalRetryTimer = null;
      logger.info('[ZeroCapitalRuntime] Canonical zero-capital lifecycle started', {
        component: 'CanonicalCryptoCrawlerRuntimeWiring',
        lifecycleOwner: 'AutonomousZeroCapitalEngine',
        receiverFleetInitialization: true,
        dynamicGraphlessScanning: true,
        liveExecutionRequested: process.env.ZERO_CAPITAL_ENABLE_EXECUTION === 'true',
        startAttempts: zeroCapitalStartAttempts,
        syntheticExecution: false,
      });
    })
    .catch(error => {
      const retryMs = zeroCapitalRetryDelayMs();
      logger.error('[ZeroCapitalRuntime] Canonical zero-capital lifecycle failed to start', {
        component: 'CanonicalCryptoCrawlerRuntimeWiring',
        error: error instanceof Error ? error.message : String(error),
        startAttempts: zeroCapitalStartAttempts,
        retryMs,
        executionAuthorityGranted: false,
      });
      zeroCapitalRetryTimer = setTimeout(() => startCanonicalZeroCapitalRuntime(), retryMs);
      zeroCapitalRetryTimer.unref?.();
    })
    .finally(() => {
      zeroCapitalStartPromise = null;
    });
}

export function ensureCanonicalCryptoCrawlerRuntimeWiring(): void {
  if (installed) return;
  installed = true;

  ensureStageProfitCapRetirement();
  logZeroCapitalReadinessDiagnostics();
  ensureLearningLifecycleWiring();
  ensureMonteCarloCalibrationWiring();
  ensureOracleEvidenceWiring();
  ensureDynamicScalePressureWiring();
  ensureZeroCapitalResourceWiring();
  // Wrapper order matters: size refinement must happen before flash-provider
  // repricing so the winning notional is subsequently charged the exact measured
  // provider fee/liquidity and bound to the verified receiver.
  ensureZeroCapitalSizeRefinementWiring();
  ensureZeroCapitalFlashProviderWiring();
  ensureProviderSpecificZeroCapitalExecutionWiring();
  ensureZeroCapitalAtomicStackWiring();
  ensureAlchemyStandardRpcFirstWiring();

  // Cost-safe RPCs must be admitted before the zero-capital engine asks the
  // provider manager for its first chain provider. This keeps paid Alchemy RPC
  // as failover while the local Computational Beam/Aries/Cryptara stack performs
  // the expensive analysis after bounded market-evidence acquisition. The
  // standard-token wrapper is already installed, so any later token reads also
  // inherit this public-first provider order automatically.
  void ensureDynamicRpcProviderWiring().finally(() => startCanonicalZeroCapitalRuntime());

  ensureOrderBookEvolutionWiring();
  ensureCryptaraCexEvidenceWiring();
  ensureInventoryConstrainedCexExecutionWiring();
  ensureDynamicProfitabilityAdmissionWiring();
  ensureStageOneBootstrapAuthority();
  void canonicalIntelligenceRepository.hydrate();
  ensureCanonicalIntelligenceOutbox();

  if (paidAlchemyPendingEvidenceExplicitlyEnabled()) {
    ensureFilteredAlchemyPendingStream();
  } else {
    logger.info('[AlchemyCostContainment] Paid filtered pending stream withheld', {
      component: 'CanonicalCryptoCrawlerRuntimeWiring',
      explicitOptInRequired: true,
      optInVariable: 'ALCHEMY_FILTERED_PENDING_ENABLED=true',
      alchemyApiKeyPresenceDoesNotStartPaidStream: true,
    });
  }

  ensureFilteredMempoolObservability();
  ensureZeroXBudgetObservability();
  ensureAcrossBridgeObservability();
  ensurePredictionMarketDiscoveryWiring();
  multiTopologyDiscoveryController.start();
  logLegacyIntelligenceQuarantine();
  ensureCryptoRuntimeObservability();

  logger.info('Canonical CryptoCrawler runtime wiring installed', {
    component: 'CanonicalCryptoCrawlerRuntimeWiring',
    lifecycleAuthority: 'canonical_measured_runtime',
    discoveryAuthority: 'unified_multi_topology_parallel_controller',
    fixedDiscoveryPriority: false,
    adaptiveAdmissionFormula: '(NetProfitUSD / ExecutionRisk) * ConfidenceLevel',
    historicalProofRequiredBeforeFirstExecution: false,
    stageOneBootstrapAuthority: 'fresh_current_evidence_without_prior_profit_history',
    adaptiveThresholdAuthority: 'terminal_realized_outcomes',
    bpsExecutionFloor: null,
    executionEconomicFloor: 'strict_all_in_net_profit_usd_greater_than_zero',
    cexInventorySizing: 'authenticated_spendable_inventory_then_fresh_economic_reoptimization',
    legacyMasterOrchestratorRequired: false,
    executionAuthorityGranted: false,
    executionMetrics: 'terminal_settlement_only',
    opportunityMetrics: 'canonical_verified_stream',
    orderBookEvolution: 'measured_short_horizon_transitions',
    dynamicScale: 'multi_axis_search_formation_profitability_pressure',
    monteCarloCalibration: 'terminal_normalized_settlement_only',
    intelligenceMemory: 'bounded_hot_plus_private_postgres_async',
    filteredMempoolEvidence: paidAlchemyPendingEvidenceExplicitlyEnabled()
      ? 'alchemy_provider_filtered_hash_first_exact_chain_explicit_opt_in'
      : 'withheld_by_default_cost_policy',
    predictionMarketDiscovery: 'public_no_auth_binary_parity_observation_only',
    predictionMarketExecutionAuthority: false,
    acrossBridgeEvidence: 'current_token_catalog_fresh_quote_rotating_route_sampling',
    acrossBridgeExecutionAuthority: false,
    zeroCapitalRuntimeLifecycle: 'cost_safe_rpc_mesh_then_canonical_wrappers_then_fail_closed_retry',
    zeroCapitalSizeOptimization: 'coarse_independent_quotes_plus_bounded_fresh_local_refinement',
    zeroCapitalFlashLoanEconomics: 'measured_provider_fee_and_liquidity',
    zeroCapitalProviderExecution: 'verified_provider_receiver_permission_binding',
    zeroCapitalAtomicStacking: 'same_chain_same_token_exact_simulation_shared_principal_composite_v2',
    zeroCapitalAtomicStackExecutionAuthority: false,
    zeroCapitalExecutionAdmission: 'resource_leases_plus_dynamic_profitability_confidence',
    alchemyPaidPendingStreamDefault: false,
    paidAlchemyRpcRole: 'fallback_only_after_two_cost_safe_provider_failures_when_available',
    alchemyStandardTokenReads: 'public_rpc_first_then_enhanced_api_fallback',
    localComputeRole: 'ComputationalBeam_Aries_Cryptara',
    runtimeHeartbeat: true,
  });
}

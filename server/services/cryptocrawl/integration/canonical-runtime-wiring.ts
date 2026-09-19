import logger from '../../../logger.js';
import { ensureProviderMeshPendingStream, providerMeshPendingStream } from '../capital-free/provider-mesh-pending-stream.js';
import {
  ensureZeroCapitalFundingLifecycleObserver,
  stopZeroCapitalFundingLifecycleObserver,
} from '../evolution/zero-capital-funding-lifecycle-observer.js';
import { startCanonicalZeroCapitalDiscovery, stopCanonicalZeroCapitalDiscovery } from '../discovery/zero-capital-canonical-discovery.js';
import { multiTopologyDiscoveryController } from '../discovery/multi-topology-discovery-controller.js';
import { ghostWalletUltraWorker } from '../ghost-wallet/ghost-wallet-ultra-worker.js';
import { ensureStageOneBootstrapAuthority } from '../governance/stage-one-bootstrap-authority.js';
import { ensureCanonicalIntelligenceOutbox } from '../intelligence/canonical-intelligence-outbox.js';
import { canonicalIntelligenceRepository } from '../intelligence/canonical-intelligence-repository.js';
import { ensureDynamicScalePressureWiring } from '../scaling/dynamic-scale-pressure-wiring.js';
import { ensureAdaptiveProfitOperationsWiring } from '../runtime/adaptive-profit-operations-wiring.js';
import { ensureExpandedNetworkObservability, stopExpandedNetworkObservability } from '../runtime/expanded-network-observability.js';
import { ensureDynamicRpcProviderWiring } from '../runtime/dynamic-rpc-provider-wiring.js';
import { ensureHybridCexExecutionWiring } from '../runtime/hybrid-cex-execution-wiring.js';
import {
  ensureCryptocrawlOverflowRuntimeSchema,
  getCryptocrawlOverflowRuntimeSchemaSnapshot,
} from '../runtime/cryptocrawl-overflow-runtime-schema.js';
import { ensureStablecoinMakerExecutionWiring } from '../runtime/stablecoin-maker-execution-wiring.js';
import { ensureStageProofMetricsWiring } from '../runtime/stage-proof-metrics-wiring.js';
import { ensureAcrossBridgeObservability, stopAcrossBridgeObservability } from './across-bridge-observability.js';
import { ensureAuthenticatedFeeTierOptimizationWiring } from './authenticated-fee-tier-optimization-wiring.js';
import { ensureCexFourModeObservabilityWiring, stopCexFourModeObservabilityWiring } from './cex-four-mode-observability-wiring.js';
import { ensureCexInventoryReadinessWiring, stopCexInventoryReadinessWiring } from './cex-inventory-readiness-wiring.js';
import { ensureComputationalReactorWiring, stopComputationalReactorWiring } from './computational-reactor-wiring.js';
import { ensureCrossVenueTimingGuardWiring } from './cross-venue-timing-guard-wiring.js';
import { ensureCryptaraCexEvidenceWiring } from './cryptara-cex-evidence-wiring.js';
import { ensureCryptaraSovereignCortexWiring } from './cryptara-sovereign-cortex-wiring.js';
import { ensureCryptaraPredictivePrefetchWiring } from './cryptara-predictive-prefetch-wiring.js';
import { ensureDynamicProfitabilityAdmissionWiring } from './dynamic-profitability-admission-wiring.js';
import { ensureExecutionReadinessProfitabilityWiring } from './execution-readiness-profitability-wiring.js';
import { ensureExternalCapitalSelectionObserver, stopExternalCapitalSelectionObserver } from './external-capital-selection-observer.js';
import { ensureFilteredMempoolObservability, stopFilteredMempoolObservability } from './filtered-mempool-observability.js';
import { getCryptaraHyperBridgeBootstrapSnapshot } from './cryptara-supabase-hyper-bridge-bootstrap.js';
import { ensureInventoryConstrainedCexExecutionWiring } from './inventory-constrained-cex-execution-wiring.js';
import { ensureKalshiBpsOptimizationWiring, stopKalshiBpsOptimizationWiring } from './kalshi-bps-optimization-wiring.js';
import { ensureMeasuredCandidateExpiryGuardWiring } from './measured-candidate-expiry-guard-wiring.js';
import {
  ensureMeasuredRebalanceRouteEvidenceWiring,
  stopMeasuredRebalanceRouteEvidenceWiring,
} from './measured-rebalance-route-evidence-wiring.js';
import { logZeroCapitalReadinessDiagnostics } from './zero-capital-readiness-diagnostics.js';
import { ensureLearningLifecycleWiring, stopLearningLifecycleWiring } from './learning-lifecycle-wiring.js';
import { ensureMonteCarloCalibrationWiring } from './monte-carlo-calibration-wiring.js';
import { ensureOrderBookEvolutionWiring, stopOrderBookEvolutionWiring } from './order-book-evolution-wiring.js';
import { ensureOracleEvidenceWiring } from './oracle-evidence-wiring.js';
import { logLegacyIntelligenceQuarantine } from './legacy-intelligence-quarantine.js';
import { ensurePredictionMarketDiscoveryWiring, stopPredictionMarketDiscoveryWiring } from './prediction-market-discovery-wiring.js';
import { ensureCryptoRuntimeObservability, stopCryptoRuntimeObservability } from './runtime-observability.js';
import { ensureZeroCapitalShadowPriorityWiring } from './zero-capital-shadow-priority-wiring.js';
import { ensureZeroCapitalAtomicStackWiring } from './zero-capital-atomic-stack-wiring.js';
import { stopBpsCompressionMesh } from './bps-compression-mesh.js';
import { stopBpsFrontierWave3Wiring } from './bps-frontier-wave3-wiring.js';
import { stopBpsDecompositionObservability } from './bps-decomposition-observability.js';
import { stopEconomicTransformationWiring } from './economic-transformation-wiring.js';
import { stopProfitabilityRecoveryCoordinator } from './profitability-recovery-coordinator.js';
import { ensureZeroXBudgetObservability, stopZeroXBudgetObservability } from './zerox-budget-observability.js';
import { stopCryptaraTwoSpeedRevalidationWiring } from './cryptara-two-speed-revalidation-wiring.js';

let installed = false;
let runtimeActivationAllowed = false;
let installRetryTimer: NodeJS.Timeout | null = null;
let overflowSchemaRepairPromise: Promise<void> | null = null;
let zeroCapitalStartPromise: Promise<void> | null = null;
let zeroCapitalRetryTimer: NodeJS.Timeout | null = null;
let zeroCapitalStartAttempts = 0;

type RuntimeComponentStatus = 'pending' | 'ready' | 'degraded';
type RuntimeComponentInstaller = () => void | Promise<void>;

interface RuntimeComponentState {
  status: RuntimeComponentStatus;
  attempts: number;
  lastAttemptAt: number | null;
  lastReadyAt: number | null;
  lastError: string | null;
}

const runtimeComponentStates = new Map<string, RuntimeComponentState>();
const runtimeComponentRetryTimers = new Map<string, NodeJS.Timeout>();

function zeroCapitalRetryDelayMs(): number {
  const configured = Number(process.env.ZERO_CAPITAL_RUNTIME_START_RETRY_MS || 15_000);
  return Number.isFinite(configured) ? Math.max(2_500, Math.min(120_000, Math.trunc(configured))) : 15_000;
}

function runtimeComponentRetryDelayMs(): number {
  const configured = Number(process.env.CRYPTOCRAWL_COMPONENT_RETRY_MS || 10_000);
  return Number.isFinite(configured) ? Math.max(1_000, Math.min(120_000, Math.trunc(configured))) : 10_000;
}

function canonicalRuntimeStartupGraceMs(): number {
  const configured = Number(process.env.CRYPTOCRAWL_RUNTIME_STARTUP_GRACE_MS || 30_000);
  return Number.isFinite(configured) ? Math.max(5_000, Math.min(120_000, Math.trunc(configured))) : 30_000;
}

function canonicalRuntimeOverflowRetryMs(): number {
  const configured = Number(process.env.CRYPTOCRAWL_RUNTIME_DATABASE_RETRY_MS || 5_000);
  return Number.isFinite(configured) ? Math.max(1_000, Math.min(30_000, Math.trunc(configured))) : 5_000;
}

function currentComponentState(name: string): RuntimeComponentState {
  return runtimeComponentStates.get(name) || {
    status: 'pending',
    attempts: 0,
    lastAttemptAt: null,
    lastReadyAt: null,
    lastError: null,
  };
}

function scheduleRuntimeComponentRetry(name: string, installer: RuntimeComponentInstaller): void {
  if (!runtimeActivationAllowed || runtimeComponentRetryTimers.has(name)) return;
  const retryMs = runtimeComponentRetryDelayMs();
  const timer = setTimeout(() => {
    runtimeComponentRetryTimers.delete(name);
    if (!runtimeActivationAllowed) return;
    installRuntimeComponent(name, installer);
  }, retryMs);
  timer.unref?.();
  runtimeComponentRetryTimers.set(name, timer);
}

function installRuntimeComponent(name: string, installer: RuntimeComponentInstaller): void {
  if (!runtimeActivationAllowed) return;
  const previous = currentComponentState(name);
  const attempt = previous.attempts + 1;
  runtimeComponentStates.set(name, {
    ...previous,
    status: 'pending',
    attempts: attempt,
    lastAttemptAt: Date.now(),
  });

  const markReady = () => {
    runtimeComponentStates.set(name, {
      status: 'ready',
      attempts: attempt,
      lastAttemptAt: Date.now(),
      lastReadyAt: Date.now(),
      lastError: null,
    });
    const retryTimer = runtimeComponentRetryTimers.get(name);
    if (retryTimer) clearTimeout(retryTimer);
    runtimeComponentRetryTimers.delete(name);
  };

  const markDegraded = (error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    runtimeComponentStates.set(name, {
      status: 'degraded',
      attempts: attempt,
      lastAttemptAt: Date.now(),
      lastReadyAt: previous.lastReadyAt,
      lastError: message,
    });
    logger.error('[CryptoRuntimeIsolation] Component degraded without stopping unrelated runtime components', {
      component: 'CanonicalCryptoCrawlerRuntimeWiring',
      runtimeComponent: name,
      attempts: attempt,
      error: message,
      retryInMs: runtimeComponentRetryDelayMs(),
      globalRuntimeShutdownAuthority: false,
      unrelatedComponentsContinue: true,
      failedComponentExecutionAuthorityGranted: false,
    });
    scheduleRuntimeComponentRetry(name, installer);
  };

  try {
    const result = installer();
    if (result && typeof (result as Promise<void>).then === 'function') {
      void Promise.resolve(result).then(markReady).catch(markDegraded);
      return;
    }
    markReady();
  } catch (error) {
    markDegraded(error);
  }
}

export function getCanonicalRuntimeComponentIsolationSnapshot() {
  const components = [...runtimeComponentStates.entries()]
    .map(([name, state]) => ({ name, ...state }))
    .sort((left, right) => left.name.localeCompare(right.name));
  return {
    observedAt: Date.now(),
    totalComponents: components.length,
    readyComponents: components.filter(component => component.status === 'ready').length,
    degradedComponents: components.filter(component => component.status === 'degraded').length,
    pendingComponents: components.filter(component => component.status === 'pending').length,
    components,
    failureIsolation: 'per_component_retry_without_global_runtime_shutdown' as const,
    globalRuntimeShutdownAuthority: false as const,
    independentComponentsContinue: true as const,
    hardSafetyRemainsLocalFailClosed: true as const,
  };
}

function startCanonicalZeroCapitalRuntime(): void {
  if (!runtimeActivationAllowed || zeroCapitalStartPromise) return;
  if (zeroCapitalRetryTimer) {
    clearTimeout(zeroCapitalRetryTimer);
    zeroCapitalRetryTimer = null;
  }
  zeroCapitalStartAttempts += 1;
  zeroCapitalStartPromise = startCanonicalZeroCapitalDiscovery()
    .then(() => {
      zeroCapitalRetryTimer = null;
      if (!runtimeActivationAllowed) {
        stopCanonicalZeroCapitalDiscovery();
        return;
      }
      logger.info('[ZeroCapitalRuntime] Canonical zero-capital discovery lifecycle started', {
        component: 'CanonicalCryptoCrawlerRuntimeWiring',
        lifecycleOwner: 'CanonicalZeroCapitalDiscovery',
        executionSchedulerOwner: 'CanonicalExecutionScheduler',
        executionOwner: 'CanonicalZeroCapitalExecutor',
        independentZeroCapitalExecutionLoop: false,
        runtimeMethodMutation: false,
        receiverFleetInitialization: true,
        dynamicGraphlessScanning: true,
        liveExecutionRequested: process.env.CRYPTO_ARBITRAGE_LIVE_EXECUTION === 'true' && process.env.NO_EXECUTION !== 'true',
        startAttempts: zeroCapitalStartAttempts,
        syntheticExecution: false,
      });
    })
    .catch(error => {
      const retryMs = zeroCapitalRetryDelayMs();
      logger.error('[ZeroCapitalRuntime] Canonical zero-capital discovery failed to start', {
        component: 'CanonicalCryptoCrawlerRuntimeWiring',
        error: error instanceof Error ? error.message : String(error),
        startAttempts: zeroCapitalStartAttempts,
        retryMs,
        executionAuthorityGranted: false,
      });
      if (runtimeActivationAllowed) {
        zeroCapitalRetryTimer = setTimeout(() => startCanonicalZeroCapitalRuntime(), retryMs);
        zeroCapitalRetryTimer.unref?.();
      }
    })
    .finally(() => {
      zeroCapitalStartPromise = null;
    });
}

function installCanonicalRuntime(): void {
  if (!runtimeActivationAllowed || installed) return;
  installed = true;

  const install = installRuntimeComponent;

  install('zero_capital_readiness_diagnostics', () => logZeroCapitalReadinessDiagnostics());
  install('computational_reactor', () => ensureComputationalReactorWiring());
  install('learning_lifecycle', () => ensureLearningLifecycleWiring());
  install('monte_carlo_calibration', () => ensureMonteCarloCalibrationWiring());
  install('oracle_evidence', () => ensureOracleEvidenceWiring());
  install('dynamic_scale_pressure', () => ensureDynamicScalePressureWiring());
  install('zero_capital_shadow_priority', () => ensureZeroCapitalShadowPriorityWiring());
  install('zero_capital_atomic_stack', () => ensureZeroCapitalAtomicStackWiring());
  install('dynamic_rpc_provider', async () => {
    try {
      await ensureDynamicRpcProviderWiring();
      ensureProviderMeshPendingStream();
    } finally {
      startCanonicalZeroCapitalRuntime();
    }
  });
  install('ghost_wallet_ultra_worker', () => ghostWalletUltraWorker.start());

  install('order_book_evolution', () => ensureOrderBookEvolutionWiring());
  install('cex_four_mode_observability', () => ensureCexFourModeObservabilityWiring());
  install('cryptara_cex_evidence', () => ensureCryptaraCexEvidenceWiring());
  install('cryptara_sovereign_cortex', () => ensureCryptaraSovereignCortexWiring());
  install('cryptara_predictive_prefetch', () => ensureCryptaraPredictivePrefetchWiring());
  install('stablecoin_maker_execution', () => ensureStablecoinMakerExecutionWiring());
  install('hybrid_cex_execution', () => ensureHybridCexExecutionWiring());
  install('stage_proof_metrics', () => ensureStageProofMetricsWiring());
  install('authenticated_fee_tier_optimization', () => ensureAuthenticatedFeeTierOptimizationWiring());
  install('kalshi_bps_optimization', () => ensureKalshiBpsOptimizationWiring());
  install('adaptive_profit_operations', () => ensureAdaptiveProfitOperationsWiring());
  install('cex_inventory_readiness', () => ensureCexInventoryReadinessWiring());
  install('execution_readiness_profitability', () => ensureExecutionReadinessProfitabilityWiring());
  install('inventory_constrained_cex_execution', () => ensureInventoryConstrainedCexExecutionWiring());
  install('cross_venue_timing_guard', () => ensureCrossVenueTimingGuardWiring());
  install('measured_candidate_expiry_guard', () => ensureMeasuredCandidateExpiryGuardWiring());
  install('zero_capital_funding_lifecycle_observer', () => ensureZeroCapitalFundingLifecycleObserver());
  install('measured_rebalance_route_evidence', () => ensureMeasuredRebalanceRouteEvidenceWiring());
  install('dynamic_profitability_admission', () => ensureDynamicProfitabilityAdmissionWiring());
  install('stage_one_bootstrap_authority', () => ensureStageOneBootstrapAuthority());
  install('canonical_intelligence_repository_hydrate', () => canonicalIntelligenceRepository.hydrate());
  install('canonical_intelligence_outbox', () => ensureCanonicalIntelligenceOutbox());
  install('provider_mesh_pending_stream', () => ensureProviderMeshPendingStream());
  install('filtered_mempool_observability', () => ensureFilteredMempoolObservability());
  install('zero_x_budget_observability', () => ensureZeroXBudgetObservability());
  install('across_bridge_observability', () => ensureAcrossBridgeObservability());
  install('prediction_market_discovery', () => ensurePredictionMarketDiscoveryWiring());
  install('multi_topology_discovery_controller', () => multiTopologyDiscoveryController.start());
  install('legacy_intelligence_quarantine_log', () => logLegacyIntelligenceQuarantine());
  install('crypto_runtime_observability', () => ensureCryptoRuntimeObservability());
  install('expanded_network_observability', () => ensureExpandedNetworkObservability());
  install('external_capital_selection_observer', () => ensureExternalCapitalSelectionObserver());

  logger.info('Canonical CryptoCrawler runtime wiring installed', {
    component: 'CanonicalCryptoCrawlerRuntimeWiring',
    lifecycleAuthority: 'canonical_measured_runtime',
    discoveryAuthority: 'unified_multi_topology_parallel_controller_plus_explicit_zero_capital_discovery',
    zeroCapitalDiscoveryAuthority: 'CanonicalZeroCapitalDiscovery',
    zeroCapitalEligibilityAuthority: 'canonical_provider_repricing_stage_only',
    zeroCapitalSchedulerAuthority: 'CanonicalExecutionScheduler_only',
    zeroCapitalExecutionAuthority: 'CanonicalZeroCapitalExecutor_only',
    zeroCapitalRuntimeMethodMutation: false,
    ghostWalletRuntime: 'isolated_event_driven_atomic_credit_ultra_worker',
    ghostWalletProfitLadderAuthority: false,
    ghostWalletArbitrageExecutionAuthority: false,
    fixedDiscoveryPriority: false,
    adaptiveAdmissionFormula: '(NetProfitUSD / ExecutionRisk) * ConfidenceLevel',
    historicalProofRequiredBeforeFirstExecution: false,
    stageOneBootstrapAuthority: 'fresh_current_evidence_without_prior_profit_history',
    adaptiveThresholdAuthority: 'terminal_realized_outcomes',
    measuredCandidateFreshnessPromotionGuard: true,
    executionReadinessProfitabilityControls: '200_bounded_prewarm_retention_inventory_provider_expiry_rules_without_order_authority',
    crossVenueTimingGuard: 'fresh_synchronized_coinbase_kraken_okx_books_then_existing_exact_economic_requote',
    bpsExecutionFloor: null,
    executionEconomicFloor: 'strict_all_in_net_profit_usd_greater_than_zero',
    cexInventorySizing: 'authenticated_spendable_inventory_then_fresh_economic_reoptimization',
    cexInventoryReadiness: 'proactive_authenticated_balance_hydration_then_candidate_specific_reconciliation',
    cexInventoryRateProtection: 'five_second_fresh_cache_inflight_dedupe_bounded_backoff_then_fresh_requote',
    staleInventoryExecutionAuthority: false,
    cexFourModeEconomics: 'measured_TT_MT_TM_MM_same_fresh_books_authenticated_fees',
    cexAuthenticatedFeeTierOverlay: 'cache_only_observer_canonical_fee_resolver_refreshes_on_demand',
    kalshiBpsOverlay: 'authenticated_perps_fee_frontier_plus_public_funding_spread_and_prediction_incentive_metadata_advisory_only',
    kalshiBpsRealizedAuthority: false,
    rebateModeSelection: 'expected_realized_net_value_not_rebate_alone',
    minimumOrderNotionalTierAssumed: false,
    cexMakerExecution: 'coinbase_kraken_okx_post_only_measured_plan_then_inventory_governance_product_and_terminal_settlement',
    coinbaseMakerExecutionAuthority: true,
    cexHybridExecutionAuthority: true,
    cexHybridExecution: 'MT_TM_maker_terminal_fill_then_fresh_depth_aware_taker_hedge',
    adaptiveProfitOperatingEnvelope: 'terminal_realized_performance_telemetry_plus_profit_ladder_notional_and_dynamic_cycle_budget',
    adaptiveProfitCapScope: 'retired_no_daily_realized_profit_execution_cap',
    rolling24hProfitRole: 'telemetry_only',
    retainedProfitRole: 'available_for_redeployment_subject_to_profit_ladder_stage_inventory_liquidity_and_risk',
    exchangeSurveillanceThresholdAssumed: false,
    stageProofMetricsAuthority: 'terminal_realized_sharpe_drawdown_plus_executed_mc_outcome_validation',
    computationalReactor: 'measured_cpu_memory_rate_pressure_plus_real_scorer_monte_carlo_plus_bounded_callbacks',
    computationalReactorExecutionAuthority: false,
    cryptaraSovereignCortex: 'eight_dimension_measured_capability_vector_plus_consensus_confidence_plus_terminal_learning',
    cryptaraPredictivePrefetch: 'positive_high_priority_compute_aware_provider_ranked_coinbase_kraken_okx_book_warmup',
    cryptaraCortexExecutionAuthority: false,
    legacyMasterOrchestratorRequired: false,
    executionAuthorityGranted: false,
    executionMetrics: 'terminal_settlement_only',
    opportunityMetrics: 'canonical_verified_stream',
    orderBookEvolution: 'adaptive_measured_short_horizon_transitions',
    dynamicScale: 'multi_axis_search_formation_profitability_pressure',
    monteCarloCalibration: 'terminal_normalized_settlement_only',
    intelligenceMemory: 'bounded_hot_plus_private_postgres_async_retry',
    filteredMempoolEvidence: 'alchemy_free_provider_mesh_full_pending_exact_chain',
    filteredMempoolTelemetry: 'full_pending_relevance_and_bounded_fallback_detail_pressure',
    filteredMempoolExecutionAuthority: false,
    predictionMarketDiscovery: 'public_no_auth_binary_parity_observation_only',
    predictionMarketExecutionAuthority: false,
    acrossBridgeEvidence: 'current_token_catalog_fresh_quote_rotating_route_sampling',
    acrossBridgeExecutionAuthority: false,
    zeroCapitalRuntimeLifecycle: 'explicit_discovery_to_measured_candidate_to_single_scheduler_to_single_executor_to_terminal_treasury_feedback',
    zeroCapitalSizeOptimization: 'canonical_scan_direct_bps_rescue_with_exact_provider_fee_liquidity_and_fresh_notional_requotes',
    zeroCapitalDuplicateSizeOptimizerOwners: 0,
    zeroCapitalProfitabilityRescue: 'canonical_scan_direct_call_decimals_correct_gap_aware_fresh_provider_liquidity_bounded_expiry_safe',
    zeroCapitalProfitabilityRescueInstallerAuthority: false,
    zeroCapitalPredictiveUsdEconomics: 'live_input_asset_price_required_before_monte_carlo_and_position_sizing',
    zeroCapitalFlashLoanEconomics: 'single_registry_measured_single_or_combined_provider_fee_liquidity',
    zeroCapitalProviderExecution: 'single_executor_verified_balancer_aave_morpho_or_dual_receiver_permission_binding',
    zeroCapitalProviderMesh: 'balancer_aave_morpho_or_combined_aave_balancer_when_measured_exact_economics_support_it',
    zeroCapitalProviderMeshSinglePreferredWhenSufficient: true,
    zeroCapitalAtomicStacking: 'same_chain_same_token_exact_simulation_shared_principal_composite_v2_advisory_only',
    zeroCapitalAtomicStackExecutionAuthority: false,
    zeroCapitalDynamicAttemptBarrier: 'direct_exact_pre_broadcast_validator_called_by_single_executor',
    zeroCapitalDynamicAttemptBarrierExecutionAuthority: false,
    zeroCapitalExecutionAdmission: 'measured_positive_exact_provider_resource_evidence_then_canonical_scheduler',
    zeroCapitalWorkOrdering: 'expected_net_profit_per_scarcity_unit_with_expiry_urgency_scheduling_only',
    alchemyPaidPendingStreamDefault: false,
    paidAlchemyRpcRole: 'disabled_no_runtime_authority',
    alchemyStandardTokenReads: 'disabled_no_runtime_authority',
    alchemyGasSponsorshipAuthority: false,
    freeProviderReplacement: 'publicnode_drpc_configured_rpc_mesh_plus_alchemy_free_ghost_mesh',
    localComputeRole: 'ComputationalBeam_Aries_Cryptara',
    runtimeHeartbeat: true,
    runtimeComponentIsolation: 'per_component_retry_without_global_runtime_shutdown',
    runtimeComponentIsolationGlobalShutdownAuthority: false,
    runtimeComponentIsolationHardSafetyScope: 'failed_component_or_candidate_only',
    startupAdmission: 'production_grace_then_overflow_transport_and_schema_authority_no_primary_probe_or_fallback',
    startupGraceMs: canonicalRuntimeStartupGraceMs(),
  });
}

function scheduleCanonicalRuntimeInstall(delayMs: number, reason: string): void {
  if (!runtimeActivationAllowed || installed || installRetryTimer) return;
  installRetryTimer = setTimeout(() => {
    installRetryTimer = null;
    ensureCanonicalCryptoCrawlerRuntimeWiring();
  }, delayMs);
  installRetryTimer.unref?.();
  logger.info('[CryptoRuntimeStartup] Canonical runtime installation deferred', {
    component: 'CanonicalCryptoCrawlerRuntimeWiring',
    reason,
    retryInMs: delayMs,
    exchangeRequestsDuringDeferral: false,
    executionAuthorityGranted: false,
  });
}

function startOverflowSchemaRepair(): void {
  if (overflowSchemaRepairPromise) return;
  overflowSchemaRepairPromise = ensureCryptocrawlOverflowRuntimeSchema()
    .then(() => {
      process.env.CRYPTOCRAWL_OVERFLOW_RUNTIME_SCHEMA_READY = 'true';
      logger.info('[CryptoRuntimeStartup] Overflow schema authority recovered; canonical runtime installation will resume', {
        component: 'CanonicalCryptoCrawlerRuntimeWiring',
        schema: getCryptocrawlOverflowRuntimeSchemaSnapshot(),
        primaryFallback: false,
      });
      ensureCanonicalCryptoCrawlerRuntimeWiring();
    })
    .catch(error => {
      process.env.CRYPTOCRAWL_OVERFLOW_RUNTIME_SCHEMA_READY = 'false';
      logger.warn('[CryptoRuntimeStartup] Overflow transport is ready but schema authority repair failed; retry remains bounded', {
        component: 'CanonicalCryptoCrawlerRuntimeWiring',
        error: error instanceof Error ? error.message : String(error),
        schema: getCryptocrawlOverflowRuntimeSchemaSnapshot(),
        retryInMs: canonicalRuntimeOverflowRetryMs(),
        primaryFallback: false,
      });
      scheduleCanonicalRuntimeInstall(canonicalRuntimeOverflowRetryMs(), 'overflow_schema_not_ready');
    })
    .finally(() => {
      overflowSchemaRepairPromise = null;
    });
}

export function ensureCanonicalCryptoCrawlerRuntimeWiring(): void {
  if (!runtimeActivationAllowed || installed) return;

  if (process.env.NODE_ENV === 'production') {
    const graceRemainingMs = Math.max(0, canonicalRuntimeStartupGraceMs() - Math.floor(process.uptime() * 1_000));
    if (graceRemainingMs > 0) {
      scheduleCanonicalRuntimeInstall(graceRemainingMs, 'production_startup_grace');
      return;
    }

    const overflowBootstrap = getCryptaraHyperBridgeBootstrapSnapshot();
    const overflowSchema = getCryptocrawlOverflowRuntimeSchemaSnapshot();
    if (overflowBootstrap.state === 'ready' && overflowSchema.ready) {
      process.env.CRYPTOCRAWL_OVERFLOW_RUNTIME_SCHEMA_READY = 'true';
      logger.info('[CryptoRuntimeStartup] Overflow authority ready; installing canonical runtime with all Primary admission/recovery paths disabled', {
        component: 'CanonicalCryptoCrawlerRuntimeWiring',
        dataPlane: 'overflow_authority',
        overflowTransportReady: true,
        overflowSchemaReady: true,
        overflowSchemaVersion: overflowSchema.schemaVersion,
        primaryRuntimePrerequisite: false,
        directPrimaryProbe: false,
        primaryFallback: false,
        recoveryPolling: false,
        executionAuthorityGranted: false,
      });
      installCanonicalRuntime();
      return;
    }

    if (overflowBootstrap.state === 'ready') {
      startOverflowSchemaRepair();
      logger.warn('[CryptoRuntimeStartup] Overflow transport ready but schema authority not ready; runtime remains fail-closed while bounded repair runs', {
        component: 'CanonicalCryptoCrawlerRuntimeWiring',
        overflowState: overflowBootstrap.state,
        overflowReason: overflowBootstrap.reason,
        overflowSchemaReady: overflowSchema.ready,
        overflowSchemaVersion: overflowSchema.schemaVersion,
        overflowSchemaInFlight: overflowSchema.inFlight,
        overflowSchemaLastError: overflowSchema.lastError,
        primaryRuntimePrerequisite: false,
        directPrimaryProbe: false,
        primaryFallback: false,
        exchangeRequestsDuringDeferral: false,
        executionAuthorityGranted: false,
      });
      scheduleCanonicalRuntimeInstall(canonicalRuntimeOverflowRetryMs(), 'overflow_schema_not_ready');
      return;
    }

    logger.warn('[CryptoRuntimeStartup] Overflow transport not ready; runtime remains fail-closed without Primary fallback', {
      component: 'CanonicalCryptoCrawlerRuntimeWiring',
      overflowState: overflowBootstrap.state,
      overflowReason: overflowBootstrap.reason,
      overflowSchemaReady: overflowSchema.ready,
      overflowSchemaVersion: overflowSchema.schemaVersion,
      primaryRuntimePrerequisite: false,
      directPrimaryProbe: false,
      primaryFallback: false,
      exchangeRequestsDuringDeferral: false,
      executionAuthorityGranted: false,
    });
    scheduleCanonicalRuntimeInstall(canonicalRuntimeOverflowRetryMs(), 'overflow_transport_not_ready');
    return;
  }

  installCanonicalRuntime();
}

export function activateCanonicalCryptoCrawlerRuntimeWiring(): void {
  runtimeActivationAllowed = true;
  ensureCanonicalCryptoCrawlerRuntimeWiring();
}

export async function deactivateCanonicalCryptoCrawlerRuntimeWiring(): Promise<void> {
  runtimeActivationAllowed = false;

  if (installRetryTimer) clearTimeout(installRetryTimer);
  installRetryTimer = null;

  if (zeroCapitalRetryTimer) clearTimeout(zeroCapitalRetryTimer);
  zeroCapitalRetryTimer = null;

  for (const timer of runtimeComponentRetryTimers.values()) clearTimeout(timer);
  runtimeComponentRetryTimers.clear();

  stopCanonicalZeroCapitalDiscovery();
  multiTopologyDiscoveryController.stop();
  stopPredictionMarketDiscoveryWiring();
  stopOrderBookEvolutionWiring();
  stopCexFourModeObservabilityWiring();
  stopCexInventoryReadinessWiring();
  stopComputationalReactorWiring();
  stopBpsCompressionMesh();
  stopBpsFrontierWave3Wiring();
  stopBpsDecompositionObservability();
  stopEconomicTransformationWiring();
  stopProfitabilityRecoveryCoordinator();
  stopKalshiBpsOptimizationWiring();
  stopFilteredMempoolObservability();
  stopZeroXBudgetObservability();
  stopAcrossBridgeObservability();
  stopCryptoRuntimeObservability();
  stopExpandedNetworkObservability();
  stopExternalCapitalSelectionObserver();
  stopZeroCapitalFundingLifecycleObserver();
  stopCryptaraTwoSpeedRevalidationWiring();

  const { stopTelemetryBootstrap } = await import('./telemetry-bootstrap.js');
  await Promise.allSettled([
    ghostWalletUltraWorker.stop(),
    providerMeshPendingStream.stop(),
    stopTelemetryBootstrap(),
    stopLearningLifecycleWiring(),
    stopMeasuredRebalanceRouteEvidenceWiring(),
  ]);

  installed = false;
  runtimeComponentStates.clear();

  logger.info('[CryptoRuntimeLifecycle] Canonical runtime wiring deactivated by master lifecycle', {
    component: 'CanonicalCryptoCrawlerRuntimeWiring',
    operatorStartRequired: true,
    automaticRestartAllowed: false,
  });
}

export function getCanonicalCryptoCrawlerActivationState(): {
  operatorStartRequired: true;
  activationAllowed: boolean;
  installed: boolean;
} {
  return {
    operatorStartRequired: true,
    activationAllowed: runtimeActivationAllowed,
    installed,
  };
}

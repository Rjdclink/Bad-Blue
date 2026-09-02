import logger from '../../../logger.js';
import { ensureFilteredAlchemyPendingStream } from '../capital-free/alchemy-filtered-pending-stream.js';
import { zeroCapitalEngine } from '../core/zero-capital-engine.js';
import { multiTopologyDiscoveryController } from '../discovery/multi-topology-discovery-controller.js';
import { ensureStageOneBootstrapAuthority } from '../governance/stage-one-bootstrap-authority.js';
import { ensureStageProfitCapRetirement } from '../governance/stage-profit-cap-retirement.js';
import { ensureCanonicalIntelligenceOutbox } from '../intelligence/canonical-intelligence-outbox.js';
import { canonicalIntelligenceRepository } from '../intelligence/canonical-intelligence-repository.js';
import { ensureDynamicScalePressureWiring } from '../scaling/dynamic-scale-pressure-wiring.js';
import { ensureAdaptiveProfitOperationsWiring } from '../runtime/adaptive-profit-operations-wiring.js';
import { ensureAlchemyStandardRpcFirstWiring } from '../runtime/alchemy-standard-rpc-first-wiring.js';
import { ensureDynamicRpcProviderWiring } from '../runtime/dynamic-rpc-provider-wiring.js';
import { ensureHybridCexExecutionWiring } from '../runtime/hybrid-cex-execution-wiring.js';
import { ensureStablecoinMakerExecutionWiring } from '../runtime/stablecoin-maker-execution-wiring.js';
import { ensureStageProofMetricsWiring } from '../runtime/stage-proof-metrics-wiring.js';
import { ensureZeroCapitalRealizedProfitWiring } from '../runtime/zero-capital-realized-profit-wiring.js';
import { ensureAcrossBridgeObservability } from './across-bridge-observability.js';
import { ensureAuthenticatedFeeTierOptimizationWiring } from './authenticated-fee-tier-optimization-wiring.js';
import { ensureCexFourModeObservabilityWiring } from './cex-four-mode-observability-wiring.js';
import { ensureCexInventoryReadinessWiring } from './cex-inventory-readiness-wiring.js';
import { ensureComputationalReactorWiring } from './computational-reactor-wiring.js';
import { ensureCrossVenueTimingGuardWiring } from './cross-venue-timing-guard-wiring.js';
import { ensureCryptaraCexEvidenceWiring } from './cryptara-cex-evidence-wiring.js';
import { ensureCryptaraSovereignCortexWiring } from './cryptara-sovereign-cortex-wiring.js';
import { ensureCryptaraPredictivePrefetchWiring } from './cryptara-predictive-prefetch-wiring.js';
import { ensureDynamicProfitabilityAdmissionWiring } from './dynamic-profitability-admission-wiring.js';
import { ensureExecutionReadinessProfitabilityWiring } from './execution-readiness-profitability-wiring.js';
import { ensureFilteredMempoolObservability } from './filtered-mempool-observability.js';
import { getCryptaraHyperBridgeBootstrapSnapshot } from './cryptara-supabase-hyper-bridge-bootstrap.js';
import { ensureInventoryConstrainedCexExecutionWiring } from './inventory-constrained-cex-execution-wiring.js';
import { ensureMeasuredCandidateExpiryGuardWiring } from './measured-candidate-expiry-guard-wiring.js';
import { logZeroCapitalReadinessDiagnostics } from './zero-capital-readiness-diagnostics.js';
import { ensureLearningLifecycleWiring } from './learning-lifecycle-wiring.js';
import { ensureMonteCarloCalibrationWiring } from './monte-carlo-calibration-wiring.js';
import { ensureOrderBookEvolutionWiring } from './order-book-evolution-wiring.js';
import { ensureOracleEvidenceWiring } from './oracle-evidence-wiring.js';
import { logLegacyIntelligenceQuarantine } from './legacy-intelligence-quarantine.js';
import { ensurePredictionMarketDiscoveryWiring } from './prediction-market-discovery-wiring.js';
import { ensureCryptoRuntimeObservability } from './runtime-observability.js';
import { ensureZeroCapitalResourceWiring } from './zero-capital-resource-wiring.js';
import { ensureZeroCapitalShadowPriorityWiring } from './zero-capital-shadow-priority-wiring.js';
import { ensureZeroCapitalSizeRefinementWiring } from './zero-capital-size-refinement-wiring.js';
import { ensureZeroCapitalJointProviderSizeWiring } from './zero-capital-joint-provider-size-wiring.js';
import { ensureZeroCapitalProfitabilityRescueV2 } from './zero-capital-profitability-rescue-v2.js';
import { ensureZeroCapitalFlashProviderWiring } from './zero-capital-flash-provider-wiring.js';
import { ensureZeroCapitalAtomicStackWiring } from './zero-capital-atomic-stack-wiring.js';
import { ensureZeroCapitalDynamicAttemptBarrierWiring } from './zero-capital-dynamic-attempt-barrier-wiring.js';
import { ensureProviderSpecificZeroCapitalExecutionWiring } from './provider-specific-zero-capital-execution-wiring.js';
import { ensureDualProviderZeroCapitalExecutionWiring } from './dual-provider-zero-capital-execution-wiring.js';
import { ensureZeroXBudgetObservability } from './zerox-budget-observability.js';

let installed = false;
let installRetryTimer: NodeJS.Timeout | null = null;
let zeroCapitalStartPromise: Promise<void> | null = null;
let zeroCapitalRetryTimer: NodeJS.Timeout | null = null;
let zeroCapitalStartAttempts = 0;

function zeroCapitalRetryDelayMs(): number {
  const configured = Number(process.env.ZERO_CAPITAL_RUNTIME_START_RETRY_MS || 15_000);
  return Number.isFinite(configured) ? Math.max(2_500, Math.min(120_000, Math.trunc(configured))) : 15_000;
}

function canonicalRuntimeStartupGraceMs(): number {
  const configured = Number(process.env.CRYPTOCRAWL_RUNTIME_STARTUP_GRACE_MS || 30_000);
  return Number.isFinite(configured) ? Math.max(5_000, Math.min(120_000, Math.trunc(configured))) : 30_000;
}

function canonicalRuntimeOverflowRetryMs(): number {
  const configured = Number(process.env.CRYPTOCRAWL_RUNTIME_DATABASE_RETRY_MS || 5_000);
  return Number.isFinite(configured) ? Math.max(1_000, Math.min(30_000, Math.trunc(configured))) : 5_000;
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

function installCanonicalRuntime(): void {
  if (installed) return;
  installed = true;

  ensureStageProfitCapRetirement();
  logZeroCapitalReadinessDiagnostics();
  ensureComputationalReactorWiring();
  ensureLearningLifecycleWiring();
  ensureMonteCarloCalibrationWiring();
  ensureOracleEvidenceWiring();
  ensureDynamicScalePressureWiring();
  ensureZeroCapitalResourceWiring();
  ensureZeroCapitalShadowPriorityWiring();
  ensureZeroCapitalSizeRefinementWiring();
  ensureZeroCapitalJointProviderSizeWiring();
  ensureZeroCapitalProfitabilityRescueV2();
  ensureZeroCapitalFlashProviderWiring();
  ensureProviderSpecificZeroCapitalExecutionWiring();
  ensureDualProviderZeroCapitalExecutionWiring();
  ensureZeroCapitalAtomicStackWiring();
  ensureZeroCapitalDynamicAttemptBarrierWiring();
  ensureAlchemyStandardRpcFirstWiring();

  // Terminal realized-profit reconciliation must exist before the engine can
  // select native funding or broadcast any zero-capital transaction. The wiring
  // is idempotent, so every lifecycle entry point can safely reassert it.
  ensureZeroCapitalRealizedProfitWiring();
  void ensureDynamicRpcProviderWiring().finally(() => startCanonicalZeroCapitalRuntime());

  ensureOrderBookEvolutionWiring();
  ensureCexFourModeObservabilityWiring();
  ensureCryptaraCexEvidenceWiring();
  ensureCryptaraSovereignCortexWiring();
  ensureCryptaraPredictivePrefetchWiring();
  ensureStablecoinMakerExecutionWiring();
  ensureHybridCexExecutionWiring();
  ensureStageProofMetricsWiring();
  ensureAuthenticatedFeeTierOptimizationWiring();
  ensureAdaptiveProfitOperationsWiring();
  ensureCexInventoryReadinessWiring();
  ensureExecutionReadinessProfitabilityWiring();
  ensureInventoryConstrainedCexExecutionWiring();
  ensureCrossVenueTimingGuardWiring();
  ensureMeasuredCandidateExpiryGuardWiring();
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
    filteredMempoolEvidence: paidAlchemyPendingEvidenceExplicitlyEnabled()
      ? 'alchemy_provider_filtered_hash_first_exact_chain_explicit_opt_in'
      : 'withheld_by_default_cost_policy',
    predictionMarketDiscovery: 'public_no_auth_binary_parity_observation_only',
    predictionMarketExecutionAuthority: false,
    acrossBridgeEvidence: 'current_token_catalog_fresh_quote_rotating_route_sampling',
    acrossBridgeExecutionAuthority: false,
    zeroCapitalRuntimeLifecycle: 'terminal_realized_profit_authority_then_cost_safe_rpc_mesh_then_canonical_wrappers_then_fail_closed_retry',
    zeroCapitalSizeOptimization: 'coarse_independent_quotes_plus_bounded_fresh_local_refinement_plus_exact_provider_size_rescue_plus_profitability_rescue_v2',
    zeroCapitalProfitabilityRescue: 'decimals_correct_gap_aware_fresh_provider_liquidity_bounded_expiry_safe',
    zeroCapitalFlashLoanEconomics: 'measured_single_provider_fee_liquidity_plus_combined_aave_balancer_liquidity_rescue',
    zeroCapitalProviderExecution: 'verified_balancer_aave_or_dual_receiver_permission_binding',
    zeroCapitalProviderMesh: 'balancer_or_aave_or_balancer_outer_plus_nested_aave_when_combined_liquidity_unlocks_exact_size',
    zeroCapitalProviderMeshSinglePreferredWhenSufficient: true,
    zeroCapitalAtomicStacking: 'same_chain_same_token_exact_simulation_shared_principal_composite_v2',
    zeroCapitalAtomicStackExecutionAuthority: false,
    zeroCapitalDynamicAttemptBarrier: 'exact_provider_specific_eth_call_plus_exact_gas_estimate_then_dynamic_profit_cushion_vs_failed_attempt_exposure_defer_and_requote',
    zeroCapitalDynamicAttemptBarrierExecutionAuthority: false,
    zeroCapitalExecutionAdmission: 'resource_leases_plus_dynamic_profitability_confidence',
    zeroCapitalWorkOrdering: 'expected_net_profit_per_scarcity_unit_with_expiry_urgency_scheduling_only',
    alchemyPaidPendingStreamDefault: false,
    paidAlchemyRpcRole: 'fallback_only_after_two_cost_safe_provider_failures_when_available',
    alchemyStandardTokenReads: 'public_rpc_first_then_enhanced_api_fallback',
    localComputeRole: 'ComputationalBeam_Aries_Cryptara',
    runtimeHeartbeat: true,
    startupAdmission: 'production_grace_then_overflow_authority_only_no_primary_probe_or_fallback',
    startupGraceMs: canonicalRuntimeStartupGraceMs(),
  });
}

function scheduleCanonicalRuntimeInstall(delayMs: number, reason: string): void {
  if (installed || installRetryTimer) return;
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

export function ensureCanonicalCryptoCrawlerRuntimeWiring(): void {
  if (installed) return;

  if (process.env.NODE_ENV === 'production') {
    const graceRemainingMs = Math.max(0, canonicalRuntimeStartupGraceMs() - Math.floor(process.uptime() * 1_000));
    if (graceRemainingMs > 0) {
      scheduleCanonicalRuntimeInstall(graceRemainingMs, 'production_startup_grace');
      return;
    }

    const overflowBootstrap = getCryptaraHyperBridgeBootstrapSnapshot();
    if (overflowBootstrap.state === 'ready') {
      logger.info('[CryptoRuntimeStartup] Overflow authority ready; installing canonical runtime with all Primary admission/recovery paths disabled', {
        component: 'CanonicalCryptoCrawlerRuntimeWiring',
        dataPlane: 'overflow_authority',
        primaryRuntimePrerequisite: false,
        directPrimaryProbe: false,
        primaryFallback: false,
        recoveryPolling: false,
        executionAuthorityGranted: false,
      });
      installCanonicalRuntime();
      return;
    }

    logger.warn('[CryptoRuntimeStartup] Overflow authority not ready; runtime remains fail-closed without Primary fallback', {
      component: 'CanonicalCryptoCrawlerRuntimeWiring',
      overflowState: overflowBootstrap.state,
      overflowReason: overflowBootstrap.reason,
      primaryRuntimePrerequisite: false,
      directPrimaryProbe: false,
      primaryFallback: false,
      exchangeRequestsDuringDeferral: false,
      executionAuthorityGranted: false,
    });
    scheduleCanonicalRuntimeInstall(canonicalRuntimeOverflowRetryMs(), 'overflow_authority_not_ready');
    return;
  }

  installCanonicalRuntime();
}

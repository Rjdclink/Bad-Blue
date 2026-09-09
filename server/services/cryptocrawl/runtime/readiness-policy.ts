export interface CryptoRuntimeReadinessInput {
  runtimeIdentitySafe: boolean;
  runtimeIdentityMismatch: boolean;
  centralizedExecutionConfigured: boolean;
  coreMarketDataReady: boolean;
  criticalRpcReady: boolean;
  graphReady: boolean;
  discoveryEvidenceCount: number;
  canonicalObservedOpportunities: number;
  schedulerRunning: boolean;
  noExecutionGuardEnabled: boolean;
  liveExecutionEnabled: boolean;
  liveExecutionConfirmed: boolean;
  reconciledInventoryAssets: number;
  spendableInventoryAssets: number;
  spendableInventoryVenues: number;
  eligibleCandidates: number;
  eligibleCexCandidates: number;
  eligibleZeroCapitalCandidates: number;
  /** Kalshi prediction/funding candidates are a separate non-CEX topology. */
  eligibleKalshiCandidates?: number;
  /** True only when at least one authenticated Kalshi execution credential family exists. */
  kalshiExecutionConfigured?: boolean;
  stageCanExecute: boolean;
  currentStage: number;
  /**
   * Legacy StageManager/global-runtime readiness. This is not sufficient evidence
   * that a strict zero-initial-capital funding lane is currently usable.
   */
  initialGasReady: boolean;
  /**
   * Route-local strict zero-capital funding proof. Callers that do not yet supply
   * this field fail closed instead of converting global wallet/RPC readiness into
   * a false zero-personal-cost funding claim.
   */
  zeroCapitalFundingReady?: boolean;
  zeroCapitalExecutionEnabled: boolean;
}

export type RuntimeReadinessCheck = {
  ready: boolean;
  detail: string;
  scope?: 'identity' | 'configuration' | 'data' | 'discovery' | 'capability' | 'resource' | 'candidate' | 'governance' | 'trade';
};

export type CryptoRuntimeReadiness = {
  APP_READY: RuntimeReadinessCheck;
  CONFIG_READY: RuntimeReadinessCheck;
  DATA_READY: RuntimeReadinessCheck;
  DISCOVERY_READY: RuntimeReadinessCheck;
  EXECUTION_CAPABILITY_READY: RuntimeReadinessCheck;
  INVENTORY_READY: RuntimeReadinessCheck;
  CANDIDATE_READY: RuntimeReadinessCheck;
  GOVERNANCE_READY: RuntimeReadinessCheck;
  EXECUTION_READY: RuntimeReadinessCheck;
  TRADING_READY: RuntimeReadinessCheck;
};

/**
 * Pure readiness policy used only for truthful observability. It does not grant
 * execution permission and does not replace StageManager, the canonical
 * scheduler, deterministic economics, topology-specific resource reservations,
 * or settlement.
 *
 * Overall readiness is topology-aware. CEX inventory is required only for CEX
 * plans. A proven zero-initial-capital atomic lane may satisfy resource/trading
 * readiness without CEX balances. Kalshi remains a separate execution domain;
 * credentials and candidates are surfaced here, while its own canonical cash /
 * margin reservation authorities remain fail-closed at admission/execution time.
 */
export function computeCryptoRuntimeReadiness(input: CryptoRuntimeReadinessInput): CryptoRuntimeReadiness {
  const baseExecutionCapabilityReady = input.runtimeIdentitySafe
    && !input.noExecutionGuardEnabled
    && input.liveExecutionEnabled
    && input.liveExecutionConfirmed
    && input.schedulerRunning;

  const cexExecutionCapabilityReady = baseExecutionCapabilityReady && input.centralizedExecutionConfigured;
  const zeroCapitalExecutionCapabilityReady = baseExecutionCapabilityReady && input.zeroCapitalExecutionEnabled;
  const kalshiExecutionConfigured = input.kalshiExecutionConfigured === true;
  const kalshiExecutionCapabilityReady = baseExecutionCapabilityReady && kalshiExecutionConfigured;
  const executionCapabilityReady = cexExecutionCapabilityReady
    || zeroCapitalExecutionCapabilityReady
    || kalshiExecutionCapabilityReady;

  const inventoryReady = input.spendableInventoryAssets > 0 && input.spendableInventoryVenues >= 2;
  const zeroCapitalFundingReady = input.zeroCapitalFundingReady === true;
  const zeroCapitalResourceReady = input.zeroCapitalExecutionEnabled && zeroCapitalFundingReady && input.criticalRpcReady;
  const resourceReady = inventoryReady || zeroCapitalResourceReady;

  const cexCandidateReady = input.eligibleCexCandidates > 0;
  const zeroCapitalCandidateReady = input.eligibleZeroCapitalCandidates > 0;
  const eligibleKalshiCandidates = Math.max(0, input.eligibleKalshiCandidates ?? 0);
  const kalshiCandidateReady = eligibleKalshiCandidates > 0;
  const candidateReady = cexCandidateReady || zeroCapitalCandidateReady || kalshiCandidateReady;
  const governanceReady = input.stageCanExecute;

  const cexTradingReady = cexExecutionCapabilityReady && governanceReady && cexCandidateReady && inventoryReady;
  const zeroCapitalTradingReady = zeroCapitalExecutionCapabilityReady
    && governanceReady
    && zeroCapitalCandidateReady
    && zeroCapitalResourceReady;
  // Kalshi resource ownership/reservation is intentionally not inferred here.
  // Its event/funding lifecycles remain the authority for cash/margin readiness.
  const tradingReady = cexTradingReady || zeroCapitalTradingReady;
  const tradingDetail = `runtimeIdentitySafe=${input.runtimeIdentitySafe}; baseCapability=${baseExecutionCapabilityReady}; cexCapability=${cexExecutionCapabilityReady}; zeroCapitalCapability=${zeroCapitalExecutionCapabilityReady}; kalshiCapability=${kalshiExecutionCapabilityReady}; governance=${governanceReady}; cexCandidate=${cexCandidateReady}; zeroCapitalCandidate=${zeroCapitalCandidateReady}; kalshiCandidate=${kalshiCandidateReady}; cexInventory=${inventoryReady}; zeroCapitalFundingReady=${zeroCapitalFundingReady}; zeroCapitalResourceReady=${zeroCapitalResourceReady}; inventoryAssets=${input.reconciledInventoryAssets}; spendableInventoryAssets=${input.spendableInventoryAssets}; spendableInventoryVenues=${input.spendableInventoryVenues}; eligibleCexCandidates=${input.eligibleCexCandidates}; eligibleZeroCapitalCandidates=${input.eligibleZeroCapitalCandidates}; eligibleKalshiCandidates=${eligibleKalshiCandidates}. CEX inventory gates only CEX plans; proven zero-capital resources are a first-class primary resource path. Kalshi cash/margin remains topology-local and fail-closed. Final trade admission still requires deterministic positive economics and canonical resource reservation.`;

  return {
    APP_READY: {
      ready: input.runtimeIdentitySafe,
      scope: 'identity',
      detail: input.runtimeIdentityMismatch
        ? 'runtime source/deployment identity mismatch detected'
        : input.runtimeIdentitySafe
          ? 'process is running and runtime identity satisfies this environment\'s admission policy'
          : 'runtime identity lacks independently verified build/deployment agreement',
    },
    CONFIG_READY: {
      ready: input.centralizedExecutionConfigured || input.zeroCapitalExecutionEnabled || kalshiExecutionConfigured,
      scope: 'configuration',
      detail: `cexConfigured=${input.centralizedExecutionConfigured}; zeroCapitalExecutionEnabled=${input.zeroCapitalExecutionEnabled}; kalshiExecutionConfigured=${kalshiExecutionConfigured}`,
    },
    DATA_READY: {
      ready: input.coreMarketDataReady,
      scope: 'data',
      detail: `coreCexMarketData=${input.coreMarketDataReady}; blockchainRpc=${input.criticalRpcReady} (RPC is topology-local and not required for core CEX discovery)`,
    },
    DISCOVERY_READY: {
      // Discovery answers whether measured search is running and producing
      // evidence. Candidate profitability is intentionally owned by
      // CANDIDATE_READY and must not make discovery itself appear broken.
      ready: input.graphReady && input.discoveryEvidenceCount > 0,
      scope: 'discovery',
      detail: `graphFresh=${input.graphReady}; discoveryEvidence=${input.discoveryEvidenceCount}; canonicalObserved=${input.canonicalObservedOpportunities}`,
    },
    EXECUTION_CAPABILITY_READY: {
      ready: executionCapabilityReady,
      scope: 'capability',
      detail: `runtimeIdentitySafe=${input.runtimeIdentitySafe}; guard=${input.noExecutionGuardEnabled}; enabled=${input.liveExecutionEnabled}; confirmed=${input.liveExecutionConfirmed}; schedulerRunning=${input.schedulerRunning}; cexCapability=${cexExecutionCapabilityReady}; zeroCapitalCapability=${zeroCapitalExecutionCapabilityReady}; kalshiCapability=${kalshiExecutionCapabilityReady}. Capability readiness does not imply that any topology has resources or an eligible candidate.`,
    },
    INVENTORY_READY: {
      ready: resourceReady,
      scope: 'resource',
      detail: `resourceReady=${resourceReady}; cexInventoryReady=${inventoryReady}; reconciledCexInventoryAssets=${input.reconciledInventoryAssets}; spendableCexInventoryAssets=${input.spendableInventoryAssets}; spendableCexInventoryVenues=${input.spendableInventoryVenues}; zeroCapitalFundingReady=${zeroCapitalFundingReady}; zeroCapitalResourceReady=${zeroCapitalResourceReady}. CEX inventory is redundancy for the zero-capital topology and remains mandatory only for CEX plans.`,
    },
    CANDIDATE_READY: {
      ready: candidateReady,
      scope: 'candidate',
      detail: `eligibleCexCandidates=${input.eligibleCexCandidates}; eligibleZeroCapitalCandidates=${input.eligibleZeroCapitalCandidates}; eligibleKalshiCandidates=${eligibleKalshiCandidates}; eligibleCandidatesAllTopologies=${input.eligibleCandidates}`,
    },
    GOVERNANCE_READY: {
      ready: governanceReady,
      scope: 'governance',
      detail: `stage=${input.currentStage}; stageCanExecute=${input.stageCanExecute}`,
    },
    EXECUTION_READY: {
      ready: tradingReady,
      scope: 'trade',
      detail: `topology-aware execution readiness; ${tradingDetail}`,
    },
    TRADING_READY: {
      ready: tradingReady,
      scope: 'trade',
      detail: tradingDetail,
    },
  };
}

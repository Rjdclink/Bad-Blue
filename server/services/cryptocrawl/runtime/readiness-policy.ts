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
 * scheduler, deterministic economics, resource reservations, or settlement.
 *
 * ZERO_CAPITAL_ATOMIC is the bootstrap/primary capital topology. Existing CEX
 * inventory is a parallel/redundant topology once capital exists; it is never a
 * prerequisite for a strictly proven zero-capital route. Resource truth remains
 * topology-local: zero-capital funding cannot authorize a CEX plan, and CEX
 * balances cannot authorize a zero-capital plan.
 */
export function computeCryptoRuntimeReadiness(input: CryptoRuntimeReadinessInput): CryptoRuntimeReadiness {
  const baseExecutionCapability = input.runtimeIdentitySafe
    && !input.noExecutionGuardEnabled
    && input.liveExecutionEnabled
    && input.liveExecutionConfirmed
    && input.schedulerRunning;
  const cexExecutionCapability = baseExecutionCapability && input.centralizedExecutionConfigured;
  const zeroCapitalExecutionCapability = baseExecutionCapability && input.zeroCapitalExecutionEnabled;
  const configuredTopologyReady = input.centralizedExecutionConfigured || input.zeroCapitalExecutionEnabled;

  const cexInventoryReady = input.spendableInventoryAssets > 0 && input.spendableInventoryVenues >= 2;
  const zeroCapitalFundingReady = input.zeroCapitalFundingReady === true;
  const zeroCapitalResourceReady = input.zeroCapitalExecutionEnabled && zeroCapitalFundingReady && input.criticalRpcReady;
  const anyResourceReady = cexInventoryReady || zeroCapitalResourceReady;

  const cexCandidateReady = input.eligibleCexCandidates > 0;
  const zeroCapitalCandidateReady = input.eligibleZeroCapitalCandidates > 0;
  const anyCandidateReady = cexCandidateReady || zeroCapitalCandidateReady;
  const governanceReady = input.stageCanExecute;

  const cexTradingReady = cexExecutionCapability && governanceReady && cexCandidateReady && cexInventoryReady;
  const zeroCapitalTradingReady = zeroCapitalExecutionCapability && governanceReady && zeroCapitalCandidateReady && zeroCapitalResourceReady;
  const tradingReady = cexTradingReady || zeroCapitalTradingReady;
  const tradingDetail = `runtimeIdentitySafe=${input.runtimeIdentitySafe}; baseCapability=${baseExecutionCapability}; governance=${governanceReady}; cexCapability=${cexExecutionCapability}; cexCandidate=${cexCandidateReady}; cexInventory=${cexInventoryReady}; zeroCapitalCapability=${zeroCapitalExecutionCapability}; zeroCapitalCandidate=${zeroCapitalCandidateReady}; zeroCapitalFundingReady=${zeroCapitalFundingReady}; zeroCapitalRpcReady=${input.criticalRpcReady}; zeroCapitalResourceReady=${zeroCapitalResourceReady}; cexTradingReady=${cexTradingReady}; zeroCapitalTradingReady=${zeroCapitalTradingReady}; reconciledCexInventoryAssets=${input.reconciledInventoryAssets}; spendableCexInventoryAssets=${input.spendableInventoryAssets}; spendableCexInventoryVenues=${input.spendableInventoryVenues}; eligibleCexCandidates=${input.eligibleCexCandidates}; eligibleZeroCapitalCandidates=${input.eligibleZeroCapitalCandidates}. Each topology still requires its own deterministic economics, exact resource proof, canonical scheduler admission and terminal settlement.`;

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
      ready: configuredTopologyReady,
      scope: 'configuration',
      detail: `centralizedExecutionConfigured=${input.centralizedExecutionConfigured}; zeroCapitalExecutionEnabled=${input.zeroCapitalExecutionEnabled}. At least one canonical execution topology must be configured; configuration alone never grants trade authority.`,
    },
    DATA_READY: {
      ready: input.coreMarketDataReady,
      scope: 'data',
      detail: `coreCexMarketData=${input.coreMarketDataReady}; blockchainRpc=${input.criticalRpcReady} (RPC is topology-local and required for zero-capital/on-chain execution, not for core CEX discovery)`,
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
      ready: baseExecutionCapability && configuredTopologyReady,
      scope: 'capability',
      detail: `runtimeIdentitySafe=${input.runtimeIdentitySafe}; guard=${input.noExecutionGuardEnabled}; enabled=${input.liveExecutionEnabled}; confirmed=${input.liveExecutionConfirmed}; schedulerRunning=${input.schedulerRunning}; cexConfigured=${input.centralizedExecutionConfigured}; zeroCapitalEnabled=${input.zeroCapitalExecutionEnabled}. Capability readiness does not imply that a topology has a qualifying candidate or its exact resource proof.`,
    },
    INVENTORY_READY: {
      // Historical name retained for API compatibility. This now reports whether
      // at least one canonical trading topology has its required resource. Zero-
      // capital bootstrap intentionally does not require pre-existing CEX funds.
      ready: anyResourceReady,
      scope: 'resource',
      detail: `cexInventoryReady=${cexInventoryReady}; reconciledCexInventoryAssets=${input.reconciledInventoryAssets}; spendableCexInventoryAssets=${input.spendableInventoryAssets}; spendableCexInventoryVenues=${input.spendableInventoryVenues}; zeroCapitalFundingReady=${zeroCapitalFundingReady}; zeroCapitalResourceReady=${zeroCapitalResourceReady}. CEX inventory is a parallel/redundant resource and is not a prerequisite for a proven ZERO_CAPITAL_ATOMIC route. Resources never cross-authorize another topology.`,
    },
    CANDIDATE_READY: {
      ready: anyCandidateReady,
      scope: 'candidate',
      detail: `eligibleCexCandidates=${input.eligibleCexCandidates}; eligibleZeroCapitalCandidates=${input.eligibleZeroCapitalCandidates}; eligibleCandidatesAllTopologies=${input.eligibleCandidates}. Candidate readiness means at least one supported canonical topology has an eligible candidate; execution still requires the matching topology resource.`,
    },
    GOVERNANCE_READY: {
      ready: governanceReady,
      scope: 'governance',
      detail: `stage=${input.currentStage}; stageCanExecute=${input.stageCanExecute}`,
    },
    EXECUTION_READY: {
      ready: tradingReady,
      scope: 'trade',
      detail: `topology-specific canonical execution readiness; ${tradingDetail}`,
    },
    TRADING_READY: {
      ready: tradingReady,
      scope: 'trade',
      detail: tradingDetail,
    },
  };
}

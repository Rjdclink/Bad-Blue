export interface CryptoRuntimeReadinessInput {
  runtimeIdentitySafe: boolean;
  runtimeIdentityMismatch: boolean;
  centralizedExecutionConfigured: boolean;
  coreMarketDataReady: boolean;
  criticalRpcReady: boolean;
  graphReady: boolean;
  observedOpportunities: number;
  schedulerRunning: boolean;
  noExecutionGuardEnabled: boolean;
  liveExecutionEnabled: boolean;
  liveExecutionConfirmed: boolean;
  reconciledInventoryAssets: number;
  eligibleCandidates: number;
  eligibleCexCandidates: number;
  eligibleZeroCapitalCandidates: number;
  stageCanExecute: boolean;
  currentStage: number;
  initialGasReady: boolean;
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
 * EXECUTION_READY/TRADING_READY describe the canonical Kraken/OKX CEX scheduler.
 * Zero-capital gas readiness is a different topology and therefore cannot satisfy
 * a missing CEX inventory requirement. Likewise, optional blockchain RPC health
 * does not make core CEX market-data readiness false.
 */
export function computeCryptoRuntimeReadiness(input: CryptoRuntimeReadinessInput): CryptoRuntimeReadiness {
  const executionCapabilityReady = !input.noExecutionGuardEnabled
    && input.liveExecutionEnabled
    && input.liveExecutionConfirmed
    && input.centralizedExecutionConfigured
    && input.schedulerRunning;

  const inventoryReady = input.reconciledInventoryAssets > 0;
  const zeroCapitalResourceReady = input.zeroCapitalExecutionEnabled && input.initialGasReady && input.criticalRpcReady;
  const cexCandidateReady = input.eligibleCexCandidates > 0;
  const governanceReady = input.stageCanExecute;
  const cexResourceReady = inventoryReady;
  const tradingReady = executionCapabilityReady && governanceReady && cexCandidateReady && cexResourceReady;
  const tradingDetail = `canonicalCexCapability=${executionCapabilityReady}; governance=${governanceReady}; cexCandidate=${cexCandidateReady}; cexInventory=${cexResourceReady}; inventoryAssets=${input.reconciledInventoryAssets}; eligibleCexCandidates=${input.eligibleCexCandidates}; eligibleZeroCapitalCandidates=${input.eligibleZeroCapitalCandidates}; zeroCapitalResourceReady=${zeroCapitalResourceReady}. Zero-capital resources never substitute for CEX inventory. Final trade admission still requires topology-specific deterministic economics and canonical scheduler resource reservation.`;

  return {
    APP_READY: {
      ready: input.runtimeIdentitySafe,
      scope: 'identity',
      detail: input.runtimeIdentityMismatch
        ? 'runtime source/deployment identity mismatch detected'
        : 'process is running and runtime identity has no detected mismatch',
    },
    CONFIG_READY: {
      ready: input.centralizedExecutionConfigured,
      scope: 'configuration',
      detail: input.centralizedExecutionConfigured
        ? 'Kraken and OKX execution credentials are visible to this runtime'
        : 'one or more settlement-safe centralized execution credentials are not visible',
    },
    DATA_READY: {
      ready: input.coreMarketDataReady,
      scope: 'data',
      detail: `coreCexMarketData=${input.coreMarketDataReady}; blockchainRpc=${input.criticalRpcReady} (RPC is topology-local and not required for core CEX discovery)`,
    },
    DISCOVERY_READY: {
      ready: input.graphReady && input.observedOpportunities > 0,
      scope: 'discovery',
      detail: `graphFresh=${input.graphReady}; canonicalObserved=${input.observedOpportunities}`,
    },
    EXECUTION_CAPABILITY_READY: {
      ready: executionCapabilityReady,
      scope: 'capability',
      detail: `guard=${input.noExecutionGuardEnabled}; enabled=${input.liveExecutionEnabled}; confirmed=${input.liveExecutionConfirmed}; cexConfigured=${input.centralizedExecutionConfigured}; schedulerRunning=${input.schedulerRunning}. Capability readiness does not imply that a trade has CEX inventory, an eligible CEX candidate, or governance authorization.`,
    },
    INVENTORY_READY: {
      ready: inventoryReady,
      scope: 'resource',
      detail: `reconciledCexInventoryAssets=${input.reconciledInventoryAssets}; zeroCapitalResourceReady=${zeroCapitalResourceReady}. These are separate topology resources.`,
    },
    CANDIDATE_READY: {
      ready: cexCandidateReady,
      scope: 'candidate',
      detail: `eligibleCexCandidates=${input.eligibleCexCandidates}; eligibleCandidatesAllTopologies=${input.eligibleCandidates}; eligibleZeroCapitalCandidates=${input.eligibleZeroCapitalCandidates}`,
    },
    GOVERNANCE_READY: {
      ready: governanceReady,
      scope: 'governance',
      detail: `stage=${input.currentStage}; stageCanExecute=${input.stageCanExecute}`,
    },
    EXECUTION_READY: {
      ready: tradingReady,
      scope: 'trade',
      detail: `strict canonical CEX execution readiness alias; ${tradingDetail}`,
    },
    TRADING_READY: {
      ready: tradingReady,
      scope: 'trade',
      detail: tradingDetail,
    },
  };
}

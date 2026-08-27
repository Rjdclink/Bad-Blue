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
  TRADING_READY: RuntimeReadinessCheck;
};

/**
 * Pure readiness policy used only for truthful observability. It does not grant
 * execution permission and does not replace StageManager, the canonical
 * scheduler, deterministic economics, resource reservations, or settlement.
 */
export function computeCryptoRuntimeReadiness(input: CryptoRuntimeReadinessInput): CryptoRuntimeReadiness {
  const executionCapabilityReady = !input.noExecutionGuardEnabled
    && input.liveExecutionEnabled
    && input.liveExecutionConfirmed
    && input.centralizedExecutionConfigured
    && input.schedulerRunning;

  const inventoryReady = input.reconciledInventoryAssets > 0;
  const zeroCapitalResourceReady = input.zeroCapitalExecutionEnabled && input.initialGasReady;
  const resourceReady = inventoryReady || zeroCapitalResourceReady;
  const candidateReady = input.eligibleCandidates > 0;
  const governanceReady = input.stageCanExecute;

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
      ready: input.coreMarketDataReady && input.criticalRpcReady,
      scope: 'data',
      detail: `coreMarketData=${input.coreMarketDataReady}; rpc=${input.criticalRpcReady}`,
    },
    DISCOVERY_READY: {
      ready: input.graphReady && input.observedOpportunities > 0,
      scope: 'discovery',
      detail: `graphFresh=${input.graphReady}; canonicalObserved=${input.observedOpportunities}`,
    },
    EXECUTION_CAPABILITY_READY: {
      ready: executionCapabilityReady,
      scope: 'capability',
      detail: `guard=${input.noExecutionGuardEnabled}; enabled=${input.liveExecutionEnabled}; confirmed=${input.liveExecutionConfirmed}; cexConfigured=${input.centralizedExecutionConfigured}; schedulerRunning=${input.schedulerRunning}. Capability readiness does not imply that a trade has inventory, a candidate, or governance authorization.`,
    },
    INVENTORY_READY: {
      ready: inventoryReady,
      scope: 'resource',
      detail: `reconciledInventoryAssets=${input.reconciledInventoryAssets}; zeroCapitalResourceReady=${zeroCapitalResourceReady}. Inventory readiness is topology-specific and is not a global CEX/DEX startup dependency.`,
    },
    CANDIDATE_READY: {
      ready: candidateReady,
      scope: 'candidate',
      detail: `eligibleCandidates=${input.eligibleCandidates}`,
    },
    GOVERNANCE_READY: {
      ready: governanceReady,
      scope: 'governance',
      detail: `stage=${input.currentStage}; stageCanExecute=${input.stageCanExecute}`,
    },
    TRADING_READY: {
      ready: executionCapabilityReady && governanceReady && candidateReady && resourceReady,
      scope: 'trade',
      detail: `capability=${executionCapabilityReady}; governance=${governanceReady}; candidate=${candidateReady}; resource=${resourceReady}; inventoryAssets=${input.reconciledInventoryAssets}; zeroCapitalResourceReady=${zeroCapitalResourceReady}. Final trade admission still requires topology-specific deterministic economics and canonical scheduler resource reservation.`,
    },
  };
}

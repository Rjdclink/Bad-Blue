import logger from '../../../logger.js';
import { alchemyIntegration } from '../capital-free/alchemy-integration.js';
import { multiProviderRpcManager, type SupportedChain } from '../api/blockchain-providers.js';
import { getVenueCapabilities } from '../discovery/venue-capability-registry.js';
import { measuredOpportunityGraph } from '../discovery/opportunity-graph.js';
import { multiTopologyDiscoveryController } from '../discovery/multi-topology-discovery-controller.js';
import { measuredCandidateRegistry } from '../discovery/measured-candidate-registry.js';
import { getMempoolCapabilities } from '../discovery/mempool-capability-registry.js';
import { canonicalExecutionScheduler } from '../execution/canonical-execution-scheduler.js';
import { cexInventoryLedger } from '../execution/cex-inventory-ledger.js';
import { inventoryRebalancer } from '../execution/inventory-rebalancer.js';
import { marketDataProviders } from '../intelligence/market-data-providers.js';
import { canonicalOpportunityState } from '../intelligence/canonical-opportunity-state.js';
import { stageManager } from '../governance/stage-management.js';
import { workloadRouter } from '../../computationalBeam/workloadRouter.js';
import { getMeasuredEvolutionMetrics } from '../evolution/measured-execution-feedback.js';
import { monteCarloCalibrationStore } from '../validation/monte-carlo-calibration-store.js';
import { orderBookEvolutionStore } from '../validation/order-book-evolution-store.js';
import { resolveCoinStatsEnvironment } from '../runtime/environment-contract.js';
import { getCryptoCrawlerRuntimeAttestation, isRuntimeIdentitySafe } from '../runtime/runtime-attestation.js';
import { computeCryptoRuntimeReadiness } from '../runtime/readiness-policy.js';

const CHAINS: SupportedChain[] = [
  'ethereum',
  'polygon',
  'arbitrum',
  'optimism',
  'base',
  'avalanche',
  'bsc',
];

let heartbeatTimer: NodeJS.Timeout | null = null;
let heartbeatRunning = false;

function blockchainProviderSnapshot() {
  return CHAINS.map(chain => ({
    chain,
    providers: multiProviderRpcManager.getHealth(chain).map(observation => ({
      provider: observation.provider,
      http: observation.http.success ? 'healthy' : observation.http.state,
      lastError: observation.http.lastError || null,
    })),
  }));
}

function executionConfiguration() {
  const krakenConfigured = !!(process.env.KRAKEN_API_KEY?.trim() && process.env.KRAKEN_API_SECRET?.trim());
  const okxConfigured = !!(
    process.env.OKX_API_KEY?.trim()
    && process.env.OKX_API_SECRET?.trim()
    && process.env.OKX_API_PASSPHRASE?.trim()
  );
  const noExecutionGuardEnabled = process.env.NO_EXECUTION === 'true';
  const liveExecutionEnabled = process.env.CRYPTO_ARBITRAGE_LIVE_EXECUTION === 'true';
  const liveExecutionConfirmed = process.env.CRYPTO_ARBITRAGE_LIVE_CONFIRMATION === 'I_ACCEPT_LIVE_ORDER_RISK';
  return {
    krakenConfigured,
    okxConfigured,
    noExecutionGuardEnabled,
    liveExecutionEnabled,
    liveExecutionConfirmed,
    centralizedExecutionConfigured: krakenConfigured && okxConfigured,
  };
}

export async function emitCryptoRuntimeHeartbeat(): Promise<void> {
  if (heartbeatRunning) return;
  heartbeatRunning = true;
  try {
    const [alchemy, beam] = await Promise.all([
      alchemyIntegration.readinessCheck({ strictLive: false }).catch(error => ({
        ready: false,
        active: false,
        degraded: true,
        detail: error instanceof Error ? error.message : String(error),
      })),
      Promise.resolve(workloadRouter.getSystemStatus()),
    ]);
    const recentMinute = canonicalOpportunityState.getMetrics(60_000);
    const recentHour = canonicalOpportunityState.getMetrics(60 * 60_000);
    const latest = canonicalOpportunityState.getLatest();
    const graph = measuredOpportunityGraph.getLatestCycle();
    const multiTopology = multiTopologyDiscoveryController.getLatestCycle();
    const candidateMetrics = measuredCandidateRegistry.getMetrics(60_000);
    const scheduler = canonicalExecutionScheduler.getStats();
    const stage = stageManager.getState();
    const measured = getMeasuredEvolutionMetrics();
    const runtime = getCryptoCrawlerRuntimeAttestation();
    const execution = executionConfiguration();
    const providerStatuses = marketDataProviders.getProviderStatuses();
    const coreMarketDataReady = providerStatuses.some(status =>
      status.provider === 'coingecko' && ['live', 'cached', 'stale'].includes(status.state),
    );
    const coinStatsEnvironment = resolveCoinStatsEnvironment();
    const rpcSnapshot = blockchainProviderSnapshot();
    const criticalRpcReady = rpcSnapshot.some(chain => chain.providers.some(provider => provider.http === 'healthy'));
    const graphFreshMs = Math.max(15_000, Number(process.env.CRYPTOCRAWL_OPPORTUNITY_GRAPH_FRESH_MS || 30_000));
    const graphReady = !!graph && graph.completedAt >= Date.now() - graphFreshMs && graph.evaluatedSymbols > 0;
    const inventory = cexInventoryLedger.getSnapshots();
    const rebalance = inventoryRebalancer.getStatus();
    const mcCalibration = monteCarloCalibrationStore.getMetrics();
    const bookEvolution = orderBookEvolutionStore.getStatus();
    const mempoolCapabilities = getMempoolCapabilities();
    const zeroCapitalExecutionEnabled = process.env.ZERO_CAPITAL_ENABLE_EXECUTION === 'true';
    const stageCanExecute = stageManager.canExecuteTrades();

    const readiness = computeCryptoRuntimeReadiness({
      runtimeIdentitySafe: isRuntimeIdentitySafe(runtime),
      runtimeIdentityMismatch: runtime.state === 'mismatch',
      centralizedExecutionConfigured: execution.centralizedExecutionConfigured,
      coreMarketDataReady,
      criticalRpcReady,
      graphReady,
      observedOpportunities: recentMinute.observedOpportunities,
      schedulerRunning: scheduler.running,
      noExecutionGuardEnabled: execution.noExecutionGuardEnabled,
      liveExecutionEnabled: execution.liveExecutionEnabled,
      liveExecutionConfirmed: execution.liveExecutionConfirmed,
      reconciledInventoryAssets: inventory.length,
      eligibleCandidates: recentMinute.eligibleOpportunities,
      stageCanExecute,
      currentStage: stage.currentStage,
      initialGasReady: stageManager.isInitialGasReady(),
      zeroCapitalExecutionEnabled,
    });

    // Preserve the high-value discovery context alongside the pure policy output.
    readiness.DISCOVERY_READY.detail += `; selectedSymbols=${graph?.selectedSymbols ?? 0}; multiTopologyObserved=${candidateMetrics.observed}`;

    logger.info('[CryptoRuntime] Authoritative runtime heartbeat', {
      component: 'CryptoRuntimeObservability',
      runtime,
      readiness,
      governance: {
        stage: stage.currentStage,
        paused: stage.isPaused,
        killSwitchActive: stage.killSwitchActive,
        canExecuteTrades: stageCanExecute,
        initialGasReady: stageManager.isInitialGasReady(),
        automaticAdvancementBlockers: [...stage.automaticAdvancementBlockers],
      },
      discovery: {
        cex: graph ? {
          cycleId: graph.cycleId,
          topology: graph.topology,
          startedAt: graph.startedAt,
          completedAt: graph.completedAt,
          universeAssets: graph.universeAssets,
          selectedSymbols: graph.selectedSymbols,
          evaluatedSymbols: graph.evaluatedSymbols,
          deterministicPositive: graph.deterministicPositive,
          assessedCandidates: graph.assessedCandidates,
          eligibleCandidates: graph.eligibleCandidates,
          capacity: graph.capacity,
          errors: graph.errors,
        } : null,
        multiTopology,
        candidateRegistry: candidateMetrics,
      },
      opportunities: {
        observedPerMinute: recentMinute.observedOpportunities,
        verifiedPositivePerMinute: recentMinute.verifiedPositiveOpportunities,
        eligiblePerMinute: recentMinute.eligibleOpportunities,
        expectedNetProfitLastHourUsd: recentHour.expectedNetProfitUsd,
        realizedNetProfitLastHourUsd: recentHour.realizedNetProfitUsd,
        realizedSettlementsLastHour: recentHour.realizedSettlementCount,
      },
      latestDecision: latest ? {
        opportunityId: latest.opportunityId,
        symbol: latest.symbol,
        chain: latest.chain,
        status: latest.status,
        buyVenue: latest.plan?.buyVenue ?? null,
        sellVenue: latest.plan?.sellVenue ?? null,
        buyAsk: latest.plan?.buyAsk ?? null,
        sellBid: latest.plan?.sellBid ?? null,
        executableNotionalUsd: latest.plan?.executableNotionalUsd ?? null,
        grossProfitUsd: latest.plan?.grossProfitUsd ?? null,
        netProfitUsd: latest.plan?.netProfitUsd ?? null,
        costs: latest.plan?.costs ?? null,
        feeEvidence: latest.plan?.feeEvidence ?? null,
        quoteAgeMs: latest.plan?.quoteAgeMs ?? null,
        expectedSlippageBps: latest.plan?.expectedSlippageBps ?? null,
        expectedPriceImpactBps: latest.plan?.expectedPriceImpactBps ?? null,
        liquidity: latest.plan?.liquidity ?? null,
        marketData: latest.assessment?.marketData ?? null,
        technicalProvenance: latest.technical?.dataProvenance ?? null,
        technicalSignal: latest.technical?.summary.signal ?? null,
        oracle: latest.oracle ?? null,
        monteCarlo: latest.assessment?.monteCarlo ?? null,
        rankScore: latest.assessment?.rankScore ?? null,
        executionConfidence: latest.assessment?.executionConfidence ?? null,
        missingInformation: latest.missingInformation,
        settlement: latest.realized,
      } : null,
      providers: {
        alchemy,
        rpc: rpcSnapshot,
        mempoolCapabilities,
        marketData: providerStatuses.map(status => ({
          provider: status.provider,
          state: status.state,
          observedAt: status.observedAt,
          detail: status.detail,
          requiredForCoreCexDiscovery: status.provider === 'coingecko',
        })),
        optional: {
          coinStats: {
            requiredForCoreCexDiscovery: false,
            environmentState: coinStatsEnvironment.state,
            sourceName: coinStatsEnvironment.sourceName,
          },
        },
      },
      venues: getVenueCapabilities(),
      inventory: {
        reconciled: inventory,
        rebalance,
      },
      monteCarloCalibration: mcCalibration,
      orderBookEvolution: bookEvolution,
      beam: {
        routed: beam.router,
        directional: {
          activeNodes: beam.beam.activeNodes,
          queuedTasks: beam.beam.queuedTasks,
          executingTasks: beam.beam.executingTasks,
          nodes: beam.beam.nodes,
        },
        legacyAntenna: {
          authoritative: false,
          reason: 'legacy antenna health uses simulated probes and is excluded from trading evidence',
        },
        activeRetries: beam.activeRetries,
      },
      executionScheduler: scheduler,
      learning: measured,
      executionPosture: {
        ...execution,
        zeroCapitalExecutionEnabled,
      },
    });
  } catch (error) {
    logger.warn('[CryptoRuntime] Runtime heartbeat degraded', {
      component: 'CryptoRuntimeObservability',
      error: error instanceof Error ? error.message : String(error),
    });
  } finally {
    heartbeatRunning = false;
  }
}

export function ensureCryptoRuntimeObservability(): void {
  if (heartbeatTimer) return;
  const intervalMs = Math.max(15_000, Number(process.env.CRYPTOCRAWL_RUNTIME_HEARTBEAT_MS || 60_000));
  void emitCryptoRuntimeHeartbeat();
  heartbeatTimer = setInterval(() => void emitCryptoRuntimeHeartbeat(), intervalMs);
  heartbeatTimer.unref();
  logger.info('[CryptoRuntime] Runtime observability installed', {
    component: 'CryptoRuntimeObservability',
    heartbeatMs: intervalMs,
    runtimeAttestation: true,
    decomposedReadiness: [
      'APP_READY',
      'CONFIG_READY',
      'DATA_READY',
      'DISCOVERY_READY',
      'EXECUTION_CAPABILITY_READY',
      'INVENTORY_READY',
      'CANDIDATE_READY',
      'GOVERNANCE_READY',
      'EXECUTION_READY',
      'TRADING_READY',
    ],
    executionReadySemantics: 'strict_trade_ready_backward_compatible_alias',
    providerHeartbeat: ['Alchemy', 'Ankr/shared-RPC', 'market-data'],
    measuredOpportunityGraphTelemetry: true,
    multiTopologyCandidateTelemetry: true,
    inventoryTelemetry: true,
    monteCarloCalibrationTelemetry: true,
    orderBookEvolutionTelemetry: true,
    canonicalDecisionTelemetry: true,
    canonicalExecutionSchedulerTelemetry: true,
    directionalBeamTelemetry: true,
    legacyAntennaAuthoritative: false,
    settlementLearningTelemetry: true,
  });
}

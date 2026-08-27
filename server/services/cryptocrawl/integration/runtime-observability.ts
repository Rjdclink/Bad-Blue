import logger from '../../../logger.js';
import { alchemyIntegration } from '../capital-free/alchemy-integration.js';
import { multiProviderRpcManager, type SupportedChain } from '../api/blockchain-providers.js';
import { marketDataProviders } from '../intelligence/market-data-providers.js';
import { canonicalOpportunityState } from '../intelligence/canonical-opportunity-state.js';
import { stageManager } from '../governance/stage-management.js';
import { workloadRouter } from '../../computationalBeam/workloadRouter.js';
import { getMeasuredEvolutionMetrics } from '../evolution/measured-execution-feedback.js';

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
    const stage = stageManager.getState();
    const measured = getMeasuredEvolutionMetrics();

    logger.info('[CryptoRuntime] Authoritative runtime heartbeat', {
      component: 'CryptoRuntimeObservability',
      governance: {
        stage: stage.currentStage,
        paused: stage.isPaused,
        killSwitchActive: stage.killSwitchActive,
        canExecuteTrades: stageManager.canExecuteTrades(),
        initialGasReady: stageManager.isInitialGasReady(),
        automaticAdvancementBlockers: [...stage.automaticAdvancementBlockers],
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
        rpc: blockchainProviderSnapshot(),
        marketData: marketDataProviders.getProviderStatuses().map(status => ({
          provider: status.provider,
          state: status.state,
          observedAt: status.observedAt,
          detail: status.detail,
        })),
      },
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
      learning: measured,
      executionPosture: {
        noExecutionGuardEnabled: process.env.NO_EXECUTION === 'true',
        liveExecutionEnabled: process.env.CRYPTO_ARBITRAGE_LIVE_EXECUTION === 'true',
        liveExecutionConfirmed: process.env.CRYPTO_ARBITRAGE_LIVE_CONFIRMATION === 'I_ACCEPT_LIVE_ORDER_RISK',
        zeroCapitalExecutionEnabled: process.env.ZERO_CAPITAL_ENABLE_EXECUTION === 'true',
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
    providerHeartbeat: ['Alchemy', 'Ankr/shared-RPC', 'market-data'],
    canonicalDecisionTelemetry: true,
    directionalBeamTelemetry: true,
    legacyAntennaAuthoritative: false,
    settlementLearningTelemetry: true,
  });
}

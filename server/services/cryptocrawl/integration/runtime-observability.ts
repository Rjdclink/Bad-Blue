import logger from '../../../logger.js';
import { alchemyIntegration } from '../capital-free/alchemy-integration.js';
import { multiProviderRpcManager, type SupportedChain } from '../api/blockchain-providers.js';
import { getVenueCapabilities } from '../discovery/venue-capability-registry.js';
import { marketDataProviders } from '../intelligence/market-data-providers.js';
import { canonicalOpportunityState } from '../intelligence/canonical-opportunity-state.js';
import { stageManager } from '../governance/stage-management.js';
import { workloadRouter } from '../../computationalBeam/workloadRouter.js';
import { getMeasuredEvolutionMetrics } from '../evolution/measured-execution-feedback.js';
import { resolveCoinStatsEnvironment } from '../runtime/environment-contract.js';
import { getCryptoCrawlerRuntimeAttestation, isRuntimeIdentitySafe } from '../runtime/runtime-attestation.js';

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
    const stage = stageManager.getState();
    const measured = getMeasuredEvolutionMetrics();
    const runtime = getCryptoCrawlerRuntimeAttestation();
    const execution = executionConfiguration();
    const providerStatuses = marketDataProviders.getProviderStatuses();
    const coreMarketDataReady = providerStatuses.some(status =>
      status.provider === 'coingecko' && ['live', 'cached', 'stale'].includes(status.state),
    );
    const coinStatsEnvironment = resolveCoinStatsEnvironment();
    const criticalRpcReady = blockchainProviderSnapshot().some(chain =>
      chain.providers.some(provider => provider.http === 'healthy'),
    );

    const readiness = {
      APP_READY: {
        ready: isRuntimeIdentitySafe(runtime),
        detail: runtime.state === 'mismatch'
          ? 'runtime source/deployment identity mismatch detected'
          : 'process is running and runtime identity has no detected mismatch',
      },
      CONFIG_READY: {
        ready: execution.centralizedExecutionConfigured,
        detail: execution.centralizedExecutionConfigured
          ? 'Kraken and OKX execution credentials are visible to this runtime'
          : 'one or more settlement-safe centralized execution credentials are not visible',
      },
      DATA_READY: {
        ready: coreMarketDataReady && criticalRpcReady,
        detail: `coreMarketData=${coreMarketDataReady}; rpc=${criticalRpcReady}`,
      },
      DISCOVERY_READY: {
        ready: recentMinute.observedOpportunities > 0,
        detail: `observedOpportunitiesLastMinute=${recentMinute.observedOpportunities}`,
      },
      EXECUTION_READY: {
        ready: !execution.noExecutionGuardEnabled
          && execution.liveExecutionEnabled
          && execution.liveExecutionConfirmed
          && execution.centralizedExecutionConfigured,
        detail: `guard=${execution.noExecutionGuardEnabled}; enabled=${execution.liveExecutionEnabled}; confirmed=${execution.liveExecutionConfirmed}; cexConfigured=${execution.centralizedExecutionConfigured}`,
      },
      TRADING_READY: {
        ready: stageManager.canExecuteTrades()
          && !execution.noExecutionGuardEnabled
          && execution.liveExecutionEnabled
          && execution.liveExecutionConfirmed
          && execution.centralizedExecutionConfigured,
        detail: `stage=${stage.currentStage}; stageCanExecute=${stageManager.canExecuteTrades()}`,
      },
    };

    logger.info('[CryptoRuntime] Authoritative runtime heartbeat', {
      component: 'CryptoRuntimeObservability',
      runtime,
      readiness,
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
        ...execution,
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
    runtimeAttestation: true,
    decomposedReadiness: ['APP_READY', 'CONFIG_READY', 'DATA_READY', 'DISCOVERY_READY', 'EXECUTION_READY', 'TRADING_READY'],
    providerHeartbeat: ['Alchemy', 'Ankr/shared-RPC', 'market-data'],
    canonicalDecisionTelemetry: true,
    directionalBeamTelemetry: true,
    legacyAntennaAuthoritative: false,
    settlementLearningTelemetry: true,
  });
}

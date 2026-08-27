import logger from '../../../logger.js';
import { alchemyIntegration } from '../capital-free/alchemy-integration.js';
import { multiProviderRpcManager, type SupportedChain } from '../api/blockchain-providers.js';
import { marketDataProviders } from '../intelligence/market-data-providers.js';
import { SUPPORTED_CHAINS } from '../bridge/chain-config.js';
import {
  adoptResolvedEnvironmentVariable,
  resolveCoinStatsEnvironment,
} from '../runtime/environment-contract.js';
import { getCryptoCrawlerRuntimeAttestation } from '../runtime/runtime-attestation.js';
import {
  ensureCryptoCrawlerCoreRuntime,
  getCryptoCrawlerCoreRuntimeStatus,
} from '../runtime/core-runtime.js';
import { admitAnkrFallback } from '../runtime/rpc-fallback-admission-policy.js';

const TELEMETRY_CHAINS: SupportedChain[] = [
  'ethereum',
  'polygon',
  'arbitrum',
  'optimism',
  'base',
  'avalanche',
  'bsc',
];

const ANKR_PUBLIC_HTTP: Partial<Record<SupportedChain, string>> = {
  ethereum: 'https://rpc.ankr.com/eth',
  polygon: 'https://rpc.ankr.com/polygon',
  arbitrum: 'https://rpc.ankr.com/arbitrum',
  optimism: 'https://rpc.ankr.com/optimism',
  base: 'https://rpc.ankr.com/base',
  avalanche: 'https://rpc.ankr.com/avalanche',
  bsc: 'https://rpc.ankr.com/bsc',
};

let bootstrapPromise: Promise<void> | null = null;

function logExecutionPosture(): void {
  logger.info('[TelemetryBootstrap] Production execution posture', {
    component: 'TelemetryBootstrap',
    noExecutionGuardEnabled: process.env.NO_EXECUTION === 'true',
    liveExecutionEnabled: process.env.CRYPTO_ARBITRAGE_LIVE_EXECUTION === 'true',
    liveExecutionConfirmed: process.env.CRYPTO_ARBITRAGE_LIVE_CONFIRMATION === 'I_ACCEPT_LIVE_ORDER_RISK',
    zeroCapitalExecutionEnabled: process.env.ZERO_CAPITAL_ENABLE_EXECUTION === 'true',
    zeroCapitalExecutionConfirmed: process.env.ZERO_CAPITAL_EXECUTION_CONFIRMATION === 'I_ACCEPT_ZERO_CAPITAL_EXECUTION_RISK',
    walletConfigured: !!process.env.WALLET_PRIVATE_KEY?.trim(),
    krakenConfigured: !!(process.env.KRAKEN_API_KEY?.trim() && process.env.KRAKEN_API_SECRET?.trim()),
    okxConfigured: !!(
      process.env.OKX_API_KEY?.trim()
      && process.env.OKX_API_SECRET?.trim()
      && process.env.OKX_API_PASSPHRASE?.trim()
    ),
  });
}

function adoptLegacyProviderAliases(): void {
  const aliases: Array<{ canonical: string; candidates: string[] }> = [
    { canonical: 'ALCHEMY_API_KEY', candidates: ['ALCHEMY_KEY'] },
    { canonical: 'ZEROX_API_KEY', candidates: ['ZERO_X_API_KEY', 'ZEROX_KEY'] },
  ];

  for (const { canonical, candidates } of aliases) {
    if (process.env[canonical]?.trim()) continue;
    const source = candidates.find(candidate => process.env[candidate]?.trim());
    if (!source) continue;
    process.env[canonical] = process.env[source]?.trim();
    logger.info('[TelemetryBootstrap] Adopted legacy provider environment alias', {
      component: 'TelemetryBootstrap',
      canonical,
      source,
    });
  }

  const coinStatsResolution = resolveCoinStatsEnvironment();
  const adopted = adoptResolvedEnvironmentVariable(coinStatsResolution);
  logger.info('[TelemetryBootstrap] CoinStats credential resolution', {
    component: 'TelemetryBootstrap',
    state: coinStatsResolution.state,
    configured: coinStatsResolution.state === 'VISIBLE',
    source: coinStatsResolution.sourceName,
    adoptedCanonical: adopted,
    aliasesChecked: coinStatsResolution.aliasesChecked,
  });
}

async function registerBestEffortAnkrFallbacks(): Promise<void> {
  const allowAnonymousPublicFallback = process.env.CRYPTOCRAWL_ALLOW_PUBLIC_ANKR_FALLBACK === 'true';
  const outcomes = await Promise.all(TELEMETRY_CHAINS.map(async chain => {
    const configured = process.env[`${chain.toUpperCase()}_ANKR_RPC_URL`]?.trim()
      || process.env[`ANKR_${chain.toUpperCase()}_RPC_URL`]?.trim()
      || (chain === 'ethereum' ? process.env.ANKR_RPC_URL?.trim() : undefined);
    const admission = admitAnkrFallback({
      configuredUrl: configured,
      publicUrl: ANKR_PUBLIC_HTTP[chain],
      allowAnonymousPublicFallback,
    });
    if (!admission) {
      return {
        chain,
        provider: null,
        healthy: false,
        skipped: true,
        detail: 'anonymous public Ankr fallback is disabled by policy',
      };
    }

    try {
      await multiProviderRpcManager.registerProvider({
        provider: admission.provider,
        chain,
        httpUrl: admission.httpUrl,
        priority: admission.priority,
        capabilities: [
          'json_rpc',
          'network',
          'blocks',
          'transactions',
          'receipts',
          'gas',
          'logs',
          'contract_calls',
        ],
      });
      const health = multiProviderRpcManager.getHealth(chain)
        .find(observation => observation.provider === admission.provider);
      return {
        chain,
        provider: admission.provider,
        healthy: health?.http.success === true,
        skipped: false,
        detail: health?.http.lastError || health?.http.state || 'registered',
      };
    } catch (error) {
      return {
        chain,
        provider: admission.provider,
        healthy: false,
        skipped: false,
        detail: error instanceof Error ? error.message : String(error),
      };
    }
  }));

  logger.info('[TelemetryBootstrap] Ankr fallback admission completed', {
    component: 'TelemetryBootstrap',
    anonymousPublicFallbackEnabled: allowAnonymousPublicFallback,
    healthyChains: outcomes.filter(outcome => outcome.healthy).map(outcome => outcome.chain),
    skippedChains: outcomes.filter(outcome => outcome.skipped).map(outcome => outcome.chain),
    unavailableChains: outcomes.filter(outcome => !outcome.healthy && !outcome.skipped).map(outcome => ({
      chain: outcome.chain,
      provider: outcome.provider,
      detail: outcome.detail,
    })),
  });
}

async function startAlchemyTelemetry(): Promise<void> {
  const apiKey = process.env.ALCHEMY_API_KEY?.trim();
  if (!apiKey) {
    logger.warn('[TelemetryBootstrap] ALCHEMY_API_KEY is not visible to this runtime; shared RPC telemetry remains available', {
      component: 'TelemetryBootstrap',
    });
    return;
  }

  try {
    await alchemyIntegration.start(['ethereum', 'polygon', 'arbitrum', 'optimism', 'base']);
    const readiness = await alchemyIntegration.readinessCheck({ strictLive: false });
    logger.info('[TelemetryBootstrap] Alchemy telemetry initialized', {
      component: 'TelemetryBootstrap',
      ready: readiness.ready,
      active: readiness.active,
      degraded: readiness.degraded,
      detail: readiness.detail,
    });
  } catch (error) {
    logger.warn('[TelemetryBootstrap] Alchemy telemetry initialization degraded', {
      component: 'TelemetryBootstrap',
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

async function probeReadOnlyZeroX(): Promise<void> {
  if (!process.env.ZEROX_API_KEY?.trim()) return;
  const polygon = SUPPORTED_CHAINS.polygon;
  try {
    const observation = await marketDataProviders.getDexQuote({
      chainId: polygon.chainId,
      sellToken: polygon.usdc,
      buyToken: polygon.usdt,
      sellAmount: '1000000',
    });
    logger.info('[TelemetryBootstrap] 0x read-only price probe completed', {
      component: 'TelemetryBootstrap',
      available: !!observation,
      chainId: polygon.chainId,
      quoteKind: observation?.quoteKind ?? null,
      executable: observation?.executable ?? false,
      liquidityAvailable: observation?.liquidityAvailable ?? false,
    });
  } catch (error) {
    logger.warn('[TelemetryBootstrap] 0x read-only price probe degraded', {
      component: 'TelemetryBootstrap',
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

async function probeMarketUniverseProviders(): Promise<void> {
  try {
    const universe = await marketDataProviders.discoverUniverse();
    logger.info('[TelemetryBootstrap] Market-universe provider probe completed', {
      component: 'TelemetryBootstrap',
      assets: universe.length,
      providers: marketDataProviders.getProviderStatuses().map(status => ({
        provider: status.provider,
        state: status.state,
        observedAt: status.observedAt,
        detail: status.detail,
      })),
    });
  } catch (error) {
    logger.warn('[TelemetryBootstrap] Market-universe provider probe degraded', {
      component: 'TelemetryBootstrap',
      error: error instanceof Error ? error.message : String(error),
      providers: marketDataProviders.getProviderStatuses().map(status => ({
        provider: status.provider,
        state: status.state,
        detail: status.detail,
      })),
    });
  }
}

export function ensureTelemetryBootstrap(): Promise<void> {
  const coreStart = ensureCryptoCrawlerCoreRuntime();

  if (!bootstrapPromise) {
    adoptLegacyProviderAliases();
    logExecutionPosture();
    logger.info('[TelemetryBootstrap] Runtime identity', {
      component: 'TelemetryBootstrap',
      ...getCryptoCrawlerRuntimeAttestation(),
    });
    bootstrapPromise = (async () => {
      // Canonical CEX discovery and scheduler admission are established before
      // optional blockchain-provider probes. Their failure is therefore
      // topology-local rather than a global CryptoCrawler startup blocker.
      await coreStart;
      await multiProviderRpcManager.initialize(TELEMETRY_CHAINS);
      await registerBestEffortAnkrFallbacks();
      await startAlchemyTelemetry();
      await probeReadOnlyZeroX();
      await probeMarketUniverseProviders();

      const healthyProviders = TELEMETRY_CHAINS.flatMap(chain =>
        multiProviderRpcManager.getHealth(chain)
          .filter(observation => observation.http.success)
          .map(observation => `${chain}:${observation.provider}`),
      );

      logger.info('[TelemetryBootstrap] Optional blockchain telemetry ready', {
        component: 'TelemetryBootstrap',
        healthyProviders,
        core: getCryptoCrawlerCoreRuntimeStatus(),
        marketDataProviders: marketDataProviders.getProviderStatuses().map(status => ({
          provider: status.provider,
          state: status.state,
          detail: status.detail,
        })),
      });
    })().catch(error => {
      logger.warn('[TelemetryBootstrap] Optional blockchain telemetry bootstrap degraded; canonical CEX core remains independent', {
        component: 'TelemetryBootstrap',
        coreStarted: getCryptoCrawlerCoreRuntimeStatus().started,
        error: error instanceof Error ? error.message : String(error),
      });
    });
  }

  return bootstrapPromise;
}

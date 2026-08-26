import logger from '../../../logger.js';
import { alchemyIntegration } from '../capital-free/alchemy-integration.js';
import { multiProviderRpcManager, type SupportedChain } from '../api/blockchain-providers.js';
import { marketDataProviders } from '../intelligence/market-data-providers.js';
import { SUPPORTED_CHAINS } from '../bridge/chain-config.js';

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

function adoptLegacyProviderAliases(): void {
  const aliases: Array<{ canonical: string; candidates: string[] }> = [
    { canonical: 'ALCHEMY_API_KEY', candidates: ['ALCHEMY_KEY'] },
    { canonical: 'COINSTATS_API_KEY', candidates: ['COIN_STATS_API_KEY', 'COINSTATS_KEY'] },
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
}

async function registerBestEffortAnkrFallbacks(): Promise<void> {
  await Promise.all(TELEMETRY_CHAINS.map(async chain => {
    const configured = process.env[`${chain.toUpperCase()}_ANKR_RPC_URL`]?.trim();
    const publicUrl = configured || ANKR_PUBLIC_HTTP[chain];
    if (!publicUrl) return;

    try {
      await multiProviderRpcManager.registerProvider({
        provider: configured ? 'AnkrConfigured' : 'AnkrPublic',
        chain,
        httpUrl: publicUrl,
        priority: configured ? 8 : 2,
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
    } catch (error) {
      logger.debug('[TelemetryBootstrap] Ankr fallback registration unavailable', {
        component: 'TelemetryBootstrap',
        chain,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }));
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
    logger.info('[TelemetryBootstrap] 0x read-only quote probe completed', {
      component: 'TelemetryBootstrap',
      available: !!observation,
      chainId: polygon.chainId,
      executable: observation?.executable ?? false,
      liquidityAvailable: observation?.liquidityAvailable ?? false,
    });
  } catch (error) {
    logger.warn('[TelemetryBootstrap] 0x read-only quote probe degraded', {
      component: 'TelemetryBootstrap',
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export function ensureTelemetryBootstrap(): Promise<void> {
  if (!bootstrapPromise) {
    adoptLegacyProviderAliases();
    bootstrapPromise = (async () => {
      // Establish the shared manager once, then add optional providers serially so
      // health/provenance state cannot race during startup.
      await multiProviderRpcManager.initialize(TELEMETRY_CHAINS);
      await registerBestEffortAnkrFallbacks();
      await startAlchemyTelemetry();
      await probeReadOnlyZeroX();

      const healthyProviders = TELEMETRY_CHAINS.flatMap(chain =>
        multiProviderRpcManager.getHealth(chain)
          .filter(observation => observation.http.success)
          .map(observation => `${chain}:${observation.provider}`),
      );

      logger.info('[TelemetryBootstrap] Shared blockchain telemetry ready', {
        component: 'TelemetryBootstrap',
        healthyProviders,
        marketDataProviders: marketDataProviders.getProviderStatuses().map(status => ({
          provider: status.provider,
          state: status.state,
          detail: status.detail,
        })),
      });
    })().catch(error => {
      logger.warn('[TelemetryBootstrap] Shared telemetry bootstrap failed closed', {
        component: 'TelemetryBootstrap',
        error: error instanceof Error ? error.message : String(error),
      });
    });
  }

  return bootstrapPromise;
}

import logger from '../../../logger.js';
import { alchemyIntegration } from '../capital-free/alchemy-integration.js';
import { multiProviderRpcManager, type SupportedChain } from '../api/blockchain-providers.js';

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

export function ensureTelemetryBootstrap(): Promise<void> {
  if (!bootstrapPromise) {
    bootstrapPromise = (async () => {
      await Promise.all([
        registerBestEffortAnkrFallbacks(),
        startAlchemyTelemetry(),
      ]);

      const healthyProviders = TELEMETRY_CHAINS.flatMap(chain =>
        multiProviderRpcManager.getHealth(chain)
          .filter(observation => observation.http.success)
          .map(observation => `${chain}:${observation.provider}`),
      );

      logger.info('[TelemetryBootstrap] Shared blockchain telemetry ready', {
        component: 'TelemetryBootstrap',
        healthyProviders,
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

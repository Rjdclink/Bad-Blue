import logger from '../../../logger.js';
import {
  multiProviderRpcManager,
  type RpcCapability,
  type SupportedChain,
} from '../api/blockchain-providers.js';

const CHAINS: SupportedChain[] = ['ethereum', 'polygon', 'arbitrum', 'optimism', 'base', 'avalanche', 'bsc'];
const DEFAULT_CAPABILITIES: RpcCapability[] = [
  'json_rpc', 'network', 'blocks', 'transactions', 'receipts', 'gas', 'logs', 'contract_calls',
];

interface ProviderDefinition {
  provider: string;
  chain: SupportedChain;
  httpUrl: string;
  websocketUrl?: string;
  priority: number;
}

let installed = false;

function validHttpUrl(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    const url = new URL(value.trim());
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : null;
  } catch {
    return null;
  }
}

function validWebSocketUrl(value: unknown): string | undefined {
  if (typeof value !== 'string' || !value.trim()) return undefined;
  try {
    const url = new URL(value.trim());
    return url.protocol === 'wss:' || url.protocol === 'ws:' ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}

function namedProviderDefinitions(): ProviderDefinition[] {
  const definitions: ProviderDefinition[] = [];
  const providers = [
    { provider: 'Chainstack', token: 'CHAINSTACK', priority: 8 },
    { provider: 'GetBlock', token: 'GETBLOCK', priority: 8 },
    { provider: 'dRPC', token: 'DRPC', priority: 8 },
    { provider: 'BlastAPI', token: 'BLAST', priority: 7 },
  ] as const;

  for (const chain of CHAINS) {
    const prefix = chain.toUpperCase();
    for (const candidate of providers) {
      const httpUrl = validHttpUrl(process.env[`${prefix}_${candidate.token}_RPC_URL`]);
      if (!httpUrl) continue;
      definitions.push({
        provider: candidate.provider,
        chain,
        httpUrl,
        websocketUrl: validWebSocketUrl(process.env[`${prefix}_${candidate.token}_WS_URL`]),
        priority: candidate.priority,
      });
    }
  }
  return definitions;
}

function genericProviderDefinitions(): ProviderDefinition[] {
  const raw = process.env.CRYPTOCRAWL_RPC_PROVIDER_MESH?.trim();
  if (!raw) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    logger.warn('[DynamicRpcProviderWiring] Ignoring invalid provider-mesh JSON', {
      component: 'DynamicRpcProviderWiring',
    });
    return [];
  }
  if (!Array.isArray(parsed)) return [];

  const output: ProviderDefinition[] = [];
  for (const item of parsed.slice(0, 32)) {
    if (!item || typeof item !== 'object') continue;
    const row = item as Record<string, unknown>;
    const chain = typeof row.chain === 'string' ? row.chain.trim().toLowerCase() as SupportedChain : null;
    const provider = typeof row.provider === 'string' ? row.provider.trim().slice(0, 48) : '';
    const httpUrl = validHttpUrl(row.httpUrl);
    if (!chain || !CHAINS.includes(chain) || !provider || !httpUrl) continue;
    const priorityRaw = Number(row.priority);
    output.push({
      provider,
      chain,
      httpUrl,
      websocketUrl: validWebSocketUrl(row.websocketUrl),
      priority: Number.isFinite(priorityRaw) ? Math.max(1, Math.min(10, Math.round(priorityRaw))) : 7,
    });
  }
  return output;
}

async function registerConfiguredMesh(): Promise<void> {
  const definitions = [...namedProviderDefinitions(), ...genericProviderDefinitions()];
  const unique = new Map<string, ProviderDefinition>();
  for (const definition of definitions) unique.set(`${definition.chain}:${definition.httpUrl}`, definition);

  const outcomes = await Promise.allSettled([...unique.values()].map(async definition => {
    await multiProviderRpcManager.registerProvider({
      provider: definition.provider,
      chain: definition.chain,
      httpUrl: definition.httpUrl,
      websocketUrl: definition.websocketUrl,
      priority: definition.priority,
      capabilities: [
        ...DEFAULT_CAPABILITIES,
        ...(definition.websocketUrl ? ['subscriptions' as RpcCapability] : []),
      ],
    });
    return { provider: definition.provider, chain: definition.chain };
  }));

  const admitted = outcomes.flatMap(result => result.status === 'fulfilled' ? [result.value] : []);
  const failed = outcomes.filter(result => result.status === 'rejected').length;
  logger.info('[DynamicRpcProviderWiring] Configured provider mesh admission completed', {
    component: 'DynamicRpcProviderWiring',
    configuredCandidates: unique.size,
    admitted,
    failed,
    endpointUrlsLogged: false,
    providerManagerAuthoritative: true,
  });
}

export function ensureDynamicRpcProviderWiring(): void {
  if (installed) return;
  installed = true;
  void registerConfiguredMesh().catch(error => {
    logger.warn('[DynamicRpcProviderWiring] Provider admission degraded without blocking canonical core', {
      component: 'DynamicRpcProviderWiring',
      error: error instanceof Error ? error.message : String(error),
    });
  });
}

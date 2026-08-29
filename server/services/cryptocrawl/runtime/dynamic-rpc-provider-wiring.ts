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
let installationPromise: Promise<void> | null = null;

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

/**
 * No-key RPC mesh for ordinary chain reads. Two independent public transports are
 * admitted where practical so a single free endpoint outage does not immediately
 * spill ordinary reads into paid Alchemy. Alchemy remains available to the
 * provider manager as a fallback and is still untouched for gas sponsorship.
 */
function costSafePublicDefinitions(): ProviderDefinition[] {
  if (process.env.CRYPTOCRAWL_COST_SAFE_PUBLIC_RPC_ENABLED?.trim().toLowerCase() === 'false') return [];

  const primary: Partial<Record<SupportedChain, string>> = {
    ethereum: 'https://ethereum-rpc.publicnode.com',
    polygon: 'https://polygon-bor-rpc.publicnode.com',
    arbitrum: 'https://arbitrum-one-rpc.publicnode.com',
    optimism: 'https://optimism-rpc.publicnode.com',
    base: 'https://base-rpc.publicnode.com',
    avalanche: 'https://avalanche-c-chain-rpc.publicnode.com',
    bsc: 'https://bsc-rpc.publicnode.com',
  };
  const secondary: Partial<Record<SupportedChain, string>> = {
    ethereum: 'https://cloudflare-eth.com',
    polygon: 'https://polygon-rpc.com',
    arbitrum: 'https://arb1.arbitrum.io/rpc',
    optimism: 'https://mainnet.optimism.io',
    base: 'https://mainnet.base.org',
    avalanche: 'https://api.avax.network/ext/bc/C/rpc',
    bsc: 'https://bsc-dataseed.binance.org',
  };

  const definitions: ProviderDefinition[] = [];
  for (const chain of CHAINS) {
    const primaryUrl = validHttpUrl(primary[chain]);
    const secondaryUrl = validHttpUrl(secondary[chain]);
    if (primaryUrl) definitions.push({
      provider: 'CostSafePublicRPCPrimary',
      chain,
      httpUrl: primaryUrl,
      priority: 100,
    });
    if (secondaryUrl && secondaryUrl !== primaryUrl) definitions.push({
      provider: 'CostSafePublicRPCSecondary',
      chain,
      httpUrl: secondaryUrl,
      priority: 95,
    });
  }
  return definitions;
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
      priority: Number.isFinite(priorityRaw) ? Math.max(1, Math.min(90, Math.round(priorityRaw))) : 7,
    });
  }
  return output;
}

async function registerConfiguredMesh(): Promise<void> {
  const definitions = [
    ...costSafePublicDefinitions(),
    ...namedProviderDefinitions(),
    ...genericProviderDefinitions(),
  ];
  const unique = new Map<string, ProviderDefinition>();
  for (const definition of definitions) unique.set(`${definition.chain}:${definition.httpUrl}`, definition);

  const outcomes = await Promise.allSettled([...unique.values()].map(async definition => {
    await multiProviderRpcManager.registerProvider({
      provider: `${definition.provider}:${definition.chain}`,
      chain: definition.chain,
      httpUrl: definition.httpUrl,
      websocketUrl: definition.websocketUrl,
      priority: definition.priority,
      capabilities: [
        ...DEFAULT_CAPABILITIES,
        ...(definition.websocketUrl ? ['subscriptions' as RpcCapability] : []),
      ],
    });
    return { provider: definition.provider, chain: definition.chain, priority: definition.priority };
  }));

  const admitted = outcomes.flatMap(result => result.status === 'fulfilled' ? [result.value] : []);
  const failed = outcomes.filter(result => result.status === 'rejected').length;
  const publicAdmitted = admitted.filter(result => result.provider.startsWith('CostSafePublicRPC')).length;
  logger.info('[DynamicRpcProviderWiring] Configured provider mesh admission completed', {
    component: 'DynamicRpcProviderWiring',
    configuredCandidates: unique.size,
    admitted,
    failed,
    publicAdmitted,
    endpointUrlsLogged: false,
    providerManagerAuthoritative: true,
    costSafePublicRpcPreferred: true,
    independentNoKeyPublicFailover: true,
    paidAlchemyRpcRole: 'last_resort_fallback_after_two_no_key_public_transports_when_available',
    alchemyGasSponsorshipUntouched: true,
    localComputeRole: 'ComputationalBeam_Aries_Cryptara_analysis_after_bounded_market_evidence',
  });
}

export function ensureDynamicRpcProviderWiring(): Promise<void> {
  if (installationPromise) return installationPromise;
  installed = true;
  installationPromise = registerConfiguredMesh().catch(error => {
    logger.warn('[DynamicRpcProviderWiring] Provider admission degraded without blocking canonical core', {
      component: 'DynamicRpcProviderWiring',
      error: error instanceof Error ? error.message : String(error),
    });
  });
  return installationPromise;
}

export function isDynamicRpcProviderWiringInstalled(): boolean {
  return installed;
}

import logger from '../../../logger.js';
import {
  multiProviderRpcManager,
  type RpcCapability,
  type SupportedChain,
} from '../api/blockchain-providers.js';
import {
  installRpcRequestCoalescer,
  noteRpcChainBlock,
} from './rpc-request-coalescer.js';

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
  pendingTransactions?: boolean;
}

let installed = false;
let installationPromise: Promise<void> | null = null;
let blockInvalidationStarted = false;

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
 * No-key RPC mesh for ordinary chain reads. These transports create no operator
 * billing liability and remain route-local: one public endpoint failing cannot
 * disable another chain or force a paid provider into authority.
 */
function costSafePublicDefinitions(): ProviderDefinition[] {
  if (process.env.CRYPTOCRAWL_COST_SAFE_PUBLIC_RPC_ENABLED?.trim().toLowerCase() === 'false') return [];

  const primary: Partial<Record<SupportedChain, string>> = {
    ethereum: 'https://ethereum-rpc.publicnode.com',
    polygon: 'https://polygon-bor-rpc.publicnode.com',
    arbitrum: 'https://arb1.arbitrum.io/rpc',
    optimism: 'https://optimism-rpc.publicnode.com',
    base: 'https://base-rpc.publicnode.com',
    avalanche: 'https://avalanche-c-chain-rpc.publicnode.com',
    bsc: 'https://bsc-rpc.publicnode.com',
  };
  const secondary: Partial<Record<SupportedChain, string>> = {
    ethereum: 'https://eth.drpc.org/',
    polygon: 'https://polygon-rpc.com',
    arbitrum: 'https://arbitrum-one-rpc.publicnode.com',
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

/**
 * Public dRPC endpoints are a separate free streaming lane. They retain pending
 * transaction capability, but deliberately rank below the ordinary PublicNode /
 * official HTTP lanes for general RPC. dRPC's free tier has aggressive regional
 * rate limits and short timeouts, so making this streaming transport the highest
 * priority HTTP provider causes unrelated quote/log traffic to consume its budget.
 */
function freeStreamingDefinitions(): ProviderDefinition[] {
  if (process.env.CRYPTOCRAWL_FREE_STREAMING_RPC_ENABLED?.trim().toLowerCase() === 'false') return [];
  const slugs: Partial<Record<SupportedChain, string>> = {
    ethereum: 'eth',
    polygon: 'polygon',
    arbitrum: 'arbitrum',
    optimism: 'optimism',
    base: 'base',
    bsc: 'bsc',
  };
  return Object.entries(slugs).flatMap(([rawChain, slug]) => {
    const chain = rawChain as SupportedChain;
    if (!slug) return [];
    return [{
      provider: 'dRPCPublicStreaming',
      chain,
      httpUrl: `https://${slug}.drpc.org/`,
      websocketUrl: `wss://${slug}.drpc.org`,
      priority: 85,
      pendingTransactions: true,
    } satisfies ProviderDefinition];
  });
}

/**
 * Alchemy is admitted only as another standard JSON-RPC fallback. PublicNode /
 * official endpoints remain preferred so one paid/free-credit provider cannot
 * become a quota bottleneck. Enhanced APIs, gas sponsorship, and mempool authority
 * remain outside this lane.
 */
function alchemyStandardRpcDefinitions(): ProviderDefinition[] {
  if (/^(1|true|yes|on)$/i.test(String(process.env.CRYPTOCRAWL_ALCHEMY_STANDARD_RPC_DISABLED || ''))) return [];
  const key = process.env.ALCHEMY_API_KEY?.trim();
  const slugs: Partial<Record<SupportedChain, string>> = {
    ethereum: 'eth-mainnet',
    polygon: 'polygon-mainnet',
    arbitrum: 'arb-mainnet',
    optimism: 'opt-mainnet',
    base: 'base-mainnet',
  };
  const definitions: ProviderDefinition[] = [];
  for (const chain of CHAINS) {
    const prefix = chain.toUpperCase();
    const explicitHttp = validHttpUrl(process.env[`${prefix}_ALCHEMY_RPC_URL`]);
    const explicitWs = validWebSocketUrl(process.env[`${prefix}_ALCHEMY_WS_URL`]);
    const slug = slugs[chain];
    const httpUrl = explicitHttp || (key && slug ? `https://${slug}.g.alchemy.com/v2/${key}` : null);
    if (!httpUrl) continue;
    definitions.push({
      provider: 'AlchemyStandardRPC',
      chain,
      httpUrl,
      websocketUrl: explicitWs || (key && slug ? `wss://${slug}.g.alchemy.com/v2/${key}` : undefined),
      priority: 80,
      pendingTransactions: false,
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
      const websocketUrl = validWebSocketUrl(process.env[`${prefix}_${candidate.token}_WS_URL`]);
      definitions.push({
        provider: candidate.provider,
        chain,
        httpUrl,
        websocketUrl,
        priority: candidate.priority,
        pendingTransactions: websocketUrl
          ? process.env[`${prefix}_${candidate.token}_PENDING_TRANSACTIONS`]?.trim().toLowerCase() === 'true'
          : false,
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
    const websocketUrl = validWebSocketUrl(row.websocketUrl);
    output.push({
      provider,
      chain,
      httpUrl,
      websocketUrl,
      priority: Number.isFinite(priorityRaw) ? Math.max(1, Math.min(90, Math.round(priorityRaw))) : 7,
      pendingTransactions: Boolean(websocketUrl) && row.pendingTransactions === true,
    });
  }
  return output;
}

function startBlockInvalidationSubscriptions(): void {
  if (blockInvalidationStarted) return;
  blockInvalidationStarted = true;
  for (const chain of CHAINS) {
    void multiProviderRpcManager.subscribe(chain, 'blocks', value => {
      const blockNumber = Number(value);
      if (Number.isSafeInteger(blockNumber) && blockNumber >= 0) noteRpcChainBlock(chain, blockNumber);
    }).catch(error => {
      logger.debug('[DynamicRpcProviderWiring] Block invalidation stream degraded locally', {
        component: 'DynamicRpcProviderWiring',
        chain,
        error: error instanceof Error ? error.message : String(error),
        cacheFallsBackToBoundedTtl: true,
      });
    });
  }
}

async function registerConfiguredMesh(): Promise<void> {
  const definitions = [
    ...freeStreamingDefinitions(),
    ...costSafePublicDefinitions(),
    ...alchemyStandardRpcDefinitions(),
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
        ...(definition.websocketUrl && definition.pendingTransactions ? ['pending_transactions' as RpcCapability] : []),
      ],
    });
    return {
      provider: definition.provider,
      chain: definition.chain,
      priority: definition.priority,
      pendingTransactions: definition.pendingTransactions === true,
    };
  }));

  const admitted = outcomes.flatMap(result => result.status === 'fulfilled' ? [result.value] : []);
  const failed = outcomes.filter(result => result.status === 'rejected').length;
  const publicAdmitted = admitted.filter(result =>
    result.provider.startsWith('CostSafePublicRPC') || result.provider === 'dRPCPublicStreaming',
  ).length;
  const alchemyStandardRpcAdmitted = admitted.filter(result => result.provider === 'AlchemyStandardRPC').length;
  logger.info('[DynamicRpcProviderWiring] Free/configured provider mesh admission completed', {
    component: 'DynamicRpcProviderWiring',
    configuredCandidates: unique.size,
    admitted,
    failed,
    publicAdmitted,
    alchemyStandardRpcAdmitted,
    freePendingTransactionLanes: admitted.filter(result => result.pendingTransactions).length,
    endpointUrlsLogged: false,
    providerManagerAuthoritative: true,
    costSafePublicRpcPreferred: true,
    streamingHttpIsGeneralAuthority: false,
    independentNoKeyPublicFailover: true,
    standardRpcQuotaDiversification: true,
    sharedRpcSingleflight: true,
    blockScopedReadCache: true,
    eventDrivenCacheInvalidation: true,
    deprecatedCloudflarePublicGatewayAdmitted: false,
    alchemyOperationalAuthority: false,
    alchemyStandardRpcFallback: alchemyStandardRpcAdmitted > 0,
    alchemyPaidMempoolAuthority: false,
    alchemyGasSponsorshipAuthority: false,
    localComputeRole: 'ComputationalBeam_Aries_Cryptara_analysis_after_bounded_market_evidence',
  });
  startBlockInvalidationSubscriptions();
}

export function ensureDynamicRpcProviderWiring(): Promise<void> {
  if (installationPromise) return installationPromise;
  installed = true;
  installRpcRequestCoalescer();
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

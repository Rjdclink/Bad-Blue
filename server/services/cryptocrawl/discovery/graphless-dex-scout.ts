import { ethers, type providers } from 'ethers';
import logger from '../../../logger.js';
import type { SupportedExecutionChain } from '../execution/adapters/onchain-payload-builder.js';

const UNISWAP_V3_FACTORY = '0x1F98431c8aD98523631AE4a59f267346ea31F984';
const UNI_V3_POOL_CREATED = new ethers.utils.Interface([
  'event PoolCreated(address indexed token0, address indexed token1, uint24 indexed fee, int24 tickSpacing, address pool)',
]);
const V2_PAIR_CREATED = new ethers.utils.Interface([
  'event PairCreated(address indexed token0,address indexed token1,address pair,uint256)',
]);
const POOL_CREATED_TOPIC = UNI_V3_POOL_CREATED.getEventTopic('PoolCreated');
const PAIR_CREATED_TOPIC = V2_PAIR_CREATED.getEventTopic('PairCreated');

const V2_FACTORIES: Partial<Record<SupportedExecutionChain, Array<{ name: string; address: string }>>> = {
  polygon: [
    { name: 'quickswap_v2', address: '0x5757371414417b8c6caad45baef941abc7d3ab32' },
    { name: 'sushiswap_v2', address: '0xc35DADB65012eC5796536bD9864eD8773aBc74C4' },
  ],
  arbitrum: [
    { name: 'sushiswap_v2', address: '0xc35DADB65012eC5796536bD9864eD8773aBc74C4' },
  ],
};

const GECKO_NETWORK: Partial<Record<SupportedExecutionChain, string>> = {
  polygon: 'polygon_pos',
  arbitrum: 'arbitrum',
  bsc: 'bsc',
  avalanche: 'avax',
  ethereum: 'eth',
  optimism: 'optimism',
};

const V3_FACTORY_SCAN_CHAINS = new Set<SupportedExecutionChain>([
  'ethereum',
  'polygon',
  'arbitrum',
  'optimism',
]);

export interface GraphlessDexTokenCandidate {
  token: string;
  liquidityUsd: number | null;
  source: 'geckoterminal_public' | 'uniswap_v3_factory_event' | 'uniswap_v2_factory_event';
  observedAt: number;
}

export interface GraphlessDexScoutResult {
  chain: SupportedExecutionChain;
  observedAt: number;
  candidates: GraphlessDexTokenCandidate[];
  sources: string[];
  publicScoutAvailable: boolean;
  directRpcAvailable: boolean;
  errors: string[];
}

type CacheEntry = { expiresAt: number; result: GraphlessDexScoutResult };
const cache = new Map<string, CacheEntry>();
const lastFactoryBlock = new Map<string, number>();
const archiveRestrictedKeys = new Set<string>();
const geckoCooldownUntil = new Map<string, number>();

function bounded(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = Number(value);
  const normalized = Number.isFinite(parsed) ? parsed : fallback;
  return Math.max(min, Math.min(max, normalized));
}

function normalizeAddress(value: unknown): string | null {
  const text = String(value ?? '').trim();
  const match = text.match(/0x[a-fA-F0-9]{40}/g);
  if (!match?.length) return null;
  const address = match[match.length - 1];
  try {
    return ethers.utils.getAddress(address);
  } catch {
    return null;
  }
}

function candidateLimit(): number {
  return Math.floor(bounded(process.env.ZERO_CAPITAL_GRAPHLESS_TOKEN_LIMIT, 16, 2, 64));
}

function cacheTtlMs(): number {
  return Math.floor(bounded(process.env.ZERO_CAPITAL_GRAPHLESS_SCOUT_TTL_MS, 60_000, 15_000, 10 * 60_000));
}

function geckoRateLimitCooldownMs(): number {
  return Math.floor(bounded(process.env.ZERO_CAPITAL_GECKO_RATE_LIMIT_COOLDOWN_MS, 60_000, 5_000, 10 * 60_000));
}

function minLiquidityUsd(): number {
  return bounded(process.env.ZERO_CAPITAL_GRAPHLESS_MIN_LIQUIDITY_USD, 25_000, 0, 100_000_000);
}

function meshSafeHeadLagBlocks(chain: SupportedExecutionChain): number {
  const fallback = chain === 'polygon' ? 8 : chain === 'arbitrum' ? 4 : 2;
  return Math.floor(bounded(process.env.ZERO_CAPITAL_GRAPHLESS_HEAD_LAG_BLOCKS, fallback, 1, 128));
}

function geckoRetryAfterMs(response: Response): number {
  const retryAfter = response.headers.get('retry-after')?.trim();
  if (!retryAfter) return geckoRateLimitCooldownMs();
  const seconds = Number(retryAfter);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.max(1_000, Math.min(10 * 60_000, Math.ceil(seconds * 1_000)));
  const date = Date.parse(retryAfter);
  if (Number.isFinite(date)) return Math.max(1_000, Math.min(10 * 60_000, date - Date.now()));
  return geckoRateLimitCooldownMs();
}

async function fetchGeckoCandidates(
  chain: SupportedExecutionChain,
  anchorTokens: string[],
): Promise<GraphlessDexTokenCandidate[]> {
  const network = GECKO_NETWORK[chain];
  if (!network || process.env.ZERO_CAPITAL_GRAPHLESS_PUBLIC_SCOUTS === 'false') return [];
  const cooldownKey = network;
  const blockedUntil = geckoCooldownUntil.get(cooldownKey) || 0;
  if (blockedUntil > Date.now()) {
    throw new Error(`GeckoTerminal ${network} route-local cooldown active until ${new Date(blockedUntil).toISOString()}`);
  }
  if (blockedUntil > 0) geckoCooldownUntil.delete(cooldownKey);

  const observedAt = Date.now();
  const result = new Map<string, GraphlessDexTokenCandidate>();
  const maxAnchors = Math.min(2, anchorTokens.length);

  for (const anchor of anchorTokens.slice(0, maxAnchors)) {
    const url = `https://api.geckoterminal.com/api/v2/networks/${network}/tokens/${anchor}/pools?page=1`;
    const response = await fetch(url, {
      headers: {
        accept: 'application/json;version=20230203',
        'user-agent': 'Bad-Blue-CryptoCrawler/Aries-Graphless-DEX',
      },
      signal: AbortSignal.timeout(2_500),
    });
    if (!response.ok) {
      if (response.status === 429) {
        const until = Date.now() + geckoRetryAfterMs(response);
        geckoCooldownUntil.set(cooldownKey, until);
        throw new Error(`GeckoTerminal ${network} token-pools returned HTTP 429; route-local cooldown until ${new Date(until).toISOString()}`);
      }
      throw new Error(`GeckoTerminal ${network} token-pools returned HTTP ${response.status}`);
    }
    const payload = await response.json() as { data?: Array<Record<string, any>> };
    for (const pool of payload.data || []) {
      const liquidityUsdRaw = Number(pool?.attributes?.reserve_in_usd ?? pool?.attributes?.liquidity_usd);
      const liquidityUsd = Number.isFinite(liquidityUsdRaw) && liquidityUsdRaw >= 0 ? liquidityUsdRaw : null;
      if (liquidityUsd !== null && liquidityUsd < minLiquidityUsd()) continue;
      const addresses = [
        normalizeAddress(pool?.relationships?.base_token?.data?.id),
        normalizeAddress(pool?.relationships?.quote_token?.data?.id),
      ].filter((value): value is string => !!value);
      for (const token of addresses) {
        if (anchorTokens.some(anchorToken => anchorToken.toLowerCase() === token.toLowerCase())) continue;
        const existing = result.get(token.toLowerCase());
        if (!existing || (liquidityUsd ?? 0) > (existing.liquidityUsd ?? 0)) {
          result.set(token.toLowerCase(), { token, liquidityUsd, source: 'geckoterminal_public', observedAt });
        }
      }
    }
  }
  return [...result.values()];
}

function rememberAnchoredCandidate(
  candidates: Map<string, GraphlessDexTokenCandidate>,
  token0: string,
  token1: string,
  anchors: Set<string>,
  source: GraphlessDexTokenCandidate['source'],
  observedAt: number,
): void {
  if (anchors.has(token0.toLowerCase()) && !anchors.has(token1.toLowerCase())) {
    candidates.set(token1.toLowerCase(), { token: token1, liquidityUsd: null, source, observedAt });
  }
  if (anchors.has(token1.toLowerCase()) && !anchors.has(token0.toLowerCase())) {
    candidates.set(token0.toLowerCase(), { token: token0, liquidityUsd: null, source, observedAt });
  }
}

function isArchiveRestriction(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /archive requests require|archive node|historical state|block range.*too (?:large|old)/i.test(message);
}

function recentFilter(filter: providers.Filter, currentBlock: number): providers.Filter {
  const recentBlocks = Math.floor(bounded(process.env.ZERO_CAPITAL_GRAPHLESS_ARCHIVE_FALLBACK_BLOCKS, 128, 32, 2_000));
  const recentFrom = Math.max(0, currentBlock - recentBlocks + 1);
  return { ...filter, fromBlock: recentFrom, toBlock: currentBlock };
}

async function getLogsWithRecentFallback(
  provider: providers.Provider,
  filter: providers.Filter,
  currentBlock: number,
  capabilityKey: string,
): Promise<providers.Log[]> {
  if (archiveRestrictedKeys.has(capabilityKey)) {
    return provider.getLogs(recentFilter(filter, currentBlock));
  }
  try {
    return await provider.getLogs(filter);
  } catch (error) {
    if (!isArchiveRestriction(error)) throw error;
    archiveRestrictedKeys.add(capabilityKey);
    logger.info('[GraphlessDexScout] RPC archive restriction learned; future discovery uses bounded recent logs directly', {
      component: 'GraphlessDexScout',
      capabilityKey,
      executionAuthority: false,
    });
    return provider.getLogs(recentFilter(filter, currentBlock));
  }
}

async function scanFactoryLogs(input: {
  provider: providers.Provider;
  currentBlock: number;
  chainKey: string;
  address: string;
  topic: string;
  parse: (log: providers.Log) => { token0: string; token1: string } | null;
  source: GraphlessDexTokenCandidate['source'];
  anchors: Set<string>;
  observedAt: number;
  output: Map<string, GraphlessDexTokenCandidate>;
}): Promise<void> {
  const bootstrapBlocks = Math.floor(bounded(process.env.ZERO_CAPITAL_GRAPHLESS_FACTORY_BOOTSTRAP_BLOCKS, 512, 64, 100_000));
  const priorCursor = lastFactoryBlock.get(input.chainKey);
  const bootstrapStart = Math.max(0, input.currentBlock - bootstrapBlocks);
  const fromBlock = Math.max(0, Math.min(input.currentBlock, priorCursor ?? bootstrapStart));
  const chunk = Math.floor(bounded(process.env.ZERO_CAPITAL_GRAPHLESS_FACTORY_LOG_CHUNK, 512, 64, 10_000));
  for (let start = fromBlock; start <= input.currentBlock; start += chunk) {
    const end = Math.min(input.currentBlock, start + chunk - 1);
    const logs = await getLogsWithRecentFallback(
      input.provider,
      { address: input.address, topics: [input.topic], fromBlock: start, toBlock: end },
      input.currentBlock,
      input.chainKey,
    );
    for (const log of logs) {
      try {
        const parsed = input.parse(log);
        if (!parsed) continue;
        rememberAnchoredCandidate(input.output, parsed.token0, parsed.token1, input.anchors, input.source, input.observedAt);
      } catch {
        // Malformed logs never create candidates. Direct route quoting remains final authority.
      }
    }
  }
  lastFactoryBlock.set(input.chainKey, input.currentBlock + 1);
}

async function fetchRecentFactoryCandidates(
  chain: SupportedExecutionChain,
  provider: providers.Provider,
  anchorTokens: string[],
): Promise<GraphlessDexTokenCandidate[]> {
  if (!V3_FACTORY_SCAN_CHAINS.has(chain)) return [];
  const network = await provider.getNetwork();
  if (!Number.isSafeInteger(network.chainId) || network.chainId <= 0) return [];
  const observedHead = await provider.getBlockNumber();
  const headLagBlocks = meshSafeHeadLagBlocks(chain);
  const current = Math.max(0, observedHead - headLagBlocks);
  const candidates = new Map<string, GraphlessDexTokenCandidate>();
  const anchors = new Set(anchorTokens.map(token => token.toLowerCase()));
  const observedAt = Date.now();

  await scanFactoryLogs({
    provider,
    currentBlock: current,
    chainKey: `${network.chainId}:uniswapV3`,
    address: UNISWAP_V3_FACTORY,
    topic: POOL_CREATED_TOPIC,
    parse: log => {
      const parsed = UNI_V3_POOL_CREATED.parseLog(log);
      return {
        token0: ethers.utils.getAddress(parsed.args.token0),
        token1: ethers.utils.getAddress(parsed.args.token1),
      };
    },
    source: 'uniswap_v3_factory_event',
    anchors,
    observedAt,
    output: candidates,
  });

  if (process.env.ZERO_CAPITAL_V2_FORK_RPC_SCANNING !== 'false') {
    for (const factory of V2_FACTORIES[chain] || []) {
      await scanFactoryLogs({
        provider,
        currentBlock: current,
        chainKey: `${network.chainId}:${factory.name}:${factory.address.toLowerCase()}`,
        address: factory.address,
        topic: PAIR_CREATED_TOPIC,
        parse: log => {
          const parsed = V2_PAIR_CREATED.parseLog(log);
          return {
            token0: ethers.utils.getAddress(parsed.args.token0),
            token1: ethers.utils.getAddress(parsed.args.token1),
          };
        },
        source: 'uniswap_v2_factory_event',
        anchors,
        observedAt,
        output: candidates,
      });
    }
  }

  logger.debug('[GraphlessDexScout] Mesh-safe factory-log head selected', {
    component: 'GraphlessDexScout',
    chain,
    chainId: network.chainId,
    observedHead,
    canonicalScanHead: current,
    headLagBlocks,
    executionAuthority: false,
  });
  return [...candidates.values()];
}

export async function discoverGraphlessDexTokens(
  chain: SupportedExecutionChain,
  provider: providers.Provider,
  anchorTokens: string[],
): Promise<GraphlessDexScoutResult> {
  const normalizedAnchors = anchorTokens.map(normalizeAddress).filter((value): value is string => !!value);
  const cacheKey = `${chain}:${normalizedAnchors.map(value => value.toLowerCase()).sort().join(',')}`;
  const cached = cache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.result;

  const errors: string[] = [];
  let publicScoutAvailable = false;
  let directRpcAvailable = false;
  let publicCandidates: GraphlessDexTokenCandidate[] = [];
  let rpcCandidates: GraphlessDexTokenCandidate[] = [];

  try {
    publicCandidates = await fetchGeckoCandidates(chain, normalizedAnchors);
    publicScoutAvailable = true;
  } catch (error) {
    errors.push(error instanceof Error ? error.message : String(error));
  }

  try {
    rpcCandidates = await fetchRecentFactoryCandidates(chain, provider, normalizedAnchors);
    directRpcAvailable = true;
  } catch (error) {
    errors.push(error instanceof Error ? error.message : String(error));
  }

  const merged = new Map<string, GraphlessDexTokenCandidate>();
  for (const candidate of [...publicCandidates, ...rpcCandidates]) {
    const key = candidate.token.toLowerCase();
    const previous = merged.get(key);
    if (!previous || (candidate.liquidityUsd ?? 0) > (previous.liquidityUsd ?? 0)) merged.set(key, candidate);
  }
  const candidates = [...merged.values()]
    .sort((left, right) => (right.liquidityUsd ?? -1) - (left.liquidityUsd ?? -1) || left.token.localeCompare(right.token))
    .slice(0, candidateLimit());

  const result: GraphlessDexScoutResult = {
    chain,
    observedAt: Date.now(),
    candidates,
    sources: [...new Set(candidates.map(candidate => candidate.source))],
    publicScoutAvailable,
    directRpcAvailable,
    errors,
  };
  cache.set(cacheKey, { expiresAt: Date.now() + cacheTtlMs(), result });
  logger.info('[GraphlessDexScout] No-key DEX token surface refreshed', {
    component: 'GraphlessDexScout',
    chain,
    candidates: candidates.length,
    sources: result.sources,
    publicScoutAvailable,
    directRpcAvailable,
    geckoCooldownUntil: geckoCooldownUntil.get(GECKO_NETWORK[chain] || '') || null,
    geckoFailureIsRouteLocal: true,
    archiveRestrictedCapabilities: archiveRestrictedKeys.size,
    v2ForkRpcScanning: process.env.ZERO_CAPITAL_V2_FORK_RPC_SCANNING !== 'false',
    v2Factories: (V2_FACTORIES[chain] || []).map(factory => factory.name),
    factoryBootstrapBlocks: Math.floor(bounded(process.env.ZERO_CAPITAL_GRAPHLESS_FACTORY_BOOTSTRAP_BLOCKS, 512, 64, 100_000)),
    meshSafeHeadLagBlocks: meshSafeHeadLagBlocks(chain),
    errors,
    apiKeysRequired: false,
    executionAuthority: false,
  });
  return result;
}

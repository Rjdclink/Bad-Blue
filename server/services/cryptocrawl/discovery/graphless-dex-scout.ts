import { ethers, type providers } from 'ethers';
import logger from '../../../logger.js';
import type { ChainId } from '../bridge/types.js';
import type { SupportedExecutionChain } from '../execution/adapters/onchain-payload-builder.js';

const UNISWAP_V3_FACTORY = '0x1F98431c8aD98523631AE4a59f267346ea31F984';
const UNI_V3_POOL_CREATED = new ethers.utils.Interface([
  'event PoolCreated(address indexed token0, address indexed token1, uint24 indexed fee, int24 tickSpacing, address pool)',
]);
const POOL_CREATED_TOPIC = UNI_V3_POOL_CREATED.getEventTopic('PoolCreated');

const GECKO_NETWORK: Partial<Record<SupportedExecutionChain, string>> = {
  polygon: 'polygon_pos',
  arbitrum: 'arbitrum',
  bsc: 'bsc',
  avalanche: 'avax',
  ethereum: 'eth',
  optimism: 'optimism',
};

export interface GraphlessDexTokenCandidate {
  token: string;
  liquidityUsd: number | null;
  source: 'geckoterminal_public' | 'uniswap_v3_factory_event';
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

function minLiquidityUsd(): number {
  return bounded(process.env.ZERO_CAPITAL_GRAPHLESS_MIN_LIQUIDITY_USD, 25_000, 0, 100_000_000);
}

async function fetchGeckoCandidates(
  chain: SupportedExecutionChain,
  anchorTokens: string[],
): Promise<GraphlessDexTokenCandidate[]> {
  const network = GECKO_NETWORK[chain];
  if (!network || process.env.ZERO_CAPITAL_GRAPHLESS_PUBLIC_SCOUTS === 'false') return [];
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
    if (!response.ok) throw new Error(`GeckoTerminal ${network} token-pools returned HTTP ${response.status}`);
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

async function fetchRecentFactoryCandidates(
  chain: SupportedExecutionChain,
  provider: providers.Provider,
  anchorTokens: string[],
): Promise<GraphlessDexTokenCandidate[]> {
  if (chain !== 'polygon' && chain !== 'arbitrum') return [];
  const network = await provider.getNetwork();
  if (!Number.isSafeInteger(network.chainId) || network.chainId <= 0) return [];
  const current = await provider.getBlockNumber();
  const key = `${network.chainId}:uniswapV3`;
  const bootstrapBlocks = Math.floor(bounded(process.env.ZERO_CAPITAL_GRAPHLESS_FACTORY_BOOTSTRAP_BLOCKS, 20_000, 500, 100_000));
  const fromBlock = Math.max(0, lastFactoryBlock.get(key) ?? current - bootstrapBlocks);
  const chunk = Math.floor(bounded(process.env.ZERO_CAPITAL_GRAPHLESS_FACTORY_LOG_CHUNK, 2_000, 100, 10_000));
  const candidates = new Map<string, GraphlessDexTokenCandidate>();
  const anchors = new Set(anchorTokens.map(token => token.toLowerCase()));
  const observedAt = Date.now();

  for (let start = fromBlock; start <= current; start += chunk) {
    const end = Math.min(current, start + chunk - 1);
    const logs = await provider.getLogs({ address: UNISWAP_V3_FACTORY, topics: [POOL_CREATED_TOPIC], fromBlock: start, toBlock: end });
    for (const log of logs) {
      try {
        const parsed = UNI_V3_POOL_CREATED.parseLog(log);
        const token0 = ethers.utils.getAddress(parsed.args.token0);
        const token1 = ethers.utils.getAddress(parsed.args.token1);
        if (anchors.has(token0.toLowerCase()) && !anchors.has(token1.toLowerCase())) {
          candidates.set(token1.toLowerCase(), { token: token1, liquidityUsd: null, source: 'uniswap_v3_factory_event', observedAt });
        }
        if (anchors.has(token1.toLowerCase()) && !anchors.has(token0.toLowerCase())) {
          candidates.set(token0.toLowerCase(), { token: token0, liquidityUsd: null, source: 'uniswap_v3_factory_event', observedAt });
        }
      } catch {
        // Ignore malformed/unexpected factory logs; direct route quoting is still final authority.
      }
    }
  }
  lastFactoryBlock.set(key, current + 1);
  return [...candidates.values()];
}

/**
 * No-key DEX discovery. Public analytics are optional scouts only. Direct RPC
 * factory events keep discovery alive when scouts are unavailable, and neither
 * source grants execution authority: every route must still receive fresh
 * router/quoter outputs plus all-in profitability checks downstream.
 */
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
    errors,
    apiKeysRequired: false,
    executionAuthority: false,
  });
  return result;
}

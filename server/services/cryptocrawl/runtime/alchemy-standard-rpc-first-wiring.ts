import { Contract } from 'ethers';
import logger from '../../../logger.js';
import { multiProviderRpcManager, type SupportedChain } from '../api/blockchain-providers.js';
import { alchemyIntegration, type TokenBalance, type TokenMetadata } from '../capital-free/alchemy-integration.js';

const ERC20_ABI = [
  'function balanceOf(address account) view returns (uint256)',
  'function name() view returns (string)',
  'function symbol() view returns (string)',
  'function decimals() view returns (uint8)',
];

const SUPPORTED = new Set<SupportedChain>(['ethereum', 'polygon', 'arbitrum', 'optimism', 'base']);
let installed = false;

const metadataCache = new Map<string, { value: TokenMetadata; expiresAt: number }>();
const balanceCache = new Map<string, { value: TokenBalance; expiresAt: number }>();
const inFlight = new Map<string, Promise<unknown>>();

function enabled(): boolean {
  return process.env.CRYPTOCRAWL_ALCHEMY_STANDARD_RPC_FIRST?.trim().toLowerCase() !== 'false';
}

function metadataTtlMs(): number {
  const parsed = Number(process.env.CRYPTOCRAWL_STANDARD_TOKEN_METADATA_TTL_MS || 24 * 60 * 60_000);
  return Number.isFinite(parsed) ? Math.max(5 * 60_000, Math.min(7 * 24 * 60 * 60_000, Math.trunc(parsed))) : 24 * 60 * 60_000;
}

function balanceTtlMs(): number {
  const parsed = Number(process.env.CRYPTOCRAWL_STANDARD_TOKEN_BALANCE_TTL_MS || 15_000);
  return Number.isFinite(parsed) ? Math.max(1_000, Math.min(60_000, Math.trunc(parsed))) : 15_000;
}

function concurrency(): number {
  const parsed = Number(process.env.CRYPTOCRAWL_STANDARD_TOKEN_BALANCE_CONCURRENCY || 8);
  return Number.isFinite(parsed) ? Math.max(1, Math.min(16, Math.trunc(parsed))) : 8;
}

function asChain(network: string): SupportedChain | null {
  const normalized = network.trim().toLowerCase() as SupportedChain;
  return SUPPORTED.has(normalized) ? normalized : null;
}

async function runBounded<T, R>(items: readonly T[], limit: number, worker: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  const workers = Math.max(1, Math.min(items.length || 1, limit));
  await Promise.all(Array.from({ length: workers }, async () => {
    while (true) {
      const index = cursor++;
      if (index >= items.length) return;
      results[index] = await worker(items[index]);
    }
  }));
  return results;
}

async function standardMetadata(chain: SupportedChain, tokenAddress: string): Promise<TokenMetadata | null> {
  const key = `${chain}:${tokenAddress.toLowerCase()}`;
  const cached = metadataCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.value;
  const pending = inFlight.get(`metadata:${key}`) as Promise<TokenMetadata | null> | undefined;
  if (pending) return pending;

  const request = multiProviderRpcManager.execute(chain, 'contract_calls', async provider => {
    const token = new Contract(tokenAddress, ERC20_ABI, provider);
    const [name, symbol, decimals] = await Promise.all([
      token.name(),
      token.symbol(),
      token.decimals(),
    ]);
    const value: TokenMetadata = {
      name: String(name || 'Unknown'),
      symbol: String(symbol || 'UNK'),
      decimals: Number(decimals),
      logo: null,
    };
    if (!Number.isFinite(value.decimals) || value.decimals < 0 || value.decimals > 255) throw new Error('invalid ERC20 decimals');
    return value;
  }).then(({ result }) => {
    metadataCache.set(key, { value: result, expiresAt: Date.now() + metadataTtlMs() });
    return result;
  }).catch(() => null).finally(() => inFlight.delete(`metadata:${key}`));

  inFlight.set(`metadata:${key}`, request);
  return request;
}

async function standardBalance(chain: SupportedChain, owner: string, tokenAddress: string): Promise<TokenBalance | null> {
  const key = `${chain}:${owner.toLowerCase()}:${tokenAddress.toLowerCase()}`;
  const cached = balanceCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.value;
  const pending = inFlight.get(`balance:${key}`) as Promise<TokenBalance | null> | undefined;
  if (pending) return pending;

  const request = multiProviderRpcManager.execute(chain, 'contract_calls', async provider => {
    const token = new Contract(tokenAddress, ERC20_ABI, provider);
    const raw = await token.balanceOf(owner);
    const hex = raw.toHexString();
    return {
      contractAddress: tokenAddress,
      tokenBalance: hex,
      tokenBalanceRaw: hex,
    } satisfies TokenBalance;
  }).then(({ result }) => {
    balanceCache.set(key, { value: result, expiresAt: Date.now() + balanceTtlMs() });
    return result;
  }).catch(() => null).finally(() => inFlight.delete(`balance:${key}`));

  inFlight.set(`balance:${key}`, request);
  return request;
}

/**
 * Moves standard ERC20 reads off Alchemy enhanced APIs whenever the caller already
 * knows the token addresses. The canonical RPC manager handles public/no-key
 * transports first and can still fail over to configured paid RPC if all free
 * transports are unavailable. Unsupported enumeration requests keep the original
 * Alchemy behavior so no capability is removed.
 */
export function ensureAlchemyStandardRpcFirstWiring(): void {
  if (installed || !enabled()) return;
  installed = true;

  const tokenApi = alchemyIntegration.tokenAPI as unknown as {
    getTokenBalances: (network: string, owner: string, tokenAddresses?: string[]) => Promise<TokenBalance[]>;
    getTokenMetadata: (network: string, tokenAddress: string) => Promise<TokenMetadata | null>;
  };
  const originalBalances = tokenApi.getTokenBalances.bind(tokenApi);
  const originalMetadata = tokenApi.getTokenMetadata.bind(tokenApi);

  tokenApi.getTokenMetadata = async (network, tokenAddress) => {
    const chain = asChain(network);
    if (!chain) return originalMetadata(network, tokenAddress);
    const standard = await standardMetadata(chain, tokenAddress);
    if (standard) return standard;
    return originalMetadata(network, tokenAddress);
  };

  tokenApi.getTokenBalances = async (network, owner, tokenAddresses) => {
    const chain = asChain(network);
    if (!chain || !tokenAddresses?.length) return originalBalances(network, owner, tokenAddresses);
    const unique = [...new Set(tokenAddresses.map(value => value.trim()).filter(Boolean))];
    const measured = await runBounded(unique, concurrency(), token => standardBalance(chain, owner, token));
    const usable = measured.filter((value): value is TokenBalance => value !== null);
    if (usable.length === unique.length) return usable;

    // Preserve capability when one or more standard calls fail. The original
    // enhanced API remains an exact fallback rather than silently returning a
    // partial wallet view.
    return originalBalances(network, owner, tokenAddresses);
  };

  logger.info('[AlchemyCostAvoidance] Standard ERC20 reads routed through no-key RPC first', {
    component: 'AlchemyStandardRpcFirstWiring',
    metadataViaStandardRpcFirst: true,
    specificTokenBalancesViaStandardRpcFirst: true,
    allTokenEnumerationStillUsesAlchemyEnhancedApi: true,
    enhancedApiFallbackPreserved: true,
    noNewApiKeys: true,
    gasSponsorshipUntouched: true,
    balanceCacheTtlMs: balanceTtlMs(),
    metadataCacheTtlMs: metadataTtlMs(),
  });
}

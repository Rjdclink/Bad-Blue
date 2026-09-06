import { Contract } from 'ethers';
import { multiProviderRpcManager, type SupportedChain } from '../api/blockchain-providers.js';

const ERC20_DECIMALS_ABI = ['function decimals() view returns (uint8)'];
const cache = new Map<string, { decimals: number; expiresAt: number }>();
const inFlight = new Map<string, Promise<number>>();

function ttlMs(): number {
  const parsed = Number(process.env.CRYPTOCRAWL_ERC20_DECIMALS_TTL_MS || 24 * 60 * 60_000);
  return Number.isFinite(parsed)
    ? Math.max(5 * 60_000, Math.min(7 * 24 * 60 * 60_000, Math.trunc(parsed)))
    : 24 * 60 * 60_000;
}

/**
 * Token base-unit precision is execution evidence, not a symbol convention.
 * Resolve decimals from the token contract through the canonical RPC mesh and
 * cache only that immutable contract metadata. This prevents six-decimal
 * assumptions from corrupting quote sizes on networks such as BSC where the
 * configured USDC/USDT contracts use eighteen decimals.
 */
export async function getMeasuredErc20Decimals(
  chain: SupportedChain,
  tokenAddress: string,
): Promise<number> {
  const address = tokenAddress.trim();
  if (!/^0x[0-9a-fA-F]{40}$/.test(address)) throw new Error('ERC20 decimals authority requires a valid token address');
  const key = `${chain}:${address.toLowerCase()}`;
  const cached = cache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.decimals;
  const pending = inFlight.get(key);
  if (pending) return pending;

  const request = (async () => {
    await multiProviderRpcManager.initialize([chain]);
    const { result } = await multiProviderRpcManager.execute(chain, 'contract_calls', async provider => {
      const token = new Contract(address, ERC20_DECIMALS_ABI, provider);
      return Number(await token.decimals());
    });
    const decimals = Number(result);
    if (!Number.isInteger(decimals) || decimals < 0 || decimals > 36) {
      throw new Error(`ERC20 decimals are invalid for ${chain}:${address}`);
    }
    cache.set(key, { decimals, expiresAt: Date.now() + ttlMs() });
    return decimals;
  })().finally(() => inFlight.delete(key));

  inFlight.set(key, request);
  return request;
}

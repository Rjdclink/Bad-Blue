import { BigNumber } from 'ethers';
import { livePriceMesh } from '../bridge/live-price-mesh.js';
import { gasUsdToTokenBaseUnits } from '../discovery/configured-zero-capital-gas-economics.js';

const NATIVE: Record<string, string> = { ethereum: 'ETH', optimism: 'ETH', base: 'ETH', arbitrum: 'ETH', polygon: 'POL', bsc: 'BNB', avalanche: 'AVAX' };

/** A preliminary discovery budget cannot authorize a more expensive signed payload. */
export async function validatePreparedNativeFeeBudget(input: {
  chain: string; inputAssetSymbol: string; inputTokenDecimals: number;
  budgetInInputToken: bigint | undefined; maximumWei: BigNumber;
}): Promise<void> {
  const native = NATIVE[input.chain];
  if (!native || input.budgetInInputToken === undefined || input.budgetInInputToken <= 0n || input.maximumWei.lte(0)) throw new Error('Prepared native fee budget unavailable');
  const prices = await livePriceMesh.getLiveSymbolPrices([native, input.inputAssetSymbol]);
  const nativeUsd = prices.get(native);
  const tokenUsd = prices.get(input.inputAssetSymbol);
  if (!nativeUsd || !tokenUsd) throw new Error('Prepared native fee conversion lacks fresh market prices');
  const usd = Number(input.maximumWei.toString()) / 1e18 * nativeUsd;
  const cost = BigInt(gasUsdToTokenBaseUnits(usd, tokenUsd, input.inputTokenDecimals));
  if (cost > input.budgetInInputToken) throw new Error('Complete prepared network fee exceeds selected economics; reprice before submission');
}

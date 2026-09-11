import { coinGeckoPriceClient } from './coingecko-client.js';

/**
 * Provider-neutral live USD price authority used by execution economics.
 *
 * The underlying implementation resolves CoinMarketCap/CoinCap/Coinbase evidence
 * in parallel and queries CoinGecko only for symbols still missing afterward.
 * Execution callers must depend on this surface rather than on any named provider.
 */
class LivePriceMesh {
  async getLiveSymbolPrices(symbols: string[]): Promise<Map<string, number>> {
    return coinGeckoPriceClient.getLiveSymbolPrices(symbols);
  }
}

export const livePriceMesh = new LivePriceMesh();

import logger from '../../../logger.js';
import { marketDataProviders, type MarketUniverseAsset } from '../intelligence/market-data-providers.js';
import { orderMeasuredMarketUniverse, rankMeasuredMarketUniverse } from '../discovery/market-universe-controller.js';
import { fetchJsonWithRetry } from '../utils/resilient-http.js';

let installed = false;
let expandedCache: { expiresAt: number; assets: MarketUniverseAsset[] } | null = null;
let expandedInFlight: Promise<MarketUniverseAsset[]> | null = null;

function targetUniverseSize(): number {
  const configured = Number(process.env.CRYPTO_MARKET_UNIVERSE_SIZE);
  const requested = Number.isFinite(configured) && configured > 0 ? Math.floor(configured) : 120;
  // The profitability objective requires broad discovery. Keep a practical lower
  // bound above fifty while retaining a hard provider/load ceiling.
  return Math.max(64, Math.min(250, requested));
}

function cacheTtlMs(): number {
  const configured = Number(process.env.CRYPTOCRAWL_EXPANDED_UNIVERSE_TTL_MS || 300_000);
  return Math.max(60_000, Math.min(30 * 60_000, Number.isFinite(configured) ? configured : 300_000));
}

function isProductDiscoveryAsset(asset: MarketUniverseAsset): boolean {
  return asset.source === 'cex_product_directory' || asset.sources?.includes('cex_product_directory') === true;
}

async function fetchExpandedCoinGeckoUniverse(target: number): Promise<MarketUniverseAsset[]> {
  const headers: HeadersInit = { accept: 'application/json' };
  const apiKey = process.env.COINGECKO_API_KEY?.trim();
  if (apiKey) headers['x-cg-demo-api-key'] = apiKey;

  const rows = await fetchJsonWithRetry<any[]>(
    `https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=${target}&page=1&sparkline=true`,
    {
      init: { headers },
      maxRetries: 2,
      baseDelayMs: 500,
      maxDelayMs: 4_000,
      timeoutMs: 8_000,
    },
  );
  const observedAt = Date.now();
  return rows
    .filter(row => typeof row?.symbol === 'string' && row.symbol.trim())
    .map(row => ({
      symbol: `${row.symbol.trim().toUpperCase()}USDT`,
      coinGeckoId: typeof row.id === 'string' ? row.id : undefined,
      marketCapRank: Number(row.market_cap_rank) || undefined,
      priceUsd: Number.isFinite(Number(row.current_price)) ? Number(row.current_price) : undefined,
      volume24hUsd: Number.isFinite(Number(row.total_volume)) ? Number(row.total_volume) : undefined,
      marketCapUsd: Number.isFinite(Number(row.market_cap)) ? Number(row.market_cap) : undefined,
      priceChange24hPct: Number.isFinite(Number(row.price_change_percentage_24h)) ? Number(row.price_change_percentage_24h) : undefined,
      priceHistory: Array.isArray(row.sparkline_in_7d?.price)
        ? row.sparkline_in_7d.price
            .filter((price: unknown) => Number.isFinite(Number(price)) && Number(price) > 0)
            .map((price: unknown) => Number(price))
        : undefined,
      source: 'coingecko' as const,
      sources: ['coingecko' as const],
      observedAt,
    }));
}

async function expandedUniverse(): Promise<MarketUniverseAsset[]> {
  if (expandedCache && expandedCache.expiresAt > Date.now()) return expandedCache.assets.map(asset => ({ ...asset, sources: asset.sources ? [...asset.sources] : undefined }));
  if (expandedInFlight) return expandedInFlight;

  const target = targetUniverseSize();
  expandedInFlight = fetchExpandedCoinGeckoUniverse(target)
    .then(assets => {
      const ranked = rankMeasuredMarketUniverse(assets).slice(0, target);
      expandedCache = { assets: ranked, expiresAt: Date.now() + cacheTtlMs() };
      return ranked;
    })
    .catch(error => {
      logger.warn('[ExpandedUniverse] Broad CoinGecko universe refresh degraded; retaining canonical provider universe', {
        component: 'ExpandedMarketUniverse',
        target,
        error: error instanceof Error ? error.message : String(error),
      });
      return [];
    })
    .finally(() => { expandedInFlight = null; });
  return expandedInFlight;
}

/**
 * Extends the existing measured market universe without replacing the product
 * authority. External market-cap/volume evidence owns the broad ranked primary
 * set. The canonical provider's bounded cross-venue product-discovery tail is
 * preserved after that ranking instead of being silently dropped by this wrapper.
 */
export function ensureExpandedMarketUniverseWiring(): void {
  if (installed) return;
  installed = true;

  const original = marketDataProviders.discoverUniverse.bind(marketDataProviders);
  marketDataProviders.discoverUniverse = async (): Promise<MarketUniverseAsset[]> => {
    const [canonical, expanded] = await Promise.all([
      original(),
      expandedUniverse(),
    ]);

    const productTail = canonical.filter(isProductDiscoveryAsset);
    const canonicalPrimary = canonical.filter(asset => !isProductDiscoveryAsset(asset));
    const bySymbol = new Map<string, MarketUniverseAsset>();
    for (const asset of expanded) bySymbol.set(asset.symbol.toUpperCase(), { ...asset, sources: asset.sources ? [...asset.sources] : undefined });
    for (const asset of canonicalPrimary) {
      const key = asset.symbol.toUpperCase();
      const previous = bySymbol.get(key);
      bySymbol.set(key, previous ? {
        ...previous,
        ...asset,
        sources: [...new Set([...(previous.sources || [previous.source]), ...(asset.sources || [asset.source])])],
      } : { ...asset, sources: asset.sources ? [...asset.sources] : [asset.source] });
    }

    const target = targetUniverseSize();
    const rankedPrimary = rankMeasuredMarketUniverse([...bySymbol.values()]).slice(0, target);
    const primarySymbols = new Set(rankedPrimary.map(asset => asset.symbol.toUpperCase()));
    const preservedProductTail = productTail.filter(asset => !primarySymbols.has(asset.symbol.toUpperCase()));
    const combined = [...rankedPrimary, ...preservedProductTail];

    logger.info('[ExpandedUniverse] Final universe composed from broad market evidence plus live cross-venue product discovery', {
      component: 'ExpandedMarketUniverse',
      rankedPrimary: rankedPrimary.length,
      preservedProductTail: preservedProductTail.length,
      total: combined.length,
      productDiscoveryDiscardedByMarketScore: false,
      productDiscoveryExecutionAuthority: false,
    });
    return orderMeasuredMarketUniverse(combined);
  };

  logger.info('[ExpandedUniverse] Broad measured market-universe wiring installed', {
    component: 'ExpandedMarketUniverse',
    targetSymbols: targetUniverseSize(),
    newCredentialsRequired: false,
    canonicalProviderEvidencePreserved: true,
    crossVenueProductDiscoveryTailPreserved: true,
  });
}

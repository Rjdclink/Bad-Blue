import logger from '../../../logger.js';
import { marketDataProviders, type MarketUniverseAsset } from '../intelligence/market-data-providers.js';
import { orderMeasuredMarketUniverse } from '../discovery/market-universe-controller.js';
import { canonicalizeCexSymbol, isUsefulArbitrageSymbol } from '../discovery/symbol-registry.js';
import { getLiveSpotProductDirectory } from '../execution/cex-spot-product-policy.js';
import { getCoinbaseAdvancedSpotProductDirectory } from '../intelligence/coinbase-advanced-market-data.js';
import { getCachedOkxExecutionRestBaseUrl } from '../intelligence/cex-private-authority.js';

let installed = false;
let expandedCache: { expiresAt: number; assets: MarketUniverseAsset[] } | null = null;
let expandedInFlight: Promise<MarketUniverseAsset[]> | null = null;

type PrimaryVenue = 'coinbase' | 'kraken' | 'okx';
type ProductDirectoryObservation = { venue: PrimaryVenue; observedAt: number; symbols: string[] };

function targetUniverseSize(): number {
  const configured = Number(process.env.CRYPTO_MARKET_UNIVERSE_SIZE);
  const requested = Number.isFinite(configured) && configured > 0 ? Math.floor(configured) : 120;
  return Math.max(64, Math.min(250, requested));
}

function cacheTtlMs(): number {
  const configured = Number(process.env.CRYPTOCRAWL_EXPANDED_UNIVERSE_TTL_MS || 60_000);
  return Math.max(10_000, Math.min(5 * 60_000, Number.isFinite(configured) ? configured : 60_000));
}

function cloneAssets(assets: readonly MarketUniverseAsset[]): MarketUniverseAsset[] {
  return assets.map(asset => ({ ...asset, sources: asset.sources ? [...asset.sources] : undefined }));
}

/**
 * The arbitrage search universe is owned by products that are actually listed on
 * multiple executable CEX venues, not by a market-cap website. Coinbase, Kraken
 * and OKX directories are fetched in parallel and intersected before ranking.
 * External aggregators remain available through the canonical provider mesh only
 * as enrichment/fallback evidence and never become the broad primary authority.
 */
async function fetchLiveCrossVenueUniverse(target: number): Promise<MarketUniverseAsset[]> {
  const tasks: Array<Promise<ProductDirectoryObservation | null>> = [
    getCoinbaseAdvancedSpotProductDirectory()
      .then(directory => ({ ...directory, venue: 'coinbase' as const }))
      .catch(error => {
        logger.debug('[ExpandedUniverse] Coinbase product directory unavailable for this refresh', {
          component: 'ExpandedMarketUniverse',
          error: error instanceof Error ? error.message : String(error),
        });
        return null;
      }),
    getLiveSpotProductDirectory('kraken')
      .then(directory => ({ ...directory, venue: 'kraken' as const }))
      .catch(error => {
        logger.debug('[ExpandedUniverse] Kraken product directory unavailable for this refresh', {
          component: 'ExpandedMarketUniverse',
          error: error instanceof Error ? error.message : String(error),
        });
        return null;
      }),
  ];

  if (getCachedOkxExecutionRestBaseUrl()) {
    tasks.push(
      getLiveSpotProductDirectory('okx')
        .then(directory => ({ ...directory, venue: 'okx' as const }))
        .catch(error => {
          logger.debug('[ExpandedUniverse] OKX product directory unavailable for this refresh', {
            component: 'ExpandedMarketUniverse',
            error: error instanceof Error ? error.message : String(error),
          });
          return null;
        }),
    );
  }

  const directories = (await Promise.all(tasks)).filter((value): value is ProductDirectoryObservation => value !== null);
  const support = new Map<string, { venues: Set<PrimaryVenue>; observedAt: number }>();
  for (const directory of directories) {
    for (const raw of directory.symbols) {
      const canonical = canonicalizeCexSymbol(raw);
      if (!canonical || !isUsefulArbitrageSymbol(canonical.symbol)) continue;
      const current = support.get(canonical.symbol) || { venues: new Set<PrimaryVenue>(), observedAt: 0 };
      current.venues.add(directory.venue);
      current.observedAt = Math.max(current.observedAt, directory.observedAt);
      support.set(canonical.symbol, current);
    }
  }

  const eligible = [...support.entries()]
    .filter(([, value]) => value.venues.size >= 2)
    .sort((left, right) => right[1].venues.size - left[1].venues.size || left[0].localeCompare(right[0]))
    .slice(0, target);

  logger.info('[ExpandedUniverse] Live executable cross-venue product universe refreshed', {
    component: 'ExpandedMarketUniverse',
    primaryAuthority: 'parallel_live_coinbase_kraken_okx_product_directories',
    directoryVenues: directories.map(directory => directory.venue),
    directoryCounts: Object.fromEntries(directories.map(directory => [directory.venue, directory.symbols.length])),
    crossVenueEligible: eligible.length,
    minimumVenueSupport: 2,
    coinGeckoRole: 'redundancy_enrichment_only',
    externalAggregatorExecutionAuthority: false,
  });

  return eligible.map(([symbol, value]) => ({
    symbol,
    source: 'cex_product_directory' as const,
    sources: ['cex_product_directory' as const],
    observedAt: value.observedAt || Date.now(),
  }));
}

async function expandedUniverse(): Promise<MarketUniverseAsset[]> {
  if (expandedCache && expandedCache.expiresAt > Date.now()) return cloneAssets(expandedCache.assets);
  if (expandedInFlight) return cloneAssets(await expandedInFlight);

  const target = targetUniverseSize();
  expandedInFlight = fetchLiveCrossVenueUniverse(target)
    .then(assets => {
      const ordered = orderMeasuredMarketUniverse(assets).slice(0, target);
      expandedCache = { assets: ordered, expiresAt: Date.now() + cacheTtlMs() };
      return ordered;
    })
    .catch(error => {
      logger.warn('[ExpandedUniverse] Live cross-venue directory refresh degraded; canonical provider mesh remains available as redundancy', {
        component: 'ExpandedMarketUniverse',
        target,
        error: error instanceof Error ? error.message : String(error),
        coinGeckoPromotedToPrimary: false,
      });
      return [];
    })
    .finally(() => { expandedInFlight = null; });
  return cloneAssets(await expandedInFlight);
}

/**
 * Extends the canonical provider without granting a second execution authority.
 * Live multi-venue product support owns the primary set. Canonical aggregator
 * evidence may enrich those rows and is used as a fallback universe only when no
 * live multi-venue directory can be obtained at all.
 */
export function ensureExpandedMarketUniverseWiring(): void {
  if (installed) return;
  installed = true;

  const original = marketDataProviders.discoverUniverse.bind(marketDataProviders);
  marketDataProviders.discoverUniverse = async (): Promise<MarketUniverseAsset[]> => {
    const [canonical, liveCrossVenue] = await Promise.all([
      original(),
      expandedUniverse(),
    ]);

    const canonicalBySymbol = new Map(canonical.map(asset => [asset.symbol.toUpperCase(), asset]));
    const primary = liveCrossVenue.map(asset => {
      const enrichment = canonicalBySymbol.get(asset.symbol.toUpperCase());
      if (!enrichment) return asset;
      return {
        ...enrichment,
        ...asset,
        // Preserve live multi-venue listing as the authority while retaining
        // measured price/volume metadata from every available provider.
        source: 'cex_product_directory' as const,
        sources: [...new Set([
          'cex_product_directory' as const,
          ...(enrichment.sources || [enrichment.source]),
        ])],
        observedAt: Math.max(asset.observedAt, enrichment.observedAt),
      };
    });

    if (primary.length > 0) {
      const ordered = orderMeasuredMarketUniverse(primary).slice(0, targetUniverseSize());
      logger.info('[ExpandedUniverse] Final market universe uses live cross-venue product support as primary authority', {
        component: 'ExpandedMarketUniverse',
        total: ordered.length,
        primaryAuthority: 'parallel_live_cross_venue_product_directories',
        canonicalAggregatorRowsUsedForEnrichment: ordered.filter(asset => (asset.sources?.length || 0) > 1).length,
        coinGeckoPrimaryAuthority: false,
        coinGeckoRequiredForDiscovery: false,
        executionAuthorityChanged: false,
      });
      return ordered;
    }

    logger.warn('[ExpandedUniverse] No live multi-venue product directory was available; using bounded canonical provider universe as observation-only fallback', {
      component: 'ExpandedMarketUniverse',
      fallbackRows: canonical.length,
      fallbackAuthority: 'redundancy_observation_only_until_exact_venue_revalidation',
      coinGeckoPrimaryAuthority: false,
      executionAuthorityChanged: false,
    });
    return orderMeasuredMarketUniverse(canonical).slice(0, targetUniverseSize());
  };

  logger.info('[ExpandedUniverse] Broad market-universe wiring installed', {
    component: 'ExpandedMarketUniverse',
    targetSymbols: targetUniverseSize(),
    primaryAuthority: 'parallel_live_coinbase_kraken_okx_product_directories',
    coinGeckoRole: 'absolute_redundancy_within_canonical_provider_mesh',
    crossVenueProductSupportRequiredForPrimary: true,
    newCredentialsRequired: false,
  });
}

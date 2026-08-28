import logger from '../../../logger.js';
import { multiProviderRpcManager, type SupportedChain } from '../api/blockchain-providers.js';
import { measuredCandidateRegistry } from '../discovery/measured-candidate-registry.js';
import { cexOrderBookStreams, type CexStreamVenue } from '../intelligence/cex-order-book-stream.js';
import { marketDataProviders } from '../intelligence/market-data-providers.js';

let timer: NodeJS.Timeout | null = null;
let inFlight = false;
let lastWarmAt: number | null = null;
let lastWarmTargets = { cex: [] as string[], chains: [] as SupportedChain[] };

const VENUES = new Set<CexStreamVenue>(['coinbase','kraken','okx']);
const CHAIN_ALIASES: Record<string, SupportedChain> = {
  ethereum:'ethereum', eth:'ethereum', polygon:'polygon', matic:'polygon', arbitrum:'arbitrum', arb:'arbitrum',
  optimism:'optimism', op:'optimism', base:'base', avalanche:'avalanche', avax:'avalanche', bsc:'bsc', binance:'bsc',
};
function chain(value: string): SupportedChain | null { return CHAIN_ALIASES[value.trim().toLowerCase()] || null; }
function venue(value: string): CexStreamVenue | null {
  const normalized = value.trim().toLowerCase() as CexStreamVenue;
  return VENUES.has(normalized) ? normalized : null;
}
function increment<K>(map: Map<K, number>, key: K, weight = 1): void { map.set(key, (map.get(key) || 0) + weight); }

async function warmMeasuredDensity(): Promise<void> {
  if (inFlight) return;
  inFlight = true;
  try {
    const recent = measuredCandidateRegistry.getRecent(Math.max(128, Number(process.env.CRYPTO_HOT_PREWARM_SCAN_LIMIT || 512)))
      .filter(candidate => candidate.expiresAt >= Date.now() && !['blocked','expired'].includes(candidate.status));
    const venueSymbols = new Map<string, number>();
    const chainDensity = new Map<SupportedChain, number>();
    for (const candidate of recent) {
      const weight = candidate.status === 'eligible' ? 4 : candidate.status === 'deterministic_positive' ? 3 : candidate.status === 'enriched' ? 2 : 1;
      for (const rawChain of candidate.chains) { const normalized = chain(rawChain); if (normalized) increment(chainDensity, normalized, weight); }
      const symbols = [...new Set(candidate.rawQuotes.map(quote => quote.symbol).filter((value): value is string => Boolean(value)))];
      for (const rawVenue of candidate.venues) {
        const normalized = venue(rawVenue); if (!normalized) continue;
        for (const symbol of symbols) increment(venueSymbols, `${normalized}:${symbol.toUpperCase()}`, weight);
      }
    }

    const maxCex = Math.max(1, Math.min(50, Number(process.env.CRYPTO_HOT_PREWARM_CEX_TARGETS || 12)));
    const maxChains = Math.max(1, Math.min(7, Number(process.env.CRYPTO_HOT_PREWARM_CHAIN_TARGETS || 4)));
    const cexTargets = [...venueSymbols.entries()].sort((a,b) => b[1] - a[1]).slice(0, maxCex).map(([key]) => key);
    const chains = [...chainDensity.entries()].sort((a,b) => b[1] - a[1]).slice(0, maxChains).map(([key]) => key);

    // Existing provider objects and websocket managers own connection lifecycle;
    // this layer only chooses measured-density targets to warm.
    if (chains.length) await multiProviderRpcManager.initialize(chains);
    await Promise.allSettled(cexTargets.map(target => {
      const separator = target.indexOf(':');
      const v = target.slice(0, separator) as CexStreamVenue;
      const symbol = target.slice(separator + 1);
      return cexOrderBookStreams.getQuote(v, symbol);
    }));
    if (recent.length > 0) await marketDataProviders.discoverUniverse().catch(() => []);

    lastWarmAt = Date.now();
    lastWarmTargets = { cex: cexTargets, chains };
  } catch (error) {
    logger.warn('[HotPrewarm] measured-density prewarming degraded', {
      component: 'HotConnectionPrewarming', error: error instanceof Error ? error.message : String(error), executionBlocked: false,
    });
  } finally { inFlight = false; }
}

export function ensureHotConnectionPrewarming(): void {
  if (timer || process.env.NO_INTERVALS === 'true') return;
  const intervalMs = Math.max(5_000, Number(process.env.CRYPTO_HOT_PREWARM_INTERVAL_MS || 20_000));
  void warmMeasuredDensity();
  timer = setInterval(() => void warmMeasuredDensity(), intervalMs);
  timer.unref();
  logger.info('[HotPrewarm] measured-density connection prewarming installed', {
    component: 'HotConnectionPrewarming', intervalMs,
    selectionAuthority: 'measured_opportunity_density',
    freshnessAuthority: 'venue_provider_ttl_and_sequence_checks',
    unboundedConnectionFanout: false,
    executionAuthority: false,
  });
}

export function getHotConnectionPrewarmingHealth() {
  return {
    running: timer !== null, inFlight, lastWarmAt, lastWarmTargets,
    cexStream: cexOrderBookStreams.getStats(),
    selectionAuthority: 'measured_opportunity_density' as const,
    warmConnectionIsFreshEvidence: false as const,
    executionAuthority: false as const,
  };
}

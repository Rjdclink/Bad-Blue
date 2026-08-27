import logger from '../../../logger.js';
import { getActiveExecutableQuoteVenues } from '../discovery/venue-capability-registry.js';
import { getLastOrderedMarketUniverseSymbols } from '../discovery/market-universe-controller.js';
import { cexOrderBookStreams } from '../intelligence/cex-order-book-stream.js';
import { orderBookEvolutionStore } from '../validation/order-book-evolution-store.js';

let timer: NodeJS.Timeout | null = null;
let running = false;

async function observeOnce(): Promise<void> {
  if (running) return;
  running = true;
  try {
    const venues = getActiveExecutableQuoteVenues();
    const symbols = getLastOrderedMarketUniverseSymbols().slice(0, Math.max(1, Math.min(32,
      Number(process.env.CRYPTOCRAWL_BOOK_EVOLUTION_SYMBOLS || 16),
    )));
    const maxAgeMs = Math.max(500, Number(process.env.CRYPTO_ARBITRAGE_MAX_QUOTE_AGE_MS || 5_000));
    await Promise.all(venues.flatMap(venue => symbols.map(async symbol => {
      const quote = await cexOrderBookStreams.getQuote(venue, symbol, maxAgeMs).catch(() => null);
      if (quote) orderBookEvolutionStore.record(quote);
    })));
  } finally {
    running = false;
  }
}

export function ensureOrderBookEvolutionWiring(): void {
  if (timer) return;
  const intervalMs = Math.max(500, Number(process.env.CRYPTOCRAWL_BOOK_EVOLUTION_INTERVAL_MS || 1_000));
  void observeOnce();
  timer = setInterval(() => void observeOnce(), intervalMs);
  timer.unref?.();
  logger.info('[OrderBookEvolution] Measured short-horizon book observer installed', {
    component: 'OrderBookEvolutionWiring',
    intervalMs,
    authoritativeVenues: getActiveExecutableQuoteVenues(),
    syntheticTransitions: false,
  });
}

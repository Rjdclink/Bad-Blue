import logger from '../../../logger.js';
import type { VerifiedArbitragePlan } from '../arbitrage/arbitrage-verifier.js';
import { centralizedExchangeExecutor, type ArbitrageExecutionResult } from '../execution/centralized-exchange-executor.js';
import { cexOrderBookStreams, type CexStreamVenue } from '../intelligence/cex-order-book-stream.js';

let installed = false;

function reject(reason: string): ArbitrageExecutionResult {
  return { success: false, status: 'rejected', settlementConfirmed: false, error: reason };
}

function maxQuoteAgeMs(): number {
  const parsed = Number(process.env.CRYPTO_ARBITRAGE_MAX_QUOTE_AGE_MS || 5_000);
  return Number.isFinite(parsed) ? Math.max(250, Math.min(15_000, Math.trunc(parsed))) : 5_000;
}

function maxCrossVenueSkewMs(): number {
  const parsed = Number(process.env.CRYPTO_ARBITRAGE_MAX_CROSS_VENUE_SKEW_MS || 1_250);
  return Number.isFinite(parsed) ? Math.max(50, Math.min(5_000, Math.trunc(parsed))) : 1_250;
}

function activeVenue(value: string): value is CexStreamVenue {
  return value === 'kraken' || value === 'okx';
}

export function ensureCrossVenueTimingGuardWiring(): void {
  if (installed) return;
  installed = true;
  const target = centralizedExchangeExecutor as typeof centralizedExchangeExecutor & {
    execute: (plan: VerifiedArbitragePlan) => Promise<ArbitrageExecutionResult>;
  };
  const originalExecute = target.execute.bind(target);

  target.execute = async (plan: VerifiedArbitragePlan): Promise<ArbitrageExecutionResult> => {
    if (!activeVenue(plan.buyVenue) || !activeVenue(plan.sellVenue)) return originalExecute(plan);
    if (plan.buyVenue === plan.sellVenue) return reject('REJECT_CROSS_VENUE_TIMING: distinct executable venues are required');

    const ageLimit = maxQuoteAgeMs();
    const [buy, sell] = await Promise.all([
      cexOrderBookStreams.getQuote(plan.buyVenue, plan.symbol, ageLimit).catch(() => null),
      cexOrderBookStreams.getQuote(plan.sellVenue, plan.symbol, ageLimit).catch(() => null),
    ]);
    if (!buy || !sell) {
      return reject('REJECT_CROSS_VENUE_TIMING: synchronized executable books are unavailable');
    }
    const now = Date.now();
    const buyAgeMs = Math.max(0, now - buy.timestamp);
    const sellAgeMs = Math.max(0, now - sell.timestamp);
    const skewMs = Math.abs(buy.timestamp - sell.timestamp);
    if (buyAgeMs > ageLimit || sellAgeMs > ageLimit) {
      return reject('REJECT_CROSS_VENUE_TIMING: one or both executable books are stale');
    }
    if (skewMs > maxCrossVenueSkewMs()) {
      logger.info('[CrossVenueTimingGuard] CEX execution rejected because otherwise-fresh books were not synchronized closely enough', {
        component: 'CrossVenueTimingGuardWiring',
        symbol: plan.symbol,
        buyVenue: plan.buyVenue,
        sellVenue: plan.sellVenue,
        buyAgeMs,
        sellAgeMs,
        skewMs,
        maxCrossVenueSkewMs: maxCrossVenueSkewMs(),
        executionAuthorityGranted: false,
      });
      return reject('REJECT_CROSS_VENUE_TIMING: executable book timestamp skew exceeds bounded tolerance');
    }
    if (!(sell.bid > buy.ask)) {
      return reject('REJECT_CROSS_VENUE_TIMING: synchronized raw cross-venue edge no longer exists');
    }

    return originalExecute(plan);
  };

  logger.info('[CrossVenueTimingGuard] Synchronized Kraken/OKX execution timing guard installed', {
    component: 'CrossVenueTimingGuardWiring',
    maxCrossVenueSkewMs: maxCrossVenueSkewMs(),
    maxQuoteAgeMs: maxQuoteAgeMs(),
    rawEdgeRevalidated: true,
    fullEconomicsRequoteStillDownstream: true,
    executionAuthority: false,
  });
}

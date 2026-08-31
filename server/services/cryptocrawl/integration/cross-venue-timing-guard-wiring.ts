import logger from '../../../logger.js';
import type { VerifiedArbitragePlan } from '../arbitrage/arbitrage-verifier.js';
import { centralizedExchangeExecutor, type ArbitrageExecutionResult } from '../execution/centralized-exchange-executor.js';
import type { MakerRecoveryPlan } from '../execution/stablecoin-maker-strategy.js';
import { cexOrderBookStreams, type CexStreamVenue, type StreamOrderBookQuote } from '../intelligence/cex-order-book-stream.js';
import { isHybridCexRecoveryPlan } from '../runtime/hybrid-cex-execution-wiring.js';

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
  return value === 'coinbase' || value === 'kraken' || value === 'okx';
}

function isMakerRecoveryPlan(plan: VerifiedArbitragePlan): plan is MakerRecoveryPlan {
  const maker = (plan as Partial<MakerRecoveryPlan>).makerExecution;
  return Boolean(maker && maker.buyMode === 'maker' && maker.sellMode === 'maker');
}

function synchronizedPlanEdge(plan: VerifiedArbitragePlan, buy: StreamOrderBookQuote, sell: StreamOrderBookQuote): {
  positive: boolean;
  buyPrice: number;
  sellPrice: number;
  mode: 'TT' | 'MT' | 'TM' | 'MM';
} {
  if (isHybridCexRecoveryPlan(plan)) {
    const buyPrice = plan.hybridExecution.buyMode === 'maker' ? buy.bid : buy.ask;
    const sellPrice = plan.hybridExecution.sellMode === 'maker' ? sell.ask : sell.bid;
    return { positive: sellPrice > buyPrice, buyPrice, sellPrice, mode: plan.hybridExecution.mode };
  }
  if (isMakerRecoveryPlan(plan)) {
    return { positive: sell.ask > buy.bid, buyPrice: buy.bid, sellPrice: sell.ask, mode: 'MM' };
  }
  return { positive: sell.bid > buy.ask, buyPrice: buy.ask, sellPrice: sell.bid, mode: 'TT' };
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
    if (!buy || !sell) return reject('REJECT_CROSS_VENUE_TIMING: synchronized executable books are unavailable');

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

    const edge = synchronizedPlanEdge(plan, buy, sell);
    if (!edge.positive) return reject(`REJECT_CROSS_VENUE_TIMING: synchronized ${edge.mode} cross-venue edge no longer exists`);

    logger.debug('[CrossVenueTimingGuard] Synchronized plan-mode edge preserved', {
      component: 'CrossVenueTimingGuardWiring',
      symbol: plan.symbol,
      buyVenue: plan.buyVenue,
      sellVenue: plan.sellVenue,
      mode: edge.mode,
      buyPrice: edge.buyPrice,
      sellPrice: edge.sellPrice,
      skewMs,
      fullEconomicsRequoteStillDownstream: true,
      executionAuthorityGranted: false,
    });
    return originalExecute(plan);
  };

  logger.info('[CrossVenueTimingGuard] Synchronized Coinbase/Kraken/OKX execution timing guard installed', {
    component: 'CrossVenueTimingGuardWiring',
    maxCrossVenueSkewMs: maxCrossVenueSkewMs(),
    maxQuoteAgeMs: maxQuoteAgeMs(),
    rawEdgeRevalidated: true,
    planModeAware: true,
    supportedModes: ['TT', 'MT', 'TM', 'MM'],
    fullEconomicsRequoteStillDownstream: true,
    executionAuthority: false,
  });
}

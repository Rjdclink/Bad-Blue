import logger from '../../../logger.js';
import { arbitrageVerifier, type QuoteVenue, type VerifiedArbitragePlan } from '../arbitrage/arbitrage-verifier.js';
import { getSpotProductConstraints } from '../execution/cex-spot-product-policy.js';
import { floorToIncrement } from '../execution/coinbase-product-policy.js';
import {
  getDynamicMakerCanaryStatus,
  type MakerRecoveryPlan,
} from '../execution/stablecoin-maker-strategy.js';
import {
  estimateAriesVenueLeadLag,
  observeAriesQueueEcho,
  stressTestAriesSpread,
} from '../intelligence/aries-microstructure.js';
import { resolveCexFeeEvidence, type CexFeeEvidence } from '../intelligence/cex-fee-resolver.js';
import { cexOrderBookStreams } from '../intelligence/cex-order-book-stream.js';

let installed = false;

function authenticatedMakerFeeBps(evidence: CexFeeEvidence | null): number | null {
  if (!evidence || evidence.source === 'configured_override') return null;
  if (evidence.makerFeeBps !== null && Number.isFinite(evidence.makerFeeBps)) return evidence.makerFeeBps;
  if (evidence.makerRebateBps !== null && Number.isFinite(evidence.makerRebateBps)) return -Math.abs(evidence.makerRebateBps);
  return null;
}

async function evaluateNoBpsFloorMaker(input: {
  symbol: string;
  notionalUsd: number;
  maxQuoteAgeMs: number;
}): Promise<MakerRecoveryPlan | null> {
  const symbol = input.symbol.trim().toUpperCase();
  if (!(input.notionalUsd > 0) || !/^([A-Z0-9]+?)(USDT|USDC|USD)$/.test(symbol)) return null;

  const [krakenBook, okxBook, krakenFee, okxFee] = await Promise.all([
    cexOrderBookStreams.getQuote('kraken', symbol, input.maxQuoteAgeMs).catch(() => null),
    cexOrderBookStreams.getQuote('okx', symbol, input.maxQuoteAgeMs).catch(() => null),
    resolveCexFeeEvidence('kraken', symbol).catch(() => null),
    resolveCexFeeEvidence('okx', symbol).catch(() => null),
  ]);
  if (!krakenBook || !okxBook) return null;

  const feeEvidence: Record<'kraken' | 'okx', CexFeeEvidence | null> = {
    kraken: krakenFee,
    okx: okxFee,
  };
  const books = [
    { venue: 'kraken' as const, quote: krakenBook },
    { venue: 'okx' as const, quote: okxBook },
  ];
  const makerCanary = getDynamicMakerCanaryStatus();
  const notionalCap = Math.min(input.notionalUsd, makerCanary.ceilingUsd);
  if (!(notionalCap > 0)) return null;

  let best: MakerRecoveryPlan | null = null;
  for (const buy of books) {
    for (const sell of books) {
      if (buy.venue === sell.venue) continue;
      const buyFeeBps = authenticatedMakerFeeBps(feeEvidence[buy.venue]);
      const sellFeeBps = authenticatedMakerFeeBps(feeEvidence[sell.venue]);
      if (buyFeeBps === null || sellFeeBps === null) continue;

      // Post-only maker orders rest on the book: buy at current bid, sell at current ask.
      const buyPrice = buy.quote.bid;
      const sellPrice = sell.quote.ask;
      if (!(buyPrice > 0) || !(sellPrice > buyPrice)) continue;
      const grossSpreadBps = ((sellPrice - buyPrice) / buyPrice) * 10_000;
      const combinedMakerFeeBps = buyFeeBps + sellFeeBps;
      // No static BPS admission floor. The only economic floor is actual positive
      // all-in dollar profit after the authenticated maker fees below.
      if (!(grossSpreadBps > combinedMakerFeeBps)) continue;

      const [buyConstraints, sellConstraints] = await Promise.all([
        getSpotProductConstraints(buy.venue, symbol).catch(() => null),
        getSpotProductConstraints(sell.venue, symbol).catch(() => null),
      ]);
      if (!buyConstraints || !sellConstraints) continue;

      const buyTopQty = Number(buy.quote.depth.bids[0]?.quantity || 0);
      const sellTopQty = Number(sell.quote.depth.asks[0]?.quantity || 0);
      if (!(buyTopQty > 0) || !(sellTopQty > 0)) continue;
      const commonIncrement = Math.max(buyConstraints.baseIncrement, sellConstraints.baseIncrement);
      const requestedQty = Math.min(notionalCap / buyPrice, buyTopQty, sellTopQty);
      const baseQty = floorToIncrement(requestedQty, commonIncrement);
      if (!(baseQty > 0) || baseQty < buyConstraints.baseMinSize || baseQty < sellConstraints.baseMinSize) continue;

      const buyNotional = baseQty * buyPrice;
      const sellNotional = baseQty * sellPrice;
      if (buyConstraints.quoteMinSize !== null && buyNotional < buyConstraints.quoteMinSize) continue;
      if (sellConstraints.quoteMinSize !== null && sellNotional < sellConstraints.quoteMinSize) continue;

      const buyFeeUsd = buyNotional * buyFeeBps / 10_000;
      const sellFeeUsd = sellNotional * sellFeeBps / 10_000;
      const grossProfitUsd = sellNotional - buyNotional;
      const totalCostsUsd = buyFeeUsd + sellFeeUsd;
      const netProfitUsd = grossProfitUsd - totalCostsUsd;
      if (!(netProfitUsd > 0)) continue;

      const ttlMs = Math.max(2_000, Math.min(30_000, Number(process.env.CRYPTO_ARBITRAGE_MAKER_TTL_MS || 30_000)));
      const buyQueue = observeAriesQueueEcho(buy.quote, 'buy', ttlMs, 0.02);
      const sellQueue = observeAriesQueueEcho(sell.quote, 'sell', ttlMs, 0.02);
      const jointFillProbability = Math.max(0, Math.min(1, buyQueue.fillProbabilityWithinTtl * sellQueue.fillProbabilityWithinTtl));
      const causal = estimateAriesVenueLeadLag(symbol, buy.venue, sell.venue);
      const stress = stressTestAriesSpread(grossSpreadBps, buy.venue, sell.venue, symbol);
      const quoteAgeMs = Math.max(Date.now() - buy.quote.timestamp, Date.now() - sell.quote.timestamp);
      if (quoteAgeMs > input.maxQuoteAgeMs) continue;

      const candidate = {
        symbol,
        notionalUsd: buyNotional,
        requestedNotionalUsd: input.notionalUsd,
        executableNotionalUsd: buyNotional,
        buyVenue: buy.venue as QuoteVenue,
        sellVenue: sell.venue as QuoteVenue,
        buyAsk: buyPrice,
        sellBid: sellPrice,
        buyLimitPrice: buyPrice,
        sellLimitPrice: sellPrice,
        baseQty,
        grossProfitUsd,
        netProfitUsd,
        spreadPct: ((sellPrice - buyPrice) / buyPrice) * 100,
        costs: { buyFeeUsd, sellFeeUsd, gasUsd: 0, bridgeFeeUsd: 0, transferFeeUsd: 0, totalCostsUsd },
        quoteAgeMs,
        expectedSlippageBps: 0,
        expectedPriceImpactBps: 0,
        liquidity: {
          status: 'measured' as const,
          buyAvailableBaseQty: buyTopQty,
          sellAvailableBaseQty: sellTopQty,
          source: [`${buy.venue}:websocket_post_only`, `${sell.venue}:websocket_post_only`],
        },
        feeEvidence: { buy: feeEvidence[buy.venue]!, sell: feeEvidence[sell.venue]! },
        crossVenueCostModel: 'prepositioned_inventory' as const,
        makerExecution: {
          strategy: 'volatile_spread_post_only' as const,
          buyMode: 'maker' as const,
          sellMode: 'maker' as const,
          ttlMs,
          takerFallbackAllowed: false as const,
          feeAuthority: 'authenticated' as const,
          bookAuthority: 'websocket' as const,
          canaryCeilingUsd: makerCanary.ceilingUsd,
          canaryProofSamples: makerCanary.samples,
          canaryConfidenceScore: makerCanary.confidenceScore,
          canarySizingAuthority: makerCanary.sizingAuthority,
          volatileMinGrossSpreadBps: null,
          queueEcho: {
            buyFillProbability: buyQueue.fillProbabilityWithinTtl,
            sellFillProbability: sellQueue.fillProbabilityWithinTtl,
            jointFillProbability,
            buyArrivalRatePerSecond: buyQueue.orderArrivalRatePerSecond,
            sellArrivalRatePerSecond: sellQueue.orderArrivalRatePerSecond,
            buyQueueClearSeconds: buyQueue.queueClearSeconds,
            sellQueueClearSeconds: sellQueue.queueClearSeconds,
            authority: (buyQueue.orderArrivalRatePerSecond > 0 && sellQueue.orderArrivalRatePerSecond > 0) ? 'measured_history' as const : 'cold_start' as const,
          },
          fractionalKelly: {
            applied: false,
            recommendedFraction: null,
            recommendedNotionalUsd: null,
            atrFraction: Math.max(buyQueue.atrFraction, sellQueue.atrFraction),
            hurstExponent: (buyQueue.hurstExponent + sellQueue.hurstExponent) / 2,
          },
          causalLeadLag: {
            leaderVenue: causal.leaderVenue,
            followerVenue: causal.followerVenue,
            confidence: causal.confidence,
            lagMs: causal.lagMs,
          },
          spreadStress: stress,
        },
      } as MakerRecoveryPlan;

      if (!best || candidate.netProfitUsd > best.netProfitUsd) best = candidate;
    }
  }
  return best;
}

export function ensureNoBpsMakerAdmissionWiring(): void {
  if (installed) return;
  installed = true;

  const verifier = arbitrageVerifier as typeof arbitrageVerifier & {
    evaluateOnce: (request: any) => Promise<VerifiedArbitragePlan | null>;
    verifyOnce: (request: any) => Promise<VerifiedArbitragePlan | null>;
  };
  const originalEvaluateOnce = verifier.evaluateOnce.bind(verifier);

  verifier.evaluateOnce = async (request: any): Promise<VerifiedArbitragePlan | null> => {
    const existing = await originalEvaluateOnce(request);
    if (existing) return existing;
    return evaluateNoBpsFloorMaker({
      symbol: String(request?.symbol || ''),
      notionalUsd: Number(request?.notionalUsd || 0),
      maxQuoteAgeMs: Math.max(250, Number(request?.maxQuoteAgeMs || process.env.CRYPTO_ARBITRAGE_MAX_QUOTE_AGE_MS || 5_000)),
    });
  };
  verifier.verifyOnce = async (request: any): Promise<VerifiedArbitragePlan | null> => {
    const plan = await verifier.evaluateOnce(request);
    return plan && Number.isFinite(plan.netProfitUsd) && plan.netProfitUsd > 0 ? plan : null;
  };

  logger.info('[NoBpsMakerAdmission] Maker recovery now uses measured economics without an arbitrary BPS floor', {
    component: 'NoBpsMakerAdmissionWiring',
    bpsExecutionFloor: null,
    executionRule: 'strict_all_in_net_profit_usd_greater_than_zero',
    authenticatedMakerFeesRequired: true,
    measuredProductConstraintsRequired: true,
    freshWebsocketBooksRequired: true,
    postOnlyExecution: true,
  });
}

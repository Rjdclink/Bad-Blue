import type { VerifiedArbitragePlan, QuoteVenue } from '../arbitrage/arbitrage-verifier.js';
import {
  getCoinbaseAdvancedProductBook,
  getCoinbaseAdvancedProductConstraints,
} from '../intelligence/coinbase-advanced-market-data.js';
import { resolveCexFeeEvidence, type CexFeeEvidence, type CexFeeVenue } from '../intelligence/cex-fee-resolver.js';
import { getOkxExecutionRestBaseUrl } from '../intelligence/cex-private-authority.js';
import { cexOrderBookStreams, type StreamOrderBookQuote } from '../intelligence/cex-order-book-stream.js';
import {
  getOkxRpiExecutionCapability,
  isOkxRpiMakerPriceAdmissible,
  type OkxRpiExecutionCapability,
} from '../intelligence/okx-rpi-fee-advisory.js';
import {
  computeAriesFractionalKellySizing,
  estimateAriesVenueLeadLag,
  observeAriesQueueEcho,
  stressTestAriesSpread,
  type AriesQueueEcho,
} from '../intelligence/aries-microstructure.js';
import { fetchJsonWithRetry } from '../utils/resilient-http.js';
import { floorToIncrement } from './coinbase-product-policy.js';
import { getSpotProductConstraints } from './cex-spot-product-policy.js';
import {
  getCryptaraDynamicMakerCanaryDecision,
  type DynamicMakerCanaryDecision,
} from './cryptara-dynamic-canary-controller.js';

export type MakerLegMode = 'maker';
export type MakerRecoveryStrategy = 'stablecoin_post_only' | 'volatile_spread_post_only';
export type MakerOrderStyle = 'post_only' | 'rpi';

type MakerExecutionMetadata = {
  strategy: MakerRecoveryStrategy;
  buyMode: MakerLegMode;
  sellMode: MakerLegMode;
  ttlMs: number;
  takerFallbackAllowed: false;
  feeAuthority: 'authenticated';
  bookAuthority: 'websocket' | 'rest_fallback';
  canaryCeilingUsd: number;
  canaryProofSamples: number;
  canaryConfidenceScore: number;
  canarySizingAuthority: 'bootstrap' | 'cryptara_realized_evidence';
  /** Compatibility telemetry only. Artificial maker BPS floors are retired. */
  volatileMinGrossSpreadBps: null;
  orderStyle: {
    buy: MakerOrderStyle;
    sell: MakerOrderStyle;
    buyEffectiveMakerFeeBps: number;
    sellEffectiveMakerFeeBps: number;
    okxRpiEvidenceObservedAt: number | null;
    rpiPermissionAndSpacingRequiredAtSubmit: true;
  };
  queueEcho: {
    buyFillProbability: number;
    sellFillProbability: number;
    jointFillProbability: number;
    buyArrivalRatePerSecond: number;
    sellArrivalRatePerSecond: number;
    buyQueueClearSeconds: number | null;
    sellQueueClearSeconds: number | null;
    authority: 'measured_history' | 'cold_start';
  };
  fractionalKelly: {
    applied: boolean;
    recommendedFraction: number | null;
    recommendedNotionalUsd: number | null;
    atrFraction: number;
    hurstExponent: number;
  };
  causalLeadLag: {
    leaderVenue: string | null;
    followerVenue: string | null;
    confidence: number;
    lagMs: number | null;
  };
  spreadStress: {
    persistenceProbability: number;
    downsideQuantileBps: number;
    expectedTerminalSpreadBps: number;
    paths: number;
  };
};

export type MakerRecoveryPlan = VerifiedArbitragePlan & {
  makerExecution: MakerExecutionMetadata;
};

export type StablecoinMakerPlan = MakerRecoveryPlan & {
  makerExecution: MakerExecutionMetadata & { strategy: 'stablecoin_post_only' };
};

type Book = {
  venue: CexFeeVenue;
  symbol: string;
  bid: number;
  bidQty: number;
  ask: number;
  askQty: number;
  observedAt: number;
  authority: 'websocket' | 'rest_fallback';
  quote: StreamOrderBookQuote;
};

type MakerCanaryProof = DynamicMakerCanaryDecision;

type MakerProductConstraints = {
  quoteAsset: string;
  baseIncrement: number;
  priceIncrement: number;
  baseMinSize: number;
  quoteMinSize: number | null;
};

type MakerLegEconomics = {
  style: MakerOrderStyle;
  feeBps: number;
  rpiEvidenceObservedAt: number | null;
};

const STABLECOIN_SYMBOLS = new Set(['USDGUSDT', 'USDCUSDT', 'DAIUSDT', 'RLUSDUSDT']);
const USD_NORMALIZED_QUOTES = new Set(['USD', 'USDC', 'USDT']);
const DEFAULT_TTL_MS = 30_000;
const CEX_VENUES: readonly CexFeeVenue[] = ['coinbase', 'kraken', 'okx'] as const;

function finitePositive(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function finiteBoundedEnv(name: string, fallback: number, min: number, max: number): number {
  const parsed = Number(process.env[name]);
  const value = Number.isFinite(parsed) ? parsed : fallback;
  return Math.max(min, Math.min(max, value));
}

function authenticatedMakerFeeBps(evidence: CexFeeEvidence | null): number | null {
  if (!evidence || evidence.source === 'configured_override') return null;
  if (evidence.makerFeeBps !== null && Number.isFinite(evidence.makerFeeBps)) return Math.max(0, evidence.makerFeeBps);
  if (evidence.makerRebateBps !== null && Number.isFinite(evidence.makerRebateBps)) return -Math.max(0, evidence.makerRebateBps);
  return null;
}

function optimisticMakerFeeBps(
  venue: CexFeeVenue,
  standardMakerFeeBps: number,
  rpi: OkxRpiExecutionCapability | null,
): number {
  if (venue !== 'okx' || !rpi?.makerPermission || !rpi.executableFeeAdvantage) return standardMakerFeeBps;
  return Math.min(standardMakerFeeBps, rpi.rpiMakerFeeBps);
}

function exactMakerLegEconomics(input: {
  venue: CexFeeVenue;
  standardMakerFeeBps: number;
  rpi: OkxRpiExecutionCapability | null;
  side: 'buy' | 'sell';
  price: number;
  oppositeOrganicPrice: number;
  tickSize: number;
  notionalUsd: number;
}): MakerLegEconomics {
  const standard: MakerLegEconomics = {
    style: 'post_only',
    feeBps: input.standardMakerFeeBps,
    rpiEvidenceObservedAt: null,
  };
  if (input.venue !== 'okx' || !input.rpi) return standard;
  if (!(input.rpi.rpiMakerFeeBps < input.standardMakerFeeBps)) return standard;
  if (!isOkxRpiMakerPriceAdmissible({
    capability: input.rpi,
    side: input.side,
    price: input.price,
    oppositeOrganicPrice: input.oppositeOrganicPrice,
    tickSize: input.tickSize,
    notionalUsd: input.notionalUsd,
  })) return standard;
  return {
    style: 'rpi',
    feeBps: input.rpi.rpiMakerFeeBps,
    rpiEvidenceObservedAt: input.rpi.observedAt,
  };
}

function makerCanaryProof(): MakerCanaryProof {
  return getCryptaraDynamicMakerCanaryDecision();
}

export function getDynamicMakerCanaryStatus(): MakerCanaryProof {
  return makerCanaryProof();
}

function maxCanaryUsd(requested: number): { amount: number; proof: MakerCanaryProof } {
  const proof = makerCanaryProof();
  return { amount: Math.min(requested, proof.ceilingUsd), proof };
}

function minMeasuredJointFillProbability(): number {
  return finiteBoundedEnv('CRYPTO_ARBITRAGE_MAKER_MIN_JOINT_FILL_PROBABILITY', 0.20, 0.05, 0.95);
}

function minMeasuredStressPersistence(): number {
  return finiteBoundedEnv('CRYPTO_ARBITRAGE_MAKER_MIN_STRESS_PERSISTENCE', 0.40, 0.10, 0.95);
}

function queueParticipationFraction(): number {
  return finiteBoundedEnv('CRYPTO_ARBITRAGE_MAKER_QUEUE_PARTICIPATION', 0.02, 0.001, 0.10);
}

function syntheticQuote(book: Omit<Book, 'quote'>): StreamOrderBookQuote {
  return {
    venue: book.venue,
    symbol: book.symbol,
    bid: book.bid,
    ask: book.ask,
    timestamp: book.observedAt,
    sequence: null,
    depth: {
      bids: [{ price: book.bid, quantity: book.bidQty }],
      asks: [{ price: book.ask, quantity: book.askQty }],
      observedAt: book.observedAt,
      source: book.venue,
    },
  };
}

async function streamBook(venue: CexFeeVenue, symbol: string, maxAgeMs: number): Promise<Book | null> {
  const quote = await cexOrderBookStreams.getQuote(venue, symbol, maxAgeMs).catch(() => null);
  if (!quote) return null;
  const bidQty = finitePositive(quote.depth.bids[0]?.quantity);
  const askQty = finitePositive(quote.depth.asks[0]?.quantity);
  if (!bidQty || !askQty) return null;
  return {
    venue,
    symbol,
    bid: quote.bid,
    bidQty,
    ask: quote.ask,
    askQty,
    observedAt: quote.timestamp,
    authority: 'websocket',
    quote,
  };
}

async function coinbaseBook(symbol: string, maxAgeMs: number): Promise<Book | null> {
  const stream = await streamBook('coinbase', symbol, maxAgeMs);
  if (stream) return stream;
  const book = await getCoinbaseAdvancedProductBook(symbol).catch(() => null);
  if (!book) return null;
  const bidQty = finitePositive(book.bids[0]?.quantity);
  const askQty = finitePositive(book.asks[0]?.quantity);
  if (!bidQty || !askQty) return null;
  const base = {
    venue: 'coinbase' as const,
    symbol,
    bid: book.bid,
    bidQty,
    ask: book.ask,
    askQty,
    observedAt: book.observedAt,
    authority: 'rest_fallback' as const,
  };
  return { ...base, quote: syntheticQuote(base) };
}

async function krakenBook(symbol: string, maxAgeMs: number): Promise<Book | null> {
  const stream = await streamBook('kraken', symbol, maxAgeMs);
  if (stream) return stream;
  const constraints = await getSpotProductConstraints('kraken', symbol).catch(() => null);
  if (!constraints) return null;
  const payload = await fetchJsonWithRetry<any>(`https://api.kraken.com/0/public/Depth?pair=${encodeURIComponent(constraints.exchangeSymbol)}&count=5`, {
    init: { headers: { accept: 'application/json' } }, maxRetries: 1, baseDelayMs: 100, maxDelayMs: 400, timeoutMs: 2_000,
  });
  const key = Object.keys(payload?.result || {})[0];
  const row = key ? payload?.result?.[key] : null;
  const bid = finitePositive(row?.b?.[0]?.[0]);
  const bidQty = finitePositive(row?.b?.[0]?.[1]);
  const ask = finitePositive(row?.a?.[0]?.[0]);
  const askQty = finitePositive(row?.a?.[0]?.[1]);
  if (!bid || !bidQty || !ask || !askQty) return null;
  const base = { venue: 'kraken' as const, symbol, bid, bidQty, ask, askQty, observedAt: Date.now(), authority: 'rest_fallback' as const };
  return { ...base, quote: syntheticQuote(base) };
}

async function okxBook(symbol: string, maxAgeMs: number): Promise<Book | null> {
  const stream = await streamBook('okx', symbol, maxAgeMs);
  if (stream) return stream;
  const constraints = await getSpotProductConstraints('okx', symbol).catch(() => null);
  if (!constraints) return null;
  const baseUrl = await getOkxExecutionRestBaseUrl();
  const payload = await fetchJsonWithRetry<any>(`${baseUrl}/api/v5/market/books?instId=${encodeURIComponent(constraints.exchangeSymbol)}&sz=5`, {
    init: { headers: { accept: 'application/json' } }, maxRetries: 1, baseDelayMs: 100, maxDelayMs: 400, timeoutMs: 2_000,
  });
  const row = payload?.data?.[0];
  const bid = finitePositive(row?.bids?.[0]?.[0]);
  const bidQty = finitePositive(row?.bids?.[0]?.[1]);
  const ask = finitePositive(row?.asks?.[0]?.[0]);
  const askQty = finitePositive(row?.asks?.[0]?.[1]);
  if (!bid || !bidQty || !ask || !askQty) return null;
  const base = { venue: 'okx' as const, symbol, bid, bidQty, ask, askQty, observedAt: Date.now(), authority: 'rest_fallback' as const };
  return { ...base, quote: syntheticQuote(base) };
}

async function venueBook(venue: CexFeeVenue, symbol: string, maxAgeMs: number): Promise<Book | null> {
  if (venue === 'coinbase') return coinbaseBook(symbol, maxAgeMs);
  if (venue === 'kraken') return krakenBook(symbol, maxAgeMs);
  return okxBook(symbol, maxAgeMs);
}

async function makerProductConstraints(venue: CexFeeVenue, symbol: string): Promise<MakerProductConstraints | null> {
  if (venue === 'coinbase') {
    const constraints = await getCoinbaseAdvancedProductConstraints(symbol).catch(() => null);
    if (!constraints || constraints.isDisabled || constraints.tradingDisabled || constraints.cancelOnly || constraints.auctionMode || constraints.viewOnly) return null;
    return {
      quoteAsset: constraints.quoteAsset,
      baseIncrement: constraints.baseIncrement,
      priceIncrement: constraints.priceIncrement,
      baseMinSize: constraints.baseMinSize,
      quoteMinSize: constraints.quoteMinSize,
    };
  }
  const constraints = await getSpotProductConstraints(venue, symbol).catch(() => null);
  if (!constraints) return null;
  return {
    quoteAsset: constraints.quoteAsset,
    baseIncrement: constraints.baseIncrement,
    priceIncrement: constraints.priceIncrement,
    baseMinSize: constraints.baseMinSize,
    quoteMinSize: constraints.quoteMinSize,
  };
}

function ttlMs(): number {
  const configured = Number(process.env.CRYPTO_ARBITRAGE_MAKER_TTL_MS || DEFAULT_TTL_MS);
  return Math.max(2_000, Math.min(30_000, Number.isFinite(configured) ? configured : DEFAULT_TTL_MS));
}

function measuredQueueEvidence(echo: AriesQueueEcho): boolean {
  return echo.orderArrivalRatePerSecond > 0 && echo.queueClearSeconds !== null;
}

async function evaluateMakerCandidate(input: {
  symbol: string;
  notionalUsd: number;
  maxQuoteAgeMs: number;
  requireStablecoin: boolean;
}): Promise<MakerRecoveryPlan | null> {
  const symbol = input.symbol.trim().toUpperCase();
  const stablecoin = STABLECOIN_SYMBOLS.has(symbol);
  if (input.requireStablecoin && !stablecoin) return null;
  if (!(input.notionalUsd > 0) || !symbol) return null;

  const observations = await Promise.all(CEX_VENUES.map(async venue => {
    const [book, fee, rpi] = await Promise.all([
      venueBook(venue, symbol, input.maxQuoteAgeMs).catch(() => null),
      resolveCexFeeEvidence(venue, symbol).catch(() => null),
      venue === 'okx' ? getOkxRpiExecutionCapability(symbol).catch(() => null) : Promise.resolve(null),
    ]);
    return { venue, book, fee, rpi };
  }));
  const books = observations.flatMap(value => value.book ? [value.book] : []);
  const fees = new Map<CexFeeVenue, CexFeeEvidence>();
  const rpiByVenue = new Map<CexFeeVenue, OkxRpiExecutionCapability>();
  for (const observation of observations) {
    if (observation.fee) fees.set(observation.venue, observation.fee);
    if (observation.rpi) rpiByVenue.set(observation.venue, observation.rpi);
  }
  if (books.length < 2) return null;

  const now = Date.now();
  const configuredTtlMs = ttlMs();
  const participation = queueParticipationFraction();

  for (const book of books) observeAriesQueueEcho(book.quote, 'buy', configuredTtlMs, participation);

  let best: MakerRecoveryPlan | null = null;
  for (const buy of books) {
    for (const sell of books) {
      if (buy.venue === sell.venue) continue;
      const buyEvidence = fees.get(buy.venue) || null;
      const sellEvidence = fees.get(sell.venue) || null;
      const standardBuyFeeBps = authenticatedMakerFeeBps(buyEvidence);
      const standardSellFeeBps = authenticatedMakerFeeBps(sellEvidence);
      if (standardBuyFeeBps === null || standardSellFeeBps === null) continue;
      const buyRpi = buy.venue === 'okx' ? rpiByVenue.get('okx') || null : null;
      const sellRpi = sell.venue === 'okx' ? rpiByVenue.get('okx') || null : null;

      const buyPrice = buy.bid;
      const sellPrice = sell.ask;
      if (!(sellPrice > buyPrice)) continue;
      const grossSpreadBps = ((sellPrice - buyPrice) / buyPrice) * 10_000;
      // This optimistic screen exists only to avoid discarding a route that a
      // currently permitted RPI rebate could rescue. Exact RPI notional, spacing,
      // book, fee and permission checks occur after sizing and again at submit.
      const optimisticFeeFloorBps = optimisticMakerFeeBps(buy.venue, standardBuyFeeBps, buyRpi)
        + optimisticMakerFeeBps(sell.venue, standardSellFeeBps, sellRpi);
      if (!(grossSpreadBps > optimisticFeeFloorBps)) continue;

      const buyQueue = observeAriesQueueEcho(buy.quote, 'buy', configuredTtlMs, participation);
      const sellQueue = observeAriesQueueEcho(sell.quote, 'sell', configuredTtlMs, participation);
      const jointFillProbability = Math.max(0, Math.min(1, buyQueue.fillProbabilityWithinTtl * sellQueue.fillProbabilityWithinTtl));
      const queueAuthority = measuredQueueEvidence(buyQueue) && measuredQueueEvidence(sellQueue) ? 'measured_history' as const : 'cold_start' as const;
      if (queueAuthority === 'measured_history' && jointFillProbability < minMeasuredJointFillProbability()) continue;

      const stress = stressTestAriesSpread(grossSpreadBps, buy.venue, sell.venue, symbol);
      if (stress.paths > 0 && stress.persistenceProbability < minMeasuredStressPersistence()) continue;
      const causal = estimateAriesVenueLeadLag(symbol, buy.venue, sell.venue);

      const [buyConstraints, sellConstraints] = await Promise.all([
        makerProductConstraints(buy.venue, symbol),
        makerProductConstraints(sell.venue, symbol),
      ]);
      if (!buyConstraints || !sellConstraints) continue;
      const quoteAsset = buyConstraints.quoteAsset.trim().toUpperCase();
      if (quoteAsset !== sellConstraints.quoteAsset.trim().toUpperCase()) continue;
      if (!USD_NORMALIZED_QUOTES.has(quoteAsset)) continue;

      const commonIncrement = Math.max(buyConstraints.baseIncrement, sellConstraints.baseIncrement);
      const canary = maxCanaryUsd(input.notionalUsd);
      const parentCeilingUsd = canary.amount;
      if (!(parentCeilingUsd > 0)) continue;

      // Queue participation and Kelly may tighten total safe exposure beneath the
      // active ladder/canary ceiling. Venue single-order maxima are deliberately
      // absent here: the canonical hyper-hybrid executor applies them only when
      // partitioning this measured parent into legal child orders.
      const queueQty = Math.min(buy.bidQty, sell.askQty) * participation;
      const queueLiquidityUsd = Math.max(0, queueQty * buyPrice);
      const atrFraction = Math.max(buyQueue.atrFraction, sellQueue.atrFraction);
      const hurstExponent = (buyQueue.hurstExponent + sellQueue.hurstExponent) / 2;
      const kellyConfidence = Math.max(0.5, Math.min(0.99,
        0.5 + 0.25 * jointFillProbability + 0.15 * stress.persistenceProbability + 0.10 * causal.confidence,
      ));
      const kelly = computeAriesFractionalKellySizing({
        confidence: kellyConfidence,
        atrFraction,
        hurstExponent,
        capitalUsd: parentCeilingUsd,
        kellyFraction: finiteBoundedEnv('CRYPTO_ARBITRAGE_FRACTIONAL_KELLY', 0.25, 0.05, 0.50),
        liquidityCapUsd: queueLiquidityUsd,
        governanceCapUsd: parentCeilingUsd,
        maxFractionOfCapital: finiteBoundedEnv('CRYPTO_ARBITRAGE_KELLY_MAX_FRACTION', 0.20, 0.01, 0.50),
      });
      const kellyApplied = queueAuthority === 'measured_history' && canary.proof.samples >= 5 && kelly.recommendedNotionalUsd > 0;
      const sizingUsd = kellyApplied ? Math.min(parentCeilingUsd, kelly.recommendedNotionalUsd) : parentCeilingUsd;
      const requestedQty = Math.min(sizingUsd / buyPrice, queueQty);
      const baseQty = floorToIncrement(requestedQty, commonIncrement);
      if (!(baseQty > 0) || baseQty < buyConstraints.baseMinSize || baseQty < sellConstraints.baseMinSize) continue;

      const buyNotional = baseQty * buyPrice;
      const sellNotional = baseQty * sellPrice;
      if (buyConstraints.quoteMinSize !== null && buyNotional < buyConstraints.quoteMinSize) continue;
      if (sellConstraints.quoteMinSize !== null && sellNotional < sellConstraints.quoteMinSize) continue;

      const buyMaker = exactMakerLegEconomics({
        venue: buy.venue,
        standardMakerFeeBps: standardBuyFeeBps,
        rpi: buyRpi,
        side: 'buy',
        price: buyPrice,
        oppositeOrganicPrice: buy.ask,
        tickSize: buyConstraints.priceIncrement,
        notionalUsd: buyNotional,
      });
      const sellMaker = exactMakerLegEconomics({
        venue: sell.venue,
        standardMakerFeeBps: standardSellFeeBps,
        rpi: sellRpi,
        side: 'sell',
        price: sellPrice,
        oppositeOrganicPrice: sell.bid,
        tickSize: sellConstraints.priceIncrement,
        notionalUsd: sellNotional,
      });
      const buyFeeUsd = buyNotional * buyMaker.feeBps / 10_000;
      const sellFeeUsd = sellNotional * sellMaker.feeBps / 10_000;
      const grossProfitUsd = sellNotional - buyNotional;
      const totalCostsUsd = buyFeeUsd + sellFeeUsd;
      const netProfitUsd = grossProfitUsd - totalCostsUsd;
      if (!(netProfitUsd > 0)) continue;

      const quoteAgeMs = Math.max(now - buy.observedAt, now - sell.observedAt);
      if (quoteAgeMs > input.maxQuoteAgeMs) continue;
      const authority: 'websocket' | 'rest_fallback' = buy.authority === 'websocket' && sell.authority === 'websocket'
        ? 'websocket'
        : 'rest_fallback';
      const rpiEvidenceObservedAt = Math.max(
        buyMaker.rpiEvidenceObservedAt ?? 0,
        sellMaker.rpiEvidenceObservedAt ?? 0,
      ) || null;
      const candidate: MakerRecoveryPlan = {
        symbol,
        notionalUsd: buyNotional,
        requestedNotionalUsd: canary.amount,
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
        spreadPct: (sellPrice - buyPrice) / buyPrice * 100,
        costs: { buyFeeUsd, sellFeeUsd, gasUsd: 0, bridgeFeeUsd: 0, transferFeeUsd: 0, totalCostsUsd },
        quoteAgeMs,
        expectedSlippageBps: 0,
        expectedPriceImpactBps: 0,
        liquidity: {
          status: 'measured',
          buyAvailableBaseQty: buy.bidQty,
          sellAvailableBaseQty: sell.askQty,
          source: [
            `${buy.venue}:maker_queue:${buy.authority}`,
            `${sell.venue}:maker_queue:${sell.authority}`,
            `aries_queue_echo:${queueAuthority}`,
            `aries_stress_paths:${stress.paths}`,
            ...(buyMaker.style === 'rpi' || sellMaker.style === 'rpi' ? ['okx_rpi:authenticated_permission_fee_spacing'] : []),
          ],
        },
        feeEvidence: { buy: buyEvidence!, sell: sellEvidence! },
        crossVenueCostModel: 'prepositioned_inventory',
        makerExecution: {
          strategy: stablecoin ? 'stablecoin_post_only' : 'volatile_spread_post_only',
          buyMode: 'maker',
          sellMode: 'maker',
          ttlMs: configuredTtlMs,
          takerFallbackAllowed: false,
          feeAuthority: 'authenticated',
          bookAuthority: authority,
          canaryCeilingUsd: canary.proof.ceilingUsd,
          canaryProofSamples: canary.proof.samples,
          canaryConfidenceScore: canary.proof.confidenceScore,
          canarySizingAuthority: canary.proof.sizingAuthority,
          volatileMinGrossSpreadBps: null,
          orderStyle: {
            buy: buyMaker.style,
            sell: sellMaker.style,
            buyEffectiveMakerFeeBps: buyMaker.feeBps,
            sellEffectiveMakerFeeBps: sellMaker.feeBps,
            okxRpiEvidenceObservedAt: rpiEvidenceObservedAt,
            rpiPermissionAndSpacingRequiredAtSubmit: true,
          },
          queueEcho: {
            buyFillProbability: buyQueue.fillProbabilityWithinTtl,
            sellFillProbability: sellQueue.fillProbabilityWithinTtl,
            jointFillProbability,
            buyArrivalRatePerSecond: buyQueue.orderArrivalRatePerSecond,
            sellArrivalRatePerSecond: sellQueue.orderArrivalRatePerSecond,
            buyQueueClearSeconds: buyQueue.queueClearSeconds,
            sellQueueClearSeconds: sellQueue.queueClearSeconds,
            authority: queueAuthority,
          },
          fractionalKelly: {
            applied: kellyApplied,
            recommendedFraction: kellyApplied ? kelly.recommendedFraction : null,
            recommendedNotionalUsd: kellyApplied ? kelly.recommendedNotionalUsd : null,
            atrFraction,
            hurstExponent,
          },
          causalLeadLag: {
            leaderVenue: causal.leaderVenue,
            followerVenue: causal.followerVenue,
            confidence: causal.confidence,
            lagMs: causal.lagMs,
          },
          spreadStress: stress,
        },
      };
      if (!best || candidate.netProfitUsd > best.netProfitUsd) best = candidate;
    }
  }
  return best;
}

export async function evaluateStablecoinMakerCandidate(input: {
  symbol: string;
  notionalUsd: number;
  maxQuoteAgeMs: number;
}): Promise<StablecoinMakerPlan | null> {
  return evaluateMakerCandidate({ ...input, requireStablecoin: true }) as Promise<StablecoinMakerPlan | null>;
}

/**
 * Maker recovery across every canonical executable CEX venue. Product discovery
 * is universal; executable USD P&L remains fail-closed until the quote currency
 * has authoritative USD normalization. There is no arbitrary BPS admission floor:
 * strict positive all-in net dollars plus measured execution/risk evidence governs.
 */
export async function evaluateMakerRecoveryCandidate(input: {
  symbol: string;
  notionalUsd: number;
  maxQuoteAgeMs: number;
}): Promise<MakerRecoveryPlan | null> {
  return evaluateMakerCandidate({ ...input, requireStablecoin: false });
}

export function isStablecoinMakerPlan(plan: VerifiedArbitragePlan): plan is StablecoinMakerPlan {
  const value = plan as MakerRecoveryPlan;
  return value?.makerExecution?.strategy === 'stablecoin_post_only' && value.makerExecution.takerFallbackAllowed === false;
}

export function isMakerRecoveryPlan(plan: VerifiedArbitragePlan): plan is MakerRecoveryPlan {
  const value = plan as MakerRecoveryPlan;
  return (value?.makerExecution?.strategy === 'stablecoin_post_only' || value?.makerExecution?.strategy === 'volatile_spread_post_only')
    && value.makerExecution.takerFallbackAllowed === false;
}

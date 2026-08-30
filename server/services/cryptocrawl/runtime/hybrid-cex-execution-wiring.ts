import logger from '../../../logger.js';
import {
  arbitrageVerifier,
  type QuoteVenue,
  type VerifiedArbitragePlan,
  type VerifyManyRequest,
} from '../arbitrage/arbitrage-verifier.js';
import {
  CentralizedExchangeExecutor,
  centralizedExchangeExecutor,
  type ArbitrageExecutionResult,
} from '../execution/centralized-exchange-executor.js';
import { floorToIncrement } from '../execution/coinbase-product-policy.js';
import { getSpotProductConstraints } from '../execution/cex-spot-product-policy.js';
import {
  createProductionCexSettlementAdapters,
  type CexOrderReceipt,
  type CexSettlementAdapter,
  type ExecutableCexVenue,
  type OrderRequest,
} from '../execution/cex-settlement.js';
import { createPostOnlyMakerAdapters } from '../execution/post-only-maker-adapters.js';
import {
  getDynamicMakerCanaryStatus,
  type MakerRecoveryPlan,
} from '../execution/stablecoin-maker-strategy.js';
import type { NormalizedOrderSettlement } from '../execution/settlement-types.js';
import { getCryptocrawlGovernance } from '../governance/index.js';
import {
  getCachedCexFeeEvidence,
  primeCexFeeEvidenceForVenueSymbols,
  resolveCexFeeEvidence,
  type CexFeeEvidence,
} from '../intelligence/cex-fee-resolver.js';
import { cexOrderBookStreams, type StreamOrderBookQuote } from '../intelligence/cex-order-book-stream.js';
import { observeAriesQueueEcho, stressTestAriesSpread } from '../intelligence/aries-microstructure.js';
import type { ScanCapacityDecision } from '../discovery/scan-capacity-policy.js';

export type HybridCexMode = 'MT' | 'TM';
export type HybridCexLegMode = 'maker' | 'taker';

export type HybridCexRecoveryPlan = VerifiedArbitragePlan & {
  hybridExecution: {
    mode: HybridCexMode;
    buyMode: HybridCexLegMode;
    sellMode: HybridCexLegMode;
    makerSide: 'buy' | 'sell';
    makerVenue: 'kraken' | 'okx';
    takerVenue: 'kraken' | 'okx';
    ttlMs: number;
    maxQuoteAgeMs: number;
    feeAuthority: 'authenticated';
    bookAuthority: 'websocket';
    freshTakerRequoteRequired: true;
    partialFillHedgeRequired: true;
    makerFillProbability: number;
    canaryCeilingUsd: number;
    canaryProofSamples: number;
    spreadStress: {
      persistenceProbability: number;
      downsideQuantileBps: number;
      expectedTerminalSpreadBps: number;
      paths: number;
    };
  };
};

type HybridVenue = 'kraken' | 'okx';

type HybridBook = {
  venue: HybridVenue;
  quote: StreamOrderBookQuote;
};

let installed = false;

function bounded(raw: unknown, fallback: number, min: number, max: number): number {
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? Math.max(min, Math.min(max, parsed)) : fallback;
}

function authenticatedFeeBps(evidence: CexFeeEvidence | null, mode: HybridCexLegMode): number | null {
  if (!evidence || evidence.source === 'configured_override') return null;
  if (mode === 'taker') {
    return Number.isFinite(evidence.takerFeeBps) ? Math.max(0, Number(evidence.takerFeeBps)) : null;
  }
  if (evidence.makerFeeBps !== null && Number.isFinite(evidence.makerFeeBps)) return Number(evidence.makerFeeBps);
  if (evidence.makerRebateBps !== null && Number.isFinite(evidence.makerRebateBps)) return -Math.abs(Number(evidence.makerRebateBps));
  return null;
}

async function feeEvidence(venue: HybridVenue, symbol: string): Promise<CexFeeEvidence | null> {
  return getCachedCexFeeEvidence(venue, symbol)
    || await resolveCexFeeEvidence(venue, symbol).catch(() => null);
}

function topQuantity(book: StreamOrderBookQuote, side: 'buy' | 'sell', mode: HybridCexLegMode): number {
  const levels = side === 'buy'
    ? (mode === 'maker' ? book.depth.bids : book.depth.asks)
    : (mode === 'maker' ? book.depth.asks : book.depth.bids);
  const quantity = Number(levels[0]?.quantity || 0);
  return Number.isFinite(quantity) && quantity > 0 ? quantity : 0;
}

function executionPrice(book: StreamOrderBookQuote, side: 'buy' | 'sell', mode: HybridCexLegMode): number {
  if (side === 'buy') return mode === 'maker' ? book.bid : book.ask;
  return mode === 'maker' ? book.ask : book.bid;
}

function hybridModes(): Array<{
  mode: HybridCexMode;
  buyMode: HybridCexLegMode;
  sellMode: HybridCexLegMode;
}> {
  return [
    { mode: 'MT', buyMode: 'maker', sellMode: 'taker' },
    { mode: 'TM', buyMode: 'taker', sellMode: 'maker' },
  ];
}

async function evaluateHybridCandidate(input: {
  symbol: string;
  notionalUsd: number;
  maxQuoteAgeMs: number;
}): Promise<HybridCexRecoveryPlan | null> {
  const symbol = input.symbol.trim().toUpperCase();
  if (!(input.notionalUsd > 0) || !/^([A-Z0-9]+?)(USDT|USDC|USD)$/.test(symbol)) return null;

  const [krakenQuote, okxQuote, krakenFee, okxFee] = await Promise.all([
    cexOrderBookStreams.getQuote('kraken', symbol, input.maxQuoteAgeMs).catch(() => null),
    cexOrderBookStreams.getQuote('okx', symbol, input.maxQuoteAgeMs).catch(() => null),
    feeEvidence('kraken', symbol),
    feeEvidence('okx', symbol),
  ]);
  if (!krakenQuote || !okxQuote || !krakenFee || !okxFee) return null;

  const books: Record<HybridVenue, HybridBook> = {
    kraken: { venue: 'kraken', quote: krakenQuote },
    okx: { venue: 'okx', quote: okxQuote },
  };
  const fees: Record<HybridVenue, CexFeeEvidence> = { kraken: krakenFee, okx: okxFee };
  const now = Date.now();
  const ttlMs = Math.max(2_000, Math.min(30_000, Number(process.env.CRYPTO_ARBITRAGE_MAKER_TTL_MS || 30_000)));
  const canary = getDynamicMakerCanaryStatus();
  const notionalCap = Math.min(input.notionalUsd, canary.ceilingUsd);
  if (!(notionalCap > 0)) return null;
  const minMakerFill = bounded(process.env.CRYPTO_ARBITRAGE_HYBRID_MIN_MAKER_FILL_PROBABILITY, 0.20, 0.05, 0.95);
  const minStressPersistence = bounded(process.env.CRYPTO_ARBITRAGE_HYBRID_MIN_STRESS_PERSISTENCE, 0.35, 0.05, 0.95);

  let best: HybridCexRecoveryPlan | null = null;
  for (const buyVenue of ['kraken', 'okx'] as const) {
    for (const sellVenue of ['kraken', 'okx'] as const) {
      if (buyVenue === sellVenue) continue;
      const buyBook = books[buyVenue].quote;
      const sellBook = books[sellVenue].quote;

      for (const candidate of hybridModes()) {
        const buyPrice = executionPrice(buyBook, 'buy', candidate.buyMode);
        const sellPrice = executionPrice(sellBook, 'sell', candidate.sellMode);
        if (!(buyPrice > 0) || !(sellPrice > buyPrice)) continue;

        const buyFeeBps = authenticatedFeeBps(fees[buyVenue], candidate.buyMode);
        const sellFeeBps = authenticatedFeeBps(fees[sellVenue], candidate.sellMode);
        if (buyFeeBps === null || sellFeeBps === null) continue;

        const makerSide = candidate.buyMode === 'maker' ? 'buy' as const : 'sell' as const;
        const makerVenue = makerSide === 'buy' ? buyVenue : sellVenue;
        const takerVenue = makerSide === 'buy' ? sellVenue : buyVenue;
        const makerBook = books[makerVenue].quote;
        const queue = observeAriesQueueEcho(makerBook, makerSide, ttlMs, 0.02);
        const measuredQueue = queue.orderArrivalRatePerSecond > 0 && queue.queueClearSeconds !== null;
        if (measuredQueue && queue.fillProbabilityWithinTtl < minMakerFill) continue;

        const grossSpreadBps = ((sellPrice - buyPrice) / buyPrice) * 10_000;
        const stress = stressTestAriesSpread(grossSpreadBps, buyVenue, sellVenue, symbol);
        if (stress.paths > 0 && stress.persistenceProbability < minStressPersistence) continue;

        const [buyConstraints, sellConstraints] = await Promise.all([
          getSpotProductConstraints(buyVenue, symbol).catch(() => null),
          getSpotProductConstraints(sellVenue, symbol).catch(() => null),
        ]);
        if (!buyConstraints || !sellConstraints) continue;

        const buyQty = topQuantity(buyBook, 'buy', candidate.buyMode);
        const sellQty = topQuantity(sellBook, 'sell', candidate.sellMode);
        if (!(buyQty > 0) || !(sellQty > 0)) continue;
        const commonIncrement = Math.max(buyConstraints.baseIncrement, sellConstraints.baseIncrement);
        const requestedQty = Math.min(notionalCap / buyPrice, buyQty, sellQty);
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

        const quoteAgeMs = Math.max(now - buyBook.timestamp, now - sellBook.timestamp);
        if (quoteAgeMs > input.maxQuoteAgeMs) continue;

        const plan: HybridCexRecoveryPlan = {
          symbol,
          notionalUsd: buyNotional,
          requestedNotionalUsd: input.notionalUsd,
          executableNotionalUsd: buyNotional,
          buyVenue: buyVenue as QuoteVenue,
          sellVenue: sellVenue as QuoteVenue,
          buyAsk: buyPrice,
          sellBid: sellPrice,
          buyLimitPrice: buyPrice,
          sellLimitPrice: sellPrice,
          baseQty,
          grossProfitUsd,
          netProfitUsd,
          spreadPct: (sellPrice - buyPrice) / buyPrice * 100,
          costs: {
            buyFeeUsd,
            sellFeeUsd,
            gasUsd: 0,
            bridgeFeeUsd: 0,
            transferFeeUsd: 0,
            totalCostsUsd,
          },
          quoteAgeMs,
          expectedSlippageBps: 0,
          expectedPriceImpactBps: 0,
          liquidity: {
            status: 'measured',
            buyAvailableBaseQty: buyQty,
            sellAvailableBaseQty: sellQty,
            source: [
              `${buyVenue}:${candidate.buyMode}:websocket`,
              `${sellVenue}:${candidate.sellMode}:websocket`,
              `hybrid_${candidate.mode.toLowerCase()}:maker_first_fresh_taker_requote`,
            ],
          },
          feeEvidence: { buy: fees[buyVenue], sell: fees[sellVenue] },
          crossVenueCostModel: 'prepositioned_inventory',
          hybridExecution: {
            mode: candidate.mode,
            buyMode: candidate.buyMode,
            sellMode: candidate.sellMode,
            makerSide,
            makerVenue,
            takerVenue,
            ttlMs,
            maxQuoteAgeMs: input.maxQuoteAgeMs,
            feeAuthority: 'authenticated',
            bookAuthority: 'websocket',
            freshTakerRequoteRequired: true,
            partialFillHedgeRequired: true,
            makerFillProbability: queue.fillProbabilityWithinTtl,
            canaryCeilingUsd: canary.ceilingUsd,
            canaryProofSamples: canary.samples,
            spreadStress: stress,
          },
        };

        if (!best || plan.netProfitUsd > best.netProfitUsd) best = plan;
      }
    }
  }

  return best;
}

export function isHybridCexRecoveryPlan(plan: VerifiedArbitragePlan): plan is HybridCexRecoveryPlan {
  const value = plan as HybridCexRecoveryPlan;
  return (value?.hybridExecution?.mode === 'MT' || value?.hybridExecution?.mode === 'TM')
    && value.hybridExecution.freshTakerRequoteRequired === true
    && value.hybridExecution.partialFillHedgeRequired === true;
}

function betterPlan(
  current: VerifiedArbitragePlan | null | undefined,
  candidate: VerifiedArbitragePlan | null | undefined,
): VerifiedArbitragePlan | null {
  if (!candidate || !Number.isFinite(candidate.netProfitUsd) || candidate.netProfitUsd <= 0) return current ?? null;
  if (!current || !Number.isFinite(current.netProfitUsd) || current.netProfitUsd <= 0) return candidate;
  return candidate.netProfitUsd > current.netProfitUsd ? candidate : current;
}

async function runBounded<T>(items: readonly T[], concurrency: number, worker: (item: T) => Promise<void>): Promise<void> {
  if (items.length === 0) return;
  let cursor = 0;
  const count = Math.max(1, Math.min(items.length, concurrency));
  await Promise.all(Array.from({ length: count }, async () => {
    while (true) {
      const index = cursor++;
      if (index >= items.length) return;
      await worker(items[index]);
    }
  }));
}

async function awaitMakerTerminal(
  receipt: CexOrderReceipt,
  adapter: CexSettlementAdapter,
  ttlMs: number,
): Promise<NormalizedOrderSettlement> {
  const pollMs = Math.max(75, Math.min(750, Number(process.env.CRYPTO_ARBITRAGE_HYBRID_MAKER_POLL_MS || 200)));
  const deadline = Date.now() + ttlMs;
  let last: NormalizedOrderSettlement | null = null;
  while (Date.now() <= deadline) {
    last = await adapter.query(receipt);
    if (last.terminal) return last;
    if (Date.now() >= deadline) break;
    await new Promise(resolve => setTimeout(resolve, Math.min(pollMs, Math.max(0, deadline - Date.now()))));
  }
  try {
    await adapter.cancel(receipt);
  } catch (error) {
    logger.warn('[HybridCEX] Maker cancellation degraded before taker hedge decision', {
      component: 'HybridCexExecutionWiring',
      venue: receipt.venue,
      orderId: receipt.orderId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
  const final = await adapter.query(receipt);
  if (!final.terminal) throw new Error('HYBRID_MAKER_SETTLEMENT_UNKNOWN');
  return final;
}

function depthExecution(input: {
  quote: StreamOrderBookQuote;
  side: 'buy' | 'sell';
  quantity: number;
}): { averagePrice: number; limitPrice: number; coveredQuantity: number; coverage: number } | null {
  const levels = input.side === 'buy' ? input.quote.depth.asks : input.quote.depth.bids;
  if (levels.length === 0 || !(input.quantity > 0)) return null;
  let remaining = input.quantity;
  let coveredQuantity = 0;
  let notional = 0;
  let limitPrice = 0;
  for (const level of levels) {
    const available = Number(level.quantity);
    const price = Number(level.price);
    if (!(available > 0) || !(price > 0)) continue;
    const fill = Math.min(remaining, available);
    coveredQuantity += fill;
    notional += fill * price;
    remaining -= fill;
    limitPrice = price;
    if (remaining <= 1e-12) break;
  }
  if (!(coveredQuantity > 0) || !(limitPrice > 0)) return null;
  return {
    averagePrice: notional / coveredQuantity,
    limitPrice,
    coveredQuantity,
    coverage: Math.max(0, Math.min(1, coveredQuantity / input.quantity)),
  };
}

function wrapHybridAdapters(plan: HybridCexRecoveryPlan): {
  adapters: Record<ExecutableCexVenue, CexSettlementAdapter>;
  getMakerSettlement: () => NormalizedOrderSettlement | null;
} {
  const production = createProductionCexSettlementAdapters();
  const makerAdapters = createPostOnlyMakerAdapters(plan as unknown as MakerRecoveryPlan);
  const metadata = plan.hybridExecution;
  const makerDelegate = makerAdapters[metadata.makerVenue];
  const takerDelegate = production[metadata.takerVenue];
  let makerSettlement: NormalizedOrderSettlement | null = null;
  let resolveMaker!: (settlement: NormalizedOrderSettlement) => void;
  let rejectMaker!: (error: unknown) => void;
  const makerTerminal = new Promise<NormalizedOrderSettlement>((resolve, reject) => {
    resolveMaker = resolve;
    rejectMaker = reject;
  });

  const makerWrapper: CexSettlementAdapter = {
    async submit(request: OrderRequest): Promise<CexOrderReceipt> {
      try {
        const receipt = await makerDelegate.submit(request);
        makerSettlement = await awaitMakerTerminal(receipt, makerDelegate, metadata.ttlMs);
        resolveMaker(makerSettlement);
        return receipt;
      } catch (error) {
        rejectMaker(error);
        throw error;
      }
    },
    query: order => makerDelegate.query(order),
    cancel: order => makerDelegate.cancel(order),
    ...(makerDelegate.getBalances ? { getBalances: () => makerDelegate.getBalances!() } : {}),
  };

  const takerWrapper: CexSettlementAdapter = {
    async submit(request: OrderRequest): Promise<CexOrderReceipt> {
      const settledMaker = await makerTerminal;
      const makerFilled = Number(settledMaker.filledQuantity || 0);
      if (!settledMaker.terminal || !(makerFilled > 0) || !(settledMaker.averageFillPrice && settledMaker.averageFillPrice > 0)) {
        throw new Error('HYBRID_MAKER_NO_TERMINAL_FILL');
      }

      const constraints = await getSpotProductConstraints(metadata.takerVenue, plan.symbol);
      const hedgeQuantity = floorToIncrement(makerFilled, constraints.baseIncrement);
      if (!(hedgeQuantity > 0) || hedgeQuantity < constraints.baseMinSize) {
        throw new Error('HYBRID_PARTIAL_FILL_BELOW_TAKER_MINIMUM');
      }

      const quoteMaxAgeMs = Math.max(250, Math.min(2_500, metadata.maxQuoteAgeMs));
      const [freshBook, makerFee, takerFee] = await Promise.all([
        cexOrderBookStreams.getQuote(metadata.takerVenue, plan.symbol, quoteMaxAgeMs),
        resolveCexFeeEvidence(metadata.makerVenue, plan.symbol),
        resolveCexFeeEvidence(metadata.takerVenue, plan.symbol),
      ]);
      if (!freshBook) throw new Error('HYBRID_FRESH_TAKER_BOOK_UNAVAILABLE');
      const depth = depthExecution({ quote: freshBook, side: request.side, quantity: hedgeQuantity });
      if (!depth) throw new Error('HYBRID_FRESH_TAKER_DEPTH_UNAVAILABLE');
      const makerFeeBps = authenticatedFeeBps(makerFee, 'maker');
      const takerFeeBps = authenticatedFeeBps(takerFee, 'taker');
      if (makerFeeBps === null || takerFeeBps === null) throw new Error('HYBRID_FRESH_AUTHENTICATED_FEE_EVIDENCE_UNAVAILABLE');

      const makerPrice = settledMaker.averageFillPrice;
      const makerNotional = makerPrice * hedgeQuantity;
      const takerNotional = depth.averagePrice * Math.min(hedgeQuantity, depth.coveredQuantity);
      const makerFeeUsd = makerNotional * makerFeeBps / 10_000;
      const takerFeeUsd = takerNotional * takerFeeBps / 10_000;
      const freshNetProfitUsd = metadata.makerSide === 'buy'
        ? takerNotional - makerNotional - makerFeeUsd - takerFeeUsd
        : makerNotional - takerNotional - makerFeeUsd - takerFeeUsd;
      const residual = Math.max(0, makerFilled - hedgeQuantity);

      logger.info('[HybridCEX] Maker terminal fill triggered fresh taker requote', {
        component: 'HybridCexExecutionWiring',
        symbol: plan.symbol,
        mode: metadata.mode,
        makerVenue: metadata.makerVenue,
        takerVenue: metadata.takerVenue,
        makerFilled,
        hedgeQuantity,
        roundingResidualQuantity: residual,
        freshDepthCoverage: depth.coverage,
        freshTakerAveragePrice: depth.averagePrice,
        freshTakerLimitPrice: depth.limitPrice,
        freshAllInNetProfitUsd: depth.coverage >= 0.999999 ? freshNetProfitUsd : null,
        freshEconomicsPositive: depth.coverage >= 0.999999 ? freshNetProfitUsd > 0 : null,
        flatteningRequiredAfterMakerFill: true,
        sequential_partial_fill_safe_hybrid_executor: true,
        fresh_taker_requote_after_maker_fill: true,
      });

      return takerDelegate.submit({
        ...request,
        quantity: hedgeQuantity,
        price: depth.limitPrice,
      });
    },
    query: order => takerDelegate.query(order),
    cancel: order => takerDelegate.cancel(order),
    ...(takerDelegate.getBalances ? { getBalances: () => takerDelegate.getBalances!() } : {}),
  };

  const adapters = { ...production };
  adapters[metadata.makerVenue] = makerWrapper;
  adapters[metadata.takerVenue] = takerWrapper;
  return { adapters, getMakerSettlement: () => makerSettlement };
}

function normalizeHybridLifecycle(
  plan: HybridCexRecoveryPlan,
  result: ArbitrageExecutionResult,
  makerSettlement: NormalizedOrderSettlement | null,
): ArbitrageExecutionResult {
  if (!makerSettlement?.terminal || !result.normalized || !result.settlementConfirmed) return result;
  const takerSettlement = (result.orders || []).find(order =>
    order.venue === plan.hybridExecution.takerVenue && order.side !== plan.hybridExecution.makerSide,
  );
  if (!takerSettlement?.terminal) return result;
  const makerFilled = Number(makerSettlement.filledQuantity || 0);
  const takerFilled = Number(takerSettlement.filledQuantity || 0);
  const tolerance = Math.max(1e-8, makerFilled * 1e-6);
  const exposureFlat = makerFilled > 0 && takerFilled > 0 && Math.abs(makerFilled - takerFilled) <= tolerance;
  const realizedNet = result.normalized.realized.netProfitUsd;
  if (!exposureFlat || realizedNet === null || !Number.isFinite(realizedNet)) return result;

  const success = realizedNet > 0;
  return {
    ...result,
    success,
    status: 'filled',
    settlementConfirmed: true,
    normalized: {
      ...result.normalized,
      status: 'filled',
      terminal: true,
      settlementConfirmed: true,
      provenance: [...new Set([
        ...result.normalized.provenance,
        'hybrid_maker_first_terminal_fill',
        'hybrid_fresh_taker_requote',
        'hybrid_partial_fill_quantity_hedged',
        'hybrid_terminal_exposure_flat',
      ])],
      error: success ? undefined : result.normalized.error || 'Hybrid lifecycle flattened exposure but realized non-positive net economics',
    },
    error: success ? undefined : result.error || 'Hybrid lifecycle flattened exposure but realized non-positive net economics',
  };
}

function rejectResult(reason: string): ArbitrageExecutionResult {
  return {
    success: false,
    status: 'rejected',
    settlementConfirmed: false,
    error: reason,
  } as ArbitrageExecutionResult;
}

async function executeHybridPlan(plan: HybridCexRecoveryPlan): Promise<ArbitrageExecutionResult> {
  if (plan.hybridExecution.feeAuthority !== 'authenticated') return rejectResult('REJECT_HYBRID_FEE_AUTHORITY');
  if (!(plan.notionalUsd > 0) || plan.notionalUsd > plan.hybridExecution.canaryCeilingUsd + 1e-9) {
    return rejectResult('REJECT_HYBRID_CANARY_CEILING');
  }
  const minFill = bounded(process.env.CRYPTO_ARBITRAGE_HYBRID_EXECUTION_MIN_MAKER_FILL, 0.20, 0.05, 0.95);
  if (plan.hybridExecution.makerFillProbability < minFill && plan.hybridExecution.canaryProofSamples > 0) {
    return rejectResult('REJECT_HYBRID_MAKER_FILL_PROBABILITY');
  }
  const minPersistence = bounded(process.env.CRYPTO_ARBITRAGE_HYBRID_EXECUTION_MIN_STRESS_PERSISTENCE, 0.35, 0.05, 0.95);
  if (plan.hybridExecution.spreadStress.paths > 0
      && plan.hybridExecution.spreadStress.persistenceProbability < minPersistence) {
    return rejectResult('REJECT_HYBRID_SPREAD_PERSISTENCE');
  }

  const wrapped = wrapHybridAdapters(plan);
  const executor = new CentralizedExchangeExecutor({
    adapters: wrapped.adapters,
    settlementTimeoutMs: Math.max(2_000, Math.min(30_000, plan.hybridExecution.ttlMs)),
    pollIntervalMs: Math.max(75, Math.min(750, Number(process.env.CRYPTO_ARBITRAGE_HYBRID_SETTLEMENT_POLL_MS || 200))),
  });
  const result = await executor.execute(plan);
  return normalizeHybridLifecycle(plan, result, wrapped.getMakerSettlement());
}

export function ensureHybridCexExecutionWiring(): void {
  if (installed) return;
  installed = true;

  const verifier = arbitrageVerifier as typeof arbitrageVerifier & {
    evaluateOnce: (request: any) => Promise<VerifiedArbitragePlan | null>;
    verifyOnce: (request: any) => Promise<VerifiedArbitragePlan | null>;
    evaluateMany: (
      request: VerifyManyRequest,
      symbols: readonly string[],
      capacity?: ScanCapacityDecision,
    ) => Promise<Map<string, VerifiedArbitragePlan | null>>;
  };
  const originalEvaluateOnce = verifier.evaluateOnce.bind(verifier);
  const originalEvaluateMany = verifier.evaluateMany.bind(verifier);

  verifier.evaluateOnce = async (request: any): Promise<VerifiedArbitragePlan | null> => {
    const existing = await originalEvaluateOnce(request);
    const hybrid = await evaluateHybridCandidate({
      symbol: String(request?.symbol || ''),
      notionalUsd: Number(request?.notionalUsd || 0),
      maxQuoteAgeMs: Math.max(250, Number(request?.maxQuoteAgeMs || process.env.CRYPTO_ARBITRAGE_MAX_QUOTE_AGE_MS || 5_000)),
    });
    return betterPlan(existing, hybrid);
  };

  verifier.evaluateMany = async (
    request: VerifyManyRequest,
    symbols: readonly string[],
    capacity?: ScanCapacityDecision,
  ): Promise<Map<string, VerifiedArbitragePlan | null>> => {
    const plans = await originalEvaluateMany(request, symbols, capacity);
    const governance = getCryptocrawlGovernance();
    const governedSymbols = [...new Set(symbols
      .map(symbol => symbol.trim().toUpperCase())
      .filter(Boolean)
      .filter(symbol => {
        try {
          governance.requireAllowed('ADVISE', { chain: request.gas?.chain, pair: symbol });
          return true;
        } catch {
          return false;
        }
      }))];

    if (governedSymbols.length === 0) return plans;
    await primeCexFeeEvidenceForVenueSymbols({
      kraken: governedSymbols,
      okx: governedSymbols,
    }).catch(error => {
      logger.debug('[HybridCEX] Batch authenticated fee prime degraded', {
        component: 'HybridCexExecutionWiring',
        symbols: governedSymbols.length,
        error: error instanceof Error ? error.message : String(error),
      });
    });

    let hybridPositive = 0;
    let hybridSelected = 0;
    const concurrency = Math.max(1, Math.min(16, Number(process.env.CRYPTO_ARBITRAGE_HYBRID_BATCH_CONCURRENCY || 8)));
    await runBounded(governedSymbols, concurrency, async symbol => {
      const before = plans.get(symbol) ?? null;
      const hybrid = await evaluateHybridCandidate({
        symbol,
        notionalUsd: Number(request.notionalUsd || 0),
        maxQuoteAgeMs: Math.max(250, Number(request.maxQuoteAgeMs || process.env.CRYPTO_ARBITRAGE_MAX_QUOTE_AGE_MS || 5_000)),
      });
      if (!hybrid) return;
      hybridPositive++;
      const selected = betterPlan(before, hybrid);
      if (selected === hybrid) {
        plans.set(symbol, hybrid);
        hybridSelected++;
      }
    });

    logger.info('[HybridCEX] MT/TM canonical comparison completed', {
      component: 'HybridCexExecutionWiring',
      symbolsRequested: symbols.length,
      governedSymbols: governedSymbols.length,
      hybridPositive,
      hybridSelected,
      executionRule: 'strict_all_in_net_profit_usd_greater_than_zero',
      executionSequence: 'maker_terminal_fill_then_fresh_depth_aware_taker_hedge',
      partialFillHandling: 'hedge_actual_terminal_maker_fill_quantity',
      authenticatedFeesRequired: true,
      measuredDepthRequired: true,
      syntheticEconomicsAllowed: false,
    });
    return plans;
  };

  verifier.verifyOnce = async (request: any): Promise<VerifiedArbitragePlan | null> => {
    const plan = await verifier.evaluateOnce(request);
    return plan && Number.isFinite(plan.netProfitUsd) && plan.netProfitUsd > 0 ? plan : null;
  };

  const executionTarget = centralizedExchangeExecutor as typeof centralizedExchangeExecutor & {
    execute: (plan: VerifiedArbitragePlan) => Promise<ArbitrageExecutionResult>;
  };
  const originalExecute = executionTarget.execute.bind(executionTarget);
  executionTarget.execute = async (plan: VerifiedArbitragePlan): Promise<ArbitrageExecutionResult> => {
    if (!isHybridCexRecoveryPlan(plan)) return originalExecute(plan);
    return executeHybridPlan(plan);
  };

  logger.info('[HybridCEX] Canonical MT/TM admission and execution wiring installed', {
    component: 'HybridCexExecutionWiring',
    supportedModes: ['MT', 'TM'],
    makerFirst: true,
    freshTakerRequoteAfterMakerFill: true,
    sequentialPartialFillSafeHybridExecutor: true,
    authenticatedFeeAuthority: true,
    measuredDepthAuthority: true,
    existingTTExecutionChanged: false,
    existingMMExecutionChanged: false,
    arbitraryBpsExecutionFloor: false,
    executionRule: 'strict_all_in_net_profit_usd_greater_than_zero',
  });
}

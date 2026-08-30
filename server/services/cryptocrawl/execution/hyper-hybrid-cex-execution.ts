import { randomUUID } from 'node:crypto';
import logger from '../../../logger.js';
import type { QuoteVenue, VerifiedArbitragePlan } from '../arbitrage/arbitrage-verifier.js';
import { getProfitLadderNotionalAuthority } from '../governance/profit-ladder-notional-authority.js';
import {
  getCoinbaseAdvancedProductConstraints,
  type CoinbaseAdvancedProductConstraints,
} from '../intelligence/coinbase-advanced-market-data.js';
import {
  assertCoinbaseSpotTradeReady,
  coinbasePrivateRequest,
} from '../intelligence/coinbase-advanced-trade-authority.js';
import { cexOrderBookStreams } from '../intelligence/cex-order-book-stream.js';
import { krakenPrivateRequest, okxPrivateRequest } from '../intelligence/cex-private-authority.js';
import {
  executeCexPlan,
  type CexExecutionResult,
  type CexExecutorOptions,
  type CexOrderReceipt,
  type CexSettlementAdapter,
  type ExecutableCexVenue,
  type OrderRequest,
} from './cex-settlement.js';
import { coinbaseDecimalString, coinbaseProductId } from './coinbase-spot-settlement-adapter.js';
import { floorToIncrement, validateCoinbaseOrderAgainstProduct } from './coinbase-product-policy.js';
import { cexDecimalString } from './cex-order-serialization.js';
import { getSpotProductConstraints, type SpotProductConstraints } from './cex-spot-product-policy.js';
import { assertFreshCexProductConstraints } from './cex-submit-time-product-guard.js';
import type { ExecutionStatus, NormalizedRealizedExecution, RealizedExecutionEconomics } from './settlement-types.js';

const ORDER_SUBMIT_TIMEOUT_MS = Math.max(3_000, Number(process.env.CRYPTO_ARBITRAGE_ORDER_TIMEOUT_MS || 12_000));
const DEFAULT_CHILD_CONCURRENCY = 8;

export interface HyperHybridChildExecution {
  childId: string;
  index: number;
  plannedNotionalUsd: number;
  expectedProfitUsd: number;
  timeInForce: 'IOC' | 'FOK';
  latencyMs: number;
  success: boolean;
  status: ExecutionStatus;
  settlementConfirmed: boolean;
  normalized?: NormalizedRealizedExecution;
  realizedProfitUsd: number | null;
  realizedFeeUsd: number | null;
  realizedSlippageBps: number | null;
  error?: string;
}

export interface HyperHybridCexExecutionMetadata {
  parentTargetNotionalUsd?: number;
  completedNotionalUsd?: number;
  remainingNotionalUsd?: number;
  splitExecution?: boolean;
  childExecutions?: HyperHybridChildExecution[];
  stopReason?: string;
}

export type HyperHybridCexExecutionResult = CexExecutionResult & HyperHybridCexExecutionMetadata;

type VenueLimit = {
  venue: ExecutableCexVenue;
  baseIncrement: number;
  baseMinSize: number;
  quoteMinSize: number | null;
  baseMaxSize: number | null;
  quoteMaxSize: number | null;
};

function splitSymbol(symbol: string): { base: string; quote: string } {
  const match = symbol.trim().toUpperCase().match(/^([A-Z0-9]+?)(USDT|USDC|USD)$/);
  if (!match) throw new Error(`Unsupported hyper-hybrid CEX spot symbol: ${symbol}`);
  return { base: match[1], quote: match[2] };
}

function decimalPlaces(value: number): number {
  const text = value.toString().toLowerCase();
  if (text.includes('e-')) {
    const [coefficient, exponentText] = text.split('e-');
    return Number(exponentText) + (coefficient.includes('.') ? coefficient.split('.')[1].length : 0);
  }
  return text.includes('.') ? text.split('.')[1].length : 0;
}

function gcd(a: bigint, b: bigint): bigint {
  let left = a < 0n ? -a : a;
  let right = b < 0n ? -b : b;
  while (right !== 0n) [left, right] = [right, left % right];
  return left;
}

function lcm(a: bigint, b: bigint): bigint {
  if (a === 0n || b === 0n) return 0n;
  return (a / gcd(a, b)) * b;
}

function commonIncrement(values: readonly number[]): number {
  const places = Math.min(18, Math.max(...values.map(decimalPlaces)));
  const scale = 10 ** places;
  if (!Number.isSafeInteger(scale)) throw new Error('CEX product increments exceed safe common precision');
  const units = values.map(value => BigInt(Math.round(value * scale)));
  if (units.some(value => value <= 0n)) throw new Error('CEX product increment is invalid');
  const commonUnits = units.reduce((left, right) => lcm(left, right));
  const result = Number(commonUnits) / scale;
  if (!(result > 0) || !Number.isFinite(result)) throw new Error('Unable to derive common CEX child increment');
  return result;
}

function coinbaseLimit(constraints: CoinbaseAdvancedProductConstraints): VenueLimit {
  return {
    venue: 'coinbase',
    baseIncrement: constraints.baseIncrement,
    baseMinSize: constraints.baseMinSize,
    quoteMinSize: constraints.quoteMinSize,
    baseMaxSize: constraints.baseMaxSize,
    quoteMaxSize: constraints.quoteMaxSize,
  };
}

function constrainedLimit(constraints: SpotProductConstraints): VenueLimit {
  return {
    venue: constraints.venue,
    baseIncrement: constraints.baseIncrement,
    baseMinSize: constraints.baseMinSize,
    quoteMinSize: constraints.quoteMinSize,
    baseMaxSize: constraints.baseMaxSize,
    quoteMaxSize: constraints.quoteMaxSize,
  };
}

async function venueLimit(venue: QuoteVenue, symbol: string): Promise<VenueLimit> {
  if (venue === 'coinbase') return coinbaseLimit(await getCoinbaseAdvancedProductConstraints(symbol));
  if (venue === 'kraken' || venue === 'okx') return constrainedLimit(await getSpotProductConstraints(venue, symbol));
  throw new Error(`Hyper-hybrid CEX execution is unavailable for ${venue}`);
}

function maxQuantityForLimit(limit: VenueLimit, price: number): number {
  let maximum = Number.POSITIVE_INFINITY;
  if (limit.baseMaxSize !== null) maximum = Math.min(maximum, limit.baseMaxSize);
  if (limit.quoteMaxSize !== null) maximum = Math.min(maximum, limit.quoteMaxSize / price);
  return maximum;
}

function minQuantityForLimit(limit: VenueLimit, price: number): number {
  let minimum = limit.baseMinSize;
  if (limit.quoteMinSize !== null) minimum = Math.max(minimum, limit.quoteMinSize / price);
  return minimum;
}

function proportionalChildPlan(parent: VerifiedArbitragePlan, baseQty: number): VerifiedArbitragePlan {
  const ratio = baseQty / parent.baseQty;
  if (!(ratio > 0 && ratio <= 1) || !Number.isFinite(ratio)) throw new Error('Invalid hyper-hybrid child ratio');
  // A split cannot guess how a fixed gas/bridge/transfer cost should be allocated.
  // Canonical CEX arbitrage is prepositioned-inventory execution and normally has
  // zero fixed transport cost. Fail closed rather than fabricate split economics.
  const fixedCostsUsd = Math.max(0, parent.costs.gasUsd) + Math.max(0, parent.costs.bridgeFeeUsd) + Math.max(0, parent.costs.transferFeeUsd ?? 0);
  if (fixedCostsUsd > 1e-9) throw new Error('Hyper-hybrid CEX splitting requires zero fixed transport costs; cost allocation is not provable');
  const child: VerifiedArbitragePlan = {
    ...parent,
    baseQty,
    notionalUsd: parent.notionalUsd * ratio,
    requestedNotionalUsd: parent.notionalUsd * ratio,
    executableNotionalUsd: parent.notionalUsd * ratio,
    grossProfitUsd: parent.grossProfitUsd * ratio,
    netProfitUsd: parent.netProfitUsd * ratio,
    costs: {
      ...parent.costs,
      buyFeeUsd: parent.costs.buyFeeUsd * ratio,
      sellFeeUsd: parent.costs.sellFeeUsd * ratio,
      gasUsd: 0,
      bridgeFeeUsd: 0,
      transferFeeUsd: 0,
      totalCostsUsd: parent.costs.totalCostsUsd * ratio,
    },
  };
  if (!(child.netProfitUsd > 0)) throw new Error('Hyper-hybrid child is not deterministically profitable');
  return child;
}

export async function buildHyperHybridCexChildren(parent: VerifiedArbitragePlan): Promise<VerifiedArbitragePlan[]> {
  if (!(parent.baseQty > 0) || !(parent.notionalUsd > 0) || !(parent.netProfitUsd > 0)) {
    throw new Error('Hyper-hybrid parent must have positive quantity, notional and verified net profit');
  }
  const ladder = getProfitLadderNotionalAuthority();
  if (!(ladder.maxNotionalUsd > 0) || parent.notionalUsd > ladder.maxNotionalUsd + 1e-8) {
    throw new Error(`Hyper-hybrid parent notional $${parent.notionalUsd} exceeds active profit-ladder rung $${ladder.maxNotionalUsd}`);
  }

  const buyPrice = parent.buyLimitPrice ?? parent.buyAsk;
  const sellPrice = parent.sellLimitPrice ?? parent.sellBid;
  const [buy, sell] = await Promise.all([
    venueLimit(parent.buyVenue, parent.symbol),
    venueLimit(parent.sellVenue, parent.symbol),
  ]);
  const increment = commonIncrement([buy.baseIncrement, sell.baseIncrement]);
  const totalQty = floorToIncrement(parent.baseQty, increment);
  if (!(totalQty > 0)) throw new Error('Hyper-hybrid parent quantity cannot be aligned to current venue increments');

  const rawMaxChild = Math.min(
    totalQty,
    maxQuantityForLimit(buy, buyPrice),
    maxQuantityForLimit(sell, sellPrice),
  );
  const maxChildQty = floorToIncrement(rawMaxChild, increment);
  if (!(maxChildQty > 0)) throw new Error('No positive child size satisfies current CEX per-order maxima');

  const minimumQty = Math.max(
    minQuantityForLimit(buy, buyPrice),
    minQuantityForLimit(sell, sellPrice),
  );
  const totalUnits = Math.floor(totalQty / increment + 1e-8);
  const maxUnits = Math.floor(maxChildQty / increment + 1e-8);
  const minUnits = Math.max(1, Math.ceil(minimumQty / increment - 1e-8));
  const childCount = Math.max(1, Math.ceil(totalUnits / maxUnits));
  if (totalUnits < childCount * minUnits) {
    throw new Error('Parent cannot be split into children that simultaneously satisfy current exchange minimums and maximums');
  }

  const baseUnits = Math.floor(totalUnits / childCount);
  const remainder = totalUnits % childCount;
  const quantities = Array.from({ length: childCount }, (_, index) => (baseUnits + (index < remainder ? 1 : 0)) * increment);
  if (quantities.some(quantity => quantity + increment * 1e-7 < minimumQty || quantity > maxChildQty + increment * 1e-7)) {
    throw new Error('Derived CEX child quantity violates current exchange size envelope');
  }
  return quantities.map(quantity => proportionalChildPlan(parent, Number(quantity.toPrecision(15))));
}

function childConcurrency(): number {
  const parsed = Number(process.env.CRYPTO_CEX_CHILD_CONCURRENCY || DEFAULT_CHILD_CONCURRENCY);
  return Number.isFinite(parsed) ? Math.max(1, Math.min(32, Math.trunc(parsed))) : DEFAULT_CHILD_CONCURRENCY;
}

function takerFeeBps(plan: VerifiedArbitragePlan, side: 'buy' | 'sell'): number | null {
  const evidence = side === 'buy' ? plan.feeEvidence?.buy : plan.feeEvidence?.sell;
  const value = Number(evidence?.takerFeeBps);
  return Number.isFinite(value) && value >= 0 ? value : null;
}

function depthAtOrBetter(levels: readonly { price: number; quantity: number }[], side: 'buy' | 'sell', limitPrice: number): number {
  return levels
    .filter(level => side === 'buy' ? level.price <= limitPrice : level.price >= limitPrice)
    .reduce((sum, level) => sum + Math.max(0, level.quantity), 0);
}

/**
 * Warm, no-new-network revalidation between child waves. This prevents a stale
 * parent from blindly continuing after the spread/depth disappears. Missing warm
 * evidence fails closed for later waves; the first wave already inherits the
 * canonical parent's fresh measured book evidence and submit-time product guard.
 */
async function revalidateWave(parent: VerifiedArbitragePlan, waveQty: number, maxQuoteAgeMs: number): Promise<{ ok: boolean; reason: string }> {
  const buyVenue = parent.buyVenue as ExecutableCexVenue;
  const sellVenue = parent.sellVenue as ExecutableCexVenue;
  const [buy, sell] = await Promise.all([
    cexOrderBookStreams.getQuote(buyVenue, parent.symbol, maxQuoteAgeMs),
    cexOrderBookStreams.getQuote(sellVenue, parent.symbol, maxQuoteAgeMs),
  ]);
  if (!buy || !sell) return { ok: false, reason: 'warm_live_book_unavailable_for_next_split_wave' };

  const buyLimit = parent.buyLimitPrice ?? parent.buyAsk;
  const sellLimit = parent.sellLimitPrice ?? parent.sellBid;
  const buyDepth = depthAtOrBetter(buy.depth.asks, 'buy', buyLimit);
  const sellDepth = depthAtOrBetter(sell.depth.bids, 'sell', sellLimit);
  if (buyDepth + 1e-12 < waveQty || sellDepth + 1e-12 < waveQty) {
    return { ok: false, reason: `remaining_depth_insufficient:buy=${buyDepth}:sell=${sellDepth}:wave=${waveQty}` };
  }

  const buyBps = takerFeeBps(parent, 'buy');
  const sellBps = takerFeeBps(parent, 'sell');
  if (buyBps === null || sellBps === null) return { ok: false, reason: 'authenticated_taker_fee_evidence_missing_for_split_revalidation' };
  const buyNotional = waveQty * buyLimit;
  const sellNotional = waveQty * sellLimit;
  const conservativeNet = sellNotional - buyNotional - buyNotional * buyBps / 10_000 - sellNotional * sellBps / 10_000;
  if (!(conservativeNet > 0)) return { ok: false, reason: `split_wave_no_longer_positive_at_live_limits:${conservativeNet}` };
  return { ok: true, reason: 'warm_live_book_depth_and_limit_economics_positive' };
}

function fokAdapter(
  venue: ExecutableCexVenue,
  delegate: CexSettlementAdapter,
): CexSettlementAdapter {
  const adapter: CexSettlementAdapter = {
    async submit(request: OrderRequest): Promise<CexOrderReceipt> {
      const submittedAt = Date.now();
      if (venue === 'kraken') {
        const result = await krakenPrivateRequest('/0/private/AddOrder', {
          pair: request.symbol,
          type: request.side,
          ordertype: 'limit',
          price: cexDecimalString(request.price),
          volume: cexDecimalString(request.quantity),
          timeinforce: 'FOK',
        }, { timeoutMs: ORDER_SUBMIT_TIMEOUT_MS });
        const orderId = result.txid?.[0];
        if (!orderId) throw new Error('Kraken did not return an order id for FOK child');
        return { venue, orderId, symbol: request.symbol, side: request.side, requestedQuantity: request.quantity, submittedAt };
      }

      if (venue === 'okx') {
        const { base, quote } = splitSymbol(request.symbol);
        const { data } = await okxPrivateRequest('/api/v5/trade/order', 'POST', {
          instId: `${base}-${quote}`,
          tdMode: 'cash',
          side: request.side,
          ordType: 'fok',
          px: cexDecimalString(request.price),
          sz: cexDecimalString(request.quantity),
          clOrdId: randomUUID().replace(/-/g, '').slice(0, 32),
        }, { timeoutMs: ORDER_SUBMIT_TIMEOUT_MS });
        const order = data?.[0];
        if (!order || order.sCode !== '0' || !order.ordId) throw new Error(`OKX rejected FOK child: ${order?.sMsg || 'unknown error'}`);
        return { venue, orderId: order.ordId, symbol: request.symbol, side: request.side, requestedQuantity: request.quantity, submittedAt };
      }

      await assertCoinbaseSpotTradeReady();
      const constraints = await getCoinbaseAdvancedProductConstraints(request.symbol);
      const check = validateCoinbaseOrderAgainstProduct({ quantity: request.quantity, price: request.price }, constraints);
      if (!check.valid) throw new Error(`Coinbase FOK child violates current product constraints: ${check.reason}`);
      const payload = await coinbasePrivateRequest('/api/v3/brokerage/orders', 'POST', {
        body: {
          client_order_id: randomUUID(),
          product_id: coinbaseProductId(request.symbol),
          side: request.side.toUpperCase(),
          order_configuration: {
            limit_limit_fok: {
              base_size: coinbaseDecimalString(request.quantity),
              limit_price: coinbaseDecimalString(request.price),
              post_only: false,
            },
          },
        },
      });
      if (payload?.success !== true || !payload?.success_response?.order_id) {
        const message = payload?.error_response?.message || payload?.error_response?.error_details || 'unknown Coinbase FOK rejection';
        throw new Error(`Coinbase rejected FOK child: ${String(message)}`);
      }
      return { venue, orderId: String(payload.success_response.order_id), symbol: request.symbol, side: request.side, requestedQuantity: request.quantity, submittedAt };
    },
    query: order => delegate.query(order),
    cancel: order => delegate.cancel(order),
  };
  if (delegate.getBalances) adapter.getBalances = () => delegate.getBalances!();
  return adapter;
}

function fokAdapters(adapters: Partial<Record<ExecutableCexVenue, CexSettlementAdapter>>): Partial<Record<ExecutableCexVenue, CexSettlementAdapter>> {
  const output: Partial<Record<ExecutableCexVenue, CexSettlementAdapter>> = {};
  for (const venue of ['coinbase', 'kraken', 'okx'] as const) {
    const delegate = adapters[venue];
    if (delegate) output[venue] = fokAdapter(venue, delegate);
  }
  return output;
}

function sumKnown(values: Array<number | null | undefined>): number | null {
  if (values.some(value => value === null || value === undefined || !Number.isFinite(value))) return null;
  return values.reduce((sum, value) => sum + Number(value), 0);
}

function aggregateEconomics(children: readonly HyperHybridChildExecution[]): RealizedExecutionEconomics {
  const normalized = children.map(child => child.normalized?.realized).filter((value): value is RealizedExecutionEconomics => Boolean(value));
  return {
    acquisitionCostUsd: sumKnown(normalized.map(value => value.acquisitionCostUsd)),
    proceedsUsd: sumKnown(normalized.map(value => value.proceedsUsd)),
    exchangeFeeUsd: sumKnown(normalized.map(value => value.exchangeFeeUsd)),
    gasUsd: sumKnown(normalized.map(value => value.gasUsd)),
    gasUsed: null,
    effectiveGasPriceWei: null,
    slippageBps: normalized.length > 0 && normalized.every(value => value.slippageBps !== null && Number.isFinite(value.slippageBps))
      ? Math.max(...normalized.map(value => value.slippageBps!))
      : null,
    netProfitUsd: sumKnown(normalized.map(value => value.netProfitUsd)),
  };
}

function aggregateResult(
  parent: VerifiedArbitragePlan,
  plannedChildren: readonly VerifiedArbitragePlan[],
  children: readonly HyperHybridChildExecution[],
  stopReason?: string,
): HyperHybridCexExecutionResult {
  const completedChildren = children.filter(child => child.success && child.settlementConfirmed && child.normalized?.terminal === true);
  const completedNotionalUsd = completedChildren.reduce((sum, child) => sum + child.plannedNotionalUsd, 0);
  const remainingNotionalUsd = Math.max(0, parent.notionalUsd - completedNotionalUsd);
  const fullTargetCompleted = children.length === plannedChildren.length && completedChildren.length === plannedChildren.length;
  const allAttemptedTerminal = children.length > 0 && children.every(child => child.normalized?.terminal === true);
  const economics = aggregateEconomics(children);
  const orders = children.flatMap(child => child.normalized?.orders || []);
  const submittedAt = orders.length > 0 ? Math.min(...orders.map(order => order.submittedAt)) : Date.now();
  const settledAtValues = orders.map(order => order.terminalAt).filter((value): value is number => value !== null && Number.isFinite(value));
  const normalized: NormalizedRealizedExecution = {
    status: fullTargetCompleted ? 'filled' : completedChildren.length > 0 ? 'partially_filled' : (children[0]?.status || 'failed'),
    terminal: allAttemptedTerminal,
    settlementConfirmed: allAttemptedTerminal,
    submittedAt,
    settledAt: settledAtValues.length > 0 ? Math.max(...settledAtValues) : null,
    venueOrRoute: `${parent.buyVenue}->${parent.sellVenue}:hyper_hybrid`,
    chain: 'cex',
    predicted: {
      profitUsd: children.reduce((sum, child) => sum + child.expectedProfitUsd, 0),
      feeUsd: null,
      slippageBps: parent.expectedSlippageBps,
    },
    realized: economics,
    provenance: [
      'hyper_hybrid_parent_child_execution',
      `parent_target_notional_usd:${parent.notionalUsd}`,
      `planned_children:${plannedChildren.length}`,
      `attempted_children:${children.length}`,
      `completed_children:${completedChildren.length}`,
      'split_children_fok:true',
      'completed_child_profit_retained:true',
      'unfilled_remaining_notional_requires_fresh_revalidation:true',
    ],
    orders,
    error: stopReason,
  };
  return {
    success: fullTargetCompleted && allAttemptedTerminal,
    status: normalized.status,
    settlementConfirmed: normalized.settlementConfirmed,
    orders,
    normalized,
    realizedProfitUsd: economics.netProfitUsd,
    realizedFeeUsd: economics.exchangeFeeUsd,
    realizedSlippageBps: economics.slippageBps,
    error: stopReason,
    parentTargetNotionalUsd: parent.notionalUsd,
    completedNotionalUsd,
    remainingNotionalUsd,
    splitExecution: plannedChildren.length > 1,
    childExecutions: [...children],
    stopReason,
  };
}

export async function executeHyperHybridCexPlan(input: {
  parent: VerifiedArbitragePlan;
  adapters: Partial<Record<ExecutableCexVenue, CexSettlementAdapter>>;
  executorOptions?: CexExecutorOptions;
  maxQuoteAgeMs: number;
  executionAdmissionStartedAt: number;
  useProductionFok: boolean;
}): Promise<HyperHybridCexExecutionResult> {
  const plannedChildren = await buildHyperHybridCexChildren(input.parent);
  if (plannedChildren.length === 1) {
    await assertFreshCexProductConstraints(plannedChildren[0]);
    const result = await executeCexPlan(plannedChildren[0], { ...input.executorOptions, adapters: input.adapters });
    return {
      ...result,
      parentTargetNotionalUsd: input.parent.notionalUsd,
      completedNotionalUsd: result.success ? input.parent.notionalUsd : 0,
      remainingNotionalUsd: result.success ? 0 : input.parent.notionalUsd,
      splitExecution: false,
    };
  }

  const splitAdapters = input.useProductionFok ? fokAdapters(input.adapters) : input.adapters;
  const concurrency = childConcurrency();
  const childExecutions: HyperHybridChildExecution[] = [];
  let stopReason: string | undefined;

  for (let offset = 0; offset < plannedChildren.length; offset += concurrency) {
    const wave = plannedChildren.slice(offset, offset + concurrency);
    const effectiveQuoteAgeMs = Math.max(0, input.parent.quoteAgeMs) + (Date.now() - input.executionAdmissionStartedAt);
    if (effectiveQuoteAgeMs > input.maxQuoteAgeMs) {
      stopReason = `parent_quote_expired_before_child_wave:${effectiveQuoteAgeMs}>${input.maxQuoteAgeMs}`;
      break;
    }

    if (offset > 0) {
      const waveQty = wave.reduce((sum, child) => sum + child.baseQty, 0);
      const live = await revalidateWave(input.parent, waveQty, input.maxQuoteAgeMs);
      if (!live.ok) {
        stopReason = live.reason;
        break;
      }
    }

    const settled = await Promise.all(wave.map(async (child, index) => {
      const globalIndex = offset + index;
      const childId = `child-${globalIndex + 1}-of-${plannedChildren.length}`;
      const startedAt = Date.now();
      try {
        await assertFreshCexProductConstraints(child);
        const result = await executeCexPlan(child, { ...input.executorOptions, adapters: splitAdapters });
        return {
          childId,
          index: globalIndex,
          plannedNotionalUsd: child.notionalUsd,
          expectedProfitUsd: child.netProfitUsd,
          timeInForce: input.useProductionFok ? 'FOK' as const : 'IOC' as const,
          latencyMs: Date.now() - startedAt,
          success: result.success,
          status: result.status,
          settlementConfirmed: result.settlementConfirmed,
          normalized: result.normalized,
          realizedProfitUsd: result.realizedProfitUsd ?? result.normalized?.realized.netProfitUsd ?? null,
          realizedFeeUsd: result.realizedFeeUsd ?? result.normalized?.realized.exchangeFeeUsd ?? null,
          realizedSlippageBps: result.realizedSlippageBps ?? result.normalized?.realized.slippageBps ?? null,
          error: result.error,
        } satisfies HyperHybridChildExecution;
      } catch (error) {
        return {
          childId,
          index: globalIndex,
          plannedNotionalUsd: child.notionalUsd,
          expectedProfitUsd: child.netProfitUsd,
          timeInForce: input.useProductionFok ? 'FOK' as const : 'IOC' as const,
          latencyMs: Date.now() - startedAt,
          success: false,
          status: 'rejected' as const,
          settlementConfirmed: false,
          realizedProfitUsd: null,
          realizedFeeUsd: null,
          realizedSlippageBps: null,
          error: error instanceof Error ? error.message : String(error),
        } satisfies HyperHybridChildExecution;
      }
    }));
    childExecutions.push(...settled);

    const failed = settled.find(child => !child.success || child.normalized?.terminal !== true || child.settlementConfirmed !== true);
    if (failed) {
      stopReason = `child_wave_stopped_after_${failed.childId}:${failed.error || failed.status}`;
      break;
    }
  }

  const result = aggregateResult(input.parent, plannedChildren, childExecutions, stopReason);
  logger.info('[CEX HyperHybrid] Parent/child execution completed', {
    component: 'HyperHybridCexExecution',
    symbol: input.parent.symbol,
    buyVenue: input.parent.buyVenue,
    sellVenue: input.parent.sellVenue,
    parentTargetNotionalUsd: input.parent.notionalUsd,
    profitLadderMaxNotionalUsd: getProfitLadderNotionalAuthority().maxNotionalUsd,
    plannedChildren: plannedChildren.length,
    attemptedChildren: childExecutions.length,
    successfulChildren: childExecutions.filter(child => child.success).length,
    completedNotionalUsd: result.completedNotionalUsd,
    remainingNotionalUsd: result.remainingNotionalUsd,
    childConcurrency: concurrency,
    productionSplitTimeInForce: input.useProductionFok ? 'FOK' : 'injected_adapter_semantics',
    warmBookRevalidationBetweenWaves: true,
    completedChildProfitRetained: true,
    stopReason: result.stopReason || null,
  });
  return result;
}

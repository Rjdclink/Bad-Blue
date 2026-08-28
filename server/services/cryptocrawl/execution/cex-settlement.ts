import { randomUUID } from 'node:crypto';
import logger from '../../../logger.js';
import type { VerifiedArbitragePlan } from '../arbitrage/arbitrage-verifier.js';
import { krakenPrivateRequest, okxPrivateRequest } from '../intelligence/cex-private-authority.js';
import {
  CoinbaseSpotSettlementAdapter,
  type CoinbaseOrderReceipt,
} from './coinbase-spot-settlement-adapter.js';
import type {
  ExecutionFill,
  ExecutionStatus,
  NormalizedOrderSettlement,
  NormalizedRealizedExecution,
  RealizedExecutionEconomics,
} from './settlement-types.js';

export type ExecutableCexVenue = 'coinbase' | 'kraken' | 'okx';

export interface CexOrderReceipt {
  venue: ExecutableCexVenue;
  orderId: string;
  symbol: string;
  side: 'buy' | 'sell';
  requestedQuantity: number;
  submittedAt: number;
}

export interface CexSettlementAdapter {
  submit(request: OrderRequest): Promise<CexOrderReceipt>;
  query(order: CexOrderReceipt): Promise<NormalizedOrderSettlement>;
  cancel(order: CexOrderReceipt): Promise<void>;
  getBalances?(): Promise<Record<string, string>>;
}

export interface CexExecutorOptions {
  adapters?: Partial<Record<ExecutableCexVenue, CexSettlementAdapter>>;
  settlementTimeoutMs?: number;
  pollIntervalMs?: number;
  now?: () => number;
  sleep?: (milliseconds: number) => Promise<void>;
}

export interface CexExecutionResult {
  success: boolean;
  status: ExecutionStatus;
  settlementConfirmed: boolean;
  buyOrder?: CexOrderReceipt;
  sellOrder?: CexOrderReceipt;
  orders?: NormalizedOrderSettlement[];
  normalized?: NormalizedRealizedExecution;
  realizedProfitUsd?: number | null;
  realizedFeeUsd?: number | null;
  realizedSlippageBps?: number | null;
  error?: string;
}

export interface OrderRequest {
  symbol: string;
  side: 'buy' | 'sell';
  quantity: number;
  price: number;
}

const ORDER_SUBMIT_TIMEOUT_MS = Math.max(3000, Number(process.env.CRYPTO_ARBITRAGE_ORDER_TIMEOUT_MS || 12000));
const SETTLEMENT_TIMEOUT_MS = Math.max(1000, Number(process.env.CRYPTO_ARBITRAGE_SETTLEMENT_TIMEOUT_MS || 30000));
const SETTLEMENT_POLL_INTERVAL_MS = Math.max(100, Number(process.env.CRYPTO_ARBITRAGE_SETTLEMENT_POLL_INTERVAL_MS || 1000));

function toDecimal(value: number): string {
  if (!Number.isFinite(value) || value <= 0) throw new Error('Order values must be finite and positive');
  return value.toFixed(12).replace(/\.?0+$/, '');
}

function splitSymbol(symbol: string): { base: string; quote: string } {
  const match = symbol.match(/^([A-Z0-9]+)(USDT|USDC|USD)$/);
  if (!match) throw new Error(`Unsupported spot symbol: ${symbol}`);
  return { base: match[1], quote: match[2] };
}

function nullableNumber(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function signedFeeAmount(value: unknown): number | null {
  return nullableNumber(value);
}

function positiveNumber(value: unknown): number | null {
  const parsed = nullableNumber(value);
  return parsed !== null && parsed > 0 ? parsed : null;
}

function timestampMilliseconds(value: unknown): number | null {
  const timestamp = nullableNumber(value);
  if (timestamp === null || timestamp <= 0) return null;
  return timestamp < 10_000_000_000 ? Math.round(timestamp * 1000) : Math.round(timestamp);
}

function sumNumbers(values: Array<number | null>): number | null {
  if (values.some(value => value === null)) return null;
  return values.reduce((sum, value) => sum + value!, 0);
}

function feeAssetFromValues(values: Array<string | null>): string | null {
  const known = values.filter((value): value is string => !!value);
  if (known.length === 0) return null;
  const first = known[0].toUpperCase();
  return known.every(value => value.toUpperCase() === first) ? first : null;
}

function classifyOrderStatus(rawStatus: string, filledQuantity: number, requestedQuantity: number): { status: ExecutionStatus; terminal: boolean } {
  const status = rawStatus.toLowerCase();
  const complete = requestedQuantity > 0 && filledQuantity >= requestedQuantity * (1 - 1e-8);
  if (status.includes('reject') || status === 'order_failed') return { status: 'rejected', terminal: true };
  if (complete || status === 'filled') return { status: 'filled', terminal: true };
  if (status.includes('cancel') || status === 'expired' || status === 'closed' && filledQuantity <= 0) {
    return filledQuantity > 0 ? { status: 'partially_filled', terminal: true } : { status: 'cancelled', terminal: true };
  }
  if (filledQuantity > 0) return { status: 'partially_filled', terminal: status !== 'open' && status !== 'live' && status !== 'pending' };
  if (status === 'closed') return { status: 'cancelled', terminal: true };
  return { status: 'submitted', terminal: false };
}

function unknownSettlement(order: CexOrderReceipt, error: string): NormalizedOrderSettlement {
  return {
    venue: order.venue,
    orderId: order.orderId,
    symbol: order.symbol,
    side: order.side,
    status: 'settlement_unknown',
    terminal: false,
    requestedQuantity: order.requestedQuantity,
    filledQuantity: null,
    remainingQuantity: null,
    averageFillPrice: null,
    fills: [],
    feeAmount: null,
    feeAsset: null,
    submittedAt: order.submittedAt,
    terminalAt: null,
    error,
  };
}

class KrakenSettlementAdapter implements CexSettlementAdapter {
  private async privateRequest(path: string, parameters: Record<string, string> = {}): Promise<any> {
    return krakenPrivateRequest(path, parameters, { timeoutMs: ORDER_SUBMIT_TIMEOUT_MS });
  }

  async submit(request: OrderRequest): Promise<CexOrderReceipt> {
    const submittedAt = Date.now();
    const result = await this.privateRequest('/0/private/AddOrder', {
      pair: request.symbol,
      type: request.side,
      ordertype: 'limit',
      price: toDecimal(request.price),
      volume: toDecimal(request.quantity),
      timeinforce: 'IOC',
    });
    const orderId = result.txid?.[0];
    if (!orderId) throw new Error('Kraken did not return an order id');
    return { venue: 'kraken', orderId, symbol: request.symbol, side: request.side, requestedQuantity: request.quantity, submittedAt };
  }

  async query(order: CexOrderReceipt): Promise<NormalizedOrderSettlement> {
    if (order.venue !== 'kraken') throw new Error(`Kraken adapter cannot query ${order.venue} order`);
    const result = await this.privateRequest('/0/private/QueryOrders', { txid: order.orderId, trades: 'true' });
    const row = result[order.orderId] || result[Object.keys(result)[0]];
    if (!row) throw new Error(`Kraken returned no order state for ${order.orderId}`);
    const filledQuantity = nullableNumber(row.vol_exec) ?? 0;
    const requestedQuantity = positiveNumber(row.vol) ?? order.requestedQuantity;
    const averageFillPrice = positiveNumber(row.price) ?? (filledQuantity > 0 && positiveNumber(row.cost) !== null ? Number(row.cost) / filledQuantity : null);
    let fills: ExecutionFill[] = [];
    let tradeFees: Array<number | null> = [];
    let tradeFeeAssets: Array<string | null> = [];
    const tradeIds = Array.isArray(row.trades) ? row.trades.filter((value: unknown): value is string => typeof value === 'string') : [];
    if (tradeIds.length > 0) {
      try {
        const trades = await this.privateRequest('/0/private/QueryTrades', { txid: tradeIds.join(',') });
        fills = Object.entries(trades).map(([tradeId, value]) => {
          const trade = value as Record<string, unknown>;
          const quantity = positiveNumber(trade.vol) || 0;
          const price = positiveNumber(trade.price) || 0;
          const feeAmount = signedFeeAmount(trade.fee);
          const feeAsset = typeof trade.feeCurrency === 'string'
            ? trade.feeCurrency
            : typeof trade.fee_currency === 'string' ? trade.fee_currency : null;
          tradeFees.push(feeAmount);
          tradeFeeAssets.push(feeAsset);
          return { quantity, price, feeAmount, feeAsset, timestamp: timestampMilliseconds(trade.time), tradeId };
        }).filter(fill => fill.quantity > 0 && fill.price > 0);
      } catch (error) {
        logger.warn('[CEX Executor] Kraken trade details unavailable; retaining aggregate order fee', {
          component: 'CentralizedExchangeExecutor',
          orderId: order.orderId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    if (fills.length === 0 && filledQuantity > 0 && averageFillPrice !== null) {
      const feeAsset = typeof row.feeCurrency === 'string'
        ? row.feeCurrency
        : typeof row.fee_currency === 'string' ? row.fee_currency : null;
      fills = [{
        quantity: filledQuantity,
        price: averageFillPrice,
        feeAmount: signedFeeAmount(row.fee),
        feeAsset,
        timestamp: timestampMilliseconds(row.closetm || row.time || row.opentm),
      }];
      tradeFees = [signedFeeAmount(row.fee)];
      tradeFeeAssets = [feeAsset];
    }
    const feeAmount = fills.length > 0 ? sumNumbers(tradeFees) : signedFeeAmount(row.fee);
    const classification = classifyOrderStatus(String(row.status || 'pending'), filledQuantity, requestedQuantity);
    let finalBalances: Record<string, string> | undefined;
    if (classification.terminal) {
      try {
        finalBalances = await this.getBalances();
      } catch (error) {
        logger.warn('[CEX Executor] Kraken final balance query unavailable', {
          component: 'CentralizedExchangeExecutor',
          orderId: order.orderId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    return {
      venue: 'kraken',
      orderId: order.orderId,
      symbol: order.symbol,
      side: order.side,
      status: classification.status,
      terminal: classification.terminal,
      requestedQuantity,
      filledQuantity,
      remainingQuantity: Math.max(0, requestedQuantity - filledQuantity),
      averageFillPrice,
      fills,
      feeAmount,
      feeAsset: feeAssetFromValues(tradeFeeAssets),
      submittedAt: order.submittedAt,
      terminalAt: classification.terminal ? timestampMilliseconds(row.closetm || row.time || row.opentm) || Date.now() : null,
      finalBalances,
      error: row.reason ? String(row.reason) : undefined,
    };
  }

  async cancel(order: CexOrderReceipt): Promise<void> {
    if (order.venue !== 'kraken') throw new Error(`Kraken adapter cannot cancel ${order.venue} order`);
    await this.privateRequest('/0/private/CancelOrder', { txid: order.orderId });
  }

  async getBalances(): Promise<Record<string, string>> {
    const result = await this.privateRequest('/0/private/Balance');
    return Object.fromEntries(Object.entries(result).map(([asset, value]) => [asset, String(value)]));
  }
}

class OkxSettlementAdapter implements CexSettlementAdapter {
  private async privateRequest(path: string, method: 'GET' | 'POST', parameters: Record<string, string> = {}): Promise<any[]> {
    const { data } = await okxPrivateRequest(path, method, parameters, { timeoutMs: ORDER_SUBMIT_TIMEOUT_MS });
    return data;
  }

  async submit(request: OrderRequest): Promise<CexOrderReceipt> {
    const submittedAt = Date.now();
    const { base, quote } = splitSymbol(request.symbol);
    const rows = await this.privateRequest('/api/v5/trade/order', 'POST', {
      instId: `${base}-${quote}`,
      tdMode: 'cash',
      side: request.side,
      ordType: 'ioc',
      px: toDecimal(request.price),
      sz: toDecimal(request.quantity),
      clOrdId: randomUUID().replace(/-/g, '').slice(0, 32),
    });
    const order = rows[0];
    if (!order || order.sCode !== '0' || !order.ordId) throw new Error(`OKX rejected order: ${order?.sMsg || 'unknown error'}`);
    return { venue: 'okx', orderId: order.ordId, symbol: request.symbol, side: request.side, requestedQuantity: request.quantity, submittedAt };
  }

  async query(order: CexOrderReceipt): Promise<NormalizedOrderSettlement> {
    if (order.venue !== 'okx') throw new Error(`OKX adapter cannot query ${order.venue} order`);
    const { base, quote } = splitSymbol(order.symbol);
    const rows = await this.privateRequest('/api/v5/trade/order', 'GET', { instId: `${base}-${quote}`, ordId: order.orderId });
    const row = rows[0];
    if (!row) throw new Error(`OKX returned no order state for ${order.orderId}`);
    const filledQuantity = nullableNumber(row.accFillSz) ?? 0;
    const requestedQuantity = positiveNumber(row.sz) ?? order.requestedQuantity;
    const averageFillPrice = positiveNumber(row.avgPx);
    let fills: ExecutionFill[] = [];
    try {
      const fillRows = await this.privateRequest('/api/v5/trade/fills', 'GET', {
        instId: `${base}-${quote}`,
        ordId: order.orderId,
        limit: '100',
      });
      fills = fillRows.map((fill: Record<string, unknown>) => ({
        quantity: positiveNumber(fill.fillSz) || 0,
        price: positiveNumber(fill.fillPx) || 0,
        feeAmount: signedFeeAmount(fill.fee),
        feeAsset: typeof fill.feeCcy === 'string' ? fill.feeCcy : null,
        timestamp: timestampMilliseconds(fill.ts),
        tradeId: typeof fill.tradeId === 'string' ? fill.tradeId : undefined,
      })).filter((fill: ExecutionFill) => fill.quantity > 0 && fill.price > 0);
    } catch (error) {
      logger.warn('[CEX Executor] OKX fill details unavailable; retaining aggregate order fee', {
        component: 'CentralizedExchangeExecutor',
        orderId: order.orderId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
    const feeValues = fills.length > 0 ? fills.map(fill => fill.feeAmount) : [signedFeeAmount(row.fee)];
    const feeAssets = fills.length > 0 ? fills.map(fill => fill.feeAsset) : [typeof row.feeCcy === 'string' ? row.feeCcy : null];
    const classification = classifyOrderStatus(String(row.state || 'live'), filledQuantity, requestedQuantity);
    let finalBalances: Record<string, string> | undefined;
    if (classification.terminal) {
      try {
        finalBalances = await this.getBalances();
      } catch (error) {
        logger.warn('[CEX Executor] OKX final balance query unavailable', {
          component: 'CentralizedExchangeExecutor',
          orderId: order.orderId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    return {
      venue: 'okx',
      orderId: order.orderId,
      symbol: order.symbol,
      side: order.side,
      status: classification.status,
      terminal: classification.terminal,
      requestedQuantity,
      filledQuantity,
      remainingQuantity: Math.max(0, requestedQuantity - filledQuantity),
      averageFillPrice,
      fills,
      feeAmount: sumNumbers(feeValues),
      feeAsset: feeAssetFromValues(feeAssets),
      submittedAt: order.submittedAt,
      terminalAt: classification.terminal ? timestampMilliseconds(row.uTime || row.fillTime || row.cTime) || Date.now() : null,
      finalBalances,
      error: row.cancelSource ? `cancel_source:${row.cancelSource}` : undefined,
    };
  }

  async cancel(order: CexOrderReceipt): Promise<void> {
    if (order.venue !== 'okx') throw new Error(`OKX adapter cannot cancel ${order.venue} order`);
    const { base, quote } = splitSymbol(order.symbol);
    await this.privateRequest('/api/v5/trade/cancel-order', 'POST', { instId: `${base}-${quote}`, ordId: order.orderId });
  }

  async getBalances(): Promise<Record<string, string>> {
    const rows = await this.privateRequest('/api/v5/account/balance', 'GET');
    const details = Array.isArray(rows[0]?.details) ? rows[0].details : [];
    return Object.fromEntries(details
      .filter((detail: Record<string, unknown>) => typeof detail.ccy === 'string')
      .map((detail: Record<string, unknown>) => [detail.ccy as string, String(detail.eq ?? detail.cashBal ?? detail.availBal ?? '')]));
  }
}

class CoinbaseSettlementBridge implements CexSettlementAdapter {
  private readonly delegate = new CoinbaseSpotSettlementAdapter();

  async submit(request: OrderRequest): Promise<CexOrderReceipt> {
    return this.delegate.submit(request);
  }

  async query(order: CexOrderReceipt): Promise<NormalizedOrderSettlement> {
    if (order.venue !== 'coinbase') throw new Error(`Coinbase adapter cannot query ${order.venue} order`);
    return this.delegate.query(order as CoinbaseOrderReceipt);
  }

  async cancel(order: CexOrderReceipt): Promise<void> {
    if (order.venue !== 'coinbase') throw new Error(`Coinbase adapter cannot cancel ${order.venue} order`);
    await this.delegate.cancel(order as CoinbaseOrderReceipt);
  }

  async getBalances(): Promise<Record<string, string>> {
    return this.delegate.getBalances();
  }
}

function canonicalFeeAsset(asset: string): string {
  const upper = asset.trim().toUpperCase();
  if (upper === 'ZUSD') return 'USD';
  if (upper === 'XXBT' || upper === 'XBT') return 'BTC';
  if (upper === 'XETH') return 'ETH';
  return upper;
}

function knownFeeUsd(order: NormalizedOrderSettlement, baseAsset: string, quoteAsset: string): number | null {
  if (order.feeAmount === null) return null;
  if (order.feeAmount === 0) return 0;
  if (!order.feeAsset) return null;
  const feeAmount = order.feeAmount;
  const feeAsset = canonicalFeeAsset(order.feeAsset);
  const normalizedBase = canonicalFeeAsset(baseAsset);
  const normalizedQuote = canonicalFeeAsset(quoteAsset);
  // USD, USDT and USDC are distinct inventory assets. Never silently assume a
  // stablecoin is worth exactly one USD in realized settlement accounting.
  if (feeAsset === normalizedQuote) return feeAmount;
  if (feeAsset === normalizedBase && order.averageFillPrice !== null) return feeAmount * order.averageFillPrice;
  return null;
}

function calculateRealizedEconomics(plan: VerifiedArbitragePlan, buy: NormalizedOrderSettlement, sell: NormalizedOrderSettlement): { economics: RealizedExecutionEconomics; complete: boolean } {
  const buyQuantity = buy.filledQuantity;
  const sellQuantity = sell.filledQuantity;
  const buyPrice = buy.averageFillPrice;
  const sellPrice = sell.averageFillPrice;
  const matchingQuantity = buyQuantity !== null && sellQuantity !== null ? Math.min(buyQuantity, sellQuantity) : null;
  const quantitiesMatch = matchingQuantity !== null && matchingQuantity > 0
    && Math.abs(buyQuantity! - sellQuantity!) <= Math.max(1e-10, Math.max(buyQuantity!, sellQuantity!) * 1e-8);
  const acquisitionCostUsd = quantitiesMatch && buyPrice !== null ? matchingQuantity! * buyPrice : null;
  const proceedsUsd = quantitiesMatch && sellPrice !== null ? matchingQuantity! * sellPrice : null;
  const { base, quote } = splitSymbol(plan.symbol);
  const buyFeeUsd = knownFeeUsd(buy, base, quote);
  const sellFeeUsd = knownFeeUsd(sell, base, quote);
  const exchangeFeeUsd = buyFeeUsd !== null && sellFeeUsd !== null ? buyFeeUsd + sellFeeUsd : null;
  const slippageBps = buyPrice !== null && sellPrice !== null && plan.buyAsk > 0 && plan.sellBid > 0
    ? Math.max(0, ((buyPrice - plan.buyAsk) / plan.buyAsk + (plan.sellBid - sellPrice) / plan.sellBid) * 10000)
    : null;
  const netProfitUsd = acquisitionCostUsd !== null && proceedsUsd !== null && exchangeFeeUsd !== null
    ? proceedsUsd - acquisitionCostUsd - exchangeFeeUsd
    : null;
  return {
    economics: {
      acquisitionCostUsd,
      proceedsUsd,
      exchangeFeeUsd,
      gasUsd: null,
      gasUsed: null,
      effectiveGasPriceWei: null,
      slippageBps,
      netProfitUsd,
    },
    complete: netProfitUsd !== null && slippageBps !== null && Number.isFinite(netProfitUsd) && Number.isFinite(slippageBps),
  };
}

function incompletePairSettlement(
  plan: VerifiedArbitragePlan,
  orders: NormalizedOrderSettlement[],
  status: ExecutionStatus,
  now: () => number,
  error?: string,
): NormalizedRealizedExecution {
  return {
    status,
    terminal: false,
    settlementConfirmed: false,
    submittedAt: orders.length > 0 ? Math.min(...orders.map(order => order.submittedAt)) : now(),
    settledAt: null,
    venueOrRoute: `${plan.buyVenue}->${plan.sellVenue}`,
    chain: 'cex',
    predicted: {
      profitUsd: plan.netProfitUsd,
      feeUsd: plan.costs.totalCostsUsd,
      slippageBps: plan.expectedSlippageBps,
    },
    realized: {
      acquisitionCostUsd: null,
      proceedsUsd: null,
      exchangeFeeUsd: null,
      gasUsd: null,
      gasUsed: null,
      effectiveGasPriceWei: null,
      slippageBps: null,
      netProfitUsd: null,
    },
    provenance: ['authenticated_order_submission'],
    orders,
    error,
  };
}

function pairLifecycleStatus(buy: NormalizedOrderSettlement, sell: NormalizedOrderSettlement): ExecutionStatus {
  if (!buy.terminal || !sell.terminal) return 'settlement_unknown';
  const buyFilled = (buy.filledQuantity || 0) > 0;
  const sellFilled = (sell.filledQuantity || 0) > 0;
  if (buy.status === 'filled' && sell.status === 'filled') return 'filled';
  if (buyFilled || sellFilled || buy.status === 'partially_filled' || sell.status === 'partially_filled') return 'partially_filled';
  if (buy.status === 'rejected' || sell.status === 'rejected') return 'rejected';
  if (buy.status === 'failed' || sell.status === 'failed') return 'failed';
  return 'cancelled';
}

async function settleOrder(
  order: CexOrderReceipt,
  adapter: CexSettlementAdapter,
  options: Required<Pick<CexExecutorOptions, 'now' | 'sleep'>> & { settlementTimeoutMs: number; pollIntervalMs: number },
): Promise<NormalizedOrderSettlement> {
  const deadline = options.now() + options.settlementTimeoutMs;
  let last: NormalizedOrderSettlement | null = null;
  let lastError = 'settlement query did not return a terminal state';
  while (options.now() <= deadline) {
    try {
      last = await adapter.query(order);
      if (last.terminal) return last;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    if (options.now() >= deadline) break;
    await options.sleep(Math.min(options.pollIntervalMs, Math.max(0, deadline - options.now())));
  }
  if (last && !last.terminal) {
    try {
      await adapter.cancel(order);
    } catch (error) {
      lastError = `cancel failed: ${error instanceof Error ? error.message : String(error)}`;
    }
    try {
      const afterCancel = await adapter.query(order);
      if (afterCancel.terminal) return afterCancel;
      last = afterCancel;
    } catch (error) {
      lastError = `final settlement query failed: ${error instanceof Error ? error.message : String(error)}`;
    }
  }
  return last
    ? { ...last, status: 'settlement_unknown', terminal: false, error: lastError }
    : unknownSettlement(order, lastError);
}

export function createProductionCexSettlementAdapters(): Record<ExecutableCexVenue, CexSettlementAdapter> {
  return {
    coinbase: new CoinbaseSettlementBridge(),
    kraken: new KrakenSettlementAdapter(),
    okx: new OkxSettlementAdapter(),
  };
}

export async function executeCexPlan(plan: VerifiedArbitragePlan, options: CexExecutorOptions = {}): Promise<CexExecutionResult> {
  const adapters: Record<ExecutableCexVenue, CexSettlementAdapter> = {
    ...createProductionCexSettlementAdapters(),
    ...options.adapters,
  };
  const now = options.now || Date.now;
  const sleep = options.sleep || (milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds)));
  const settlementTimeoutMs = Math.max(0, options.settlementTimeoutMs ?? SETTLEMENT_TIMEOUT_MS);
  const pollIntervalMs = Math.max(0, options.pollIntervalMs ?? SETTLEMENT_POLL_INTERVAL_MS);
  const buyRequest = {
    symbol: plan.symbol,
    side: 'buy' as const,
    quantity: plan.baseQty,
    price: plan.buyLimitPrice ?? plan.buyAsk,
  };
  const sellRequest = {
    symbol: plan.symbol,
    side: 'sell' as const,
    quantity: plan.baseQty,
    price: plan.sellLimitPrice ?? plan.sellBid,
  };
  const buyAdapter = adapters[plan.buyVenue as ExecutableCexVenue];
  const sellAdapter = adapters[plan.sellVenue as ExecutableCexVenue];
  if (!buyAdapter || !sellAdapter) {
    return {
      success: false,
      status: 'rejected',
      settlementConfirmed: false,
      error: `No settlement-safe adapter for ${plan.buyVenue}->${plan.sellVenue}`,
    };
  }
  const [buyResult, sellResult] = await Promise.allSettled([
    buyAdapter.submit(buyRequest),
    sellAdapter.submit(sellRequest),
  ]);
  const buyOrder = buyResult.status === 'fulfilled' ? buyResult.value : undefined;
  const sellOrder = sellResult.status === 'fulfilled' ? sellResult.value : undefined;
  const [buySettlement, sellSettlement] = await Promise.all([
    buyOrder
      ? settleOrder(buyOrder, adapters[buyOrder.venue], { now, sleep, settlementTimeoutMs, pollIntervalMs })
      : Promise.resolve(null),
    sellOrder
      ? settleOrder(sellOrder, adapters[sellOrder.venue], { now, sleep, settlementTimeoutMs, pollIntervalMs })
      : Promise.resolve(null),
  ]);
  const submissionError = [buyResult, sellResult]
    .filter((result): result is PromiseRejectedResult => result.status === 'rejected')
    .map(result => result.reason instanceof Error ? result.reason.message : String(result.reason));

  if (!buySettlement || !sellSettlement) {
    const orders = [buySettlement, sellSettlement].filter((value): value is NormalizedOrderSettlement => value !== null);
    const status: ExecutionStatus = buyOrder || sellOrder
      ? 'settlement_unknown'
      : submissionError.length > 0 ? 'rejected' : 'failed';
    const normalized = incompletePairSettlement(
      plan,
      orders,
      status,
      now,
      `Order pair was not fully submitted: ${submissionError.join('; ')}`,
    );
    return {
      success: false,
      status,
      settlementConfirmed: false,
      buyOrder,
      sellOrder,
      orders,
      normalized,
      realizedProfitUsd: null,
      realizedFeeUsd: null,
      realizedSlippageBps: null,
      error: normalized.error,
    };
  }

  const lifecycleStatus = pairLifecycleStatus(buySettlement, sellSettlement);
  const { economics, complete } = calculateRealizedEconomics(plan, buySettlement, sellSettlement);
  const status = lifecycleStatus;
  const settlementConfirmed = buySettlement.terminal && sellSettlement.terminal;
  const normalized: NormalizedRealizedExecution = {
    status,
    terminal: settlementConfirmed,
    settlementConfirmed,
    submittedAt: Math.min(buyOrder.submittedAt, sellOrder.submittedAt),
    settledAt: Math.max(buySettlement.terminalAt || 0, sellSettlement.terminalAt || 0) || null,
    venueOrRoute: `${plan.buyVenue}->${plan.sellVenue}`,
    chain: 'cex',
    predicted: {
      profitUsd: plan.netProfitUsd,
      feeUsd: plan.costs.totalCostsUsd,
      slippageBps: plan.expectedSlippageBps,
    },
    realized: economics,
    provenance: [
      `${plan.buyVenue}:authenticated_order_query`,
      `${plan.sellVenue}:authenticated_order_query`,
      ...(buySettlement.fills.length > 0 ? [`${plan.buyVenue}:fills`] : []),
      ...(sellSettlement.fills.length > 0 ? [`${plan.sellVenue}:fills`] : []),
      ...(buySettlement.finalBalances || sellSettlement.finalBalances ? ['authenticated_final_balances'] : []),
    ],
    orders: [buySettlement, sellSettlement],
    error: submissionError.length > 0 ? submissionError.join('; ') : undefined,
  };

  logger.info('[CEX Executor] Normalized exchange settlement', {
    component: 'CentralizedExchangeExecutor',
    symbol: plan.symbol,
    status,
    settlementConfirmed,
    realizedProfitUsd: economics.netProfitUsd,
    realizedFeeUsd: economics.exchangeFeeUsd,
  });

  return {
    success: status === 'filled' && settlementConfirmed && complete,
    status,
    settlementConfirmed,
    buyOrder,
    sellOrder,
    orders: [buySettlement, sellSettlement],
    normalized,
    realizedProfitUsd: economics.netProfitUsd,
    realizedFeeUsd: economics.exchangeFeeUsd,
    realizedSlippageBps: economics.slippageBps,
    error: normalized.error,
  };
}

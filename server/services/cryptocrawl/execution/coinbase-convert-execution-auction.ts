import logger from '../../../logger.js';
import { coinbasePrivateRequest } from '../intelligence/coinbase-advanced-trade-authority.js';
import { resolveCexFeeEvidence } from '../intelligence/cex-fee-resolver.js';
import { coinbaseDecimalString, coinbaseProductId } from './coinbase-spot-settlement-adapter.js';
import type { CexOrderReceipt, OrderRequest, PreparedCexOrderSubmission } from './cex-settlement.js';
import type { NormalizedOrderSettlement } from './settlement-types.js';

const CONVERT_PREFIX = 'coinbase-convert:';
const QUOTE_TTL_MS = boundedInt(process.env.CRYPTO_COINBASE_CONVERT_QUOTE_TTL_MS, 1_500, 250, 10_000);
const MIN_BENEFIT_BPS = boundedNumber(process.env.CRYPTO_COINBASE_CONVERT_MIN_BENEFIT_BPS, 0, 0, 100);
const ELIGIBLE_PAIRS = new Set(['USDC-USD', 'PYUSD-USD', 'EURC-EUR', 'PYUSD-USDC']);

export interface CoinbaseConvertQuoteEvidence {
  tradeId: string;
  symbol: string;
  side: 'buy' | 'sell';
  sourceCurrency: string;
  targetCurrency: string;
  sourceAmount: number;
  targetAmount: number;
  baseQuantity: number;
  effectivePrice: number;
  fallbackAllInPrice: number;
  measuredBenefitBps: number;
  totalFeeAmount: number | null;
  totalFeeCurrency: string | null;
  observedAt: number;
  expiresAt: number;
  status: string;
  provenance: string[];
}

function boundedInt(raw: unknown, fallback: number, min: number, max: number): number {
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? Math.max(min, Math.min(max, Math.trunc(parsed))) : fallback;
}

function boundedNumber(raw: unknown, fallback: number, min: number, max: number): number {
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? Math.max(min, Math.min(max, parsed)) : fallback;
}

function finitePositive(value: unknown): number | null {
  if (value === null || value === undefined || typeof value === 'boolean') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function finiteNonNegative(value: unknown): number | null {
  if (value === null || value === undefined || typeof value === 'boolean') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function money(value: any): { value: number; currency: string } | null {
  const amount = finitePositive(value?.value);
  const currency = String(value?.currency || '').trim().toUpperCase();
  return amount !== null && currency ? { value: amount, currency } : null;
}

function feeMoney(value: any): { value: number; currency: string } | null {
  const amount = finiteNonNegative(value?.amount?.value);
  const currency = String(value?.amount?.currency || '').trim().toUpperCase();
  return amount !== null && currency ? { value: amount, currency } : null;
}

function pair(symbol: string): { base: string; quote: string; productId: string } | null {
  let productId: string;
  try {
    productId = coinbaseProductId(symbol);
  } catch {
    return null;
  }
  const [base, quote] = productId.split('-').map(value => value.trim().toUpperCase());
  if (!base || !quote) return null;
  const canonical = `${base}-${quote}`;
  const inverse = `${quote}-${base}`;
  if (!ELIGIBLE_PAIRS.has(canonical) && !ELIGIBLE_PAIRS.has(inverse)) return null;
  return { base, quote, productId: canonical };
}

function terminalStatus(statusRaw: unknown): { terminal: boolean; success: boolean } {
  const status = String(statusRaw || '').trim().toUpperCase();
  if (/(COMPLETE|COMPLETED|SUCCESS|SUCCEEDED|SETTLED)/.test(status)) return { terminal: true, success: true };
  if (/(CANCEL|FAIL|FAILED|REJECT|ERROR|EXPIRE)/.test(status)) return { terminal: true, success: false };
  return { terminal: false, success: false };
}

function convertId(orderId: string): string | null {
  return orderId.startsWith(CONVERT_PREFIX) ? orderId.slice(CONVERT_PREFIX.length) || null : null;
}

function extractTradeAmounts(trade: any, sourceCurrency: string, targetCurrency: string, side: 'buy' | 'sell') {
  const entered = money(trade?.user_entered_amount);
  const amount = money(trade?.amount);
  const total = money(trade?.total);
  const source = side === 'buy'
    ? total?.currency === sourceCurrency ? total : entered?.currency === sourceCurrency ? entered : null
    : entered?.currency === sourceCurrency ? entered : total?.currency === sourceCurrency ? total : null;
  const target = side === 'sell'
    ? total?.currency === targetCurrency ? total : amount?.currency === targetCurrency ? amount : null
    : amount?.currency === targetCurrency ? amount : total?.currency === targetCurrency ? total : null;
  return { source, target };
}

export async function evaluateCoinbaseConvertQuote(request: OrderRequest): Promise<CoinbaseConvertQuoteEvidence | null> {
  if (process.env.CRYPTO_COINBASE_CONVERT_AUCTION_ENABLED?.trim().toLowerCase() === 'false') return null;
  const product = pair(request.symbol);
  if (!product) return null;

  const sourceCurrency = request.side === 'buy' ? product.quote : product.base;
  const targetCurrency = request.side === 'buy' ? product.base : product.quote;
  const requestedSourceAmount = request.side === 'buy' ? request.quantity * request.price : request.quantity;
  if (!(requestedSourceAmount > 0) || !Number.isFinite(requestedSourceAmount)) return null;

  const [payload, feeEvidence] = await Promise.all([
    coinbasePrivateRequest('/api/v3/brokerage/convert/quote', 'POST', {
      body: {
        from_account: sourceCurrency,
        to_account: targetCurrency,
        amount: coinbaseDecimalString(requestedSourceAmount),
      },
    }),
    resolveCexFeeEvidence('coinbase', request.symbol, {
      maxAgeMs: Math.max(5_000, Number(process.env.CRYPTOCRAWL_CEX_FOUR_MODE_FEE_MAX_AGE_MS || 60_000)),
    }).catch(() => null),
  ]);

  const trade = payload?.trade;
  const tradeId = String(trade?.id || '').trim();
  if (!trade || !tradeId || !feeEvidence || feeEvidence.source === 'configured_override') return null;
  const amounts = extractTradeAmounts(trade, sourceCurrency, targetCurrency, request.side);
  if (!amounts.source || !amounts.target) return null;

  const baseQuantity = request.side === 'buy' ? amounts.target.value : amounts.source.value;
  if (!(baseQuantity > 0)) return null;
  const effectivePrice = request.side === 'buy'
    ? amounts.source.value / baseQuantity
    : amounts.target.value / baseQuantity;
  const takerFeeBps = Math.max(0, Number(feeEvidence.takerFeeBps));
  if (!Number.isFinite(effectivePrice) || !(effectivePrice > 0) || !Number.isFinite(takerFeeBps)) return null;
  const fallbackAllInPrice = request.side === 'buy'
    ? request.price * (1 + takerFeeBps / 10_000)
    : request.price * (1 - takerFeeBps / 10_000);
  const measuredBenefitBps = request.side === 'buy'
    ? (fallbackAllInPrice - effectivePrice) / request.price * 10_000
    : (effectivePrice - fallbackAllInPrice) / request.price * 10_000;
  if (!Number.isFinite(measuredBenefitBps) || measuredBenefitBps <= MIN_BENEFIT_BPS) return null;

  const totalFee = feeMoney(trade?.total_fee);
  const observedAt = Date.now();
  return {
    tradeId,
    symbol: request.symbol,
    side: request.side,
    sourceCurrency,
    targetCurrency,
    sourceAmount: amounts.source.value,
    targetAmount: amounts.target.value,
    baseQuantity,
    effectivePrice,
    fallbackAllInPrice,
    measuredBenefitBps,
    totalFeeAmount: totalFee?.value ?? null,
    totalFeeCurrency: totalFee?.currency ?? null,
    observedAt,
    expiresAt: observedAt + QUOTE_TTL_MS,
    status: String(trade?.status || ''),
    provenance: [
      'coinbase_advanced_convert_quote',
      'authenticated_coinbase_taker_fee_reference',
      'convert_effective_price_from_source_target_amounts',
      'future_rebate_precredit:false',
      'synthetic_bps:false',
    ],
  };
}

export async function prepareCoinbaseConvertAuctionAgainstFallback(input: {
  request: OrderRequest;
  fallback: PreparedCexOrderSubmission;
}): Promise<PreparedCexOrderSubmission> {
  const quote = await evaluateCoinbaseConvertQuote(input.request).catch(error => {
    logger.debug('[Coinbase Convert] Quote comparison unavailable; prepared order-book fallback retained', {
      component: 'CoinbaseConvertExecutionAuction',
      symbol: input.request.symbol,
      side: input.request.side,
      error: error instanceof Error ? error.message : String(error),
      orderSubmitted: false,
      executionAuthorityChanged: false,
    });
    return null;
  });
  if (!quote) return input.fallback;

  logger.info('[Coinbase Convert] Measured Convert quote beats authenticated IOC all-in fee surface', {
    component: 'CoinbaseConvertExecutionAuction',
    symbol: quote.symbol,
    side: quote.side,
    measuredBenefitBps: quote.measuredBenefitBps,
    effectivePrice: quote.effectivePrice,
    fallbackAllInPrice: quote.fallbackAllInPrice,
    totalFeeAmount: quote.totalFeeAmount,
    totalFeeCurrency: quote.totalFeeCurrency,
    quoteExpiresAt: quote.expiresAt,
    canonicalPlanAlreadyPositive: true,
    syntheticBps: false,
  });

  return {
    transport: 'rest',
    preparedAt: quote.observedAt,
    dispatch: async (): Promise<CexOrderReceipt> => {
      if (Date.now() > quote.expiresAt) return input.fallback.dispatch();
      const submittedAt = Date.now();
      const payload = await coinbasePrivateRequest(`/api/v3/brokerage/convert/trade/${encodeURIComponent(quote.tradeId)}`, 'POST', {
        body: {
          from_account: quote.sourceCurrency,
          to_account: quote.targetCurrency,
        },
      });
      const trade = payload?.trade;
      const returnedId = String(trade?.id || quote.tradeId).trim();
      if (!returnedId) throw new Error('Coinbase Convert commit returned no trade id after submission');
      const terminal = terminalStatus(trade?.status);
      if (terminal.terminal && !terminal.success) {
        throw new Error(`Coinbase Convert commit reached terminal failure: ${String(trade?.status || 'unknown')}`);
      }
      return {
        venue: 'coinbase',
        orderId: `${CONVERT_PREFIX}${returnedId}`,
        symbol: input.request.symbol,
        side: input.request.side,
        requestedQuantity: input.request.quantity,
        submittedAt,
      };
    },
  };
}

export async function queryCoinbaseConvertSettlement(
  order: CexOrderReceipt,
  finalBalances?: Record<string, string>,
): Promise<NormalizedOrderSettlement | null> {
  const tradeId = convertId(order.orderId);
  if (!tradeId) return null;
  const product = pair(order.symbol);
  if (!product) throw new Error(`Coinbase Convert receipt ${order.orderId} has unsupported symbol ${order.symbol}`);
  const sourceCurrency = order.side === 'buy' ? product.quote : product.base;
  const targetCurrency = order.side === 'buy' ? product.base : product.quote;
  const payload = await coinbasePrivateRequest(`/api/v3/brokerage/convert/trade/${encodeURIComponent(tradeId)}`, 'GET', {
    query: { from_account: sourceCurrency, to_account: targetCurrency },
  });
  const trade = payload?.trade;
  if (!trade) throw new Error(`Coinbase Convert returned no trade state for ${tradeId}`);
  const classification = terminalStatus(trade.status);
  const amounts = extractTradeAmounts(trade, sourceCurrency, targetCurrency, order.side);
  const baseQuantity = amounts.source && amounts.target
    ? order.side === 'buy' ? amounts.target.value : amounts.source.value
    : null;
  const averageFillPrice = amounts.source && amounts.target && baseQuantity && baseQuantity > 0
    ? order.side === 'buy' ? amounts.source.value / baseQuantity : amounts.target.value / baseQuantity
    : null;
  const totalFee = feeMoney(trade?.total_fee);
  return {
    venue: 'coinbase',
    orderId: order.orderId,
    symbol: order.symbol,
    side: order.side,
    status: classification.terminal
      ? classification.success ? 'filled' : 'failed'
      : baseQuantity && baseQuantity > 0 ? 'partially_filled' : 'submitted',
    terminal: classification.terminal,
    requestedQuantity: order.requestedQuantity,
    filledQuantity: classification.success ? baseQuantity : null,
    remainingQuantity: classification.success && baseQuantity !== null
      ? Math.max(0, order.requestedQuantity - baseQuantity)
      : null,
    averageFillPrice,
    fills: classification.success && baseQuantity && averageFillPrice
      ? [{ quantity: baseQuantity, price: averageFillPrice, feeAmount: totalFee?.value ?? null, feeAsset: totalFee?.currency ?? null, timestamp: Date.now(), tradeId }]
      : [],
    feeAmount: totalFee?.value ?? null,
    feeAsset: totalFee?.currency ?? null,
    submittedAt: order.submittedAt,
    terminalAt: classification.terminal ? Date.now() : null,
    finalBalances,
    error: classification.terminal && !classification.success ? String(trade?.cancellation_reason?.message || trade?.status || 'Coinbase Convert failed') : undefined,
  };
}

export function isCoinbaseConvertReceipt(orderId: string): boolean {
  return convertId(orderId) !== null;
}

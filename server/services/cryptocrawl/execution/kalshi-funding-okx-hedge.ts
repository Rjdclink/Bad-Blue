import { createHash } from 'node:crypto';
import { OkxPrivateApiError, okxPrivateRequest } from '../intelligence/cex-private-authority.js';
import { cexDecimalString } from './cex-order-serialization.js';
import { getSpotProductConstraints } from './cex-spot-product-policy.js';
import { getExactOkxOrderAssetDeltas, type ExactCexOrderAssetDeltaEvidence } from './cex-system-capital-settlement-evidence.js';
import { applyExactCexSystemOwnedSettlement } from './cex-system-owned-lot-ledger.js';
import type { CexSystemCapitalSettlementAuthority } from './cex-system-owned-lot-ledger.js';
import type { NormalizedOrderSettlement } from './settlement-types.js';

export interface KalshiFundingOkxOrderState {
  orderId: string;
  filled: boolean;
  terminal: boolean;
  quantity: number;
  row: any;
}

function clientOrderId(lifecycleId: string, leg: string): string {
  return `kfh${createHash('sha256').update(`${lifecycleId}:${leg}`).digest('hex').slice(0, 29)}`.slice(0, 32);
}

function finite(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

async function lookup(symbol: string, lifecycleId: string, leg: string): Promise<KalshiFundingOkxOrderState | null> {
  const constraints = await getSpotProductConstraints('okx', symbol, true);
  const clOrdId = clientOrderId(lifecycleId, leg);
  try {
    const response = await okxPrivateRequest('/api/v5/trade/order', 'GET', {
      instId: constraints.exchangeSymbol,
      clOrdId,
    }, { lane: 'order_read' });
    const row = response.data?.[0];
    if (!row || String(row.clOrdId || '') !== clOrdId || !row.ordId) {
      throw new Error(`OKX Kalshi hedge client-order lookup identity mismatch: ${clOrdId}`);
    }
    return normalizeState(String(row.ordId), row);
  } catch (error) {
    if (error instanceof OkxPrivateApiError && String(error.code) === '51603') return null;
    throw error;
  }
}

function normalizeState(orderId: string, row: any): KalshiFundingOkxOrderState {
  const state = String(row?.state || '').toLowerCase();
  const quantity = finite(row?.accFillSz) ?? 0;
  return {
    orderId,
    filled: state === 'filled' && quantity > 0,
    terminal: state === 'filled' || state === 'canceled' || state === 'mmp_canceled',
    quantity: Math.max(0, quantity),
    row,
  };
}

export async function getKalshiFundingOkxOrderState(symbol: string, orderId: string): Promise<KalshiFundingOkxOrderState> {
  const constraints = await getSpotProductConstraints('okx', symbol, true);
  const response = await okxPrivateRequest('/api/v5/trade/order', 'GET', {
    instId: constraints.exchangeSymbol,
    ordId: orderId,
  }, { lane: 'order_read' });
  const row = response.data?.[0];
  if (!row || String(row.ordId || '') !== orderId) throw new Error(`OKX Kalshi hedge order state unavailable: ${orderId}`);
  return normalizeState(orderId, row);
}

export async function getKalshiFundingOkxOrderByClientId(
  symbol: string,
  lifecycleId: string,
  leg: string,
): Promise<KalshiFundingOkxOrderState | null> {
  return lookup(symbol, lifecycleId, leg);
}

export async function placeOrRecoverKalshiFundingOkxOrder(input: {
  lifecycleId: string;
  leg: string;
  symbol: string;
  side: 'buy' | 'sell';
  quantity: number;
  price?: number;
  ordType?: 'fok' | 'market';
}): Promise<string> {
  if (!(input.quantity > 0) || !Number.isFinite(input.quantity)) throw new Error('Kalshi funding OKX hedge quantity must be positive');
  const constraints = await getSpotProductConstraints('okx', input.symbol, true);
  const clOrdId = clientOrderId(input.lifecycleId, input.leg);
  const prior = await lookup(input.symbol, input.lifecycleId, input.leg);
  if (prior) return prior.orderId;
  try {
    const response = await okxPrivateRequest('/api/v5/trade/order', 'POST', {
      instId: constraints.exchangeSymbol,
      tdMode: 'cash',
      side: input.side,
      ordType: input.ordType || 'fok',
      sz: cexDecimalString(input.quantity),
      clOrdId,
      ...(input.price !== undefined ? { px: cexDecimalString(input.price) } : {}),
    }, { lane: 'order_write' });
    const row = response.data?.[0];
    if (!row || String(row.sCode || '0') !== '0' || !row.ordId) {
      throw new Error(`OKX Kalshi funding hedge rejected: ${String(row?.sMsg || 'missing order id')}`);
    }
    return String(row.ordId);
  } catch (error) {
    const recovered = await lookup(input.symbol, input.lifecycleId, input.leg);
    if (recovered) return recovered.orderId;
    throw error;
  }
}

function normalizedSpotSettlement(input: {
  symbol: string;
  orderId: string;
  side: 'buy' | 'sell';
  row: any;
  submittedAt: number;
}): NormalizedOrderSettlement {
  const filled = finite(input.row?.accFillSz) ?? 0;
  const avgPx = finite(input.row?.avgPx ?? input.row?.fillPx);
  return {
    venue: 'okx',
    orderId: input.orderId,
    symbol: input.symbol,
    side: input.side,
    status: 'filled',
    terminal: true,
    requestedQuantity: filled,
    filledQuantity: filled,
    remainingQuantity: 0,
    averageFillPrice: avgPx !== null && avgPx > 0 ? avgPx : null,
    fills: [],
    feeAmount: null,
    feeAsset: null,
    submittedAt: input.submittedAt,
    terminalAt: Date.now(),
    requestedQuantityDecimal: String(input.row?.sz ?? input.row?.accFillSz ?? ''),
    filledQuantityDecimal: String(input.row?.accFillSz ?? ''),
    averageFillPriceDecimal: String(input.row?.avgPx ?? input.row?.fillPx ?? '') || null,
    feeAmountDecimal: null,
  };
}

export async function applyKalshiFundingOkxSpotOwnership(input: {
  lifecycleId: string;
  opportunityId: string;
  symbol: string;
  orderId: string;
  side: 'buy' | 'sell';
  row: any;
  submittedAt: number;
  authority: CexSystemCapitalSettlementAuthority;
}): Promise<ExactCexOrderAssetDeltaEvidence> {
  const normalized = normalizedSpotSettlement(input);
  const evidence = await getExactOkxOrderAssetDeltas(normalized);
  await applyExactCexSystemOwnedSettlement({
    evidence,
    opportunityId: input.opportunityId,
    strategy: 'kalshi_okx_spot_perp_funding',
    authority: input.authority,
  });
  return evidence;
}

export async function getKalshiFundingOkxSpotFillEconomics(input: {
  symbol: string;
  orderId: string;
  side: 'buy' | 'sell';
  baseAsset: string;
  quoteAsset: string;
}): Promise<{
  quoteCashflow: number;
  feeDeltaQuote: number;
  feeCostQuote: number;
  fills: number;
}> {
  const constraints = await getSpotProductConstraints('okx', input.symbol, true);
  const response = await okxPrivateRequest('/api/v5/trade/fills', 'GET', {
    instType: 'SPOT', instId: constraints.exchangeSymbol, ordId: input.orderId, limit: '100',
  }, { lane: 'account_read' });
  let quoteCashflow = 0;
  let feeDeltaQuote = 0;
  let fills = 0;
  for (const row of response.data || []) {
    if (String(row?.ordId || '') !== input.orderId) continue;
    const size = finite(row?.fillSz);
    const price = finite(row?.fillPx);
    if (size === null || size <= 0 || price === null || price <= 0) continue;
    fills += 1;
    quoteCashflow += (input.side === 'sell' ? 1 : -1) * size * price;
    const fee = finite(row?.fee);
    const feeCcy = String(row?.feeCcy || '').trim().toUpperCase();
    if (fee !== null && fee !== 0) {
      if (feeCcy === input.quoteAsset) feeDeltaQuote += fee;
      else if (feeCcy === input.baseAsset) feeDeltaQuote += fee * price;
      else throw new Error(`OKX Kalshi hedge fee currency ${feeCcy || 'missing'} cannot be valued canonically`);
    }
  }
  if (fills === 0) throw new Error(`OKX Kalshi hedge ${input.orderId} has no authenticated fills`);
  return {
    quoteCashflow,
    feeDeltaQuote,
    // OKX reports charges as negative and rebates as positive.
    feeCostQuote: -feeDeltaQuote,
    fills,
  };
}
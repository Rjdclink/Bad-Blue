import { coinbasePrivateRequest } from '../intelligence/coinbase-advanced-trade-authority.js';
import { getCoinbaseAdvancedProductConstraints } from '../intelligence/coinbase-advanced-market-data.js';
import type { NormalizedOrderSettlement } from './settlement-types.js';
import {
  addExactDecimals,
  compareExactDecimals,
  multiplyExactDecimals,
  negateExactDecimal,
  parseExactDecimal,
  requireNonNegativeExactDecimal,
  requirePositiveExactDecimal,
} from './exact-decimal.js';

export interface ExactCoinbaseFillEvidence {
  tradeId: string;
  quantityDecimal: string;
  priceDecimal: string;
  feeDecimal: string;
  feeAsset: string | null;
  liquidityRole: 'maker' | 'taker' | 'unknown';
}

export interface ExactCoinbaseOrderAssetDeltaEvidence {
  venue: 'coinbase';
  orderId: string;
  symbol: string;
  side: 'buy' | 'sell';
  baseAsset: string;
  quoteAsset: string;
  terminalState: string;
  accumulatedFillDecimal: string;
  fills: ExactCoinbaseFillEvidence[];
  assetDeltas: Record<string, string>;
  settlementReference: string;
  provenance: string[];
}

function canonicalAsset(value: unknown): string {
  const asset = String(value ?? '').trim().toUpperCase();
  if (!asset || !/^[A-Z0-9]+$/.test(asset)) throw new Error(`Invalid Coinbase settlement asset identity: ${String(value ?? '')}`);
  return asset;
}

function exactSignedDecimal(value: unknown, label: string): string {
  const raw = String(value ?? '').trim();
  if (!raw) return '0';
  const parsed = parseExactDecimal(raw, label);
  return parsed.units === 0n ? '0' : raw.replace(/^\+/, '');
}

function addDelta(deltas: Record<string, string>, asset: string, delta: string): void {
  if (compareExactDecimals(delta, '0') === 0) return;
  deltas[asset] = addExactDecimals(deltas[asset] || '0', delta);
  if (compareExactDecimals(deltas[asset], '0') === 0) delete deltas[asset];
}

function terminalCoinbaseState(value: unknown, settled: unknown): string {
  const state = String(value ?? '').trim().toUpperCase();
  if (!['FILLED', 'CANCELLED', 'CANCELED', 'EXPIRED', 'FAILED'].includes(state)) {
    throw new Error(`Coinbase exact settlement evidence requires a terminal order state, received ${state || 'missing'}`);
  }
  if (settled !== true && state === 'FILLED') {
    throw new Error('Coinbase exact settlement requires settled=true for a FILLED order');
  }
  return state.toLowerCase();
}

function liquidityRole(value: unknown): ExactCoinbaseFillEvidence['liquidityRole'] {
  const raw = String(value ?? '').trim().toUpperCase();
  if (raw.includes('MAKER')) return 'maker';
  if (raw.includes('TAKER')) return 'taker';
  return 'unknown';
}

/**
 * Authenticated Coinbase Advanced Trade order/fill evidence converted into exact
 * asset deltas. Account balances never create ownership; only these terminal,
 * trade-id-deduplicated deltas may transform already-system-owned inventory.
 */
export async function getExactCoinbaseOrderAssetDeltas(
  order: NormalizedOrderSettlement,
): Promise<ExactCoinbaseOrderAssetDeltaEvidence> {
  if (order.venue !== 'coinbase') throw new Error(`Exact Coinbase settlement evidence cannot process venue ${order.venue}`);
  if (!order.terminal) throw new Error('Exact Coinbase settlement evidence requires a terminal normalized order');

  const constraints = await getCoinbaseAdvancedProductConstraints(order.symbol, true);
  const [orderPayload, fillsPayload] = await Promise.all([
    coinbasePrivateRequest(`/api/v3/brokerage/orders/historical/${encodeURIComponent(order.orderId)}`, 'GET'),
    coinbasePrivateRequest('/api/v3/brokerage/orders/historical/fills', 'GET', {
      query: { order_ids: [order.orderId], product_ids: [constraints.productId], limit: '100' },
    }),
  ]);

  const row = orderPayload?.order;
  if (!row || String(row?.order_id || '') !== order.orderId) {
    throw new Error(`Coinbase returned no authenticated order state for exact settlement ${order.orderId}`);
  }
  if (String(row?.product_id || '').trim().toUpperCase() !== constraints.productId.toUpperCase()) {
    throw new Error('Coinbase exact settlement product conflicts with canonical product identity');
  }
  const authenticatedSide = String(row?.side || '').trim().toLowerCase();
  if (authenticatedSide !== order.side) throw new Error('Coinbase exact settlement side conflicts with submitted order identity');
  const terminalState = terminalCoinbaseState(row?.status, row?.settled);
  const accumulatedFillDecimal = requireNonNegativeExactDecimal(String(row?.filled_size ?? '0'), 'Coinbase accumulated fill');

  const baseAsset = canonicalAsset(constraints.baseAsset);
  const quoteAsset = canonicalAsset(constraints.quoteAsset);
  const assetDeltas: Record<string, string> = {};
  const fills: ExactCoinbaseFillEvidence[] = [];
  const seen = new Set<string>();
  let summedFill = '0';

  for (const raw of Array.isArray(fillsPayload?.fills) ? fillsPayload.fills : []) {
    if (String(raw?.order_id || '') !== order.orderId) continue;
    if (String(raw?.product_id || '').trim().toUpperCase() !== constraints.productId.toUpperCase()) {
      throw new Error('Coinbase exact fill product conflicts with canonical order identity');
    }
    const tradeId = String(raw?.trade_id || raw?.entry_id || '').trim();
    if (!tradeId) throw new Error('Coinbase exact fill evidence requires trade_id or entry_id');
    if (seen.has(tradeId)) continue;
    seen.add(tradeId);

    const quantityDecimal = requirePositiveExactDecimal(String(raw?.size || ''), `Coinbase fill ${tradeId} quantity`);
    const priceDecimal = requirePositiveExactDecimal(String(raw?.price || ''), `Coinbase fill ${tradeId} price`);
    const commissionDecimal = exactSignedDecimal(raw?.commission, `Coinbase fill ${tradeId} commission`);
    const quoteConsideration = multiplyExactDecimals(quantityDecimal, priceDecimal);

    if (order.side === 'buy') {
      addDelta(assetDeltas, baseAsset, quantityDecimal);
      addDelta(assetDeltas, quoteAsset, negateExactDecimal(quoteConsideration));
    } else {
      addDelta(assetDeltas, baseAsset, negateExactDecimal(quantityDecimal));
      addDelta(assetDeltas, quoteAsset, quoteConsideration);
    }
    // Coinbase Advanced Trade commission is represented in quote currency.
    if (compareExactDecimals(commissionDecimal, '0') !== 0) {
      addDelta(assetDeltas, quoteAsset, negateExactDecimal(commissionDecimal));
    }

    summedFill = addExactDecimals(summedFill, quantityDecimal);
    fills.push({
      tradeId,
      quantityDecimal,
      priceDecimal,
      feeDecimal: commissionDecimal,
      feeAsset: compareExactDecimals(commissionDecimal, '0') === 0 ? null : quoteAsset,
      liquidityRole: liquidityRole(raw?.liquidity_indicator),
    });
  }

  if (compareExactDecimals(summedFill, accumulatedFillDecimal) !== 0) {
    throw new Error(`Coinbase exact fill coverage mismatch for ${order.orderId}: accumulated=${accumulatedFillDecimal} enumerated=${summedFill}`);
  }
  if (compareExactDecimals(accumulatedFillDecimal, '0') > 0 && fills.length === 0) {
    throw new Error(`Coinbase order ${order.orderId} has authenticated fill quantity but no exact fill records`);
  }
  if (order.filledQuantity !== null && order.filledQuantity !== undefined &&
      compareExactDecimals(accumulatedFillDecimal, String(order.filledQuantity)) !== 0) {
    throw new Error('Coinbase authenticated accumulated fill conflicts with normalized settlement');
  }

  return {
    venue: 'coinbase',
    orderId: order.orderId,
    symbol: order.symbol,
    side: order.side,
    baseAsset,
    quoteAsset,
    terminalState,
    accumulatedFillDecimal,
    fills,
    assetDeltas,
    settlementReference: `coinbase:${order.orderId}`,
    provenance: [
      'coinbase_advanced_authenticated_order_state',
      'coinbase_advanced_authenticated_trade_fills',
      'coinbase_trade_id_deduplicated',
      'coinbase_fill_commission:quote_currency',
      'exact_decimal_asset_deltas',
      'enumerated_fill_sum_matches_filled_size',
      'account_balance_does_not_create_system_ownership',
    ],
  };
}

import type { NormalizedOrderSettlement } from './settlement-types.js';
import { getSpotProductConstraints } from './cex-spot-product-policy.js';
import { coinbasePrivateRequest } from '../intelligence/coinbase-advanced-trade-authority.js';
import { krakenPrivateRequest, okxPrivateRequest } from '../intelligence/cex-private-authority.js';
import {
  addExactDecimals,
  compareExactDecimals,
  multiplyExactDecimals,
  negateExactDecimal,
  parseExactDecimal,
  requireNonNegativeExactDecimal,
  requirePositiveExactDecimal,
} from './exact-decimal.js';

export interface ExactCexFillEvidence {
  tradeId: string;
  quantityDecimal: string;
  priceDecimal: string;
  feeDecimal: string;
  feeAsset: string | null;
  liquidityRole: 'maker' | 'taker' | 'unknown';
}

export interface ExactCexOrderAssetDeltaEvidence {
  venue: 'coinbase' | 'okx' | 'kraken';
  orderId: string;
  symbol: string;
  side: 'buy' | 'sell';
  baseAsset: string;
  quoteAsset: string;
  terminalState: string;
  accumulatedFillDecimal: string;
  fills: ExactCexFillEvidence[];
  assetDeltas: Record<string, string>;
  settlementReference: string;
  provenance: string[];
}

const OKX_CONVERT_ORDER_PREFIX = 'okx-convert:';

function canonicalAsset(value: unknown): string {
  let asset = String(value ?? '').trim().toUpperCase();
  if (!asset || !/^[A-Z0-9]+$/.test(asset)) throw new Error(`Invalid CEX settlement asset identity: ${String(value ?? '')}`);
  if ((asset.startsWith('X') || asset.startsWith('Z')) && asset.length === 4) asset = asset.slice(1);
  if (asset === 'XBT') return 'BTC';
  if (asset === 'XDG') return 'DOGE';
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

function okxLiquidityRole(value: unknown): ExactCexFillEvidence['liquidityRole'] {
  const raw = String(value ?? '').trim().toUpperCase();
  return raw === 'M' ? 'maker' : raw === 'T' ? 'taker' : 'unknown';
}

function coinbaseLiquidityRole(value: unknown): ExactCexFillEvidence['liquidityRole'] {
  const raw = String(value ?? '').trim().toUpperCase();
  if (raw.includes('MAKER')) return 'maker';
  if (raw.includes('TAKER')) return 'taker';
  return 'unknown';
}

function terminalOkxState(value: unknown): string {
  const state = String(value ?? '').trim().toLowerCase();
  if (!['filled', 'canceled', 'mmp_canceled'].includes(state)) {
    throw new Error(`OKX exact settlement evidence requires a terminal order state, received ${state || 'missing'}`);
  }
  return state;
}

function terminalKrakenState(value: unknown): string {
  const state = String(value ?? '').trim().toLowerCase();
  if (!['closed', 'canceled', 'cancelled', 'expired'].includes(state)) {
    throw new Error(`Kraken exact settlement evidence requires a terminal order state, received ${state || 'missing'}`);
  }
  return state;
}

function terminalCoinbaseState(row: any): string {
  const state = String(row?.status ?? '').trim().toUpperCase();
  const terminal = row?.settled === true || ['FILLED', 'CANCELLED', 'CANCELED', 'EXPIRED', 'FAILED'].includes(state);
  if (!terminal) throw new Error(`Coinbase exact settlement evidence requires terminal authenticated order state, received ${state || 'missing'}`);
  return state.toLowerCase() || 'settled';
}

async function getExactOkxConvertAssetDeltas(order: NormalizedOrderSettlement): Promise<ExactCexOrderAssetDeltaEvidence> {
  const clTReqId = order.orderId.startsWith(OKX_CONVERT_ORDER_PREFIX)
    ? order.orderId.slice(OKX_CONVERT_ORDER_PREFIX.length)
    : '';
  if (!clTReqId) throw new Error('OKX Convert exact settlement evidence requires a client trade request id');
  if (!order.terminal) throw new Error('OKX Convert exact settlement evidence requires a terminal normalized order');

  const constraints = await getSpotProductConstraints('okx', order.symbol, true);
  const response = await okxPrivateRequest('/api/v5/asset/convert/history', 'GET', { clTReqId, limit: '1' }, { lane: 'account_read' });
  const row = response.data.find(item => String(item?.clTReqId || '') === clTReqId) || response.data[0];
  if (!row) throw new Error(`OKX returned no authenticated Convert history for ${clTReqId}`);
  if (String(row.state || '') !== 'fullyFilled') throw new Error(`OKX Convert exact settlement requires fullyFilled state, received ${String(row.state || 'missing')}`);
  if (String(row.instId || '').trim().toUpperCase() !== constraints.exchangeSymbol.toUpperCase()) throw new Error('OKX Convert instrument conflicts with canonical product identity');
  const authenticatedSide = String(row.side || '').trim().toLowerCase();
  if (authenticatedSide !== order.side) throw new Error('OKX Convert side conflicts with normalized settlement identity');

  const quantityDecimal = requirePositiveExactDecimal(String(row.fillBaseSz || ''), 'OKX Convert base fill');
  const priceDecimal = requirePositiveExactDecimal(String(row.fillPx || ''), 'OKX Convert fill price');
  const quoteConsideration = requirePositiveExactDecimal(String(row.fillQuoteSz || ''), 'OKX Convert quote fill');
  const tradeId = String(row.tradeId || '').trim();
  if (!tradeId) throw new Error('OKX Convert exact settlement requires tradeId');
  if (order.filledQuantity === null || compareExactDecimals(quantityDecimal, String(order.filledQuantity)) !== 0) {
    throw new Error(`OKX Convert authenticated base fill conflicts with normalized settlement for ${clTReqId}`);
  }

  const baseAsset = canonicalAsset(constraints.baseAsset);
  const quoteAsset = canonicalAsset(constraints.quoteAsset);
  const assetDeltas: Record<string, string> = {};
  if (order.side === 'buy') {
    addDelta(assetDeltas, baseAsset, quantityDecimal);
    addDelta(assetDeltas, quoteAsset, negateExactDecimal(quoteConsideration));
  } else {
    addDelta(assetDeltas, baseAsset, negateExactDecimal(quantityDecimal));
    addDelta(assetDeltas, quoteAsset, quoteConsideration);
  }

  return {
    venue: 'okx', orderId: order.orderId, symbol: order.symbol, side: order.side,
    baseAsset, quoteAsset, terminalState: 'fullyfilled', accumulatedFillDecimal: quantityDecimal,
    fills: [{ tradeId, quantityDecimal, priceDecimal, feeDecimal: '0', feeAsset: null, liquidityRole: 'unknown' }],
    assetDeltas, settlementReference: `okx-convert:${tradeId}`,
    provenance: ['okx_authenticated_convert_history','okx_convert_trade_id','exact_decimal_asset_deltas','authenticated_fill_base_and_quote_amounts','convert_all_in_quote_no_separate_fill_fee_field','convert_spread_preserved_in_authenticated_fill_price'],
  };
}

export async function getExactOkxOrderAssetDeltas(order: NormalizedOrderSettlement): Promise<ExactCexOrderAssetDeltaEvidence> {
  if (order.venue !== 'okx') throw new Error(`Exact OKX settlement evidence cannot process venue ${order.venue}`);
  if (!order.terminal) throw new Error('Exact OKX settlement evidence requires a terminal normalized order');
  if (order.orderId.startsWith(OKX_CONVERT_ORDER_PREFIX)) return getExactOkxConvertAssetDeltas(order);

  const constraints = await getSpotProductConstraints('okx', order.symbol, true);
  const [orderResponse, fillsResponse] = await Promise.all([
    okxPrivateRequest('/api/v5/trade/order', 'GET', { instId: constraints.exchangeSymbol, ordId: order.orderId }, { lane: 'account_read' }),
    okxPrivateRequest('/api/v5/trade/fills', 'GET', { instType: 'SPOT', instId: constraints.exchangeSymbol, ordId: order.orderId, limit: '100' }, { lane: 'account_read' }),
  ]);
  const orderRow = orderResponse.data[0];
  if (!orderRow || String(orderRow.ordId || '') !== order.orderId) throw new Error(`OKX returned no authenticated order state for exact settlement ${order.orderId}`);
  if (String(orderRow.instId || '').trim().toUpperCase() !== constraints.exchangeSymbol.toUpperCase()) throw new Error('OKX exact settlement order instrument conflicts with canonical product identity');
  const terminalState = terminalOkxState(orderRow.state);
  const authenticatedSide = String(orderRow.side || '').trim().toLowerCase();
  if (authenticatedSide !== order.side) throw new Error('OKX exact settlement side conflicts with submitted order identity');
  const accumulatedFillDecimal = exactSignedDecimal(orderRow.accFillSz, 'OKX accumulated fill');
  if (compareExactDecimals(accumulatedFillDecimal, '0') < 0) throw new Error('OKX accumulated fill cannot be negative');

  const seen = new Set<string>();
  const fills: ExactCexFillEvidence[] = [];
  let summedFill = '0';
  const assetDeltas: Record<string, string> = {};
  const baseAsset = canonicalAsset(constraints.baseAsset);
  const quoteAsset = canonicalAsset(constraints.quoteAsset);
  for (const raw of fillsResponse.data) {
    if (String(raw?.ordId || '') !== order.orderId) continue;
    if (String(raw?.instId || '').trim().toUpperCase() !== constraints.exchangeSymbol.toUpperCase()) throw new Error('OKX fill instrument conflicts with canonical order identity');
    const tradeId = String(raw?.tradeId || '').trim();
    if (!tradeId) throw new Error('OKX exact fill evidence requires a tradeId');
    if (seen.has(tradeId)) continue;
    seen.add(tradeId);
    const fillSide = String(raw?.side || '').trim().toLowerCase();
    if (fillSide !== order.side) throw new Error(`OKX fill ${tradeId} side conflicts with order side`);
    const quantityDecimal = requirePositiveExactDecimal(String(raw?.fillSz || ''), `OKX fill ${tradeId} quantity`);
    const priceDecimal = requirePositiveExactDecimal(String(raw?.fillPx || ''), `OKX fill ${tradeId} price`);
    const feeDecimal = exactSignedDecimal(raw?.fee, `OKX fill ${tradeId} fee`);
    const feeAsset = compareExactDecimals(feeDecimal, '0') === 0 ? null : canonicalAsset(raw?.feeCcy);
    const quoteConsideration = multiplyExactDecimals(quantityDecimal, priceDecimal);
    if (order.side === 'buy') {
      addDelta(assetDeltas, baseAsset, quantityDecimal);
      addDelta(assetDeltas, quoteAsset, negateExactDecimal(quoteConsideration));
    } else {
      addDelta(assetDeltas, baseAsset, negateExactDecimal(quantityDecimal));
      addDelta(assetDeltas, quoteAsset, quoteConsideration);
    }
    if (feeAsset) addDelta(assetDeltas, feeAsset, feeDecimal);
    summedFill = addExactDecimals(summedFill, quantityDecimal);
    fills.push({ tradeId, quantityDecimal, priceDecimal, feeDecimal, feeAsset, liquidityRole: okxLiquidityRole(raw?.execType) });
  }
  if (compareExactDecimals(summedFill, accumulatedFillDecimal) !== 0) throw new Error(`OKX exact fill coverage mismatch for ${order.orderId}: accumulated=${accumulatedFillDecimal} enumerated=${summedFill}`);
  if (compareExactDecimals(accumulatedFillDecimal, '0') > 0 && fills.length === 0) throw new Error(`OKX order ${order.orderId} has authenticated fill quantity but no exact fill records`);
  return {
    venue: 'okx', orderId: order.orderId, symbol: order.symbol, side: order.side,
    baseAsset, quoteAsset, terminalState, accumulatedFillDecimal, fills, assetDeltas,
    settlementReference: `okx:${order.orderId}`,
    provenance: ['okx_authenticated_order_state','okx_authenticated_trade_fills','trade_id_deduplicated','exact_decimal_asset_deltas','enumerated_fill_sum_matches_accumulated_fill','fee_or_rebate_applied_in_authenticated_fee_currency'],
  };
}

export async function getExactCoinbaseOrderAssetDeltas(order: NormalizedOrderSettlement): Promise<ExactCexOrderAssetDeltaEvidence> {
  if (order.venue !== 'coinbase') throw new Error(`Exact Coinbase settlement evidence cannot process venue ${order.venue}`);
  if (!order.terminal) throw new Error('Exact Coinbase settlement evidence requires a terminal normalized order');

  const constraints = await getSpotProductConstraints('coinbase', order.symbol, true);
  const [orderPayload, fillsPayload] = await Promise.all([
    coinbasePrivateRequest(`/api/v3/brokerage/orders/historical/${encodeURIComponent(order.orderId)}`, 'GET'),
    coinbasePrivateRequest('/api/v3/brokerage/orders/historical/fills', 'GET', { query: { order_ids: [order.orderId], limit: '100' } }),
  ]);
  const orderRow = orderPayload?.order;
  if (!orderRow) throw new Error(`Coinbase returned no authenticated order state for exact settlement ${order.orderId}`);
  const authenticatedOrderId = String(orderRow?.order_id || '').trim();
  if (authenticatedOrderId && authenticatedOrderId !== order.orderId) throw new Error('Coinbase exact settlement order id conflicts with submitted order identity');
  const productId = String(orderRow?.product_id || constraints.exchangeSymbol || '').trim().toUpperCase();
  if (productId !== constraints.exchangeSymbol.toUpperCase()) throw new Error('Coinbase exact settlement product conflicts with canonical product identity');
  const authenticatedSide = String(orderRow?.side || '').trim().toLowerCase();
  if (authenticatedSide && authenticatedSide !== order.side) throw new Error('Coinbase exact settlement side conflicts with submitted order identity');
  const terminalState = terminalCoinbaseState(orderRow);
  const accumulatedFillDecimal = requireNonNegativeExactDecimal(String(orderRow?.filled_size ?? '0'), 'Coinbase accumulated fill');

  const baseAsset = canonicalAsset(constraints.baseAsset);
  const quoteAsset = canonicalAsset(constraints.quoteAsset);
  const fills: ExactCexFillEvidence[] = [];
  const assetDeltas: Record<string, string> = {};
  const seen = new Set<string>();
  let summedFill = '0';
  for (const raw of Array.isArray(fillsPayload?.fills) ? fillsPayload.fills : []) {
    if (String(raw?.order_id || '') !== order.orderId) continue;
    if (String(raw?.product_id || '').trim().toUpperCase() !== constraints.exchangeSymbol.toUpperCase()) throw new Error('Coinbase fill product conflicts with canonical order identity');
    if (raw?.size_in_quote === true) throw new Error(`Coinbase fill for ${order.orderId} is quote-sized; exact base/quote ownership conversion is not authorized for this execution shape`);
    const fillSide = String(raw?.side || raw?.order_side || '').trim().toLowerCase();
    if (fillSide && fillSide !== order.side) throw new Error('Coinbase fill side conflicts with submitted order identity');
    const tradeId = String(raw?.trade_id || raw?.entry_id || '').trim();
    if (!tradeId) throw new Error('Coinbase exact fill evidence requires trade_id or entry_id');
    if (seen.has(tradeId)) continue;
    seen.add(tradeId);
    const quantityDecimal = requirePositiveExactDecimal(String(raw?.size || ''), `Coinbase fill ${tradeId} quantity`);
    const priceDecimal = requirePositiveExactDecimal(String(raw?.price || ''), `Coinbase fill ${tradeId} price`);
    const quoteConsideration = multiplyExactDecimals(quantityDecimal, priceDecimal);
    const feeDecimal = exactSignedDecimal(raw?.commission, `Coinbase fill ${tradeId} commission`);
    if (order.side === 'buy') {
      addDelta(assetDeltas, baseAsset, quantityDecimal);
      addDelta(assetDeltas, quoteAsset, negateExactDecimal(quoteConsideration));
    } else {
      addDelta(assetDeltas, baseAsset, negateExactDecimal(quantityDecimal));
      addDelta(assetDeltas, quoteAsset, quoteConsideration);
    }
    if (compareExactDecimals(feeDecimal, '0') !== 0) addDelta(assetDeltas, quoteAsset, negateExactDecimal(feeDecimal));
    summedFill = addExactDecimals(summedFill, quantityDecimal);
    fills.push({ tradeId, quantityDecimal, priceDecimal, feeDecimal, feeAsset: compareExactDecimals(feeDecimal, '0') !== 0 ? quoteAsset : null, liquidityRole: coinbaseLiquidityRole(raw?.liquidity_indicator) });
  }
  if (compareExactDecimals(summedFill, accumulatedFillDecimal) !== 0) throw new Error(`Coinbase exact fill coverage mismatch for ${order.orderId}: accumulated=${accumulatedFillDecimal} enumerated=${summedFill}`);
  if (compareExactDecimals(accumulatedFillDecimal, '0') > 0 && fills.length === 0) throw new Error(`Coinbase order ${order.orderId} has authenticated fill quantity but no exact fill records`);
  return {
    venue: 'coinbase', orderId: order.orderId, symbol: order.symbol, side: order.side,
    baseAsset, quoteAsset, terminalState, accumulatedFillDecimal, fills, assetDeltas,
    settlementReference: `coinbase:${order.orderId}`,
    provenance: ['coinbase_authenticated_order_state','coinbase_authenticated_advanced_trade_fills','trade_id_deduplicated','exact_decimal_asset_deltas','enumerated_fill_sum_matches_filled_size','commission_debited_in_quote_currency','operator_account_balance_never_creates_ownership'],
  };
}

export async function getExactKrakenOrderAssetDeltas(order: NormalizedOrderSettlement): Promise<ExactCexOrderAssetDeltaEvidence> {
  if (order.venue !== 'kraken') throw new Error(`Exact Kraken settlement evidence cannot process venue ${order.venue}`);
  if (!order.terminal) throw new Error('Exact Kraken settlement evidence requires a terminal normalized order');

  const constraints = await getSpotProductConstraints('kraken', order.symbol, true);
  const orderResult = await krakenPrivateRequest('/0/private/QueryOrders', { txid: order.orderId, trades: 'true' }, { timeoutMs: 12_000 });
  const orderRow = orderResult?.[order.orderId] || orderResult?.[Object.keys(orderResult || {})[0]];
  if (!orderRow) throw new Error(`Kraken returned no authenticated order state for exact settlement ${order.orderId}`);
  const terminalState = terminalKrakenState(orderRow.status);
  const authenticatedSide = String(orderRow?.descr?.type || orderRow?.type || '').trim().toLowerCase();
  if (authenticatedSide && authenticatedSide !== order.side) throw new Error('Kraken exact settlement side conflicts with submitted order identity');
  const accumulatedFillDecimal = requireNonNegativeExactDecimal(String(orderRow.vol_exec ?? '0'), 'Kraken accumulated fill');
  const tradeIds = Array.isArray(orderRow.trades) ? [...new Set(orderRow.trades.map((value: unknown) => String(value || '').trim()).filter(Boolean))] : [];
  const fills: ExactCexFillEvidence[] = [];
  const assetDeltas: Record<string, string> = {};
  const baseAsset = canonicalAsset(constraints.baseAsset);
  const quoteAsset = canonicalAsset(constraints.quoteAsset);
  let summedFill = '0';

  if (tradeIds.length > 0) {
    const tradeRows: Record<string, unknown> = {};
    for (let offset = 0; offset < tradeIds.length; offset += 20) {
      const batch = tradeIds.slice(offset, offset + 20);
      const response = await krakenPrivateRequest('/0/private/QueryTrades', { txid: batch.join(','), trades: 'false' }, { timeoutMs: 12_000 });
      Object.assign(tradeRows, response || {});
    }
    const seen = new Set<string>();
    for (const [tradeTxId, rawValue] of Object.entries(tradeRows)) {
      const raw = rawValue as Record<string, unknown>;
      if (String(raw.ordertxid || '') !== order.orderId) continue;
      const tradeId = String(tradeTxId || '').trim();
      if (!tradeId || seen.has(tradeId)) continue;
      seen.add(tradeId);
      if (constraints.feeLookupKey && String(raw.pair || '').trim() && String(raw.pair).trim() !== constraints.feeLookupKey) throw new Error(`Kraken fill ${tradeId} pair conflicts with canonical product identity`);
      const fillSide = String(raw.type || '').trim().toLowerCase();
      if (fillSide !== order.side) throw new Error(`Kraken fill ${tradeId} side conflicts with order side`);
      const quantityDecimal = requirePositiveExactDecimal(String(raw.vol || ''), `Kraken fill ${tradeId} quantity`);
      const priceDecimal = requirePositiveExactDecimal(String(raw.price || ''), `Kraken fill ${tradeId} price`);
      const quoteConsideration = requirePositiveExactDecimal(String(raw.cost || ''), `Kraken fill ${tradeId} cost`);
      const feeDecimal = exactSignedDecimal(raw.fee, `Kraken fill ${tradeId} fee`);
      if (order.side === 'buy') {
        addDelta(assetDeltas, baseAsset, quantityDecimal);
        addDelta(assetDeltas, quoteAsset, negateExactDecimal(quoteConsideration));
      } else {
        addDelta(assetDeltas, baseAsset, negateExactDecimal(quantityDecimal));
        addDelta(assetDeltas, quoteAsset, quoteConsideration);
      }
      if (compareExactDecimals(feeDecimal, '0') !== 0) addDelta(assetDeltas, quoteAsset, negateExactDecimal(feeDecimal));
      summedFill = addExactDecimals(summedFill, quantityDecimal);
      fills.push({ tradeId, quantityDecimal, priceDecimal, feeDecimal, feeAsset: compareExactDecimals(feeDecimal, '0') !== 0 ? quoteAsset : null, liquidityRole: raw.maker === true ? 'maker' : raw.maker === false ? 'taker' : 'unknown' });
    }
  }
  if (compareExactDecimals(summedFill, accumulatedFillDecimal) !== 0) throw new Error(`Kraken exact fill coverage mismatch for ${order.orderId}: accumulated=${accumulatedFillDecimal} enumerated=${summedFill}`);
  if (compareExactDecimals(accumulatedFillDecimal, '0') > 0 && fills.length === 0) throw new Error(`Kraken order ${order.orderId} has authenticated fill quantity but no exact fill records`);
  return {
    venue: 'kraken', orderId: order.orderId, symbol: order.symbol, side: order.side,
    baseAsset, quoteAsset, terminalState, accumulatedFillDecimal, fills, assetDeltas,
    settlementReference: `kraken:${order.orderId}`,
    provenance: ['kraken_authenticated_order_state','kraken_authenticated_trade_fills','query_trades_batched_at_20','trade_transaction_id_deduplicated','exact_decimal_asset_deltas','enumerated_fill_sum_matches_vol_exec','quote_currency_signed_fee_or_rebate_semantics'],
  };
}

export async function getExactSystemCapitalOrderAssetDeltas(order: NormalizedOrderSettlement): Promise<ExactCexOrderAssetDeltaEvidence> {
  if (order.venue === 'coinbase') return getExactCoinbaseOrderAssetDeltas(order);
  if (order.venue === 'kraken') return getExactKrakenOrderAssetDeltas(order);
  return getExactOkxOrderAssetDeltas(order);
}

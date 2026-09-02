import type { NormalizedOrderSettlement } from './settlement-types.js';
import { getSpotProductConstraints } from './cex-spot-product-policy.js';
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
  venue: 'okx' | 'kraken';
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
  return (() => {
    const parsed = parseExactDecimal(raw, label);
    return parsed.units === 0n ? '0' : raw.replace(/^\+/, '');
  })();
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

export async function getExactOkxOrderAssetDeltas(order: NormalizedOrderSettlement): Promise<ExactCexOrderAssetDeltaEvidence> {
  if (order.venue !== 'okx') throw new Error(`Exact OKX settlement evidence cannot process venue ${order.venue}`);
  if (!order.terminal) throw new Error('Exact OKX settlement evidence requires a terminal normalized order');

  const constraints = await getSpotProductConstraints('okx', order.symbol, true);
  const [orderResponse, fillsResponse] = await Promise.all([
    okxPrivateRequest(
      '/api/v5/trade/order',
      'GET',
      { instId: constraints.exchangeSymbol, ordId: order.orderId },
      { lane: 'account_read' },
    ),
    okxPrivateRequest(
      '/api/v5/trade/fills',
      'GET',
      { instType: 'SPOT', instId: constraints.exchangeSymbol, ordId: order.orderId, limit: '100' },
      { lane: 'account_read' },
    ),
  ]);

  const orderRow = orderResponse.data[0];
  if (!orderRow || String(orderRow.ordId || '') !== order.orderId) {
    throw new Error(`OKX returned no authenticated order state for exact settlement ${order.orderId}`);
  }
  if (String(orderRow.instId || '').trim().toUpperCase() !== constraints.exchangeSymbol.toUpperCase()) {
    throw new Error('OKX exact settlement order instrument conflicts with canonical product identity');
  }
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
    if (String(raw?.instId || '').trim().toUpperCase() !== constraints.exchangeSymbol.toUpperCase()) {
      throw new Error('OKX fill instrument conflicts with canonical order identity');
    }
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
    fills.push({
      tradeId,
      quantityDecimal,
      priceDecimal,
      feeDecimal,
      feeAsset,
      liquidityRole: okxLiquidityRole(raw?.execType),
    });
  }

  if (compareExactDecimals(summedFill, accumulatedFillDecimal) !== 0) {
    throw new Error(`OKX exact fill coverage mismatch for ${order.orderId}: accumulated=${accumulatedFillDecimal} enumerated=${summedFill}`);
  }
  if (compareExactDecimals(accumulatedFillDecimal, '0') > 0 && fills.length === 0) {
    throw new Error(`OKX order ${order.orderId} has authenticated fill quantity but no exact fill records`);
  }

  return {
    venue: 'okx',
    orderId: order.orderId,
    symbol: order.symbol,
    side: order.side,
    baseAsset,
    quoteAsset,
    terminalState,
    accumulatedFillDecimal,
    fills,
    assetDeltas,
    settlementReference: `okx:${order.orderId}`,
    provenance: [
      'okx_authenticated_order_state',
      'okx_authenticated_trade_fills',
      'trade_id_deduplicated',
      'exact_decimal_asset_deltas',
      'enumerated_fill_sum_matches_accumulated_fill',
      'fee_or_rebate_applied_in_authenticated_fee_currency',
    ],
  };
}

export async function getExactKrakenOrderAssetDeltas(order: NormalizedOrderSettlement): Promise<ExactCexOrderAssetDeltaEvidence> {
  if (order.venue !== 'kraken') throw new Error(`Exact Kraken settlement evidence cannot process venue ${order.venue}`);
  if (!order.terminal) throw new Error('Exact Kraken settlement evidence requires a terminal normalized order');

  const constraints = await getSpotProductConstraints('kraken', order.symbol, true);
  const orderResult = await krakenPrivateRequest(
    '/0/private/QueryOrders',
    { txid: order.orderId, trades: 'true' },
    { timeoutMs: 12_000 },
  );
  const orderRow = orderResult?.[order.orderId] || orderResult?.[Object.keys(orderResult || {})[0]];
  if (!orderRow) throw new Error(`Kraken returned no authenticated order state for exact settlement ${order.orderId}`);
  const terminalState = terminalKrakenState(orderRow.status);
  const authenticatedSide = String(orderRow?.descr?.type || orderRow?.type || '').trim().toLowerCase();
  if (authenticatedSide && authenticatedSide !== order.side) {
    throw new Error('Kraken exact settlement side conflicts with submitted order identity');
  }
  const accumulatedFillDecimal = requireNonNegativeExactDecimal(String(orderRow.vol_exec ?? '0'), 'Kraken accumulated fill');
  const tradeIds = Array.isArray(orderRow.trades)
    ? [...new Set(orderRow.trades.map((value: unknown) => String(value || '').trim()).filter(Boolean))]
    : [];

  const fills: ExactCexFillEvidence[] = [];
  const assetDeltas: Record<string, string> = {};
  const baseAsset = canonicalAsset(constraints.baseAsset);
  const quoteAsset = canonicalAsset(constraints.quoteAsset);
  let summedFill = '0';

  if (tradeIds.length > 0) {
    const tradeRows: Record<string, unknown> = {};
    for (let offset = 0; offset < tradeIds.length; offset += 20) {
      const batch = tradeIds.slice(offset, offset + 20);
      const response = await krakenPrivateRequest(
        '/0/private/QueryTrades',
        { txid: batch.join(','), trades: 'false' },
        { timeoutMs: 12_000 },
      );
      Object.assign(tradeRows, response || {});
    }
    const seen = new Set<string>();
    for (const [tradeTxId, rawValue] of Object.entries(tradeRows)) {
      const raw = rawValue as Record<string, unknown>;
      if (String(raw.ordertxid || '') !== order.orderId) continue;
      const tradeId = String(tradeTxId || '').trim();
      if (!tradeId || seen.has(tradeId)) continue;
      seen.add(tradeId);
      if (constraints.feeLookupKey && String(raw.pair || '').trim() && String(raw.pair).trim() !== constraints.feeLookupKey) {
        throw new Error(`Kraken fill ${tradeId} pair conflicts with canonical product identity`);
      }
      const fillSide = String(raw.type || '').trim().toLowerCase();
      if (fillSide !== order.side) throw new Error(`Kraken fill ${tradeId} side conflicts with order side`);

      const quantityDecimal = requirePositiveExactDecimal(String(raw.vol || ''), `Kraken fill ${tradeId} quantity`);
      const priceDecimal = requirePositiveExactDecimal(String(raw.price || ''), `Kraken fill ${tradeId} price`);
      const quoteConsideration = requirePositiveExactDecimal(String(raw.cost || ''), `Kraken fill ${tradeId} cost`);
      const feeDecimal = requireNonNegativeExactDecimal(String(raw.fee ?? '0'), `Kraken fill ${tradeId} fee`);

      if (order.side === 'buy') {
        addDelta(assetDeltas, baseAsset, quantityDecimal);
        addDelta(assetDeltas, quoteAsset, negateExactDecimal(quoteConsideration));
      } else {
        addDelta(assetDeltas, baseAsset, negateExactDecimal(quantityDecimal));
        addDelta(assetDeltas, quoteAsset, quoteConsideration);
      }
      if (compareExactDecimals(feeDecimal, '0') > 0) addDelta(assetDeltas, quoteAsset, negateExactDecimal(feeDecimal));

      summedFill = addExactDecimals(summedFill, quantityDecimal);
      fills.push({
        tradeId,
        quantityDecimal,
        priceDecimal,
        feeDecimal,
        feeAsset: compareExactDecimals(feeDecimal, '0') > 0 ? quoteAsset : null,
        liquidityRole: raw.maker === true ? 'maker' : raw.maker === false ? 'taker' : 'unknown',
      });
    }
  }

  if (compareExactDecimals(summedFill, accumulatedFillDecimal) !== 0) {
    throw new Error(`Kraken exact fill coverage mismatch for ${order.orderId}: accumulated=${accumulatedFillDecimal} enumerated=${summedFill}`);
  }
  if (compareExactDecimals(accumulatedFillDecimal, '0') > 0 && fills.length === 0) {
    throw new Error(`Kraken order ${order.orderId} has authenticated fill quantity but no exact fill records`);
  }

  return {
    venue: 'kraken',
    orderId: order.orderId,
    symbol: order.symbol,
    side: order.side,
    baseAsset,
    quoteAsset,
    terminalState,
    accumulatedFillDecimal,
    fills,
    assetDeltas,
    settlementReference: `kraken:${order.orderId}`,
    provenance: [
      'kraken_authenticated_order_state',
      'kraken_authenticated_trade_fills',
      'query_trades_batched_at_20',
      'trade_transaction_id_deduplicated',
      'exact_decimal_asset_deltas',
      'enumerated_fill_sum_matches_vol_exec',
      'quote_currency_fee_semantics_from_current_kraken_spot_execution_schema',
    ],
  };
}

export async function getExactSystemCapitalOrderAssetDeltas(order: NormalizedOrderSettlement): Promise<ExactCexOrderAssetDeltaEvidence> {
  if (order.venue === 'coinbase') {
    throw new Error('Coinbase is operator-balance evidence only and has no system-capital settlement authority');
  }
  if (order.venue === 'kraken') return getExactKrakenOrderAssetDeltas(order);
  return getExactOkxOrderAssetDeltas(order);
}

import { createHash } from 'node:crypto';
import logger from '../../../logger.js';
import { kalshiAuthenticatedRequest } from '../intelligence/kalshi-authenticated-authority.js';

export type KalshiEventBookSide = 'bid' | 'ask';
export type KalshiEventTimeInForce = 'fill_or_kill' | 'immediate_or_cancel' | 'good_till_canceled';

export interface KalshiEventOrderState {
  orderId: string;
  clientOrderId: string;
  ticker: string;
  bookSide: KalshiEventBookSide;
  price: number;
  initialCount: number;
  fillCount: number;
  remainingCount: number;
  takerFeesUsd: number | null;
  makerFeesUsd: number | null;
  averageFillPrice: number | null;
  status: string;
  terminal: boolean;
  fullyFilled: boolean;
  orderGroupId: string | null;
  createdAt: number | null;
  updatedAt: number | null;
  observedAt: number;
}

export interface KalshiEventFillEvidence {
  fillId: string;
  tradeId: string | null;
  orderId: string;
  ticker: string;
  bookSide: KalshiEventBookSide;
  outcomeSide: 'yes' | 'no' | null;
  contracts: number;
  yesPrice: number;
  noPrice: number;
  feeUsd: number;
  isTaker: boolean;
  createdAt: number;
}

export interface KalshiEventPositionEvidence {
  ticker: string;
  position: number;
  totalTradedUsd: number;
  exposureUsd: number;
  realizedPnlUsd: number;
  feesPaidUsd: number;
  observedAt: number;
}

export interface KalshiEventSettlementEvidence {
  ticker: string;
  eventTicker: string;
  marketResult: 'yes' | 'no' | string;
  yesCount: number;
  noCount: number;
  yesTotalCostUsd: number;
  noTotalCostUsd: number;
  revenueUsd: number;
  settlementFeeUsd: number;
  valueUsd: number | null;
  settledAt: number;
  observedAt: number;
}

export interface KalshiEventQueuePosition {
  orderId: string;
  ticker: string;
  contractsAhead: number;
  observedAt: number;
}

export interface KalshiEventOrderGroup {
  orderGroupId: string;
  subaccount: number;
  exchangeIndex: number;
  contractsLimit: number;
  createdAt: number;
}

function finite(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function nonnegative(value: unknown): number | null {
  const parsed = finite(value);
  return parsed !== null && parsed >= 0 ? parsed : null;
}

function positive(value: unknown): number | null {
  const parsed = finite(value);
  return parsed !== null && parsed > 0 ? parsed : null;
}

function timestamp(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return value < 10_000_000_000 ? Math.trunc(value * 1_000) : Math.trunc(value);
  }
  if (typeof value !== 'string' || !value.trim()) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function fixed(value: number, decimals: number): string {
  if (!Number.isFinite(value) || value < 0) throw new Error('Kalshi event fixed-point value must be finite and non-negative');
  return value.toFixed(decimals).replace(/\.0+$/, '').replace(/(\.\d*?)0+$/, '$1');
}

function bookSide(row: any): KalshiEventBookSide | null {
  const explicit = String(row?.book_side || '').trim().toLowerCase();
  if (explicit === 'bid' || explicit === 'ask') return explicit;
  const outcome = String(row?.outcome_side || row?.side || '').trim().toLowerCase();
  const action = String(row?.action || '').trim().toLowerCase();
  if (outcome === 'yes' && action === 'buy') return 'bid';
  if (outcome === 'yes' && action === 'sell') return 'ask';
  if (outcome === 'no' && action === 'buy') return 'ask';
  if (outcome === 'no' && action === 'sell') return 'bid';
  return null;
}

function orderPrice(row: any, side: KalshiEventBookSide): number | null {
  const direct = positive(row?.price ?? row?.average_fill_price);
  if (direct !== null) return direct;
  const yes = positive(row?.yes_price_dollars);
  if (yes !== null) return yes;
  const no = positive(row?.no_price_dollars);
  if (no !== null) return side === 'ask' ? 1 - no : no;
  return null;
}

function parseOrder(row: any): KalshiEventOrderState | null {
  const orderId = String(row?.order_id || '').trim();
  const clientOrderId = String(row?.client_order_id || '').trim();
  const ticker = String(row?.ticker || row?.market_ticker || '').trim().toUpperCase();
  const side = bookSide(row);
  const price = side ? orderPrice(row, side) : null;
  const fillCount = nonnegative(row?.fill_count_fp ?? row?.fill_count);
  const remainingCount = nonnegative(row?.remaining_count_fp ?? row?.remaining_count);
  const initialCount = nonnegative(row?.initial_count_fp ?? row?.initial_count ?? ((fillCount ?? 0) + (remainingCount ?? 0)));
  if (!orderId || !ticker || !side || price === null || fillCount === null || remainingCount === null || initialCount === null) return null;
  const status = String(row?.status || row?.last_update_reason || '').trim().toLowerCase();
  const terminalStatus = /executed|filled|cancel|expired|rejected|failed/.test(status);
  const restingStatus = /resting|pending|open|live/.test(status);
  const terminal = terminalStatus || (remainingCount === 0 && !restingStatus);
  const fullTolerance = Math.max(1e-8, initialCount * 1e-8);
  return {
    orderId,
    clientOrderId,
    ticker,
    bookSide: side,
    price,
    initialCount,
    fillCount,
    remainingCount,
    takerFeesUsd: nonnegative(row?.taker_fees_dollars),
    makerFeesUsd: nonnegative(row?.maker_fees_dollars),
    averageFillPrice: positive(row?.average_fill_price),
    status,
    terminal,
    fullyFilled: terminal && fillCount + fullTolerance >= initialCount && remainingCount <= fullTolerance,
    orderGroupId: row?.order_group_id ? String(row.order_group_id) : null,
    createdAt: timestamp(row?.created_time ?? row?.ts_ms),
    updatedAt: timestamp(row?.last_update_time ?? row?.ts_ms),
    observedAt: Date.now(),
  };
}

export function kalshiEventClientOrderId(scope: string, leg: string): string {
  const digest = createHash('sha256').update(`cryptocrawl:kalshi:event:${scope}:${leg}`, 'utf8').digest('hex');
  return `cce-${leg.replace(/[^a-z0-9]/gi, '').slice(0, 10)}-${digest.slice(0, 36)}`;
}

async function lookupByClientOrderId(ticker: string, clientOrderId: string): Promise<KalshiEventOrderState | null> {
  let cursor = '';
  const found: KalshiEventOrderState[] = [];
  for (let page = 0; page < 5; page++) {
    const query = new URLSearchParams({ ticker, limit: '1000' });
    if (cursor) query.set('cursor', cursor);
    const payload = await kalshiAuthenticatedRequest<any>(`/trade-api/v2/portfolio/orders?${query.toString()}`);
    for (const row of Array.isArray(payload?.orders) ? payload.orders : []) {
      if (String(row?.client_order_id || '') !== clientOrderId) continue;
      const parsed = parseOrder(row);
      if (parsed) found.push(parsed);
    }
    cursor = String(payload?.cursor || '').trim();
    if (!cursor) break;
  }
  const unique = [...new Map(found.map(row => [row.orderId, row])).values()];
  if (unique.length > 1) throw new Error(`KALSHI_EVENT_CLIENT_ORDER_ID_COLLISION:${clientOrderId}`);
  return unique[0] ?? null;
}

export async function getKalshiEventOrder(orderIdInput: string): Promise<KalshiEventOrderState> {
  const orderId = orderIdInput.trim();
  if (!orderId) throw new Error('Kalshi event order id is required');
  const payload = await kalshiAuthenticatedRequest<any>(`/trade-api/v2/portfolio/orders/${encodeURIComponent(orderId)}`);
  const parsed = parseOrder(payload?.order);
  if (!parsed || parsed.orderId !== orderId) throw new Error(`Kalshi event order ${orderId} state unavailable`);
  return parsed;
}

export async function getKalshiEventExchangeIndex(tickerInput: string): Promise<number> {
  const ticker = tickerInput.trim().toUpperCase();
  if (!ticker) throw new Error('Kalshi event ticker is required for exchange routing');
  const payload = await kalshiAuthenticatedRequest<any>(`/trade-api/v2/markets/${encodeURIComponent(ticker)}`);
  const returnedTicker = String(payload?.market?.ticker || '').trim().toUpperCase();
  const exchangeIndex = Number(payload?.market?.exchange_index);
  if (returnedTicker !== ticker || !Number.isInteger(exchangeIndex) || exchangeIndex < 0) {
    throw new Error(`KALSHI_EVENT_EXCHANGE_INDEX_UNAVAILABLE:${ticker}`);
  }
  return exchangeIndex;
}

export async function placeOrRecoverKalshiEventOrder(input: {
  scope: string;
  leg: string;
  ticker: string;
  side: KalshiEventBookSide;
  contracts: number;
  price: number;
  timeInForce?: KalshiEventTimeInForce;
  postOnly?: boolean;
  reduceOnly?: boolean;
  cancelOrderOnPause?: boolean;
  orderGroupId?: string | null;
  expirationTime?: number | null;
}): Promise<KalshiEventOrderState> {
  const ticker = input.ticker.trim().toUpperCase();
  if (!ticker || !(input.contracts > 0) || !(input.price > 0) || !(input.price < 1)) {
    throw new Error('Kalshi event order inputs are invalid');
  }
  const clientOrderId = kalshiEventClientOrderId(input.scope, input.leg);
  const prior = await lookupByClientOrderId(ticker, clientOrderId);
  if (prior) return prior;

  const timeInForce = input.timeInForce || 'fill_or_kill';
  const body: Record<string, unknown> = {
    ticker,
    client_order_id: clientOrderId,
    side: input.side,
    count: fixed(input.contracts, 2),
    price: fixed(input.price, 4),
    time_in_force: timeInForce,
    self_trade_prevention_type: 'taker_at_cross',
    post_only: input.postOnly === true,
    cancel_order_on_pause: input.cancelOrderOnPause !== false,
    reduce_only: input.reduceOnly === true,
    subaccount: 0,
  };
  if (input.orderGroupId) body.order_group_id = input.orderGroupId;
  if (input.expirationTime !== null && input.expirationTime !== undefined) body.expiration_time = Math.trunc(input.expirationTime);

  try {
    // Current V2 event order routing auto-selects the exchange shard when the
    // ticker is present and exchange_index is omitted. Never pin a live order
    // to shard 0 because Kalshi can move product families between shards.
    const payload = await kalshiAuthenticatedRequest<any>('/trade-api/v2/portfolio/events/orders', { method: 'POST', body });
    const orderId = String(payload?.order_id || '').trim();
    if (!orderId) throw new Error('Kalshi event create response omitted order_id');
    const queried = await getKalshiEventOrder(orderId).catch(() => null);
    if (queried) return queried;
    const fallback = parseOrder({ ...payload, ticker, client_order_id: clientOrderId, book_side: input.side, price: input.price, initial_count: input.contracts });
    if (!fallback) throw new Error('Kalshi event create response could not be normalized');
    return fallback;
  } catch (error) {
    // A write timeout is ambiguous. Never blindly resubmit; recover by the
    // deterministic client id and only throw if the exchange still proves none.
    const recovered = await lookupByClientOrderId(ticker, clientOrderId).catch(() => null);
    if (recovered) return recovered;
    throw error;
  }
}

export async function cancelKalshiEventOrder(orderIdInput: string): Promise<void> {
  const orderId = orderIdInput.trim();
  if (!orderId) return;
  const state = await getKalshiEventOrder(orderId);
  const query = new URLSearchParams({ subaccount: '0', market_ticker: state.ticker });
  // Supplying market_ticker while omitting exchange_index invokes Kalshi's V2
  // auto-routing, so cancel remains valid after exchange-shard migrations.
  await kalshiAuthenticatedRequest(`/trade-api/v2/portfolio/events/orders/${encodeURIComponent(orderId)}?${query.toString()}`, { method: 'DELETE' });
}

export async function getKalshiEventFillsForOrder(input: {
  ticker: string;
  orderId: string;
  minObservedAt?: number;
  maxObservedAt?: number;
}): Promise<KalshiEventFillEvidence[]> {
  const ticker = input.ticker.trim().toUpperCase();
  const orderId = input.orderId.trim();
  if (!ticker || !orderId) return [];
  const minTs = Math.floor(Math.max(0, (input.minObservedAt ?? Date.now() - 24 * 60 * 60_000) - 60_000) / 1_000);
  const maxTs = Math.ceil(Math.max(minTs + 1, (input.maxObservedAt ?? Date.now() + 60_000)) / 1_000);
  let cursor = '';
  const output: KalshiEventFillEvidence[] = [];
  for (let page = 0; page < 8; page++) {
    const query = new URLSearchParams({ ticker, limit: '1000', min_ts: String(minTs), max_ts: String(maxTs) });
    if (cursor) query.set('cursor', cursor);
    const payload = await kalshiAuthenticatedRequest<any>(`/trade-api/v2/portfolio/fills?${query.toString()}`);
    for (const row of Array.isArray(payload?.fills) ? payload.fills : []) {
      if (String(row?.order_id || '') !== orderId) continue;
      const side = bookSide(row);
      const contracts = positive(row?.count_fp ?? row?.count);
      const yesPrice = positive(row?.yes_price_dollars);
      const noPrice = positive(row?.no_price_dollars);
      const feeUsd = nonnegative(row?.fee_cost);
      const createdAt = timestamp(row?.created_time ?? row?.ts);
      if (!side || contracts === null || yesPrice === null || noPrice === null || feeUsd === null || createdAt === null) continue;
      const outcome = String(row?.outcome_side || row?.side || '').toLowerCase();
      output.push({
        fillId: String(row?.fill_id || ''),
        tradeId: row?.trade_id ? String(row.trade_id) : null,
        orderId,
        ticker,
        bookSide: side,
        outcomeSide: outcome === 'yes' || outcome === 'no' ? outcome : null,
        contracts,
        yesPrice,
        noPrice,
        feeUsd,
        isTaker: row?.is_taker === true,
        createdAt,
      });
    }
    cursor = String(payload?.cursor || '').trim();
    if (!cursor) break;
  }
  return output.sort((a, b) => a.createdAt - b.createdAt || a.fillId.localeCompare(b.fillId));
}

export async function requireTerminalKalshiEventFokFill(input: {
  state: KalshiEventOrderState;
  requestedContracts: number;
  minimumObservedAt?: number;
}): Promise<{ state: KalshiEventOrderState; fills: KalshiEventFillEvidence[]; feeUsd: number }> {
  const state = input.state.terminal ? input.state : await getKalshiEventOrder(input.state.orderId);
  const tolerance = Math.max(1e-8, input.requestedContracts * 1e-8);
  if (!state.terminal || state.remainingCount > tolerance || state.fillCount + tolerance < input.requestedContracts) {
    throw new Error('KALSHI_EVENT_FOK_TERMINAL_FULL_FILL_UNPROVEN');
  }
  const fills = await getKalshiEventFillsForOrder({
    ticker: state.ticker,
    orderId: state.orderId,
    minObservedAt: input.minimumObservedAt ?? state.createdAt ?? Date.now() - 60_000,
  });
  const filled = fills.reduce((sum, row) => sum + row.contracts, 0);
  if (fills.length === 0 || filled + tolerance < input.requestedContracts) {
    logger.warn('[KalshiEvent] Terminal event order lacks complete authenticated fill evidence', {
      component: 'KalshiEventOrderAuthority', ticker: state.ticker, orderId: state.orderId,
      requestedContracts: input.requestedContracts, authenticatedFillContracts: filled,
      settlementAuthorityGranted: false, syntheticFillAllowed: false,
    });
    throw new Error('KALSHI_EVENT_AUTHENTICATED_FILLS_INCOMPLETE');
  }
  return { state, fills, feeUsd: fills.reduce((sum, row) => sum + row.feeUsd, 0) };
}

export async function getKalshiEventPosition(tickerInput: string): Promise<KalshiEventPositionEvidence | null> {
  const ticker = tickerInput.trim().toUpperCase();
  if (!ticker) return null;
  const query = new URLSearchParams({ ticker, subaccount: '0', count_filter: 'position,total_traded', limit: '1000' });
  const payload = await kalshiAuthenticatedRequest<any>(`/trade-api/v2/portfolio/positions?${query.toString()}`);
  const row = (Array.isArray(payload?.market_positions) ? payload.market_positions : [])
    .find((item: any) => String(item?.ticker || '').trim().toUpperCase() === ticker);
  if (!row) return null;
  const position = finite(row?.position_fp ?? row?.position);
  const totalTradedUsd = nonnegative(row?.total_traded_dollars);
  const exposureUsd = nonnegative(row?.market_exposure_dollars);
  const realizedPnlUsd = finite(row?.realized_pnl_dollars);
  const feesPaidUsd = nonnegative(row?.fees_paid_dollars);
  if (position === null || totalTradedUsd === null || exposureUsd === null || realizedPnlUsd === null || feesPaidUsd === null) return null;
  return { ticker, position, totalTradedUsd, exposureUsd, realizedPnlUsd, feesPaidUsd, observedAt: Date.now() };
}

export async function getKalshiEventSettlement(tickerInput: string): Promise<KalshiEventSettlementEvidence | null> {
  const ticker = tickerInput.trim().toUpperCase();
  if (!ticker) return null;
  const query = new URLSearchParams({ ticker, subaccount: '0', limit: '1000' });
  const payload = await kalshiAuthenticatedRequest<any>(`/trade-api/v2/portfolio/settlements?${query.toString()}`);
  const row = (Array.isArray(payload?.settlements) ? payload.settlements : [])
    .find((item: any) => String(item?.ticker || '').trim().toUpperCase() === ticker);
  if (!row) return null;
  const yesCount = nonnegative(row?.yes_count_fp ?? row?.yes_count);
  const noCount = nonnegative(row?.no_count_fp ?? row?.no_count);
  const yesTotalCostUsd = nonnegative(row?.yes_total_cost_dollars);
  const noTotalCostUsd = nonnegative(row?.no_total_cost_dollars);
  const fee = nonnegative(row?.fee_cost);
  const settledAt = timestamp(row?.settled_time);
  if (yesCount === null || noCount === null || yesTotalCostUsd === null || noTotalCostUsd === null || fee === null || settledAt === null) return null;
  const revenueRaw = finite(row?.revenue);
  // Historical `revenue` may be integer cents while fixed-point fields are
  // dollars. Prefer the explicit settlement `value` when representable; retain
  // revenue as dollars only after conservative integer-cent normalization.
  const revenueUsd = revenueRaw === null ? 0 : Number.isInteger(revenueRaw) ? revenueRaw / 100 : revenueRaw;
  const valueRaw = finite(row?.value);
  const valueUsd = valueRaw === null ? null : Number.isInteger(valueRaw) ? valueRaw / 100 : valueRaw;
  return {
    ticker,
    eventTicker: String(row?.event_ticker || '').trim().toUpperCase(),
    marketResult: String(row?.market_result || '').trim().toLowerCase(),
    yesCount,
    noCount,
    yesTotalCostUsd,
    noTotalCostUsd,
    revenueUsd,
    settlementFeeUsd: fee,
    valueUsd,
    settledAt,
    observedAt: Date.now(),
  };
}

export async function getKalshiEventQueuePositions(): Promise<KalshiEventQueuePosition[]> {
  const payload = await kalshiAuthenticatedRequest<any>('/trade-api/v2/portfolio/orders/queue_positions');
  const observedAt = Date.now();
  return (Array.isArray(payload?.queue_positions) ? payload.queue_positions : []).flatMap((row: any) => {
    const orderId = String(row?.order_id || '').trim();
    const ticker = String(row?.market_ticker || '').trim().toUpperCase();
    const contractsAhead = nonnegative(row?.queue_position_fp ?? row?.queue_position);
    return orderId && ticker && contractsAhead !== null ? [{ orderId, ticker, contractsAhead, observedAt }] : [];
  });
}

export async function createKalshiEventOrderGroup(contractsLimit: number, tickerInput: string): Promise<KalshiEventOrderGroup> {
  if (!(contractsLimit > 0) || !Number.isFinite(contractsLimit)) throw new Error('Kalshi event order-group limit must be positive');
  const exchangeIndex = await getKalshiEventExchangeIndex(tickerInput);
  const payload = await kalshiAuthenticatedRequest<any>('/trade-api/v2/portfolio/order_groups/create', {
    method: 'POST',
    body: { subaccount: 0, contracts_limit_fp: fixed(contractsLimit, 2), exchange_index: exchangeIndex },
  });
  const orderGroupId = String(payload?.order_group_id || '').trim();
  const returnedExchangeIndex = Number(payload?.exchange_index);
  if (!orderGroupId || returnedExchangeIndex !== exchangeIndex) {
    throw new Error('Kalshi event order-group response omitted identity or returned the wrong exchange shard');
  }
  return { orderGroupId, subaccount: Number(payload?.subaccount || 0), exchangeIndex, contractsLimit, createdAt: Date.now() };
}

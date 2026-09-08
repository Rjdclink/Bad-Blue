import { createHash } from 'node:crypto';
import logger from '../../../logger.js';
import { kalshiAuthenticatedRequest } from '../intelligence/kalshi-authenticated-authority.js';

export type KalshiPerpSide = 'bid' | 'ask';
export type KalshiPerpTimeInForce = 'fill_or_kill' | 'immediate_or_cancel' | 'good_till_canceled';

export interface KalshiPerpOrderState {
  orderId: string;
  clientOrderId: string;
  ticker: string;
  side: KalshiPerpSide;
  price: number;
  filledContracts: number;
  remainingContracts: number;
  terminal: boolean;
  fullyFilled: boolean;
  observedAt: number;
  createdAt: number | null;
  lastUpdateAt: number | null;
  lastUpdateReason: string;
  raw: any;
}

export interface KalshiPerpFillEvidence {
  fillId: string;
  orderId: string;
  ticker: string;
  side: KalshiPerpSide;
  isTaker: boolean;
  contracts: number;
  price: number;
  entryPrice: number;
  feesUsd: number;
  realizedPnlUsd: number;
  createdAt: number;
}

export interface KalshiPerpPositionEvidence {
  ticker: string;
  subaccount: number;
  contracts: number;
  entryPrice: number;
  unrealizedPnlUsd: number;
  feesUsd: number;
  marginUsedUsd: number | null;
  portfolioMargined: boolean;
  observedAt: number;
}

export interface KalshiFundingPaymentEvidence {
  ticker: string;
  fundingTime: number;
  fundingRate: number;
  markPrice: number;
  fundingAmountUsd: number;
  contracts: number;
  subaccount: number | null;
}

function finite(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function positive(value: unknown): number | null {
  const parsed = finite(value);
  return parsed !== null && parsed > 0 ? parsed : null;
}

function nonnegative(value: unknown): number | null {
  const parsed = finite(value);
  return parsed !== null && parsed >= 0 ? parsed : null;
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
  if (!Number.isFinite(value) || value < 0) throw new Error('Kalshi fixed-point value must be finite and non-negative');
  const text = value.toFixed(decimals);
  return text.replace(/\.0+$/, '').replace(/(\.\d*?)0+$/, '$1');
}

export function kalshiFundingClientOrderId(lifecycleId: string, leg: string): string {
  const digest = createHash('sha256').update(`${lifecycleId}:${leg}`, 'utf8').digest('hex');
  // Kalshi accepts caller-provided string IDs. Keep IDs stable, compact and leg-specific.
  return `cc-${leg}-${digest.slice(0, 40)}`;
}

function parseOrder(row: any): KalshiPerpOrderState | null {
  const orderId = String(row?.order_id || '').trim();
  const clientOrderId = String(row?.client_order_id || '').trim();
  const ticker = String(row?.ticker || '').trim().toUpperCase();
  const side = String(row?.side || '').trim().toLowerCase();
  const price = positive(row?.price);
  const filledContracts = nonnegative(row?.fill_count);
  const remainingContracts = nonnegative(row?.remaining_count);
  if (!orderId || !clientOrderId || !ticker || (side !== 'bid' && side !== 'ask') || price === null || filledContracts === null || remainingContracts === null) return null;
  // FOK/IOC terminal truth is remaining_count=0. GTC may remain live with remaining_count>0.
  const terminal = remainingContracts === 0;
  return {
    orderId,
    clientOrderId,
    ticker,
    side,
    price,
    filledContracts,
    remainingContracts,
    terminal,
    fullyFilled: terminal && filledContracts > 0,
    observedAt: Date.now(),
    createdAt: timestamp(row?.created_time),
    lastUpdateAt: timestamp(row?.last_update_time),
    lastUpdateReason: String(row?.last_update_reason || ''),
    raw: row,
  };
}

async function lookupByClientOrderId(ticker: string, clientOrderId: string): Promise<KalshiPerpOrderState | null> {
  let cursor = '';
  for (let page = 0; page < 4; page++) {
    const query = new URLSearchParams({ ticker, limit: '1000', subaccount: '0' });
    if (cursor) query.set('cursor', cursor);
    const payload = await kalshiAuthenticatedRequest<any>(`/trade-api/v2/margin/orders?${query.toString()}`);
    for (const row of Array.isArray(payload?.orders) ? payload.orders : []) {
      if (String(row?.client_order_id || '') !== clientOrderId) continue;
      return parseOrder(row);
    }
    cursor = String(payload?.cursor || '').trim();
    if (!cursor) break;
  }
  return null;
}

export async function getKalshiPerpOrder(orderId: string): Promise<KalshiPerpOrderState> {
  const id = orderId.trim();
  if (!id) throw new Error('Kalshi margin order id is required');
  const payload = await kalshiAuthenticatedRequest<any>(`/trade-api/v2/margin/orders/${encodeURIComponent(id)}`);
  const state = parseOrder(payload?.order);
  if (!state || state.orderId !== id) throw new Error(`Kalshi margin order ${id} state unavailable`);
  return state;
}

export async function placeOrRecoverKalshiPerpOrder(input: {
  lifecycleId: string;
  leg: string;
  ticker: string;
  side: KalshiPerpSide;
  contracts: number;
  price: number;
  timeInForce?: KalshiPerpTimeInForce;
  reduceOnly?: boolean;
  postOnly?: boolean;
  cancelOrderOnPause?: boolean;
}): Promise<KalshiPerpOrderState> {
  const ticker = input.ticker.trim().toUpperCase();
  if (!ticker || !(input.contracts > 0) || !(input.price > 0)) throw new Error('Kalshi margin order inputs are invalid');
  const clientOrderId = kalshiFundingClientOrderId(input.lifecycleId, input.leg);
  const prior = await lookupByClientOrderId(ticker, clientOrderId);
  if (prior) return prior;

  const timeInForce = input.timeInForce || 'fill_or_kill';
  const body = {
    ticker,
    client_order_id: clientOrderId,
    side: input.side,
    count: fixed(input.contracts, 2),
    price: fixed(input.price, 6),
    time_in_force: timeInForce,
    post_only: input.postOnly === true,
    self_trade_prevention_type: 'taker_at_cross',
    cancel_order_on_pause: input.cancelOrderOnPause !== false,
    reduce_only: input.reduceOnly === true,
    subaccount: 0,
  };

  try {
    const payload = await kalshiAuthenticatedRequest<any>('/trade-api/v2/margin/orders', { method: 'POST', body });
    const orderId = String(payload?.order_id || '').trim();
    if (!orderId) throw new Error('Kalshi margin order response omitted order_id');
    const queried = await getKalshiPerpOrder(orderId).catch(() => null);
    if (queried) return queried;
    const fillCount = nonnegative(payload?.fill_count) ?? 0;
    const remainingCount = nonnegative(payload?.remaining_count) ?? 0;
    return {
      orderId,
      clientOrderId,
      ticker,
      side: input.side,
      price: positive(payload?.average_fill_price) ?? input.price,
      filledContracts: fillCount,
      remainingContracts: remainingCount,
      terminal: timeInForce !== 'good_till_canceled' && remainingCount === 0,
      fullyFilled: timeInForce !== 'good_till_canceled' && remainingCount === 0 && fillCount >= input.contracts * (1 - 1e-8),
      observedAt: Date.now(),
      createdAt: null,
      lastUpdateAt: null,
      lastUpdateReason: 'create_response',
      raw: payload,
    };
  } catch (error) {
    // Ambiguous write failures are never blindly retried. Recover by deterministic client ID first.
    const recovered = await lookupByClientOrderId(ticker, clientOrderId).catch(() => null);
    if (recovered) return recovered;
    throw error;
  }
}

export async function cancelKalshiPerpOrder(orderId: string): Promise<void> {
  const id = orderId.trim();
  if (!id) return;
  await kalshiAuthenticatedRequest(`/trade-api/v2/margin/orders/${encodeURIComponent(id)}?subaccount=0`, { method: 'DELETE' });
}

export async function getKalshiPerpFillsForOrder(input: {
  ticker: string;
  orderId: string;
  minObservedAt?: number;
  maxObservedAt?: number;
}): Promise<KalshiPerpFillEvidence[]> {
  const ticker = input.ticker.trim().toUpperCase();
  const orderId = input.orderId.trim();
  if (!ticker || !orderId) return [];
  const minimumSeconds = Math.floor(Math.max(0, (input.minObservedAt ?? Date.now() - 24 * 60 * 60_000) - 60_000) / 1_000);
  const maximumSeconds = Math.ceil(Math.max(minimumSeconds + 1, (input.maxObservedAt ?? Date.now() + 60_000)) / 1_000);
  let cursor = '';
  const output: KalshiPerpFillEvidence[] = [];
  for (let page = 0; page < 8; page++) {
    const query = new URLSearchParams({ subaccount: '0', limit: '1000', min_ts: String(minimumSeconds), max_ts: String(maximumSeconds) });
    if (cursor) query.set('cursor', cursor);
    const payload = await kalshiAuthenticatedRequest<any>(`/trade-api/v2/margin/fills?${query.toString()}`);
    for (const row of Array.isArray(payload?.fills) ? payload.fills : []) {
      if (String(row?.order_id || '') !== orderId || String(row?.ticker || '').trim().toUpperCase() !== ticker) continue;
      const contracts = positive(row?.count);
      const price = positive(row?.price);
      const entryPrice = nonnegative(row?.entry_price);
      const feesUsd = nonnegative(row?.fees);
      const realizedPnlUsd = finite(row?.realized_pnl);
      const createdAt = timestamp(row?.created_time);
      const side = String(row?.side || '').toLowerCase();
      if (contracts === null || price === null || entryPrice === null || feesUsd === null || realizedPnlUsd === null || createdAt === null || (side !== 'bid' && side !== 'ask')) continue;
      output.push({
        fillId: String(row?.fill_id || ''),
        orderId,
        ticker,
        side,
        isTaker: row?.is_taker === true,
        contracts,
        price,
        entryPrice,
        feesUsd,
        realizedPnlUsd,
        createdAt,
      });
    }
    cursor = String(payload?.cursor || '').trim();
    if (!cursor) break;
  }
  return output.sort((a, b) => a.createdAt - b.createdAt || a.fillId.localeCompare(b.fillId));
}

export async function getKalshiPerpPosition(tickerInput: string): Promise<KalshiPerpPositionEvidence | null> {
  const ticker = tickerInput.trim().toUpperCase();
  if (!ticker) return null;
  const query = new URLSearchParams({ subaccount: '0', ticker });
  const payload = await kalshiAuthenticatedRequest<any>(`/trade-api/v2/margin/positions?${query.toString()}`);
  const row = (Array.isArray(payload?.positions) ? payload.positions : [])
    .find((item: any) => String(item?.market_ticker || '').trim().toUpperCase() === ticker && Number(item?.subaccount || 0) === 0);
  if (!row) return null;
  const contracts = finite(row?.position);
  const entryPrice = nonnegative(row?.entry_price);
  const unrealizedPnlUsd = finite(row?.unrealized_pnl);
  const feesUsd = nonnegative(row?.fees);
  if (contracts === null || entryPrice === null || unrealizedPnlUsd === null || feesUsd === null) return null;
  return {
    ticker,
    subaccount: Number(row?.subaccount || 0),
    contracts,
    entryPrice,
    unrealizedPnlUsd,
    feesUsd,
    marginUsedUsd: row?.margin_used === null || row?.margin_used === undefined ? null : nonnegative(row.margin_used),
    portfolioMargined: row?.is_portfolio === true,
    observedAt: Date.now(),
  };
}

function utcDate(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

export async function getKalshiFundingPayments(input: {
  ticker: string;
  openedAt: number;
  closedAt?: number;
}): Promise<KalshiFundingPaymentEvidence[]> {
  const ticker = input.ticker.trim().toUpperCase();
  const closedAt = input.closedAt ?? Date.now();
  const query = new URLSearchParams({ ticker, start_date: utcDate(input.openedAt), end_date: utcDate(closedAt) });
  const payload = await kalshiAuthenticatedRequest<any>(`/trade-api/v2/margin/funding_history?${query.toString()}`);
  return (Array.isArray(payload?.funding_history) ? payload.funding_history : [])
    .flatMap((row: any) => {
      const fundingTime = timestamp(row?.funding_time);
      const fundingRate = finite(row?.funding_rate);
      const markPrice = positive(row?.mark_price);
      const fundingAmountUsd = finite(row?.funding_amount);
      const contracts = finite(row?.quantity);
      const marketTicker = String(row?.market_ticker || '').trim().toUpperCase();
      if (marketTicker !== ticker || fundingTime === null || fundingRate === null || markPrice === null || fundingAmountUsd === null || contracts === null) return [];
      if (fundingTime < input.openedAt - 60_000 || fundingTime > closedAt + 60_000) return [];
      return [{
        ticker,
        fundingTime,
        fundingRate,
        markPrice,
        fundingAmountUsd,
        contracts,
        subaccount: row?.subaccount_number === null || row?.subaccount_number === undefined ? null : Number(row.subaccount_number),
      } satisfies KalshiFundingPaymentEvidence];
    })
    .sort((a, b) => a.fundingTime - b.fundingTime);
}

export function summarizeKalshiPerpFillEconomics(fills: readonly KalshiPerpFillEvidence[]): {
  contracts: number;
  feesUsd: number;
  realizedPnlUsd: number;
  averagePrice: number | null;
  takerFills: number;
  makerFills: number;
} {
  const contracts = fills.reduce((sum, fill) => sum + fill.contracts, 0);
  const notionalWeightedPrice = fills.reduce((sum, fill) => sum + fill.contracts * fill.price, 0);
  return {
    contracts,
    feesUsd: fills.reduce((sum, fill) => sum + fill.feesUsd, 0),
    realizedPnlUsd: fills.reduce((sum, fill) => sum + fill.realizedPnlUsd, 0),
    averagePrice: contracts > 0 ? notionalWeightedPrice / contracts : null,
    takerFills: fills.filter(fill => fill.isTaker).length,
    makerFills: fills.filter(fill => !fill.isTaker).length,
  };
}

export async function requireTerminalKalshiFokFill(input: {
  state: KalshiPerpOrderState;
  requestedContracts: number;
  minimumObservedAt?: number;
}): Promise<{ state: KalshiPerpOrderState; fills: KalshiPerpFillEvidence[] }> {
  const state = input.state.terminal ? input.state : await getKalshiPerpOrder(input.state.orderId);
  if (!state.terminal || state.remainingContracts !== 0 || state.filledContracts < input.requestedContracts * (1 - 1e-8)) {
    throw new Error('KALSHI_FOK_TERMINAL_FULL_FILL_UNPROVEN');
  }
  const fills = await getKalshiPerpFillsForOrder({
    ticker: state.ticker,
    orderId: state.orderId,
    minObservedAt: input.minimumObservedAt ?? state.createdAt ?? Date.now() - 60_000,
  });
  const summed = fills.reduce((sum, fill) => sum + fill.contracts, 0);
  if (fills.length === 0 || summed < input.requestedContracts * (1 - 1e-8)) {
    logger.warn('[KalshiPerps] Terminal order lacks complete authenticated fill evidence', {
      component: 'KalshiPerpsOrderAuthority',
      ticker: state.ticker,
      orderId: state.orderId,
      requestedContracts: input.requestedContracts,
      observedFillContracts: summed,
      settlementAuthorityGranted: false,
    });
    throw new Error('KALSHI_FOK_AUTHENTICATED_FILLS_INCOMPLETE');
  }
  return { state, fills };
}
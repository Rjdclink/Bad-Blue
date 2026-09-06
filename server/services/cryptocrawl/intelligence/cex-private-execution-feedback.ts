import logger from '../../../logger.js';
import { canonicalizeCexSymbol } from '../discovery/symbol-registry.js';

export type PrivateExecutionFeedbackVenue = 'coinbase' | 'kraken' | 'okx';
export type PrivateExecutionLiquidityRole = 'maker' | 'taker' | null;

export interface PrivateExecutionFeedbackEvent {
  venue: PrivateExecutionFeedbackVenue;
  orderId: string;
  symbol: string | null;
  state: string;
  eventType: string;
  observedAt: number;
  eventTimestamp: number | null;
  cumulativeFillQuantity: number | null;
  lastFillQuantity: number | null;
  averageFillPrice: number | null;
  lastFillPrice: number | null;
  feeAmountEconomic: number | null;
  feeAsset: string | null;
  feeUsd: number | null;
  liquidityRole: PrivateExecutionLiquidityRole;
  terminal: boolean;
  sourceEventId: string | null;
  rawSequence: number | null;
  orderEnteredBook: boolean | null;
  settlementAuthority: false;
  economicBpsAuthority: false;
  executionAuthority: false;
}

type TrackedOrder = {
  symbol: string;
  submittedAt: number;
  expiresAt: number;
};

type FeedbackListener = (event: PrivateExecutionFeedbackEvent) => void;

const TRACKED_ORDER_TTL_MS = boundedInt(process.env.CRYPTO_CEX_PRIVATE_EXECUTION_TRACK_MS, 300_000, 30_000, 1_800_000);
const EVENT_CACHE_LIMIT = boundedInt(process.env.CRYPTO_CEX_PRIVATE_EXECUTION_EVENT_LIMIT, 4096, 256, 20_000);
const REVALIDATION_COOLDOWN_MS = boundedInt(process.env.CRYPTO_CEX_PRIVATE_EXECUTION_REVALIDATE_COOLDOWN_MS, 250, 50, 5_000);

const trackedOrders = new Map<string, TrackedOrder>();
const latestByOrder = new Map<string, PrivateExecutionFeedbackEvent>();
const seenEventKeys = new Set<string>();
const listeners = new Set<FeedbackListener>();
const revalidationCooldownUntil = new Map<string, number>();

let observedEvents = 0;
let duplicateEvents = 0;
let revalidationRequests = 0;
let revalidationFailures = 0;
let lastObservedAt: number | null = null;

function boundedInt(raw: unknown, fallback: number, min: number, max: number): number {
  const value = Number(raw);
  return Number.isFinite(value) ? Math.max(min, Math.min(max, Math.trunc(value))) : fallback;
}

function finiteNumber(value: unknown): number | null {
  if (value === null || value === undefined || typeof value === 'boolean') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function timestampMs(value: unknown): number | null {
  const parsed = finiteNumber(value);
  if (parsed !== null && parsed > 0) return parsed < 10_000_000_000 ? Math.round(parsed * 1000) : Math.round(parsed);
  if (typeof value === 'string' && value.trim()) {
    const date = Date.parse(value);
    if (Number.isFinite(date)) return date;
  }
  return null;
}

function orderKey(venue: PrivateExecutionFeedbackVenue, orderId: string): string {
  return `${venue}:${orderId}`;
}

function prune(now = Date.now()): void {
  for (const [key, value] of trackedOrders) {
    if (value.expiresAt <= now) trackedOrders.delete(key);
  }
  if (latestByOrder.size > EVENT_CACHE_LIMIT) {
    const oldest = [...latestByOrder.entries()]
      .sort((left, right) => left[1].observedAt - right[1].observedAt)
      .slice(0, latestByOrder.size - EVENT_CACHE_LIMIT);
    oldest.forEach(([key]) => latestByOrder.delete(key));
  }
  while (seenEventKeys.size > EVENT_CACHE_LIMIT) {
    const first = seenEventKeys.values().next().value as string | undefined;
    if (!first) break;
    seenEventKeys.delete(first);
  }
}

function canonicalEventSymbol(raw: unknown): string | null {
  if (typeof raw !== 'string' || !raw.trim()) return null;
  const normalized = raw.trim().toUpperCase().replace(/^XBT(?=([/_:\-]|USD|USDT|USDC))/, 'BTC');
  return canonicalizeCexSymbol(normalized)?.symbol || null;
}

function trackedSymbol(venue: PrivateExecutionFeedbackVenue, orderId: string): string | null {
  const tracked = trackedOrders.get(orderKey(venue, orderId));
  if (!tracked || tracked.expiresAt <= Date.now()) return null;
  return tracked.symbol;
}

function isTracked(venue: PrivateExecutionFeedbackVenue, orderId: string): boolean {
  return trackedSymbol(venue, orderId) !== null;
}

function rememberEventKey(key: string): boolean {
  if (seenEventKeys.has(key)) {
    duplicateEvents += 1;
    return false;
  }
  seenEventKeys.add(key);
  prune();
  return true;
}

function materiallyUseful(event: PrivateExecutionFeedbackEvent): boolean {
  if (event.terminal) return true;
  if ((event.cumulativeFillQuantity || 0) > 0 || (event.lastFillQuantity || 0) > 0) return true;
  if (event.venue === 'kraken') {
    return ['trade', 'amended', 'restated', 'canceled', 'expired', 'filled'].includes(event.eventType);
  }
  if (event.venue === 'coinbase') {
    return ['open', 'filled', 'cancelled', 'canceled', 'expired', 'failed'].includes(event.state)
      || event.orderEnteredBook === true;
  }
  if (event.state === 'partially_filled') return true;
  // Since the 2026 OKX post-only/RPI state change, a pushed `live` state means
  // the order actually entered the book. That is useful queue/resting evidence,
  // but remains scheduling evidence rather than settlement or BPS authority.
  return event.orderEnteredBook === true;
}

function scheduleExactSymbolRevalidation(event: PrivateExecutionFeedbackEvent): void {
  const symbol = event.symbol;
  if (!symbol || !materiallyUseful(event)) return;
  const now = Date.now();
  if ((revalidationCooldownUntil.get(symbol) || 0) > now) return;
  revalidationCooldownUntil.set(symbol, now + REVALIDATION_COOLDOWN_MS);
  revalidationRequests += 1;

  void import('../discovery/opportunity-graph.js')
    .then(({ measuredOpportunityGraph }) => measuredOpportunityGraph.revalidateSymbols([symbol]))
    .then(cycle => {
      logger.info('[BPS Private Execution] Authenticated execution-state event triggered exact-symbol revalidation', {
        component: 'CexPrivateExecutionFeedback',
        venue: event.venue,
        orderId: event.orderId,
        symbol,
        state: event.state,
        eventType: event.eventType,
        cumulativeFillQuantity: event.cumulativeFillQuantity,
        lastFillQuantity: event.lastFillQuantity,
        liquidityRole: event.liquidityRole,
        feeAmountEconomic: event.feeAmountEconomic,
        feeAsset: event.feeAsset,
        cycleId: cycle.cycleId,
        deterministicPositive: cycle.deterministicPositive,
        eligibleCandidates: cycle.eligibleCandidates,
        economicBpsAuthority: false,
        executionAuthority: false,
        settlementAuthority: false,
      });
    })
    .catch(error => {
      revalidationFailures += 1;
      logger.debug('[BPS Private Execution] Exact-symbol revalidation degraded without affecting execution', {
        component: 'CexPrivateExecutionFeedback',
        venue: event.venue,
        orderId: event.orderId,
        symbol,
        state: event.state,
        error: error instanceof Error ? error.message : String(error),
        economicBpsAuthority: false,
        executionAuthority: false,
        settlementAuthority: false,
      });
    });
}

function publish(event: PrivateExecutionFeedbackEvent): void {
  observedEvents += 1;
  lastObservedAt = event.observedAt;
  latestByOrder.set(orderKey(event.venue, event.orderId), event);
  for (const listener of listeners) {
    try {
      listener(event);
    } catch {
      // Read-only observers may not interfere with order transport or settlement.
    }
  }
  scheduleExactSymbolRevalidation(event);
}

export function trackSubmittedPrivateCexOrder(input: {
  venue: string;
  orderId: string;
  symbol: string;
  submittedAt: number;
}): void {
  if (input.venue !== 'coinbase' && input.venue !== 'kraken' && input.venue !== 'okx') return;
  const venue: PrivateExecutionFeedbackVenue = input.venue;
  const orderId = input.orderId.trim();
  const symbol = canonicalizeCexSymbol(input.symbol)?.symbol || input.symbol.trim().toUpperCase();
  if (!orderId || !symbol) return;
  trackedOrders.set(orderKey(venue, orderId), {
    symbol,
    submittedAt: input.submittedAt,
    expiresAt: Math.max(Date.now(), input.submittedAt) + TRACKED_ORDER_TTL_MS,
  });
  prune();
  if (venue === 'coinbase') {
    // Coinbase order submission remains REST-authoritative. The separate user
    // WebSocket is started only after this process has a concrete submitted order
    // and is strictly read-only execution-state feedback.
    void import('./coinbase-private-execution-feedback.js')
      .then(({ ensureCoinbasePrivateExecutionFeedback }) => ensureCoinbasePrivateExecutionFeedback())
      .catch(() => undefined);
  }
}

function coinbaseEvent(
  row: Record<string, any>,
  sequence: number | null,
  envelopeTimestamp: unknown,
  envelopeEventType: string,
): PrivateExecutionFeedbackEvent | null {
  const orderId = String(row.order_id || '').trim();
  if (!orderId || !isTracked('coinbase', orderId)) return null;
  const state = String(row.status || '').trim().toLowerCase();
  const cumulativeFillQuantity = finiteNumber(row.cumulative_quantity);
  const averageFillPrice = finiteNumber(row.avg_price);
  const totalFees = finiteNumber(row.total_fees);
  const productId = String(row.product_id || '').trim().toUpperCase();
  const quoteAsset = productId.includes('-') ? productId.split('-')[1] || null : null;
  const eventTimestamp = timestampMs(row.last_fill_time || row.end_time || row.creation_time || envelopeTimestamp);
  const terminal = ['filled', 'cancelled', 'canceled', 'expired', 'failed'].includes(state);
  const sourceEventId = String(row.client_order_id || '').trim() || null;
  const dedupe = `coinbase:${orderId}:${state}:${cumulativeFillQuantity ?? ''}:${totalFees ?? ''}:${sequence ?? eventTimestamp ?? ''}`;
  if (!rememberEventKey(dedupe)) return null;
  return {
    venue: 'coinbase',
    orderId,
    symbol: trackedSymbol('coinbase', orderId) || canonicalEventSymbol(productId),
    state,
    eventType: envelopeEventType || state || 'status',
    observedAt: Date.now(),
    eventTimestamp,
    cumulativeFillQuantity,
    lastFillQuantity: null,
    averageFillPrice,
    lastFillPrice: null,
    feeAmountEconomic: totalFees,
    feeAsset: quoteAsset,
    // Only literal USD fees are normalized to USD here. Stablecoin par is never
    // assumed by this advisory feedback layer.
    feeUsd: quoteAsset === 'USD' ? totalFees : null,
    liquidityRole: row.post_only === true ? 'maker' : null,
    terminal,
    sourceEventId,
    rawSequence: sequence,
    orderEnteredBook: state === 'open' ? true : null,
    settlementAuthority: false,
    economicBpsAuthority: false,
    executionAuthority: false,
  };
}

function krakenEvent(row: Record<string, any>, sequence: number | null): PrivateExecutionFeedbackEvent | null {
  const orderId = String(row.order_id || '').trim();
  if (!orderId) return null;
  const eventType = String(row.exec_type || row.order_status || 'status').toLowerCase();
  const state = String(row.order_status || eventType).toLowerCase();
  const tradeId = row.trade_id === undefined || row.trade_id === null ? null : String(row.trade_id);
  const execId = row.exec_id === undefined || row.exec_id === null ? null : String(row.exec_id);
  const eventTimestamp = timestampMs(row.timestamp);
  const cumulativeFillQuantity = finiteNumber(row.cum_qty);
  const lastFillQuantity = finiteNumber(row.last_qty);
  const averageFillPrice = finiteNumber(row.avg_price);
  const lastFillPrice = finiteNumber(row.last_price);
  const fees = Array.isArray(row.fees) ? row.fees : [];
  const feeAmounts = fees.map((fee: any) => finiteNumber(fee?.qty));
  const feeUsdValues = fees.map((fee: any) => finiteNumber(fee?.fee_usd_equiv));
  const feeAmount = fees.length > 0 && feeAmounts.every((value: number | null) => value !== null)
    ? feeAmounts.reduce((sum: number, value: number | null) => sum + value!, 0)
    : null;
  const feeUsd = fees.length > 0 && feeUsdValues.every((value: number | null) => value !== null)
    ? feeUsdValues.reduce((sum: number, value: number | null) => sum + value!, 0)
    : null;
  const feeAsset = fees.length > 0 && fees.every((fee: any) => String(fee?.asset || '') === String(fees[0]?.asset || ''))
    ? String(fees[0]?.asset || '') || null
    : null;
  const liquidityRole: PrivateExecutionLiquidityRole = row.liquidity_ind === 'm' ? 'maker' : row.liquidity_ind === 't' ? 'taker' : null;
  const sourceEventId = execId || tradeId || null;
  const dedupe = `kraken:${orderId}:${eventType}:${sourceEventId || eventTimestamp || ''}:${cumulativeFillQuantity ?? ''}`;
  if (!rememberEventKey(dedupe)) return null;
  return {
    venue: 'kraken',
    orderId,
    symbol: trackedSymbol('kraken', orderId) || canonicalEventSymbol(row.symbol),
    state,
    eventType,
    observedAt: Date.now(),
    eventTimestamp,
    cumulativeFillQuantity,
    lastFillQuantity,
    averageFillPrice,
    lastFillPrice,
    feeAmountEconomic: feeAmount,
    feeAsset,
    feeUsd,
    liquidityRole,
    terminal: ['filled', 'canceled', 'expired'].includes(state) || ['filled', 'canceled', 'expired'].includes(eventType),
    sourceEventId,
    rawSequence: sequence,
    orderEnteredBook: eventType === 'new' ? true : null,
    settlementAuthority: false,
    economicBpsAuthority: false,
    executionAuthority: false,
  };
}

function okxEvent(row: Record<string, any>): PrivateExecutionFeedbackEvent | null {
  const orderId = String(row.ordId || '').trim();
  if (!orderId) return null;
  const state = String(row.state || '').toLowerCase();
  const eventType = String(row.execType || state || 'status').toLowerCase();
  const tradeId = String(row.tradeId || '').trim();
  const reqId = String(row.reqId || '').trim();
  const eventTimestamp = timestampMs(row.fillTime || row.uTime);
  const terminal = ['filled', 'canceled', 'mmp_canceled'].includes(state);
  const dedupe = tradeId
    ? `okx:trade:${String(row.instId || '')}:${tradeId}`
    : terminal ? `okx:terminal:${orderId}:${state}`
      : reqId ? `okx:req:${reqId}`
        : `okx:${orderId}:${state}:${String(row.accFillSz || '')}:${String(row.uTime || '')}`;
  if (!rememberEventKey(dedupe)) return null;
  const rawFee = finiteNumber(row.fillFee);
  const liquidityRole: PrivateExecutionLiquidityRole = row.execType === 'M' ? 'maker' : row.execType === 'T' ? 'taker' : null;
  const orderType = String(row.ordType || '').toLowerCase();
  return {
    venue: 'okx',
    orderId,
    symbol: trackedSymbol('okx', orderId) || canonicalEventSymbol(row.instId),
    state,
    eventType,
    observedAt: Date.now(),
    eventTimestamp,
    cumulativeFillQuantity: finiteNumber(row.accFillSz),
    lastFillQuantity: finiteNumber(row.fillSz),
    averageFillPrice: finiteNumber(row.avgPx),
    lastFillPrice: finiteNumber(row.fillPx),
    // OKX order-channel fee sign is venue-native: negative=fee, positive=rebate.
    // Canonical economic convention is the inverse: positive=cost, negative=credit.
    feeAmountEconomic: rawFee === null ? null : -rawFee,
    feeAsset: typeof row.fillFeeCcy === 'string' && row.fillFeeCcy ? row.fillFeeCcy : null,
    feeUsd: null,
    liquidityRole,
    terminal,
    sourceEventId: tradeId || reqId || null,
    rawSequence: null,
    orderEnteredBook: state === 'live' && ['post_only', 'rpi'].includes(orderType) ? true : null,
    settlementAuthority: false,
    economicBpsAuthority: false,
    executionAuthority: false,
  };
}

/**
 * Consume authenticated private WebSocket execution/order-state frames. Returning
 * true tells a shared transport/listener that the frame was an asynchronous state
 * update rather than a request acknowledgement. These observations may wake
 * revalidation/settlement work, but never finalize P/L or mutate canonical BPS.
 */
export function consumePrivateCexExecutionFrame(
  venue: PrivateExecutionFeedbackVenue,
  payload: Record<string, any>,
): boolean {
  if (venue === 'coinbase') {
    if (payload.channel !== 'user' || !Array.isArray(payload.events)) return false;
    const sequence = finiteNumber(payload.sequence_num);
    for (const envelope of payload.events) {
      if (!envelope || typeof envelope !== 'object') continue;
      const eventType = String(envelope.type || 'update').toLowerCase();
      for (const raw of Array.isArray(envelope.orders) ? envelope.orders : []) {
        if (!raw || typeof raw !== 'object') continue;
        const event = coinbaseEvent(raw as Record<string, any>, sequence, payload.timestamp, eventType);
        if (event) publish(event);
      }
    }
    return true;
  }

  if (venue === 'kraken') {
    if (payload.channel !== 'executions' || !Array.isArray(payload.data)) return false;
    const sequence = finiteNumber(payload.sequence);
    for (const raw of payload.data) {
      if (!raw || typeof raw !== 'object') continue;
      const event = krakenEvent(raw as Record<string, any>, sequence);
      if (event) publish(event);
    }
    return true;
  }

  if (payload?.arg?.channel !== 'orders' || !Array.isArray(payload.data)) return false;
  for (const raw of payload.data) {
    if (!raw || typeof raw !== 'object') continue;
    const event = okxEvent(raw as Record<string, any>);
    if (event) publish(event);
  }
  return true;
}

export function getPrivateCexExecutionFeedback(
  venue: PrivateExecutionFeedbackVenue,
  orderId: string,
): PrivateExecutionFeedbackEvent | null {
  return latestByOrder.get(orderKey(venue, orderId)) || null;
}

export function subscribePrivateCexExecutionFeedback(listener: FeedbackListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function waitForPrivateCexExecutionFeedback(input: {
  venue: PrivateExecutionFeedbackVenue;
  orderId: string;
  afterObservedAt: number;
  timeoutMs: number;
}): Promise<PrivateExecutionFeedbackEvent | null> {
  const current = getPrivateCexExecutionFeedback(input.venue, input.orderId);
  if (current && current.observedAt > input.afterObservedAt) return Promise.resolve(current);
  const timeoutMs = Math.max(0, Math.trunc(input.timeoutMs));
  if (timeoutMs === 0) return Promise.resolve(null);
  return new Promise(resolve => {
    let settled = false;
    let timer: NodeJS.Timeout | null = null;
    let unsubscribe: () => void = () => undefined;
    const finish = (event: PrivateExecutionFeedbackEvent | null) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      unsubscribe();
      resolve(event);
    };
    unsubscribe = subscribePrivateCexExecutionFeedback(event => {
      if (event.venue === input.venue && event.orderId === input.orderId && event.observedAt > input.afterObservedAt) finish(event);
    });
    timer = setTimeout(() => finish(null), timeoutMs);
    timer.unref?.();
  });
}

export function getPrivateCexExecutionFeedbackSnapshot() {
  prune();
  return {
    observedAt: Date.now(),
    trackedOrders: trackedOrders.size,
    retainedLatestEvents: latestByOrder.size,
    observedEvents,
    duplicateEvents,
    revalidationRequests,
    revalidationFailures,
    lastObservedAt,
    venues: ['coinbase', 'kraken', 'okx'] as const,
    settlementAuthority: false as const,
    economicBpsAuthority: false as const,
    executionAuthority: false as const,
    purpose: 'authenticated_private_execution_state_for_bps_revalidation_and_settlement_wakeup' as const,
  };
}

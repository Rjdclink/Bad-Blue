import logger from '../../../logger.js';
import { getSpotProductConstraints } from '../execution/cex-spot-product-policy.js';
import { krakenPrivateRequest } from './cex-private-authority.js';

export interface KrakenL3QueueEvidence {
  symbol: string;
  exchangeSymbol: string;
  orderId: string;
  side: 'buy' | 'sell';
  restingPrice: number;
  observedAt: number;
  depth: 10;
  ownOrderVisible: boolean;
  samePriceOrdersAhead: number | null;
  samePriceQuantityAhead: number | null;
  ownQueueTimestamp: number | null;
  reason: 'exact_order_visible' | 'own_order_not_visible_in_bounded_depth' | 'malformed_l3_payload';
  authority: 'kraken_l3_queue_advisory_only';
  economicBpsAuthority: false;
  executionAuthority: false;
}

type NormalizedL3Order = {
  price: number;
  quantity: number;
  orderId: string;
  timestamp: number | null;
  index: number;
};

const KRAKEN_L3_DEPTH = 10 as const;

function finite(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function timestampMs(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const numeric = Number(value);
  if (Number.isFinite(numeric)) {
    if (numeric > 10_000_000_000) return numeric;
    if (numeric > 0) return numeric * 1_000;
  }
  const parsed = Date.parse(String(value));
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeEntry(raw: any, index: number): NormalizedL3Order | null {
  if (Array.isArray(raw)) {
    const price = finite(raw[0]);
    const quantity = finite(raw[1]);
    const timestamp = timestampMs(raw[2]);
    const orderId = String(raw[3] ?? raw[4] ?? '').trim();
    if (!(price && price > 0) || !(quantity !== null && quantity >= 0) || !orderId) return null;
    return { price, quantity, timestamp, orderId, index };
  }

  if (!raw || typeof raw !== 'object') return null;
  const price = finite(raw.price ?? raw.px ?? raw.limit_price);
  const quantity = finite(raw.qty ?? raw.quantity ?? raw.volume ?? raw.order_qty);
  const orderId = String(raw.order_id ?? raw.orderId ?? raw.txid ?? raw.id ?? '').trim();
  const timestamp = timestampMs(raw.timestamp ?? raw.time ?? raw.order_timestamp ?? raw.queue_timestamp);
  if (!(price && price > 0) || !(quantity !== null && quantity >= 0) || !orderId) return null;
  return { price, quantity, timestamp, orderId, index };
}

function samePrice(left: number, right: number): boolean {
  const tolerance = Math.max(1e-12, Math.abs(right) * 1e-10);
  return Math.abs(left - right) <= tolerance;
}

function isAhead(candidate: NormalizedL3Order, own: NormalizedL3Order): boolean {
  if (!samePrice(candidate.price, own.price) || candidate.orderId === own.orderId) return false;
  if (candidate.timestamp !== null && own.timestamp !== null) {
    if (candidate.timestamp < own.timestamp) return true;
    if (candidate.timestamp > own.timestamp) return false;
  }
  return candidate.index < own.index;
}

/**
 * Bounded authenticated L3 snapshot used only to measure the queue in front of
 * one already-resting Kraken maker order. Absence from depth=10 is deliberately
 * UNKNOWN rather than zero queue-ahead. This function cannot admit execution or
 * create canonical BPS; it supplies exact current queue evidence to the existing
 * maker tick/queue optimizer.
 */
export async function getKrakenL3QueueEvidence(input: {
  symbol: string;
  orderId: string;
  side: 'buy' | 'sell';
  restingPrice: number;
}): Promise<KrakenL3QueueEvidence> {
  const observedAt = Date.now();
  const constraints = await getSpotProductConstraints('kraken', input.symbol, true);
  const result = await krakenPrivateRequest(
    '/0/private/Level3',
    { pair: constraints.exchangeSymbol, depth: KRAKEN_L3_DEPTH },
    { encoding: 'json', timeoutMs: Math.max(1_000, Math.min(6_000, Number(process.env.CRYPTO_KRAKEN_L3_TIMEOUT_MS || 3_500))) },
  );

  const rawSide = input.side === 'buy' ? result?.bids : result?.asks;
  if (!Array.isArray(rawSide)) {
    return {
      symbol: input.symbol,
      exchangeSymbol: constraints.exchangeSymbol,
      orderId: input.orderId,
      side: input.side,
      restingPrice: input.restingPrice,
      observedAt,
      depth: KRAKEN_L3_DEPTH,
      ownOrderVisible: false,
      samePriceOrdersAhead: null,
      samePriceQuantityAhead: null,
      ownQueueTimestamp: null,
      reason: 'malformed_l3_payload',
      authority: 'kraken_l3_queue_advisory_only',
      economicBpsAuthority: false,
      executionAuthority: false,
    };
  }

  const orders = rawSide
    .map((entry: any, index: number) => normalizeEntry(entry, index))
    .filter((entry: NormalizedL3Order | null): entry is NormalizedL3Order => entry !== null);
  const own = orders.find(order => order.orderId === input.orderId && samePrice(order.price, input.restingPrice));
  if (!own) {
    return {
      symbol: input.symbol,
      exchangeSymbol: constraints.exchangeSymbol,
      orderId: input.orderId,
      side: input.side,
      restingPrice: input.restingPrice,
      observedAt,
      depth: KRAKEN_L3_DEPTH,
      ownOrderVisible: false,
      samePriceOrdersAhead: null,
      samePriceQuantityAhead: null,
      ownQueueTimestamp: null,
      reason: 'own_order_not_visible_in_bounded_depth',
      authority: 'kraken_l3_queue_advisory_only',
      economicBpsAuthority: false,
      executionAuthority: false,
    };
  }

  const ahead = orders.filter(order => isAhead(order, own));
  const evidence: KrakenL3QueueEvidence = {
    symbol: input.symbol,
    exchangeSymbol: constraints.exchangeSymbol,
    orderId: input.orderId,
    side: input.side,
    restingPrice: input.restingPrice,
    observedAt,
    depth: KRAKEN_L3_DEPTH,
    ownOrderVisible: true,
    samePriceOrdersAhead: ahead.length,
    samePriceQuantityAhead: ahead.reduce((sum, order) => sum + order.quantity, 0),
    ownQueueTimestamp: own.timestamp,
    reason: 'exact_order_visible',
    authority: 'kraken_l3_queue_advisory_only',
    economicBpsAuthority: false,
    executionAuthority: false,
  };
  logger.debug('[KrakenL3] Exact resting-order queue evidence measured', {
    component: 'KrakenL3QueueIntelligence',
    symbol: evidence.symbol,
    orderId: evidence.orderId,
    side: evidence.side,
    depth: evidence.depth,
    samePriceOrdersAhead: evidence.samePriceOrdersAhead,
    samePriceQuantityAhead: evidence.samePriceQuantityAhead,
    authority: evidence.authority,
    economicBpsAuthority: false,
    executionAuthority: false,
  });
  return evidence;
}

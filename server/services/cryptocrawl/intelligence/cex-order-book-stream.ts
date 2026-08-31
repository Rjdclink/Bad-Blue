import WebSocket from 'ws';
import logger from '../../../logger.js';
import {
  canonicalCoinbaseSymbol,
  resolveCoinbaseAdvancedProductId,
} from './coinbase-advanced-market-data.js';
import { getSpotProductConstraints } from '../execution/cex-spot-product-policy.js';

export type CexStreamVenue = 'coinbase' | 'kraken' | 'okx';

export interface StreamOrderBookLevel {
  price: number;
  quantity: number;
}

export interface StreamOrderBookQuote {
  venue: CexStreamVenue;
  symbol: string;
  bid: number;
  ask: number;
  timestamp: number;
  depth: {
    bids: StreamOrderBookLevel[];
    asks: StreamOrderBookLevel[];
    observedAt: number;
    source: CexStreamVenue;
  };
  sequence: number | null;
}

export interface CexOrderBookStreamStats {
  activeStreams: number;
  activeConnections: number;
  snapshotsApplied: number;
  deltasApplied: number;
  deltasQueued: number;
  staleDeltasRejected: number;
  sequenceGaps: number;
  staleResets: number;
  connectionsOpened: number;
  reconnects: number;
  connectionErrors: number;
}

interface ParsedBookMessage {
  kind: 'snapshot' | 'delta';
  bids: StreamOrderBookLevel[];
  asks: StreamOrderBookLevel[];
  sequence: number | null;
  previousSequence: number | null;
  observedAt: number;
}

interface ParsedVenueMessage {
  externalSymbol: string;
  message: ParsedBookMessage;
}

interface StreamIdentity {
  canonicalSymbol: string;
  externalSymbol: string;
}

interface SymbolStreamState {
  venue: CexStreamVenue;
  symbol: string;
  externalSymbol: string;
  book: SequencedOrderBook;
}

interface VenueConnectionState {
  venue: CexStreamVenue;
  socket: WebSocket | null;
  symbols: Map<string, string>;
  canonicalByExternal: Map<string, string>;
  reconnectTimer: NodeJS.Timeout | null;
  reconnectAttempts: number;
  stopped: boolean;
}

const MAX_LEVELS = 50;
const MAX_PENDING_DELTAS = 256;
const DEFAULT_STALE_MS = 7_500;
const DEFAULT_RECONNECT_DELAY_MS = 1_000;

function configuredWebSocket(name: string): string | null {
  const value = process.env[name]?.trim();
  return value && /^wss:\/\//i.test(value) ? value : null;
}

export function getCoinbaseAdvancedPublicWebSocketEndpoint(): string {
  return configuredWebSocket('COINBASE_ADVANCED_PUBLIC_WS_URL') || 'wss://advanced-trade-ws.coinbase.com';
}

/**
 * Public OKX observation must stay on the same regional surface as authenticated
 * execution. The global endpoint remains correct for non-US accounts, while US
 * execution is paired with wsus.okx.com. Operators may explicitly override the
 * endpoint only with a wss:// URL.
 */
export function getOkxPublicWebSocketEndpoint(): string {
  const explicit = configuredWebSocket('OKX_PUBLIC_WS_URL');
  if (explicit) return explicit;
  const restBase = (process.env.OKX_API_BASE_URL || 'https://us.okx.com').trim().toLowerCase();
  if (restBase.includes('us.okx.com')) return 'wss://wsus.okx.com:8443/ws/v5/public';
  return 'wss://ws.okx.com:8443/ws/v5/public';
}

function canonicalAsset(value: unknown): string | null {
  let asset = String(value ?? '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (!asset) return null;
  if (asset === 'XBT') asset = 'BTC';
  if (asset === 'XDG') asset = 'DOGE';
  return asset;
}

function canonicalCompactSymbol(value: unknown): string | null {
  const raw = String(value ?? '').trim().toUpperCase();
  if (!raw) return null;
  const delimited = raw.split(/[\/_:\-]/).filter(Boolean);
  if (delimited.length === 2) {
    const base = canonicalAsset(delimited[0]);
    const quote = canonicalAsset(delimited[1]);
    return base && quote ? `${base}${quote}` : null;
  }
  let compact = raw.replace(/[^A-Z0-9]/g, '');
  if (!compact) return null;
  if (compact.startsWith('XBT')) compact = `BTC${compact.slice(3)}`;
  if (compact.startsWith('XDG')) compact = `DOGE${compact.slice(3)}`;
  return compact;
}

function externalKey(value: unknown): string {
  return String(value ?? '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
}

async function resolveStreamIdentity(venue: CexStreamVenue, symbolInput: string): Promise<StreamIdentity> {
  if (venue === 'coinbase') {
    const productId = await resolveCoinbaseAdvancedProductId(symbolInput);
    return {
      canonicalSymbol: canonicalCoinbaseSymbol(productId),
      externalSymbol: productId,
    };
  }

  const constraints = await getSpotProductConstraints(venue, symbolInput);
  return {
    canonicalSymbol: constraints.symbol,
    // Kraken WebSocket v2 uses canonical BASE/QUOTE notation rather than the
    // legacy REST altname. OKX uses the exact regional instId from its catalog.
    externalSymbol: venue === 'kraken'
      ? `${constraints.baseAsset}/${constraints.quoteAsset}`
      : constraints.exchangeSymbol,
  };
}

function finiteNumber(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function nonNegativeNumber(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function nonNegativeInteger(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

function observedAt(value: unknown, fallback = Date.now()): number {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) return value;
  if (typeof value === 'string') {
    const numeric = Number(value);
    if (Number.isFinite(numeric) && numeric > 0) return numeric;
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  return fallback;
}

function normalizeLevels(raw: unknown, allowZeroQuantity = false): StreamOrderBookLevel[] {
  if (!Array.isArray(raw)) return [];
  return raw.map(level => {
    if (Array.isArray(level)) {
      return {
        price: finiteNumber(level[0]),
        quantity: allowZeroQuantity ? nonNegativeNumber(level[1]) : finiteNumber(level[1]),
      };
    }
    if (level && typeof level === 'object') {
      const row = level as Record<string, unknown>;
      return {
        price: finiteNumber(row.price ?? row.price_level),
        quantity: allowZeroQuantity
          ? nonNegativeNumber(row.qty ?? row.quantity ?? row.size ?? row.new_quantity)
          : finiteNumber(row.qty ?? row.quantity ?? row.size ?? row.new_quantity),
      };
    }
    return { price: null, quantity: null };
  }).filter((level): level is StreamOrderBookLevel => level.price !== null && level.quantity !== null);
}

function parseCoinbase(message: Record<string, unknown>): ParsedVenueMessage[] {
  if (message.channel !== 'l2_data' || !Array.isArray(message.events)) return [];
  const fallbackObservedAt = observedAt(message.timestamp);
  const output: ParsedVenueMessage[] = [];
  for (const rawEvent of message.events) {
    if (!rawEvent || typeof rawEvent !== 'object') continue;
    const event = rawEvent as Record<string, unknown>;
    const externalSymbol = String(event.product_id ?? '').trim().toUpperCase();
    const kind = event.type === 'snapshot' ? 'snapshot' : event.type === 'update' ? 'delta' : null;
    if (!externalSymbol || !kind || !Array.isArray(event.updates)) continue;
    const bids: StreamOrderBookLevel[] = [];
    const asks: StreamOrderBookLevel[] = [];
    let eventObservedAt = fallbackObservedAt;
    for (const rawUpdate of event.updates) {
      if (!rawUpdate || typeof rawUpdate !== 'object') continue;
      const update = rawUpdate as Record<string, unknown>;
      const price = finiteNumber(update.price_level);
      const quantity = nonNegativeNumber(update.new_quantity);
      if (price === null || quantity === null) continue;
      eventObservedAt = Math.max(eventObservedAt, observedAt(update.event_time, fallbackObservedAt));
      const side = String(update.side ?? '').trim().toLowerCase();
      if (side === 'bid' || side === 'buy') bids.push({ price, quantity });
      else if (side === 'offer' || side === 'ask' || side === 'sell') asks.push({ price, quantity });
    }
    output.push({
      externalSymbol,
      message: {
        kind,
        bids,
        asks,
        // Advanced Trade level2 guarantees ordered delivery. sequence_num is a
        // channel envelope sequence and can cover multiple products, so it is
        // retained out of per-product gap authority to avoid false resets.
        sequence: null,
        previousSequence: null,
        observedAt: eventObservedAt,
      },
    });
  }
  return output;
}

function parseKraken(message: Record<string, unknown>): ParsedVenueMessage[] {
  if (message.channel !== 'book' || !Array.isArray(message.data)) return [];
  const kind = message.type === 'snapshot' ? 'snapshot' : message.type === 'update' ? 'delta' : null;
  if (!kind) return [];
  return message.data.flatMap(rawRow => {
    if (!rawRow || typeof rawRow !== 'object') return [];
    const row = rawRow as Record<string, unknown>;
    const externalSymbol = String(row.symbol ?? '').trim().toUpperCase();
    if (!externalSymbol) return [];
    return [{
      externalSymbol,
      message: {
        kind,
        bids: normalizeLevels(row.bids, kind === 'delta'),
        asks: normalizeLevels(row.asks, kind === 'delta'),
        sequence: null,
        previousSequence: null,
        observedAt: observedAt(row.timestamp),
      },
    }];
  });
}

function parseOkx(message: Record<string, unknown>): ParsedVenueMessage[] {
  const arg = message.arg && typeof message.arg === 'object' ? message.arg as Record<string, unknown> : null;
  if (!arg || arg.channel !== 'books' || !Array.isArray(message.data)) return [];
  const kind = message.action === 'snapshot' ? 'snapshot' : message.action === 'update' ? 'delta' : null;
  const externalSymbol = String(arg.instId ?? '').trim().toUpperCase();
  if (!kind || !externalSymbol) return [];
  return message.data.flatMap(rawRow => {
    if (!rawRow || typeof rawRow !== 'object') return [];
    const row = rawRow as Record<string, unknown>;
    return [{
      externalSymbol,
      message: {
        kind,
        bids: normalizeLevels(row.bids, kind === 'delta'),
        asks: normalizeLevels(row.asks, kind === 'delta'),
        sequence: nonNegativeInteger(row.seqId),
        previousSequence: nonNegativeInteger(row.prevSeqId),
        observedAt: observedAt(row.ts),
      },
    }];
  });
}

function parseMessages(venue: CexStreamVenue, message: Record<string, unknown>): ParsedVenueMessage[] {
  if (venue === 'coinbase') return parseCoinbase(message);
  if (venue === 'kraken') return parseKraken(message);
  return parseOkx(message);
}

export class SequencedOrderBook {
  private readonly bids = new Map<string, StreamOrderBookLevel>();
  private readonly asks = new Map<string, StreamOrderBookLevel>();
  private readonly pendingDeltas: ParsedBookMessage[] = [];
  private initialized = false;
  private lastSequence: number | null = null;
  private lastUpdateAt = 0;

  apply(message: ParsedBookMessage): 'applied' | 'queued' | 'gap' | 'stale' {
    if (message.kind === 'snapshot') {
      this.bids.clear();
      this.asks.clear();
      this.applyLevels(this.bids, message.bids);
      this.applyLevels(this.asks, message.asks);
      this.initialized = true;
      this.lastSequence = message.sequence;
      this.lastUpdateAt = message.observedAt;
      const queued = this.pendingDeltas.splice(0);
      for (const delta of queued) {
        const result = this.applyDelta(delta);
        if (result === 'gap') return result;
      }
      return 'applied';
    }

    if (!this.initialized) {
      if (this.pendingDeltas.length >= MAX_PENDING_DELTAS) this.pendingDeltas.shift();
      this.pendingDeltas.push(message);
      return 'queued';
    }
    return this.applyDelta(message);
  }

  reset(): void {
    this.bids.clear();
    this.asks.clear();
    this.pendingDeltas.length = 0;
    this.initialized = false;
    this.lastSequence = null;
    this.lastUpdateAt = 0;
  }

  isFresh(maxAgeMs: number, now = Date.now()): boolean {
    return this.initialized && this.lastUpdateAt > 0 && now - this.lastUpdateAt <= maxAgeMs;
  }

  isStale(maxAgeMs: number, now = Date.now()): boolean {
    return this.initialized && this.lastUpdateAt > 0 && now - this.lastUpdateAt > maxAgeMs;
  }

  getQuote(venue: CexStreamVenue, symbol: string): StreamOrderBookQuote | null {
    if (!this.initialized) return null;
    const bids = [...this.bids.values()].sort((left, right) => right.price - left.price).slice(0, MAX_LEVELS);
    const asks = [...this.asks.values()].sort((left, right) => left.price - right.price).slice(0, MAX_LEVELS);
    const bid = bids[0]?.price;
    const ask = asks[0]?.price;
    if (!Number.isFinite(bid) || !Number.isFinite(ask) || bid <= 0 || ask <= 0 || ask < bid) return null;
    return {
      venue,
      symbol,
      bid,
      ask,
      timestamp: this.lastUpdateAt,
      sequence: this.lastSequence,
      depth: { bids, asks, observedAt: this.lastUpdateAt, source: venue },
    };
  }

  private applyDelta(message: ParsedBookMessage): 'applied' | 'gap' | 'stale' {
    if (message.sequence !== null && this.lastSequence !== null) {
      if (message.previousSequence !== null && message.previousSequence !== this.lastSequence) return 'gap';
      if (message.sequence <= this.lastSequence) return 'stale';
    }
    this.applyLevels(this.bids, message.bids);
    this.applyLevels(this.asks, message.asks);
    this.lastSequence = message.sequence ?? this.lastSequence;
    this.lastUpdateAt = message.observedAt;
    return 'applied';
  }

  private applyLevels(target: Map<string, StreamOrderBookLevel>, levels: StreamOrderBookLevel[]): void {
    for (const level of levels) {
      const key = String(level.price);
      if (level.quantity <= 0) target.delete(key);
      else target.set(key, level);
    }
  }
}

class CexOrderBookStreamManager {
  private readonly streams = new Map<string, SymbolStreamState>();
  private readonly connections = new Map<CexStreamVenue, VenueConnectionState>();
  private readonly identityInFlight = new Map<string, Promise<StreamIdentity>>();
  private readonly stats: Omit<CexOrderBookStreamStats, 'activeStreams' | 'activeConnections'> = {
    snapshotsApplied: 0,
    deltasApplied: 0,
    deltasQueued: 0,
    staleDeltasRejected: 0,
    sequenceGaps: 0,
    staleResets: 0,
    connectionsOpened: 0,
    reconnects: 0,
    connectionErrors: 0,
  };

  async getQuote(venue: CexStreamVenue, symbolInput: string, maxAgeMs = this.staleMs()): Promise<StreamOrderBookQuote | null> {
    if (!this.enabled()) return null;
    const requestedCanonical = canonicalCompactSymbol(symbolInput);
    if (!requestedCanonical) return null;

    let state = this.streams.get(`${venue}:${requestedCanonical}`);
    if (!state) {
      const identityKey = `${venue}:${requestedCanonical}`;
      let pending = this.identityInFlight.get(identityKey);
      if (!pending) {
        pending = resolveStreamIdentity(venue, symbolInput).finally(() => this.identityInFlight.delete(identityKey));
        this.identityInFlight.set(identityKey, pending);
      }
      const identity = await pending.catch(() => null);
      if (!identity) return null;
      state = this.ensureStream(venue, identity);
    }

    if (state.book.isStale(maxAgeMs)) {
      this.stats.staleResets += 1;
      state.book.reset();
      this.refreshSubscription(venue, state.symbol);
      return null;
    }
    if (!state.book.isFresh(maxAgeMs)) return null;
    return state.book.getQuote(venue, state.symbol);
  }

  stop(): void {
    for (const connection of this.connections.values()) {
      connection.stopped = true;
      if (connection.reconnectTimer) clearTimeout(connection.reconnectTimer);
      connection.socket?.close();
    }
    this.connections.clear();
    this.streams.clear();
    this.identityInFlight.clear();
  }

  getStats(): Readonly<CexOrderBookStreamStats> {
    return {
      activeStreams: this.streams.size,
      activeConnections: [...this.connections.values()].filter(connection => connection.socket?.readyState === WebSocket.OPEN).length,
      ...this.stats,
    };
  }

  private ensureStream(venue: CexStreamVenue, identity: StreamIdentity): SymbolStreamState {
    const key = `${venue}:${identity.canonicalSymbol}`;
    const existing = this.streams.get(key);
    if (existing) return existing;

    const state: SymbolStreamState = {
      venue,
      symbol: identity.canonicalSymbol,
      externalSymbol: identity.externalSymbol,
      book: new SequencedOrderBook(),
    };
    this.streams.set(key, state);
    const connection = this.ensureConnection(venue);
    connection.symbols.set(identity.canonicalSymbol, identity.externalSymbol);
    connection.canonicalByExternal.set(externalKey(identity.externalSymbol), identity.canonicalSymbol);
    if (connection.socket?.readyState === WebSocket.OPEN) {
      this.send(connection.socket, this.subscription(venue, [identity.externalSymbol]), venue, 'subscribe');
    }
    return state;
  }

  private ensureConnection(venue: CexStreamVenue): VenueConnectionState {
    const existing = this.connections.get(venue);
    if (existing) return existing;
    const connection: VenueConnectionState = {
      venue,
      socket: null,
      symbols: new Map<string, string>(),
      canonicalByExternal: new Map<string, string>(),
      reconnectTimer: null,
      reconnectAttempts: 0,
      stopped: false,
    };
    this.connections.set(venue, connection);
    this.connect(connection);
    return connection;
  }

  private connect(connection: VenueConnectionState): void {
    if (connection.stopped) return;
    const endpoint = connection.venue === 'coinbase'
      ? getCoinbaseAdvancedPublicWebSocketEndpoint()
      : connection.venue === 'kraken'
        ? 'wss://ws.kraken.com/v2'
        : getOkxPublicWebSocketEndpoint();
    const socket = new WebSocket(endpoint);
    connection.socket = socket;

    socket.once('open', () => {
      this.stats.connectionsOpened += 1;
      if (connection.reconnectAttempts > 0) this.stats.reconnects += 1;
      connection.reconnectAttempts = 0;
      logger.info('[CexOrderBookStream] venue market-data stream connected', {
        component: 'CexOrderBookStream',
        venue: connection.venue,
        endpoint,
        productIdentityAuthority: 'live_exchange_product_catalog',
        quoteCurrencyAllowlistUsed: false,
        coinbaseAdvancedTrade: connection.venue === 'coinbase',
        regionalExecutionAlignment: connection.venue === 'okx' ? 'rest_base_to_public_ws_region' : 'native_venue_endpoint',
      });
      const externalSymbols = [...connection.symbols.values()];
      if (externalSymbols.length > 0) {
        this.send(socket, this.subscription(connection.venue, externalSymbols), connection.venue, 'subscribe');
        if (connection.venue === 'coinbase') {
          this.send(socket, { type: 'subscribe', channel: 'heartbeats' }, connection.venue, 'heartbeat_subscribe');
        }
      }
    });

    socket.on('message', data => {
      try {
        const payload = JSON.parse(data.toString()) as Record<string, unknown>;
        for (const parsed of parseMessages(connection.venue, payload)) {
          const canonical = connection.canonicalByExternal.get(externalKey(parsed.externalSymbol))
            || canonicalCompactSymbol(parsed.externalSymbol);
          if (!canonical) continue;
          const state = this.streams.get(`${connection.venue}:${canonical}`);
          if (!state) continue;
          const result = state.book.apply(parsed.message);
          if (parsed.message.kind === 'snapshot') this.stats.snapshotsApplied += 1;
          else if (result === 'applied') this.stats.deltasApplied += 1;
          else if (result === 'queued') this.stats.deltasQueued += 1;
          else if (result === 'stale') this.stats.staleDeltasRejected += 1;
          if (result === 'gap') {
            this.stats.sequenceGaps += 1;
            state.book.reset();
            this.refreshSubscription(connection.venue, canonical);
          }
        }
      } catch (error) {
        logger.debug('[CexOrderBookStream] ignored invalid message', {
          venue: connection.venue,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    });

    socket.once('error', error => {
      this.stats.connectionErrors += 1;
      logger.debug('[CexOrderBookStream] websocket error', {
        venue: connection.venue,
        endpoint,
        error: error.message,
      });
    });

    socket.once('close', () => {
      if (connection.socket === socket) connection.socket = null;
      this.scheduleReconnect(connection);
    });
  }

  private refreshSubscription(venue: CexStreamVenue, canonicalSymbol: string): void {
    const connection = this.connections.get(venue);
    const socket = connection?.socket;
    const externalSymbol = connection?.symbols.get(canonicalSymbol);
    if (!connection || !socket || !externalSymbol || socket.readyState !== WebSocket.OPEN) return;
    this.send(socket, this.unsubscription(venue, [externalSymbol]), venue, 'unsubscribe');
    this.send(socket, this.subscription(venue, [externalSymbol]), venue, 'subscribe');
  }

  private scheduleReconnect(connection: VenueConnectionState): void {
    if (connection.stopped || connection.reconnectTimer) return;
    connection.reconnectAttempts += 1;
    const delay = Math.min(30_000, DEFAULT_RECONNECT_DELAY_MS * 2 ** Math.min(connection.reconnectAttempts - 1, 5));
    connection.reconnectTimer = setTimeout(() => {
      connection.reconnectTimer = null;
      this.connect(connection);
    }, delay);
    connection.reconnectTimer.unref?.();
  }

  private subscription(venue: CexStreamVenue, externalSymbols: string[]): Record<string, unknown> {
    if (venue === 'coinbase') {
      return { type: 'subscribe', product_ids: externalSymbols, channel: 'level2' };
    }
    if (venue === 'kraken') {
      return { method: 'subscribe', params: { channel: 'book', symbol: externalSymbols, depth: 25, snapshot: true } };
    }
    return { op: 'subscribe', args: externalSymbols.map(instId => ({ channel: 'books', instId })) };
  }

  private unsubscription(venue: CexStreamVenue, externalSymbols: string[]): Record<string, unknown> {
    if (venue === 'coinbase') {
      return { type: 'unsubscribe', product_ids: externalSymbols, channel: 'level2' };
    }
    if (venue === 'kraken') {
      return { method: 'unsubscribe', params: { channel: 'book', symbol: externalSymbols, depth: 25 } };
    }
    return { op: 'unsubscribe', args: externalSymbols.map(instId => ({ channel: 'books', instId })) };
  }

  private send(socket: WebSocket, payload: Record<string, unknown>, venue: CexStreamVenue, operation: string): void {
    try {
      socket.send(JSON.stringify(payload));
    } catch (error) {
      logger.debug('[CexOrderBookStream] websocket send failed', {
        venue,
        operation,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private enabled(): boolean {
    return process.env.CRYPTO_CEX_ORDER_BOOK_STREAM_ENABLED?.trim().toLowerCase() !== 'false';
  }

  private staleMs(): number {
    const configured = Number(process.env.CRYPTO_CEX_STREAM_STALE_MS);
    return Number.isFinite(configured) && configured >= 1_000 ? configured : DEFAULT_STALE_MS;
  }
}

export const cexOrderBookStreams = new CexOrderBookStreamManager();

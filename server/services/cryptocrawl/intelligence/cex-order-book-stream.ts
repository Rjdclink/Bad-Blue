import WebSocket from 'ws';
import logger from '../../../logger.js';

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

interface SymbolStreamState {
  venue: CexStreamVenue;
  symbol: string;
  book: SequencedOrderBook;
}

interface VenueConnectionState {
  venue: CexStreamVenue;
  socket: WebSocket | null;
  symbols: Set<string>;
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

/**
 * Keep OKX public observation on the same regional market surface as the
 * authenticated execution authority. U.S. credentials execute through
 * https://us.okx.com and must observe wsus.okx.com rather than the global book.
 * An explicit WS URL remains available for other authenticated regions.
 */
export function getOkxPublicWebSocketEndpoint(): string {
  const explicit = configuredWebSocket('OKX_PUBLIC_WS_URL');
  if (explicit) return explicit;
  const restBase = (process.env.OKX_API_BASE_URL || 'https://us.okx.com').trim().toLowerCase();
  if (restBase.includes('us.okx.com')) return 'wss://wsus.okx.com:8443/ws/v5/public';
  return 'wss://ws.okx.com:8443/ws/v5/public';
}

function parseSymbol(symbol: string): { base: string; quote: string } | null {
  const match = symbol.trim().toUpperCase().match(/^([A-Z0-9]+?)(USDT|USDC|USD)$/);
  return match ? { base: match[1], quote: match[2] } : null;
}

function normalizeExternalSymbol(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const normalized = raw.trim().toUpperCase().replace(/[\/_:\-]/g, '');
  return parseSymbol(normalized) ? normalized : null;
}

function messageSymbol(venue: CexStreamVenue, message: Record<string, unknown>): string | null {
  if (venue === 'coinbase') return normalizeExternalSymbol(message.product_id);
  if (venue === 'kraken') {
    const row = Array.isArray(message.data) ? message.data[0] as Record<string, unknown> | undefined : undefined;
    return normalizeExternalSymbol(row?.symbol);
  }
  const arg = message.arg && typeof message.arg === 'object' ? message.arg as Record<string, unknown> : null;
  return normalizeExternalSymbol(arg?.instId);
}

function finiteNumber(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function nonNegativeNumber(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function normalizeLevels(raw: unknown): StreamOrderBookLevel[] {
  if (!Array.isArray(raw)) return [];
  return raw.map(level => {
    if (Array.isArray(level)) {
      return { price: finiteNumber(level[0]), quantity: finiteNumber(level[1]) };
    }
    if (level && typeof level === 'object') {
      const row = level as Record<string, unknown>;
      return { price: finiteNumber(row.price), quantity: finiteNumber(row.qty ?? row.quantity ?? row.size) };
    }
    return { price: null, quantity: null };
  }).filter((level): level is StreamOrderBookLevel => level.price !== null && level.quantity !== null);
}

function normalizeChanges(raw: unknown): { bids: StreamOrderBookLevel[]; asks: StreamOrderBookLevel[] } {
  const bids: StreamOrderBookLevel[] = [];
  const asks: StreamOrderBookLevel[] = [];
  if (!Array.isArray(raw)) return { bids, asks };
  for (const change of raw) {
    if (Array.isArray(change)) {
      const side = String(change[0]).toLowerCase();
      const level = { price: finiteNumber(change[1]), quantity: nonNegativeNumber(change[2]) };
      if (level.price === null || level.quantity === null) continue;
      if (side === 'buy' || side === 'bid' || side === 'bids') bids.push(level);
      else if (side === 'sell' || side === 'ask' || side === 'asks') asks.push(level);
    }
  }
  return { bids, asks };
}

function parseCoinbase(message: Record<string, unknown>): ParsedBookMessage | null {
  if (message.type === 'snapshot') {
    return {
      kind: 'snapshot',
      bids: normalizeLevels(message.bids),
      asks: normalizeLevels(message.asks),
      sequence: null,
      previousSequence: null,
      observedAt: Date.now(),
    };
  }
  if (message.type === 'l2update') {
    const changes = normalizeChanges(message.changes);
    return { kind: 'delta', ...changes, sequence: null, previousSequence: null, observedAt: Date.now() };
  }
  return null;
}

function parseKraken(message: Record<string, unknown>): ParsedBookMessage | null {
  if (message.channel !== 'book' || !Array.isArray(message.data)) return null;
  const row = message.data[0] as Record<string, unknown> | undefined;
  if (!row) return null;
  const kind = message.type === 'snapshot' ? 'snapshot' : message.type === 'update' ? 'delta' : null;
  if (!kind) return null;
  return {
    kind,
    bids: normalizeLevels(row.bids),
    asks: normalizeLevels(row.asks),
    sequence: null,
    previousSequence: null,
    observedAt: Date.now(),
  };
}

function parseOkx(message: Record<string, unknown>): ParsedBookMessage | null {
  if (message.arg && typeof message.arg === 'object' && (message.arg as Record<string, unknown>).channel !== 'books') return null;
  if (!Array.isArray(message.data)) return null;
  const row = message.data[0] as Record<string, unknown> | undefined;
  if (!row || (message.action !== 'snapshot' && message.action !== 'update')) return null;
  const sequence = finiteNumber(row.seqId);
  const previousSequence = finiteNumber(row.prevSeqId);
  return {
    kind: message.action,
    bids: normalizeLevels(row.bids),
    asks: normalizeLevels(row.asks),
    sequence,
    previousSequence,
    observedAt: Date.now(),
  };
}

function parseMessage(venue: CexStreamVenue, message: Record<string, unknown>): ParsedBookMessage | null {
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
    if (!Number.isFinite(bid) || !Number.isFinite(ask) || bid <= 0 || ask <= 0) return null;
    return { venue, symbol, bid, ask, timestamp: this.lastUpdateAt, sequence: this.lastSequence, depth: { bids, asks, observedAt: this.lastUpdateAt, source: venue } };
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

  async getQuote(venue: CexStreamVenue, symbol: string, maxAgeMs = this.staleMs()): Promise<StreamOrderBookQuote | null> {
    if (!this.enabled()) return null;
    const normalizedSymbol = symbol.trim().toUpperCase();
    if (!parseSymbol(normalizedSymbol)) return null;
    const state = this.ensureStream(venue, normalizedSymbol);
    if (state.book.isStale(maxAgeMs)) {
      this.stats.staleResets += 1;
      state.book.reset();
      this.refreshSubscription(venue, normalizedSymbol);
      return null;
    }
    if (!state.book.isFresh(maxAgeMs)) return null;
    return state.book.getQuote(venue, normalizedSymbol);
  }

  stop(): void {
    for (const connection of this.connections.values()) {
      connection.stopped = true;
      if (connection.reconnectTimer) clearTimeout(connection.reconnectTimer);
      connection.socket?.close();
    }
    this.connections.clear();
    this.streams.clear();
  }

  getStats(): Readonly<CexOrderBookStreamStats> {
    return {
      activeStreams: this.streams.size,
      activeConnections: [...this.connections.values()].filter(connection => connection.socket?.readyState === WebSocket.OPEN).length,
      ...this.stats,
    };
  }

  private ensureStream(venue: CexStreamVenue, symbol: string): SymbolStreamState {
    const key = `${venue}:${symbol}`;
    const existing = this.streams.get(key);
    if (existing) return existing;

    const state: SymbolStreamState = { venue, symbol, book: new SequencedOrderBook() };
    this.streams.set(key, state);
    const connection = this.ensureConnection(venue);
    connection.symbols.add(symbol);
    if (connection.socket?.readyState === WebSocket.OPEN) {
      this.send(connection.socket, this.subscription(venue, [symbol]), venue, 'subscribe');
    }
    return state;
  }

  private ensureConnection(venue: CexStreamVenue): VenueConnectionState {
    const existing = this.connections.get(venue);
    if (existing) return existing;
    const connection: VenueConnectionState = {
      venue,
      socket: null,
      symbols: new Set<string>(),
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
      ? 'wss://ws-feed.exchange.coinbase.com'
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
        regionalExecutionAlignment: connection.venue === 'okx' ? 'rest_base_to_public_ws_region' : 'native_venue_endpoint',
      });
      const symbols = [...connection.symbols];
      if (symbols.length > 0) this.send(socket, this.subscription(connection.venue, symbols), connection.venue, 'subscribe');
    });

    socket.on('message', data => {
      try {
        const message = JSON.parse(data.toString()) as Record<string, unknown>;
        const symbol = messageSymbol(connection.venue, message);
        if (!symbol) return;
        const state = this.streams.get(`${connection.venue}:${symbol}`);
        if (!state) return;
        const parsed = parseMessage(connection.venue, message);
        if (!parsed) return;
        const result = state.book.apply(parsed);
        if (parsed.kind === 'snapshot') this.stats.snapshotsApplied += 1;
        else if (result === 'applied') this.stats.deltasApplied += 1;
        else if (result === 'queued') this.stats.deltasQueued += 1;
        else if (result === 'stale') this.stats.staleDeltasRejected += 1;
        if (result === 'gap') {
          this.stats.sequenceGaps += 1;
          state.book.reset();
          this.refreshSubscription(connection.venue, symbol);
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
      logger.debug('[CexOrderBookStream] websocket error', { venue: connection.venue, error: error.message });
    });

    socket.once('close', () => {
      if (connection.socket === socket) connection.socket = null;
      this.scheduleReconnect(connection);
    });
  }

  private refreshSubscription(venue: CexStreamVenue, symbol: string): void {
    const connection = this.connections.get(venue);
    const socket = connection?.socket;
    if (!connection || !socket || socket.readyState !== WebSocket.OPEN) return;
    this.send(socket, this.unsubscription(venue, [symbol]), venue, 'unsubscribe');
    this.send(socket, this.subscription(venue, [symbol]), venue, 'subscribe');
  }

  private scheduleReconnect(connection: VenueConnectionState): void {
    if (connection.stopped || connection.reconnectTimer) return;
    connection.reconnectAttempts += 1;
    const delay = Math.min(30_000, DEFAULT_RECONNECT_DELAY_MS * 2 ** Math.min(connection.reconnectAttempts - 1, 5));
    connection.reconnectTimer = setTimeout(() => {
      connection.reconnectTimer = null;
      this.connect(connection);
    }, delay);
  }

  private subscription(venue: CexStreamVenue, symbols: string[]): Record<string, unknown> {
    const pairs = symbols.map(symbol => parseSymbol(symbol)).filter((pair): pair is { base: string; quote: string } => Boolean(pair));
    if (venue === 'coinbase') {
      return { type: 'subscribe', product_ids: pairs.map(pair => `${pair.base}-${pair.quote}`), channels: ['level2'] };
    }
    if (venue === 'kraken') {
      return { method: 'subscribe', params: { channel: 'book', symbol: pairs.map(pair => `${pair.base}/${pair.quote}`), depth: 25, snapshot: true } };
    }
    return { op: 'subscribe', args: pairs.map(pair => ({ channel: 'books', instId: `${pair.base}-${pair.quote}` })) };
  }

  private unsubscription(venue: CexStreamVenue, symbols: string[]): Record<string, unknown> {
    const pairs = symbols.map(symbol => parseSymbol(symbol)).filter((pair): pair is { base: string; quote: string } => Boolean(pair));
    if (venue === 'coinbase') {
      return { type: 'unsubscribe', product_ids: pairs.map(pair => `${pair.base}-${pair.quote}`), channels: ['level2'] };
    }
    if (venue === 'kraken') {
      return { method: 'unsubscribe', params: { channel: 'book', symbol: pairs.map(pair => `${pair.base}/${pair.quote}`), depth: 25 } };
    }
    return { op: 'unsubscribe', args: pairs.map(pair => ({ channel: 'books', instId: `${pair.base}-${pair.quote}` })) };
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
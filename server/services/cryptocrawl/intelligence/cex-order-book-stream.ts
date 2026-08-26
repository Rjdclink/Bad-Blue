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

interface StreamState {
  venue: CexStreamVenue;
  symbol: string;
  socket: WebSocket | null;
  book: SequencedOrderBook;
  reconnectTimer: NodeJS.Timeout | null;
  reconnectAttempts: number;
  stopped: boolean;
}

const MAX_LEVELS = 50;
const MAX_PENDING_DELTAS = 256;
const DEFAULT_STALE_MS = 7_500;
const DEFAULT_RECONNECT_DELAY_MS = 1_000;

function parseSymbol(symbol: string): { base: string; quote: string } | null {
  const match = symbol.trim().toUpperCase().match(/^([A-Z0-9]+?)(USDT|USDC|USD)$/);
  return match ? { base: match[1], quote: match[2] } : null;
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
  private readonly streams = new Map<string, StreamState>();
  private readonly stats: Omit<CexOrderBookStreamStats, 'activeStreams'> = {
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
    const key = `${venue}:${normalizedSymbol}`;
    const state = this.ensureStream(venue, normalizedSymbol, key);
    if (state.book.isStale(maxAgeMs)) {
      this.stats.staleResets += 1;
      state.book.reset();
      state.socket?.close();
      return null;
    }
    if (!state.book.isFresh(maxAgeMs)) return null;
    return state.book.getQuote(venue, normalizedSymbol);
  }

  stop(): void {
    for (const state of this.streams.values()) {
      state.stopped = true;
      if (state.reconnectTimer) clearTimeout(state.reconnectTimer);
      state.socket?.close();
    }
    this.streams.clear();
  }

  getStats(): Readonly<CexOrderBookStreamStats> {
    return { activeStreams: this.streams.size, ...this.stats };
  }

  private ensureStream(venue: CexStreamVenue, symbol: string, key: string): StreamState {
    const existing = this.streams.get(key);
    if (existing) return existing;
    const state: StreamState = { venue, symbol, socket: null, book: new SequencedOrderBook(), reconnectTimer: null, reconnectAttempts: 0, stopped: false };
    this.streams.set(key, state);
    this.connect(state);
    return state;
  }

  private connect(state: StreamState): void {
    if (state.stopped) return;
    const endpoint = state.venue === 'coinbase' ? 'wss://ws-feed.exchange.coinbase.com' : state.venue === 'kraken' ? 'wss://ws.kraken.com/v2' : 'wss://ws.okx.com:8443/ws/v5/public';
    const socket = new WebSocket(endpoint);
    state.socket = socket;
    socket.once('open', () => {
      this.stats.connectionsOpened += 1;
      if (state.reconnectAttempts > 0) this.stats.reconnects += 1;
      state.reconnectAttempts = 0;
      socket.send(JSON.stringify(this.subscription(state.venue, state.symbol)));
    });
    socket.on('message', data => {
      try {
        const parsed = parseMessage(state.venue, JSON.parse(data.toString()) as Record<string, unknown>);
        if (!parsed) return;
        const result = state.book.apply(parsed);
        if (parsed.kind === 'snapshot') this.stats.snapshotsApplied += 1;
        else if (result === 'applied') this.stats.deltasApplied += 1;
        else if (result === 'queued') this.stats.deltasQueued += 1;
        else if (result === 'stale') this.stats.staleDeltasRejected += 1;
        if (result === 'gap') {
          this.stats.sequenceGaps += 1;
          state.book.reset();
          socket.close();
        }
      } catch (error) {
        logger.debug('[CexOrderBookStream] ignored invalid message', { venue: state.venue, symbol: state.symbol, error: error instanceof Error ? error.message : String(error) });
      }
    });
    socket.once('error', error => {
      this.stats.connectionErrors += 1;
      logger.debug('[CexOrderBookStream] websocket error', { venue: state.venue, symbol: state.symbol, error: error.message });
    });
    socket.once('close', () => {
      if (state.socket === socket) state.socket = null;
      this.scheduleReconnect(state);
    });
  }

  private scheduleReconnect(state: StreamState): void {
    if (state.stopped || state.reconnectTimer) return;
    state.reconnectAttempts += 1;
    const delay = Math.min(30_000, DEFAULT_RECONNECT_DELAY_MS * 2 ** Math.min(state.reconnectAttempts - 1, 5));
    state.reconnectTimer = setTimeout(() => {
      state.reconnectTimer = null;
      this.connect(state);
    }, delay);
  }

  private subscription(venue: CexStreamVenue, symbol: string): Record<string, unknown> {
    const pair = parseSymbol(symbol)!;
    if (venue === 'coinbase') return { type: 'subscribe', product_ids: [`${pair.base}-${pair.quote}`], channels: ['level2'] };
    if (venue === 'kraken') return { method: 'subscribe', params: { channel: 'book', symbol: [`${pair.base}/${pair.quote}`], depth: 25, snapshot: true } };
    return { op: 'subscribe', args: [{ channel: 'books', instId: `${pair.base}-${pair.quote}`, sz: '50' }] };
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
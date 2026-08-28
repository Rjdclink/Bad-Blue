import WebSocket from 'ws';
import logger from '../../../logger.js';

export type CexStreamVenue = 'coinbase' | 'kraken' | 'okx';
export interface StreamOrderBookLevel { price: number; quantity: number; }
export interface StreamOrderBookQuote {
  venue: CexStreamVenue;
  symbol: string;
  bid: number;
  ask: number;
  timestamp: number;
  depth: { bids: StreamOrderBookLevel[]; asks: StreamOrderBookLevel[]; observedAt: number; source: CexStreamVenue };
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
  checksumFailures: number;
  heartbeatMessages: number;
  staleResets: number;
  connectionsOpened: number;
  reconnects: number;
  connectionErrors: number;
}

interface WireLevel extends StreamOrderBookLevel { wirePrice: string; wireQuantity: string; }
interface BookMessage {
  kind: 'snapshot' | 'delta';
  bids: WireLevel[];
  asks: WireLevel[];
  sequence: number | null;
  previousSequence: number | null;
  observedAt: number;
  checksum: number | null;
}
interface SymbolMessage { symbol: string; book: BookMessage; }
interface SymbolState { venue: CexStreamVenue; symbol: string; book: SequencedOrderBook; connectionKey: string; }
interface ConnectionState {
  key: string;
  venue: CexStreamVenue;
  shard: number;
  socket: WebSocket | null;
  symbols: Set<string>;
  reconnectTimer: NodeJS.Timeout | null;
  reconnectAttempts: number;
  stopped: boolean;
}

const DEFAULT_CACHE_DEPTH = 50;
const KRAKEN_BOOK_DEPTH = 25;
const MAX_PENDING_DELTAS = 256;
const DEFAULT_STALE_MS = 7_500;
const COINBASE_ADVANCED_MARKET_WS = 'wss://advanced-trade-ws.coinbase.com';
const KRAKEN_SPOT_V2_WS = 'wss://ws.kraken.com/v2';
const OKX_PUBLIC_WS = 'wss://ws.okx.com:8443/ws/v5/public';

function parseSymbol(symbol: string): { base: string; quote: string } | null {
  const match = symbol.trim().toUpperCase().match(/^([A-Z0-9]+?)(USDT|USDC|USD)$/);
  return match ? { base: match[1], quote: match[2] } : null;
}
function normalizeExternalSymbol(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const symbol = raw.trim().toUpperCase().replace(/[\/_:\-]/g, '');
  return parseSymbol(symbol) ? symbol : null;
}
function positive(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}
function nonNegative(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}
function integer(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}
function wire(value: unknown): string | null {
  if (typeof value === 'string' && value.trim()) return value.trim();
  const parsed = Number(value);
  return Number.isFinite(parsed) ? String(parsed) : null;
}
function level(priceValue: unknown, quantityValue: unknown, allowZero = false): WireLevel | null {
  const price = positive(priceValue);
  const quantity = allowZero ? nonNegative(quantityValue) : positive(quantityValue);
  const wirePrice = wire(priceValue);
  const wireQuantity = wire(quantityValue);
  return price === null || quantity === null || wirePrice === null || wireQuantity === null
    ? null
    : { price, quantity, wirePrice, wireQuantity };
}
function levels(raw: unknown, allowZero = false): WireLevel[] {
  if (!Array.isArray(raw)) return [];
  const output: WireLevel[] = [];
  for (const value of raw) {
    if (Array.isArray(value)) {
      const parsed = level(value[0], value[1], allowZero);
      if (parsed) output.push(parsed);
      continue;
    }
    if (!value || typeof value !== 'object') continue;
    const row = value as Record<string, unknown>;
    const parsed = level(row.price, row.qty ?? row.quantity ?? row.size, allowZero);
    if (parsed) output.push(parsed);
  }
  return output;
}

function parseWireJson(venue: CexStreamVenue, raw: string): Record<string, unknown> {
  if (venue !== 'kraken') return JSON.parse(raw) as Record<string, unknown>;
  const preserved = raw.replace(
    /"(price|qty)"\s*:\s*(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/g,
    (_match, field: string, value: string) => `"${field}":"${value}"`,
  );
  return JSON.parse(preserved) as Record<string, unknown>;
}

function parseCoinbase(message: Record<string, unknown>): SymbolMessage[] {
  if (message.channel !== 'l2_data' || !Array.isArray(message.events)) return [];
  const sequence = integer(message.sequence_num);
  const parsedTimestamp = typeof message.timestamp === 'string' ? Date.parse(message.timestamp) : NaN;
  const observedAt = Number.isFinite(parsedTimestamp) ? parsedTimestamp : Date.now();
  const output: SymbolMessage[] = [];
  for (const rawEvent of message.events) {
    if (!rawEvent || typeof rawEvent !== 'object') continue;
    const event = rawEvent as Record<string, unknown>;
    const symbol = normalizeExternalSymbol(event.product_id);
    const kind = event.type === 'snapshot' ? 'snapshot' : event.type === 'update' ? 'delta' : null;
    if (!symbol || !kind || !Array.isArray(event.updates)) continue;
    const bids: WireLevel[] = [];
    const asks: WireLevel[] = [];
    for (const rawUpdate of event.updates) {
      if (!rawUpdate || typeof rawUpdate !== 'object') continue;
      const update = rawUpdate as Record<string, unknown>;
      const parsed = level(update.price_level, update.new_quantity, true);
      if (!parsed) continue;
      const side = String(update.side || '').toLowerCase();
      if (side === 'bid' || side === 'buy') bids.push(parsed);
      else if (side === 'offer' || side === 'ask' || side === 'sell') asks.push(parsed);
    }
    output.push({ symbol, book: {
      kind, bids, asks, sequence,
      previousSequence: kind === 'delta' && sequence !== null && sequence > 0 ? sequence - 1 : null,
      observedAt, checksum: null,
    } });
  }
  return output;
}
function parseKraken(message: Record<string, unknown>): SymbolMessage[] {
  if (message.channel !== 'book' || !Array.isArray(message.data)) return [];
  const kind = message.type === 'snapshot' ? 'snapshot' : message.type === 'update' ? 'delta' : null;
  if (!kind) return [];
  return message.data.flatMap(raw => {
    if (!raw || typeof raw !== 'object') return [];
    const row = raw as Record<string, unknown>;
    const symbol = normalizeExternalSymbol(row.symbol);
    if (!symbol) return [];
    const timestamp = typeof row.timestamp === 'string' ? Date.parse(row.timestamp) : NaN;
    return [{ symbol, book: {
      kind,
      bids: levels(row.bids, true),
      asks: levels(row.asks, true),
      sequence: null,
      previousSequence: null,
      observedAt: Number.isFinite(timestamp) ? timestamp : Date.now(),
      checksum: integer(row.checksum),
    } }];
  });
}
function parseOkx(message: Record<string, unknown>): SymbolMessage[] {
  const arg = message.arg && typeof message.arg === 'object' ? message.arg as Record<string, unknown> : null;
  const kind = message.action === 'snapshot' ? 'snapshot' : message.action === 'update' ? 'delta' : null;
  const symbol = normalizeExternalSymbol(arg?.instId);
  if (arg?.channel !== 'books' || !Array.isArray(message.data) || !kind || !symbol) return [];
  return message.data.flatMap(raw => {
    if (!raw || typeof raw !== 'object') return [];
    const row = raw as Record<string, unknown>;
    const ts = Number(row.ts);
    return [{ symbol, book: {
      kind,
      bids: levels(row.bids, true),
      asks: levels(row.asks, true),
      sequence: integer(row.seqId),
      previousSequence: integer(row.prevSeqId),
      observedAt: Number.isFinite(ts) && ts > 0 ? ts : Date.now(),
      checksum: null,
    } }];
  });
}
function parseMessages(venue: CexStreamVenue, message: Record<string, unknown>): SymbolMessage[] {
  return venue === 'coinbase' ? parseCoinbase(message) : venue === 'kraken' ? parseKraken(message) : parseOkx(message);
}

const CRC32_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index++) {
    let value = index;
    for (let bit = 0; bit < 8; bit++) value = (value & 1) ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    table[index] = value >>> 0;
  }
  return table;
})();
function crc32(value: string): number {
  let crc = 0xffffffff;
  for (const byte of Buffer.from(value, 'utf8')) crc = CRC32_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}
function checksumToken(value: string): string {
  return value.replace('.', '').replace(/^0+/, '') || '0';
}
function krakenChecksum(bids: readonly WireLevel[], asks: readonly WireLevel[]): number {
  const askText = [...asks].sort((a, b) => a.price - b.price).slice(0, 10)
    .map(entry => `${checksumToken(entry.wirePrice)}${checksumToken(entry.wireQuantity)}`).join('');
  const bidText = [...bids].sort((a, b) => b.price - a.price).slice(0, 10)
    .map(entry => `${checksumToken(entry.wirePrice)}${checksumToken(entry.wireQuantity)}`).join('');
  return crc32(`${askText}${bidText}`);
}

export class SequencedOrderBook {
  private readonly bids = new Map<string, WireLevel>();
  private readonly asks = new Map<string, WireLevel>();
  private readonly pending: BookMessage[] = [];
  private initialized = false;
  private lastSequence: number | null = null;
  private lastUpdateAt = 0;
  constructor(
    private readonly integrityMode: 'sequence' | 'kraken_crc32' | 'none' = 'sequence',
    private readonly maxDepth = DEFAULT_CACHE_DEPTH,
  ) {
    if (!Number.isInteger(maxDepth) || maxDepth < 10) throw new Error('Order-book cache depth must be an integer >= 10');
  }

  apply(message: BookMessage): 'applied' | 'queued' | 'gap' | 'stale' | 'checksum_mismatch' {
    if (message.kind === 'snapshot') {
      this.bids.clear(); this.asks.clear();
      this.applyLevels(this.bids, message.bids); this.applyLevels(this.asks, message.asks); this.trim();
      this.initialized = true; this.lastSequence = message.sequence; this.lastUpdateAt = message.observedAt;
      if (!this.integrity(message)) { this.reset(); return 'checksum_mismatch'; }
      const queued = this.pending.splice(0);
      for (const delta of queued) {
        const result = this.applyDelta(delta);
        if (result === 'gap' || result === 'checksum_mismatch') return result;
      }
      return 'applied';
    }
    if (!this.initialized) {
      if (this.pending.length >= MAX_PENDING_DELTAS) this.pending.shift();
      this.pending.push(message);
      return 'queued';
    }
    return this.applyDelta(message);
  }
  reset(): void {
    this.bids.clear(); this.asks.clear(); this.pending.length = 0;
    this.initialized = false; this.lastSequence = null; this.lastUpdateAt = 0;
  }
  isFresh(maxAgeMs: number, now = Date.now()): boolean {
    return this.initialized && this.lastUpdateAt > 0 && now - this.lastUpdateAt <= maxAgeMs;
  }
  isStale(maxAgeMs: number, now = Date.now()): boolean {
    return this.initialized && this.lastUpdateAt > 0 && now - this.lastUpdateAt > maxAgeMs;
  }
  getQuote(venue: CexStreamVenue, symbol: string): StreamOrderBookQuote | null {
    if (!this.initialized) return null;
    const bids = [...this.bids.values()].sort((a, b) => b.price - a.price).slice(0, this.maxDepth);
    const asks = [...this.asks.values()].sort((a, b) => a.price - b.price).slice(0, this.maxDepth);
    const bid = bids[0]?.price; const ask = asks[0]?.price;
    if (!Number.isFinite(bid) || !Number.isFinite(ask) || bid <= 0 || ask <= 0) return null;
    return { venue, symbol, bid, ask, timestamp: this.lastUpdateAt, sequence: this.lastSequence,
      depth: { bids: bids.map(({ price, quantity }) => ({ price, quantity })), asks: asks.map(({ price, quantity }) => ({ price, quantity })), observedAt: this.lastUpdateAt, source: venue } };
  }
  private applyDelta(message: BookMessage): 'applied' | 'gap' | 'stale' | 'checksum_mismatch' {
    if (message.sequence !== null && this.lastSequence !== null) {
      if (message.previousSequence !== null && message.previousSequence !== this.lastSequence) return 'gap';
      if (message.sequence <= this.lastSequence) return 'stale';
      if (this.integrityMode === 'sequence' && message.sequence !== this.lastSequence + 1) return 'gap';
    }
    this.applyLevels(this.bids, message.bids); this.applyLevels(this.asks, message.asks); this.trim();
    this.lastSequence = message.sequence ?? this.lastSequence; this.lastUpdateAt = message.observedAt;
    if (!this.integrity(message)) { this.reset(); return 'checksum_mismatch'; }
    return 'applied';
  }
  private applyLevels(target: Map<string, WireLevel>, updates: WireLevel[]): void {
    for (const update of updates) {
      const key = String(update.price);
      if (update.quantity <= 0) target.delete(key); else target.set(key, update);
    }
  }
  private trim(): void {
    const bids = [...this.bids.values()].sort((a, b) => b.price - a.price);
    const asks = [...this.asks.values()].sort((a, b) => a.price - b.price);
    for (const entry of bids.slice(this.maxDepth)) this.bids.delete(String(entry.price));
    for (const entry of asks.slice(this.maxDepth)) this.asks.delete(String(entry.price));
  }
  private integrity(message: BookMessage): boolean {
    return this.integrityMode !== 'kraken_crc32' || message.checksum === null
      || krakenChecksum([...this.bids.values()], [...this.asks.values()]) === (message.checksum >>> 0);
  }
}

class CexOrderBookStreamManager {
  private readonly streams = new Map<string, SymbolState>();
  private readonly connections = new Map<string, ConnectionState>();
  private readonly counters = {
    snapshotsApplied: 0, deltasApplied: 0, deltasQueued: 0, staleDeltasRejected: 0,
    sequenceGaps: 0, checksumFailures: 0, heartbeatMessages: 0, staleResets: 0,
    connectionsOpened: 0, reconnects: 0, connectionErrors: 0,
  };

  async getQuote(venue: CexStreamVenue, symbol: string, maxAgeMs = this.staleMs()): Promise<StreamOrderBookQuote | null> {
    if (!this.enabled()) return null;
    const normalized = symbol.trim().toUpperCase();
    if (!parseSymbol(normalized)) return null;
    const state = this.ensureStream(venue, normalized);
    if (state.book.isStale(maxAgeMs)) {
      this.counters.staleResets++; state.book.reset(); this.refresh(state); return null;
    }
    return state.book.isFresh(maxAgeMs) ? state.book.getQuote(venue, normalized) : null;
  }
  stop(): void {
    for (const connection of this.connections.values()) {
      connection.stopped = true;
      if (connection.reconnectTimer) clearTimeout(connection.reconnectTimer);
      connection.socket?.close();
    }
    this.connections.clear(); this.streams.clear();
  }
  getStats(): Readonly<CexOrderBookStreamStats> {
    return { activeStreams: this.streams.size,
      activeConnections: [...this.connections.values()].filter(c => c.socket?.readyState === WebSocket.OPEN).length,
      ...this.counters };
  }
  private ensureStream(venue: CexStreamVenue, symbol: string): SymbolState {
    const key = `${venue}:${symbol}`;
    const existing = this.streams.get(key); if (existing) return existing;
    const connection = this.connectionFor(venue);
    const depth = venue === 'kraken' ? KRAKEN_BOOK_DEPTH : DEFAULT_CACHE_DEPTH;
    const book = new SequencedOrderBook(venue === 'kraken' ? 'kraken_crc32' : 'sequence', depth);
    const state = { venue, symbol, book, connectionKey: connection.key };
    this.streams.set(key, state); connection.symbols.add(symbol);
    if (connection.socket?.readyState === WebSocket.OPEN) this.subscribe(connection, [symbol]);
    return state;
  }
  private connectionFor(venue: CexStreamVenue): ConnectionState {
    const limit = this.symbolsPerConnection(venue);
    const available = [...this.connections.values()].filter(c => c.venue === venue && !c.stopped && c.symbols.size < limit)
      .sort((a, b) => a.symbols.size - b.symbols.size)[0];
    if (available) return available;
    const shard = [...this.connections.values()].filter(c => c.venue === venue).length;
    const connection: ConnectionState = { key: `${venue}:${shard}`, venue, shard, socket: null, symbols: new Set(), reconnectTimer: null, reconnectAttempts: 0, stopped: false };
    this.connections.set(connection.key, connection); this.connect(connection); return connection;
  }
  private connect(connection: ConnectionState): void {
    if (connection.stopped) return;
    const endpoint = connection.venue === 'coinbase' ? COINBASE_ADVANCED_MARKET_WS : connection.venue === 'kraken' ? KRAKEN_SPOT_V2_WS : OKX_PUBLIC_WS;
    const socket = new WebSocket(endpoint); connection.socket = socket;
    socket.once('open', () => {
      this.counters.connectionsOpened++; if (connection.reconnectAttempts > 0) this.counters.reconnects++;
      connection.reconnectAttempts = 0; if (connection.symbols.size) this.subscribe(connection, [...connection.symbols]);
    });
    socket.on('message', data => {
      try {
        const message = parseWireJson(connection.venue, data.toString());
        if (connection.venue === 'coinbase' && message.channel === 'heartbeats') { this.counters.heartbeatMessages++; return; }
        for (const parsed of parseMessages(connection.venue, message)) {
          const state = this.streams.get(`${connection.venue}:${parsed.symbol}`);
          if (!state || state.connectionKey !== connection.key) continue;
          const result = state.book.apply(parsed.book);
          if (result === 'applied' && parsed.book.kind === 'snapshot') this.counters.snapshotsApplied++;
          else if (result === 'applied') this.counters.deltasApplied++;
          else if (result === 'queued') this.counters.deltasQueued++;
          else if (result === 'stale') this.counters.staleDeltasRejected++;
          else if (result === 'gap' || result === 'checksum_mismatch') {
            if (result === 'gap') this.counters.sequenceGaps++; else this.counters.checksumFailures++;
            state.book.reset(); this.refresh(state);
          }
        }
      } catch (error) {
        logger.debug('[CexOrderBookStream] ignored invalid message', { venue: connection.venue, shard: connection.shard, error: error instanceof Error ? error.message : String(error) });
      }
    });
    socket.once('error', error => { this.counters.connectionErrors++; logger.debug('[CexOrderBookStream] websocket error', { venue: connection.venue, shard: connection.shard, error: error.message }); });
    socket.once('close', () => { if (connection.socket === socket) connection.socket = null; this.reconnect(connection); });
  }
  private refresh(state: SymbolState): void {
    const connection = this.connections.get(state.connectionKey);
    if (!connection?.socket || connection.socket.readyState !== WebSocket.OPEN) return;
    for (const payload of this.unsubscribeMessages(connection.venue, [state.symbol])) this.send(connection.socket, payload);
    const timer = setTimeout(() => { if (connection.socket?.readyState === WebSocket.OPEN) this.subscribe(connection, [state.symbol]); }, 75); timer.unref();
  }
  private reconnect(connection: ConnectionState): void {
    if (connection.stopped || connection.reconnectTimer) return;
    connection.reconnectAttempts++;
    const delay = Math.min(30_000, 1_000 * Math.pow(2, Math.min(6, connection.reconnectAttempts - 1)) + ((connection.shard * 137 + connection.reconnectAttempts * 53) % 500));
    connection.reconnectTimer = setTimeout(() => { connection.reconnectTimer = null; this.connect(connection); }, delay); connection.reconnectTimer.unref();
  }
  private subscribe(connection: ConnectionState, symbols: string[]): void {
    for (const payload of this.subscribeMessages(connection.venue, symbols)) this.send(connection.socket, payload);
  }
  private subscribeMessages(venue: CexStreamVenue, symbols: string[]): Record<string, unknown>[] {
    const pairs = symbols.map(parseSymbol).filter((value): value is { base: string; quote: string } => Boolean(value));
    if (venue === 'coinbase') {
      const product_ids = pairs.map(pair => `${pair.base}-${pair.quote}`);
      return [{ type: 'subscribe', product_ids, channel: 'level2' }, { type: 'subscribe', channel: 'heartbeats' }];
    }
    if (venue === 'kraken') return [{ method: 'subscribe', params: { channel: 'book', symbol: pairs.map(pair => `${pair.base}/${pair.quote}`), depth: KRAKEN_BOOK_DEPTH, snapshot: true } }];
    return [{ op: 'subscribe', args: pairs.map(pair => ({ channel: 'books', instId: `${pair.base}-${pair.quote}` })) }];
  }
  private unsubscribeMessages(venue: CexStreamVenue, symbols: string[]): Record<string, unknown>[] {
    const pairs = symbols.map(parseSymbol).filter((value): value is { base: string; quote: string } => Boolean(value));
    if (venue === 'coinbase') return [{ type: 'unsubscribe', product_ids: pairs.map(pair => `${pair.base}-${pair.quote}`), channel: 'level2' }];
    if (venue === 'kraken') return [{ method: 'unsubscribe', params: { channel: 'book', symbol: pairs.map(pair => `${pair.base}/${pair.quote}`), depth: KRAKEN_BOOK_DEPTH } }];
    return [{ op: 'unsubscribe', args: pairs.map(pair => ({ channel: 'books', instId: `${pair.base}-${pair.quote}` })) }];
  }
  private send(socket: WebSocket | null, payload: Record<string, unknown>): void {
    if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(payload));
  }
  private symbolsPerConnection(venue: CexStreamVenue): number {
    const configured = Number(process.env[`CRYPTO_CEX_${venue.toUpperCase()}_WS_SYMBOLS_PER_CONNECTION`]);
    if (Number.isFinite(configured) && configured >= 1) return Math.min(250, Math.floor(configured));
    return venue === 'coinbase' ? 25 : 50;
  }
  private enabled(): boolean { return process.env.CRYPTO_CEX_ORDER_BOOK_STREAM_ENABLED?.trim().toLowerCase() !== 'false'; }
  private staleMs(): number {
    const configured = Number(process.env.CRYPTO_CEX_STREAM_STALE_MS);
    return Number.isFinite(configured) && configured >= 1_000 ? configured : DEFAULT_STALE_MS;
  }
}

export const cexOrderBookStreams = new CexOrderBookStreamManager();

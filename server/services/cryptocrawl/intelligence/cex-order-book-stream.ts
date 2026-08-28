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
  checksumFailures: number;
  heartbeatMessages: number;
  staleResets: number;
  connectionsOpened: number;
  reconnects: number;
  connectionErrors: number;
}

interface InternalOrderBookLevel extends StreamOrderBookLevel {
  wirePrice: string;
  wireQuantity: string;
}

interface ParsedBookMessage {
  kind: 'snapshot' | 'delta';
  bids: InternalOrderBookLevel[];
  asks: InternalOrderBookLevel[];
  sequence: number | null;
  previousSequence: number | null;
  observedAt: number;
  checksum: number | null;
}

interface ParsedSymbolMessage {
  symbol: string;
  book: ParsedBookMessage;
}

interface SymbolStreamState {
  venue: CexStreamVenue;
  symbol: string;
  book: SequencedOrderBook;
  connectionKey: string;
}

interface VenueConnectionState {
  key: string;
  venue: CexStreamVenue;
  shard: number;
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
const COINBASE_ADVANCED_MARKET_WS = 'wss://advanced-trade-ws.coinbase.com';
const KRAKEN_SPOT_V2_WS = 'wss://ws.kraken.com/v2';
const OKX_PUBLIC_WS = 'wss://ws.okx.com:8443/ws/v5/public';

function parseSymbol(symbol: string): { base: string; quote: string } | null {
  const match = symbol.trim().toUpperCase().match(/^([A-Z0-9]+?)(USDT|USDC|USD)$/);
  return match ? { base: match[1], quote: match[2] } : null;
}

function normalizeExternalSymbol(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const normalized = raw.trim().toUpperCase().replace(/[\/_:\-]/g, '');
  return parseSymbol(normalized) ? normalized : null;
}

function positiveNumber(value: unknown): number | null {
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

function wireDecimal(value: unknown): string | null {
  if (typeof value === 'string' && value.trim()) return value.trim();
  const parsed = Number(value);
  return Number.isFinite(parsed) ? String(parsed) : null;
}

function levelFromValues(priceValue: unknown, quantityValue: unknown, allowZeroQuantity = false): InternalOrderBookLevel | null {
  const price = positiveNumber(priceValue);
  const quantity = allowZeroQuantity ? nonNegativeNumber(quantityValue) : positiveNumber(quantityValue);
  const wirePrice = wireDecimal(priceValue);
  const wireQuantity = wireDecimal(quantityValue);
  if (price === null || quantity === null || wirePrice === null || wireQuantity === null) return null;
  return { price, quantity, wirePrice, wireQuantity };
}

function normalizeLevels(raw: unknown, allowZeroQuantity = false): InternalOrderBookLevel[] {
  if (!Array.isArray(raw)) return [];
  const levels: InternalOrderBookLevel[] = [];
  for (const value of raw) {
    if (Array.isArray(value)) {
      const level = levelFromValues(value[0], value[1], allowZeroQuantity);
      if (level) levels.push(level);
      continue;
    }
    if (!value || typeof value !== 'object') continue;
    const row = value as Record<string, unknown>;
    const level = levelFromValues(row.price, row.qty ?? row.quantity ?? row.size, allowZeroQuantity);
    if (level) levels.push(level);
  }
  return levels;
}

/**
 * Kraken explicitly requires decimal/string preservation for checksum input. JSON
 * numbers otherwise lose insignificant trailing zeros in JavaScript. Quote only
 * the two numeric book fields before JSON.parse so every other field retains its
 * documented JSON type while price/qty retain their wire representation.
 */
function parseWireJson(venue: CexStreamVenue, raw: string): Record<string, unknown> {
  if (venue !== 'kraken') return JSON.parse(raw) as Record<string, unknown>;
  const preserved = raw.replace(
    /"(price|qty)"\s*:\s*(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/g,
    (_match, field: string, value: string) => `"${field}":"${value}"`,
  );
  return JSON.parse(preserved) as Record<string, unknown>;
}

function parseCoinbase(message: Record<string, unknown>): ParsedSymbolMessage[] {
  if (message.channel !== 'l2_data' || !Array.isArray(message.events)) return [];
  const sequence = nonNegativeInteger(message.sequence_num);
  const topTimestamp = typeof message.timestamp === 'string' ? Date.parse(message.timestamp) : NaN;
  const observedAt = Number.isFinite(topTimestamp) ? topTimestamp : Date.now();
  const output: ParsedSymbolMessage[] = [];

  for (const eventValue of message.events) {
    if (!eventValue || typeof eventValue !== 'object') continue;
    const event = eventValue as Record<string, unknown>;
    const symbol = normalizeExternalSymbol(event.product_id);
    const kind = event.type === 'snapshot' ? 'snapshot' : event.type === 'update' ? 'delta' : null;
    if (!symbol || !kind || !Array.isArray(event.updates)) continue;
    const bids: InternalOrderBookLevel[] = [];
    const asks: InternalOrderBookLevel[] = [];
    for (const updateValue of event.updates) {
      if (!updateValue || typeof updateValue !== 'object') continue;
      const update = updateValue as Record<string, unknown>;
      const level = levelFromValues(update.price_level, update.new_quantity, true);
      if (!level) continue;
      const side = String(update.side || '').trim().toLowerCase();
      if (side === 'bid' || side === 'buy') bids.push(level);
      else if (side === 'offer' || side === 'ask' || side === 'sell') asks.push(level);
    }
    output.push({
      symbol,
      book: {
        kind,
        bids,
        asks,
        sequence,
        previousSequence: kind === 'delta' && sequence !== null && sequence > 0 ? sequence - 1 : null,
        observedAt,
        checksum: null,
      },
    });
  }
  return output;
}

function parseKraken(message: Record<string, unknown>): ParsedSymbolMessage[] {
  if (message.channel !== 'book' || !Array.isArray(message.data)) return [];
  const kind = message.type === 'snapshot' ? 'snapshot' : message.type === 'update' ? 'delta' : null;
  if (!kind) return [];
  const output: ParsedSymbolMessage[] = [];
  for (const value of message.data) {
    if (!value || typeof value !== 'object') continue;
    const row = value as Record<string, unknown>;
    const symbol = normalizeExternalSymbol(row.symbol);
    if (!symbol) continue;
    const timestamp = typeof row.timestamp === 'string' ? Date.parse(row.timestamp) : NaN;
    output.push({
      symbol,
      book: {
        kind,
        bids: normalizeLevels(row.bids, true),
        asks: normalizeLevels(row.asks, true),
        sequence: null,
        previousSequence: null,
        observedAt: Number.isFinite(timestamp) ? timestamp : Date.now(),
        checksum: nonNegativeInteger(row.checksum),
      },
    });
  }
  return output;
}

function parseOkx(message: Record<string, unknown>): ParsedSymbolMessage[] {
  const arg = message.arg && typeof message.arg === 'object' ? message.arg as Record<string, unknown> : null;
  if (arg?.channel !== 'books' || !Array.isArray(message.data)) return [];
  const kind = message.action === 'snapshot' ? 'snapshot' : message.action === 'update' ? 'delta' : null;
  if (!kind) return [];
  const symbol = normalizeExternalSymbol(arg.instId);
  if (!symbol) return [];
  const output: ParsedSymbolMessage[] = [];
  for (const value of message.data) {
    if (!value || typeof value !== 'object') continue;
    const row = value as Record<string, unknown>;
    const observedAtValue = Number(row.ts);
    output.push({
      symbol,
      book: {
        kind,
        bids: normalizeLevels(row.bids, true),
        asks: normalizeLevels(row.asks, true),
        sequence: nonNegativeInteger(row.seqId),
        previousSequence: nonNegativeInteger(row.prevSeqId),
        observedAt: Number.isFinite(observedAtValue) && observedAtValue > 0 ? observedAtValue : Date.now(),
        checksum: null,
      },
    });
  }
  return output;
}

function parseMessages(venue: CexStreamVenue, message: Record<string, unknown>): ParsedSymbolMessage[] {
  if (venue === 'coinbase') return parseCoinbase(message);
  if (venue === 'kraken') return parseKraken(message);
  return parseOkx(message);
}

const CRC32_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index++) {
    let value = index;
    for (let bit = 0; bit < 8; bit++) value = (value & 1) ? (0xedb88320 ^ (value >>> 1)) : (value >>> 1);
    table[index] = value >>> 0;
  }
  return table;
})();

function crc32(value: string): number {
  let crc = 0xffffffff;
  const bytes = Buffer.from(value, 'utf8');
  for (const byte of bytes) crc = CRC32_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function checksumToken(value: string): string {
  const noDecimal = value.replace('.', '');
  return noDecimal.replace(/^0+/, '') || '0';
}

function krakenBookChecksum(
  bids: readonly InternalOrderBookLevel[],
  asks: readonly InternalOrderBookLevel[],
): number {
  const askText = [...asks]
    .sort((left, right) => left.price - right.price)
    .slice(0, 10)
    .map(level => `${checksumToken(level.wirePrice)}${checksumToken(level.wireQuantity)}`)
    .join('');
  const bidText = [...bids]
    .sort((left, right) => right.price - left.price)
    .slice(0, 10)
    .map(level => `${checksumToken(level.wirePrice)}${checksumToken(level.wireQuantity)}`)
    .join('');
  return crc32(`${askText}${bidText}`);
}

export class SequencedOrderBook {
  private readonly bids = new Map<string, InternalOrderBookLevel>();
  private readonly asks = new Map<string, InternalOrderBookLevel>();
  private readonly pendingDeltas: ParsedBookMessage[] = [];
  private initialized = false;
  private lastSequence: number | null = null;
  private lastUpdateAt = 0;

  constructor(private readonly integrityMode: 'sequence' | 'kraken_crc32' | 'none' = 'sequence') {}

  apply(message: ParsedBookMessage): 'applied' | 'queued' | 'gap' | 'stale' | 'checksum_mismatch' {
    if (message.kind === 'snapshot') {
      this.bids.clear();
      this.asks.clear();
      this.applyLevels(this.bids, message.bids);
      this.applyLevels(this.asks, message.asks);
      this.trimToDepth();
      this.initialized = true;
      this.lastSequence = message.sequence;
      this.lastUpdateAt = message.observedAt;
      if (!this.checkIntegrity(message)) {
        this.reset();
        return 'checksum_mismatch';
      }
      const queued = this.pendingDeltas.splice(0);
      for (const delta of queued) {
        const result = this.applyDelta(delta);
        if (result === 'gap' || result === 'checksum_mismatch') return result;
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
    return {
      venue,
      symbol,
      bid,
      ask,
      timestamp: this.lastUpdateAt,
      sequence: this.lastSequence,
      depth: {
        bids: bids.map(level => ({ price: level.price, quantity: level.quantity })),
        asks: asks.map(level => ({ price: level.price, quantity: level.quantity })),
        observedAt: this.lastUpdateAt,
        source: venue,
      },
    };
  }

  private applyDelta(message: ParsedBookMessage): 'applied' | 'gap' | 'stale' | 'checksum_mismatch' {
    if (message.sequence !== null && this.lastSequence !== null) {
      if (message.previousSequence !== null && message.previousSequence !== this.lastSequence) return 'gap';
      if (message.sequence <= this.lastSequence) return 'stale';
      if (this.integrityMode === 'sequence' && message.sequence !== this.lastSequence + 1) return 'gap';
    }
    this.applyLevels(this.bids, message.bids);
    this.applyLevels(this.asks, message.asks);
    this.trimToDepth();
    this.lastSequence = message.sequence ?? this.lastSequence;
    this.lastUpdateAt = message.observedAt;
    if (!this.checkIntegrity(message)) {
      this.reset();
      return 'checksum_mismatch';
    }
    return 'applied';
  }

  private applyLevels(target: Map<string, InternalOrderBookLevel>, levels: InternalOrderBookLevel[]): void {
    for (const level of levels) {
      const key = String(level.price);
      if (level.quantity <= 0) target.delete(key);
      else target.set(key, level);
    }
  }

  private trimToDepth(): void {
    const bids = [...this.bids.values()].sort((left, right) => right.price - left.price);
    const asks = [...this.asks.values()].sort((left, right) => left.price - right.price);
    for (const level of bids.slice(MAX_LEVELS)) this.bids.delete(String(level.price));
    for (const level of asks.slice(MAX_LEVELS)) this.asks.delete(String(level.price));
  }

  private checkIntegrity(message: ParsedBookMessage): boolean {
    if (this.integrityMode !== 'kraken_crc32' || message.checksum === null) return true;
    return krakenBookChecksum([...this.bids.values()], [...this.asks.values()]) === (message.checksum >>> 0);
  }
}

class CexOrderBookStreamManager {
  private readonly streams = new Map<string, SymbolStreamState>();
  private readonly connections = new Map<string, VenueConnectionState>();
  private readonly stats: Omit<CexOrderBookStreamStats, 'activeStreams' | 'activeConnections'> = {
    snapshotsApplied: 0,
    deltasApplied: 0,
    deltasQueued: 0,
    staleDeltasRejected: 0,
    sequenceGaps: 0,
    checksumFailures: 0,
    heartbeatMessages: 0,
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
      this.refreshSubscription(state);
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

  private integrityMode(venue: CexStreamVenue): 'sequence' | 'kraken_crc32' | 'none' {
    if (venue === 'kraken') return 'kraken_crc32';
    return 'sequence';
  }

  private maxSymbolsPerConnection(venue: CexStreamVenue): number {
    const specific = Number(process.env[`CRYPTO_CEX_${venue.toUpperCase()}_WS_SYMBOLS_PER_CONNECTION`]);
    if (Number.isFinite(specific) && specific >= 1) return Math.min(250, Math.floor(specific));
    return venue === 'coinbase' ? 25 : 50;
  }

  private ensureStream(venue: CexStreamVenue, symbol: string): SymbolStreamState {
    const key = `${venue}:${symbol}`;
    const existing = this.streams.get(key);
    if (existing) return existing;
    const connection = this.connectionForNewSymbol(venue);
    const state: SymbolStreamState = {
      venue,
      symbol,
      book: new SequencedOrderBook(this.integrityMode(venue)),
      connectionKey: connection.key,
    };
    this.streams.set(key, state);
    connection.symbols.add(symbol);
    if (connection.socket?.readyState === WebSocket.OPEN) this.sendSubscriptions(connection, [symbol]);
    return state;
  }

  private connectionForNewSymbol(venue: CexStreamVenue): VenueConnectionState {
    const limit = this.maxSymbolsPerConnection(venue);
    const available = [...this.connections.values()]
      .filter(connection => connection.venue === venue && !connection.stopped && connection.symbols.size < limit)
      .sort((left, right) => left.symbols.size - right.symbols.size)[0];
    if (available) return available;
    const shard = [...this.connections.values()].filter(connection => connection.venue === venue).length;
    const key = `${venue}:${shard}`;
    const connection: VenueConnectionState = {
      key,
      venue,
      shard,
      socket: null,
      symbols: new Set<string>(),
      reconnectTimer: null,
      reconnectAttempts: 0,
      stopped: false,
    };
    this.connections.set(key, connection);
    this.connect(connection);
    return connection;
  }

  private connect(connection: VenueConnectionState): void {
    if (connection.stopped) return;
    const endpoint = connection.venue === 'coinbase'
      ? COINBASE_ADVANCED_MARKET_WS
      : connection.venue === 'kraken'
        ? KRAKEN_SPOT_V2_WS
        : OKX_PUBLIC_WS;
    const socket = new WebSocket(endpoint);
    connection.socket = socket;

    socket.once('open', () => {
      this.stats.connectionsOpened += 1;
      if (connection.reconnectAttempts > 0) this.stats.reconnects += 1;
      connection.reconnectAttempts = 0;
      const symbols = [...connection.symbols];
      if (symbols.length > 0) this.sendSubscriptions(connection, symbols);
    });

    socket.on('message', data => {
      try {
        const raw = data.toString();
        const message = parseWireJson(connection.venue, raw);
        if (connection.venue === 'coinbase' && message.channel === 'heartbeats') {
          this.stats.heartbeatMessages += 1;
          return;
        }
        for (const parsed of parseMessages(connection.venue, message)) {
          const state = this.streams.get(`${connection.venue}:${parsed.symbol}`);
          if (!state || state.connectionKey !== connection.key) continue;
          const result = state.book.apply(parsed.book);
          if (parsed.book.kind === 'snapshot' && result === 'applied') this.stats.snapshotsApplied += 1;
          else if (result === 'applied') this.stats.deltasApplied += 1;
          else if (result === 'queued') this.stats.deltasQueued += 1;
          else if (result === 'stale') this.stats.staleDeltasRejected += 1;
          else if (result === 'gap') {
            this.stats.sequenceGaps += 1;
            state.book.reset();
            this.refreshSubscription(state);
          } else if (result === 'checksum_mismatch') {
            this.stats.checksumFailures += 1;
            state.book.reset();
            this.refreshSubscription(state);
          }
        }
      } catch (error) {
        logger.debug('[CexOrderBookStream] ignored invalid message', {
          venue: connection.venue,
          shard: connection.shard,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    });

    socket.once('error', error => {
      this.stats.connectionErrors += 1;
      logger.debug('[CexOrderBookStream] websocket error', {
        venue: connection.venue,
        shard: connection.shard,
        error: error.message,
      });
    });

    socket.once('close', () => {
      if (connection.socket === socket) connection.socket = null;
      this.scheduleReconnect(connection);
    });
  }

  private refreshSubscription(state: SymbolStreamState): void {
    const connection = this.connections.get(state.connectionKey);
    if (!connection?.socket || connection.socket.readyState !== WebSocket.OPEN) return;
    this.sendUnsubscriptions(connection, [state.symbol]);
    const timer = setTimeout(() => {
      if (connection.socket?.readyState === WebSocket.OPEN) this.sendSubscriptions(connection, [state.symbol]);
    }, 75);
    timer.unref();
  }

  private scheduleReconnect(connection: VenueConnectionState): void {
    if (connection.stopped || connection.reconnectTimer) return;
    connection.reconnectAttempts += 1;
    const exponential = DEFAULT_RECONNECT_DELAY_MS * Math.pow(2, Math.min(6, connection.reconnectAttempts - 1));
    const deterministicJitter = (connection.shard * 137 + connection.reconnectAttempts * 53) % 500;
    const delay = Math.min(30_000, exponential + deterministicJitter);
    connection.reconnectTimer = setTimeout(() => {
      connection.reconnectTimer = null;
      this.connect(connection);
    }, delay);
    connection.reconnectTimer.unref();
  }

  private sendSubscriptions(connection: VenueConnectionState, symbols: string[]): void {
    for (const payload of this.subscriptionMessages(connection.venue, symbols)) {
      this.send(connection.socket, payload, connection.venue, 'subscribe');
    }
  }

  private sendUnsubscriptions(connection: VenueConnectionState, symbols: string[]): void {
    for (const payload of this.unsubscriptionMessages(connection.venue, symbols)) {
      this.send(connection.socket, payload, connection.venue, 'unsubscribe');
    }
  }

  private subscriptionMessages(venue: CexStreamVenue, symbols: string[]): Record<string, unknown>[] {
    const pairs = symbols.map(symbol => parseSymbol(symbol)).filter((pair): pair is { base: string; quote: string } => Boolean(pair));
    if (venue === 'coinbase') {
      const productIds = pairs.map(pair => `${pair.base}-${pair.quote}`);
      return [
        { type: 'subscribe', product_ids: productIds, channel: 'level2' },
        { type: 'subscribe', channel: 'heartbeats' },
      ];
    }
    if (venue === 'kraken') {
      return [{ method: 'subscribe', params: { channel: 'book', symbol: pairs.map(pair => `${pair.base}/${pair.quote}`), depth: 25, snapshot: true } }];
    }
    return [{ op: 'subscribe', args: pairs.map(pair => ({ channel: 'books', instId: `${pair.base}-${pair.quote}` })) }];
  }

  private unsubscriptionMessages(venue: CexStreamVenue, symbols: string[]): Record<string, unknown>[] {
    const pairs = symbols.map(symbol => parseSymbol(symbol)).filter((pair): pair is { base: string; quote: string } => Boolean(pair));
    if (venue === 'coinbase') {
      return [{ type: 'unsubscribe', product_ids: pairs.map(pair => `${pair.base}-${pair.quote}`), channel: 'level2' }];
    }
    if (venue === 'kraken') {
      return [{ method: 'unsubscribe', params: { channel: 'book', symbol: pairs.map(pair => `${pair.base}/${pair.quote}`), depth: 25 } }];
    }
    return [{ op: 'unsubscribe', args: pairs.map(pair => ({ channel: 'books', instId: `${pair.base}-${pair.quote}` })) }];
  }

  private send(socket: WebSocket | null, payload: Record<string, unknown>, venue: CexStreamVenue, operation: string): void {
    if (!socket || socket.readyState !== WebSocket.OPEN) return;
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

import WebSocket from 'ws';
import logger from '../../../logger.js';
import { omniAntennaLayer } from '../../computationalBeam/omniAntennaLayer.js';
import { TaskType } from '../../computationalBeam/types.js';
import {
  canonicalCoinbaseSymbol,
  resolveCoinbaseAdvancedProductId,
} from './coinbase-advanced-market-data.js';
import { getSpotProductConstraints } from '../execution/cex-spot-product-policy.js';

export type CexStreamVenue = 'coinbase' | 'kraken' | 'okx';
type CexStreamLane = 'primary' | 'standby';

export interface StreamOrderBookLevel {
  price: number;
  quantity: number;
  rawPrice?: string;
  rawQuantity?: string;
  rawExact?: boolean;
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
  activeStandbyConnections: number;
  snapshotsApplied: number;
  deltasApplied: number;
  deltasQueued: number;
  staleDeltasRejected: number;
  sequenceGaps: number;
  integrityFailures: number;
  staleResets: number;
  framesReceived: number;
  standbyFramesReceived: number;
  standbyHandovers: number;
  controlMessages: number;
  connectionsOpened: number;
  reconnects: number;
  proactiveReconnects: number;
  heartbeatTimeouts: number;
  connectionErrors: number;
}

interface ParsedBookMessage {
  kind: 'snapshot' | 'delta';
  bids: StreamOrderBookLevel[];
  asks: StreamOrderBookLevel[];
  sequence: number | null;
  previousSequence: number | null;
  checksum: number | null;
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
  lane: CexStreamLane;
  socket: WebSocket | null;
  symbols: Map<string, string>;
  canonicalByExternal: Map<string, string>;
  reconnectTimer: NodeJS.Timeout | null;
  heartbeatTimer: NodeJS.Timeout | null;
  reconnectAttempts: number;
  lastMessageAt: number;
  awaitingPongAt: number | null;
  stopped: boolean;
}

type BookApplyStatus = 'applied' | 'queued' | 'gap' | 'stale' | 'integrity';

const MAX_LEVELS = 50;
const KRAKEN_BOOK_DEPTH = 25;
const MAX_PENDING_DELTAS = 256;
const DEFAULT_STALE_MS = 7_500;
const DEFAULT_RECONNECT_DELAY_MS = 1_000;
const LIVENESS_CHECK_MS = 5_000;
const IDLE_BEFORE_PING_MS = 15_000;
const PONG_TIMEOUT_MS = 10_000;
const MAX_WS_PAYLOAD_BYTES = 4 * 1024 * 1024;

const CRC32_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    table[n] = c >>> 0;
  }
  return table;
})();

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

function rawDecimal(value: unknown): { text?: string; exact: boolean } {
  if (typeof value === 'string' && value.trim()) return { text: value.trim(), exact: true };
  if (typeof value === 'number' && Number.isFinite(value)) return { text: String(value), exact: false };
  return { exact: false };
}

function normalizeLevels(raw: unknown, allowZeroQuantity = false): StreamOrderBookLevel[] {
  if (!Array.isArray(raw)) return [];
  return raw.map(level => {
    if (Array.isArray(level)) {
      const rawPrice = rawDecimal(level[0]);
      const rawQuantity = rawDecimal(level[1]);
      return {
        price: finiteNumber(level[0]),
        quantity: allowZeroQuantity ? nonNegativeNumber(level[1]) : finiteNumber(level[1]),
        rawPrice: rawPrice.text,
        rawQuantity: rawQuantity.text,
        rawExact: rawPrice.exact && rawQuantity.exact,
      };
    }
    if (level && typeof level === 'object') {
      const row = level as Record<string, unknown>;
      const priceValue = row.price ?? row.price_level;
      const quantityValue = row.qty ?? row.quantity ?? row.size ?? row.new_quantity;
      const rawPrice = rawDecimal(priceValue);
      const rawQuantity = rawDecimal(quantityValue);
      return {
        price: finiteNumber(priceValue),
        quantity: allowZeroQuantity ? nonNegativeNumber(quantityValue) : finiteNumber(quantityValue),
        rawPrice: rawPrice.text,
        rawQuantity: rawQuantity.text,
        rawExact: rawPrice.exact && rawQuantity.exact,
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
        sequence: null,
        previousSequence: null,
        checksum: null,
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
        checksum: nonNegativeInteger(row.checksum),
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
        checksum: null,
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

function crc32Ascii(value: string): number {
  let crc = 0xffffffff;
  for (let index = 0; index < value.length; index += 1) {
    crc = CRC32_TABLE[(crc ^ value.charCodeAt(index)) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function krakenChecksumToken(value: string): string {
  const stripped = value.replace('.', '').replace(/^0+/, '');
  return stripped || '0';
}

export class SequencedOrderBook {
  private readonly bids = new Map<string, StreamOrderBookLevel>();
  private readonly asks = new Map<string, StreamOrderBookLevel>();
  private readonly pendingDeltas: ParsedBookMessage[] = [];
  private initialized = false;
  private lastSequence: number | null = null;
  private lastUpdateAt = 0;

  constructor(
    private readonly venue: CexStreamVenue = 'coinbase',
    private readonly depthLimit: number = MAX_LEVELS,
  ) {}

  apply(message: ParsedBookMessage): BookApplyStatus {
    if (message.kind === 'snapshot') {
      this.bids.clear();
      this.asks.clear();
      this.applyLevels(this.bids, message.bids);
      this.applyLevels(this.asks, message.asks);
      this.truncate();
      this.initialized = true;
      this.lastSequence = message.sequence;
      this.lastUpdateAt = message.observedAt;
      if (!this.validateKrakenChecksum(message.checksum)) return 'integrity';
      const queued = this.pendingDeltas.splice(0);
      for (const delta of queued) {
        const result = this.applyDelta(delta);
        if (result === 'gap' || result === 'integrity') return result;
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

  private applyDelta(message: ParsedBookMessage): BookApplyStatus {
    if (message.sequence !== null && this.lastSequence !== null) {
      if (message.previousSequence !== null && message.previousSequence !== this.lastSequence) return 'gap';
      if (message.sequence <= this.lastSequence) return 'stale';
    }
    this.applyLevels(this.bids, message.bids);
    this.applyLevels(this.asks, message.asks);
    this.truncate();
    this.lastSequence = message.sequence ?? this.lastSequence;
    this.lastUpdateAt = message.observedAt;
    if (!this.validateKrakenChecksum(message.checksum)) return 'integrity';
    return 'applied';
  }

  private applyLevels(target: Map<string, StreamOrderBookLevel>, levels: StreamOrderBookLevel[]): void {
    for (const level of levels) {
      const key = String(level.price);
      if (level.quantity <= 0) target.delete(key);
      else target.set(key, level);
    }
  }

  private truncate(): void {
    const bids = [...this.bids.entries()].sort((left, right) => right[1].price - left[1].price);
    const asks = [...this.asks.entries()].sort((left, right) => left[1].price - right[1].price);
    for (const [key] of bids.slice(this.depthLimit)) this.bids.delete(key);
    for (const [key] of asks.slice(this.depthLimit)) this.asks.delete(key);
  }

  private validateKrakenChecksum(expected: number | null): boolean {
    if (this.venue !== 'kraken' || expected === null) return true;
    const asks = [...this.asks.values()].sort((left, right) => left.price - right.price).slice(0, 10);
    const bids = [...this.bids.values()].sort((left, right) => right.price - left.price).slice(0, 10);
    const levels = [...asks, ...bids];
    if (levels.some(level => level.rawExact !== true || !level.rawPrice || !level.rawQuantity)) return true;
    const input = levels.map(level => `${krakenChecksumToken(level.rawPrice!)}${krakenChecksumToken(level.rawQuantity!)}`).join('');
    return crc32Ascii(input) === expected;
  }
}

class CexOrderBookStreamManager {
  private readonly streams = new Map<string, SymbolStreamState>();
  private readonly standbyBooks = new Map<string, SequencedOrderBook>();
  private readonly connections = new Map<CexStreamVenue, VenueConnectionState>();
  private readonly standbyConnections = new Map<CexStreamVenue, VenueConnectionState>();
  private readonly standbyServing = new Set<string>();
  private readonly identityInFlight = new Map<string, Promise<StreamIdentity>>();
  private readonly stats: Omit<CexOrderBookStreamStats, 'activeStreams' | 'activeConnections' | 'activeStandbyConnections'> = {
    snapshotsApplied: 0,
    deltasApplied: 0,
    deltasQueued: 0,
    staleDeltasRejected: 0,
    sequenceGaps: 0,
    integrityFailures: 0,
    staleResets: 0,
    framesReceived: 0,
    standbyFramesReceived: 0,
    standbyHandovers: 0,
    controlMessages: 0,
    connectionsOpened: 0,
    reconnects: 0,
    proactiveReconnects: 0,
    heartbeatTimeouts: 0,
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

    const key = `${venue}:${state.symbol}`;
    const standby = this.hotStandbyEnabled() ? this.standbyBooks.get(key) : null;
    if (state.book.isStale(maxAgeMs)) {
      this.stats.staleResets += 1;
      state.book.reset();
      this.refreshSubscription(venue, state.symbol, 'primary');
      if (standby?.isFresh(maxAgeMs)) return this.serveStandby(key, venue, state.symbol, standby);
      return null;
    }
    if (state.book.isFresh(maxAgeMs)) {
      this.standbyServing.delete(key);
      return state.book.getQuote(venue, state.symbol);
    }
    if (standby?.isFresh(maxAgeMs)) return this.serveStandby(key, venue, state.symbol, standby);
    return null;
  }

  stop(): void {
    for (const connection of [...this.connections.values(), ...this.standbyConnections.values()]) {
      connection.stopped = true;
      if (connection.reconnectTimer) clearTimeout(connection.reconnectTimer);
      if (connection.heartbeatTimer) clearInterval(connection.heartbeatTimer);
      connection.socket?.close();
    }
    this.connections.clear();
    this.standbyConnections.clear();
    this.streams.clear();
    this.standbyBooks.clear();
    this.standbyServing.clear();
    this.identityInFlight.clear();
  }

  getStats(): Readonly<CexOrderBookStreamStats> {
    return {
      activeStreams: this.streams.size,
      activeConnections: [...this.connections.values()].filter(connection => connection.socket?.readyState === WebSocket.OPEN).length,
      activeStandbyConnections: [...this.standbyConnections.values()].filter(connection => connection.socket?.readyState === WebSocket.OPEN).length,
      ...this.stats,
    };
  }

  private serveStandby(
    key: string,
    venue: CexStreamVenue,
    symbol: string,
    book: SequencedOrderBook,
  ): StreamOrderBookQuote | null {
    const quote = book.getQuote(venue, symbol);
    if (!quote) return null;
    if (!this.standbyServing.has(key)) {
      this.standbyServing.add(key);
      this.stats.standbyHandovers += 1;
      logger.warn('[CexOrderBookStream] hot standby assumed quote service while primary recovers', {
        component: 'CexOrderBookStream',
        venue,
        symbol,
        marketDataAuthority: 'cex_order_book_stream',
        handoverAuthority: 'fresh_exchange_snapshot_only',
        syntheticBookAllowed: false,
        executionAuthorityChanged: false,
      });
    }
    return quote;
  }

  private ensureStream(venue: CexStreamVenue, identity: StreamIdentity): SymbolStreamState {
    const key = `${venue}:${identity.canonicalSymbol}`;
    const existing = this.streams.get(key);
    if (existing) return existing;

    const state: SymbolStreamState = {
      venue,
      symbol: identity.canonicalSymbol,
      externalSymbol: identity.externalSymbol,
      book: new SequencedOrderBook(venue, venue === 'kraken' ? KRAKEN_BOOK_DEPTH : MAX_LEVELS),
    };
    this.streams.set(key, state);
    this.attachSymbol(this.ensureConnection(venue, 'primary'), identity);

    if (this.hotStandbyEnabled()) {
      this.standbyBooks.set(key, new SequencedOrderBook(venue, venue === 'kraken' ? KRAKEN_BOOK_DEPTH : MAX_LEVELS));
      this.attachSymbol(this.ensureConnection(venue, 'standby'), identity);
    }
    return state;
  }

  private attachSymbol(connection: VenueConnectionState, identity: StreamIdentity): void {
    connection.symbols.set(identity.canonicalSymbol, identity.externalSymbol);
    connection.canonicalByExternal.set(externalKey(identity.externalSymbol), identity.canonicalSymbol);
    if (connection.socket?.readyState === WebSocket.OPEN) {
      this.send(connection.socket, this.subscription(connection.venue, [identity.externalSymbol]), connection.venue, `${connection.lane}_subscribe`);
    }
  }

  private ensureConnection(venue: CexStreamVenue, lane: CexStreamLane): VenueConnectionState {
    const registry = lane === 'primary' ? this.connections : this.standbyConnections;
    const existing = registry.get(venue);
    if (existing) return existing;
    const connection: VenueConnectionState = {
      venue,
      lane,
      socket: null,
      symbols: new Map<string, string>(),
      canonicalByExternal: new Map<string, string>(),
      reconnectTimer: null,
      heartbeatTimer: null,
      reconnectAttempts: 0,
      lastMessageAt: Date.now(),
      awaitingPongAt: null,
      stopped: false,
    };
    registry.set(venue, connection);
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
    const socket = new WebSocket(endpoint, {
      perMessageDeflate: false,
      handshakeTimeout: 10_000,
      maxPayload: MAX_WS_PAYLOAD_BYTES,
    });
    connection.socket = socket;

    socket.once('open', () => {
      this.stats.connectionsOpened += 1;
      if (connection.reconnectAttempts > 0) this.stats.reconnects += 1;
      connection.reconnectAttempts = 0;
      connection.lastMessageAt = Date.now();
      connection.awaitingPongAt = null;
      this.startLiveness(connection, socket);
      logger.info('[CexOrderBookStream] venue market-data stream connected', {
        component: 'CexOrderBookStream',
        venue: connection.venue,
        lane: connection.lane,
        endpoint,
        productIdentityAuthority: 'live_exchange_product_catalog',
        quoteCurrencyAllowlistUsed: false,
        coinbaseAdvancedTrade: connection.venue === 'coinbase',
        regionalExecutionAlignment: connection.venue === 'okx' ? 'rest_base_to_public_ws_region' : 'native_venue_endpoint',
        antennaHotPath: true,
        websocketCompression: false,
        marketDataAuthority: 'cex_order_book_stream',
        standbyExecutionAuthority: false,
        antennaExecutionAuthority: false,
      });
      const externalSymbols = [...connection.symbols.values()];
      if (externalSymbols.length > 0) {
        this.send(socket, this.subscription(connection.venue, externalSymbols), connection.venue, `${connection.lane}_subscribe`);
        if (connection.venue === 'coinbase') {
          this.send(socket, { type: 'subscribe', channel: 'heartbeats' }, connection.venue, `${connection.lane}_heartbeat_subscribe`);
        }
      }
    });

    socket.on('message', data => {
      if (connection.lane === 'primary') this.stats.framesReceived += 1;
      else this.stats.standbyFramesReceived += 1;
      connection.lastMessageAt = Date.now();
      const raw = data.toString();
      if (connection.venue === 'okx' && raw === 'pong') {
        connection.awaitingPongAt = null;
        this.stats.controlMessages += 1;
        return;
      }
      try {
        const decoded = omniAntennaLayer.executeHotPathSync(TaskType.ORDER_BOOK_FRAME, () => {
          const payload = JSON.parse(raw) as Record<string, unknown>;
          return { payload, parsed: parseMessages(connection.venue, payload) };
        });
        const payload = decoded.payload;
        if (connection.venue === 'kraken' && payload.method === 'pong') {
          connection.awaitingPongAt = null;
          this.stats.controlMessages += 1;
          return;
        }
        if (
          connection.venue === 'okx' &&
          payload.event === 'notice' &&
          String(payload.code || '') === '64008'
        ) {
          this.stats.controlMessages += 1;
          this.stats.proactiveReconnects += 1;
          logger.info('[CexOrderBookStream] OKX service-upgrade notice received; reconnecting proactively', {
            component: 'CexOrderBookStream',
            venue: connection.venue,
            lane: connection.lane,
            code: payload.code,
          });
          socket.close();
          return;
        }

        for (const parsed of decoded.parsed) {
          const canonical = connection.canonicalByExternal.get(externalKey(parsed.externalSymbol))
            || canonicalCompactSymbol(parsed.externalSymbol);
          if (!canonical) continue;
          const key = `${connection.venue}:${canonical}`;
          const state = this.streams.get(key);
          if (!state) continue;
          const book = connection.lane === 'primary' ? state.book : this.standbyBooks.get(key);
          if (!book) continue;
          const result = omniAntennaLayer.executeHotPathSync(
            TaskType.ORDER_BOOK_APPLY,
            () => book.apply(parsed.message),
          );
          if (connection.lane === 'primary') {
            if (parsed.message.kind === 'snapshot' && result === 'applied') this.stats.snapshotsApplied += 1;
            else if (result === 'applied') this.stats.deltasApplied += 1;
            else if (result === 'queued') this.stats.deltasQueued += 1;
            else if (result === 'stale') this.stats.staleDeltasRejected += 1;
          }
          if (result === 'gap' || result === 'integrity') {
            if (result === 'gap') this.stats.sequenceGaps += 1;
            else this.stats.integrityFailures += 1;
            book.reset();
            this.refreshSubscription(connection.venue, canonical, connection.lane);
          }
        }
      } catch (error) {
        logger.debug('[CexOrderBookStream] ignored invalid message', {
          venue: connection.venue,
          lane: connection.lane,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    });

    socket.once('error', error => {
      this.stats.connectionErrors += 1;
      logger.debug('[CexOrderBookStream] websocket error', {
        venue: connection.venue,
        lane: connection.lane,
        endpoint,
        error: error.message,
      });
    });

    socket.once('close', () => {
      this.stopLiveness(connection);
      if (connection.socket === socket) connection.socket = null;
      this.scheduleReconnect(connection);
    });
  }

  private startLiveness(connection: VenueConnectionState, socket: WebSocket): void {
    this.stopLiveness(connection);
    connection.heartbeatTimer = setInterval(() => {
      if (connection.socket !== socket || socket.readyState !== WebSocket.OPEN) return;
      const now = Date.now();
      if (connection.awaitingPongAt !== null && now - connection.awaitingPongAt > PONG_TIMEOUT_MS) {
        this.stats.heartbeatTimeouts += 1;
        logger.warn('[CexOrderBookStream] websocket heartbeat timed out; reconnecting', {
          component: 'CexOrderBookStream',
          venue: connection.venue,
          lane: connection.lane,
          idleMs: now - connection.lastMessageAt,
        });
        socket.terminate();
        return;
      }
      if (now - connection.lastMessageAt < IDLE_BEFORE_PING_MS) return;

      omniAntennaLayer.executeHotPathSync(TaskType.STREAM_LIVENESS, () => {
        if (connection.venue === 'okx') {
          socket.send('ping');
          connection.awaitingPongAt = now;
          return;
        }
        if (connection.venue === 'kraken') {
          this.send(socket, { method: 'ping', req_id: now }, connection.venue, `${connection.lane}_ping`);
          connection.awaitingPongAt = now;
          return;
        }
        this.stats.heartbeatTimeouts += 1;
        socket.terminate();
      });
    }, LIVENESS_CHECK_MS);
    connection.heartbeatTimer.unref?.();
  }

  private stopLiveness(connection: VenueConnectionState): void {
    if (connection.heartbeatTimer) clearInterval(connection.heartbeatTimer);
    connection.heartbeatTimer = null;
    connection.awaitingPongAt = null;
  }

  private refreshSubscription(venue: CexStreamVenue, canonicalSymbol: string, lane: CexStreamLane = 'primary'): void {
    const registry = lane === 'primary' ? this.connections : this.standbyConnections;
    const connection = registry.get(venue);
    const socket = connection?.socket;
    const externalSymbol = connection?.symbols.get(canonicalSymbol);
    if (!connection || !socket || !externalSymbol || socket.readyState !== WebSocket.OPEN) return;
    this.send(socket, this.unsubscription(venue, [externalSymbol]), venue, `${lane}_unsubscribe`);
    this.send(socket, this.subscription(venue, [externalSymbol]), venue, `${lane}_subscribe`);
  }

  private scheduleReconnect(connection: VenueConnectionState): void {
    if (connection.stopped || connection.reconnectTimer) return;
    connection.reconnectAttempts += 1;
    const exponential = Math.min(30_000, DEFAULT_RECONNECT_DELAY_MS * 2 ** Math.min(connection.reconnectAttempts - 1, 5));
    const jitter = 0.8 + Math.random() * 0.4;
    const delay = Math.max(250, Math.round(exponential * jitter));
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
      return { method: 'subscribe', params: { channel: 'book', symbol: externalSymbols, depth: KRAKEN_BOOK_DEPTH, snapshot: true } };
    }
    return { op: 'subscribe', args: externalSymbols.map(instId => ({ channel: 'books', instId })) };
  }

  private unsubscription(venue: CexStreamVenue, externalSymbols: string[]): Record<string, unknown> {
    if (venue === 'coinbase') {
      return { type: 'unsubscribe', product_ids: externalSymbols, channel: 'level2' };
    }
    if (venue === 'kraken') {
      return { method: 'unsubscribe', params: { channel: 'book', symbol: externalSymbols, depth: KRAKEN_BOOK_DEPTH } };
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

  private hotStandbyEnabled(): boolean {
    return process.env.CRYPTO_CEX_HOT_STANDBY_ENABLED?.trim().toLowerCase() !== 'false';
  }

  private staleMs(): number {
    const configured = Number(process.env.CRYPTO_CEX_STREAM_STALE_MS);
    return Number.isFinite(configured) && configured >= 1_000 ? configured : DEFAULT_STALE_MS;
  }
}

export const cexOrderBookStreams = new CexOrderBookStreamManager();

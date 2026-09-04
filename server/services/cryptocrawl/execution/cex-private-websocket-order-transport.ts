import { createHmac, randomUUID } from 'node:crypto';
import WebSocket from 'ws';
import logger from '../../../logger.js';
import {
  getOkxExecutionRestBaseUrl,
  krakenPrivateRequest,
} from '../intelligence/cex-private-authority.js';
import { cexDecimalString } from './cex-order-serialization.js';
import { getSpotProductConstraints } from './cex-spot-product-policy.js';
import type { CexOrderReceipt, OrderRequest } from './cex-settlement.js';

export type PrivateCexOrderTimeInForce = 'ioc' | 'fok';

export interface PreparedPrivateCexOrder {
  venue: 'kraken' | 'okx';
  timeInForce: PrivateCexOrderTimeInForce;
  preparedAt: number;
  transport: 'websocket';
  dispatch(): Promise<CexOrderReceipt>;
}

type PendingRequest = {
  sent: boolean;
  resolve: (payload: Record<string, any>) => void;
  reject: (error: Error) => void;
  timeout: NodeJS.Timeout;
};

const REQUEST_TIMEOUT_MS = boundedInt(process.env.CRYPTO_CEX_PRIVATE_WS_ORDER_TIMEOUT_MS, 3_000, 500, 10_000);
const ORDER_EXPIRY_MS = boundedInt(process.env.CRYPTO_CEX_PRIVATE_WS_ORDER_EXPIRY_MS, 2_000, 500, 5_000);
const CONNECT_TIMEOUT_MS = boundedInt(process.env.CRYPTO_CEX_PRIVATE_WS_CONNECT_TIMEOUT_MS, 5_000, 1_000, 15_000);
const OKX_INSTRUMENT_CODE_TTL_MS = boundedInt(process.env.CRYPTO_OKX_INST_ID_CODE_TTL_MS, 300_000, 30_000, 900_000);

function boundedInt(raw: unknown, fallback: number, min: number, max: number): number {
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? Math.max(min, Math.min(max, Math.trunc(parsed))) : fallback;
}

function visibleCredential(name: string): string {
  const raw = process.env[name]?.trim();
  if (!raw) throw new Error(`${name} is not visible to the private WebSocket order transport`);
  let value = raw;
  if (value.length >= 2 && ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'")))) {
    value = value.slice(1, -1).trim();
  }
  if (!value) throw new Error(`${name} is empty after normalization`);
  return value;
}

function websocketEnabled(): boolean {
  return process.env.CRYPTO_CEX_PRIVATE_WS_ORDER_ENABLED?.trim().toLowerCase() !== 'false';
}

function requestTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs);
    timer.unref?.();
    promise.then(
      value => { clearTimeout(timer); resolve(value); },
      error => { clearTimeout(timer); reject(error); },
    );
  });
}

abstract class PersistentPrivateOrderSocket {
  protected socket: WebSocket | null = null;
  protected readyPromise: Promise<void> | null = null;
  protected readonly pending = new Map<string, PendingRequest>();
  protected lastTrafficAt = 0;
  private heartbeatTimer: NodeJS.Timeout | null = null;

  abstract readonly venue: 'kraken' | 'okx';
  protected abstract connectAndAuthenticate(): Promise<WebSocket>;
  protected abstract heartbeat(socket: WebSocket): void;

  async ensureReady(): Promise<void> {
    if (this.socket?.readyState === WebSocket.OPEN) return;
    if (this.readyPromise) return this.readyPromise;
    this.readyPromise = requestTimeout(this.open(), CONNECT_TIMEOUT_MS, `${this.venue} private WebSocket connection`)
      .finally(() => { this.readyPromise = null; });
    return this.readyPromise;
  }

  protected async open(): Promise<void> {
    const socket = await this.connectAndAuthenticate();
    this.socket = socket;
    this.lastTrafficAt = Date.now();
    this.startHeartbeat(socket);
    socket.on('close', () => this.handleClose(socket, 'closed'));
    socket.on('error', error => {
      logger.debug('[CEX Private WS] socket error', {
        component: 'CexPrivateWebSocketOrderTransport',
        venue: this.venue,
        error: error.message,
        secretsLogged: false,
      });
    });
    logger.info('[CEX Private WS] authenticated order transport ready', {
      component: 'CexPrivateWebSocketOrderTransport',
      venue: this.venue,
      role: 'submission_transport_only',
      settlementAuthority: false,
      economicAuthority: false,
      retryAfterAmbiguousSend: false,
    });
  }

  protected installFrameRouter(socket: WebSocket, onPayload?: (payload: Record<string, any>) => boolean): void {
    socket.on('message', data => {
      this.lastTrafficAt = Date.now();
      const raw = data.toString();
      if (raw === 'pong') return;
      let payload: Record<string, any>;
      try {
        payload = JSON.parse(raw);
      } catch {
        return;
      }
      if (onPayload?.(payload)) return;
      const key = this.responseKey(payload);
      if (!key) return;
      const pending = this.pending.get(key);
      if (!pending) return;
      clearTimeout(pending.timeout);
      this.pending.delete(key);
      pending.resolve(payload);
    });
  }

  protected abstract responseKey(payload: Record<string, any>): string | null;

  protected sendAndWait(socket: WebSocket, key: string, payload: Record<string, unknown>): Promise<Record<string, any>> {
    if (socket !== this.socket || socket.readyState !== WebSocket.OPEN) {
      throw new Error(`${this.venue} private WebSocket is not ready at dispatch`);
    }
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        const pending = this.pending.get(key);
        this.pending.delete(key);
        reject(new Error(
          pending?.sent
            ? `${this.venue} WebSocket order acknowledgement timed out after send; outcome is ambiguous and REST fallback is forbidden`
            : `${this.venue} WebSocket order acknowledgement timed out before send`,
        ));
      }, REQUEST_TIMEOUT_MS);
      timeout.unref?.();
      const entry: PendingRequest = { sent: false, resolve, reject, timeout };
      this.pending.set(key, entry);
      try {
        socket.send(JSON.stringify(payload), error => {
          if (!error) {
            entry.sent = true;
            this.lastTrafficAt = Date.now();
            return;
          }
          clearTimeout(timeout);
          this.pending.delete(key);
          reject(new Error(`${this.venue} WebSocket order send failed before acknowledgement: ${error.message}`));
        });
      } catch (error) {
        clearTimeout(timeout);
        this.pending.delete(key);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  private startHeartbeat(socket: WebSocket): void {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = setInterval(() => {
      if (socket !== this.socket || socket.readyState !== WebSocket.OPEN) return;
      if (Date.now() - this.lastTrafficAt < 20_000) return;
      try {
        this.heartbeat(socket);
      } catch {
        socket.terminate();
      }
    }, 5_000);
    this.heartbeatTimer.unref?.();
  }

  private handleClose(socket: WebSocket, reason: string): void {
    if (socket !== this.socket) return;
    this.socket = null;
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = null;
    for (const [key, pending] of this.pending) {
      clearTimeout(pending.timeout);
      pending.reject(new Error(
        pending.sent
          ? `${this.venue} private WebSocket ${reason} after order send; outcome is ambiguous and duplicate fallback is forbidden`
          : `${this.venue} private WebSocket ${reason} before order send`,
      ));
      this.pending.delete(key);
    }
  }
}

class KrakenPrivateOrderSocket extends PersistentPrivateOrderSocket {
  readonly venue = 'kraken' as const;
  private token: string | null = null;
  private requestSequence = Math.max(1, Date.now() % 2_000_000_000);

  protected async connectAndAuthenticate(): Promise<WebSocket> {
    // WebSocket tokens are minted through the existing Kraken REST nonce/signing
    // authority. The WS transport never implements an alternate Kraken signer.
    const result = await krakenPrivateRequest('/0/private/GetWebSocketsToken', {}, {
      timeoutMs: CONNECT_TIMEOUT_MS,
      encoding: 'json',
    });
    const token = String(result?.token || '').trim();
    if (!token) throw new Error('Kraken GetWebSocketsToken returned no token');
    this.token = token;

    const endpoint = process.env.KRAKEN_SPOT_WS_AUTH_URL?.trim() || 'wss://ws-auth.kraken.com/v2';
    const socket = new WebSocket(endpoint, {
      perMessageDeflate: false,
      handshakeTimeout: CONNECT_TIMEOUT_MS,
      maxPayload: 1024 * 1024,
    });
    await new Promise<void>((resolve, reject) => {
      const onError = (error: Error) => { cleanup(); reject(error); };
      const onOpen = () => { cleanup(); resolve(); };
      const cleanup = () => {
        socket.off('error', onError);
        socket.off('open', onOpen);
      };
      socket.once('error', onError);
      socket.once('open', onOpen);
    });
    this.installFrameRouter(socket);
    return socket;
  }

  protected responseKey(payload: Record<string, any>): string | null {
    const reqId = payload.req_id;
    return Number.isSafeInteger(reqId) ? String(reqId) : null;
  }

  protected heartbeat(socket: WebSocket): void {
    socket.ping();
    this.lastTrafficAt = Date.now();
  }

  async prepare(request: OrderRequest, timeInForce: PrivateCexOrderTimeInForce): Promise<PreparedPrivateCexOrder> {
    const constraints = await getSpotProductConstraints('kraken', request.symbol, true);
    await this.ensureReady();
    const token = this.token;
    if (!token) throw new Error('Kraken private WebSocket token unavailable after connection preparation');
    const symbol = `${constraints.baseAsset}/${constraints.quoteAsset}`;
    const preparedAt = Date.now();
    return {
      venue: 'kraken',
      timeInForce,
      preparedAt,
      transport: 'websocket',
      dispatch: async () => {
        const socket = this.socket;
        if (!socket || socket.readyState !== WebSocket.OPEN) throw new Error('Kraken private WebSocket unavailable before synchronized dispatch');
        const reqId = ++this.requestSequence;
        const submittedAt = Date.now();
        const clientOrderId = randomUUID().replace(/-/g, '').slice(0, 32);
        const payload = {
          method: 'add_order',
          params: {
            order_type: 'limit',
            side: request.side,
            order_qty: request.quantity,
            symbol,
            limit_price: request.price,
            time_in_force: timeInForce,
            deadline: new Date(submittedAt + Math.max(500, Math.min(60_000, ORDER_EXPIRY_MS))).toISOString(),
            cl_ord_id: clientOrderId,
            token,
          },
          req_id: reqId,
        };
        const response = await this.sendAndWait(socket, String(reqId), payload);
        if (response.success !== true || !response.result?.order_id) {
          throw new Error(`Kraken WebSocket rejected ${timeInForce.toUpperCase()} order: ${String(response.error || 'unknown error')}`);
        }
        return {
          venue: 'kraken',
          orderId: String(response.result.order_id),
          symbol: request.symbol,
          side: request.side,
          requestedQuantity: request.quantity,
          submittedAt,
        };
      },
    };
  }
}

type OkxInstrumentCodeCache = { instIdCode: number; expiresAt: number };

class OkxPrivateOrderSocket extends PersistentPrivateOrderSocket {
  readonly venue = 'okx' as const;
  private readonly instrumentCodes = new Map<string, OkxInstrumentCodeCache>();
  private requestSequence = 0;
  private currentBaseUrl: string | null = null;

  private websocketEndpoint(baseUrl: string): string {
    const explicit = process.env.OKX_PRIVATE_WS_URL?.trim();
    if (explicit) {
      if (!/^wss:\/\//i.test(explicit)) throw new Error('OKX_PRIVATE_WS_URL must be a wss:// URL');
      return explicit;
    }
    const lower = baseUrl.toLowerCase();
    if (lower.includes('us.okx.com')) return 'wss://wsus.okx.com:8443/ws/v5/private';
    if (lower.includes('eea.okx.com')) return 'wss://wseea.okx.com:8443/ws/v5/private';
    return 'wss://ws.okx.com:8443/ws/v5/private';
  }

  protected async connectAndAuthenticate(): Promise<WebSocket> {
    const baseUrl = await getOkxExecutionRestBaseUrl();
    this.currentBaseUrl = baseUrl;
    const endpoint = this.websocketEndpoint(baseUrl);
    const apiKey = visibleCredential('OKX_API_KEY');
    const secret = visibleCredential('OKX_API_SECRET');
    const passphrase = visibleCredential('OKX_API_PASSPHRASE');
    const timestamp = String(Date.now() / 1_000);
    const sign = createHmac('sha256', secret)
      .update(`${timestamp}GET/users/self/verify`)
      .digest('base64');

    const socket = new WebSocket(endpoint, {
      perMessageDeflate: false,
      handshakeTimeout: CONNECT_TIMEOUT_MS,
      maxPayload: 1024 * 1024,
    });
    await new Promise<void>((resolve, reject) => {
      const onError = (error: Error) => { cleanup(); reject(error); };
      const onOpen = () => { cleanup(); resolve(); };
      const cleanup = () => {
        socket.off('error', onError);
        socket.off('open', onOpen);
      };
      socket.once('error', onError);
      socket.once('open', onOpen);
    });

    let loginResolve: (() => void) | null = null;
    let loginReject: ((error: Error) => void) | null = null;
    const loginPromise = new Promise<void>((resolve, reject) => {
      loginResolve = resolve;
      loginReject = reject;
    });
    this.installFrameRouter(socket, payload => {
      if (payload.event === 'login') {
        if (String(payload.code || '') === '0') loginResolve?.();
        else loginReject?.(new Error(`OKX private WebSocket login rejected: ${String(payload.code || '')} ${String(payload.msg || '')}`.trim()));
        return true;
      }
      if (payload.event === 'error' && String(payload.code || '').startsWith('600')) {
        loginReject?.(new Error(`OKX private WebSocket login failed: ${String(payload.code)} ${String(payload.msg || '')}`.trim()));
        return true;
      }
      return false;
    });
    socket.send(JSON.stringify({
      op: 'login',
      args: [{ apiKey, passphrase, timestamp, sign }],
    }));
    await requestTimeout(loginPromise, CONNECT_TIMEOUT_MS, 'OKX private WebSocket login');
    return socket;
  }

  protected responseKey(payload: Record<string, any>): string | null {
    const id = payload.id;
    return typeof id === 'string' || typeof id === 'number' ? String(id) : null;
  }

  protected heartbeat(socket: WebSocket): void {
    socket.send('ping');
    this.lastTrafficAt = Date.now();
  }

  private async getInstIdCode(exchangeSymbol: string): Promise<number> {
    const cached = this.instrumentCodes.get(exchangeSymbol);
    if (cached && cached.expiresAt > Date.now()) return cached.instIdCode;
    const baseUrl = this.currentBaseUrl || await getOkxExecutionRestBaseUrl();
    const response = await fetch(`${baseUrl}/api/v5/public/instruments?instType=SPOT&instId=${encodeURIComponent(exchangeSymbol)}`, {
      headers: { accept: 'application/json', 'cache-control': 'no-cache' },
    });
    if (!response.ok) throw new Error(`OKX instIdCode lookup failed with HTTP ${response.status}`);
    const payload = await response.json() as any;
    if (String(payload?.code) !== '0') throw new Error(`OKX instIdCode lookup failed: ${String(payload?.code)} ${String(payload?.msg || '')}`.trim());
    const row = Array.isArray(payload?.data)
      ? payload.data.find((item: any) => String(item?.instId || '').toUpperCase() === exchangeSymbol.toUpperCase())
      : null;
    const instIdCode = Number(row?.instIdCode);
    if (!Number.isSafeInteger(instIdCode) || instIdCode <= 0) {
      throw new Error(`OKX live instrument ${exchangeSymbol} has no valid instIdCode for WebSocket order entry`);
    }
    this.instrumentCodes.set(exchangeSymbol, { instIdCode, expiresAt: Date.now() + OKX_INSTRUMENT_CODE_TTL_MS });
    return instIdCode;
  }

  async prepare(
    request: OrderRequest,
    timeInForce: PrivateCexOrderTimeInForce,
    options?: { rpiTakerAccess?: boolean },
  ): Promise<PreparedPrivateCexOrder> {
    const constraints = await getSpotProductConstraints('okx', request.symbol, true);
    await this.ensureReady();
    const instIdCode = await this.getInstIdCode(constraints.exchangeSymbol);
    const preparedAt = Date.now();
    return {
      venue: 'okx',
      timeInForce,
      preparedAt,
      transport: 'websocket',
      dispatch: async () => {
        const socket = this.socket;
        if (!socket || socket.readyState !== WebSocket.OPEN) throw new Error('OKX private WebSocket unavailable before synchronized dispatch');
        const submittedAt = Date.now();
        const id = `${submittedAt}${++this.requestSequence}`.slice(-32);
        const clOrdId = randomUUID().replace(/-/g, '').slice(0, 32);
        const payload = {
          id,
          op: 'order',
          expTime: String(submittedAt + ORDER_EXPIRY_MS),
          args: [{
            instIdCode,
            tdMode: 'cash',
            side: request.side,
            ordType: timeInForce,
            px: cexDecimalString(request.price),
            sz: cexDecimalString(request.quantity),
            clOrdId,
            ...(options?.rpiTakerAccess ? { rpiTakerAccess: true } : {}),
          }],
        };
        const response = await this.sendAndWait(socket, id, payload);
        const order = Array.isArray(response.data) ? response.data[0] : null;
        if (String(response.code ?? '0') !== '0' || !order || String(order.sCode ?? '') !== '0' || !order.ordId) {
          throw new Error(`OKX WebSocket rejected ${timeInForce.toUpperCase()} order: ${String(order?.sMsg || response.msg || 'unknown error')}`);
        }
        return {
          venue: 'okx',
          orderId: String(order.ordId),
          symbol: request.symbol,
          side: request.side,
          requestedQuantity: request.quantity,
          submittedAt,
        };
      },
    };
  }
}

const krakenSocket = new KrakenPrivateOrderSocket();
const okxSocket = new OkxPrivateOrderSocket();

/**
 * Prepares all exchange/product/authentication work before the parent execution
 * barrier. Returning null means the caller may safely use its existing REST path
 * because no order message was sent. Once dispatch() is called, ambiguous WS
 * outcomes must never be retried through REST.
 */
export async function preparePrivateCexOrder(input: {
  venue: 'kraken' | 'okx';
  request: OrderRequest;
  timeInForce: PrivateCexOrderTimeInForce;
  rpiTakerAccess?: boolean;
}): Promise<PreparedPrivateCexOrder | null> {
  if (!websocketEnabled()) return null;
  try {
    if (input.venue === 'kraken') return await krakenSocket.prepare(input.request, input.timeInForce);
    return await okxSocket.prepare(input.request, input.timeInForce, { rpiTakerAccess: input.rpiTakerAccess });
  } catch (error) {
    // Preparation occurs before the synchronized dispatch barrier. A REST
    // fallback is therefore safe because no WS order could yet exist.
    logger.warn('[CEX Private WS] preparation unavailable; existing REST order transport retained before any submission', {
      component: 'CexPrivateWebSocketOrderTransport',
      venue: input.venue,
      symbol: input.request.symbol,
      side: input.request.side,
      timeInForce: input.timeInForce,
      error: error instanceof Error ? error.message : String(error),
      websocketOrderSent: false,
      restFallbackSafe: true,
      duplicateSubmissionPossible: false,
    });
    return null;
  }
}

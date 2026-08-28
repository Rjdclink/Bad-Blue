import { createHash, createHmac } from 'crypto';
import logger from '../../../logger.js';
import { isDatabaseConfigured, pool } from '../../../db.js';

const KRAKEN_TIMEOUT_MS = Math.max(3_000, Number(process.env.CRYPTO_KRAKEN_PRIVATE_TIMEOUT_MS || 12_000));
const OKX_TIMEOUT_MS = Math.max(3_000, Number(process.env.CRYPTO_OKX_PRIVATE_TIMEOUT_MS || 12_000));
const OKX_REGION_CACHE_MS = Math.max(60_000, Number(process.env.CRYPTO_OKX_REGION_CACHE_MS || 3_600_000));
const OKX_FEE_MIN_INTERVAL_MS = Math.max(425, Number(process.env.CRYPTO_OKX_FEE_MIN_INTERVAL_MS || 450));
const OKX_ORDER_MIN_INTERVAL_MS = Math.max(0, Number(process.env.CRYPTO_OKX_ORDER_MIN_INTERVAL_MS || 0));
const OKX_ACCOUNT_READ_MIN_INTERVAL_MS = Math.max(0, Number(process.env.CRYPTO_OKX_ACCOUNT_READ_MIN_INTERVAL_MS || 0));

function credential(name: string): string | null {
  const raw = process.env[name];
  if (!raw) return null;
  let value = raw.trim();
  if (value.length >= 2) {
    const first = value[0];
    const last = value[value.length - 1];
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) value = value.slice(1, -1).trim();
  }
  return value || null;
}

function requireCredential(name: string): string {
  const value = credential(name);
  if (!value) throw new Error(`${name} is not visible to the private CEX authority`);
  return value;
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

async function parseJson(response: Response, provider: string): Promise<any> {
  const body = await response.text();
  let payload: any;
  try {
    payload = body ? JSON.parse(body) : {};
  } catch {
    throw new Error(`${provider} private endpoint returned non-JSON (${response.status})`);
  }
  if (!response.ok) {
    const code = payload?.code ?? payload?.error?.[0] ?? response.status;
    const message = payload?.msg || payload?.message || '';
    throw new Error(`${provider} private endpoint failed (${response.status}) code=${String(code)}${message ? ` message=${message}` : ''}`);
  }
  return payload;
}

// ============================================================================
// KRAKEN — one nonce/signing/serialization authority per API key
// ============================================================================

let krakenLastNonce = 0;
let krakenPrivateTail: Promise<void> = Promise.resolve();
let krakenRequestCount = 0;
let krakenDistributedStateReady: Promise<void> | null = null;

function nextKrakenNonce(): string {
  const nonce = Math.max(Date.now(), krakenLastNonce + 1);
  krakenLastNonce = nonce;
  return String(nonce);
}

function signKraken(path: string, body: string, nonce: string, decodedSecret: Buffer): string {
  const hash = createHash('sha256').update(nonce + body).digest();
  return createHmac('sha512', decodedSecret)
    .update(Buffer.concat([Buffer.from(path), hash]))
    .digest('base64');
}

function serializeKrakenPrivate<T>(operation: () => Promise<T>): Promise<T> {
  const run = krakenPrivateTail.catch(() => undefined).then(operation);
  krakenPrivateTail = run.then(() => undefined, () => undefined);
  return run;
}

function krakenKeyFingerprint(apiKey: string): string {
  return createHash('sha256').update(apiKey).digest('hex');
}

async function ensureKrakenDistributedState(): Promise<void> {
  if (!isDatabaseConfigured) return;
  if (krakenDistributedStateReady) return krakenDistributedStateReady;
  krakenDistributedStateReady = (async () => {
    await pool.query('CREATE SCHEMA IF NOT EXISTS private');
    await pool.query(`
      CREATE TABLE IF NOT EXISTS private.cryptocrawler_kraken_nonce_state (
        key_hash text PRIMARY KEY,
        last_nonce bigint NOT NULL,
        updated_at timestamptz NOT NULL DEFAULT now()
      )
    `);
  })().catch(error => {
    krakenDistributedStateReady = null;
    throw error;
  });
  return krakenDistributedStateReady;
}

/**
 * Kraken nonces are an API-key-wide ordering domain, not a process-local one.
 * Hold a PostgreSQL advisory lock across nonce allocation AND the signed network
 * request so separate Railway replicas cannot allocate increasing nonces and
 * then transmit them out of order. In local/no-database development the existing
 * in-process lane is sufficient; when a production database is configured, loss
 * of the distributed lane fails closed rather than weakening nonce safety.
 */
async function withKrakenDistributedLane<T>(
  apiKey: string,
  operation: (nonce: string) => Promise<T>,
): Promise<T> {
  if (!isDatabaseConfigured) return operation(nextKrakenNonce());
  await ensureKrakenDistributedState();

  const keyHash = krakenKeyFingerprint(apiKey);
  const lockName = `cryptocrawl:kraken-private:${keyHash}`;
  const client = await pool.connect();
  let locked = false;
  try {
    await client.query('SELECT pg_advisory_lock(hashtext($1))', [lockName]);
    locked = true;
    const proposed = String(Math.max(Date.now(), krakenLastNonce + 1));
    const allocated = await client.query(
      `INSERT INTO private.cryptocrawler_kraken_nonce_state (key_hash, last_nonce, updated_at)
       VALUES ($1, $2::bigint, now())
       ON CONFLICT (key_hash) DO UPDATE
       SET last_nonce = GREATEST(private.cryptocrawler_kraken_nonce_state.last_nonce + 1, EXCLUDED.last_nonce),
           updated_at = now()
       RETURNING last_nonce`,
      [keyHash, proposed],
    );
    const nonce = String(allocated.rows[0]?.last_nonce || '');
    if (!/^\d+$/.test(nonce)) throw new Error('Distributed Kraken nonce allocation failed');
    const numericNonce = Number(nonce);
    if (Number.isSafeInteger(numericNonce)) krakenLastNonce = Math.max(krakenLastNonce, numericNonce);
    return await operation(nonce);
  } finally {
    if (locked) {
      try { await client.query('SELECT pg_advisory_unlock(hashtext($1))', [lockName]); } catch { /* connection release also clears session lock */ }
    }
    client.release();
  }
}

export async function krakenPrivateRequest(
  path: string,
  parameters: Record<string, string> = {},
  options: { timeoutMs?: number } = {},
): Promise<any> {
  return serializeKrakenPrivate(async () => {
    const apiKey = requireCredential('KRAKEN_API_KEY');
    const apiSecret = requireCredential('KRAKEN_API_SECRET');
    const decodedSecret = Buffer.from(apiSecret, 'base64');
    if (decodedSecret.length === 0) throw new Error('Kraken API secret is not valid base64');

    return withKrakenDistributedLane(apiKey, async nonce => {
      const body = new URLSearchParams({ nonce, ...parameters }).toString();
      const response = await fetchWithTimeout(`https://api.kraken.com${path}`, {
        method: 'POST',
        headers: {
          'API-Key': apiKey,
          'API-Sign': signKraken(path, body, nonce, decodedSecret),
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body,
      }, options.timeoutMs ?? KRAKEN_TIMEOUT_MS);
      const payload = await parseJson(response, 'Kraken');
      if (Array.isArray(payload?.error) && payload.error.length > 0) {
        throw new Error(`Kraken request failed: ${payload.error.join(', ')}`);
      }
      krakenRequestCount += 1;
      return payload?.result ?? {};
    });
  });
}

export function getKrakenPrivateAuthoritySnapshot(): {
  lastNonce: number;
  requestCount: number;
} {
  return { lastNonce: krakenLastNonce, requestCount: krakenRequestCount };
}

// ============================================================================
// OKX — one credential/region authority, endpoint-specific rate lanes
// ============================================================================

export type OkxPrivateLane = 'trade_fee' | 'order_write' | 'order_read' | 'account_read';

export class OkxPrivateApiError extends Error {
  constructor(
    readonly code: string | null,
    readonly baseUrl: string,
    readonly path: string,
    message: string,
  ) {
    super(message);
    this.name = 'OkxPrivateApiError';
  }
}

interface OkxRegionSnapshot {
  baseUrl: string;
  selectedAt: number;
  expiresAt: number;
  source: 'configured_and_authenticated' | 'authenticated_probe';
}

interface OkxLaneState {
  tail: Promise<void>;
  lastStartedAt: number;
  requestCount: number;
}

const okxLanes: Record<OkxPrivateLane, OkxLaneState> = {
  trade_fee: { tail: Promise.resolve(), lastStartedAt: 0, requestCount: 0 },
  order_write: { tail: Promise.resolve(), lastStartedAt: 0, requestCount: 0 },
  order_read: { tail: Promise.resolve(), lastStartedAt: 0, requestCount: 0 },
  account_read: { tail: Promise.resolve(), lastStartedAt: 0, requestCount: 0 },
};

let okxRegion: OkxRegionSnapshot | null = null;
let okxRegionInFlight: Promise<OkxRegionSnapshot> | null = null;

function normalizeOkxBaseUrl(value: string): string {
  const trimmed = value.trim().replace(/\/+$/, '');
  if (!/^https:\/\/[a-z0-9.-]+$/i.test(trimmed)) throw new Error('OKX_API_BASE_URL must be an https origin');
  return trimmed;
}

function okxBaseUrlCandidates(): string[] {
  const configured = credential('OKX_API_BASE_URL');
  if (configured) return [normalizeOkxBaseUrl(configured)];
  return ['https://us.okx.com', 'https://openapi.okx.com'];
}

function laneIntervalMs(lane: OkxPrivateLane): number {
  if (lane === 'trade_fee') return OKX_FEE_MIN_INTERVAL_MS;
  if (lane === 'order_write' || lane === 'order_read') return OKX_ORDER_MIN_INTERVAL_MS;
  return OKX_ACCOUNT_READ_MIN_INTERVAL_MS;
}

function scheduleOkxLane<T>(lane: OkxPrivateLane, operation: () => Promise<T>): Promise<T> {
  const state = okxLanes[lane];
  const run = state.tail.catch(() => undefined).then(async () => {
    const waitMs = Math.max(0, state.lastStartedAt + laneIntervalMs(lane) - Date.now());
    if (waitMs > 0) await new Promise(resolve => setTimeout(resolve, waitMs));
    state.lastStartedAt = Date.now();
    const result = await operation();
    state.requestCount += 1;
    return result;
  });
  state.tail = run.then(() => undefined, () => undefined);
  return run;
}

function inferOkxLane(path: string, method: 'GET' | 'POST'): OkxPrivateLane {
  if (path.startsWith('/api/v5/account/trade-fee')) return 'trade_fee';
  if (path.startsWith('/api/v5/account/')) return 'account_read';
  if (method === 'POST') return 'order_write';
  return 'order_read';
}

async function authenticatedOkxRequestFromBase(
  baseUrl: string,
  path: string,
  method: 'GET' | 'POST',
  parameters: Record<string, string>,
  timeoutMs: number,
): Promise<any> {
  const apiKey = requireCredential('OKX_API_KEY');
  const apiSecret = requireCredential('OKX_API_SECRET');
  const passphrase = requireCredential('OKX_API_PASSPHRASE');
  const query = method === 'GET' ? new URLSearchParams(parameters).toString() : '';
  const requestPath = method === 'GET' && query ? `${path}?${query}` : path;
  const body = method === 'POST' ? JSON.stringify(parameters) : '';
  const timestamp = new Date().toISOString();
  const signature = createHmac('sha256', apiSecret)
    .update(`${timestamp}${method}${requestPath}${body}`)
    .digest('base64');
  const response = await fetchWithTimeout(`${baseUrl}${requestPath}`, {
    method,
    headers: {
      'OK-ACCESS-KEY': apiKey,
      'OK-ACCESS-SIGN': signature,
      'OK-ACCESS-TIMESTAMP': timestamp,
      'OK-ACCESS-PASSPHRASE': passphrase,
      'Content-Type': 'application/json',
    },
    body: method === 'POST' ? body : undefined,
  }, timeoutMs);

  const responseText = await response.text();
  let payload: any;
  try {
    payload = responseText ? JSON.parse(responseText) : {};
  } catch {
    throw new OkxPrivateApiError(null, baseUrl, requestPath, `OKX private endpoint returned non-JSON (${response.status})`);
  }
  const code = payload?.code === undefined || payload?.code === null ? null : String(payload.code);
  if (!response.ok || code !== '0') {
    throw new OkxPrivateApiError(
      code || String(response.status),
      baseUrl,
      requestPath,
      `OKX private request failed: ${code || response.status}${payload?.msg ? ` ${payload.msg}` : ''}`,
    );
  }
  return payload;
}

async function selectOkxRegion(): Promise<OkxRegionSnapshot> {
  if (okxRegion && okxRegion.expiresAt > Date.now()) return okxRegion;
  if (okxRegionInFlight) return okxRegionInFlight;

  okxRegionInFlight = (async () => {
    const configured = Boolean(credential('OKX_API_BASE_URL'));
    const failures: string[] = [];
    for (const baseUrl of okxBaseUrlCandidates()) {
      try {
        await scheduleOkxLane('trade_fee', () => authenticatedOkxRequestFromBase(
          baseUrl,
          '/api/v5/account/trade-fee',
          'GET',
          { instType: 'SPOT' },
          OKX_TIMEOUT_MS,
        ));
        const snapshot: OkxRegionSnapshot = {
          baseUrl,
          selectedAt: Date.now(),
          expiresAt: Date.now() + OKX_REGION_CACHE_MS,
          source: configured ? 'configured_and_authenticated' : 'authenticated_probe',
        };
        okxRegion = snapshot;
        logger.info('[CEX Private] OKX credential region selected', {
          component: 'CexPrivateAuthority',
          baseUrl,
          source: snapshot.source,
        });
        return snapshot;
      } catch (error) {
        failures.push(`${baseUrl}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    throw new Error(`OKX credential-region selection failed: ${failures.join(' | ')}`);
  })().finally(() => { okxRegionInFlight = null; });

  return okxRegionInFlight;
}

export async function getOkxExecutionRestBaseUrl(): Promise<string> {
  return (await selectOkxRegion()).baseUrl;
}

export function getCachedOkxExecutionRestBaseUrl(): string | null {
  if (!okxRegion || okxRegion.expiresAt <= Date.now()) return null;
  return okxRegion.baseUrl;
}

export async function okxPrivateRequest(
  path: string,
  method: 'GET' | 'POST',
  parameters: Record<string, string> = {},
  options: { timeoutMs?: number; lane?: OkxPrivateLane } = {},
): Promise<{ payload: any; data: any[]; baseUrl: string }> {
  const baseUrl = await getOkxExecutionRestBaseUrl();
  const lane = options.lane || inferOkxLane(path, method);
  const payload = await scheduleOkxLane(lane, () => authenticatedOkxRequestFromBase(
    baseUrl,
    path,
    method,
    parameters,
    options.timeoutMs ?? OKX_TIMEOUT_MS,
  ));
  return {
    payload,
    data: Array.isArray(payload?.data) ? payload.data : [],
    baseUrl,
  };
}

export function getOkxPrivateAuthoritySnapshot(): {
  baseUrl: string | null;
  regionSource: OkxRegionSnapshot['source'] | null;
  regionExpiresAt: number | null;
  lanes: Record<OkxPrivateLane, { requestCount: number; lastStartedAt: number; minIntervalMs: number }>;
} {
  return {
    baseUrl: getCachedOkxExecutionRestBaseUrl(),
    regionSource: okxRegion?.source || null,
    regionExpiresAt: okxRegion?.expiresAt || null,
    lanes: Object.fromEntries(
      (Object.keys(okxLanes) as OkxPrivateLane[]).map(lane => [lane, {
        requestCount: okxLanes[lane].requestCount,
        lastStartedAt: okxLanes[lane].lastStartedAt,
        minIntervalMs: laneIntervalMs(lane),
      }]),
    ) as Record<OkxPrivateLane, { requestCount: number; lastStartedAt: number; minIntervalMs: number }>,
  };
}
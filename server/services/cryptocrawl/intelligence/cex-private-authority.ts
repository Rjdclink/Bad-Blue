import { createHash, createHmac } from 'crypto';
import type { PoolClient } from 'pg';
import logger from '../../../logger.js';
import { isDatabaseConfigured } from '../../../db.js';
import {
  isCoordinationDatabaseConfigured,
  queryCoordinationDatabase,
  withDatabaseSessionAdvisoryLock,
} from '../runtime/database-coordination.js';

function finiteEnvNumber(name: string, fallback: number, min: number, max: number): number {
  const parsed = Number(process.env[name]);
  const value = Number.isFinite(parsed) ? parsed : fallback;
  return Math.max(min, Math.min(max, value));
}

const KRAKEN_TIMEOUT_MS = Math.max(3_000, Number(process.env.CRYPTO_KRAKEN_PRIVATE_TIMEOUT_MS || 12_000));
const KRAKEN_DB_BREAKER_BASE_MS = finiteEnvNumber('CRYPTO_KRAKEN_DB_BREAKER_BASE_MS', 5_000, 1_000, 60_000);
const KRAKEN_DB_BREAKER_MAX_MS = finiteEnvNumber('CRYPTO_KRAKEN_DB_BREAKER_MAX_MS', 60_000, 5_000, 300_000);
const KRAKEN_LOCK_ACQUIRE_TIMEOUT_MS = finiteEnvNumber('CRYPTO_KRAKEN_LOCK_ACQUIRE_TIMEOUT_MS', 6_000, 250, 30_000);
const OKX_TIMEOUT_MS = Math.max(3_000, Number(process.env.CRYPTO_OKX_PRIVATE_TIMEOUT_MS || 12_000));
const OKX_REGION_CACHE_MS = Math.max(60_000, Number(process.env.CRYPTO_OKX_REGION_CACHE_MS || 3_600_000));
const OKX_FEE_MIN_INTERVAL_MS = Math.max(425, Number(process.env.CRYPTO_OKX_FEE_MIN_INTERVAL_MS || 450));
const OKX_ORDER_MIN_INTERVAL_MS = Math.max(0, Number(process.env.CRYPTO_OKX_ORDER_MIN_INTERVAL_MS || 0));
const OKX_ACCOUNT_READ_MIN_INTERVAL_MS = Math.max(0, Number(process.env.CRYPTO_OKX_ACCOUNT_READ_MIN_INTERVAL_MS || 0));
const OKX_RATE_RETRY_BASE_MS = finiteEnvNumber('CRYPTO_OKX_RATE_RETRY_BASE_MS', 1_000, 100, 30_000);
const OKX_RATE_RETRY_MAX_MS = finiteEnvNumber('CRYPTO_OKX_RATE_RETRY_MAX_MS', 30_000, 1_000, 120_000);
const OKX_RATE_MAX_RETRIES = Math.floor(finiteEnvNumber('CRYPTO_OKX_RATE_MAX_RETRIES', 5, 0, 8));
const OKX_RATE_BREAKER_MS = finiteEnvNumber('CRYPTO_OKX_RATE_BREAKER_MS', 30_000, 1_000, 300_000);
const OKX_DISTRIBUTED_RATE_LOCK_TIMEOUT_MS = finiteEnvNumber('CRYPTO_OKX_DISTRIBUTED_RATE_LOCK_TIMEOUT_MS', 7_500, 500, 30_000);
const OKX_REPLICA_SAFETY_FACTOR = Math.floor(finiteEnvNumber('CRYPTO_OKX_REPLICA_SAFETY_FACTOR', 4, 1, 16));

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

function fingerprint(value: string): string {
  return createHash('sha256').update(value).digest('hex');
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

function sleep(ms: number): Promise<void> {
  return ms > 0 ? new Promise(resolve => setTimeout(resolve, ms)) : Promise.resolve();
}

// ============================================================================
// KRAKEN — one nonce/signing/serialization authority per API key
// ============================================================================

let krakenLastNonce = 0;
let krakenPrivateTail: Promise<void> = Promise.resolve();
let krakenRequestCount = 0;
let krakenDistributedStateReady: Promise<void> | null = null;
let krakenDbFailureCount = 0;
let krakenDbBreakerOpenUntil = 0;
let krakenDbLastError: string | null = null;
let krakenLockContentionCount = 0;
let krakenLockTimeoutCount = 0;
let krakenLastLockWaitMs = 0;

class KrakenLockBusyError extends Error {
  constructor(readonly waitedMs: number) {
    super(`Kraken distributed nonce lane busy after ${waitedMs}ms; fail-closed and retry on a later hydration cycle`);
    this.name = 'KrakenLockBusyError';
  }
}

class KrakenPostCoordinationError extends Error {
  constructor(readonly causeError: unknown) {
    super(causeError instanceof Error ? causeError.message : String(causeError));
    this.name = 'KrakenPostCoordinationError';
  }
}

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

function krakenDatabaseBackoffMs(): number {
  return Math.min(
    KRAKEN_DB_BREAKER_MAX_MS,
    KRAKEN_DB_BREAKER_BASE_MS * Math.pow(2, Math.max(0, krakenDbFailureCount - 1)),
  );
}

function recordKrakenDatabaseFailure(error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  krakenDbFailureCount += 1;
  krakenDbLastError = message;
  krakenDbBreakerOpenUntil = Date.now() + krakenDatabaseBackoffMs();
  logger.warn('[CEX Private] Kraken distributed nonce database lane degraded; private requests fail closed until retry window', {
    component: 'CexPrivateAuthority',
    consecutiveDatabaseFailures: krakenDbFailureCount,
    breakerOpenUntil: krakenDbBreakerOpenUntil,
    retryInMs: Math.max(0, krakenDbBreakerOpenUntil - Date.now()),
    error: message,
    localNonceFallbackAllowed: false,
  });
}

function recordKrakenDatabaseSuccess(): void {
  krakenDbFailureCount = 0;
  krakenDbBreakerOpenUntil = 0;
  krakenDbLastError = null;
}

function assertKrakenDatabaseLaneAvailable(): void {
  const retryInMs = Math.max(0, krakenDbBreakerOpenUntil - Date.now());
  if (retryInMs > 0) {
    throw new Error(`Kraken distributed nonce database circuit open; fail-closed retry in ${retryInMs}ms`);
  }
}

async function ensureKrakenDistributedState(): Promise<void> {
  if (!isDatabaseConfigured) return;
  assertKrakenDatabaseLaneAvailable();
  if (krakenDistributedStateReady) return krakenDistributedStateReady;

  krakenDistributedStateReady = (async () => {
    try {
      const result = await queryCoordinationDatabase(
        `SELECT to_regclass('private.cryptocrawler_kraken_nonce_state') IS NOT NULL AS ready`,
      );
      if (result.rows?.[0]?.ready !== true) {
        throw new Error('Migration-owned private.cryptocrawler_kraken_nonce_state is missing');
      }
      recordKrakenDatabaseSuccess();
    } catch (error) {
      recordKrakenDatabaseFailure(error);
      throw error;
    }
  })().catch(error => {
    krakenDistributedStateReady = null;
    throw error;
  });
  return krakenDistributedStateReady;
}

async function acquireKrakenDistributedLock(client: PoolClient, lockName: string): Promise<void> {
  const startedAt = Date.now();
  const deadline = startedAt + KRAKEN_LOCK_MAX_WAIT_MS;
  while (true) {
    const result = await client.query('SELECT pg_try_advisory_lock(hashtext($1)) AS locked', [lockName]);
    if (result.rows?.[0]?.locked === true) {
      krakenLastLockWaitMs = Math.max(0, Date.now() - startedAt);
      return;
    }

    krakenLockContentionCount += 1;
    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0) {
      krakenLockTimeoutCount += 1;
      krakenLastLockWaitMs = Math.max(0, Date.now() - startedAt);
      logger.warn('[CEX Private] Kraken distributed nonce lane busy; request deferred without blocking an advisory-lock wait queue', {
        component: 'CexPrivateAuthority',
        waitedMs: krakenLastLockWaitMs,
        contentionCount: krakenLockContentionCount,
        timeoutCount: krakenLockTimeoutCount,
        blockingAdvisoryLockUsed: false,
        localNonceFallbackAllowed: false,
      });
      throw new KrakenLockBusyError(krakenLastLockWaitMs);
    }

    const pollMs = Math.min(KRAKEN_LOCK_POLL_MS, remainingMs);
    const lowMs = Math.max(10, Math.floor(pollMs / 2));
    const jitterMs = Math.floor(Math.random() * Math.max(1, pollMs - lowMs + 1));
    await new Promise(resolve => setTimeout(resolve, Math.min(remainingMs, lowMs + jitterMs)));
  }
}

/**
 * Kraken nonce ordering is API-key-wide. The same dedicated session lock covers
 * durable nonce allocation and physical network submission, but schema ownership
 * stays entirely with migrations. Bounded try-lock acquisition prevents a blocked
 * replica from consuming an ordinary application DB session indefinitely.
 */
async function withKrakenDistributedLane<T>(
  apiKey: string,
  operation: (nonce: string) => Promise<T>,
): Promise<T> {
  if (!isDatabaseConfigured) return operation(nextKrakenNonce());
  assertKrakenDatabaseLaneAvailable();
  await ensureKrakenDistributedState();
  assertKrakenDatabaseLaneAvailable();

  const keyHash = fingerprint(apiKey);
  const lockName = `cryptocrawl:kraken-private:${keyHash}`;
  try {
    return await withDatabaseSessionAdvisoryLock(lockName, async client => {
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
      recordKrakenDatabaseSuccess();

      // Network/exchange failures occur after nonce authority is proven. Keep the
      // session lock until submission finishes, but never misclassify those errors
      // as database failures or open the database breaker.
      try {
        return await operation(nonce);
      } catch (error) {
        throw new KrakenPostCoordinationError(error);
      }
    }, { acquireTimeoutMs: KRAKEN_LOCK_ACQUIRE_TIMEOUT_MS });
  } catch (error) {
    if (error instanceof KrakenPostCoordinationError) throw error.causeError;
    recordKrakenDatabaseFailure(error);
    throw error;
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
  databaseBreakerOpenUntil: number;
  databaseConsecutiveFailures: number;
  databaseLastError: string | null;
  lockContentionCount: number;
  lockTimeoutCount: number;
  lastLockWaitMs: number;
} {
  return {
    lastNonce: krakenLastNonce,
    requestCount: krakenRequestCount,
    databaseBreakerOpenUntil: krakenDbBreakerOpenUntil,
    databaseConsecutiveFailures: krakenDbFailureCount,
    databaseLastError: krakenDbLastError,
    lockContentionCount: krakenLockContentionCount,
    lockTimeoutCount: krakenLockTimeoutCount,
    lastLockWaitMs: krakenLastLockWaitMs,
  };
}

// ============================================================================
// OKX — one credential/region authority, adaptive endpoint-specific rate lanes
// ============================================================================

export type OkxPrivateLane = 'trade_fee' | 'order_write' | 'order_read' | 'account_read';

export class OkxPrivateApiError extends Error {
  constructor(
    readonly code: string | null,
    readonly baseUrl: string,
    readonly path: string,
    message: string,
    readonly retryAfterMs: number | null = null,
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

interface OkxLanePolicy {
  capacity: number;
  windowMs: number;
  priority: number;
}

interface OkxLaneState {
  tail: Promise<void>;
  lastStartedAt: number;
  requestCount: number;
  tokens: number;
  lastRefillAt: number;
  cooldownUntil: number;
  breakerOpenUntil: number;
  consecutiveRateLimits: number;
  rateLimitCount: number;
  retryCount: number;
}

interface OkxLaneSnapshot {
  requestCount: number;
  lastStartedAt: number;
  minIntervalMs: number;
  capacity: number;
  windowMs: number;
  priority: number;
  tokens: number;
  cooldownUntil: number;
  breakerOpenUntil: number;
  consecutiveRateLimits: number;
  rateLimitCount: number;
  retryCount: number;
  distributedPacing: boolean;
}

const OKX_LANE_POLICIES: Record<OkxPrivateLane, OkxLanePolicy> = {
  trade_fee: {
    // OKX documents this endpoint at 5 requests / 2 seconds per User ID.
    // Never let an environment override expand beyond the venue's authority.
    capacity: finiteEnvNumber('CRYPTO_OKX_FEE_BUCKET_CAPACITY', 5, 1, 5),
    windowMs: finiteEnvNumber('CRYPTO_OKX_FEE_BUCKET_WINDOW_MS', 2_000, 2_000, 60_000),
    priority: 10,
  },
  order_write: {
    capacity: finiteEnvNumber('CRYPTO_OKX_ORDER_BUCKET_CAPACITY', 60, 1, 300),
    windowMs: finiteEnvNumber('CRYPTO_OKX_ORDER_BUCKET_WINDOW_MS', 2_000, 500, 60_000),
    priority: 100,
  },
  order_read: {
    capacity: finiteEnvNumber('CRYPTO_OKX_ORDER_READ_BUCKET_CAPACITY', 20, 1, 100),
    windowMs: finiteEnvNumber('CRYPTO_OKX_ORDER_READ_BUCKET_WINDOW_MS', 2_000, 500, 60_000),
    priority: 80,
  },
  account_read: {
    capacity: finiteEnvNumber('CRYPTO_OKX_ACCOUNT_BUCKET_CAPACITY', 10, 1, 100),
    windowMs: finiteEnvNumber('CRYPTO_OKX_ACCOUNT_BUCKET_WINDOW_MS', 2_000, 500, 60_000),
    priority: 30,
  },
};

function initialLaneState(lane: OkxPrivateLane): OkxLaneState {
  return {
    tail: Promise.resolve(),
    lastStartedAt: 0,
    requestCount: 0,
    tokens: OKX_LANE_POLICIES[lane].capacity,
    lastRefillAt: Date.now(),
    cooldownUntil: 0,
    breakerOpenUntil: 0,
    consecutiveRateLimits: 0,
    rateLimitCount: 0,
    retryCount: 0,
  };
}

const okxLanes: Record<OkxPrivateLane, OkxLaneState> = {
  trade_fee: initialLaneState('trade_fee'),
  order_write: initialLaneState('order_write'),
  order_read: initialLaneState('order_read'),
  account_read: initialLaneState('account_read'),
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
  if (lane === 'trade_fee') {
    if (!isDatabaseConfigured) return OKX_FEE_MIN_INTERVAL_MS;
    return isCoordinationDatabaseConfigured
      ? OKX_FEE_MIN_INTERVAL_MS
      : OKX_FEE_MIN_INTERVAL_MS * OKX_REPLICA_SAFETY_FACTOR;
  }
  if (lane === 'order_write' || lane === 'order_read') return OKX_ORDER_MIN_INTERVAL_MS;
  return OKX_ACCOUNT_READ_MIN_INTERVAL_MS;
}

function refillLane(lane: OkxPrivateLane, now = Date.now()): void {
  const state = okxLanes[lane];
  const policy = OKX_LANE_POLICIES[lane];
  const elapsed = Math.max(0, now - state.lastRefillAt);
  if (elapsed <= 0) return;
  const refill = elapsed * policy.capacity / policy.windowMs;
  state.tokens = Math.min(policy.capacity, state.tokens + refill);
  state.lastRefillAt = now;
}

async function acquireOkxToken(lane: OkxPrivateLane): Promise<void> {
  const state = okxLanes[lane];
  const policy = OKX_LANE_POLICIES[lane];
  while (true) {
    const now = Date.now();
    if (state.breakerOpenUntil > now) {
      await sleep(state.breakerOpenUntil - now);
      continue;
    }
    if (state.cooldownUntil > now) {
      await sleep(state.cooldownUntil - now);
      continue;
    }
    refillLane(lane, now);
    if (state.tokens >= 1) {
      state.tokens -= 1;
      return;
    }
    const msPerToken = policy.windowMs / policy.capacity;
    await sleep(Math.max(1, Math.ceil((1 - state.tokens) * msPerToken)));
  }
}

async function executeStartedLaneOperation<T>(lane: OkxPrivateLane, operation: () => Promise<T>): Promise<T> {
  const state = okxLanes[lane];
  const intervalMs = laneIntervalMs(lane);
  const waitMs = Math.max(0, state.lastStartedAt + intervalMs - Date.now());
  if (waitMs > 0) await sleep(waitMs);
  const startedAt = Date.now();
  state.lastStartedAt = startedAt;
  const result = await operation();

  if (lane === 'trade_fee' && isCoordinationDatabaseConfigured) {
    await sleep(Math.max(0, startedAt + OKX_FEE_MIN_INTERVAL_MS - Date.now()));
  }
  state.requestCount += 1;
  return result;
}

function okxTradeFeeQuotaNamespace(): string {
  const apiKey = requireCredential('OKX_API_KEY');
  return `okx:trade_fee:${createHash('sha256').update(apiKey).digest('hex').slice(0, 24)}`;
}

async function acquireOkxDistributedQuota(lane: OkxPrivateLane): Promise<void> {
  if (lane !== 'trade_fee' || !isDatabaseConfigured) return;
  const policy = OKX_LANE_POLICIES.trade_fee;
  await acquireDistributedApiQuota({
    namespace: okxTradeFeeQuotaNamespace(),
    capacity: policy.capacity,
    windowMs: policy.windowMs,
    maxWaitMs: Math.max(10_000, policy.windowMs * 5),
  });
}

function scheduleOkxLane<T>(lane: OkxPrivateLane, operation: () => Promise<T>): Promise<T> {
  const state = okxLanes[lane];
  const run = state.tail.catch(() => undefined).then(async () => {
    await acquireOkxToken(lane);
    if (lane !== 'trade_fee' || !isCoordinationDatabaseConfigured) {
      return executeStartedLaneOperation(lane, operation);
    }

    const apiKey = requireCredential('OKX_API_KEY');
    const lockName = `cryptocrawl:okx:trade-fee:${fingerprint(apiKey)}`;
    return withDatabaseSessionAdvisoryLock(
      lockName,
      async () => executeStartedLaneOperation(lane, operation),
      { acquireTimeoutMs: OKX_DISTRIBUTED_RATE_LOCK_TIMEOUT_MS },
    );
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

function headerDelayMs(response: Response): number | null {
  const retryAfter = response.headers.get('retry-after');
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds) && seconds >= 0) return Math.ceil(seconds * 1_000);
    const parsedDate = Date.parse(retryAfter);
    if (Number.isFinite(parsedDate)) return Math.max(0, parsedDate - Date.now());
  }
  const remaining = Number(response.headers.get('OK-RateLimit-Remaining'));
  const resetRaw = response.headers.get('OK-RateLimit-Reset');
  if (Number.isFinite(remaining) && remaining <= 0 && resetRaw) {
    const reset = Number(resetRaw);
    if (Number.isFinite(reset)) {
      const resetMs = reset > 10_000_000_000 ? reset : reset * 1_000;
      return Math.max(0, resetMs - Date.now());
    }
  }
  return null;
}

function isOkxRateLimitError(error: unknown): error is OkxPrivateApiError {
  return error instanceof OkxPrivateApiError && ['429', '50011', '51071', '50061'].includes(String(error.code));
}

function fullJitterDelay(attempt: number, hintedMs: number | null): number {
  if (hintedMs !== null && Number.isFinite(hintedMs) && hintedMs > 0) {
    return Math.min(OKX_RATE_RETRY_MAX_MS, Math.ceil(hintedMs + Math.random() * Math.min(250, hintedMs * 0.1)));
  }
  const ceiling = Math.min(OKX_RATE_RETRY_MAX_MS, OKX_RATE_RETRY_BASE_MS * (2 ** attempt));
  return Math.max(50, Math.floor(Math.random() * ceiling));
}

function recordOkxRateLimit(lane: OkxPrivateLane, delayMs: number, error: OkxPrivateApiError): void {
  const state = okxLanes[lane];
  state.rateLimitCount += 1;
  state.consecutiveRateLimits += 1;
  state.cooldownUntil = Math.max(state.cooldownUntil, Date.now() + delayMs);
  if (state.consecutiveRateLimits >= 5) {
    state.breakerOpenUntil = Math.max(state.breakerOpenUntil, Date.now() + OKX_RATE_BREAKER_MS);
  }
  logger.warn('[CEX Private] OKX rate lane throttled', {
    component: 'CexPrivateAuthority',
    lane,
    code: error.code,
    path: error.path,
    retryDelayMs: delayMs,
    consecutiveRateLimits: state.consecutiveRateLimits,
    breakerOpenUntil: state.breakerOpenUntil || null,
    distributedTradeFeePacing: lane === 'trade_fee' && isCoordinationDatabaseConfigured,
  });
}

function recordOkxSuccess(lane: OkxPrivateLane): void {
  const state = okxLanes[lane];
  state.consecutiveRateLimits = 0;
  if (state.breakerOpenUntil <= Date.now()) state.breakerOpenUntil = 0;
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
      headerDelayMs(response),
    );
  }
  return payload;
}

async function executeOkxWithAdaptiveRetry<T>(lane: OkxPrivateLane, operation: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      const result = await scheduleOkxLane(lane, operation);
      recordOkxSuccess(lane);
      return result;
    } catch (error) {
      if (!isOkxRateLimitError(error) || attempt >= OKX_RATE_MAX_RETRIES) throw error;
      const delayMs = fullJitterDelay(attempt, error.retryAfterMs);
      okxLanes[lane].retryCount += 1;
      recordOkxRateLimit(lane, delayMs, error);
      await sleep(delayMs);
    }
  }
}

async function selectOkxRegion(): Promise<OkxRegionSnapshot> {
  if (okxRegion && okxRegion.expiresAt > Date.now()) return okxRegion;
  if (okxRegionInFlight) return okxRegionInFlight;

  okxRegionInFlight = (async () => {
    const configured = Boolean(credential('OKX_API_BASE_URL'));
    const failures: string[] = [];
    for (const baseUrl of okxBaseUrlCandidates()) {
      try {
        await executeOkxWithAdaptiveRetry('trade_fee', () => authenticatedOkxRequestFromBase(
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
          distributedTradeFeePacing: isCoordinationDatabaseConfigured,
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
  const payload = await executeOkxWithAdaptiveRetry(lane, () => authenticatedOkxRequestFromBase(
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
  lanes: Record<OkxPrivateLane, OkxLaneSnapshot>;
  distributedQuota: ReturnType<typeof getDistributedApiQuotaSnapshot>;
} {
  const lanes = Object.fromEntries(
    (Object.keys(okxLanes) as OkxPrivateLane[]).map(lane => {
      refillLane(lane);
      const state = okxLanes[lane];
      const policy = OKX_LANE_POLICIES[lane];
      return [lane, {
        requestCount: state.requestCount,
        lastStartedAt: state.lastStartedAt,
        minIntervalMs: laneIntervalMs(lane),
        capacity: policy.capacity,
        windowMs: policy.windowMs,
        priority: policy.priority,
        tokens: Number(state.tokens.toFixed(3)),
        cooldownUntil: state.cooldownUntil,
        breakerOpenUntil: state.breakerOpenUntil,
        consecutiveRateLimits: state.consecutiveRateLimits,
        rateLimitCount: state.rateLimitCount,
        retryCount: state.retryCount,
        distributedPacing: lane === 'trade_fee' && isCoordinationDatabaseConfigured,
      } satisfies OkxLaneSnapshot];
    }),
  ) as Record<OkxPrivateLane, OkxLaneSnapshot>;

  return {
    baseUrl: getCachedOkxExecutionRestBaseUrl(),
    regionSource: okxRegion?.source || null,
    regionExpiresAt: okxRegion?.expiresAt || null,
    lanes,
    distributedQuota: getDistributedApiQuotaSnapshot(),
  };
}

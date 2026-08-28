import {
  createPrivateKey,
  randomBytes,
  sign as cryptoSign,
  type KeyObject,
} from 'node:crypto';
import logger from '../../../logger.js';

const COINBASE_HOST = 'api.coinbase.com';
const COINBASE_ORIGIN = 'https://api.coinbase.com';
const REQUEST_TIMEOUT_MS = Math.max(3_000, Number(process.env.CRYPTO_COINBASE_PRIVATE_TIMEOUT_MS || 12_000));
const PERMISSION_CACHE_MS = Math.max(30_000, Number(process.env.CRYPTO_COINBASE_PERMISSION_CACHE_MS || 300_000));

export interface CoinbaseKeyPermissions {
  canView: boolean;
  canTrade: boolean;
  canTransfer: boolean;
  canReceive: boolean;
  portfolioUuid: string | null;
  observedAt: number;
}

export interface CoinbasePrivateAuthoritySnapshot {
  credentialsVisible: boolean;
  permissionObservedAt: number | null;
  canView: boolean | null;
  canTrade: boolean | null;
  requestCount: number;
  lastRequestAt: number | null;
  authAlgorithm: 'ES256' | 'EdDSA' | null;
}

let permissionsCache: { expiresAt: number; value: CoinbaseKeyPermissions } | null = null;
let permissionsInFlight: Promise<CoinbaseKeyPermissions> | null = null;
let requestCount = 0;
let lastRequestAt: number | null = null;
let lastAuthAlgorithm: 'ES256' | 'EdDSA' | null = null;

function normalizeCredential(raw: string | undefined): string | null {
  if (!raw) return null;
  let value = raw.trim();
  if (value.length >= 2) {
    const first = value[0];
    const last = value[value.length - 1];
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) value = value.slice(1, -1).trim();
  }
  return value || null;
}

function coinbaseKeyName(): string | null {
  return normalizeCredential(process.env.COINBASE_API_KEY)
    || normalizeCredential(process.env.COINBASE_KEY_NAME)
    || normalizeCredential(process.env.CDP_API_KEY_NAME);
}

function coinbaseKeySecret(): string | null {
  const value = normalizeCredential(process.env.COINBASE_API_SECRET)
    || normalizeCredential(process.env.COINBASE_KEY_SECRET)
    || normalizeCredential(process.env.CDP_API_KEY_SECRET);
  return value ? value.replace(/\\n/g, '\n') : null;
}

export function hasCoinbaseAdvancedTradeCredentials(): boolean {
  return Boolean(coinbaseKeyName() && coinbaseKeySecret());
}

function requireCoinbaseCredentials(): { keyName: string; keySecret: string } {
  const keyName = coinbaseKeyName();
  const keySecret = coinbaseKeySecret();
  if (!keyName || !keySecret) {
    throw new Error('Coinbase Advanced Trade credentials are not visible; expected COINBASE_API_KEY and COINBASE_API_SECRET (legacy aliases are also checked)');
  }
  if (!keyName.includes('/apiKeys/')) {
    logger.warn('[Coinbase] API key name does not match the documented CDP key-name shape', {
      component: 'CoinbaseAdvancedTradeAuthority',
      expectedShape: 'organizations/{org_id}/apiKeys/{key_id}',
    });
  }
  return { keyName, keySecret };
}

function base64Url(value: Buffer | string): string {
  return Buffer.from(value).toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

function privateKeyFromSecret(secret: string): { key: KeyObject; algorithm: 'ES256' | 'EdDSA' } {
  if (secret.includes('BEGIN')) {
    const key = createPrivateKey(secret);
    if (key.asymmetricKeyType !== 'ec') {
      throw new Error(`Coinbase PEM secret must be an EC private key for ES256; received ${key.asymmetricKeyType || 'unknown'}`);
    }
    return { key, algorithm: 'ES256' };
  }

  const decoded = Buffer.from(secret, 'base64');
  if (decoded.length !== 64 && decoded.length !== 32) {
    throw new Error('Coinbase non-PEM secret is not a supported Ed25519 seed/key payload');
  }
  const seed = decoded.subarray(0, 32);
  // RFC 8410 PKCS#8 wrapper for a raw Ed25519 32-byte private seed.
  const prefix = Buffer.from('302e020100300506032b657004220420', 'hex');
  const key = createPrivateKey({ key: Buffer.concat([prefix, seed]), format: 'der', type: 'pkcs8' });
  return { key, algorithm: 'EdDSA' };
}

export function createCoinbaseRestJwt(
  methodInput: string,
  requestPath: string,
  nowMs: number = Date.now(),
): string {
  const { keyName, keySecret } = requireCoinbaseCredentials();
  const method = methodInput.trim().toUpperCase();
  if (!method || !requestPath.startsWith('/')) throw new Error('Coinbase JWT requires an HTTP method and absolute request path');
  const { key, algorithm } = privateKeyFromSecret(keySecret);
  const now = Math.floor(nowMs / 1000);
  const header = {
    typ: 'JWT',
    alg: algorithm,
    kid: keyName,
    nonce: randomBytes(16).toString('hex'),
  };
  const payload = {
    sub: keyName,
    iss: 'cdp',
    aud: ['cdp_service'],
    nbf: now,
    exp: now + 120,
    uri: `${method} ${COINBASE_HOST}${requestPath}`,
  };
  const signingInput = `${base64Url(JSON.stringify(header))}.${base64Url(JSON.stringify(payload))}`;
  const signature = algorithm === 'ES256'
    ? cryptoSign('sha256', Buffer.from(signingInput), { key, dsaEncoding: 'ieee-p1363' })
    : cryptoSign(null, Buffer.from(signingInput), key);
  lastAuthAlgorithm = algorithm;
  return `${signingInput}.${base64Url(signature)}`;
}

function appendQuery(url: URL, query: Record<string, string | string[]> | undefined): void {
  if (!query) return;
  for (const [key, raw] of Object.entries(query)) {
    if (Array.isArray(raw)) raw.forEach(value => url.searchParams.append(key, value));
    else url.searchParams.set(key, raw);
  }
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

export async function coinbasePrivateRequest(
  path: string,
  method: 'GET' | 'POST',
  options: {
    query?: Record<string, string | string[]>;
    body?: unknown;
    timeoutMs?: number;
  } = {},
): Promise<any> {
  if (!path.startsWith('/api/v3/brokerage/')) throw new Error(`Unsupported Coinbase private path: ${path}`);
  const url = new URL(path, COINBASE_ORIGIN);
  appendQuery(url, options.query);
  const jwt = createCoinbaseRestJwt(method, path);
  const body = method === 'POST' && options.body !== undefined ? JSON.stringify(options.body) : undefined;
  const response = await fetchWithTimeout(url.toString(), {
    method,
    headers: {
      accept: 'application/json',
      Authorization: `Bearer ${jwt}`,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body,
  }, options.timeoutMs ?? REQUEST_TIMEOUT_MS);
  const text = await response.text();
  let payload: any;
  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(`Coinbase private endpoint returned non-JSON (${response.status})`);
  }
  if (!response.ok || payload?.error) {
    const code = payload?.error_response?.error || payload?.error || payload?.code || response.status;
    const message = payload?.error_response?.message || payload?.message || payload?.error_details || '';
    throw new Error(`Coinbase private endpoint failed (${response.status}) code=${String(code)}${message ? ` message=${String(message)}` : ''}`);
  }
  requestCount += 1;
  lastRequestAt = Date.now();
  return payload;
}

export async function getCoinbaseKeyPermissions(forceRefresh = false): Promise<CoinbaseKeyPermissions> {
  if (!forceRefresh && permissionsCache && permissionsCache.expiresAt > Date.now()) return { ...permissionsCache.value };
  if (permissionsInFlight) return { ...(await permissionsInFlight) };

  permissionsInFlight = (async () => {
    const payload = await coinbasePrivateRequest('/api/v3/brokerage/key_permissions', 'GET');
    const value: CoinbaseKeyPermissions = {
      canView: payload?.can_view === true,
      canTrade: payload?.can_trade === true,
      canTransfer: payload?.can_transfer === true,
      canReceive: payload?.can_receive === true,
      portfolioUuid: typeof payload?.portfolio_uuid === 'string' && payload.portfolio_uuid.trim()
        ? payload.portfolio_uuid.trim()
        : null,
      observedAt: Date.now(),
    };
    permissionsCache = { value, expiresAt: Date.now() + PERMISSION_CACHE_MS };
    logger.info('[Coinbase] Advanced Trade API-key permissions verified', {
      component: 'CoinbaseAdvancedTradeAuthority',
      canView: value.canView,
      canTrade: value.canTrade,
      canTransfer: value.canTransfer,
      portfolioBound: Boolean(value.portfolioUuid),
    });
    return value;
  })().finally(() => { permissionsInFlight = null; });

  return { ...(await permissionsInFlight) };
}

export async function assertCoinbaseSpotTradeReady(): Promise<CoinbaseKeyPermissions> {
  const permissions = await getCoinbaseKeyPermissions();
  if (!permissions.canView) throw new Error('Coinbase API key does not have view permission required for fees, balances, and settlement verification');
  if (!permissions.canTrade) throw new Error('Coinbase API key does not have trade permission required for live execution');
  return permissions;
}

export function getCoinbasePrivateAuthoritySnapshot(): CoinbasePrivateAuthoritySnapshot {
  return {
    credentialsVisible: hasCoinbaseAdvancedTradeCredentials(),
    permissionObservedAt: permissionsCache?.value.observedAt || null,
    canView: permissionsCache?.value.canView ?? null,
    canTrade: permissionsCache?.value.canTrade ?? null,
    requestCount,
    lastRequestAt,
    authAlgorithm: lastAuthAlgorithm,
  };
}

import logger from '../../../logger.js';
import {
  createCoinbaseRestJwt,
  getCoinbaseKeyPermissions,
} from './coinbase-advanced-trade-authority.js';

const COINBASE_ORIGIN = 'https://api.coinbase.com';
const REQUEST_TIMEOUT_MS = Math.max(3_000, Number(process.env.CRYPTO_COINBASE_APP_PRIVATE_TIMEOUT_MS || 12_000));

export interface CoinbaseAppReceiveCapability {
  canView: true;
  canReceive: true;
  portfolioUuid: string | null;
  authAlgorithm: 'ES256';
  observedAt: number;
}

function decodeJwtHeader(jwt: string): Record<string, unknown> {
  const encoded = jwt.split('.')[0] || '';
  if (!encoded) throw new Error('Coinbase App JWT header is missing');
  try {
    return JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as Record<string, unknown>;
  } catch {
    throw new Error('Coinbase App JWT header could not be decoded');
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

function appendQuery(url: URL, query: Record<string, string> | undefined): void {
  if (!query) return;
  for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value);
}

/**
 * Coinbase App v2 uses the same canonical CDP credential signer as Advanced
 * Trade, but currently requires ES256. This adapter never owns a second key or
 * signer and never retries writes automatically.
 */
export async function coinbaseAppPrivateRequest(
  path: string,
  method: 'GET' | 'POST',
  options: { query?: Record<string, string>; body?: unknown; timeoutMs?: number } = {},
): Promise<any> {
  if (!path.startsWith('/v2/')) throw new Error(`Unsupported Coinbase App private path: ${path}`);
  const jwt = createCoinbaseRestJwt(method, path);
  const header = decodeJwtHeader(jwt);
  if (String(header.alg || '') !== 'ES256') {
    throw new Error('COINBASE_APP_ES256_API_KEY_REQUIRED');
  }
  const url = new URL(path, COINBASE_ORIGIN);
  appendQuery(url, options.query);
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
    throw new Error(`Coinbase App private endpoint returned non-JSON (${response.status})`);
  }
  if (!response.ok || payload?.errors?.length || payload?.error) {
    const code = payload?.errors?.[0]?.id || payload?.error || payload?.code || response.status;
    const message = payload?.errors?.[0]?.message || payload?.message || '';
    throw new Error(`Coinbase App private endpoint failed (${response.status}) code=${String(code)}${message ? ` message=${String(message)}` : ''}`);
  }
  return payload;
}

export async function assertCoinbaseAppReceiveReady(): Promise<CoinbaseAppReceiveCapability> {
  const permissions = await getCoinbaseKeyPermissions(true);
  if (!permissions.canView) throw new Error('COINBASE_APP_VIEW_PERMISSION_REQUIRED');
  if (!permissions.canReceive) throw new Error('COINBASE_APP_RECEIVE_PERMISSION_REQUIRED');
  // Mint an App-format token now so an EdDSA-only key fails before any deposit
  // address is requested or source capital is moved.
  const probe = createCoinbaseRestJwt('GET', '/v2/accounts');
  const header = decodeJwtHeader(probe);
  if (String(header.alg || '') !== 'ES256') throw new Error('COINBASE_APP_ES256_API_KEY_REQUIRED');
  const capability: CoinbaseAppReceiveCapability = {
    canView: true,
    canReceive: true,
    portfolioUuid: permissions.portfolioUuid,
    authAlgorithm: 'ES256',
    observedAt: Date.now(),
  };
  logger.info('[CoinbaseApp] Receive capability verified through canonical Coinbase credentials', {
    component: 'CoinbaseAppPrivateAuthority',
    canView: true,
    canReceive: true,
    es256Required: true,
    secondCredentialAuthorityCreated: false,
    accountBalanceCreatesOwnership: false,
  });
  return capability;
}

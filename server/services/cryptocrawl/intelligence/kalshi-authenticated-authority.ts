import { constants, createHash, createPrivateKey, sign, type KeyObject } from 'node:crypto';
import logger from '../../../logger.js';

export type KalshiApiEnvironment = 'production' | 'demo';
export type KalshiCredentialScope = 'auto' | 'event' | 'perps';

export interface KalshiAuthenticatedRequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  body?: unknown;
  timeoutMs?: number;
  environment?: KalshiApiEnvironment;
  credentialScope?: KalshiCredentialScope;
}

const PROD_ORIGIN = 'https://external-api.kalshi.com';
const DEMO_ORIGIN = 'https://external-api.demo.kalshi.co';
const MIN_TIMEOUT_MS = 1_000;
const MAX_TIMEOUT_MS = 15_000;

function cleanSecret(raw: string | undefined): string | null {
  if (!raw) return null;
  let value = raw.trim();
  if (value.length >= 2) {
    const first = value[0];
    const last = value[value.length - 1];
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) value = value.slice(1, -1).trim();
  }
  return value || null;
}

function eventApiKeyId(): string | null {
  return cleanSecret(process.env.KALSHI_API_KEY)
    || cleanSecret(process.env.KALSHI_API_KEY_ID);
}

function eventPrivateKeyRaw(): string | null {
  return cleanSecret(process.env.KALSHI_PRIVATE_KEY);
}

function perpsApiKeyId(): string | null {
  return cleanSecret(process.env.KALSHI_PERPS_API_KEY)
    || cleanSecret(process.env.KALSHI_PERPS_KEY_ID);
}

function perpsPrivateKeyRaw(): string | null {
  return cleanSecret(process.env.KALSHI_PERPS_PRIVATE_KEY);
}

/**
 * Kalshi may use separate credentials for event/prediction and perps surfaces.
 * Existing generic credentials remain a compatibility fallback for perps, while
 * event requests prefer the generic event key so a configured perps key cannot
 * accidentally shadow a valid prediction-market credential.
 */
function apiKeyId(scope: KalshiCredentialScope = 'auto'): string | null {
  if (scope === 'event') return eventApiKeyId() || perpsApiKeyId();
  if (scope === 'perps') return perpsApiKeyId() || eventApiKeyId();
  return perpsApiKeyId() || eventApiKeyId();
}

function privateKeyRaw(scope: KalshiCredentialScope = 'auto'): string | null {
  if (scope === 'event') return eventPrivateKeyRaw() || perpsPrivateKeyRaw();
  if (scope === 'perps') return perpsPrivateKeyRaw() || eventPrivateKeyRaw();
  return perpsPrivateKeyRaw() || eventPrivateKeyRaw();
}

function normalizePem(value: string): string {
  return value.replace(/\\n/g, '\n').trim();
}

function decodePrivateKey(value: string): KeyObject {
  const normalized = normalizePem(value);
  if (normalized.includes('-----BEGIN')) return createPrivateKey(normalized);

  const compact = normalized.replace(/\s+/g, '');
  if (!/^[A-Za-z0-9+/=]+$/.test(compact)) {
    throw new Error('Kalshi private key is neither PEM nor base64 DER');
  }
  const der = Buffer.from(compact, 'base64');
  if (der.length < 256) throw new Error('Kalshi private key base64 DER is unexpectedly short');
  try {
    return createPrivateKey({ key: der, format: 'der', type: 'pkcs8' });
  } catch {
    return createPrivateKey({ key: der, format: 'der', type: 'pkcs1' });
  }
}

const cachedPrivateKeys = new Map<string, KeyObject>();
function privateKey(scope: KalshiCredentialScope): KeyObject {
  const raw = privateKeyRaw(scope);
  if (!raw) throw new Error(`Kalshi ${scope} private key is not configured`);
  const fingerprint = createHash('sha256').update(raw, 'utf8').digest('hex');
  const cached = cachedPrivateKeys.get(fingerprint);
  if (cached) return cached;
  const key = decodePrivateKey(raw);
  if (key.asymmetricKeyType !== 'rsa') throw new Error('Kalshi private key must be an RSA key');
  cachedPrivateKeys.set(fingerprint, key);
  return key;
}

export function kalshiCredentialsPresent(scope: KalshiCredentialScope = 'auto'): boolean {
  return Boolean(apiKeyId(scope) && privateKeyRaw(scope));
}

export function getKalshiApiEnvironment(): KalshiApiEnvironment {
  const configured = cleanSecret(process.env.KALSHI_API_ENV)?.toLowerCase();
  if (configured === 'demo') return 'demo';
  return 'production';
}

export function getKalshiApiOrigin(environment = getKalshiApiEnvironment()): string {
  return environment === 'demo' ? DEMO_ORIGIN : PROD_ORIGIN;
}

function boundedTimeout(raw: unknown): number {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return 5_000;
  return Math.max(MIN_TIMEOUT_MS, Math.min(MAX_TIMEOUT_MS, Math.trunc(parsed)));
}

function normalizePath(pathWithQuery: string): string {
  const raw = pathWithQuery.trim();
  if (!raw.startsWith('/trade-api/v2/')) throw new Error('Kalshi path must begin with /trade-api/v2/');
  return raw;
}

function signatureHeaders(method: string, pathWithQuery: string, scope: KalshiCredentialScope): Record<string, string> {
  const keyId = apiKeyId(scope);
  if (!keyId) throw new Error(`Kalshi ${scope} API key ID is not configured`);
  const timestamp = String(Date.now());
  const pathWithoutQuery = normalizePath(pathWithQuery).split('?')[0];
  const message = Buffer.from(`${timestamp}${method.toUpperCase()}${pathWithoutQuery}`, 'utf8');
  const signature = sign('sha256', message, {
    key: privateKey(scope),
    padding: constants.RSA_PKCS1_PSS_PADDING,
    saltLength: 32,
  }).toString('base64');
  return {
    'KALSHI-ACCESS-KEY': keyId,
    'KALSHI-ACCESS-TIMESTAMP': timestamp,
    'KALSHI-ACCESS-SIGNATURE': signature,
  };
}

export async function kalshiAuthenticatedRequest<T>(
  pathWithQuery: string,
  options: KalshiAuthenticatedRequestOptions = {},
): Promise<T> {
  const method = options.method || 'GET';
  const scope = options.credentialScope || 'auto';
  const path = normalizePath(pathWithQuery);
  const origin = getKalshiApiOrigin(options.environment);
  const headers: Record<string, string> = {
    accept: 'application/json',
    ...signatureHeaders(method, path, scope),
  };
  let body: string | undefined;
  if (options.body !== undefined) {
    body = JSON.stringify(options.body);
    headers['content-type'] = 'application/json';
  }

  const startedAt = Date.now();
  const response = await fetch(`${origin}${path}`, {
    method,
    headers,
    body,
    signal: AbortSignal.timeout(boundedTimeout(options.timeoutMs ?? process.env.KALSHI_API_TIMEOUT_MS)),
  });
  const text = await response.text();
  let payload: unknown = null;
  if (text) {
    try { payload = JSON.parse(text); } catch { payload = text; }
  }
  if (!response.ok) {
    const message = typeof payload === 'object' && payload !== null && 'message' in payload
      ? String((payload as { message?: unknown }).message || '')
      : '';
    logger.warn('[KalshiAuth] Authenticated request failed closed', {
      component: 'KalshiAuthenticatedAuthority',
      environment: options.environment || getKalshiApiEnvironment(),
      credentialScope: scope,
      method,
      path: path.split('?')[0],
      status: response.status,
      latencyMs: Date.now() - startedAt,
      message: message.slice(0, 240) || null,
      scopedApiKeyPresent: Boolean(apiKeyId(scope)),
      scopedPrivateKeyPresent: Boolean(privateKeyRaw(scope)),
      eventCredentialPresent: Boolean(eventApiKeyId() && eventPrivateKeyRaw()),
      perpsCredentialPresent: Boolean(perpsApiKeyId() && perpsPrivateKeyRaw()),
      secretsLogged: false,
      executionAuthorityGranted: false,
    });
    throw new Error(`Kalshi ${method} ${path.split('?')[0]} failed with HTTP ${response.status}${message ? `: ${message}` : ''}`);
  }
  return payload as T;
}

export async function getKalshiMarginEnabled(forceEnvironment?: KalshiApiEnvironment): Promise<boolean> {
  if (!kalshiCredentialsPresent('perps')) return false;
  const result = await kalshiAuthenticatedRequest<{ enabled?: boolean }>('/trade-api/v2/margin/enabled', {
    environment: forceEnvironment,
    credentialScope: 'perps',
  });
  return result?.enabled === true;
}
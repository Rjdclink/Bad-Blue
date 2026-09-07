import logger from '../../../logger.js';
import {
  createCoinbaseRestJwt,
  getCoinbasePrivateAuthoritySnapshot,
} from './coinbase-advanced-trade-authority.js';

const ORIGIN = 'https://api.coinbase.com';
const TIMEOUT_MS = Math.max(2_000, Math.min(15_000, Number(process.env.CRYPTO_COINBASE_APP_READ_TIMEOUT_MS || 8_000)));
const MAX_PAGES = Math.max(1, Math.min(20, Math.trunc(Number(process.env.CRYPTO_COINBASE_APP_READ_MAX_PAGES || 8))));

export interface CoinbaseAppAccount {
  id: string;
  currency: string;
  type: string;
  balance: number | null;
}

function sleep(ms: number): Promise<void> {
  return ms > 0 ? new Promise(resolve => setTimeout(resolve, ms)) : Promise.resolve();
}

function retryDelay(response: Response, attempt: number): number {
  const retryAfter = response.headers.get('retry-after');
  const seconds = Number(retryAfter);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.max(100, Math.min(10_000, Math.ceil(seconds * 1_000)));
  return Math.min(5_000, 250 * (2 ** Math.max(0, attempt)));
}

function safeNextUri(value: unknown, expectedPrefix: string): string | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  const url = new URL(value, ORIGIN);
  if (url.origin !== ORIGIN || !url.pathname.startsWith(expectedPrefix)) return null;
  return `${url.pathname}${url.search}`;
}

/**
 * Coinbase App v2 read APIs use the same CDP key/JWT model, but Coinbase
 * documents ES256-only support for App API keys. This sidecar reuses the one
 * canonical Coinbase signer and refuses EdDSA before any request is sent.
 */
export async function coinbaseAppRead(pathWithQuery: string): Promise<any> {
  const url = new URL(pathWithQuery, ORIGIN);
  if (url.origin !== ORIGIN || !url.pathname.startsWith('/v2/')) {
    throw new Error(`Unsupported Coinbase App read path: ${pathWithQuery}`);
  }
  const signedPath = url.pathname;
  const jwt = createCoinbaseRestJwt('GET', signedPath);
  if (getCoinbasePrivateAuthoritySnapshot().authAlgorithm !== 'ES256') {
    throw new Error('Coinbase App v2 rebate reads require an ES256/ECDSA CDP key; current key type is not supported by Coinbase App APIs');
  }

  for (let attempt = 0; attempt < 3; attempt++) {
    const response = await fetch(url.toString(), {
      method: 'GET',
      headers: { accept: 'application/json', Authorization: `Bearer ${jwt}` },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (response.status === 429 && attempt < 2) {
      await sleep(retryDelay(response, attempt));
      continue;
    }
    const text = await response.text();
    let payload: any;
    try { payload = text ? JSON.parse(text) : {}; } catch { throw new Error(`Coinbase App read returned non-JSON (${response.status})`); }
    if (!response.ok || payload?.errors?.length) {
      const message = payload?.errors?.[0]?.message || payload?.error || payload?.message || '';
      throw new Error(`Coinbase App read failed (${response.status})${message ? `: ${String(message)}` : ''}`);
    }
    return payload;
  }
  throw new Error(`Coinbase App read exhausted bounded retries for ${url.pathname}`);
}

export async function getCoinbaseAppAccounts(): Promise<CoinbaseAppAccount[]> {
  const output: CoinbaseAppAccount[] = [];
  let path = '/v2/accounts?limit=100';
  for (let page = 0; page < MAX_PAGES && path; page++) {
    const payload = await coinbaseAppRead(path);
    for (const row of Array.isArray(payload?.data) ? payload.data : []) {
      const id = String(row?.id || '').trim();
      const currency = String(row?.currency?.code || row?.balance?.currency || '').trim().toUpperCase();
      if (!id || !currency) continue;
      const balance = Number(row?.balance?.amount);
      output.push({
        id,
        currency,
        type: String(row?.type || '').trim().toLowerCase(),
        balance: Number.isFinite(balance) ? balance : null,
      });
    }
    path = safeNextUri(payload?.pagination?.next_uri, '/v2/accounts') || '';
  }
  return output;
}

export async function getCoinbaseAppTransactions(accountIdInput: string): Promise<any[]> {
  const accountId = accountIdInput.trim();
  if (!/^[A-Za-z0-9-]+$/.test(accountId)) throw new Error('Invalid Coinbase App account id');
  const output: any[] = [];
  const prefix = `/v2/accounts/${accountId}/transactions`;
  let path = `${prefix}?limit=100`;
  for (let page = 0; page < MAX_PAGES && path; page++) {
    const payload = await coinbaseAppRead(path);
    output.push(...(Array.isArray(payload?.data) ? payload.data : []));
    path = safeNextUri(payload?.pagination?.next_uri, prefix) || '';
  }
  return output;
}

export async function probeCoinbaseAppRebateReadiness(): Promise<{ ready: boolean; reason: string | null }> {
  try {
    const accounts = await getCoinbaseAppAccounts();
    return { ready: true, reason: accounts.some(row => row.currency === 'USDC') ? null : 'USDC_ACCOUNT_NOT_VISIBLE' };
  } catch (error) {
    logger.debug('[Coinbase Rebate] App read authority unavailable; rebate evidence remains fail-closed', {
      component: 'CoinbaseAppReadAuthority',
      error: error instanceof Error ? error.message : String(error),
      preTradeRebateCredited: false,
    });
    return { ready: false, reason: error instanceof Error ? error.message : String(error) };
  }
}

import { createHmac } from 'crypto';
import logger from '../../../logger.js';

const REQUEST_TIMEOUT_MS = Math.max(3_000, Number(process.env.CRYPTO_ARBITRAGE_FEE_TIMEOUT_MS || 8_000));
const REGION_CACHE_TTL_MS = Math.max(60_000, Number(process.env.CRYPTO_OKX_REGION_CACHE_MS || 3_600_000));

interface OkxRegionSnapshot {
  baseUrl: string;
  selectedAt: number;
  expiresAt: number;
  source: 'configured_and_authenticated' | 'authenticated_probe';
}

let cachedRegion: OkxRegionSnapshot | null = null;
let regionInFlight: Promise<OkxRegionSnapshot> | null = null;

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

function normalizeBaseUrl(value: string): string {
  const trimmed = value.trim().replace(/\/+$/, '');
  if (!/^https:\/\/[a-z0-9.-]+$/i.test(trimmed)) throw new Error('OKX_API_BASE_URL must be an https origin');
  return trimmed;
}

function candidateBaseUrls(): string[] {
  const configured = credential('OKX_API_BASE_URL');
  if (configured) return [normalizeBaseUrl(configured)];
  return ['https://us.okx.com', 'https://openapi.okx.com'];
}

async function fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

async function authenticateBaseUrl(baseUrl: string): Promise<void> {
  const apiKey = credential('OKX_API_KEY');
  const apiSecret = credential('OKX_API_SECRET');
  const passphrase = credential('OKX_API_PASSPHRASE');
  if (!apiKey || !apiSecret || !passphrase) throw new Error('OKX execution credentials are incomplete');

  const query = new URLSearchParams({ instType: 'SPOT' }).toString();
  const path = `/api/v5/account/trade-fee?${query}`;
  const timestamp = new Date().toISOString();
  const signature = createHmac('sha256', apiSecret).update(`${timestamp}GET${path}`).digest('base64');
  const response = await fetchWithTimeout(`${baseUrl}${path}`, {
    method: 'GET',
    headers: {
      'OK-ACCESS-KEY': apiKey,
      'OK-ACCESS-SIGN': signature,
      'OK-ACCESS-TIMESTAMP': timestamp,
      'OK-ACCESS-PASSPHRASE': passphrase,
      'Content-Type': 'application/json',
    },
  });
  const body = await response.text();
  let payload: any;
  try {
    payload = body ? JSON.parse(body) : {};
  } catch {
    throw new Error(`OKX region probe returned non-JSON (${response.status})`);
  }
  if (!response.ok || payload?.code !== '0') {
    const code = payload?.code ?? response.status;
    const message = payload?.msg || payload?.message || 'authentication failed';
    throw new Error(`OKX region probe failed: ${code} ${message}`);
  }
}

export async function getOkxExecutionRestBaseUrl(): Promise<string> {
  if (cachedRegion && cachedRegion.expiresAt > Date.now()) return cachedRegion.baseUrl;
  if (regionInFlight) return (await regionInFlight).baseUrl;

  regionInFlight = (async () => {
    const configured = Boolean(credential('OKX_API_BASE_URL'));
    const failures: string[] = [];
    for (const baseUrl of candidateBaseUrls()) {
      try {
        await authenticateBaseUrl(baseUrl);
        const snapshot: OkxRegionSnapshot = {
          baseUrl,
          selectedAt: Date.now(),
          expiresAt: Date.now() + REGION_CACHE_TTL_MS,
          source: configured ? 'configured_and_authenticated' : 'authenticated_probe',
        };
        cachedRegion = snapshot;
        logger.info('[OKX Region] Execution REST authority selected', {
          component: 'OkxRegionAuthority',
          baseUrl,
          source: snapshot.source,
        });
        return snapshot;
      } catch (error) {
        failures.push(`${baseUrl}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    throw new Error(`OKX execution region selection failed: ${failures.join(' | ')}`);
  })().finally(() => { regionInFlight = null; });

  return (await regionInFlight).baseUrl;
}

export function getCachedOkxExecutionRestBaseUrl(): string | null {
  if (!cachedRegion || cachedRegion.expiresAt <= Date.now()) return null;
  return cachedRegion.baseUrl;
}

import { createHash, createHmac } from 'crypto';
import logger from '../../../logger.js';

export type CexFeeVenue = 'coinbase' | 'kraken' | 'okx';

export interface CexFeeEvidence {
  venue: CexFeeVenue;
  symbol: string;
  takerFeeBps: number;
  makerFeeBps: number | null;
  makerRebateBps: number | null;
  source: 'kraken_account_trade_volume' | 'okx_account_trade_fee' | 'configured_override';
  observedAt: number;
}

const FEE_CACHE_TTL_MS = Math.max(5_000, Number(process.env.CRYPTO_ARBITRAGE_FEE_CACHE_MS || 60_000));
const REQUEST_TIMEOUT_MS = Math.max(3_000, Number(process.env.CRYPTO_ARBITRAGE_FEE_TIMEOUT_MS || 8_000));
const feeCache = new Map<string, CexFeeEvidence>();
const feeInFlight = new Map<string, Promise<CexFeeEvidence | null>>();
let krakenNonce = 0;

function finiteNumber(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function credential(name: string): string | null {
  const raw = process.env[name];
  if (!raw) return null;
  let value = raw.trim();
  if (value.length >= 2) {
    const first = value[0];
    const last = value[value.length - 1];
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      value = value.slice(1, -1).trim();
    }
  }
  return value || null;
}

function configuredFee(venue: CexFeeVenue, symbol: string): CexFeeEvidence | null {
  const taker = finiteNumber(process.env[`CRYPTO_ARBITRAGE_${venue.toUpperCase()}_TAKER_FEE_BPS`]);
  if (taker === null || taker < 0) return null;
  const maker = finiteNumber(process.env[`CRYPTO_ARBITRAGE_${venue.toUpperCase()}_MAKER_FEE_BPS`]);
  const rebate = finiteNumber(process.env[`CRYPTO_ARBITRAGE_${venue.toUpperCase()}_MAKER_REBATE_BPS`]);
  return {
    venue,
    symbol,
    takerFeeBps: taker,
    makerFeeBps: maker !== null && maker >= 0 ? maker : null,
    makerRebateBps: rebate !== null && rebate >= 0 ? rebate : null,
    source: 'configured_override',
    observedAt: Date.now(),
  };
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

async function readJson(response: Response): Promise<any> {
  const body = await response.text();
  let payload: any;
  try {
    payload = body ? JSON.parse(body) : {};
  } catch {
    throw new Error(`Exchange fee endpoint returned non-JSON (${response.status})`);
  }
  if (!response.ok) throw new Error(`Exchange fee endpoint failed (${response.status})`);
  return payload;
}

async function fetchKrakenFeeEvidence(symbol: string): Promise<CexFeeEvidence | null> {
  const apiKey = credential('KRAKEN_API_KEY');
  const apiSecret = credential('KRAKEN_API_SECRET');
  if (!apiKey || !apiSecret) {
    logger.warn('[CEX Fees] Kraken authenticated fee discovery unavailable because credentials are incomplete', {
      component: 'CexFeeResolver',
      venue: 'kraken',
      symbol,
      apiKeyPresent: Boolean(apiKey),
      apiSecretPresent: Boolean(apiSecret),
    });
    return null;
  }

  let decodedSecret: Buffer;
  try {
    decodedSecret = Buffer.from(apiSecret, 'base64');
    if (decodedSecret.length === 0) throw new Error('empty decoded secret');
  } catch {
    throw new Error('Kraken API secret is not valid base64');
  }

  const path = '/0/private/TradeVolume';
  const nonce = String(Math.max(Date.now(), krakenNonce + 1));
  krakenNonce = Number(nonce);
  const body = new URLSearchParams({ nonce, pair: symbol, 'fee-info': 'true' }).toString();
  const hash = createHash('sha256').update(nonce + body).digest();
  const signature = createHmac('sha512', decodedSecret)
    .update(Buffer.concat([Buffer.from(path), hash]))
    .digest('base64');
  const response = await fetchWithTimeout(`https://api.kraken.com${path}`, {
    method: 'POST',
    headers: {
      'API-Key': apiKey,
      'API-Sign': signature,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body,
  });
  const payload = await readJson(response);
  if (payload.error?.length) throw new Error(`Kraken fee request failed: ${payload.error.join(', ')}`);
  const result = payload.result || {};
  const takerRow = Object.values(result.fees || {})[0] as Record<string, unknown> | undefined;
  const makerRow = Object.values(result.fees_maker || {})[0] as Record<string, unknown> | undefined;
  const takerPct = finiteNumber(takerRow?.fee);
  if (takerPct === null) throw new Error('Kraken TradeVolume response did not contain taker fee evidence for the requested pair');
  const makerPct = finiteNumber(makerRow?.fee);
  return {
    venue: 'kraken',
    symbol,
    takerFeeBps: Math.max(0, takerPct * 100),
    makerFeeBps: makerPct !== null && makerPct >= 0 ? makerPct * 100 : null,
    makerRebateBps: makerPct !== null && makerPct < 0 ? Math.abs(makerPct) * 100 : null,
    source: 'kraken_account_trade_volume',
    observedAt: Date.now(),
  };
}

function okxInstrumentId(symbol: string): string {
  const match = symbol.match(/^([A-Z0-9]+)(USDT|USDC|USD)$/);
  return match ? `${match[1]}-${match[2]}` : symbol;
}

async function fetchOkxFeeEvidence(symbol: string): Promise<CexFeeEvidence | null> {
  const apiKey = credential('OKX_API_KEY');
  const apiSecret = credential('OKX_API_SECRET');
  const passphrase = credential('OKX_API_PASSPHRASE');
  if (!apiKey || !apiSecret || !passphrase) {
    logger.warn('[CEX Fees] OKX authenticated fee discovery unavailable because credentials are incomplete', {
      component: 'CexFeeResolver',
      venue: 'okx',
      symbol,
      apiKeyPresent: Boolean(apiKey),
      apiSecretPresent: Boolean(apiSecret),
      passphrasePresent: Boolean(passphrase),
    });
    return null;
  }

  const query = new URLSearchParams({ instType: 'SPOT', instId: okxInstrumentId(symbol) }).toString();
  const path = `/api/v5/account/trade-fee?${query}`;
  const timestamp = new Date().toISOString();
  const signature = createHmac('sha256', apiSecret).update(`${timestamp}GET${path}`).digest('base64');
  const response = await fetchWithTimeout(`https://www.okx.com${path}`, {
    method: 'GET',
    headers: {
      'OK-ACCESS-KEY': apiKey,
      'OK-ACCESS-SIGN': signature,
      'OK-ACCESS-TIMESTAMP': timestamp,
      'OK-ACCESS-PASSPHRASE': passphrase,
      'Content-Type': 'application/json',
    },
  });
  const payload = await readJson(response);
  if (payload.code !== '0') throw new Error(`OKX fee request failed: ${payload.msg || payload.code}`);
  const row = payload.data?.[0];
  const takerRate = finiteNumber(row?.taker);
  if (takerRate === null) throw new Error('OKX trade-fee response did not contain taker fee evidence for the requested pair');
  const makerRate = finiteNumber(row?.maker);
  // OKX represents charged fees as negative rates and rebates as positive rates.
  return {
    venue: 'okx',
    symbol,
    takerFeeBps: Math.max(0, -takerRate * 10_000),
    makerFeeBps: makerRate !== null && makerRate < 0 ? -makerRate * 10_000 : null,
    makerRebateBps: makerRate !== null && makerRate > 0 ? makerRate * 10_000 : null,
    source: 'okx_account_trade_fee',
    observedAt: Date.now(),
  };
}

async function fetchLiveFeeEvidence(venue: CexFeeVenue, symbol: string): Promise<CexFeeEvidence | null> {
  if (venue === 'kraken') return fetchKrakenFeeEvidence(symbol);
  if (venue === 'okx') return fetchOkxFeeEvidence(symbol);
  // Coinbase is currently market-data-only in CryptoCrawler's centralized execution layer.
  return null;
}

export async function resolveCexFeeEvidence(venue: CexFeeVenue, symbolInput: string): Promise<CexFeeEvidence | null> {
  const symbol = symbolInput.trim().toUpperCase();
  const key = `${venue}:${symbol}`;
  const cached = feeCache.get(key);
  if (cached && Date.now() - cached.observedAt <= FEE_CACHE_TTL_MS) return { ...cached };
  const inFlight = feeInFlight.get(key);
  if (inFlight) return inFlight;

  const promise = (async () => {
    try {
      const live = await fetchLiveFeeEvidence(venue, symbol);
      const evidence = live || configuredFee(venue, symbol);
      if (evidence) {
        feeCache.set(key, evidence);
        logger.info('[CEX Fees] Fee evidence resolved', {
          component: 'CexFeeResolver',
          venue,
          symbol,
          source: evidence.source,
          takerFeeBps: evidence.takerFeeBps,
          makerFeeBps: evidence.makerFeeBps,
          makerRebateBps: evidence.makerRebateBps,
        });
      } else if (venue !== 'coinbase') {
        logger.warn('[CEX Fees] No executable fee evidence available for venue', {
          component: 'CexFeeResolver',
          venue,
          symbol,
        });
      }
      return evidence ? { ...evidence } : null;
    } catch (error) {
      logger.warn('[CEX Fees] Authenticated fee discovery failed; checking configured fallback', {
        component: 'CexFeeResolver',
        venue,
        symbol,
        error: error instanceof Error ? error.message : String(error),
      });
      const fallback = configuredFee(venue, symbol);
      if (fallback) {
        feeCache.set(key, fallback);
        logger.info('[CEX Fees] Configured fee fallback resolved', {
          component: 'CexFeeResolver',
          venue,
          symbol,
          takerFeeBps: fallback.takerFeeBps,
        });
      }
      return fallback ? { ...fallback } : null;
    }
  })().finally(() => feeInFlight.delete(key));

  feeInFlight.set(key, promise);
  return promise;
}

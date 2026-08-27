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

export interface CexFeePrimeResult {
  requestedSymbols: number;
  krakenResolved: number;
  okxResolved: number;
  unresolved: Array<{ venue: 'kraken' | 'okx'; symbol: string }>;
}

interface KrakenPairIdentity {
  canonicalSymbol: string;
  requestPair: string;
  responseKey: string;
}

const FEE_CACHE_TTL_MS = Math.max(5_000, Number(process.env.CRYPTO_ARBITRAGE_FEE_CACHE_MS || 60_000));
const REQUEST_TIMEOUT_MS = Math.max(3_000, Number(process.env.CRYPTO_ARBITRAGE_FEE_TIMEOUT_MS || 8_000));
const KRAKEN_PAIR_DIRECTORY_TTL_MS = Math.max(60_000, Number(process.env.CRYPTO_KRAKEN_PAIR_DIRECTORY_TTL_MS || 3_600_000));
// OKX documents 5 account trade-fee requests per 2 seconds per User ID. A
// 425ms minimum start interval stays conservatively below that ceiling.
const OKX_FEE_MIN_INTERVAL_MS = Math.max(425, Number(process.env.CRYPTO_OKX_FEE_MIN_INTERVAL_MS || 450));
const feeCache = new Map<string, CexFeeEvidence>();
const feeInFlight = new Map<string, Promise<CexFeeEvidence | null>>();
let krakenNonce = 0;
let krakenPrivateTail: Promise<void> = Promise.resolve();
let okxPrivateTail: Promise<void> = Promise.resolve();
let okxLastRequestStartedAt = 0;
let krakenPairDirectory: { expiresAt: number; byCanonical: Map<string, KrakenPairIdentity> } | null = null;
let krakenPairDirectoryInFlight: Promise<Map<string, KrakenPairIdentity>> | null = null;

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
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) value = value.slice(1, -1).trim();
  }
  return value || null;
}

function normalizeSymbolInput(symbol: string): string {
  return symbol.trim().toUpperCase();
}

function canonicalKrakenPairSymbol(value: string): string | null {
  const compact = value.trim().toUpperCase().replace(/[\/_-]/g, '');
  if (!compact) return null;
  const quotes = ['USDT', 'USDC', 'USD', 'EUR', 'GBP', 'CAD', 'AUD', 'JPY', 'BTC', 'ETH'];
  const quote = quotes.find(candidate => compact.endsWith(candidate));
  if (!quote) return compact;
  let base = compact.slice(0, -quote.length);
  if (!base) return null;
  if (base === 'XBT') base = 'BTC';
  if (base === 'XDG') base = 'DOGE';
  const canonicalQuote = quote === 'XBT' ? 'BTC' : quote;
  return `${base}${canonicalQuote}`;
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

function cacheKey(venue: CexFeeVenue, symbol: string): string {
  return `${venue}:${normalizeSymbolInput(symbol)}`;
}

function readFreshCache(venue: CexFeeVenue, symbol: string): CexFeeEvidence | null {
  const key = cacheKey(venue, symbol);
  const cached = feeCache.get(key);
  if (!cached) return null;
  if (Date.now() - cached.observedAt > FEE_CACHE_TTL_MS) {
    feeCache.delete(key);
    return null;
  }
  return { ...cached };
}

function storeFeeEvidence(evidence: CexFeeEvidence): void {
  feeCache.set(cacheKey(evidence.venue, evidence.symbol), evidence);
  if (feeCache.size > 512) {
    const now = Date.now();
    for (const [key, value] of feeCache.entries()) {
      if (now - value.observedAt > FEE_CACHE_TTL_MS) feeCache.delete(key);
    }
  }
}

export function getCachedCexFeeEvidence(venue: CexFeeVenue, symbolInput: string): CexFeeEvidence | null {
  const symbol = normalizeSymbolInput(symbolInput);
  return readFreshCache(venue, symbol) || configuredFee(venue, symbol);
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
    throw new Error(`Exchange endpoint returned non-JSON (${response.status})`);
  }
  if (!response.ok) {
    const exchangeCode = payload?.code || payload?.error?.[0] || null;
    const exchangeMessage = payload?.msg || payload?.message || null;
    throw new Error(`Exchange endpoint failed (${response.status})${exchangeCode ? ` code=${exchangeCode}` : ''}${exchangeMessage ? ` message=${exchangeMessage}` : ''}`);
  }
  return payload;
}

function nextKrakenNonce(): string {
  const nonce = Math.max(Date.now(), krakenNonce + 1);
  krakenNonce = nonce;
  return String(nonce);
}

function signKraken(path: string, body: string, nonce: string, decodedSecret: Buffer): string {
  const hash = createHash('sha256').update(nonce + body).digest();
  return createHmac('sha512', decodedSecret).update(Buffer.concat([Buffer.from(path), hash])).digest('base64');
}

/**
 * Kraken private endpoints require monotonically increasing nonces. Generating
 * monotonic values is insufficient when concurrent requests can arrive at the
 * exchange out of order, so authenticated Kraken fee discovery is serialized at
 * the transport boundary. Public quote discovery remains independently parallel.
 */
function serializeKrakenPrivate<T>(operation: () => Promise<T>): Promise<T> {
  const run = krakenPrivateTail.catch(() => undefined).then(operation);
  krakenPrivateTail = run.then(() => undefined, () => undefined);
  return run;
}

function serializeOkxPrivate<T>(operation: () => Promise<T>): Promise<T> {
  const run = okxPrivateTail.catch(() => undefined).then(async () => {
    const waitMs = Math.max(0, okxLastRequestStartedAt + OKX_FEE_MIN_INTERVAL_MS - Date.now());
    if (waitMs > 0) await new Promise(resolve => setTimeout(resolve, waitMs));
    okxLastRequestStartedAt = Date.now();
    return operation();
  });
  okxPrivateTail = run.then(() => undefined, () => undefined);
  return run;
}

async function getKrakenPairDirectory(): Promise<Map<string, KrakenPairIdentity>> {
  if (krakenPairDirectory && krakenPairDirectory.expiresAt > Date.now()) {
    return krakenPairDirectory.byCanonical;
  }
  if (krakenPairDirectoryInFlight) return krakenPairDirectoryInFlight;

  krakenPairDirectoryInFlight = (async () => {
    const response = await fetchWithTimeout('https://api.kraken.com/0/public/AssetPairs', {
      method: 'GET',
      headers: { accept: 'application/json' },
    });
    const payload = await readJson(response);
    if (Array.isArray(payload?.error) && payload.error.length > 0) {
      throw new Error(`Kraken AssetPairs request failed: ${payload.error.join(', ')}`);
    }

    const byCanonical = new Map<string, KrakenPairIdentity>();
    const ambiguous = new Set<string>();
    const result = payload?.result && typeof payload.result === 'object' ? payload.result : {};
    for (const [responseKey, raw] of Object.entries(result)) {
      const row = raw && typeof raw === 'object' ? raw as Record<string, unknown> : null;
      if (!row) continue;
      const requestPair = typeof row.altname === 'string' && row.altname.trim()
        ? row.altname.trim().toUpperCase()
        : typeof row.wsname === 'string' && row.wsname.trim()
          ? row.wsname.trim().toUpperCase()
          : responseKey;
      const variants = [row.altname, row.wsname]
        .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
        .map(canonicalKrakenPairSymbol)
        .filter((value): value is string => Boolean(value));

      for (const canonicalSymbol of new Set(variants)) {
        if (ambiguous.has(canonicalSymbol)) continue;
        const existing = byCanonical.get(canonicalSymbol);
        if (existing && existing.responseKey !== responseKey) {
          byCanonical.delete(canonicalSymbol);
          ambiguous.add(canonicalSymbol);
          continue;
        }
        byCanonical.set(canonicalSymbol, { canonicalSymbol, requestPair, responseKey });
      }
    }

    krakenPairDirectory = {
      expiresAt: Date.now() + KRAKEN_PAIR_DIRECTORY_TTL_MS,
      byCanonical,
    };
    logger.info('[CEX Fees] Kraken AssetPairs translation directory refreshed', {
      component: 'CexFeeResolver',
      pairs: byCanonical.size,
      ambiguousPairs: ambiguous.size,
    });
    return byCanonical;
  })().finally(() => {
    krakenPairDirectoryInFlight = null;
  });

  return krakenPairDirectoryInFlight;
}

async function fetchKrakenFeeEvidenceBatch(symbolInputs: readonly string[]): Promise<Map<string, CexFeeEvidence>> {
  const symbols = [...new Set(symbolInputs.map(normalizeSymbolInput).filter(Boolean))];
  const output = new Map<string, CexFeeEvidence>();
  if (symbols.length === 0) return output;

  const apiKey = credential('KRAKEN_API_KEY');
  const apiSecret = credential('KRAKEN_API_SECRET');
  if (!apiKey || !apiSecret) {
    logger.warn('[CEX Fees] Kraken batch unavailable: credentials incomplete', {
      component: 'CexFeeResolver',
      apiKeyPresent: Boolean(apiKey),
      apiSecretPresent: Boolean(apiSecret),
      symbols: symbols.length,
    });
    return output;
  }

  const decodedSecret = Buffer.from(apiSecret, 'base64');
  if (decodedSecret.length === 0) throw new Error('Kraken API secret is not valid base64');
  const directory = await getKrakenPairDirectory();
  const resolved = symbols.map(symbol => {
    const canonical = canonicalKrakenPairSymbol(symbol);
    const identity = canonical ? directory.get(canonical) : undefined;
    return identity ? { symbol, identity } : null;
  }).filter((value): value is { symbol: string; identity: KrakenPairIdentity } => Boolean(value));
  if (resolved.length === 0) return output;

  return serializeKrakenPrivate(async () => {
    const path = '/0/private/TradeVolume';
    const nonce = nextKrakenNonce();
    const requestPairs = [...new Set(resolved.map(entry => entry.identity.requestPair))];
    const body = new URLSearchParams({ nonce, pair: requestPairs.join(','), 'fee-info': 'true' }).toString();
    const response = await fetchWithTimeout(`https://api.kraken.com${path}`, {
      method: 'POST',
      headers: { 'API-Key': apiKey, 'API-Sign': signKraken(path, body, nonce, decodedSecret), 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });
    const payload = await readJson(response);
    if (payload.error?.length) throw new Error(`Kraken fee batch request failed: ${payload.error.join(', ')}`);
    const result = payload.result || {};
    const fees = result.fees && typeof result.fees === 'object' ? result.fees : {};
    const makerFees = result.fees_maker && typeof result.fees_maker === 'object' ? result.fees_maker : {};
    const observedAt = Date.now();

    for (const { symbol, identity } of resolved) {
      const takerRow = fees[identity.responseKey] as Record<string, unknown> | undefined;
      if (!takerRow) continue;
      const takerPct = finiteNumber(takerRow.fee);
      if (takerPct === null) continue;
      const makerRow = makerFees[identity.responseKey] as Record<string, unknown> | undefined;
      const makerPct = finiteNumber(makerRow?.fee);
      output.set(symbol, {
        venue: 'kraken',
        symbol,
        takerFeeBps: Math.max(0, takerPct * 100),
        makerFeeBps: makerPct !== null && makerPct >= 0 ? makerPct * 100 : null,
        makerRebateBps: makerPct !== null && makerPct < 0 ? Math.abs(makerPct) * 100 : null,
        source: 'kraken_account_trade_volume',
        observedAt,
      });
    }

    logger.info('[CEX Fees] Kraken batch fee evidence resolved', {
      component: 'CexFeeResolver',
      requestedSymbols: symbols.length,
      translatedSymbols: resolved.length,
      resolvedSymbols: output.size,
    });
    return output;
  });
}

async function fetchKrakenFeeEvidence(symbol: string): Promise<CexFeeEvidence | null> {
  const batched = await fetchKrakenFeeEvidenceBatch([symbol]);
  return batched.get(normalizeSymbolInput(symbol)) || null;
}

function okxInstrumentId(symbol: string): string {
  const match = symbol.match(/^([A-Z0-9]+)(USDT|USDC|USD)$/);
  return match ? `${match[1]}-${match[2]}` : symbol;
}

function normalizeOkxBaseUrl(value: string): string {
  const trimmed = value.trim().replace(/\/+$/, '');
  if (!/^https:\/\/[a-z0-9.-]+$/i.test(trimmed)) throw new Error('OKX_API_BASE_URL must be an https origin');
  return trimmed;
}

function okxBaseUrls(): string[] {
  const configured = credential('OKX_API_BASE_URL');
  if (configured) return [normalizeOkxBaseUrl(configured)];
  // US/AU accounts created at app.okx.com require us.okx.com. Global remains a
  // secondary probe so one regional endpoint failure does not disable OKX.
  return ['https://us.okx.com', 'https://openapi.okx.com'];
}

async function fetchOkxFeeEvidenceFromBase(symbol: string, baseUrl: string): Promise<CexFeeEvidence> {
  return serializeOkxPrivate(async () => {
    const apiKey = credential('OKX_API_KEY')!;
    const apiSecret = credential('OKX_API_SECRET')!;
    const passphrase = credential('OKX_API_PASSPHRASE')!;
    const query = new URLSearchParams({ instType: 'SPOT', instId: okxInstrumentId(symbol) }).toString();
    const path = `/api/v5/account/trade-fee?${query}`;
    const timestamp = new Date().toISOString();
    const signature = createHmac('sha256', apiSecret).update(`${timestamp}GET${path}`).digest('base64');
    const response = await fetchWithTimeout(`${baseUrl}${path}`, {
      method: 'GET',
      headers: {
        'OK-ACCESS-KEY': apiKey, 'OK-ACCESS-SIGN': signature, 'OK-ACCESS-TIMESTAMP': timestamp,
        'OK-ACCESS-PASSPHRASE': passphrase, 'Content-Type': 'application/json',
      },
    });
    const payload = await readJson(response);
    if (payload.code !== '0') throw new Error(`OKX fee request failed: ${payload.code}${payload.msg ? ` ${payload.msg}` : ''}`);
    const row = payload.data?.[0];
    const takerRate = finiteNumber(row?.taker);
    if (takerRate === null) throw new Error('OKX trade-fee response did not contain taker fee evidence for the requested pair');
    const makerRate = finiteNumber(row?.maker);
    return {
      venue: 'okx', symbol,
      takerFeeBps: Math.max(0, -takerRate * 10_000),
      makerFeeBps: makerRate !== null && makerRate < 0 ? -makerRate * 10_000 : null,
      makerRebateBps: makerRate !== null && makerRate > 0 ? makerRate * 10_000 : null,
      source: 'okx_account_trade_fee', observedAt: Date.now(),
    };
  });
}

async function fetchOkxFeeEvidence(symbol: string): Promise<CexFeeEvidence | null> {
  const apiKey = credential('OKX_API_KEY');
  const apiSecret = credential('OKX_API_SECRET');
  const passphrase = credential('OKX_API_PASSPHRASE');
  if (!apiKey || !apiSecret || !passphrase) {
    logger.warn('[CEX Fees] OKX unavailable: credentials incomplete', { component: 'CexFeeResolver', venue: 'okx', symbol, apiKeyPresent: Boolean(apiKey), apiSecretPresent: Boolean(apiSecret), passphrasePresent: Boolean(passphrase) });
    return null;
  }

  const failures: string[] = [];
  for (const baseUrl of okxBaseUrls()) {
    try {
      const evidence = await fetchOkxFeeEvidenceFromBase(symbol, baseUrl);
      logger.info('[CEX Fees] OKX authenticated endpoint selected', { component: 'CexFeeResolver', venue: 'okx', symbol, baseUrl });
      return evidence;
    } catch (error) {
      failures.push(`${baseUrl}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  throw new Error(`OKX authenticated fee discovery failed across regional endpoints: ${failures.join(' | ')}`);
}

async function fetchLiveFeeEvidence(venue: CexFeeVenue, symbol: string): Promise<CexFeeEvidence | null> {
  if (venue === 'kraken') return fetchKrakenFeeEvidence(symbol);
  if (venue === 'okx') return fetchOkxFeeEvidence(symbol);
  return null; // Coinbase remains inactive until a settlement-safe execution path is implemented.
}

export async function resolveCexFeeEvidence(venue: CexFeeVenue, symbolInput: string): Promise<CexFeeEvidence | null> {
  const symbol = normalizeSymbolInput(symbolInput);
  const cached = readFreshCache(venue, symbol);
  if (cached) return cached;
  const key = cacheKey(venue, symbol);
  const inFlight = feeInFlight.get(key);
  if (inFlight) return inFlight;

  const promise = (async () => {
    try {
      const live = await fetchLiveFeeEvidence(venue, symbol);
      const evidence = live || configuredFee(venue, symbol);
      if (evidence) {
        storeFeeEvidence(evidence);
        logger.info('[CEX Fees] Fee evidence resolved', { component: 'CexFeeResolver', venue, symbol, source: evidence.source, takerFeeBps: evidence.takerFeeBps, makerFeeBps: evidence.makerFeeBps, makerRebateBps: evidence.makerRebateBps });
      } else if (venue !== 'coinbase') {
        logger.warn('[CEX Fees] Venue excluded from executable routing: no fee evidence', { component: 'CexFeeResolver', venue, symbol });
      }
      return evidence ? { ...evidence } : null;
    } catch (error) {
      logger.warn('[CEX Fees] Authenticated fee discovery failed; venue will fail over to configured evidence or be excluded', { component: 'CexFeeResolver', venue, symbol, error: error instanceof Error ? error.message : String(error) });
      const fallback = configuredFee(venue, symbol);
      if (fallback) {
        storeFeeEvidence(fallback);
        logger.info('[CEX Fees] Configured fee fallback resolved', { component: 'CexFeeResolver', venue, symbol, takerFeeBps: fallback.takerFeeBps });
      }
      return fallback ? { ...fallback } : null;
    }
  })().finally(() => feeInFlight.delete(key));

  feeInFlight.set(key, promise);
  return promise;
}

/**
 * Prime measured fee evidence for a scan batch before parallel quote/economics
 * evaluation. Kraken is resolved in one authenticated TradeVolume call wherever
 * AssetPairs provides an unambiguous mapping. OKX remains per-instrument because
 * account-specific fee programs can differ by instrument, but calls share the
 * documented account rate-limit throttle and existing cache/in-flight dedupe.
 */
export async function primeCexFeeEvidence(symbolInputs: readonly string[]): Promise<CexFeePrimeResult> {
  const symbols = [...new Set(symbolInputs.map(normalizeSymbolInput).filter(Boolean))];
  const unresolved: CexFeePrimeResult['unresolved'] = [];

  const missingKraken = symbols.filter(symbol => !getCachedCexFeeEvidence('kraken', symbol));
  if (missingKraken.length > 0) {
    try {
      const batch = await fetchKrakenFeeEvidenceBatch(missingKraken);
      for (const evidence of batch.values()) storeFeeEvidence(evidence);
    } catch (error) {
      logger.warn('[CEX Fees] Kraken batch prefetch degraded; final per-symbol verification remains available', {
        component: 'CexFeeResolver',
        symbols: missingKraken.length,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const missingOkx = symbols.filter(symbol => !getCachedCexFeeEvidence('okx', symbol));
  if (missingOkx.length > 0) {
    await Promise.all(missingOkx.map(symbol => resolveCexFeeEvidence('okx', symbol)));
  }

  for (const symbol of symbols) {
    if (!getCachedCexFeeEvidence('kraken', symbol)) unresolved.push({ venue: 'kraken', symbol });
    if (!getCachedCexFeeEvidence('okx', symbol)) unresolved.push({ venue: 'okx', symbol });
  }

  return {
    requestedSymbols: symbols.length,
    krakenResolved: symbols.filter(symbol => Boolean(getCachedCexFeeEvidence('kraken', symbol))).length,
    okxResolved: symbols.filter(symbol => Boolean(getCachedCexFeeEvidence('okx', symbol))).length,
    unresolved,
  };
}

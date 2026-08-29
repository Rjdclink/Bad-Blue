import logger from '../../../logger.js';
import {
  getOkxExecutionRestBaseUrl,
  krakenPrivateRequest,
  okxPrivateRequest,
  OkxPrivateApiError,
} from './cex-private-authority.js';
import { assertCoinbaseSpotTradeReady } from './coinbase-advanced-trade-authority.js';
import { getCoinbaseSpotFeeEvidence } from './coinbase-fee-evidence.js';

export type CexFeeVenue = 'coinbase' | 'kraken' | 'okx';

export interface CexFeeEvidence {
  venue: CexFeeVenue;
  symbol: string;
  takerFeeBps: number;
  makerFeeBps: number | null;
  makerRebateBps: number | null;
  source: 'coinbase_transaction_summary' | 'kraken_account_trade_volume' | 'okx_account_trade_fee' | 'configured_override';
  observedAt: number;
}

export interface CexFeePrimeResult {
  requestedSymbols: number;
  requestedByVenue: Record<CexFeeVenue, number>;
  coinbaseResolved: number;
  krakenResolved: number;
  okxResolved: number;
  unresolved: Array<{ venue: CexFeeVenue; symbol: string }>;
}

export interface CexSpotProductSupport {
  venue: CexFeeVenue;
  symbol: string;
  supported: boolean;
  reason: 'quote_time_product_validation' | 'live_spot_pair_directory' | 'not_in_live_spot_pair_directory' | 'live_spot_instrument_directory' | 'not_in_live_spot_instrument_directory';
  baseUrl?: string;
}

interface KrakenPairIdentity {
  canonicalSymbol: string;
  requestPair: string;
  responseKey: string;
}

interface OkxInstrumentIdentity {
  canonicalSymbol: string;
  instId: string;
  groupId: string | null;
}

interface OkxInstrumentDirectorySnapshot {
  expiresAt: number;
  baseUrl: string;
  byCanonical: Map<string, OkxInstrumentIdentity>;
}

class KrakenUnsupportedPairError extends Error {
  constructor(readonly symbol: string) {
    super(`Kraken symbol ${symbol} is not a live spot pair in AssetPairs`);
    this.name = 'KrakenUnsupportedPairError';
  }
}

class OkxUnsupportedInstrumentError extends Error {
  constructor(readonly symbol: string, readonly baseUrl: string) {
    super(`OKX symbol ${symbol} is not a live SPOT instrument on ${baseUrl}`);
    this.name = 'OkxUnsupportedInstrumentError';
  }
}

const FEE_CACHE_TTL_MS = Math.max(5_000, Number(process.env.CRYPTO_ARBITRAGE_FEE_CACHE_MS || 300_000));
const REQUEST_TIMEOUT_MS = Math.max(3_000, Number(process.env.CRYPTO_ARBITRAGE_FEE_TIMEOUT_MS || 8_000));
const KRAKEN_PAIR_DIRECTORY_TTL_MS = Math.max(60_000, Number(process.env.CRYPTO_KRAKEN_PAIR_DIRECTORY_TTL_MS || 3_600_000));
const OKX_INSTRUMENT_DIRECTORY_TTL_MS = Math.max(60_000, Number(process.env.CRYPTO_OKX_INSTRUMENT_DIRECTORY_TTL_MS || 3_600_000));
const feeCache = new Map<string, CexFeeEvidence>();
const feeInFlight = new Map<string, Promise<CexFeeEvidence | null>>();
let krakenPairDirectory: { expiresAt: number; byCanonical: Map<string, KrakenPairIdentity> } | null = null;
let krakenPairDirectoryInFlight: Promise<Map<string, KrakenPairIdentity>> | null = null;
let okxInstrumentDirectory: OkxInstrumentDirectorySnapshot | null = null;
let okxInstrumentDirectoryInFlight: Promise<OkxInstrumentDirectorySnapshot> | null = null;

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
  return `${base}${quote}`;
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

function freshOkxInstrumentDirectory(): OkxInstrumentDirectorySnapshot | null {
  if (!okxInstrumentDirectory) return null;
  if (okxInstrumentDirectory.expiresAt <= Date.now()) {
    okxInstrumentDirectory = null;
    return null;
  }
  return okxInstrumentDirectory;
}

function storeFeeEvidence(evidence: CexFeeEvidence): void {
  feeCache.set(cacheKey(evidence.venue, evidence.symbol), evidence);
  if (feeCache.size > 1024) {
    const now = Date.now();
    for (const [key, value] of feeCache.entries()) {
      if (now - value.observedAt > FEE_CACHE_TTL_MS) feeCache.delete(key);
    }
  }
}

/**
 * Cached evidence means evidence that has already passed the venue's product
 * support authority. A configured number is not returned synchronously here:
 * Kraken/OKX overrides are accepted only after their live product directory has
 * established that the exact symbol is executable on that venue.
 */
export function getCachedCexFeeEvidence(venue: CexFeeVenue, symbolInput: string): CexFeeEvidence | null {
  return readFreshCache(venue, normalizeSymbolInput(symbolInput));
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

async function getKrakenPairDirectory(): Promise<Map<string, KrakenPairIdentity>> {
  if (krakenPairDirectory && krakenPairDirectory.expiresAt > Date.now()) return krakenPairDirectory.byCanonical;
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

    krakenPairDirectory = { expiresAt: Date.now() + KRAKEN_PAIR_DIRECTORY_TTL_MS, byCanonical };
    logger.info('[CEX Fees] Kraken AssetPairs translation directory refreshed', {
      component: 'CexFeeResolver',
      pairs: byCanonical.size,
      ambiguousPairs: ambiguous.size,
    });
    return byCanonical;
  })().finally(() => { krakenPairDirectoryInFlight = null; });

  return krakenPairDirectoryInFlight;
}

async function requireKrakenPair(symbol: string): Promise<KrakenPairIdentity> {
  const directory = await getKrakenPairDirectory();
  const canonical = canonicalKrakenPairSymbol(symbol);
  const identity = canonical ? directory.get(canonical) : undefined;
  if (!identity) throw new KrakenUnsupportedPairError(symbol);
  return identity;
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

  const directory = await getKrakenPairDirectory();
  const unsupportedSymbols: string[] = [];
  const resolved = symbols.map(symbol => {
    const canonical = canonicalKrakenPairSymbol(symbol);
    const identity = canonical ? directory.get(canonical) : undefined;
    if (!identity) unsupportedSymbols.push(symbol);
    return identity ? { symbol, identity } : null;
  }).filter((value): value is { symbol: string; identity: KrakenPairIdentity } => Boolean(value));
  if (resolved.length === 0) {
    logger.debug('[CEX Fees] Kraken fee batch skipped because no requested symbols are live spot pairs', {
      component: 'CexFeeResolver',
      requestedSymbols: symbols.length,
      unsupportedSymbols: unsupportedSymbols.length,
      unsupportedSample: unsupportedSymbols.slice(0, 5),
    });
    return output;
  }

  const requestPairs = [...new Set(resolved.map(entry => entry.identity.requestPair))];
  const result = await krakenPrivateRequest('/0/private/TradeVolume', {
    pair: requestPairs.join(','),
    'fee-info': 'true',
  }, { timeoutMs: REQUEST_TIMEOUT_MS });
  const fees = result.fees && typeof result.fees === 'object' ? result.fees : {};
  const makerFees = result.fees_maker && typeof result.fees_maker === 'object' ? result.fees_maker : {};
  const observedAt = Date.now();
  const missingAuthenticatedRows: Array<{ symbol: string; responseKey: string }> = [];

  for (const { symbol, identity } of resolved) {
    const takerRow = fees[identity.responseKey] as Record<string, unknown> | undefined;
    if (!takerRow) {
      missingAuthenticatedRows.push({ symbol, responseKey: identity.responseKey });
      continue;
    }
    const takerPct = finiteNumber(takerRow.fee);
    if (takerPct === null) {
      missingAuthenticatedRows.push({ symbol, responseKey: identity.responseKey });
      continue;
    }
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
    unsupportedSymbols: unsupportedSymbols.length,
    unsupportedSample: unsupportedSymbols.slice(0, 5),
    authenticatedRowsMissing: missingAuthenticatedRows.length,
    authenticatedRowsMissingSample: missingAuthenticatedRows.slice(0, 5),
    resolvedSymbols: output.size,
  });
  return output;
}

async function fetchKrakenFeeEvidence(symbol: string): Promise<CexFeeEvidence | null> {
  await requireKrakenPair(symbol);
  const batched = await fetchKrakenFeeEvidenceBatch([symbol]);
  return batched.get(normalizeSymbolInput(symbol)) || null;
}

async function fetchCoinbaseFeeEvidence(symbolInput: string): Promise<CexFeeEvidence | null> {
  const symbol = normalizeSymbolInput(symbolInput);
  await assertCoinbaseSpotTradeReady();
  const accountFee = await getCoinbaseSpotFeeEvidence();
  return {
    venue: 'coinbase',
    symbol,
    takerFeeBps: accountFee.takerFeeBps,
    makerFeeBps: accountFee.makerFeeBps,
    makerRebateBps: null,
    source: 'coinbase_transaction_summary',
    observedAt: accountFee.observedAt,
  };
}

function canonicalOkxSymbol(instId: string): string | null {
  const compact = instId.trim().toUpperCase().replace(/[\/_-]/g, '');
  return compact.match(/^([A-Z0-9]+)(USDT|USDC|USD)$/) ? compact : null;
}

async function getOkxInstrumentDirectory(): Promise<OkxInstrumentDirectorySnapshot> {
  const cached = freshOkxInstrumentDirectory();
  if (cached) return cached;
  if (okxInstrumentDirectoryInFlight) return okxInstrumentDirectoryInFlight;

  okxInstrumentDirectoryInFlight = (async () => {
    const baseUrl = await getOkxExecutionRestBaseUrl();
    const response = await fetchWithTimeout(`${baseUrl}/api/v5/public/instruments?instType=SPOT`, {
      method: 'GET',
      headers: { accept: 'application/json' },
    });
    const payload = await readJson(response);
    if (payload.code !== '0') throw new Error(`OKX instrument directory failed: ${payload.code}${payload.msg ? ` ${payload.msg}` : ''}`);

    const byCanonical = new Map<string, OkxInstrumentIdentity>();
    for (const raw of Array.isArray(payload.data) ? payload.data : []) {
      const instId = typeof raw?.instId === 'string' ? raw.instId.trim().toUpperCase() : '';
      const canonicalSymbol = canonicalOkxSymbol(instId);
      if (!canonicalSymbol) continue;
      const state = typeof raw?.state === 'string' ? raw.state.trim().toLowerCase() : '';
      if (state && state !== 'live') continue;
      const groupId = typeof raw?.groupId === 'string' && raw.groupId.trim() ? raw.groupId.trim() : null;
      byCanonical.set(canonicalSymbol, { canonicalSymbol, instId, groupId });
    }

    const snapshot: OkxInstrumentDirectorySnapshot = {
      expiresAt: Date.now() + OKX_INSTRUMENT_DIRECTORY_TTL_MS,
      baseUrl,
      byCanonical,
    };
    okxInstrumentDirectory = snapshot;
    logger.info('[CEX Fees] OKX regional instrument fee-group directory refreshed', {
      component: 'CexFeeResolver',
      baseUrl,
      instruments: byCanonical.size,
      feeGroups: new Set([...byCanonical.values()].map(item => item.groupId).filter(Boolean)).size,
    });
    return snapshot;
  })().finally(() => { okxInstrumentDirectoryInFlight = null; });

  return okxInstrumentDirectoryInFlight;
}

async function requireOkxInstrument(symbol: string): Promise<{ identity: OkxInstrumentIdentity; directory: OkxInstrumentDirectorySnapshot }> {
  const directory = await getOkxInstrumentDirectory();
  const identity = directory.byCanonical.get(symbol);
  if (!identity) throw new OkxUnsupportedInstrumentError(symbol, directory.baseUrl);
  return { identity, directory };
}

export async function getCexSpotProductSupport(venue: CexFeeVenue, symbolInput: string): Promise<CexSpotProductSupport> {
  const symbol = normalizeSymbolInput(symbolInput);
  if (venue === 'coinbase') {
    return { venue, symbol, supported: true, reason: 'quote_time_product_validation' };
  }
  if (venue === 'kraken') {
    const directory = await getKrakenPairDirectory();
    const canonical = canonicalKrakenPairSymbol(symbol);
    const supported = Boolean(canonical && directory.has(canonical));
    return {
      venue,
      symbol,
      supported,
      reason: supported ? 'live_spot_pair_directory' : 'not_in_live_spot_pair_directory',
    };
  }
  const directory = await getOkxInstrumentDirectory();
  const supported = directory.byCanonical.has(symbol);
  return {
    venue,
    symbol,
    supported,
    reason: supported ? 'live_spot_instrument_directory' : 'not_in_live_spot_instrument_directory',
    baseUrl: directory.baseUrl,
  };
}

function selectOkxFeeRates(row: any, groupId: string | null): { taker: number; maker: number | null } | null {
  const groups = Array.isArray(row?.feeGroup) ? row.feeGroup : [];
  const group = groupId
    ? groups.find((candidate: any) => String(candidate?.groupId ?? '') === groupId)
    : groups.length === 1 ? groups[0] : null;
  const taker = finiteNumber(group?.taker ?? row?.taker);
  if (taker === null) return null;
  return { taker, maker: finiteNumber(group?.maker ?? row?.maker) };
}

function okxEvidence(symbol: string, rates: { taker: number; maker: number | null }, observedAt: number): CexFeeEvidence {
  return {
    venue: 'okx',
    symbol,
    takerFeeBps: Math.max(0, -rates.taker * 10_000),
    makerFeeBps: rates.maker !== null && rates.maker < 0 ? -rates.maker * 10_000 : null,
    makerRebateBps: rates.maker !== null && rates.maker > 0 ? rates.maker * 10_000 : null,
    source: 'okx_account_trade_fee',
    observedAt,
  };
}

async function fetchOkxFeeRates(
  queryParameters: Record<string, string>,
  expectedGroupId: string | null,
): Promise<{ rates: { taker: number; maker: number | null }; observedAt: number; baseUrl: string }> {
  const { data, baseUrl } = await okxPrivateRequest(
    '/api/v5/account/trade-fee',
    'GET',
    { instType: 'SPOT', ...queryParameters },
    { timeoutMs: REQUEST_TIMEOUT_MS, lane: 'trade_fee' },
  );
  const row = data[0];
  const rates = selectOkxFeeRates(row, expectedGroupId);
  if (!rates) throw new Error('OKX trade-fee response did not contain applicable fee-group evidence');
  return { rates, observedAt: Date.now(), baseUrl };
}

async function fetchOkxFeeEvidence(symbol: string): Promise<CexFeeEvidence | null> {
  const apiKey = credential('OKX_API_KEY');
  const apiSecret = credential('OKX_API_SECRET');
  const passphrase = credential('OKX_API_PASSPHRASE');
  if (!apiKey || !apiSecret || !passphrase) {
    logger.warn('[CEX Fees] OKX unavailable: credentials incomplete', {
      component: 'CexFeeResolver',
      venue: 'okx',
      symbol,
      apiKeyPresent: Boolean(apiKey),
      apiSecretPresent: Boolean(apiSecret),
      passphrasePresent: Boolean(passphrase),
    });
    return null;
  }

  const normalizedSymbol = normalizeSymbolInput(symbol);
  const { identity, directory } = await requireOkxInstrument(normalizedSymbol);
  const groupId = identity.groupId;
  const query = groupId ? { groupId } : { instId: identity.instId };
  try {
    const result = await fetchOkxFeeRates(query, groupId);
    const evidence = okxEvidence(normalizedSymbol, result.rates, result.observedAt);
    logger.info('[CEX Fees] OKX authenticated fee evidence resolved', {
      component: 'CexFeeResolver',
      venue: 'okx',
      symbol: normalizedSymbol,
      baseUrl: result.baseUrl,
      feeLookup: groupId ? 'group' : 'instrument',
      groupId,
    });
    return evidence;
  } catch (error) {
    if (error instanceof OkxPrivateApiError && error.code === '51001') {
      throw new OkxUnsupportedInstrumentError(normalizedSymbol, directory.baseUrl);
    }
    throw error;
  }
}

async function fetchOkxFeeEvidenceBatch(symbolInputs: readonly string[]): Promise<Map<string, CexFeeEvidence>> {
  const symbols = [...new Set(symbolInputs.map(normalizeSymbolInput).filter(Boolean))];
  const output = new Map<string, CexFeeEvidence>();
  if (symbols.length === 0) return output;

  const apiKey = credential('OKX_API_KEY');
  const apiSecret = credential('OKX_API_SECRET');
  const passphrase = credential('OKX_API_PASSPHRASE');
  if (!apiKey || !apiSecret || !passphrase) return output;

  const directory = await getOkxInstrumentDirectory();
  const byGroup = new Map<string, string[]>();
  const ungrouped: string[] = [];
  const unsupportedSymbols: string[] = [];

  for (const symbol of symbols) {
    const identity = directory.byCanonical.get(symbol);
    if (!identity) {
      unsupportedSymbols.push(symbol);
      continue;
    }
    if (!identity.groupId) {
      ungrouped.push(symbol);
      continue;
    }
    const current = byGroup.get(identity.groupId) || [];
    current.push(symbol);
    byGroup.set(identity.groupId, current);
  }

  for (const [groupId, groupSymbols] of byGroup.entries()) {
    try {
      const result = await fetchOkxFeeRates({ groupId }, groupId);
      for (const symbol of groupSymbols) output.set(symbol, okxEvidence(symbol, result.rates, result.observedAt));
    } catch (error) {
      logger.debug('[CEX Fees] OKX fee-group batch degraded; supported symbols will use per-symbol verification', {
        component: 'CexFeeResolver',
        groupId,
        symbols: groupSymbols.length,
        error: error instanceof Error ? error.message : String(error),
      });
      ungrouped.push(...groupSymbols);
    }
  }

  if (ungrouped.length > 0) {
    await Promise.all(ungrouped.map(async symbol => {
      const evidence = await fetchOkxFeeEvidence(symbol);
      if (evidence) output.set(symbol, evidence);
    }));
  }

  logger.info('[CEX Fees] OKX fee batch resolved using regional live-instrument groups', {
    component: 'CexFeeResolver',
    requestedSymbols: symbols.length,
    groupRequests: byGroup.size,
    perInstrumentFallbacks: ungrouped.length,
    unsupportedSymbols: unsupportedSymbols.length,
    unsupportedSample: unsupportedSymbols.slice(0, 5),
    resolvedSymbols: output.size,
    baseUrl: directory.baseUrl,
  });
  return output;
}

async function fetchLiveFeeEvidence(venue: CexFeeVenue, symbol: string): Promise<CexFeeEvidence | null> {
  if (venue === 'coinbase') return fetchCoinbaseFeeEvidence(symbol);
  if (venue === 'kraken') return fetchKrakenFeeEvidence(symbol);
  return fetchOkxFeeEvidence(symbol);
}

async function supportedKrakenConfiguredFallback(symbol: string): Promise<CexFeeEvidence | null> {
  try {
    await requireKrakenPair(symbol);
    return configuredFee('kraken', symbol);
  } catch {
    return null;
  }
}

async function supportedOkxConfiguredFallback(symbol: string): Promise<CexFeeEvidence | null> {
  try {
    await requireOkxInstrument(symbol);
    return configuredFee('okx', symbol);
  } catch {
    return null;
  }
}

async function configuredFallbackForVenue(venue: CexFeeVenue, symbol: string): Promise<CexFeeEvidence | null> {
  if (venue === 'coinbase') return null;
  return venue === 'kraken' ? supportedKrakenConfiguredFallback(symbol) : supportedOkxConfiguredFallback(symbol);
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
      const evidence = live || await configuredFallbackForVenue(venue, symbol);
      if (evidence) {
        storeFeeEvidence(evidence);
        logger.info('[CEX Fees] Fee evidence resolved', {
          component: 'CexFeeResolver',
          venue,
          symbol,
          source: evidence.source,
          takerFeeBps: evidence.takerFeeBps,
          makerFeeBps: evidence.makerFeeBps,
          makerRebateBps: evidence.makerRebateBps,
        });
      } else {
        logger.warn('[CEX Fees] Live venue product has no supported authenticated fee evidence', {
          component: 'CexFeeResolver',
          venue,
          symbol,
          reason: venue === 'kraken' ? 'live_pair_missing_authenticated_trade_volume_fee_row' : 'authenticated_fee_evidence_unavailable',
        });
      }
      return evidence ? { ...evidence } : null;
    } catch (error) {
      if (venue === 'kraken' && error instanceof KrakenUnsupportedPairError) {
        logger.info('[CEX Fees] Kraken symbol excluded before authenticated fee routing', {
          component: 'CexFeeResolver',
          venue,
          symbol,
          reason: 'not_in_live_spot_pair_directory',
        });
        return null;
      }
      if (venue === 'okx' && error instanceof OkxUnsupportedInstrumentError) {
        logger.info('[CEX Fees] OKX symbol excluded before authenticated fee routing', {
          component: 'CexFeeResolver',
          venue,
          symbol,
          baseUrl: error.baseUrl,
          reason: 'not_in_live_spot_instrument_directory',
        });
        return null;
      }
      logger.warn('[CEX Fees] Authenticated fee discovery failed; only explicitly supported fallback evidence may be used', {
        component: 'CexFeeResolver',
        venue,
        symbol,
        error: error instanceof Error ? error.message : String(error),
      });
      const fallback = await configuredFallbackForVenue(venue, symbol);
      if (fallback) {
        storeFeeEvidence(fallback);
        logger.info('[CEX Fees] Configured fee fallback resolved for verified live product', {
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

function normalizedVenueSymbols(input: Partial<Record<CexFeeVenue, readonly string[]>>): Record<CexFeeVenue, string[]> {
  const normalize = (values: readonly string[] | undefined) => [...new Set((values || []).map(normalizeSymbolInput).filter(Boolean))];
  return {
    coinbase: normalize(input.coinbase),
    kraken: normalize(input.kraken),
    okx: normalize(input.okx),
  };
}

/**
 * Prime only the exact measured venue/symbol combinations that can participate
 * in the current candidate topology. This retains one authenticated Kraken batch,
 * one account-level Coinbase tier request, and grouped regional OKX fee requests,
 * while avoiding private traffic for venues that did not produce a usable quote.
 */
export async function primeCexFeeEvidenceForVenueSymbols(
  input: Partial<Record<CexFeeVenue, readonly string[]>>,
): Promise<CexFeePrimeResult> {
  const requested = normalizedVenueSymbols(input);
  const unresolved: CexFeePrimeResult['unresolved'] = [];

  const missingCoinbase = requested.coinbase.filter(symbol => !readFreshCache('coinbase', symbol));
  if (missingCoinbase.length > 0) {
    try {
      const baseEvidence = await fetchCoinbaseFeeEvidence(missingCoinbase[0]);
      if (baseEvidence) {
        for (const symbol of missingCoinbase) storeFeeEvidence({ ...baseEvidence, symbol });
      }
    } catch (error) {
      logger.debug('[CEX Fees] Coinbase account fee prime unavailable; Coinbase will remain excluded from executable economics', {
        component: 'CexFeeResolver',
        symbols: missingCoinbase.length,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const missingKraken = requested.kraken.filter(symbol => !readFreshCache('kraken', symbol));
  if (missingKraken.length > 0) {
    try {
      const batch = await fetchKrakenFeeEvidenceBatch(missingKraken);
      for (const evidence of batch.values()) storeFeeEvidence(evidence);
      for (const symbol of missingKraken) {
        if (readFreshCache('kraken', symbol)) continue;
        const fallback = await supportedKrakenConfiguredFallback(symbol);
        if (fallback) storeFeeEvidence(fallback);
      }
    } catch (error) {
      logger.warn('[CEX Fees] Kraken batch prefetch degraded; final per-symbol verification remains available', {
        component: 'CexFeeResolver',
        symbols: missingKraken.length,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const missingOkx = requested.okx.filter(symbol => !readFreshCache('okx', symbol));
  if (missingOkx.length > 0) {
    try {
      const batch = await fetchOkxFeeEvidenceBatch(missingOkx);
      for (const evidence of batch.values()) storeFeeEvidence(evidence);
      for (const symbol of missingOkx) {
        if (readFreshCache('okx', symbol)) continue;
        const fallback = await supportedOkxConfiguredFallback(symbol);
        if (fallback) storeFeeEvidence(fallback);
      }
    } catch (error) {
      logger.warn('[CEX Fees] OKX grouped batch prefetch degraded; final supported per-symbol verification remains available', {
        component: 'CexFeeResolver',
        symbols: missingOkx.length,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  for (const venue of ['coinbase', 'kraken', 'okx'] as const) {
    for (const symbol of requested[venue]) {
      if (!readFreshCache(venue, symbol)) unresolved.push({ venue, symbol });
    }
  }

  const allRequestedSymbols = new Set([...requested.coinbase, ...requested.kraken, ...requested.okx]);
  return {
    requestedSymbols: allRequestedSymbols.size,
    requestedByVenue: {
      coinbase: requested.coinbase.length,
      kraken: requested.kraken.length,
      okx: requested.okx.length,
    },
    coinbaseResolved: requested.coinbase.filter(symbol => Boolean(readFreshCache('coinbase', symbol))).length,
    krakenResolved: requested.kraken.filter(symbol => Boolean(readFreshCache('kraken', symbol))).length,
    okxResolved: requested.okx.filter(symbol => Boolean(readFreshCache('okx', symbol))).length,
    unresolved,
  };
}

/** Backward-compatible all-venue prime for callers that truly need every venue. */
export async function primeCexFeeEvidence(symbolInputs: readonly string[]): Promise<CexFeePrimeResult> {
  const symbols = [...new Set(symbolInputs.map(normalizeSymbolInput).filter(Boolean))];
  return primeCexFeeEvidenceForVenueSymbols({
    coinbase: symbols,
    kraken: symbols,
    okx: symbols,
  });
}

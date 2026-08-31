import logger from '../../../logger.js';
import {
  krakenPrivateRequest,
  okxPrivateRequest,
} from './cex-private-authority.js';
import { assertCoinbaseSpotTradeReady } from './coinbase-advanced-trade-authority.js';
import { getCoinbaseSpotFeeEvidence } from './coinbase-fee-evidence.js';
import {
  getSpotProductConstraints,
  type SpotProductConstraints,
} from '../execution/cex-spot-product-policy.js';

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

export interface ResolveCexFeeEvidenceOptions {
  /** Maximum acceptable evidence age for this consumer. Tightens only. */
  maxAgeMs?: number;
  /** Bypass the shared cache and obtain fresh authenticated evidence. */
  forceRefresh?: boolean;
}

const FEE_CACHE_TTL_MS = Math.max(5_000, Number(process.env.CRYPTO_ARBITRAGE_FEE_CACHE_MS || 300_000));
const REQUEST_TIMEOUT_MS = Math.max(3_000, Number(process.env.CRYPTO_ARBITRAGE_FEE_TIMEOUT_MS || 8_000));
const feeCache = new Map<string, CexFeeEvidence>();
const feeInFlight = new Map<string, Promise<CexFeeEvidence | null>>();

function finiteNumber(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function boundedEvidenceAge(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return FEE_CACHE_TTL_MS;
  return Math.max(0, Math.min(FEE_CACHE_TTL_MS, Math.trunc(parsed)));
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
  return symbol.trim().toUpperCase().replace(/[\/_-]/g, '');
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

function readFreshCache(venue: CexFeeVenue, symbol: string, maxAgeMs = FEE_CACHE_TTL_MS): CexFeeEvidence | null {
  const key = cacheKey(venue, symbol);
  const cached = feeCache.get(key);
  if (!cached) return null;
  const ageMs = Date.now() - cached.observedAt;
  if (ageMs > FEE_CACHE_TTL_MS) {
    feeCache.delete(key);
    return null;
  }
  if (ageMs > boundedEvidenceAge(maxAgeMs)) return null;
  return { ...cached };
}

function storeFeeEvidence(evidence: CexFeeEvidence): void {
  feeCache.set(cacheKey(evidence.venue, evidence.symbol), evidence);
  if (feeCache.size <= 1024) return;
  const now = Date.now();
  for (const [key, value] of feeCache.entries()) {
    if (now - value.observedAt > FEE_CACHE_TTL_MS) feeCache.delete(key);
  }
}

export function getCachedCexFeeEvidence(
  venue: CexFeeVenue,
  symbolInput: string,
  maxAgeMs = FEE_CACHE_TTL_MS,
): CexFeeEvidence | null {
  return readFreshCache(venue, normalizeSymbolInput(symbolInput), maxAgeMs);
}

async function verifiedConstraints(
  venue: 'kraken' | 'okx',
  symbol: string,
): Promise<SpotProductConstraints | null> {
  try {
    return await getSpotProductConstraints(venue, symbol);
  } catch (error) {
    logger.debug('[CEX Fees] Product authority rejected fee lookup after targeted live-catalog hydration', {
      component: 'CexFeeResolver',
      venue,
      symbol,
      error: error instanceof Error ? error.message : String(error),
      failClosed: true,
    });
    return null;
  }
}

export async function getCexSpotProductSupport(venue: CexFeeVenue, symbolInput: string): Promise<CexSpotProductSupport> {
  const symbol = normalizeSymbolInput(symbolInput);
  if (venue === 'coinbase') return { venue, symbol, supported: true, reason: 'quote_time_product_validation' };
  const constraints = await verifiedConstraints(venue, symbol);
  const supported = Boolean(constraints);
  return {
    venue,
    symbol,
    supported,
    reason: venue === 'kraken'
      ? supported ? 'live_spot_pair_directory' : 'not_in_live_spot_pair_directory'
      : supported ? 'live_spot_instrument_directory' : 'not_in_live_spot_instrument_directory',
  };
}

async function fetchCoinbaseFeeEvidence(symbolInput: string, forceRefresh = false): Promise<CexFeeEvidence | null> {
  const symbol = normalizeSymbolInput(symbolInput);
  await assertCoinbaseSpotTradeReady();
  const accountFee = await getCoinbaseSpotFeeEvidence(forceRefresh);
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

  const resolved: Array<{ symbol: string; constraints: SpotProductConstraints }> = [];
  const unsupportedSymbols: string[] = [];
  const settled = await Promise.allSettled(symbols.map(async symbol => ({
    symbol,
    constraints: await getSpotProductConstraints('kraken', symbol),
  })));
  for (let index = 0; index < settled.length; index++) {
    const result = settled[index];
    if (result.status === 'fulfilled') resolved.push(result.value);
    else unsupportedSymbols.push(symbols[index]);
  }
  if (resolved.length === 0) return output;

  const requestPairs = [...new Set(resolved.map(entry => entry.constraints.exchangeSymbol))];
  const result = await krakenPrivateRequest('/0/private/TradeVolume', {
    pair: requestPairs.join(','),
    'fee-info': 'true',
  }, { timeoutMs: REQUEST_TIMEOUT_MS });
  const fees = result.fees && typeof result.fees === 'object' ? result.fees : {};
  const makerFees = result.fees_maker && typeof result.fees_maker === 'object' ? result.fees_maker : {};
  const observedAt = Date.now();
  const missingAuthenticatedRows: Array<{ symbol: string; feeLookupKey: string }> = [];

  for (const { symbol, constraints } of resolved) {
    const lookupKey = constraints.feeLookupKey || constraints.exchangeSymbol;
    const takerRow = fees[lookupKey] as Record<string, unknown> | undefined;
    if (!takerRow) {
      missingAuthenticatedRows.push({ symbol, feeLookupKey: lookupKey });
      continue;
    }
    const takerPct = finiteNumber(takerRow.fee);
    if (takerPct === null) {
      missingAuthenticatedRows.push({ symbol, feeLookupKey: lookupKey });
      continue;
    }
    const makerRow = makerFees[lookupKey] as Record<string, unknown> | undefined;
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

  logger.info('[CEX Fees] Kraken batch fee evidence resolved from canonical live-product identities', {
    component: 'CexFeeResolver',
    requestedSymbols: symbols.length,
    translatedSymbols: resolved.length,
    unsupportedSymbols: unsupportedSymbols.length,
    unsupportedSample: unsupportedSymbols.slice(0, 5),
    authenticatedRowsMissing: missingAuthenticatedRows.length,
    authenticatedRowsMissingSample: missingAuthenticatedRows.slice(0, 5),
    resolvedSymbols: output.size,
    productAuthority: 'cex_spot_product_policy',
    quoteCurrencyAllowlistUsed: false,
  });
  return output;
}

async function fetchKrakenFeeEvidence(symbol: string): Promise<CexFeeEvidence | null> {
  const batch = await fetchKrakenFeeEvidenceBatch([symbol]);
  return batch.get(normalizeSymbolInput(symbol)) || null;
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
): Promise<{ rates: { taker: number; maker: number | null }; observedAt: number }> {
  const { data } = await okxPrivateRequest(
    '/api/v5/account/trade-fee',
    'GET',
    { instType: 'SPOT', ...queryParameters },
    { timeoutMs: REQUEST_TIMEOUT_MS, lane: 'trade_fee' },
  );
  const row = data[0];
  const rates = selectOkxFeeRates(row, expectedGroupId);
  if (!rates) throw new Error('OKX trade-fee response did not contain applicable fee-group evidence');
  return { rates, observedAt: Date.now() };
}

async function fetchOkxFeeEvidenceFromConstraint(symbol: string, constraints: SpotProductConstraints): Promise<CexFeeEvidence | null> {
  const groupId = constraints.feeGroupId;
  const query = groupId ? { groupId } : { instId: constraints.exchangeSymbol };
  const result = await fetchOkxFeeRates(query, groupId);
  return okxEvidence(symbol, result.rates, result.observedAt);
}

async function fetchOkxFeeEvidence(symbolInput: string): Promise<CexFeeEvidence | null> {
  const symbol = normalizeSymbolInput(symbolInput);
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
  const constraints = await getSpotProductConstraints('okx', symbol);
  return fetchOkxFeeEvidenceFromConstraint(symbol, constraints);
}

async function fetchOkxFeeEvidenceBatch(symbolInputs: readonly string[]): Promise<Map<string, CexFeeEvidence>> {
  const symbols = [...new Set(symbolInputs.map(normalizeSymbolInput).filter(Boolean))];
  const output = new Map<string, CexFeeEvidence>();
  if (symbols.length === 0) return output;

  const apiKey = credential('OKX_API_KEY');
  const apiSecret = credential('OKX_API_SECRET');
  const passphrase = credential('OKX_API_PASSPHRASE');
  if (!apiKey || !apiSecret || !passphrase) return output;

  const constraintsBySymbol = new Map<string, SpotProductConstraints>();
  const unsupportedSymbols: string[] = [];
  const settled = await Promise.allSettled(symbols.map(async symbol => ({
    symbol,
    constraints: await getSpotProductConstraints('okx', symbol),
  })));
  for (let index = 0; index < settled.length; index++) {
    const result = settled[index];
    if (result.status === 'fulfilled') constraintsBySymbol.set(result.value.symbol, result.value.constraints);
    else unsupportedSymbols.push(symbols[index]);
  }

  const byGroup = new Map<string, string[]>();
  const perInstrument: string[] = [];
  for (const [symbol, constraints] of constraintsBySymbol.entries()) {
    if (!constraints.feeGroupId) {
      perInstrument.push(symbol);
      continue;
    }
    const current = byGroup.get(constraints.feeGroupId) || [];
    current.push(symbol);
    byGroup.set(constraints.feeGroupId, current);
  }

  for (const [groupId, groupSymbols] of byGroup.entries()) {
    try {
      const result = await fetchOkxFeeRates({ groupId }, groupId);
      for (const symbol of groupSymbols) output.set(symbol, okxEvidence(symbol, result.rates, result.observedAt));
    } catch (error) {
      logger.debug('[CEX Fees] OKX fee-group batch degraded; verified products will use per-instrument fee lookup', {
        component: 'CexFeeResolver',
        groupId,
        symbols: groupSymbols.length,
        error: error instanceof Error ? error.message : String(error),
      });
      perInstrument.push(...groupSymbols);
    }
  }

  await Promise.all(perInstrument.map(async symbol => {
    const constraints = constraintsBySymbol.get(symbol);
    if (!constraints) return;
    try {
      const evidence = await fetchOkxFeeEvidenceFromConstraint(symbol, constraints);
      if (evidence) output.set(symbol, evidence);
    } catch (error) {
      logger.debug('[CEX Fees] OKX verified product has no current authenticated fee row', {
        component: 'CexFeeResolver',
        symbol,
        exchangeSymbol: constraints.exchangeSymbol,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }));

  logger.info('[CEX Fees] OKX fee batch resolved from canonical regional live products', {
    component: 'CexFeeResolver',
    requestedSymbols: symbols.length,
    groupRequests: byGroup.size,
    perInstrumentFallbacks: perInstrument.length,
    unsupportedSymbols: unsupportedSymbols.length,
    unsupportedSample: unsupportedSymbols.slice(0, 5),
    resolvedSymbols: output.size,
    productAuthority: 'cex_spot_product_policy',
    quoteCurrencyAllowlistUsed: false,
  });
  return output;
}

async function fetchLiveFeeEvidence(venue: CexFeeVenue, symbol: string, forceRefresh = false): Promise<CexFeeEvidence | null> {
  if (venue === 'coinbase') return fetchCoinbaseFeeEvidence(symbol, forceRefresh);
  if (venue === 'kraken') return fetchKrakenFeeEvidence(symbol);
  return fetchOkxFeeEvidence(symbol);
}

async function configuredFallbackForVenue(venue: CexFeeVenue, symbol: string): Promise<CexFeeEvidence | null> {
  if (venue === 'coinbase') return null;
  const constraints = await verifiedConstraints(venue, symbol);
  return constraints ? configuredFee(venue, symbol) : null;
}

export async function resolveCexFeeEvidence(
  venue: CexFeeVenue,
  symbolInput: string,
  options: ResolveCexFeeEvidenceOptions = {},
): Promise<CexFeeEvidence | null> {
  const symbol = normalizeSymbolInput(symbolInput);
  const maxAgeMs = options.forceRefresh ? 0 : boundedEvidenceAge(options.maxAgeMs ?? FEE_CACHE_TTL_MS);
  const cached = options.forceRefresh ? null : readFreshCache(venue, symbol, maxAgeMs);
  if (cached) return cached;
  const key = cacheKey(venue, symbol);
  const inFlight = feeInFlight.get(key);
  if (inFlight) {
    const evidence = await inFlight;
    if (!evidence) return null;
    return Date.now() - evidence.observedAt <= maxAgeMs || maxAgeMs === 0 ? { ...evidence } : null;
  }

  const promise = (async () => {
    try {
      const live = await fetchLiveFeeEvidence(venue, symbol, options.forceRefresh || maxAgeMs < FEE_CACHE_TTL_MS);
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
          requestedMaxAgeMs: maxAgeMs,
          forceRefresh: options.forceRefresh === true,
        });
        return { ...evidence };
      }
      logger.warn('[CEX Fees] Verified live product has no supported authenticated fee evidence', {
        component: 'CexFeeResolver',
        venue,
        symbol,
        failClosed: true,
      });
      return null;
    } catch (error) {
      logger.warn('[CEX Fees] Authenticated fee discovery failed closed after canonical product hydration', {
        component: 'CexFeeResolver',
        venue,
        symbol,
        error: error instanceof Error ? error.message : String(error),
      });
      const fallback = await configuredFallbackForVenue(venue, symbol);
      if (fallback) {
        storeFeeEvidence(fallback);
        return { ...fallback };
      }
      return null;
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

export async function primeCexFeeEvidenceForVenueSymbols(
  input: Partial<Record<CexFeeVenue, readonly string[]>>,
  maxAgeMs = FEE_CACHE_TTL_MS,
): Promise<CexFeePrimeResult> {
  const requested = normalizedVenueSymbols(input);
  const acceptedAgeMs = boundedEvidenceAge(maxAgeMs);
  const unresolved: CexFeePrimeResult['unresolved'] = [];

  const missingCoinbase = requested.coinbase.filter(symbol => !readFreshCache('coinbase', symbol, acceptedAgeMs));
  if (missingCoinbase.length > 0) {
    try {
      const baseEvidence = await fetchCoinbaseFeeEvidence(missingCoinbase[0], acceptedAgeMs < FEE_CACHE_TTL_MS);
      if (baseEvidence) for (const symbol of missingCoinbase) storeFeeEvidence({ ...baseEvidence, symbol });
    } catch (error) {
      logger.debug('[CEX Fees] Coinbase account fee prime unavailable; Coinbase remains fail-closed for executable economics', {
        component: 'CexFeeResolver',
        symbols: missingCoinbase.length,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const missingKraken = requested.kraken.filter(symbol => !readFreshCache('kraken', symbol, acceptedAgeMs));
  if (missingKraken.length > 0) {
    try {
      const batch = await fetchKrakenFeeEvidenceBatch(missingKraken);
      for (const evidence of batch.values()) storeFeeEvidence(evidence);
      for (const symbol of missingKraken) {
        if (readFreshCache('kraken', symbol, acceptedAgeMs)) continue;
        const fallback = await configuredFallbackForVenue('kraken', symbol);
        if (fallback) storeFeeEvidence(fallback);
      }
    } catch (error) {
      logger.warn('[CEX Fees] Kraken batch prime degraded; per-symbol final verification remains available', {
        component: 'CexFeeResolver',
        symbols: missingKraken.length,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const missingOkx = requested.okx.filter(symbol => !readFreshCache('okx', symbol, acceptedAgeMs));
  if (missingOkx.length > 0) {
    try {
      const batch = await fetchOkxFeeEvidenceBatch(missingOkx);
      for (const evidence of batch.values()) storeFeeEvidence(evidence);
      for (const symbol of missingOkx) {
        if (readFreshCache('okx', symbol, acceptedAgeMs)) continue;
        const fallback = await configuredFallbackForVenue('okx', symbol);
        if (fallback) storeFeeEvidence(fallback);
      }
    } catch (error) {
      logger.warn('[CEX Fees] OKX grouped batch prime degraded; per-symbol final verification remains available', {
        component: 'CexFeeResolver',
        symbols: missingOkx.length,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  for (const venue of ['coinbase', 'kraken', 'okx'] as const) {
    for (const symbol of requested[venue]) {
      if (!readFreshCache(venue, symbol, acceptedAgeMs)) unresolved.push({ venue, symbol });
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
    coinbaseResolved: requested.coinbase.filter(symbol => Boolean(readFreshCache('coinbase', symbol, acceptedAgeMs))).length,
    krakenResolved: requested.kraken.filter(symbol => Boolean(readFreshCache('kraken', symbol, acceptedAgeMs))).length,
    okxResolved: requested.okx.filter(symbol => Boolean(readFreshCache('okx', symbol, acceptedAgeMs))).length,
    unresolved,
  };
}

export async function primeCexFeeEvidence(
  symbolInputs: readonly string[],
  maxAgeMs = FEE_CACHE_TTL_MS,
): Promise<CexFeePrimeResult> {
  const symbols = [...new Set(symbolInputs.map(normalizeSymbolInput).filter(Boolean))];
  return primeCexFeeEvidenceForVenueSymbols({ coinbase: symbols, kraken: symbols, okx: symbols }, maxAgeMs);
}

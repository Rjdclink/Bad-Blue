import logger from '../../../logger.js';
import { krakenPrivateRequest } from './cex-private-authority.js';
import { resolveOkxAccountFeeRates } from './okx-account-fee-authority.js';
import { assertCoinbaseSpotTradeReady } from './coinbase-advanced-trade-authority.js';
import { getCoinbaseSpotFeeEvidence } from './coinbase-fee-evidence.js';
import {
  getSpotProductConstraints,
  SpotProductUnavailableError,
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
  /** Bypass shared cache/backoff and obtain fresh authenticated evidence. */
  forceRefresh?: boolean;
}

const FEE_CACHE_TTL_MS = Math.max(5_000, Number(process.env.CRYPTO_ARBITRAGE_FEE_CACHE_MS || 300_000));
const REQUEST_TIMEOUT_MS = Math.max(3_000, Number(process.env.CRYPTO_ARBITRAGE_FEE_TIMEOUT_MS || 8_000));
const UNAVAILABLE_TTL_MS = Math.max(5_000, Math.min(300_000, Number(process.env.CRYPTO_CEX_FEE_UNAVAILABLE_TTL_MS || 60_000)));
const TRANSIENT_RETRY_MS = Math.max(500, Math.min(10_000, Number(process.env.CRYPTO_CEX_FEE_TRANSIENT_RETRY_MS || 2_500)));
const KRAKEN_FEE_MIN_INTERVAL_MS = (() => {
  const parsed = Number(process.env.CRYPTO_KRAKEN_FEE_MIN_INTERVAL_MS);
  return Number.isFinite(parsed) ? Math.max(2_000, Math.min(30_000, Math.trunc(parsed))) : 2_500;
})();
const KRAKEN_FEE_RATE_COOLDOWN_MS = (() => {
  const parsed = Number(process.env.CRYPTO_KRAKEN_FEE_RATE_COOLDOWN_MS);
  return Number.isFinite(parsed) ? Math.max(10_000, Math.min(300_000, Math.trunc(parsed))) : 40_000;
})();
const OKX_PER_INSTRUMENT_BUDGET = Math.max(1, Math.min(4, Math.floor(Number(process.env.CRYPTO_OKX_FEE_PER_INSTRUMENT_BUDGET || 2))));
const feeCache = new Map<string, CexFeeEvidence>();
const feeInFlight = new Map<string, Promise<CexFeeEvidence | null>>();
const feeUnavailableUntil = new Map<string, { until: number; reason: string }>();
const feeTransientRetryUntil = new Map<string, { until: number; reason: string }>();
let krakenFeeRequestNotBefore = 0;
let okxPerInstrumentCursor = 0;

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

function unavailableEntry(venue: CexFeeVenue, symbol: string): { until: number; reason: string } | null {
  const key = cacheKey(venue, symbol);
  const entry = feeUnavailableUntil.get(key);
  if (!entry) return null;
  if (entry.until <= Date.now()) {
    feeUnavailableUntil.delete(key);
    return null;
  }
  return entry;
}

function transientRetryEntry(venue: CexFeeVenue, symbol: string): { until: number; reason: string } | null {
  const key = cacheKey(venue, symbol);
  const entry = feeTransientRetryUntil.get(key);
  if (!entry) return null;
  if (entry.until <= Date.now()) {
    feeTransientRetryUntil.delete(key);
    return null;
  }
  return entry;
}

function markFeeUnavailable(venue: CexFeeVenue, symbol: string, reason: string, ttlMs = UNAVAILABLE_TTL_MS): void {
  feeUnavailableUntil.set(cacheKey(venue, symbol), {
    until: Date.now() + Math.max(1_000, ttlMs),
    reason,
  });
  feeTransientRetryUntil.delete(cacheKey(venue, symbol));
}

function clearFeeUnavailable(venue: CexFeeVenue, symbol: string): void {
  feeUnavailableUntil.delete(cacheKey(venue, symbol));
}

function markTransientRetry(venue: CexFeeVenue, symbol: string, reason: string, ttlMs = TRANSIENT_RETRY_MS): void {
  if (unavailableEntry(venue, symbol)) return;
  const key = cacheKey(venue, symbol);
  const until = Date.now() + Math.max(250, ttlMs);
  const existing = feeTransientRetryUntil.get(key);
  if (!existing || existing.until < until) feeTransientRetryUntil.set(key, { until, reason });
}

function markTransientRetryMany(venue: CexFeeVenue, symbols: readonly string[], reason: string, ttlMs = TRANSIENT_RETRY_MS): void {
  for (const symbol of symbols) markTransientRetry(venue, symbol, reason, ttlMs);
}

function clearTransientRetry(venue: CexFeeVenue, symbol: string): void {
  feeTransientRetryUntil.delete(cacheKey(venue, symbol));
}

function krakenFeeGateRemainingMs(): number {
  return Math.max(0, krakenFeeRequestNotBefore - Date.now());
}

function holdKrakenFeeRequests(delayMs: number): void {
  krakenFeeRequestNotBefore = Math.max(krakenFeeRequestNotBefore, Date.now() + Math.max(0, delayMs));
}

function suppressKrakenFeeRequestWhileGated(symbols: readonly string[]): boolean {
  const remainingMs = krakenFeeGateRemainingMs();
  if (remainingMs <= 0) return false;
  markTransientRetryMany('kraken', symbols, 'kraken_account_fee_gate_active', remainingMs);
  return true;
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
  // Configured values can assist diagnostics/non-executable planning, but they
  // are never authenticated venue evidence and therefore must never enter the
  // cache used by prime resolution or executable economics.
  if (evidence.source === 'configured_override') return;
  feeCache.set(cacheKey(evidence.venue, evidence.symbol), evidence);
  clearFeeUnavailable(evidence.venue, evidence.symbol);
  clearTransientRetry(evidence.venue, evidence.symbol);
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
    const constraints = await getSpotProductConstraints(venue, symbol);
    clearTransientRetry(venue, symbol);
    return constraints;
  } catch (error) {
    if (error instanceof SpotProductUnavailableError) {
      markFeeUnavailable(venue, symbol, `product_${error.reason}`);
      logger.debug('[CEX Fees] Product authority rejected fee lookup from an authoritative live catalog', {
        component: 'CexFeeResolver',
        venue,
        symbol,
        reason: error.reason,
        retrySuppressedUntil: unavailableEntry(venue, symbol)?.until || null,
        failClosed: true,
      });
      return null;
    }
    markTransientRetry(venue, symbol, 'product_catalog_transient_failure');
    logger.debug('[CEX Fees] Product catalog hydration degraded transiently; product is not negative-cached as unsupported', {
      component: 'CexFeeResolver',
      venue,
      symbol,
      error: error instanceof Error ? error.message : String(error),
      retrySuppressedUntil: transientRetryEntry(venue, symbol)?.until || null,
      authoritativeAbsenceProven: false,
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
    markTransientRetryMany('kraken', symbols, 'credentials_temporarily_unavailable');
    return output;
  }
  if (suppressKrakenFeeRequestWhileGated(symbols)) return output;

  const resolved: Array<{ symbol: string; constraints: SpotProductConstraints }> = [];
  const unsupportedSymbols: string[] = [];
  const transientProductSymbols: string[] = [];
  const settled = await Promise.allSettled(symbols.map(async symbol => ({
    symbol,
    constraints: await getSpotProductConstraints('kraken', symbol),
  })));
  for (let index = 0; index < settled.length; index++) {
    const result = settled[index];
    if (result.status === 'fulfilled') {
      resolved.push(result.value);
      clearTransientRetry('kraken', result.value.symbol);
      continue;
    }
    const symbol = symbols[index];
    if (result.reason instanceof SpotProductUnavailableError) {
      unsupportedSymbols.push(symbol);
      markFeeUnavailable('kraken', symbol, `product_${result.reason.reason}`);
    } else {
      transientProductSymbols.push(symbol);
      markTransientRetry('kraken', symbol, 'product_catalog_transient_failure');
    }
  }
  if (resolved.length === 0) return output;
  if (suppressKrakenFeeRequestWhileGated(resolved.map(entry => entry.symbol))) return output;

  const requestPairs = [...new Set(resolved.map(entry => entry.constraints.exchangeSymbol))];
  holdKrakenFeeRequests(KRAKEN_FEE_MIN_INTERVAL_MS);
  let result: Record<string, any>;
  try {
    result = await krakenPrivateRequest('/0/private/TradeVolume', {
      pair: requestPairs.join(','),
      'fee-info': 'true',
    }, { timeoutMs: REQUEST_TIMEOUT_MS });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes('EAPI:Rate limit exceeded')) {
      holdKrakenFeeRequests(KRAKEN_FEE_RATE_COOLDOWN_MS);
      markTransientRetryMany('kraken', resolved.map(entry => entry.symbol), 'kraken_account_rate_limit_cooldown', KRAKEN_FEE_RATE_COOLDOWN_MS);
      logger.warn('[CEX Fees] Kraken account rate limit engaged one account-wide fee cooldown', {
        component: 'CexFeeResolver',
        symbols: resolved.length,
        cooldownMs: KRAKEN_FEE_RATE_COOLDOWN_MS,
        minimumSuccessIntervalMs: KRAKEN_FEE_MIN_INTERVAL_MS,
        accountWidePrivateCounter: true,
        immediatePerSymbolRetryAllowed: false,
        failClosed: true,
      });
      return output;
    }
    throw error;
  }
  const fees = result.fees && typeof result.fees === 'object' ? result.fees : {};
  const makerFees = result.fees_maker && typeof result.fees_maker === 'object' ? result.fees_maker : {};
  const observedAt = Date.now();
  const missingAuthenticatedRows: Array<{ symbol: string; feeLookupKey: string }> = [];

  for (const { symbol, constraints } of resolved) {
    const lookupKey = constraints.feeLookupKey || constraints.exchangeSymbol;
    const takerRow = fees[lookupKey] as Record<string, unknown> | undefined;
    if (!takerRow) {
      missingAuthenticatedRows.push({ symbol, feeLookupKey: lookupKey });
      markFeeUnavailable('kraken', symbol, 'authenticated_trade_volume_fee_row_missing');
      continue;
    }
    const takerPct = finiteNumber(takerRow.fee);
    if (takerPct === null) {
      missingAuthenticatedRows.push({ symbol, feeLookupKey: lookupKey });
      markFeeUnavailable('kraken', symbol, 'authenticated_trade_volume_fee_rate_missing');
      continue;
    }
    const makerRow = makerFees[lookupKey] as Record<string, unknown> | undefined;
    const makerPct = finiteNumber(makerRow?.fee);
    const evidence: CexFeeEvidence = {
      venue: 'kraken',
      symbol,
      takerFeeBps: Math.max(0, takerPct * 100),
      makerFeeBps: makerPct !== null && makerPct >= 0 ? makerPct * 100 : null,
      makerRebateBps: makerPct !== null && makerPct < 0 ? Math.abs(makerPct) * 100 : null,
      source: 'kraken_account_trade_volume',
      observedAt,
    };
    output.set(symbol, evidence);
    clearFeeUnavailable('kraken', symbol);
    clearTransientRetry('kraken', symbol);
  }

  logger.info('[CEX Fees] Kraken batch fee evidence resolved from canonical live-product identities', {
    component: 'CexFeeResolver',
    requestedSymbols: symbols.length,
    translatedSymbols: resolved.length,
    unsupportedSymbols: unsupportedSymbols.length,
    unsupportedSample: unsupportedSymbols.slice(0, 5),
    transientProductFailures: transientProductSymbols.length,
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
  const result = await resolveOkxAccountFeeRates({
    instType: 'SPOT',
    groupId: queryParameters.groupId,
    instId: queryParameters.instId,
    expectedGroupId,
    timeoutMs: REQUEST_TIMEOUT_MS,
  });
  return {
    rates: { taker: result.taker, maker: result.maker },
    observedAt: result.observedAt,
  };
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
    markTransientRetry('okx', symbol, 'credentials_temporarily_unavailable');
    return null;
  }
  const constraints = await verifiedConstraints('okx', symbol);
  if (!constraints) return null;
  return fetchOkxFeeEvidenceFromConstraint(symbol, constraints);
}

function selectOkxPerInstrumentTargets(symbols: readonly string[]): string[] {
  const unique = [...new Set(symbols)];
  if (unique.length <= OKX_PER_INSTRUMENT_BUDGET) return unique;
  const start = okxPerInstrumentCursor % unique.length;
  const selected = Array.from({ length: OKX_PER_INSTRUMENT_BUDGET }, (_, offset) => unique[(start + offset) % unique.length]);
  okxPerInstrumentCursor = (start + OKX_PER_INSTRUMENT_BUDGET) % unique.length;
  return selected;
}

async function fetchOkxFeeEvidenceBatch(symbolInputs: readonly string[]): Promise<Map<string, CexFeeEvidence>> {
  const symbols = [...new Set(symbolInputs.map(normalizeSymbolInput).filter(Boolean))];
  const output = new Map<string, CexFeeEvidence>();
  if (symbols.length === 0) return output;

  const apiKey = credential('OKX_API_KEY');
  const apiSecret = credential('OKX_API_SECRET');
  const passphrase = credential('OKX_API_PASSPHRASE');
  if (!apiKey || !apiSecret || !passphrase) {
    markTransientRetryMany('okx', symbols, 'credentials_temporarily_unavailable');
    return output;
  }

  const constraintsBySymbol = new Map<string, SpotProductConstraints>();
  const unsupportedSymbols: string[] = [];
  const transientProductSymbols: string[] = [];
  const settled = await Promise.allSettled(symbols.map(async symbol => ({
    symbol,
    constraints: await getSpotProductConstraints('okx', symbol),
  })));
  for (let index = 0; index < settled.length; index++) {
    const result = settled[index];
    if (result.status === 'fulfilled') {
      constraintsBySymbol.set(result.value.symbol, result.value.constraints);
      clearTransientRetry('okx', result.value.symbol);
      continue;
    }
    const symbol = symbols[index];
    if (result.reason instanceof SpotProductUnavailableError) {
      unsupportedSymbols.push(symbol);
      markFeeUnavailable('okx', symbol, `product_${result.reason.reason}`);
    } else {
      transientProductSymbols.push(symbol);
      markTransientRetry('okx', symbol, 'product_catalog_transient_failure');
    }
  }

  const byGroup = new Map<string, string[]>();
  const ungrouped: string[] = [];
  for (const [symbol, constraints] of constraintsBySymbol.entries()) {
    if (!constraints.feeGroupId) {
      ungrouped.push(symbol);
      continue;
    }
    const current = byGroup.get(constraints.feeGroupId) || [];
    current.push(symbol);
    byGroup.set(constraints.feeGroupId, current);
  }

  let failedGroups = 0;
  for (const [groupId, groupSymbols] of byGroup.entries()) {
    try {
      const result = await fetchOkxFeeRates({ groupId }, groupId);
      for (const symbol of groupSymbols) {
        const evidence = okxEvidence(symbol, result.rates, result.observedAt);
        output.set(symbol, evidence);
        clearFeeUnavailable('okx', symbol);
        clearTransientRetry('okx', symbol);
      }
    } catch (error) {
      // A group request already consumed the account-wide private quota. Never
      // fan one group failure into N same-cycle instrument requests. A short
      // transient gate is distinct from product/fee unavailability and therefore
      // cannot falsely convert a transport/rate failure into missing evidence.
      failedGroups += 1;
      markTransientRetryMany('okx', groupSymbols, 'group_fee_request_transient_failure');
      logger.debug('[CEX Fees] OKX fee-group batch degraded; same-cycle per-instrument fan-out suppressed', {
        component: 'CexFeeResolver',
        groupId,
        symbols: groupSymbols.length,
        error: error instanceof Error ? error.message : String(error),
        immediatePerInstrumentFallbackAllowed: false,
        transientRetrySuppressed: true,
      });
    }
  }

  const eligibleUngrouped = ungrouped.filter(symbol => !unavailableEntry('okx', symbol) && !transientRetryEntry('okx', symbol));
  const perInstrumentTargets = selectOkxPerInstrumentTargets(eligibleUngrouped);
  const selectedSet = new Set(perInstrumentTargets);
  markTransientRetryMany(
    'okx',
    eligibleUngrouped.filter(symbol => !selectedSet.has(symbol)),
    'bounded_per_instrument_budget_deferred',
  );
  for (const symbol of perInstrumentTargets) {
    const constraints = constraintsBySymbol.get(symbol);
    if (!constraints) continue;
    try {
      const evidence = await fetchOkxFeeEvidenceFromConstraint(symbol, constraints);
      if (evidence) {
        output.set(symbol, evidence);
        clearFeeUnavailable('okx', symbol);
        clearTransientRetry('okx', symbol);
      }
    } catch (error) {
      // Transport/rate errors are transient, never product-negative evidence.
      markTransientRetry('okx', symbol, 'per_instrument_fee_request_transient_failure');
      logger.debug('[CEX Fees] OKX bounded per-instrument fee lookup degraded', {
        component: 'CexFeeResolver',
        symbol,
        exchangeSymbol: constraints.exchangeSymbol,
        error: error instanceof Error ? error.message : String(error),
        transientRetrySuppressed: true,
      });
    }
  }

  logger.info('[CEX Fees] OKX fee batch resolved from canonical regional live products', {
    component: 'CexFeeResolver',
    requestedSymbols: symbols.length,
    groupRequests: byGroup.size,
    failedGroups,
    ungroupedProducts: ungrouped.length,
    perInstrumentBudget: OKX_PER_INSTRUMENT_BUDGET,
    perInstrumentRequests: perInstrumentTargets.length,
    unsupportedSymbols: unsupportedSymbols.length,
    unsupportedSample: unsupportedSymbols.slice(0, 5),
    transientProductFailures: transientProductSymbols.length,
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
  if (!options.forceRefresh && unavailableEntry(venue, symbol)) return null;
  if (!options.forceRefresh && transientRetryEntry(venue, symbol)) return null;

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
      if (live) {
        storeFeeEvidence(live);
        logger.info('[CEX Fees] Fee evidence resolved', {
          component: 'CexFeeResolver',
          venue,
          symbol,
          source: live.source,
          takerFeeBps: live.takerFeeBps,
          makerFeeBps: live.makerFeeBps,
          makerRebateBps: live.makerRebateBps,
          requestedMaxAgeMs: maxAgeMs,
          forceRefresh: options.forceRefresh === true,
          authenticatedCacheAuthority: true,
        });
        return { ...live };
      }

      const fallback = await configuredFallbackForVenue(venue, symbol);
      if (!unavailableEntry(venue, symbol)) markTransientRetry(venue, symbol, 'authenticated_fee_temporarily_unresolved');
      logger.debug('[CEX Fees] Verified live product has no current authenticated fee evidence', {
        component: 'CexFeeResolver',
        venue,
        symbol,
        retrySuppressed: Boolean(unavailableEntry(venue, symbol) || transientRetryEntry(venue, symbol)),
        configuredFallbackReturnedButNotCached: Boolean(fallback),
        failClosed: true,
      });
      return fallback ? { ...fallback } : null;
    } catch (error) {
      markTransientRetry(venue, symbol, 'authenticated_fee_request_transient_failure');
      logger.warn('[CEX Fees] Authenticated fee discovery failed closed after canonical product hydration', {
        component: 'CexFeeResolver',
        venue,
        symbol,
        error: error instanceof Error ? error.message : String(error),
        transientRetrySuppressed: true,
      });
      const fallback = await configuredFallbackForVenue(venue, symbol);
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

export async function primeCexFeeEvidenceForVenueSymbols(
  input: Partial<Record<CexFeeVenue, readonly string[]>>,
  maxAgeMs = FEE_CACHE_TTL_MS,
): Promise<CexFeePrimeResult> {
  const requested = normalizedVenueSymbols(input);
  const acceptedAgeMs = boundedEvidenceAge(maxAgeMs);
  const unresolved: CexFeePrimeResult['unresolved'] = [];

  const missingCoinbase = requested.coinbase.filter(symbol =>
    !readFreshCache('coinbase', symbol, acceptedAgeMs) && !transientRetryEntry('coinbase', symbol));
  if (missingCoinbase.length > 0) {
    try {
      // Coinbase transaction-summary fees are account-level. One authenticated
      // read hydrates every requested Coinbase SPOT symbol; never issue one fee
      // request per symbol.
      const baseEvidence = await fetchCoinbaseFeeEvidence(missingCoinbase[0], acceptedAgeMs < FEE_CACHE_TTL_MS);
      if (baseEvidence) for (const symbol of missingCoinbase) storeFeeEvidence({ ...baseEvidence, symbol });
      else markTransientRetryMany('coinbase', missingCoinbase, 'account_fee_temporarily_unresolved');
    } catch (error) {
      markTransientRetryMany('coinbase', missingCoinbase, 'account_fee_request_transient_failure');
      logger.debug('[CEX Fees] Coinbase account fee prime unavailable; Coinbase remains fail-closed for executable economics', {
        component: 'CexFeeResolver',
        symbols: missingCoinbase.length,
        error: error instanceof Error ? error.message : String(error),
        transientRetrySuppressed: true,
      });
    }
  }

  const missingKraken = requested.kraken.filter(symbol =>
    !readFreshCache('kraken', symbol, acceptedAgeMs) &&
    !unavailableEntry('kraken', symbol) &&
    !transientRetryEntry('kraken', symbol));
  if (missingKraken.length > 0) {
    try {
      const batch = await fetchKrakenFeeEvidenceBatch(missingKraken);
      for (const evidence of batch.values()) storeFeeEvidence(evidence);
      // Prime resolution is authenticated-only. Configured overrides remain
      // diagnostic fallbacks and may never be cached/count as resolved here.
    } catch (error) {
      markTransientRetryMany('kraken', missingKraken, 'batch_fee_request_transient_failure');
      logger.warn('[CEX Fees] Kraken batch prime degraded; same-cycle per-symbol retry remains suppressed', {
        component: 'CexFeeResolver',
        symbols: missingKraken.length,
        error: error instanceof Error ? error.message : String(error),
        transientRetrySuppressed: true,
      });
    }
  }

  const missingOkx = requested.okx.filter(symbol =>
    !readFreshCache('okx', symbol, acceptedAgeMs) &&
    !unavailableEntry('okx', symbol) &&
    !transientRetryEntry('okx', symbol));
  if (missingOkx.length > 0) {
    try {
      const batch = await fetchOkxFeeEvidenceBatch(missingOkx);
      for (const evidence of batch.values()) storeFeeEvidence(evidence);
      // Do not immediately fan unresolved OKX symbols into individual private
      // lookups. fetchOkxFeeEvidenceBatch owns the bounded rotating fallback budget
      // and records transient suppression for deferred/failed symbols.
    } catch (error) {
      markTransientRetryMany('okx', missingOkx, 'grouped_batch_request_transient_failure');
      logger.warn('[CEX Fees] OKX grouped batch prime degraded; same-cycle fan-out remains suppressed', {
        component: 'CexFeeResolver',
        symbols: missingOkx.length,
        error: error instanceof Error ? error.message : String(error),
        transientRetrySuppressed: true,
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

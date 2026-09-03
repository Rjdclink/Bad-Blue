import logger from '../../../logger.js';
import type { VerifiedArbitragePlan } from '../arbitrage/arbitrage-verifier.js';
import {
  getCachedOkxExecutionRestBaseUrl,
  getOkxExecutionRestBaseUrl,
} from '../intelligence/cex-private-authority.js';
import { fetchJsonWithRetry } from '../utils/resilient-http.js';
import { normalizeCoinbaseExecutablePlan } from './coinbase-executable-plan-policy.js';
import { floorToIncrement, isIncrementAligned } from './coinbase-product-policy.js';

export type ConstrainedSpotVenue = 'kraken' | 'okx';

export interface SpotProductConstraints {
  venue: ConstrainedSpotVenue;
  symbol: string;
  exchangeSymbol: string;
  baseAsset: string;
  quoteAsset: string;
  baseIncrement: number;
  priceIncrement: number;
  baseMinSize: number;
  quoteMinSize: number | null;
  baseMaxSize: number | null;
  quoteMaxSize: number | null;
  feeLookupKey: string | null;
  feeGroupId: string | null;
  state: 'live';
  observedAt: number;
  source: 'kraken_asset_pairs' | 'okx_public_instruments';
}

export interface LiveSpotProductDirectory {
  venue: ConstrainedSpotVenue;
  observedAt: number;
  symbols: string[];
}

export class SpotProductUnavailableError extends Error {
  constructor(
    readonly venue: ConstrainedSpotVenue,
    readonly symbol: string,
    readonly reason: 'invalid_symbol' | 'recently_absent' | 'absent_from_authoritative_catalog',
  ) {
    super(`${venue} SPOT product ${symbol} unavailable: ${reason}`);
    this.name = 'SpotProductUnavailableError';
  }
}

interface ConstraintSnapshot {
  observedAt: number;
  expiresAt: number;
  values: Map<string, SpotProductConstraints>;
}

const TTL_MS = Math.max(5_000, Math.min(300_000, Number(process.env.CRYPTO_CEX_PRODUCT_CONSTRAINT_TTL_MS || 60_000)));
const TIMEOUT_MS = Math.max(1_000, Math.min(10_000, Number(process.env.CRYPTO_CEX_PRODUCT_CONSTRAINT_TIMEOUT_MS || 4_000)));
const NEGATIVE_TTL_MS = Math.max(5_000, Math.min(120_000, Number(process.env.CRYPTO_CEX_PRODUCT_NEGATIVE_TTL_MS || 30_000)));
const MISSING_CATALOG_RECHECK_MS = Math.max(
  5_000,
  Math.min(TTL_MS, Number(process.env.CRYPTO_CEX_MISSING_CATALOG_RECHECK_MS || Math.min(30_000, TTL_MS))),
);
let krakenSnapshot: ConstraintSnapshot | null = null;
let krakenInFlight: Promise<ConstraintSnapshot> | null = null;
let okxSnapshot: ConstraintSnapshot | null = null;
let okxInFlight: Promise<ConstraintSnapshot> | null = null;
const freshConstraintInFlight = new Map<string, Promise<SpotProductConstraints>>();
const unsupportedUntil = new Map<string, number>();

function positive(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function configuredOkxPublicBaseUrl(): string | null {
  const raw = process.env.OKX_API_BASE_URL?.trim().replace(/\/+$/, '');
  if (!raw) return null;
  if (!/^https:\/\/[a-z0-9.-]+$/i.test(raw)) throw new Error('OKX_API_BASE_URL must be an https origin');
  return raw;
}

async function resolveOkxProductBaseUrl(allowAuthenticatedRegionSelection: boolean): Promise<string> {
  const cached = getCachedOkxExecutionRestBaseUrl();
  if (cached) return cached;
  const configured = configuredOkxPublicBaseUrl();
  if (configured) return configured;
  if (!allowAuthenticatedRegionSelection) {
    throw new Error('OKX public product directory deferred until the account region is cached or OKX_API_BASE_URL is configured');
  }
  return getOkxExecutionRestBaseUrl();
}

function canonicalAsset(value: unknown): string | null {
  let asset = String(value ?? '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (!asset) return null;
  if (asset === 'XBT') return 'BTC';
  if (asset === 'XDG') return 'DOGE';
  return asset;
}

function canonicalKrakenAsset(value: unknown): string | null {
  let asset = String(value ?? '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (!asset) return null;
  if ((asset.startsWith('X') || asset.startsWith('Z')) && asset.length === 4) asset = asset.slice(1);
  if (asset === 'XBT') return 'BTC';
  if (asset === 'XDG') return 'DOGE';
  return canonicalAsset(asset);
}

// Exchange tickers are transport labels, not globally unique asset identities.
// These aliases are backed by the venues' own asset/listing documentation and
// prevent economically unrelated products from becoming false-positive spreads.
const VERIFIED_VENUE_ASSET_ALIASES: Readonly<Record<ConstrainedSpotVenue, Readonly<Record<string, string>>>> = Object.freeze({
  kraken: Object.freeze({ LUNA: 'LUNC', UST: 'USTC' }),
  okx: Object.freeze({ LIT: 'LIGHTER', LUNA: 'WLUNA' }),
});

function canonicalVenueAsset(venue: ConstrainedSpotVenue, value: unknown): string | null {
  const asset = venue === 'kraken' ? canonicalKrakenAsset(value) : canonicalAsset(value);
  return asset ? VERIFIED_VENUE_ASSET_ALIASES[venue][asset] || asset : null;
}

type ProductIdentity = { symbol: string; baseAsset: string; quoteAsset: string };

function canonicalPair(
  baseInput: unknown,
  quoteInput: unknown,
  venue?: ConstrainedSpotVenue,
): ProductIdentity | null {
  const baseAsset = venue ? canonicalVenueAsset(venue, baseInput) : canonicalAsset(baseInput);
  const quoteAsset = venue ? canonicalVenueAsset(venue, quoteInput) : canonicalAsset(quoteInput);
  if (!baseAsset || !quoteAsset) return null;
  return { symbol: `${baseAsset}${quoteAsset}`, baseAsset, quoteAsset };
}

function canonicalDelimitedPair(value: unknown, venue?: ConstrainedSpotVenue): ProductIdentity | null {
  const raw = String(value ?? '').trim().toUpperCase();
  if (!raw) return null;
  const parts = raw.split(/[\/_-]/).filter(Boolean);
  return parts.length === 2 ? canonicalPair(parts[0], parts[1], venue) : null;
}

function canonicalLookupSymbol(value: string): string | null {
  const delimited = canonicalDelimitedPair(value);
  if (delimited) return delimited.symbol;
  let compact = value.trim().toUpperCase().replace(/[\/_-]/g, '');
  if (!compact || !/^[A-Z0-9]+$/.test(compact)) return null;
  if (compact.startsWith('XBT')) compact = `BTC${compact.slice(3)}`;
  if (compact.startsWith('XDG')) compact = `DOGE${compact.slice(3)}`;
  return compact;
}

function canonicalKrakenProduct(row: Record<string, unknown>): ProductIdentity | null {
  const fromFields = canonicalPair(row.base, row.quote, 'kraken');
  if (fromFields) return fromFields;
  return canonicalDelimitedPair(row.wsname, 'kraken');
}

function canonicalOkxProduct(raw: Record<string, unknown>): ProductIdentity | null {
  const fromFields = canonicalPair(raw.baseCcy, raw.quoteCcy, 'okx');
  if (fromFields) return fromFields;
  return canonicalDelimitedPair(raw.instId, 'okx');
}

function powerOfTenIncrement(decimals: unknown): number | null {
  const parsed = Number(decimals);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 18) return null;
  return 10 ** -parsed;
}

function krakenConstraint(responseKey: string, row: Record<string, unknown>, observedAt: number): SpotProductConstraints | null {
  const state = typeof row.status === 'string' ? row.status.trim().toLowerCase() : 'online';
  if (state !== 'online') return null;
  const identity = canonicalKrakenProduct(row);
  if (!identity) return null;
  const exchangeSymbol = typeof row.altname === 'string' && row.altname.trim() ? row.altname.trim().toUpperCase() : responseKey;
  const baseIncrement = powerOfTenIncrement(row.lot_decimals);
  const priceIncrement = powerOfTenIncrement(row.pair_decimals);
  const baseMinSize = positive(row.ordermin);
  if (baseIncrement === null || priceIncrement === null || baseMinSize === null) return null;
  return {
    venue: 'kraken',
    symbol: identity.symbol,
    exchangeSymbol,
    baseAsset: identity.baseAsset,
    quoteAsset: identity.quoteAsset,
    baseIncrement,
    priceIncrement,
    baseMinSize,
    quoteMinSize: positive(row.costmin),
    baseMaxSize: null,
    quoteMaxSize: null,
    feeLookupKey: responseKey,
    feeGroupId: null,
    state: 'live',
    observedAt,
    source: 'kraken_asset_pairs',
  };
}

function okxConstraint(raw: Record<string, unknown>, observedAt: number): SpotProductConstraints | null {
  const exchangeSymbol = typeof raw.instId === 'string' ? raw.instId.trim().toUpperCase() : '';
  const identity = canonicalOkxProduct(raw);
  if (!identity || !exchangeSymbol) return null;
  const state = typeof raw.state === 'string' ? raw.state.trim().toLowerCase() : '';
  if (state !== 'live') return null;
  const baseIncrement = positive(raw.lotSz);
  const priceIncrement = positive(raw.tickSz);
  const baseMinSize = positive(raw.minSz);
  if (baseIncrement === null || priceIncrement === null || baseMinSize === null) return null;
  const feeGroupId = typeof raw.groupId === 'string' && raw.groupId.trim() ? raw.groupId.trim() : null;
  return {
    venue: 'okx',
    symbol: identity.symbol,
    exchangeSymbol,
    baseAsset: identity.baseAsset,
    quoteAsset: identity.quoteAsset,
    baseIncrement,
    priceIncrement,
    baseMinSize,
    quoteMinSize: null,
    baseMaxSize: positive(raw.maxLmtSz),
    quoteMaxSize: positive(raw.maxLmtAmt),
    feeLookupKey: exchangeSymbol,
    feeGroupId,
    state: 'live',
    observedAt,
    source: 'okx_public_instruments',
  };
}

function clearNegativeEntries(venue: ConstrainedSpotVenue, snapshot: ConstraintSnapshot): void {
  for (const key of unsupportedUntil.keys()) {
    if (!key.startsWith(`${venue}:`)) continue;
    const symbol = key.slice(venue.length + 1);
    if (snapshot.values.has(symbol)) unsupportedUntil.delete(key);
  }
}

async function fetchKrakenSnapshot(forceRefresh = false): Promise<ConstraintSnapshot> {
  if (!forceRefresh && krakenSnapshot && krakenSnapshot.expiresAt > Date.now()) return krakenSnapshot;
  if (krakenInFlight) return krakenInFlight;
  krakenInFlight = (async () => {
    const payload = await fetchJsonWithRetry<any>('https://api.kraken.com/0/public/AssetPairs', {
      init: { headers: { accept: 'application/json', 'cache-control': forceRefresh ? 'no-cache' : 'max-age=0' } },
      maxRetries: 1,
      baseDelayMs: 100,
      maxDelayMs: 500,
      timeoutMs: TIMEOUT_MS,
    });
    if (Array.isArray(payload?.error) && payload.error.length > 0) throw new Error(`Kraken AssetPairs constraint request failed: ${payload.error.join(', ')}`);
    const values = new Map<string, SpotProductConstraints>();
    const ambiguous = new Set<string>();
    const rows = payload?.result && typeof payload.result === 'object' ? payload.result : {};
    const observedAt = Date.now();
    for (const [responseKey, raw] of Object.entries(rows)) {
      const row = raw && typeof raw === 'object' ? raw as Record<string, unknown> : null;
      if (!row) continue;
      const constraint = krakenConstraint(responseKey, row, observedAt);
      if (!constraint || ambiguous.has(constraint.symbol)) continue;
      if (values.has(constraint.symbol)) {
        values.delete(constraint.symbol);
        ambiguous.add(constraint.symbol);
      } else {
        values.set(constraint.symbol, constraint);
      }
    }
    const snapshot = { observedAt, expiresAt: observedAt + TTL_MS, values };
    krakenSnapshot = snapshot;
    clearNegativeEntries('kraken', snapshot);
    logger.info('[CEX Product] Kraken SPOT constraints refreshed', {
      component: 'CexSpotProductPolicy',
      products: values.size,
      ambiguous: ambiguous.size,
      forcedRefresh: forceRefresh,
      canonicalizationAuthority: 'live_base_quote_fields_or_wsname',
      quoteCurrencyAllowlistUsed: false,
      unpublishedSingleOrderMaxTreatedAsUnlimited: true,
    });
    return snapshot;
  })().finally(() => { krakenInFlight = null; });
  return krakenInFlight;
}

async function fetchOkxSnapshot(
  forceRefresh = false,
  allowAuthenticatedRegionSelection = false,
): Promise<ConstraintSnapshot> {
  if (!forceRefresh && okxSnapshot && okxSnapshot.expiresAt > Date.now()) return okxSnapshot;
  if (okxInFlight) return okxInFlight;
  okxInFlight = (async () => {
    const baseUrl = await resolveOkxProductBaseUrl(allowAuthenticatedRegionSelection);
    const payload = await fetchJsonWithRetry<any>(`${baseUrl}/api/v5/public/instruments?instType=SPOT`, {
      init: { headers: { accept: 'application/json', 'cache-control': forceRefresh ? 'no-cache' : 'max-age=0' } },
      maxRetries: 1,
      baseDelayMs: 100,
      maxDelayMs: 500,
      timeoutMs: TIMEOUT_MS,
    });
    if (String(payload?.code) !== '0') throw new Error(`OKX SPOT instrument constraints failed: ${String(payload?.code)} ${String(payload?.msg || '')}`.trim());
    const values = new Map<string, SpotProductConstraints>();
    const observedAt = Date.now();
    for (const rawValue of Array.isArray(payload?.data) ? payload.data : []) {
      const raw = rawValue && typeof rawValue === 'object' ? rawValue as Record<string, unknown> : null;
      if (!raw) continue;
      const constraint = okxConstraint(raw, observedAt);
      if (constraint) values.set(constraint.symbol, constraint);
    }
    const snapshot = { observedAt, expiresAt: observedAt + TTL_MS, values };
    okxSnapshot = snapshot;
    clearNegativeEntries('okx', snapshot);
    logger.info('[CEX Product] OKX regional SPOT constraints refreshed', {
      component: 'CexSpotProductPolicy',
      baseUrl,
      products: values.size,
      forcedRefresh: forceRefresh,
      authenticatedRegionSelectionAllowed: allowAuthenticatedRegionSelection,
      privateFeeRequestIssuedByPublicDirectory: false,
      canonicalizationAuthority: 'live_baseCcy_quoteCcy_fields',
      quoteCurrencyAllowlistUsed: false,
      perOrderMaximumsCaptured: true,
    });
    return snapshot;
  })().finally(() => { okxInFlight = null; });
  return okxInFlight;
}

export async function getLiveSpotProductDirectory(
  venue: ConstrainedSpotVenue,
  forceFresh = false,
): Promise<LiveSpotProductDirectory> {
  const snapshot = venue === 'kraken'
    ? await fetchKrakenSnapshot(forceFresh)
    : await fetchOkxSnapshot(forceFresh, false);
  return {
    venue,
    observedAt: snapshot.observedAt,
    symbols: [...snapshot.values.keys()].sort(),
  };
}

function updateSnapshotConstraint(venue: ConstrainedSpotVenue, constraint: SpotProductConstraints): void {
  const snapshot = venue === 'kraken' ? krakenSnapshot : okxSnapshot;
  if (!snapshot) return;
  snapshot.values.set(constraint.symbol, constraint);
  unsupportedUntil.delete(`${venue}:${constraint.symbol}`);
}

async function fetchTargetedFreshConstraint(venue: ConstrainedSpotVenue, current: SpotProductConstraints): Promise<SpotProductConstraints> {
  const key = `${venue}:${current.symbol}`;
  const pending = freshConstraintInFlight.get(key);
  if (pending) return pending;

  const request = (async () => {
    const observedAt = Date.now();
    if (venue === 'kraken') {
      const url = `https://api.kraken.com/0/public/AssetPairs?pair=${encodeURIComponent(current.exchangeSymbol)}`;
      const payload = await fetchJsonWithRetry<any>(url, {
        init: { headers: { accept: 'application/json', 'cache-control': 'no-cache' } },
        maxRetries: 1,
        baseDelayMs: 100,
        maxDelayMs: 500,
        timeoutMs: TIMEOUT_MS,
      });
      if (Array.isArray(payload?.error) && payload.error.length > 0) throw new Error(`Kraken targeted AssetPairs refresh failed: ${payload.error.join(', ')}`);
      const rows = payload?.result && typeof payload.result === 'object' ? payload.result : {};
      const matches = Object.entries(rows).flatMap(([responseKey, raw]) => {
        const row = raw && typeof raw === 'object' ? raw as Record<string, unknown> : null;
        const constraint = row ? krakenConstraint(responseKey, row, observedAt) : null;
        return constraint && constraint.symbol === current.symbol ? [constraint] : [];
      });
      if (matches.length !== 1) throw new Error(`Kraken ${current.symbol} targeted refresh returned ${matches.length} unambiguous live products`);
      updateSnapshotConstraint(venue, matches[0]);
      return matches[0];
    }

    const baseUrl = await resolveOkxProductBaseUrl(true);
    const url = `${baseUrl}/api/v5/public/instruments?instType=SPOT&instId=${encodeURIComponent(current.exchangeSymbol)}`;
    const payload = await fetchJsonWithRetry<any>(url, {
      init: { headers: { accept: 'application/json', 'cache-control': 'no-cache' } },
      maxRetries: 1,
      baseDelayMs: 100,
      maxDelayMs: 500,
      timeoutMs: TIMEOUT_MS,
    });
    if (String(payload?.code) !== '0') throw new Error(`OKX targeted instrument refresh failed: ${String(payload?.code)} ${String(payload?.msg || '')}`.trim());
    const matches = (Array.isArray(payload?.data) ? payload.data : []).flatMap((rawValue: unknown) => {
      const raw = rawValue && typeof rawValue === 'object' ? rawValue as Record<string, unknown> : null;
      const constraint = raw ? okxConstraint(raw, observedAt) : null;
      return constraint && constraint.symbol === current.symbol && constraint.exchangeSymbol === current.exchangeSymbol ? [constraint] : [];
    });
    if (matches.length !== 1) throw new Error(`OKX ${current.symbol} targeted refresh returned ${matches.length} unambiguous live products`);
    updateSnapshotConstraint(venue, matches[0]);
    return matches[0];
  })().finally(() => freshConstraintInFlight.delete(key));

  freshConstraintInFlight.set(key, request);
  return request;
}

export async function getSpotProductConstraints(
  venue: ConstrainedSpotVenue,
  symbolInput: string,
  forceFresh = false,
): Promise<SpotProductConstraints> {
  const symbol = canonicalLookupSymbol(symbolInput);
  if (!symbol) throw new SpotProductUnavailableError(venue, symbolInput, 'invalid_symbol');
  const negativeKey = `${venue}:${symbol}`;
  const negativeUntil = unsupportedUntil.get(negativeKey) || 0;
  if (!forceFresh && negativeUntil > Date.now()) {
    throw new SpotProductUnavailableError(venue, symbol, 'recently_absent');
  }

  let snapshot = venue === 'kraken'
    ? await fetchKrakenSnapshot()
    : await fetchOkxSnapshot(false, true);
  let constraint = snapshot.values.get(symbol);
  if (!constraint) {
    // A just-fetched full catalog is already authoritative. Do not force another
    // full catalog request for every missing symbol in the same scan cycle. Only
    // recheck once the shared catalog has aged enough to plausibly be stale.
    if (Date.now() - snapshot.observedAt >= MISSING_CATALOG_RECHECK_MS) {
      snapshot = venue === 'kraken'
        ? await fetchKrakenSnapshot(true)
        : await fetchOkxSnapshot(true, true);
      constraint = snapshot.values.get(symbol);
    }
    if (!constraint) {
      unsupportedUntil.set(negativeKey, Date.now() + NEGATIVE_TTL_MS);
      throw new SpotProductUnavailableError(venue, symbol, 'absent_from_authoritative_catalog');
    }
  }
  unsupportedUntil.delete(negativeKey);
  if (!forceFresh) return { ...constraint };
  return { ...(await fetchTargetedFreshConstraint(venue, constraint)) };
}

function decimalPlaces(value: number): number {
  const text = value.toString().toLowerCase();
  if (text.includes('e-')) {
    const [coefficient, exponentText] = text.split('e-');
    const exponent = Number(exponentText);
    const fractional = coefficient.includes('.') ? coefficient.split('.')[1].length : 0;
    return exponent + fractional;
  }
  return text.includes('.') ? text.split('.')[1].length : 0;
}

function gcd(a: bigint, b: bigint): bigint {
  let left = a < 0n ? -a : a;
  let right = b < 0n ? -b : b;
  while (right !== 0n) [left, right] = [right, left % right];
  return left;
}

function lcm(a: bigint, b: bigint): bigint {
  if (a === 0n || b === 0n) return 0n;
  return (a / gcd(a, b)) * b;
}

function commonIncrement(increments: number[]): number | null {
  if (increments.length === 0 || increments.some(value => !Number.isFinite(value) || value <= 0)) return null;
  const scalePlaces = Math.min(18, Math.max(...increments.map(decimalPlaces)));
  const scale = 10 ** scalePlaces;
  if (!Number.isSafeInteger(scale)) return null;
  const units = increments.map(value => BigInt(Math.round(value * scale)));
  if (units.some(value => value <= 0n)) return null;
  const commonUnits = units.reduce((current, value) => lcm(current, value));
  const numeric = Number(commonUnits) / scale;
  return Number.isFinite(numeric) && numeric > 0 ? numeric : null;
}

function feeBps(plan: VerifiedArbitragePlan, side: 'buy' | 'sell'): number | null {
  const evidence = side === 'buy' ? plan.feeEvidence?.buy : plan.feeEvidence?.sell;
  const value = Number(evidence?.takerFeeBps);
  return Number.isFinite(value) && value >= 0 ? value : null;
}

function recomputeEconomics(plan: VerifiedArbitragePlan, baseQty: number): VerifiedArbitragePlan | null {
  const buyBps = feeBps(plan, 'buy');
  const sellBps = feeBps(plan, 'sell');
  if (buyBps === null || sellBps === null) return null;
  const acquisitionCostUsd = baseQty * plan.buyAsk;
  const proceedsUsd = baseQty * plan.sellBid;
  const buyFeeUsd = acquisitionCostUsd * buyBps / 10_000;
  const sellFeeUsd = proceedsUsd * sellBps / 10_000;
  const fixedCostsUsd = plan.costs.gasUsd + plan.costs.bridgeFeeUsd + (plan.costs.transferFeeUsd ?? 0);
  const totalCostsUsd = buyFeeUsd + sellFeeUsd + fixedCostsUsd;
  const grossProfitUsd = proceedsUsd - acquisitionCostUsd;
  const netProfitUsd = grossProfitUsd - totalCostsUsd;
  if (!Number.isFinite(netProfitUsd) || netProfitUsd <= 0) return null;
  return {
    ...plan,
    baseQty,
    notionalUsd: acquisitionCostUsd,
    executableNotionalUsd: acquisitionCostUsd,
    grossProfitUsd,
    netProfitUsd,
    costs: { ...plan.costs, buyFeeUsd, sellFeeUsd, totalCostsUsd },
  };
}

function validateLeg(side: 'buy' | 'sell', quantity: number, price: number, constraints: SpotProductConstraints): string | null {
  if (!isIncrementAligned(quantity, constraints.baseIncrement)) return `${constraints.venue} ${side} quantity is off lot increment ${constraints.baseIncrement}`;
  if (!isIncrementAligned(price, constraints.priceIncrement)) return `${constraints.venue} ${side} price is off tick increment ${constraints.priceIncrement}`;
  if (quantity + constraints.baseIncrement * 1e-7 < constraints.baseMinSize) return `${constraints.venue} ${side} quantity is below minimum ${constraints.baseMinSize}`;
  if (constraints.quoteMinSize !== null && quantity * price + constraints.priceIncrement * constraints.baseIncrement < constraints.quoteMinSize) {
    return `${constraints.venue} ${side} notional is below quote minimum ${constraints.quoteMinSize}`;
  }
  return null;
}

export async function normalizeCexExecutablePlan(input: VerifiedArbitragePlan): Promise<VerifiedArbitragePlan | null> {
  let plan = await normalizeCoinbaseExecutablePlan(input);
  if (!plan) return null;

  const constraints: Array<{ side: 'buy' | 'sell'; value: SpotProductConstraints }> = [];
  if (plan.buyVenue === 'kraken' || plan.buyVenue === 'okx') {
    constraints.push({ side: 'buy', value: await getSpotProductConstraints(plan.buyVenue, plan.symbol) });
  }
  if (plan.sellVenue === 'kraken' || plan.sellVenue === 'okx') {
    constraints.push({ side: 'sell', value: await getSpotProductConstraints(plan.sellVenue, plan.symbol) });
  }
  if (constraints.length === 0) return plan;

  const increment = commonIncrement(constraints.map(entry => entry.value.baseIncrement));
  if (increment === null) return null;
  const normalizedQty = floorToIncrement(plan.baseQty, increment);
  if (!(normalizedQty > 0)) return null;

  for (const entry of constraints) {
    const price = entry.side === 'buy' ? (plan.buyLimitPrice ?? plan.buyAsk) : (plan.sellLimitPrice ?? plan.sellBid);
    if (!(price > 0) || validateLeg(entry.side, normalizedQty, price, entry.value)) return null;
  }

  if (Math.abs(normalizedQty - plan.baseQty) <= Math.max(increment * 1e-8, Number.EPSILON * plan.baseQty * 16)) return plan;
  return recomputeEconomics(plan, normalizedQty);
}

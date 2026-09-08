import logger from '../../../logger.js';
import { getKalshiApiOrigin } from './kalshi-authenticated-authority.js';

export type KalshiEventFeeType = 'quadratic' | 'quadratic_with_maker_fees' | 'flat' | string;

export interface KalshiEventFeeMetadata {
  ticker: string;
  eventTicker: string;
  seriesTicker: string;
  feeType: KalshiEventFeeType;
  feeMultiplier: number;
  feeWaiverExpirationAt: number | null;
  feeWaiverActive: boolean;
  scheduledChangeAt: number | null;
  scheduledFeeType: KalshiEventFeeType | null;
  scheduledFeeMultiplier: number | null;
  observedAt: number;
  expiresAt: number;
  settlementSources: Array<{ name: string; url: string }>;
  contractTermsUrl: string | null;
  provenance: string[];
}

export interface KalshiEventFeeEstimate {
  ticker: string;
  contracts: number;
  price: number;
  notionalUsd: number;
  takerFeeUsd: number | null;
  makerFeeUsd: number | null;
  takerFeeBps: number | null;
  makerFeeBps: number | null;
  makerVsTakerSavingsBps: number | null;
  feeType: KalshiEventFeeType;
  feeMultiplier: number;
  feeWaiverActiveAdvisory: boolean;
  zeroFeeCreditedFromWaiverMetadata: false;
  economicCreditAllowed: boolean;
  observedAt: number;
  expiresAt: number;
  provenance: string[];
}

const CACHE_MS = Math.max(5_000, Math.min(300_000, Number(process.env.KALSHI_EVENT_FEE_CACHE_MS || 60_000)));
const FORCED_REFRESH_COALESCE_MS = Math.max(250, Math.min(5_000, Number(process.env.KALSHI_EVENT_FEE_FORCE_COALESCE_MS || 1_000)));
const TAKER_QUADRATIC_COEFFICIENT = 0.07;
const MAKER_QUADRATIC_COEFFICIENT = 0.0175;
const cache = new Map<string, KalshiEventFeeMetadata>();
const inFlight = new Map<string, Promise<KalshiEventFeeMetadata | null>>();
const resourceCache = new Map<string, { observedAt: number; expiresAt: number; payload: any }>();
const resourceInFlight = new Map<string, Promise<any>>();

function finite(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function nonnegative(value: unknown): number | null {
  const parsed = finite(value);
  return parsed !== null && parsed >= 0 ? parsed : null;
}

function timestamp(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return value < 10_000_000_000 ? Math.trunc(value * 1_000) : Math.trunc(value);
  }
  if (typeof value !== 'string' || !value.trim()) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

async function publicJson<T>(path: string): Promise<T> {
  if (!path.startsWith('/trade-api/v2/')) throw new Error('Kalshi public fee path rejected');
  const maxAttempts = 4;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const response = await fetch(`${getKalshiApiOrigin()}${path}`, {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(Math.max(1_000, Math.min(10_000, Number(process.env.KALSHI_EVENT_FEE_TIMEOUT_MS || 4_000)))),
    });
    if (response.ok) return response.json() as Promise<T>;
    if (response.status !== 429 || attempt === maxAttempts - 1) {
      throw new Error(`Kalshi public fee request failed HTTP ${response.status} for ${path.split('?')[0]}`);
    }
    await new Promise(resolve => setTimeout(resolve, 125 * 2 ** attempt));
  }
  throw new Error(`Kalshi public fee request exhausted retries for ${path.split('?')[0]}`);
}

async function sharedPublicJson<T>(key: string, path: string, forceRefresh: boolean): Promise<T> {
  const now = Date.now();
  const prior = resourceCache.get(key);
  if (prior && prior.expiresAt > now && (!forceRefresh || now - prior.observedAt <= FORCED_REFRESH_COALESCE_MS)) {
    return prior.payload as T;
  }
  const pending = resourceInFlight.get(key);
  if (pending) return pending as Promise<T>;
  const request = publicJson<T>(path).then(payload => {
    const observedAt = Date.now();
    resourceCache.set(key, { observedAt, expiresAt: observedAt + CACHE_MS, payload });
    return payload;
  }).finally(() => resourceInFlight.delete(key));
  resourceInFlight.set(key, request);
  return request;
}

function eventChangeFor(rows: any[], eventTicker: string, observedAt: number): any | null {
  const future = rows
    .filter(row => String(row?.event_ticker || '').trim().toUpperCase() === eventTicker)
    .map(row => ({ ...row, at: timestamp(row?.scheduled_ts) }))
    .filter(row => row.at !== null && row.at >= observedAt)
    .sort((a, b) => a.at - b.at);
  return future[0] ?? null;
}

export async function getKalshiEventFeeMetadata(tickerInput: string, forceRefresh = false): Promise<KalshiEventFeeMetadata | null> {
  const ticker = tickerInput.trim().toUpperCase();
  if (!ticker) return null;
  const cached = cache.get(ticker);
  if (!forceRefresh && cached && cached.expiresAt > Date.now()) return { ...cached, settlementSources: cached.settlementSources.map(row => ({ ...row })), provenance: [...cached.provenance] };
  const pending = inFlight.get(ticker);
  if (pending) return pending;

  const promise = (async (): Promise<KalshiEventFeeMetadata | null> => {
    const marketPayload = await sharedPublicJson<any>(`market:${ticker}`, `/trade-api/v2/markets/${encodeURIComponent(ticker)}`, forceRefresh);
    const market = marketPayload?.market;
    const eventTicker = String(market?.event_ticker || '').trim().toUpperCase();
    if (!market || !eventTicker) return null;
    const eventPayload = await sharedPublicJson<any>(`event:${eventTicker}`, `/trade-api/v2/events/${encodeURIComponent(eventTicker)}`, forceRefresh);
    const event = eventPayload?.event;
    const seriesTicker = String(event?.series_ticker || '').trim().toUpperCase();
    if (!seriesTicker) return null;
    const [seriesPayload, changesPayload] = await Promise.all([
      sharedPublicJson<any>(`series:${seriesTicker}`, `/trade-api/v2/series/${encodeURIComponent(seriesTicker)}`, forceRefresh),
      sharedPublicJson<any>(
        `event-fee-changes:${eventTicker}`,
        `/trade-api/v2/events/fee_changes?event_ticker=${encodeURIComponent(eventTicker)}&limit=1000`,
        forceRefresh,
      ).catch(() => ({ event_fee_changes: [] })),
    ]);
    const series = seriesPayload?.series;
    const seriesFeeType = String(series?.fee_type || '').trim();
    const seriesFeeMultiplier = nonnegative(series?.fee_multiplier);
    if (!seriesFeeType || seriesFeeMultiplier === null) return null;
    const overrideType = String(event?.fee_type_override || '').trim();
    const overrideMultiplier = nonnegative(event?.fee_multiplier_override);
    const hasOverride = overrideType.length > 0
      || (event?.fee_multiplier_override !== null && event?.fee_multiplier_override !== undefined);
    if (hasOverride && (!overrideType || overrideMultiplier === null)) return null;
    const feeType = hasOverride ? overrideType : seriesFeeType;
    const feeMultiplier = hasOverride ? overrideMultiplier! : seriesFeeMultiplier;
    const observedAt = Date.now();
    const feeWaiverExpirationAt = timestamp(market?.fee_waiver_expiration_time);
    const change = eventChangeFor(Array.isArray(changesPayload?.event_fee_changes) ? changesPayload.event_fee_changes : [], eventTicker, observedAt);
    const scheduledOverrideType = change ? String(change?.fee_type_override || '').trim() : '';
    const scheduledOverrideMultiplier = change ? nonnegative(change?.fee_multiplier_override) : null;
    const scheduledClearsOverride = Boolean(change) && !scheduledOverrideType && change?.fee_multiplier_override == null;
    const settlementSources = (Array.isArray(series?.settlement_sources) ? series.settlement_sources : []).flatMap((row: any) => {
      const name = String(row?.name || '').trim();
      const url = String(row?.url || '').trim();
      return name || url ? [{ name, url }] : [];
    });
    const metadata: KalshiEventFeeMetadata = {
      ticker,
      eventTicker,
      seriesTicker,
      feeType,
      feeMultiplier,
      feeWaiverExpirationAt,
      feeWaiverActive: feeWaiverExpirationAt !== null && feeWaiverExpirationAt > observedAt,
      scheduledChangeAt: change?.at ?? null,
      scheduledFeeType: change ? (scheduledClearsOverride ? seriesFeeType : scheduledOverrideType || null) : null,
      scheduledFeeMultiplier: change ? (scheduledClearsOverride ? seriesFeeMultiplier : scheduledOverrideMultiplier) : null,
      observedAt,
      expiresAt: observedAt + CACHE_MS,
      settlementSources,
      contractTermsUrl: series?.contract_terms_url ? String(series.contract_terms_url) : null,
      provenance: [
        'kalshi_market:live_public_metadata',
        'kalshi_event:live_public_series_identity_and_fee_override',
        'kalshi_series:live_fee_type_and_multiplier',
        'kalshi_event_fee_changes:live_scheduled_override_surface',
        hasOverride ? 'kalshi_event_fee_override:current_effective_authority' : 'kalshi_series_fee:current_effective_authority',
        'kalshi_current_fee_schedule:quadratic_coefficients',
        'fee_waiver_metadata:advisory_until_fill_fee_proof',
        'actual_fill_fee:terminal_authority',
        'unknown_fee_structure:fails_closed',
      ],
    };
    cache.set(ticker, metadata);
    return { ...metadata, settlementSources: metadata.settlementSources.map(row => ({ ...row })), provenance: [...metadata.provenance] };
  })().catch(error => {
    logger.warn('[KalshiEventFees] Event fee metadata failed closed', {
      component: 'KalshiEventFeeAuthority', ticker,
      error: error instanceof Error ? error.message : String(error),
      zeroFeeAssumed: false, configuredFallbackUsed: false,
    });
    return null;
  }).finally(() => inFlight.delete(ticker));
  inFlight.set(ticker, promise);
  return promise;
}

function roundFeeUpToCent(value: number): number {
  if (!(value > 0)) return 0;
  return Math.ceil((value - 1e-12) * 100) / 100;
}

function quadraticFee(coefficient: number, multiplier: number, contracts: number, price: number): number {
  return roundFeeUpToCent(multiplier * coefficient * contracts * price * (1 - price));
}

export async function estimateKalshiEventFees(input: {
  ticker: string;
  contracts: number;
  price: number;
  forceRefresh?: boolean;
}): Promise<KalshiEventFeeEstimate | null> {
  if (!(input.contracts > 0) || !(input.price > 0) || !(input.price < 1)) return null;
  const metadata = await getKalshiEventFeeMetadata(input.ticker, input.forceRefresh === true);
  if (!metadata) return null;
  const notionalUsd = input.contracts * input.price;
  if (!(notionalUsd > 0)) return null;

  let takerFeeUsd: number | null = null;
  let makerFeeUsd: number | null = null;
  let economicCreditAllowed = false;
  if (metadata.feeType === 'quadratic' || metadata.feeType === 'quadratic_with_maker_fees') {
    takerFeeUsd = quadraticFee(TAKER_QUADRATIC_COEFFICIENT, metadata.feeMultiplier, input.contracts, input.price);
    makerFeeUsd = metadata.feeType === 'quadratic_with_maker_fees'
      ? quadraticFee(MAKER_QUADRATIC_COEFFICIENT, metadata.feeMultiplier, input.contracts, input.price)
      : 0;
    economicCreditAllowed = true;
  }

  // A fee-waiver timestamp is useful for route search but it is not allowed to
  // turn a nonzero schedule into zero cost before an authenticated fill reports
  // the actual fee. The normal current schedule therefore remains the pretrade
  // conservative cost even while waiver metadata is active.
  const takerFeeBps = takerFeeUsd === null ? null : takerFeeUsd / notionalUsd * 10_000;
  const makerFeeBps = makerFeeUsd === null ? null : makerFeeUsd / notionalUsd * 10_000;
  const makerVsTakerSavingsBps = takerFeeBps !== null && makerFeeBps !== null ? Math.max(0, takerFeeBps - makerFeeBps) : null;
  return {
    ticker: metadata.ticker,
    contracts: input.contracts,
    price: input.price,
    notionalUsd,
    takerFeeUsd,
    makerFeeUsd,
    takerFeeBps,
    makerFeeBps,
    makerVsTakerSavingsBps,
    feeType: metadata.feeType,
    feeMultiplier: metadata.feeMultiplier,
    feeWaiverActiveAdvisory: metadata.feeWaiverActive,
    zeroFeeCreditedFromWaiverMetadata: false,
    economicCreditAllowed,
    observedAt: metadata.observedAt,
    expiresAt: metadata.expiresAt,
    provenance: [...metadata.provenance, economicCreditAllowed ? 'pretrade_fee_formula:supported_current_structure' : 'pretrade_fee_formula:unsupported_fail_closed'],
  };
}

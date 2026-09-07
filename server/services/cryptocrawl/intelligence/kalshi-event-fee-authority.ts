import logger from '../../../logger.js';
import { getKalshiApiOrigin } from './kalshi-authenticated-authority.js';

export type KalshiEventFeeType = 'quadratic' | 'quadratic_with_maker_fees' | 'flat' | string;

export interface KalshiEventFeeMetadata {
  ticker: string;
  eventTicker: string;
  seriesTicker: string;
  feeType: KalshiEventFeeType;
  feeMultiplier: number;
  eventFeeOverrideActive: boolean;
  eventFeeOverrideId: string | null;
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

type EventFeeChange = {
  id: string;
  eventTicker: string;
  seriesTicker: string;
  feeTypeOverride: KalshiEventFeeType | null;
  feeMultiplierOverride: number | null;
  scheduledAt: number;
};

const CACHE_MS = Math.max(5_000, Math.min(300_000, Number(process.env.KALSHI_EVENT_FEE_CACHE_MS || 60_000)));
const TAKER_QUADRATIC_COEFFICIENT = 0.07;
const MAKER_QUADRATIC_COEFFICIENT = 0.0175;
const cache = new Map<string, KalshiEventFeeMetadata>();
const inFlight = new Map<string, Promise<KalshiEventFeeMetadata | null>>();

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
  const response = await fetch(`${getKalshiApiOrigin()}${path}`, {
    headers: { accept: 'application/json' },
    signal: AbortSignal.timeout(Math.max(1_000, Math.min(10_000, Number(process.env.KALSHI_EVENT_FEE_TIMEOUT_MS || 4_000)))),
  });
  if (!response.ok) throw new Error(`Kalshi public fee request failed HTTP ${response.status} for ${path.split('?')[0]}`);
  return response.json() as Promise<T>;
}

function seriesChangeFor(rows: any[], seriesTicker: string, observedAt: number): any | null {
  const future = rows
    .filter(row => String(row?.series_ticker || '').trim().toUpperCase() === seriesTicker)
    .map(row => ({ ...row, at: timestamp(row?.scheduled_ts) }))
    .filter(row => row.at !== null && row.at >= observedAt)
    .sort((a, b) => a.at - b.at);
  return future[0] ?? null;
}

function parseEventFeeChange(row: any): EventFeeChange | null {
  const id = String(row?.id || '').trim();
  const eventTicker = String(row?.event_ticker || '').trim().toUpperCase();
  const seriesTicker = String(row?.series_ticker || '').trim().toUpperCase();
  const scheduledAt = timestamp(row?.scheduled_ts);
  if (!id || !eventTicker || !seriesTicker || scheduledAt === null) return null;
  const rawType = row?.fee_type_override;
  const feeTypeOverride = rawType === null || rawType === undefined || String(rawType).trim() === ''
    ? null
    : String(rawType).trim();
  const feeMultiplierOverride = row?.fee_multiplier_override === null || row?.fee_multiplier_override === undefined
    ? null
    : nonnegative(row.fee_multiplier_override);
  if (row?.fee_multiplier_override !== null && row?.fee_multiplier_override !== undefined && feeMultiplierOverride === null) return null;
  return { id, eventTicker, seriesTicker, feeTypeOverride, feeMultiplierOverride, scheduledAt };
}

async function getEventFeeChanges(eventTicker: string): Promise<EventFeeChange[]> {
  const rows: EventFeeChange[] = [];
  let cursor = '';
  const seen = new Set<string>();
  for (let page = 0; page < 100; page += 1) {
    const params = new URLSearchParams({ event_ticker: eventTicker, limit: '1000' });
    if (cursor) params.set('cursor', cursor);
    const payload = await publicJson<any>(`/trade-api/v2/events/fee_changes?${params.toString()}`);
    const pageRows = Array.isArray(payload?.event_fee_changes) ? payload.event_fee_changes : [];
    for (const raw of pageRows) {
      const parsed = parseEventFeeChange(raw);
      if (!parsed || parsed.eventTicker !== eventTicker || seen.has(parsed.id)) continue;
      seen.add(parsed.id);
      rows.push(parsed);
    }
    const next = String(payload?.cursor || '').trim();
    if (!next) break;
    if (next === cursor) throw new Error('KALSHI_EVENT_FEE_CHANGE_CURSOR_DID_NOT_ADVANCE');
    cursor = next;
    if (page === 99) throw new Error('KALSHI_EVENT_FEE_CHANGE_PAGINATION_LIMIT_EXCEEDED');
  }
  return rows.sort((left, right) => left.scheduledAt - right.scheduledAt || left.id.localeCompare(right.id));
}

function effectiveEventOverride(changes: EventFeeChange[], observedAt: number): {
  active: EventFeeChange | null;
  future: EventFeeChange | null;
} {
  let active: EventFeeChange | null = null;
  let future: EventFeeChange | null = null;
  for (const row of changes) {
    if (row.scheduledAt <= observedAt) active = row;
    else if (!future) future = row;
  }
  return { active, future };
}

export async function getKalshiEventFeeMetadata(tickerInput: string, forceRefresh = false): Promise<KalshiEventFeeMetadata | null> {
  const ticker = tickerInput.trim().toUpperCase();
  if (!ticker) return null;
  const cached = cache.get(ticker);
  if (!forceRefresh && cached && cached.expiresAt > Date.now()) return { ...cached, settlementSources: cached.settlementSources.map(row => ({ ...row })), provenance: [...cached.provenance] };
  const pending = inFlight.get(ticker);
  if (pending) return pending;

  const promise = (async (): Promise<KalshiEventFeeMetadata | null> => {
    const marketPayload = await publicJson<any>(`/trade-api/v2/markets/${encodeURIComponent(ticker)}`);
    const market = marketPayload?.market;
    const eventTicker = String(market?.event_ticker || '').trim().toUpperCase();
    if (!market || !eventTicker) return null;
    const eventPayload = await publicJson<any>(`/trade-api/v2/events/${encodeURIComponent(eventTicker)}`);
    const seriesTicker = String(eventPayload?.event?.series_ticker || '').trim().toUpperCase();
    if (!seriesTicker) return null;
    const [seriesPayload, seriesChangesPayload, eventChanges] = await Promise.all([
      publicJson<any>(`/trade-api/v2/series/${encodeURIComponent(seriesTicker)}`),
      publicJson<any>('/trade-api/v2/series/fee_changes?show_historical=false').catch(() => ({ series_fee_change_arr: [] })),
      getEventFeeChanges(eventTicker),
    ]);
    const series = seriesPayload?.series;
    const parentFeeType = String(series?.fee_type || '').trim();
    const parentFeeMultiplier = nonnegative(series?.fee_multiplier);
    if (!parentFeeType || parentFeeMultiplier === null) return null;
    const observedAt = Date.now();
    const override = effectiveEventOverride(eventChanges, observedAt);
    if (override.active && override.active.seriesTicker !== seriesTicker) return null;
    const eventOverrideActive = Boolean(override.active && (override.active.feeTypeOverride !== null || override.active.feeMultiplierOverride !== null));
    const feeType = eventOverrideActive && override.active?.feeTypeOverride !== null
      ? override.active!.feeTypeOverride!
      : parentFeeType;
    const feeMultiplier = eventOverrideActive && override.active?.feeMultiplierOverride !== null
      ? override.active!.feeMultiplierOverride!
      : parentFeeMultiplier;
    if (!feeType || feeMultiplier < 0) return null;
    const feeWaiverExpirationAt = timestamp(market?.fee_waiver_expiration_time);
    const seriesChange = seriesChangeFor(Array.isArray(seriesChangesPayload?.series_fee_change_arr) ? seriesChangesPayload.series_fee_change_arr : [], seriesTicker, observedAt);
    const nextEvent = override.future;
    const scheduledChangeAt = [seriesChange?.at ?? null, nextEvent?.scheduledAt ?? null]
      .filter((value): value is number => value !== null)
      .sort((left, right) => left - right)[0] ?? null;
    let scheduledFeeType: KalshiEventFeeType | null = seriesChange ? String(seriesChange?.fee_type || '').trim() || null : null;
    let scheduledFeeMultiplier: number | null = seriesChange ? nonnegative(seriesChange?.fee_multiplier) : null;
    if (nextEvent && (seriesChange?.at === undefined || nextEvent.scheduledAt <= seriesChange.at)) {
      const futureOverrideActive = nextEvent.feeTypeOverride !== null || nextEvent.feeMultiplierOverride !== null;
      scheduledFeeType = futureOverrideActive ? (nextEvent.feeTypeOverride ?? parentFeeType) : parentFeeType;
      scheduledFeeMultiplier = futureOverrideActive ? (nextEvent.feeMultiplierOverride ?? parentFeeMultiplier) : parentFeeMultiplier;
    }
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
      eventFeeOverrideActive,
      eventFeeOverrideId: eventOverrideActive ? override.active?.id ?? null : null,
      feeWaiverExpirationAt,
      feeWaiverActive: feeWaiverExpirationAt !== null && feeWaiverExpirationAt > observedAt,
      scheduledChangeAt,
      scheduledFeeType,
      scheduledFeeMultiplier,
      observedAt,
      expiresAt: observedAt + CACHE_MS,
      settlementSources,
      contractTermsUrl: series?.contract_terms_url ? String(series.contract_terms_url) : null,
      provenance: [
        'kalshi_market:live_public_metadata',
        'kalshi_event:live_public_series_identity',
        'kalshi_series:live_fee_type_and_multiplier',
        'kalshi_event_fee_changes:historical_and_scheduled_override_authority',
        eventOverrideActive ? 'kalshi_event_fee_override:applied' : 'kalshi_event_fee_override:parent_series_effective',
        'kalshi_series_fee_changes:live_scheduled_change_surface',
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

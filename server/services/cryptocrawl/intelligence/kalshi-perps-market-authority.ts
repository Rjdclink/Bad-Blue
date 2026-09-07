import logger from '../../../logger.js';
import {
  getKalshiApiOrigin,
  getKalshiMarginEnabled,
  kalshiAuthenticatedRequest,
  kalshiCredentialsPresent,
} from './kalshi-authenticated-authority.js';
import { getKalshiMarginFeeEvidence, type KalshiMarginFeeEvidence } from './kalshi-margin-fee-authority.js';

export interface KalshiMarginMarket {
  ticker: string;
  title: string;
  contractSize: number | null;
  tickSize: number | null;
  status: 'inactive' | 'active' | 'closed' | string;
  fractionalTradingEnabled: boolean;
  isOpen: boolean;
  nextCloseTs: number | null;
  nextOpenTs: number | null;
  bid: number | null;
  ask: number | null;
  settlementMarkPrice: number | null;
  liquidationMarkPrice: number | null;
  referencePrice: number | null;
  referenceObservedAt: number | null;
  assetClass: string | null;
  observedAt: number;
}

export interface KalshiOrderbookLevel {
  price: number;
  quantity: number;
}

export interface KalshiPerpOrderbook {
  ticker: string;
  bids: KalshiOrderbookLevel[];
  asks: KalshiOrderbookLevel[];
  observedAt: number;
}

export interface KalshiPerpFundingEvidence {
  ticker: string;
  fundingRate: number;
  nextFundingTime: number;
  computedTime: number | null;
  markPrice: number | null;
  fundingRateLocked: false;
  observedAt: number;
  source: 'kalshi_public_margin_funding_estimate';
}

export interface KalshiMarginAccountReadiness {
  observedAt: number;
  credentialsPresent: boolean;
  marginEnabled: boolean;
  availableBalanceUsd: number | null;
  availableBalanceComputed: boolean;
  settledFundsUsd: number | null;
  accountEquityUsd: number | null;
  maintenanceMarginUsd: number | null;
  initialMarginUsd: number | null;
  totalPositionNotionalUsd: number | null;
  totalMaintenanceMarginUsd: number | null;
  accountLeverage: number | null;
  authenticated: boolean;
  executionAuthorityGranted: false;
  provenance: string[];
}

export interface KalshiPerpsApiLimits {
  observedAt: number;
  usageTier: string | null;
  readRefillRate: number | null;
  readBucketCapacity: number | null;
  writeRefillRate: number | null;
  writeBucketCapacity: number | null;
  grants: Array<{ exchangeInstance: string; level: string; source: string; expiresTs: number | null }>;
  authenticated: boolean;
}

export interface KalshiMarginExchangeStatus {
  observedAt: number;
  exchangeActive: boolean;
  tradingActive: boolean;
}

export interface KalshiNotionalRiskLimit {
  observedAt: number;
  defaultNotionalUsd: number | null;
  byTicker: Record<string, number>;
  authenticated: boolean;
}

const MARKET_CACHE_MS = Math.max(1_000, Math.min(60_000, Number(process.env.KALSHI_MARKET_CACHE_MS || 5_000)));
const ACCOUNT_CACHE_MS = Math.max(1_000, Math.min(30_000, Number(process.env.KALSHI_ACCOUNT_CACHE_MS || 5_000)));
const LIMIT_CACHE_MS = Math.max(5_000, Math.min(300_000, Number(process.env.KALSHI_API_LIMIT_CACHE_MS || 60_000)));
let marketCache: { observedAt: number; markets: KalshiMarginMarket[] } | null = null;
let marketInFlight: Promise<KalshiMarginMarket[]> | null = null;
const accountCache = new Map<'computed' | 'uncomputed', { observedAt: number; value: KalshiMarginAccountReadiness }>();
const accountInFlight = new Map<'computed' | 'uncomputed', Promise<KalshiMarginAccountReadiness>>();
let limitsCache: { observedAt: number; value: KalshiPerpsApiLimits } | null = null;

function finite(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function positive(value: unknown): number | null {
  const parsed = finite(value);
  return parsed !== null && parsed > 0 ? parsed : null;
}

function timestamp(value: unknown): number | null {
  const direct = finite(value);
  if (direct !== null && direct > 0) return direct < 10_000_000_000 ? Math.trunc(direct * 1_000) : Math.trunc(direct);
  if (typeof value !== 'string' || !value.trim()) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function safeTicker(value: unknown): string {
  return String(value || '').trim().toUpperCase();
}

/** Supports current BTC-PERP style plus earlier KXBTCPERP-style product identifiers. */
export function kalshiPerpBaseAsset(tickerInput: string): string | null {
  const ticker = safeTicker(tickerInput);
  const current = ticker.match(/^([A-Z0-9]+)-PERP$/);
  if (current) return current[1];
  const kx = ticker.match(/^KX([A-Z0-9]+)PERP$/);
  if (kx) return kx[1];
  const compact = ticker.match(/^([A-Z0-9]+)PERP$/);
  return compact ? compact[1].replace(/^KX/, '') : null;
}

async function publicJson<T>(path: string, timeoutMs = 4_000): Promise<T> {
  if (!path.startsWith('/trade-api/v2/margin/')) throw new Error('Kalshi public margin path rejected');
  const response = await fetch(`${getKalshiApiOrigin()}${path}`, {
    headers: { accept: 'application/json' },
    signal: AbortSignal.timeout(Math.max(1_000, Math.min(10_000, timeoutMs))),
  });
  if (!response.ok) throw new Error(`Kalshi public margin request failed HTTP ${response.status}`);
  return response.json() as Promise<T>;
}

function normalizeMarket(row: any, observedAt: number): KalshiMarginMarket | null {
  const ticker = safeTicker(row?.ticker);
  if (!ticker) return null;
  const schedulePresent = row !== null && typeof row === 'object' && Object.prototype.hasOwnProperty.call(row, 'schedule');
  const schedule = schedulePresent ? row.schedule : undefined;
  return {
    ticker,
    title: String(row?.title || ''),
    contractSize: positive(row?.contract_size),
    tickSize: positive(row?.tick_size),
    status: String(row?.status || ''),
    fractionalTradingEnabled: row?.fractional_trading_enabled === true,
    // OpenAPI: schedule=null means 24/7. A missing required schedule key remains fail-closed.
    isOpen: schedule === null ? true : schedule?.is_open === true,
    nextCloseTs: timestamp(schedule?.next_close_ts),
    nextOpenTs: timestamp(schedule?.next_open_ts),
    bid: positive(row?.bid),
    ask: positive(row?.ask),
    settlementMarkPrice: positive(row?.settlement_mark_price?.price),
    liquidationMarkPrice: positive(row?.liquidation_mark_price?.price),
    referencePrice: positive(row?.reference_price?.price),
    referenceObservedAt: timestamp(row?.reference_price?.ts_ms),
    assetClass: row?.asset_class ? String(row.asset_class) : null,
    observedAt,
  };
}

export async function getKalshiMarginMarkets(forceRefresh = false): Promise<KalshiMarginMarket[]> {
  const now = Date.now();
  if (!forceRefresh && marketCache && now - marketCache.observedAt <= MARKET_CACHE_MS) {
    return marketCache.markets.map(row => ({ ...row }));
  }
  if (marketInFlight) return (await marketInFlight).map(row => ({ ...row }));
  marketInFlight = (async () => {
    const payload = await publicJson<{ markets?: any[] }>('/trade-api/v2/margin/markets?status=active');
    const observedAt = Date.now();
    const markets = (Array.isArray(payload?.markets) ? payload.markets : [])
      .map(row => normalizeMarket(row, observedAt))
      .filter((row): row is KalshiMarginMarket => row !== null);
    marketCache = { observedAt, markets };
    return markets;
  })().finally(() => { marketInFlight = null; });
  return (await marketInFlight).map(row => ({ ...row }));
}

export async function getKalshiPerpOrderbook(tickerInput: string, depth = 0): Promise<KalshiPerpOrderbook> {
  const ticker = safeTicker(tickerInput);
  if (!ticker) throw new Error('Kalshi margin ticker is required');
  const boundedDepth = Number.isFinite(depth) ? Math.max(0, Math.min(500, Math.trunc(depth))) : 0;
  const payload = await publicJson<{ orderbook?: { bids?: unknown[]; asks?: unknown[] } }>(
    `/trade-api/v2/margin/markets/${encodeURIComponent(ticker)}/orderbook?depth=${boundedDepth}`,
  );
  const parseLevels = (levels: unknown): KalshiOrderbookLevel[] => (Array.isArray(levels) ? levels : [])
    .map(row => Array.isArray(row) ? { price: positive(row[0]), quantity: positive(row[1]) } : { price: null, quantity: null })
    .filter((row): row is { price: number; quantity: number } => row.price !== null && row.quantity !== null);
  return {
    ticker,
    bids: parseLevels(payload?.orderbook?.bids).sort((left, right) => right.price - left.price),
    asks: parseLevels(payload?.orderbook?.asks).sort((left, right) => left.price - right.price),
    observedAt: Date.now(),
  };
}

export async function getKalshiPerpFundingEvidence(tickerInput: string): Promise<KalshiPerpFundingEvidence | null> {
  const ticker = safeTicker(tickerInput);
  if (!ticker) return null;
  const payload = await publicJson<any>(`/trade-api/v2/margin/funding_rates/estimate?ticker=${encodeURIComponent(ticker)}`);
  const fundingRate = finite(payload?.funding_rate);
  const nextFundingTime = timestamp(payload?.next_funding_time);
  const computedTime = timestamp(payload?.computed_time);
  const markPrice = positive(payload?.mark_price ?? payload?.mark_price_dollars);
  // Current schema requires next_funding_time; funding_rate/mark may be absent during upstream outages.
  if (fundingRate === null || nextFundingTime === null) return null;
  return {
    ticker: safeTicker(payload?.market_ticker) || ticker,
    fundingRate,
    nextFundingTime,
    computedTime,
    markPrice,
    fundingRateLocked: false,
    observedAt: computedTime ?? Date.now(),
    source: 'kalshi_public_margin_funding_estimate',
  };
}

export async function getKalshiPerpExecutionEvidence(tickerInput: string, forceRefreshFees = false): Promise<{
  market: KalshiMarginMarket & { contractSize: number; tickSize: number };
  orderbook: KalshiPerpOrderbook;
  funding: KalshiPerpFundingEvidence | null;
  fees: KalshiMarginFeeEvidence;
  marginEnabled: true;
  observedAt: number;
} | null> {
  if (!kalshiCredentialsPresent()) return null;
  const ticker = safeTicker(tickerInput);
  const markets = await getKalshiMarginMarkets();
  const market = markets.find(row => row.ticker === ticker);
  if (!market || market.status !== 'active' || !market.isOpen || market.contractSize === null || market.tickSize === null) return null;
  const [marginEnabled, orderbook, funding, fees] = await Promise.all([
    getKalshiMarginEnabled().catch(() => false),
    getKalshiPerpOrderbook(ticker),
    getKalshiPerpFundingEvidence(ticker).catch(() => null),
    getKalshiMarginFeeEvidence(ticker, forceRefreshFees).catch(() => null),
  ]);
  if (!marginEnabled || !fees || orderbook.bids.length === 0 || orderbook.asks.length === 0) return null;
  return {
    market: market as KalshiMarginMarket & { contractSize: number; tickSize: number },
    orderbook,
    funding,
    fees,
    marginEnabled: true,
    observedAt: Date.now(),
  };
}

async function loadMarginAccountReadiness(computeAvailableBalance: boolean): Promise<KalshiMarginAccountReadiness> {
  const observedAt = Date.now();
  if (!kalshiCredentialsPresent()) {
    return {
      observedAt,
      credentialsPresent: false,
      marginEnabled: false,
      availableBalanceUsd: null,
      availableBalanceComputed: computeAvailableBalance,
      settledFundsUsd: null,
      accountEquityUsd: null,
      maintenanceMarginUsd: null,
      initialMarginUsd: null,
      totalPositionNotionalUsd: null,
      totalMaintenanceMarginUsd: null,
      accountLeverage: null,
      authenticated: false,
      executionAuthorityGranted: false,
      provenance: ['kalshi_credentials_absent', 'fail_closed'],
    };
  }
  try {
    const balancePath = `/trade-api/v2/margin/balance?compute_available_balance=${computeAvailableBalance ? 'true' : 'false'}`;
    const [enabled, balance, risk] = await Promise.all([
      getKalshiMarginEnabled(),
      kalshiAuthenticatedRequest<any>(balancePath),
      kalshiAuthenticatedRequest<any>('/trade-api/v2/margin/risk'),
    ]);
    const primary = Array.isArray(balance?.subaccount_balances)
      ? balance.subaccount_balances.find((row: any) => Number(row?.subaccount) === 0) || balance.subaccount_balances[0]
      : null;
    return {
      observedAt,
      credentialsPresent: true,
      marginEnabled: enabled,
      // OpenAPI returns zero when compute_available_balance is omitted/false; do not mislabel that as spendable cash.
      availableBalanceUsd: computeAvailableBalance ? finite(primary?.available_balance) : null,
      availableBalanceComputed: computeAvailableBalance,
      settledFundsUsd: finite(balance?.settled_funds),
      accountEquityUsd: finite(primary?.account_equity),
      maintenanceMarginUsd: finite(primary?.maintenance_margin),
      initialMarginUsd: finite(primary?.initial_margin),
      totalPositionNotionalUsd: finite(risk?.total_position_notional),
      totalMaintenanceMarginUsd: finite(risk?.total_maintenance_margin),
      accountLeverage: finite(risk?.account_leverage),
      authenticated: true,
      executionAuthorityGranted: false,
      provenance: [
        'kalshi_margin_enabled_authenticated',
        `kalshi_margin_balance_authenticated:available_computed=${computeAvailableBalance}`,
        'kalshi_margin_risk_authenticated',
      ],
    };
  } catch (error) {
    logger.warn('[KalshiPerps] Margin account readiness failed closed', {
      component: 'KalshiPerpsMarketAuthority',
      error: error instanceof Error ? error.message : String(error),
      computeAvailableBalance,
      executionAuthorityGranted: false,
      syntheticReadiness: false,
    });
    return {
      observedAt,
      credentialsPresent: true,
      marginEnabled: false,
      availableBalanceUsd: null,
      availableBalanceComputed: computeAvailableBalance,
      settledFundsUsd: null,
      accountEquityUsd: null,
      maintenanceMarginUsd: null,
      initialMarginUsd: null,
      totalPositionNotionalUsd: null,
      totalMaintenanceMarginUsd: null,
      accountLeverage: null,
      authenticated: false,
      executionAuthorityGranted: false,
      provenance: ['kalshi_margin_readiness_unavailable', 'fail_closed'],
    };
  }
}

export async function getKalshiMarginAccountReadiness(computeAvailableBalance = false, forceRefresh = false): Promise<KalshiMarginAccountReadiness> {
  const key = computeAvailableBalance ? 'computed' : 'uncomputed';
  const cached = accountCache.get(key);
  if (!forceRefresh && cached && Date.now() - cached.observedAt <= ACCOUNT_CACHE_MS) {
    return { ...cached.value, provenance: [...cached.value.provenance] };
  }
  const pending = accountInFlight.get(key);
  if (pending) {
    const value = await pending;
    return { ...value, provenance: [...value.provenance] };
  }
  const promise = loadMarginAccountReadiness(computeAvailableBalance)
    .then(value => {
      accountCache.set(key, { observedAt: Date.now(), value });
      return value;
    })
    .finally(() => { accountInFlight.delete(key); });
  accountInFlight.set(key, promise);
  const value = await promise;
  return { ...value, provenance: [...value.provenance] };
}

export async function getKalshiPerpsApiLimits(forceRefresh = false): Promise<KalshiPerpsApiLimits> {
  if (!forceRefresh && limitsCache && Date.now() - limitsCache.observedAt <= LIMIT_CACHE_MS) {
    return { ...limitsCache.value, grants: limitsCache.value.grants.map(row => ({ ...row })) };
  }
  const observedAt = Date.now();
  if (!kalshiCredentialsPresent()) {
    return {
      observedAt, usageTier: null, readRefillRate: null, readBucketCapacity: null,
      writeRefillRate: null, writeBucketCapacity: null, grants: [], authenticated: false,
    };
  }
  try {
    const payload = await kalshiAuthenticatedRequest<any>('/trade-api/v2/account/limits/perps');
    const value: KalshiPerpsApiLimits = {
      observedAt,
      usageTier: payload?.usage_tier ? String(payload.usage_tier) : null,
      readRefillRate: finite(payload?.read?.refill_rate),
      readBucketCapacity: finite(payload?.read?.bucket_capacity),
      writeRefillRate: finite(payload?.write?.refill_rate),
      writeBucketCapacity: finite(payload?.write?.bucket_capacity),
      grants: (Array.isArray(payload?.grants) ? payload.grants : []).map((row: any) => ({
        exchangeInstance: String(row?.exchange_instance || ''),
        level: String(row?.level || ''),
        source: String(row?.source || ''),
        expiresTs: timestamp(row?.expires_ts),
      })),
      authenticated: true,
    };
    limitsCache = { observedAt, value };
    return { ...value, grants: value.grants.map(row => ({ ...row })) };
  } catch {
    return {
      observedAt, usageTier: null, readRefillRate: null, readBucketCapacity: null,
      writeRefillRate: null, writeBucketCapacity: null, grants: [], authenticated: false,
    };
  }
}

export async function getKalshiMarginExchangeStatus(): Promise<KalshiMarginExchangeStatus> {
  const payload = await publicJson<any>('/trade-api/v2/margin/exchange/status');
  return {
    observedAt: Date.now(),
    exchangeActive: payload?.exchange_active === true,
    tradingActive: payload?.trading_active === true,
  };
}

export async function getKalshiNotionalRiskLimit(): Promise<KalshiNotionalRiskLimit> {
  const observedAt = Date.now();
  if (!kalshiCredentialsPresent()) return { observedAt, defaultNotionalUsd: null, byTicker: {}, authenticated: false };
  try {
    const payload = await kalshiAuthenticatedRequest<any>('/trade-api/v2/margin/notional_risk_limit');
    const byTicker: Record<string, number> = {};
    for (const [ticker, raw] of Object.entries(payload?.notional_value_risk_limits_by_market_ticker || {})) {
      const value = finite(raw);
      if (value !== null && value >= 0) byTicker[safeTicker(ticker)] = value;
    }
    return {
      observedAt,
      defaultNotionalUsd: finite(payload?.default_notional_value_risk_limit),
      byTicker,
      authenticated: true,
    };
  } catch {
    return { observedAt, defaultNotionalUsd: null, byTicker: {}, authenticated: false };
  }
}

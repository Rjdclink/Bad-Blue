import { createHash } from 'node:crypto';
import logger from '../../../logger.js';
import { getKalshiApiOrigin } from './kalshi-authenticated-authority.js';

export interface KalshiPredictionMarketSignal {
  ticker: string;
  eventTicker: string;
  title: string;
  subtitle: string;
  asset: string | null;
  status: string;
  yesBid: number | null;
  yesAsk: number | null;
  noBid: number | null;
  noAsk: number | null;
  impliedProbability: number | null;
  spreadBps: number | null;
  liquidityUsd: number | null;
  volume: number | null;
  volume24h: number | null;
  openInterest: number | null;
  strikeType: string | null;
  floorStrike: number | null;
  capStrike: number | null;
  functionalStrike: string | null;
  occurrenceAt: number | null;
  expectedExpirationAt: number | null;
  feeWaiverExpirationAt: number | null;
  rulesFingerprint: string;
  rulesPrimary: string;
  rulesSecondary: string;
  observedAt: number;
  expiresAt: number;
  executable: false;
  predictionAuthority: 'market_implied_probability_advisory';
  provenance: string[];
}

export interface KalshiIncentiveProgramEvidence {
  id: string;
  marketTicker: string;
  incentiveType: string;
  description: string;
  startAt: number | null;
  endAt: number | null;
  periodReward: number | null;
  discountFactorBps: number | null;
  targetSize: number | null;
  paidOut: boolean;
  observedAt: number;
  economicCreditAllowed: false;
}

export interface KalshiSeriesFeeChangeEvidence {
  id: string;
  seriesTicker: string;
  feeType: 'quadratic' | 'quadratic_with_maker_fees' | 'flat' | string;
  feeMultiplier: number | null;
  scheduledAt: number | null;
  observedAt: number;
  pretradeFeeBpsDerived: false;
}

export interface KalshiPredictionIntelligenceSnapshot {
  observedAt: number | null;
  cycles: number;
  errors: number;
  markets: KalshiPredictionMarketSignal[];
  incentives: KalshiIncentiveProgramEvidence[];
  feeChanges: KalshiSeriesFeeChangeEvidence[];
  marketRowsFetched: number;
  marketScanCap: number;
  marketScanTruncated: boolean;
  executionAuthority: false;
  syntheticEvidence: false;
}

const CACHE_MS = Math.max(2_000, Math.min(120_000, Number(process.env.KALSHI_PREDICTION_CACHE_MS || 15_000)));
const QUOTE_TTL_MS = Math.max(1_000, Math.min(60_000, Number(process.env.KALSHI_PREDICTION_QUOTE_TTL_MS || 10_000)));
const MARKET_LIMIT = Math.max(10, Math.min(5_000, Math.trunc(Number(process.env.KALSHI_PREDICTION_MARKET_LIMIT || 1_000))));
const MARKET_PAGE_SIZE = Math.max(10, Math.min(1_000, Math.trunc(Number(process.env.KALSHI_PREDICTION_MARKET_PAGE_SIZE || 1_000))));
const MARKET_MAX_PAGES = Math.max(1, Math.min(20, Math.trunc(Number(process.env.KALSHI_PREDICTION_MARKET_MAX_PAGES || 8))));
let snapshot: KalshiPredictionIntelligenceSnapshot = {
  observedAt: null,
  cycles: 0,
  errors: 0,
  markets: [],
  incentives: [],
  feeChanges: [],
  marketRowsFetched: 0,
  marketScanCap: MARKET_LIMIT,
  marketScanTruncated: false,
  executionAuthority: false,
  syntheticEvidence: false,
};
let inFlight: Promise<KalshiPredictionIntelligenceSnapshot> | null = null;

const ASSET_PATTERNS: Array<{ asset: string; pattern: RegExp }> = [
  { asset: 'BTC', pattern: /\b(?:BTC|BITCOIN)\b/i },
  { asset: 'ETH', pattern: /\b(?:ETH|ETHEREUM)\b/i },
  { asset: 'SOL', pattern: /\b(?:SOL|SOLANA)\b/i },
  { asset: 'XRP', pattern: /\bXRP\b/i },
  { asset: 'DOGE', pattern: /\b(?:DOGE|DOGECOIN)\b/i },
  { asset: 'LINK', pattern: /\b(?:LINK|CHAINLINK)\b/i },
  { asset: 'DOT', pattern: /\b(?:DOT|POLKADOT)\b/i },
  { asset: 'LTC', pattern: /\b(?:LTC|LITECOIN)\b/i },
  { asset: 'BCH', pattern: /\b(?:BCH|BITCOIN CASH)\b/i },
  { asset: 'SUI', pattern: /\bSUI\b/i },
  { asset: 'XLM', pattern: /\b(?:XLM|STELLAR)\b/i },
  { asset: 'SHIB', pattern: /\b(?:SHIB|SHIBA INU)\b/i },
  { asset: 'HBAR', pattern: /\b(?:HBAR|HEDERA)\b/i },
];

function finite(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function nonnegative(value: unknown): number | null {
  const parsed = finite(value);
  return parsed !== null && parsed >= 0 ? parsed : null;
}

function probability(value: unknown): number | null {
  const parsed = finite(value);
  return parsed !== null && parsed >= 0 && parsed <= 1 ? parsed : null;
}

function timestamp(value: unknown): number | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function rulesFingerprint(row: any): string {
  const material = JSON.stringify({
    eventTicker: String(row?.event_ticker || ''),
    marketType: String(row?.market_type || ''),
    rulesPrimary: String(row?.rules_primary || ''),
    rulesSecondary: String(row?.rules_secondary || ''),
    strikeType: String(row?.strike_type || ''),
    floorStrike: finite(row?.floor_strike),
    capStrike: finite(row?.cap_strike),
    functionalStrike: String(row?.functional_strike || ''),
    customStrike: row?.custom_strike ?? null,
    occurrenceDatetime: String(row?.occurrence_datetime || ''),
    expectedExpirationTime: String(row?.expected_expiration_time || ''),
    earlyCloseCondition: String(row?.early_close_condition || ''),
  });
  return createHash('sha256').update(material).digest('hex');
}

function detectAsset(row: any): string | null {
  const haystack = [row?.ticker, row?.event_ticker, row?.title, row?.subtitle, row?.yes_sub_title, row?.no_sub_title, row?.rules_primary]
    .map(value => String(value || ''))
    .join(' ');
  return ASSET_PATTERNS.find(entry => entry.pattern.test(haystack))?.asset ?? null;
}

function impliedProbability(yesBid: number | null, yesAsk: number | null, last: number | null): number | null {
  if (yesBid !== null && yesAsk !== null && yesAsk >= yesBid) return (yesBid + yesAsk) / 2;
  return yesBid ?? yesAsk ?? last;
}

function spreadBps(yesBid: number | null, yesAsk: number | null): number | null {
  if (yesBid === null || yesAsk === null || yesAsk < yesBid) return null;
  const mid = (yesBid + yesAsk) / 2;
  return mid > 0 ? (yesAsk - yesBid) / mid * 10_000 : null;
}

async function publicJson<T>(path: string): Promise<T> {
  if (!path.startsWith('/trade-api/v2/')) throw new Error('Kalshi public path rejected');
  const response = await fetch(`${getKalshiApiOrigin()}${path}`, {
    headers: { accept: 'application/json' },
    signal: AbortSignal.timeout(5_000),
  });
  if (!response.ok) throw new Error(`Kalshi public request failed HTTP ${response.status} for ${path.split('?')[0]}`);
  return response.json() as Promise<T>;
}

async function fetchOpenMarkets(): Promise<{ rows: any[]; truncated: boolean }> {
  const rows: any[] = [];
  const seenTickers = new Set<string>();
  const seenCursors = new Set<string>();
  let cursor = '';
  let moreAvailable = false;

  for (let page = 0; page < MARKET_MAX_PAGES && rows.length < MARKET_LIMIT; page++) {
    const remaining = MARKET_LIMIT - rows.length;
    const query = new URLSearchParams({ status: 'open', limit: String(Math.min(MARKET_PAGE_SIZE, remaining)) });
    if (cursor) query.set('cursor', cursor);
    const payload = await publicJson<{ markets?: any[]; cursor?: string }>(`/trade-api/v2/markets?${query.toString()}`);
    const marketRows = Array.isArray(payload?.markets) ? payload.markets : [];
    for (const row of marketRows) {
      const ticker = String(row?.ticker || '').trim().toUpperCase();
      if (!ticker || seenTickers.has(ticker)) continue;
      seenTickers.add(ticker);
      rows.push(row);
      if (rows.length >= MARKET_LIMIT) break;
    }

    const nextCursor = String(payload?.cursor || '').trim();
    moreAvailable = Boolean(nextCursor);
    if (!nextCursor) break;
    if (seenCursors.has(nextCursor)) {
      logger.warn('[KalshiPrediction] Market pagination cursor repeated; stopping without synthetic continuation', {
        component: 'KalshiPredictionMarketAuthority',
        page,
        marketRowsFetched: rows.length,
        cursorLoopDetected: true,
        executionAuthority: false,
      });
      break;
    }
    seenCursors.add(nextCursor);
    cursor = nextCursor;
  }

  return {
    rows,
    truncated: moreAvailable,
  };
}

async function fetchIncentives(): Promise<KalshiIncentiveProgramEvidence[]> {
  const payload = await publicJson<{ incentive_programs?: any[] }>('/trade-api/v2/incentive_programs?status=active&limit=10000');
  const observedAt = Date.now();
  return (Array.isArray(payload?.incentive_programs) ? payload.incentive_programs : []).flatMap(row => {
    const id = String(row?.id || '').trim();
    const marketTicker = String(row?.market_ticker || '').trim().toUpperCase();
    if (!id || !marketTicker) return [];
    return [{
      id,
      marketTicker,
      incentiveType: String(row?.incentive_type || ''),
      description: String(row?.incentive_description || ''),
      startAt: timestamp(row?.start_date),
      endAt: timestamp(row?.end_date),
      periodReward: nonnegative(row?.period_reward),
      discountFactorBps: nonnegative(row?.discount_factor_bps),
      targetSize: nonnegative(row?.target_size_fp),
      paidOut: row?.paid_out === true,
      observedAt,
      economicCreditAllowed: false as const,
    }];
  });
}

async function fetchFeeChanges(): Promise<KalshiSeriesFeeChangeEvidence[]> {
  const observedAt = Date.now();
  const payload = await publicJson<{ series_fee_change_arr?: any[] }>('/trade-api/v2/series/fee_changes?show_historical=false');
  return (Array.isArray(payload?.series_fee_change_arr) ? payload.series_fee_change_arr : []).flatMap(row => {
    const id = String(row?.id || '').trim();
    const seriesTicker = String(row?.series_ticker || '').trim().toUpperCase();
    if (!id || !seriesTicker) return [];
    return [{
      id,
      seriesTicker,
      feeType: String(row?.fee_type || ''),
      feeMultiplier: finite(row?.fee_multiplier),
      scheduledAt: timestamp(row?.scheduled_ts),
      observedAt,
      pretradeFeeBpsDerived: false as const,
    }];
  });
}

function normalizeMarket(row: any, observedAt: number): KalshiPredictionMarketSignal | null {
  const ticker = String(row?.ticker || '').trim().toUpperCase();
  if (!ticker) return null;
  const yesBid = probability(row?.yes_bid_dollars);
  const yesAsk = probability(row?.yes_ask_dollars);
  const noBid = probability(row?.no_bid_dollars);
  const noAsk = probability(row?.no_ask_dollars);
  const last = probability(row?.last_price_dollars);
  const implied = impliedProbability(yesBid, yesAsk, last);
  return {
    ticker,
    eventTicker: String(row?.event_ticker || '').trim().toUpperCase(),
    title: String(row?.title || ''),
    subtitle: String(row?.subtitle || ''),
    asset: detectAsset(row),
    status: String(row?.status || ''),
    yesBid,
    yesAsk,
    noBid,
    noAsk,
    impliedProbability: implied,
    spreadBps: spreadBps(yesBid, yesAsk),
    liquidityUsd: nonnegative(row?.liquidity_dollars),
    volume: nonnegative(row?.volume_fp),
    volume24h: nonnegative(row?.volume_24h_fp),
    openInterest: nonnegative(row?.open_interest_fp),
    strikeType: row?.strike_type ? String(row.strike_type) : null,
    floorStrike: finite(row?.floor_strike),
    capStrike: finite(row?.cap_strike),
    functionalStrike: row?.functional_strike ? String(row.functional_strike) : null,
    occurrenceAt: timestamp(row?.occurrence_datetime),
    expectedExpirationAt: timestamp(row?.expected_expiration_time),
    feeWaiverExpirationAt: timestamp(row?.fee_waiver_expiration_time),
    rulesFingerprint: rulesFingerprint(row),
    rulesPrimary: String(row?.rules_primary || ''),
    rulesSecondary: String(row?.rules_secondary || ''),
    observedAt,
    expiresAt: observedAt + QUOTE_TTL_MS,
    executable: false,
    predictionAuthority: 'market_implied_probability_advisory',
    provenance: [
      'kalshi_open_markets_public',
      'kalshi_market_rules_and_strike_metadata',
      'market_implied_probability_not_ground_truth',
      'cross_venue_equivalence_requires_rule_fingerprint_review',
      'prediction_signal_cannot_override_deterministic_all_in_economics',
      'execution_authority:false',
      'synthetic_evidence:false',
    ],
  };
}

export async function refreshKalshiPredictionIntelligence(forceRefresh = false): Promise<KalshiPredictionIntelligenceSnapshot> {
  const now = Date.now();
  if (!forceRefresh && snapshot.observedAt !== null && now - snapshot.observedAt <= CACHE_MS) return getKalshiPredictionIntelligenceSnapshot();
  if (inFlight) return inFlight;
  inFlight = (async () => {
    const marketPage = await fetchOpenMarkets();
    const observedAt = Date.now();
    const markets = marketPage.rows.map(row => normalizeMarket(row, observedAt)).filter((row): row is KalshiPredictionMarketSignal => row !== null);
    const [incentives, feeChanges] = await Promise.all([
      fetchIncentives().catch(() => []),
      fetchFeeChanges().catch(() => []),
    ]);
    snapshot = {
      observedAt,
      cycles: snapshot.cycles + 1,
      errors: snapshot.errors,
      markets,
      incentives,
      feeChanges,
      marketRowsFetched: marketPage.rows.length,
      marketScanCap: MARKET_LIMIT,
      marketScanTruncated: marketPage.truncated,
      executionAuthority: false,
      syntheticEvidence: false,
    };
    return getKalshiPredictionIntelligenceSnapshot();
  })().catch(error => {
    snapshot = {
      observedAt: Date.now(),
      cycles: snapshot.cycles + 1,
      errors: snapshot.errors + 1,
      markets: [],
      incentives: [],
      feeChanges: [],
      marketRowsFetched: 0,
      marketScanCap: MARKET_LIMIT,
      marketScanTruncated: false,
      executionAuthority: false,
      syntheticEvidence: false,
    };
    logger.warn('[KalshiPrediction] Prediction intelligence refresh failed closed', {
      component: 'KalshiPredictionMarketAuthority',
      error: error instanceof Error ? error.message : String(error),
      staleMarketsRetained: false,
      syntheticProbabilityUsed: false,
      executionAuthority: false,
    });
    return getKalshiPredictionIntelligenceSnapshot();
  }).finally(() => { inFlight = null; });
  return inFlight;
}

export function getKalshiPredictionIntelligenceSnapshot(): KalshiPredictionIntelligenceSnapshot {
  const now = Date.now();
  return {
    ...snapshot,
    markets: snapshot.markets.filter(row => row.expiresAt > now).map(row => ({ ...row, provenance: [...row.provenance] })),
    incentives: snapshot.incentives.map(row => ({ ...row })),
    feeChanges: snapshot.feeChanges.map(row => ({ ...row })),
  };
}

export function getKalshiPredictionSignalsForAsset(assetInput: string): KalshiPredictionMarketSignal[] {
  const asset = assetInput.trim().toUpperCase().replace(/(USDT|USDC|USD)$/, '');
  if (!asset) return [];
  return getKalshiPredictionIntelligenceSnapshot().markets
    .filter(row => row.asset === asset)
    .sort((left, right) =>
      (right.liquidityUsd ?? 0) - (left.liquidityUsd ?? 0)
      || (right.volume24h ?? 0) - (left.volume24h ?? 0)
      || left.ticker.localeCompare(right.ticker));
}

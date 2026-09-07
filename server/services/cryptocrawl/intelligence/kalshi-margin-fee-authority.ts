import logger from '../../../logger.js';
import { kalshiAuthenticatedRequest, kalshiCredentialsPresent } from './kalshi-authenticated-authority.js';

export interface KalshiMarginFeeEvidence {
  ticker: string;
  makerFeeBps: number;
  takerFeeBps: number;
  observedAt: number;
  source: 'kalshi_authenticated_effective_margin_fee_tiers';
  authenticated: true;
  synthetic: false;
}

type FeeTierPayload = {
  maker_fee_rates?: Record<string, unknown>;
  taker_fee_rates?: Record<string, unknown>;
};

const CACHE_TTL_MS = Math.max(5_000, Math.min(300_000, Number(process.env.KALSHI_FEE_CACHE_MS || 60_000)));
let feeSnapshot: { observedAt: number; rows: Map<string, KalshiMarginFeeEvidence> } | null = null;
let inFlight: Promise<Map<string, KalshiMarginFeeEvidence>> | null = null;

function canonicalTicker(value: string): string {
  return value.trim().toUpperCase();
}

function rateToBps(value: unknown): number | null {
  const rate = Number(value);
  if (!Number.isFinite(rate) || rate < 0) return null;
  const bps = rate * 10_000;
  return Number.isFinite(bps) && bps >= 0 ? bps : null;
}

function cloneMap(source: Map<string, KalshiMarginFeeEvidence>): Map<string, KalshiMarginFeeEvidence> {
  return new Map([...source.entries()].map(([ticker, row]) => [ticker, { ...row }]));
}

async function fetchEffectiveFeeMap(): Promise<Map<string, KalshiMarginFeeEvidence>> {
  if (!kalshiCredentialsPresent()) return new Map();
  const payload = await kalshiAuthenticatedRequest<FeeTierPayload>('/trade-api/v2/margin/fee_tiers');
  const makers = payload?.maker_fee_rates && typeof payload.maker_fee_rates === 'object' ? payload.maker_fee_rates : {};
  const takers = payload?.taker_fee_rates && typeof payload.taker_fee_rates === 'object' ? payload.taker_fee_rates : {};
  const tickers = new Set([...Object.keys(makers), ...Object.keys(takers)].map(canonicalTicker).filter(Boolean));
  const observedAt = Date.now();
  const rows = new Map<string, KalshiMarginFeeEvidence>();

  for (const ticker of tickers) {
    const makerFeeBps = rateToBps(makers[ticker] ?? makers[Object.keys(makers).find(key => canonicalTicker(key) === ticker) || '']);
    const takerFeeBps = rateToBps(takers[ticker] ?? takers[Object.keys(takers).find(key => canonicalTicker(key) === ticker) || '']);
    if (makerFeeBps === null || takerFeeBps === null) continue;
    rows.set(ticker, {
      ticker,
      makerFeeBps,
      takerFeeBps,
      observedAt,
      source: 'kalshi_authenticated_effective_margin_fee_tiers',
      authenticated: true,
      synthetic: false,
    });
  }

  if (rows.size === 0) {
    logger.warn('[KalshiFees] Authenticated effective margin fee response contained no complete market rates', {
      component: 'KalshiMarginFeeAuthority',
      makerEntries: Object.keys(makers).length,
      takerEntries: Object.keys(takers).length,
      zeroFeeAssumed: false,
      executionAuthorityGranted: false,
    });
  }
  feeSnapshot = { observedAt, rows };
  return cloneMap(rows);
}

export async function getKalshiMarginFeeMap(forceRefresh = false): Promise<Map<string, KalshiMarginFeeEvidence>> {
  const now = Date.now();
  if (!forceRefresh && feeSnapshot && now - feeSnapshot.observedAt <= CACHE_TTL_MS) return cloneMap(feeSnapshot.rows);
  if (inFlight) return cloneMap(await inFlight);
  inFlight = fetchEffectiveFeeMap().finally(() => { inFlight = null; });
  return cloneMap(await inFlight);
}

export async function getKalshiMarginFeeEvidence(tickerInput: string, forceRefresh = false): Promise<KalshiMarginFeeEvidence | null> {
  const ticker = canonicalTicker(tickerInput);
  if (!ticker) return null;
  const rows = await getKalshiMarginFeeMap(forceRefresh);
  const row = rows.get(ticker);
  return row ? { ...row } : null;
}

export function getCachedKalshiMarginFeeEvidence(tickerInput: string, maxAgeMs = CACHE_TTL_MS): KalshiMarginFeeEvidence | null {
  if (!feeSnapshot) return null;
  const age = Date.now() - feeSnapshot.observedAt;
  if (age > Math.max(0, Math.min(CACHE_TTL_MS, maxAgeMs))) return null;
  const row = feeSnapshot.rows.get(canonicalTicker(tickerInput));
  return row ? { ...row } : null;
}

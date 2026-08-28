import logger from '../../../logger.js';
import { coinbasePrivateRequest } from './coinbase-advanced-trade-authority.js';

export interface CoinbaseFeeEvidence {
  venue: 'coinbase';
  takerFeeBps: number;
  makerFeeBps: number;
  pricingTier: string | null;
  observedAt: number;
  source: 'coinbase_transaction_summary';
  productType: 'SPOT';
}

let cache: { expiresAt: number; value: CoinbaseFeeEvidence } | null = null;
let inFlight: Promise<CoinbaseFeeEvidence> | null = null;
const CACHE_MS = Math.max(5_000, Number(process.env.CRYPTO_COINBASE_FEE_CACHE_MS || 300_000));

function decimalRateToBps(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed * 10_000 : null;
}

/** Pure parser retained for regression verification. */
export function parseCoinbaseSpotFeeSummary(payload: any, observedAt = Date.now()): CoinbaseFeeEvidence {
  const feeTier = payload?.fee_tier;
  const takerFeeBps = decimalRateToBps(feeTier?.taker_fee_rate);
  const makerFeeBps = decimalRateToBps(feeTier?.maker_fee_rate);
  if (takerFeeBps === null || makerFeeBps === null) {
    throw new Error('Coinbase transaction summary did not contain non-negative spot maker/taker fee rates');
  }
  return {
    venue: 'coinbase',
    takerFeeBps,
    makerFeeBps,
    pricingTier: typeof feeTier?.pricing_tier === 'string' ? feeTier.pricing_tier : null,
    observedAt,
    source: 'coinbase_transaction_summary',
    productType: 'SPOT',
  };
}

/**
 * Coinbase fee tiers are account-level evidence, so one authenticated summary can
 * be shared across every Coinbase spot symbol until the bounded cache expires.
 * No configured numeric fallback is used here: if authenticated tier evidence is
 * unavailable, Coinbase must remain ineligible for executable economics.
 */
export async function getCoinbaseSpotFeeEvidence(forceRefresh = false): Promise<CoinbaseFeeEvidence> {
  if (!forceRefresh && cache && cache.expiresAt > Date.now()) return { ...cache.value };
  if (inFlight) return { ...(await inFlight) };

  inFlight = coinbasePrivateRequest('/api/v3/brokerage/transaction_summary', 'GET', {
    query: { product_type: 'SPOT' },
  }).then(payload => {
    const value = parseCoinbaseSpotFeeSummary(payload);
    cache = { value, expiresAt: Date.now() + CACHE_MS };
    logger.info('[Coinbase] Authenticated Advanced Trade spot fee tier resolved', {
      component: 'CoinbaseFeeEvidence',
      takerFeeBps: value.takerFeeBps,
      makerFeeBps: value.makerFeeBps,
      pricingTier: value.pricingTier,
      source: value.source,
    });
    return value;
  }).finally(() => { inFlight = null; });

  return { ...(await inFlight) };
}

export function getCachedCoinbaseSpotFeeEvidence(): CoinbaseFeeEvidence | null {
  if (!cache || cache.expiresAt <= Date.now()) return null;
  return { ...cache.value };
}

import logger from '../../../logger.js';
import { estimateKalshiEventFees } from './kalshi-event-fee-authority.js';
import { getKalshiEventDepth } from './kalshi-event-depth-authority.js';
import { getKalshiPredictionIntelligenceSnapshot } from './kalshi-prediction-market-authority.js';

export interface KalshiEventMarketMakingCandidate {
  ticker: string;
  eventTicker: string;
  asset: string | null;
  observedAt: number;
  expiresAt: number;
  referenceContracts: number;
  yesBid: number;
  yesAsk: number;
  midpoint: number;
  quotedSpreadUsdPerContract: number;
  quotedSpreadBps: number;
  makerEntryFeeUsd: number;
  makerExitFeeUsd: number;
  makerRoundTripFeeUsd: number;
  measuredMakerSpreadAfterFeesUsd: number;
  measuredMakerSpreadAfterFeesBps: number;
  activeIncentive: boolean;
  incentiveType: string | null;
  incentivePeriodReward: number | null;
  incentiveTargetSize: number | null;
  incentiveDiscountFactorBps: number | null;
  incentiveRewardCreditedBeforePayment: false;
  fillProbabilityCreditedAsCertain: false;
  adverseSelectionCreditedAsZero: false;
  projectedSpreadCanCreateProfitability: false;
  executionAuthority: false;
  provenance: string[];
}

export interface KalshiEventMarketMakingSnapshot {
  observedAt: number | null;
  cycles: number;
  errors: number;
  candidates: KalshiEventMarketMakingCandidate[];
  marketsConsidered: number;
  marketsMeasured: number;
  predictionScanTruncated: boolean;
  activeIncentiveCandidates: number;
  bestMeasuredMakerSpreadAfterFeesBps: number | null;
  incentiveRewardCreditedBeforePayment: false;
  projectedSpreadCanCreateProfitability: false;
  executionAuthority: false;
}

const SCAN_LIMIT = Math.max(1, Math.min(96, Math.trunc(Number(process.env.KALSHI_EVENT_MAKER_SCAN_LIMIT || 32))));
const REFERENCE_CONTRACTS = Math.max(1, Math.min(10_000, Number(process.env.KALSHI_EVENT_MAKER_REFERENCE_CONTRACTS || 100)));
const CONCURRENCY = Math.max(1, Math.min(16, Math.trunc(Number(process.env.KALSHI_EVENT_MAKER_CONCURRENCY || 8))));
let snapshot: KalshiEventMarketMakingSnapshot = {
  observedAt: null,
  cycles: 0,
  errors: 0,
  candidates: [],
  marketsConsidered: 0,
  marketsMeasured: 0,
  predictionScanTruncated: false,
  activeIncentiveCandidates: 0,
  bestMeasuredMakerSpreadAfterFeesBps: null,
  incentiveRewardCreditedBeforePayment: false,
  projectedSpreadCanCreateProfitability: false,
  executionAuthority: false,
};
let inFlight: Promise<KalshiEventMarketMakingSnapshot> | null = null;

function cloneCandidate(row: KalshiEventMarketMakingCandidate): KalshiEventMarketMakingCandidate {
  return { ...row, provenance: [...row.provenance] };
}

function currentSnapshot(): KalshiEventMarketMakingSnapshot {
  return { ...snapshot, candidates: snapshot.candidates.map(cloneCandidate) };
}

async function mapBounded<T, R>(values: readonly T[], worker: (value: T) => Promise<R>): Promise<R[]> {
  const output: R[] = new Array(values.length);
  let cursor = 0;
  const runners = Array.from({ length: Math.min(CONCURRENCY, values.length) }, async () => {
    while (true) {
      const index = cursor++;
      if (index >= values.length) return;
      output[index] = await worker(values[index]);
    }
  });
  await Promise.all(runners);
  return output;
}

export async function refreshKalshiEventMarketMakingFrontier(forceRefresh = false): Promise<KalshiEventMarketMakingSnapshot> {
  if (inFlight) return inFlight;
  inFlight = (async () => {
    const prediction = getKalshiPredictionIntelligenceSnapshot();
    const now = Date.now();
    const incentivesByTicker = new Map(prediction.incentives
      .filter(program => !program.paidOut && (program.startAt === null || program.startAt <= now) && (program.endAt === null || program.endAt > now))
      .map(program => [program.marketTicker, program] as const));
    const markets = prediction.markets
      .filter(market => market.status === 'open' && market.expiresAt > now)
      .sort((left, right) =>
        (right.liquidityUsd ?? 0) - (left.liquidityUsd ?? 0)
        || (right.volume24h ?? 0) - (left.volume24h ?? 0)
        || left.ticker.localeCompare(right.ticker))
      .slice(0, SCAN_LIMIT);

    const measured = await mapBounded(markets, async market => {
      const depth = await getKalshiEventDepth(market.ticker, forceRefresh).catch(() => null);
      const bestBid = depth?.yesBids[0] ?? null;
      const bestAsk = depth?.yesAsks[0] ?? null;
      if (!depth || !bestBid || !bestAsk || !(bestAsk.price > bestBid.price)) return null;
      const midpoint = (bestBid.price + bestAsk.price) / 2;
      const spread = bestAsk.price - bestBid.price;
      const availableContracts = Math.min(bestBid.contracts, bestAsk.contracts, REFERENCE_CONTRACTS);
      if (!(midpoint > 0) || !(availableContracts > 0)) return null;
      const [entryFee, exitFee] = await Promise.all([
        estimateKalshiEventFees({ ticker: market.ticker, contracts: availableContracts, price: bestBid.price, forceRefresh }).catch(() => null),
        estimateKalshiEventFees({ ticker: market.ticker, contracts: availableContracts, price: bestAsk.price, forceRefresh }).catch(() => null),
      ]);
      if (!entryFee?.economicCreditAllowed || !exitFee?.economicCreditAllowed || entryFee.makerFeeUsd === null || exitFee.makerFeeUsd === null) return null;
      const grossSpreadUsd = spread * availableContracts;
      const makerRoundTripFeeUsd = entryFee.makerFeeUsd + exitFee.makerFeeUsd;
      const afterFeesUsd = grossSpreadUsd - makerRoundTripFeeUsd;
      const referenceNotionalUsd = midpoint * availableContracts;
      const incentive = incentivesByTicker.get(market.ticker) ?? null;
      const observedAt = Math.max(depth.observedAt, entryFee.observedAt, exitFee.observedAt);
      const expiresAt = Math.min(depth.expiresAt, entryFee.expiresAt, exitFee.expiresAt, market.expiresAt);
      const row: KalshiEventMarketMakingCandidate = {
        ticker: market.ticker,
        eventTicker: market.eventTicker,
        asset: market.asset,
        observedAt,
        expiresAt,
        referenceContracts: availableContracts,
        yesBid: bestBid.price,
        yesAsk: bestAsk.price,
        midpoint,
        quotedSpreadUsdPerContract: spread,
        quotedSpreadBps: spread / midpoint * 10_000,
        makerEntryFeeUsd: entryFee.makerFeeUsd,
        makerExitFeeUsd: exitFee.makerFeeUsd,
        makerRoundTripFeeUsd,
        measuredMakerSpreadAfterFeesUsd: afterFeesUsd,
        measuredMakerSpreadAfterFeesBps: referenceNotionalUsd > 0 ? afterFeesUsd / referenceNotionalUsd * 10_000 : 0,
        activeIncentive: incentive !== null,
        incentiveType: incentive?.incentiveType ?? null,
        incentivePeriodReward: incentive?.periodReward ?? null,
        incentiveTargetSize: incentive?.targetSize ?? null,
        incentiveDiscountFactorBps: incentive?.discountFactorBps ?? null,
        incentiveRewardCreditedBeforePayment: false,
        fillProbabilityCreditedAsCertain: false,
        adverseSelectionCreditedAsZero: false,
        projectedSpreadCanCreateProfitability: false,
        executionAuthority: false,
        provenance: [
          ...depth.provenance,
          ...entryFee.provenance,
          ...exitFee.provenance,
          'event_maker_spread:live_book_counterfactual',
          'event_maker_fees:exact_reference_size',
          incentive ? 'kalshi_active_incentive:advisory_only' : 'kalshi_active_incentive:none_observed',
          'maker_fill_probability:unknown',
          'adverse_selection:unknown',
          'queue_position:requires_live_resting_order',
          'incentive_reward:unpaid_not_credited',
          'canonical_profitability_authority:false',
          'execution_authority:false',
        ],
      };
      return row;
    });

    const candidates = measured.filter((row): row is KalshiEventMarketMakingCandidate => row !== null)
      .sort((left, right) =>
        right.measuredMakerSpreadAfterFeesBps - left.measuredMakerSpreadAfterFeesBps
        || Number(right.activeIncentive) - Number(left.activeIncentive)
        || right.referenceContracts - left.referenceContracts
        || left.ticker.localeCompare(right.ticker));
    snapshot = {
      observedAt: Date.now(),
      cycles: snapshot.cycles + 1,
      errors: snapshot.errors,
      candidates,
      marketsConsidered: markets.length,
      marketsMeasured: candidates.length,
      predictionScanTruncated: prediction.marketScanTruncated,
      activeIncentiveCandidates: candidates.filter(row => row.activeIncentive).length,
      bestMeasuredMakerSpreadAfterFeesBps: candidates.length ? candidates[0].measuredMakerSpreadAfterFeesBps : null,
      incentiveRewardCreditedBeforePayment: false,
      projectedSpreadCanCreateProfitability: false,
      executionAuthority: false,
    };
    return currentSnapshot();
  })().catch(error => {
    snapshot = {
      observedAt: Date.now(),
      cycles: snapshot.cycles + 1,
      errors: snapshot.errors + 1,
      candidates: [],
      marketsConsidered: 0,
      marketsMeasured: 0,
      predictionScanTruncated: false,
      activeIncentiveCandidates: 0,
      bestMeasuredMakerSpreadAfterFeesBps: null,
      incentiveRewardCreditedBeforePayment: false,
      projectedSpreadCanCreateProfitability: false,
      executionAuthority: false,
    };
    logger.debug('[KalshiEventMaker] Market-making frontier refresh failed closed', {
      component: 'KalshiEventMarketMakingAuthority',
      error: error instanceof Error ? error.message : String(error),
      incentiveRewardPrecredited: false,
      projectedSpreadPromotedToProfit: false,
      executionAuthority: false,
    });
    return currentSnapshot();
  }).finally(() => { inFlight = null; });
  return inFlight;
}

export function getKalshiEventMarketMakingSnapshot(): KalshiEventMarketMakingSnapshot {
  return currentSnapshot();
}

import { createHash } from 'node:crypto';
import logger from '../../../logger.js';
import type { KalshiEventExecutionPlan, KalshiEventOutcome } from '../execution/kalshi-event-lifecycle.js';
import { getKalshiEventSystemCashSnapshot } from '../execution/kalshi-event-system-owned-cash-ledger.js';
import { measureKalshiEventSizedDepth } from '../intelligence/kalshi-event-depth-authority.js';
import { estimateKalshiEventFees } from '../intelligence/kalshi-event-fee-authority.js';
import {
  getKalshiProbabilityCalibration,
  type KalshiProbabilityCalibration,
} from '../intelligence/kalshi-probability-calibration-authority.js';
import type {
  KalshiPredictionIntelligenceSnapshot,
  KalshiPredictionMarketSignal,
} from '../intelligence/kalshi-prediction-market-authority.js';

export type KalshiEventCandidateStatus = 'data_collection' | 'eligible' | 'blocked' | 'expired';

export interface KalshiEventCandidate {
  opportunityId: string;
  ticker: string;
  eventTicker: string;
  symbol: string;
  asset: string;
  outcome: KalshiEventOutcome;
  rulesFingerprint: string;
  status: KalshiEventCandidateStatus;
  contracts: number;
  calibratedProbability: number | null;
  conservativeProbability: number | null;
  entryCostUsd: number | null;
  entryFeeUsd: number | null;
  settlementCostReserveUsd: number;
  capitalLockCostUsd: number;
  expectedPayoutUsd: number | null;
  expectedNetProfitUsd: number | null;
  expectedNetBps: number | null;
  observedAt: number;
  expiresAt: number;
  settlementDeadlineAt: number;
  missingEvidence: string[];
  plan: KalshiEventExecutionPlan | null;
  provenance: string[];
}

export interface KalshiEventOpportunitySnapshot {
  observedAt: number | null;
  cycles: number;
  errors: number;
  candidates: KalshiEventCandidate[];
  eligible: number;
  dataCollection: number;
  blocked: number;
  executionAuthority: 'exact_candidate_only';
  rawMarketProbabilityExecutionAuthority: false;
  accountBalanceMintsOwnership: false;
}

const candidates = new Map<string, KalshiEventCandidate>();
const preparedPlans = new Map<string, KalshiEventExecutionPlan>();
let cycles = 0;
let errors = 0;
let observedAt: number | null = null;

function boundedInt(raw: unknown, fallback: number, min: number, max: number): number {
  const value = Number(raw);
  return Number.isFinite(value) ? Math.max(min, Math.min(max, Math.trunc(value))) : fallback;
}
function boundedNumber(raw: unknown, fallback: number, min: number, max: number): number {
  const value = Number(raw);
  return Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : fallback;
}
function maxContractsPerCandidate(): number { return boundedInt(process.env.CRYPTOCRAWL_KALSHI_EVENT_MAX_CONTRACTS, 250, 1, 100_000); }
function minExpectedNetUsd(): number { return boundedNumber(process.env.CRYPTOCRAWL_KALSHI_EVENT_MIN_EXPECTED_NET_USD, 0.01, 0.01, 10_000); }
function capitalOpportunityApr(): number { return boundedNumber(process.env.CRYPTOCRAWL_KALSHI_EVENT_CAPITAL_OPPORTUNITY_APR, 0, 0, 5); }
function settlementGraceMs(): number { return boundedInt(process.env.CRYPTOCRAWL_KALSHI_EVENT_SETTLEMENT_GRACE_MS, 24 * 60 * 60_000, 60_000, 14 * 24 * 60 * 60_000); }
function scanLimit(): number { return boundedInt(process.env.CRYPTOCRAWL_KALSHI_EVENT_OPPORTUNITY_SCAN_LIMIT, 64, 1, 500); }

function sha(material: string): string { return createHash('sha256').update(material).digest('hex'); }
function integerContracts(value: number): number { return Math.max(0, Math.floor(value + 1e-9)); }
function assetSymbol(signal: KalshiPredictionMarketSignal): string | null {
  const asset = signal.asset?.trim().toUpperCase() || null;
  return asset ? `${asset}USD` : null;
}
function settlementDeadline(signal: KalshiPredictionMarketSignal, now: number): number {
  const eventTime = [signal.expectedExpirationAt, signal.occurrenceAt]
    .filter((value): value is number => Number.isFinite(value) && Number(value) > now)
    .sort((a, b) => a - b)[0];
  return (eventTime ?? now + 24 * 60 * 60_000) + settlementGraceMs();
}
function outcomeProbability(calibration: KalshiProbabilityCalibration, outcome: KalshiEventOutcome): { mean: number; conservative: number } {
  if (outcome === 'yes') {
    return { mean: calibration.calibratedProbability, conservative: calibration.confidenceInterval95[0] };
  }
  return { mean: 1 - calibration.calibratedProbability, conservative: 1 - calibration.confidenceInterval95[1] };
}
function cloneCandidate(candidate: KalshiEventCandidate): KalshiEventCandidate {
  return { ...candidate, missingEvidence: [...candidate.missingEvidence], provenance: [...candidate.provenance], plan: candidate.plan ? { ...candidate.plan, provenance: [...candidate.plan.provenance] } : null };
}

function dataCollectionCandidate(signal: KalshiPredictionMarketSignal, outcome: KalshiEventOutcome, missingEvidence: string[]): KalshiEventCandidate | null {
  const symbol = assetSymbol(signal);
  if (!symbol || !signal.asset) return null;
  const now = Date.now();
  const id = `kalshi-event-data:${sha(`${signal.ticker}|${outcome}|${signal.rulesFingerprint}`).slice(0, 40)}`;
  return {
    opportunityId: id,
    ticker: signal.ticker,
    eventTicker: signal.eventTicker,
    symbol,
    asset: signal.asset,
    outcome,
    rulesFingerprint: signal.rulesFingerprint,
    status: 'data_collection',
    contracts: 0,
    calibratedProbability: null,
    conservativeProbability: null,
    entryCostUsd: null,
    entryFeeUsd: null,
    settlementCostReserveUsd: 0,
    capitalLockCostUsd: 0,
    expectedPayoutUsd: null,
    expectedNetProfitUsd: null,
    expectedNetBps: null,
    observedAt: signal.observedAt,
    expiresAt: Math.max(now + 1_000, signal.expiresAt),
    settlementDeadlineAt: settlementDeadline(signal, now),
    missingEvidence,
    plan: null,
    provenance: [
      ...signal.provenance,
      'kalshi_event:data_collection_mode',
      'raw_market_probability:advisory_only',
      'execution_fail_closed_until_calibration_and_exact_economics',
    ],
  };
}

async function buildOutcomeCandidate(
  signal: KalshiPredictionMarketSignal,
  calibration: KalshiProbabilityCalibration,
  outcome: KalshiEventOutcome,
  usableSystemCashUsd: number,
): Promise<KalshiEventCandidate | null> {
  const symbol = assetSymbol(signal);
  if (!symbol || !signal.asset) return null;
  const now = Date.now();
  const probability = outcomeProbability(calibration, outcome);
  if (!(probability.conservative > 0) || !(probability.mean > 0)) {
    return dataCollectionCandidate(signal, outcome, ['required:calibration_confidence_interval_nonzero']);
  }

  // Measure one contract first to establish executable price and fee shape. Size
  // only from authenticated book depth and system-owned cash; account balance is
  // capacity, never ownership.
  const one = await measureKalshiEventSizedDepth({ ticker: signal.ticker, outcome, side: 'buy', contracts: 1, forceRefresh: true });
  if (!one?.complete || one.vwapPrice === null || one.worstPrice === null || one.notionalUsd === null) {
    return dataCollectionCandidate(signal, outcome, ['required:authenticated_executable_depth']);
  }
  const oneFee = await estimateKalshiEventFees({ ticker: signal.ticker, contracts: 1, price: one.vwapPrice, forceRefresh: true });
  if (!oneFee?.economicCreditAllowed || oneFee.takerFeeUsd === null) {
    return dataCollectionCandidate(signal, outcome, ['required:current_supported_fee_schedule']);
  }
  const estimatedCashPerContract = one.notionalUsd + oneFee.takerFeeUsd;
  const cashCap = estimatedCashPerContract > 0 ? integerContracts(usableSystemCashUsd / estimatedCashPerContract) : 0;
  const requestedContracts = Math.min(maxContractsPerCandidate(), cashCap);
  if (requestedContracts < 1) {
    return dataCollectionCandidate(signal, outcome, ['required:system_owned_kalshi_event_cash']);
  }

  let contracts = requestedContracts;
  let depth = await measureKalshiEventSizedDepth({ ticker: signal.ticker, outcome, side: 'buy', contracts, forceRefresh: true });
  if (!depth?.complete) {
    // Find the largest integer size that current authenticated depth can execute.
    let low = 1;
    let high = contracts;
    let best = 0;
    while (low <= high) {
      const mid = Math.floor((low + high) / 2);
      const measured = await measureKalshiEventSizedDepth({ ticker: signal.ticker, outcome, side: 'buy', contracts: mid });
      if (measured?.complete) { best = mid; low = mid + 1; depth = measured; }
      else high = mid - 1;
    }
    contracts = best;
  }
  if (contracts < 1 || !depth?.complete || depth.vwapPrice === null || depth.worstPrice === null || depth.notionalUsd === null) {
    return dataCollectionCandidate(signal, outcome, ['required:authenticated_sized_depth']);
  }

  const fee = await estimateKalshiEventFees({ ticker: signal.ticker, contracts, price: depth.vwapPrice, forceRefresh: true });
  if (!fee?.economicCreditAllowed || fee.takerFeeUsd === null) {
    return dataCollectionCandidate(signal, outcome, ['required:authenticated_sized_fee_economics']);
  }
  const entryCostUsd = depth.notionalUsd;
  const entryFeeUsd = fee.takerFeeUsd;
  const settleDeadline = settlementDeadline(signal, now);
  const lockYears = Math.max(0, settleDeadline - now) / (365.25 * 24 * 60 * 60_000);
  const capitalLockCostUsd = entryCostUsd * capitalOpportunityApr() * lockYears;
  // Integer binary contracts have exact $1 payout and Kalshi documents zero
  // settlement fee for simple yes/no determinations. Fractional/scalar paths are
  // not admitted by this generator.
  const settlementCostReserveUsd = 0;
  const expectedPayoutUsd = probability.conservative * contracts;
  const expectedNetProfitUsd = expectedPayoutUsd - entryCostUsd - entryFeeUsd - settlementCostReserveUsd - capitalLockCostUsd;
  const expectedNetBps = entryCostUsd > 0 ? expectedNetProfitUsd / entryCostUsd * 10_000 : null;
  const expiresAt = Math.min(signal.expiresAt, depth.expiresAt, fee.expiresAt, calibration.observedAt + boundedInt(process.env.CRYPTOCRAWL_KALSHI_EVENT_MAX_CALIBRATION_AGE_MS, 60_000, 5_000, 24 * 60 * 60_000));
  const identity = sha(JSON.stringify({
    ticker: signal.ticker,
    outcome,
    rules: signal.rulesFingerprint,
    model: calibration.modelKey,
    contracts,
    depthObservedAt: depth.observedAt,
    depthWorstPrice: depth.worstPrice,
    feeObservedAt: fee.observedAt,
    feeType: fee.feeType,
    feeMultiplier: fee.feeMultiplier,
  }));
  const opportunityId = `kalshi-event:${identity.slice(0, 48)}`;
  const baseProvenance = [
    ...signal.provenance,
    ...calibration.provenance,
    ...depth.provenance,
    ...fee.provenance,
    `kalshi_event_rules_fingerprint:${signal.rulesFingerprint}`,
    `kalshi_event_calibration_model:${calibration.modelKey}`,
    'expected_probability:95pct_conservative_bound',
    'event_contracts:integer_binary_only',
    'simple_binary_settlement_fee:documented_zero',
    'capital_lock_cost:included',
    'account_balance_mints_ownership:false',
    'system_owned_event_cash:required_at_execution',
    'expected_net:all_in_positive_required',
  ];
  const positive = Number.isFinite(expectedNetProfitUsd) && expectedNetProfitUsd >= minExpectedNetUsd() && expiresAt > now;
  const plan: KalshiEventExecutionPlan | null = positive ? {
    opportunityId,
    ticker: signal.ticker,
    symbol,
    asset: signal.asset,
    outcome,
    contracts,
    maxEntryPrice: depth.worstPrice,
    calibratedProbability: probability.conservative,
    calibrationSampleCount: calibration.sampleCount,
    calibrationObservedAt: calibration.observedAt,
    calibrationBrierScore: calibration.brierScore,
    calibrationAuthority: 'cryptara_kalshi_terminal_calibration',
    expectedNetProfitUsd,
    minimumExpectedNetProfitUsd: minExpectedNetUsd(),
    expiresAt,
    settlementDeadlineAt: settleDeadline,
    provenance: baseProvenance,
  } : null;
  return {
    opportunityId,
    ticker: signal.ticker,
    eventTicker: signal.eventTicker,
    symbol,
    asset: signal.asset,
    outcome,
    rulesFingerprint: signal.rulesFingerprint,
    status: positive ? 'eligible' : 'blocked',
    contracts,
    calibratedProbability: probability.mean,
    conservativeProbability: probability.conservative,
    entryCostUsd,
    entryFeeUsd,
    settlementCostReserveUsd,
    capitalLockCostUsd,
    expectedPayoutUsd,
    expectedNetProfitUsd,
    expectedNetBps,
    observedAt: Math.max(signal.observedAt, depth.observedAt, fee.observedAt, calibration.observedAt),
    expiresAt,
    settlementDeadlineAt: settleDeadline,
    missingEvidence: positive ? [] : ['required:strictly_positive_conservative_all_in_expected_net'],
    plan,
    provenance: baseProvenance,
  };
}

export async function refreshKalshiEventOpportunities(snapshot: KalshiPredictionIntelligenceSnapshot): Promise<KalshiEventOpportunitySnapshot> {
  const now = Date.now();
  const next = new Map<string, KalshiEventCandidate>();
  const nextPlans = new Map<string, KalshiEventExecutionPlan>();
  try {
    const cash = await getKalshiEventSystemCashSnapshot(true).catch(() => null);
    const usableSystemCashUsd = cash?.usableUsd ?? 0;
    const markets = snapshot.markets
      .filter(signal => signal.status === 'open' && signal.expiresAt > now && signal.asset && signal.rulesFingerprint)
      .sort((a, b) => (b.liquidityUsd ?? 0) - (a.liquidityUsd ?? 0) || (b.volume24h ?? 0) - (a.volume24h ?? 0))
      .slice(0, scanLimit());

    for (const signal of markets) {
      const calibration = await getKalshiProbabilityCalibration(signal).catch(() => null);
      for (const outcome of ['yes', 'no'] as const) {
        const candidate = calibration
          ? await buildOutcomeCandidate(signal, calibration, outcome, usableSystemCashUsd)
          : dataCollectionCandidate(signal, outcome, ['required:terminal_probability_calibration_authority']);
        if (!candidate) continue;
        next.set(candidate.opportunityId, candidate);
        if (candidate.plan && candidate.status === 'eligible') nextPlans.set(candidate.opportunityId, candidate.plan);
      }
    }
    cycles += 1;
    observedAt = Date.now();
  } catch (error) {
    errors += 1;
    logger.warn('[KalshiEventOpportunity] Candidate refresh failed closed', {
      component: 'KalshiEventOpportunityGenerator',
      error: error instanceof Error ? error.message : String(error),
      staleEligibleCandidatesRetained: false,
      executionAuthorityGranted: false,
    });
  }

  candidates.clear();
  preparedPlans.clear();
  for (const [id, candidate] of next) candidates.set(id, candidate);
  for (const [id, plan] of nextPlans) preparedPlans.set(id, plan);
  return getKalshiEventOpportunitySnapshot();
}

export function getPreparedKalshiEventPlan(opportunityId: string): KalshiEventExecutionPlan | null {
  const plan = preparedPlans.get(opportunityId);
  if (!plan || plan.expiresAt <= Date.now()) return null;
  return { ...plan, provenance: [...plan.provenance] };
}

export function getKalshiEventOpportunitySnapshot(): KalshiEventOpportunitySnapshot {
  const now = Date.now();
  const rows = [...candidates.values()].map(candidate => candidate.expiresAt <= now ? { ...candidate, status: 'expired' as const, plan: null } : candidate);
  return {
    observedAt,
    cycles,
    errors,
    candidates: rows.map(cloneCandidate),
    eligible: rows.filter(row => row.status === 'eligible').length,
    dataCollection: rows.filter(row => row.status === 'data_collection').length,
    blocked: rows.filter(row => row.status === 'blocked').length,
    executionAuthority: 'exact_candidate_only',
    rawMarketProbabilityExecutionAuthority: false,
    accountBalanceMintsOwnership: false,
  };
}

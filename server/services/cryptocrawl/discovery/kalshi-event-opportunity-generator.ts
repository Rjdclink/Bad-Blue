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
import { measuredCandidateRegistry } from './measured-candidate-registry.js';

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

function recordCanonicalEventCandidate(candidate: KalshiEventCandidate): void {
  const now = Date.now();
  const entryCostUsd = candidate.entryCostUsd;
  const grossProfitUsd = entryCostUsd !== null && candidate.expectedPayoutUsd !== null
    ? candidate.expectedPayoutUsd - entryCostUsd
    : null;
  const allInCostUsd = entryCostUsd !== null && candidate.entryFeeUsd !== null
    ? candidate.entryFeeUsd + candidate.settlementCostReserveUsd
    : null;
  const allInCostBps = entryCostUsd !== null && entryCostUsd > 0 && allInCostUsd !== null
    ? allInCostUsd / entryCostUsd * 10_000
    : null;
  const grossProfitBps = entryCostUsd !== null && entryCostUsd > 0 && grossProfitUsd !== null
    ? grossProfitUsd / entryCostUsd * 10_000
    : null;
  const quotePrice = entryCostUsd !== null && candidate.contracts > 0
    ? entryCostUsd / candidate.contracts
    : null;
  const eligible = candidate.status === 'eligible' && candidate.plan !== null && candidate.expiresAt > now;
  const status = candidate.status === 'expired'
    ? 'expired'
    : candidate.status === 'blocked'
      ? 'blocked'
      : eligible
        ? 'eligible'
        : 'enriched';

  measuredCandidateRegistry.record({
    opportunityId: candidate.opportunityId,
    topology: 'PREDICTION_EVENT',
    observedAt: candidate.observedAt,
    expiresAt: candidate.expiresAt,
    status,
    assets: [candidate.asset],
    venues: ['kalshi'],
    chains: [],
    rawQuotes: [{
      source: 'kalshi_event_authenticated_execution_evidence',
      venue: 'kalshi',
      symbol: candidate.symbol,
      observedAt: candidate.observedAt,
      price: quotePrice,
      executable: eligible,
      provenance: candidate.provenance,
    }],
    depth: candidate.contracts > 0 && entryCostUsd !== null
      ? { status: 'measured', detail: `${candidate.outcome}:${candidate.contracts}:authenticated_sized_depth` }
      : { status: 'unavailable', detail: `${candidate.outcome}:evidence_collection_required` },
    economics: {
      grossProfitUsd,
      // Event edge is calibrated/probabilistic, never mislabeled as deterministic.
      deterministicNetProfitUsd: null,
      feeUsd: candidate.entryFeeUsd,
      gasUsd: 0,
      bridgeUsd: 0,
      // Authenticated sized VWAP is the entry-cost authority; depth impact is
      // already embedded in that cost rather than credited again as a reduction.
      expectedSlippageBps: entryCostUsd !== null ? 0 : null,
      expectedPriceImpactBps: entryCostUsd !== null ? 0 : null,
      notionalUsd: entryCostUsd,
      grossProfitBps,
      flashLoanFeeBps: 0,
      gasCostBps: 0,
      relayCostBps: 0,
      allInCostBps,
      breakEvenBps: allInCostBps,
      netProfitBps: candidate.expectedNetBps,
      bpsToBreakEven: candidate.expectedNetBps !== null && candidate.expectedNetBps < 0 ? -candidate.expectedNetBps : 0,
      realizedNetProfitBps: null,
    },
    quoteAgeMs: Math.max(0, now - candidate.observedAt),
    executableCapability: eligible,
    executionCapabilityReason: eligible
      ? 'kalshi_prediction_event_exact_candidate_evidence_complete'
      : candidate.status === 'data_collection'
        ? 'kalshi_prediction_event_evidence_collection_required'
        : candidate.status === 'blocked'
          ? 'kalshi_prediction_event_all_in_economics_blocked'
          : 'kalshi_prediction_event_expired',
    missingInformation: candidate.missingEvidence,
    provenance: [
      ...candidate.provenance,
      'canonical_topology:PREDICTION_EVENT',
      'spot_quote_venue_assumptions:false',
      'raw_market_probability_execution_authority:false',
      'event_expected_net:conservative_calibrated_probability',
      'event_entry_cost:authenticated_sized_vwap',
      'event_all_in_cost:fee_plus_settlement',
      'capital_lock_opportunity_cost:ranking_only_not_profitability_gate',
    ],
  });
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
  let depth = await measureKalshiEventSizedDepth({ ticker: signal.ticker, outcome, side: 'buy', contracts });
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

  const fee = await estimateKalshiEventFees({ ticker: signal.ticker, contracts, price: depth.vwapPrice });
  if (!fee?.economicCreditAllowed || fee.takerFeeUsd === null) {
    return dataCollectionCandidate(signal, outcome, ['required:authenticated_sized_fee_economics']);
  }
  const entryCostUsd = depth.notionalUsd;
  const entryFeeUsd = fee.takerFeeUsd;
  const settleDeadline = settlementDeadline(signal, now);
  const lockYears = Math.max(0, settleDeadline - now) / (365.25 * 24 * 60 * 60_000);
  // Capital opportunity cost is retained as a ranking signal only. It is not a
  // venue charge, cash outflow, or profitability veto.
  const capitalLockCostUsd = entryCostUsd * capitalOpportunityApr() * lockYears;
  // Integer binary contracts have exact $1 payout and Kalshi documents zero
  // settlement fee for simple yes/no determinations. Fractional/scalar paths are
  // not admitted by this generator.
  const settlementCostReserveUsd = 0;
  const expectedPayoutUsd = probability.conservative * contracts;
  const expectedNetProfitUsd = expectedPayoutUsd - entryCostUsd - entryFeeUsd - settlementCostReserveUsd;
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
    'capital_lock_cost:ranking_only',
    'variable_incentive_rewards:economic_credit_false_until_earned',
    'account_balance_mints_ownership:false',
    'system_owned_event_cash:required_at_execution',
    'expected_net:strictly_positive_executable_costs_required',
  ];
  const positive = Number.isFinite(expectedNetProfitUsd) && expectedNetProfitUsd > 0 && expiresAt > now;
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
    minimumExpectedNetProfitUsd: settlementCostReserveUsd,
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
    missingEvidence: positive ? [] : ['required:strictly_positive_conservative_executable_net'],
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
    const incentiveCountByTicker = new Map<string, number>();
    const incentiveRewardWeightByTicker = new Map<string, number>();
    const incentiveIdsByTicker = new Map<string, string[]>();
    for (const incentive of snapshot.incentives) {
      if (incentive.paidOut) continue;
      if (incentive.startAt !== null && incentive.startAt > now) continue;
      if (incentive.endAt !== null && incentive.endAt <= now) continue;
      const ticker = incentive.marketTicker.trim().toUpperCase();
      if (!ticker) continue;
      incentiveCountByTicker.set(ticker, (incentiveCountByTicker.get(ticker) ?? 0) + 1);
      incentiveRewardWeightByTicker.set(ticker, (incentiveRewardWeightByTicker.get(ticker) ?? 0) + Math.max(0, incentive.periodReward ?? 0));
      const ids = incentiveIdsByTicker.get(ticker) ?? [];
      ids.push(incentive.id);
      incentiveIdsByTicker.set(ticker, ids);
    }
    const markets = snapshot.markets
      .filter(signal => signal.status === 'open' && signal.expiresAt > now && signal.asset && signal.rulesFingerprint)
      .sort((a, b) => {
        const aTicker = a.ticker.trim().toUpperCase();
        const bTicker = b.ticker.trim().toUpperCase();
        const incentiveCountDelta = (incentiveCountByTicker.get(bTicker) ?? 0) - (incentiveCountByTicker.get(aTicker) ?? 0);
        if (incentiveCountDelta !== 0) return incentiveCountDelta;
        const incentiveRewardDelta = (incentiveRewardWeightByTicker.get(bTicker) ?? 0) - (incentiveRewardWeightByTicker.get(aTicker) ?? 0);
        if (incentiveRewardDelta !== 0) return incentiveRewardDelta;
        return (b.liquidityUsd ?? 0) - (a.liquidityUsd ?? 0) || (b.volume24h ?? 0) - (a.volume24h ?? 0);
      })
      .slice(0, scanLimit());

    for (const signal of markets) {
      const calibration = await getKalshiProbabilityCalibration(signal).catch(() => null);
      for (const outcome of ['yes', 'no'] as const) {
        const candidate = calibration
          ? await buildOutcomeCandidate(signal, calibration, outcome, usableSystemCashUsd)
          : dataCollectionCandidate(signal, outcome, ['required:terminal_probability_calibration_authority']);
        if (!candidate) continue;
        const ticker = signal.ticker.trim().toUpperCase();
        const incentiveIds = incentiveIdsByTicker.get(ticker) ?? [];
        if (incentiveIds.length > 0) {
          const incentiveProvenance = [
            `kalshi_active_incentive_program_count:${incentiveIds.length}`,
            `kalshi_active_incentive_program_ids:${incentiveIds.join(',')}`,
            'kalshi_incentive_program:ranking_priority_only',
            'kalshi_variable_reward:economic_credit_false_until_terminally_earned',
          ];
          candidate.provenance = [...candidate.provenance, ...incentiveProvenance];
          if (candidate.plan) candidate.plan = { ...candidate.plan, provenance: [...candidate.plan.provenance, ...incentiveProvenance] };
        }
        recordCanonicalEventCandidate(candidate);
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

  for (const previous of candidates.values()) {
    if (next.has(previous.opportunityId)) continue;
    measuredCandidateRegistry.updateStatus(previous.opportunityId, 'expired', {
      executableCapability: false,
      executionCapabilityReason: 'kalshi_prediction_event_candidate_invalidated_by_refresh',
      provenance: ['kalshi_event_refresh:stale_candidate_invalidated'],
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
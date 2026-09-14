import logger from '../../../logger.js';
import { getKalshiCrossVenueEventArbitrageSnapshot, type CrossVenueEventArbitrageCandidate } from '../discovery/kalshi-cross-venue-event-arbitrage.js';
import { getKalshiEventOpportunitySnapshot, getPreparedKalshiEventPlan } from '../discovery/kalshi-event-opportunity-generator.js';
import { measuredCandidateRegistry } from '../discovery/measured-candidate-registry.js';
import { getProfitLadderNotionalAuthority } from '../governance/profit-ladder-notional-authority.js';
import { operatorTradingStrategy } from '../governance/operator-trading-strategy.js';
import { stageManager } from '../governance/stage-management.js';
import {
  executeKalshiCrossVenueEventCandidate,
  type CrossVenueEventLifecycleResult,
} from './kalshi-cross-venue-event-lifecycle.js';
import { routeMeasuredOpportunity } from './unified-execution-router.js';
import { kalshiEventLifecycle, type KalshiEventLifecycleResult } from './kalshi-event-lifecycle.js';
import { dispatchBestKalshiEventMakerCandidate } from './kalshi-event-market-maker.js';
import {
  acquireKalshiCrossVenueEventResourceLease,
  acquireKalshiEventResourceLease,
} from './kalshi-event-resource-lease.js';

type CanonicalKalshiDispatchLifecycleResult = KalshiEventLifecycleResult | CrossVenueEventLifecycleResult;

export interface KalshiEventCanonicalDispatchResult {
  attempted: boolean;
  submitted: boolean;
  opportunityId: string | null;
  lifecycleId: string | null;
  result: CanonicalKalshiDispatchLifecycleResult | null;
  error?: string;
}

let dispatchInFlight: Promise<KalshiEventCanonicalDispatchResult> | null = null;

function liveExecutionEnabled(): boolean {
  return process.env.NO_EXECUTION !== 'true'
    && process.env.CRYPTO_ARBITRAGE_LIVE_EXECUTION === 'true'
    && process.env.CRYPTO_ARBITRAGE_LIVE_CONFIRMATION === 'I_ACCEPT_LIVE_ORDER_RISK'
    && process.env.CRYPTOCRAWL_KALSHI_EVENT_LIVE_EXECUTION === 'true';
}

function crossVenueLiveExecutionEnabled(): boolean {
  return liveExecutionEnabled()
    && process.env.CRYPTOCRAWL_KALSHI_CROSS_VENUE_LIVE_EXECUTION === 'true';
}

function crossVenueCandidateReady(candidate: CrossVenueEventArbitrageCandidate): boolean {
  const supersededDiscoveryGap = 'required:cross_venue_terminal_settlement_reconciliation';
  const onlyImplementedLegacyGapRemains = candidate.missingEvidence.every(item => item === supersededDiscoveryGap);
  return candidate.expiresAt > Date.now()
    && Number.isInteger(candidate.matchedContracts)
    && candidate.matchedContracts > 0
    && candidate.semanticEquivalenceProven
    && candidate.secondVenueExecutionEvidenceProven
    && candidate.guaranteedResidualUsd !== null
    && Number.isFinite(candidate.guaranteedResidualUsd)
    && candidate.guaranteedResidualUsd > 0
    && onlyImplementedLegacyGapRemains;
}

function crossVenueNotionalUsd(candidate: CrossVenueEventArbitrageCandidate): number | null {
  const values = [
    candidate.kalshiEntryUsd,
    candidate.secondVenueEntryUsd,
    candidate.kalshiFeeUsd,
    candidate.secondVenueFeeUsd,
    candidate.settlementCostReserveUsd,
    candidate.capitalLockCostUsd,
  ];
  if (values.some(value => value === null || !Number.isFinite(Number(value)) || Number(value) < 0)) return null;
  return values.reduce((sum, value) => sum + Number(value), 0);
}

function makerDispatchResult(
  maker: Awaited<ReturnType<typeof dispatchBestKalshiEventMakerCandidate>>,
): KalshiEventCanonicalDispatchResult {
  const result: KalshiEventLifecycleResult | null = maker.lifecycleId
    ? {
      success: maker.submitted && !maker.error,
      submitted: maker.submitted,
      settlementConfirmed: false,
      status: maker.submitted ? 'opening' : 'rejected',
      lifecycleId: maker.lifecycleId,
      orderId: maker.orderId ?? undefined,
      error: maker.error,
    }
    : null;
  return {
    attempted: maker.attempted,
    submitted: maker.submitted,
    opportunityId: maker.opportunityId,
    lifecycleId: maker.lifecycleId,
    result,
    error: maker.error,
  };
}

async function dispatchBestCrossVenueCandidate(): Promise<KalshiEventCanonicalDispatchResult | null> {
  if (!crossVenueLiveExecutionEnabled()) return null;
  const snapshot = getKalshiCrossVenueEventArbitrageSnapshot();
  const eligible = snapshot.candidates
    .filter(crossVenueCandidateReady)
    .sort((a, b) => (b.guaranteedResidualUsd ?? -Infinity) - (a.guaranteedResidualUsd ?? -Infinity));
  for (const candidate of eligible) {
    const notionalUsd = crossVenueNotionalUsd(candidate);
    if (notionalUsd === null || !(notionalUsd > 0)) continue;
    const resource = await acquireKalshiCrossVenueEventResourceLease({
      opportunityId: candidate.id,
      notionalUsd,
      expiresAt: candidate.expiresAt,
    });
    if (!resource) continue;
    const operator = await operatorTradingStrategy.reserveTrade(candidate.id, 'kalshi_polymarket_cross_event_arbitrage').catch(() => null);
    if (!operator?.allowed || !operator.reservationId) {
      await resource.release();
      return { attempted: false, submitted: false, opportunityId: candidate.id, lifecycleId: null, result: null, error: 'KALSHI_CROSS_EVENT_OPERATOR_SLOT_UNAVAILABLE' };
    }
    const reservationId = operator.reservationId;
    try {
      const current = getKalshiCrossVenueEventArbitrageSnapshot().candidates.find(row => row.id === candidate.id);
      if (!current || !crossVenueCandidateReady(current)) {
        await operatorTradingStrategy.releaseReservation(reservationId);
        return { attempted: false, submitted: false, opportunityId: candidate.id, lifecycleId: null, result: null, error: 'KALSHI_CROSS_EVENT_CANDIDATE_INVALIDATED_BEFORE_SUBMISSION' };
      }
      const result = await executeKalshiCrossVenueEventCandidate(current);
      if (!result.submitted) {
        await operatorTradingStrategy.releaseReservation(reservationId);
        return {
          attempted: true,
          submitted: false,
          opportunityId: candidate.id,
          lifecycleId: result.lifecycleId,
          result,
          error: result.error,
        };
      }
      await operatorTradingStrategy.markSubmitted(reservationId);
      if (result.settlementConfirmed || result.status === 'FAILED') {
        await operatorTradingStrategy.markTerminal(reservationId);
      }
      logger.info('[KalshiEventDispatch] Canonical cross-venue prediction parent submitted', {
        component: 'KalshiEventCanonicalDispatch', opportunityId: candidate.id,
        lifecycleId: result.lifecycleId, status: result.status,
        guaranteedResidualUsd: current.guaranteedResidualUsd,
        matchedContracts: current.matchedContracts,
        semanticEquivalenceProven: current.semanticEquivalenceProven,
        secondVenueExecutionEvidenceProven: current.secondVenueExecutionEvidenceProven,
        systemOwnedCashBothVenuesRequired: true,
        distributedDualVenueResourceLease: true,
        operatorSlotConsumed: true,
        personalCapitalFallback: false,
      });
      return { attempted: true, submitted: true, opportunityId: candidate.id, lifecycleId: result.lifecycleId, result, error: result.error };
    } catch (error) {
      await operatorTradingStrategy.markSubmitted(reservationId).catch(() => undefined);
      logger.error('[KalshiEventDispatch] Cross-venue dispatch became ambiguous; operator slot retained conservatively', {
        component: 'KalshiEventCanonicalDispatch', opportunityId: candidate.id,
        error: error instanceof Error ? error.message : String(error),
        operatorSlotConsumedConservatively: true, extraDailyTradeAllowed: false,
      });
      return { attempted: true, submitted: true, opportunityId: candidate.id, lifecycleId: null, result: null, error: 'KALSHI_CROSS_EVENT_AMBIGUOUS_DISPATCH' };
    } finally {
      await resource.release();
    }
  }
  return null;
}

export async function dispatchBestKalshiEventCandidate(): Promise<KalshiEventCanonicalDispatchResult> {
  if (dispatchInFlight) return dispatchInFlight;
  dispatchInFlight = (async () => {
    if (!liveExecutionEnabled() || !stageManager.isMarketOperationsAllowed() || !stageManager.canExecuteTrades()) {
      return { attempted: false, submitted: false, opportunityId: null, lifecycleId: null, result: null };
    }
    const ladder = getProfitLadderNotionalAuthority();
    if (!ladder.aligned || !(ladder.maxNotionalUsd > 0)) {
      return { attempted: false, submitted: false, opportunityId: null, lifecycleId: null, result: null, error: 'KALSHI_EVENT_PROFIT_LADDER_NOTIONAL_UNAVAILABLE' };
    }

    const crossVenue = await dispatchBestCrossVenueCandidate();
    if (crossVenue) return crossVenue;

    const snapshot = getKalshiEventOpportunitySnapshot();
    const eligible = snapshot.candidates
      .filter(candidate => candidate.status === 'eligible' && candidate.plan && candidate.expiresAt > Date.now())
      .sort((a, b) => (b.expectedNetProfitUsd ?? -Infinity) - (a.expectedNetProfitUsd ?? -Infinity)
        || (b.expectedNetBps ?? -Infinity) - (a.expectedNetBps ?? -Infinity)
        || a.settlementDeadlineAt - b.settlementDeadlineAt);
    for (const candidate of eligible) {
      const measured = measuredCandidateRegistry.get(candidate.opportunityId);
      if (!measured
        || measured.topology !== 'PREDICTION_EVENT'
        || measured.status !== 'eligible'
        || measured.executableCapability !== true
        || measured.expiresAt <= Date.now()) continue;
      const admission = routeMeasuredOpportunity(measured);
      if (!admission.admitted
        || admission.hardVetoVerified
        || admission.path !== 'PREDICTION_EVENT_ORDER'
        || admission.opportunityId !== candidate.opportunityId) continue;

      const plan = getPreparedKalshiEventPlan(candidate.opportunityId);
      if (!plan || plan.opportunityId !== measured.opportunityId) continue;
      // Resource notional is actual system cash required by the route. Capital
      // lock opportunity cost remains a ranking signal and never consumes cash
      // capacity or vetoes an otherwise profitable candidate.
      const notionalUsd = Number(candidate.entryCostUsd ?? 0) + Number(candidate.entryFeeUsd ?? 0)
        + Number(candidate.settlementCostReserveUsd ?? 0);
      if (!(notionalUsd > 0) || notionalUsd > ladder.maxNotionalUsd) continue;
      const resource = await acquireKalshiEventResourceLease({ opportunityId: candidate.opportunityId, notionalUsd, expiresAt: candidate.expiresAt });
      if (!resource) continue;
      const operator = await operatorTradingStrategy.reserveTrade(candidate.opportunityId, 'kalshi_event_calibrated_buy_hold').catch(() => null);
      if (!operator?.allowed || !operator.reservationId) {
        await resource.release();
        return { attempted: false, submitted: false, opportunityId: candidate.opportunityId, lifecycleId: null, result: null, error: 'KALSHI_EVENT_OPERATOR_SLOT_UNAVAILABLE' };
      }
      const reservationId = operator.reservationId;
      try {
        const currentMeasured = measuredCandidateRegistry.get(candidate.opportunityId);
        const currentAdmission = currentMeasured ? routeMeasuredOpportunity(currentMeasured) : null;
        if (!currentMeasured
          || currentMeasured.updatedAt !== measured.updatedAt
          || currentMeasured.status !== 'eligible'
          || !currentAdmission?.admitted
          || currentAdmission.path !== 'PREDICTION_EVENT_ORDER') {
          await operatorTradingStrategy.releaseReservation(reservationId);
          return { attempted: false, submitted: false, opportunityId: candidate.opportunityId, lifecycleId: null, result: null, error: 'KALSHI_EVENT_CANDIDATE_INVALIDATED_BEFORE_SUBMISSION' };
        }

        const result = await kalshiEventLifecycle.execute(plan);
        const ambiguousDurableOpening = result.submitted === false
          && Boolean(result.lifecycleId)
          && result.status === 'opening'
          && result.error === 'KALSHI_EVENT_ENTRY_RECOVERY_REQUIRED';
        if (ambiguousDurableOpening) {
          await operatorTradingStrategy.markSubmitted(reservationId);
          logger.warn('[KalshiEventDispatch] Ambiguous event entry retained under canonical operator accounting', {
            component: 'KalshiEventCanonicalDispatch', opportunityId: candidate.opportunityId,
            lifecycleId: result.lifecycleId, venueSubmissionConfirmed: false,
            operatorSlotConsumedConservatively: true, extraDailyTradeAllowed: false,
          });
          return {
            attempted: true,
            submitted: true,
            opportunityId: candidate.opportunityId,
            lifecycleId: result.lifecycleId ?? null,
            result,
            error: 'KALSHI_EVENT_ENTRY_RECOVERY_REQUIRED',
          };
        }
        const concreteSubmission = result.submitted === true && Boolean(result.lifecycleId)
          && (Boolean(result.orderId) || result.status === 'opening' || result.status === 'waiting_settlement');
        if (!concreteSubmission) {
          await operatorTradingStrategy.releaseReservation(reservationId);
          return { attempted: true, submitted: false, opportunityId: candidate.opportunityId, lifecycleId: result.lifecycleId ?? null, result };
        }
        await operatorTradingStrategy.markSubmitted(reservationId);
        if (result.settlementConfirmed || result.status === 'failed') {
          await operatorTradingStrategy.markTerminal(reservationId);
        }
        logger.info('[KalshiEventDispatch] Canonical event parent submitted', {
          component: 'KalshiEventCanonicalDispatch', opportunityId: candidate.opportunityId,
          lifecycleId: result.lifecycleId, orderId: result.orderId, expectedNetProfitUsd: plan.expectedNetProfitUsd,
          capitalLockCostUsd: candidate.capitalLockCostUsd, capitalLockRankingOnly: true,
          operatorSlotConsumed: true, systemOwnedCashOnly: true, rawProbabilityAuthority: false,
          dynamicProfitabilityAdmission: 'required', profitLadderRung: ladder.rungKey,
          profitLadderMaxNotionalUsd: ladder.maxNotionalUsd, exactMeasuredCandidateRequired: true,
        });
        return { attempted: true, submitted: true, opportunityId: candidate.opportunityId, lifecycleId: result.lifecycleId ?? null, result };
      } catch (error) {
        logger.error('[KalshiEventDispatch] Canonical event dispatch failed with durable reservation retained', {
          component: 'KalshiEventCanonicalDispatch', opportunityId: candidate.opportunityId,
          error: error instanceof Error ? error.message : String(error), extraDailyTradeAllowed: false,
        });
        return { attempted: true, submitted: false, opportunityId: candidate.opportunityId, lifecycleId: null, result: null, error: 'KALSHI_EVENT_AMBIGUOUS_DISPATCH' };
      } finally {
        await resource.release();
      }
    }

    const maker = await dispatchBestKalshiEventMakerCandidate();
    if (maker.attempted || maker.submitted || maker.error) return makerDispatchResult(maker);
    return { attempted: false, submitted: false, opportunityId: null, lifecycleId: null, result: null };
  })().finally(() => { dispatchInFlight = null; });
  return dispatchInFlight;
}
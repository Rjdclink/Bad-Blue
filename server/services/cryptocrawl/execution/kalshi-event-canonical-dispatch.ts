import logger from '../../../logger.js';
import { getKalshiEventOpportunitySnapshot, getPreparedKalshiEventPlan } from '../discovery/kalshi-event-opportunity-generator.js';
import { measuredCandidateRegistry } from '../discovery/measured-candidate-registry.js';
import { getProfitLadderNotionalAuthority } from '../governance/profit-ladder-notional-authority.js';
import { operatorTradingStrategy } from '../governance/operator-trading-strategy.js';
import { stageManager } from '../governance/stage-management.js';
import { routeMeasuredOpportunity } from './unified-execution-router.js';
import { kalshiEventLifecycle, type KalshiEventLifecycleResult } from './kalshi-event-lifecycle.js';
import { dispatchBestKalshiEventMakerCandidate } from './kalshi-event-market-maker.js';
import { acquireKalshiEventResourceLease } from './kalshi-event-resource-lease.js';

export interface KalshiEventCanonicalDispatchResult {
  attempted: boolean;
  submitted: boolean;
  opportunityId: string | null;
  lifecycleId: string | null;
  result: KalshiEventLifecycleResult | null;
  error?: string;
}

let dispatchInFlight: Promise<KalshiEventCanonicalDispatchResult> | null = null;

function liveExecutionEnabled(): boolean {
  return process.env.NO_EXECUTION !== 'true'
    && process.env.CRYPTO_ARBITRAGE_LIVE_EXECUTION === 'true'
    && process.env.CRYPTO_ARBITRAGE_LIVE_CONFIRMATION === 'I_ACCEPT_LIVE_ORDER_RISK'
    && process.env.CRYPTOCRAWL_KALSHI_EVENT_LIVE_EXECUTION === 'true';
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
    const snapshot = getKalshiEventOpportunitySnapshot();
    const eligible = snapshot.candidates
      .filter(candidate => candidate.status === 'eligible' && candidate.plan && candidate.expiresAt > Date.now())
      .sort((a, b) => (b.expectedNetProfitUsd ?? -Infinity) - (a.expectedNetProfitUsd ?? -Infinity)
        || (b.expectedNetBps ?? -Infinity) - (a.expectedNetBps ?? -Infinity));
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
      const notionalUsd = Number(candidate.entryCostUsd ?? 0) + Number(candidate.entryFeeUsd ?? 0)
        + Number(candidate.settlementCostReserveUsd ?? 0) + Number(candidate.capitalLockCostUsd ?? 0);
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

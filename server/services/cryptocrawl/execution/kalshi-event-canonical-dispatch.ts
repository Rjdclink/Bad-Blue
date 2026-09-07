import logger from '../../../logger.js';
import { getKalshiEventOpportunitySnapshot, getPreparedKalshiEventPlan } from '../discovery/kalshi-event-opportunity-generator.js';
import { operatorTradingStrategy } from '../governance/operator-trading-strategy.js';
import { stageManager } from '../governance/stage-management.js';
import { kalshiEventLifecycle, type KalshiEventLifecycleResult } from './kalshi-event-lifecycle.js';
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

export async function dispatchBestKalshiEventCandidate(): Promise<KalshiEventCanonicalDispatchResult> {
  if (dispatchInFlight) return dispatchInFlight;
  dispatchInFlight = (async () => {
    if (!liveExecutionEnabled() || !stageManager.isMarketOperationsAllowed() || !stageManager.canExecuteTrades()) {
      return { attempted: false, submitted: false, opportunityId: null, lifecycleId: null, result: null };
    }
    const snapshot = getKalshiEventOpportunitySnapshot();
    const eligible = snapshot.candidates
      .filter(candidate => candidate.status === 'eligible' && candidate.plan && candidate.expiresAt > Date.now())
      .sort((a, b) => (b.expectedNetProfitUsd ?? -Infinity) - (a.expectedNetProfitUsd ?? -Infinity)
        || (b.expectedNetBps ?? -Infinity) - (a.expectedNetBps ?? -Infinity));
    for (const candidate of eligible) {
      const plan = getPreparedKalshiEventPlan(candidate.opportunityId);
      if (!plan) continue;
      const notionalUsd = Number(candidate.entryCostUsd ?? 0) + Number(candidate.entryFeeUsd ?? 0);
      if (!(notionalUsd > 0)) continue;
      const resource = await acquireKalshiEventResourceLease({ opportunityId: candidate.opportunityId, notionalUsd, expiresAt: candidate.expiresAt });
      if (!resource) continue;
      const operator = await operatorTradingStrategy.reserveTrade(candidate.opportunityId, 'kalshi_event_calibrated_buy_hold').catch(() => null);
      if (!operator?.allowed || !operator.reservationId) {
        await resource.release();
        return { attempted: false, submitted: false, opportunityId: candidate.opportunityId, lifecycleId: null, result: null, error: 'KALSHI_EVENT_OPERATOR_SLOT_UNAVAILABLE' };
      }
      const reservationId = operator.reservationId;
      try {
        const result = await kalshiEventLifecycle.execute(plan);
        const concreteSubmission = result.submitted === true && Boolean(result.lifecycleId)
          && (Boolean(result.orderId) || result.status === 'opening' || result.status === 'waiting_settlement');
        if (!concreteSubmission) {
          await operatorTradingStrategy.releaseReservation(reservationId);
          return { attempted: true, submitted: false, opportunityId: candidate.opportunityId, lifecycleId: result.lifecycleId ?? null, result };
        }
        await operatorTradingStrategy.markSubmitted(reservationId);
        if (result.settlementConfirmed) await operatorTradingStrategy.markTerminal(reservationId);
        logger.info('[KalshiEventDispatch] Canonical event parent submitted', {
          component: 'KalshiEventCanonicalDispatch', opportunityId: candidate.opportunityId,
          lifecycleId: result.lifecycleId, orderId: result.orderId, expectedNetProfitUsd: plan.expectedNetProfitUsd,
          operatorSlotConsumed: true, systemOwnedCashOnly: true, rawProbabilityAuthority: false,
        });
        return { attempted: true, submitted: true, opportunityId: candidate.opportunityId, lifecycleId: result.lifecycleId ?? null, result };
      } catch (error) {
        // Submission state may be ambiguous. Preserve the durable operator
        // reservation rather than granting an extra daily trade after a timeout.
        logger.error('[KalshiEventDispatch] Canonical event dispatch failed with durable reservation retained', {
          component: 'KalshiEventCanonicalDispatch', opportunityId: candidate.opportunityId,
          error: error instanceof Error ? error.message : String(error), extraDailyTradeAllowed: false,
        });
        return { attempted: true, submitted: false, opportunityId: candidate.opportunityId, lifecycleId: null, result: null, error: 'KALSHI_EVENT_AMBIGUOUS_DISPATCH' };
      } finally {
        await resource.release();
      }
    }
    return { attempted: false, submitted: false, opportunityId: null, lifecycleId: null, result: null };
  })().finally(() => { dispatchInFlight = null; });
  return dispatchInFlight;
}

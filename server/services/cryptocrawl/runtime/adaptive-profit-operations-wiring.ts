import logger from '../../../logger.js';
import {
  arbitrageVerifier,
  type VerifiedArbitragePlan,
  type VerifyManyRequest,
} from '../arbitrage/arbitrage-verifier.js';
import { getCryptocrawlGovernance } from '../governance/governance.js';
import { getAdaptiveProfitOperatingEnvelope } from '../governance/adaptive-profit-operating-envelope.js';
import { stageManager } from '../governance/stage-management.js';
import { GovernanceError, type GovernanceAction } from '../governance/types.js';
import type { ScanCapacityDecision } from '../discovery/scan-capacity-policy.js';

const ADAPTIVE_MARK = Symbol.for('cryptocrawl.adaptive-profit-operations');

function marked(fn: unknown): boolean {
  return typeof fn === 'function' && Boolean((fn as any)[ADAPTIVE_MARK]);
}

function mark<T extends Function>(fn: T): T {
  (fn as any)[ADAPTIVE_MARK] = true;
  return fn;
}

function boundedNotional(requested: number): number {
  const envelope = getAdaptiveProfitOperatingEnvelope();
  if (envelope.stage <= 1 || !(envelope.recommendedMaxNotionalUsd > 0)) return requested;
  return Math.min(requested, envelope.recommendedMaxNotionalUsd);
}

function planNeedsRefinement(plan: VerifiedArbitragePlan): { needed: boolean; scale: number; reasons: string[] } {
  const envelope = getAdaptiveProfitOperatingEnvelope();
  const reasons: string[] = [];
  let scale = 1;
  const impact = Number(plan.expectedPriceImpactBps ?? plan.expectedSlippageBps);
  if (Number.isFinite(impact) && impact > envelope.maxExpectedSlippageBps && impact > 0) {
    scale = Math.min(scale, envelope.maxExpectedSlippageBps / impact * 0.9);
    reasons.push(`expected_slippage_${impact.toFixed(4)}bps_above_${envelope.maxExpectedSlippageBps.toFixed(4)}bps`);
  }
  if (envelope.stage > 1 && envelope.remainingDailyProfitCapacityUsd > 0
      && plan.netProfitUsd > envelope.remainingDailyProfitCapacityUsd) {
    scale = Math.min(scale, envelope.remainingDailyProfitCapacityUsd / plan.netProfitUsd * 0.9);
    reasons.push('expected_profit_exceeds_remaining_daily_realized_profit_capacity');
  }
  return { needed: reasons.length > 0 && scale < 0.999, scale: Math.max(0.01, Math.min(1, scale)), reasons };
}

function planWithinOperatingEnvelope(plan: VerifiedArbitragePlan): boolean {
  const envelope = getAdaptiveProfitOperatingEnvelope();
  const impact = Number(plan.expectedPriceImpactBps ?? plan.expectedSlippageBps);
  if (Number.isFinite(impact) && impact > envelope.maxExpectedSlippageBps + 1e-9) return false;
  if (envelope.stage > 1) {
    if (!envelope.newExposureAllowed) return false;
    if (plan.netProfitUsd > envelope.remainingDailyProfitCapacityUsd + 1e-9) return false;
    if (plan.notionalUsd > envelope.recommendedMaxNotionalUsd + 1e-9) return false;
  }
  return Number.isFinite(plan.netProfitUsd) && plan.netProfitUsd > 0;
}

export function ensureAdaptiveProfitOperationsWiring(): void {
  const verifier = arbitrageVerifier as typeof arbitrageVerifier & {
    evaluateOnce: (request: any) => Promise<VerifiedArbitragePlan | null>;
    evaluateMany: (
      request: VerifyManyRequest,
      symbols: readonly string[],
      capacity?: ScanCapacityDecision,
    ) => Promise<Map<string, VerifiedArbitragePlan | null>>;
  };

  if (!marked(verifier.evaluateOnce)) {
    const underlyingEvaluateOnce = verifier.evaluateOnce.bind(verifier);
    verifier.evaluateOnce = mark(async (request: any): Promise<VerifiedArbitragePlan | null> => {
      const envelope = getAdaptiveProfitOperatingEnvelope();
      if (envelope.stage > 1 && !envelope.newExposureAllowed) return null;
      const requested = Number(request?.notionalUsd || 0);
      const initialBound = requested > 0 ? boundedNotional(requested) : requested;
      let plan = await underlyingEvaluateOnce({ ...request, notionalUsd: initialBound });
      if (!plan) return null;

      const refinement = planNeedsRefinement(plan);
      if (refinement.needed) {
        const refinedBound = Math.max(1e-6, initialBound * refinement.scale);
        const refined = await underlyingEvaluateOnce({ ...request, notionalUsd: refinedBound });
        if (refined) plan = refined;
        logger.info('[AdaptiveProfitOperations] CEX plan received one bounded depth/profit-cap refinement', {
          component: 'AdaptiveProfitOperationsWiring',
          symbol: plan.symbol,
          originalRequestedNotionalUsd: requested,
          initialBoundUsd: initialBound,
          refinedBoundUsd: refinedBound,
          reasons: refinement.reasons,
          refinedPlanAvailable: Boolean(refined),
        });
      }
      return planWithinOperatingEnvelope(plan) ? plan : null;
    });
  }

  if (!marked(verifier.evaluateMany)) {
    const underlyingEvaluateMany = verifier.evaluateMany.bind(verifier);
    const refinementEvaluateOnce = verifier.evaluateOnce.bind(verifier);
    verifier.evaluateMany = mark(async (
      request: VerifyManyRequest,
      symbols: readonly string[],
      capacity?: ScanCapacityDecision,
    ): Promise<Map<string, VerifiedArbitragePlan | null>> => {
      const envelope = getAdaptiveProfitOperatingEnvelope();
      if (envelope.stage > 1 && !envelope.newExposureAllowed) {
        return new Map<string, VerifiedArbitragePlan | null>(
          symbols.map(symbol => [symbol.trim().toUpperCase(), null] as [string, VerifiedArbitragePlan | null]),
        );
      }
      const requested = Number(request.notionalUsd || 0);
      const initialBound = requested > 0 ? boundedNotional(requested) : requested;
      const plans = await underlyingEvaluateMany({ ...request, notionalUsd: initialBound }, symbols, capacity);

      const refinements: Array<Promise<void>> = [];
      for (const [symbol, plan] of plans.entries()) {
        if (!plan) continue;
        const refinement = planNeedsRefinement(plan);
        if (!refinement.needed) {
          if (!planWithinOperatingEnvelope(plan)) plans.set(symbol, null);
          continue;
        }
        refinements.push((async () => {
          const refinedBound = Math.max(1e-6, initialBound * refinement.scale);
          const refined = await refinementEvaluateOnce({
            ...request,
            symbol,
            notionalUsd: refinedBound,
            minNetProfitUsd: 0,
          }).catch(() => null);
          plans.set(symbol, refined && planWithinOperatingEnvelope(refined) ? refined : null);
        })());
      }
      await Promise.all(refinements);
      return plans;
    });
  }

  const governance = getCryptocrawlGovernance() as ReturnType<typeof getCryptocrawlGovernance> & {
    requireAllowed: (
      action: GovernanceAction,
      context?: { chain?: string; pair?: string; venue?: string },
    ) => void;
  };
  if (!marked(governance.requireAllowed)) {
    const underlyingRequireAllowed = governance.requireAllowed.bind(governance);
    governance.requireAllowed = mark((action: GovernanceAction, context?: { chain?: string; pair?: string; venue?: string }): void => {
      underlyingRequireAllowed(action, context);
      // This gate blocks only NEW exposure. SUBMIT_TX remains available so an
      // already-open position can always be cancelled, hedged, settled or flattened.
      if (action !== 'EXECUTE_OPPORTUNITY') return;
      const envelope = getAdaptiveProfitOperatingEnvelope();
      if (!envelope.newExposureAllowed) {
        throw new GovernanceError('CONSTRAINT_VIOLATION', 'Adaptive daily realized-profit envelope reached; new exposure is paused until rolling capacity returns', {
          dailyProfitCapUsd: envelope.dailyProfitCapUsd,
          rolling24hRealizedProfitUsd: envelope.rolling24hRealizedProfitUsd,
          remainingDailyProfitCapacityUsd: envelope.remainingDailyProfitCapacityUsd,
          settlementAndFlatteningStillAllowed: true,
        });
      }
    });
  }

  // Reassert this telemetry method on every installation call because older
  // compatibility profitability wiring may be initialized in either runtime order.
  const stageRuntime = stageManager as typeof stageManager & { getMaxDailyProfit: () => number };
  stageRuntime.getMaxDailyProfit = () => getAdaptiveProfitOperatingEnvelope().dailyProfitCapUsd;

  const envelope = getAdaptiveProfitOperatingEnvelope();
  logger.info('[AdaptiveProfitOperations] Terminal-realized profit operating envelope installed/reasserted', {
    component: 'AdaptiveProfitOperationsWiring',
    dailyProfitCapUsd: envelope.dailyProfitCapUsd,
    recommendedMaxNotionalUsd: envelope.recommendedMaxNotionalUsd,
    maxExpectedSlippageBps: envelope.maxExpectedSlippageBps,
    recommendedCycleBudget: envelope.recommendedCycleBudget,
    performanceDegraded: envelope.performanceDegraded,
    wrapperOrderResilient: true,
    newExposureGateOnly: true,
    settlementHedgeFlatteningExemptFromProfitCap: true,
    stagePositionCeilingsPreserved: true,
    strictPositiveNetAuthorityPreserved: true,
    terminalSettlementAuthorityPreserved: true,
    exchangeSurveillanceThresholdAssumed: false,
  });
}

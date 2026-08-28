import logger from '../../../logger.js';
import { getCryptara } from '../../cryptara/index.js';
import { arbitrageVerifier, type VerifiedArbitragePlan } from '../arbitrage/arbitrage-verifier.js';
import { canonicalOpportunityState } from '../intelligence/canonical-opportunity-state.js';
import { estimateResidualSlippage, observeSlippageCalibration, slippageSizeBucket, slippageTimeBucket } from '../validation/slippage-calibration-store.js';

const ARB_PATCH = Symbol.for('cryptocrawl.slippage-calibration.arbitrage');
const LEARNING_PATCH = Symbol.for('cryptocrawl.slippage-calibration.learning');

function calibratedPlan(plan: VerifiedArbitragePlan): VerifiedArbitragePlan | null {
  const estimate = estimateResidualSlippage({
    venuePair: `${plan.buyVenue}->${plan.sellVenue}`,
    symbol: plan.symbol,
    sizeBucket: slippageSizeBucket(plan.notionalUsd),
    volatilityBucket: 'unknown',
    timeBucket: slippageTimeBucket(),
  });
  const residualUsd = plan.notionalUsd * estimate.residualSlippageBps / 10_000;
  if (!Number.isFinite(residualUsd) || residualUsd < 0) return null;
  const totalCostsUsd = plan.costs.totalCostsUsd + residualUsd;
  const netProfitUsd = plan.grossProfitUsd - totalCostsUsd;
  if (!Number.isFinite(netProfitUsd) || netProfitUsd <= 0) return null;
  return {
    ...plan,
    netProfitUsd,
    expectedSlippageBps: Math.max(0, plan.expectedSlippageBps || 0) + estimate.residualSlippageBps,
    costs: {
      ...plan.costs,
      totalCostsUsd,
      calibratedResidualSlippageUsd: residualUsd,
    } as VerifiedArbitragePlan['costs'] & { calibratedResidualSlippageUsd: number },
  };
}

export function ensureSlippageCalibrationWiring(): void {
  const verifier = arbitrageVerifier as typeof arbitrageVerifier & { [ARB_PATCH]?: boolean };
  if (!verifier[ARB_PATCH]) {
    verifier[ARB_PATCH] = true;
    const previousEvaluateOnce = verifier.evaluateOnce.bind(verifier);
    verifier.evaluateOnce = async request => {
      const plan = await previousEvaluateOnce(request);
      if (!plan) return null;
      return calibratedPlan(plan);
    };
  }

  const cryptara = getCryptara() as ReturnType<typeof getCryptara> & { [LEARNING_PATCH]?: boolean };
  if (!cryptara[LEARNING_PATCH]) {
    cryptara[LEARNING_PATCH] = true;
    const previousRecord = cryptara.recordExecutionResult.bind(cryptara);
    cryptara.recordExecutionResult = feedback => {
      previousRecord(feedback);
      if (feedback.settlement.terminal !== true || feedback.settlement.confirmed !== true || feedback.realizedSlippageBps === null || !Number.isFinite(feedback.realizedSlippageBps)) return;
      const snapshot = canonicalOpportunityState.get(feedback.opportunityId);
      const plan = snapshot?.plan;
      if (!plan) return;
      const partialFill = feedback.settlement.legs.some(leg => leg.status === 'partial');
      observeSlippageCalibration({
        venuePair: `${plan.buyVenue}->${plan.sellVenue}`,
        symbol: plan.symbol,
        sizeBucket: slippageSizeBucket(plan.notionalUsd),
        volatilityBucket: 'unknown',
        timeBucket: slippageTimeBucket(feedback.observedAt),
        observedAt: feedback.observedAt,
        expectedDepthSlippageBps: Math.max(0, plan.expectedPriceImpactBps || 0),
        realizedSlippageBps: Math.max(0, feedback.realizedSlippageBps),
        partialFill,
        sourceEventId: feedback.settlement.settlementId,
      });
    };
  }

  logger.info('[SlippageCalibration] measured residual slippage wiring installed', {
    component: 'SlippageCalibrationWiring',
    terminalSettlementOnly: true,
    deterministicEconomicsInput: true,
    monteCarloInput: true,
    conservativeFallback: true,
    regimeInvalidation: true,
    executionAuthority: false,
  });
}

import logger from '../../../logger.js';
import { getCryptara } from '../../cryptara/index.js';
import type { CryptaraOpportunityAssessment, CryptaraOpportunityContext } from '../../cryptara/index.js';
import { arbitrageVerifier, type VerifiedArbitragePlan } from '../arbitrage/arbitrage-verifier.js';
import { normalizeCoinbaseExecutablePlan } from '../execution/coinbase-executable-plan-policy.js';
import { stageManager } from '../governance/stage-management.js';

let installed = false;

function criticalMissingInformation(items: readonly string[]): string[] {
  return [...new Set(items)].filter(item =>
    !item.startsWith('optional:')
    && !item.startsWith('optional_missing:')
    && !item.startsWith('not_applicable:'),
  );
}

function normalizePositiveAssessment(
  context: CryptaraOpportunityContext,
  assessment: CryptaraOpportunityAssessment,
): CryptaraOpportunityAssessment {
  const plan = context.plan;
  if (!plan || !Number.isFinite(plan.netProfitUsd) || plan.netProfitUsd <= 0) return assessment;

  const criticalMissing = criticalMissingInformation(assessment.missingInformation);
  if (criticalMissing.length > 0 || !assessment.monteCarlo) {
    // Positive deterministic economics are necessary, not sufficient. Missing
    // critical execution evidence remains fail-closed, but rank is not allowed
    // to turn a genuinely positive opportunity into a rejection by itself.
    assessment.recommendation = 'observe';
    assessment.provenance = [...new Set([
      ...assessment.provenance,
      'positive_profit_capture:critical_evidence_still_required',
      'rank_non_authoritative_for_execution',
    ])];
    return assessment;
  }

  if (!Number.isFinite(assessment.monteCarlo.probabilityOfProfit) || assessment.monteCarlo.probabilityOfProfit < 0.6) {
    // Stochastic execution-risk evidence may still reject a positive pre-trade
    // plan. The user directive removes arbitrary profit/rank filters, not risk,
    // fill, settlement, freshness, liquidity, or governance controls.
    assessment.recommendation = 'reject';
    assessment.provenance = [...new Set([
      ...assessment.provenance,
      'positive_profit_capture:mc_risk_gate_retained',
      'rank_non_authoritative_for_execution',
    ])];
    return assessment;
  }

  assessment.recommendation = 'consider';
  assessment.provenance = [...new Set([
    ...assessment.provenance,
    'positive_profit_capture:any_verified_net_gt_zero',
    'rank_diagnostic_only',
  ])];
  return assessment;
}

/**
 * Installs a narrow compatibility policy over legacy profit/ranking surfaces.
 * Canonical all-in deterministic economics, Monte Carlo risk, governance,
 * inventory/resource leases, quote freshness, settlement and circuit breakers
 * remain authoritative. Only arbitrary minimum-profit, maximum-profit and
 * rank-score rejection semantics are removed.
 */
export function ensurePositiveProfitCaptureWiring(): void {
  if (installed) return;
  installed = true;

  const verifier = arbitrageVerifier as typeof arbitrageVerifier & {
    verifyOnce: (request: any) => Promise<VerifiedArbitragePlan | null>;
    evaluateOnce: (request: any) => Promise<VerifiedArbitragePlan | null>;
  };
  const originalEvaluateOnce = verifier.evaluateOnce.bind(verifier);
  verifier.evaluateOnce = async (request: any): Promise<VerifiedArbitragePlan | null> => {
    const plan = await originalEvaluateOnce(request);
    if (!plan) return null;
    // Coinbase increments/minimums are deterministic execution evidence, not an
    // order-submission concern. Normalize before a plan can become eligible.
    return normalizeCoinbaseExecutablePlan(plan);
  };
  verifier.verifyOnce = async (request: any): Promise<VerifiedArbitragePlan | null> => {
    const plan = await verifier.evaluateOnce(request);
    return plan && Number.isFinite(plan.netProfitUsd) && plan.netProfitUsd > 0 ? plan : null;
  };

  // Stage maxDailyProfit remains a descriptive progression milestone in stage
  // configuration, but must never be a reason to stop taking another otherwise
  // safe, independently profitable trade. Drawdown, position and loss limits stay.
  const stageRuntime = stageManager as typeof stageManager & { getMaxDailyProfit: () => number };
  stageRuntime.getMaxDailyProfit = () => Number.POSITIVE_INFINITY;

  const cryptara = getCryptara() as ReturnType<typeof getCryptara> & {
    getAutonomousDirective: () => ReturnType<ReturnType<typeof getCryptara>['getAutonomousDirective']>;
    recordOpportunityObservation: (context: CryptaraOpportunityContext) => CryptaraOpportunityAssessment;
  };

  const originalDirective = cryptara.getAutonomousDirective.bind(cryptara);
  cryptara.getAutonomousDirective = () => ({
    ...originalDirective(),
    minimumNetProfitUsd: 0,
  });

  const originalObservation = cryptara.recordOpportunityObservation.bind(cryptara);
  cryptara.recordOpportunityObservation = (context: CryptaraOpportunityContext): CryptaraOpportunityAssessment => {
    const assessment = originalObservation(context);
    return normalizePositiveAssessment(context, assessment);
  };

  logger.info('[PositiveProfitCapture] Arbitrary profit/rank filters removed without weakening safety authorities', {
    component: 'PositiveProfitCapture',
    deterministicNetProfitRule: 'strictly_greater_than_zero',
    arbitraryMinimumProfitUsd: false,
    maximumDailyProfitExecutionStop: false,
    rankScoreExecutionGate: false,
    coinbaseProductConstraintsBeforeEligibility: true,
    retainedAuthorities: [
      'deterministic_all_in_economics',
      'monte_carlo_execution_risk',
      'governance_stage',
      'risk_circuit_breakers',
      'position_size',
      'inventory_resource_leases',
      'quote_freshness',
      'settlement',
    ],
  });
}

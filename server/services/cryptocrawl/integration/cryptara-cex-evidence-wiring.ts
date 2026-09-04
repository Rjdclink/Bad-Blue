import type Cryptara from '../../cryptara/index.js';
import type {
  CryptaraOpportunityAssessment,
  CryptaraOpportunityContext,
} from '../../cryptara/index.js';
import { createLogger } from '../../../logger.js';
import { canonicalOpportunityState } from '../intelligence/canonical-opportunity-state.js';
import { evaluateCexCrossImpactPriority } from '../intelligence/cex-cross-impact-advisory.js';
import { ensureCryptaraAssessmentWiring } from './cryptara-assessment-wiring.js';
import { ensureCryptaraProviderConsensusWiring } from './cryptara-provider-consensus-wiring.js';

const log = createLogger('CryptaraCexEvidenceWiring');
const installed = new WeakSet<object>();
// Keep the active CEX governance surface aligned with the implemented execution
// venues. Unsupported venues must not receive topology-specific completeness
// corrections that could make them look more executable than they are.
const CEX_EXECUTION_VENUES = new Set(['coinbase', 'kraken', 'okx']);

type CryptaraAssessmentTarget = {
  assessOpportunity: (context: CryptaraOpportunityContext) => Promise<CryptaraOpportunityAssessment>;
};

function isCexCexPlan(context: CryptaraOpportunityContext): boolean {
  const plan = context.plan;
  return !!plan
    && CEX_EXECUTION_VENUES.has(String(plan.buyVenue).toLowerCase())
    && CEX_EXECUTION_VENUES.has(String(plan.sellVenue).toLowerCase());
}

function correctedCompleteness(missingInformation: readonly string[]): number {
  const critical = [...new Set(missingInformation)]
    .filter(item => !item.startsWith('optional:'));
  return Number(Math.max(0, Math.min(1, 1 - critical.length / 8)).toFixed(4));
}

function recordCanonicalAssessment(
  context: CryptaraOpportunityContext,
  assessment: CryptaraOpportunityAssessment,
): void {
  const priorCanonical = canonicalOpportunityState.get(context.opportunityId);
  const priorCanonicalMonteCarlo = priorCanonical?.assessment?.monteCarlo
    ? { ...priorCanonical.assessment.monteCarlo }
    : null;
  canonicalOpportunityState.recordAssessment({
    opportunityId: context.opportunityId,
    observedAt: context.observedAt,
    chain: context.chain,
    symbol: context.symbol,
    plan: context.plan,
    technical: context.tradingView,
    mempool: context.mempool,
    assessment: {
      opportunityId: assessment.opportunityId,
      evaluatedAt: assessment.evaluatedAt,
      recommendation: assessment.recommendation,
      rankScore: assessment.rankScore,
      executionConfidence: assessment.executionConfidence,
      probabilityOfProfitableExecution: assessment.probabilityOfProfitableExecution,
      riskLevel: assessment.riskLevel,
      dataCompleteness: assessment.dataCompleteness,
      marketData: { ...assessment.marketData },
      missingInformation: [...assessment.missingInformation],
      provenance: [...assessment.provenance],
      monteCarlo: priorCanonicalMonteCarlo,
    },
  });
}

function correctCexMempoolApplicability(
  context: CryptaraOpportunityContext,
  assessment: CryptaraOpportunityAssessment,
): CryptaraOpportunityAssessment {
  if (!isCexCexPlan(context)) return assessment;
  if (!assessment.missingInformation.includes('mempool_evidence')) return assessment;

  const missingInformation = assessment.missingInformation
    .filter(item => item !== 'mempool_evidence');
  const dataCompleteness = correctedCompleteness(missingInformation);
  const rankScore = assessment.netProfitMargin !== null
    && assessment.probabilityOfProfitableExecution !== null
    ? Number((
        assessment.netProfitMargin
        * 10_000
        * assessment.probabilityOfProfitableExecution
        * dataCompleteness
      ).toFixed(4))
    : null;
  const recommendation: CryptaraOpportunityAssessment['recommendation'] = rankScore === null
    ? 'observe'
    : rankScore > 0 && assessment.probabilityOfProfitableExecution! >= 0.6
      ? 'consider'
      : 'reject';
  const provenance = [...new Set([
    ...assessment.provenance,
    'topology:CEX_CEX',
    'not_applicable:mempool_evidence',
  ])];

  const corrected: CryptaraOpportunityAssessment = {
    ...assessment,
    recommendation,
    rankScore,
    dataCompleteness,
    missingInformation,
    provenance,
  };

  recordCanonicalAssessment(context, corrected);
  return corrected;
}

function applyMeasuredCrossImpactScheduling(
  context: CryptaraOpportunityContext,
  assessment: CryptaraOpportunityAssessment,
): CryptaraOpportunityAssessment {
  if (!isCexCexPlan(context) || !context.plan) return assessment;
  const advisory = evaluateCexCrossImpactPriority(context.opportunityId, context.plan);
  if (!(advisory.priorityFactor < 1) || assessment.rankScore === null || !(assessment.rankScore > 0)) return assessment;

  const adjusted: CryptaraOpportunityAssessment = {
    ...assessment,
    // Scheduling rank only. Recommendation, probability, deterministic economics,
    // plan notional, stage eligibility, and execution authority are unchanged.
    rankScore: Number((assessment.rankScore * advisory.priorityFactor).toFixed(4)),
    provenance: [...new Set([
      ...assessment.provenance,
      ...advisory.provenance,
      `cross_impact:priority_factor=${advisory.priorityFactor.toFixed(6)}`,
      `cross_impact:measured_pairs=${advisory.measuredPairs}`,
      'cross_impact:economic_authority=false',
      'cross_impact:execution_authority=false',
    ])],
  };
  recordCanonicalAssessment(context, adjusted);

  log.info('Measured cross-impact adjusted CEX scheduling rank only', {
    opportunityId: context.opportunityId,
    symbol: context.symbol,
    competingPlans: advisory.competingPlans,
    measuredPairs: advisory.measuredPairs,
    maxPositiveCorrelation: advisory.maxPositiveCorrelation,
    aggregateMeasuredPressure: advisory.aggregateMeasuredPressure,
    priorityFactor: advisory.priorityFactor,
    canonicalNetProfitUsd: context.plan.netProfitUsd,
    recommendationChanged: false,
    economicsChanged: false,
    eligibilityChanged: false,
    executionAuthority: false,
  });
  return adjusted;
}

/**
 * Topology adapter layered after the authoritative Cryptara assessment stack.
 * It changes no economics, Monte Carlo output, or execution thresholds. It removes
 * the on-chain mempool completeness penalty from implemented CEX_CEX plans and can
 * use measured cross-asset/venue pressure to order already-eligible work only.
 */
export function ensureCryptaraCexEvidenceWiring(): Cryptara {
  // Always install the bootstrap-aware Monte Carlo / canonical assessment stack
  // before wrapping it with CEX topology applicability. This removes entry-point
  // order dependence without changing any execution or profitability authority.
  const instance = ensureCryptaraAssessmentWiring();
  if (installed.has(instance)) return instance;
  installed.add(instance);

  const target = instance as unknown as CryptaraAssessmentTarget;
  const originalAssessOpportunity = target.assessOpportunity.bind(target);
  target.assessOpportunity = async (
    context: CryptaraOpportunityContext,
  ): Promise<CryptaraOpportunityAssessment> => {
    const assessment = await originalAssessOpportunity(context);
    const topologyCorrected = correctCexMempoolApplicability(context, assessment);
    return applyMeasuredCrossImpactScheduling(context, topologyCorrected);
  };

  ensureCryptaraProviderConsensusWiring();

  log.info('Cryptara CEX topology evidence wiring installed', {
    cexVenues: [...CEX_EXECUTION_VENUES],
    assessmentAuthority: 'bootstrap_aware_canonical_stack',
    mempoolEvidenceApplicability: 'not_applicable_for_CEX_CEX',
    measuredCrossImpactRole: 'scheduling_rank_only',
    crossImpactEconomicAuthority: false,
    crossImpactEligibilityAuthority: false,
    crossImpactExecutionAuthority: false,
    unsupportedVenueCompletenessCorrectionAllowed: false,
    syntheticMempoolEvidenceCreated: false,
    canonicalMonteCarloPreserved: true,
    monteCarloChanged: false,
    economicsChanged: false,
    providerConsensusFoundation: 'measured_advisory_only',
  });

  return instance;
}

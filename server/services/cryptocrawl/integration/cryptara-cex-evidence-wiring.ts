import type Cryptara from '../../cryptara/index.js';
import {
  getCryptara,
  type CryptaraOpportunityAssessment,
  type CryptaraOpportunityContext,
} from '../../cryptara/index.js';
import { createLogger } from '../../../logger.js';
import { canonicalOpportunityState } from '../intelligence/canonical-opportunity-state.js';

const log = createLogger('CryptaraCexEvidenceWiring');
const installed = new WeakSet<object>();
const CEX_EXECUTION_VENUES = new Set(['kraken', 'okx']);

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

  canonicalOpportunityState.recordAssessment({
    opportunityId: context.opportunityId,
    observedAt: context.observedAt,
    chain: context.chain,
    symbol: context.symbol,
    plan: context.plan,
    technical: context.tradingView,
    mempool: context.mempool,
    assessment: {
      opportunityId: corrected.opportunityId,
      evaluatedAt: corrected.evaluatedAt,
      recommendation: corrected.recommendation,
      rankScore: corrected.rankScore,
      executionConfidence: corrected.executionConfidence,
      probabilityOfProfitableExecution: corrected.probabilityOfProfitableExecution,
      riskLevel: corrected.riskLevel,
      dataCompleteness: corrected.dataCompleteness,
      marketData: { ...corrected.marketData },
      missingInformation: [...corrected.missingInformation],
      provenance: [...corrected.provenance],
      monteCarlo: corrected.monteCarlo ? { ...corrected.monteCarlo } : null,
    },
  });

  return corrected;
}

/**
 * Topology adapter layered after the existing Cryptara assessment authority.
 * It changes no economics, Monte Carlo output, or execution thresholds. It only
 * removes the on-chain mempool completeness penalty from Kraken/OKX CEX_CEX plans.
 */
export function ensureCryptaraCexEvidenceWiring(): Cryptara {
  const instance = getCryptara();
  if (installed.has(instance)) return instance;
  installed.add(instance);

  const target = instance as unknown as CryptaraAssessmentTarget;
  const originalAssessOpportunity = target.assessOpportunity.bind(target);
  target.assessOpportunity = async (
    context: CryptaraOpportunityContext,
  ): Promise<CryptaraOpportunityAssessment> => {
    const assessment = await originalAssessOpportunity(context);
    return correctCexMempoolApplicability(context, assessment);
  };

  log.info('Cryptara CEX topology evidence wiring installed', {
    cexVenues: [...CEX_EXECUTION_VENUES],
    mempoolEvidenceApplicability: 'not_applicable_for_CEX_CEX',
    syntheticMempoolEvidenceCreated: false,
    monteCarloChanged: false,
    economicsChanged: false,
  });

  return instance;
}

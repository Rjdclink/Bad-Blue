import type Cryptara from '../../cryptara/index.js';
import type {
  CryptaraOpportunityAssessment,
  CryptaraOpportunityContext,
  MonteCarloResult,
} from '../../cryptara/index.js';
import { createLogger } from '../../../logger.js';
import { canonicalOpportunityState } from '../intelligence/canonical-opportunity-state.js';
import { ensureCryptaraBeamWiring } from './cryptara-beam-wiring.js';

const log = createLogger('CryptaraAssessmentWiring');
const installed = new WeakSet<object>();
const warningState = new Map<string, { signature: string; emittedAt: number }>();
const WARNING_REPEAT_MS = Math.max(10_000, Number(process.env.CRYPTARA_INCOMPLETE_WARNING_REPEAT_MS || 60_000));

type CryptaraAssessmentInternals = {
  status: { isRunning: boolean };
  latestOpportunityContext: CryptaraOpportunityContext | null;
  latestMonteCarloEvidence: unknown | null;
  runMonteCarloSimulation: (context?: CryptaraOpportunityContext, signal?: AbortSignal) => Promise<MonteCarloResult>;
  recordOpportunityObservation: (context: CryptaraOpportunityContext) => CryptaraOpportunityAssessment;
  assessOpportunity: (context: CryptaraOpportunityContext) => Promise<CryptaraOpportunityAssessment>;
};

type MissingInformationClassification = {
  critical: string[];
  optional: string[];
};

function missingFromError(error: unknown): string[] {
  const message = error instanceof Error ? error.message : String(error);
  if (message.startsWith('EVIDENCE_INCOMPLETE:')) {
    return message.replace('EVIDENCE_INCOMPLETE:', '').trim().split(',').map(value => value.trim()).filter(Boolean);
  }
  if (message.startsWith('Cryptara Monte Carlo requires measured context: ')) {
    return message.replace('Cryptara Monte Carlo requires measured context: ', '').split(', ').filter(Boolean);
  }
  if (message.includes('HYPER_ABORTED') || message.includes('timed out') || message.includes('cancelled')) {
    return ['monte_carlo_timeout'];
  }
  return ['monte_carlo_execution'];
}

function isTopologyOptionalProvider(item: string, context: CryptaraOpportunityContext): boolean {
  if (item.startsWith('provider_coinstats_')) return true;
  if (context.chain !== 'cex') return false;

  // Core CEX execution is independently grounded in direct exchange books,
  // authenticated exchange fee evidence, measured depth and settlement-safe
  // venue adapters. CoinCap and 0x are enrichment/discovery providers only for
  // this topology; their outage must not veto an otherwise complete CEX plan.
  return item.startsWith('provider_coincap_') || item.startsWith('provider_0x_');
}

function classifyMissingInformation(
  items: readonly string[],
  context: CryptaraOpportunityContext,
): MissingInformationClassification {
  const critical: string[] = [];
  const optional: string[] = [];
  for (const item of [...new Set(items)]) {
    if (isTopologyOptionalProvider(item, context)) optional.push(item);
    else critical.push(item);
  }
  return { critical, optional };
}

function shouldEmitIncompleteWarning(opportunityKey: string, missing: string[]): boolean {
  const signature = [...new Set(missing)].sort().join('|');
  const now = Date.now();
  const previous = warningState.get(opportunityKey);
  if (!previous || previous.signature !== signature || now - previous.emittedAt >= WARNING_REPEAT_MS) {
    warningState.set(opportunityKey, { signature, emittedAt: now });
    return true;
  }
  return false;
}

function decorateOptionalEvidence(
  assessment: CryptaraOpportunityAssessment,
  optionalMissing: readonly string[],
): CryptaraOpportunityAssessment {
  if (optionalMissing.length === 0) return assessment;
  return {
    ...assessment,
    // Optional enrichment is surfaced for operators without being counted as a
    // critical completeness defect by Cryptara's authoritative rank calculation.
    missingInformation: [
      ...assessment.missingInformation,
      ...optionalMissing.map(item => `optional:${item}`),
    ],
    provenance: [
      ...new Set([
        ...assessment.provenance,
        ...optionalMissing.map(item => `optional_missing:${item}`),
      ]),
    ],
  };
}

function enforceDeterministicRejection(
  context: CryptaraOpportunityContext,
  assessment: CryptaraOpportunityAssessment,
): CryptaraOpportunityAssessment {
  const plan = context.plan;
  if (!plan || !Number.isFinite(plan.netProfitUsd) || plan.netProfitUsd > 0) return assessment;

  const missingInformation = assessment.missingInformation.filter(item => item !== 'monte_carlo_evidence');
  const provenance = [...new Set([...assessment.provenance, 'deterministic_all_in_economics'])];
  const corrected: CryptaraOpportunityAssessment = {
    ...assessment,
    recommendation: 'reject',
    rankScore: 0,
    probabilityOfProfitableExecution: 0,
    monteCarlo: null,
    missingInformation,
    provenance,
  };

  // Cryptara's base recorder historically treated any plan without Monte Carlo as
  // incomplete. For deterministic non-positive economics MC is intentionally not
  // required, so overwrite the canonical snapshot with the authoritative rejection.
  // This records no synthetic evidence: P(profitable execution)=0 follows directly
  // from the already-measured all-in net economics being <= 0.
  canonicalOpportunityState.recordAssessment({
    opportunityId: context.opportunityId,
    observedAt: context.observedAt,
    chain: context.chain,
    symbol: context.symbol,
    plan,
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
      monteCarlo: null,
    },
  });

  return corrected;
}

export function ensureCryptaraAssessmentWiring(): Cryptara {
  const instance = ensureCryptaraBeamWiring();
  if (installed.has(instance)) return instance;
  installed.add(instance);
  const target = instance as unknown as CryptaraAssessmentInternals;

  target.assessOpportunity = async (context: CryptaraOpportunityContext): Promise<CryptaraOpportunityAssessment> => {
    // Reset evidence for every observation, even when no verified plan exists. Stable
    // opportunity IDs are reused across cycles, so stale Monte Carlo evidence must
    // never survive into the next observation.
    target.latestMonteCarloEvidence = null;
    target.latestOpportunityContext = structuredClone(context);
    let monteCarloMissingInformation: string[] = [];
    const missing = classifyMissingInformation(context.missingInformation, context);

    // Deterministic all-in economics are authoritative and must run before stochastic
    // execution-uncertainty analysis. Monte Carlo may estimate realization probability
    // for an already-positive plan; it must never spend Beam capacity on, or transform,
    // a deterministic zero/negative candidate into a tradeable opportunity.
    const deterministicPositivePlan = !!context.plan &&
      Number.isFinite(context.plan.netProfitUsd) &&
      context.plan.netProfitUsd > 0;

    if (deterministicPositivePlan && target.status.isRunning) {
      try {
        await target.runMonteCarloSimulation({
          ...context,
          missingInformation: missing.critical,
          provenance: [
            ...context.provenance,
            ...missing.optional.map(item => `optional_missing:${item}`),
          ],
        });
      } catch (error) {
        monteCarloMissingInformation = missingFromError(error);
        const opportunityKey = `${context.opportunityId}:${context.observedAt}`;
        if (shouldEmitIncompleteWarning(opportunityKey, monteCarloMissingInformation)) {
          log.warn('Cryptara opportunity Hyper Monte Carlo incomplete; retaining explicit evidence state', {
            opportunityId: context.opportunityId,
            observedAt: context.observedAt,
            symbol: context.symbol,
            missingInformation: monteCarloMissingInformation,
            repeatWindowMs: WARNING_REPEAT_MS,
          });
        }
      }
    } else if (context.plan && !deterministicPositivePlan) {
      log.debug('Cryptara Monte Carlo skipped for deterministic non-positive economics', {
        opportunityId: context.opportunityId,
        observedAt: context.observedAt,
        symbol: context.symbol,
        netProfitUsd: context.plan.netProfitUsd,
      });
    }

    const assessment = target.recordOpportunityObservation({
      ...context,
      missingInformation: [...new Set([...missing.critical, ...monteCarloMissingInformation])],
      provenance: [
        ...context.provenance,
        ...missing.optional.map(item => `optional_missing:${item}`),
      ],
    });
    const decorated = decorateOptionalEvidence(assessment, missing.optional);
    return enforceDeterministicRejection(context, decorated);
  };

  log.info('Cryptara assessment wiring installed', {
    incompleteWarningRepeatMs: WARNING_REPEAT_MS,
    warningTransitionsImmediate: true,
    monteCarloCompute: 'computational_beam_hyper_worker_pool',
    deterministicPositiveGateBeforeMonteCarlo: true,
    deterministicNonPositiveRecommendation: 'reject',
    optionalProviderMissingDoesNotReduceRank: ['coinstats', 'cex:coincap', 'cex:0x'],
    immutableOpportunityInput: true,
    staleEvidenceIsolation: true,
  });
  return instance;
}

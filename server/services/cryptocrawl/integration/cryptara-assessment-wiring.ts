import type Cryptara from '../../cryptara/index.js';
import type {
  CryptaraOpportunityAssessment,
  CryptaraOpportunityContext,
  MonteCarloResult,
} from '../../cryptara/index.js';
import { createLogger } from '../../../logger.js';
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

    // Deterministic all-in economics are authoritative and must run before stochastic
    // execution-uncertainty analysis. Monte Carlo may estimate realization probability
    // for an already-positive plan; it must never spend Beam capacity on, or transform,
    // a deterministic zero/negative candidate into a tradeable opportunity.
    const deterministicPositivePlan = !!context.plan &&
      Number.isFinite(context.plan.netProfitUsd) &&
      context.plan.netProfitUsd > 0;

    if (deterministicPositivePlan && target.status.isRunning) {
      try {
        await target.runMonteCarloSimulation(context);
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

    return target.recordOpportunityObservation({
      ...context,
      missingInformation: [...new Set([...context.missingInformation, ...monteCarloMissingInformation])],
    });
  };

  log.info('Cryptara assessment wiring installed', {
    incompleteWarningRepeatMs: WARNING_REPEAT_MS,
    warningTransitionsImmediate: true,
    monteCarloCompute: 'computational_beam_hyper_worker_pool',
    deterministicPositiveGateBeforeMonteCarlo: true,
    immutableOpportunityInput: true,
    staleEvidenceIsolation: true,
  });
  return instance;
}
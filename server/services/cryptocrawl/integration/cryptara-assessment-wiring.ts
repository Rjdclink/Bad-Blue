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

    if (context.plan && target.status.isRunning) {
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
    immutableOpportunityInput: true,
    staleEvidenceIsolation: true,
  });
  return instance;
}

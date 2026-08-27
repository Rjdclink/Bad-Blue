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
  runMonteCarloSimulation: () => Promise<MonteCarloResult>;
  recordOpportunityObservation: (context: CryptaraOpportunityContext) => CryptaraOpportunityAssessment;
  assessOpportunity: (context: CryptaraOpportunityContext) => Promise<CryptaraOpportunityAssessment>;
};

function missingFromError(error: unknown): string[] {
  const message = error instanceof Error ? error.message : String(error);
  return message.startsWith('Cryptara Monte Carlo requires measured context: ')
    ? message.replace('Cryptara Monte Carlo requires measured context: ', '').split(', ').filter(Boolean)
    : ['monte_carlo_evidence'];
}

function shouldEmitIncompleteWarning(opportunityId: string, missing: string[]): boolean {
  const signature = [...new Set(missing)].sort().join('|');
  const now = Date.now();
  const previous = warningState.get(opportunityId);
  if (!previous || previous.signature !== signature || now - previous.emittedAt >= WARNING_REPEAT_MS) {
    warningState.set(opportunityId, { signature, emittedAt: now });
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
    target.latestOpportunityContext = context;
    let monteCarloMissingInformation: string[] = [];

    if (context.plan && target.status.isRunning) {
      try {
        await target.runMonteCarloSimulation();
      } catch (error) {
        monteCarloMissingInformation = missingFromError(error);
        if (shouldEmitIncompleteWarning(context.opportunityId, monteCarloMissingInformation)) {
          log.warn('Cryptara opportunity Monte Carlo incomplete; retaining explicit evidence state', {
            opportunityId: context.opportunityId,
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
    monteCarloCompute: 'computational_beam',
  });
  return instance;
}

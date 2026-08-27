import type Cryptara from '../../cryptara/index.js';
import type { CryptaraOpportunityContext, MonteCarloResult } from '../../cryptara/index.js';
import { createLogger } from '../../../logger.js';
import { workloadRouter } from '../../computationalBeam/workloadRouter.js';
import { ComputeLayer, TaskIntensity, TaskPriority, TaskType, type Task } from '../../computationalBeam/types.js';
import { getMonteCarloPolicy, type MonteCarloTopology } from '../validation/monte-carlo-policy.js';
import { ensureAuthoritativeMonteCarloWiring } from './authoritative-monte-carlo-wiring.js';

const log = createLogger('CryptaraBeamWiring');
const installed = new WeakSet<object>();

function validMonteCarloResult(result: unknown): result is MonteCarloResult {
  if (!result || typeof result !== 'object') return false;
  const value = result as MonteCarloResult;
  return typeof value.simulationId === 'string' &&
    value.timestamp instanceof Date &&
    Number.isFinite(value.iterations) && value.iterations > 0 &&
    Array.isArray(value.scenarios) &&
    !!value.riskMetrics &&
    Number.isFinite(value.riskMetrics.valueAtRisk) &&
    Number.isFinite(value.riskMetrics.expectedShortfall) &&
    Number.isFinite(value.riskMetrics.maxDrawdown);
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isEvidenceIncomplete(error: unknown): boolean {
  const message = messageOf(error);
  return message.startsWith('EVIDENCE_INCOMPLETE:') ||
    message.startsWith('Cryptara Monte Carlo requires measured context:');
}

function quoteDeadline(context: CryptaraOpportunityContext): number | undefined {
  if (!context.plan) return undefined;
  const quoteMaxAgeMs = Math.max(1, Number(process.env.CRYPTO_ARBITRAGE_MAX_QUOTE_AGE_MS || 5000));
  const elapsedSinceObservationMs = Math.max(0, Date.now() - context.observedAt);
  const currentQuoteAgeMs = Math.max(0, context.plan.quoteAgeMs + elapsedSinceObservationMs);
  const remainingMs = quoteMaxAgeMs - currentQuoteAgeMs;
  if (remainingMs <= 0) throw new Error('EVIDENCE_INCOMPLETE: fresh_verified_quote');
  return Date.now() + remainingMs;
}

function topology(context: CryptaraOpportunityContext): MonteCarloTopology {
  if (context.routeObservation) return 'ZERO_CAPITAL';
  if (context.plan?.bridge) return 'CROSS_CHAIN';
  return 'CEX_CEX';
}

function beamPolicyMetadata(context: CryptaraOpportunityContext) {
  const plan = context.plan;
  if (!plan) return null;
  const quoteMaxAgeMs = Math.max(1, Number(process.env.CRYPTO_ARBITRAGE_MAX_QUOTE_AGE_MS || 5000));
  const policy = getMonteCarloPolicy({
    topology: topology(context),
    notionalUsd: plan.notionalUsd,
    deterministicNetProfitUsd: plan.netProfitUsd,
    confidence: Math.max(0.01, Math.min(0.999, 1 - plan.quoteAgeMs / quoteMaxAgeMs)),
    quoteAgeMs: plan.quoteAgeMs,
    quoteMaxAgeMs,
    calibrationSamples: 0,
    executionHorizonMs: plan.bridge ? Math.max(quoteMaxAgeMs, plan.bridge.estimatedTimeSec * 1000) : quoteMaxAgeMs,
  });
  return {
    topology: policy.topology,
    simulationTier: policy.ordinarySamples >= 10_000 ? 'deep' : policy.ordinarySamples >= 2_000 ? 'ordinary' : 'screen',
    ordinarySampleBudget: policy.ordinarySamples,
    maximumSampleBudget: policy.maxSamples,
    expectedOpportunityValueUsd: plan.netProfitUsd,
    candidateExpiresAt: context.observedAt + quoteMaxAgeMs,
    policyVersion: policy.policyVersion,
  };
}

async function runThroughBeam(task: Task): Promise<MonteCarloResult> {
  return new Promise<MonteCarloResult>((resolve, reject) => {
    let settled = false;
    const cleanup = () => {
      workloadRouter.off('task-completed', onCompleted);
      workloadRouter.off('task-failed', onFailed);
    };
    const onCompleted = (event: { taskId: string; result?: unknown }) => {
      if (event.taskId !== task.id || settled) return;
      settled = true;
      cleanup();
      const result = event.result ?? workloadRouter.consumeTaskOutcome(task.id)?.result;
      if (!validMonteCarloResult(result)) {
        reject(new Error(`MC_INVALID_RESULT: Beam returned invalid Monte Carlo result for ${task.id}`));
        return;
      }
      resolve(result);
    };
    const onFailed = (event: { taskId: string; error?: string }) => {
      if (event.taskId !== task.id || settled) return;
      settled = true;
      cleanup();
      const error = event.error || `BEAM_EXECUTION_FAILED: Beam task ${task.id} failed`;
      if (/deadline expired/i.test(error)) {
        reject(new Error('EVIDENCE_INCOMPLETE: fresh_verified_quote'));
        return;
      }
      reject(new Error(error));
    };
    workloadRouter.on('task-completed', onCompleted);
    workloadRouter.on('task-failed', onFailed);
    void workloadRouter.routeTask(task).catch(error => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    });
  });
}

export function ensureCryptaraBeamWiring(): Cryptara {
  const instance = ensureAuthoritativeMonteCarloWiring();
  if (installed.has(instance)) return instance;
  installed.add(instance);
  const target = instance as unknown as {
    latestOpportunityContext: CryptaraOpportunityContext | null;
    runMonteCarloSimulation: (context?: CryptaraOpportunityContext, signal?: AbortSignal) => Promise<MonteCarloResult>;
  };
  const originalRun = target.runMonteCarloSimulation.bind(target);

  target.runMonteCarloSimulation = async (contextOverride?: CryptaraOpportunityContext): Promise<MonteCarloResult> => {
    const sourceContext = contextOverride ?? target.latestOpportunityContext;
    if (!sourceContext) throw new Error('EVIDENCE_INCOMPLETE: verified_opportunity_context');

    const immutableContext = structuredClone(sourceContext);
    const deadlineAt = quoteDeadline(immutableContext);
    const policyMetadata = beamPolicyMetadata(immutableContext);
    const task = workloadRouter.createTask(TaskType.MONTE_CARLO, {
      source: 'cryptara_authoritative_adaptive_mc',
      opportunityId: immutableContext.opportunityId,
      observedAt: immutableContext.observedAt,
      topology: policyMetadata?.topology ?? 'UNKNOWN',
      simulationTier: policyMetadata?.simulationTier ?? 'screen',
      sampleBudget: policyMetadata?.ordinarySampleBudget ?? 0,
      maxSampleBudget: policyMetadata?.maximumSampleBudget ?? 0,
      expectedOpportunityValueUsd: policyMetadata?.expectedOpportunityValueUsd ?? null,
      candidateExpiresAt: policyMetadata?.candidateExpiresAt ?? deadlineAt ?? null,
      policyVersion: policyMetadata?.policyVersion ?? null,
      convergenceState: 'pending',
      quantiDeadlineAt: deadlineAt,
      quantiParallelismHint: 1,
      quantiUsefulWorkUnits: Math.max(1, policyMetadata?.ordinarySampleBudget ?? 1),
    }, {
      intensity: TaskIntensity.HEAVY,
      priority: TaskPriority.HIGH,
      requiredLayer: ComputeLayer.BEAM,
    });
    task.workload = {
      id: `cryptara-authoritative-adaptive-mc:${task.id}`,
      type: 'cryptara_authoritative_adaptive_monte_carlo',
      input: {
        requestedAt: Date.now(),
        context: immutableContext,
      },
      timeoutMs: Math.max(5_000, Number(process.env.CRYPTARA_BEAM_MONTE_CARLO_TIMEOUT_MS || 30_000)),
      execute: async (input, beamContext) => {
        if (beamContext.signal.aborted) throw new Error('MC_ABORTED: Beam workload aborted before execution');
        const workloadInput = input as { requestedAt: number; context: CryptaraOpportunityContext };
        const expiration = policyMetadata?.candidateExpiresAt;
        if (expiration !== undefined && Date.now() >= expiration) {
          throw new Error('EVIDENCE_INCOMPLETE: fresh_verified_quote');
        }
        return originalRun(workloadInput.context, beamContext.signal);
      },
      validate: result => validMonteCarloResult(result),
    };

    try {
      const result = await runThroughBeam(task);
      log.info('Authoritative adaptive Monte Carlo completed through Computational Beam', {
        component: 'CryptaraBeamWiring',
        taskId: task.id,
        opportunityId: immutableContext.opportunityId,
        observedAt: immutableContext.observedAt,
        simulationId: result.simulationId,
        iterations: result.iterations,
        topology: policyMetadata?.topology ?? 'UNKNOWN',
        simulationTier: policyMetadata?.simulationTier ?? 'screen',
        sampleBudget: policyMetadata?.ordinarySampleBudget ?? 0,
        maxSampleBudget: policyMetadata?.maximumSampleBudget ?? 0,
        expectedOpportunityValueUsd: policyMetadata?.expectedOpportunityValueUsd ?? null,
        candidateExpiresAt: policyMetadata?.candidateExpiresAt ?? null,
        policyVersion: policyMetadata?.policyVersion ?? null,
        quantiDeadlineAt: deadlineAt,
      });
      return result;
    } catch (error) {
      const message = messageOf(error);
      if (isEvidenceIncomplete(error)) {
        log.info('Authoritative Monte Carlo evidence incomplete', {
          component: 'CryptaraBeamWiring', taskId: task.id,
          opportunityId: immutableContext.opportunityId, observedAt: immutableContext.observedAt, error: message,
        });
      } else if (message.includes('MC_ABORTED') || message.includes('timed out') || message.includes('cancelled')) {
        log.warn('Authoritative Monte Carlo Beam workload aborted or timed out', {
          component: 'CryptaraBeamWiring', taskId: task.id, opportunityId: immutableContext.opportunityId, error: message,
        });
      } else {
        log.warn('Computational Beam authoritative Monte Carlo execution failed', {
          component: 'CryptaraBeamWiring', taskId: task.id, opportunityId: immutableContext.opportunityId, error: message,
        });
      }
      throw error;
    }
  };

  log.info('Cryptara Computational Beam authoritative Monte Carlo wiring installed', {
    component: 'CryptaraBeamWiring',
    workload: 'cryptara_authoritative_adaptive_monte_carlo',
    immutableTaskInput: true,
    sharedPolicyAuthority: true,
    quoteDeadlineBound: true,
    expiredCandidateCancellation: true,
    executionAuthority: false,
  });
  return instance;
}
